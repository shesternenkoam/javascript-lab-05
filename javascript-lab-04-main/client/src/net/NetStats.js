export class NetStats {
  constructor() {
    this.events = { in: [], out: [] };
    this.rtt = 0;
    this.rttAvg = 0;
    this.lastSnapshotAt = 0;
    this.history = { correction: [], rtt: [] };
  }

  traffic(dir, bytes, now = performance.now()) {
    this.events[dir].push([now, bytes]);
  }

  bytesPerSec(dir, now = performance.now()) {
    const list = this.events[dir];
    while (list.length && now - list[0][0] > 1000) list.shift();
    let sum = 0;
    for (const [, b] of list) sum += b;
    return sum;
  }

  onPong(sentAt, now = performance.now()) {
    this.rtt = now - sentAt;
    this.rttAvg = this.rttAvg ? this.rttAvg + (this.rtt - this.rttAvg) * 0.2 : this.rtt;
  }

  snapshotAge(now = performance.now()) {
    return this.lastSnapshotAt ? now - this.lastSnapshotAt : 0;
  }

  pushHistory(key, value, max = 120) {
    const h = this.history[key];
    h.push(value);
    if (h.length > max) h.shift();
  }
}

