// Where the abyss is: the one "is this position below the rim" predicate every
// abyss system shares (the expedition bag today; the ascent toll and the depth
// readout are meant to read the same answer instead of re-deriving it).
//
// The pit is a vertical cylinder: inside the opening's circle AND below the rim
// height. The opening is 1,000 m across at 1:1 scale (a 547 yd radius, see
// docs/design/abyss-world.md section 3), and the rim sits at Y = 0, so every
// metre of descent is a negative Y.
//
// The centre is a PLACEHOLDER until the island terrain lands: it sits far
// outside the current map, so the shipped world never reads as "in the abyss"
// and nothing changes for it. The terrain work repoints these numbers; no
// consumer may hard-code its own copy.
//
// Pure leaf: no SimContext, no rng, no clock.

import type { Vec3 } from '../types';

export interface AbyssPit {
  /** Centre of the opening on the ground plane (yards). */
  readonly x: number;
  readonly z: number;
  /** Radius of the opening (yards). */
  readonly radius: number;
  /** Height of the rim; anything strictly below it inside the circle is in the pit. */
  readonly rimY: number;
}

export const ABYSS_PIT: AbyssPit = Object.freeze({
  x: 40000,
  z: 40000,
  radius: 547,
  rimY: 0,
});

/** Whether a position is inside the pit: within the opening and below the rim. */
export function isInAbyss(pos: Pick<Vec3, 'x' | 'y' | 'z'>, pit: AbyssPit = ABYSS_PIT): boolean {
  if (!(pos.y < pit.rimY)) return false;
  const dx = pos.x - pit.x;
  const dz = pos.z - pit.z;
  return dx * dx + dz * dz <= pit.radius * pit.radius;
}
