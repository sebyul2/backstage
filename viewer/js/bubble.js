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
    // N3: typewriter 효과 — 긴 메시지만 적용
    this.totalChars = text.length;
    this.typedChars = 0;
    this.typing = text.length >= 15 && (type === 'talk' || type === 'assign' || type === 'done' || type === 'update');
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
        // N3: 타자 애니메이션 — 초당 ~33자 (30ms/char). 너무 빠르지도 느리지도 않게.
        if (this.typing && this.typedChars < this.totalChars) {
          this.typedChars = Math.min(this.totalChars, this.typedChars + dt * 1000 / 30);
        }
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
  // I4: 같은 Y영역에 말풍선이 겹치지 않도록 이미 점유된 박스를 피해 위로 밀어올림.
  render(ctx, characters) {
    // 캐릭터를 Y 좌표 내림차순(아래→위)으로 정렬: 아래 캐릭터부터 기본 위치 사용,
    // 위쪽 캐릭터는 겹칠 경우 더 높이 올림.
    const items = [];
    for (const [name, bubble] of this.active) {
      const char = characters.get(name);
      if (!char) continue;
      bubble.measure(ctx);
      items.push({ name, bubble, char });
    }
    items.sort((a, b) => b.char.y - a.char.y);

    const placed = []; // [{x, y, w, h}]
    for (const { name, bubble, char } of items) {
      const cx = char.x;
      let cy = char.y - 32;
      // 충돌 회피: 이미 배치된 bubble box와 겹치면 18px 씩 위로
      let attempts = 0;
      while (attempts < 6) {
        const bx = cx - bubble.width / 2;
        const by = cy - bubble.height - BUBBLE_TAIL_H;
        const overlaps = placed.some(p =>
          bx < p.x + p.w + 4 &&
          bx + bubble.width + 4 > p.x &&
          by < p.y + p.h + 4 &&
          by + bubble.height + 4 > p.y
        );
        if (!overlaps) break;
        cy -= 18;
        attempts++;
      }
      this._drawBubble(ctx, bubble, cx, cy);
      const bx = cx - bubble.width / 2;
      const by = cy - bubble.height - BUBBLE_TAIL_H;
      placed.push({ x: bx, y: by, w: bubble.width, h: bubble.height });

      // F4: 큐 뱃지 — 대기 중 2개 이상이면 우측 상단에 작은 원형 카운터
      const q = this.queues.get(name);
      const pending = q ? q.length : 0;
      if (pending >= 2) {
        this._drawQueueBadge(ctx, bx + bubble.width - 4, by - 4, pending);
      }
    }
  }

  _drawQueueBadge(ctx, cx, cy, count) {
    ctx.save();
    ctx.fillStyle = '#FF77A8';  // PICO-8 핑크
    ctx.strokeStyle = '#1D2B53';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#FFF1E8';
    ctx.font = 'bold 10px "Menlo", "Consolas", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = count > 9 ? '9+' : String(count);
    ctx.fillText(label, cx, cy + 0.5);
    ctx.restore();
  }

  _drawBubble(ctx, bubble, cx, cy) {
    if (bubble.alpha <= 0) return;

    const colors = TYPE_COLORS[bubble.type] || TYPE_COLORS.talk;
    const { width, height, lines, alpha, scale } = bubble;

    // Position bubble above character, centered (clamp to canvas bounds)
    const canvasW = ctx.canvas.width;
    let bx = cx - width / 2;
    if (bx < 4) bx = 4; // 좌측 clamp
    if (bx + width > canvasW - 4) bx = canvasW - width - 4; // 우측 clamp
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

    // Text — N3: 타이핑 진행에 따라 visible chars 계산
    ctx.fillStyle = colors.text;
    ctx.font = `${BUBBLE_FONT_SIZE}px "Menlo", "Consolas", monospace`;
    ctx.textBaseline = 'top';
    let visibleBudget = bubble.typing ? Math.floor(bubble.typedChars) : Infinity;
    for (let i = 0; i < lines.length; i++) {
      if (visibleBudget <= 0) break;
      const line = lines[i];
      const displayLine = visibleBudget >= line.length ? line : line.slice(0, visibleBudget);
      ctx.fillText(displayLine, bx + BUBBLE_PAD, by + BUBBLE_PAD + i * BUBBLE_LINE_H);
      visibleBudget -= line.length;
    }
    // 커서 (타이핑 중에만)
    if (bubble.typing && bubble.typedChars < bubble.totalChars) {
      const totalVisible = Math.floor(bubble.typedChars);
      // 커서 위치 — 마지막 글자 뒤에 ▌ 블록
      let consumed = 0;
      for (let i = 0; i < lines.length; i++) {
        const lineLen = lines[i].length;
        if (consumed + lineLen >= totalVisible) {
          const offset = totalVisible - consumed;
          const textWidth = ctx.measureText(lines[i].slice(0, offset)).width;
          const blink = Math.floor(Date.now() / 400) % 2;
          if (blink) {
            ctx.fillStyle = colors.text;
            ctx.fillRect(bx + BUBBLE_PAD + textWidth, by + BUBBLE_PAD + i * BUBBLE_LINE_H + 2, 2, BUBBLE_FONT_SIZE);
          }
          break;
        }
        consumed += lineLen;
      }
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
