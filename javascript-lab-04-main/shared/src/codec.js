
import { PROTOCOL_VERSION } from './constants.js';

export const MSG_INPUT = 1;
export const MSG_SNAPSHOT = 2;

const LE = true;
const ANGLE_SCALE = 10000;
export const SNAPSHOT_ACK_OFFSET = 6;
const HEADER = 15;
const SHIP_BYTES = 25;
const BULLET_BYTES = 20;
const ASTEROID_BYTES = 13;


export const jsonCodec = {
  name: 'json',
  encodeInput(input) {
    return JSON.stringify({ type: 'input', seq: input.seq, thrust: input.thrust, turn: input.turn, fire: input.fire });
  },
  encodeSnapshot(world, ack) {
    return JSON.stringify({
      type: 'snapshot', tick: world.tick, ack,
      ships: world.ships.map((s) => ({
        id: s.id, x: s.x, y: s.y, vx: s.vx, vy: s.vy, angle: s.angle, hp: s.hp, cooldown: s.cooldown, respawn: s.respawn,
      })),
      bullets: world.bullets.map((b) => ({ id: b.id, owner: b.owner, seq: b.seq, x: b.x, y: b.y })),
      asteroids: world.asteroids.map((a) => ({ id: a.id, x: a.x, y: a.y, radius: a.radius })),
    });
  },
};


function viewOf(data) {
  if (data instanceof ArrayBuffer) return new DataView(data);
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

export const binaryCodec = {
  name: 'binary',

  encodeInput(input) {
    const buf = new ArrayBuffer(8);
    const v = new DataView(buf);
    v.setUint8(0, PROTOCOL_VERSION);
    v.setUint8(1, MSG_INPUT);
    v.setUint32(2, input.seq, LE);
    v.setUint8(6, (input.thrust ? 1 : 0) | (input.fire ? 2 : 0));
    v.setInt8(7, input.turn);
    return new Uint8Array(buf);
  },

  encodeSnapshot(world, ack = 0) {
    const { ships, bullets, asteroids } = world;
    const size = HEADER + ships.length * SHIP_BYTES + bullets.length * BULLET_BYTES + asteroids.length * ASTEROID_BYTES;
    const buf = new ArrayBuffer(size);
    const v = new DataView(buf);
    v.setUint8(0, PROTOCOL_VERSION);
    v.setUint8(1, MSG_SNAPSHOT);
    v.setUint32(2, world.tick, LE);
    v.setUint32(SNAPSHOT_ACK_OFFSET, ack, LE);
    v.setUint8(10, ships.length);
    v.setUint16(11, bullets.length, LE);
    v.setUint16(13, asteroids.length, LE);
    let o = HEADER;
    for (const s of ships) {
      v.setUint32(o, s.id, LE);
      v.setFloat32(o + 4, s.x, LE);
      v.setFloat32(o + 8, s.y, LE);
      v.setFloat32(o + 12, s.vx, LE);
      v.setFloat32(o + 16, s.vy, LE);
      v.setInt16(o + 20, Math.round(s.angle * ANGLE_SCALE), LE);
      v.setUint8(o + 22, s.hp);
      v.setUint8(o + 23, s.cooldown);
      v.setUint8(o + 24, s.respawn);
      o += SHIP_BYTES;
    }
    for (const b of bullets) {
      v.setUint32(o, b.id, LE);
      v.setUint32(o + 4, b.owner, LE);
      v.setUint32(o + 8, b.seq, LE);
      v.setFloat32(o + 12, b.x, LE);
      v.setFloat32(o + 16, b.y, LE);
      o += BULLET_BYTES;
    }
    for (const a of asteroids) {
      v.setUint32(o, a.id, LE);
      v.setFloat32(o + 4, a.x, LE);
      v.setFloat32(o + 8, a.y, LE);
      v.setUint8(o + 12, a.radius);
      o += ASTEROID_BYTES;
    }
    return new Uint8Array(buf);
  },
};

export function patchSnapshotAck(bytes, ack) {
  const copy = new Uint8Array(bytes);
  new DataView(copy.buffer).setUint32(SNAPSHOT_ACK_OFFSET, ack, LE);
  return copy;
}

function decodeBinary(data) {
  const v = viewOf(data);
  if (v.byteLength < 2) throw new Error('short message');
  if (v.getUint8(0) !== PROTOCOL_VERSION) throw new Error(`unsupported protocol version ${v.getUint8(0)}`);
  const type = v.getUint8(1);

  if (type === MSG_INPUT) {
    if (v.byteLength !== 8) throw new Error('bad input length');
    const flags = v.getUint8(6);
    return {
      type: 'input',
      seq: v.getUint32(2, LE),
      thrust: flags & 1,
      fire: (flags >> 1) & 1,
      turn: v.getInt8(7),
    };
  }

  if (type === MSG_SNAPSHOT) {
    if (v.byteLength < HEADER) throw new Error('short snapshot');
    const nShips = v.getUint8(10);
    const nBullets = v.getUint16(11, LE);
    const nAsteroids = v.getUint16(13, LE);
    if (v.byteLength !== HEADER + nShips * SHIP_BYTES + nBullets * BULLET_BYTES + nAsteroids * ASTEROID_BYTES) {
      throw new Error('bad snapshot length');
    }
    const snap = { type: 'snapshot', tick: v.getUint32(2, LE), ack: v.getUint32(SNAPSHOT_ACK_OFFSET, LE), ships: [], bullets: [], asteroids: [] };
    let o = HEADER;
    for (let i = 0; i < nShips; i++, o += SHIP_BYTES) {
      snap.ships.push({
        id: v.getUint32(o, LE),
        x: v.getFloat32(o + 4, LE), y: v.getFloat32(o + 8, LE),
        vx: v.getFloat32(o + 12, LE), vy: v.getFloat32(o + 16, LE),
        angle: v.getInt16(o + 20, LE) / ANGLE_SCALE,
        hp: v.getUint8(o + 22), cooldown: v.getUint8(o + 23), respawn: v.getUint8(o + 24),
      });
    }
    for (let i = 0; i < nBullets; i++, o += BULLET_BYTES) {
      snap.bullets.push({
        id: v.getUint32(o, LE), owner: v.getUint32(o + 4, LE), seq: v.getUint32(o + 8, LE),
        x: v.getFloat32(o + 12, LE), y: v.getFloat32(o + 16, LE),
      });
    }
    for (let i = 0; i < nAsteroids; i++, o += ASTEROID_BYTES) {
      snap.asteroids.push({
        id: v.getUint32(o, LE), x: v.getFloat32(o + 4, LE), y: v.getFloat32(o + 8, LE), radius: v.getUint8(o + 12),
      });
    }
    return snap;
  }
  throw new Error(`unknown message type ${type}`);
}

export function decodeMessage(data) {
  if (typeof data === 'string') {
    const msg = JSON.parse(data);
    if (!msg || typeof msg.type !== 'string') throw new Error('bad json message');
    return msg;
  }
  return decodeBinary(data);
}

export function getCodec(name) {
  return name === 'json' ? jsonCodec : binaryCodec;
}

