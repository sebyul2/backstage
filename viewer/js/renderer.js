// renderer.js — Canvas 2D drawing: Gather Town style office + break room
// v2.1: break room rendering, enhanced info display
// 48px tile version

import { TILE_SIZE, MAP_COLS, MAP_ROWS, MAP_W, MAP_H, PICO8, groundMap, furniture, T } from './map.js';
import { TOOL_ICONS } from './character.js';

const TS = TILE_SIZE;

// ─── Gather Town-inspired palette ─────────────────────────────
const PAL = {
  floorWood1: '#8B7355',    floorWood2: '#7D6548',
  floorWood3: '#9A8262',    floorWoodGap: '#6B5538',
  floorAlt1:  '#7A6A50',    floorAlt2:   '#6E5E44',
  wallBase:   '#4A5568',    wallTop:     '#5A6A7E',
  wallDark:   '#374151',    wallBoard:   '#6B7A8E',
  baseboard:  '#8B6914',    baseboardDk: '#6B4F0E',
  rugMain:    '#8B4D6E',    rugPattern:  '#A05E82',
  rugBorder:  '#6B3752',    rugFringe:   '#C27890',
  // Break room floor
  breakFloor1: '#7A6E5A',   breakFloor2: '#6E6250',
  breakFloorGap: '#5A5040',
  breakCarpet1: '#6B6058',  breakCarpet2: '#5F5448',
  shadow:     'rgba(0,0,0,0.18)',
  shadowDark: 'rgba(0,0,0,0.30)',
  deskTop:    '#C4A672',    deskFront:   '#A08050',
  deskEdge:   '#D4B882',    deskLeg:     '#7A6030',
  deskShadow: 'rgba(90,60,20,0.15)',
  monitorBody:'#2D3748',    monitorScreen:'#1A202C',
  monitorGlow:'rgba(41,173,255,0.12)',
  chairSeat:  '#4A5568',    chairCushion:'#5A6A80',
  plantPot:   '#C67B4A',    plantPotDk:  '#A06030',
  leafDark:   '#2D6B3F',    leafBright:  '#48BB78',
  leafMid:    '#38A169',
  whiteboardFrame: '#CBD5E0', whiteboardBg: '#F7FAFC',
  coffeeBody: '#718096',    coffeeDark: '#4A5568',
  bookColors: ['#E53E3E','#3182CE','#38A169','#D69E2E','#D53F8C','#805AD5','#DD6B20'],
  // Break room furniture
  sofaBase:   '#6B4D7A',    sofaCushion: '#8B6DA0',
  sofaArm:    '#5A3D6A',    sofaPillow:  '#A888C0',
  vendBody:   '#4A5568',    vendFront:   '#5A6A80',
  vendScreen: '#2D3748',    vendGlow:    '#4FD1C5',
  breakTableTop: '#9A7E5A', breakTableLeg: '#6B5538',
};

// ─── Name colors per role ──────────────────────────────────────
const NAME_COLORS = {
  'boss': '#60A5FA', 'explore': '#34D399', 'oracle': '#A78BFA',
  'sisyphus-junior': '#FB923C', 'frontend-engineer': '#F9A8D4',
  'document-writer': '#FCD34D', 'librarian': '#6EE7B7',
  'prometheus': '#93C5FD', 'qa-tester': '#FCA5A5', 'player': '#FFFFFF',
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.floorCanvas = null;
    this.connectionStatus = 'connecting';
    this.tick = 0;
    this._initFloor();
  }

  _initFloor() {
    const dpr = window.devicePixelRatio || 1;
    this.floorCanvas = document.createElement('canvas');
    this.floorCanvas.width = MAP_W * dpr;
    this.floorCanvas.height = MAP_H * dpr;
    const ctx = this.floorCanvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;

    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        const x = c * TS, y = r * TS;
        const tile = groundMap[r][c];
        switch (tile) {
          case T.WALL:        this._drawWall(ctx, x, y, c, r); break;
          case T.FLOOR:       this._drawFloor(ctx, x, y, c, r, false); break;
          case T.FLOOR_ALT:   this._drawFloor(ctx, x, y, c, r, true); break;
          case T.RUG:         this._drawRug(ctx, x, y, c, r); break;
          case T.BREAK_FLOOR: this._drawBreakFloor(ctx, x, y, c, r); break;
        }
      }
    }

    // Draw baseboard along inner wall edges
    this._drawBaseboards(ctx);
  }

  // ─── Floor tile: wood plank with grain ────────────────────────
  _drawFloor(ctx, x, y, col, row, alt) {
    const c1 = alt ? PAL.floorAlt1 : PAL.floorWood1;
    const c2 = alt ? PAL.floorAlt2 : PAL.floorWood2;

    ctx.fillStyle = c1;
    ctx.fillRect(x, y, TS, TS);

    for (let py = 0; py < TS; py += 12) {
      const plankIdx = Math.floor((py + row * TS) / 12);
      ctx.fillStyle = plankIdx % 2 === 0 ? c1 : c2;
      ctx.fillRect(x, y + py, TS, 12);
      ctx.fillStyle = PAL.floorWoodGap;
      ctx.fillRect(x, y + py, TS, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(x, y + py + 5, TS, 1);
      ctx.fillRect(x + 6, y + py + 8, TS - 12, 1);
    }

    const vOffset = ((row % 2) * 24 + 15) % TS;
    ctx.fillStyle = PAL.floorWoodGap;
    ctx.fillRect(x + vOffset, y, 1, TS);

    ctx.fillStyle = 'rgba(0,0,0,0.02)';
    if ((col + row) % 3 === 0) ctx.fillRect(x, y, TS, TS);
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    if ((col + row) % 5 === 0) ctx.fillRect(x, y, TS, TS);
  }

  // ─── Break room floor: warm carpet texture ───────────────────
  _drawBreakFloor(ctx, x, y, col, row) {
    // Warm carpet base
    ctx.fillStyle = PAL.breakCarpet1;
    ctx.fillRect(x, y, TS, TS);

    // Subtle carpet texture pattern
    for (let py = 0; py < TS; py += 6) {
      ctx.fillStyle = (py + row * TS) % 12 < 6 ? PAL.breakCarpet1 : PAL.breakCarpet2;
      ctx.fillRect(x, y + py, TS, 6);
    }

    // Carpet fiber texture
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let py = 0; py < TS; py += 4) {
      const offset = ((col + row) * 7 + py) % 12;
      ctx.fillRect(x + offset, y + py, TS - offset, 1);
    }

    // Subtle warmth variation
    ctx.fillStyle = 'rgba(180,120,60,0.03)';
    if ((col + row) % 2 === 0) ctx.fillRect(x, y, TS, TS);
    ctx.fillStyle = 'rgba(0,0,0,0.02)';
    if ((col + row) % 4 === 0) ctx.fillRect(x, y, TS, TS);
  }

  // ─── Wall tile: depth + texture ───────────────────────────────
  _drawWall(ctx, x, y, col, row) {
    ctx.fillStyle = PAL.wallBase;
    ctx.fillRect(x, y, TS, TS);

    if (row === 0) {
      ctx.fillStyle = PAL.wallTop;
      ctx.fillRect(x, y, TS, 12);
      ctx.fillStyle = PAL.wallBoard;
      ctx.fillRect(x, y + TS - 6, TS, 6);
    }

    if (row === MAP_ROWS - 1) {
      ctx.fillStyle = PAL.wallDark;
      ctx.fillRect(x, y, TS, TS);
      ctx.fillStyle = PAL.wallTop;
      ctx.fillRect(x, y, TS, 6);
    }

    if (col === 0 || col === MAP_COLS - 1) {
      ctx.fillStyle = PAL.wallDark;
      ctx.fillRect(x, y, TS, TS);
      if (col === 0) {
        ctx.fillStyle = PAL.wallTop;
        ctx.fillRect(x + TS - 6, y, 6, TS);
      } else {
        ctx.fillStyle = PAL.wallTop;
        ctx.fillRect(x, y, 6, TS);
      }
    }

    // Interior wall separator (cols 18-19)
    if ((col === 18 || col === 19) && row > 0 && row < MAP_ROWS - 1) {
      ctx.fillStyle = PAL.wallBase;
      ctx.fillRect(x, y, TS, TS);
      // Lighter inner face
      if (col === 18) {
        ctx.fillStyle = PAL.wallTop;
        ctx.fillRect(x, y, 4, TS);
      }
      if (col === 19) {
        ctx.fillStyle = PAL.wallTop;
        ctx.fillRect(x + TS - 4, y, 4, TS);
      }
    }

    // Subtle brick pattern
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let py = 0; py < TS; py += 12) {
      const offset = (Math.floor(py / 12) % 2) * 24;
      ctx.fillRect(x + offset, y + py, 22, 10);
    }
  }

  // ─── Baseboard along wall edges ───────────────────────────────
  _drawBaseboards(ctx) {
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        if (groundMap[r][c] === T.WALL) continue;
        const x = c * TS, y = r * TS;
        if (r > 0 && groundMap[r-1][c] === T.WALL) {
          ctx.fillStyle = PAL.baseboard;
          ctx.fillRect(x, y, TS, 4);
          ctx.fillStyle = PAL.baseboardDk;
          ctx.fillRect(x, y + 4, TS, 2);
        }
        if (c > 0 && groundMap[r][c-1] === T.WALL) {
          ctx.fillStyle = PAL.baseboard;
          ctx.fillRect(x, y, 4, TS);
        }
        if (c < MAP_COLS-1 && groundMap[r][c+1] === T.WALL) {
          ctx.fillStyle = PAL.baseboard;
          ctx.fillRect(x + TS - 4, y, 4, TS);
        }
        if (r < MAP_ROWS-1 && groundMap[r+1][c] === T.WALL) {
          ctx.fillStyle = PAL.baseboard;
          ctx.fillRect(x, y + TS - 4, TS, 4);
        }
      }
    }
  }

  // ─── Rug tile ─────────────────────────────────────────────────
  _drawRug(ctx, x, y, col, row) {
    ctx.fillStyle = PAL.rugMain;
    ctx.fillRect(x, y, TS, TS);

    ctx.fillStyle = PAL.rugPattern;
    for (let py = 0; py < TS; py += 12) {
      for (let px = 0; px < TS; px += 12) {
        if (((px + py) / 12) % 2 === 0) {
          ctx.fillRect(x + px + 2, y + py + 2, 9, 9);
        }
      }
    }

    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x + 6, y + 6, TS - 12, TS - 12);

    const isRug = (r, c) => r >= 0 && r < MAP_ROWS && c >= 0 && c < MAP_COLS && groundMap[r][c] === T.RUG;
    ctx.fillStyle = PAL.rugBorder;
    if (!isRug(row-1, col)) { ctx.fillRect(x, y, TS, 4); ctx.fillStyle = PAL.rugFringe; ctx.fillRect(x, y, TS, 2); }
    ctx.fillStyle = PAL.rugBorder;
    if (!isRug(row+1, col)) { ctx.fillRect(x, y+TS-4, TS, 4); }
    if (!isRug(row, col-1)) { ctx.fillRect(x, y, 4, TS); }
    if (!isRug(row, col+1)) { ctx.fillRect(x+TS-4, y, 4, TS); }
  }

  // ═══════════════════════════════════════════════════════════════
  // FURNITURE DRAWING
  // ═══════════════════════════════════════════════════════════════

  _drawDesk(ctx, f) {
    const x = f.x * TS, y = f.y * TS;
    const w = f.w * TS, h = f.h * TS;

    ctx.fillStyle = PAL.shadow;
    ctx.fillRect(x + 5, y + 5, w - 3, h - 3);

    ctx.fillStyle = PAL.deskTop;
    ctx.fillRect(x, y, w, h - 12);
    ctx.fillStyle = PAL.deskEdge;
    ctx.fillRect(x + 2, y + 2, w - 4, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x + w - 30, y + 9, 21, 15);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x + w - 27, y + 12, 15, 9);

    ctx.fillStyle = PAL.deskFront;
    ctx.fillRect(x, y + h - 15, w, 15);
    ctx.fillStyle = PAL.deskEdge;
    ctx.fillRect(x, y + h - 15, w, 2);

    ctx.fillStyle = PAL.deskLeg;
    ctx.fillRect(x + 3, y + h - 6, 6, 6);
    ctx.fillRect(x + w - 9, y + h - 6, 6, 6);

    ctx.fillStyle = '#B8A070';
    ctx.fillRect(x + w/2 - 6, y + h - 11, 12, 3);
  }

  _drawMonitor(ctx, f, toolColor, workInfo) {
    const x = f.x * TS, y = f.y * TS;
    const w = f.w * TS, h = f.h * TS;
    const glowColor = toolColor || null;

    if (glowColor) {
      ctx.fillStyle = glowColor.replace(')', ',0.15)').replace('rgb', 'rgba');
      ctx.fillRect(x - 5, y - 5, w + 10, h + 15);
    }

    ctx.fillStyle = PAL.monitorBody;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = glowColor ? '#0D1117' : PAL.monitorScreen;
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);

    if (glowColor) {
      ctx.fillStyle = glowColor;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(x + 5, y + 5, w * 0.6, 3);
      ctx.globalAlpha = 0.5;
      ctx.fillRect(x + 5, y + 11, w * 0.4, 2);
      ctx.fillRect(x + 5, y + 15, w * 0.7, 2);
      ctx.globalAlpha = 1;

    } else {
      ctx.fillStyle = 'rgba(41,173,255,0.2)';
      ctx.fillRect(x + 5, y + 5, w * 0.5, 2);
      ctx.fillStyle = 'rgba(0,228,54,0.15)';
      ctx.fillRect(x + 5, y + 9, w * 0.3, 2);
    }

    ctx.fillStyle = '#4A5568';
    ctx.fillRect(x + w/2 - 3, y + h, 6, 6);
    ctx.fillRect(x + w/2 - 6, y + h + 5, 12, 3);
  }

  _drawChair(ctx, f) {
    const x = f.x * TS, y = f.y * TS;
    const w = f.w * TS, h = f.h * TS;

    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.beginPath();
    ctx.ellipse(x + w/2, y + h, w/2, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#2D3748';
    const cx = x + w/2, cy = y + h - 3;
    for (let a = 0; a < 5; a++) {
      const angle = (a / 5) * Math.PI * 2 - Math.PI/2;
      ctx.fillRect(cx + Math.cos(angle) * 9 - 2, cy + Math.sin(angle) * 6 - 2, 4, 4);
    }

    ctx.fillStyle = PAL.chairSeat;
    ctx.fillRect(x + 2, y + 6, w - 4, h - 12);
    ctx.fillStyle = PAL.chairCushion;
    ctx.fillRect(x + 5, y + 9, w - 10, h - 18);

    ctx.fillStyle = PAL.chairSeat;
    ctx.fillRect(x + 3, y, w - 6, 9);
    ctx.fillStyle = PAL.chairCushion;
    ctx.fillRect(x + 6, y + 2, w - 12, 6);
  }

  _drawPlant(ctx, f) {
    const x = f.x * TS, y = f.y * TS;

    ctx.fillStyle = PAL.shadow;
    ctx.beginPath();
    ctx.ellipse(x + 24, y + 45, 15, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = PAL.plantPot;
    ctx.fillRect(x + 12, y + 30, 24, 15);
    ctx.fillStyle = PAL.plantPotDk;
    ctx.fillRect(x + 11, y + 29, 27, 5);
    ctx.fillStyle = '#D4956A';
    ctx.fillRect(x + 12, y + 29, 24, 2);

    ctx.fillStyle = '#5D4E37';
    ctx.fillRect(x + 14, y + 30, 21, 5);

    ctx.fillStyle = PAL.leafDark;
    ctx.fillRect(x + 9, y + 12, 30, 18);
    ctx.fillStyle = PAL.leafMid;
    ctx.fillRect(x + 12, y + 9, 24, 18);
    ctx.fillStyle = PAL.leafBright;
    ctx.fillRect(x + 15, y + 6, 18, 18);
    ctx.fillStyle = '#68D391';
    ctx.fillRect(x + 18, y + 9, 6, 6);
    ctx.fillRect(x + 21, y + 15, 9, 5);
    ctx.fillStyle = PAL.leafMid;
    ctx.fillRect(x + 6, y + 18, 9, 6);
    ctx.fillRect(x + 33, y + 15, 8, 8);
  }

  _drawCoffee(ctx, f) {
    const x = f.x * TS, y = f.y * TS;

    ctx.fillStyle = PAL.shadow;
    ctx.fillRect(x + 6, y + 42, 39, 6);

    ctx.fillStyle = PAL.coffeeBody;
    ctx.fillRect(x + 6, y + 6, 36, 36);
    ctx.fillStyle = '#A0AEC0';
    ctx.fillRect(x + 9, y + 9, 30, 18);
    ctx.fillStyle = '#2D3748';
    ctx.fillRect(x + 12, y + 12, 15, 9);
    ctx.fillStyle = '#4FD1C5';
    ctx.fillRect(x + 14, y + 14, 6, 3);
    ctx.fillRect(x + 14, y + 18, 9, 2);
    ctx.fillStyle = '#FC8181';
    ctx.fillRect(x + 30, y + 12, 6, 6);
    ctx.fillStyle = '#68D391';
    ctx.fillRect(x + 30, y + 21, 6, 3);
    ctx.fillStyle = '#2D3748';
    ctx.fillRect(x + 12, y + 30, 24, 9);
    ctx.fillStyle = '#FFF';
    ctx.fillRect(x + 18, y + 33, 9, 6);
    ctx.fillStyle = '#A0AEC0';
    ctx.fillRect(x + 18, y + 32, 9, 2);
    if (this.tick % 60 < 30) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(x + 21, y + 29, 2, 3);
      ctx.fillRect(x + 24, y + 27, 2, 3);
    }
  }

  _drawWhiteboard(ctx, f, activeAgents) {
    const x = f.x * TS, y = f.y * TS;
    const w = f.w * TS, h = f.h * TS;

    ctx.fillStyle = PAL.shadow;
    ctx.fillRect(x + 5, y + 5, w - 3, h - 3);

    ctx.fillStyle = PAL.whiteboardFrame;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = PAL.whiteboardBg;
    ctx.fillRect(x + 5, y + 5, w - 10, h - 15);

    // Show active tasks on whiteboard
    if (activeAgents && activeAgents.length > 0) {
      ctx.font = '12px "Menlo", "Consolas", monospace';
      ctx.textAlign = 'left';
      let ty = y + 16;
      for (let i = 0; i < Math.min(3, activeAgents.length); i++) {
        const agent = activeAgents[i];
        const tool = TOOL_ICONS[agent.workTool];
        ctx.fillStyle = tool ? tool.color : '#3182CE';
        const label = `${agent.name.slice(0,4)}: ${agent.workTarget || (tool ? tool.label : '...')}`;
        ctx.fillText(label.slice(0, 10), x + 8, ty);
        ty += 20;
      }
      ctx.textAlign = 'left';
    } else {
      // Idle whiteboard content
      ctx.fillStyle = '#3182CE';
      ctx.fillRect(x + 12, y + 12, w * 0.5, 3);
      ctx.fillRect(x + 12, y + 21, w * 0.7, 3);
      ctx.fillStyle = '#E53E3E';
      ctx.fillRect(x + 12, y + 33, w * 0.35, 3);
      ctx.fillStyle = '#38A169';
      ctx.fillRect(x + 12, y + 42, w * 0.55, 3);
    }

    // Sticky notes
    ctx.fillStyle = '#FEFCBF';
    ctx.fillRect(x + w - 27, y + 12, 18, 15);
    ctx.fillStyle = '#FED7D7';
    ctx.fillRect(x + w - 27, y + 33, 18, 15);

    // Marker tray
    ctx.fillStyle = '#A0AEC0';
    ctx.fillRect(x + 6, y + h - 12, w - 12, 8);
    ctx.fillStyle = '#E53E3E'; ctx.fillRect(x + 12, y + h - 11, 5, 6);
    ctx.fillStyle = '#3182CE'; ctx.fillRect(x + 21, y + h - 11, 5, 6);
    ctx.fillStyle = '#38A169'; ctx.fillRect(x + 30, y + h - 11, 5, 6);
  }

  _drawWaterCooler(ctx, f) {
    const x = f.x * TS, y = f.y * TS;

    ctx.fillStyle = PAL.shadow;
    ctx.beginPath();
    ctx.ellipse(x + 24, y + 45, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#E2E8F0';
    ctx.fillRect(x + 12, y + 21, 24, 24);
    ctx.fillStyle = '#90CDF4';
    ctx.fillRect(x + 15, y + 3, 18, 21);
    ctx.fillStyle = '#63B3ED';
    ctx.fillRect(x + 18, y + 6, 12, 15);
    ctx.fillStyle = '#FC8181';
    ctx.fillRect(x + 17, y + 27, 6, 5);
    ctx.fillStyle = '#63B3ED';
    ctx.fillRect(x + 26, y + 27, 6, 5);
    ctx.fillStyle = '#A0AEC0';
    ctx.fillRect(x + 12, y + 42, 24, 5);
  }

  _drawBookshelf(ctx, f) {
    const x = f.x * TS, y = f.y * TS;
    const w = f.w * TS, h = f.h * TS;

    ctx.fillStyle = PAL.shadow;
    ctx.fillRect(x + 5, y + 5, w - 3, h);

    ctx.fillStyle = '#6B4D30';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#7D5C3A';
    ctx.fillRect(x + 3, y + 3, w - 6, h - 6);

    ctx.fillStyle = '#6B4D30';
    ctx.fillRect(x + 3, y + h/2 - 2, w - 6, 5);

    const colors = PAL.bookColors;
    const widths = [6, 4, 7, 4, 6, 7, 4, 6, 4, 7];
    let bx = x + 6;
    for (let i = 0; i < 10 && bx < x + w - 9; i++) {
      const bw = widths[i % widths.length];
      const bh1 = h/2 - 9 - (i % 3);
      const bh2 = h/2 - 12 - ((i+1) % 3);
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(bx, y + 6, bw, bh1);
      ctx.fillRect(bx, y + h/2 + 5, bw, bh2);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(bx, y + 6, 1, bh1);
      bx += bw + 1;
    }
  }

  // ─── Break room: Sofa ─────────────────────────────────────────
  _drawSofa(ctx, f) {
    const x = f.x * TS, y = f.y * TS;
    const w = f.w * TS, h = f.h * TS;

    // Shadow
    ctx.fillStyle = PAL.shadow;
    ctx.fillRect(x + 5, y + 5, w - 3, h);

    // Sofa base/back
    ctx.fillStyle = PAL.sofaBase;
    ctx.fillRect(x, y, w, h);

    // Seat cushions (3 sections)
    const cushW = (w - 16) / 3;
    ctx.fillStyle = PAL.sofaCushion;
    for (let i = 0; i < 3; i++) {
      const cx = x + 6 + i * (cushW + 2);
      ctx.fillRect(cx, y + h * 0.35, cushW, h * 0.55);
      // Cushion highlight
      ctx.fillStyle = PAL.sofaPillow;
      ctx.fillRect(cx + 3, y + h * 0.38, cushW - 6, 4);
      ctx.fillStyle = PAL.sofaCushion;
    }

    // Backrest
    ctx.fillStyle = PAL.sofaBase;
    ctx.fillRect(x + 3, y + 3, w - 6, h * 0.3);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(x + 6, y + 5, w - 12, 4);

    // Arms
    ctx.fillStyle = PAL.sofaArm;
    ctx.fillRect(x, y + 3, 8, h - 6);
    ctx.fillRect(x + w - 8, y + 3, 8, h - 6);
    // Arm highlight
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x + 1, y + 5, 5, h - 10);

    // Pillow on sofa
    ctx.fillStyle = PAL.sofaPillow;
    ctx.fillRect(x + 12, y + 8, 18, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(x + 14, y + 10, 14, 4);
  }

  // ─── Break room: Table ────────────────────────────────────────
  _drawBreakTable(ctx, f) {
    const x = f.x * TS, y = f.y * TS;
    const w = f.w * TS, h = f.h * TS;

    // Shadow
    ctx.fillStyle = PAL.shadow;
    ctx.fillRect(x + 5, y + 5, w - 3, h);

    // Table top
    ctx.fillStyle = PAL.breakTableTop;
    ctx.fillRect(x, y, w, h - 10);
    // Top highlight
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(x + 3, y + 3, w - 6, 3);

    // Edge
    ctx.fillStyle = PAL.breakTableLeg;
    ctx.fillRect(x, y + h - 12, w, 3);

    // Legs
    ctx.fillStyle = PAL.breakTableLeg;
    ctx.fillRect(x + 6, y + h - 10, 5, 10);
    ctx.fillRect(x + w - 11, y + h - 10, 5, 10);

    // Items on table: cup and plate
    ctx.fillStyle = '#FFF';
    ctx.fillRect(x + 15, y + 8, 8, 8);  // cup
    ctx.fillStyle = '#E2E8F0';
    ctx.fillRect(x + 15, y + 7, 8, 2);
    ctx.fillStyle = '#F7FAFC';
    ctx.fillRect(x + w - 30, y + 10, 15, 10); // plate
    ctx.fillStyle = '#E2E8F0';
    ctx.fillRect(x + w - 30, y + 9, 15, 2);
  }

  // ─── Break room: Vending machine ──────────────────────────────
  _drawVendingMachine(ctx, f) {
    const x = f.x * TS, y = f.y * TS;
    const w = f.w * TS, h = f.h * TS;

    // Shadow
    ctx.fillStyle = PAL.shadowDark;
    ctx.fillRect(x + 5, y + 5, w, h);

    // Body
    ctx.fillStyle = PAL.vendBody;
    ctx.fillRect(x, y, w, h);

    // Front panel
    ctx.fillStyle = PAL.vendFront;
    ctx.fillRect(x + 4, y + 4, w - 8, h - 8);

    // Display screen (top)
    ctx.fillStyle = PAL.vendScreen;
    ctx.fillRect(x + 8, y + 8, w - 16, 18);
    // Screen glow
    ctx.fillStyle = PAL.vendGlow;
    ctx.globalAlpha = 0.6 + Math.sin(this.tick * 0.05) * 0.2;
    ctx.fillRect(x + 10, y + 10, w - 20, 3);
    ctx.fillRect(x + 10, y + 16, (w - 20) * 0.6, 2);
    ctx.globalAlpha = 1;

    // Product rows (colored rectangles)
    const products = ['#E53E3E', '#3182CE', '#38A169', '#D69E2E', '#D53F8C', '#805AD5'];
    let py = y + 30;
    for (let row = 0; row < 3; row++) {
      let px = x + 8;
      for (let col = 0; col < 2; col++) {
        const clr = products[(row * 2 + col) % products.length];
        ctx.fillStyle = clr;
        ctx.fillRect(px, py, 10, 10);
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillRect(px, py, 10, 3);
        px += 14;
      }
      py += 14;
    }

    // Pickup slot
    ctx.fillStyle = '#1A202C';
    ctx.fillRect(x + 6, y + h - 20, w - 12, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(x + 8, y + h - 18, w - 16, 2);

    // Coin slot
    ctx.fillStyle = '#A0AEC0';
    ctx.fillRect(x + w - 14, y + 32, 6, 12);
  }

  // ─── Lead desk (Chris - Team Lead) ──────────────────────────────
  _drawLeadDesk(ctx, f) {
    const x = f.x * TS, y = f.y * TS;
    const w = f.w * TS, h = f.h * TS;

    ctx.fillStyle = PAL.shadow;
    ctx.fillRect(x + 5, y + 5, w - 3, h - 3);

    // Premium desk top
    ctx.fillStyle = '#A08050';
    ctx.fillRect(x, y, w, h - 12);
    ctx.fillStyle = '#B8966A';
    ctx.fillRect(x + 2, y + 2, w - 4, 3);

    // Metal nameplate
    ctx.fillStyle = '#C0C0C0';
    ctx.fillRect(x + w/2 - 12, y + 6, 24, 8);
    ctx.fillStyle = '#A0A0A0';
    ctx.fillRect(x + w/2 - 10, y + 8, 20, 4);

    // Front panel
    ctx.fillStyle = '#8A6A40';
    ctx.fillRect(x, y + h - 15, w, 15);
    ctx.fillStyle = '#A08050';
    ctx.fillRect(x, y + h - 15, w, 2);

    // Legs
    ctx.fillStyle = PAL.deskLeg;
    ctx.fillRect(x + 3, y + h - 6, 6, 6);
    ctx.fillRect(x + w - 9, y + h - 6, 6, 6);

    // Drawer handle
    ctx.fillStyle = '#B8A070';
    ctx.fillRect(x + w/2 - 8, y + h - 11, 16, 3);
  }

  // ─── Boss desk (Player - CEO) ──────────────────────────────────
  _drawBossDesk(ctx, f) {
    const x = f.x * TS, y = f.y * TS;
    const w = f.w * TS, h = f.h * TS;

    ctx.fillStyle = PAL.shadowDark;
    ctx.fillRect(x + 5, y + 5, w - 3, h - 3);

    // Rich mahogany desk top
    ctx.fillStyle = '#6B3410';
    ctx.fillRect(x, y, w, h - 12);
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(x + 3, y + 3, w - 6, h - 18);

    // Gold trim
    ctx.fillStyle = '#DAA520';
    ctx.fillRect(x + 1, y + 1, w - 2, 2);
    ctx.fillRect(x + 1, y + 1, 2, h - 14);
    ctx.fillRect(x + w - 3, y + 1, 2, h - 14);

    // Desktop items
    ctx.fillStyle = '#2D3748';
    ctx.fillRect(x + 12, y + 8, 8, 10);
    ctx.fillStyle = '#E53E3E';
    ctx.fillRect(x + 13, y + 5, 2, 6);
    ctx.fillStyle = '#3182CE';
    ctx.fillRect(x + 16, y + 6, 2, 5);

    // Gold nameplate
    ctx.fillStyle = '#DAA520';
    ctx.fillRect(x + w/2 - 15, y + 8, 30, 10);
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(x + w/2 - 13, y + 10, 26, 6);

    // Front panel
    ctx.fillStyle = '#5B2D0E';
    ctx.fillRect(x, y + h - 15, w, 15);
    ctx.fillStyle = '#6B3410';
    ctx.fillRect(x, y + h - 15, w, 2);

    // Legs with gold accent
    ctx.fillStyle = '#4A2008';
    ctx.fillRect(x + 3, y + h - 6, 8, 6);
    ctx.fillRect(x + w - 11, y + h - 6, 8, 6);
    ctx.fillStyle = '#DAA520';
    ctx.fillRect(x + 3, y + h - 6, 8, 2);
    ctx.fillRect(x + w - 11, y + h - 6, 8, 2);

    // Drawer handles
    ctx.fillStyle = '#DAA520';
    ctx.fillRect(x + w/3 - 5, y + h - 11, 10, 3);
    ctx.fillRect(x + 2*w/3 - 5, y + h - 11, 10, 3);
  }

  // ─── Boss chair (Executive) ─────────────────────────────────────
  _drawBossChair(ctx, f) {
    const x = f.x * TS, y = f.y * TS;
    const w = f.w * TS, h = f.h * TS;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(x + w/2, y + h, w/2 + 4, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Chair base (5 caster wheels)
    ctx.fillStyle = '#1A1A1A';
    const cx = x + w/2, cy = y + h - 4;
    for (let a = 0; a < 5; a++) {
      const angle = (a / 5) * Math.PI * 2 - Math.PI/2;
      ctx.fillRect(cx + Math.cos(angle) * 16 - 3, cy + Math.sin(angle) * 9 - 2, 6, 4);
    }

    // Seat - dark leather
    ctx.fillStyle = '#1A1A2E';
    ctx.fillRect(x + 4, y + h * 0.4, w - 8, h * 0.45);
    ctx.fillStyle = '#2D2D44';
    ctx.fillRect(x + 8, y + h * 0.43, w - 16, h * 0.38);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x + 10, y + h * 0.45, w - 20, 4);

    // High backrest
    ctx.fillStyle = '#1A1A2E';
    ctx.fillRect(x + 6, y, w - 12, h * 0.45);
    ctx.fillStyle = '#2D2D44';
    ctx.fillRect(x + 10, y + 3, w - 20, h * 0.38);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(x + 12, y + 5, w - 24, 4);

    // Gold armrests
    ctx.fillStyle = '#DAA520';
    ctx.fillRect(x + 2, y + h * 0.35, 7, h * 0.25);
    ctx.fillRect(x + w - 9, y + h * 0.35, 7, h * 0.25);
    ctx.fillStyle = '#B8860B';
    ctx.fillRect(x + 2, y + h * 0.35, 7, 3);
    ctx.fillRect(x + w - 9, y + h * 0.35, 7, 3);

    // Gold trim on backrest top
    ctx.fillStyle = '#DAA520';
    ctx.fillRect(x + 8, y, w - 16, 3);
  }

  _drawFurniture(ctx, f, activeTools, workInfoMap, activeAgents) {
    let toolColor = null;
    let workInfo = null;
    if (f.type === 'monitor' && activeTools) {
      const key = this._monitorKey(f);
      toolColor = activeTools.get(key);
      if (workInfoMap) workInfo = workInfoMap.get(key);
    }

    switch (f.type) {
      case 'desk':       this._drawDesk(ctx, f); break;
      case 'monitor':    this._drawMonitor(ctx, f, toolColor, workInfo); break;
      case 'chair':      this._drawChair(ctx, f); break;
      case 'plant':      this._drawPlant(ctx, f); break;
      case 'coffee':     this._drawCoffee(ctx, f); break;
      case 'whiteboard': this._drawWhiteboard(ctx, f, activeAgents); break;
      case 'water':      this._drawWaterCooler(ctx, f); break;
      case 'bookshelf':  this._drawBookshelf(ctx, f); break;
      case 'sofa':       this._drawSofa(ctx, f); break;
      case 'breakTable': this._drawBreakTable(ctx, f); break;
      case 'vending':    this._drawVendingMachine(ctx, f); break;
      case 'leadDesk':   this._drawLeadDesk(ctx, f); break;
      case 'bossDesk':   this._drawBossDesk(ctx, f); break;
      case 'bossChair':  this._drawBossChair(ctx, f); break;
      case 'leadChair':  this._drawChair(ctx, f); break;
    }
  }

  _monitorKey(f) {
    return `${Math.round(f.x)},${Math.round(f.y)}`;
  }

  _furnitureSortY(f) {
    // Chairs sort by top edge so characters render ON TOP of them
    if (f.type === 'chair' || f.type === 'leadChair' || f.type === 'bossChair') {
      return f.y * TS;
    }
    return (f.y + f.h) * TS;
  }

  // ═══════════════════════════════════════════════════════════════
  // CHARACTER RENDERING
  // ═══════════════════════════════════════════════════════════════

  _drawCharacter(ctx, char, isPlayer) {
    if (!char.sprite) return;
    const frame = char.getFrameRect();
    if (!frame) return;

    if (isPlayer) {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.ellipse(char.x, char.y + 6, 24, 16, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = isPlayer ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(char.x, char.y + 20, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.drawImage(
      char.sprite.canvas,
      frame.sx, frame.sy, frame.sw, frame.sh,
      char.x - 24, char.y - 24, 48, 48
    );

    // Work indicator (tool + file + elapsed)
    if (char.isWorking && char.workTool) {
      this._drawWorkIndicator(ctx, char);
    }

    // Name tag
    ctx.font = '12px "Menlo", "Consolas", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const label = isPlayer ? '▸ YOU' : char.name;
    const nameW = ctx.measureText(label).width + 8;
    const nx = char.x - nameW / 2, ny = char.y + 24;

    ctx.fillStyle = isPlayer ? 'rgba(41,173,255,0.6)' : 'rgba(0,0,0,0.5)';
    this._roundRect(ctx, nx, ny, nameW, 16, 2);
    ctx.fill();

    ctx.fillStyle = isPlayer ? '#FFF' : (NAME_COLORS[char.role] || '#C2C3C7');
    ctx.fillText(label, char.x, ny + 3);
    ctx.textAlign = 'left';
  }

  _drawWorkIndicator(ctx, char) {
    const tool = TOOL_ICONS[char.workTool];
    if (!tool) return;

    // Build label: TOOL filename elapsed
    let label = tool.label;
    if (char.workTarget) {
      const shortFile = char.workTarget.length > 10 ? char.workTarget.slice(0, 10) : char.workTarget;
      label = `${tool.label} ${shortFile}`;
    }

    // Add elapsed time
    const elapsed = char.taskElapsed;
    if (elapsed > 0) {
      const min = Math.floor(elapsed / 60);
      const sec = elapsed % 60;
      const timeStr = min > 0 ? `${min}m${sec}s` : `${sec}s`;
      label += ` ${timeStr}`;
    }

    const color = tool.color;

    ctx.font = '12px "Menlo", "Consolas", monospace';
    ctx.textAlign = 'center';
    const w = ctx.measureText(label).width + 10;
    const ix = char.x - w / 2, iy = char.y - 40;

    const pulse = 0.7 + Math.sin(this.tick * 0.1) * 0.3;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = color;
    this._roundRect(ctx, ix, iy, w, 16, 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#000';
    ctx.fillText(label, char.x, iy + 3);
    ctx.textAlign = 'left';
  }

  // ═══════════════════════════════════════════════════════════════
  // MAIN RENDER PIPELINE
  // ═══════════════════════════════════════════════════════════════

  render(ctx, characters, bubbleManager, player) {
    this.tick++;
    ctx.imageSmoothingEnabled = false;

    // 1. Floor
    ctx.drawImage(this.floorCanvas, 0, 0, MAP_W, MAP_H);

    // 2. Build active tool map for monitor glow + work info
    const activeTools = new Map();
    const workInfoMap = new Map();
    const activeAgents = characters.getActiveAgents();

    for (const char of characters.characters.values()) {
      if (char.isWorking && char.workTool) {
        const toolInfo = TOOL_ICONS[char.workTool];
        if (toolInfo) {
          const mx = Math.round(char.homeX / TS - 0.2);
          const my = Math.round(char.homeY / TS - 2.7);
          const key = `${mx},${my}`;
          activeTools.set(key, toolInfo.color);
          workInfoMap.set(key, { tool: char.workTool, target: char.workTarget });
        }
      }
    }

    // 3. Collect entities for y-sorting
    const entities = [];
    for (const f of furniture) {
      entities.push({ type: 'f', data: f, sortY: this._furnitureSortY(f) });
    }
    for (const char of characters.getSorted()) {
      entities.push({ type: 'c', data: char, sortY: char.sortY, isPlayer: false });
    }
    if (player) {
      entities.push({ type: 'c', data: player, sortY: player.sortY, isPlayer: true });
    }
    entities.sort((a, b) => a.sortY - b.sortY);

    // 4. Render
    for (const ent of entities) {
      if (ent.type === 'f') {
        this._drawFurniture(ctx, ent.data, activeTools, workInfoMap, activeAgents);
      } else {
        this._drawCharacter(ctx, ent.data, ent.isPlayer);
      }
    }

    // 5. Bubbles
    bubbleManager.render(ctx, characters.characters);
    if (player) {
      bubbleManager.render(ctx, new Map([['Player', player]]));
    }

    // 6. UI
    this._drawUI(ctx, characters);

    // 7. Room labels
    this._drawRoomLabels(ctx);
  }

  // ═══════════════════════════════════════════════════════════════
  // UI OVERLAY
  // ═══════════════════════════════════════════════════════════════

  _drawUI(ctx, characters) {
    const stats = characters.getStats();

    // ─── Top left: title + status ───
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    this._roundRect(ctx, 4, 4, 180, 24, 4);
    ctx.fill();

    ctx.font = '14px "Menlo", "Consolas", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#29ADFF';
    ctx.fillText('BACKSTAGE', 10, 20);

    const dotColors = { connected: '#68D391', connecting: '#ECC94B', disconnected: '#FC8181' };
    ctx.fillStyle = dotColors[this.connectionStatus] || dotColors.connecting;
    ctx.beginPath();
    ctx.arc(168, 16, 3, 0, Math.PI * 2);
    ctx.fill();

    // ─── Top right: agent stats ───
    ctx.font = '12px "Menlo", "Consolas", monospace';
    const statsText = `Active: ${stats.active}/${stats.total}  Idle: ${stats.idle}  Done: ${stats.tasksCompleted}`;
    const sw = ctx.measureText(statsText).width + 12;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    this._roundRect(ctx, MAP_W - sw - 4, 4, sw, 24, 4);
    ctx.fill();

    ctx.fillStyle = stats.active > 0 ? '#68D391' : '#718096';
    ctx.textAlign = 'right';
    ctx.fillText(statsText, MAP_W - 10, 20);
    ctx.textAlign = 'left';

    // ─── Bottom: active agents bar with task description + elapsed ───
    if (stats.active > 0) {
      const activeAgents = characters.getActiveAgents();
      let bx = 6;
      const by = MAP_H - 32;

      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const barW = Math.min(activeAgents.length * 200 + 10, MAP_W - 4);
      this._roundRect(ctx, 2, by - 2, barW, 28, 4);
      ctx.fill();

      ctx.font = '12px "Menlo", "Consolas", monospace';
      for (const agent of activeAgents) {
        const tool = TOOL_ICONS[agent.workTool];
        const color = tool ? tool.color : '#718096';

        // Name + tool + file + elapsed
        let label = `${agent.name}: ${tool ? tool.label : '...'}`;
        if (agent.workTarget) {
          const shortFile = agent.workTarget.length > 10 ? agent.workTarget.slice(0, 10) : agent.workTarget;
          label += ` ${shortFile}`;
        }
        const elapsed = agent.taskElapsed;
        if (elapsed > 0) {
          const min = Math.floor(elapsed / 60);
          const sec = elapsed % 60;
          label += min > 0 ? ` ${min}m${sec}s` : ` ${sec}s`;
        }

        ctx.fillStyle = color;
        ctx.fillText(label, bx, by + 16);
        bx += ctx.measureText(label).width + 14;

        if (bx > MAP_W - 20) break;
      }
    }
  }

  // Room labels (subtle)
  _drawRoomLabels(ctx) {
    ctx.font = '12px "Menlo", "Consolas", monospace';
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.3;

    // Office label
    ctx.fillStyle = '#29ADFF';
    ctx.fillText('OFFICE', 9 * TS, MAP_H - 10);

    // Break room label
    ctx.fillStyle = '#FFA300';
    ctx.fillText('BREAK ROOM', 24.5 * TS, MAP_H - 10);

    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
