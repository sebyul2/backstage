import { homedir } from "os";
import * as path from "path";
import * as fs from "fs";
import { spawn } from "child_process";
import Anthropic from '@anthropic-ai/sdk';

const PLUGIN_DIR = path.join(homedir(), ".claude/plugins/backstage");

// ─── Self-daemonize: fork detached child via setsid and exit ─
// Uses perl POSIX::setsid() to create a new session — fully detaches
// from parent shell's process group (prevents SIGTERM on shell exit)
if (!process.env.BACKSTAGE_DAEMON) {
  const logFd = fs.openSync("/tmp/backstage-viewer.log", "a");
  // Do NOT use detached:true — it makes the child a process group leader,
  // which causes perl's setsid() to fail (POSIX: PGID==PID can't setsid)
  const child = spawn("perl", [
    "-e", 'use POSIX "setsid"; setsid(); exec @ARGV',
    process.execPath, import.meta.path,
  ], {
    env: { ...process.env, BACKSTAGE_DAEMON: "1" },
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  const pidFile = path.join(PLUGIN_DIR, "viewer.pid");
  fs.mkdirSync(PLUGIN_DIR, { recursive: true });
  fs.writeFileSync(pidFile, String(child.pid));
  console.log(`Backstage daemon started (PID: ${child.pid})`);
  process.exit(0);
}
const HISTORY_FILE =
  process.env.BACKSTAGE_HISTORY ||
  path.join(PLUGIN_DIR, "history.jsonl");

const CHARACTERS_FILE = (() => {
  const local = path.join(import.meta.dir, "../hooks/characters.json");
  if (fs.existsSync(local)) return local;
  return path.join(PLUGIN_DIR, "characters.json");
})();

const HTML_FILE = path.join(import.meta.dir, "./index.html");
const VIEWER_DIR = import.meta.dir;

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

let anthropicClient: Anthropic | null = null;
try {
    if (process.env.ANTHROPIC_API_KEY) {
        anthropicClient = new Anthropic();
    }
} catch {}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ─── Agent name mapping ─────────────────────────────────────────
const AGENT_NAMES: Record<string, string> = {
  // ─── Jake: 탐색 ───
  'explore': 'Jake', 'explore-medium': 'Jake',
  'oh-my-claudecode:explore': 'Jake', 'oh-my-claudecode:explore-medium': 'Jake',
  // ─── David: 아키텍트/자문 ───
  'oracle': 'David', 'oracle-medium': 'David', 'oracle-low': 'David',
  'oh-my-claudecode:architect': 'David',
  // ─── Kevin: 실행 ───
  'sisyphus-junior': 'Kevin', 'sisyphus-junior-low': 'Kevin', 'sisyphus-junior-high': 'Kevin',
  'oh-my-claudecode:executor': 'Kevin', 'oh-my-claudecode:executor-low': 'Kevin', 'oh-my-claudecode:executor-high': 'Kevin',
  'oh-my-claudecode:deep-executor': 'Kevin', 'general-purpose': 'Kevin',
  // ─── Sophie: 디자인/프론트 ───
  'frontend-engineer': 'Sophie', 'frontend-engineer-low': 'Sophie', 'frontend-engineer-high': 'Sophie',
  'oh-my-claudecode:designer': 'Sophie',
  // ─── Emily: 문서 ───
  'document-writer': 'Emily', 'dialogue-generator': 'Emily',
  'oh-my-claudecode:writer': 'Emily', 'oh-my-claudecode:document-specialist': 'Emily',
  // ─── Michael: 리서치 ───
  'librarian': 'Michael', 'librarian-low': 'Michael',
  'claude-code-guide': 'Michael', 'multimodal-looker': 'Michael',
  // ─── Alex: 기획 ───
  'prometheus': 'Alex', 'Plan': 'Alex', 'plan': 'Alex',
  'oh-my-claudecode:planner': 'Alex',
  // ─── Sam: QA ───
  'qa-tester': 'Sam', 'oh-my-claudecode:qa-tester': 'Sam',
  // ─── Ethan: 코드 리뷰 ───
  'oh-my-claudecode:code-reviewer': 'Ethan', 'oh-my-claudecode:quality-reviewer': 'Ethan',
  // ─── Rachel: 비평 ───
  'momus': 'Rachel', 'oh-my-claudecode:critic': 'Rachel',
  // ─── Leo: 디버깅 ───
  'oh-my-claudecode:debugger': 'Leo',
  // ─── Daniel: 분석/연구 ───
  'metis': 'Daniel', 'oh-my-claudecode:scientist': 'Daniel', 'oh-my-claudecode:analyst': 'Daniel',
  // ─── Max: 빌드/정리 ───
  'oh-my-claudecode:build-fixer': 'Max', 'oh-my-claudecode:code-simplifier': 'Max',
  // ─── Tyler: 테스트/검증 ───
  'oh-my-claudecode:test-engineer': 'Tyler', 'oh-my-claudecode:verifier': 'Tyler',
  // ─── Ryan: 보안 ───
  'oh-my-claudecode:security-reviewer': 'Ryan',
  // ─── Eric: Git ───
  'oh-my-claudecode:git-master': 'Eric',
};

// Reverse mapping: name → primary role
const NAME_TO_ROLE: Record<string, string> = {
  'Jake': 'explore', 'David': 'oracle', 'Kevin': 'sisyphus-junior',
  'Sophie': 'frontend-engineer', 'Emily': 'document-writer',
  'Michael': 'librarian', 'Alex': 'prometheus', 'Sam': 'qa-tester',
  'Ethan': 'code-reviewer', 'Rachel': 'critic', 'Leo': 'debugger',
  'Daniel': 'scientist', 'Max': 'build-fixer', 'Tyler': 'test-engineer',
  'Ryan': 'security-reviewer', 'Eric': 'git-master',
};

const AGENT_PERSONALITIES: Record<string, string> = {
  'Jake': '신입 1년차, 열정적, 밝음',
  'David': '10년차 시니어, 쿨하고 간결',
  'Kevin': '성실한 2년차, 가끔 투덜',
  'Sophie': '디자인 감각, 깔끔함 추구',
  'Emily': '꼼꼼, 정리 잘함, 친절',
  'Michael': '조용, 박학다식, 말수 적음',
  'Alex': '전략적 사고, 큰 그림 좋아함',
  'Sam': '꼼꼼, 버그 찾으면 기뻐함, 장난기',
  'Ethan': '3년차, 꼼꼼한 리뷰어, 날카로운 눈',
  'Rachel': '독설가지만 실력 인정, 팩폭',
  'Leo': '끈기 있는 디버거, 집요함',
  'Daniel': '데이터 덕후, 분석 좋아함, 조용',
  'Max': '빌드 장인, 에러 보면 흥분',
  'Tyler': '테스트 광, 커버리지 집착',
  'Ryan': '보안 전문가, 약간 편집증',
  'Eric': 'Git 마스터, 히스토리 깔끔함 집착',
};

// Minimal tool info for fallback only
const TOOL_INFO: Record<string, { emoji: string; verb: string }> = {
  'Read': { emoji: '📖', verb: '확인 중' },
  'Glob': { emoji: '🔍', verb: '찾는 중' },
  'Grep': { emoji: '🔎', verb: '검색 중' },
  'Edit': { emoji: '✏️', verb: '수정 중' },
  'Write': { emoji: '📝', verb: '작성 중' },
  'Bash': { emoji: '💻', verb: '실행 중' },
};

// ─── Idle chat lines (break room) ───────────────────────────────
const IDLE_CHATS: string[] = [
  '커피 한 잔 더 마셔야겠다',
  '오늘 점심 뭐 먹지',
  '아 오늘 금요일이었으면...',
  '커피 맛있다 ☕',
  '코드 리뷰 언제 하지',
  '어제 넷플릭스 뭐 봤어?',
  '배고프다...',
  '자판기 커피도 괜찮네',
  '오늘 야근인가...',
  '주말에 뭐 해?',
  '아 졸려 😴',
  '이거 다 언제 끝나지',
  '맥주 마시고 싶다 🍺',
  '치킨 먹고 싶다',
  '오후에 회의 있어?',
  '카페인 충전 완료 ⚡',
  '런치 메뉴 정했어?',
  '아 날씨 좋다',
  '코딩하다 머리 터질 것 같아',
  '디버깅 지옥에서 탈출했다',
  '깃 충돌 또 났어 ㅠ',
  'PR 리뷰 좀 해줘~',
  '테스트 다 통과했어! 🎉',
  '빌드 왜 이렇게 오래 걸려',
  '슬랙 알림 좀 꺼야겠다',
  '점심 같이 먹을 사람?',
  '아메리카노 하나 더',
  '오늘 배포일이야?',
  '버그 잡았다! 🐛',
  '타입스크립트 왜 이래...',
  'null이 또 터졌어',
  '이 로직 누가 짠 거야',
  '스프린트 끝나간다',
  '회의실 잡았어?',
  '와이파이 느려...',
  '모니터 하나 더 갖고 싶다',
  '키보드 새로 살까',
  '에어컨 좀 세다',
  '택배 왔대!',
  '간식 누가 사왔어?',
  '자판기 아이스티 맛있어',
  '오늘 퇴근 몇 시야',
  '스탠딩 데스크 좋네',
  '눈이 피곤하다',
  '스트레칭 좀 해야지',
  '회의 끝났어?',
  '점심 먹고 졸려...',
  '다음 스프린트 뭐야',
  '어제 뭐 했어?',
  '히터 좀 틀어줘',
];

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
  if (now - lastIdleChatTime < 20_000) return;
  lastIdleChatTime = now;

  const names = Object.keys(AGENT_PERSONALITIES);
  const name = names[Math.floor(Math.random() * names.length)];
  const role = NAME_TO_ROLE[name] || 'agent';
  let msg: string | null = null;

  // Try Haiku API first
  if (anthropicClient) {
    try {
      const personality = AGENT_PERSONALITIES[name] || '';
      const humor = Math.random() < 0.4;
      const style = humor
        ? '유머/드립을 섞어서. IT개발자 밈, 야근드립, 커피드립, 버그드립 등. 웃기게.'
        : '자연스럽고 일상적으로. 편하게 수다떠는 느낌.';
      const response = await anthropicClient.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: `IT 스타트업 휴게실에서 ${name}(${personality})이 혼잣말 또는 동료에게 한마디.
20-50자. 한국어. 이모지 가끔. ${style}
문장만 출력. 따옴표 없이. 설명 없이.`
        }],
      });
      const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : null;
      if (text && text.length > 0 && text.length < 80) {
        msg = text;
      }
    } catch {}
  }

  // Fallback to predefined
  if (!msg) {
    msg = IDLE_CHATS[Math.floor(Math.random() * IDLE_CHATS.length)];
  }

  const ts = new Date().toTimeString().slice(0, 8);
  const epoch = Math.floor(Date.now() / 1000);
  const entry = JSON.stringify({
    ts, epoch, type: 'idle-chat',
    speaker: name, role, msg,
  });

  ensureHistoryFile();
  try { fs.appendFileSync(HISTORY_FILE, entry + '\n'); } catch {}
}

// ─── Transcript Scanner (Agent Work Detection) ─────────────────

let transcriptOffset = 0;
let transcriptPath: string | null = null;
let transcriptLastCheck = 0;
const agentTypeMap: Record<string, string> = {};
const agentIdToType: Record<string, string> = {};
const subagentOffsets = new Map<string, number>();
const recordedToolIds = new Set<string>();
let lastChrisTalkEpoch = 0;
const recordedTextHashes = new Set<string>();

// Track active agents for auto-completion detection
const activeAgents: Map<string, { lastActivity: number; agentName: string; agentType: string }> = new Map();
const AGENT_IDLE_TIMEOUT = 30_000; // 30 seconds without activity → auto "done"

function findCurrentTranscript(): string | null {
  const projectsDir = path.join(homedir(), ".claude/projects");
  if (!fs.existsSync(projectsDir)) return null;

  let newest: { path: string; mtime: number } | null = null;

  try {
    const projectDirs = fs.readdirSync(projectsDir);
    for (const dir of projectDirs) {
      if (!dir.includes("claude-backstage")) continue;

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
            if (!newest || stat.mtimeMs > newest.mtime) {
              newest = { path: fullPath, mtime: stat.mtimeMs };
            }
          } catch { continue; }
        }
      } catch { continue; }
    }
  } catch { return null; }

  return newest?.path || null;
}

function scanTranscriptForAgentWork(): void {
  const now = Date.now();

  if (!transcriptPath || (now - transcriptLastCheck) > 10_000) {
    transcriptLastCheck = now;
    const found = findCurrentTranscript();
    if (found && found !== transcriptPath) {
      transcriptPath = found;
      recordedToolIds.clear();

      // One-time scan: populate agentTypeMap from entire transcript
      // (needed so new agent_progress events can resolve agent names)
      try {
        const fullContent = fs.readFileSync(found, 'utf-8');
        for (const line of fullContent.trim().split('\n')) {
          try {
            const e = JSON.parse(line);
            if (e.message?.content) {
              for (const c of e.message.content) {
                if (c.type === 'tool_use' && c.name === 'Task' && c.input?.subagent_type) {
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
          } catch {}
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
  if (stat.size <= transcriptOffset) return;

  let readFrom = transcriptOffset;
  const maxRead = 512 * 1024;
  if (stat.size - readFrom > maxRead) {
    readFrom = stat.size - maxRead;
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
          if (c.type === "tool_use" && c.name === "Task" && c.input?.subagent_type) {
            agentTypeMap[c.id] = c.input.subagent_type;
          }
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

          const agentName = AGENT_NAMES[agentType] || "Agent";
          latestPerAgent.set(agentName, { agentName, agentType, tool: toolName, target: shortTarget, detail });
        }
      }
    } catch {}
  }

  if (latestPerAgent.size > 0) {
    ensureHistoryFile();
    for (const tool of latestPerAgent.values()) {
      const info = TOOL_INFO[tool.tool] || { emoji: "🔧", verb: "작업 중" };
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

      try { fs.appendFileSync(HISTORY_FILE, entry + "\n"); } catch {}
    }

    // Update active agent tracking (exclude Chris — boss never "completes")
    for (const tool of latestPerAgent.values()) {
      if (tool.agentName === 'Chris') continue;
      activeAgents.set(tool.agentName, {
        lastActivity: Date.now(),
        agentName: tool.agentName,
        agentType: tool.agentType,
      });
    }
  }

  // Auto-complete agents with no recent activity
  const now2 = Date.now();
  for (const [name, info] of activeAgents) {
    if (now2 - info.lastActivity > AGENT_IDLE_TIMEOUT) {
      const ts = new Date().toTimeString().slice(0, 8);
      const epoch = Math.floor(now2 / 1000);
      const entry = JSON.stringify({
        ts, epoch, type: "done",
        speaker: name, role: info.agentType,
        msg: "작업 완료",
      });
      try { fs.appendFileSync(HISTORY_FILE, entry + "\n"); } catch {}
      activeAgents.delete(name);
    }
  }

  // User input detection
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== "human" || entry.message?.role !== "human") continue;
      if (!entry.message?.content) continue;

      for (const block of entry.message.content) {
        if (block.type !== "text" || !block.text) continue;
        const text = block.text.trim();
        if (text.length < 3 || text.length > 200) continue;
        if (text.startsWith("<") || text.startsWith("{")) continue;

        const hash = `user:${text.slice(0, 60)}`;
        if (recordedTextHashes.has(hash)) continue;
        recordedTextHashes.add(hash);

        const ts = new Date().toTimeString().slice(0, 8);
        const epoch = Math.floor(Date.now() / 1000);
        let msg = text.replace(/\n/g, " ");
        if (msg.length > 100) msg = msg.slice(0, 100) + "...";

        const userEntry = JSON.stringify({
          ts, epoch, type: "user-input",
          speaker: "You", role: "client", msg,
        });
        try { fs.appendFileSync(HISTORY_FILE, userEntry + "\n"); } catch {}
        break;
      }
    } catch {}
  }

  // Chris talk
  const nowEpoch = Math.floor(Date.now() / 1000);

  if (nowEpoch - lastChrisTalkEpoch >= 30) {
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
          if (msg.length > 150) msg = msg.slice(0, 150) + "...";
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

    // First encounter after server restart: skip to end (don't replay old activity)
    if (!subagentOffsets.has(filePath)) {
      subagentOffsets.set(filePath, stat.size);
      continue;
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
    const agentName = AGENT_NAMES[agentType] || "Agent";

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
      const info = TOOL_INFO[tool.tool] || { emoji: "🔧", verb: "작업 중" };
      const ts = new Date().toTimeString().slice(0, 8);
      const epoch = Math.floor(Date.now() / 1000);
      const msg = `${info.emoji} ${tool.target || tool.tool} ${info.verb}`;

      const histEntry = JSON.stringify({
        ts, epoch, type: "work",
        speaker: tool.agentName,
        role: tool.agentType,
        msg,
      });

      try { fs.appendFileSync(HISTORY_FILE, histEntry + "\n"); } catch {}

      // Track for auto-completion (so done events get generated after 30s idle)
      activeAgents.set(tool.agentName, {
        lastActivity: Date.now(),
        agentName: tool.agentName,
        agentType: tool.agentType,
      });
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

  let offset = fs.existsSync(HISTORY_FILE)
    ? fs.statSync(HISTORY_FILE).size
    : 0;

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
  const entries = getLastNLines(HISTORY_FILE, 50);
  return new Response(JSON.stringify(entries), {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
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
    const file = Bun.file(HTML_FILE);
    return new Response(file, {
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
      case "/status":
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      default:
        if (url.pathname.startsWith("/js/") || url.pathname.startsWith("/css/") || url.pathname.startsWith("/sprites/")) {
          return await handleStaticFile(url.pathname);
        }
        return new Response("Not Found", {
          status: 404,
          headers: CORS_HEADERS,
        });
    }
  },
});

console.log(`Backstage viewer running at http://localhost:${PORT}`);

// Write own PID for reliable process management (launch.sh PID may differ)
const PID_FILE = path.join(PLUGIN_DIR, "viewer.pid");
try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch {}

// ─── Timers ──────────────────────────────────────────────────────

// Transcript scanner: every 3 seconds
const transcriptScanTimer = setInterval(() => {
  try { scanTranscriptForAgentWork(); } catch {}
}, 3000);

// Idle chat generator: every 20 seconds
const idleChatTimer = setInterval(() => {
  try { generateIdleChat(); } catch {}
}, 20_000);

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
  clearInterval(idleChatTimer);
  clearInterval(idleCheckTimer);
  for (const conn of activeConnections) {
    conn.close();
  }
  activeConnections.clear();
  server.stop(true);
  process.exit(0);
}

process.on("SIGTERM", () => { console.log("Received SIGTERM"); shutdown(); });
process.on("SIGINT", () => { console.log("Received SIGINT"); shutdown(); });
