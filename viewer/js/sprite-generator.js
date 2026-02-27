// sprite-generator.js — High-quality 48x48 chibi character sprite generation (PICO-8 palette)
// Generates spritesheet-style offscreen canvases for each character
// Inspired by Gather Town / RPG Maker quality pixel art

import { PICO8 } from './map.js';

// ─── Color indices in PICO-8 palette ───
const C = {
  BLACK: 0, DARK_BLUE: 1, DARK_PURPLE: 2, DARK_GREEN: 3,
  BROWN: 4, DARK_GREY: 5, LIGHT_GREY: 6, WHITE: 7,
  RED: 8, ORANGE: 9, YELLOW: 10, GREEN: 11,
  BLUE: 12, LAVENDER: 13, PINK: 14, PEACH: 15,
};

// ─── Color helper functions ───

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function rgbToHex(r, g, b) {
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [clamp(r), clamp(g), clamp(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}

function darken(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const f = 1 - amount;
  return rgbToHex(r * f, g * f, b * f);
}

function lighten(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

// ─── Derived color cache ───
// For each PICO-8 color, pre-compute dark, base, highlight shades
const colorShades = {};
function getShades(colorIdx) {
  if (colorShades[colorIdx]) return colorShades[colorIdx];
  const base = PICO8[colorIdx];
  colorShades[colorIdx] = {
    dark: darken(base, 0.35),
    base: base,
    highlight: lighten(base, 0.3),
  };
  return colorShades[colorIdx];
}

// Skin shades
const SKIN_BASE = '#FFCCAA';
const SKIN_SHADOW = '#E8A77A';
const SKIN_HIGHLIGHT = '#FFD9BB';
const SKIN_OUTLINE = '#C48860';

// Pants color (dark blue jeans)
const PANTS_BASE = '#2D3B6E';
const PANTS_DARK = '#1D2B53';
const PANTS_HIGHLIGHT = '#3D4B7E';

// Shoe color
const SHOE_BASE = '#5F574F';
const SHOE_HIGHLIGHT = '#7A726A';
const SHOE_DARK = '#45403A';

// Mouth color
const MOUTH_COLOR = '#AB5236';

// ─── Character visual configs ───
const CHARACTER_CONFIGS = {
  'Player':  { hair: C.DARK_BLUE, shirt: C.WHITE, hairStyle: 'short', skin: C.PEACH },
  'Chris':   { hair: C.BROWN,   shirt: C.BLUE,    hairStyle: 'short',     skin: C.PEACH },
  'Jake':    { hair: C.GREEN,   shirt: C.GREEN,   hairStyle: 'spiky',     skin: C.PEACH },
  'David':   { hair: C.DARK_BLUE, shirt: C.LAVENDER, hairStyle: 'neat',  skin: C.PEACH, glasses: true },
  'Kevin':   { hair: C.BROWN,   shirt: C.ORANGE,  hairStyle: 'cap',       skin: C.PEACH },
  'Sophie':  { hair: C.PINK,    shirt: C.PINK,    hairStyle: 'bob',       skin: C.PEACH },
  'Emily':   { hair: C.YELLOW,  shirt: C.YELLOW,  hairStyle: 'ponytail',  skin: C.PEACH },
  'Michael': { hair: C.BROWN,   shirt: C.DARK_GREEN, hairStyle: 'curly',  skin: C.PEACH, glasses: true },
  'Alex':    { hair: C.DARK_BLUE, shirt: C.BLUE,  hairStyle: 'slick',     skin: C.PEACH },
  'Sam':     { hair: C.RED,     shirt: C.RED,     hairStyle: 'short-r',   skin: C.PEACH },
  // [C] Team — all DARK_BLUE shirts (team uniform)
  'Mia':  { hair: C.PINK,      shirt: C.DARK_BLUE, hairStyle: 'ponytail', skin: C.PEACH },
  'Kai':  { hair: C.BROWN,     shirt: C.DARK_BLUE, hairStyle: 'spiky',    skin: C.PEACH },
  'Zoe':  { hair: C.YELLOW,    shirt: C.DARK_BLUE, hairStyle: 'bob',      skin: C.PEACH },
  'Liam': { hair: C.DARK_BLUE, shirt: C.DARK_BLUE, hairStyle: 'neat',     skin: C.PEACH },
  'Aria': { hair: C.LAVENDER,  shirt: C.DARK_BLUE, hairStyle: 'ponytail', skin: C.PEACH },
  'Noah': { hair: C.GREEN,     shirt: C.DARK_BLUE, hairStyle: 'short',    skin: C.PEACH },
  'Luna': { hair: C.RED,       shirt: C.DARK_BLUE, hairStyle: 'bob',      skin: C.PEACH },
  'Owen': { hair: C.BROWN,     shirt: C.DARK_BLUE, hairStyle: 'curly',    skin: C.PEACH },
};

// ─── Low-level drawing helpers ───

function px(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

// Draw outlined rect: 1px outline of outlineColor, filled with fillColor
function outlinedRect(ctx, x, y, w, h, fillColor, outlineColor) {
  rect(ctx, x, y, w, h, outlineColor);
  if (w > 2 && h > 2) {
    rect(ctx, x + 1, y + 1, w - 2, h - 2, fillColor);
  }
}

// ─── Body part drawing functions ───

function drawShadow(ctx, cx, cy) {
  ctx.fillStyle = 'rgba(29,43,83,0.25)';
  ctx.beginPath();
  ctx.ellipse(cx, cy, 9, 3, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawLegs(ctx, baseX, baseY, legShift, hairShades) {
  const outline = hairShades.dark;
  // Left leg
  const lx = baseX - 5 + legShift;
  rect(ctx, lx, baseY, 5, 8, PANTS_DARK);
  rect(ctx, lx + 1, baseY, 3, 7, PANTS_BASE);
  px(ctx, lx + 2, baseY, PANTS_HIGHLIGHT);
  // Right leg
  const rx = baseX + 2 - legShift;
  rect(ctx, rx, baseY, 5, 8, PANTS_DARK);
  rect(ctx, rx + 1, baseY, 3, 7, PANTS_BASE);
  px(ctx, rx + 2, baseY, PANTS_HIGHLIGHT);

  // Shoes
  const sy = baseY + 7;
  // Left shoe
  rect(ctx, lx - 1, sy, 6, 3, SHOE_DARK);
  rect(ctx, lx, sy, 5, 2, SHOE_BASE);
  px(ctx, lx + 1, sy, SHOE_HIGHLIGHT);
  // Right shoe
  rect(ctx, rx - 1, sy, 6, 3, SHOE_DARK);
  rect(ctx, rx, sy, 5, 2, SHOE_BASE);
  px(ctx, rx + 1, sy, SHOE_HIGHLIGHT);
}

function drawLegsSide(ctx, baseX, baseY, legShift, facingLeft) {
  // Side view legs - slightly overlapping
  const frontLeg = facingLeft ? -2 : 0;
  const backLeg = facingLeft ? 1 : -3;

  // Back leg (slightly behind)
  const bx = baseX + backLeg + (facingLeft ? legShift : -legShift);
  rect(ctx, bx, baseY + 1, 5, 7, PANTS_DARK);
  rect(ctx, bx + 1, baseY + 1, 3, 6, darken(PANTS_BASE, 0.1));
  // Back shoe
  rect(ctx, bx - 1, baseY + 7, 6, 3, SHOE_DARK);

  // Front leg
  const fx = baseX + frontLeg + (facingLeft ? -legShift : legShift);
  rect(ctx, fx, baseY, 5, 8, PANTS_DARK);
  rect(ctx, fx + 1, baseY, 3, 7, PANTS_BASE);
  px(ctx, fx + 2, baseY, PANTS_HIGHLIGHT);
  // Front shoe
  rect(ctx, fx - 1, baseY + 7, 6, 3, SHOE_DARK);
  rect(ctx, fx, baseY + 7, 5, 2, SHOE_BASE);
  px(ctx, fx + 1, baseY + 7, SHOE_HIGHLIGHT);
}

function drawLegsBack(ctx, baseX, baseY, legShift) {
  // Back view same as front structurally
  drawLegs(ctx, baseX, baseY, legShift, { dark: PANTS_DARK });
}

function drawTorso(ctx, baseX, baseY, shirtShades, hairShades) {
  const w = 16;
  const h = 10;
  const x = baseX - w / 2;
  const y = baseY;

  // Main torso
  rect(ctx, x, y, w, h, hairShades.dark); // outline
  rect(ctx, x + 1, y + 1, w - 2, h - 2, shirtShades.base);

  // Collar (2px)
  rect(ctx, x + 4, y, 8, 2, shirtShades.highlight);
  rect(ctx, x + 5, y, 6, 1, lighten(shirtShades.highlight, 0.15));

  // Fold line (subtle center detail)
  rect(ctx, baseX, y + 3, 1, h - 5, shirtShades.highlight);

  // Darker bottom edge
  rect(ctx, x + 1, y + h - 2, w - 2, 1, shirtShades.dark);

  // Side shading
  rect(ctx, x + 1, y + 2, 1, h - 4, shirtShades.dark);
  rect(ctx, x + w - 2, y + 2, 1, h - 4, shirtShades.dark);
}

function drawTorsoSide(ctx, baseX, baseY, shirtShades, facingLeft) {
  const w = 12;
  const h = 10;
  const x = facingLeft ? baseX - w / 2 - 1 : baseX - w / 2 + 1;
  const y = baseY;

  rect(ctx, x, y, w, h, shirtShades.dark);
  rect(ctx, x + 1, y + 1, w - 2, h - 2, shirtShades.base);

  // Collar
  rect(ctx, x + 2, y, 6, 2, shirtShades.highlight);

  // Side shading
  const shadowSide = facingLeft ? x + w - 3 : x + 1;
  rect(ctx, shadowSide, y + 2, 2, h - 4, shirtShades.dark);
}

function drawTorsoBack(ctx, baseX, baseY, shirtShades) {
  const w = 16;
  const h = 10;
  const x = baseX - w / 2;
  const y = baseY;

  rect(ctx, x, y, w, h, shirtShades.dark);
  rect(ctx, x + 1, y + 1, w - 2, h - 2, shirtShades.base);

  // Back collar
  rect(ctx, x + 4, y, 8, 1, shirtShades.highlight);

  // Back seam
  rect(ctx, baseX, y + 2, 1, h - 3, shirtShades.dark);
}

function drawArms(ctx, torsoX, torsoY, shirtShades, armSwing) {
  // Left arm
  const lax = torsoX - 11;
  const lay = torsoY + 1 + armSwing;
  rect(ctx, lax, lay, 4, 8, shirtShades.dark);
  rect(ctx, lax + 1, lay + 1, 2, 6, shirtShades.base);
  // Hand
  rect(ctx, lax, lay + 7, 4, 3, SKIN_OUTLINE);
  rect(ctx, lax + 1, lay + 7, 2, 2, SKIN_BASE);

  // Right arm
  const rax = torsoX + 7;
  const ray = torsoY + 1 - armSwing;
  rect(ctx, rax, ray, 4, 8, shirtShades.dark);
  rect(ctx, rax + 1, ray + 1, 2, 6, shirtShades.base);
  // Hand
  rect(ctx, rax, ray + 7, 4, 3, SKIN_OUTLINE);
  rect(ctx, rax + 1, ray + 7, 2, 2, SKIN_BASE);
}

function drawArmsSide(ctx, torsoX, torsoY, shirtShades, armSwing, facingLeft) {
  // Side view: one arm in front, one behind
  const ax = facingLeft ? torsoX - 2 : torsoX - 2;
  // Back arm (slightly behind body)
  const bay = torsoY + 2 + armSwing;
  rect(ctx, ax, bay, 4, 7, shirtShades.dark);
  rect(ctx, ax + 1, bay + 1, 2, 5, darken(shirtShades.base, 0.1));
  rect(ctx, ax, bay + 6, 4, 2, SKIN_OUTLINE);
  rect(ctx, ax + 1, bay + 6, 2, 1, darken(SKIN_BASE, 0.05));

  // Front arm
  const fay = torsoY + 1 - armSwing;
  rect(ctx, ax, fay, 4, 8, shirtShades.dark);
  rect(ctx, ax + 1, fay + 1, 2, 6, shirtShades.base);
  rect(ctx, ax, fay + 7, 4, 3, SKIN_OUTLINE);
  rect(ctx, ax + 1, fay + 7, 2, 2, SKIN_BASE);
}

function drawArmsBack(ctx, torsoX, torsoY, shirtShades, armSwing) {
  drawArms(ctx, torsoX, torsoY, shirtShades, armSwing);
}

// ─── Head drawing ───

function drawHeadFront(ctx, cx, cy, hairShades, glasses) {
  const headW = 18;
  const headH = 16;
  const x = cx - headW / 2;
  const y = cy;

  // Head outline using hair dark shade for softer look
  rect(ctx, x, y + 1, headW, headH - 1, hairShades.dark);
  rect(ctx, x + 1, y, headW - 2, headH, hairShades.dark);
  // Skin fill
  rect(ctx, x + 1, y + 1, headW - 2, headH - 2, SKIN_BASE);
  // Skin shadow (right side of face)
  rect(ctx, cx + 2, y + 2, 5, headH - 5, SKIN_SHADOW);
  // Skin highlight (left cheek area)
  px(ctx, cx - 5, cy + 8, SKIN_HIGHLIGHT);
  px(ctx, cx - 4, cy + 8, SKIN_HIGHLIGHT);

  // Eyes - positioned at row ~8-10 from top of head
  const eyeY = cy + 7;
  const leftEyeX = cx - 5;
  const rightEyeX = cx + 2;

  // Left eye
  px(ctx, leftEyeX, eyeY, '#FFFFFF');     // sclera left
  px(ctx, leftEyeX + 1, eyeY, '#1D2B53'); // pupil
  px(ctx, leftEyeX + 2, eyeY, '#1D2B53'); // pupil
  px(ctx, leftEyeX, eyeY + 1, '#FFFFFF');
  px(ctx, leftEyeX + 1, eyeY + 1, hairShades.base); // iris color dot
  px(ctx, leftEyeX + 2, eyeY + 1, '#1D2B53');
  px(ctx, leftEyeX, eyeY + 2, '#FFFFFF');
  px(ctx, leftEyeX + 1, eyeY + 2, '#1D2B53');
  px(ctx, leftEyeX + 2, eyeY + 2, '#1D2B53');

  // Right eye
  px(ctx, rightEyeX, eyeY, '#1D2B53');
  px(ctx, rightEyeX + 1, eyeY, '#1D2B53');
  px(ctx, rightEyeX + 2, eyeY, '#FFFFFF');
  px(ctx, rightEyeX, eyeY + 1, '#1D2B53');
  px(ctx, rightEyeX + 1, eyeY + 1, hairShades.base);
  px(ctx, rightEyeX + 2, eyeY + 1, '#FFFFFF');
  px(ctx, rightEyeX, eyeY + 2, '#1D2B53');
  px(ctx, rightEyeX + 1, eyeY + 2, '#1D2B53');
  px(ctx, rightEyeX + 2, eyeY + 2, '#FFFFFF');

  // Eyebrows
  rect(ctx, leftEyeX, eyeY - 2, 3, 1, hairShades.dark);
  rect(ctx, rightEyeX, eyeY - 2, 3, 1, hairShades.dark);

  // Mouth
  rect(ctx, cx - 1, cy + 12, 2, 1, MOUTH_COLOR);

  // Glasses
  if (glasses) {
    drawGlassesFront(ctx, cx, eyeY, hairShades);
  }
}

function drawHeadSide(ctx, cx, cy, hairShades, glasses, facingLeft) {
  const headW = 16;
  const headH = 16;
  const x = facingLeft ? cx - headW / 2 - 1 : cx - headW / 2 + 1;
  const y = cy;

  // Head outline
  rect(ctx, x, y + 1, headW, headH - 1, hairShades.dark);
  rect(ctx, x + 1, y, headW - 2, headH, hairShades.dark);
  // Skin fill
  rect(ctx, x + 1, y + 1, headW - 2, headH - 2, SKIN_BASE);
  // Shadow on far side
  if (facingLeft) {
    rect(ctx, x + headW - 4, y + 2, 3, headH - 5, SKIN_SHADOW);
  } else {
    rect(ctx, x + 1, y + 2, 3, headH - 5, SKIN_SHADOW);
  }

  // One eye visible (side view)
  const eyeY = cy + 7;
  const eyeX = facingLeft ? cx - 4 : cx + 1;

  // Eye
  px(ctx, eyeX, eyeY, '#FFFFFF');
  px(ctx, eyeX + 1, eyeY, '#1D2B53');
  px(ctx, eyeX + 2, eyeY, '#1D2B53');
  px(ctx, eyeX, eyeY + 1, '#FFFFFF');
  px(ctx, eyeX + 1, eyeY + 1, hairShades.base);
  px(ctx, eyeX + 2, eyeY + 1, '#1D2B53');
  px(ctx, eyeX, eyeY + 2, '#FFFFFF');
  px(ctx, eyeX + 1, eyeY + 2, '#1D2B53');
  px(ctx, eyeX + 2, eyeY + 2, '#1D2B53');

  // Eyebrow
  rect(ctx, eyeX, eyeY - 2, 3, 1, hairShades.dark);

  // Mouth
  const mouthX = facingLeft ? cx - 3 : cx + 1;
  rect(ctx, mouthX, cy + 12, 2, 1, MOUTH_COLOR);

  // Nose hint (1px)
  const noseX = facingLeft ? cx - 5 : cx + 4;
  px(ctx, noseX, cy + 9, SKIN_SHADOW);

  if (glasses) {
    drawGlassesSide(ctx, cx, eyeY, facingLeft);
  }
}

function drawHeadBack(ctx, cx, cy, hairShades) {
  const headW = 18;
  const headH = 16;
  const x = cx - headW / 2;
  const y = cy;

  // Head outline
  rect(ctx, x, y + 1, headW, headH - 1, hairShades.dark);
  rect(ctx, x + 1, y, headW - 2, headH, hairShades.dark);
  // Skin fill (barely visible under hair)
  rect(ctx, x + 1, y + 1, headW - 2, headH - 2, SKIN_BASE);
  // Neck area at bottom
  rect(ctx, cx - 3, cy + headH - 2, 6, 3, SKIN_BASE);
  rect(ctx, cx - 2, cy + headH - 1, 4, 2, SKIN_SHADOW);
  // Ears hint
  px(ctx, x, cy + 7, SKIN_SHADOW);
  px(ctx, x + headW - 1, cy + 7, SKIN_SHADOW);
}

// ─── Glasses ───

function drawGlassesFront(ctx, cx, eyeY) {
  const frameColor = '#5F574F';
  const lensColor = 'rgba(180, 210, 240, 0.4)';

  // Left lens frame
  rect(ctx, cx - 6, eyeY - 1, 5, 5, frameColor);
  ctx.fillStyle = lensColor;
  ctx.fillRect(cx - 5, eyeY, 3, 3);

  // Right lens frame
  rect(ctx, cx + 1, eyeY - 1, 5, 5, frameColor);
  ctx.fillStyle = lensColor;
  ctx.fillRect(cx + 2, eyeY, 3, 3);

  // Bridge
  rect(ctx, cx - 1, eyeY, 2, 1, frameColor);
}

function drawGlassesSide(ctx, cx, eyeY, facingLeft) {
  const frameColor = '#5F574F';
  const lensColor = 'rgba(180, 210, 240, 0.4)';
  const lx = facingLeft ? cx - 5 : cx;

  rect(ctx, lx, eyeY - 1, 5, 5, frameColor);
  ctx.fillStyle = lensColor;
  ctx.fillRect(lx + 1, eyeY, 3, 3);

  // Temple (arm of glasses going to ear)
  const templeX = facingLeft ? lx + 5 : lx - 1;
  rect(ctx, templeX, eyeY, 2, 1, frameColor);
}

// ─── Hair drawing ───

function drawHairFront(ctx, cx, cy, style, hairShades) {
  const { dark, base, highlight } = hairShades;
  const headTop = cy;
  const headLeft = cx - 9;
  const headRight = cx + 9;

  switch (style) {
    case 'short': {
      // Messy fringe covering top of head
      rect(ctx, headLeft, headTop - 2, 18, 5, dark);
      rect(ctx, headLeft + 1, headTop - 3, 16, 4, base);
      rect(ctx, headLeft + 2, headTop - 2, 14, 3, base);
      // Fringe strands
      rect(ctx, cx - 5, headTop + 1, 3, 3, base);
      rect(ctx, cx - 1, headTop, 4, 3, base);
      rect(ctx, cx + 3, headTop + 1, 3, 2, base);
      // Highlights
      rect(ctx, cx - 3, headTop - 3, 2, 1, highlight);
      rect(ctx, cx + 2, headTop - 2, 3, 1, highlight);
      // Side hair
      rect(ctx, headLeft, headTop + 2, 2, 4, dark);
      rect(ctx, headRight - 2, headTop + 2, 2, 4, dark);
      break;
    }

    case 'spiky': {
      // Base hair
      rect(ctx, headLeft, headTop - 1, 18, 4, dark);
      rect(ctx, headLeft + 1, headTop - 1, 16, 3, base);
      // Spikes going up
      // Spike 1 (left)
      rect(ctx, cx - 7, headTop - 4, 3, 5, base);
      rect(ctx, cx - 6, headTop - 5, 2, 3, base);
      px(ctx, cx - 6, headTop - 6, highlight);
      // Spike 2 (center-left)
      rect(ctx, cx - 3, headTop - 6, 3, 7, base);
      rect(ctx, cx - 2, headTop - 7, 2, 4, base);
      px(ctx, cx - 2, headTop - 8, highlight);
      // Spike 3 (center-right)
      rect(ctx, cx + 1, headTop - 5, 3, 6, base);
      rect(ctx, cx + 2, headTop - 7, 2, 4, base);
      px(ctx, cx + 2, headTop - 8, highlight);
      // Spike 4 (right)
      rect(ctx, cx + 5, headTop - 3, 3, 4, base);
      rect(ctx, cx + 6, headTop - 4, 2, 2, base);
      px(ctx, cx + 6, headTop - 5, highlight);
      // Fringe
      rect(ctx, cx - 4, headTop + 1, 3, 2, base);
      rect(ctx, cx + 2, headTop + 1, 3, 2, base);
      // Highlights on spikes
      px(ctx, cx - 6, headTop - 4, highlight);
      px(ctx, cx - 2, headTop - 6, highlight);
      px(ctx, cx + 2, headTop - 6, highlight);
      break;
    }

    case 'neat': {
      // Clean side-parted hair
      rect(ctx, headLeft, headTop - 2, 18, 5, dark);
      rect(ctx, headLeft + 1, headTop - 3, 16, 4, base);
      // Part line (left side)
      rect(ctx, cx - 3, headTop - 3, 1, 3, dark);
      // Left side (shorter)
      rect(ctx, headLeft, headTop, 6, 4, base);
      rect(ctx, headLeft, headTop + 3, 3, 3, base);
      // Right side (longer, swept over)
      rect(ctx, cx - 2, headTop - 1, 11, 4, base);
      rect(ctx, headRight - 4, headTop + 2, 4, 4, base);
      rect(ctx, headRight - 3, headTop + 5, 3, 2, base);
      // Highlights
      rect(ctx, cx + 1, headTop - 3, 4, 1, highlight);
      rect(ctx, cx + 3, headTop - 2, 2, 1, highlight);
      // Side tuck
      rect(ctx, headLeft, headTop + 2, 2, 5, dark);
      break;
    }

    case 'cap': {
      // Baseball cap
      const capColor = hairShades.base;
      const capDark = hairShades.dark;
      const capHighlight = hairShades.highlight;

      // Cap dome
      rect(ctx, headLeft - 1, headTop - 4, 20, 7, capDark);
      rect(ctx, headLeft, headTop - 5, 18, 6, capColor);
      rect(ctx, headLeft + 1, headTop - 5, 16, 5, capColor);
      // Cap brim (extends forward)
      rect(ctx, headLeft - 3, headTop + 2, 24, 3, capDark);
      rect(ctx, headLeft - 2, headTop + 2, 22, 2, capColor);
      // Brim shadow on face
      rect(ctx, headLeft + 1, headTop + 4, 16, 1, 'rgba(0,0,0,0.15)');
      // Cap button on top
      px(ctx, cx, headTop - 5, capHighlight);
      // Cap highlight
      rect(ctx, cx - 4, headTop - 4, 5, 1, capHighlight);
      // Hair peeking from under cap
      rect(ctx, headLeft, headTop + 3, 3, 3, darken(PICO8[C.BROWN], 0.2));
      rect(ctx, headRight - 3, headTop + 3, 3, 3, darken(PICO8[C.BROWN], 0.2));
      break;
    }

    case 'bob': {
      // Chin-length bob with bangs
      rect(ctx, headLeft - 2, headTop - 2, 22, 5, dark);
      rect(ctx, headLeft - 1, headTop - 3, 20, 4, base);
      // Bangs (full fringe)
      rect(ctx, headLeft, headTop, 18, 4, base);
      rect(ctx, headLeft + 1, headTop + 1, 16, 2, base);
      // Bangs detail lines
      rect(ctx, cx - 3, headTop, 1, 4, dark);
      rect(ctx, cx + 3, headTop, 1, 4, dark);
      // Left side (chin-length)
      rect(ctx, headLeft - 2, headTop + 2, 4, 12, dark);
      rect(ctx, headLeft - 1, headTop + 2, 3, 11, base);
      px(ctx, headLeft - 1, headTop + 3, highlight);
      // Right side (chin-length)
      rect(ctx, headRight - 2, headTop + 2, 4, 12, dark);
      rect(ctx, headRight - 2, headTop + 2, 3, 11, base);
      px(ctx, headRight - 1, headTop + 3, highlight);
      // Rounded bottom of sides
      rect(ctx, headLeft - 1, headTop + 12, 2, 1, dark);
      rect(ctx, headRight - 1, headTop + 12, 2, 1, dark);
      // Top highlight
      rect(ctx, cx - 2, headTop - 3, 4, 1, highlight);
      break;
    }

    case 'ponytail': {
      // Neat top with visible ponytail base
      rect(ctx, headLeft, headTop - 2, 18, 5, dark);
      rect(ctx, headLeft + 1, headTop - 3, 16, 4, base);
      // Front bangs (swept to side)
      rect(ctx, headLeft + 1, headTop, 7, 4, base);
      rect(ctx, headLeft + 2, headTop + 1, 5, 2, base);
      // Hair highlight
      rect(ctx, cx - 2, headTop - 3, 3, 1, highlight);
      // Side wisps
      rect(ctx, headLeft, headTop + 2, 2, 4, base);
      rect(ctx, headRight - 2, headTop + 2, 2, 3, base);
      // Ponytail holder (visible from front as small bump at back)
      rect(ctx, cx - 1, headTop - 1, 2, 1, dark);
      break;
    }

    case 'curly': {
      // Voluminous curly hair, wider than head
      rect(ctx, headLeft - 3, headTop - 3, 24, 6, dark);
      rect(ctx, headLeft - 2, headTop - 4, 22, 5, base);
      // Bumpy outline on top (curls)
      rect(ctx, headLeft - 2, headTop - 5, 4, 2, base);
      rect(ctx, cx - 4, headTop - 6, 4, 3, base);
      rect(ctx, cx + 1, headTop - 5, 4, 2, base);
      rect(ctx, headRight - 1, headTop - 4, 3, 2, base);
      // Side curls (left)
      rect(ctx, headLeft - 3, headTop + 1, 4, 8, dark);
      rect(ctx, headLeft - 2, headTop + 1, 3, 7, base);
      rect(ctx, headLeft - 3, headTop + 3, 2, 2, base);
      rect(ctx, headLeft - 2, headTop + 7, 2, 2, base);
      // Side curls (right)
      rect(ctx, headRight - 1, headTop + 1, 4, 8, dark);
      rect(ctx, headRight - 1, headTop + 1, 3, 7, base);
      rect(ctx, headRight + 1, headTop + 3, 2, 2, base);
      rect(ctx, headRight, headTop + 7, 2, 2, base);
      // Front bangs (curly)
      rect(ctx, headLeft + 1, headTop + 1, 5, 3, base);
      rect(ctx, cx + 2, headTop + 1, 5, 3, base);
      // Highlights
      px(ctx, cx - 3, headTop - 5, highlight);
      px(ctx, cx + 2, headTop - 4, highlight);
      px(ctx, headLeft - 1, headTop + 2, highlight);
      px(ctx, headRight, headTop + 2, highlight);
      break;
    }

    case 'slick': {
      // Swept back, clean, shiny
      rect(ctx, headLeft, headTop - 2, 18, 5, dark);
      rect(ctx, headLeft + 1, headTop - 3, 16, 4, base);
      // Swept back lines
      rect(ctx, headLeft + 2, headTop - 2, 14, 3, base);
      rect(ctx, headLeft + 3, headTop - 3, 12, 2, base);
      // Multiple shine highlights (shiny look)
      rect(ctx, cx - 4, headTop - 3, 2, 1, highlight);
      rect(ctx, cx, headTop - 2, 3, 1, highlight);
      rect(ctx, cx + 4, headTop - 2, 2, 1, highlight);
      px(ctx, cx - 2, headTop - 2, lighten(highlight, 0.2));
      px(ctx, cx + 1, headTop - 3, lighten(highlight, 0.2));
      // Sides (tight)
      rect(ctx, headLeft, headTop + 2, 2, 4, dark);
      rect(ctx, headRight - 2, headTop + 2, 2, 4, dark);
      // Back flow visible
      rect(ctx, headRight - 2, headTop + 1, 3, 3, base);
      break;
    }

    case 'short-r': {
      // Short and slightly spiky, messy-cute
      rect(ctx, headLeft, headTop - 2, 18, 5, dark);
      rect(ctx, headLeft + 1, headTop - 3, 16, 4, base);
      // Messy tufts
      rect(ctx, cx - 6, headTop - 3, 3, 3, base);
      rect(ctx, cx - 2, headTop - 4, 3, 3, base);
      rect(ctx, cx + 2, headTop - 3, 3, 2, base);
      rect(ctx, cx + 5, headTop - 2, 2, 2, base);
      // Little spike
      px(ctx, cx - 1, headTop - 5, base);
      px(ctx, cx, headTop - 5, base);
      // Fringe
      rect(ctx, headLeft + 2, headTop + 1, 5, 2, base);
      rect(ctx, cx + 1, headTop + 1, 4, 2, base);
      // Highlights
      px(ctx, cx - 1, headTop - 4, highlight);
      px(ctx, cx + 3, headTop - 3, highlight);
      // Sides
      rect(ctx, headLeft, headTop + 2, 2, 3, dark);
      rect(ctx, headRight - 2, headTop + 2, 2, 3, dark);
      break;
    }
  }
}

function drawHairSide(ctx, cx, cy, style, hairShades, facingLeft) {
  const { dark, base, highlight } = hairShades;
  const headTop = cy;
  const headLeft = cx - 8;
  const headRight = cx + 8;
  const flipX = facingLeft ? -1 : 1;

  switch (style) {
    case 'short': {
      rect(ctx, headLeft, headTop - 2, 16, 5, dark);
      rect(ctx, headLeft + 1, headTop - 3, 14, 4, base);
      // Side fringe
      if (facingLeft) {
        rect(ctx, headLeft, headTop, 5, 4, base);
        rect(ctx, headLeft - 1, headTop + 1, 3, 2, base);
      } else {
        rect(ctx, headRight - 5, headTop, 5, 4, base);
        rect(ctx, headRight - 1, headTop + 1, 3, 2, base);
      }
      // Back
      const backX = facingLeft ? headRight - 3 : headLeft;
      rect(ctx, backX, headTop, 3, 5, dark);
      rect(ctx, cx - 2, headTop - 3, 3, 1, highlight);
      break;
    }

    case 'spiky': {
      rect(ctx, headLeft, headTop - 1, 16, 4, dark);
      rect(ctx, headLeft + 1, headTop - 1, 14, 3, base);
      // Side spikes
      rect(ctx, cx - 3, headTop - 5, 3, 5, base);
      rect(ctx, cx - 2, headTop - 7, 2, 4, base);
      rect(ctx, cx + 1, headTop - 4, 3, 4, base);
      rect(ctx, cx + 2, headTop - 6, 2, 3, base);
      if (facingLeft) {
        rect(ctx, headLeft - 1, headTop - 3, 3, 4, base);
        px(ctx, headLeft - 1, headTop - 4, base);
      } else {
        rect(ctx, headRight - 2, headTop - 3, 3, 4, base);
        px(ctx, headRight, headTop - 4, base);
      }
      px(ctx, cx - 1, headTop - 7, highlight);
      px(ctx, cx + 2, headTop - 5, highlight);
      break;
    }

    case 'neat': {
      rect(ctx, headLeft, headTop - 2, 16, 5, dark);
      rect(ctx, headLeft + 1, headTop - 3, 14, 4, base);
      // Longer side
      if (facingLeft) {
        rect(ctx, headLeft - 1, headTop, 5, 6, base);
        rect(ctx, headLeft - 1, headTop + 4, 3, 4, base);
        rect(ctx, headRight - 2, headTop, 2, 4, dark);
      } else {
        rect(ctx, headRight - 4, headTop, 5, 6, base);
        rect(ctx, headRight - 2, headTop + 4, 3, 4, base);
        rect(ctx, headLeft, headTop, 2, 4, dark);
      }
      rect(ctx, cx, headTop - 3, 3, 1, highlight);
      break;
    }

    case 'cap': {
      const capColor = base;
      const capDark = dark;
      rect(ctx, headLeft - 1, headTop - 4, 18, 7, capDark);
      rect(ctx, headLeft, headTop - 5, 16, 6, capColor);
      // Brim
      if (facingLeft) {
        rect(ctx, headLeft - 5, headTop + 2, 14, 3, capDark);
        rect(ctx, headLeft - 4, headTop + 2, 12, 2, capColor);
      } else {
        rect(ctx, headRight - 8, headTop + 2, 14, 3, capDark);
        rect(ctx, headRight - 7, headTop + 2, 12, 2, capColor);
      }
      rect(ctx, cx - 3, headTop - 4, 4, 1, highlight);
      // Hair peeking
      const peekX = facingLeft ? headRight - 3 : headLeft;
      rect(ctx, peekX, headTop + 3, 3, 3, darken(PICO8[C.BROWN], 0.2));
      break;
    }

    case 'bob': {
      rect(ctx, headLeft - 1, headTop - 2, 18, 5, dark);
      rect(ctx, headLeft, headTop - 3, 16, 4, base);
      // Side hair (chin-length)
      if (facingLeft) {
        rect(ctx, headLeft - 2, headTop, 5, 13, dark);
        rect(ctx, headLeft - 1, headTop, 4, 12, base);
        rect(ctx, headRight - 2, headTop, 3, 6, dark);
      } else {
        rect(ctx, headRight - 3, headTop, 5, 13, dark);
        rect(ctx, headRight - 3, headTop, 4, 12, base);
        rect(ctx, headLeft, headTop, 3, 6, dark);
      }
      // Bangs
      rect(ctx, headLeft + 2, headTop, 5, 4, base);
      px(ctx, cx, headTop - 3, highlight);
      break;
    }

    case 'ponytail': {
      rect(ctx, headLeft, headTop - 2, 16, 5, dark);
      rect(ctx, headLeft + 1, headTop - 3, 14, 4, base);
      // Front wisps
      if (facingLeft) {
        rect(ctx, headLeft, headTop, 4, 4, base);
      } else {
        rect(ctx, headRight - 4, headTop, 4, 4, base);
      }
      // Ponytail (extending behind head)
      const ptX = facingLeft ? headRight - 1 : headLeft - 3;
      rect(ctx, ptX, headTop, 4, 3, dark);
      rect(ctx, ptX, headTop + 2, 3, 3, base);
      rect(ctx, ptX - 1, headTop + 4, 3, 4, base);
      rect(ctx, ptX - 1, headTop + 7, 2, 3, base);
      px(ctx, ptX, headTop + 1, highlight);
      // Hair tie
      rect(ctx, ptX, headTop + 1, 2, 2, dark);
      rect(ctx, cx, headTop - 3, 2, 1, highlight);
      break;
    }

    case 'curly': {
      rect(ctx, headLeft - 2, headTop - 3, 20, 6, dark);
      rect(ctx, headLeft - 1, headTop - 4, 18, 5, base);
      // Side curls
      if (facingLeft) {
        rect(ctx, headLeft - 3, headTop, 5, 9, dark);
        rect(ctx, headLeft - 2, headTop, 4, 8, base);
        rect(ctx, headLeft - 3, headTop + 3, 2, 2, base);
        rect(ctx, headLeft - 2, headTop + 7, 2, 2, base);
        rect(ctx, headRight - 2, headTop, 3, 5, dark);
      } else {
        rect(ctx, headRight - 2, headTop, 5, 9, dark);
        rect(ctx, headRight - 2, headTop, 4, 8, base);
        rect(ctx, headRight + 1, headTop + 3, 2, 2, base);
        rect(ctx, headRight, headTop + 7, 2, 2, base);
        rect(ctx, headLeft, headTop, 3, 5, dark);
      }
      // Top curls
      rect(ctx, cx - 3, headTop - 5, 3, 2, base);
      rect(ctx, cx + 1, headTop - 4, 3, 2, base);
      px(ctx, cx - 2, headTop - 5, highlight);
      px(ctx, cx + 2, headTop - 4, highlight);
      break;
    }

    case 'slick': {
      rect(ctx, headLeft, headTop - 2, 16, 5, dark);
      rect(ctx, headLeft + 1, headTop - 3, 14, 4, base);
      rect(ctx, headLeft + 2, headTop - 2, 12, 3, base);
      // Swept back flow
      const backX = facingLeft ? headRight - 2 : headLeft;
      rect(ctx, backX, headTop, 3, 5, base);
      rect(ctx, backX, headTop + 4, 2, 2, base);
      // Multiple highlights
      px(ctx, cx - 2, headTop - 3, highlight);
      px(ctx, cx + 1, headTop - 2, highlight);
      rect(ctx, cx - 1, headTop - 3, 2, 1, lighten(highlight, 0.2));
      // Sides
      rect(ctx, headLeft, headTop + 2, 2, 3, dark);
      rect(ctx, headRight - 2, headTop + 2, 2, 3, dark);
      break;
    }

    case 'short-r': {
      rect(ctx, headLeft, headTop - 2, 16, 5, dark);
      rect(ctx, headLeft + 1, headTop - 3, 14, 4, base);
      // Messy tufts (side view)
      rect(ctx, cx - 3, headTop - 4, 3, 3, base);
      rect(ctx, cx + 1, headTop - 3, 3, 2, base);
      px(ctx, cx, headTop - 5, base);
      // Front tuft
      if (facingLeft) {
        rect(ctx, headLeft, headTop, 4, 3, base);
      } else {
        rect(ctx, headRight - 4, headTop, 4, 3, base);
      }
      px(ctx, cx - 1, headTop - 4, highlight);
      rect(ctx, headLeft, headTop + 2, 2, 3, dark);
      rect(ctx, headRight - 2, headTop + 2, 2, 3, dark);
      break;
    }
  }
}

function drawHairBack(ctx, cx, cy, style, hairShades) {
  const { dark, base, highlight } = hairShades;
  const headTop = cy;
  const headLeft = cx - 9;
  const headRight = cx + 9;

  switch (style) {
    case 'short': {
      rect(ctx, headLeft, headTop - 2, 18, 6, dark);
      rect(ctx, headLeft + 1, headTop - 3, 16, 5, base);
      rect(ctx, headLeft + 2, headTop - 2, 14, 4, base);
      rect(ctx, headLeft, headTop + 2, 2, 4, dark);
      rect(ctx, headRight - 2, headTop + 2, 2, 4, dark);
      px(ctx, cx, headTop - 3, highlight);
      rect(ctx, cx - 3, headTop - 2, 6, 1, highlight);
      break;
    }

    case 'spiky': {
      rect(ctx, headLeft, headTop - 1, 18, 5, dark);
      rect(ctx, headLeft + 1, headTop - 1, 16, 4, base);
      // Back spikes
      rect(ctx, cx - 6, headTop - 4, 3, 4, base);
      rect(ctx, cx - 2, headTop - 6, 3, 6, base);
      rect(ctx, cx + 2, headTop - 5, 3, 5, base);
      rect(ctx, cx + 5, headTop - 3, 3, 3, base);
      px(ctx, cx - 1, headTop - 7, highlight);
      px(ctx, cx + 3, headTop - 5, highlight);
      rect(ctx, headLeft, headTop + 2, 18, 4, base);
      break;
    }

    case 'neat': {
      rect(ctx, headLeft, headTop - 2, 18, 7, dark);
      rect(ctx, headLeft + 1, headTop - 3, 16, 5, base);
      // Part visible from back
      rect(ctx, cx - 3, headTop - 2, 1, 6, dark);
      rect(ctx, headLeft, headTop + 2, 3, 5, base);
      rect(ctx, headRight - 3, headTop + 2, 3, 6, base);
      rect(ctx, cx, headTop - 3, 3, 1, highlight);
      break;
    }

    case 'cap': {
      rect(ctx, headLeft - 1, headTop - 4, 20, 8, dark);
      rect(ctx, headLeft, headTop - 5, 18, 7, base);
      // Cap adjustment strap
      rect(ctx, cx - 3, headTop + 1, 6, 2, dark);
      rect(ctx, cx - 2, headTop + 1, 4, 1, darken(base, 0.2));
      // Hair peeking
      rect(ctx, headLeft, headTop + 3, 4, 3, darken(PICO8[C.BROWN], 0.2));
      rect(ctx, headRight - 4, headTop + 3, 4, 3, darken(PICO8[C.BROWN], 0.2));
      px(ctx, cx, headTop - 5, highlight);
      break;
    }

    case 'bob': {
      rect(ctx, headLeft - 1, headTop - 2, 20, 6, dark);
      rect(ctx, headLeft, headTop - 3, 18, 5, base);
      // Back of bob (rounded)
      rect(ctx, headLeft - 2, headTop + 2, 22, 8, dark);
      rect(ctx, headLeft - 1, headTop + 2, 20, 7, base);
      rect(ctx, headLeft, headTop + 8, 18, 3, base);
      rect(ctx, headLeft + 1, headTop + 10, 16, 1, dark);
      px(ctx, cx, headTop - 3, highlight);
      rect(ctx, cx - 3, headTop + 3, 6, 1, highlight);
      break;
    }

    case 'ponytail': {
      rect(ctx, headLeft, headTop - 2, 18, 6, dark);
      rect(ctx, headLeft + 1, headTop - 3, 16, 5, base);
      // Ponytail extending down from back
      // Hair tie
      rect(ctx, cx - 2, headTop + 3, 4, 2, dark);
      // Ponytail body
      rect(ctx, cx - 2, headTop + 4, 4, 4, base);
      rect(ctx, cx - 1, headTop + 7, 3, 4, base);
      rect(ctx, cx - 1, headTop + 10, 2, 3, base);
      px(ctx, cx, headTop + 12, dark);
      // Highlight on ponytail
      px(ctx, cx, headTop + 5, highlight);
      px(ctx, cx, headTop + 8, highlight);
      rect(ctx, cx - 2, headTop - 3, 3, 1, highlight);
      break;
    }

    case 'curly': {
      rect(ctx, headLeft - 2, headTop - 3, 22, 7, dark);
      rect(ctx, headLeft - 1, headTop - 4, 20, 6, base);
      // Top curls
      rect(ctx, headLeft - 1, headTop - 5, 4, 2, base);
      rect(ctx, cx - 3, headTop - 6, 4, 3, base);
      rect(ctx, cx + 2, headTop - 5, 4, 2, base);
      // Back curls (voluminous)
      rect(ctx, headLeft - 3, headTop + 2, 24, 7, dark);
      rect(ctx, headLeft - 2, headTop + 2, 22, 6, base);
      rect(ctx, headLeft - 3, headTop + 4, 2, 3, base);
      rect(ctx, headRight + 1, headTop + 4, 2, 3, base);
      rect(ctx, headLeft - 1, headTop + 8, 20, 2, base);
      px(ctx, cx - 2, headTop - 6, highlight);
      px(ctx, cx + 3, headTop - 5, highlight);
      px(ctx, cx, headTop + 3, highlight);
      break;
    }

    case 'slick': {
      rect(ctx, headLeft, headTop - 2, 18, 7, dark);
      rect(ctx, headLeft + 1, headTop - 3, 16, 6, base);
      rect(ctx, headLeft + 2, headTop - 2, 14, 5, base);
      // Swept back lines visible
      rect(ctx, cx - 5, headTop, 10, 1, dark);
      rect(ctx, cx - 4, headTop + 2, 8, 1, dark);
      // Multiple highlights (shiny)
      rect(ctx, cx - 3, headTop - 3, 2, 1, highlight);
      rect(ctx, cx + 1, headTop - 2, 3, 1, highlight);
      px(ctx, cx, headTop - 3, lighten(highlight, 0.3));
      rect(ctx, headLeft, headTop + 3, 2, 3, dark);
      rect(ctx, headRight - 2, headTop + 3, 2, 3, dark);
      break;
    }

    case 'short-r': {
      rect(ctx, headLeft, headTop - 2, 18, 6, dark);
      rect(ctx, headLeft + 1, headTop - 3, 16, 5, base);
      // Messy back tufts
      rect(ctx, cx - 5, headTop - 3, 3, 2, base);
      rect(ctx, cx - 1, headTop - 4, 3, 2, base);
      rect(ctx, cx + 3, headTop - 3, 3, 2, base);
      px(ctx, cx, headTop - 5, base);
      rect(ctx, headLeft, headTop + 2, 2, 4, dark);
      rect(ctx, headRight - 2, headTop + 2, 2, 4, dark);
      px(ctx, cx - 1, headTop - 4, highlight);
      break;
    }
  }
}

// ─── Main character frame drawing function ───

function drawCharacterFrame(ctx, config, dir, frame, isIdle) {
  const { hair, shirt, hairStyle, glasses } = config;

  const hairShades = getShades(hair);
  const shirtShades = getShades(shirt);

  // Center of 48x48 frame
  const cx = 24;

  // Walk animation offsets
  const bob = isIdle ? (frame === 0 ? 0 : -1) : ([0, -1, 0, -1][frame]);
  const legShift = isIdle ? 0 : ([0, 2, 0, -2][frame]);
  const armSwing = isIdle ? 0 : ([0, 1, 0, -1][frame]);

  // Y positions (from top of 48px frame)
  const headY = 6 + bob;
  const torsoY = 20 + bob;
  const legY = 29 + bob;
  const shadowY = 41;

  // 1. Shadow
  drawShadow(ctx, cx, shadowY);

  if (dir === 0) {
    // ── FACING DOWN (front view) ──

    // 2. Back hair (for styles that have back elements)
    // 3. Legs
    drawLegs(ctx, cx, legY, legShift, hairShades);
    // 4. Torso
    drawTorso(ctx, cx, torsoY, shirtShades, hairShades);
    // 5. Arms
    drawArms(ctx, cx, torsoY, shirtShades, armSwing);
    // 6. Head
    drawHeadFront(ctx, cx, headY, hairShades, glasses);
    // 7. Hair (front)
    drawHairFront(ctx, cx, headY, hairStyle, hairShades);

  } else if (dir === 1) {
    // ── FACING LEFT ──

    drawLegsSide(ctx, cx, legY, legShift, true);
    drawTorsoSide(ctx, cx, torsoY, shirtShades, true);
    drawArmsSide(ctx, cx, torsoY, shirtShades, armSwing, true);
    drawHeadSide(ctx, cx, headY, hairShades, glasses, true);
    drawHairSide(ctx, cx, headY, hairStyle, hairShades, true);

  } else if (dir === 2) {
    // ── FACING RIGHT ──

    drawLegsSide(ctx, cx, legY, legShift, false);
    drawTorsoSide(ctx, cx, torsoY, shirtShades, false);
    drawArmsSide(ctx, cx, torsoY, shirtShades, armSwing, false);
    drawHeadSide(ctx, cx, headY, hairShades, glasses, false);
    drawHairSide(ctx, cx, headY, hairStyle, hairShades, false);

  } else if (dir === 3) {
    // ── FACING UP (back view) ──

    drawLegsBack(ctx, cx, legY, legShift);
    drawTorsoBack(ctx, cx, torsoY, shirtShades);
    drawArmsBack(ctx, cx, torsoY, shirtShades, armSwing);
    drawHeadBack(ctx, cx, headY, hairShades);
    drawHairBack(ctx, cx, headY, hairStyle, hairShades);
  }
}

// ─── Spritesheet generation ───

// Generate a full spritesheet for a character
// Returns: { canvas, frameWidth: 48, frameHeight: 48, cols: 4, rows: 5 }
// Layout: 4 cols x 5 rows
//   Row 0: walk-down (4 frames)
//   Row 1: walk-left (4 frames)
//   Row 2: walk-right (4 frames)
//   Row 3: walk-up (4 frames)
//   Row 4: idle (2 frames, cols 0-1)
export function generateSpriteSheet(name) {
  const config = CHARACTER_CONFIGS[name];
  if (!config) return null;

  const cols = 4;
  const rows = 5;
  const fw = 48;
  const fh = 48;
  const canvas = document.createElement('canvas');
  canvas.width = cols * fw;
  canvas.height = rows * fh;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const directions = [0, 1, 2, 3]; // down, left, right, up
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      ctx.save();
      ctx.translate(col * fw, row * fh);
      drawCharacterFrame(ctx, config, directions[row], col, false);
      ctx.restore();
    }
  }
  // Idle frames (row 4)
  for (let col = 0; col < 2; col++) {
    ctx.save();
    ctx.translate(col * fw, 4 * fh);
    drawCharacterFrame(ctx, config, 0, col, true); // idle faces down
    ctx.restore();
  }

  return { canvas, frameWidth: fw, frameHeight: fh, cols, rows };
}

// Get all character names that have configs
export function getCharacterNames() {
  return Object.keys(CHARACTER_CONFIGS);
}
