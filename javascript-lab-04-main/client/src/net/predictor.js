

import {
  DT, WORLD_W, WORLD_H, integrate, didFire, makeBullet, stepBullet, normalizeAngle,
} from 'shared';

const SNAP_DISTANCE = 120;
const MAX_PENDING = 300;

const wrapDelta = (d, size) => (d > size / 2 ? d - size : d < -size / 2 ? d + size : d);

export class Predictor {
  constructor({ enabled = true, smoothMs = 100 } = {}) {
    this.enabled = enabled;
    this.smoothMs = smoothMs;
    this.myId = 0;
    this.ship = null;
    this.pending = [];
    this.seq = 0;
    this.offset = { x: 0, y: 0, angle: 0 };
    this.correction = 0;
    this.correctionAvg = 0;
    this.localBullets = [];
  }

  nextInput({ thrust, turn, fire }) {
    this.seq += 1;
    return { seq: this.seq, thrust, turn, fire };
  }

  applyLocal(input) {
    this.pending.push(input);
    if (this.pending.length > MAX_PENDING) this.pending.shift();

    this.localBullets = this.localBullets.filter((b) => stepBullet(b));

    if (!this.ship) return false;
    const fired = didFire(this.ship, input);
    if (this.enabled) {
      this.ship = integrate(this.ship, input, DT);
      if (fired) this.localBullets.push(makeBullet(-input.seq, this.myId, input.seq, this.ship));
    }
    return fired;
  }

  onSnapshot(snap) {
    this.pending = this.pending.filter((i) => i.seq > snap.ack);
    const own = snap.ships.find((s) => s.id === this.myId);
    if (!own) return;

    const before = this.ship;
    let ship = { ...own };
    if (this.enabled) {
      for (const input of this.pending) ship = integrate(ship, input, DT);
    }

    if (this.enabled && before) {
      const dx = wrapDelta(before.x - ship.x, WORLD_W);
      const dy = wrapDelta(before.y - ship.y, WORLD_H);
      const da = normalizeAngle(before.angle - ship.angle);
      const mag = Math.hypot(dx, dy);
      this.correction = mag;
      if (mag <= SNAP_DISTANCE) this.correctionAvg += (mag - this.correctionAvg) * 0.1; // respawn jumps are not prediction error
      if (mag > SNAP_DISTANCE) {
        this.offset = { x: 0, y: 0, angle: 0 };
      } else {
        this.offset.x += dx;
        this.offset.y += dy;
        this.offset.angle += da;
      }
    } else {
      this.correction = 0;
      this.offset = { x: 0, y: 0, angle: 0 };
    }
    this.ship = ship;

    const serverSeqs = new Set();
    for (const b of snap.bullets) if (b.owner === this.myId) serverSeqs.add(b.seq);
    this.localBullets = this.localBullets.filter((b) => !(b.seq <= snap.ack && !serverSeqs.has(b.seq)));
  }
  decay(dtMs) {
    const k = Math.exp(-dtMs / (this.smoothMs / 3));
    this.offset.x *= k;
    this.offset.y *= k;
    this.offset.angle *= k;
  }

  visual() {
    if (!this.ship) return null;
    const wrap = (v, size) => ((v % size) + size) % size;
    return {
      ...this.ship,
      x: wrap(this.ship.x + this.offset.x, WORLD_W),
      y: wrap(this.ship.y + this.offset.y, WORLD_H),
      angle: this.ship.angle + this.offset.angle,
    };
  }
}


