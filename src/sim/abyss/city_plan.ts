// Rimholt's street plan: where the terrace walls run, where the avenues and
// stair lanes cut through them, which district a plot belongs to, which plots
// grew gardens instead of houses, and the city ground those make.
//
// The brief (owner, 2026-10-05): an organic, slightly irregular city that
// still reads as BUILT. So nothing here is a perfect circle or a straight
// spoke:
//
// - Each terrace wall is a closed polygon of straight masonry runs between
//   corners at irregular spacing and irregular distance from the pit. Straight
//   runs read as hand-built; their changing directions read as a town that
//   followed the hill one plot at a time.
// - The avenues leave the rim exactly at their gates, then bend gently as they
//   climb, each its own way, and they are not evenly spaced.
// - Narrow stair lanes cut through every wall at irregular intervals: the
//   short way up between the avenues.
// - Gardens and orchards fill some plots, more of them toward the outskirts.
//
// Everything is a pure function of fixed constants (hash2 with a fixed salt,
// never the world seed): the plan is content, identical on every host, and the
// terrain (terrain.ts), the layout (city_layout.ts), and the ground paint
// (surface.ts) all read the same answers. Coordinates here are LOCAL to the
// pit axis (ABYSS_CENTER subtracted).

import { fbm2, hash2 } from '../rng';
import { CITY_OUTER_RADIUS, PIT_RADIUS, RIM_HEIGHT, RIM_OUTER_RADIUS } from './geometry';

const TAU = Math.PI * 2;
const SALT = 0x6c17;

/** Angle (atan2(z, x), local to the pit axis) of the south gate, where the
 *  main avenue meets the rim and the spiral descent begins. */
export const SOUTH_GATE_ANGLE = -Math.PI / 2;

/** Angle relative to the south gate, wrapped into [0, TAU). */
function fromGate(theta: number): number {
  let t = (theta - SOUTH_GATE_ANGLE) % TAU;
  if (t < 0) t += TAU;
  return t;
}

function smooth(t: number): number {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

// ---------------------------------------------------------------------------
// Terrace walls and the heights they hold up
// ---------------------------------------------------------------------------

/** Number of retaining walls from the rim plaza up to the city's outer edge.
 *  Wall k (0-based) holds up level k + 1; level 0 is the rim plaza, and the
 *  last wall is the city's edge, where the island's farmland begins on top. */
export const CITY_WALLS = 6;
/** Mean radius of each wall. The spacing is deliberately uneven: some terraces
 *  are deep, some narrow, as a town that grew in stages would have them. */
const WALL_MEAN_RADIUS: readonly number[] = [
  RIM_OUTER_RADIUS,
  968,
  1146,
  1302,
  1486,
  CITY_OUTER_RADIUS - 12,
];
/** How far a corner may sit from its wall's mean radius, inward or outward
 *  (the outer wall stays inside the city's edge). */
const CORNER_JITTER: readonly number[] = [20, 28, 30, 28, 30, 8];
/** Height each wall lifts the ground by, in total (sums to the city's climb).
 *  Tall enough that the terraces read as tiers of roofs stacked up from the
 *  rim, the way the reference town climbs, rather than a flat paved plain:
 *  three to five storeys a wall, about 80 yards over the whole city. */
export const WALL_RISE: readonly number[] = [15, 13, 16, 12, 14, 11];
/** Length range of one straight run of wall, corner to corner (yards). */
const RUN_MIN = 60;
const RUN_MAX = 170;
/** Horizontal run of a wall's face: far too steep to climb, yet wider than
 *  the terrain mesh's coarse vertex spacing, so the drawn wall stands where
 *  the sim's does. */
export const WALL_FACE_RUN = 4.5;
/** The rim plaza's own lift from the pit edge to the foot of the first wall. */
const PLAZA_LIFT = 2;
/** Each upper level rises this much from its wall top to the foot of the
 *  next wall (drainage, and streets that are never quite flat). It comes out
 *  of the next wall's face, so the city's total climb is unchanged. */
const LEVEL_TILT = 0.8;

/** Ground height on top of each wall (the inner edge of the level above). */
export const WALL_TOP: readonly number[] = WALL_RISE.reduce<number[]>((out, rise, k) => {
  out.push((k === 0 ? RIM_HEIGHT + PLAZA_LIFT : out[k - 1]) + rise);
  return out;
}, []);
/** Ground height at the foot of each wall (the outer edge of the level below). */
export const WALL_FOOT: readonly number[] = WALL_TOP.map((_, k) =>
  k === 0 ? RIM_HEIGHT + PLAZA_LIFT : WALL_TOP[k - 1] + LEVEL_TILT,
);
/** Ground height on top of the city's outer wall (the island starts here). */
export const CITY_EDGE_HEIGHT = WALL_TOP[CITY_WALLS - 1];

interface WallPolygon {
  /** Corner angles, ascending, all within one turn from the south gate. */
  angles: number[];
  /** Corner positions (local to the pit axis). */
  xs: number[];
  zs: number[];
}

function buildWall(k: number): WallPolygon {
  const angles: number[] = [];
  const xs: number[] = [];
  const zs: number[] = [];
  const mean = WALL_MEAN_RADIUS[k];
  let a = SOUTH_GATE_ANGLE + (hash2(k, 0, SALT) * RUN_MIN) / mean;
  for (let i = 0; a < SOUTH_GATE_ANGLE + TAU - (RUN_MIN * 0.5) / mean; i++) {
    // neighbouring corners lean the same way more often than not, so the
    // wall wanders in long bays and bulges instead of zig-zagging
    const slow = Math.sin(a * 3 + k * 1.7) * 0.5 + Math.sin(a * 7 - k * 2.3) * 0.25;
    const jitter = (hash2(k, i + 1, SALT + 1) - 0.5) * 0.5 + slow;
    const r = mean + jitter * CORNER_JITTER[k];
    angles.push(a);
    xs.push(Math.cos(a) * r);
    zs.push(Math.sin(a) * r);
    a += (RUN_MIN + hash2(k, i + 1, SALT + 2) * (RUN_MAX - RUN_MIN)) / mean;
  }
  return { angles, xs, zs };
}

const WALLS: readonly WallPolygon[] = Array.from({ length: CITY_WALLS }, (_, k) => buildWall(k));

/** Index of the corner that starts the wall run containing angle theta. */
function runIndex(w: WallPolygon, theta: number): number {
  const t = fromGate(theta) + SOUTH_GATE_ANGLE;
  const angles = w.angles;
  if (t < angles[0]) return angles.length - 1; // the closing run
  let lo = 0;
  let hi = angles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (angles[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Radius of wall k's face along the ray at angle theta. The ray meets one
 *  straight run between two corners. */
export function wallRadiusAt(k: number, theta: number): number {
  const w = WALLS[k];
  const i = runIndex(w, theta);
  const j = (i + 1) % w.angles.length;
  const ax = w.xs[i];
  const az = w.zs[i];
  const dx = w.xs[j] - ax;
  const dz = w.zs[j] - az;
  const ux = Math.cos(theta);
  const uz = Math.sin(theta);
  // P = A + tD with P on the ray: cross(u, A + tD) = 0
  const cu = ux * dz - uz * dx;
  const t = Math.abs(cu) < 1e-9 ? 0 : -(ux * az - uz * ax) / cu;
  return ux * (ax + t * dx) + uz * (az + t * dz);
}

/** Unit direction along wall k's run at angle theta, pointing the way the
 *  angle increases. The layout lines house fronts up with it. */
export function wallRunDirection(k: number, theta: number): { x: number; z: number } {
  const w = WALLS[k];
  const i = runIndex(w, theta);
  const j = (i + 1) % w.angles.length;
  const dx = w.xs[j] - w.xs[i];
  const dz = w.zs[j] - w.zs[i];
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
}

/** The corners of wall k in order (local coordinates). */
export function wallCorners(k: number): readonly { x: number; z: number; theta: number }[] {
  const w = WALLS[k];
  return w.angles.map((theta, i) => ({ x: w.xs[i], z: w.zs[i], theta }));
}

/** Which level a local point stands on: 0 is the rim plaza, CITY_WALLS is on
 *  top of the outer wall. */
export function levelAt(r: number, theta: number): number {
  for (let k = 0; k < CITY_WALLS; k++) {
    if (r < wallRadiusAt(k, theta)) return k;
  }
  return CITY_WALLS;
}

// ---------------------------------------------------------------------------
// Avenues
// ---------------------------------------------------------------------------

interface Avenue {
  /** Angle at which it meets the rim (its gate). */
  gate: number;
  halfWidth: number;
  /** Sideways wander as it climbs (yards), its wavelength, and phase. */
  swing: number;
  wavelength: number;
  phase: number;
}

/** Eight avenues. The south one (the main gate and the descent) and the north
 *  one (to the explorers' hall) are wider and nearly straight; the others sit
 *  off the even spacing by up to a sixth of a sector and wander more. */
const AVENUES: readonly Avenue[] = Array.from({ length: 8 }, (_, i) => {
  const main = i === 0 || i === 4;
  const even = SOUTH_GATE_ANGLE + (i * TAU) / 8;
  return {
    gate: main ? even : even + (hash2(i, 11, SALT) - 0.5) * (TAU / 8) * 0.34,
    halfWidth: main ? 11 : 7 + hash2(i, 12, SALT) * 2,
    swing: main ? 8 : 16 + hash2(i, 13, SALT) * 22,
    wavelength: 190 + hash2(i, 14, SALT) * 120,
    phase: hash2(i, 15, SALT) * TAU,
  };
});

export const CITY_AVENUE_COUNT = AVENUES.length;
/** Index of the south (main) avenue, and of the north one. */
export const SOUTH_AVENUE = 0;
export const NORTH_AVENUE = 4;
/** Blend from an avenue's paved ramp into the terrace beside it. */
export const AVENUE_BLEND = 10;

/** Centre-line angle of avenue i at radius r: it leaves its gate straight,
 *  then wanders by its own swing as it climbs. */
export function avenueAngleAt(i: number, r: number): number {
  const a = AVENUES[i];
  const climb = Math.max(0, r - PIT_RADIUS);
  const ease = Math.min(1, climb / 160);
  const side = a.swing * ease * (Math.sin(climb / a.wavelength + a.phase) - Math.sin(a.phase));
  return a.gate + side / Math.max(r, 1);
}

export function avenueHalfWidth(i: number): number {
  return AVENUES[i].halfWidth;
}

export interface AvenueHit {
  index: number;
  /** Yards from the point to the avenue's centre line. */
  distance: number;
}

/** The nearest avenue to a local point and its distance. */
export function nearestAvenue(x: number, z: number): AvenueHit {
  const r = Math.hypot(x, z);
  const theta = Math.atan2(z, x);
  let best = Number.POSITIVE_INFINITY;
  let index = 0;
  for (let i = 0; i < AVENUES.length; i++) {
    let d = theta - avenueAngleAt(i, r);
    d -= TAU * Math.round(d / TAU);
    const dist = Math.sin(Math.min(Math.abs(d), Math.PI / 2)) * r;
    if (dist < best) {
      best = dist;
      index = i;
    }
  }
  return { index, distance: best };
}

/** How fully an avenue's ramp owns a local point: 1 on the paved way, easing
 *  to 0 across the blend into the terrace beside it. */
export function avenueWeight(x: number, z: number): number {
  const hit = nearestAvenue(x, z);
  const hw = AVENUES[hit.index].halfWidth;
  return 1 - smooth((hit.distance - hw) / AVENUE_BLEND);
}

/** Height of the avenues' ramp at radius r: an even climb from the rim to the
 *  city's edge, through the middle of each wall's rise. */
function avenueRampHeight(r: number): number {
  if (r <= PIT_RADIUS) return RIM_HEIGHT;
  let r0 = PIT_RADIUS;
  let h0 = RIM_HEIGHT;
  for (let k = 0; k <= CITY_WALLS; k++) {
    const r1 = k < CITY_WALLS ? WALL_MEAN_RADIUS[k] : CITY_OUTER_RADIUS;
    const h1 = k < CITY_WALLS ? (WALL_FOOT[k] + WALL_TOP[k]) / 2 : CITY_EDGE_HEIGHT;
    if (r <= r1) return h0 + ((h1 - h0) * (r - r0)) / (r1 - r0);
    r0 = r1;
    h0 = h1;
  }
  return CITY_EDGE_HEIGHT;
}

// ---------------------------------------------------------------------------
// Stair lanes
// ---------------------------------------------------------------------------

/** Half width of a stair lane cut through a wall, and its sideways blend. */
export const LANE_HALF_WIDTH = 2.6;
const LANE_BLEND = 1.6;
/** Horizontal run of a lane's climb through its wall: walkable up the
 *  tallest wall (a smoothstep's steepest grade is 1.5x its mean). */
export const LANE_RUN = 24;
/** Spacing range between lanes along one wall (yards of wall). */
const LANE_GAP_MIN = 110;
const LANE_GAP_MAX = 240;

/** Lane angles per wall, ascending within one turn from the south gate. */
const LANES: readonly number[][] = WALLS.map((_, k) => {
  const out: number[] = [];
  const r = WALL_MEAN_RADIUS[k];
  const length = TAU * r;
  let s = hash2(k, 21, SALT) * LANE_GAP_MAX;
  for (let i = 0; s < length - LANE_GAP_MIN * 0.5; i++) {
    out.push(SOUTH_GATE_ANGLE + s / r);
    s += LANE_GAP_MIN + hash2(k, i + 22, SALT) * (LANE_GAP_MAX - LANE_GAP_MIN);
  }
  // the outer wall is the city's edge: fewer ways up onto the farmland
  return k === CITY_WALLS - 1 ? out.filter((_, n) => n % 3 === 0) : out;
});

/** Lane angles of wall k (for the layout: steps, clear ground). */
export function laneAngles(k: number): readonly number[] {
  return LANES[k];
}

/** Arc distance (yards at radius r) from angle theta to wall k's nearest lane. */
function laneDistance(k: number, r: number, theta: number): number {
  const lanes = LANES[k];
  const t = fromGate(theta) + SOUTH_GATE_ANGLE;
  let lo = 0;
  let hi = lanes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lanes[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  let best = Number.POSITIVE_INFINITY;
  // the neighbours of the insertion point, plus both ends for the wrap
  for (const n of [lo - 1, lo, 0, lanes.length - 1]) {
    if (n < 0 || n >= lanes.length) continue;
    let d = t - lanes[n];
    d -= TAU * Math.round(d / TAU);
    best = Math.min(best, Math.abs(d) * r);
  }
  return best;
}

/** How fully a stair lane through wall k owns a point: 1 in the lane, easing
 *  to 0 across its sides. */
export function laneWeight(k: number, r: number, theta: number): number {
  if (LANES[k].length === 0) return 0;
  return 1 - smooth((laneDistance(k, r, theta) - LANE_HALF_WIDTH) / LANE_BLEND);
}

// ---------------------------------------------------------------------------
// The city ground
// ---------------------------------------------------------------------------

/** What a city point is, for the ground paint and the layout. */
export interface CityGround {
  height: number;
  level: number;
  /** 1 on an avenue's paved way, easing to 0 beside it. */
  avenue: number;
  /** 1 in a stair lane, easing to 0 beside it. */
  lane: number;
  /** 0 on a level's floor, rising to 1 on a terrace wall's face. */
  face: number;
}

/** The city ground at a LOCAL point between the pit edge and the city edge. */
export function cityGround(x: number, z: number): CityGround {
  const r = Math.hypot(x, z);
  const theta = Math.atan2(z, x);
  const level = levelAt(r, theta);
  let height = CITY_EDGE_HEIGHT;
  let lane = 0;
  let face = 0;
  if (level < CITY_WALLS) {
    const k = level;
    const inner = k === 0 ? PIT_RADIUS : wallRadiusAt(k - 1, theta);
    const outer = wallRadiusAt(k, theta);
    lane = laneWeight(k, r, theta);
    const run = WALL_FACE_RUN + (LANE_RUN - WALL_FACE_RUN) * lane;
    const faceStart = outer - run;
    if (r <= faceStart) {
      const t = Math.max(0, Math.min(1, (r - inner) / Math.max(1, faceStart - inner)));
      // the rim plaza is level at the edge and lifts toward its wall
      height = k === 0 ? RIM_HEIGHT + PLAZA_LIFT * t * t : WALL_TOP[k - 1] + LEVEL_TILT * t;
    } else {
      const c = (r - faceStart) / run;
      height = WALL_FOOT[k] + (WALL_TOP[k] - WALL_FOOT[k]) * smooth(c);
      face = 1 - lane;
    }
  }
  const avenue = avenueWeight(x, z);
  if (avenue > 0) height += (avenueRampHeight(r) - height) * avenue;
  return { height, level, avenue, lane, face: face * (1 - avenue) };
}

/** City ground height at a LOCAL point. */
export function cityGroundHeight(x: number, z: number): number {
  return cityGround(x, z).height;
}

// ---------------------------------------------------------------------------
// Districts and gardens
// ---------------------------------------------------------------------------

/** The five districts: the rim ring, then four quarters split by avenues. */
export type CityDistrict = 'centre' | 'north' | 'east' | 'south' | 'west';

/** District of a local point. The quarters are split by the avenues nearest
 *  the diagonals, so every border runs along a street. */
export function districtAt(r: number, theta: number): CityDistrict {
  if (levelAt(r, theta) === 0) return 'centre';
  const t = fromGate(theta);
  const border = (n: number) => fromGate(avenueAngleAt(n, r));
  if (t < border(1) || t >= border(7)) return 'south';
  if (t < border(3)) return 'east';
  if (t < border(5)) return 'north';
  return 'west';
}

/** Gardens and orchards: whole plots left green, more of them toward the
 *  outskirts and in the west, fewer in the crowded south, none on the rim
 *  plaza, a street, or a wall. */
export function isGardenPlot(x: number, z: number): boolean {
  const r = Math.hypot(x, z);
  const theta = Math.atan2(z, x);
  const level = levelAt(r, theta);
  if (level < 2 || level >= CITY_WALLS) return false;
  if (avenueWeight(x, z) > 0) return false;
  const district = districtAt(r, theta);
  const bias = district === 'west' ? -0.06 : district === 'south' ? 0.08 : 0;
  return fbm2(x * 0.011, z * 0.011, SALT, 3) > 0.64 - level * 0.025 + bias;
}
