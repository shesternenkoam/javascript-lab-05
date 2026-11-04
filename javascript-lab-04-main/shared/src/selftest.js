

import { createWorld, addShip, stepWorld, hashWorld } from './sim.js';
import { mulberry32 } from './rng.js';

export function simSelfTest(steps = 1000, seed = 12345) {
  const world = createWorld(seed);
  const a = addShip(world).id;
  const b = addShip(world).id;
  const script = mulberry32(777);
  for (let i = 0; i < steps; i++) {
    const r1 = script(), r2 = script();
    stepWorld(world, {
      [a]: { seq: i + 1, thrust: r1 < 0.6 ? 1 : 0, turn: Math.floor(r1 * 3 * 1000) % 3 - 1, fire: r2 < 0.2 ? 1 : 0 },
      [b]: { seq: i + 1, thrust: r2 < 0.5 ? 1 : 0, turn: Math.floor(r2 * 3 * 1000) % 3 - 1, fire: r1 < 0.2 ? 1 : 0 },
    });
  }
  return hashWorld(world);
}

