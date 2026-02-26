import { homedir } from "os";
import * as path from "path";
import * as fs from "fs";

const PLUGIN_DIR = path.join(homedir(), ".claude/plugins/backstage");
const HISTORY_FILE =
  process.env.BACKSTAGE_HISTORY ||
  path.join(PLUGIN_DIR, "history.jsonl");

const CHARACTERS_FILE = (() => {
  const local = path.join(import.meta.dir, "../hooks/characters.json");
  if (fs.existsSync(local)) return local;
  return path.join(PLUGIN_DIR, "characters.json");
})();

const HTML_FILE = path.join(import.meta.dir, "./index.html");

const PORT = Number(process.env.BACKSTAGE_PORT) || 7777;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ─── Agent name mapping ─────────────────────────────────────────
const AGENT_NAMES: Record<string, string> = {
  'explore': 'Jake', 'explore-medium': 'Jake',
  'oracle': 'David', 'oracle-medium': 'David', 'oracle-low': 'Danny',
  'sisyphus-junior': 'Kevin', 'sisyphus-junior-low': 'Ken', 'sisyphus-junior-high': 'Karl',
  'frontend-engineer': 'Sophie', 'frontend-engineer-low': 'Sophie', 'frontend-engineer-high': 'Sophie',
  'document-writer': 'Emily',
  'librarian': 'Michael', 'librarian-low': 'Michael',
  'prometheus': 'Alex',
  'momus': 'Rachel',
  'metis': 'Tom',
  'multimodal-looker': 'Luna',
  'qa-tester': 'Sam',
};

// Minimal tool info for fallback only (subagents write their own dialogue)
const TOOL_INFO: Record<string, { emoji: string; verb: string }> = {
  'Read': { emoji: '📖', verb: '확인 중' },
  'Glob': { emoji: '🔍', verb: '찾는 중' },
  'Grep': { emoji: '🔎', verb: '검색 중' },
  'Edit': { emoji: '✏️', verb: '수정 중' },
  'Write': { emoji: '📝', verb: '작성 중' },
  'Bash': { emoji: '💻', verb: '실행 중' },
};

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

  // File was truncated/rotated - reset offset
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

// ─── Transcript Scanner (Agent Work Detection) ─────────────────

let transcriptOffset = 0;
let transcriptPath: string | null = null;
let transcriptLastCheck = 0;
const agentTypeMap: Record<string, string> = {};
const recordedToolIds = new Set<string>();
let lastChrisTalkEpoch = 0; // Rate-limit Chris talk (30s)
const recordedTextHashes = new Set<string>(); // Dedup

// Find transcript .jsonl for THIS project only
function findCurrentTranscript(): string | null {
  const projectsDir = path.join(homedir(), ".claude/projects");
  if (!fs.existsSync(projectsDir)) return null;

  // Encode current working directory to match Claude's project dir naming
  const cwd = process.cwd();
  const encodedCwd = cwd.replace(/\//g, "-");

  let newest: { path: string; mtime: number } | null = null;

  try {
    const projectDirs = fs.readdirSync(projectsDir);
    for (const dir of projectDirs) {
      // Only match directories for THIS project
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

  // Re-discover transcript every 10 seconds (handles new sessions)
  if (!transcriptPath || (now - transcriptLastCheck) > 10_000) {
    transcriptLastCheck = now;
    const found = findCurrentTranscript();
    if (found && found !== transcriptPath) {
      transcriptPath = found;
      transcriptOffset = 0; // New transcript, start from beginning
      recordedToolIds.clear();
    }
    if (!transcriptPath) return;
  }

  if (!fs.existsSync(transcriptPath)) return;

  let stat: fs.Stats;
  try { stat = fs.statSync(transcriptPath); } catch { return; }

  // Handle truncation
  if (stat.size < transcriptOffset) transcriptOffset = 0;
  if (stat.size <= transcriptOffset) return;

  // Cap read size at 512KB per scan
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

  // Build/update agentTypeMap from new lines
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

  // Collect new agent tool uses (latest per agent only)
  const latestPerAgent: Map<string, { agentName: string; agentType: string; tool: string; target: string }> = new Map();

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);

      if (entry.type === "progress" && entry.data?.type === "agent_progress") {
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

          // Find agent type
          let agentType = "agent";
          if (entry.parentToolUseID && agentTypeMap[entry.parentToolUseID]) {
            agentType = agentTypeMap[entry.parentToolUseID];
          }

          // Skip dialogue-generator
          if (agentType === "dialogue-generator") continue;

          const toolId = `${agentId}:${toolName}:${shortTarget}`;
          if (recordedToolIds.has(toolId)) continue;
          recordedToolIds.add(toolId);

          const agentName = AGENT_NAMES[agentType] || "Agent";
          // Keep only latest per agent (avoid flooding)
          latestPerAgent.set(agentName, { agentName, agentType, tool: toolName, target: shortTarget });
        }
      }
    } catch {}
  }

  // Write to history
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
      });

      try { fs.appendFileSync(HISTORY_FILE, entry + "\n"); } catch {}
    }
  }

  // ── Chris talk: 짧게 요약, 30초 간격 ─────────────────────────
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

          // Skip noise
          if (text.startsWith("<") || text.startsWith("{") || text.startsWith("```")) continue;
          // Korean only
          if (!/[\uAC00-\uD7AF\u3130-\u318F]/.test(text.slice(0, 200))) continue;

          // Dedup
          const hash = text.slice(0, 80);
          if (recordedTextHashes.has(hash)) continue;
          recordedTextHashes.add(hash);

          // Extract first meaningful Korean line only (짧게!)
          const meaningful = text.split("\n")
            .map(l => l.trim())
            .filter(l => l.length > 8)
            .filter(l => !l.startsWith("|") && !l.startsWith("```") && !l.startsWith("#") && !l.startsWith("- "))
            .filter(l => /[\uAC00-\uD7AF]/.test(l));

          if (meaningful.length === 0) continue;

          // 2줄까지, 총 150자. 뷰어 버블이 expand/collapse 처리
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
          break; // 1개만
        }
        if (lastChrisTalkEpoch === nowEpoch) break; // 이미 기록했으면 끝
      } catch {}
    }
  }

  // Prune text hashes
  if (recordedTextHashes.size > 300) {
    const arr = [...recordedTextHashes];
    recordedTextHashes.clear();
    for (const h of arr.slice(-150)) recordedTextHashes.add(h);
  }

  // Prune recorded IDs to prevent unbounded growth
  if (recordedToolIds.size > 1000) {
    const arr = [...recordedToolIds];
    recordedToolIds.clear();
    for (const id of arr.slice(-500)) recordedToolIds.add(id);
  }

  // Prune agentTypeMap
  const mapKeys = Object.keys(agentTypeMap);
  if (mapKeys.length > 200) {
    for (const k of mapKeys.slice(0, mapKeys.length - 100)) {
      delete agentTypeMap[k];
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

      // Primary: fs.watch with 50ms debounce
      try {
        watcher = fs.watch(HISTORY_FILE, () => {
          if (closed) return;
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(checkForUpdates, 50);
        });
        watcher.on("error", () => cleanup());
      } catch {
        // Watch failed, polling will handle it
      }

      // Fallback: poll every 1 second
      pollTimer = setInterval(checkForUpdates, 1000);

      // Heartbeat every 15 seconds
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

async function handleRoot(): Promise<Response> {
  try {
    const file = Bun.file(HTML_FILE);
    return new Response(file, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

// ─── Server ─────────────────────────────────────────────────────

const server = Bun.serve({
  port: PORT,
  idleTimeout: 255, // Max for Bun — SSE connections need long idle
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
      case "/characters":
        return await handleCharacters();
      default:
        return new Response("Not Found", {
          status: 404,
          headers: CORS_HEADERS,
        });
    }
  },
});

console.log(`Backstage viewer running at http://localhost:${PORT}`);

// ─── Transcript Scanner Timer ───────────────────────────────────
// Scans Claude Code transcript every 3 seconds for subagent tool use
const transcriptScanTimer = setInterval(() => {
  try { scanTranscriptForAgentWork(); } catch {}
}, 3000);

// ─── Shutdown ───────────────────────────────────────────────────

function shutdown(): void {
  console.log("\nShutting down...");
  clearInterval(transcriptScanTimer);
  for (const conn of activeConnections) {
    conn.close();
  }
  activeConnections.clear();
  server.stop(true);
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
