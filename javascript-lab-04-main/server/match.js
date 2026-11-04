import { randomInt } from 'node:crypto';
import {
  TICK_MS, TICK_RATE, MAX_PENDING_INPUTS,
  createWorld, addShip, removeShip, stepWorld, binaryCodec, jsonCodec, patchSnapshotAck,
} from 'shared';

const OVERRUN_RESYNC_TICKS = 5;

export class Match {
  constructor(room) {
    this.room = room;
    this.seed = randomInt(0, 2 ** 32);
    this.world = createWorld(this.seed);
    this.timer = null;
    this.running = false;
    this.nextTick = 0;
    this.stats = {
      ticks: 0, starved: 0, overruns: 0, droppedInputs: 0, invalidInputs: 0,
      tickMsAvg: 0, tickMsMax: 0, jitterMsAvg: 0, jitterMsMax: 0,
    };
  }

  get players() {
    return this.room.players;
  }

  addPlayer(player) {
    const ship = addShip(this.world);
    player.id = ship.id;
    player.queue = [];
    player.lastSeq = 0;
    player.ack = 0;
    player.bytesIn = 0;
    player.bytesOut = 0;
    this.players.set(player.id, player);
    this.start();
    return ship;
  }

  removePlayer(player) {
    removeShip(this.world, player.id);
    this.players.delete(player.id);
  }

  receiveInput(player, input) {
    if (input.seq <= player.lastSeq) return;
    player.lastSeq = input.seq;
    player.queue.push(input);
    while (player.queue.length > MAX_PENDING_INPUTS) {
      player.queue.shift();
      this.stats.droppedInputs++;
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.nextTick = performance.now() + TICK_MS;
    this.schedule();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
  }

  schedule() {
    this.timer = setTimeout(() => this.tick(), Math.max(0, this.nextTick - performance.now()));
  }

  tick() {
    if (!this.running) return;
    const started = performance.now();
    const s = this.stats;
    const lateBy = Math.max(0, started - this.nextTick);
    s.jitterMsAvg += (lateBy - s.jitterMsAvg) * 0.05;
    s.jitterMsMax = Math.max(s.jitterMsMax, lateBy);

    const inputs = {};
    for (const p of this.players.values()) {
      const input = p.queue.shift();
      if (input) {
        inputs[p.id] = input;
        p.ack = input.seq;
      } else {
        s.starved++;
      }
    }
    stepWorld(this.world, inputs);
    this.broadcast();

    const took = performance.now() - started;
    s.ticks++;
    s.tickMsAvg += (took - s.tickMsAvg) * 0.05;
    s.tickMsMax = Math.max(s.tickMsMax, took);

    this.nextTick += TICK_MS;
    const now = performance.now();
    if (now > this.nextTick + OVERRUN_RESYNC_TICKS * TICK_MS) {
      s.overruns++;
      this.nextTick = now + TICK_MS;
    }
    this.schedule();
  }

  broadcast() {
    let binaryBase = null;
    for (const p of this.players.values()) {
      let data;
      if (p.codec === 'json') {
        data = jsonCodec.encodeSnapshot(this.world, p.ack);
      } else {
        binaryBase ??= binaryCodec.encodeSnapshot(this.world, 0);
        data = patchSnapshotAck(binaryBase, p.ack);
      }
      p.sendRaw(data);
    }
  }

  summary() {
    const { stats } = this;
    return {
      room: this.room.id,
      players: this.players.size,
      tickRate: TICK_RATE,
      tick: this.world.tick,
      seed: this.seed,
      ...Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 100) / 100 : v])),
    };
  }
}

