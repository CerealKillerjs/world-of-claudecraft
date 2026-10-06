// The Sounding's analytic heightfield: island, terraced rim city, and the
// continuous 1:1 first layer of the pit (design doc section 4).
//
// A pure function of (x, z, seed), like every terrain read in the sim, so the
// renderer, colliders, pathfinding, and every host sample the same ground.
// The heightfield holds ONE height per (x, z), which shapes the pit:
//
// - The mouth is a 547 yd radius circle at Y = 0 (the rim). Inside it the
//   ground falls away as a near-vertical wall.
// - A single ledge path spirals DOWN and INWARD along that wall, losing height
//   at a 1-in-4 grade. Each turn sits one SPIRAL_PITCH further in than the
//   turn above, so no ledge ever lies under another one (the heightfield rule),
//   and the cliff between two turns is the pit wall: hundreds of yards tall
//   over a few dozen yards of run.
// - Some stretches of ledge widen into hanging meadows (SPIRAL_MEADOWS).
// - The spiral ends on the layer 1 floor, 1,350 m (1,476 yd) below the rim,
//   where the boundary camp stands.
//
// The city climbs AWAY from the pit in stepped terraces held up by irregular,
// hand-built retaining walls, cut by avenues that ramp smoothly between them
// and by narrow stair lanes, so the whole city looks down on the mouth like an
// amphitheatre (the plan and its ground: city_plan.ts). Past the city the
// island rolls out to its beaches.
//
// Every shape constant lives here so the world pack (which places the camp,
// railings, and buildings ON this ground) and the tests share one definition.

import { fbm2 } from '../rng';
import { CITY_EDGE_HEIGHT, cityGroundHeight } from './city_plan';
import {
  ABYSS_CENTER,
  CITY_OUTER_RADIUS,
  COAST_OUTER_RADIUS,
  ISLAND_RADIUS,
  LAYER1_FLOOR_Y,
  PIT_RADIUS,
  RIM_HEIGHT,
} from './geometry';

const TAU = Math.PI * 2;

/** Angle (atan2(z, x), radians) where the spiral leaves the rim: due south,
 *  at the head of the main avenue that runs up from the harbor. */
export const SPIRAL_START_ANGLE = -Math.PI / 2;
/** The spiral winds clockwise seen from above (decreasing atan2 angle). */
const SPIRAL_DIR = -1;
/** Gap between the pit edge and the first turn's wall foot. */
const SPIRAL_EDGE_INSET = 6;
/** How much further in each successive turn sits (wall foot to wall foot). */
export const SPIRAL_PITCH = 110;
/** Ledge width away from the meadows. */
export const SPIRAL_LEDGE_WIDTH = 16;
/** Extra width at the heart of a hanging meadow. */
const SPIRAL_MEADOW_EXTRA = 58;
/** Meadow sectors per turn (where the ledge swells into a shelf of grass). */
const SPIRAL_MEADOWS = 3;
/** The path's grade: height lost per yard walked along the ledge centre. */
export const SPIRAL_GRADE = 0.25;

/** Total height the spiral descends: rim to layer 1 floor. */
export const SPIRAL_DROP = RIM_HEIGHT - LAYER1_FLOOR_Y;

// Radius of the wall foot of the turn at unwrapped angle phi (0 at the start).
function wallFootRadius(phi: number): number {
  return PIT_RADIUS - SPIRAL_EDGE_INSET - (SPIRAL_PITCH * phi) / TAU;
}

// Walked length of the ledge centre from the start to unwrapped angle phi. The
// centre runs half the BASE ledge width in from the wall foot, so the grade is
// measured where a traveller actually walks.
function pathLength(phi: number): number {
  const r0 = PIT_RADIUS - SPIRAL_EDGE_INSET - SPIRAL_LEDGE_WIDTH / 2;
  return r0 * phi - (SPIRAL_PITCH * phi * phi) / (2 * TAU);
}

/** Unwrapped angle at which the spiral reaches the layer 1 floor: the root of
 *  pathLength(phi) * SPIRAL_GRADE = SPIRAL_DROP (closed form, so the pack and
 *  the tests agree exactly). About 2.3 turns. */
export const SPIRAL_END_PHI = (() => {
  const r0 = PIT_RADIUS - SPIRAL_EDGE_INSET - SPIRAL_LEDGE_WIDTH / 2;
  const a = SPIRAL_PITCH / (2 * TAU);
  const target = SPIRAL_DROP / SPIRAL_GRADE;
  return (r0 - Math.sqrt(r0 * r0 - 4 * a * target)) / (2 * a);
})();

/** Ledge height at unwrapped angle phi (floor height past the end). */
export function spiralHeightAt(phi: number): number {
  if (phi <= 0) return RIM_HEIGHT;
  if (phi >= SPIRAL_END_PHI) return LAYER1_FLOOR_Y;
  return RIM_HEIGHT - pathLength(phi) * SPIRAL_GRADE;
}

/** Ledge width at a (wrapped) angle along the turn: meadows swell it. */
export function spiralLedgeWidthAt(theta: number): number {
  const s = Math.sin(SPIRAL_MEADOWS * theta + 0.7);
  const swell = s > 0.55 ? ((s - 0.55) / 0.45) ** 2 : 0;
  return SPIRAL_LEDGE_WIDTH + SPIRAL_MEADOW_EXTRA * swell;
}

/** A point on the ledge centre line, for placing things on the path. */
export function spiralPointAt(phi: number): { x: number; z: number; y: number; theta: number } {
  const theta = SPIRAL_START_ANGLE + SPIRAL_DIR * phi;
  const r = wallFootRadius(phi) - SPIRAL_LEDGE_WIDTH / 2;
  return {
    x: ABYSS_CENTER.x + Math.cos(theta) * r,
    z: ABYSS_CENTER.z + Math.sin(theta) * r,
    y: spiralHeightAt(phi),
    theta,
  };
}

/** Radius of the layer 1 floor disc, where the last turn of ledge meets it. */
export const LAYER1_FLOOR_RADIUS = wallFootRadius(SPIRAL_END_PHI);

// The pit cliff profile between a higher ledge edge (t = 0) and the next
// ledge's wall foot (t = 1): a sheer face with a short lip at the top and a
// scree apron at the bottom, never perfectly vertical (the mesh needs run).
function cliffProfile(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  // mostly linear (the sheer face) with smoothed ends
  return c * c * (3 - 2 * c) * 0.35 + c * 0.65;
}

// Height inside the pit (r < PIT_RADIUS).
function pitHeight(x: number, z: number, r: number, seed: number): number {
  const theta = Math.atan2(z, x);
  // unwrapped angle of this direction on the FIRST turn, in [0, TAU)
  let base = (SPIRAL_DIR * (theta - SPIRAL_START_ANGLE)) % TAU;
  if (base < 0) base += TAU;
  // continuous turn coordinate: phi where the wall foot would sit at radius r
  const phiHere = ((PIT_RADIUS - SPIRAL_EDGE_INSET - r) * TAU) / SPIRAL_PITCH;
  // the outer (higher) turn at this direction is the last whose foot is >= r
  const n = Math.floor((phiHere - base) / TAU);
  const floorRough = (fbm2(x * 0.02, z * 0.02, seed + 401, 3) - 0.5) * 6;
  if (n < 0) {
    // between the rim edge and the first turn: the rim's own cliff
    const innerPhi = base;
    const innerFoot = wallFootRadius(innerPhi);
    const hInner = spiralHeightAt(innerPhi);
    const span = PIT_RADIUS - innerFoot;
    const d = PIT_RADIUS - r;
    const cliff = RIM_HEIGHT + (hInner - RIM_HEIGHT) * cliffProfile(d / Math.max(1e-6, span));
    const w = hangingQuarterWeight(base);
    if (w <= 0) return cliff;
    // the hanging quarter: a shelf of packed ground the city has crept out onto,
    // sloping down into the pit, then its own sheer drop to the ledge below
    const shelfH = hangingShelfHeight(d, x, z, seed);
    const shelf =
      d <= HANGING_SHELF_DEPTH
        ? shelfH
        : shelfH +
          (hInner - shelfH) *
            cliffProfile((d - HANGING_SHELF_DEPTH) / Math.max(1e-6, span - HANGING_SHELF_DEPTH));
    return cliff + (shelf - cliff) * w;
  }
  const outerPhi = base + n * TAU;
  if (outerPhi >= SPIRAL_END_PHI) return LAYER1_FLOOR_Y + floorRough;
  const innerPhi = outerPhi + TAU;
  const foot = wallFootRadius(outerPhi);
  const width = spiralLedgeWidthAt(theta);
  const d = foot - r;
  const hOuter = spiralHeightAt(outerPhi);
  if (d <= width) {
    // on the ledge (meadows get a gentle grassy roll, the path stays level)
    const meadow = Math.max(0, (width - SPIRAL_LEDGE_WIDTH) / SPIRAL_MEADOW_EXTRA);
    const roll = (fbm2(x * 0.05, z * 0.05, seed + 409, 2) - 0.5) * 3 * meadow;
    return hOuter + roll * Math.min(1, d / 6);
  }
  const hInner = innerPhi >= SPIRAL_END_PHI ? LAYER1_FLOOR_Y : spiralHeightAt(innerPhi);
  const t = (d - width) / Math.max(1e-6, SPIRAL_PITCH - width);
  const h = hOuter + (hInner - hOuter) * cliffProfile(t);
  // the ledge that reaches the floor blends into its rough ground
  return innerPhi >= SPIRAL_END_PHI ? h + floorRough * cliffProfile(t) : h;
}

// The hanging quarter (design guide section 3): on the south side, just east of
// where the spiral leaves the rim, the city's poorest quarter has crept out
// over the edge onto a shelf that slopes down INTO the pit. It is the lowest
// part of the city. The shelf sits where the rim's own cliff is widest (just
// before the spiral wraps under its start), so it never overlaps a ledge.
/** Unwrapped-angle window of the quarter (base angle, radians). */
export const HANGING_QUARTER_FROM = Math.PI * 2 - 0.95;
export const HANGING_QUARTER_TO = Math.PI * 2 - 0.2;
const HANGING_QUARTER_FADE = 0.08;
/** How far the shelf reaches in from the rim edge. */
export const HANGING_SHELF_DEPTH = 80;
/** Grade of the shelf as it runs down into the pit (walkable). */
const HANGING_SHELF_GRADE = 0.45;

function hangingQuarterWeight(base: number): number {
  if (base <= HANGING_QUARTER_FROM || base >= HANGING_QUARTER_TO) return 0;
  const a = (base - HANGING_QUARTER_FROM) / HANGING_QUARTER_FADE;
  const b = (HANGING_QUARTER_TO - base) / HANGING_QUARTER_FADE;
  const c = Math.min(1, a, b);
  return c * c * (3 - 2 * c);
}

/** How fully a LOCAL point stands on the hanging quarter's shelf (0 off it):
 *  inside the quarter's angular window and within the shelf's reach of the
 *  rim edge. The ground paint reads it. */
export function hangingShelfWeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const d = PIT_RADIUS - r;
  if (d < 0 || d > HANGING_SHELF_DEPTH) return 0;
  let base = (SPIRAL_DIR * (Math.atan2(z, x) - SPIRAL_START_ANGLE)) % TAU;
  if (base < 0) base += TAU;
  return hangingQuarterWeight(base);
}

function hangingShelfHeight(d: number, x: number, z: number, seed: number): number {
  const lumps = (fbm2(x * 0.08, z * 0.08, seed + 433, 2) - 0.5) * 1.5;
  return RIM_HEIGHT - HANGING_SHELF_GRADE * Math.min(d, HANGING_SHELF_DEPTH) + lumps;
}

/** Height of the city's outer edge, where the island's farmland begins. */
export const CITY_TOP_HEIGHT = CITY_EDGE_HEIGHT;

/** Sea floor far from the island. */
const SEA_FLOOR = -26;

// Farmland, beaches, and sea beyond the city.
function islandHeight(x: number, z: number, r: number, seed: number): number {
  const roll = fbm2(x * 0.004, z * 0.004, seed + 421, 4);
  // a long gentle crest just past the city, falling to the shore
  const t = (r - CITY_OUTER_RADIUS) / (ISLAND_RADIUS - CITY_OUTER_RADIUS);
  const crest = CITY_TOP_HEIGHT + 6 - (CITY_TOP_HEIGHT + 2) * t ** 1.4;
  const blendIn = Math.min(1, (r - CITY_OUTER_RADIUS) / 60);
  const land = CITY_TOP_HEIGHT + (crest + (roll - 0.5) * 22 * blendIn - CITY_TOP_HEIGHT) * blendIn;
  if (r <= ISLAND_RADIUS - 120) return land;
  // the beach shelf: land eases down to the sea floor through the surf line
  const c = Math.min(1, (r - (ISLAND_RADIUS - 120)) / (COAST_OUTER_RADIUS - ISLAND_RADIUS + 120));
  const shore = c * c * (3 - 2 * c);
  return land + (SEA_FLOOR - land) * shore;
}

/** The finished abyss-world terrain height at WORLD (x, z). */
export function abyssTerrainHeight(wx: number, wz: number, seed: number): number {
  const x = wx - ABYSS_CENTER.x;
  const z = wz - ABYSS_CENTER.z;
  const r = Math.hypot(x, z);
  if (r < PIT_RADIUS) return pitHeight(x, z, r, seed);
  if (r <= CITY_OUTER_RADIUS) return cityGroundHeight(x, z);
  return islandHeight(x, z, r, seed);
}

/** Open sea: only OUTSIDE the island. The pit sinks far below the sea surface
 *  yet holds no water, so the generic "ground below the waterline" sea rule
 *  must never apply inside it. */
export function abyssIsOpenSea(wx: number, wz: number, seed: number, waterY: number): boolean {
  if (Math.hypot(wx - ABYSS_CENTER.x, wz - ABYSS_CENTER.z) < CITY_OUTER_RADIUS) return false;
  return abyssTerrainHeight(wx, wz, seed) < waterY;
}
