// engine.js — Game loop (30fps fixed), update/render separation

export class GameEngine {
  constructor(canvas, logicalW, logicalH) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.running = false;
    this.lastTime = 0;
    this.accumulator = 0;
    this.frameTime = 1000 / 30; // 30fps
    this.updateCallbacks = [];
    this.renderCallbacks = [];
    this.rafId = null;

    // HiDPI support: scale canvas buffer by devicePixelRatio
    const dpr = window.devicePixelRatio || 1;
    canvas.width = logicalW * dpr;
    canvas.height = logicalH * dpr;
    canvas.style.width = logicalW + 'px';
    canvas.style.height = logicalH + 'px';
    this.ctx.scale(dpr, dpr);
    this.dpr = dpr;

    // Disable image smoothing for pixel art
    this.ctx.imageSmoothingEnabled = false;
  }

  onUpdate(cb) { this.updateCallbacks.push(cb); }
  onRender(cb) { this.renderCallbacks.push(cb); }

  start() {
    this.running = true;
    this.lastTime = performance.now();
    this._loop(this.lastTime);
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  _loop(timestamp) {
    if (!this.running) return;
    this.rafId = requestAnimationFrame((t) => this._loop(t));

    const delta = timestamp - this.lastTime;
    this.lastTime = timestamp;
    this.accumulator += delta;

    // Cap accumulator to prevent spiral of death
    if (this.accumulator > 200) this.accumulator = 200;

    while (this.accumulator >= this.frameTime) {
      const dt = this.frameTime / 1000; // seconds
      for (const cb of this.updateCallbacks) cb(dt);
      this.accumulator -= this.frameTime;
    }

    // Render once per frame
    this.ctx.imageSmoothingEnabled = false;
    for (const cb of this.renderCallbacks) cb(this.ctx);
  }
}
