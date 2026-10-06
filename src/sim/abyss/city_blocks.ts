// Rimholt's built blocks on its terraces: rows of houses lined up along the
// terrace walls district by district, garden plots, small plazas where the
// avenues cross the terraces, and a stone parapet along the top of every
// wall. Laid out on the street plan (city_plan.ts).
//
// The look the art guide asks for (project design notes, "guia-referencias",
// section 3, and the owner's brief of 2026-10-05): a dense, warm stone town
// that is organic and a little irregular but plainly built by people. So:
//
// - houses stand in ROWS that follow the straight runs of the terrace walls
//   (their fronts turn with each run, so a row bends at every corner of the
//   wall it follows), never on perfect circles;
// - each house takes its own width and gap, with an alley every few houses,
//   and the row count on a terrace grows and shrinks with its depth;
// - the districts differ: the crowded south, the workshops of the east, the
//   towers and halls of the north, the gardens and windmills of the west;
// - every house front faces the pit, so the whole city reads as tiers of
//   facades around the opening, the way the reference town does.
//
// Pure functions of fixed constants (hash2 with a fixed salt, no world seed,
// no Rng): placements are content, identical on every host and every boot.

import { hash2 } from '../rng';
import type { ZonePropsDef } from '../types';
import {
  AVENUE_BLEND,
  avenueAngleAt,
  avenueHalfWidth,
  CITY_AVENUE_COUNT,
  CITY_WALLS,
  type CityDistrict,
  districtAt,
  isGardenPlot,
  LANE_HALF_WIDTH,
  LANE_RUN,
  laneAngles,
  NORTH_AVENUE,
  nearestAvenue,
  SOUTH_GATE_ANGLE,
  WALL_FACE_RUN,
  wallCorners,
  wallRadiusAt,
  wallRunDirection,
} from './city_plan';
import { ABYSS_CENTER, PIT_RADIUS } from './geometry';
import { RIM_GRAVEYARD } from './regions';
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
// Building kits per district
// ---------------------------------------------------------------------------

/** A building with its hex-kit scale, collider radius and height (the same
 *  measured values the built-in towns use), and its width along a row. */
interface Kind {
  key: string;
  scale: number;
  r: number;
  h: number;
}

const HOME_RED: readonly Kind[] = [
  { key: 'hexrHomeA', scale: 7.5, r: 5.2, h: 11 },
  { key: 'hexrHomeB', scale: 7.5, r: 5.2, h: 11 },
];
const HOME_PLAIN: readonly Kind[] = [
  { key: 'hexHomeA', scale: 7.5, r: 5.2, h: 11 },
  { key: 'hexHomeB', scale: 7.5, r: 5.2, h: 11 },
];
const HOME_BLUE: readonly Kind[] = [
  { key: 'hexbHomeA', scale: 7.5, r: 5.2, h: 11 },
  { key: 'hexbHomeB', scale: 7.5, r: 5.2, h: 11 },
];
const TAVERN: readonly Kind[] = [
  { key: 'hexrTavern', scale: 7.5, r: 5.6, h: 11 },
  { key: 'hexbTavern', scale: 7.5, r: 5.5, h: 11 },
];
const TOWER: readonly Kind[] = [
  { key: 'hexTower', scale: 8, r: 4, h: 17 },
  { key: 'hexrTowerA', scale: 8, r: 4, h: 17 },
  { key: 'hexbTowerA', scale: 8, r: 4.5, h: 18 },
];
const CHURCH: readonly Kind[] = [{ key: 'hexrChurch', scale: 8, r: 5.6, h: 15 }];
const HALL: readonly Kind[] = [
  { key: 'hexrTownhall', scale: 8, r: 6.5, h: 15 },
  { key: 'hexbTownhall', scale: 8, r: 6.5, h: 15 },
];
const WORKSHOP: readonly Kind[] = [
  { key: 'hexbWorkshop', scale: 7, r: 6, h: 8 },
  { key: 'hexBlacksmith', scale: 7.5, r: 5.6, h: 10 },
  { key: 'hexrBlacksmith', scale: 7.5, r: 5.6, h: 10 },
];
const MARKET: readonly Kind[] = [
  { key: 'hexrMarket', scale: 6, r: 4.5, h: 7 },
  { key: 'hexMarket', scale: 6, r: 4.5, h: 7 },
];
const STABLES: readonly Kind[] = [
  { key: 'hexrStables', scale: 7, r: 5.5, h: 9 },
  { key: 'hexbStables', scale: 7, r: 5.5, h: 9 },
];
const WINDMILL: readonly Kind[] = [
  { key: 'hexrWindmill', scale: 7, r: 4, h: 12 },
  { key: 'hexWindmill', scale: 9, r: 5, h: 13 },
];

/** How one district builds: its mix of buildings (weights), how big its
 *  houses run, how tight its rows are, and how much of a row it fills. */
interface DistrictStyle {
  mix: readonly (readonly [readonly Kind[], number])[];
  /** Multiplier on every kit scale (the poor south builds small). */
  size: number;
  /** Gap range between neighbours in a row, and the chance of an alley. */
  gapMin: number;
  gapMax: number;
  alley: number;
  /** Share of row slots built on (the rest stay yards and alleys). */
  fill: number;
}

const STYLES: Record<CityDistrict, DistrictStyle> = {
  // the rim ring: the oldest, busiest streets, inns and markets
  centre: {
    mix: [
      [HOME_RED, 0.42],
      [HOME_PLAIN, 0.18],
      [TAVERN, 0.12],
      [MARKET, 0.12],
      [TOWER, 0.08],
      [CHURCH, 0.015],
      [HALL, 0.04],
    ],
    size: 1.05,
    gapMin: 0.8,
    gapMax: 2.5,
    alley: 0.14,
    fill: 0.96,
  },
  // the poor south: small houses packed wall to wall, crooked alleys
  south: {
    mix: [
      [HOME_RED, 0.5],
      [HOME_PLAIN, 0.36],
      [TAVERN, 0.05],
      [MARKET, 0.05],
      [TOWER, 0.04],
    ],
    size: 0.88,
    gapMin: 0.2,
    gapMax: 1.4,
    alley: 0.24,
    fill: 0.97,
  },
  // the east: workshops, smithies, stables and the crafts that feed the pit
  east: {
    mix: [
      [HOME_RED, 0.34],
      [HOME_PLAIN, 0.18],
      [WORKSHOP, 0.24],
      [STABLES, 0.07],
      [HOME_BLUE, 0.06],
      [TAVERN, 0.05],
      [TOWER, 0.06],
    ],
    size: 1,
    gapMin: 1,
    gapMax: 3.5,
    alley: 0.16,
    fill: 0.9,
  },
  // the north: the explorers' quarter and the well-off, halls and towers
  north: {
    mix: [
      [HOME_RED, 0.36],
      [HOME_BLUE, 0.16],
      [HOME_PLAIN, 0.1],
      [TOWER, 0.14],
      [CHURCH, 0.025],
      [HALL, 0.08],
      [TAVERN, 0.09],
    ],
    size: 1.1,
    gapMin: 2,
    gapMax: 5,
    alley: 0.12,
    fill: 0.88,
  },
  // the west: market gardens, orchards and windmills between the houses
  west: {
    mix: [
      [HOME_RED, 0.44],
      [HOME_PLAIN, 0.22],
      [WINDMILL, 0.14],
      [STABLES, 0.08],
      [TAVERN, 0.05],
      [TOWER, 0.07],
    ],
    size: 1,
    gapMin: 3,
    gapMax: 8,
    alley: 0.18,
    fill: 0.74,
  },
};

function pickKind(style: DistrictStyle, roll: number, sub: number): Kind {
  let total = 0;
  for (const [, w] of style.mix) total += w;
  let acc = 0;
  for (const [kinds, w] of style.mix) {
    acc += w / total;
    if (roll < acc) return kinds[Math.floor(sub * kinds.length) % kinds.length];
  }
  const last = style.mix[style.mix.length - 1][0];
  return last[Math.floor(sub * last.length) % last.length];
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** Clear yards kept at the top of each wall (the parapet walk) and along
 *  each wall's foot, and the pitch between rows (a house, then a yard or a
 *  street before the next row). */
const PROMENADE = 7;
const WALL_FOOT_GAP = 2;
const ROW_PITCH = 26;
/** Every kit is built up from the built-in towns' scale: a terrace city
 *  reads as packed tall facades, and at the towns' scale its rows looked
 *  like scattered cottages on a wide paved yard. */
const KIT_SCALE = 1.7;
/** Half the depth a row's houses take (the largest kit, scaled up). */
const ROW_HALF_DEPTH = 10;
/** Clearance kept around a plaza's centre. */
const PLAZA_CLEAR = 16;
/** The open walk along the pit edge, measured from the edge: the
 *  watchtowers, cranes and lookout decks stand in it. */
const RIM_PROMENADE = 48;
/** The rim ring road's radius and half width (city_layout lays it). */
export const RIM_RING_RADIUS = PIT_RADIUS + 115;
const RIM_RING_CLEAR = 9;

/** Open ground the rim landmarks stand on (city_layout places them): the
 *  explorers' hall, the market by the descent arch, and the graveyard. */
const RIM_KEEP_CLEAR: readonly { x: number; z: number; r: number }[] = (() => {
  const north = avenueAngleAt(NORTH_AVENUE, PIT_RADIUS);
  const atR = (r: number, a: number) => ({ x: Math.cos(a) * r, z: Math.sin(a) * r });
  const out = [{ ...atR(PIT_RADIUS + 60, north), r: 40 }];
  for (let i = 0; i < 10; i += 3) {
    out.push({ ...atR(PIT_RADIUS + 81, SPIRAL_START_ANGLE - 0.12 - i * 0.022), r: 26 });
  }
  out.push({ x: RIM_GRAVEYARD.x - cx, z: RIM_GRAVEYARD.z - cz, r: 45 });
  return out;
})();

function onRimLandmark(x: number, z: number, reach: number): boolean {
  for (const k of RIM_KEEP_CLEAR) {
    if (Math.hypot(x - k.x, z - k.z) < k.r + reach) return true;
  }
  return false;
}

interface Row {
  level: number;
  /** The wall the row follows, and its signed offset from that wall's face
   *  (positive: further from the pit). */
  wall: number;
  offset: number;
  id: number;
}

/** Offset of the row that stands against a wall's foot (negative: toward
 *  the pit from the wall it follows). */
const BACK_ROW = -(WALL_FACE_RUN + WALL_FOOT_GAP + ROW_HALF_DEPTH);

/** The rows of a level: one against the foot of the wall behind it, and
 *  rows stepping out from the wall below (behind the parapet walk) as far as
 *  the level's deepest stretch allows; where the level narrows, the rows
 *  measured from the wall below thin out against the back row (rowProps).
 *  The rim plaza (level 0) builds only against its wall: its front is the
 *  open promenade along the edge. */
function levelRows(level: number, maxDepth: number): Row[] {
  const rows: Row[] = [{ level, wall: level, offset: BACK_ROW, id: 0 }];
  if (level === 0) {
    // the rim level builds from its wall in toward the pit, up to the
    // promenade along the edge (rowProps keeps that and the ring road open)
    for (let off = BACK_ROW - ROW_PITCH; off > -maxDepth + RIM_PROMENADE; off -= ROW_PITCH) {
      rows.push({ level, wall: 0, offset: off, id: rows.length });
    }
    return rows;
  }
  const backRoom = -BACK_ROW + ROW_HALF_DEPTH * 2 + 6;
  for (let off = PROMENADE + ROW_HALF_DEPTH; off < maxDepth - backRoom; off += ROW_PITCH) {
    rows.push({ level, wall: level - 1, offset: off, id: rows.length });
  }
  return rows;
}

/** A row's radius at angle theta (local polar). */
function rowRadius(row: Row, theta: number): number {
  return wallRadiusAt(row.wall, theta) + row.offset;
}

/** Yaw that turns a model's +z front toward the pit, square to the wall run
 *  the row follows (so the row turns at each corner of its wall). */
function rowFacing(row: Row, theta: number): number {
  const d = wallRunDirection(row.wall, theta);
  return Math.atan2(-d.z, d.x);
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

/** Where a level's plazas stand: one on each avenue, on the level's ring
 *  street, to the side of the avenue that hash picks. Rim plaza excluded. */
interface Plaza {
  x: number;
  z: number;
  /** Yaw facing the avenue. */
  rot: number;
}

function plazasOf(level: number): Plaza[] {
  if (level === 0 || level >= CITY_WALLS) return [];
  const out: Plaza[] = [];
  for (let i = 0; i < CITY_AVENUE_COUNT; i++) {
    // every avenue gets a plaza on every other level, alternating
    if ((i + level) % 2 === 1) continue;
    const a0 = avenueAngleAt(i, 1000);
    const inner = wallRadiusAt(level - 1, a0);
    const outer = wallRadiusAt(level, a0) - WALL_FACE_RUN;
    const r = (inner + outer) / 2;
    const a = avenueAngleAt(i, r);
    const side = rand(i, level + 40) < 0.5 ? -1 : 1;
    const off = avenueHalfWidth(i) + 9;
    const tx = -Math.sin(a) * side;
    const tz = Math.cos(a) * side;
    out.push({
      x: Math.cos(a) * r + tx * off,
      z: Math.sin(a) * r + tz * off,
      rot: Math.atan2(-tx, -tz),
    });
  }
  return out;
}

const PLAZAS: readonly Plaza[] = Array.from({ length: CITY_WALLS }, (_, k) => plazasOf(k)).flat();

function nearPlaza(x: number, z: number, clear: number): boolean {
  for (const p of PLAZAS) {
    if (Math.hypot(x - p.x, z - p.z) < clear) return true;
  }
  return false;
}

/** Everything a row slot can become: a building, a garden piece, or nothing. */
function rowProps(row: Row, out: DecorProp[]): void {
  const r0 = rowRadius(row, SOUTH_GATE_ANGLE + 0.001);
  // lanes to keep clear: the ones climbing the wall behind the row (their
  // ramps run LANE_RUN yards out from that wall) and the ones arriving from
  // the wall below (their tops open onto this level's front)
  const lanesBehind = row.level < CITY_WALLS ? laneAngles(row.level) : [];
  const lanesBelow = row.level > 0 ? laneAngles(row.level - 1) : [];
  let theta = SOUTH_GATE_ANGLE + (rand(row.level * 17 + row.id, 1) * 12) / r0;
  const end = SOUTH_GATE_ANGLE + TAU;
  for (let i = 0; theta < end; i++) {
    const r = rowRadius(row, theta);
    const district = districtAt(r, theta);
    const style = STYLES[district];
    const seed = row.level * 1009 + row.id * 101;
    const kind = pickKind(style, rand(seed + i, 2), rand(seed + i, 3));
    const size = KIT_SCALE * style.size * (0.94 + rand(seed + i, 4) * 0.12);
    const width = kind.r * 2 * size;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    const reach = kind.r * size;
    const hit = nearestAvenue(x, z);
    const clearOfAvenue = hit.distance > avenueHalfWidth(hit.index) + AVENUE_BLEND * 0.5 + reach;
    const behindWall = wallRadiusAt(row.level, theta);
    const nearBack = behindWall - r < LANE_RUN + reach + 2;
    // a row stepped out from the wall below stops short of the back row
    const roomy = row.wall === row.level || r + reach + 4 < behindWall + BACK_ROW - ROW_HALF_DEPTH;
    const clearOfLanes =
      (!nearBack || arcDistance(lanesBehind, r, theta) > LANE_HALF_WIDTH + reach + 1.5) &&
      arcDistance(lanesBelow, r, theta) > LANE_HALF_WIDTH + reach + 3;
    const clearOfRim =
      row.level > 0 ||
      (r - reach > PIT_RADIUS + RIM_PROMENADE &&
        Math.abs(r - RIM_RING_RADIUS) > RIM_RING_CLEAR + reach &&
        !onRimLandmark(x, z, reach));
    if (
      roomy &&
      clearOfAvenue &&
      clearOfLanes &&
      clearOfRim &&
      !nearPlaza(x, z, PLAZA_CLEAR + reach)
    ) {
      if (row.level > 0 && isGardenPlot(x, z)) {
        gardenPiece(x, z, seed + i, out);
      } else if (rand(seed + i, 5) < style.fill) {
        out.push({
          key: kind.key,
          x: cx + x,
          z: cz + z,
          rot: rowFacing(row, theta) + (rand(seed + i, 6) - 0.5) * 0.16,
          scale: kind.scale * size,
          r: kind.r * size,
          h: kind.h * size,
        });
      }
    }
    const alley = rand(seed + i, 7) < style.alley ? 5 + rand(seed + i, 8) * 5 : 0;
    const gap = style.gapMin + rand(seed + i, 9) * (style.gapMax - style.gapMin) + alley;
    theta += (width + gap) / Math.max(r, 1);
  }
}

/** One slot of a garden plot: an orchard tree, a flower bed, or a shrub. */
function gardenPiece(x: number, z: number, seed: number, out: DecorProp[]): void {
  const roll = rand(seed, 11);
  const rot = rand(seed, 12) * TAU;
  if (roll < 0.5) {
    const s = 1.1 + rand(seed, 13) * 0.45;
    out.push({ key: 'oakTree', x: cx + x, z: cz + z, rot, scale: s, r: 0.8, h: 9 * s });
  } else if (roll < 0.7) {
    const key = ['flowerBedRound', 'flowerBedSquareA', 'flowerBedSquareB'][
      Math.floor(rand(seed, 14) * 3) % 3
    ];
    out.push({ key, x: cx + x, z: cz + z, rot, scale: 5.5, r: 2.6, h: 2.5 });
  } else if (roll < 0.85) {
    out.push({ key: 'shrubFlowering', x: cx + x, z: cz + z, rot, scale: 1.4 });
  }
}

/** Rows of houses and gardens on every level of the city. */
export function cityBlockProps(): DecorProp[] {
  const out: DecorProp[] = [];
  for (let level = 0; level < CITY_WALLS; level++) {
    // a level's depth varies around the city: plan rows for its deepest
    // stretch and let the narrower stretches drop the rows that do not fit
    let maxDepth = 0;
    for (let s = 0; s < 96; s++) {
      const t = SOUTH_GATE_ANGLE + (s / 96) * TAU;
      const inner = level === 0 ? PIT_RADIUS : wallRadiusAt(level - 1, t);
      maxDepth = Math.max(maxDepth, wallRadiusAt(level, t) - inner);
    }
    for (const row of levelRows(level, maxDepth)) rowProps(row, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plazas
// ---------------------------------------------------------------------------

/** Each plaza: a well with market stalls facing the avenue. */
export function cityPlazas(): { wells: Well[]; stalls: Stall[] } {
  const wells: Well[] = [];
  const stalls: Stall[] = [];
  PLAZAS.forEach((p, n) => {
    wells.push({ x: cx + p.x, z: cz + p.z, r: 1.5 });
    // two stalls flanking the well, along the avenue
    const ax = Math.cos(p.rot);
    const az = -Math.sin(p.rot);
    for (const s of [-1, 1]) {
      if (rand(n, 60 + s) < 0.25) continue;
      stalls.push({
        x: cx + p.x + ax * s * 7 + Math.sin(p.rot) * 2,
        z: cz + p.z + az * s * 7 + Math.cos(p.rot) * 2,
        rot: p.rot + (rand(n, 62 + s) - 0.5) * 0.3,
        r: 1.6,
      });
    }
  });
  return { wells, stalls };
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

/** Ring streets along the middle of every other level (streetlamps follow
 *  the road network), as world polylines. */
export function cityRingStreets(): { x: number; z: number }[][] {
  const out: { x: number; z: number }[][] = [];
  for (const level of [1, 3, 5]) {
    const line: { x: number; z: number }[] = [];
    const segs = 240;
    for (let s = 0; s <= segs; s++) {
      const t = SOUTH_GATE_ANGLE + (s / segs) * TAU;
      const r = (wallRadiusAt(level - 1, t) + wallRadiusAt(level, t) - WALL_FACE_RUN) / 2;
      line.push({ x: cx + Math.cos(t) * r, z: cz + Math.sin(t) * r });
    }
    out.push(line);
  }
  return out;
}
