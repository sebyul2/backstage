// character.js — Character class: position, state machine, animation, movement
// v2.1: break room lifecycle, no random office wandering

import { TILE_SIZE, deskPositions, breakPositions, breakWanderZones, furnitureInteractions, MAP_W, MAP_H } from './map.js?v=2.5';
import { findPath, pixelToTile, tileToPixel } from './pathfinding.js?v=2.5';
import { generateSpriteSheet } from './sprite-generator.js?v=2.7';

// States
const S = {
  IDLE: 'idle',                       // Chris/Player/[C]team idle
  IDLE_BREAK: 'idle_break',           // Agent idle in break room
  WALKING_BREAK: 'walking_break',     // Agent wandering in break room
  WALKING_TO: 'walking_to',           // Generic walk to target
  RUNNING_TO_DESK: 'running_to_desk', // Agent: break room → desk
  WORKING: 'working',                 // Agent/[C]team at desk working
  WALKING_TO_BREAK: 'walking_to_break', // Agent: desk → break room
  INTERACTING: 'interacting',         // Agent interacting with break room furniture
  TALKING: 'talking',                 // Showing speech bubble
};

// Direction: 0=down, 1=left, 2=right, 3=up
const DIR = { DOWN: 0, LEFT: 1, RIGHT: 2, UP: 3 };

const WALK_SPEED = 82;    // pixels per second (normal wandering, 1.5x)
const RUN_SPEED = 1800;   // running to desk (1.5x)
const IDLE_MIN = 4000;   // ms before break room wander
const IDLE_MAX = 10000;
const ARRIVE_DIST = 6;

// I3: Agent lifecycle timeouts
// - 서버: AGENT_IDLE_TIMEOUT = 30s (transcript 기반 무활동 감지)
// - 서버/훅: SubagentStop 이벤트 (정확한 완료 신호, 주 경로)
// - 클라이언트: AGENT_ABSOLUTE_TTL = 120s (assign 시점부터 재진입 영향 없음)
//   → 서버 신호가 유실되거나 훅 비활성 상태여도 반드시 퇴근시키는 마지막 방어선.
const AGENT_ABSOLUTE_TTL = 120_000;

// F1: Break room auto-leave — IDLE_BREAK 에서 N초 이상 누적 활동 없으면 fade out
const AUTO_LEAVE_MS = 150_000;     // 휴게실에서 2.5분 idle 이면 퇴장 시작
const FADE_OUT_MS = 2_000;         // 2초에 걸쳐 alpha 0 으로
const DOOR_X = 14.5 * TILE_SIZE;
const DOOR_Y = 7.5 * TILE_SIZE;

// Collision detection constants
const COLLISION_DIST = 20;  // px - distance threshold for collision
const BOUNCE_FORCE = 3;     // px - pushback distance
const COLLISION_STUN = 400; // ms - stun duration after collision

// Stuck detection constants — 벽/캐릭터에 막혀 제자리 푸시하는 현상을 빠르게 감지
const STUCK_CHECK_INTERVAL = 500;  // ms - 0.5초 간격 샘플 (이전 1000ms)
const STUCK_WINDOW = 2;            // 2 samples = 1초 전체 (이전 3 samples = 3초)
const STUCK_THRESHOLD = 10;        // px - velocity 만큼 이동 했어야 함 (이전 5px)
// Tool categories for visual display
export const TOOL_ICONS = {
  'Read':  { icon: '📖', label: 'READ',  color: '#29ADFF' },
  'Glob':  { icon: '🔍', label: 'FIND',  color: '#FFEC27' },
  'Grep':  { icon: '🔎', label: 'GREP',  color: '#FFEC27' },
  'Edit':  { icon: '✏️', label: 'EDIT',  color: '#FFA300' },
  'Write': { icon: '📝', label: 'WRITE', color: '#FFA300' },
  'Bash':  { icon: '💻', label: 'BASH',  color: '#00E436' },
  'Task':  { icon: '📋', label: 'TASK',  color: '#83769C' },
};

export class Character {
  constructor(name, role, x, y) {
    this.name = name;
    this.role = role;
    this.x = x;
    this.y = y;

    // Desk position (where they work)
    const desk = deskPositions[name];
    this.homeX = desk ? desk.x : x;
    this.homeY = desk ? desk.y : y;
    this.deskDir = desk?.dir ?? DIR.UP; // face direction when sitting at desk

    // Break room position (where they idle)
    const brk = breakPositions[name];
    this.breakX = brk ? brk.x : x;
    this.breakY = brk ? brk.y : y;

    this.targetX = x;
    this.targetY = y;

    // Initial state: agents in break room, Chris/Player in office
    if (role === 'boss' || role === 'player') {
      this.state = S.IDLE;
    } else {
      this.state = S.IDLE_BREAK;
    }

    this.dir = DIR.DOWN;
    this.frame = 0;
    this.frameTimer = 0;
    this.stateTimer = 0;
    this.idleDelay = this._randomIdleDelay();
    this.sprite = null;
    this.active = false;
    this.talkCallback = null;

    // Pathfinding
    this.path = null;       // Array of {x, y} pixel waypoints
    this.pathIndex = 0;     // Current waypoint index

    // Work tracking
    this.workTool = null;
    this.workTarget = '';
    this.workTimer = 0;
    this.totalWorkTime = 0;
    this.toolCounts = {};

    // Task tracking
    this.currentTask = null;
    this.tasksCompleted = 0;
    this.taskStartTime = 0;

    // [C] Team flag (set by CharacterManager)
    this._isCTeam = false;
    this._cTeamTimeout = 0;

    // Stun timer: blocks all state logic while > 0 (used by whip knockback)
    this.stunTimer = 0;

    // F1: auto-leave state
    this.alpha = 1;                // 렌더 시 곱해지는 투명도
    this._offscreen = false;        // true 면 드로우/충돌 제외
    this._idleBreakAccum = 0;       // IDLE_BREAK 누적 시간 (ms)
    this._fadeStart = 0;            // fade 시작 시각 (performance)

    // Stuck detection: position history sampled every STUCK_CHECK_INTERVAL ms
    this._posHistory = [];      // Array of {x, y} snapshots
    this._posTimer = 0;         // Accumulator for sampling interval

    // Physics reference (set by CharacterManager.initPhysics)
    this.physics = null;

    // Generate sprite
    this.sprite = generateSpriteSheet(name);
  }

  _randomIdleDelay() {
    return IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN);
  }

  _pickBreakWanderTarget() {
    const roll = Math.random();
    if (roll < 0.3) {
      // 30% → return to home position
      return { x: this.breakX, y: this.breakY };
    } else if (roll < 0.7) {
      // 40% → furniture interaction
      const fi = furnitureInteractions[Math.floor(Math.random() * furnitureInteractions.length)];
      return { x: fi.x * TILE_SIZE, y: fi.y * TILE_SIZE, interaction: fi };
    } else {
      // 30% → random wander
      const zone = breakWanderZones[Math.floor(Math.random() * breakWanderZones.length)];
      const tx = (zone.x + Math.random() * zone.w) * TILE_SIZE;
      const ty = (zone.y + Math.random() * zone.h) * TILE_SIZE;
      return { x: tx, y: ty };
    }
  }

  _directionTo(tx, ty) {
    const dx = tx - this.x;
    const dy = ty - this.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? DIR.RIGHT : DIR.LEFT;
    }
    return dy > 0 ? DIR.DOWN : DIR.UP;
  }

  // Generic walk to position
  walkTo(tx, ty, callback) {
    // Chris/boss stays at desk — never wander
    if (this.role === 'boss') return;
    this.path = null;
    this.pathIndex = 0;
    this.targetX = Math.max(TILE_SIZE, Math.min(MAP_W - TILE_SIZE, tx));
    this.targetY = Math.max(TILE_SIZE, Math.min(MAP_H - TILE_SIZE, ty));
    this.state = S.WALKING_TO;
    this.talkCallback = callback || null;
  }

  // [C] Team: activate tool indicator (stay seated)
  activateTool(tool, duration) {
    if (!this._isCTeam) return;
    this.workTool = tool;
    this.workTimer = 0;
    this._cTeamTimeout = duration || 8000;
    this.state = S.WORKING;
    this.dir = this.deskDir ?? 0;
  }

  // [C] Team: deactivate tool indicator (return to idle at desk)
  deactivateTool() {
    if (!this._isCTeam) return;
    this.workTool = null;
    this.workTarget = '';
    this.state = S.IDLE;
    this.dir = this.deskDir ?? 0;
    this._cTeamTimeout = 0;
  }

  // Agent: run from break room to desk and start working
  workAtDesk(tool, target) {
    if (this._isCTeam) return; // [C] team uses activateTool instead
    this.workTool = tool || 'Read';
    this.workTarget = target || '';
    this.workTimer = 0;
    this.active = true;

    // Track tool usage
    this.toolCounts[this.workTool] = (this.toolCounts[this.workTool] || 0) + 1;

    // Already at desk and working? Just update the tool
    if (this.state === S.WORKING) {
      return;
    }

    // Already running to desk? Keep running, update tool
    if (this.state === S.RUNNING_TO_DESK) {
      return;
    }

    this.path = null;
    this.pathIndex = 0;

    const arriveAtDesk = () => {
      this.state = S.WORKING;
      this.dir = this.deskDir ?? DIR.UP; // face monitor
      this.stateTimer = 0;
    };

    // If in break room (past the wall), go through doorway first
    if (this.x > 14 * TILE_SIZE) {
      this.targetX = DOOR_X;
      this.targetY = DOOR_Y;
      this.state = S.RUNNING_TO_DESK;
      this.talkCallback = () => {
        this.path = null;
        this.pathIndex = 0;
        this.targetX = this.homeX;
        this.targetY = this.homeY;
        this.state = S.RUNNING_TO_DESK;
        this.stateTimer = 0;
        this.talkCallback = arriveAtDesk;
      };
    } else {
      this.targetX = this.homeX;
      this.targetY = this.homeY;
      this.state = S.RUNNING_TO_DESK;
      this.talkCallback = arriveAtDesk;
    }
  }

  // Teleport to desk immediately (for state restoration on refresh)
  sitAtDesk(tool, target) {
    this.workTool = tool || 'Read';
    this.workTarget = target || '';
    this.workTimer = 0;
    this.active = true;
    this.x = this.homeX;
    this.y = this.homeY;
    this.targetX = this.homeX;
    this.targetY = this.homeY;
    // Sync physics body to desk position
    if (this.physics && this.physics.enabled) {
      this.physics.setPosition(this.name, this.homeX, this.homeY);
    }
    this.state = S.WORKING;
    this.dir = this.deskDir ?? DIR.UP;
    this.stateTimer = 0;
    this.talkCallback = null;
  }

  // Assign a task description
  assignTask(description, startTime) {
    const ts = startTime || Date.now();
    this.currentTask = { description, startTime: ts };
    this.taskStartTime = ts;
    this.active = true;
    // I3: Absolute lifetime TTL — assign 시점부터. 재진입으로 리셋 안 됨.
    this.lifetimeDeadline = ts + AGENT_ABSOLUTE_TTL;
    // F1: 퇴장 상태에서 재등장
    this._offscreen = false;
    this.alpha = 1;
    this._idleBreakAccum = 0;
    this._fadeStart = 0;
  }

  // Complete current task — walk back to break room (idempotent)
  completeTask() {
    if (this.role === 'boss') return;
    if (this._isCTeam) return; // [C] team never leaves desk
    // Idempotent: 이미 퇴근 중이거나 휴게실이면 중복 실행 방지
    if (this.state === S.WALKING_TO_BREAK || this.state === S.IDLE_BREAK || this.state === S.WALKING_BREAK) {
      return;
    }
    this.lifetimeDeadline = 0;
    if (this.currentTask) {
      this.tasksCompleted++;
      this.currentTask = null;
    }
    this.workTool = null;
    this.workTarget = '';
    this.active = false;

    this.path = null;
    this.pathIndex = 0;

    const arriveAtBreak = () => {
      this.state = S.IDLE_BREAK;
      // Keep last facing direction (don't reset to DOWN)
      this.stateTimer = 0;
      this.idleDelay = this._randomIdleDelay();
    };

    // If in office (before the wall), go through doorway first
    if (this.x < 15 * TILE_SIZE) {
      this.targetX = DOOR_X;
      this.targetY = DOOR_Y;
      this.state = S.WALKING_TO_BREAK;
      this.talkCallback = () => {
        this.path = null;
        this.pathIndex = 0;
        this.targetX = this.breakX;
        this.targetY = this.breakY;
        this.state = S.WALKING_TO_BREAK;
        this.stateTimer = 0;
        this.talkCallback = arriveAtBreak;
      };
    } else {
      this.targetX = this.breakX;
      this.targetY = this.breakY;
      this.state = S.WALKING_TO_BREAK;
      this.talkCallback = arriveAtBreak;
    }
  }

  talk(duration) {
    this._preTalkState = this.state;
    this.state = S.TALKING;
    this.stateTimer = 0;
    this.idleDelay = duration || 3000;
  }

  update(dt) {
    this.stateTimer += dt * 1000;
    this.frameTimer += dt * 1000;

    // Sync position from physics body
    if (this.physics && this.physics.enabled) {
      const pos = this.physics.getPosition(this.name);
      if (pos) { this.x = pos.x; this.y = pos.y; }
    }

    // Stun: physics handles knockback movement, skip pathfinding/state logic
    if (this.stunTimer > 0) {
      this.stunTimer -= dt * 1000;
      return;
    }

    // Animation speed varies by state
    let animSpeed;
    switch (this.state) {
      case S.RUNNING_TO_DESK: animSpeed = 100; break;
      case S.WALKING_BREAK:
      case S.WALKING_TO:
      case S.WALKING_TO_BREAK: animSpeed = 160; break;
      case S.WORKING: animSpeed = 400; break;
      default: animSpeed = 500;
    }

    if (this.frameTimer >= animSpeed) {
      this.frameTimer -= animSpeed;
      this.frame = (this.frame + 1) % 4;
    }

    switch (this.state) {
      case S.IDLE:
        // Chris/Player: just idle, no wandering
        break;

      case S.IDLE_BREAK:
        // F1: 휴게실 idle 누적 시간 추적 + 페이드 아웃
        if (!this._isCTeam && this.role !== 'boss' && this.role !== 'player') {
          this._idleBreakAccum += dt * 1000;
          if (this._offscreen) {
            // 이미 퇴장 — 아무것도 안 함
          } else if (this._fadeStart > 0) {
            // 페이드 진행 중
            const elapsed = Date.now() - this._fadeStart;
            this.alpha = Math.max(0, 1 - elapsed / FADE_OUT_MS);
            if (elapsed >= FADE_OUT_MS) {
              this._offscreen = true;
              this.alpha = 0;
              this.active = false;
            }
            break; // wander 건너뛰기
          } else if (this._idleBreakAccum >= AUTO_LEAVE_MS) {
            // 페이드 시작
            this._fadeStart = Date.now();
            break;
          }
        }
        // Agent in break room — occasionally wander or interact with furniture
        if (this.stateTimer >= this.idleDelay) {
          const target = this._pickBreakWanderTarget();
          this.targetX = target.x;
          this.targetY = target.y;
          this._pendingInteraction = target.interaction || null;
          this.state = S.WALKING_BREAK;
          this.stateTimer = 0;
          this._idleBreakAccum = 0; // wander 시작 시 누적 리셋
        }
        break;

      case S.WALKING_BREAK:
        this._moveToward(dt, WALK_SPEED);
        break;

      case S.WALKING_TO:
        this._moveToward(dt, WALK_SPEED);
        break;

      case S.WALKING_TO_BREAK:
        // Fast in office (desk→door), normal in break room (door→break pos)
        this._moveToward(dt, this.x < 15 * TILE_SIZE ? RUN_SPEED : WALK_SPEED);
        break;

      case S.RUNNING_TO_DESK:
        this._moveToward(dt, RUN_SPEED);
        break;

      case S.TALKING:
        if (this.stateTimer >= this.idleDelay) {
          // Return to previous state
          const prev = this._preTalkState;
          if (prev === S.WORKING) {
            this.state = prev;
          } else if (prev === S.INTERACTING) {
            this.state = S.INTERACTING;
          } else if (prev === S.IDLE_BREAK || prev === S.WALKING_BREAK) {
            this.state = S.IDLE_BREAK;
          } else {
            this.state = S.IDLE;
          }
          this.stateTimer = 0;
          this.idleDelay = this._randomIdleDelay();
        }
        break;

      case S.WORKING:
        this.workTimer += dt * 1000;
        this.totalWorkTime += dt * 1000;
        if (this._isCTeam) {
          // [C] team: auto-deactivate after timeout
          if (this._cTeamTimeout && this.workTimer >= this._cTeamTimeout) {
            this.deactivateTool();
          }
        } else {
          // I3: Absolute TTL 만 유지 (45s workTimer safety 제거 — 재진입 리셋되어 의미 없음).
          // 서버 SubagentStop/30s-idle-timeout/hook done 이 모두 실패해도 이 경로로 반드시 퇴근.
          if (this.lifetimeDeadline && Date.now() >= this.lifetimeDeadline) {
            this.completeTask();
          }
        }
        break;

      case S.INTERACTING:
        // Interacting with break room furniture (emoji shown by renderer)
        if (this.stateTimer >= (this._interactionDuration || 5000)) {
          this._interactionEmoji = null;
          this._interactionDuration = 0;
          this.state = S.IDLE_BREAK;
          this.stateTimer = 0;
          this.idleDelay = this._randomIdleDelay();
        }
        break;
    }
  }

  _moveToward(dt, speed) {
    // Stuck detection: sample position every STUCK_CHECK_INTERVAL ms
    this._posTimer += dt * 1000;
    if (this._posTimer >= STUCK_CHECK_INTERVAL) {
      this._posTimer -= STUCK_CHECK_INTERVAL;
      this._posHistory.push({ x: this.x, y: this.y });
      // Keep only the last STUCK_WINDOW + 1 samples
      if (this._posHistory.length > STUCK_WINDOW + 1) {
        this._posHistory.shift();
      }

      // Check if stuck: moved less than STUCK_THRESHOLD px over STUCK_WINDOW samples
      if (this._posHistory.length === STUCK_WINDOW + 1) {
        const oldest = this._posHistory[0];
        const dx = this.x - oldest.x;
        const dy = this.y - oldest.y;
        const moved = Math.sqrt(dx * dx + dy * dy);

        if (moved < STUCK_THRESHOLD) {
          // Stuck — 인접 walkable 타일 중 **원래 타겟에서 멀어지지 않는** 쪽 우선 선택.
          // 순수 랜덤이면 자주 "벽 반대쪽" 이 아니라 또 벽 쪽으로 튐 → 개선.
          const { x: tx, y: ty } = pixelToTile(this.x, this.y);
          const origTargetTile = pixelToTile(this.targetX, this.targetY);
          const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

          // 각 offset 을 원래 타겟과의 거리 감소량 기준으로 정렬 — 우회하되 전진하는 방향 우선.
          const scored = offsets.map(([ox, oy]) => {
            const nx = tx + ox;
            const ny = ty + oy;
            const distToOrig = Math.hypot(nx - origTargetTile.x, ny - origTargetTile.y);
            return { ox, oy, distToOrig, rand: Math.random() };
          });
          scored.sort((a, b) => a.distToOrig - b.distToOrig || a.rand - b.rand);

          for (const { ox, oy } of scored) {
            const nx = tx + ox;
            const ny = ty + oy;
            const testPath = findPath(tx, ty, nx, ny);
            if (testPath && testPath.length > 0) {
              const pixel = tileToPixel(nx, ny);
              this.path = null;
              this.pathIndex = 0;
              this.targetX = pixel.x;
              this.targetY = pixel.y;
              this._posHistory = [];
              this._posTimer = 0;
              break;
            }
          }
        }
      }
    }

    // If no active path, calculate one via A*
    if (!this.path || this.path.length === 0) {
      const start = pixelToTile(this.x, this.y);
      const end = pixelToTile(this.targetX, this.targetY);
      const tilePath = findPath(start.x, start.y, end.x, end.y);

      if (tilePath && tilePath.length > 1) {
        // Convert tile path to pixel waypoints, skipping first (current position)
        this.path = tilePath.slice(1).map(t => tileToPixel(t.x, t.y));
        this.pathIndex = 0;
      } else {
        // No valid path — fall back to direct movement
        this._moveDirectly(dt, speed);
        return;
      }
    }

    // Follow path waypoints
    if (this.pathIndex >= this.path.length) {
      this.path = null;
      this.pathIndex = 0;
      this._onArrival();
      return;
    }

    let waypoint = this.path[this.pathIndex];
    let dx = waypoint.x - this.x;
    let dy = waypoint.y - this.y;
    let dist = Math.sqrt(dx * dx + dy * dy);

    // Arrival threshold scales with speed to prevent overshoot at high velocities
    const baseV = speed / 60;
    const arriveThreshold = Math.max(baseV * 2, 8);

    // 중간 waypoint 는 snap + velocity=0 없이 다음 waypoint 로 연속 이동.
    // 기존: waypoint 마다 정지→재시작 → 뚝뚝 끊기는 체감의 주 원인.
    // 변경: 마지막 waypoint 에서만 snap (정확한 도착), 중간은 그냥 advance.
    while (dist < arriveThreshold && this.pathIndex < this.path.length - 1) {
      this.pathIndex++;
      waypoint = this.path[this.pathIndex];
      dx = waypoint.x - this.x;
      dy = waypoint.y - this.y;
      dist = Math.sqrt(dx * dx + dy * dy);
    }

    if (dist < arriveThreshold) {
      // 최종 waypoint 도착 — 여기서만 snap.
      this.x = waypoint.x;
      this.y = waypoint.y;
      if (this.physics && this.physics.enabled) {
        this.physics.setPosition(this.name, waypoint.x, waypoint.y);
        this.physics.setVelocity(this.name, 0, 0);
      }
      this.path = null;
      this.pathIndex = 0;
      this._onArrival();
      return;
    }

    // Physics velocity toward waypoint, clamped to prevent overshoot at the *final* waypoint only.
    // 중간 waypoint 에선 감속 없이 꾸준한 baseV 유지 → cornering smooth.
    this.dir = this._directionTo(waypoint.x, waypoint.y);
    const isLastWaypoint = this.pathIndex >= this.path.length - 1;
    const v = isLastWaypoint ? Math.min(baseV, dist * 0.4) : baseV;
    if (this.physics && this.physics.enabled) {
      this.physics.setVelocity(this.name, (dx / dist) * v, (dy / dist) * v);
    } else {
      const move = Math.min(speed * dt, dist);
      this.x += (dx / dist) * move;
      this.y += (dy / dist) * move;
    }
  }

  _moveDirectly(dt, speed) {
    // Fallback: direct movement when A* finds no path
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const baseV = speed / 60;
    const arriveThreshold = Math.max(baseV * 2, ARRIVE_DIST);

    if (dist < arriveThreshold) {
      this.x = this.targetX;
      this.y = this.targetY;
      if (this.physics && this.physics.enabled) {
        this.physics.setPosition(this.name, this.targetX, this.targetY);
        this.physics.setVelocity(this.name, 0, 0);
      }
      this._onArrival();
      return;
    }

    this.dir = this._directionTo(this.targetX, this.targetY);
    const v = Math.min(baseV, dist * 0.4);
    if (this.physics && this.physics.enabled) {
      this.physics.setVelocity(this.name, (dx / dist) * v, (dy / dist) * v);
    } else {
      const move = Math.min(speed * dt, dist);
      this.x += (dx / dist) * move;
      this.y += (dy / dist) * move;
    }
  }

  _onArrival() {
    // Stop physics movement on arrival
    if (this.physics && this.physics.enabled) {
      this.physics.setVelocity(this.name, 0, 0);
    }
    if (this.talkCallback) {
      this.talkCallback();
      this.talkCallback = null;
    } else if (this.state === S.WALKING_BREAK) {
      // Arrived at break room target — start interaction or idle
      if (this._pendingInteraction) {
        const fi = this._pendingInteraction;
        this._pendingInteraction = null;
        this._interactionEmoji = fi.emoji;
        this._interactionDuration = fi.duration;
        this.state = S.INTERACTING;
        this.stateTimer = 0;
      } else {
        this.state = S.IDLE_BREAK;
        this.stateTimer = 0;
        this.idleDelay = this._randomIdleDelay();
      }
    } else if (this.state === S.WALKING_TO_BREAK) {
      this.state = S.IDLE_BREAK;
      this.stateTimer = 0;
      this.idleDelay = this._randomIdleDelay();
    } else {
      this.state = S.IDLE;
      this.stateTimer = 0;
      this.idleDelay = this._randomIdleDelay();
    }
  }

  // Get sprite frame coords
  getFrameRect() {
    if (!this.sprite) return null;
    const { frameWidth: fw, frameHeight: fh } = this.sprite;
    let row, col;

    if (this.state === S.IDLE || this.state === S.IDLE_BREAK || this.state === S.TALKING || this.state === S.INTERACTING) {
      if (this._isCTeam) {
        row = this.deskDir ?? 0; // C-team faces desk direction (walk row)
      } else {
        row = this.dir; // face last walk direction
      }
      col = this.frame % 2;
    } else if (this.state === S.WORKING) {
      row = this.deskDir ?? 3; // face desk direction (UP for agents, DOWN for [C] team)
      col = this.frame % 2;
    } else {
      row = this.dir; // 0-3 for walk directions
      col = this.frame % 4;
    }

    return { sx: col * fw, sy: row * fh, sw: fw, sh: fh };
  }

  get sortY() {
    return this.y + 20;
  }

  get isWorking() {
    return this.state === S.WORKING || this.state === S.RUNNING_TO_DESK;
  }

  get isMoving() {
    return [S.WALKING_TO, S.WALKING_BREAK, S.RUNNING_TO_DESK, S.WALKING_TO_BREAK].includes(this.state);
  }

  get isInBreakRoom() {
    return this.state === S.IDLE_BREAK || this.state === S.WALKING_BREAK || this.state === S.INTERACTING;
  }

  // Task elapsed time in seconds
  get taskElapsed() {
    if (!this.currentTask) return 0;
    return Math.floor((Date.now() - this.currentTask.startTime) / 1000);
  }
}

export class CharacterManager {
  constructor() {
    this.characters = new Map();
    this._init();
  }

  _init() {
    // Chris — starts in office at his position
    const chrisPos = deskPositions['Chris'];
    const chris = new Character('Chris', 'boss', chrisPos.x, chrisPos.y);
    chris.active = true;
    chris.dir = 0; // Face DOWN (toward agents)
    this.characters.set('Chris', chris);

    // [C] Team — always at desk, never leave
    const cTeam = [
      ['Mia', 'c-read'], ['Kai', 'c-edit'],
      ['Zoe', 'c-grep'], ['Liam', 'c-glob'],
      ['Aria', 'c-write'], ['Noah', 'c-bash'],
      ['Luna', 'c-task'], ['Owen', 'c-other'],
    ];

    for (const [name, role] of cTeam) {
      const desk = deskPositions[name];
      if (desk) {
        const char = new Character(name, role, desk.x, desk.y);
        char._isCTeam = true;
        char.state = 'idle'; // Always at desk
        char.dir = desk.dir ?? 0; // Face DOWN toward monitors
        this.characters.set(name, char);
      }
    }

    // Regular agents — start in break room
    const agents = [
      ['Jake', 'explore'], ['David', 'oracle'], ['Kevin', 'sisyphus-junior'],
      ['Sophie', 'frontend-engineer'], ['Emily', 'document-writer'],
      ['Michael', 'librarian'], ['Alex', 'prometheus'], ['Sam', 'qa-tester'],
    ];

    for (const [name, role] of agents) {
      const brk = breakPositions[name];
      if (brk) {
        const char = new Character(name, role, brk.x, brk.y);
        this.characters.set(name, char);
      }
    }
  }

  initPhysics(physicsWorld) {
    for (const [name, char] of this.characters) {
      char.physics = physicsWorld;
      const isStatic = char.role === 'boss' || char._isCTeam;
      physicsWorld.addCharacter(name, char.x, char.y, { radius: 12, isStatic });
    }
  }

  get(name) {
    return this.characters.get(name);
  }

  update(dt) {
    for (const char of this.characters.values()) {
      char.update(dt);
    }
    // 커스텀 충돌 처리는 비활성화 — Matter.js body 가 이미 원형 충돌 + restitution 으로
    // 자연스럽게 튕김. 예전의 직접 위치 조작(±3px snap) + stun + path reset 이
    // 시각적으로 "짧게 워프하며 멈칫" 현상을 유발했음. Matter.js 에 위임하는 것이
    // setVelocity 를 매 프레임 덮어쓰는 구조와 더 잘 맞음.
    // this._checkCollisions();
  }

  _checkCollisions() {
    // Legacy — 호출되지 않지만 whip/stun 등 다른 경로가 참조할 수 있어 보존.
    const walkingStates = new Set([S.WALKING_BREAK, S.WALKING_TO, S.WALKING_TO_BREAK]);

    const eligible = [];
    for (const char of this.characters.values()) {
      if (char.role === 'boss' || char._isCTeam) continue;
      if (char.stunTimer > 0) continue;
      if (!walkingStates.has(char.state)) continue;
      eligible.push(char);
    }

    for (let i = 0; i < eligible.length; i++) {
      for (let j = i + 1; j < eligible.length; j++) {
        const a = eligible[i];
        const b = eligible[j];

        if (a.stunTimer > 0 || b.stunTimer > 0) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < COLLISION_DIST) {
          // Compute push direction (normalised); handle degenerate case
          let nx, ny;
          if (dist < 0.001) {
            // Perfectly overlapping — push in random direction
            const angle = Math.random() * Math.PI * 2;
            nx = Math.cos(angle);
            ny = Math.sin(angle);
          } else {
            nx = dx / dist;
            ny = dy / dist;
          }

          // Push a away from b, b away from a
          a.x -= nx * BOUNCE_FORCE;
          a.y -= ny * BOUNCE_FORCE;
          b.x += nx * BOUNCE_FORCE;
          b.y += ny * BOUNCE_FORCE;

          // Sync physics bodies if present
          if (a.physics && a.physics.enabled) {
            a.physics.setPosition(a.name, a.x, a.y);
            a.physics.setVelocity(a.name, 0, 0);
          }
          if (b.physics && b.physics.enabled) {
            b.physics.setPosition(b.name, b.x, b.y);
            b.physics.setVelocity(b.name, 0, 0);
          }

          // Clear paths so both recalculate after stun
          a.path = null;
          a.pathIndex = 0;
          b.path = null;
          b.pathIndex = 0;

          // Apply stun
          a.stunTimer = COLLISION_STUN;
          b.stunTimer = COLLISION_STUN;
        }
      }
    }
  }

  getSorted() {
    return [...this.characters.values()].sort((a, b) => a.sortY - b.sortY);
  }

  // Get active (working) regular agents (excludes [C] team)
  getActiveAgents() {
    return [...this.characters.values()].filter(c =>
      c.name !== 'Chris' && !c._isCTeam && c.isWorking
    );
  }

  // Get idle agents (in break room)
  getIdleAgents() {
    return [...this.characters.values()].filter(c =>
      c.name !== 'Chris' && !c._isCTeam && c.isInBreakRoom
    );
  }

  // Get [C] team members currently active
  getActiveCTeam() {
    return [...this.characters.values()].filter(c =>
      c._isCTeam && c.state === 'working'
    );
  }

  // Get stats for UI
  getStats() {
    const agents = [...this.characters.values()].filter(c =>
      c.name !== 'Chris' && !c._isCTeam
    );
    const cTeam = [...this.characters.values()].filter(c => c._isCTeam);
    return {
      total: agents.length,
      active: agents.filter(c => c.isWorking).length,
      idle: agents.filter(c => c.isInBreakRoom).length,
      tasksCompleted: agents.reduce((sum, c) => sum + c.tasksCompleted, 0),
      cTeamActive: cTeam.filter(c => c.state === 'working').length,
    };
  }

  getByRole(role) {
    for (const char of this.characters.values()) {
      if (char.role === role) return char;
    }
    const nameMap = {
      'explore': 'Jake', 'explore-medium': 'Jake',
      'oracle': 'David', 'oracle-medium': 'David', 'oracle-low': 'David',
      'sisyphus-junior': 'Kevin', 'sisyphus-junior-low': 'Kevin', 'sisyphus-junior-high': 'Kevin',
      'frontend-engineer': 'Sophie', 'frontend-engineer-low': 'Sophie', 'frontend-engineer-high': 'Sophie',
      'document-writer': 'Emily',
      'librarian': 'Michael', 'librarian-low': 'Michael',
      'prometheus': 'Alex',
      'qa-tester': 'Sam',
      // [C] Team
      'c-read': 'Mia', 'c-edit': 'Kai', 'c-grep': 'Zoe',
      'c-glob': 'Liam', 'c-write': 'Aria', 'c-bash': 'Noah',
      'c-task': 'Luna', 'c-other': 'Owen',
    };
    const name = nameMap[role];
    if (name) return this.characters.get(name);
    return null;
  }
}
