// What the abyss world's ground is MADE of, where it is not natural ground:
// Rimholt's stone paving, its cobbled avenues and stair lanes, the masonry
// faces of its terrace walls, the garden plots left green, and the packed
// earth of the hanging quarter's shelf. The renderer paints it (the terrain
// model's surfaceAt hook); the sim never reads it.
//
// A pure function of position, like the ground itself, so every host and the
// renderer agree on it.

import type { GroundSurface } from '../types';
import { cityGround, isGardenPlot } from './city_plan';
import { ABYSS_CENTER, CITY_OUTER_RADIUS, PIT_RADIUS } from './geometry';
import { hangingShelfWeight } from './terrain';

/** The built surface at WORLD (x, z), or null for natural ground. */
export function abyssSurfaceAt(wx: number, wz: number): GroundSurface | null {
  const x = wx - ABYSS_CENTER.x;
  const z = wz - ABYSS_CENTER.z;
  const r = Math.hypot(x, z);
  if (r < PIT_RADIUS) return hangingShelfWeight(x, z) > 0.5 ? 'earth' : null;
  if (r > CITY_OUTER_RADIUS) return null;
  const g = cityGround(x, z);
  if (g.face > 0.5) return 'masonry';
  if (g.avenue > 0.5 || g.lane > 0.5) return 'street';
  return isGardenPlot(x, z) ? 'garden' : 'paving';
}
