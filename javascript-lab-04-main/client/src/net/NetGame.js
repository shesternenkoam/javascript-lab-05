import {
  DT, TICK_MS, WORLD_W, WORLD_H, SHIP_RADIUS, BULLET_RADIUS, SHIP_MAX_HP,
  binaryCodec, jsonCodec, simSelfTest,
} from 'shared';
import { Predictor } from './predictor.js';
import { Interpolator } from './interpolator.js';
import { NetStats } from './NetStats.js';
import { createInput } from '../input.js';
import { eventBus } from '../events.js';

const PRESETS = {
  1: { lat: 0, jitter: 0, drop: 0 },
  2: { lat: 100, jitter: 0, drop: 0 },
  3: { lat: 100, jitter: 30, drop: 0.02 },
};
const PING_EVERY_MS = 1000;
const COLORS = ['#4fc3f7', '#ff8a65', '#aed581', '#ba68c8'];

export class NetGame {
  constructor({ canvas, connection }) {
    const params = new URLSearchParams(window.location.search);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.connection = connection;
    this.assets = null;

    this.predictor = new Predictor({ enabled: params.get('predict') !== '0' });
    this.interp = new Interpolator();
    this.stats = new NetStats();
    this.interpDelay = Number(params.get('interp') ?? 100);
    this.codecName = params.get('codec') === 'json' ? 'json' : 'binary';
    this.net = { lat: Number(params.get('lat') ?? 0), jitter: Number(params.get('jitter') ?? 0), drop: Number(params.get('drop') ?? 0) };
    this.showGraph = true;
    this.players = new Map();
    this.welcome = null;
    this.lastTick = 0;
    this.sentAt = new Map(); // seq -> send time, to measure input -> acknowledged delay
    this.ackLag = 0;
    this.disconnected = false;

    this.getInput = null;
    this.accumulator = 0;
    this.lastFrame = 0;
    this.nextPing = 0;
    this.running = false;

    connection.onTraffic = (dir, bytes) => this.stats.traffic(dir, bytes);
    // After a drop the new socket has not joined any room: stop sending inputs and tell the player.
    connection.onClose = () => { this.disconnected = true; this.welcome = null; };
    connection.on('welcome', (m) => {
      this.welcome = m;
      this.predictor.myId = m.id;
      this.codecName = m.codec;
      this.net = m.net;
    });
    connection.on('players', (m) => { this.players = new Map(m.players.map((p) => [p.id, p.name])); });
    connection.on('config', (m) => { this.net = m.net; this.codecName = m.codec; });
    connection.on('pong', (m) => this.stats.onPong(m.t));
    connection.on('snapshot', (snap) => this.onSnapshot(snap));
    window.simSelfTest = simSelfTest;
  }

  get codec() {
    return this.codecName === 'json' ? jsonCodec : binaryCodec;
  }

  onSnapshot(snap) {
    const now = performance.now();
    this.stats.lastSnapshotAt = now;
    if (!this.interp.push(snap, now)) return;
    this.lastTick = snap.tick;
    this.predictor.onSnapshot(snap);
    if (this.sentAt.has(snap.ack)) this.ackLag = now - this.sentAt.get(snap.ack);
    for (const seq of this.sentAt.keys()) if (seq <= snap.ack) this.sentAt.delete(seq);
    this.stats.pushHistory('correction', this.predictor.correction);
  }

  start(assets) {
    if (this.running) return;
    this.running = true;
    this.assets = assets;
    this.getInput = createInput();
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.fitCanvas();
    window.addEventListener('resize', () => this.fitCanvas());
    this.lastFrame = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  fitCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  sendConfig(extra) {
    this.connection.send({ type: 'config', ...this.net, codec: this.codecName, ...extra });
  }

  onKey(e) {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === 'p') {
      this.predictor.enabled = !this.predictor.enabled;
      this.predictor.localBullets = [];
    } else if (k === '[') this.interpDelay = Math.max(0, this.interpDelay - 16);
    else if (k === ']') this.interpDelay = Math.min(500, this.interpDelay + 16);
    else if (k === 'n') this.showGraph = !this.showGraph;
    else if (k === 'b') {
      this.codecName = this.codecName === 'json' ? 'binary' : 'json';
      this.sendConfig({ codec: this.codecName });
    } else if (PRESETS[k]) {
      this.net = PRESETS[k];
      this.sendConfig(PRESETS[k]);
    }
  }


  frame(now) {
    const frameSec = Math.min((now - this.lastFrame) / 1000, 0.25);
    this.lastFrame = now;
    this.accumulator += frameSec;
    while (this.accumulator >= DT) {
      this.simStep();
      this.accumulator -= DT;
    }
    this.predictor.decay(frameSec * 1000);
    if (now >= this.nextPing) {
      this.nextPing = now + PING_EVERY_MS;
      this.connection.send({ type: 'ping', t: now });
    }
    this.render(now);
    requestAnimationFrame((t) => this.frame(t));
  }

  simStep() {
    if (!this.welcome) return;
    const keys = this.getInput();
    const input = this.predictor.nextInput({
      thrust: keys.w ? 1 : 0,
      turn: (keys.d ? 1 : 0) - (keys.a ? 1 : 0),
      fire: keys.space ? 1 : 0,
    });
    this.sentAt.set(input.seq, performance.now());
    if (this.sentAt.size > 300) this.sentAt.delete(this.sentAt.keys().next().value);
    if (this.predictor.applyLocal(input)) eventBus.dispatchEvent(new CustomEvent('fired'));
    this.connection.sendRaw(this.codec.encodeInput(input));
  }


  render(now) {
    const { ctx, canvas } = this;
    const scale = Math.min(canvas.width / WORLD_W, canvas.height / WORLD_H);
    const ox = (canvas.width - WORLD_W * scale) / 2;
    const oy = (canvas.height - WORLD_H * scale) / 2;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, ox, oy);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    const world = this.interp.sample(now, this.interpDelay);
    const me = this.predictor.myId;
    if (world) {
      for (const a of world.asteroids) this.drawAsteroid(a);
      const mine = this.predictor.enabled;
      for (const b of world.bullets) {
        if (mine && b.owner === me) continue;
        this.drawBullet(b, '#ffd54f');
      }
      for (const s of world.ships) {
        if (s.id === me || s.respawn > 0) continue;
        this.drawShip(s, this.colorOf(s.id), this.players.get(s.id));
      }
    }
    for (const b of this.predictor.localBullets) this.drawBullet(b, '#fff59d');

    const own = this.predictor.visual();
    if (own && own.respawn === 0) this.drawShip(own, this.colorOf(me), 'you');

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawHud(own, now);
  }

  colorOf(id) {
    return COLORS[(id >>> 0) % COLORS.length];
  }

  drawShip(s, color, label) {
    const { ctx } = this;
    const img = this.assets?.sprites?.ship;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    if (img) {
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
    } else {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(SHIP_RADIUS, 0);
      ctx.lineTo(-SHIP_RADIUS, -SHIP_RADIUS * 0.7);
      ctx.lineTo(-SHIP_RADIUS, SHIP_RADIUS * 0.7);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = color;
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    if (img) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, SHIP_RADIUS + 3, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (label) ctx.fillText(label, s.x, s.y - SHIP_RADIUS - 8);
  }

  drawAsteroid(a) {
    const { ctx } = this;
    const img = this.assets?.sprites?.asteroid;
    if (img) {
      const f = (a.radius * 2) / img.width;
      ctx.drawImage(img, a.x - a.radius, a.y - (img.height * f) / 2, img.width * f, img.height * f);
    } else {
      ctx.fillStyle = 'gray';
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawBullet(b, color) {
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(b.x, b.y, BULLET_RADIUS + 1, 0, Math.PI * 2);
    ctx.fill();
  }

  drawHud(own, now) {
    const { ctx, stats, predictor } = this;
    ctx.fillStyle = 'white';
    ctx.font = '16px monospace';
    ctx.textAlign = 'left';
    const hp = own ? own.hp : SHIP_MAX_HP;
    ctx.fillText(own && own.respawn > 0 ? `HP: 0  respawn in ${(own.respawn * TICK_MS / 1000).toFixed(1)}s` : `HP: ${hp}`, 20, 30);
    ctx.fillStyle = '#9e9e9e';
    ctx.font = '12px monospace';
    ctx.fillText('W/A/D or arrows + Space | P predict  [ ] interp  B codec  1/2/3 network  N netgraph', 20, 48);

    if (this.disconnected || stats.snapshotAge(now) > 2000) {
      ctx.fillStyle = '#ff5252';
      ctx.font = '20px monospace';
      ctx.fillText('Зв\u0027язок із сервером втрачено — перезавантажте сторінку (F5)', 20, 90);
    }

    if (!this.showGraph) return;
    const lines = [
      `RTT          ${stats.rtt.toFixed(0)} ms (avg ${stats.rttAvg.toFixed(0)})`,
      `snapshot age ${stats.snapshotAge(now).toFixed(0)} ms   tick ${this.lastTick}`,
      `down / up    ${stats.bytesPerSec('in', now)} / ${stats.bytesPerSec('out', now)} B/s`,
      `input queue  ${predictor.pending.length} unacked`,
      `input->ack   ${this.ackLag.toFixed(0)} ms`,
      `ship reacts  ${predictor.enabled ? '0 ms (predicted)' : `after ${this.ackLag.toFixed(0)} ms`}`,
      `correction   ${predictor.correction.toFixed(2)} px (avg ${predictor.correctionAvg.toFixed(2)})`,
      `interp delay ${this.interpDelay} ms   starved ${this.interp.starved}`,
      `predict ${predictor.enabled ? 'ON' : 'OFF'}   codec ${this.codecName}`,
      `net  lat ${this.net.lat} jitter ${this.net.jitter} drop ${(this.net.drop * 100).toFixed(0)}%`,
    ];
    const x = this.canvas.width - 300;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x - 10, 10, 300, 20 + lines.length * 16 + 50);
    ctx.fillStyle = '#b2ff59';
    ctx.font = '12px monospace';
    lines.forEach((l, i) => ctx.fillText(l, x, 28 + i * 16));
    this.drawSpark(stats.history.correction, x, 28 + lines.length * 16 + 4, 280, 36, 10, '#ff5252');
  }

  drawSpark(values, x, y, w, h, maxValue, color) {
    const { ctx } = this;
    ctx.strokeStyle = '#333';
    ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = color;
    ctx.beginPath();
    values.forEach((v, i) => {
      const px = x + (i / 119) * w;
      const py = y + h - Math.min(1, v / maxValue) * h;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }
}

