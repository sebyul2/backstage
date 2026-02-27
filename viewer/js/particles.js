// particles.js — Floating emoji particle system + whip trail effects

export class ParticleManager {
  constructor() {
    this.particles = [];
    this.whipTrails = [];
  }

  // Spawn a floating emoji particle at (x, y)
  spawn(x, y, emoji) {
    this.particles.push({
      x: x + (Math.random() - 0.5) * 30,
      y: y,
      emoji,
      vx: (Math.random() - 0.5) * 12,
      vy: -35 - Math.random() * 15,
      life: 0,
      maxLife: 1500,
    });
  }

  // Whip hit: animated whip from player to agent
  spawnWhip(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = (y2 - 15) - (y1 - 10);
    const len = Math.sqrt(dx * dx + dy * dy) || 1;

    this.whipTrails.push({
      x1, y1: y1 - 10,
      x2, y2: y2 - 15,
      nx: -dy / len,  // perpendicular for wave
      ny: dx / len,
      life: 0,
      maxLife: 420,
      segments: 18,
      hit: true,
    });

    // Crack sparks at impact point
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 15 + Math.random() * 25;
      this.particles.push({
        x: x2,
        y: y2 - 15,
        emoji: '·',
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 10,
        life: 0,
        maxLife: 350,
        isSpark: true,
      });
    }
  }

  // Whip miss: shorter swing in facing direction
  spawnWhipMiss(x, y, dir) {
    const reach = 40;
    const dx = dir === 2 ? reach : dir === 1 ? -reach : (Math.random() - 0.5) * 15;
    const dy = dir === 0 ? reach : dir === 3 ? -reach : (Math.random() - 0.5) * 15;
    const x2 = x + dx;
    const y2 = y - 10 + dy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;

    this.whipTrails.push({
      x1: x, y1: y - 10,
      x2, y2,
      nx: -dy / len,
      ny: dx / len,
      life: 0,
      maxLife: 300,
      segments: 10,
      hit: false,
    });

    this.particles.push({
      x: x2, y: y2,
      emoji: '💨',
      vx: dx * 0.15,
      vy: -12,
      life: 0,
      maxLife: 700,
    });
  }

  update(dt) {
    const dtMs = dt * 1000;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dtMs;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.isSpark) {
        p.vx *= 0.92;
        p.vy *= 0.92;
      } else {
        p.vy *= 0.97;
      }
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
      }
    }
    for (let i = this.whipTrails.length - 1; i >= 0; i--) {
      this.whipTrails[i].life += dtMs;
      if (this.whipTrails[i].life >= this.whipTrails[i].maxLife) {
        this.whipTrails.splice(i, 1);
      }
    }
  }

  render(ctx) {
    // ─── Whip trails ─────────────────────────────────────────────
    for (const trail of this.whipTrails) {
      const progress = trail.life / trail.maxLife;

      // How far the whip has extended (reaches target in first 30%)
      const reach = Math.min(1, progress * 3.3);
      // Wave amplitude: peaks mid-animation, then dies
      const waveAmp = 20 * Math.sin(Math.min(progress * 4, 1) * Math.PI) * (1 - progress * 0.7);
      // Overall alpha
      const alpha = progress < 0.75 ? 0.95 : (1 - progress) / 0.25 * 0.95;

      // Build points along the whip
      const pts = [];
      for (let i = 0; i <= trail.segments; i++) {
        const t = i / trail.segments;
        if (t > reach) break;

        const baseX = trail.x1 + (trail.x2 - trail.x1) * t;
        const baseY = trail.y1 + (trail.y2 - trail.y1) * t;

        // Traveling sine wave: moves from base to tip
        const wavePhase = t * Math.PI * 2.5 - progress * 14;
        // Envelope: zero at base, peaks at ~60%, tapers at tip
        const envelope = Math.sin(Math.min(t, 0.85) * Math.PI * 0.9) * (1 - t * 0.3);
        const wave = Math.sin(wavePhase) * waveAmp * envelope;

        // Width: thick at base (3px), thin at tip (0.6px)
        const width = (3.2 - t * 2.6) * (1 - progress * 0.4);

        pts.push({
          x: baseX + trail.nx * wave,
          y: baseY + trail.ny * wave,
          width: Math.max(0.4, width),
        });
      }

      if (pts.length < 2) continue;

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = alpha;

      // Draw segment by segment (thick→thin)
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i], p1 = pts[i + 1];

        // Outer glow (warm)
        ctx.strokeStyle = 'rgba(160, 80, 20, 0.25)';
        ctx.lineWidth = p0.width + 5;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();

        // Leather core
        ctx.strokeStyle = '#6B3410';
        ctx.lineWidth = p0.width + 1;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();

        // Bright center highlight
        ctx.strokeStyle = '#C48030';
        ctx.lineWidth = Math.max(0.3, p0.width - 0.8);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }

      // ─── Tip crack flash ───────────────────────────────────────
      if (trail.hit && reach >= 0.95 && progress < 0.35) {
        const tip = pts[pts.length - 1];
        const flash = (0.35 - progress) / 0.35;

        // White flash
        ctx.globalAlpha = flash * 0.9;
        ctx.fillStyle = '#FFF';
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 5 + flash * 4, 0, Math.PI * 2);
        ctx.fill();

        // Orange glow ring
        ctx.globalAlpha = flash * 0.5;
        ctx.strokeStyle = '#FFA300';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 8 + (1 - flash) * 6, 0, Math.PI * 2);
        ctx.stroke();
      }

      // ─── Handle (small circle at base) ─────────────────────────
      if (pts.length > 0 && progress < 0.6) {
        const base = pts[0];
        ctx.globalAlpha = alpha * 0.7;
        ctx.fillStyle = '#4A2008';
        ctx.beginPath();
        ctx.arc(base.x, base.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';

    // ─── Emoji particles ─────────────────────────────────────────
    for (const p of this.particles) {
      const progress = p.life / p.maxLife;
      const alpha = 1 - progress;

      if (p.isSpark) {
        // Spark dots: small orange/yellow circles
        ctx.globalAlpha = alpha * 0.9;
        const hue = Math.random() > 0.5 ? '#FFA300' : '#FFD700';
        ctx.fillStyle = hue;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2 * (1 - progress * 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Regular emoji particles
        const size = Math.round(16 + progress * 6);
        ctx.globalAlpha = alpha * 0.85;
        ctx.font = `${size}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(p.emoji, p.x, p.y);
      }
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }
}
