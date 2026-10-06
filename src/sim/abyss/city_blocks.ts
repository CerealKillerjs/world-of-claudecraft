// Rimholt's built blocks: lots of houses lined up along every street of the
// terrace street network (city_streets.ts), district by district, with
// courtyards behind them, garden plots left green, plazas furnished, and a
// stone parapet along the top of every wall.
//
// The look the art guide asks for (project design notes, "guia-referencias",
// section 3, and the owner's briefs of 2026-10-05 and 2026-10-06): a dense,
// warm stone town that is organic and a little irregular but plainly built
// by people, with no two streets alike. So:
//
// - every block is two rows of attached houses back to back, each row
//   fronting its own street (the row against a terrace wall stands taller
//   and looks out over the roofs below), with a courtyard between them when
//   the block is deep enough;
// - each lot takes its own width, depth and setback, so fronts are nearly
//   aligned but the backs and the rooflines are ragged;
// - the districts build differently: the poor south in narrow lots of
//   shacks and small houses, the east in wide lots of workshops with yards,
//   the north in tall plastered houses with towers, the west in detached
//   cottages among gardens, and the rim ring in old civic stone with halls.
//
// The houses are procedural (city_buildings.ts gives their form, the
// renderer builds them); every one collides as its own box.
//
// Pure functions of fixed constants (hash2 with a fixed salt, no world seed,
// no Rng): placements are content, identical on every host and every boot.

import { hash2 } from '../rng';
import type { ZonePropsDef } from '../types';
import { type RimholtBuildingKind, rimholtBuildingForm } from './city_buildings';
import {
  AVENUE_BLEND,
  avenueAngleAt,
  avenueHalfWidth,
  CITY_WALLS,
  type CityDistrict,
  cityGround,
  districtAt,
  isGardenPlot,
  LANE_HALF_WIDTH,
  laneAngles,
  NORTH_AVENUE,
  nearestAvenue,
  wallCorners,
} from './city_plan';
import {
  alleyCovers,
  alleyThetaAt,
  type CityBlock,
  cityStreetAt,
  levelBlocks,
  levelStreets,
  ringRadius,
  type Stripe,
  stripeInnerEdge,
  stripeOuterEdge,
} from './city_streets';
import { ABYSS_CENTER, PIT_RADIUS } from './geometry';
import { ABYSS_PLAYER_START, RIM_GRAVEYARD } from './regions';
import { SPIRAL_START_ANGLE } from './terrain';

type DecorProp = NonNullable<ZonePropsDef['decorProps']>[number];
type Fence = ZonePropsDef['fences'][number];
type Well = ZonePropsDef['wells'][number];
type Stall = ZonePropsDef['stalls'][number];

const TAU = Math.PI * 2;
const cx = ABYSS_CENTER.x;
const cz = ABYSS_CENTER.z;
const SALT = 0x7b10;

function rand(a: number, b: number): number {
  return hash2(a, b, SALT);
}

// ---------------------------------------------------------------------------
// Lot grain per district
// ---------------------------------------------------------------------------

interface LotGrain {
  /** Lot width along the street, and depth into the block, yards. */
  widthMin: number;
  widthMax: number;
  depthMin: number;
  depthMax: number;
  /** Gap between neighbours, and the chance of a walkable passage. */
  gapMin: number;
  gapMax: number;
  passage: number;
  /** How far a front may stand back from its street. */
  setbackMax: number;
  /** Least courtyard kept between two back-to-back rows. */
  courtyard: number;
  /** Chances a lot holds something other than an ordinary house. */
  kinds: readonly (readonly [RimholtBuildingKind, number])[];
}

export const LOT_GRAIN: Readonly<Record<CityDistrict, LotGrain>> = {
  centre: {
    widthMin: 7,
    widthMax: 12,
    depthMin: 11,
    depthMax: 15,
    gapMin: 0,
    gapMax: 0.25,
    passage: 0.07,
    setbackMax: 0.5,
    courtyard: 4,
    kinds: [
      ['rimTower', 0.05],
      ['rimHall', 0.05],
    ],
  },
  south: {
    widthMin: 4.5,
    widthMax: 7.5,
    depthMin: 8,
    depthMax: 11,
    gapMin: 0,
    gapMax: 0.2,
    passage: 0.04,
    setbackMax: 0.8,
    courtyard: 2,
    kinds: [
      ['rimTower', 0.015],
      ['rimShack', 0.35],
    ],
  },
  east: {
    widthMin: 9,
    widthMax: 16,
    depthMin: 12,
    depthMax: 18,
    gapMin: 0.5,
    gapMax: 3.5,
    passage: 0.08,
    setbackMax: 2,
    courtyard: 6,
    kinds: [
      ['rimTower', 0.02],
      ['rimWorkshop', 0.4],
    ],
  },
  north: {
    widthMin: 9,
    widthMax: 14,
    depthMin: 12,
    depthMax: 16,
    gapMin: 0,
    gapMax: 2.5,
    passage: 0.1,
    setbackMax: 2.5,
    courtyard: 8,
    kinds: [
      ['rimTower', 0.08],
      ['rimHall', 0.05],
    ],
  },
  west: {
    widthMin: 7,
    widthMax: 11,
    depthMin: 9,
    depthMax: 12,
    gapMin: 2,
    gapMax: 6,
    passage: 0,
    setbackMax: 4,
    courtyard: 8,
    kinds: [
      ['rimTower', 0.02],
      ['rimCottage', 0.55],
      ['rimWorkshop', 0.05],
    ],
  },
};

function pickKind(grain: LotGrain, roll: number): RimholtBuildingKind {
  let acc = 0;
  for (const [kind, w] of grain.kinds) {
    acc += w;
    if (roll < acc) return kind;
  }
  return 'rimHouse';
}

// ---------------------------------------------------------------------------
// Keep-clear ground
// ---------------------------------------------------------------------------

/** Open ground the rim landmarks stand on (city_layout places them): the
 *  explorers' hall, the market by the descent arch, the graveyard, and the
 *  spot a new player arrives on. */
const RIM_KEEP_CLEAR: readonly { x: number; z: number; r: number }[] = (() => {
  const north = avenueAngleAt(NORTH_AVENUE, PIT_RADIUS);
  const atR = (r: number, a: number) => ({ x: Math.cos(a) * r, z: Math.sin(a) * r });
  const out = [{ ...atR(PIT_RADIUS + 60, north), r: 40 }];
  for (let i = 0; i < 10; i += 3) {
    out.push({ ...atR(PIT_RADIUS + 81, SPIRAL_START_ANGLE - 0.12 - i * 0.022), r: 26 });
  }
  out.push({ x: RIM_GRAVEYARD.x - cx, z: RIM_GRAVEYARD.z - cz, r: 45 });
  out.push({ x: ABYSS_PLAYER_START.x - cx, z: ABYSS_PLAYER_START.z - cz, r: 16 });
  return out;
})();

function onRimLandmark(x: number, z: number, reach: number): boolean {
  for (const k of RIM_KEEP_CLEAR) {
    if (Math.hypot(x - k.x, z - k.z) < k.r + reach) return true;
  }
  return false;
}

/** Arc distance (yards at radius r) from theta to the nearest of `angles`. */
function arcDistance(angles: readonly number[], r: number, theta: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const a of angles) {
    let d = theta - a;
    d -= TAU * Math.round(d / TAU);
    best = Math.min(best, Math.abs(d) * r);
  }
  return best;
}

/** A building's footprint corners (LOCAL), plus its centre. */
function footprint(
  x: number,
  z: number,
  rot: number,
  hw: number,
  hd: number,
): { x: number; z: number }[] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const out = [{ x, z }];
  for (const [u, v] of [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ]) {
    // three.js yaw: local +x -> (cos, -sin), local +z -> (sin, cos)
    out.push({ x: x + u * c + v * s, z: z - u * s + v * c });
  }
  return out;
}

/** Whether a footprint is clear of the avenues, the wall faces, the stair
 *  lanes (and their ramps), and on the rim level, of the landmarks. */
function footprintClear(level: number, pts: { x: number; z: number }[], reach: number): boolean {
  const lanes = [...laneAngles(level), ...(level > 0 ? laneAngles(level - 1) : [])];
  for (const p of pts) {
    const hit = nearestAvenue(p.x, p.z);
    if (hit.distance < avenueHalfWidth(hit.index) + AVENUE_BLEND * 0.5) return false;
    const g = cityGround(p.x, p.z);
    if (g.face > 0.05) return false;
    const r = Math.hypot(p.x, p.z);
    if (arcDistance(lanes, r, Math.atan2(p.z, p.x)) < LANE_HALF_WIDTH + 2) return false;
  }
  // no corner or edge (pulled in a little) on a street: a dead end or a
  // skewed alley may reach across a row
  const [c, ...k] = pts;
  for (let i = 0; i < 4; i++) {
    const p = k[i];
    const q = k[(i + 1) % 4];
    for (const [px, pz] of [
      [p.x, p.z],
      [(p.x + q.x) / 2, (p.z + q.z) / 2],
    ]) {
      if (cityStreetAt(c.x + (px - c.x) * 0.92, c.z + (pz - c.z) * 0.92) === 'street') return false;
    }
  }
  return level > 0 || !onRimLandmark(c.x, c.z, reach);
}

/** The footprints built so far on one terrace, in a coarse grid, so a lot
 *  never overlaps a house already standing (where streets meander close or
 *  rows meet at a wall corner). */
class Footprints {
  private readonly cells = new Map<
    string,
    { x: number; z: number; rot: number; hw: number; hd: number }[]
  >();

  private static key(x: number, z: number): string {
    return `${Math.floor(x / 24)}:${Math.floor(z / 24)}`;
  }

  /** Record the box and return true, or return false if it would overlap. */
  claim(x: number, z: number, rot: number, hw: number, hd: number): boolean {
    const box = { x, z, rot, hw, hd };
    const cx0 = Math.floor(x / 24);
    const cz0 = Math.floor(z / 24);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const o of this.cells.get(`${cx0 + i}:${cz0 + j}`) ?? []) {
          if (boxesOverlap(box, o, 0.2)) return false;
        }
      }
    }
    const k = Footprints.key(x, z);
    const list = this.cells.get(k);
    if (list) list.push(box);
    else this.cells.set(k, [box]);
    return true;
  }
}

/** Whether two yawed boxes overlap by more than `slack` (separating axes). */
function boxesOverlap(
  a: { x: number; z: number; rot: number; hw: number; hd: number },
  b: { x: number; z: number; rot: number; hw: number; hd: number },
  slack: number,
): boolean {
  const axes = (r: number) => [
    { x: Math.cos(r), z: -Math.sin(r) },
    { x: Math.sin(r), z: Math.cos(r) },
  ];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const ax of [...axes(a.rot), ...axes(b.rot)]) {
    const extent = (o: typeof a) => {
      const [u, v] = axes(o.rot);
      return o.hw * Math.abs(u.x * ax.x + u.z * ax.z) + o.hd * Math.abs(v.x * ax.x + v.z * ax.z);
    };
    const gap = Math.abs(dx * ax.x + dz * ax.z) - extent(a) - extent(b);
    if (gap > -slack) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Rows of lots
// ---------------------------------------------------------------------------

/** A point and the unit normal (toward larger radius) of a stripe edge. */
function edgeFrame(
  edge: (theta: number) => number,
  theta: number,
): { x: number; z: number; nx: number; nz: number } {
  const e = 0.002;
  const r0 = edge(theta - e);
  const r1 = edge(theta + e);
  const tx = Math.cos(theta + e) * r1 - Math.cos(theta - e) * r0;
  const tz = Math.sin(theta + e) * r1 - Math.sin(theta - e) * r0;
  const len = Math.hypot(tx, tz) || 1;
  // the normal turned toward larger radius (counter-clockwise tangent)
  const nx = tz / len;
  const nz = -tx / len;
  const r = edge(theta);
  const x = Math.cos(theta) * r;
  const z = Math.sin(theta) * r;
  const outward = nx * x + nz * z > 0 ? 1 : -1;
  return { x, z, nx: nx * outward, nz: nz * outward };
}

/** The bearing range of a row between two alleys, at depth share t. */
function rowLimits(
  st: Stripe,
  a: { alley: CityBlock['a']; wrap: number },
  b: { alley: CityBlock['a']; wrap: number },
  r: number,
): [number, number] {
  return [
    alleyThetaAt(st, a.alley, r) + a.wrap + a.alley.halfWidth / r,
    alleyThetaAt(st, b.alley, r) + b.wrap - b.alley.halfWidth / r,
  ];
}

interface RowContext {
  st: Stripe;
  block: CityBlock;
  /** Front row (on the pit-side street) or back row (on the far side). */
  front: boolean;
  /** The back row stands against the terrace wall (no street behind). */
  wallBacked: boolean;
  out: DecorProp[];
  seed: number;
  /** Footprints already built on this terrace. */
  placed: Footprints;
}

/** Lay one row of lots between two alleys that reach its street. */
function layRow(
  ctx: RowContext,
  a: { alley: CityBlock['a']; wrap: number },
  b: { alley: CityBlock['a']; wrap: number },
): void {
  const { st, front } = ctx;
  const edge = front
    ? (theta: number) => stripeInnerEdge(st, theta)
    : (theta: number) => stripeOuterEdge(st, theta);
  const level = st.level;
  let theta = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < 400; i++) {
    const seed = ctx.seed + i * 13;
    const from = Number.isFinite(theta) ? theta : a.alley.theta0 + a.wrap;
    const rEdge = edge(from);
    const grain = LOT_GRAIN[districtAt(rEdge, from)];
    // depth the block allows across the lot to come (its narrowest point,
    // where the streets meander closest): back to back, or a single row
    let blockDepth = Number.POSITIVE_INFINITY;
    for (let k = 0; k <= 2; k++) {
      const t = from + (k * grain.widthMax) / 2 / rEdge;
      blockDepth = Math.min(blockDepth, stripeOuterEdge(st, t) - stripeInnerEdge(st, t));
    }
    const twoRows = blockDepth >= grain.depthMin * 2 + grain.courtyard;
    if (!twoRows && !front) return;
    const setback = rand(seed, 6) * grain.setbackMax;
    const cap = (twoRows ? (blockDepth - grain.courtyard) / 2 : blockDepth - 1) - setback;
    let depth = grain.depthMin + rand(seed, 1) * (grain.depthMax - grain.depthMin);
    if (ctx.wallBacked) depth = Math.max(depth, cap * 0.8);
    depth = Math.min(depth, cap);
    if (depth < 4) return;
    // the bearings the row may use, at its street and at its back
    const rBack = front ? rEdge + depth + setback : rEdge - depth - setback;
    const [s0, e0] = rowLimits(st, a, b, rEdge);
    const [s1, e1] = rowLimits(st, a, b, rBack);
    const start = Math.max(s0, s1);
    const end = Math.min(e0, e1);
    if (!Number.isFinite(theta)) theta = start + (rand(seed, 2) * grain.gapMax) / rEdge;
    let kind = pickKind(grain, rand(seed, 3));
    if (ctx.wallBacked && kind !== 'rimTower' && kind !== 'rimHall') kind = 'rimTall';
    let width = grain.widthMin + rand(seed, 4) * (grain.widthMax - grain.widthMin);
    if (kind === 'rimHall') width = 14 + rand(seed, 5) * 8;
    if (kind === 'rimTower') width = Math.min(width, 7 + rand(seed, 5) * 3);
    const room = (end - theta) * rEdge;
    if (room < grain.widthMin * 0.7) return;
    width = Math.min(width, room);
    if (kind === 'rimHall' && width < 12) kind = 'rimHouse';
    const hw = width / 2;
    const hd = kind === 'rimTower' ? Math.min(depth / 2, hw) : depth / 2;
    const mid = theta + hw / rEdge;
    const f = edgeFrame(edge, mid);
    // into the block: outward from the front street, inward from the back
    const into = front ? 1 : -1;
    const x = f.x + f.nx * into * (hd + setback);
    const z = f.z + f.nz * into * (hd + setback);
    // a front faces its street; a row against the wall faces back over the
    // courtyard and the roofs below, toward the pit
    const face = front || ctx.wallBacked ? -1 : 1;
    const rot = Math.atan2(f.nx * face, f.nz * face) + (rand(seed, 7) - 0.5) * 0.05;
    const pts = footprint(x, z, rot, hw, hd);
    const reach = Math.hypot(hw, hd);
    if (footprintClear(level, pts, reach) && ctx.placed.claim(x, z, rot, hw, hd)) {
      if (level >= 2 && isGardenPlot(x, z)) {
        // an orchard lot: a piece every few yards across it
        const c = Math.cos(rot);
        const sn = Math.sin(rot);
        const nu = Math.max(1, Math.round(hw / 3.5));
        const nv = Math.max(1, Math.round(hd / 3.5));
        for (let iu = 0; iu < nu; iu++) {
          for (let iv = 0; iv < nv; iv++) {
            const u = hw * ((2 * iu + 1) / nu - 1) + (rand(seed + iu, 14 + iv) - 0.5) * 1.5;
            const v = hd * ((2 * iv + 1) / nv - 1) + (rand(seed + iv, 15 + iu) - 0.5) * 1.5;
            gardenPiece(x + u * c + v * sn, z - u * sn + v * c, seed + iu * 7 + iv * 3, ctx.out);
          }
        }
      } else {
        const wx = cx + x;
        const wz = cz + z;
        const form = rimholtBuildingForm(kind, wx, wz, hw, hd);
        ctx.out.push({
          key: kind,
          x: wx,
          z: wz,
          rot,
          hw,
          hd,
          r: reach,
          h: form.eave + form.roofRise,
        });
        // now and then a tree in the courtyard behind a front-row house
        if (front && twoRows && rand(seed, 8) < 0.16) {
          const yard = blockDepth - 2 * depth;
          if (yard > 6 && (level > 0 || !onRimLandmark(x, z, reach + yard))) {
            const tx = f.x + f.nx * (2 * hd + yard / 2);
            const tz = f.z + f.nz * (2 * hd + yard / 2);
            const s = 0.8 + rand(seed, 9) * 0.4;
            ctx.out.push({
              key: 'oakTree',
              x: cx + tx,
              z: cz + tz,
              rot: rand(seed, 10) * TAU,
              scale: s,
              r: 0.8,
              h: 9 * s,
            });
          }
        }
      }
    }
    const passage = rand(seed, 11) < grain.passage ? 1.8 + rand(seed, 12) * 0.8 : 0;
    const gap = grain.gapMin + rand(seed, 13) * (grain.gapMax - grain.gapMin) + passage;
    theta += (width + gap) / rEdge;
    if (theta >= end) return;
  }
}

/** One lot of a garden plot: an orchard tree, a flower bed, or a shrub. */
function gardenPiece(x: number, z: number, seed: number, out: DecorProp[]): void {
  const roll = rand(seed, 21);
  const rot = rand(seed, 22) * TAU;
  if (roll < 0.55) {
    const s = 1.1 + rand(seed, 23) * 0.45;
    out.push({ key: 'oakTree', x: cx + x, z: cz + z, rot, scale: s, r: 0.8, h: 9 * s });
  } else if (roll < 0.75) {
    const key = ['flowerBedRound', 'flowerBedSquareA', 'flowerBedSquareB'][
      Math.floor(rand(seed, 24) * 3) % 3
    ];
    out.push({ key, x: cx + x, z: cz + z, rot, scale: 5.5, r: 2.6, h: 2.5 });
  } else if (roll < 0.9) {
    out.push({ key: 'shrubFlowering', x: cx + x, z: cz + z, rot, scale: 1.4 });
  }
}

/** The alleys of a block that reach one of its streets, as row breaks. */
function rowBreaks(block: CityBlock, front: boolean): { alley: CityBlock['a']; wrap: number }[] {
  const st = block.stripe;
  const wrapB = block.end0 - block.b.theta0;
  const out: { alley: CityBlock['a']; wrap: number }[] = [{ alley: block.a, wrap: 0 }];
  for (const al of st.alleys) {
    if (al.reach >= 1) continue;
    let t = al.theta0;
    let wrap = 0;
    if (t < block.a.theta0) {
      t += TAU;
      wrap = TAU;
    }
    if (t <= block.a.theta0 || t >= block.end0) continue;
    if (alleyCovers(al, front ? 0 : 1)) out.push({ alley: al, wrap });
  }
  out.sort((p, q) => p.alley.theta0 + p.wrap - (q.alley.theta0 + q.wrap));
  out.push({ alley: block.b, wrap: wrapB });
  return out;
}

/** Every lot of the city: houses along both streets of every block. */
export function cityBlockProps(): DecorProp[] {
  const out: DecorProp[] = [];
  for (let level = 0; level < CITY_WALLS; level++) {
    const placed = new Footprints();
    levelBlocks(level).forEach((block, n) => {
      if (block.plaza) {
        plazaDressing(block, n, out);
        return;
      }
      const st = block.stripe;
      for (const front of [true, false]) {
        const breaks = rowBreaks(block, front);
        for (let i = 0; i + 1 < breaks.length; i++) {
          layRow(
            {
              st,
              block,
              front,
              wallBacked: !front && st.outer === null,
              out,
              placed,
              seed: level * 1_000_003 + n * 7919 + i * 131 + (front ? 0 : 61),
            },
            breaks[i],
            breaks[i + 1],
          );
        }
      }
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plazas
// ---------------------------------------------------------------------------

/** A plaza's centre (LOCAL), the radius it keeps open, and its district. */
interface PlazaSite {
  x: number;
  z: number;
  r: number;
  district: CityDistrict;
}

function plazaSite(block: CityBlock): PlazaSite {
  const st = block.stripe;
  const t0 = (block.a.theta0 + block.end0) / 2;
  const rA = stripeInnerEdge(st, t0);
  const rB = stripeOuterEdge(st, t0);
  const r = (rA + rB) / 2;
  const arc = (block.end0 - block.a.theta0) * r - block.a.halfWidth - block.b.halfWidth;
  return {
    x: Math.cos(t0) * r,
    z: Math.sin(t0) * r,
    r: Math.min(arc, rB - rA) / 2,
    district: districtAt(r, t0),
  };
}

const PLAZA_SITES: readonly PlazaSite[] = Array.from({ length: CITY_WALLS }, (_, k) =>
  levelBlocks(k)
    .filter((b) => b.plaza && plazaClear(b, plazaSite(b)))
    .map(plazaSite),
).flat();

/** Trees around a plaza's edge (its well and stalls are cityPlazas'). */
/** A plaza on the rim level that would crowd a landmark stays bare ground. */
function plazaClear(block: CityBlock, site: PlazaSite): boolean {
  return block.stripe.level > 0 || !onRimLandmark(site.x, site.z, site.r);
}

function plazaDressing(block: CityBlock, n: number, out: DecorProp[]): void {
  const site = plazaSite(block);
  if (!plazaClear(block, site)) return;
  const trees = site.district === 'south' ? 1 : 2 + Math.floor(rand(n, 30) * 3);
  for (let i = 0; i < trees; i++) {
    const a = rand(n, 31 + i) * TAU;
    const d = site.r * (0.72 + rand(n, 41 + i) * 0.18);
    const s = 0.9 + rand(n, 51 + i) * 0.4;
    out.push({
      key: 'oakTree',
      x: cx + site.x + Math.cos(a) * d,
      z: cz + site.z + Math.sin(a) * d,
      rot: rand(n, 61 + i) * TAU,
      scale: s,
      r: 0.8,
      h: 9 * s,
    });
  }
}

/** Each plaza: a well at its heart and a few market stalls facing it. */
export function cityPlazas(): { wells: Well[]; stalls: Stall[] } {
  const wells: Well[] = [];
  const stalls: Stall[] = [];
  PLAZA_SITES.forEach((p, n) => {
    wells.push({ x: cx + p.x, z: cz + p.z, r: 1.5 });
    const count = p.district === 'centre' || p.district === 'east' ? 3 : 1 + (n % 2);
    for (let i = 0; i < count; i++) {
      const a = rand(n, 70 + i) * TAU;
      const d = Math.min(6, p.r * 0.4);
      stalls.push({
        x: cx + p.x + Math.cos(a) * d,
        z: cz + p.z + Math.sin(a) * d,
        // facing the well
        rot: Math.atan2(-Math.cos(a), -Math.sin(a)),
        r: 1.6,
      });
    }
  });
  return { wells, stalls };
}

/** The main ring street of every terrace (and the others on the rim),
 *  as world polylines: streetlamps follow the road network. */
export function cityRingStreets(): { x: number; z: number }[][] {
  const out: { x: number; z: number }[][] = [];
  for (let level = 1; level < CITY_WALLS; level++) {
    const rings = levelStreets(level).rings;
    const main = rings.reduce((best, s) => (s.halfWidth > best.halfWidth ? s : best), rings[0]);
    const line: { x: number; z: number }[] = [];
    const segs = 240;
    for (let s = 0; s <= segs; s++) {
      const t = (s / segs) * TAU;
      const r = ringRadius(main, t);
      line.push({ x: cx + Math.cos(t) * r, z: cz + Math.sin(t) * r });
    }
    out.push(line);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parapets
// ---------------------------------------------------------------------------

/** How far behind a wall's top edge its parapet runs, and the sampling step
 *  along a run when cutting gaps for lanes and avenues. */
const PARAPET_SETBACK = 1.3;
const PARAPET_STEP = 2.5;

/** A low stone parapet along the top of every terrace wall, run by run (so
 *  it turns at each corner of the wall), open wherever a lane or an avenue
 *  comes up through the wall. */
export function cityParapets(): Fence[] {
  const out: Fence[] = [];
  for (let k = 0; k < CITY_WALLS; k++) {
    const corners = wallCorners(k);
    const lanes = laneAngles(k);
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % corners.length];
      // the run's outward normal (the parapet sits on the upper side)
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1) continue;
      const nx = dz / len;
      const nz = -dx / len;
      const steps = Math.max(1, Math.round(len / PARAPET_STEP));
      let open: { x: number; z: number } | null = null;
      let last: { x: number; z: number } | null = null;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a.x + dx * t + nx * PARAPET_SETBACK;
        const z = a.z + dz * t + nz * PARAPET_SETBACK;
        const r = Math.hypot(x, z);
        const theta = Math.atan2(z, x);
        const hit = nearestAvenue(x, z);
        const blocked =
          hit.distance < avenueHalfWidth(hit.index) + 3 ||
          arcDistance(lanes, r, theta) < LANE_HALF_WIDTH + 1.2;
        if (!blocked) {
          open ??= { x, z };
          last = { x, z };
        }
        if ((blocked || s === steps) && open && last) {
          if (Math.hypot(last.x - open.x, last.z - open.z) > 2) {
            out.push({
              x1: cx + open.x,
              z1: cz + open.z,
              x2: cx + last.x,
              z2: cz + last.z,
              kind: 'stone',
            });
          }
          open = null;
          last = null;
        }
      }
    }
  }
  return out;
}
