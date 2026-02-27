// character.js — Character class: position, state machine, animation, movement
// v2.1: break room lifecycle, no random office wandering

import { TILE_SIZE, deskPositions, breakPositions, breakWanderZones, MAP_W, MAP_H } from './map.js?v=2.5';
import { findPath, pixelToTile, tileToPixel } from './pathfinding.js?v=2.5';
import { generateSpriteSheet } from './sprite-generator.js?v=2.5';

// States
const S = {
  IDLE: 'idle',                       // Chris/Player idle in office
  IDLE_BREAK: 'idle_break',           // Agent idle in break room
  WALKING_BREAK: 'walking_break',     // Agent wandering in break room
  WALKING_TO: 'walking_to',           // Generic walk to target
  RUNNING_TO_DESK: 'running_to_desk', // Agent: break room → desk
  WORKING: 'working',                 // Agent at desk working
  WALKING_TO_BREAK: 'walking_to_break', // Agent: desk → break room
  TALKING: 'talking',                 // Showing speech bubble
};

// Direction: 0=down, 1=left, 2=right, 3=up
const DIR = { DOWN: 0, LEFT: 1, RIGHT: 2, UP: 3 };

const WALK_SPEED = 55;    // pixels per second (normal wandering)
const RUN_SPEED = 1200;   // running to desk (10x fast)
const IDLE_MIN = 4000;   // ms before break room wander
const IDLE_MAX = 10000;
const ARRIVE_DIST = 6;
const DOOR_X = 19 * TILE_SIZE;
const DOOR_Y = 7.5 * TILE_SIZE;

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

    // Generate sprite
    this.sprite = generateSpriteSheet(name);
  }

  _randomIdleDelay() {
    return IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN);
  }

  _pickBreakWanderTarget() {
    // 30% chance to return to break home position
    if (Math.random() < 0.3) {
      return { x: this.breakX, y: this.breakY };
    }
    const zone = breakWanderZones[Math.floor(Math.random() * breakWanderZones.length)];
    const tx = (zone.x + Math.random() * zone.w) * TILE_SIZE;
    const ty = (zone.y + Math.random() * zone.h) * TILE_SIZE;
    return { x: tx, y: ty };
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

  // Agent: run from break room to desk and start working
  workAtDesk(tool, target) {
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
    if (this.x > 18 * TILE_SIZE) {
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
  }

  // Complete current task — walk back to break room
  completeTask() {
    // Boss never leaves desk
    if (this.role === 'boss') return;
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
      this.dir = DIR.DOWN;
      this.stateTimer = 0;
      this.idleDelay = this._randomIdleDelay();
    };

    // If in office (before the wall), go through doorway first
    if (this.x < 19 * TILE_SIZE) {
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
        // Agent in break room — occasionally wander
        if (this.stateTimer >= this.idleDelay) {
          const target = this._pickBreakWanderTarget();
          this.targetX = target.x;
          this.targetY = target.y;
          this.state = S.WALKING_BREAK;
          this.stateTimer = 0;
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
        this._moveToward(dt, this.x < 19 * TILE_SIZE ? RUN_SPEED : WALK_SPEED);
        break;

      case S.RUNNING_TO_DESK:
        this._moveToward(dt, RUN_SPEED);
        break;

      case S.TALKING:
        if (this.stateTimer >= this.idleDelay) {
          // Return to previous state
          const prev = this._preTalkState;
          if (prev === S.WORKING) {
            this.state = S.WORKING;
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
        // Safety timeout: if no new work event for 45s, assume task done (handles interrupts)
        if (this.workTimer > 45000) {
          this.completeTask();
        }
        break;
    }
  }

  _moveToward(dt, speed) {
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

    const waypoint = this.path[this.pathIndex];
    const dx = waypoint.x - this.x;
    const dy = waypoint.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 4) {
      // Close enough to this waypoint — advance to next
      this.pathIndex++;
      if (this.pathIndex >= this.path.length) {
        this.path = null;
        this.pathIndex = 0;
        this._onArrival();
      }
      return;
    }

    // Move toward current waypoint
    this.dir = this._directionTo(waypoint.x, waypoint.y);
    const move = Math.min(speed * dt, dist);
    this.x += (dx / dist) * move;
    this.y += (dy / dist) * move;
  }

  _moveDirectly(dt, speed) {
    // Fallback: direct movement when A* finds no path
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < ARRIVE_DIST) {
      this._onArrival();
      return;
    }

    this.dir = this._directionTo(this.targetX, this.targetY);
    const move = Math.min(speed * dt, dist);
    this.x += (dx / dist) * move;
    this.y += (dy / dist) * move;
  }

  _onArrival() {
    if (this.talkCallback) {
      this.talkCallback();
      this.talkCallback = null;
    } else if (this.state === S.WALKING_BREAK || this.state === S.WALKING_TO_BREAK) {
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

    if (this.state === S.IDLE || this.state === S.IDLE_BREAK || this.state === S.TALKING) {
      row = 4; // idle row
      col = this.frame % 2;
    } else if (this.state === S.WORKING) {
      row = 3; // face up (toward desk)
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
    return this.state === S.IDLE_BREAK || this.state === S.WALKING_BREAK;
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
    chris.dir = 3; // Face UP (toward desk/monitor)
    this.characters.set('Chris', chris);

    // Agents — start in break room
    const agents = [
      // Bottom row (face UP)
      ['Jake', 'explore'], ['David', 'oracle'], ['Kevin', 'sisyphus-junior'],
      ['Sophie', 'frontend-engineer'], ['Emily', 'document-writer'],
      ['Michael', 'librarian'], ['Alex', 'prometheus'], ['Sam', 'qa-tester'],
      // Top row (face DOWN)
      ['Ethan', 'code-reviewer'], ['Rachel', 'critic'], ['Leo', 'debugger'],
      ['Daniel', 'scientist'], ['Max', 'build-fixer'], ['Tyler', 'test-engineer'],
      ['Ryan', 'security-reviewer'], ['Eric', 'git-master'],
    ];

    for (const [name, role] of agents) {
      const brk = breakPositions[name];
      if (brk) {
        const char = new Character(name, role, brk.x, brk.y);
        this.characters.set(name, char);
      }
    }
  }

  get(name) {
    return this.characters.get(name);
  }

  update(dt) {
    for (const char of this.characters.values()) {
      char.update(dt);
    }
  }

  getSorted() {
    return [...this.characters.values()].sort((a, b) => a.sortY - b.sortY);
  }

  // Get active (working) agents
  getActiveAgents() {
    return [...this.characters.values()].filter(c => c.name !== 'Chris' && c.isWorking);
  }

  // Get idle agents (in break room)
  getIdleAgents() {
    return [...this.characters.values()].filter(c => c.name !== 'Chris' && c.isInBreakRoom);
  }

  // Get stats for UI
  getStats() {
    const agents = [...this.characters.values()].filter(c => c.name !== 'Chris');
    return {
      total: agents.length,
      active: agents.filter(c => c.isWorking).length,
      idle: agents.filter(c => c.isInBreakRoom).length,
      tasksCompleted: agents.reduce((sum, c) => sum + c.tasksCompleted, 0),
    };
  }

  getByRole(role) {
    for (const char of this.characters.values()) {
      if (char.role === role) return char;
    }
    const nameMap = {
      'explore': 'Jake', 'explore-medium': 'Jake',
      'oracle': 'David', 'oracle-medium': 'David',
      'sisyphus-junior': 'Kevin', 'sisyphus-junior-low': 'Kevin', 'sisyphus-junior-high': 'Kevin',
      'frontend-engineer': 'Sophie', 'frontend-engineer-low': 'Sophie', 'frontend-engineer-high': 'Sophie',
      'document-writer': 'Emily',
      'librarian': 'Michael', 'librarian-low': 'Michael',
      'prometheus': 'Alex',
      'qa-tester': 'Sam',
    };
    const name = nameMap[role];
    if (name) return this.characters.get(name);
    return null;
  }
}
