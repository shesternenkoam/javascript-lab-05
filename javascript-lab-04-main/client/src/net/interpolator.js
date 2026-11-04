
import { TICK_MS, WORLD_W, WORLD_H, normalizeAngle } from 'shared';

const MAX_SNAPSHOTS = 60;

function lerpWrapped(a, b, f, size) {
  let d = b - a;
  if (Math.abs(d) > size / 2) return b;
  return a + d * f;
}

function lerpEntity(a, b, f) {
  return {
    ...b,
    x: lerpWrapped(a.x, b.x, f, WORLD_W),
    y: lerpWrapped(a.y, b.y, f, WORLD_H),
    ...(b.angle !== undefined ? { angle: a.angle + normalizeAngle(b.angle - a.angle) * f } : {}),
  };
}

function lerpList(listA, listB, f) {
  const byId = new Map(listA.map((e) => [e.id, e]));
  return listB.map((e) => {
    const prev = byId.get(e.id);
    return prev ? lerpEntity(prev, e, f) : e;
  });
}

export class Interpolator {
  constructor() {
    this.snaps = [];
    this.offset = null;
    this.starved = 0;
  }

  push(snap, arrivalMs) {
    const last = this.snaps[this.snaps.length - 1];
    if (last && snap.tick <= last.tick) return false;
    const sample = arrivalMs - snap.tick * TICK_MS;
    if (this.offset === null) this.offset = sample;
    else this.offset += (sample - this.offset) * (sample < this.offset ? 0.5 : 0.02);
    this.snaps.push(snap);
    if (this.snaps.length > MAX_SNAPSHOTS) this.snaps.shift();
    return true;
  }

  get newest() {
    return this.snaps[this.snaps.length - 1] ?? null;
  }

  sample(nowMs, delayMs) {
    const n = this.snaps.length;
    if (n === 0) return null;
    const t = (nowMs - this.offset - delayMs) / TICK_MS;
    const first = this.snaps[0];
    const last = this.snaps[n - 1];
    if (t <= first.tick) return first;
    if (t >= last.tick) {
      this.starved++;
      return last;
    }
    let i = n - 1;
    while (i > 0 && this.snaps[i - 1].tick > t) i--;
    const a = this.snaps[i - 1];
    const b = this.snaps[i];
    const f = (t - a.tick) / (b.tick - a.tick);
    return {
      tick: t,
      ships: lerpList(a.ships, b.ships, f),
      bullets: lerpList(a.bullets, b.bullets, f),
      asteroids: lerpList(a.asteroids, b.asteroids, f),
    };
  }
}

