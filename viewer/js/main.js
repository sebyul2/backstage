// main.js — Entry point: SSE, keyboard, player character, event dispatch
// v2.1: agent lifecycle, speaker fix, no chat input, no welcome

import { GameEngine } from './engine.js?v=2.7';
import { Character, CharacterManager } from './character.js?v=2.7';
import { BubbleManager } from './bubble.js?v=2.7';
import { Renderer } from './renderer.js?v=2.7';
import { ParticleManager } from './particles.js?v=2.7';
import { MAP_W, MAP_H, TILE_SIZE, MAP_COLS, MAP_ROWS, deskPositions, playerSpawn, isPixelWalkable, groundMap, furniture } from './map.js?v=2.7';
import { PhysicsWorld } from './physics.js?v=2.7';

// ─── i18n ────────────────────────────────────────────────────────
window.i18n = {};
fetch('/i18n').then(r => r.json()).then(data => { window.i18n = data; }).catch(() => {});

// ─── Globals ─────────────────────────────────────────────────────
let engine, characters, bubbles, renderer, particles, physics;
let player = null;
let eventSource = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
let reconnectAttempts = 0;
const RECONNECT_MAX_DELAY = 60000; // 1분 상한 (무한 백오프)

// ─── Dashboard State ─────────────────────────────────────────────────────────
const dashboardState = {
  tasks: [],        // { id, subject, status, description }
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    contextWindow: 0,
  },
};

// ─── Keyboard state ─────────────────────────────────────────────
const keys = { up: false, down: false, left: false, right: false };
const PLAYER_SPEED = 180; // 1.5x speed

let spaceJustPressed = false;
let lastWhipTime = 0;

document.addEventListener('keydown', (e) => {
  // F6: Shift+D 로 디버그 HUD 토글
  if (e.shiftKey && (e.key === 'D' || e.key === 'd')) {
    toggleDebugHUD();
    e.preventDefault();
    return;
  }
  switch (e.key) {
    case 'ArrowUp':    case 'w': case 'W': keys.up = true; e.preventDefault(); break;
    case 'ArrowDown':  case 's': case 'S': keys.down = true; e.preventDefault(); break;
    case 'ArrowLeft':  case 'a': case 'A': keys.left = true; e.preventDefault(); break;
    case 'ArrowRight': case 'd': case 'D': keys.right = true; e.preventDefault(); break;
    case ' ': if (!e.repeat) spaceJustPressed = true; e.preventDefault(); break;
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
  p.dir = 0; // Face DOWN (overseeing office)
  return p;
}

function updatePlayer(dt) {
  if (!player) return;

  const dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  const moving = dx !== 0 || dy !== 0;

  // Sync position from physics
  if (physics && physics.enabled) {
    const pos = physics.getPosition('Player');
    if (pos) { player.x = pos.x; player.y = pos.y; }
  }

  player.frameTimer += dt * 1000;
  const animSpeed = moving ? 120 : 500;
  if (player.frameTimer >= animSpeed) {
    player.frameTimer -= animSpeed;
    player.frame = (player.frame + 1) % 4;
  }

  if (!moving) {
    player.state = 'idle';
    if (physics && physics.enabled) physics.setVelocity('Player', 0, 0);
    return;
  }

  if (Math.abs(dx) > Math.abs(dy)) {
    player.dir = dx > 0 ? 2 : 1;
  } else {
    player.dir = dy > 0 ? 0 : 3;
  }
  player.state = 'walking';

  const len = Math.sqrt(dx * dx + dy * dy);

  if (physics && physics.enabled) {
    // Physics-based movement: set velocity, let engine handle collision
    const v = PLAYER_SPEED / 60;
    physics.setVelocity('Player', (dx / len) * v, (dy / len) * v);
  } else {
    // Fallback: grid-based collision
    const mx = (dx / len) * PLAYER_SPEED * dt;
    const my = (dy / len) * PLAYER_SPEED * dt;
    const nx = player.x + mx;
    const ny = player.y + my;
    if (isPixelWalkable(nx, ny)) {
      player.x = nx; player.y = ny;
    } else if (isPixelWalkable(nx, player.y)) {
      player.x = nx;
    } else if (isPixelWalkable(player.x, ny)) {
      player.y = ny;
    }
  }

  player.x = Math.max(TILE_SIZE, Math.min(MAP_W - TILE_SIZE, player.x));
  player.y = Math.max(TILE_SIZE, Math.min(MAP_H - TILE_SIZE, player.y));
}

// ─── 채찍질 (Whip) ──────────────────────────────────────────────

// WHIP_REACTIONS: loaded from i18n (window.i18n.whip_reactions)

function handleWhip() {
  if (!spaceJustPressed) return;
  spaceJustPressed = false;

  const now = Date.now();
  if (now - lastWhipTime < 800) return; // cooldown
  lastWhipTime = now;

  if (!player || !characters) return;

  // Find nearest idle agent within 3 tiles
  const range = TILE_SIZE * 3;
  let nearest = null;
  let nearestDist = Infinity;

  // Target any non-working agent (not just idle in break room)
  const whippable = [...characters.characters.values()].filter(c =>
    c.name !== 'Chris' && c.name !== 'Player' && !c._isCTeam &&
    c.state !== 'working' && c.state !== 'running_to_desk' && c.stunTimer <= 0
  );
  for (const char of whippable) {
    const dx = char.x - player.x;
    const dy = char.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < range && dist < nearestDist) {
      nearest = char;
      nearestDist = dist;
    }
  }

  if (nearest) {
    // Whip hit! Visual: whip trail from hand + impact
    if (particles) {
      const hx = player.dir === 2 ? 14 : player.dir === 1 ? -14 : 0;
      const hy = player.dir === 3 ? -8 : 8;
      particles.spawnWhip(player.x + hx, player.y + hy, nearest.x, nearest.y);
      particles.spawn(nearest.x, nearest.y - 20, '💥');
    }
    const reactions = window.i18n?.whip_reactions || ['Ah! Right away!'];
    const reaction = reactions[Math.floor(Math.random() * reactions.length)];
    bubbles.add(nearest.name, reaction, 'talk', 2000);

    // Physics knockback: strong push toward wall
    const kdx = nearest.x - player.x;
    const kdy = nearest.y - player.y;
    const kDist = Math.sqrt(kdx * kdx + kdy * kdy) || 1;
    if (physics && physics.enabled) {
      physics.setVelocity(nearest.name, (kdx / kDist) * 25, (kdy / kDist) * 25);
    }
    nearest.stunTimer = 600;

    const agent = nearest;
    setTimeout(() => {
      agent.stunTimer = 0;
      if (physics && physics.enabled) {
        physics.setVelocity(agent.name, 0, 0);
      }
      // Return to original position (break room spot)
      agent.walkTo(agent.breakX, agent.breakY);
    }, 600);
  } else {
    // Whip miss: swing animation in facing direction
    if (particles) {
      particles.spawnWhipMiss(player.x, player.y, player.dir);
    }
  }
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
  'boss': 'Chris',
  // [C] Team
  'c-read': 'Mia', 'c-edit': 'Kai', 'c-grep': 'Zoe',
  'c-glob': 'Liam', 'c-write': 'Aria', 'c-bash': 'Noah',
  'c-task': 'Luna', 'c-other': 'Owen',
};

// Strip plugin namespace from role strings (e.g. "oh-my-claudecode:executor" → "executor")
function stripNamespace(key) {
  if (typeof key !== 'string') return key;
  const idx = key.indexOf(':');
  return idx >= 0 ? key.slice(idx + 1) : key;
}

function lookupRoleName(key) {
  if (!key) return null;
  return ROLE_TO_NAME[key] || ROLE_TO_NAME[stripNamespace(key)] || null;
}

function resolveCharName(entry) {
  // Try direct speaker name
  if (entry.speaker && characters.get(entry.speaker)) return entry.speaker;
  // Try agent field (character name from dialogue-generator)
  if (entry.agent && characters.get(entry.agent)) return entry.agent;
  // Try role mapping (with namespace fallback)
  const byRole = lookupRoleName(entry.role);
  if (byRole) return byRole;
  // Try agent_type field (with namespace fallback)
  const byType = lookupRoleName(entry.agent_type);
  if (byType) return byType;
  return entry.speaker || null;
}

// Resolve 'agent' speaker using entry context (agent name, role, agent_type)
function resolveAgentSpeaker(entry) {
  if (entry.agent && characters.get(entry.agent)) return entry.agent;
  const byType = lookupRoleName(entry.agent_type);
  if (byType) return byType;
  if (entry.role && entry.role !== 'boss' && entry.role !== 'client') {
    const byRole = lookupRoleName(entry.role);
    if (byRole) return byRole;
  }
  return null;
}

// ─── SSE Event → Game Action ────────────────────────────────────

// Dedup: skip identical speaker+msg+type within 5 seconds
const _recentEvents = new Map();

function _isDuplicate(entry) {
  if (!entry.msg) return false;
  const key = `${entry.speaker || ''}:${entry.type || ''}:${entry.msg || ''}`;
  const now = Date.now();
  const last = _recentEvents.get(key);
  if (last && (now - last) < 5000) return true;
  _recentEvents.set(key, now);
  // Prune old entries
  if (_recentEvents.size > 200) {
    for (const [k, v] of _recentEvents) {
      if (now - v > 10000) _recentEvents.delete(k);
    }
  }
  return false;
}

function handleSSEEvent(entry) {
  const type = entry.type;
  const lines = entry.lines;

  // Skip duplicate events (hook + transcript scanner can both write same event)
  if (_isDuplicate(entry)) return;

  // 정보성/내부 이벤트는 CHAT 뷰에서 필터 (캔버스에만 표시)
  const chatHidden = new Set(['think', 'work', 'work-done', 'c-active', 'c-idle', 'agent-status']);
  // task-notification XML이나 system-reminder가 포함된 메시지 처리
  const msgText = entry.msg || '';
  if (msgText.includes('<task-notification') || msgText.includes('<system-reminder')) {
    // request/user-input은 XML strip 후 표시, 나머지는 필터
    if (type === 'request' || type === 'user-input') {
      const cleaned = msgText.replace(/<(task-notification|system-reminder)>[\s\S]*?<\/(task-notification|system-reminder)>/g, '').trim();
      if (cleaned) {
        addChatMessage({ ...entry, msg: cleaned });
      }
    }
  } else if (!chatHidden.has(type)) {
    addChatMessage(entry);
  }

  switch (type) {
    case 'assign':     handleAssign(entry, lines); break;
    case 'done':
    case 'complete':   handleDone(entry, lines); break;
    case 'work':       handleWork(entry); break;
    case 'talk':
    case 'update':
    case 'chat':       handleTalk(entry); break;
    case 'idle-chat':  handleIdleChat(entry); break;
    case 'think':      handleThink(entry); break;
    case 'c-active':   handleCTeamActive(entry); break;
    case 'c-idle':     handleCTeamIdle(entry); break;
    case 'c-bubble':   handleCTeamBubble(entry); break;
    case 'work-done':  handleWorkDone(entry); break;
    case 'agent-status': handleAgentStatus(entry); break;
    case 'user-input':
    case 'request':    handleUserInput(entry); break;
    case 'task-create':  handleTaskCreate(entry); break;
    case 'task-update':  handleTaskUpdate(entry); break;
    case 'tasks-reset':  handleTasksReset(); break;
    case 'session-end':  handleSessionEnd(); break;
    case 'usage-update': handleUsageUpdate(entry); break;
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
    const speaker = agentName || resolveCharName(entry) || 'Chris';
    bubbles.add(speaker, entry.msg, 'assign');
  }

  if (agent) {
    // Agent lifecycle: assign task, speak first, then run to desk
    agent.assignTask(entry.msg || 'task');
    // 대사가 있으면 끝난 후 이동, 없으면 즉시
    const hasDialogue = (lines && lines.length > 0) || entry.msg;
    if (hasDialogue) {
      const lineCount = (lines && lines.length > 0) ? lines.length : 1;
      const delay = lineCount * 3000; // 라인당 ~3초
      setTimeout(() => agent.workAtDesk(), delay);
    } else {
      agent.workAtDesk();
    }
  }
}

function handleDone(entry, lines) {
  const agentName = resolveCharName(entry);
  // Chris never "completes" — skip done events for boss
  if (agentName === 'Chris') return;

  const agent = agentName ? characters.get(agentName) : null;

  // AI 대화 OFF(fallback)인 경우에만 완료 대사 표시
  // AI 생성 done은 lines가 있고, fallback은 msg만 있음
  if (!lines && entry.msg) {
    const speaker = agentName || 'Agent';
    bubbles.add(speaker, entry.msg, 'done');
  }

  if (agent) {
    agent.completeTask();
  }
}

// Tool → emoji for particles
const TOOL_EMOJIS = {
  'Read': '📖', 'Glob': '🔍', 'Grep': '🔎',
  'Edit': '✏️', 'Write': '📝', 'Bash': '💻', 'Task': '📋',
};

function handleWork(entry) {
  const name = resolveCharName(entry);
  if (!name) return;

  // Chris: spawn particle at desk, don't move him
  if (name === 'Chris') {
    if (particles) {
      const chris = characters.get('Chris');
      if (chris) {
        const tool = parseToolFromMsg(entry.msg);
        const emoji = TOOL_EMOJIS[tool] || '⚡';
        particles.spawn(chris.x, chris.y - 20, emoji);
      }
    }
    return;
  }

  const char = characters.get(name);
  if (char) {
    const tool = parseToolFromMsg(entry.msg);
    const target = parseTargetFromMsg(entry.msg);

    // B1d: 이미 WORKING 중이면 재할당 대신 도구/타겟만 갱신
    // (기존: 매 work 이벤트마다 workAtDesk 재호출 → stateTimer/workTimer 리셋)
    if (char.state === 'working') {
      char.workTool = tool || char.workTool;
      char.workTarget = target || char.workTarget;
    } else {
      if (char.isInBreakRoom) {
        char.assignTask('working');
      }
      char.workAtDesk(tool, target);
    }
  }

  if (entry.msg) {
    bubbles.add(name, entry.msg, 'work', 2500);
  }
}

// F6: Debug HUD (Shift+D 토글) — 실시간 게임 상태 오버레이
let debugHudEl = null;
let debugHudTimer = null;
function toggleDebugHUD() {
  if (debugHudEl) {
    debugHudEl.remove();
    debugHudEl = null;
    if (debugHudTimer) { clearInterval(debugHudTimer); debugHudTimer = null; }
    return;
  }
  const el = document.createElement('div');
  el.style.cssText = `
    position: fixed; top: 8px; right: 8px; z-index: 9999;
    background: rgba(13, 17, 23, 0.92); color: #00E436;
    font: 11px "Menlo", "Consolas", monospace;
    padding: 8px 10px; border: 1px solid #29ADFF; border-radius: 4px;
    min-width: 200px; line-height: 1.5;
    pointer-events: none; white-space: pre;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  `;
  document.body.appendChild(el);
  debugHudEl = el;

  // FPS sampling
  let fpsFrames = 0, fpsLastT = performance.now(), fpsValue = 0;
  const fpsTick = () => {
    fpsFrames++;
    const now = performance.now();
    if (now - fpsLastT >= 500) {
      fpsValue = Math.round((fpsFrames * 1000) / (now - fpsLastT));
      fpsFrames = 0; fpsLastT = now;
    }
    if (debugHudEl) requestAnimationFrame(fpsTick);
  };
  requestAnimationFrame(fpsTick);

  debugHudTimer = setInterval(() => {
    if (!debugHudEl) return;
    const chars = characters ? [...characters.values()] : [];
    const working = chars.filter(c => c.state === 'working').length;
    const idleBreak = chars.filter(c => c.state === 'idle_break').length;
    const offscreen = chars.filter(c => c._offscreen).length;
    const bubbleActive = bubbles?.active?.size || 0;
    let bubbleQueued = 0;
    if (bubbles?.queues) for (const q of bubbles.queues.values()) bubbleQueued += q.length;
    const sseStatus = renderer?.connectionStatus || '?';
    const tasksTotal = dashboardState.tasks.length;
    const ctxPct = dashboardState.usage.maxContext
      ? Math.round((dashboardState.usage.lastTurnContext / dashboardState.usage.maxContext) * 100)
      : 0;

    el.textContent =
      `━━━ BACKSTAGE DEBUG ━━━\n` +
      `FPS       : ${fpsValue}\n` +
      `SSE       : ${sseStatus}\n` +
      `Chars     : ${chars.length}  (work:${working}  brk:${idleBreak}  off:${offscreen})\n` +
      `Bubbles   : ${bubbleActive} active / ${bubbleQueued} queued\n` +
      `Tasks     : ${tasksTotal}\n` +
      `Context   : ${ctxPct}%  (${Math.round(dashboardState.usage.lastTurnContext / 1000)}k / ${Math.round(dashboardState.usage.maxContext / 1000)}k)\n` +
      `Reconnect : ${reconnectAttempts} (delay ${Math.round(reconnectDelay)}ms)\n` +
      `[Shift+D] to hide`;
  }, 250);
}

// B1c/C4: session-end 이벤트에서 잔존 에이전트 일괄 퇴근
function handleSessionEnd() {
  if (!characters) return;
  characters.forEach((char) => {
    if (char.role === 'boss' || char._isCTeam) return;
    if (char.state !== 'idle_break') {
      char.completeTask();
    }
  });
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

function handleThink(entry) {
  // thinking 상태 표시 + 말풍선
  const chris = characters.get('Chris');
  if (chris) {
    chris._isThinking = true;
    clearTimeout(chris._thinkTimer);
    chris._thinkTimer = setTimeout(() => { chris._isThinking = false; }, 8000);
  }
  // 기존 talk 처리도 실행
  handleTalk(entry);
}

function handleAgentStatus(entry) {
  // 크리스가 에이전트 진행 상태 보고 (말풍선 + 채팅)
  handleTalk(entry);
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

function handleCTeamActive(entry) {
  const name = entry.speaker;
  if (!name) return;
  const char = characters.get(name);
  if (!char || !char._isCTeam) return;

  const tool = entry.tool || 'Read';
  const duration = entry.duration || 8000;
  char.activateTool(tool, duration);
}

function handleCTeamBubble(entry) {
  const name = entry.speaker;
  if (!name || !entry.msg) return;
  const char = characters.get(name);
  if (char) {
    bubbles.add(name, entry.msg, 'work', 4000);
  }
}

function handleWorkDone(entry) {
  const name = resolveCharName(entry);
  if (!name || !entry.msg) return;
  const char = characters.get(name);
  if (char && char._isCTeam) {
    // C-Team: activate tool briefly + show bubble
    const toolMap = { 'c-read': 'Read', 'c-edit': 'Edit', 'c-grep': 'Grep', 'c-glob': 'Glob', 'c-write': 'Write', 'c-bash': 'Bash' };
    const tool = toolMap[char.role] || 'Read';
    char.activateTool(tool, 5000);
    bubbles.add(name, entry.msg, 'work', 3000);
  } else if (char) {
    bubbles.add(name, entry.msg, 'work', 3000);
  }
}

function handleCTeamIdle(entry) {
  const name = entry.speaker;
  if (!name) return;
  const char = characters.get(name);
  if (char && char._isCTeam) {
    char.deactivateTool();
  }
}

function handleGeneric(entry) {
  if (entry.msg) {
    const name = resolveCharName(entry) || 'Chris';
    bubbles.add(name, entry.msg, 'talk');
  }
}

function handleTaskCreate(entry) {
  if (!entry.data) return;
  const task = {
    id: entry.data.id || String(dashboardState.tasks.length + 1),
    subject: entry.data.subject || 'Task',
    status: entry.data.status || 'pending',
    description: entry.data.description || '',
  };
  // 중복 방지
  const existing = dashboardState.tasks.find(t => t.subject === task.subject);
  if (!existing) {
    dashboardState.tasks.push(task);
  }
}

function handleTaskUpdate(entry) {
  if (!entry.data) return;
  const { id, status, subject } = entry.data;

  // ID로 찾기
  let task = dashboardState.tasks.find(t => t.id === id);

  // subject로도 찾기 (ID가 없을 때)
  if (!task && subject) {
    task = dashboardState.tasks.find(t => t.subject === subject);
  }

  if (task && status) {
    // deleted 요청: completed 태스크는 유지, pending/in_progress만 제거
    if (status === 'deleted') {
      if (task.status !== 'completed') {
        dashboardState.tasks = dashboardState.tasks.filter(t => t !== task);
      }
      return;
    }
    task.status = status;
  }
}

function handleTasksReset() {
  // 새 세션 시작: pending/in_progress task만 제거, completed는 유지
  dashboardState.tasks = dashboardState.tasks.filter(t => t.status === 'completed');
}

function handleUsageUpdate(entry) {
  if (!entry.data) return;
  dashboardState.usage = {
    inputTokens: entry.data.inputTokens || 0,
    outputTokens: entry.data.outputTokens || 0,
    cacheReadTokens: entry.data.cacheReadTokens || 0,
    contextWindow: entry.data.contextWindow || 0,
    lastTurnContext: entry.data.lastTurnContext || 0,
    maxContext: entry.data.maxContext || 200000,
    fiveHourPercent: entry.data.fiveHourPercent ?? null,
    sevenDayPercent: entry.data.sevenDayPercent ?? null,
  };
}

function parseToolFromMsg(msg) {
  if (!msg) return 'Read';
  const hints = window.i18n?.tool_verb_parse_hints || {
    Read: ['📖', 'check'], Glob: ['🔍', 'find'], Grep: ['🔎', 'search'],
    Edit: ['✏️', 'edit'], Write: ['📝', 'writ'], Bash: ['💻', 'run'],
  };
  for (const [tool, keywords] of Object.entries(hints)) {
    for (const kw of keywords) {
      if (msg.includes(kw)) return tool;
    }
  }
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
  window._sseSource = eventSource;

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
    if (eventSource) { eventSource.close(); eventSource = null; }
    reconnectAttempts++;

    // B2: 5회 제한 제거, 무한 지수 백오프(max 60s). 탭이 활성화되어있을 때만 재연결 시도.
    clearTimeout(reconnectTimer);
    const delay = Math.min(reconnectDelay, RECONNECT_MAX_DELAY);
    reconnectDelay = Math.min(reconnectDelay * 1.5, RECONNECT_MAX_DELAY);
    reconnectTimer = setTimeout(() => {
      if (document.visibilityState === 'visible') {
        connectSSE();
      }
      // visibility 가 hidden 이면 visibilitychange 리스너가 재연결
    }, delay);
  };
}

// B2: 탭 복귀 시 즉시 재연결 시도
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (eventSource) return;
  clearTimeout(reconnectTimer);
  reconnectDelay = 1000;
  connectSSE();
});

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
  let entries;
  try {
    const res = await fetch('/history');
    if (!res.ok) return;
    entries = await res.json();
  } catch { return; }

  // Restore agent desk positions (isolated try-catch)
  try { restoreAgentStates(entries); } catch (e) { console.warn('restoreAgentStates error:', e); }

  // Restore dashboard state from history
  for (const entry of entries) {
    try {
      if (entry.type === 'task-create') handleTaskCreate(entry);
      else if (entry.type === 'task-update') handleTaskUpdate(entry);
      else if (entry.type === 'tasks-reset') handleTasksReset();
      else if (entry.type === 'usage-update') handleUsageUpdate(entry);
    } catch {}
  }

  // Show recent dialogue/events in chat
  try {
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

  // 사용자 요청이 길면 말줄임표 (상세는 Chris 작업노트에서 확인)
  let displayText = text;
  if (type === 'request' && text.length > 80) {
    displayText = text.slice(0, 80) + '…';
  }

  div.innerHTML =
    `<span class="time">${timeStr.slice(0, 5)}</span>` +
    `<span class="speaker speaker-${speaker}">${speaker}</span> ` +
    `<span class="text">${escapeHtml(displayText)}</span>`;

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
  particles = new ParticleManager();
  physics = new PhysicsWorld();
  physics.createStaticBodies(groundMap, furniture, TILE_SIZE, MAP_COLS, MAP_ROWS);
  characters.initPhysics(physics);
  player = createPlayer();
  physics.addCharacter('Player', player.x, player.y, { radius: 12 });

  // Wall collision effects: 쿵 bounce + particles
  physics.onWallHit((name, x, y, speed) => {
    if (name === 'Player') return;
    if (particles) {
      particles.spawn(x, y - 15, '💫');
      if (speed > 8) particles.spawn(x, y - 10, '😵');
    }
    const char = characters.get(name);
    if (char && speed > 5) {
      const msgs = window.i18n?.wall_collisions || ['Ouch!'];
      bubbles.add(name, msgs[Math.floor(Math.random() * msgs.length)], 'talk', 1500);
    }
  });

  engine.onUpdate((dt) => {
    physics.update(dt);
    characters.update(dt);
    updatePlayer(dt);
    handleWhip();
    bubbles.update(dt);
    particles.update(dt);
  });

  engine.onRender((ctx) => {
    renderer.setDashboardData(dashboardState);
    renderer.render(ctx, characters, bubbles, player);
    particles.render(ctx);
  });

  // ─── 대시보드 wheel 스크롤 ───────────────────────────────────
  // 대시보드 영역: dashboardBoard furniture x:1,y:1,w:11,h:4 → px: 48,48,528,192
  const DASH_PX = { x: 48, y: 48, w: 528, h: 192 };

  canvas.addEventListener('wheel', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = MAP_W / rect.width;
    const scaleY = MAP_H / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    if (mx >= DASH_PX.x && mx <= DASH_PX.x + DASH_PX.w &&
        my >= DASH_PX.y && my <= DASH_PX.y + DASH_PX.h) {
      e.preventDefault();
      if (!renderer._dashboardScrollYs) renderer._dashboardScrollYs = [0, 0, 0];
      // 칼럼별 독립 스크롤: 마우스 x 위치로 칼럼 판별
      const cols = renderer._dashboardCols;
      if (cols) {
        const colIdx = Math.min(2, Math.max(0, Math.floor((mx - cols.kanbanX) / cols.colW)));
        renderer._dashboardScrollYs[colIdx] = Math.max(0, renderer._dashboardScrollYs[colIdx] + e.deltaY * 0.3);
      }
    }
  }, { passive: false });

  // ─── 마우스 호버 → 태스크 하이라이트 ────────────────────────────
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = MAP_W / rect.width;
    const scaleY = MAP_H / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    renderer._hoverMouse = { x: mx, y: my };

    // 커서 변경
    let onClickable = false;
    // Chris 캐릭터
    const chris = characters.get('Chris');
    if (chris && mx >= chris.x - 20 && mx <= chris.x + 20 && my >= chris.y - 32 && my <= chris.y + 8) {
      onClickable = true;
    }
    // paperStack (plan note)
    if (!onClickable) {
      for (const f of furniture) {
        if (f.type !== 'paperStack') continue;
        const fx = f.x * TILE_SIZE, fy = f.y * TILE_SIZE;
        const fw = f.w * TILE_SIZE, fh = f.h * TILE_SIZE;
        if (mx >= fx && mx <= fx + fw && my >= fy && my <= fy + fh) {
          onClickable = true;
          break;
        }
      }
    }
    // Task hitboxes
    if (!onClickable && renderer._taskHitboxes) {
      for (const hb of renderer._taskHitboxes) {
        if (mx >= hb.x && mx <= hb.x + hb.w && my >= hb.y && my <= hb.y + hb.h) {
          onClickable = true;
          break;
        }
      }
    }
    canvas.style.cursor = onClickable ? 'pointer' : 'default';
  });
  canvas.addEventListener('mouseleave', () => {
    renderer._hoverMouse = null;
    canvas.style.cursor = 'default';
  });

  // ─── 태스크 클릭 → 팝업 ─────────────────────────────────────
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = MAP_W / rect.width;
    const scaleY = MAP_H / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    // Clear 버튼 클릭
    if (renderer._clearBtnHitbox) {
      const cb = renderer._clearBtnHitbox;
      if (mx >= cb.x && mx < cb.x + cb.w && my >= cb.y && my < cb.y + cb.h) {
        (async () => {
          try {
            await fetch('/refresh');
            dashboardState.tasks = [];
            dashboardState.usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, contextWindow: 0, lastTurnContext: 0 };
            if (eventSource) { eventSource.close(); eventSource = null; }
            setTimeout(() => connectSSE(), 500);
          } catch {}
        })();
        return;
      }
    }

    // paperStack 클릭 감지 (크리스 체크보다 먼저)
    for (const f of furniture) {
      if (f.type !== 'paperStack') continue;
      const fx = f.x * TILE_SIZE, fy = f.y * TILE_SIZE;
      const fw = f.w * TILE_SIZE, fh = f.h * TILE_SIZE;
      if (mx >= fx && mx <= fx + fw && my >= fy && my <= fy + fh) {
        showPlanListPopup(e.clientX, e.clientY);
        return;
      }
    }

    // 크리스 클릭 체크 (태스크 히트박스보다 먼저)
    const chris = characters.get('Chris');
    if (chris) {
      const cx = chris.x, cy = chris.y;
      if (mx >= cx - 20 && mx <= cx + 20 && my >= cy - 32 && my <= cy + 8) {
        showChrisLogPopup();
        return;
      }
    }

    // 서브에이전트 캐릭터 클릭 감지 (48x48 hitbox)
    for (const char of characters.characters.values()) {
      if (!char || char.name === 'Chris' || char.name === 'Player') continue;
      const cx = char.x, cy = char.y;
      if (mx >= cx - 16 && mx <= cx + 32 && my >= cy - 32 && my <= cy + 16) {
        if (char._isCTeam) {
          showCTeamLogPopup(char.name, e.clientX, e.clientY);
        } else {
          showAgentInfoPopup(char.name, e.clientX, e.clientY);
        }
        return;
      }
    }

    if (!renderer._taskHitboxes) return;
    for (const hb of renderer._taskHitboxes) {
      if (mx >= hb.x && mx <= hb.x + hb.w && my >= hb.y && my <= hb.y + hb.h) {
        showTaskPopup(hb.task, e.clientX, e.clientY);
        break;
      }
    }
  });


  engine.start();
  connectSSE();
}

// ─── 플랜 리스트 팝업 (2-panel) ────────────────────────────────────

function renderMarkdownContent(container, mdText) {
  if (window.marked) {
    container.innerHTML = window.marked.parse(mdText);
    container.querySelectorAll('code').forEach(el => {
      Object.assign(el.style, { background: '#0D1B2A', padding: '1px 4px', borderRadius: '3px', fontSize: '10px', color: '#29ADFF' });
    });
    container.querySelectorAll('h1,h2,h3,h4').forEach(el => {
      Object.assign(el.style, { color: '#FF77A8', fontSize: '12px', margin: '8px 0 4px' });
    });
    container.querySelectorAll('li').forEach(el => {
      Object.assign(el.style, { color: '#C2C3C7', fontSize: '11px', marginLeft: '12px' });
    });
    container.querySelectorAll('pre').forEach(el => {
      Object.assign(el.style, { background: '#0D1B2A', padding: '8px', borderRadius: '4px', overflow: 'auto', fontSize: '10px' });
    });
    container.querySelectorAll('p').forEach(el => {
      Object.assign(el.style, { margin: '4px 0', color: '#C2C3C7' });
    });
    container.querySelectorAll('table').forEach(el => {
      Object.assign(el.style, { borderCollapse: 'collapse', width: '100%', fontSize: '10px', margin: '8px 0' });
    });
    container.querySelectorAll('th,td').forEach(el => {
      Object.assign(el.style, { border: '1px solid #374151', padding: '4px 8px', color: '#C2C3C7', textAlign: 'left' });
    });
    container.querySelectorAll('th').forEach(el => {
      Object.assign(el.style, { background: '#1A2744', color: '#FF77A8' });
    });
    container.querySelectorAll('a').forEach(el => {
      Object.assign(el.style, { color: '#29ADFF' });
    });
    container.querySelectorAll('blockquote').forEach(el => {
      Object.assign(el.style, { borderLeft: '3px solid #FF77A8', paddingLeft: '8px', margin: '8px 0', color: '#9CA3AF' });
    });
  } else {
    container.textContent = mdText;
  }
}

async function showPlanListPopup(clientX, clientY) {
  document.querySelectorAll('.plan-list-overlay').forEach(el => el.remove());

  const overlay = document.createElement('div');
  overlay.className = 'plan-list-overlay';
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.5)',
    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: '10000',
  });

  // 메인 패널 (2-column)
  const panel = document.createElement('div');
  Object.assign(panel.style, {
    width: '860px', maxWidth: '90vw', height: '520px', maxHeight: '80vh',
    background: '#1D2B53', border: '3px solid #FF77A8', borderRadius: '8px',
    fontFamily: 'Menlo, Consolas, monospace',
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  });

  // 헤더
  const header = document.createElement('div');
  Object.assign(header.style, {
    padding: '12px 16px', borderBottom: '1px solid #374151',
    fontSize: '14px', fontWeight: 'bold', color: '#FF77A8', flexShrink: '0',
  });
  header.textContent = '📋 Plans';

  // 본문 (좌: 목록, 우: 상세)
  const body = document.createElement('div');
  Object.assign(body.style, {
    display: 'flex', flex: '1', overflow: 'hidden',
  });

  // 좌측: plan 목록
  const listPane = document.createElement('div');
  Object.assign(listPane.style, {
    width: '240px', minWidth: '200px', borderRight: '1px solid #374151',
    overflowY: 'auto', flexShrink: '0',
  });

  // 우측: plan 상세
  const detailPane = document.createElement('div');
  Object.assign(detailPane.style, {
    flex: '1', overflowY: 'auto', padding: '16px',
    fontSize: '11px', color: '#C2C3C7', lineHeight: '1.6', wordBreak: 'break-word',
  });
  detailPane.textContent = window.i18n?.ui?.plan_select || '← Select a plan';

  body.appendChild(listPane);
  body.appendChild(detailPane);
  panel.appendChild(header);
  panel.appendChild(body);
  overlay.appendChild(panel);

  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
  const escHandler = (ev) => {
    if (ev.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);
  document.body.appendChild(overlay);

  // Plan 목록 로드
  let selectedItem = null;
  try {
    const res = await fetch('/plans');
    if (!res.ok) { listPane.innerHTML = '<div style="padding:12px;color:#9CA3AF">' + (window.i18n?.ui?.load_fail || '(Load failed)') + '</div>'; return; }
    const data = await res.json();
    const files = data.files || [];
    if (files.length === 0) {
      listPane.innerHTML = '<div style="padding:12px;color:#9CA3AF">' + (window.i18n?.ui?.no_plan || '(No plan)') + '</div>';
      return;
    }

    async function selectPlan(file, itemEl) {
      if (selectedItem) selectedItem.style.background = 'transparent';
      selectedItem = itemEl;
      itemEl.style.background = '#29ADFF22';
      detailPane.textContent = window.i18n?.ui?.loading || 'Loading...';
      try {
        const r = await fetch('/plan/' + encodeURIComponent(file.name));
        if (r.ok) {
          const d = await r.json();
          renderMarkdownContent(detailPane, d.content || (window.i18n?.ui?.no_content || '(No content)'));
        } else {
          detailPane.textContent = window.i18n?.ui?.load_fail || '(Load failed)';
        }
      } catch { detailPane.textContent = window.i18n?.ui?.load_fail || '(Load failed)'; }
    }

    for (const file of files) {
      const item = document.createElement('div');
      const date = new Date(file.mtime);
      const dateStr = `${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2,'0')}`;
      const isCurrent = data.currentPlan === file.name;
      Object.assign(item.style, {
        padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #1A2744',
        transition: 'background 0.15s',
      });
      item.innerHTML = `
        <div style="font-size:11px;color:${isCurrent ? '#00E436' : '#C2C3C7'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${isCurrent ? '● ' : ''}${file.title}
        </div>
        <div style="font-size:9px;color:#718096;margin-top:2px">${dateStr} · ${(file.size/1024).toFixed(1)}KB</div>
      `;
      item.addEventListener('mouseenter', () => { if (item !== selectedItem) item.style.background = '#29ADFF11'; });
      item.addEventListener('mouseleave', () => { if (item !== selectedItem) item.style.background = 'transparent'; });
      item.addEventListener('click', () => selectPlan(file, item));
      listPane.appendChild(item);

      // 자동 선택: 현재 세션 plan 또는 첫 번째
      if (isCurrent || (!selectedItem && file === files[0])) {
        selectPlan(file, item);
      }
    }
  } catch {
    listPane.innerHTML = '<div style="padding:12px;color:#9CA3AF">' + (window.i18n?.ui?.load_fail || '(Load failed)') + '</div>';
  }
}

// ─── 태스크 상세 팝업 ────────────────────────────────────────────

async function showTaskPopup(task, clientX, clientY) {
  const existing = document.getElementById('task-popup-overlay');
  if (existing) existing.remove();

  const STATUS_COLORS = {
    pending: { bg: '#4B5563', text: '#D1D5DB', label: 'PENDING' },
    in_progress: { bg: '#1D4ED8', text: '#BFDBFE', label: 'IN PROGRESS' },
    completed: { bg: '#15803D', text: '#BBF7D0', label: 'COMPLETED' },
  };
  const sc = STATUS_COLORS[task.status] || STATUS_COLORS.pending;

  // 캔버스 위치 기준 정렬
  const canvasEl = document.getElementById('game');
  const canvasRect = canvasEl.getBoundingClientRect();
  const centerX = canvasRect.left + canvasRect.width / 2;
  const centerY = canvasRect.top + canvasRect.height / 2;

  // 오버레이 (전체 화면)
  const overlay = document.createElement('div');
  overlay.id = 'task-popup-overlay';
  Object.assign(overlay.style, {
    position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
    background: 'rgba(0,0,0,0.5)', zIndex: '9999',
  });

  // 래퍼 (캔버스 중앙 정렬, flex row)
  const wrapper = document.createElement('div');
  Object.assign(wrapper.style, {
    position: 'absolute', left: centerX + 'px', top: centerY + 'px',
    transform: 'translate(-50%, -50%)',
    display: 'flex', flexDirection: 'row', gap: '12px',
    alignItems: 'flex-start',
  });

  // ── 태스크 패널 (좌측) ──
  const popup = document.createElement('div');
  Object.assign(popup.style, {
    position: 'relative', width: '450px', maxWidth: '50vw',
    background: '#1D2B53', border: '3px solid #29ADFF', borderRadius: '8px',
    padding: '20px 24px 18px', fontFamily: 'Menlo, Consolas, monospace',
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
  });

  // X 버튼
  const closeBtn = document.createElement('div');
  closeBtn.textContent = '✕';
  Object.assign(closeBtn.style, {
    position: 'absolute', top: '10px', right: '10px',
    width: '22px', height: '22px', background: '#C0392B', borderRadius: '4px',
    color: '#fff', fontSize: '13px', display: 'flex', alignItems: 'center',
    justifyContent: 'center', cursor: 'pointer', lineHeight: '1', userSelect: 'none',
  });
  closeBtn.addEventListener('click', (ev) => { ev.stopPropagation(); overlay.remove(); });

  // 상태 배지
  const badge = document.createElement('span');
  badge.textContent = sc.label;
  Object.assign(badge.style, {
    display: 'inline-block', background: sc.bg, color: sc.text,
    fontSize: '10px', padding: '2px 8px', borderRadius: '3px',
    marginBottom: '8px', letterSpacing: '0.05em',
  });

  // 제목
  const title = document.createElement('div');
  title.textContent = task.subject || '(no title)';
  Object.assign(title.style, {
    fontSize: '14px', fontWeight: 'bold', color: '#FFFFFF',
    marginBottom: '10px', lineHeight: '1.4', paddingRight: '28px',
  });

  // 설명
  const desc = document.createElement('div');
  desc.textContent = task.description || (window.i18n?.ui?.no_desc || '(No description)');
  Object.assign(desc.style, {
    fontSize: '12px', color: '#C2C3C7', lineHeight: '1.6',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    marginBottom: '14px', maxHeight: '200px', overflowY: 'auto',
  });

  // ID + Plan 토글 버튼
  const footer = document.createElement('div');
  Object.assign(footer.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
  const idLine = document.createElement('div');
  idLine.textContent = `ID: ${task.id || '-'}`;
  Object.assign(idLine.style, { fontSize: '10px', color: '#4A5568' });

  const planToggle = document.createElement('div');
  planToggle.textContent = '📋 Plan ▸';
  Object.assign(planToggle.style, {
    fontSize: '10px', fontWeight: 'bold', color: '#29ADFF',
    cursor: 'pointer', userSelect: 'none', padding: '2px 8px',
    border: '1px solid #29ADFF40', borderRadius: '4px',
  });

  footer.appendChild(idLine);
  footer.appendChild(planToggle);

  popup.appendChild(closeBtn);
  popup.appendChild(badge);
  popup.appendChild(title);
  popup.appendChild(desc);
  popup.appendChild(footer);

  // ── Plan 패널 (우측, 초기 숨김) ──
  const planPanel = document.createElement('div');
  Object.assign(planPanel.style, {
    width: '504px', maxWidth: '50vw', maxHeight: '60vh',
    background: '#0D1B2A', border: '3px solid #FF77A8', borderRadius: '8px',
    padding: '16px 20px', fontFamily: 'Menlo, Consolas, monospace',
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)', overflowY: 'auto',
    display: 'none',
  });

  const planTitle = document.createElement('div');
  planTitle.textContent = '📋 Plan';
  Object.assign(planTitle.style, {
    fontSize: '13px', fontWeight: 'bold', color: '#FF77A8', marginBottom: '12px',
  });

  const planContent = document.createElement('div');
  planContent.textContent = window.i18n?.ui?.loading || 'Loading...';
  Object.assign(planContent.style, {
    fontSize: '11px', color: '#8B93A1', lineHeight: '1.6',
    wordBreak: 'break-word',
  });

  planPanel.appendChild(planTitle);
  planPanel.appendChild(planContent);

  // Plan 토글 핸들러
  let planLoaded = false;
  planToggle.addEventListener('click', async () => {
    if (planPanel.style.display === 'none') {
      planPanel.style.display = 'block';
      planToggle.textContent = '📋 Plan ◂';
      if (!planLoaded) {
        planLoaded = true;
        try {
          // 1) plan 목록에서 현재 활성 plan 또는 최신 plan 찾기
          const listRes = await fetch('/plans');
          if (!listRes.ok) { planContent.textContent = window.i18n?.ui?.plan_load_fail || '(Plan load failed)'; return; }
          const listData = await listRes.json();
          const planFiles = listData.files || [];
          const targetName = listData.currentPlan || (planFiles[0] && planFiles[0].name);
          if (!targetName) { planContent.textContent = window.i18n?.ui?.active_plan_none || '(No active plan)'; return; }

          // 2) 상세 로드
          const res = await fetch('/plan/' + encodeURIComponent(targetName));
          if (!res.ok) { planContent.textContent = window.i18n?.ui?.plan_load_fail || '(Plan load failed)'; return; }
          const data = await res.json();
          if (!data.content) { planContent.textContent = window.i18n?.ui?.no_plan || '(No plan)'; return; }

          // 3) task subject와 관련 section 추출
          const taskSubject = (task.subject || '').toLowerCase();
          const lines = data.content.split('\n');
          let relevant = [];
          let inSection = false;
          let sectionDepth = 0;
          for (const line of lines) {
            const headerMatch = line.match(/^(#{1,4})\s+(.+)/);
            if (headerMatch) {
              const depth = headerMatch[1].length;
              const headerText = headerMatch[2].toLowerCase();
              if (taskSubject && (headerText.includes(taskSubject.slice(0, 15)) ||
                  taskSubject.includes(headerText.slice(0, 15)))) {
                inSection = true; sectionDepth = depth;
                relevant.push(line); continue;
              }
              if (inSection && depth <= sectionDepth) inSection = false;
            }
            if (inSection) relevant.push(line);
          }
          if (relevant.length === 0) relevant = lines.slice(0, 40);
          const mdText = relevant.join('\n').trim() || (window.i18n?.ui?.no_plan || '(No plan)');
          renderMarkdownContent(planContent, mdText);
        } catch {
          planContent.textContent = window.i18n?.ui?.plan_load_fail || '(Plan load failed)';
        }
      }
    } else {
      planPanel.style.display = 'none';
      planToggle.textContent = '📋 Plan ▸';
    }
  });

  wrapper.appendChild(popup);
  wrapper.appendChild(planPanel);
  overlay.appendChild(wrapper);

  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) overlay.remove();
  });
  const escHandler = (ev) => {
    if (ev.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);

  document.body.appendChild(overlay);
}

// ─── Chris 대화록 팝업 ───────────────────────────────────────────

async function showChrisLogPopup() {
  // 기존 팝업 제거
  const existing = document.getElementById('task-popup-overlay');
  if (existing) existing.remove();

  // 캔버스 위치 기준 정렬
  const canvasEl = document.getElementById('game');
  const canvasRect = canvasEl.getBoundingClientRect();
  const centerX = canvasRect.left + canvasRect.width / 2;
  const centerY = canvasRect.top + canvasRect.height / 2;

  // 오버레이
  const overlay = document.createElement('div');
  overlay.id = 'task-popup-overlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '0', left: '0', right: '0', bottom: '0',
    background: 'rgba(0,0,0,0.6)',
    zIndex: '9999',
  });

  // 팝업 박스 (레트로 게임 스타일, 캔버스 중앙)
  const popup = document.createElement('div');
  Object.assign(popup.style, {
    position: 'absolute',
    left: centerX + 'px', top: centerY + 'px',
    transform: 'translate(-50%, -50%)',
    width: '580px',
    maxWidth: '50vw',
    maxHeight: '70vh',
    background: '#1D2B53',
    border: '3px solid #FF77A8',
    borderRadius: '8px',
    padding: '20px 24px 18px',
    fontFamily: '"Menlo", "Consolas", monospace',
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
    overflowY: 'auto',
  });

  // 헤더
  const header = document.createElement('div');
  Object.assign(header.style, {
    fontSize: '16px', fontWeight: 'bold', color: '#FF77A8',
    marginBottom: '16px', paddingRight: '30px',
  });
  header.textContent = window.i18n?.ui?.chris_log_header || '🧠 Chris Work Notes';

  // X 버튼
  const closeBtn = document.createElement('div');
  closeBtn.textContent = '✕';
  Object.assign(closeBtn.style, {
    position: 'absolute', top: '10px', right: '10px',
    width: '22px', height: '22px',
    background: '#C0392B', borderRadius: '4px',
    color: '#fff', fontSize: '13px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', userSelect: 'none',
  });

  popup.appendChild(closeBtn);
  popup.appendChild(header);

  // 콘텐츠 영역 (폴링 시 이 영역만 갱신)
  const contentContainer = document.createElement('div');
  contentContainer.style.transition = 'opacity 0.3s ease';
  popup.appendChild(contentContainer);

  let lastChapterHash = '';
  const openGroups = new Set(); // 펼친 그룹 키를 기억 (리렌더 시 상태 보존)
  const expandedChapters = new Set(); // 더보기 펼친 챕터 키 (리렌더 시 상태 보존)

  function renderContent(chapters) {
   try {
    const scrollTop = popup.scrollTop;
    // 기존 키 수집 (새 그룹 감지용)
    const _prevKeys = new Set();
    for (const child of [...contentContainer.children]) {
      if (child.dataset.groupKey) _prevKeys.add(child.dataset.groupKey);
    }
    // offscreen fragment에 빌드 후 한 번에 교체 (열린 그룹이 접혔다 펼쳐지는 깜빡임 방지)
    const _fragment = document.createDocumentFragment();

    // userMsg 기준으로 그룹핑
    const groups = [];
    let currentGroup = null;
    for (const ch of chapters) {
      if (ch.type === 'compact') {
        // Compacting 이벤트는 독립 표시
        groups.push({ userMsg: '🔄 Compacting conversation...', ts: ch.ts, chapters: [ch], isCompact: true });
        currentGroup = null;
        continue;
      }
      const project = ch.project || 'main';
      // [Image: source:...] 패턴 제거 (이미지는 썸네일로 별도 표시)
      const cleanMsg = (s) => (s || '').replace(/\[Image:\s*source:\s*[^\]]+\]/g, '').trim();
      const msg = cleanMsg(ch.userMsg) || cleanMsg(ch.title) || (window.i18n?.ui?.untitled || '(Untitled)');
      const key = project + ':' + msg;
      if (!currentGroup || currentGroup._key !== key) {
        currentGroup = { _key: key, userMsg: msg, project, ts: ch.ts, chapters: [ch] };
        groups.push(currentGroup);
      } else {
        currentGroup.chapters.push(ch);
        currentGroup.ts = ch.ts;
      }
    }
    groups.reverse();

  if (groups.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = window.i18n?.ui?.chris_log_empty || 'No entries recorded yet.';
    Object.assign(empty.style, { color: '#5F574F', fontSize: '12px' });
    _fragment.appendChild(empty);
  } else {
    for (const grp of groups) {
      // 🔄 Compacting 이벤트 — 특별 스타일로 표시
      if (grp.isCompact) {
        const compactKey = 'compact|' + (grp.ts || '');
        if (_prevKeys.has(compactKey)) {
          // 기존 compact — 그대로 재생성
        }
        const compactEl = document.createElement('div');
        Object.assign(compactEl.style, {
          marginBottom: '10px', padding: '8px 12px',
          background: '#1A1A2E', borderLeft: '3px solid #FFA300',
          borderRadius: '4px',
        });
        const compactText = document.createElement('span');
        compactText.textContent = '🔄 Compacting conversation...';
        Object.assign(compactText.style, { color: '#FFA300', fontSize: '11px' });
        const compactTs = document.createElement('span');
        compactTs.textContent = grp.ts || '';
        Object.assign(compactTs.style, { color: '#5F574F', fontSize: '10px', marginLeft: '12px' });
        compactEl.appendChild(compactText);
        compactEl.appendChild(compactTs);
        compactEl.dataset.groupKey = compactKey;
        _fragment.appendChild(compactEl);
        continue;
      }

      // 그룹 key 계산 + 기존 DOM 재사용 (펼침 상태 보존)
      // pending chapter의 ts는 매번 바뀌므로 groupKey에 'pending' 사용 (매번 새 그룹 인식 → 깜빡임 방지)
      const hasPending = grp.chapters.some(c => c.pending);
      const groupKey = (grp.userMsg || '').slice(0, 100) + '|' + (hasPending ? 'pending' : (grp.chapters[0]?.ts || grp.ts || ''));
      const _isNewGroup = !_prevKeys.has(groupKey);

      // 그룹 토글 키 + 열림 상태 (DOM 생성 전에 결정해야 깜빡임 방지)
      const openKey = (grp.userMsg || '').slice(0, 100);
      const isOpen = openGroups.has(openKey);

      const groupEl = document.createElement('div');
      Object.assign(groupEl.style, {
        marginBottom: '10px',
        borderRadius: '4px',
        overflow: 'hidden',
      });

      // 레벨 1: 그룹 헤더 (userMsg 기준, 클릭으로 토글)
      const groupHeader = document.createElement('div');
      Object.assign(groupHeader.style, {
        padding: '9px 12px',
        background: '#1A1A2E',
        borderLeft: '3px solid #FF77A8',
        cursor: 'pointer',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        userSelect: 'none',
      });

      const groupTitle = document.createElement('span');
      groupTitle.style.flex = '1';
      groupTitle.style.overflow = isOpen ? 'visible' : 'hidden';

      // 프로젝트 뱃지 (모든 그룹에 표시)
      if (grp.project) {
        const badge = document.createElement('span');
        badge.textContent = grp.project;
        Object.assign(badge.style, {
          display: 'inline-block',
          background: '#29ADFF30', color: '#29ADFF', fontSize: '9px',
          padding: '1px 6px', borderRadius: '3px', marginRight: '6px',
          verticalAlign: 'middle', fontWeight: 'normal',
        });
        groupTitle.appendChild(badge);
        if (!isOpen) groupTitle.appendChild(document.createElement('br'));
      }

      const msgText = document.createElement('span');
      const shortMsg = grp.userMsg.split('\n')[0].slice(0, 120);
      msgText.textContent = '👤 ' + (isOpen ? grp.userMsg : shortMsg);
      Object.assign(msgText.style, {
        color: '#FFF1E8', fontSize: '12px', fontWeight: 'bold',
        textOverflow: 'ellipsis',
        whiteSpace: isOpen ? 'pre-wrap' : 'nowrap',
        wordBreak: isOpen ? 'break-word' : 'normal',
      });
      groupTitle.appendChild(msgText);

      const groupMeta = document.createElement('span');
      groupMeta.textContent = (grp.ts || '') + (grp.chapters.length > 1 ? '  ' + grp.chapters.length + (window.i18n?.ui?.count_suffix || '') : '');
      Object.assign(groupMeta.style, {
        color: '#5F574F', fontSize: '10px', marginLeft: '12px', flexShrink: '0',
      });

      const groupArrow = document.createElement('span');
      groupArrow.textContent = '▸';
      Object.assign(groupArrow.style, {
        color: '#FF77A8', fontSize: '12px', marginLeft: '8px',
        transition: 'transform 0.2s',
        transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
      });

      groupHeader.appendChild(groupTitle);
      groupHeader.appendChild(groupMeta);
      groupHeader.appendChild(groupArrow);

      // 레벨 2: 챕터 본문들 (isOpen이면 처음부터 열린 상태로 생성)
      const groupBody = document.createElement('div');
      Object.assign(groupBody.style, {
        maxHeight: isOpen ? 'none' : '0',
        overflow: isOpen ? 'visible' : 'hidden',
        transition: isOpen ? 'none' : 'max-height 0.3s ease',
        background: '#0F1A33',
      });

      // 이미지 썸네일 표시 (첫 챕터의 images 사용)
      const allImages = grp.chapters.flatMap(ch => ch.images || []);
      if (allImages.length > 0) {
        const imgRow = document.createElement('div');
        Object.assign(imgRow.style, {
          padding: '6px 12px', display: 'flex', gap: '6px', flexWrap: 'wrap',
          background: '#0F1A33', borderTop: '1px solid #29ADFF20',
        });
        for (const img of allImages) {
          const thumb = document.createElement('img');
          thumb.src = '/images/' + img;
          Object.assign(thumb.style, {
            width: '40px', height: '40px', objectFit: 'cover',
            borderRadius: '4px', cursor: 'pointer', border: '1px solid #29ADFF40',
          });
          thumb.addEventListener('click', (ev) => {
            ev.stopPropagation();
            // 모달로 크게 표시
            const modal = document.createElement('div');
            Object.assign(modal.style, {
              position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
              background: 'rgba(0,0,0,0.85)', zIndex: '20000',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            });
            const fullImg = document.createElement('img');
            fullImg.src = '/images/' + img;
            Object.assign(fullImg.style, {
              maxWidth: '90vw', maxHeight: '90vh', borderRadius: '8px',
              boxShadow: '0 0 40px rgba(0,0,0,0.8)',
            });
            modal.appendChild(fullImg);
            modal.addEventListener('click', () => modal.remove());
            document.body.appendChild(modal);
          });
          imgRow.appendChild(thumb);
        }
        groupBody.appendChild(imgRow);
      }

      // 각 챕터 내용을 바로 펼쳐서 표시
      grp.chapters.forEach((ch, idx) => {
        const chapterEl = document.createElement('div');
        Object.assign(chapterEl.style, {
          padding: '10px 14px',
        });

        // 챕터가 여러 개면 구분선 (첫 번째 제외)
        if (idx > 0) {
          const divider = document.createElement('div');
          Object.assign(divider.style, {
            borderTop: '1px solid #29ADFF30',
            marginBottom: '10px',
          });
          chapterEl.insertBefore(divider, chapterEl.firstChild);
        }

        // pending 챕터: steps가 있으면 표시하고, 맨 아래에 진행 중 indicator 추가
        if (ch.pending) {
          const stepsArr = ch.steps || [];
          if (stepsArr.length === 0) {
            // steps가 정말 없을 때만 응답 대기 중
            const pendingEl = document.createElement('div');
            pendingEl.textContent = '⏳ ' + (window.i18n?.ui?.pending || '응답 대기 중...');
            Object.assign(pendingEl.style, {
              color: '#FFEC27', fontSize: '11px', padding: '8px 0',
              opacity: '0.7', fontStyle: 'italic',
            });
            pendingEl.animate([{ opacity: 0.4 }, { opacity: 1 }], {
              duration: 1200, iterations: Infinity, direction: 'alternate',
            });
            chapterEl.appendChild(pendingEl);
            groupBody.appendChild(chapterEl);
            return;
          }
          // steps가 있으면 아래 일반 렌더링으로 진행 (pending indicator만 추가)
        }

        // 시간순 steps 렌더링 (카테고리 헤더 + 전체 더보기)
        const stepsArr = ch.steps || [];

        // 레거시 호환: steps가 없으면 기존 필드에서 변환
        if (stepsArr.length === 0) {
          if (ch.thinks?.length) stepsArr.push({ type: 'think', lines: ch.thinks });
          if (ch.response) stepsArr.push({ type: 'response', text: ch.response });
          if (ch.tools?.length) ch.tools.forEach(t => stepsArr.push({ type: 'tool', ...t }));
          if (ch.agents?.length) ch.agents.forEach(a => stepsArr.push({ type: 'agent', ...a }));
        }

        // step 요소들을 먼저 생성
        const stepElements = [];
        const INITIAL_VISIBLE = 5; // 처음 보이는 step 수

        for (const step of stepsArr) {
          // 💭 Think step
          if (step.type === 'think' && step.lines?.length) {
            const wrap = document.createElement('div');
            Object.assign(wrap.style, { marginTop: '6px' });

            const header = document.createElement('div');
            header.textContent = '💭 Thinking';
            Object.assign(header.style, {
              color: '#FFEC27', fontSize: '10px', fontWeight: 'bold', marginBottom: '4px',
            });
            wrap.appendChild(header);

            for (const t of step.lines) {
              const el = document.createElement('div');
              el.textContent = t;
              Object.assign(el.style, {
                color: '#C2C3C7', fontSize: '10px', lineHeight: '1.5',
                paddingLeft: '8px', borderLeft: '2px solid #FFEC27',
                marginBottom: '3px', wordBreak: 'break-word',
              });
              wrap.appendChild(el);
            }
            stepElements.push(wrap);
          }

          // 💬 Response step
          if (step.type === 'response' && step.text) {
            const wrap = document.createElement('div');
            Object.assign(wrap.style, { marginTop: '6px' });

            const header = document.createElement('div');
            header.textContent = '💬 Response';
            Object.assign(header.style, {
              color: '#00E436', fontSize: '10px', fontWeight: 'bold', marginBottom: '4px',
            });
            wrap.appendChild(header);

            const respText = document.createElement('div');
            respText.textContent = step.text;
            Object.assign(respText.style, {
              color: '#FFF1E8', fontSize: '11px', lineHeight: '1.5',
              paddingLeft: '8px', borderLeft: '2px solid #00E436',
              wordBreak: 'break-word',
            });
            wrap.appendChild(respText);
            stepElements.push(wrap);
          }

          // 🔧 Tool step
          if (step.type === 'tool') {
            const toolIcon = { Read: '📖', Edit: '✏️', Write: '📝', Bash: '⚡', Grep: '🔍', Glob: '📂' }[step.name] || '🔧';
            const toolEl = document.createElement('div');
            Object.assign(toolEl.style, { marginTop: '3px' });

            const headerEl = document.createElement('div');
            headerEl.textContent = `${toolIcon} ${step.name}${step.detail ? ' → ' + step.detail : ''}`;
            Object.assign(headerEl.style, {
              color: '#AB5236', fontSize: '10px', lineHeight: '1.4',
              cursor: step.change ? 'pointer' : 'default', userSelect: 'none',
            });
            toolEl.appendChild(headerEl);

            if (step.change) {
              const changeEl = document.createElement('div');
              Object.assign(changeEl.style, {
                maxHeight: '0', overflow: 'hidden', transition: 'max-height 0.2s ease',
                paddingLeft: '12px', marginTop: '2px',
              });
              for (const cl of step.change.split('\n')) {
                const lineEl = document.createElement('div');
                lineEl.textContent = cl;
                const isAdd = cl.startsWith('+');
                const isDel = cl.startsWith('-');
                Object.assign(lineEl.style, {
                  color: isAdd ? '#00E436' : isDel ? '#FF004D' : '#8E8E8E',
                  fontSize: '9px', fontFamily: '"Menlo", "Consolas", monospace',
                  lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                });
                changeEl.appendChild(lineEl);
              }
              headerEl.addEventListener('click', (e) => {
                e.stopPropagation();
                changeEl.style.maxHeight = changeEl.style.maxHeight === '0px' ? '300px' : '0px';
              });
              toolEl.appendChild(changeEl);
            }
            stepElements.push(toolEl);
          }

          // 🤖 Agent step
          if (step.type === 'agent') {
            const agentEl = document.createElement('div');
            agentEl.textContent = `🤖 ${step.name}${step.desc ? ': ' + step.desc : ''}`;
            Object.assign(agentEl.style, {
              color: '#7E2553', fontSize: '10px', marginTop: '3px',
            });
            stepElements.push(agentEl);
          }

          // 사용자 추가 메시지 (상위 뎁스, 선명한 배경)
          if (step.type === 'user-reply' && step.text) {
            const replyEl = document.createElement('div');
            replyEl.textContent = `👤 ${step.text}`;
            Object.assign(replyEl.style, {
              color: '#FFEC27', fontSize: '11px',
              marginTop: '10px', marginBottom: '4px',
              padding: '5px 8px',
              background: 'rgba(255,236,39,0.15)',
              borderLeft: '3px solid #FFEC27',
              borderRadius: '2px',
              fontWeight: 'bold',
              lineHeight: '1.4',
            });
            stepElements.push(replyEl);
          }
        }

        // 전체 더보기: 처음 INITIAL_VISIBLE개만 표시, 나머지는 숨김
        const chapterKey = groupKey + '|ch' + idx;
        const hiddenEls = [];
        let expanded = expandedChapters.has(chapterKey);
        stepElements.forEach((el, i) => {
          if (i >= INITIAL_VISIBLE) {
            el.style.display = expanded ? '' : 'none';
            hiddenEls.push(el);
          }
          chapterEl.appendChild(el);
        });

        if (hiddenEls.length > 0) {
          const moreBtn = document.createElement('div');
          moreBtn.textContent = expanded
            ? (window.i18n?.ui?.collapse_button || '▲ Collapse')
            : (window.i18n?.ui?.more_button || '▼ +${n} more').replace('${n}', hiddenEls.length);
          Object.assign(moreBtn.style, {
            color: '#29ADFF', fontSize: '10px', cursor: 'pointer',
            marginTop: '6px', opacity: '0.8', userSelect: 'none',
          });
          moreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            expanded = !expanded;
            if (expanded) expandedChapters.add(chapterKey); else expandedChapters.delete(chapterKey);
            for (const el of hiddenEls) el.style.display = expanded ? '' : 'none';
            moreBtn.textContent = expanded ? (window.i18n?.ui?.collapse_button || '▲ Collapse') : (window.i18n?.ui?.more_button || '▼ +${n} more').replace('${n}', hiddenEls.length);
          });
          chapterEl.appendChild(moreBtn);
        }

        // pending chapter에 steps가 있으면 진행 중 indicator 추가
        if (ch.pending) {
          const indicator = document.createElement('div');
          indicator.textContent = '⏳ ' + (window.i18n?.ui?.in_progress || '진행 중...');
          Object.assign(indicator.style, {
            color: '#FFEC27', fontSize: '10px', padding: '6px 0',
            opacity: '0.7', fontStyle: 'italic',
          });
          indicator.animate([{ opacity: 0.4 }, { opacity: 1 }], {
            duration: 1200, iterations: Infinity, direction: 'alternate',
          });
          chapterEl.appendChild(indicator);
        }

        groupBody.appendChild(chapterEl);
      });

      // 그룹 토글 동작
      const applyOpen = (open) => {
        if (open) {
          groupBody.style.overflow = 'visible';
          groupBody.style.maxHeight = 'none';
          groupBody.style.transition = 'none';
          groupArrow.style.transform = 'rotate(90deg)';
          msgText.textContent = '👤 ' + grp.userMsg;
          msgText.style.whiteSpace = 'pre-wrap';
          msgText.style.wordBreak = 'break-word';
          groupTitle.style.overflow = 'visible';
        } else {
          groupBody.style.overflow = 'hidden';
          groupBody.style.transition = 'max-height 0.3s ease';
          groupBody.style.maxHeight = '0';
          groupArrow.style.transform = 'rotate(0deg)';
          msgText.textContent = '👤 ' + shortMsg;
          msgText.style.whiteSpace = 'nowrap';
          groupTitle.style.overflow = 'hidden';
        }
      };

      let _isOpenState = isOpen;
      groupHeader.addEventListener('click', () => {
        _isOpenState = !_isOpenState;
        if (_isOpenState) openGroups.add(openKey); else openGroups.delete(openKey);
        applyOpen(_isOpenState);
      });

      groupEl.appendChild(groupHeader);
      groupEl.appendChild(groupBody);
      groupEl.dataset.groupKey = groupKey;
      _fragment.appendChild(groupEl);

      // 새 그룹만 낑겨넣기 애니메이션 (기존 그룹은 즉시 렌더)
      if (_isNewGroup && _prevKeys.size > 0) {
        groupEl.style.overflow = 'hidden';
        groupEl.style.maxHeight = '0';
        groupEl.style.opacity = '0';
        groupEl.style.transition = 'max-height 0.35s ease, opacity 0.3s ease 0.05s';
        requestAnimationFrame(() => {
          groupEl.style.maxHeight = groupEl.scrollHeight + 'px';
          groupEl.style.opacity = '1';
          groupEl.addEventListener('transitionend', () => { groupEl.style.maxHeight = ''; groupEl.style.overflow = ''; }, { once: true });
        });
      }
    }
  }

    // 한 번에 교체: 열린 그룹이 접혔다 펼쳐지는 깜빡임 없음
    contentContainer.replaceChildren(..._fragment.childNodes);
    popup.scrollTop = scrollTop;
   } catch (err) {
    console.error('[renderContent] Error:', err);
    contentContainer.innerHTML = '';
    const errEl = document.createElement('div');
    errEl.textContent = 'renderContent error: ' + err.message;
    Object.assign(errEl.style, { color: '#FF004D', fontSize: '11px', padding: '12px' });
    contentContainer.appendChild(errEl);
   }
  } // end renderContent

  // SSE 구독용 변수 (초기 로드 전에 선언 필수)
  let refetchTimer = null;
  let lastJsonStr = '';

  // 초기 렌더링
  try {
    const res = await fetch('/chris-log');
    if (res.ok) {
      const chapters = await res.json();
      lastJsonStr = JSON.stringify(chapters);
      renderContent(chapters);
    }
  } catch {}
  // 모든 SSE 이벤트에 debounce refetch (1.5초) — 타입 필터 불필요, debounce가 과다 요청 방지
  const sseRefetch = (ev) => {
    if (refetchTimer) clearTimeout(refetchTimer);
    refetchTimer = setTimeout(async () => {
      try {
        const res = await fetch('/chris-log');
        if (!res.ok) return;
        const chapters = await res.json();
        const jsonStr = JSON.stringify(chapters);
        if (jsonStr === lastJsonStr) return; // 실제 변경 없으면 스킵
        lastJsonStr = jsonStr;
        renderContent(chapters);
      } catch {}
    }, 1500);
  };
  if (window._sseSource) {
    window._sseSource.addEventListener('message', sseRefetch);
  }

  const cleanup = () => {
    if (refetchTimer) clearTimeout(refetchTimer);
    if (window._sseSource) window._sseSource.removeEventListener('message', sseRefetch);
  };

  // X 버튼 클릭 닫기
  closeBtn.addEventListener('click', (ev) => { ev.stopPropagation(); cleanup(); overlay.remove(); });

  // 배경 클릭 닫기
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) { cleanup(); overlay.remove(); }
  });

  // ESC 닫기
  const escHandler = (ev) => {
    if (ev.key === 'Escape') {
      cleanup();
      overlay.remove();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  overlay.appendChild(popup);
  document.body.appendChild(overlay);
}

// ─── C-Team 대화 로그 팝업 ──────────────────────────────────────────

async function showCTeamLogPopup(name, clientX, clientY) {
  document.querySelectorAll('.agent-info-overlay').forEach(el => el.remove());

  const canvasEl = document.getElementById('game');
  const canvasRect = canvasEl.getBoundingClientRect();
  const centerX = canvasRect.left + canvasRect.width / 2;
  const centerY = canvasRect.top + canvasRect.height / 2;

  const overlay = document.createElement('div');
  overlay.className = 'agent-info-overlay';
  Object.assign(overlay.style, {
    position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
    background: 'rgba(0,0,0,0.5)', zIndex: '10000',
  });

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'absolute',
    left: centerX + 'px', top: centerY + 'px',
    transform: 'translate(-50%, -50%)',
    width: '420px', maxWidth: '70vw', maxHeight: '60vh',
    background: '#1D2B53', border: '3px solid #FFA300', borderRadius: '8px',
    padding: '20px 24px', fontFamily: 'Menlo, Consolas, monospace',
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)', overflowY: 'auto',
  });

  const closeBtn = document.createElement('div');
  closeBtn.textContent = '✕';
  Object.assign(closeBtn.style, {
    position: 'absolute', top: '10px', right: '10px',
    width: '22px', height: '22px', background: '#C0392B', borderRadius: '4px',
    color: '#fff', fontSize: '13px', display: 'flex', alignItems: 'center',
    justifyContent: 'center', cursor: 'pointer', lineHeight: '1', userSelect: 'none',
  });
  closeBtn.addEventListener('click', (ev) => { ev.stopPropagation(); overlay.remove(); });

  const header = document.createElement('div');
  header.textContent = name + ' — Loading...';
  Object.assign(header.style, {
    fontSize: '14px', fontWeight: 'bold', color: '#FFA300',
    marginBottom: '12px', paddingRight: '28px',
  });

  const body = document.createElement('div');
  Object.assign(body.style, { fontSize: '11px', color: '#C2C3C7', lineHeight: '1.6' });

  panel.appendChild(closeBtn);
  panel.appendChild(header);
  panel.appendChild(body);
  overlay.appendChild(panel);

  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
  const escHandler = (ev) => {
    if (ev.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);
  document.body.appendChild(overlay);

  try {
    const res = await fetch('/c-team-info?name=' + encodeURIComponent(name));
    if (res.ok) {
      const data = await res.json();
      header.textContent = name + ' (C-Team)';

      if (data.events && data.events.length > 0) {
        for (const ev of data.events) {
          const line = document.createElement('div');
          const msgText = (ev.msg || '').slice(0, 120);
          const typeLabel = ev.type === 'c-bubble' ? '💬' : '🔧';
          line.textContent = (ev.ts || '') + ' ' + typeLabel + ' ' + msgText;
          Object.assign(line.style, {
            fontSize: '10px', color: ev.type === 'c-bubble' ? '#FFA300' : '#8B93A1',
            padding: '3px 0', borderBottom: '1px solid #FFA30020',
          });
          body.appendChild(line);
        }
      } else {
        body.textContent = 'No recent activity';
        body.style.color = '#8B93A1';
      }
    }
  } catch (err) {
    body.textContent = 'Failed to load';
  }
}

// ─── 에이전트 정보 팝업 ──────────────────────────────────────────

async function showAgentInfoPopup(name, clientX, clientY) {
  document.querySelectorAll('.agent-info-overlay').forEach(el => el.remove());

  const canvasEl = document.getElementById('game');
  const canvasRect = canvasEl.getBoundingClientRect();
  const centerX = canvasRect.left + canvasRect.width / 2;
  const centerY = canvasRect.top + canvasRect.height / 2;

  const overlay = document.createElement('div');
  overlay.className = 'agent-info-overlay';
  Object.assign(overlay.style, {
    position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
    background: 'rgba(0,0,0,0.5)', zIndex: '10000',
  });

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'absolute',
    left: centerX + 'px', top: centerY + 'px',
    transform: 'translate(-50%, -50%)',
    width: '400px', maxWidth: '70vw', maxHeight: '60vh',
    background: '#1D2B53', border: '3px solid #29ADFF', borderRadius: '8px',
    padding: '20px 24px', fontFamily: 'Menlo, Consolas, monospace',
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)', overflowY: 'auto',
  });

  // X 버튼
  const closeBtn = document.createElement('div');
  closeBtn.textContent = '✕';
  Object.assign(closeBtn.style, {
    position: 'absolute', top: '10px', right: '10px',
    width: '22px', height: '22px', background: '#C0392B', borderRadius: '4px',
    color: '#fff', fontSize: '13px', display: 'flex', alignItems: 'center',
    justifyContent: 'center', cursor: 'pointer', lineHeight: '1', userSelect: 'none',
  });
  closeBtn.addEventListener('click', (ev) => { ev.stopPropagation(); overlay.remove(); });

  const header = document.createElement('div');
  header.textContent = name + (window.i18n?.ui?.agent_loading || ' — Loading...');
  Object.assign(header.style, {
    fontSize: '14px', fontWeight: 'bold', color: '#29ADFF',
    marginBottom: '12px', paddingRight: '28px',
  });

  const body = document.createElement('div');
  Object.assign(body.style, {
    fontSize: '11px', color: '#C2C3C7', lineHeight: '1.6',
  });

  panel.appendChild(closeBtn);
  panel.appendChild(header);
  panel.appendChild(body);
  overlay.appendChild(panel);

  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
  const escHandler = (ev) => {
    if (ev.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);
  document.body.appendChild(overlay);

  try {
    const res = await fetch('/agent-info?name=' + encodeURIComponent(name));
    if (res.ok) {
      const data = await res.json();
      if (data.active) {
        header.textContent = name + ' (' + (data.agentType || 'agent') + ')';
        header.style.color = '#00E436';

        const elapsed = Math.floor((Date.now() - data.lastActivity) / 1000);
        const timeInfo = document.createElement('div');
        timeInfo.textContent = (window.i18n?.ui?.recent_activity || 'Recent: ${n}s ago').replace('${n}', elapsed);
        Object.assign(timeInfo.style, { fontSize: '10px', color: '#8B93A1', marginBottom: '12px' });
        body.appendChild(timeInfo);

        // idle-chat 제외
        if (data.recentEvents) data.recentEvents = data.recentEvents.filter(e => e.type !== 'idle-chat');
        if (data.recentEvents && data.recentEvents.length > 0) {
          const evTitle = document.createElement('div');
          evTitle.textContent = window.i18n?.ui?.recent_activity_label || 'Recent activity:';
          Object.assign(evTitle.style, {
            fontSize: '11px', color: '#FF77A8', marginBottom: '6px', fontWeight: 'bold',
          });
          body.appendChild(evTitle);

          for (const ev of data.recentEvents) {
            const line = document.createElement('div');
            const msgText = (ev.msg || '').slice(0, 80);
            const typeText = ev.type ? '[' + ev.type + '] ' : '';
            line.textContent = (ev.ts || '') + ' ' + typeText + msgText;
            Object.assign(line.style, {
              fontSize: '10px', color: '#8B93A1', padding: '3px 0',
              borderBottom: '1px solid #29ADFF20',
            });
            body.appendChild(line);

            // detail이 있으면 한 줄 더
            if (ev.detail) {
              const detailLine = document.createElement('div');
              detailLine.textContent = '  ' + ev.detail.slice(0, 80);
              Object.assign(detailLine.style, {
                fontSize: '10px', color: '#4A5568', padding: '1px 0 3px 8px',
                borderBottom: '1px solid #29ADFF20', fontStyle: 'italic',
              });
              body.appendChild(detailLine);
            }
          }
        } else {
          const noEvt = document.createElement('div');
          noEvt.textContent = window.i18n?.ui?.no_recent || '(No recent activity)';
          Object.assign(noEvt.style, { color: '#4A5568', fontSize: '11px' });
          body.appendChild(noEvt);
        }
      } else {
        header.textContent = name;
        header.style.color = '#8B93A1';
        const idleMsg = document.createElement('div');
        idleMsg.textContent = window.i18n?.ui?.not_working || 'Not currently working.';
        Object.assign(idleMsg.style, { color: '#4A5568', fontSize: '11px' });
        body.appendChild(idleMsg);
      }
    }
  } catch {
    const errMsg = document.createElement('div');
    errMsg.textContent = window.i18n?.ui?.info_fail || '(Info load failed)';
    Object.assign(errMsg.style, { color: '#C0392B', fontSize: '11px' });
    body.appendChild(errMsg);
  }
}

// ─── Session End Overlay ─────────────────────────────────────────

function showSessionEndOverlay() {
  if (document.getElementById('session-end-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'session-end-overlay';
  overlay.innerHTML = `
    <div class="session-end-box">
      <div class="session-end-icon">⚡</div>
      <div class="session-end-title">${window.i18n?.ui?.session_ended || 'Session Ended'}</div>
      <div class="session-end-desc">${window.i18n?.ui?.connection_lost || 'Server connection lost'}</div>
    </div>`;
  document.getElementById('game-container').appendChild(overlay);
}

// Wait for fonts then init
if (document.fonts) {
  document.fonts.ready.then(init);
} else {
  window.addEventListener('load', init);
}
