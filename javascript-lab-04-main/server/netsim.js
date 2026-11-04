export class LinkSim {
  constructor({ lat = 0, jitter = 0, drop = 0 } = {}) {
    this.lat = 0;
    this.jitter = 0;
    this.drop = 0;
    this.set({ lat, jitter, drop });
    this.timers = new Set();
  }

  set({ lat, jitter, drop }) {
    const num = (v, lo, hi, old) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : old);
    this.lat = num(lat, 0, 1000, this.lat);
    this.jitter = num(jitter, 0, 500, this.jitter);
    this.drop = num(drop, 0, 0.5, this.drop);
  }

  get settings() {
    return { lat: this.lat, jitter: this.jitter, drop: this.drop };
  }

  deliver(fn) {
    if (this.drop > 0 && Math.random() < this.drop) return false;
    const delay = Math.max(0, this.lat / 2 + (Math.random() - 0.5) * this.jitter);
    if (delay === 0) {
      fn();
      return true;
    }
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, delay);
    this.timers.add(timer);
    return true;
  }

  close() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}

