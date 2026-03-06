// bubble.js — Speech bubble system: queue, lifecycle, rendering

import { PICO8 } from './map.js';

const BUBBLE_APPEAR_MS = 150;
const BUBBLE_FADE_MS = 300;
const BUBBLE_MAX_W = 240;
const BUBBLE_MIN_W = 40;
const BUBBLE_PAD = 6;
const BUBBLE_TAIL_H = 6;
const BUBBLE_FONT_SIZE = 12;
const BUBBLE_LINE_H = 16;
const BUBBLE_RADIUS = 4;

// Bubble type colors (border + subtle tint)
const TYPE_COLORS = {
  assign:     { border: '#29ADFF', bg: '#1a2a3a', text: '#FFF1E8' },
  done:       { border: '#00E436', bg: '#1a2a1a', text: '#FFF1E8' },
  complete:   { border: '#00E436', bg: '#1a2a1a', text: '#FFF1E8' },
  work:       { border: '#83769C', bg: '#1a1a2a', text: '#C2C3C7' },
  talk:       { border: '#FFF1E8', bg: '#1D2B53', text: '#FFF1E8' },
  request:    { border: '#FF77A8', bg: '#2a1a2a', text: '#FFF1E8' },
  update:     { border: '#FFA300', bg: '#2a2210', text: '#FFF1E8' },
  chat:       { border: '#FFEC27', bg: '#2a2a10', text: '#FFF1E8' },
  'idle-chat': { border: '#FFA300', bg: '#2a2510', text: '#FFCCAA' },
};

class Bubble {
  constructor(text, type, duration) {
    this.text = text;
    this.type = type || 'talk';
    this.duration = duration || Math.max(2000, Math.min(6000, text.length * 80));
    this.elapsed = 0;
    this.alpha = 0;
    this.scale = 0;
    this.phase = 'appear'; // appear, show, fade, done
    this.lines = [];
    this.width = 0;
    this.height = 0;
    this._measured = false;
  }

  measure(ctx) {
    if (this._measured) return;
    this._measured = true;

    ctx.font = `${BUBBLE_FONT_SIZE}px "Menlo", "Consolas", monospace`;
    this.lines = wrapText(ctx, this.text, BUBBLE_MAX_W - BUBBLE_PAD * 2);

    let maxW = 0;
    for (const line of this.lines) {
      const w = ctx.measureText(line).width;
      if (w > maxW) maxW = w;
    }

    this.width = Math.max(BUBBLE_MIN_W, maxW + BUBBLE_PAD * 2);
    this.height = this.lines.length * BUBBLE_LINE_H + BUBBLE_PAD * 2;
  }

  update(dt) {
    this.elapsed += dt * 1000;

    switch (this.phase) {
      case 'appear':
        this.scale = Math.min(1, this.elapsed / BUBBLE_APPEAR_MS);
        this.alpha = this.scale;
        if (this.elapsed >= BUBBLE_APPEAR_MS) {
          this.phase = 'show';
          this.elapsed = 0;
          this.scale = 1;
          this.alpha = 1;
        }
        break;
      case 'show':
        this.scale = 1;
        this.alpha = 1;
        if (this.elapsed >= this.duration) {
          this.phase = 'fade';
          this.elapsed = 0;
        }
        break;
      case 'fade':
        this.alpha = Math.max(0, 1 - this.elapsed / BUBBLE_FADE_MS);
        this.scale = 1;
        if (this.elapsed >= BUBBLE_FADE_MS) {
          this.phase = 'done';
        }
        break;
    }
  }

  get isDone() {
    return this.phase === 'done';
  }
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split('');  // Character-level wrapping for Korean
  const lines = [];
  let line = '';

  for (const char of words) {
    if (char === '\n') {
      lines.push(line);
      line = '';
      continue;
    }
    const test = line + char;
    if (ctx.measureText(test).width > maxWidth && line.length > 0) {
      lines.push(line);
      line = char;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  // Max 4 lines
  if (lines.length > 4) {
    lines.length = 4;
    lines[3] = lines[3].slice(0, -1) + '...';
  }

  return lines;
}

export class BubbleManager {
  constructor() {
    // Map<characterName, Bubble[]> — queue per character
    this.queues = new Map();
    // Active bubbles (one per character)
    this.active = new Map();
  }

  // Add a bubble to character's queue
  add(charName, text, type, duration) {
    if (!text || text.trim().length === 0) return;

    // Limit queue size
    let q = this.queues.get(charName);
    if (!q) { q = []; this.queues.set(charName, q); }
    if (q.length >= 5) q.shift(); // drop oldest

    q.push(new Bubble(text.trim(), type, duration));

    // If no active bubble, activate immediately
    if (!this.active.has(charName)) {
      this._activateNext(charName);
    }
  }

  _activateNext(charName) {
    const q = this.queues.get(charName);
    if (!q || q.length === 0) {
      this.active.delete(charName);
      return;
    }
    this.active.set(charName, q.shift());
  }

  update(dt) {
    for (const [name, bubble] of this.active) {
      bubble.update(dt);
      if (bubble.isDone) {
        this._activateNext(name);
      }
    }
  }

  // Render all active bubbles
  render(ctx, characters) {
    for (const [name, bubble] of this.active) {
      const char = characters.get(name);
      if (!char) continue;

      bubble.measure(ctx);
      this._drawBubble(ctx, bubble, char.x, char.y - 32);
    }
  }

  _drawBubble(ctx, bubble, cx, cy) {
    if (bubble.alpha <= 0) return;

    const colors = TYPE_COLORS[bubble.type] || TYPE_COLORS.talk;
    const { width, height, lines, alpha, scale } = bubble;

    // Position bubble above character, centered (clamp to canvas top)
    const bx = cx - width / 2;
    let by = cy - height - BUBBLE_TAIL_H;
    if (by < 42) by = 42; // 상단 UI 영역(progress bar 등) 아래로 clamp

    ctx.save();
    ctx.globalAlpha = alpha;

    // Scale from bottom center
    if (scale < 1) {
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
    }

    // Bubble background
    ctx.fillStyle = colors.bg;
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 2;
    this._roundRect(ctx, bx, by, width, height, BUBBLE_RADIUS);
    ctx.fill();
    ctx.stroke();

    // Tail (small triangle pointing down)
    ctx.fillStyle = colors.bg;
    ctx.strokeStyle = colors.border;
    ctx.beginPath();
    ctx.moveTo(cx - 4, by + height);
    ctx.lineTo(cx, by + height + BUBBLE_TAIL_H);
    ctx.lineTo(cx + 4, by + height);
    ctx.closePath();
    ctx.fill();
    // Draw tail border (only the two angled lines, not the top)
    ctx.beginPath();
    ctx.moveTo(cx - 4, by + height);
    ctx.lineTo(cx, by + height + BUBBLE_TAIL_H);
    ctx.lineTo(cx + 4, by + height);
    ctx.stroke();
    // Cover the gap at top of tail with bg
    ctx.fillStyle = colors.bg;
    ctx.fillRect(cx - 3, by + height - 1, 6, 2);

    // Text
    ctx.fillStyle = colors.text;
    ctx.font = `${BUBBLE_FONT_SIZE}px "Menlo", "Consolas", monospace`;
    ctx.textBaseline = 'top';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], bx + BUBBLE_PAD, by + BUBBLE_PAD + i * BUBBLE_LINE_H);
    }

    ctx.restore();
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
