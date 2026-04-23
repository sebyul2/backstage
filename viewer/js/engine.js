// engine.js — Game loop (60fps fixed), update/render separation
// 캐릭터 이동 smoothness 를 위해 update 를 render rate (보통 60Hz) 에 맞춤.
// 이동 공식이 모두 `speed * dt` 기반이라 timestep 을 올려도 거동은 동일,
// 초당 샘플 수만 2배로 증가 → 30fps 때 "뚝뚝" 끊기던 느낌 제거.

export class GameEngine {
  constructor(canvas, logicalW, logicalH) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.running = false;
    this.lastTime = 0;
    this.accumulator = 0;
    this.frameTime = 1000 / 60; // 60fps
    this.updateCallbacks = [];
    this.renderCallbacks = [];
    this.rafId = null;

    // HiDPI support: minimum 2x for quality pixel art rendering
    const dpr = Math.max(2, window.devicePixelRatio || 1);
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
