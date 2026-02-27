// physics.js — Matter.js wrapper for top-down 2D physics
// Manages physics world, static obstacles (walls/furniture), and character bodies

const Matter = window.Matter;
const { Engine, Bodies, Body, Composite, Events } = Matter || {};

export class PhysicsWorld {
  constructor() {
    if (!Matter) {
      console.warn('Matter.js not loaded, physics disabled');
      this.enabled = false;
      return;
    }
    this.enabled = true;
    this.engine = Engine.create({ gravity: { x: 0, y: 0 } });
    this.world = this.engine.world;
    this.bodies = new Map(); // name -> Body
  }

  // Create static bodies for walls and blocking furniture
  createStaticBodies(groundMap, furniture, TS, cols, rows) {
    if (!this.enabled) return;

    // Wall tiles → static rectangles
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (groundMap[r][c] !== 1) continue;
        Composite.add(this.world, Bodies.rectangle(
          c * TS + TS / 2, r * TS + TS / 2, TS, TS,
          { isStatic: true, label: 'wall' }
        ));
      }
    }

    // Blocking furniture → static rectangles
    const BLOCKING = [
      'desk', 'leadDesk', 'bossDesk', 'plant', 'coffee',
      'whiteboard', 'water', 'bookshelf', 'sofa', 'breakTable', 'vending',
    ];
    for (const f of furniture) {
      if (!BLOCKING.includes(f.type)) continue;
      Composite.add(this.world, Bodies.rectangle(
        (f.x + f.w / 2) * TS, (f.y + f.h / 2) * TS,
        f.w * TS, f.h * TS,
        { isStatic: true, label: f.type }
      ));
    }
  }

  // Create a character body (circle)
  addCharacter(name, x, y, opts = {}) {
    if (!this.enabled) return null;
    const body = Bodies.circle(x, y, opts.radius || 10, {
      friction: 0.05,
      frictionAir: 0.12,
      restitution: 0.6,
      isStatic: opts.isStatic || false,
      label: name,
    });
    Composite.add(this.world, body);
    this.bodies.set(name, body);
    return body;
  }

  setVelocity(name, vx, vy) {
    const b = this.bodies.get(name);
    if (b) Body.setVelocity(b, { x: vx, y: vy });
  }

  setPosition(name, x, y) {
    const b = this.bodies.get(name);
    if (b) {
      Body.setPosition(b, { x, y });
      Body.setVelocity(b, { x: 0, y: 0 });
    }
  }

  getPosition(name) {
    const b = this.bodies.get(name);
    return b ? { x: b.position.x, y: b.position.y } : null;
  }

  setStatic(name, isStatic) {
    const b = this.bodies.get(name);
    if (b) Body.setStatic(b, isStatic);
  }

  // Register callback for high-speed wall collisions (name, x, y, speed)
  onWallHit(callback) {
    if (!this.enabled) return;
    this._wallHitCallback = callback;
    Events.on(this.engine, 'collisionStart', (event) => {
      for (const pair of event.pairs) {
        const a = pair.bodyA, b = pair.bodyB;
        let charBody = null, wallBody = null;
        if (this.bodies.has(a.label) && b.isStatic) { charBody = a; wallBody = b; }
        else if (this.bodies.has(b.label) && a.isStatic) { charBody = b; wallBody = a; }
        if (!charBody) continue;

        const speed = Math.sqrt(charBody.velocity.x ** 2 + charBody.velocity.y ** 2);
        if (speed > 3) {
          this._wallHitCallback(charBody.label, charBody.position.x, charBody.position.y, speed);
        }
      }
    });
  }

  update(dt) {
    if (!this.enabled) return;
    Engine.update(this.engine, dt * 1000);
  }
}
