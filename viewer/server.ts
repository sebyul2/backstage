import { homedir } from "os";
import * as path from "path";
import * as fs from "fs";

const PLUGIN_DIR = path.join(homedir(), ".claude/plugins/backstage");
const HISTORY_FILE =
  process.env.BACKSTAGE_HISTORY ||
  path.join(PLUGIN_DIR, "history.jsonl");

const CHRIS_LOG_FILE = path.join(PLUGIN_DIR, "chris-log.jsonl");

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

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

let lastUserMessage = '';
let lastChapterUserMsg = '';  // 마지막 챕터의 사용자 메시지 (그룹핑용)

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

const AGENT_PERSONALITIES: Record<string, string> = {
  'Jake': '신입 1년차, 열정적, 밝음',
  'David': '10년차 시니어, 쿨하고 간결',
  'Kevin': '성실한 2년차, 가끔 투덜',
  'Sophie': '디자인 감각, 깔끔함 추구',
  'Emily': '꼼꼼, 정리 잘함, 친절',
  'Michael': '조용, 박학다식, 말수 적음',
  'Alex': '전략적 사고, 큰 그림 좋아함',
  'Sam': '꼼꼼, 버그 찾으면 기뻐함, 장난기',
};

// ─── C-Team Personalities (for AI dialogue generation) ────────
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

  // Predefined idle chat (callClaudeCLI 제거 — 동작 불안정)
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

// ─── Usage Tracking ──────────────────────────────────────────
let usageData = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  contextWindow: 0,      // estimated from preTokens on compact
  lastTurnContext: 0,     // last turn's input+cache_read (current context size)
  lastEmitTime: 0,
};

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
      activeAgents.delete(name);
      for (const [aid, charName] of agentAssignments) {
        if (charName === name) { releaseCharacter(aid); break; }
      }
      // dialogue-generator는 건너뛰기 (대사 생성 에이전트이므로 완료 보고 불필요)
      if (info.agentType.includes('dialogue-generator')) continue;
      // 완료 대사: history에서 해당 에이전트의 최근 이벤트를 읽어 맥락 반영
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
      }
    });
    try { fs.appendFileSync(HISTORY_FILE, usageEntry + '\n'); } catch {}
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
        lastUserMessage = msg;
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

  // Chris thinking (from model's thinking blocks → 💭 thought bubbles, chunked)
  // Queue: extract all chunks from new thinking blocks, emit one per scan cycle
  const thinkCondition = thinkQueue.length === 0 && nowEpoch - lastChrisTalkEpoch >= 6;
  console.log(`[think-debug] queue=${thinkQueue.length} gap=${nowEpoch - lastChrisTalkEpoch} lines=${lines.length} condition=${thinkCondition}`);
  if (thinkCondition) {
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== "assistant" || entry.message?.role !== "assistant") continue;
        if (!entry.message?.content) continue;

        for (const block of entry.message.content) {
          if (block.type !== "thinking" || !block.thinking) continue;

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

  // Emit one thinking chunk per scan cycle (every 3 seconds)
  if (thinkQueue.length > 0) {
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

  // ═══ Chris 대화록 챕터 로깅 ═══
  // 새 assistant 응답에서 thinking + text + tools를 하나의 챕터로 구조화
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== "assistant" || entry.message?.role !== "assistant") continue;
      if (!entry.message?.content) continue;

      const msgId = entry.message.id || '';
      if (!msgId) continue;
      const chapterKey = `chapter:${msgId}`;
      if (recordedTextHashes.has(chapterKey)) continue;
      recordedTextHashes.add(chapterKey);

      let thinkLines: string[] = [];
      let responseText = '';
      // 사용자 메시지에서 핵심 주제 추출 (강력 요약)
      let chapterTitle = '';
      if (lastUserMessage) {
        let line = lastUserMessage.split('\n')[0].trim();
        line = line.replace(/^\d+[\.\)]\s*/, '');  // 번호 리스트 접두어 제거
        line = line.replace(/[.。!！?？…~]+$/g, '')
          .replace(/\s*(해\s*줘|해주세요|하세요|해봐|부탁|좀|할\s*것|하기)\s*$/g, '')
          .trim();
        chapterTitle = line.length > 40 ? line.slice(0, 40) + '…' : (line || '');
      }
      const files: string[] = [];

      for (const block of entry.message.content) {
        if (block.type === 'thinking' && block.thinking) {
          const t = block.thinking.trim();
          const meaningful = t.split('\n')
            .map((l: string) => l.trim())
            .filter((l: string) => l.length > 10 && l.length < 200)
            .filter((l: string) => !l.startsWith('<') && !l.startsWith('{') && !l.startsWith('```'))
            .filter((l: string) => !l.startsWith('//') && !l.startsWith('#') && !l.startsWith('|'))
            .filter((l: string) => !/^(import|const|let|var|function|class|if|for|return|export)\b/.test(l))
            .filter((l: string) => /[\uAC00-\uD7AF]/.test(l));

          if (meaningful.length > 0 && !chapterTitle) {
            const t0 = meaningful[0].replace(/\*\*/g, '').replace(/`/g, '').replace(/[.。!！?？…]+$/g, '').trim();
            chapterTitle = t0.length > 25 ? t0.slice(0, 25) + '…' : t0;
          }
          for (const m of meaningful.slice(0, 15)) {
            let tl = m.replace(/\*\*/g, '').replace(/`/g, '').replace(/^[-*]\s+/, '');
            if (tl.length > 300) tl = tl.slice(0, 297) + '...';
            thinkLines.push(tl);
          }
        }

        if (block.type === 'text' && block.text) {
          const txt = block.text.trim();
          const koreanLines = txt.split('\n')
            .map((l: string) => l.trim())
            .filter((l: string) => l.length > 5 && /[\uAC00-\uD7AF]/.test(l))
            .filter((l: string) => !l.startsWith('```') && !l.startsWith('|') && !l.startsWith('#'));
          if (koreanLines.length > 0) {
            responseText = koreanLines.slice(0, 3).join(' ');
            if (responseText.length > 500) responseText = responseText.slice(0, 497) + '...';
          }
        }

        if (block.type === 'tool_use') {
          const input = block.input as any;
          const fp = input?.file_path || input?.path || input?.command || '';
          if (typeof fp === 'string' && fp.length > 0) {
            const basename = fp.split('/').pop() || fp;
            if (!files.includes(basename)) files.push(basename);
          }
        }
      }

      if (thinkLines.length === 0 && !responseText) continue;
      if (!chapterTitle) {
        const fb = responseText.slice(0, 25);
        chapterTitle = responseText.length > 25 ? fb + '…' : (fb || '(무제)');
      }

      // 같은 사용자 메시지 주제면 기존 챕터에 병합
      if (lastUserMessage && lastUserMessage === lastChapterUserMsg) {
        try {
          const logContent = fs.existsSync(CHRIS_LOG_FILE) ? fs.readFileSync(CHRIS_LOG_FILE, 'utf-8') : '';
          const logLines = logContent.trim().split('\n').filter(Boolean);
          if (logLines.length > 0) {
            const lastEntry = JSON.parse(logLines[logLines.length - 1]);
            for (const t of thinkLines) {
              if (!lastEntry.thinks.includes(t)) lastEntry.thinks.push(t);
            }
            if (responseText && responseText !== lastEntry.response) {
              lastEntry.response = (lastEntry.response ? lastEntry.response + '\n' : '') + responseText;
              if (lastEntry.response.length > 500) lastEntry.response = lastEntry.response.slice(0, 497) + '...';
            }
            for (const f of files) {
              if (!lastEntry.files.includes(f)) lastEntry.files.push(f);
            }
            lastEntry.ts = new Date().toTimeString().slice(0, 8);
            logLines[logLines.length - 1] = JSON.stringify(lastEntry);
            fs.writeFileSync(CHRIS_LOG_FILE, logLines.join('\n') + '\n');
            continue;
          }
        } catch {}
      }

      // 새 챕터 생성
      lastChapterUserMsg = lastUserMessage;
      const chapterEntry = JSON.stringify({
        ts: new Date().toTimeString().slice(0, 8),
        epoch: nowEpoch,
        title: chapterTitle,
        thinks: thinkLines,
        response: responseText,
        files,
      });

      try { fs.appendFileSync(CHRIS_LOG_FILE, chapterEntry + '\n'); } catch {}
    } catch {}
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
  const stateEntries: unknown[] = [];
  const allParsed: unknown[] = [];
  for (const line of allLines) {
    try {
      const obj = JSON.parse(line) as any;
      allParsed.push(obj);
      if (STATE_TYPES.has(obj.type)) stateEntries.push(obj);
    } catch {}
  }
  const recentEntries = allParsed.slice(-50);
  // Merge: state events first, then recent (dedup by reference)
  const recentSet = new Set(recentEntries);
  const merged = [...stateEntries.filter(e => !recentSet.has(e)), ...recentEntries];
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
              if (e.speaker === name) recentEvents.unshift(e);
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
      case "/refresh": {
        try {
          // history에서 state 이벤트 + done/assign 보존, 나머지 삭제
          const preserveTypes = new Set(['task-create', 'task-update', 'usage-update', 'done', 'assign']);
          if (fs.existsSync(HISTORY_FILE)) {
            const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
            const lines = raw.trim().split('\n');
            // done 이벤트를 done-archive.jsonl에 반영구 보관
            const doneArchive = path.join(PLUGIN_DIR, 'done-archive.jsonl');
            const doneLines = lines.filter(line => {
              try { return JSON.parse(line).type === 'done'; } catch { return false; }
            });
            if (doneLines.length > 0) {
              fs.appendFileSync(doneArchive, doneLines.join('\n') + '\n');
            }
            // state + done + assign 보존
            const preserved = lines.filter(line => {
              try { return preserveTypes.has(JSON.parse(line).type); } catch { return false; }
            }).join('\n');
            fs.writeFileSync(HISTORY_FILE, preserved ? preserved + '\n' : '');
          }
          if (fs.existsSync(CHRIS_LOG_FILE)) fs.writeFileSync(CHRIS_LOG_FILE, '');
          recordedTextHashes.clear();
          // 즉시 transcript 재스캔 → 현재 유효한 todo/doing task 갱신
          scanTranscriptForAgentWork();
          return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
        } catch {
          return new Response(JSON.stringify({ ok: false }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
        }
      }
      case "/status":
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

    // Find latest Chris work event
    let chrisTool = '';
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const e = JSON.parse(lines[i]);
        if (e.type === 'work' && e.speaker === 'Chris' && e.role === 'boss') {
          const msg = e.msg || '';
          if (msg.includes('📖') || msg.includes('확인 중')) chrisTool = 'Read';
          else if (msg.includes('🔍') || msg.includes('찾는 중')) chrisTool = 'Glob';
          else if (msg.includes('🔎') || msg.includes('검색 중')) chrisTool = 'Grep';
          else if (msg.includes('✏️') || msg.includes('수정 중')) chrisTool = 'Edit';
          else if (msg.includes('📝') || msg.includes('작성 중')) chrisTool = 'Write';
          else if (msg.includes('💻') || msg.includes('실행 중')) chrisTool = 'Bash';
          else chrisTool = 'Read';
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

    const info = TOOL_INFO[chrisTool] || { emoji: '🔧', verb: '작업 중' };
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

// ─── Timers ──────────────────────────────────────────────────────

// Transcript scanner: every 3 seconds
const transcriptScanTimer = setInterval(() => {
  try { scanTranscriptForAgentWork(); } catch {}
}, 3000);

// Idle chat generator: every 20 seconds
const idleChatTimer = setInterval(() => {
  try { generateIdleChat(); } catch {}
}, 20_000);

// [C] Team activation: every 3 seconds
const cTeamTimer = setInterval(() => {
  try { checkAndActivateCTeam(); } catch {}
}, 3000);

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
  clearInterval(cTeamTimer);
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
