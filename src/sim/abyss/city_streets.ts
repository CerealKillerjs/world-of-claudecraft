// Rimholt's street network inside each terrace: the ring streets that run
// along a terrace between its walls, the cross alleys that cut it into
// blocks, and the blocks left open as plazas. The built blocks
// (city_blocks.ts) fill what is left with lots, and the ground paint
// (surface.ts) cobbles the streets and paves the plazas.
//
// The owner's brief (2026-10-06): "a dynamic look, as little repetition as
// possible, with alleys, plazas and so on", with the districts clearly told
// apart. So nothing here is regular:
//
// - a terrace is split into stripes by ring streets that follow its walls
//   and meander a few yards either way, one wider main street among them;
// - each stripe is cut into blocks by alleys at irregular spacing that
//   depends on the district (the poor south is a warren of narrow passages,
//   the well-off north and the west's gardens have long blocks), alleys
//   that run askew, and some that stop halfway (a dead end that becomes a
//   T-junction with the row behind);
// - the stair lanes and the avenues are alleys too, so every stair lands on
//   a street and every avenue is lined by facades;
// - some blocks stay open as plazas, more of them beside the avenues.
//
// Pure functions of fixed constants (hash2 with a fixed salt, no world seed,
// no Rng): the plan is content, identical on every host and every boot.

import { hash2 } from '../rng';
import {
  AVENUE_BLEND,
  avenueAngleAt,
  avenueHalfWidth,
  CITY_AVENUE_COUNT,
  CITY_WALLS,
  type CityDistrict,
  districtAt,
  LANE_HALF_WIDTH,
  laneAngles,
  levelAt,
  SOUTH_GATE_ANGLE,
  WALL_FACE_RUN,
  wallRadiusAt,
} from './city_plan';
import { PIT_RADIUS } from './geometry';

const TAU = Math.PI * 2;
const SALT = 0x5e17;

function rand(a: number, b: number): number {
  return hash2(a, b, SALT);
}

/** Wrap an angle into [SOUTH_GATE_ANGLE, SOUTH_GATE_ANGLE + TAU). */
function fromGate(theta: number): number {
  let t = theta - SOUTH_GATE_ANGLE;
  t -= TAU * Math.floor(t / TAU);
  return SOUTH_GATE_ANGLE + t;
}

// ---------------------------------------------------------------------------
// The band each terrace builds on
// ---------------------------------------------------------------------------

/** The open walk along the top of every terrace wall (its parapet side). */
export const TOP_PROMENADE = 7;
/** The gap kept between the back row of a terrace and the wall behind it. */
export const WALL_FOOT_GAP = 2;
/** The open walk along the pit edge, measured from the edge: the
 *  watchtowers, cranes and lookout decks stand in it. */
export const RIM_PROMENADE = 48;
/** The rim ring road (city_layout lays it), its radius and half width. */
export const RIM_RING_RADIUS = PIT_RADIUS + 115;
export const RIM_RING_HALF_WIDTH = 5;

/** Where a terrace's built band starts (its pit side) at bearing theta. */
export function bandInner(level: number, theta: number): number {
  return level === 0 ? PIT_RADIUS + RIM_PROMENADE : wallRadiusAt(level - 1, theta) + TOP_PROMENADE;
}

/** Where a terrace's built band ends (against the wall behind it). */
export function bandOuter(level: number, theta: number): number {
  return wallRadiusAt(level, theta) - WALL_FACE_RUN - WALL_FOOT_GAP;
}

// ---------------------------------------------------------------------------
// District grain: how each quarter cuts its blocks
// ---------------------------------------------------------------------------

export interface StreetGrain {
  /** Arc spacing between alleys, yards. */
  spacingMin: number;
  spacingMax: number;
  /** Alley half width range, yards. */
  halfMin: number;
  halfMax: number;
  /** Chance an alley stops halfway across its stripe. */
  deadEnd: number;
  /** Most an alley runs askew across its stripe, yards of arc. */
  skew: number;
  /** Chance a block stays open as a plaza (beside an avenue: AVENUE_PLAZA). */
  plaza: number;
}

export const STREET_GRAIN: Readonly<Record<CityDistrict, StreetGrain>> = {
  // the rim ring: old, busy, medium blocks
  centre: {
    spacingMin: 34,
    spacingMax: 60,
    halfMin: 1.6,
    halfMax: 2.6,
    deadEnd: 0.15,
    skew: 8,
    plaza: 0.07,
  },
  // the poor south: a warren of narrow, crooked passages and blind alleys
  south: {
    spacingMin: 16,
    spacingMax: 30,
    halfMin: 1.2,
    halfMax: 1.8,
    deadEnd: 0.32,
    skew: 11,
    plaza: 0.04,
  },
  // the east: wide blocks for yards and workshops, carts need room
  east: {
    spacingMin: 40,
    spacingMax: 72,
    halfMin: 2.2,
    halfMax: 3.2,
    deadEnd: 0.1,
    skew: 5,
    plaza: 0.05,
  },
  // the north: long, straight, generous blocks and the most squares
  north: {
    spacingMin: 46,
    spacingMax: 76,
    halfMin: 2.2,
    halfMax: 3,
    deadEnd: 0.08,
    skew: 3,
    plaza: 0.1,
  },
  // the west: long blocks of cottages and gardens, wandering lanes
  west: {
    spacingMin: 50,
    spacingMax: 92,
    halfMin: 1.6,
    halfMax: 2.4,
    deadEnd: 0.22,
    skew: 13,
    plaza: 0.05,
  },
};

/** Chance a block that opens onto an avenue stays open as a plaza. */
const AVENUE_PLAZA = 0.32;
/** Target depth of a stripe between two ring streets: two rows of houses
 *  back to back with a yard or a courtyard between them. */
const STRIPE_DEPTH = 46;

// ---------------------------------------------------------------------------
// Ring streets
// ---------------------------------------------------------------------------

export interface RingStreet {
  level: number;
  /** Share of the band's depth from its pit side. */
  frac: number;
  /** Meander amplitude, yards, and two whole-number frequencies (so the
   *  street closes on itself around the ring). */
  amp: number;
  m1: number;
  p1: number;
  m2: number;
  p2: number;
  halfWidth: number;
  /** A ring laid at a fixed radius (the rim ring road), when set. */
  fixedRadius?: number;
}

/** A ring street's centre radius at bearing theta. */
export function ringRadius(s: RingStreet, theta: number): number {
  if (s.fixedRadius !== undefined) return s.fixedRadius;
  const rIn = bandInner(s.level, theta);
  const rOut = bandOuter(s.level, theta);
  const wave = 0.6 * Math.sin(s.m1 * theta + s.p1) + 0.4 * Math.sin(s.m2 * theta + s.p2);
  return rIn + s.frac * (rOut - rIn) + s.amp * wave;
}

function meanDepth(level: number): number {
  let sum = 0;
  for (let s = 0; s < 96; s++) {
    const t = SOUTH_GATE_ANGLE + (s / 96) * TAU;
    sum += bandOuter(level, t) - bandInner(level, t);
  }
  return sum / 96;
}

function ringStreets(level: number): RingStreet[] {
  const depth = meanDepth(level);
  const stripes = Math.max(2, Math.round(depth / STRIPE_DEPTH));
  const main = Math.floor(stripes / 2);
  const out: RingStreet[] = [];
  for (let i = 1; i < stripes; i++) {
    const seed = level * 31 + i;
    out.push({
      level,
      frac: (i + (rand(seed, 1) - 0.5) * 0.24) / stripes,
      amp: Math.min(5, (depth / stripes) * 0.09),
      m1: 5 + Math.floor(rand(seed, 2) * 7),
      p1: rand(seed, 3) * TAU,
      m2: 13 + Math.floor(rand(seed, 4) * 11),
      p2: rand(seed, 5) * TAU,
      halfWidth: i === main ? 3.2 : 2 + rand(seed, 6) * 0.6,
    });
  }
  if (level === 0) {
    // the rim ring road replaces the ring nearest to it
    let best = 0;
    const rIn = PIT_RADIUS + RIM_PROMENADE;
    const fixedFrac = (RIM_RING_RADIUS - rIn) / depth;
    out.forEach((s, i) => {
      if (Math.abs(s.frac - fixedFrac) < Math.abs(out[best].frac - fixedFrac)) best = i;
    });
    out[best] = {
      ...out[best],
      frac: fixedFrac,
      amp: 0,
      fixedRadius: RIM_RING_RADIUS,
      halfWidth: RIM_RING_HALF_WIDTH,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stripes and alleys
// ---------------------------------------------------------------------------

export interface Alley {
  /** Bearing where it leaves the stripe's pit-side street, and where it
   *  meets the far one (the difference is its skew). */
  theta0: number;
  theta1: number;
  halfWidth: number;
  /** Share of the stripe it crosses: 1 runs through; less stops halfway
   *  (a dead end), entering from the pit side unless fromOuter. */
  reach: number;
  fromOuter: boolean;
  /** Laid for a stair lane or an avenue (never a dead end). */
  forced: boolean;
  /** The block after this alley (to the next through alley) is a plaza. */
  plazaAfter: boolean;
}

export interface Stripe {
  level: number;
  index: number;
  /** Ring street on each side; null on the band's own edge. */
  inner: RingStreet | null;
  outer: RingStreet | null;
  /** Sorted by theta0, all within one turn from the first. */
  alleys: Alley[];
}

/** The street edge on a stripe's pit side at theta (where its lots front). */
export function stripeInnerEdge(st: Stripe, theta: number): number {
  return st.inner ? ringRadius(st.inner, theta) + st.inner.halfWidth : bandInner(st.level, theta);
}

/** The street edge (or wall foot) on a stripe's far side at theta. */
export function stripeOuterEdge(st: Stripe, theta: number): number {
  return st.outer ? ringRadius(st.outer, theta) - st.outer.halfWidth : bandOuter(st.level, theta);
}

/** An alley's bearing at radius r inside its stripe. */
export function alleyThetaAt(st: Stripe, a: Alley, r: number): number {
  const rA = stripeInnerEdge(st, a.theta0);
  const rB = stripeOuterEdge(st, a.theta0);
  const t = Math.min(1, Math.max(0, (r - rA) / Math.max(1, rB - rA)));
  return a.theta0 + (a.theta1 - a.theta0) * t;
}

/** Whether an alley covers depth share t (0 pit side, 1 far side). */
export function alleyCovers(a: Alley, t: number): boolean {
  if (a.reach >= 1) return true;
  return a.fromOuter ? t >= 1 - a.reach : t <= a.reach;
}

interface Forced {
  theta0: number;
  theta1: number;
  halfWidth: number;
}

/** Alleys a stripe must have: the stair lanes through the wall behind it and
 *  from the wall below, and the avenues (bearing at each edge). */
function forcedAlleys(st: Stripe): Forced[] {
  const out: Forced[] = [];
  const lanes = [...laneAngles(st.level), ...(st.level > 0 ? laneAngles(st.level - 1) : [])];
  for (const a of lanes) {
    out.push({ theta0: fromGate(a), theta1: fromGate(a), halfWidth: LANE_HALF_WIDTH + 2.2 });
  }
  for (let i = 0; i < CITY_AVENUE_COUNT; i++) {
    const a0 = fromGate(avenueAngleAt(i, 1000));
    const rA = stripeInnerEdge(st, a0);
    const rB = stripeOuterEdge(st, a0);
    const t0 = fromGate(avenueAngleAt(i, rA));
    let t1 = avenueAngleAt(i, rB);
    t1 = t0 + (t1 - t0 - TAU * Math.round((t1 - t0) / TAU));
    out.push({
      theta0: t0,
      theta1: t1,
      halfWidth: avenueHalfWidth(i) + AVENUE_BLEND * 0.5 + 1,
    });
  }
  return out.sort((p, q) => p.theta0 - q.theta0);
}

function buildStripe(level: number, index: number, rings: RingStreet[]): Stripe {
  const st: Stripe = {
    level,
    index,
    inner: index > 0 ? rings[index - 1] : null,
    outer: index < rings.length ? rings[index] : null,
    alleys: [],
  };
  const forced = forcedAlleys(st);
  const seed = level * 4099 + index * 257;
  const mid = (theta: number) => (stripeInnerEdge(st, theta) + stripeOuterEdge(st, theta)) / 2;
  // random alleys, marched around the ring with the local district's grain
  const free: Alley[] = [];
  let theta = SOUTH_GATE_ANGLE + rand(seed, 1) * 0.02;
  for (let i = 0; i < 2000; i++) {
    const r = mid(theta);
    const grain = STREET_GRAIN[districtAt(r, theta)];
    theta += (grain.spacingMin + rand(seed + i, 2) * (grain.spacingMax - grain.spacingMin)) / r;
    if (theta >= SOUTH_GATE_ANGLE + TAU - grain.spacingMin / r) break;
    // keep clear of the forced alleys: they already cut the block there
    const near = forced.some((f) => Math.abs(f.theta0 - theta) * r < grain.spacingMin * 0.6);
    if (near) continue;
    const dead = rand(seed + i, 3) < grain.deadEnd;
    free.push({
      theta0: theta,
      theta1: theta + ((rand(seed + i, 4) - 0.5) * 2 * grain.skew) / r,
      halfWidth: grain.halfMin + rand(seed + i, 5) * (grain.halfMax - grain.halfMin),
      reach: dead ? 0.45 + rand(seed + i, 6) * 0.2 : 1,
      fromOuter: rand(seed + i, 7) < 0.5,
      forced: false,
      plazaAfter: false,
    });
  }
  const all: Alley[] = [
    ...free,
    ...forced.map((f) => ({
      ...f,
      reach: 1,
      fromOuter: false,
      forced: true,
      plazaAfter: false,
    })),
  ].sort((p, q) => p.theta0 - q.theta0);
  // plazas: a block between two through alleys, deep and wide enough, kept
  // open; its dead ends go (they would cut into the square)
  const through = all.filter((a) => a.reach >= 1);
  const keep = new Set<Alley>(all);
  through.forEach((a, j) => {
    const b = through[(j + 1) % through.length];
    const end = j + 1 < through.length ? b.theta0 : b.theta0 + TAU;
    const tm = (a.theta0 + end) / 2;
    const r = mid(tm);
    const arc = (end - a.theta0) * r - a.halfWidth - b.halfWidth;
    const depth = stripeOuterEdge(st, tm) - stripeInnerEdge(st, tm);
    if (arc < 16 || arc > 72 || depth < 20) return;
    // the rim level keeps its plazas off the ring road side: the rim walk
    // already is its great square
    const grain = STREET_GRAIN[districtAt(r, tm)];
    const byAvenue = (a.forced && a.halfWidth > 6) || (b.forced && b.halfWidth > 6);
    const chance = byAvenue ? AVENUE_PLAZA : grain.plaza;
    if (rand(seed + j, 9) >= chance) return;
    a.plazaAfter = true;
    for (const d of all) {
      // unwrapped past a, so a block that runs past the gate clears too
      const t = d.theta0 < a.theta0 ? d.theta0 + TAU : d.theta0;
      if (d.reach < 1 && t > a.theta0 && t < end) keep.delete(d);
    }
  });
  st.alleys = all.filter((a) => keep.has(a));
  return st;
}

export interface LevelStreets {
  level: number;
  rings: RingStreet[];
  stripes: Stripe[];
}

const LEVELS: readonly LevelStreets[] = Array.from({ length: CITY_WALLS }, (_, level) => {
  const rings = ringStreets(level);
  const stripes = Array.from({ length: rings.length + 1 }, (_, i) => buildStripe(level, i, rings));
  return { level, rings, stripes };
});

/** The street network of one terrace. */
export function levelStreets(level: number): LevelStreets {
  return LEVELS[level];
}

/** A block between two consecutive through alleys of a stripe. */
export interface CityBlock {
  stripe: Stripe;
  /** The through alleys that bound it (b may be the stripe's first). */
  a: Alley;
  b: Alley;
  /** b's theta0 unwrapped past a's. */
  end0: number;
  end1: number;
  plaza: boolean;
}

/** Every block of a terrace, stripe by stripe. */
export function levelBlocks(level: number): CityBlock[] {
  const out: CityBlock[] = [];
  for (const st of LEVELS[level].stripes) {
    const through = st.alleys.filter((a) => a.reach >= 1);
    through.forEach((a, j) => {
      const b = through[(j + 1) % through.length];
      const wrap = j + 1 < through.length ? 0 : TAU;
      out.push({
        stripe: st,
        a,
        b,
        end0: b.theta0 + wrap,
        end1: b.theta1 + wrap,
        plaza: a.plazaAfter,
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The paint query
// ---------------------------------------------------------------------------

/** Street (cobbles), plaza (paving) or neither at LOCAL (x, z). Only the
 *  terraces' own streets: the avenues and stair lanes are cityGround's. */
export function cityStreetAt(x: number, z: number): 'street' | 'plaza' | null {
  const r = Math.hypot(x, z);
  const theta = Math.atan2(z, x);
  const level = levelAt(r, theta);
  if (level < 0 || level >= CITY_WALLS) return null;
  if (r < bandInner(level, theta) || r > bandOuter(level, theta)) return null;
  const lv = LEVELS[level];
  let stripe = lv.stripes[lv.stripes.length - 1];
  for (let i = 0; i < lv.rings.length; i++) {
    const rr = ringRadius(lv.rings[i], theta);
    if (Math.abs(r - rr) < lv.rings[i].halfWidth) return 'street';
    if (r < rr) {
      stripe = lv.stripes[i];
      break;
    }
  }
  const t0 = fromGate(theta);
  const rA = stripeInnerEdge(stripe, t0);
  const rB = stripeOuterEdge(stripe, t0);
  const depthT = (r - rA) / Math.max(1, rB - rA);
  // the alley at or before this bearing, found by bisection on theta0
  const al = stripe.alleys;
  let lo = 0;
  let hi = al.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (al[m].theta0 <= t0) lo = m;
    else hi = m - 1;
  }
  // the alleys around it can lean across this bearing: test a few each way
  let before: Alley | null = null;
  let beforeTheta = Number.NEGATIVE_INFINITY;
  for (let k = -3; k <= 3; k++) {
    const idx = lo + k;
    const wrap = idx < 0 ? -TAU : idx >= al.length ? TAU : 0;
    const a = al[((idx % al.length) + al.length) % al.length];
    if (!a) continue;
    const at = alleyThetaAt(stripe, a, r) + wrap;
    if (alleyCovers(a, depthT) && Math.abs(at - t0) * r < a.halfWidth) return 'street';
    if (a.reach >= 1 && at <= t0 && at > beforeTheta) {
      before = a;
      beforeTheta = at;
    }
  }
  return before?.plazaAfter ? 'plaza' : null;
}
