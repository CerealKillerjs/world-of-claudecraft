// The abyss: where a world's vertical pit is, how deep a position sits in it,
// and which layer that depth belongs to. Pure leaf (no SimContext, no rng):
// the ascent toll (abyss_toll.ts) and any other "below the rim" rule share
// this one definition instead of re-deriving it.
//
// A world opts in by declaring `WorldContent.abyss`. The built-in world
// declares none, so every reader here answers "not in the abyss" and nothing
// it gates changes. Like waterLevel(), the definition is read from the ACTIVE
// world content (geometry is a module-global read, never cfg.world).
//
// Scale is 1:1 (docs/design/abyss-world.md, decided 2026-10-05): engine Y is
// the real depth converted to yards, so the layer bounds below are the
// reference depths in metres, converted once.

import { getActiveWorldContent } from './data';

/** Yards per metre (1 yd = 0.9144 m exactly). */
export const YD_PER_M = 1 / 0.9144;

/** A footprint on the (x, z) plane where the abyss rules apply. The shaft is a
 *  circle; the stacked deeper layers live in their own regions elsewhere on the
 *  plane, with their floors at the real depth in Y. */
export type AbyssRegion =
  | { kind: 'circle'; x: number; z: number; r: number }
  | { kind: 'rect'; minX: number; maxX: number; minZ: number; maxZ: number };

export interface AbyssDef {
  /** Engine Y of the rim: depth 0. Depth grows downward from here. */
  rimY: number;
  /** Every footprint below which the abyss rules apply. */
  regions: AbyssRegion[];
}

/** Upper bound of each layer in metres below the rim, 1:1 with the reference
 *  table (docs/design/abyss-world.md section 2). Layer n spans
 *  [LAYER_TOPS_M[n-1], LAYER_TOPS_M[n]); the last layer is open-ended. */
export const ABYSS_LAYER_TOPS_M: readonly number[] = Object.freeze([
  0, 1350, 2600, 7000, 12000, 13000, 15500,
]);

/** Number of layers (the deepest layer index). */
export const ABYSS_LAYER_COUNT = ABYSS_LAYER_TOPS_M.length;

/** The active world's abyss, or undefined when this world has none. */
export function activeAbyss(): AbyssDef | undefined {
  return getActiveWorldContent().abyss;
}

function regionContains(r: AbyssRegion, x: number, z: number): boolean {
  if (r.kind === 'circle') {
    const dx = x - r.x;
    const dz = z - r.z;
    return dx * dx + dz * dz <= r.r * r.r;
  }
  return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
}

/** Depth below the rim in yards at a position, or null when the position is
 *  not in the abyss (no abyss in this world, outside every region, or at or
 *  above the rim). */
export function abyssDepthYd(
  x: number,
  y: number,
  z: number,
  abyss: AbyssDef | undefined = activeAbyss(),
): number | null {
  if (!abyss) return null;
  const depth = abyss.rimY - y;
  if (!(depth > 0)) return null;
  for (const r of abyss.regions) if (regionContains(r, x, z)) return depth;
  return null;
}

/** The layer (1 to ABYSS_LAYER_COUNT) a depth in yards belongs to. A depth at
 *  or above the rim still reads as layer 1. */
export function abyssLayerAtDepthYd(depthYd: number): number {
  const depthM = depthYd / YD_PER_M;
  let layer = 1;
  for (let i = 1; i < ABYSS_LAYER_TOPS_M.length; i++) {
    if (depthM >= ABYSS_LAYER_TOPS_M[i]) layer = i + 1;
  }
  return layer;
}
