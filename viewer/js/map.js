// map.js — Office + Break Room map: tile data, collision, furniture, positions
// v2.1: 30x15 grid (1440x720), break room on right side

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
  // Row 1
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 2 (desks)
  [1,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 3 (desks + sofa in break)
  [1,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 4
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 5
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 6 (plants)
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 7 (doorway — cols 18,19 open)
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,4,4,4,4,4,4,4,4,4,1],
  // Row 8 (rug + break table)
  [1,0,0,0,0,0,3,3,3,3,3,0,0,0,0,0,0,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 9
  [1,0,0,0,0,0,3,3,3,3,3,0,0,0,0,0,0,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 10
  [1,0,0,0,0,0,3,3,3,3,3,0,0,0,0,0,0,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 11 (coffee, vending)
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 12 (bookshelves)
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 13
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,4,4,4,4,4,4,4,4,4,1],
  // Row 14: bottom wall
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

// Furniture objects — rendered as entities, y-sorted with characters
// x,y in tile coords; w,h in tiles
export const furniture = [
  // ═══ OFFICE (left side) ═══

  // Desks (left cluster)
  { type: 'desk', x: 2, y: 2, w: 2, h: 2 },
  { type: 'desk', x: 5, y: 2, w: 2, h: 2 },
  // Desks (right cluster)
  { type: 'desk', x: 12, y: 2, w: 2, h: 2 },
  { type: 'desk', x: 15, y: 2, w: 2, h: 2 },

  // Monitors — bottom row (top edge of desk, facing bottom-row agents)
  { type: 'monitor', x: 2.3, y: 2.1, w: 0.6, h: 0.5 },
  { type: 'monitor', x: 3.3, y: 2.1, w: 0.6, h: 0.5 },
  { type: 'monitor', x: 5.3, y: 2.1, w: 0.6, h: 0.5 },
  { type: 'monitor', x: 6.3, y: 2.1, w: 0.6, h: 0.5 },
  { type: 'monitor', x: 12.3, y: 2.1, w: 0.6, h: 0.5 },
  { type: 'monitor', x: 13.3, y: 2.1, w: 0.6, h: 0.5 },
  { type: 'monitor', x: 15.3, y: 2.1, w: 0.6, h: 0.5 },
  { type: 'monitor', x: 16.3, y: 2.1, w: 0.6, h: 0.5 },

  // Monitors — top row (bottom edge of desk, facing top-row agents)
  { type: 'monitor', x: 2.3, y: 3.5, w: 0.6, h: 0.5 },
  { type: 'monitor', x: 3.3, y: 3.5, w: 0.6, h: 0.5 },
  { type: 'monitor', x: 5.3, y: 3.5, w: 0.6, h: 0.5 },
  { type: 'monitor', x: 6.3, y: 3.5, w: 0.6, h: 0.5 },
  { type: 'monitor', x: 12.3, y: 3.5, w: 0.6, h: 0.5 },
  { type: 'monitor', x: 13.3, y: 3.5, w: 0.6, h: 0.5 },
  { type: 'monitor', x: 15.3, y: 3.5, w: 0.6, h: 0.5 },
  { type: 'monitor', x: 16.3, y: 3.5, w: 0.6, h: 0.5 },

  // Chairs — bottom row (below desks, face UP)
  { type: 'chair', x: 2.3, y: 3.8, w: 0.7, h: 0.7 },
  { type: 'chair', x: 3.3, y: 3.8, w: 0.7, h: 0.7 },
  { type: 'chair', x: 5.3, y: 3.8, w: 0.7, h: 0.7 },
  { type: 'chair', x: 6.3, y: 3.8, w: 0.7, h: 0.7 },
  { type: 'chair', x: 12.3, y: 3.8, w: 0.7, h: 0.7 },
  { type: 'chair', x: 13.3, y: 3.8, w: 0.7, h: 0.7 },
  { type: 'chair', x: 15.3, y: 3.8, w: 0.7, h: 0.7 },
  { type: 'chair', x: 16.3, y: 3.8, w: 0.7, h: 0.7 },

  // Chairs — top row (above desks, face DOWN)
  { type: 'chair', x: 2.3, y: 1.3, w: 0.7, h: 0.7 },
  { type: 'chair', x: 3.3, y: 1.3, w: 0.7, h: 0.7 },
  { type: 'chair', x: 5.3, y: 1.3, w: 0.7, h: 0.7 },
  { type: 'chair', x: 6.3, y: 1.3, w: 0.7, h: 0.7 },
  { type: 'chair', x: 12.3, y: 1.3, w: 0.7, h: 0.7 },
  { type: 'chair', x: 13.3, y: 1.3, w: 0.7, h: 0.7 },
  { type: 'chair', x: 15.3, y: 1.3, w: 0.7, h: 0.7 },
  { type: 'chair', x: 16.3, y: 1.3, w: 0.7, h: 0.7 },

  // Plants (office)
  { type: 'plant', x: 4, y: 6, w: 1, h: 1 },
  { type: 'plant', x: 15, y: 6, w: 1, h: 1 },

  // Coffee machine (left wall)
  { type: 'coffee', x: 2, y: 11, w: 1, h: 1 },

  // Whiteboard
  { type: 'whiteboard', x: 14, y: 11, w: 2, h: 2 },

  // Water cooler
  { type: 'water', x: 2, y: 7, w: 1, h: 1 },

  // Bookshelf (bottom)
  { type: 'bookshelf', x: 5, y: 12, w: 2, h: 1 },

  // ═══ BREAK ROOM (right side) ═══

  // Sofa (top area)
  { type: 'sofa', x: 23, y: 2, w: 3, h: 2 },

  // Break table (middle)
  { type: 'breakTable', x: 23, y: 8, w: 2, h: 2 },

  // Vending machine
  { type: 'vending', x: 23, y: 11, w: 1, h: 2 },

  // Plant (break room)
  { type: 'plant', x: 26, y: 11, w: 1, h: 1 },

  // ═══ LEAD DESK (Chris - Team Lead) ═══
  { type: 'leadDesk', x: 8, y: 5, w: 3, h: 1 },
  { type: 'monitor', x: 9.1, y: 5.1, w: 0.8, h: 0.5 },
  { type: 'leadChair', x: 9.1, y: 6.0, w: 0.8, h: 0.8 },

  // ═══ BOSS DESK (Player - CEO) ═══
  { type: 'bossDesk', x: 7, y: 11, w: 3, h: 1 },
  { type: 'monitor', x: 7.5, y: 11.1, w: 0.6, h: 0.5 },
  { type: 'monitor', x: 8.8, y: 11.1, w: 0.6, h: 0.5 },
  { type: 'bossChair', x: 8.0, y: 12.0, w: 1.2, h: 1.2 },
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
const BLOCKING_FURNITURE = ['desk', 'leadDesk', 'bossDesk', 'plant', 'coffee', 'whiteboard', 'water', 'bookshelf', 'sofa', 'breakTable', 'vending'];
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
  'Chris':   { x: 9.5 * TILE_SIZE, y: 6.15 * TILE_SIZE },
  // Bottom row (face UP — dir:3)
  'Jake':    { x: 2.5 * TILE_SIZE, y: 4.15 * TILE_SIZE },
  'Emily':   { x: 3.5 * TILE_SIZE, y: 4.15 * TILE_SIZE },
  'David':   { x: 5.5 * TILE_SIZE, y: 4.15 * TILE_SIZE },
  'Michael': { x: 6.5 * TILE_SIZE, y: 4.15 * TILE_SIZE },
  'Kevin':   { x: 12.5 * TILE_SIZE, y: 4.15 * TILE_SIZE },
  'Alex':    { x: 13.5 * TILE_SIZE, y: 4.15 * TILE_SIZE },
  'Sophie':  { x: 15.5 * TILE_SIZE, y: 4.15 * TILE_SIZE },
  'Sam':     { x: 16.5 * TILE_SIZE, y: 4.15 * TILE_SIZE },
  // Top row (face DOWN — dir:0)
  'Ethan':   { x: 2.5 * TILE_SIZE, y: 1.85 * TILE_SIZE, dir: 0 },
  'Rachel':  { x: 3.5 * TILE_SIZE, y: 1.85 * TILE_SIZE, dir: 0 },
  'Leo':     { x: 5.5 * TILE_SIZE, y: 1.85 * TILE_SIZE, dir: 0 },
  'Daniel':  { x: 6.5 * TILE_SIZE, y: 1.85 * TILE_SIZE, dir: 0 },
  'Max':     { x: 12.5 * TILE_SIZE, y: 1.85 * TILE_SIZE, dir: 0 },
  'Tyler':   { x: 13.5 * TILE_SIZE, y: 1.85 * TILE_SIZE, dir: 0 },
  'Ryan':    { x: 15.5 * TILE_SIZE, y: 1.85 * TILE_SIZE, dir: 0 },
  'Eric':    { x: 16.5 * TILE_SIZE, y: 1.85 * TILE_SIZE, dir: 0 },
};

// Break room positions (pixel coords) — where agents IDLE when not working
export const breakPositions = {
  'Jake':    { x: 21.5 * TILE_SIZE, y: 4 * TILE_SIZE },
  'Emily':   { x: 22.5 * TILE_SIZE, y: 6 * TILE_SIZE },
  'David':   { x: 26 * TILE_SIZE,   y: 5 * TILE_SIZE },
  'Michael': { x: 27 * TILE_SIZE,   y: 3 * TILE_SIZE },
  'Kevin':   { x: 24.5 * TILE_SIZE, y: 10 * TILE_SIZE },
  'Alex':    { x: 26 * TILE_SIZE,   y: 9 * TILE_SIZE },
  'Sophie':  { x: 21.5 * TILE_SIZE, y: 12 * TILE_SIZE },
  'Sam':     { x: 25 * TILE_SIZE,   y: 6 * TILE_SIZE },
  'Ethan':   { x: 23.5 * TILE_SIZE, y: 3 * TILE_SIZE },
  'Rachel':  { x: 27 * TILE_SIZE,   y: 7 * TILE_SIZE },
  'Leo':     { x: 24 * TILE_SIZE,   y: 5 * TILE_SIZE },
  'Daniel':  { x: 22 * TILE_SIZE,   y: 9 * TILE_SIZE },
  'Max':     { x: 23 * TILE_SIZE,   y: 11 * TILE_SIZE },
  'Tyler':   { x: 26 * TILE_SIZE,   y: 11 * TILE_SIZE },
  'Ryan':    { x: 24.5 * TILE_SIZE, y: 7 * TILE_SIZE },
  'Eric':    { x: 27.5 * TILE_SIZE, y: 10 * TILE_SIZE },
};

// Break room wander zones — agents wander here when idle
export const breakWanderZones = [
  { x: 21, y: 1, w: 7, h: 3 },   // near sofa
  { x: 21, y: 5, w: 7, h: 4 },   // middle area
  { x: 21, y: 10, w: 7, h: 3 },  // near vending
];

// Player spawn position (at boss desk)
export const playerSpawn = { x: 8.5 * TILE_SIZE, y: 12.5 * TILE_SIZE };
