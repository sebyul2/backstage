// map.js — Office + Break Room map: tile data, collision, furniture, positions
// v2.5: Boss top, Lead middle, Agents bottom layout

export const TILE_SIZE = 48;
export const MAP_COLS = 30;
export const MAP_ROWS = 15;
export const MAP_W = MAP_COLS * TILE_SIZE; // 1440
export const MAP_H = MAP_ROWS * TILE_SIZE; // 720

// PICO-8 palette
export const PICO8 = [
  '#000000', '#1D2B53', '#7E2553', '#008751',
  '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8',
  '#FF004D', '#FFA300', '#FFEC27', '#00E436',
  '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA',
];

// Tile types (ground layer)
export const T = {
  FLOOR: 0,
  WALL: 1,
  FLOOR_ALT: 2,   // slightly different floor
  RUG: 3,
  BREAK_FLOOR: 4, // break room floor (warm carpet)
};

// Ground layer (30x15)
// Office: cols 0-17, Wall separator: cols 18-19, Break room: cols 20-28, Right wall: col 29
// Doorway at row 7 (cols 18-19 open)
export const groundMap = [
  // Row 0: top wall
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  // Row 1 (boss desk)
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 2 (boss chair + rug)
  [1,0,0,0,0,0,0,0,0,0,0,0,3,3,3,3,3,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 3 (rug + decorations)
  [1,0,0,0,0,0,0,0,0,0,0,0,3,3,3,3,3,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 4 (lead desk)
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 5 (lead chair)
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 6 (decorations)
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 7 (doorway — cols 18,19 open)
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,4,4,4,4,4,4,4,4,4,1],
  // Row 8 (top agent row)
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 9 (shared desks)
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 10 (shared desks)
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 11 (bottom agent row)
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 12 (decorations)
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 13
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 14: bottom wall
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

// Furniture objects — rendered as entities, y-sorted with characters
// x,y in tile coords; w,h in tiles
export const furniture = [
  // ═══ BOSS DESK (Player - CEO) — top of office ═══
  { type: 'bossChair', x: 14.125, y: 1.125, w: 0.75, h: 0.75 },
  { type: 'bossDesk', x: 13, y: 2, w: 3, h: 1 },
  { type: 'monitor', x: 13.5, y: 2, w: 0.6, h: 0.3, back: true },
  { type: 'monitor', x: 14.8, y: 2, w: 0.6, h: 0.3, back: true },

  // ═══ LEAD DESK (Chris - Team Lead) — middle ═══
  { type: 'leadChair', x: 9.125, y: 9.125, w: 0.75, h: 0.75 },
  { type: 'leadDesk', x: 8, y: 10, w: 3, h: 1 },
  { type: 'monitor', x: 9.1, y: 10, w: 0.8, h: 0.3, back: true },
  { type: 'paperStack', x: 10.2, y: 10.05, w: 0.8, h: 0.55 },

  // ═══ TOP DECORATIONS ═══
  { type: 'plant', x: 4, y: 5, w: 1, h: 1 },
  { type: 'plant', x: 12, y: 5, w: 1, h: 1 },
  { type: 'plant', x: 16, y: 4, w: 1, h: 1 },
  { type: 'water', x: 17, y: 6, w: 1, h: 1 },

  // ═══ [C] TEAM DESKS (LEFT side, rows 8+11) ═══
  // Row 8 top (facing DOWN)
  { type: 'desk', x: 2, y: 8, w: 2, h: 1 },
  { type: 'desk', x: 5, y: 8, w: 2, h: 1 },
  // Row 11 bottom (facing UP)
  { type: 'desk', x: 2, y: 11, w: 2, h: 1 },
  { type: 'desk', x: 5, y: 11, w: 2, h: 1 },

  // [C] Team monitors — row 8: on desk (back view), row 11: on desk (front view)
  { type: 'monitor', x: 2.2, y: 8, w: 0.6, h: 0.3, back: true },
  { type: 'monitor', x: 3.2, y: 8, w: 0.6, h: 0.3, back: true },
  { type: 'monitor', x: 5.2, y: 8, w: 0.6, h: 0.3, back: true },
  { type: 'monitor', x: 6.2, y: 8, w: 0.6, h: 0.3, back: true },
  { type: 'monitor', x: 2.2, y: 11, w: 0.6, h: 0.5 },
  { type: 'monitor', x: 3.2, y: 11, w: 0.6, h: 0.5 },
  { type: 'monitor', x: 5.2, y: 11, w: 0.6, h: 0.5 },
  { type: 'monitor', x: 6.2, y: 11, w: 0.6, h: 0.5 },

  // [C] Team chairs — row 8: above (center y:7.5), row 11: below (center y:12.5)
  { type: 'chair', x: 2.125, y: 7.125, w: 0.75, h: 0.75 },
  { type: 'chair', x: 3.125, y: 7.125, w: 0.75, h: 0.75 },
  { type: 'chair', x: 5.125, y: 7.125, w: 0.75, h: 0.75 },
  { type: 'chair', x: 6.125, y: 7.125, w: 0.75, h: 0.75 },
  { type: 'chair', x: 2.125, y: 12.125, w: 0.75, h: 0.75 },
  { type: 'chair', x: 3.125, y: 12.125, w: 0.75, h: 0.75 },
  { type: 'chair', x: 5.125, y: 12.125, w: 0.75, h: 0.75 },
  { type: 'chair', x: 6.125, y: 12.125, w: 0.75, h: 0.75 },

  // ═══ SEPARATOR (row 10) ═══
  { type: 'plant', x: 4, y: 10, w: 1, h: 1 },
  { type: 'plant', x: 14, y: 10, w: 1, h: 1 },

  // ═══ DASHBOARD BOARD (left wall, rows 5-6) ═══
  { type: 'dashboardBoard', x: 1, y: 1, w: 11, h: 4 },

  // ═══ AGENT DESKS (RIGHT side, rows 8+11) ═══
  // Row 8 top (facing DOWN)
  { type: 'desk', x: 12, y: 8, w: 2, h: 1 },
  { type: 'desk', x: 15, y: 8, w: 2, h: 1 },
  // Row 11 bottom (facing UP)
  { type: 'desk', x: 12, y: 11, w: 2, h: 1 },
  { type: 'desk', x: 15, y: 11, w: 2, h: 1 },

  // Agent monitors — row 8: on desk (back view), row 11: on desk (front view)
  { type: 'monitor', x: 12.2, y: 8, w: 0.6, h: 0.3, back: true },
  { type: 'monitor', x: 13.2, y: 8, w: 0.6, h: 0.3, back: true },
  { type: 'monitor', x: 15.2, y: 8, w: 0.6, h: 0.3, back: true },
  { type: 'monitor', x: 16.2, y: 8, w: 0.6, h: 0.3, back: true },
  { type: 'monitor', x: 12.2, y: 11, w: 0.6, h: 0.5 },
  { type: 'monitor', x: 13.2, y: 11, w: 0.6, h: 0.5 },
  { type: 'monitor', x: 15.2, y: 11, w: 0.6, h: 0.5 },
  { type: 'monitor', x: 16.2, y: 11, w: 0.6, h: 0.5 },

  // Agent chairs — row 8: above (center y:7.5), row 11: below (center y:12.5)
  { type: 'chair', x: 12.125, y: 7.125, w: 0.75, h: 0.75 },
  { type: 'chair', x: 13.125, y: 7.125, w: 0.75, h: 0.75 },
  { type: 'chair', x: 15.125, y: 7.125, w: 0.75, h: 0.75 },
  { type: 'chair', x: 16.125, y: 7.125, w: 0.75, h: 0.75 },
  { type: 'chair', x: 12.125, y: 12.125, w: 0.75, h: 0.75 },
  { type: 'chair', x: 13.125, y: 12.125, w: 0.75, h: 0.75 },
  { type: 'chair', x: 15.125, y: 12.125, w: 0.75, h: 0.75 },
  { type: 'chair', x: 16.125, y: 12.125, w: 0.75, h: 0.75 },

  // Bottom decorations
  { type: 'bookshelf', x: 2, y: 13, w: 2, h: 1 },
  { type: 'coffee', x: 17, y: 13, w: 1, h: 1 },

  // ═══ BREAK ROOM (right side) ═══
  { type: 'sofa', x: 23, y: 2, w: 3, h: 2 },
  { type: 'plant', x: 21, y: 2, w: 1, h: 1 },
  { type: 'coffee', x: 27, y: 2, w: 1, h: 1 },
  { type: 'sofa', x: 21, y: 5, w: 2, h: 1 },
  { type: 'water', x: 27, y: 4, w: 1, h: 1 },
  { type: 'plant', x: 26, y: 6, w: 1, h: 1 },
  { type: 'breakTable', x: 23, y: 8, w: 2, h: 2 },
  { type: 'chair', x: 22.125, y: 8.125, w: 0.75, h: 0.75 },
  { type: 'chair', x: 25.125, y: 8.125, w: 0.75, h: 0.75 },
  { type: 'chair', x: 22.125, y: 9.125, w: 0.75, h: 0.75 },
  { type: 'chair', x: 25.125, y: 9.125, w: 0.75, h: 0.75 },
  { type: 'vending', x: 23, y: 11, w: 1, h: 2 },
  { type: 'bookshelf', x: 21, y: 12, w: 2, h: 1 },
  { type: 'plant', x: 27, y: 12, w: 1, h: 1 },
];

// Collision map — true = blocked
const collisionMap = Array.from({ length: MAP_ROWS }, () =>
  Array.from({ length: MAP_COLS }, () => false)
);

// Walls are always blocked
for (let r = 0; r < MAP_ROWS; r++) {
  for (let c = 0; c < MAP_COLS; c++) {
    if (groundMap[r][c] === T.WALL) {
      collisionMap[r][c] = true;
    }
  }
}

// Furniture collision
const BLOCKING_FURNITURE = ['desk', 'leadDesk', 'bossDesk', 'plant', 'coffee', 'dashboardBoard', 'water', 'bookshelf', 'sofa', 'breakTable', 'vending'];
for (const f of furniture) {
  if (!BLOCKING_FURNITURE.includes(f.type)) continue;
  const x0 = Math.floor(f.x);
  const y0 = Math.floor(f.y);
  const x1 = Math.ceil(f.x + f.w);
  const y1 = Math.ceil(f.y + f.h);
  for (let r = y0; r < y1 && r < MAP_ROWS; r++) {
    for (let c = x0; c < x1 && c < MAP_COLS; c++) {
      collisionMap[r][c] = true;
    }
  }
}

export function isWalkable(tileX, tileY) {
  if (tileX < 0 || tileX >= MAP_COLS || tileY < 0 || tileY >= MAP_ROWS) return false;
  return !collisionMap[tileY][tileX];
}

export function isPixelWalkable(px, py) {
  const tx = Math.floor(px / TILE_SIZE);
  const ty = Math.floor(py / TILE_SIZE);
  return isWalkable(tx, ty);
}

// ─── Character positions ──────────────────────────────────────

// Desk positions (pixel coords) — where agents SIT when working
export const deskPositions = {
  'Chris':   { x: 9.5 * TILE_SIZE, y: 9.5 * TILE_SIZE, dir: 0 },
  // [C] Team LEFT — top row 8 (face DOWN, chair center y:7.5) + bottom row 11 (face UP, center y:12.5)
  'Mia':  { x: 2.5 * TILE_SIZE, y: 7.5 * TILE_SIZE, dir: 0 },
  'Kai':  { x: 3.5 * TILE_SIZE, y: 7.5 * TILE_SIZE, dir: 0 },
  'Zoe':  { x: 5.5 * TILE_SIZE, y: 7.5 * TILE_SIZE, dir: 0 },
  'Liam': { x: 6.5 * TILE_SIZE, y: 7.5 * TILE_SIZE, dir: 0 },
  'Aria': { x: 2.5 * TILE_SIZE, y: 12.5 * TILE_SIZE, dir: 3 },
  'Noah': { x: 3.5 * TILE_SIZE, y: 12.5 * TILE_SIZE, dir: 3 },
  'Luna': { x: 5.5 * TILE_SIZE, y: 12.5 * TILE_SIZE, dir: 3 },
  'Owen': { x: 6.5 * TILE_SIZE, y: 12.5 * TILE_SIZE, dir: 3 },
  // Agents RIGHT — top row 8 (face DOWN, chair center y:7.5) + bottom row 11 (face UP, center y:12.5)
  'Jake':    { x: 12.5 * TILE_SIZE, y: 7.5 * TILE_SIZE, dir: 0 },
  'Emily':   { x: 13.5 * TILE_SIZE, y: 7.5 * TILE_SIZE, dir: 0 },
  'David':   { x: 15.5 * TILE_SIZE, y: 7.5 * TILE_SIZE, dir: 0 },
  'Michael': { x: 16.5 * TILE_SIZE, y: 7.5 * TILE_SIZE, dir: 0 },
  'Kevin':   { x: 12.5 * TILE_SIZE, y: 12.5 * TILE_SIZE, dir: 3 },
  'Alex':    { x: 13.5 * TILE_SIZE, y: 12.5 * TILE_SIZE, dir: 3 },
  'Sophie':  { x: 15.5 * TILE_SIZE, y: 12.5 * TILE_SIZE, dir: 3 },
  'Sam':     { x: 16.5 * TILE_SIZE, y: 12.5 * TILE_SIZE, dir: 3 },
};

// Break room positions (pixel coords) — where agents IDLE when not working
// Only regular agents (8) — [C] team never leaves their desks
export const breakPositions = {
  'Jake':    { x: 21.5 * TILE_SIZE, y: 4 * TILE_SIZE },
  'Emily':   { x: 22.5 * TILE_SIZE, y: 6 * TILE_SIZE },
  'David':   { x: 26 * TILE_SIZE,   y: 5 * TILE_SIZE },
  'Michael': { x: 27 * TILE_SIZE,   y: 3 * TILE_SIZE },
  'Kevin':   { x: 24.5 * TILE_SIZE, y: 10 * TILE_SIZE },
  'Alex':    { x: 26 * TILE_SIZE,   y: 9 * TILE_SIZE },
  'Sophie':  { x: 21.5 * TILE_SIZE, y: 13 * TILE_SIZE },
  'Sam':     { x: 25 * TILE_SIZE,   y: 6 * TILE_SIZE },
};

// Break room wander zones — agents wander here when idle
export const breakWanderZones = [
  { x: 21, y: 1, w: 7, h: 3 },   // near sofa
  { x: 21, y: 5, w: 7, h: 4 },   // middle area
  { x: 21, y: 10, w: 7, h: 3 },  // near vending
];

// ─── Furniture interaction points (break room) ───────────────
// Agents walk here and "interact" with nearby furniture (emoji + pause)
export const furnitureInteractions = [
  { name: 'coffee',    x: 26.5, y: 2.5, emoji: '☕', duration: 5000 },
  { name: 'vending',   x: 24,   y: 11.5, emoji: '🥤', duration: 3500 },
  { name: 'sofa',      x: 22,   y: 4,   emoji: '💤', duration: 8000 },
  { name: 'bookshelf', x: 21.5, y: 11,  emoji: '📚', duration: 6000 },
  { name: 'table',     x: 22.5, y: 8.5, emoji: '🃏', duration: 5000 },
  { name: 'water',     x: 26.5, y: 4.5, emoji: '💧', duration: 3000 },
  { name: 'lounge',    x: 21,   y: 6.5, emoji: '😴', duration: 7000 },
];

// Player spawn position (at boss desk — top of office)
export const playerSpawn = { x: 14.5 * TILE_SIZE, y: 1.5 * TILE_SIZE };
