import { homedir } from "os";
import * as path from "path";
import * as fs from "fs";

// claude --print 중첩 세션 방지: 서버 프로세스 레벨에서 환경변수 제거
delete process.env.CLAUDECODE;
delete process.env.CLAUDE_CODE_ENTRYPOINT;

// ─── Config & i18n ──────────────────────────────────────────────
const CONFIG_PATH = path.join(process.env.HOME || '', '.claude/plugins/backstage/config.json');
let config: { language: string; ai_dialogue: boolean } = { language: 'en', ai_dialogue: true };
try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); } catch {}

const I18N_PATH = path.join(import.meta.dir, `i18n/${config.language}.json`);
let i18n: any;
try { i18n = JSON.parse(fs.readFileSync(I18N_PATH, 'utf-8')); } catch {
  i18n = JSON.parse(fs.readFileSync(path.join(import.meta.dir, 'i18n/en.json'), 'utf-8'));
}

const SERVER_START_TIME = Date.now();
const SERVER_START_EPOCH = Math.floor(SERVER_START_TIME / 1000);
const PLUGIN_DIR = path.join(homedir(), ".claude/plugins/backstage");
const HISTORY_FILE =
  process.env.BACKSTAGE_HISTORY ||
  path.join(PLUGIN_DIR, "history.jsonl");

const CHRIS_LOG_FILE = path.join(PLUGIN_DIR, "chris-log.jsonl");
const DIALOGUE_QUEUE_FILE = path.join(PLUGIN_DIR, "dialogue-queue.jsonl");

const CHARACTERS_FILE = (() => {
  const local = path.join(import.meta.dir, "../hooks/characters.json");
  if (fs.existsSync(local)) return local;
  return path.join(PLUGIN_DIR, "characters.json");
})();

const HTML_FILE = path.join(import.meta.dir, "./index.html");
const VIEWER_DIR = import.meta.dir;

// Read version from plugin.json (single source of truth)
const PLUGIN_VERSION = (() => {
  try {
    const pj = path.join(import.meta.dir, "../.claude-plugin/plugin.json");
    return JSON.parse(fs.readFileSync(pj, "utf-8")).version || "0.0.0";
  } catch { return "0.0.0"; }
})();

// MIME types for static files
const MIME_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".html": "text/html; charset=utf-8",
};

const PORT = Number(process.env.BACKSTAGE_PORT) || 7777;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// 서버 시작 시 캐시 버스트 키 생성 (재시작할 때마다 갱신 → 브라우저 캐싱 자동 무효화)
const CACHE_BUST = Date.now().toString(36);

let lastUserMessage = '';
let lastChapterUserMsg = '';  // 마지막 챕터의 사용자 메시지 (그룹핑용)
let pendingChapterSteps: any[] = [];  // 진행 중인 챕터의 steps (thinking만 있을 때 pending에 표시)

// ─── Dynamic agent pool (no fixed role mapping) ─────────────────
const AGENT_POOL = ['Jake', 'David', 'Kevin', 'Sophie', 'Emily', 'Michael', 'Alex', 'Sam'];
const agentAssignments = new Map<string, string>(); // agentId → charName
const usedCharacters = new Set<string>(); // currently occupied characters

function assignCharacter(agentId: string, _agentType: string): string {
  // Already assigned?
  const existing = agentAssignments.get(agentId);
  if (existing) return existing;

  // Find first available character from pool
  for (const name of AGENT_POOL) {
    if (!usedCharacters.has(name)) {
      agentAssignments.set(agentId, name);
      usedCharacters.add(name);
      return name;
    }
  }
  // All occupied — reuse first in pool
  const fallback = AGENT_POOL[0];
  agentAssignments.set(agentId, fallback);
  return fallback;
}

function releaseCharacter(agentId: string): string | null {
  const name = agentAssignments.get(agentId);
  if (name) {
    agentAssignments.delete(agentId);
    usedCharacters.delete(name);
  }
  return name || null;
}

// Legacy lookup for agent type → name (fallback for non-pooled lookups)
const AGENT_NAMES: Record<string, string> = {};
// Not used for assignment anymore, but kept for hook compatibility

// Reverse mapping: name → primary role (dynamic, updated on assign)
const NAME_TO_ROLE: Record<string, string> = {
  'Jake': 'agent', 'David': 'agent', 'Kevin': 'agent',
  'Sophie': 'agent', 'Emily': 'agent',
  'Michael': 'agent', 'Alex': 'agent', 'Sam': 'agent',
};

const AGENT_PERSONALITIES: Record<string, string> = i18n.agent_personalities || {};

// ─── C-Team Personalities (for AI dialogue generation) ────────
// Tool info: emojis are fixed, verbs come from i18n
const TOOL_EMOJIS: Record<string, string> = {
  'Read': '📖', 'Glob': '🔍', 'Grep': '🔎',
  'Edit': '✏️', 'Write': '📝', 'Bash': '💻',
};
const toolVerbs: Record<string, string> = i18n.tool_verbs || {};
const toolVerbDefault: string = i18n.tool_verb_default || 'working';
const TOOL_INFO: Record<string, { emoji: string; verb: string }> = {};
for (const [tool, emoji] of Object.entries(TOOL_EMOJIS)) {
  TOOL_INFO[tool] = { emoji, verb: toolVerbs[tool] || toolVerbDefault };
}

// ─── Idle chat lines (break room) — loaded from i18n ────────────
const IDLE_CHATS: string[] = i18n.idle_chats || [];

// ─── Utility functions ──────────────────────────────────────────

function ensureHistoryFile(): void {
  const dir = path.dirname(HISTORY_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(HISTORY_FILE, "");
  }
}

function getLastNLines(filePath: string, n: number): unknown[] {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(-n);

  const results: unknown[] = [];
  for (const line of lines) {
    try {
      results.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }
  return results;
}

function readNewLines(filePath: string, fromOffset: number): { lines: unknown[]; newOffset: number } {
  if (!fs.existsSync(filePath)) return { lines: [], newOffset: fromOffset };

  const stat = fs.statSync(filePath);

  if (stat.size < fromOffset) {
    fromOffset = 0;
  }

  if (stat.size <= fromOffset) return { lines: [], newOffset: fromOffset };

  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, "r");
    const buffer = Buffer.allocUnsafe(stat.size - fromOffset);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, fromOffset);

    const chunk = buffer.subarray(0, bytesRead).toString("utf-8");
    const rawLines = chunk.split("\n").filter((line) => line.trim().length > 0);

    const lines: unknown[] = [];
    for (const line of rawLines) {
      try { lines.push(JSON.parse(line)); } catch {}
    }
    return { lines, newOffset: fromOffset + bytesRead };
  } catch {
    return { lines: [], newOffset: fromOffset };
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

// ─── Idle Chat Generator (Break Room) ───────────────────────────

let lastIdleChatTime = Date.now();

async function generateIdleChat(): Promise<void> {
  const now = Date.now();

  // AI 대화 ON이면 폴백 대사 비활성화 → AI 대기실 대화만 사용
  if (config.ai_dialogue) return;

  // AI 대화 OFF: 40초 간격 폴백 대사
  if (now - lastIdleChatTime < 40_000) return;
  lastIdleChatTime = now;

  const names = Object.keys(AGENT_PERSONALITIES);
  const name = names[Math.floor(Math.random() * names.length)];
  const role = NAME_TO_ROLE[name] || 'agent';
  const msg = IDLE_CHATS[Math.floor(Math.random() * IDLE_CHATS.length)];

  const ts = new Date().toTimeString().slice(0, 8);
  const epoch = Math.floor(Date.now() / 1000);
  const entry = JSON.stringify({
    ts, epoch, type: 'idle-chat',
    speaker: name, role, msg,
  });

  ensureHistoryFile();
  try { fs.appendFileSync(HISTORY_FILE, entry + '\n'); } catch {}
}

// ─── 랜덤 분위기 (프롬프트 다양화) ─────────────────────────────
const MOODS_KO = ['급박함', '여유있음', '짜증남', '졸림', '신남', '허탈함', '배고픔', '카페인 과다', '월요병', '금요일 설렘', '야근 체념', '코드 잘 돌아서 기분좋음', '버그 발견해서 멘붕', '점심 뭐먹지 고민'];
const MOODS_EN = ['rushed', 'relaxed', 'annoyed', 'sleepy', 'excited', 'defeated', 'hungry', 'over-caffeinated', 'Monday blues', 'Friday vibes', 'overtime resigned', 'code works feeling great', 'found a bug panicking', 'lunch dilemma'];
function randomMood(): string {
  const moods = config.language === 'ko' ? MOODS_KO : MOODS_EN;
  return moods[Math.floor(Math.random() * moods.length)];
}

// ─── 최근 작업 맥락 가져오기 ─────────────────────────────────────
function getRecentWorkContext(): string {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return '';
    const lines = fs.readFileSync(HISTORY_FILE, 'utf-8').split('\n').filter(l => l.trim());
    const recent: string[] = [];
    // 최근 20줄에서 assign/done/request 이벤트의 msg 추출
    const tail = lines.slice(-20);
    for (const line of tail) {
      try {
        const e = JSON.parse(line);
        if ((e.type === 'assign' || e.type === 'done' || e.type === 'request') && e.msg && e.msg.length > 3) {
          recent.push(`${e.speaker}: ${e.msg.slice(0, 60)}`);
        }
      } catch {}
    }
    return recent.slice(-3).join(', ');
  } catch { return ''; }
}

// ─── AI Idle Chat Generator (Break Room — 1분 간격 AI 대화) ─────
let lastAiIdleChatTime = 0;

async function generateAiIdleChat(): Promise<void> {
  if (!config.ai_dialogue) return;
  const now = Date.now();
  if (now - lastAiIdleChatTime < 60_000) return;
  lastAiIdleChatTime = now;

  // 대기실에 있는 캐릭터 2명 랜덤 선택
  const names = Object.keys(AGENT_PERSONALITIES);
  const shuffled = names.sort(() => Math.random() - 0.5);
  const char1 = shuffled[0];
  const char2 = shuffled[1] || shuffled[0];

  // i18n 프롬프트 로드
  const i18nPath = path.join(PLUGIN_DIR, `hooks-i18n/${config.language || 'en'}.json`);
  let i18nData: any = {};
  try { i18nData = JSON.parse(fs.readFileSync(i18nPath, 'utf-8')); } catch {}

  const desc1 = i18nData?.c_team?.[char1] || i18nData?.c_team?._default || 'IT startup team member';
  const desc2 = i18nData?.c_team?.[char2] || i18nData?.c_team?._default || 'IT startup team member';

  const mood = randomMood();
  const workCtx = getRecentWorkContext();
  const ctxKo = workCtx ? ` 팀 근황: ${workCtx}.` : '';
  const ctxEn = workCtx ? ` Team updates: ${workCtx}.` : '';
  const prompt = config.language === 'ko'
    ? `IT스타트업 휴게실. ${char1}(${desc1})와 ${char2}(${desc2})가 잠깐 쉬면서 수다 중. 분위기: ${mood}.${ctxKo} 여유있게 휴식하는 톤, 아재개그/야근드립 가능, 각자 딱 1번씩만, 20-40자/줄, 한국어. JSON만: {"lines":[{"speaker":"${char1}","msg":".."},{"speaker":"${char2}","msg":".."}]}`
    : `IT startup break room. ${char1}(${desc1}) and ${char2}(${desc2}) taking a break, chatting casually. Mood: ${mood}.${ctxEn} Relaxed resting tone, dev humor ok, each speaks exactly once, 20-40 chars/line. JSON only: {"lines":[{"speaker":"${char1}","msg":".."},{"speaker":"${char2}","msg":".."}]}`;

  // dialogue-queue에 추가 (processDialogueQueue가 처리)
  const queueEntry = JSON.stringify({
    epoch: Math.floor(now / 1000),
    speaker: char1,
    role: 'idle',
    type: 'idle-chat',
    prompt,
  });
  try { fs.appendFileSync(DIALOGUE_QUEUE_FILE, queueEntry + '\n'); } catch {}
}

// ─── C-Team 주기적 대화 (1분 간격, 작업 중 드립) ─────────────────
let lastCTeamChatTime = 0;

async function generateCTeamChat(): Promise<void> {
  if (!config.ai_dialogue) return;
  const now = Date.now();
  if (now - lastCTeamChatTime < 60_000) return;
  lastCTeamChatTime = now;

  const cTeamNames = ['Mia', 'Kai', 'Zoe', 'Liam', 'Aria', 'Noah', 'Luna', 'Owen'];
  const char = cTeamNames[Math.floor(Math.random() * cTeamNames.length)];

  const i18nPath = path.join(PLUGIN_DIR, `hooks-i18n/${config.language || 'en'}.json`);
  let i18nData: any = {};
  try { i18nData = JSON.parse(fs.readFileSync(i18nPath, 'utf-8')); } catch {}

  const desc = i18nData?.c_team?.[char] || i18nData?.c_team?._default || 'IT startup team member';

  const mood = randomMood();
  const workCtx = getRecentWorkContext();
  const ctxKo = workCtx ? ` 팀 근황: ${workCtx}.` : '';
  const ctxEn = workCtx ? ` Team updates: ${workCtx}.` : '';
  const prompt = config.language === 'ko'
    ? `IT스타트업. ${char}(${desc}) 무한노동 중 한마디. 분위기: ${mood}.${ctxKo} 아재개그/야근드립 필수, Chris(팀장)와 딱 1번씩, 20-40자/줄, 한국어. JSON만: {"lines":[{"speaker":"boss","msg":".."},{"speaker":"${char}","msg":".."}]}`
    : `IT startup. ${char}(${desc}) working non-stop. Mood: ${mood}.${ctxEn} Dad jokes + overtime humor, exchange with Chris(boss) exactly once each, 20-40 chars/line. JSON only: {"lines":[{"speaker":"boss","msg":".."},{"speaker":"${char}","msg":".."}]}`;

  const queueEntry = JSON.stringify({
    epoch: Math.floor(now / 1000),
    speaker: char,
    role: 'c-team',
    type: 'c-bubble',
    prompt,
  });
  try { fs.appendFileSync(DIALOGUE_QUEUE_FILE, queueEntry + '\n'); } catch {}
}

// ─── Transcript Scanner (Agent Work Detection) ─────────────────

// ─── Usage Tracking ──────────────────────────────────────────
let usageData = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  contextWindow: 0,      // estimated from preTokens on compact
  lastTurnContext: 0,     // last turn's input+cache_read (current context size)
  lastEmitTime: 0,
  fiveHourPercent: null as number | null,
  sevenDayPercent: null as number | null,
};

// ─── Usage API (transcript-based + claude-hud cache fallback) ──
let usageApiCache: { fiveHour: number | null; sevenDay: number | null; ts: number } = { fiveHour: null, sevenDay: null, ts: 0 };
let transcriptUsageTs = 0; // last transcript-based usage scan time

// Transcript-based usage scan: re-accumulate token counts from transcript
function scanTranscriptUsage(): void {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return;
  try {
    const content = fs.readFileSync(transcriptPath, 'utf-8');
    let inputTotal = 0, outputTotal = 0, cacheReadTotal = 0, lastContext = 0;
    for (const line of content.trim().split('\n')) {
      try {
        const e = JSON.parse(line);
        if (e.type === 'assistant' && e.message?.usage) {
          const u = e.message.usage;
          if (u.input_tokens) inputTotal += u.input_tokens;
          if (u.output_tokens) outputTotal += u.output_tokens;
          if (u.cache_read_input_tokens) cacheReadTotal += u.cache_read_input_tokens;
          lastContext = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0);
        }
      } catch {}
    }
    usageData.inputTokens = inputTotal;
    usageData.outputTokens = outputTotal;
    usageData.cacheReadTokens = cacheReadTotal;
    usageData.lastTurnContext = lastContext;
    transcriptUsageTs = Date.now();
  } catch {}
}

async function getUsagePercent(): Promise<{ fiveHour: number | null; sevenDay: number | null }> {
  // 자체 캐시 (60초)
  if (Date.now() - usageApiCache.ts < 60_000 && usageApiCache.fiveHour !== null) {
    return { fiveHour: usageApiCache.fiveHour, sevenDay: usageApiCache.sevenDay };
  }

  // claude-hud 캐시 읽기 (직접 API 호출 안 함 → 429 방지)
  const hudCache = path.join(homedir(), '.claude/plugins/claude-hud/.usage-cache.json');
  try {
    const content = JSON.parse(fs.readFileSync(hudCache, 'utf-8'));
    if (Date.now() - content.timestamp < 300_000) { // 5분 TTL
      usageApiCache = { fiveHour: content.data.fiveHour, sevenDay: content.data.sevenDay, ts: Date.now() };
      return { fiveHour: content.data.fiveHour, sevenDay: content.data.sevenDay };
    }
  } catch {}

  return { fiveHour: null, sevenDay: null };
}

let transcriptOffset = 0;
let transcriptPath: string | null = null;
let currentPlanFile: string | null = null;  // 현재 세션의 plan 파일 (transcript에서 추출)
let transcriptLastCheck = 0;
const agentTypeMap: Record<string, string> = {};
const agentIdToType: Record<string, string> = {};
const subagentOffsets = new Map<string, number>();
const recordedToolIds = new Set<string>();
let lastChrisTalkEpoch = 0;
const recordedTextHashes = new Set<string>();
const thinkQueue: string[] = [];

// 멀티 세션: 다른 활성 Claude 세션의 transcript 추적
const otherTranscriptOffsets: Map<string, number> = new Map();

// 실행 중인 claude 프로세스의 cwd 목록 (ps + lsof 기반, 주기적 갱신)
const activeClaudeCwds = new Set<string>();
function refreshActiveClaudeSessions(): void {
  try {
    const result = Bun.spawnSync(['bash', '-c',
      `ps -eo pid,comm | grep '[c]laude$' | awk '{print $1}' | while read pid; do lsof -p "$pid" 2>/dev/null | awk '/cwd/{print $NF}'; done`
    ]);
    const output = result.stdout.toString().trim();
    activeClaudeCwds.clear();
    if (output) {
      for (const line of output.split('\n')) {
        const cwd = line.trim();
        if (cwd) activeClaudeCwds.add(cwd);
      }
    }
    if (activeClaudeCwds.size > 0) {
      console.log(`[multi-session] active claude sessions: ${[...activeClaudeCwds].map(c => c.split('/').pop()).join(', ')}`);
    }
  } catch {}
}
refreshActiveClaudeSessions(); // 서버 시작 시 즉시 1회 실행

// Thinking cache: msgId → thinking content (survives transcript redaction)
const thinkingCache = new Map<string, string>();
let transcriptWatcher: fs.FSWatcher | null = null;

function setupTranscriptWatcher(): void {
  if (transcriptWatcher) { try { transcriptWatcher.close(); } catch {} }
  if (!transcriptPath) return;
  try {
    transcriptWatcher = fs.watch(transcriptPath, { persistent: false }, (eventType) => {
      if (eventType === 'change') {
        try { scanTranscriptForAgentWork(); } catch {}
      }
    });
  } catch {}
}

// Track active agents for auto-completion detection
const activeAgents: Map<string, { lastActivity: number; startTime: number; agentName: string; agentType: string }> = new Map();
let lastAgentStatusEpoch = 0;
const AGENT_IDLE_TIMEOUT = 30_000; // 30 seconds without activity → auto "done"

// Server startup cleanup: remove stale agent data from previous sessions
try { fs.unlinkSync(path.join(PLUGIN_DIR, 'active-agent.json')); } catch {}

// Clean history.jsonl: remove volatile events (agent-status, work, idle-chat) but keep persistent ones
try {
  if (fs.existsSync(HISTORY_FILE)) {
    const lines = fs.readFileSync(HISTORY_FILE, 'utf-8').split('\n').filter(l => l.trim());
    const persistTypes = new Set(['done', 'request', 'assign']);
    const cleaned = lines.filter(line => {
      try { return persistTypes.has(JSON.parse(line).type); } catch { return false; }
    });
    fs.writeFileSync(HISTORY_FILE, cleaned.length > 0 ? cleaned.join('\n') + '\n' : '');
  }
} catch {}


// cwd 기반으로 해당 프로젝트의 최신 transcript 파일 경로 반환
// 인코딩된 프로젝트 디렉토리명에서 실제 프로젝트명 추출
// 예: -Users-aster-workspace-claude-backstage → claude-backstage
function resolveProjectName(encodedDir: string): string {
  const home = homedir();
  const homeEnc = home.replace(/\//g, '-');
  if (!encodedDir.startsWith(homeEnc + '-')) return encodedDir;

  const afterHome = encodedDir.slice(homeEnc.length + 1);
  const segments = afterHome.split('-');

  // 뒤에서부터 segment를 합쳐가며 실제 존재하는 디렉토리 찾기
  for (let nameLen = 1; nameLen < segments.length; nameLen++) {
    const dirPath = path.join(home, segments.slice(0, segments.length - nameLen).join('/'));
    const candidate = segments.slice(segments.length - nameLen).join('-');
    if (fs.existsSync(path.join(dirPath, candidate))) {
      return candidate;
    }
  }
  return afterHome;
}

// 다른 활성 세션의 transcript에서 Chris talk을 추출해 history에 기록
// ps/lsof 없이 ~/.claude/projects/ 파일시스템만으로 활성 세션 감지
function scanOtherSessionsTalk(): void {
  const projectsDir = path.join(homedir(), '.claude/projects');
  if (!fs.existsSync(projectsDir)) return;

  const activeTranscripts = new Set<string>();

  try {
    for (const dir of fs.readdirSync(projectsDir)) {
      if (dir.includes('claude-plugins-cache')) continue;

      const fullDir = path.join(projectsDir, dir);
      try { if (!fs.statSync(fullDir).isDirectory()) continue; } catch { continue; }

      // 최신 .jsonl 찾기
      let newest: { path: string; mtime: number } | null = null;
      try {
        for (const file of fs.readdirSync(fullDir)) {
          if (!file.endsWith('.jsonl')) continue;
          const fp = path.join(fullDir, file);
          try {
            const s = fs.statSync(fp);
            if (s.size < 10_000) continue;
            if (!newest || s.mtimeMs > newest.mtime) newest = { path: fp, mtime: s.mtimeMs };
          } catch { continue; }
        }
      } catch { continue; }

      if (!newest) continue;
      if (newest.path === transcriptPath) continue; // 메인 세션 제외
      // 모든 프로젝트의 transcript를 수집 (활성도 조건 없음)

      const tp = newest.path;
      activeTranscripts.add(tp);
      const projectName = resolveProjectName(dir);

      let stat: fs.Stats;
      try { stat = fs.statSync(tp); } catch { continue; }

      // 첫 등장: 실행 중인 세션이면 최근 128KB부터 수집, 아니면 과거 무시
      let isInitialRead = false;
      if (!otherTranscriptOffsets.has(tp)) {
        isInitialRead = true;
        const encodedCwd = dir;
        const isRunning = [...activeClaudeCwds].some(cwd =>
          cwd.replace(/\//g, '-') === encodedCwd
        );
        if (isRunning && stat.size > 128 * 1024) {
          otherTranscriptOffsets.set(tp, stat.size - 128 * 1024);
        } else {
          otherTranscriptOffsets.set(tp, stat.size);
          if (!isRunning) continue;
        }
      }

      const currentOffset = otherTranscriptOffsets.get(tp)!;
      if (stat.size <= currentOffset) continue;

      // delta 읽기 (최대 256KB)
      const readSize = Math.min(stat.size - currentOffset, 256 * 1024);
      let content: string;
      let fd: number | null = null;
      try {
        fd = fs.openSync(tp, 'r');
        const buf = Buffer.alloc(readSize);
        fs.readSync(fd, buf, 0, readSize, currentOffset);
        content = buf.toString('utf-8');
      } catch { continue; } finally {
        if (fd !== null) fs.closeSync(fd);
      }

      otherTranscriptOffsets.set(tp, stat.size);

      const tLines = content.trim().split('\n');
      const nowEpoch = Math.floor(Date.now() / 1000);

      // user 메시지 추적 (챕터 제목용)
      let currentUserMsg = '';

      for (const tLine of tLines) {
        try {
          const entry = JSON.parse(tLine);

          // user 메시지 추적 → 다음 assistant 응답의 챕터 제목으로 사용
          if (entry.type === 'user' && entry.message?.role === 'user' && entry.message?.content) {
            const extractUserMsg = (raw: string): string => {
              const cleaned = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
              if (cleaned.length > 0 && cleaned.length < 500 && !cleaned.startsWith('<') && !cleaned.startsWith('{')) {
                return cleaned.slice(0, 500);
              }
              return '';
            };
            if (typeof entry.message.content === 'string') {
              const msg = extractUserMsg(entry.message.content.trim());
              if (msg) currentUserMsg = msg;
            } else if (Array.isArray(entry.message.content)) {
              for (const block of entry.message.content) {
                if (block.type === 'text' && block.text) {
                  const msg = extractUserMsg(block.text.trim());
                  if (msg) { currentUserMsg = msg; break; }
                }
              }
            }
            continue;
          }

          if (entry.type !== 'assistant' || entry.message?.role !== 'assistant') continue;
          if (!entry.message?.content) continue;

          const msgId = entry.message.id || '';
          const chapterKey = `other-chapter:${projectName}:${msgId}`;
          if (msgId && recordedTextHashes.has(chapterKey)) continue;

          const steps: any[] = [];
          let talkMsg = '';
          let chapterTitle = '';

          // 사용자 메시지 기반 챕터 제목 (현재 세션과 동일한 방식)
          if (currentUserMsg) {
            let line = currentUserMsg.trim();
            line = line.replace(/^\d+[\.\)]\s*/, '');
            line = line.replace(/[.。!！?？…~]+$/g, '')
              .replace(/\s*(해\s*줘|해주세요|하세요|해봐|부탁|좀|할\s*것|하기)\s*$/g, '')
              .trim();
            chapterTitle = line.length > 40 ? line.slice(0, 40) + '…' : (line || '');
          }

          for (const block of entry.message.content) {
            // Thinking → 작업 노트 steps
            if (block.type === 'thinking' && block.thinking) {
              const thinking = block.thinking.trim();
              if (thinking.length < 30) continue;
              const meaningful = thinking.split('\n')
                .map((l: string) => l.trim())
                .filter((l: string) => l.length > 10)
                .filter((l: string) => !l.startsWith('<') && !l.startsWith('{') && !l.startsWith('```'))
                .filter((l: string) => !l.startsWith('//') && !l.startsWith('#') && !l.startsWith('|'))
                .filter((l: string) => !/^(import|const|let|var|function|class|if|for|return|export)\b/.test(l))
                .filter((l: string) => /[\uAC00-\uD7AF]/.test(l));
              if (meaningful.length > 0) {
                if (!chapterTitle) {
                  const t0 = meaningful[0].replace(/\*\*/g, '').replace(/`/g, '').trim();
                  chapterTitle = t0.length > 25 ? t0.slice(0, 25) + '…' : t0;
                }
                const thinkLines = meaningful.slice(0, 10).map((l: string) => {
                  let tl = l.replace(/\*\*/g, '').replace(/`/g, '').replace(/^[-*]\s+/, '');
                  return tl.length > 300 ? tl.slice(0, 297) + '...' : tl;
                });
                steps.push({ type: 'think', lines: thinkLines });
              }
            }

            // Tool use → 작업 노트 steps
            if (block.type === 'tool_use') {
              const toolName = block.name || '';
              const input = block.input as any;
              if (toolName === 'Agent' || toolName === 'Task') {
                if (input?.subagent_type) {
                  const agentType = String(input.subagent_type).replace(/^oh-my-claudecode:/, '');
                  steps.push({ type: 'agent', name: agentType, desc: (input.description || '').slice(0, 80) });
                }
              } else if (toolName) {
                const fp = input?.file_path || input?.path || '';
                const basename = typeof fp === 'string' && fp.length > 0 ? (fp.split('/').pop() || fp) : '';
                steps.push({ type: 'tool', name: toolName, detail: basename });
              }
            }

            // Text → talk + 작업 노트 response
            if (block.type === 'text' && block.text) {
              const text = block.text.trim();
              if (text.length < 10 || text.length > 2000) continue;
              if (text.startsWith('<') || text.startsWith('{') || text.startsWith('```')) continue;

              const meaningful = text.split('\n')
                .map((l: string) => l.trim())
                .filter((l: string) => l.length > 10 && l.length < 200)
                .filter((l: string) => !l.startsWith('|') && !l.startsWith('```') && !l.startsWith('#') && !l.startsWith('- '))
                .filter((l: string) => !/^(import|const|let|var|function|class|if|for|return|export)\b/.test(l));

              if (meaningful.length > 0) {
                let msg = meaningful[0];
                if (msg.length > 100) msg = msg.slice(0, 97) + '...';
                if (!talkMsg) talkMsg = msg;
                steps.push({ type: 'response', text: msg });
              }
            }
          }

          // Talk 기록 (초기 128KB 읽기 시에는 스킵 — chat 폭탄 방지)
          if (talkMsg && !isInitialRead) {
            const hash = `other:${projectName}:${talkMsg.slice(0, 80)}`;
            if (!recordedTextHashes.has(hash)) {
              recordedTextHashes.add(hash);
              const histEntry = JSON.stringify({
                ts: new Date().toTimeString().slice(0, 8),
                epoch: nowEpoch,
                type: 'talk',
                speaker: 'Chris',
                role: 'boss',
                msg: `[${projectName}] ${talkMsg}`,
                project: projectName,
              });
              ensureHistoryFile();
              try { fs.appendFileSync(HISTORY_FILE, histEntry + '\n'); } catch {}
            }
          }

          // Chapter 기록 (chris-log.jsonl — 작업 노트용)
          if (steps.length > 0 && msgId) {
            recordedTextHashes.add(chapterKey);
            if (!chapterTitle) {
              chapterTitle = talkMsg
                ? (talkMsg.length > 25 ? talkMsg.slice(0, 25) + '…' : talkMsg)
                : `[${projectName}]`;
            }
            const chapterEntry = JSON.stringify({
              ts: new Date().toTimeString().slice(0, 8),
              epoch: nowEpoch,
              title: `[${projectName}] ${chapterTitle}`,
              userMsg: currentUserMsg ? `[${projectName}] ${currentUserMsg}` : '',
              steps,
              project: projectName,
            });
            try { fs.appendFileSync(CHRIS_LOG_FILE, chapterEntry + '\n'); } catch {}
          }
        } catch {}
      }
    }
  } catch {}

  // 비활성 세션의 offset 정리
  for (const [tp] of otherTranscriptOffsets) {
    if (!activeTranscripts.has(tp)) otherTranscriptOffsets.delete(tp);
  }
}

function findCurrentTranscript(): string | null {
  const projectsDir = path.join(homedir(), ".claude/projects");
  if (!fs.existsSync(projectsDir)) return null;

  // hook이 기록한 활성 세션의 cwd 읽기 → 해당 프로젝트의 transcript만 선택
  let activeCwdEncoded = '';
  try {
    const cwdFile = path.join(PLUGIN_DIR, 'active-session-cwd.txt');
    if (fs.existsSync(cwdFile)) {
      const cwd = fs.readFileSync(cwdFile, 'utf-8').trim();
      // Claude Code는 cwd의 /를 -로 인코딩: /Users/aster/workspace/foo → -Users-aster-workspace-foo
      activeCwdEncoded = cwd.replace(/\//g, '-');
    }
  } catch {}

  let newest: { path: string; mtime: number } | null = null;

  try {
    const projectDirs = fs.readdirSync(projectsDir);
    for (const dir of projectDirs) {
      // 플러그인 캐시 경로 제외 (dialogue-generator 등의 transcript가 선택되는 문제 방지)
      if (dir.includes('claude-plugins-cache')) continue;

      // 활성 세션 cwd가 있으면 해당 프로젝트만 선택 (세션 혼합 방지)
      // 정확한 매칭만 허용 (prefix 매칭 시 claude-backstage-viewer 등 하위 경로도 매칭되는 문제 방지)
      if (activeCwdEncoded && dir !== activeCwdEncoded) continue;

      const fullDir = path.join(projectsDir, dir);
      try {
        const stat = fs.statSync(fullDir);
        if (!stat.isDirectory()) continue;
      } catch { continue; }

      try {
        const files = fs.readdirSync(fullDir);
        for (const file of files) {
          if (!file.endsWith(".jsonl")) continue;
          const fullPath = path.join(fullDir, file);
          try {
            const stat = fs.statSync(fullPath);
            // claude --print 세션의 짧은 transcript 무시 (10KB 미만)
            if (stat.size < 10_000) continue;
            if (!newest || stat.mtimeMs > newest.mtime) {
              newest = { path: fullPath, mtime: stat.mtimeMs };
            }
          } catch { continue; }
        }
      } catch { continue; }
    }
  } catch { return null; }

  if (newest) {
    console.log(`[transcript] selected: ${path.basename(path.dirname(newest.path))}/${path.basename(newest.path)} (${(fs.statSync(newest.path).size / 1024).toFixed(0)}KB)`);
  }

  return newest?.path || null;
}

function scanTranscriptForAgentWork(): void {
  const now = Date.now();

  if (!transcriptPath || (now - transcriptLastCheck) > 10_000) {
    transcriptLastCheck = now;
    const found = findCurrentTranscript();
    // Switch to new transcript if:
    // 1. No current transcript, OR
    // 2. Found a different file AND either:
    //    a. Current transcript hasn't been modified in 30s (session likely ended), OR
    //    b. New file is >50% size of current (for mid-session restarts)
    const shouldSwitch = found && found !== transcriptPath && (() => {
      if (!transcriptPath) return true;
      try {
        const currentMtime = fs.statSync(transcriptPath).mtimeMs;
        const stale = (Date.now() - currentMtime) > 30_000; // current transcript idle 30s+
        if (stale) return true;
        return fs.statSync(found).size > (fs.statSync(transcriptPath).size * 0.5);
      } catch { return true; }
    })();
    if (shouldSwitch) {
      const isSessionSwitch = !!transcriptPath; // 기존 세션 → 새 세션 전환인지 (서버 최초 시작이 아닌)
      transcriptPath = found;
      recordedToolIds.clear();
      thinkingCache.clear();
      subagentOffsets.clear(); // 새 세션 전환 시 subagent offset도 리셋
      setupTranscriptWatcher();

      // 진짜 세션 전환(다른 transcript)일 때만 task 리셋 (서버 재시작은 제외)
      if (isSessionSwitch) {
        ensureHistoryFile();
        const resetEntry = JSON.stringify({
          ts: new Date().toTimeString().slice(0, 8),
          epoch: Math.floor(Date.now() / 1000),
          type: 'tasks-reset',
          speaker: 'Board', role: 'system', msg: '',
        });
        try { fs.appendFileSync(HISTORY_FILE, resetEntry + '\n'); } catch {}
      }

      // One-time scan: populate agentTypeMap from entire transcript
      // (needed so new agent_progress events can resolve agent names)
      try {
        const fullContent = fs.readFileSync(found, 'utf-8');
        for (const line of fullContent.trim().split('\n')) {
          try {
            const e = JSON.parse(line);
            if (e.message?.content) {
              for (const c of e.message.content) {
                if (c.type === 'tool_use' && (c.name === 'Task' || c.name === 'Agent') && c.input?.subagent_type) {
                  agentTypeMap[c.id] = c.input.subagent_type;
                }
              }
            }
            if (e.type === 'progress' && e.data?.type === 'agent_progress') {
              const aid = e.data?.agentId;
              if (aid && e.parentToolUseID && agentTypeMap[e.parentToolUseID]) {
                agentIdToType[aid] = agentTypeMap[e.parentToolUseID];
              }
            }
            // Detect current session's plan file from system-reminder
            if (!currentPlanFile && e.type === 'system' && typeof e.message?.content === 'string') {
              const planMatch = e.message.content.match(/plan file exists.*?at:\s*([^\n]+\.md)/);
              if (planMatch) currentPlanFile = planMatch[1].trim();
            }
            // Track last user message from initial scan (세션 전환 시 이전 user 메시지 복원)
            if (e.type === 'user' && e.message?.role === 'user' && e.message?.content) {
              if (typeof e.message.content === 'string') {
                const umsg = e.message.content.trim().split('\n')[0].slice(0, 100);
                if (umsg.length >= 3 && !umsg.startsWith('<')) lastUserMessage = umsg;
              } else if (Array.isArray(e.message.content)) {
                for (const b of e.message.content) {
                  if (b.type === 'text' && b.text) {
                    const umsg = b.text.trim().split('\n')[0].slice(0, 100);
                    if (umsg.length >= 3 && !umsg.startsWith('<')) lastUserMessage = umsg;
                    break;
                  }
                }
              }
            }
            // Also track usage from full initial scan
            if (e.type === 'assistant' && e.message?.usage) {
              const u = e.message.usage;
              if (u.input_tokens) usageData.inputTokens += u.input_tokens;
              if (u.output_tokens) usageData.outputTokens += u.output_tokens;
              if (u.cache_read_input_tokens) usageData.cacheReadTokens += u.cache_read_input_tokens;
              // Track last turn's context size (overwrite, not accumulate)
              usageData.lastTurnContext = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0);
            }
          } catch {}
        }
      } catch {}

      // Restore lastChapterUserMsg from chris-log (서버 재시작 후 같은 userMsg 항목 merge 유지)
      try {
        const logContent = fs.existsSync(CHRIS_LOG_FILE) ? fs.readFileSync(CHRIS_LOG_FILE, 'utf-8') : '';
        const logLines = logContent.trim().split('\n').filter(Boolean);
        if (logLines.length > 0) {
          const lastLog = JSON.parse(logLines[logLines.length - 1]);
          if (lastLog.userMsg) lastChapterUserMsg = lastLog.userMsg;
        }
      } catch {}

      // Skip historical work events (only process new ones)
      try {
        transcriptOffset = fs.statSync(found).size;
      } catch {
        transcriptOffset = 0;
      }
    }
    if (!transcriptPath) return;
  }

  if (!fs.existsSync(transcriptPath)) return;

  let stat: fs.Stats;
  try { stat = fs.statSync(transcriptPath); } catch { return; }

  if (stat.size < transcriptOffset) transcriptOffset = 0;
  if (stat.size <= transcriptOffset) {
    // Transcript unchanged, but still scan subagent files (they update independently)
    scanSubagentFiles();
    return;
  }

  let readFrom = transcriptOffset;
  const maxRead = 512 * 1024;
  if (stat.size - readFrom > maxRead) {
    // Don't go before transcriptOffset — that would re-read already-hashed content
    // and cause thinking/talk dedup to block new events
    readFrom = Math.max(transcriptOffset, stat.size - maxRead);
  }

  let content: string;
  let fd: number | null = null;
  try {
    fd = fs.openSync(transcriptPath, "r");
    const buf = Buffer.alloc(stat.size - readFrom);
    fs.readSync(fd, buf, 0, buf.length, readFrom);
    content = buf.toString("utf-8");
  } catch { return; } finally {
    if (fd !== null) fs.closeSync(fd);
  }

  transcriptOffset = stat.size;

  const lines = content.trim().split("\n");
  if (lines.length === 0) return;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.message?.content) {
        for (const c of entry.message.content) {
          if (c.type === "tool_use" && (c.name === "Task" || c.name === "Agent") && c.input?.subagent_type) {
            agentTypeMap[c.id] = c.input.subagent_type;
          }
        }
      }
      // Usage tracking from assistant messages
      if (entry.type === 'assistant' && entry.message?.usage) {
        const u = entry.message.usage;
        if (u.input_tokens) usageData.inputTokens += u.input_tokens;
        if (u.output_tokens) usageData.outputTokens += u.output_tokens;
        if (u.cache_read_input_tokens) usageData.cacheReadTokens += u.cache_read_input_tokens;
        // Track last turn's context size (overwrite, not accumulate)
        usageData.lastTurnContext = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0);
      }

      // Context window estimation from compact events
      if (entry.type === 'summary' || (entry.message?.content && Array.isArray(entry.message.content) && entry.message.content.some((c: any) => c.type === 'text' && typeof c.text === 'string' && c.text.includes('compact_boundary')))) {
        try {
          const textBlock = entry.message?.content?.find((c: any) => c.type === 'text');
          if (textBlock?.text) {
            const match = textBlock.text.match(/preTokens["\s:]+(\d+)/);
            if (match) usageData.contextWindow = parseInt(match[1]);
          }
        } catch {}

        // Chris-log에 compacting 이벤트 기록
        const compactKey = `compact:${entry.message?.id || nowEpoch}`;
        if (!recordedTextHashes.has(compactKey)) {
          recordedTextHashes.add(compactKey);
          const compactEntry = JSON.stringify({
            ts: new Date().toTimeString().slice(0, 8),
            epoch: nowEpoch,
            type: 'compact',
            title: '🔄 Compacting conversation...',
            userMsg: '',
            thinks: [], response: '', files: [], tools: [], agents: [],
          });
          try { fs.appendFileSync(CHRIS_LOG_FILE, compactEntry + '\n'); } catch {}
        }
      }
    } catch {}
  }

  const latestPerAgent: Map<string, { agentName: string; agentType: string; tool: string; target: string; detail: string }> = new Map();

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);

      if (entry.type === "progress" && entry.data?.type === "agent_progress") {
        const aid = entry.data?.agentId;
        if (aid && entry.parentToolUseID && agentTypeMap[entry.parentToolUseID]) {
          agentIdToType[aid] = agentTypeMap[entry.parentToolUseID];
        }

        const msg = entry.data?.message?.message;
        if (!msg?.content) continue;

        for (const block of msg.content) {
          if (block.type !== "tool_use" || !block.name) continue;

          const toolName = block.name;
          if (!["Read", "Glob", "Grep", "Edit", "Write", "Bash"].includes(toolName)) continue;

          const input = block.input || {};
          const target: string = input.file_path || input.pattern || input.command || "";
          const shortTarget = target.split("/").pop()?.slice(0, 30) || target.slice(0, 30);
          const agentId: string = entry.data?.agentId || "unknown";

          let agentType = "agent";
          if (entry.parentToolUseID && agentTypeMap[entry.parentToolUseID]) {
            agentType = agentTypeMap[entry.parentToolUseID];
          }

          const toolId = `${agentId}:${toolName}:${shortTarget}`;
          if (recordedToolIds.has(toolId)) continue;
          recordedToolIds.add(toolId);

          // Build detail: full context depending on tool type
          let detail = "";
          if (toolName === "Bash") {
            detail = (input.command || "").slice(0, 200);
          } else if (toolName === "Read") {
            detail = input.file_path || "";
            if (input.offset || input.limit) {
              detail += ` (lines ${input.offset ?? 1}–${input.limit ? (input.offset ?? 1) + input.limit - 1 : "end"})`;
            }
          } else if (toolName === "Edit" || toolName === "Write") {
            detail = input.file_path || "";
          } else if (toolName === "Grep") {
            detail = `pattern: ${(input.pattern || "").slice(0, 80)}`;
            if (input.path) detail += ` in ${input.path}`;
          } else if (toolName === "Glob") {
            detail = input.pattern || "";
            if (input.path) detail += ` in ${input.path}`;
          }

          const agentName = assignCharacter(agentId, agentType);
          latestPerAgent.set(agentName, { agentName, agentType, tool: toolName, target: shortTarget, detail });
        }
      }
    } catch {}
  }

  if (latestPerAgent.size > 0) {
    ensureHistoryFile();
    for (const tool of latestPerAgent.values()) {
      const info = TOOL_INFO[tool.tool] || { emoji: "🔧", verb: toolVerbDefault };
      const ts = new Date().toTimeString().slice(0, 8);
      const epoch = Math.floor(Date.now() / 1000);
      const msg = `${info.emoji} ${tool.target || tool.tool} ${info.verb}`;

      const entry = JSON.stringify({
        ts, epoch, type: "work",
        speaker: tool.agentName,
        role: tool.agentType,
        msg,
        ...(tool.detail ? { detail: tool.detail } : {}),
      });

      // Skip history writes during initial scan to avoid stale agent data on restart
      if (Date.now() - SERVER_START_TIME > 5000) {
        try { fs.appendFileSync(HISTORY_FILE, entry + "\n"); } catch {}
      }
    }

    // Update active agent tracking (exclude Chris — boss never "completes")
    // Skip during initial scan (first 5s) to avoid re-registering stale agents from previous sessions
    if (Date.now() - SERVER_START_TIME > 5000) {
      for (const tool of latestPerAgent.values()) {
        if (tool.agentName === 'Chris') continue;
        const existing = activeAgents.get(tool.agentName);
        activeAgents.set(tool.agentName, {
          lastActivity: Date.now(),
          startTime: existing?.startTime || Date.now(),
          agentName: tool.agentName,
          agentType: tool.agentType,
        });
      }
    }
  }

  // Auto-complete agents with no recent activity
  const now2 = Date.now();
  for (const [name, info] of activeAgents) {
    if (now2 - info.lastActivity > AGENT_IDLE_TIMEOUT) {
      const ts = new Date().toTimeString().slice(0, 8);
      const epoch = Math.floor(now2 / 1000);
      activeAgents.delete(name);
      for (const [aid, charName] of agentAssignments) {
        if (charName === name) { releaseCharacter(aid); break; }
      }
      // dialogue-generator는 건너뛰기 (대사 생성 에이전트이므로 완료 보고 불필요)
      if (info.agentType.includes('dialogue-generator')) continue;

      // AI 대화 ON이면 완료 대사를 AI로 생성
      if (config.ai_dialogue) {
        // 최근 작업 내용 찾기
        let taskDesc = info.agentType || 'task';
        try {
          if (fs.existsSync(HISTORY_FILE)) {
            const hLines = fs.readFileSync(HISTORY_FILE, 'utf-8').trim().split('\n').reverse();
            for (const hl of hLines) {
              try {
                const ev = JSON.parse(hl);
                if (ev.speaker === name && (ev.type === 'assign' || ev.type === 'c-bubble') && ev.msg) {
                  taskDesc = ev.msg.slice(0, 80);
                  break;
                }
              } catch {}
            }
          }
        } catch {}

        const i18nPath = path.join(PLUGIN_DIR, `hooks-i18n/${config.language || 'en'}.json`);
        let i18nData: any = {};
        try { i18nData = JSON.parse(fs.readFileSync(i18nPath, 'utf-8')); } catch {}
        const completeTemplate = i18nData?.dialogue_prompt?.complete_template || '';

        if (completeTemplate) {
          const desc = i18nData?.c_team?.[name] || i18nData?.c_team?._default || 'team member';
          const prompt = completeTemplate
            .replace(/\$\{speaker\}/g, name)
            .replace(/\$\{role\}/g, desc)
            .replace(/\$\{task\}/g, taskDesc);
          const queueEntry = JSON.stringify({ epoch, speaker: name, role: info.agentType, type: 'complete', prompt });
          try { fs.appendFileSync(DIALOGUE_QUEUE_FILE, queueEntry + '\n'); } catch {}
        }

        // dialogue-queue에 complete 요청이 있으면 빈 done을 쓰지 않음
        // → AI 대사가 생성되면 그때 done으로 기록됨 (이중 기록 방지)
        if (!completeTemplate) {
          const entry = JSON.stringify({ ts, epoch, type: "done", speaker: name, role: info.agentType, msg: "" });
          try { fs.appendFileSync(HISTORY_FILE, entry + "\n"); } catch {}
        }
      } else {
        // AI 대화 OFF: 기존 fallback 완료 대사 유지
        let doneMsg = "작업 완료";
        try {
          if (fs.existsSync(HISTORY_FILE)) {
            const lines = fs.readFileSync(HISTORY_FILE, 'utf-8').trim().split('\n').reverse();
            const recentWork: string[] = [];
            for (const line of lines) {
              if (recentWork.length >= 3) break;
              try {
                const ev = JSON.parse(line);
                if (ev.speaker === name && ev.type === 'c-bubble' && ev.msg) {
                  recentWork.push(ev.msg);
                }
              } catch {}
            }
            if (recentWork.length > 0) {
              doneMsg = recentWork[0].replace(/[.!？！~]+$/, '') + ' — 완료!';
            }
          }
        } catch {}
        const entry = JSON.stringify({ ts, epoch, type: "done", speaker: name, role: info.agentType, msg: doneMsg });
        try { fs.appendFileSync(HISTORY_FILE, entry + "\n"); } catch {}
      }
    }
  }

  // Emit usage update every 10 seconds
  const nowMs3 = Date.now();
  if (nowMs3 - usageData.lastEmitTime >= 10_000 && (usageData.inputTokens > 0 || usageData.outputTokens > 0)) {
    usageData.lastEmitTime = nowMs3;
    const ts = new Date().toTimeString().slice(0, 8);
    const epoch = Math.floor(nowMs3 / 1000);
    const usageEntry = JSON.stringify({
      ts, epoch, type: 'usage-update',
      speaker: 'Board', role: 'system', msg: '',
      data: {
        inputTokens: usageData.inputTokens,
        outputTokens: usageData.outputTokens,
        cacheReadTokens: usageData.cacheReadTokens,
        contextWindow: usageData.contextWindow,
        lastTurnContext: usageData.lastTurnContext,
        fiveHourPercent: usageData.fiveHourPercent,
        sevenDayPercent: usageData.sevenDayPercent,
      }
    });
    try { fs.appendFileSync(HISTORY_FILE, usageEntry + '\n'); } catch {}
  }

  // User input detection — only track lastUserMessage for internal use
  // (history.jsonl recording is handled by user-prompt-hook.sh as "request" type)
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== "user" || entry.message?.role !== "user") continue;
      if (!entry.message?.content) continue;

      if (typeof entry.message.content === 'string') {
        const text = entry.message.content.trim();
        if (text.length < 3 || text.length > 200) continue;
        if (text.startsWith("<") || text.startsWith("{")) continue;
        let msg = text.replace(/\n/g, " ");
        if (msg.length > 100) msg = msg.slice(0, 100) + "...";
        lastUserMessage = msg;
        continue;
      }

      for (const block of entry.message.content) {
        if (block.type !== "text" || !block.text) continue;
        const text = block.text.trim();
        if (text.length < 3 || text.length > 200) continue;
        if (text.startsWith("<") || text.startsWith("{")) continue;
        let msg = text.replace(/\n/g, " ");
        if (msg.length > 100) msg = msg.slice(0, 100) + "...";
        lastUserMessage = msg;
        break;
      }
    } catch {}
  }

  // Chris talk
  const nowEpoch = Math.floor(Date.now() / 1000);

  if (nowEpoch - lastChrisTalkEpoch >= 15) {
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== "assistant" || entry.message?.role !== "assistant") continue;
        if (!entry.message?.content) continue;

        for (const block of entry.message.content) {
          if (block.type !== "text" || !block.text) continue;

          const text = block.text.trim();
          if (text.length < 15) continue;

          if (text.startsWith("<") || text.startsWith("{") || text.startsWith("```")) continue;
          if (!/[\uAC00-\uD7AF\u3130-\u318F]/.test(text.slice(0, 200))) continue;

          const hash = text.slice(0, 80);
          if (recordedTextHashes.has(hash)) continue;
          recordedTextHashes.add(hash);

          const meaningful = text.split("\n")
            .map(l => l.trim())
            .filter(l => l.length > 8)
            .filter(l => !l.startsWith("|") && !l.startsWith("```") && !l.startsWith("#") && !l.startsWith("- "))
            .filter(l => /[\uAC00-\uD7AF]/.test(l));

          if (meaningful.length === 0) continue;

          let msg = meaningful.slice(0, 2)
            .map(l => l.replace(/\*\*/g, "").replace(/`/g, "").replace(/^\s*>\s*/, ""))
            .join(" ");
          if (msg.length > 500) msg = msg.slice(0, 500) + "...";
          if (msg.length < 8) continue;

          lastChrisTalkEpoch = nowEpoch;

          const ts = new Date().toTimeString().slice(0, 8);
          const chatEntry = JSON.stringify({
            ts, epoch: nowEpoch, type: "talk",
            speaker: "Chris", role: "boss", msg,
          });

          try { fs.appendFileSync(HISTORY_FILE, chatEntry + "\n"); } catch {}
          break;
        }
        if (lastChrisTalkEpoch === nowEpoch) break;
      } catch {}
    }
  }

  // Chris thinking (from model's thinking blocks → 💭 thought bubbles, chunked)
  // Queue: extract all chunks from new thinking blocks, emit one per scan cycle
  const thinkCondition = thinkQueue.length === 0 && nowEpoch - lastChrisTalkEpoch >= 1;
  console.log(`[think-debug] queue=${thinkQueue.length} gap=${nowEpoch - lastChrisTalkEpoch} lines=${lines.length} condition=${thinkCondition}`);
  if (thinkCondition) {
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== "assistant" || entry.message?.role !== "assistant") continue;
        if (!entry.message?.content) continue;

        const msgId = entry.message.id || '';
        for (const block of entry.message.content) {
          if (block.type !== "thinking") continue;

          // Thinking cache: transcript에서 redact되기 전에 캡처
          if (block.thinking && block.thinking.length > 30) {
            if (msgId && !thinkingCache.has(msgId)) {
              thinkingCache.set(msgId, block.thinking);
              console.log(`[think-cache] cached msgId=${msgId.slice(0,12)} len=${block.thinking.length}`);
            }
          } else if (!block.thinking && msgId && thinkingCache.has(msgId)) {
            // Redacted → restore from cache
            block.thinking = thinkingCache.get(msgId)!;
            console.log(`[think-cache] RESTORED msgId=${msgId.slice(0,12)} len=${block.thinking.length}`);
          }

          if (!block.thinking) continue;

          console.log(`[think-debug] found thinking block, len=${block.thinking.length}`);
          const thinking: string = block.thinking.trim();
          if (thinking.length < 30) continue;

          const thinkHash = `think:${thinking.slice(0, 80)}`;
          const isDup = recordedTextHashes.has(thinkHash);
          console.log(`[think-debug] hash="${thinkHash.slice(0, 50)}" dup=${isDup}`);
          if (isDup) continue;
          recordedTextHashes.add(thinkHash);

          // Split into paragraphs (double newline or logical breaks)
          const paragraphs = thinking.split(/\n{2,}/)
            .map((p: string) => p.trim())
            .filter((p: string) => p.length > 15);

          for (const para of paragraphs) {
            // Extract meaningful lines from each paragraph
            // Keep: natural language sentences (Korean or English prose)
            // Remove: code syntax, markup, table rows
            const paraLines = para.split('\n')
              .map((l: string) => l.trim())
              .filter((l: string) => l.length > 10 && l.length < 200)
              .filter((l: string) => !l.startsWith('<') && !l.startsWith('{') && !l.startsWith('```'))
              .filter((l: string) => !l.startsWith('//') && !l.startsWith('#'))
              .filter((l: string) => !l.startsWith('|'))
              .filter((l: string) => !/^(import|const|let|var|function|class|if|for|return|export)\b/.test(l));

            if (paraLines.length === 0) continue;

            // Prefer Korean lines, but fall back to any prose line
            const korean = paraLines.filter((l: string) => /[\uAC00-\uD7AF]/.test(l));
            const best = korean.length > 0 ? korean : paraLines;

            let msg = best.slice(0, 2).join(' ');
            msg = msg.replace(/\*\*/g, '').replace(/`/g, '').replace(/^\s*>\s*/g, '').replace(/^[-*]\s+/, '');
            if (msg.length > 120) msg = msg.slice(0, 117) + '...';
            if (msg.length < 10) continue;

            console.log(`[think-debug] queued chunk: "${msg.slice(0, 60)}"`);
            thinkQueue.push(msg);
          }

          // Cap at 8 chunks max per thinking block
          if (thinkQueue.length > 8) {
            thinkQueue.length = 8;
          }
        }
        if (thinkQueue.length > 0) break;
      } catch {}
    }
  }

  // Emit thinking chunks: up to 2 per scan cycle for faster display
  const thinkEmitCount = Math.min(thinkQueue.length, 2);
  for (let ti = 0; ti < thinkEmitCount; ti++) {
    const msg = thinkQueue.shift()!;
    lastChrisTalkEpoch = nowEpoch;

    const ts = new Date().toTimeString().slice(0, 8);
    const thinkEntry = JSON.stringify({
      ts, epoch: nowEpoch, type: 'think',
      speaker: 'Chris', role: 'boss',
      msg: '💭 ' + msg,
    });

    try { fs.appendFileSync(HISTORY_FILE, thinkEntry + '\n'); } catch {}
  }

  // Chris: 활성 에이전트 진행 상태 보고 (20초마다)
  if (activeAgents.size > 0 && nowEpoch - lastAgentStatusEpoch >= 20) {
    const statuses: string[] = [];
    for (const [name, info] of activeAgents) {
      if (name === 'Chris') continue;
      const elapsed = Math.floor((Date.now() - info.startTime) / 1000);
      if (elapsed < 5) continue;
      const timeStr = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`;
      statuses.push(`✻ ${name} 작업 중… (${timeStr})`);
    }
    if (statuses.length > 0) {
      lastAgentStatusEpoch = nowEpoch;
      const ts = new Date().toTimeString().slice(0, 8);
      const statusEntry = JSON.stringify({
        ts, epoch: nowEpoch, type: 'agent-status',
        speaker: 'Chris', role: 'boss',
        msg: statuses.join('\n'),
      });
      try { fs.appendFileSync(HISTORY_FILE, statusEntry + '\n'); } catch {}
    }
  }

  // ═══ Chris 대화록 챕터 로깅 ═══
  // 새 assistant 응답에서 thinking + text + tools를 하나의 챕터로 구조화
  // transcript에서 직접 user 메시지 추적 (세션 분리 보장 — history.jsonl은 다른 세션 hook과 혼합 가능)
  let chapterUserMsg = lastUserMessage ? lastUserMessage.split('\n')[0].slice(0, 100) : '';
  let chapterAssistantCount = 0;
  let chapterNewCount = 0;

  // Hook 대사 필터 (IT스타트업 대사가 userMsg로 오염되는 문제 방지)
  // + 시스템 자동 메시지 필터 (Tool loaded 등 Claude Code 내부 메시지)
  const isHookDialogue = (t: string) =>
    t.includes('IT스타트업') || t.includes('한마디:') || t.startsWith('👤') ||
    t.includes('dialogue-generator') || t.includes('JSON만') ||
    /^Tool(s)? (loaded|not found|found)/.test(t) || t === 'No tools';

  // 전처리: 같은 msgId의 streaming 분할 entry를 하나로 합치기
  const mergedEntries: { userMsg?: string; msgId: string; content: any[] }[] = [];
  const msgIdToIdx: Record<string, number> = {};
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === "user" && entry.message?.role === "user" && entry.message?.content) {
        // content가 string인 경우 (Claude Code transcript 포맷)
        if (typeof entry.message.content === 'string') {
          const raw = entry.message.content.trim();
          // system-reminder 등 제거
          const cleaned = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
          if (cleaned.length > 0 && !cleaned.startsWith('<') && !cleaned.startsWith('{') && !isHookDialogue(cleaned)) {
            chapterUserMsg = cleaned.slice(0, 500);
          }
        } else {
          for (const block of entry.message.content) {
            if (block.type === "text" && block.text) {
              const raw = block.text.trim();
              const cleaned = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
              if (cleaned.length > 0 && !isHookDialogue(cleaned)) { chapterUserMsg = cleaned.slice(0, 500); break; }
            }
          }
        }
        continue;
      }
      if (entry.type !== "assistant" || entry.message?.role !== "assistant") continue;
      chapterAssistantCount++;
      if (!entry.message?.content) continue;
      const msgId = entry.message.id || '';
      if (!msgId) continue;
      const blocks = Array.isArray(entry.message.content) ? entry.message.content : [];
      if (msgId in msgIdToIdx) {
        // 같은 msgId → content 합치기
        mergedEntries[msgIdToIdx[msgId]].content.push(...blocks);
      } else {
        msgIdToIdx[msgId] = mergedEntries.length;
        mergedEntries.push({ userMsg: chapterUserMsg, msgId, content: blocks });
      }
    } catch {}
  }

  for (const merged of mergedEntries) {
    try {
      chapterUserMsg = merged.userMsg || chapterUserMsg;
      const msgId = merged.msgId;
      const chapterKey = `chapter:${msgId}`;
      if (recordedTextHashes.has(chapterKey)) continue;
      // Don't register chapterKey yet — wait until we confirm response text exists.
      // If only thinking arrived (streaming split), we skip and retry next scan.

      let thinkLines: string[] = [];
      let responseText = '';
      // 사용자 메시지에서 핵심 주제 추출 (강력 요약)
      let chapterTitle = '';
      if (chapterUserMsg) {
        let line = chapterUserMsg.trim();
        line = line.replace(/^\d+[\.\)]\s*/, '');  // 번호 리스트 접두어 제거
        line = line.replace(/[.。!！?？…~]+$/g, '')
          .replace(/\s*(해\s*줘|해주세요|하세요|해봐|부탁|좀|할\s*것|하기)\s*$/g, '')
          .trim();
        chapterTitle = line.length > 40 ? line.slice(0, 40) + '…' : (line || '');
      }
      // 시간순 steps 배열 구성
      const steps: any[] = [];
      let pendingThinkLines: string[] = [];

      const flushThink = () => {
        if (pendingThinkLines.length > 0) {
          steps.push({ type: 'think', lines: [...pendingThinkLines] });
          pendingThinkLines = [];
        }
      };

      for (const block of merged.content) {
        // Thinking cache restore
        if (block.type === 'thinking' && !block.thinking && msgId && thinkingCache.has(msgId)) {
          block.thinking = thinkingCache.get(msgId)!;
        }
        if (block.type === 'thinking' && block.thinking) {
          const t = block.thinking.trim();
          const meaningful = t.split('\n')
            .map((l: string) => l.trim())
            .filter((l: string) => l.length > 10)
            .filter((l: string) => !l.startsWith('<') && !l.startsWith('{') && !l.startsWith('```'))
            .filter((l: string) => !l.startsWith('//') && !l.startsWith('#') && !l.startsWith('|'))
            .filter((l: string) => !/^(import|const|let|var|function|class|if|for|return|export)\b/.test(l))
            .filter((l: string) => /[\uAC00-\uD7AF]/.test(l));

          if (meaningful.length > 0 && !chapterTitle) {
            const t0 = meaningful[0].replace(/\*\*/g, '').replace(/`/g, '').replace(/[.。!！?？…]+$/g, '').trim();
            chapterTitle = t0.length > 25 ? t0.slice(0, 25) + '…' : t0;
          }
          for (const m of meaningful) {
            let tl = m.replace(/\*\*/g, '').replace(/`/g, '').replace(/^[-*]\s+/, '');
            if (tl.length > 300) tl = tl.slice(0, 297) + '...';
            pendingThinkLines.push(tl);
          }
        }

        if (block.type === 'text' && block.text) {
          flushThink();
          const txt = block.text.trim();
          const allLines = txt.split('\n')
            .map((l: string) => l.trim())
            .filter((l: string) => l.length > 5)
            .filter((l: string) => !l.startsWith('```') && !l.startsWith('|') && !l.startsWith('#'));
          const koreanLines = allLines.filter((l: string) => /[\uAC00-\uD7AF]/.test(l));
          const picked = koreanLines.length > 0 ? koreanLines : allLines;
          if (picked.length > 0) {
            const chunk = picked.slice(0, 5).join(' ');
            responseText = responseText ? responseText + ' ' + chunk : chunk;
            if (responseText.length > 500) responseText = responseText.slice(0, 497) + '...';
            steps.push({ type: 'response', text: chunk.slice(0, 300) });
          }
        }

        if (block.type === 'tool_use') {
          flushThink();
          const toolName = block.name || '';
          const input = block.input as any;

          if ((toolName === 'Agent' || toolName === 'Task') && input?.subagent_type) {
            const agentType = String(input.subagent_type).replace(/^oh-my-claudecode:/, '');
            const desc = (input.description || input.prompt || '').slice(0, 80);
            steps.push({ type: 'agent', name: agentType, desc });
          } else if (toolName && toolName !== 'Agent' && toolName !== 'Task') {
            const fp = input?.file_path || input?.path || '';
            const basename = typeof fp === 'string' && fp.length > 0 ? (fp.split('/').pop() || fp) : '';
            const step: any = { type: 'tool', name: toolName, detail: basename };

            // Edit: 변경 내용 요약 (앞 3줄씩)
            if (toolName === 'Edit' && input?.old_string && input?.new_string) {
              const oldLines = input.old_string.trim().split('\n').slice(0, 3).map((l: string) => '- ' + l.slice(0, 120));
              const newLines = input.new_string.trim().split('\n').slice(0, 3).map((l: string) => '+ ' + l.slice(0, 120));
              const oldMore = input.old_string.trim().split('\n').length > 3 ? `\n  ... (${input.old_string.trim().split('\n').length}줄)` : '';
              const newMore = input.new_string.trim().split('\n').length > 3 ? `\n  ... (${input.new_string.trim().split('\n').length}줄)` : '';
              step.change = oldLines.join('\n') + oldMore + '\n' + newLines.join('\n') + newMore;
            }
            // Write: 새 파일 생성 (앞 3줄)
            if (toolName === 'Write' && input?.content) {
              const preview = input.content.trim().split('\n').slice(0, 3).join('\n').slice(0, 200);
              step.change = preview;
            }
            // Bash: 명령어
            if (toolName === 'Bash' && input?.command) {
              step.detail = input.command.slice(0, 100);
            }
            // Grep: 패턴
            if (toolName === 'Grep' && input?.pattern) {
              step.detail = `/${input.pattern}/` + (input.path ? ' in ' + (input.path.split('/').pop() || '') : '');
            }

            steps.push(step);
          }
        }
      }
      flushThink(); // 마지막 thinking flush

      if (steps.length === 0) continue;

      // 스트리밍 분할 방어: response text 없이 thinking만 도착한 경우
      // chapterKey를 등록하지 않고 스킵 → 다음 스캔에서 response text 포함해 재처리
      // 단, thinking steps를 pendingChapterSteps에 저장하여 /chris-log pending 챕터에서 실시간 표시
      const hasNonThink = steps.some((s: any) => s.type !== 'think');
      if (!hasNonThink) {
        pendingChapterSteps = [...steps];
        continue;
      }
      // 챕터 확정 → pending steps 초기화
      pendingChapterSteps = [];

      // response/tool 존재 확인됨 → chapterKey 등록 (중복 방지)
      recordedTextHashes.add(chapterKey);
      chapterNewCount++;

      if (!chapterTitle) {
        const fb = responseText.slice(0, 25);
        chapterTitle = responseText.length > 25 ? fb + '…' : (fb || '(무제)');
      }

      // 같은 사용자 메시지이면 기존 챕터에 steps 추가 (같은 질문에 대한 추가 응답)
      // 다른 사용자 메시지 = 무조건 새 챕터 (merge 하지 않음)
      const shouldMerge = !!chapterUserMsg && chapterUserMsg === lastChapterUserMsg;
      if (shouldMerge) {
        try {
          const logContent = fs.existsSync(CHRIS_LOG_FILE) ? fs.readFileSync(CHRIS_LOG_FILE, 'utf-8') : '';
          const logLines = logContent.trim().split('\n').filter(Boolean);
          if (logLines.length > 0) {
            const lastEntry = JSON.parse(logLines[logLines.length - 1]);
            if (!lastEntry.steps) lastEntry.steps = [];
            // 중복 방지: think lines 앞 40자 비교
            for (const s of steps) {
              if (s.type === 'think') {
                const newLines = s.lines.filter((l: string) => {
                  const prefix = l.slice(0, 40);
                  return !lastEntry.steps.some((es: any) =>
                    es.type === 'think' && es.lines?.some((x: string) => x.slice(0, 40) === prefix));
                });
                if (newLines.length > 0) lastEntry.steps.push({ type: 'think', lines: newLines });
              } else {
                lastEntry.steps.push(s);
              }
            }
            lastEntry.ts = new Date().toTimeString().slice(0, 8);
            lastEntry.epoch = nowEpoch;
            logLines[logLines.length - 1] = JSON.stringify(lastEntry);
            fs.writeFileSync(CHRIS_LOG_FILE, logLines.join('\n') + '\n');
            continue;
          }
        } catch {}
      }

      // 새 챕터 생성
      lastChapterUserMsg = chapterUserMsg;
      const chapterEntry = JSON.stringify({
        ts: new Date().toTimeString().slice(0, 8),
        epoch: nowEpoch,
        title: chapterTitle,
        userMsg: chapterUserMsg,
        steps,
      });

      try { fs.appendFileSync(CHRIS_LOG_FILE, chapterEntry + '\n'); } catch {}
    } catch {}
  }
  if (chapterAssistantCount > 0 || chapterNewCount > 0) {
    console.log(`[chris-log] assistant=${chapterAssistantCount} new=${chapterNewCount} lines=${lines.length}`);
  }

  // Prune
  if (recordedTextHashes.size > 300) {
    const arr = [...recordedTextHashes];
    recordedTextHashes.clear();
    for (const h of arr.slice(-150)) recordedTextHashes.add(h);
  }

  if (recordedToolIds.size > 1000) {
    const arr = [...recordedToolIds];
    recordedToolIds.clear();
    for (const id of arr.slice(-500)) recordedToolIds.add(id);
  }

  const mapKeys = Object.keys(agentTypeMap);
  if (mapKeys.length > 200) {
    for (const k of mapKeys.slice(0, mapKeys.length - 100)) {
      delete agentTypeMap[k];
    }
  }

  scanSubagentFiles();
  // 멀티 세션: 다른 Claude 세션의 transcript 스캔
  scanOtherSessionsTalk();
}

function scanSubagentFiles(): void {
  if (!transcriptPath) return;

  const mainName = path.basename(transcriptPath, ".jsonl");
  const subagentDir = path.join(path.dirname(transcriptPath), mainName, "subagents");

  if (!fs.existsSync(subagentDir)) return;

  let files: string[];
  try { files = fs.readdirSync(subagentDir); } catch { return; }

  const latestPerAgent = new Map<string, { agentName: string; agentType: string; tool: string; target: string }>();

  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;

    const filePath = path.join(subagentDir, file);
    const agentId = file.replace("agent-", "").replace(".jsonl", "");
    const agentType = agentIdToType[agentId] || "agent";

    let stat: fs.Stats;
    try { stat = fs.statSync(filePath); } catch { continue; }

    // First encounter: skip files from previous sessions to avoid stale agent data
    if (!subagentOffsets.has(filePath)) {
      if (stat.mtimeMs < SERVER_START_TIME) {
        subagentOffsets.set(filePath, stat.size); // skip entirely — old session data
        continue;
      }
      subagentOffsets.set(filePath, 0);
    }

    let offset = subagentOffsets.get(filePath)!;
    if (stat.size < offset) offset = 0;
    if (stat.size <= offset) { subagentOffsets.set(filePath, offset); continue; }

    let content: string;
    let fd: number | null = null;
    const readSize = Math.min(stat.size - offset, 256 * 1024);
    try {
      fd = fs.openSync(filePath, "r");
      const buf = Buffer.alloc(readSize);
      const bytesRead = fs.readSync(fd, buf, 0, buf.length, offset);
      content = buf.subarray(0, bytesRead).toString("utf-8");
      subagentOffsets.set(filePath, offset + bytesRead);
    } catch { continue; } finally {
      if (fd !== null) fs.closeSync(fd);
    }

    const lines = content.trim().split("\n");
    const agentName = assignCharacter(agentId, agentType);

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (!entry.message?.content) continue;
        for (const block of entry.message.content) {
          if (block.type !== "tool_use" || !block.name) continue;

          const toolName = block.name;
          if (!["Read", "Glob", "Grep", "Edit", "Write", "Bash"].includes(toolName)) continue;

          const input = block.input || {};
          const target: string = input.file_path || input.pattern || input.command || "";
          const shortTarget = target.split("/").pop()?.slice(0, 30) || target.slice(0, 30);

          const toolId = `sub:${agentId}:${toolName}:${shortTarget}`;
          if (recordedToolIds.has(toolId)) continue;
          recordedToolIds.add(toolId);

          latestPerAgent.set(agentName, { agentName, agentType, tool: toolName, target: shortTarget });
        }
      } catch {}
    }
  }

  if (latestPerAgent.size > 0) {
    ensureHistoryFile();
    for (const tool of latestPerAgent.values()) {
      const info = TOOL_INFO[tool.tool] || { emoji: "🔧", verb: toolVerbDefault };
      const ts = new Date().toTimeString().slice(0, 8);
      const epoch = Math.floor(Date.now() / 1000);
      const msg = `${info.emoji} ${tool.target || tool.tool} ${info.verb}`;

      const histEntry = JSON.stringify({
        ts, epoch, type: "work",
        speaker: tool.agentName,
        role: tool.agentType,
        msg,
      });

      // Skip history writes during initial scan to avoid re-recording stale agent work
      if (Date.now() - SERVER_START_TIME > 5000) {
        try { fs.appendFileSync(HISTORY_FILE, histEntry + "\n"); } catch {}
      }

      // Track for auto-completion (skip during initial scan to avoid stale agents)
      if (Date.now() - SERVER_START_TIME > 5000) {
        const existing = activeAgents.get(tool.agentName);
        activeAgents.set(tool.agentName, {
          lastActivity: Date.now(),
          startTime: existing?.startTime || Date.now(),
          agentName: tool.agentName,
          agentType: tool.agentType,
        });
      }
    }
  }

  if (subagentOffsets.size > 50) {
    for (const [p] of subagentOffsets) {
      if (!fs.existsSync(p)) subagentOffsets.delete(p);
    }
  }
}

// ─── SSE Handler ────────────────────────────────────────────────

const activeConnections = new Set<{ close: () => void }>();

function handleSSE(): Response {
  ensureHistoryFile();

  // SSE streams only new events; initial state is loaded via /history REST endpoint
  let offset = fs.existsSync(HISTORY_FILE) ? fs.statSync(HISTORY_FILE).size : 0;

  let watcher: fs.FSWatcher | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function send(event: string, data: string): void {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch { cleanup(); }
      }

      function checkForUpdates(): void {
        if (closed) return;
        const { lines, newOffset } = readNewLines(HISTORY_FILE, offset);
        if (lines.length > 0) {
          offset = newOffset;
          for (const line of lines) {
            send("message", JSON.stringify(line));
          }
        }
      }

      function cleanup(): void {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
        if (watcher) { watcher.close(); watcher = null; }
        activeConnections.delete(connection);
        try { controller.close(); } catch {}
      }

      const connection = { close: cleanup };
      activeConnections.add(connection);

      send("connected", JSON.stringify({ ts: new Date().toISOString() }));

      try {
        watcher = fs.watch(HISTORY_FILE, () => {
          if (closed) return;
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(checkForUpdates, 50);
        });
        watcher.on("error", () => cleanup());
      } catch {}

      pollTimer = setInterval(checkForUpdates, 1000);

      heartbeatTimer = setInterval(() => {
        send("ping", JSON.stringify({ ts: new Date().toISOString() }));
      }, 15_000);
    },

    cancel() {
      closed = true;
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
      if (watcher) { watcher.close(); watcher = null; }
    },
  });

  return new Response(stream, {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ─── HTTP Handlers ──────────────────────────────────────────────

function handleHistory(): Response {
  // State events (tasks, usage) from full history + recent 50 events for chat/bubbles
  if (!fs.existsSync(HISTORY_FILE)) {
    return new Response("[]", { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
  const content = fs.readFileSync(HISTORY_FILE, "utf-8");
  const allLines = content.split("\n").filter(l => l.trim().length > 0);
  const STATE_TYPES = new Set(['task-create', 'task-update', 'usage-update', 'assign', 'done']);
  // talk/think/c-bubble/idle-chat는 실시간 SSE로만 표시 (새로고침 시 chat 폭탄 방지)
  const REALTIME_ONLY = new Set(['talk', 'think', 'c-bubble', 'idle-chat']);
  const stateEntries: unknown[] = [];
  const recentEntries: unknown[] = [];
  for (const line of allLines) {
    try {
      const obj = JSON.parse(line) as any;
      if (STATE_TYPES.has(obj.type)) stateEntries.push(obj);
      else if (!REALTIME_ONLY.has(obj.type)) recentEntries.push(obj);
    } catch {}
  }
  const recent = recentEntries.slice(-20);
  const merged = [...stateEntries, ...recent];
  return new Response(JSON.stringify(merged), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function handleCharacters(): Promise<Response> {
  try {
    const file = Bun.file(CHARACTERS_FILE);
    const content = await file.text();
    return new Response(content, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
      },
    });
  } catch {
    return new Response(JSON.stringify({}), {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
      },
    });
  }
}

async function handleMessage(req: Request): Promise<Response> {
  try {
    const body = await req.json() as { text?: string };
    const text = body?.text;
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return new Response(JSON.stringify({ error: "empty message" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const ts = new Date().toTimeString().slice(0, 8);
    const epoch = Math.floor(Date.now() / 1000);
    const entry = {
      ts,
      epoch,
      type: "user-input",
      speaker: "You",
      role: "client",
      msg: text.trim().slice(0, 200),
    };

    ensureHistoryFile();
    fs.appendFileSync(HISTORY_FILE, JSON.stringify(entry) + "\n");

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "invalid request" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
}

async function handleRoot(): Promise<Response> {
  try {
    let html = fs.readFileSync(HTML_FILE, "utf-8");
    html = html.replace(/v\d+\.\d+(\.\d+)?/g, `v${PLUGIN_VERSION}`);
    // 정적 파일 캐시 버스트: ?v=xxx를 서버 시작 시 생성된 키로 치환 (재시작 = 캐시 무효화)
    html = html.replace(/\?v=[^"')]+/g, `?v=${CACHE_BUST}`);
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
      },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

// ─── Static File Handler ─────────────────────────────────────────

async function handleStaticFile(pathname: string): Promise<Response> {
  const normalized = path.normalize(pathname);
  if (normalized.includes("..")) {
    return new Response("Forbidden", { status: 403 });
  }

  const filePath = path.join(VIEWER_DIR, normalized);
  try {
    const file = Bun.file(filePath);
    const exists = await file.exists();
    if (!exists) {
      return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    return new Response(file, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": contentType,
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch {
    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  }
}

// ─── Server ─────────────────────────────────────────────────────

const server = Bun.serve({
  port: PORT,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    switch (url.pathname) {
      case "/":
        return await handleRoot();
      case "/events":
        return handleSSE();
      case "/history":
        return handleHistory();
      case "/message":
        if (req.method === "POST") {
          return await handleMessage(req);
        }
        return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
      case "/characters":
        return await handleCharacters();
      case "/plans": {
        try {
          const plansDir = path.join(process.env.HOME || '', '.claude', 'plans');
          const archiveDir = path.join(PLUGIN_DIR, 'plan-archive');
          const jsonHeaders = { 'Content-Type': 'application/json', ...CORS_HEADERS };

          // plan-archive 디렉토리 생성
          if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

          // 양쪽 디렉토리에서 .md 파일 수집
          const allFiles: { name: string; mtime: number; title: string; size: number; source: string }[] = [];
          const seen = new Set<string>();

          for (const [dir, source] of [[plansDir, 'plans'], [archiveDir, 'archive']] as const) {
            if (!fs.existsSync(dir)) continue;
            for (const f of fs.readdirSync(dir)) {
              if (!f.endsWith('.md') || seen.has(f)) continue;
              seen.add(f);
              const fpath = path.join(dir, f);
              const stat = fs.statSync(fpath);
              const firstLine = fs.readFileSync(fpath, 'utf-8').split('\n')[0] || '';
              const title = firstLine.replace(/^#+\s*/, '').trim() || f;
              allFiles.push({ name: f, mtime: stat.mtimeMs, title, size: stat.size, source });
              // 새 plan을 archive에 자동 복사
              if (source === 'plans') {
                const archivePath = path.join(archiveDir, f);
                if (!fs.existsSync(archivePath)) {
                  try { fs.copyFileSync(fpath, archivePath); } catch {}
                }
              }
            }
          }

          allFiles.sort((a, b) => b.mtime - a.mtime);

          // 현재 세션의 활성 plan 표시
          return new Response(JSON.stringify({
            files: allFiles,
            currentPlan: currentPlanFile ? path.basename(currentPlanFile) : null,
          }), { headers: jsonHeaders });
        } catch {
          return new Response(JSON.stringify({ files: [], currentPlan: null }), { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
        }
      }
      case "/chris-log": {
        try {
          const content = fs.existsSync(CHRIS_LOG_FILE) ? fs.readFileSync(CHRIS_LOG_FILE, 'utf-8') : '';
          const entries = content.trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

          // 사용자 메시지 실시간 구독: 아직 응답이 없으면 빈 pending 챕터 추가
          if (lastUserMessage) {
            const lastEntry = entries[entries.length - 1];
            const lastMsg = lastEntry?.userMsg || '';
            const pendingMsg = lastUserMessage.split('\n')[0].slice(0, 100);
            if (pendingMsg && pendingMsg !== lastMsg.slice(0, 100)) {
              entries.push({
                userMsg: lastUserMessage,
                title: '',
                ts: new Date().toTimeString().slice(0, 8),
                steps: pendingChapterSteps.length > 0 ? [...pendingChapterSteps] : [],
                pending: true,
              });
            }
          }

          return new Response(JSON.stringify(entries), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
        } catch {
          return new Response('[]', { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
        }
      }
      case "/agent-info": {
        const name = url.searchParams.get('name');
        if (!name) return new Response('{}', { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

        const info = activeAgents.get(name);
        if (!info) return new Response(JSON.stringify({ active: false }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

        // history.jsonl에서 이 에이전트의 최근 이벤트 추출
        const recentEvents: any[] = [];
        try {
          const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
          const lines = content.trim().split('\n');
          for (let i = lines.length - 1; i >= 0 && recentEvents.length < 10; i--) {
            try {
              const e = JSON.parse(lines[i]);
              if (e.speaker === name && e.type !== 'idle-chat') recentEvents.unshift(e);
            } catch {}
          }
        } catch {}

        return new Response(JSON.stringify({
          active: true,
          name,
          agentType: info.agentType,
          lastActivity: info.lastActivity,
          recentEvents,
        }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
      case "/c-team-info": {
        const cName = url.searchParams.get('name');
        if (!cName) return new Response('{}', { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

        // history.jsonl에서 이 C-Team 캐릭터의 최근 work-done 이벤트 추출
        const cEvents: any[] = [];
        try {
          const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
          const lines = content.trim().split('\n');
          for (let i = lines.length - 1; i >= 0 && cEvents.length < 20; i--) {
            try {
              const e = JSON.parse(lines[i]);
              if (e.speaker === cName && (e.type === 'work-done' || e.type === 'c-bubble')) cEvents.unshift(e);
            } catch {}
          }
        } catch {}

        return new Response(JSON.stringify({
          name: cName,
          events: cEvents,
        }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
      case "/refresh": {
        try {
          // refresh: TODO/DOING 태스크만 transcript 기준으로 갱신, 나머지 일체 건드리지 않음
          if (fs.existsSync(HISTORY_FILE)) {
            const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
            const lines = raw.trim().split('\n');

            // 1) history에서 기존 pending/in_progress 태스크 이벤트만 제거
            const completedTaskIds = new Set<string>();
            const pendingTaskIds = new Set<string>();
            for (const line of lines) {
              try {
                const e = JSON.parse(line);
                if (e.type === 'task-update' && e.data?.id) {
                  if (e.data.status === 'completed') {
                    completedTaskIds.add(e.data.id);
                    pendingTaskIds.delete(e.data.id);
                  } else if (e.data.status === 'pending' || e.data.status === 'in_progress') {
                    if (!completedTaskIds.has(e.data.id)) pendingTaskIds.add(e.data.id);
                  }
                }
                if (e.type === 'task-create' && e.data?.id && !completedTaskIds.has(e.data.id)) {
                  pendingTaskIds.add(e.data.id);
                }
              } catch {}
            }

            const preserved = lines.filter(line => {
              try {
                const e = JSON.parse(line);
                if (e.type === 'task-create' && pendingTaskIds.has(e.data?.id)) return false;
                if (e.type === 'task-update' && pendingTaskIds.has(e.data?.id)) return false;
                return true;
              } catch { return true; } // 파싱 실패한 라인은 보존
            });

            // 2) transcript에서 현재 실제 태스크 상태를 파싱하여 복원
            const newTaskEvents: string[] = [];
            if (transcriptPath && fs.existsSync(transcriptPath)) {
              const txContent = fs.readFileSync(transcriptPath, 'utf-8');
              const txLines = txContent.trim().split('\n');

              // TaskCreate tool_use → tool_result 매칭으로 태스크 복원
              const taskCreateInputs: Map<string, { subject: string; description: string }> = new Map();
              const tasks: Map<string, { id: string; subject: string; description: string; status: string }> = new Map();

              for (const tl of txLines) {
                try {
                  const entry = JSON.parse(tl);
                  if (!entry.message?.content) continue;
                  for (const c of entry.message.content) {
                    // TaskCreate tool_use
                    if (c.type === 'tool_use' && c.name === 'TaskCreate' && c.input) {
                      taskCreateInputs.set(c.id, {
                        subject: c.input.subject || '',
                        description: c.input.description || '',
                      });
                    }
                    // TaskCreate tool_result → ID 추출
                    if (c.type === 'tool_result' && taskCreateInputs.has(c.tool_use_id)) {
                      const text = typeof c.content === 'string' ? c.content : c.content?.[0]?.text || '';
                      const idMatch = text.match(/#(\d+)/);
                      if (idMatch) {
                        const info = taskCreateInputs.get(c.tool_use_id)!;
                        tasks.set(idMatch[1], { id: idMatch[1], ...info, status: 'pending' });
                      }
                      taskCreateInputs.delete(c.tool_use_id);
                    }
                    // TaskUpdate tool_use → 상태 업데이트
                    if (c.type === 'tool_use' && c.name === 'TaskUpdate' && c.input?.taskId) {
                      const t = tasks.get(c.input.taskId);
                      if (t && c.input.status) {
                        t.status = c.input.status;
                      }
                    }
                  }
                } catch {}
              }

              // completed가 아닌(pending/in_progress) 태스크만 history에 새로 기록
              const ts = new Date().toTimeString().slice(0, 8);
              const epoch = Math.floor(Date.now() / 1000);
              for (const [, t] of tasks) {
                if (t.status === 'completed' || t.status === 'deleted') continue;
                // 이미 completed로 history에 있는 태스크는 스킵
                if (completedTaskIds.has(t.id)) continue;
                newTaskEvents.push(JSON.stringify({
                  ts, epoch, type: 'task-create', speaker: 'Board', role: 'system', msg: '',
                  data: { id: t.id, subject: t.subject, description: t.description, status: 'pending' },
                }));
                if (t.status !== 'pending') {
                  newTaskEvents.push(JSON.stringify({
                    ts, epoch, type: 'task-update', speaker: 'Board', role: 'system', msg: '',
                    data: { id: t.id, status: t.status, subject: t.subject },
                  }));
                }
              }
            }

            // 3) 보존된 이벤트 + 복원된 태스크 이벤트로 history 갱신
            const allLines = [...preserved, ...newTaskEvents];
            fs.writeFileSync(HISTORY_FILE, allLines.length > 0 ? allLines.join('\n') + '\n' : '');
          }
          return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
        } catch {
          return new Response(JSON.stringify({ ok: false }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
        }
      }
      case "/i18n":
        return new Response(JSON.stringify(i18n), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      case "/config":
        return new Response(JSON.stringify(config), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      case "/status":
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      case "/trigger-scan":
        // Hook에서 호출: 즉시 transcript 스캔 트리거 (thinking 실시간 반영)
        try { scanTranscriptForAgentWork(); } catch {}
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      // /generate-dialogue 제거됨 — Hook → dialogue-generator Task 파이프라인으로 대체
      default: {
        // /plan/:filename — 특정 plan 파일 상세 반환
        if (url.pathname.startsWith("/plan/")) {
          try {
            const fileName = decodeURIComponent(url.pathname.slice(6));
            const plansDir = path.join(process.env.HOME || '', '.claude', 'plans');
            const archiveDir = path.join(PLUGIN_DIR, 'plan-archive');
            const jsonHeaders = { 'Content-Type': 'application/json', ...CORS_HEADERS };

            let filePath = path.join(plansDir, fileName);
            if (!fs.existsSync(filePath)) filePath = path.join(archiveDir, fileName);
            if (!fs.existsSync(filePath)) {
              return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: jsonHeaders });
            }

            const content = fs.readFileSync(filePath, 'utf-8');
            return new Response(JSON.stringify({
              fileName,
              content,
            }), { headers: jsonHeaders });
          } catch {
            return new Response(JSON.stringify({ error: 'failed' }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
          }
        }
        if (url.pathname.startsWith("/js/") || url.pathname.startsWith("/css/") || url.pathname.startsWith("/sprites/") || url.pathname.startsWith("/assets/")) {
          return await handleStaticFile(url.pathname);
        }
        return new Response("Not Found", {
          status: 404,
          headers: CORS_HEADERS,
        });
      }
    }
  },
});

console.log(`[${new Date().toISOString()}] Backstage viewer running at http://localhost:${PORT} (PID: ${process.pid}, PGID: ${process.getgid?.() ?? '?'}, PPID: ${process.ppid ?? '?'})`);

// Write own PID for reliable process management (launch.sh PID may differ)
const PID_FILE = path.join(PLUGIN_DIR, "viewer.pid");
try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch {}

// ─── [C] Team Activation (Chris tool → [C] team member) ─────────

const TOOL_TO_C_TEAM: Record<string, string> = {
  'Read': 'Mia', 'Edit': 'Kai', 'Grep': 'Zoe',
  'Glob': 'Liam', 'Write': 'Aria', 'Bash': 'Noah',
  'Task': 'Luna',
};
const C_TEAM_FALLBACK = 'Owen';
const C_TEAM_COOLDOWN_MS = 3_000;
const C_TEAM_DURATION_MS = 8_000;

interface CTeamActivation {
  name: string;
  tool: string;
  expireAt: number;
}

const activeCTeam = new Map<string, CTeamActivation>();
const cTeamLastActivate = new Map<string, number>();
let cTeamHistoryOffset = 0;

function checkAndActivateCTeam(): void {
  if (!fs.existsSync(HISTORY_FILE)) return;
  const now = Date.now();

  // 1. Expire active [C] team members → write c-idle events
  for (const [name, info] of activeCTeam) {
    if (now >= info.expireAt) {
      const ts = new Date().toTimeString().slice(0, 8);
      const epoch = Math.floor(now / 1000);
      const entry = JSON.stringify({
        ts, epoch, type: 'c-idle',
        speaker: name, msg: 'idle'
      });
      try { fs.appendFileSync(HISTORY_FILE, entry + '\n'); } catch {}
      activeCTeam.delete(name);
    }
  }

  // 2. Read recent history for Chris work events
  try {
    const stat = fs.statSync(HISTORY_FILE);
    if (cTeamHistoryOffset === 0) cTeamHistoryOffset = Math.max(0, stat.size - 2048);
    if (stat.size <= cTeamHistoryOffset) return;
    if (stat.size < cTeamHistoryOffset) { cTeamHistoryOffset = 0; return; }

    const readSize = Math.min(stat.size - cTeamHistoryOffset, 4096);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(HISTORY_FILE, 'r');
    try {
      fs.readSync(fd, buf, 0, readSize, cTeamHistoryOffset);
    } finally { fs.closeSync(fd); }
    cTeamHistoryOffset = stat.size;

    const content = buf.toString('utf-8');
    const lines = content.trim().split('\n');

    // Find latest Chris work event (detect tool from emoji/verb hints in i18n)
    const parseHints: Record<string, string[]> = i18n.tool_verb_parse_hints || {};
    let chrisTool = '';
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const e = JSON.parse(lines[i]);
        if (e.type === 'work' && e.speaker === 'Chris' && e.role === 'boss') {
          const msg = e.msg || '';
          let matched = false;
          for (const [tool, hints] of Object.entries(parseHints)) {
            if (Array.isArray(hints) && hints.some(h => msg.includes(h))) {
              chrisTool = tool;
              matched = true;
              break;
            }
          }
          if (!matched) chrisTool = 'Read';
          break;
        }
      } catch {}
    }

    if (!chrisTool) return;

    // 3. Map tool → [C] team member
    const memberName = TOOL_TO_C_TEAM[chrisTool] || C_TEAM_FALLBACK;

    // 4. Cooldown check (same member within 3s)
    const lastActivate = cTeamLastActivate.get(memberName) || 0;
    if (now - lastActivate < C_TEAM_COOLDOWN_MS) return;

    // 5. Skip if already active
    if (activeCTeam.has(memberName)) return;

    // 6. Activate
    activeCTeam.set(memberName, { name: memberName, tool: chrisTool, expireAt: now + C_TEAM_DURATION_MS });
    cTeamLastActivate.set(memberName, now);

    const info = TOOL_INFO[chrisTool] || { emoji: '🔧', verb: toolVerbDefault };
    const ts = new Date().toTimeString().slice(0, 8);
    const epoch = Math.floor(now / 1000);
    const entry = JSON.stringify({
      ts, epoch, type: 'c-active',
      speaker: memberName,
      tool: chrisTool,
      duration: C_TEAM_DURATION_MS,
      msg: `${info.emoji} ${chrisTool} ${info.verb}`
    });

    try { fs.appendFileSync(HISTORY_FILE, entry + '\n'); } catch {}
  } catch {}
}

// ─── Dialogue Queue Processor ─────────────────────────────────────
let dialogueQueueProcessing = false;

async function processDialogueQueue(): Promise<void> {
  if (!config.ai_dialogue) return; // ai_dialogue disabled → skip dialogue generation
  if (dialogueQueueProcessing) return;
  const exists = fs.existsSync(DIALOGUE_QUEUE_FILE);
  const size = exists ? fs.statSync(DIALOGUE_QUEUE_FILE).size : 0;
  if (!exists || size === 0) return;

  let content: string;
  try {
    content = fs.readFileSync(DIALOGUE_QUEUE_FILE, 'utf-8').trim();
    if (!content) return;
  } catch { return; }

  dialogueQueueProcessing = true;
  console.log(`[dialogue] processing queue: ${size} bytes`);

  try {
    // 큐 즉시 비우기 (새 요청은 다음 사이클에 처리)
    fs.writeFileSync(DIALOGUE_QUEUE_FILE, '');

    const lines = content.split('\n').filter(Boolean);
    const now = Math.floor(Date.now() / 1000);

    for (const line of lines) {
      let entry: any;
      try { entry = JSON.parse(line); } catch { continue; }

      // TTL 체크: 60초 이상 된 요청은 스킵
      if (now - (entry.epoch || 0) > 60) { console.log(`[dialogue] TTL skip: age=${now - (entry.epoch || 0)}s speaker=${entry.speaker}`); continue; }

      const prompt = entry.prompt;
      if (!prompt) continue;

      // Prepend language instruction based on config
      const langPrefix = config.language === 'ko'
        ? '' // Korean is default for the model
        : `Respond in English only. `;
      const fullPrompt = langPrefix + prompt;

      try {
        // claude -p (중첩 세션 감지 환경변수 모두 제거)
        // --system-prompt로 전역 CLAUDE.md/플러그인 간섭 방지 (이게 없으면 empty output 발생)
        const cleanEnv = { ...process.env, BACKSTAGE_DIALOGUE: '1' };
        delete cleanEnv.CLAUDECODE;
        delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
        delete cleanEnv.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;

        // BACKSTAGE_DIALOGUE=1 환경변수로 hook 재귀 방지 (user-prompt-hook.sh에서 체크)
        // stdin으로 프롬프트 전달: Blob을 사용해 Bun이 자동으로 파이프+닫기 처리
        const dialogueSystemPrompt = 'You are a dialogue generator for an IT startup office pixel art viewer. Output ONLY valid JSON with no markdown fences, no explanation. Format: {"lines":[{"speaker":"boss"|"agent","msg":"..."}]}';
        const proc = Bun.spawn(['claude', '-p', '--model', 'haiku', '--no-session-persistence', '--system-prompt', dialogueSystemPrompt], {
          stdin: new Blob([fullPrompt]),
          stdout: 'pipe',
          stderr: 'pipe',
          env: cleanEnv,
        });
        const killTimer = setTimeout(() => { try { proc.kill(); } catch {} }, 60_000);

        const output = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        await proc.exited;
        clearTimeout(killTimer);

        const exitCode = proc.exitCode;
        if (stderr.trim()) console.error('[dialogue] stderr:', stderr.trim().slice(0, 200));
        if (!output.trim()) { console.log(`[dialogue] empty output for: ${entry.speaker} (exit=${exitCode}, prompt=${fullPrompt.slice(0, 80)}...)`); continue; }
        console.log(`[dialogue] got output for ${entry.speaker}: ${output.trim().slice(0, 120)}`);

        // JSON 추출
        let json: any = null;
        try {
          json = JSON.parse(output.trim());
        } catch {
          const match = output.match(/\{[\s\S]*"lines"[\s\S]*\}/);
          if (match) {
            try { json = JSON.parse(match[0]); } catch {}
          }
        }

        if (!json?.lines?.length) continue;

        const ts = new Date().toTimeString().slice(0, 8);
        const epoch = Math.floor(Date.now() / 1000);

        ensureHistoryFile();
        // 시간차 대화: 첫 라인은 즉시, 나머지는 2초 간격으로 기록
        // → SSE 폴링에서 자연스럽게 순차 표시됨
        const validLines = json.lines.filter((l: any) => l.msg).slice(0, 2); // 최대 2줄 (boss 1 + agent 1)
        for (let i = 0; i < validLines.length; i++) {
          const l = validLines[i];
          const rawSpeaker = l.speaker || entry.speaker || 'Agent';
          const speaker = rawSpeaker === 'boss' ? 'Chris'
            : rawSpeaker === 'agent' ? (entry.speaker || 'Agent')
            : rawSpeaker;
          const role = rawSpeaker === 'boss' ? 'boss' : (entry.role || 'agent');
          const evType = entry.type === 'complete' ? 'done'
            : entry.type === 'assign' ? 'assign'
            : entry.type === 'idle-chat' ? 'idle-chat'
            : 'c-bubble';

          const writeEntry = () => {
            const nowTs = new Date().toTimeString().slice(0, 8);
            const nowEpoch = Math.floor(Date.now() / 1000);
            const histEntry = JSON.stringify({
              ts: nowTs, epoch: nowEpoch, type: evType,
              speaker, role, msg: l.msg,
            });
            try { fs.appendFileSync(HISTORY_FILE, histEntry + '\n'); } catch {}
          };

          if (i === 0) {
            writeEntry();
          } else {
            setTimeout(writeEntry, i * 2000);
          }
        }
      } catch (e: any) {
        console.error('[dialogue] claude --print error:', e?.message || e);
      }
    }
  } finally {
    dialogueQueueProcessing = false;
  }
}

// ─── Timers ──────────────────────────────────────────────────────

// Transcript scanner: every 1 second (thinking redact 전 캡처 + 리소스 절충)
const transcriptScanTimer = setInterval(() => {
  try { scanTranscriptForAgentWork(); } catch {}
  // Usage API 주기적 갱신 (fire-and-forget, 자체 60초 캐시)
  getUsagePercent().then(u => {
    usageData.fiveHourPercent = u.fiveHour;
    usageData.sevenDayPercent = u.sevenDay;
  }).catch(() => {});
}, 1000);

// Usage refresh: re-scan transcript every 30 seconds for accurate token data
const usageRefreshTimer = setInterval(() => {
  try { scanTranscriptUsage(); } catch {}
}, 30_000);

// Idle chat generator: fallback every 40s (AI OFF) + AI idle/c-team every 60s (AI ON)
const idleChatTimer = setInterval(() => {
  try { generateIdleChat(); } catch {}
  try { generateAiIdleChat(); } catch {}
  try { generateCTeamChat(); } catch {}
}, 20_000);

// [C] Team activation: every 3 seconds
const cTeamTimer = setInterval(() => {
  try { checkAndActivateCTeam(); } catch {}
}, 3000);

// Dialogue queue processor: every 3 seconds
const dialogueQueueTimer = setInterval(() => {
  processDialogueQueue().catch(() => {});
}, 3000);

// 실행 중인 claude 프로세스 목록 갱신: 30초마다
const claudeSessionTimer = setInterval(() => {
  refreshActiveClaudeSessions();
}, 30_000);

// ─── Auto-shutdown: no SSE listeners for 10 minutes ──────────
let lastListenerTime = Date.now();
const IDLE_SHUTDOWN_MS = 10 * 60 * 1000; // 10 minutes

const idleCheckTimer = setInterval(() => {
  if (activeConnections.size > 0) {
    lastListenerTime = Date.now();
  } else if (Date.now() - lastListenerTime >= IDLE_SHUTDOWN_MS) {
    console.log("No SSE listeners for 10 minutes, auto-shutting down...");
    shutdown();
  }
}, 30_000); // check every 30s

// ─── Shutdown ───────────────────────────────────────────────────

function shutdown(): void {
  console.log("\nShutting down...");
  clearInterval(transcriptScanTimer);
  clearInterval(usageRefreshTimer);
  clearInterval(idleChatTimer);
  clearInterval(cTeamTimer);
  clearInterval(dialogueQueueTimer);
  clearInterval(claudeSessionTimer);
  clearInterval(idleCheckTimer);
  for (const conn of activeConnections) {
    conn.close();
  }
  activeConnections.clear();
  server.stop(true);
  process.exit(0);
}

process.on("SIGTERM", () => { console.log(`[${new Date().toISOString()}] Received SIGTERM`); shutdown(); });
process.on("SIGINT", () => { console.log(`[${new Date().toISOString()}] Received SIGINT`); shutdown(); });
process.on("SIGHUP", () => { console.log(`[${new Date().toISOString()}] Received SIGHUP (ignored)`); });
