// main.js — Entry point: SSE, keyboard, player character, event dispatch
// v2.1: agent lifecycle, speaker fix, no chat input, no welcome

import { GameEngine } from './engine.js?v=2.5';
import { Character, CharacterManager } from './character.js?v=2.5';
import { BubbleManager } from './bubble.js?v=2.5';
import { Renderer } from './renderer.js?v=2.5';
import { MAP_W, MAP_H, TILE_SIZE, deskPositions, playerSpawn, isPixelWalkable } from './map.js?v=2.5';

// ─── Globals ─────────────────────────────────────────────────────
let engine, characters, bubbles, renderer;
let player = null;
let eventSource = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
let reconnectAttempts = 0;
const MAX_RECONNECT = 5;

// ─── Keyboard state ─────────────────────────────────────────────
const keys = { up: false, down: false, left: false, right: false };
const PLAYER_SPEED = 120;

document.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'ArrowUp':    case 'w': case 'W': keys.up = true; e.preventDefault(); break;
    case 'ArrowDown':  case 's': case 'S': keys.down = true; e.preventDefault(); break;
    case 'ArrowLeft':  case 'a': case 'A': keys.left = true; e.preventDefault(); break;
    case 'ArrowRight': case 'd': case 'D': keys.right = true; e.preventDefault(); break;
  }
});

document.addEventListener('keyup', (e) => {
  switch (e.key) {
    case 'ArrowUp':    case 'w': case 'W': keys.up = false; break;
    case 'ArrowDown':  case 's': case 'S': keys.down = false; break;
    case 'ArrowLeft':  case 'a': case 'A': keys.left = false; break;
    case 'ArrowRight': case 'd': case 'D': keys.right = false; break;
  }
});

// ─── Player character ───────────────────────────────────────────
function createPlayer() {
  const px = playerSpawn.x;
  const py = playerSpawn.y;
  const p = new Character('Player', 'player', px, py);
  p.homeX = px;
  p.homeY = py;
  p.active = true;
  p.dir = 3; // Face UP (toward boss desk)
  return p;
}

function updatePlayer(dt) {
  if (!player) return;

  const dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  const moving = dx !== 0 || dy !== 0;

  player.frameTimer += dt * 1000;
  const animSpeed = moving ? 120 : 500;
  if (player.frameTimer >= animSpeed) {
    player.frameTimer -= animSpeed;
    player.frame = (player.frame + 1) % 4;
  }

  if (!moving) {
    player.state = 'idle';
    return;
  }

  const len = Math.sqrt(dx * dx + dy * dy);
  const mx = (dx / len) * PLAYER_SPEED * dt;
  const my = (dy / len) * PLAYER_SPEED * dt;

  if (Math.abs(dx) > Math.abs(dy)) {
    player.dir = dx > 0 ? 2 : 1;
  } else {
    player.dir = dy > 0 ? 0 : 3;
  }
  player.state = 'walking';

  const nx = player.x + mx;
  const ny = player.y + my;

  if (isPixelWalkable(nx, ny)) {
    player.x = nx;
    player.y = ny;
  } else if (isPixelWalkable(nx, player.y)) {
    player.x = nx;
  } else if (isPixelWalkable(player.x, ny)) {
    player.y = ny;
  }

  player.x = Math.max(TILE_SIZE, Math.min(MAP_W - TILE_SIZE, player.x));
  player.y = Math.max(TILE_SIZE, Math.min(MAP_H - TILE_SIZE, player.y));
}

// ─── Name/role mapping ──────────────────────────────────────────
const ROLE_TO_NAME = {
  'explore': 'Jake', 'explore-medium': 'Jake',
  'oracle': 'David', 'oracle-medium': 'David', 'oracle-low': 'David', 'architect': 'David',
  'sisyphus-junior': 'Kevin', 'sisyphus-junior-low': 'Kevin', 'sisyphus-junior-high': 'Kevin',
  'executor': 'Kevin',
  'frontend-engineer': 'Sophie', 'frontend-engineer-low': 'Sophie', 'frontend-engineer-high': 'Sophie',
  'designer': 'Sophie',
  'document-writer': 'Emily', 'writer': 'Emily',
  'librarian': 'Michael', 'librarian-low': 'Michael',
  'prometheus': 'Alex', 'planner': 'Alex',
  'qa-tester': 'Sam',
  'code-reviewer': 'Ethan', 'quality-reviewer': 'Ethan',
  'critic': 'Rachel', 'momus': 'Rachel',
  'debugger': 'Leo',
  'scientist': 'Daniel', 'analyst': 'Daniel', 'metis': 'Daniel',
  'build-fixer': 'Max', 'code-simplifier': 'Max',
  'test-engineer': 'Tyler', 'verifier': 'Tyler',
  'security-reviewer': 'Ryan',
  'git-master': 'Eric',
  'boss': 'Chris',
};

function resolveCharName(entry) {
  // Try direct speaker name
  if (entry.speaker && characters.get(entry.speaker)) return entry.speaker;
  // Try agent field (character name from dialogue-generator)
  if (entry.agent && characters.get(entry.agent)) return entry.agent;
  // Try role mapping
  if (entry.role) {
    const name = ROLE_TO_NAME[entry.role];
    if (name) return name;
  }
  // Try agent_type field
  if (entry.agent_type) {
    const name = ROLE_TO_NAME[entry.agent_type];
    if (name) return name;
  }
  return entry.speaker || null;
}

// Resolve 'agent' speaker using entry context (agent name, role, agent_type)
function resolveAgentSpeaker(entry) {
  // Try entry.agent field (character name)
  if (entry.agent && characters.get(entry.agent)) return entry.agent;
  // Try entry.agent_type / role
  if (entry.agent_type) {
    const name = ROLE_TO_NAME[entry.agent_type];
    if (name) return name;
  }
  if (entry.role && entry.role !== 'boss' && entry.role !== 'client') {
    const name = ROLE_TO_NAME[entry.role];
    if (name) return name;
  }
  return null;
}

// ─── SSE Event → Game Action ────────────────────────────────────

function handleSSEEvent(entry) {
  const type = entry.type;
  const lines = entry.lines;

  addChatMessage(entry);

  switch (type) {
    case 'assign':     handleAssign(entry, lines); break;
    case 'done':
    case 'complete':   handleDone(entry, lines); break;
    case 'work':       handleWork(entry); break;
    case 'talk':
    case 'update':
    case 'chat':       handleTalk(entry); break;
    case 'idle-chat':  handleIdleChat(entry); break;
    case 'user-input':
    case 'request':    handleUserInput(entry); break;
    default:           handleGeneric(entry); break;
  }
}

function handleAssign(entry, lines) {
  const chris = characters.get('Chris');
  if (!chris) return;

  const agentName = findAgentInLines(lines) || resolveCharName(entry);
  const agent = agentName ? characters.get(agentName) : null;

  if (lines && lines.length > 0) {
    showDialogueLines(lines, 'assign', entry);
  } else if (entry.msg) {
    bubbles.add('Chris', entry.msg, 'assign');
  }

  if (agent) {
    // Agent lifecycle: assign task + run to desk
    agent.assignTask(entry.msg || 'task');
    agent.workAtDesk();
  }
}

function handleDone(entry, lines) {
  const agentName = resolveCharName(entry);
  // Chris never "completes" — skip done events for boss
  if (agentName === 'Chris') return;

  const agent = agentName ? characters.get(agentName) : null;

  if (lines && lines.length > 0) {
    showDialogueLines(lines, 'done', entry);
  } else if (entry.msg) {
    const speaker = agentName || 'Agent';
    bubbles.add(speaker, entry.msg, 'done');
  }

  if (agent) {
    // Agent lifecycle: complete task + walk back to break room
    agent.completeTask();
  }
}

function handleWork(entry) {
  const name = resolveCharName(entry);
  if (!name) return;

  // Chris stays at his desk — don't move him
  if (name === 'Chris') return;

  const char = characters.get(name);
  if (char) {
    const tool = parseToolFromMsg(entry.msg);
    const target = parseTargetFromMsg(entry.msg);

    // If agent is in break room, send them to desk first
    if (char.isInBreakRoom) {
      char.assignTask('working');
    }
    char.workAtDesk(tool, target);
  }

  if (entry.msg) {
    bubbles.add(name, entry.msg, 'work', 2500);
  }
}

function handleTalk(entry) {
  const lines = entry.lines;
  if (lines && lines.length > 0) {
    showDialogueLines(lines, entry.type || 'talk', entry);
  } else if (entry.msg) {
    const name = resolveCharName(entry) || 'Chris';
    bubbles.add(name, entry.msg, entry.type || 'talk');
  }
}

function handleIdleChat(entry) {
  // Show bubble on the agent in break room
  const name = resolveCharName(entry);
  if (name && entry.msg) {
    const char = characters.get(name);
    if (char && char.isInBreakRoom) {
      bubbles.add(name, entry.msg, 'idle-chat', 4000);
    }
  }
}

function handleUserInput(entry) {
  if (player && entry.msg) {
    bubbles.add('Player', entry.msg, 'request', 4000);
  }
}

function handleGeneric(entry) {
  if (entry.msg) {
    const name = resolveCharName(entry) || 'Chris';
    bubbles.add(name, entry.msg, 'talk');
  }
}

function parseToolFromMsg(msg) {
  if (!msg) return 'Read';
  if (msg.includes('📖') || msg.includes('확인')) return 'Read';
  if (msg.includes('🔍') || msg.includes('찾')) return 'Glob';
  if (msg.includes('🔎') || msg.includes('검색')) return 'Grep';
  if (msg.includes('✏️') || msg.includes('수정')) return 'Edit';
  if (msg.includes('📝') || msg.includes('작성')) return 'Write';
  if (msg.includes('💻') || msg.includes('실행')) return 'Bash';
  return 'Read';
}

function parseTargetFromMsg(msg) {
  if (!msg) return '';
  const match = msg.match(/[\w.-]+\.(ts|js|json|py|md|html|css|sh)/);
  return match ? match[0] : '';
}

// Show dialogue lines with staggered timing
// FIXED: properly resolve 'agent' speaker using entry context
function showDialogueLines(lines, type, entry) {
  if (!Array.isArray(lines)) return;
  let delay = 0;
  for (const line of lines) {
    let speaker;
    if (line.speaker === 'boss') {
      speaker = 'Chris';
    } else if (line.speaker === 'client') {
      speaker = 'Player';
    } else if (line.speaker === 'agent') {
      // FIX: resolve agent name from entry context instead of falling back to null
      speaker = resolveAgentSpeaker(entry) || findAgentInLines(lines) || resolveCharName(entry) || 'Chris';
    } else {
      // Direct name or role
      speaker = line.speaker;
      if (!characters.get(speaker)) {
        const mapped = ROLE_TO_NAME[speaker];
        if (mapped) speaker = mapped;
      }
    }

    const charName = characters.get(speaker) ? speaker : (speaker === 'Player' ? 'Player' : 'Chris');

    setTimeout(() => {
      bubbles.add(charName, line.msg, type, Math.max(2500, line.msg.length * 80));
    }, delay);
    delay += 800;
  }
}

function findAgentInLines(lines) {
  if (!Array.isArray(lines)) return null;
  for (const line of lines) {
    if (line.speaker && line.speaker !== 'boss' && line.speaker !== 'client' && line.speaker !== 'agent') {
      const name = ROLE_TO_NAME[line.speaker] || line.speaker;
      if (characters.get(name)) return name;
    }
  }
  return null;
}

// ─── SSE Connection ─────────────────────────────────────────────

function connectSSE() {
  if (eventSource) { eventSource.close(); eventSource = null; }

  renderer.connectionStatus = 'connecting';
  eventSource = new EventSource('/events');

  eventSource.addEventListener('connected', () => {
    renderer.connectionStatus = 'connected';
    updateChatIndicator('connected');
    reconnectDelay = 1000;
    reconnectAttempts = 0;
    loadHistory();
  });

  eventSource.addEventListener('message', (e) => {
    try {
      const data = JSON.parse(e.data);
      handleSSEEvent(data);
    } catch {}
  });

  eventSource.addEventListener('ping', () => {
    renderer.connectionStatus = 'connected';
  });

  eventSource.onerror = () => {
    renderer.connectionStatus = 'disconnected';
    updateChatIndicator('disconnected');
    eventSource.close();
    eventSource = null;
    reconnectAttempts++;

    if (reconnectAttempts >= MAX_RECONNECT) {
      renderer.connectionStatus = 'dead';
      showSessionEndOverlay();
      return;
    }

    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
      connectSSE();
    }, reconnectDelay);
  };
}

// Restore agent desk positions from history (for page refresh)
function restoreAgentStates(entries) {
  const agentStates = new Map();
  for (const entry of entries) {
    const name = resolveCharName(entry);
    if (!name || name === 'Chris') continue;
    if (entry.type === 'assign' || entry.type === 'work') {
      const tool = parseToolFromMsg(entry.msg);
      const target = parseTargetFromMsg(entry.msg);
      const epoch = entry.epoch ? entry.epoch * 1000 : Date.now();

      // Preserve first startTime; only update tool/target on subsequent work events
      if (!agentStates.has(name)) {
        agentStates.set(name, { tool, target, task: entry.msg || 'task', startTime: epoch });
      } else {
        const existing = agentStates.get(name);
        existing.tool = tool;
        existing.target = target;
        existing.task = entry.msg || 'task';
        // Keep original startTime
      }
    } else if (entry.type === 'done' || entry.type === 'complete') {
      agentStates.delete(name);
    }
  }

  const nowMs = Date.now();
  for (const [name, state] of agentStates) {
    const char = characters.get(name);
    if (!char) continue;
    // Skip if last work event is older than 5 minutes
    if (nowMs - state.startTime > 5 * 60 * 1000) continue;
    char.assignTask(state.task, state.startTime);
    char.sitAtDesk(state.tool, state.target);
  }
}

async function loadHistory() {
  try {
    const res = await fetch('/history');
    if (!res.ok) return;
    const entries = await res.json();

    // Restore agent desk positions from full history
    restoreAgentStates(entries);

    // Show recent dialogue/events in chat
    const recent = entries.filter(e => e.type !== 'work').slice(-8);
    for (const entry of recent) {
      handleSSEEvent(entry);
    }
  } catch {}
}

// ─── Chat Log (right panel) ─────────────────────────────────────

const chatMessages = document.getElementById('chat-messages');
const chatIndicator = document.getElementById('chat-indicator');
const MAX_CHAT_MESSAGES = 200;

function addChatMessage(entry) {
  if (!chatMessages) return;

  if (entry.lines && Array.isArray(entry.lines)) {
    for (const line of entry.lines) {
      let speaker;
      if (line.speaker === 'boss') {
        speaker = 'Chris';
      } else if (line.speaker === 'client') {
        speaker = 'You';
      } else if (line.speaker === 'agent') {
        speaker = resolveAgentSpeaker(entry) || resolveCharName(entry) || 'Agent';
      } else {
        speaker = line.speaker || 'Chris';
      }
      appendChatLine(speaker, line.msg, entry.type, entry.ts, entry);
    }
    return;
  }

  if (entry.msg) {
    const speaker = entry.type === 'user-input' ? 'You' :
                    (resolveCharName(entry) || entry.speaker || 'System');
    appendChatLine(speaker, entry.msg, entry.type, entry.ts, entry);
  }
}

function appendChatLine(speaker, text, type, ts, entry) {
  if (!chatMessages || !text) return;

  const div = document.createElement('div');
  div.className = `chat-msg type-${type || 'talk'}`;
  const timeStr = ts || new Date().toTimeString().slice(0, 5);

  div.innerHTML =
    `<span class="time">${timeStr.slice(0, 5)}</span>` +
    `<span class="speaker speaker-${speaker}">${speaker}</span> ` +
    `<span class="text">${escapeHtml(text)}</span>`;

  if (entry && entry.detail) {
    div.classList.add('has-detail');
    const detailDiv = document.createElement('div');
    detailDiv.className = 'chat-detail';
    detailDiv.textContent = entry.detail;
    div.appendChild(detailDiv);
    div.addEventListener('click', () => div.classList.toggle('expanded'));
  }

  chatMessages.appendChild(div);

  while (chatMessages.children.length > MAX_CHAT_MESSAGES) {
    chatMessages.removeChild(chatMessages.firstChild);
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function updateChatIndicator(status) {
  if (chatIndicator) {
    chatIndicator.classList.toggle('live', status === 'connected');
  }
}

// ─── Init ───────────────────────────────────────────────────────

function init() {
  const canvas = document.getElementById('game');
  if (!canvas) return;

  engine = new GameEngine(canvas, MAP_W, MAP_H);
  characters = new CharacterManager();
  bubbles = new BubbleManager();
  renderer = new Renderer(canvas);
  player = createPlayer();

  engine.onUpdate((dt) => {
    characters.update(dt);
    updatePlayer(dt);
    bubbles.update(dt);
  });

  engine.onRender((ctx) => {
    renderer.render(ctx, characters, bubbles, player);
  });

  engine.start();
  connectSSE();
}

// ─── Session End Overlay ─────────────────────────────────────────

function showSessionEndOverlay() {
  if (document.getElementById('session-end-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'session-end-overlay';
  overlay.innerHTML = `
    <div class="session-end-box">
      <div class="session-end-icon">⚡</div>
      <div class="session-end-title">세션이 종료되었습니다</div>
      <div class="session-end-desc">서버와의 연결이 끊어졌습니다</div>
    </div>`;
  document.getElementById('game-container').appendChild(overlay);
}

// Wait for fonts then init
if (document.fonts) {
  document.fonts.ready.then(init);
} else {
  window.addEventListener('load', init);
}
