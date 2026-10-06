// Rimholt's procedural houses as triangles: the pure half of
// rimholt_buildings.ts. Given a lot (centre, yaw, half extents), the ground
// under it and the form the sim gave it (src/sim/abyss/city_buildings.ts),
// it appends flat-shaded, vertex-coloured triangles: a stone base course, the
// plastered walls, window and door openings on both street faces (shuttered
// on some houses), the roof (gable, gable to the street, hipped, pyramid, lean-to, or flat behind a
// parapet) with its eaves, and a chimney.
//
// Colour is the district's: the art guide's warm sandstone and off-white
// plaster under terracotta tiles (#D9C3A0, #B5532F), with each quarter
// leaning its own way (dusty plaster and weathered timber in the south,
// brick and soot in the east, limewash in the north and west, old stone on
// the rim) and every house jittered a little so no two rows match.
// The roof values sit a little under the guide's terracotta because the
// day's warm key light lifts them on screen; a few slate roofs mark the
// well-off north and the sooty east.
//
// Three-, DOM- and i18n-free, and a pure function of its inputs (hash2 on the
// lot position), so a Vitest drives it directly.

import type { BuildingForm, RimholtBuildingKind } from '../sim/abyss';
import { hash2 } from '../sim/rng';

const SALT = 0x2f9a;

/** Growable output buffers for one cell's houses, indexed and compact:
 *  float positions, normals scaled to signed bytes (x127), colours scaled
 *  to unsigned bytes (x255) in linear space (the renderer's working colour
 *  space, so the painter copies them as is), and triangle indices. */
export interface HouseBuffers {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
}

export function emptyHouseBuffers(): HouseBuffers {
  return { positions: [], normals: [], colors: [], indices: [] };
}

export interface HouseLot {
  kind: RimholtBuildingKind;
  x: number;
  z: number;
  /** Three.js yaw: local +z is the front. */
  rot: number;
  hw: number;
  hd: number;
  /** Lowest and highest ground under the footprint. */
  groundMin: number;
  groundMax: number;
  form: BuildingForm;
}

type Rgb = readonly [number, number, number];

/** An sRGB hex colour in linear components (the sRGB transfer curve). */
function hex(c: number): Rgb {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [lin((c >> 16) & 255), lin((c >> 8) & 255), lin(c & 255)];
}

/** Wall, roof and trim palettes per district. */
interface Palette {
  walls: readonly number[];
  roofs: readonly number[];
  base: number;
  /** Painted shutters, and the share of houses that have them. */
  shutters: readonly number[];
  shuttered: number;
}

const PALETTES: Readonly<Record<BuildingForm['district'], Palette>> = {
  centre: {
    walls: [0xd9c3a0, 0xe3d3b4, 0xc9a46a, 0xede6d6, 0xcfb48a],
    roofs: [0xa4563a, 0x985034, 0xa8644a, 0x8e4a32, 0x9c5e44],
    base: 0x8f8576,
    shutters: [0x6b4a33, 0x5f7f5a, 0x4f6e8a],
    shuttered: 0.35,
  },
  south: {
    walls: [0xcdb892, 0xbfa27a, 0xa88b66, 0xd6c29c, 0xb89870],
    roofs: [0x985034, 0x8e4a32, 0xa26a4e, 0x80503a, 0x8a5a44],
    base: 0x7d7466,
    shutters: [0x5f7f5a, 0x4f6e8a, 0x7a5236, 0x8a7a4a],
    shuttered: 0.35,
  },
  east: {
    walls: [0xa0613f, 0xc8ae86, 0x9a8670, 0xbfa684, 0xb07450, 0xd0bc98],
    roofs: [0x7e4430, 0x8e4a32, 0x6e4232, 0x5e5450],
    base: 0x6f675b,
    shutters: [0x6b4a33, 0x5a4a3a],
    shuttered: 0.15,
  },
  north: {
    walls: [0xf0ebe0, 0xe8dfcc, 0xdccfb6, 0xf2ecdd, 0xe3d3b4],
    roofs: [0xa4563a, 0x7e3e2a, 0x985034, 0x5a5c62],
    base: 0x9a9284,
    shutters: [0x3f5a6e, 0x4a4a4a, 0x5f7f5a],
    shuttered: 0.45,
  },
  west: {
    walls: [0xe9ddc0, 0xdcc9a2, 0xe6d7b0, 0xf2ecdd, 0xd9c3a0],
    roofs: [0xa8644a, 0xa4563a, 0xa66e50, 0x985034],
    base: 0x8f8576,
    shutters: [0x5f7f5a, 0x6e8f6a, 0x4f6e8a],
    shuttered: 0.5,
  },
};

/** Weathered timber for the south's shacks and the workshops' sheds. */
const TIMBER: readonly number[] = [0x7d5f43, 0x8f6e4e, 0x6e5a46];
const WINDOW = hex(0x3b4148);
const DOOR = hex(0x5a3f2a);
const CHIMNEY = hex(0x7f7365);

/** Base course height above the highest ground under the house. */
const BASE_COURSE = 0.8;
/** How far a roof overhangs the walls. */
const EAVE_OVERHANG = 0.4;
/** How far openings stand proud of the wall (no z-fighting). */
const OPENING_PROUD = 0.05;

/** Every surface colour of one house, jittered by its lot. */
interface HouseColours {
  wall: Rgb;
  roof: Rgb;
  base: Rgb;
  /** Shutter paint, or null for bare openings. */
  shutter: Rgb | null;
}

function jitter(c: Rgb, k: number): Rgb {
  return [c[0] * k, c[1] * k, c[2] * k];
}

export function houseColours(lot: HouseLot): HouseColours {
  const roll = (n: number) =>
    hash2(Math.round(lot.x * 8) + n * 7919, Math.round(lot.z * 8) - n * 104729, SALT);
  const pal = PALETTES[lot.form.district];
  const timber = lot.kind === 'rimShack' || (lot.kind === 'rimWorkshop' && roll(1) < 0.4);
  const walls = timber ? TIMBER : pal.walls;
  const wall = hex(walls[Math.floor(roll(2) * walls.length) % walls.length]);
  const roof = hex(pal.roofs[Math.floor(roll(3) * pal.roofs.length) % pal.roofs.length]);
  const shutter =
    !timber && roll(7) < pal.shuttered
      ? hex(pal.shutters[Math.floor(roll(8) * pal.shutters.length) % pal.shutters.length])
      : null;
  return {
    wall: jitter(wall, 0.94 + roll(4) * 0.1),
    roof: jitter(roof, 0.9 + roll(5) * 0.16),
    base: jitter(hex(pal.base), 0.95 + roll(6) * 0.08),
    shutter,
  };
}

// ---------------------------------------------------------------------------
// Emitters
// ---------------------------------------------------------------------------

type V3 = readonly [number, number, number];

/** Push a flat face (3 or 4 corners, counter-clockwise seen from its
 *  front) as shared-normal vertices and its triangles. */
function face(out: HouseBuffers, pts: readonly V3[], col: Rgb): void {
  const [a, b, c] = pts;
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx = Math.round((nx / len) * 127);
  ny = Math.round((ny / len) * 127);
  nz = Math.round((nz / len) * 127);
  const r = Math.round(Math.min(1, col[0]) * 255);
  const g = Math.round(Math.min(1, col[1]) * 255);
  const bl = Math.round(Math.min(1, col[2]) * 255);
  const base = out.positions.length / 3;
  for (const p of pts) {
    out.positions.push(p[0], p[1], p[2]);
    out.normals.push(nx, ny, nz);
    out.colors.push(r, g, bl);
  }
  out.indices.push(base, base + 1, base + 2);
  if (pts.length === 4) out.indices.push(base, base + 2, base + 3);
}

function tri(out: HouseBuffers, a: V3, b: V3, c: V3, col: Rgb): void {
  face(out, [a, b, c], col);
}

/** A quad a-b-c-d, counter-clockwise seen from its front. */
function quad(out: HouseBuffers, a: V3, b: V3, c: V3, d: V3, col: Rgb): void {
  face(out, [a, b, c, d], col);
}

/** Local (u along the street, y up, v toward the front) to world. */
function frame(lot: HouseLot): (u: number, y: number, v: number) => V3 {
  const c = Math.cos(lot.rot);
  const s = Math.sin(lot.rot);
  return (u, y, v) => [lot.x + u * c + v * s, y, lot.z - u * s + v * c];
}

/** A box's four side walls (no top or bottom) between y0 and y1. */
function walls(
  out: HouseBuffers,
  P: (u: number, y: number, v: number) => V3,
  hw: number,
  hd: number,
  y0: number,
  y1: number,
  col: Rgb,
): void {
  quad(out, P(-hw, y0, hd), P(hw, y0, hd), P(hw, y1, hd), P(-hw, y1, hd), col);
  quad(out, P(hw, y0, -hd), P(-hw, y0, -hd), P(-hw, y1, -hd), P(hw, y1, -hd), col);
  quad(out, P(hw, y0, hd), P(hw, y0, -hd), P(hw, y1, -hd), P(hw, y1, hd), col);
  quad(out, P(-hw, y0, -hd), P(-hw, y0, hd), P(-hw, y1, hd), P(-hw, y1, -hd), col);
}

/** Windows (and on the front, a door) across one street face, with painted
 *  shutters on the houses that have them. */
function openings(
  out: HouseBuffers,
  P: (u: number, y: number, v: number) => V3,
  lot: HouseLot,
  side: 1 | -1,
  y0: number,
  shutter: Rgb | null,
  roll: (n: number) => number,
): void {
  const { hw, hd, form } = lot;
  const v = side * (hd + OPENING_PROUD);
  // a panel spanning u0..u1 (u0 < u1), wound to face out of this side
  const panel = (u0: number, u1: number, lo: number, hi: number, col: Rgb) => {
    const a = side === 1 ? u0 : u1;
    const b = side === 1 ? u1 : u0;
    quad(out, P(a, lo, v), P(b, lo, v), P(b, hi, v), P(a, hi, v), col);
  };
  const bays = Math.max(1, Math.floor((hw * 2 - 0.8) / 2.5));
  const pitch = (hw * 2) / bays;
  const doorBay = side === 1 ? Math.floor(roll(20) * bays) % bays : -1;
  const winW = Math.min(0.7, pitch * 0.3);
  const winH = Math.min(1.3, form.storeyHeight * 0.4);
  for (let s = 0; s < form.storeys; s++) {
    const floor = y0 + s * form.storeyHeight;
    for (let b = 0; b < bays; b++) {
      const u = -hw + pitch * (b + 0.5);
      if (s === 0 && b === doorBay) {
        const top = floor + Math.min(2.3, form.storeyHeight * 0.75);
        panel(u - 0.65, u + 0.65, floor, top, DOOR);
        continue;
      }
      // some ground floors are shopfronts or blind walls
      if (s === 0 && roll(30 + b) < 0.25) continue;
      const lo = floor + form.storeyHeight * 0.38;
      panel(u - winW, u + winW, lo, lo + winH, WINDOW);
      if (shutter) {
        const sw = Math.min(winW * 0.9, (pitch / 2 - winW) * 0.9);
        if (sw > 0.2) {
          panel(u - winW - sw, u - winW, lo, lo + winH, shutter);
          panel(u + winW, u + winW + sw, lo, lo + winH, shutter);
        }
      }
    }
  }
}

/** The roof, from the eave line up, with its overhang. */
function roof(
  out: HouseBuffers,
  P: (u: number, y: number, v: number) => V3,
  lot: HouseLot,
  ye: number,
  c: HouseColours,
): void {
  const { hw, hd, form } = lot;
  const rise = form.roofRise;
  const o = EAVE_OVERHANG;
  const W = hw + o;
  const D = hd + o;
  const top = ye + rise;
  switch (form.roof) {
    case 'gable': {
      // ridge along the street, slopes to front and back, gable ends
      quad(out, P(-W, ye, D), P(W, ye, D), P(W, top, 0), P(-W, top, 0), c.roof);
      quad(out, P(W, ye, -D), P(-W, ye, -D), P(-W, top, 0), P(W, top, 0), c.roof);
      const apex = ye + rise * (hd / D);
      tri(out, P(hw, ye, hd), P(hw, ye, -hd), P(hw, apex, 0), c.wall);
      tri(out, P(-hw, ye, -hd), P(-hw, ye, hd), P(-hw, apex, 0), c.wall);
      return;
    }
    case 'gableFront': {
      // ridge front to back: the gable faces the street
      quad(out, P(W, ye, D), P(W, ye, -D), P(0, top, -D), P(0, top, D), c.roof);
      quad(out, P(-W, ye, -D), P(-W, ye, D), P(0, top, D), P(0, top, -D), c.roof);
      const apex = ye + rise * (hw / W);
      tri(out, P(-hw, ye, hd), P(hw, ye, hd), P(0, apex, hd), c.wall);
      tri(out, P(hw, ye, -hd), P(-hw, ye, -hd), P(0, apex, -hd), c.wall);
      return;
    }
    case 'hip': {
      const ridge = Math.max(0, W - D);
      if (ridge > 0) {
        quad(out, P(-W, ye, D), P(W, ye, D), P(ridge, top, 0), P(-ridge, top, 0), c.roof);
        quad(out, P(W, ye, -D), P(-W, ye, -D), P(-ridge, top, 0), P(ridge, top, 0), c.roof);
        tri(out, P(W, ye, D), P(W, ye, -D), P(ridge, top, 0), c.roof);
        tri(out, P(-W, ye, -D), P(-W, ye, D), P(-ridge, top, 0), c.roof);
      } else {
        const r2 = D - W;
        quad(out, P(W, ye, D), P(W, ye, -D), P(0, top, -r2), P(0, top, r2), c.roof);
        quad(out, P(-W, ye, -D), P(-W, ye, D), P(0, top, r2), P(0, top, -r2), c.roof);
        tri(out, P(-W, ye, D), P(W, ye, D), P(0, top, r2), c.roof);
        tri(out, P(W, ye, -D), P(-W, ye, -D), P(0, top, -r2), c.roof);
      }
      return;
    }
    case 'pyramid': {
      const apex = P(0, top, 0);
      tri(out, P(-W, ye, D), P(W, ye, D), apex, c.roof);
      tri(out, P(W, ye, D), P(W, ye, -D), apex, c.roof);
      tri(out, P(W, ye, -D), P(-W, ye, -D), apex, c.roof);
      tri(out, P(-W, ye, -D), P(-W, ye, D), apex, c.roof);
      return;
    }
    case 'shed': {
      // a lean-to: low at the front, high at the back, the back wall and the
      // two side triangles filled in under it
      quad(out, P(-W, ye, D), P(W, ye, D), P(W, top, -D), P(-W, top, -D), c.roof);
      const back = ye + rise * ((D + hd) / (2 * D));
      quad(out, P(hw, ye, -hd), P(-hw, ye, -hd), P(-hw, back, -hd), P(hw, back, -hd), c.wall);
      const front = ye + rise * ((D - hd) / (2 * D));
      quad(out, P(hw, ye, hd), P(hw, ye, -hd), P(hw, back, -hd), P(hw, front, hd), c.wall);
      quad(out, P(-hw, ye, -hd), P(-hw, ye, hd), P(-hw, front, hd), P(-hw, back, -hd), c.wall);
      return;
    }
    case 'flat': {
      // a roof terrace behind a low parapet
      walls(out, P, hw, hd, ye, top, c.wall);
      const deck = ye + 0.15;
      quad(out, P(-hw, deck, hd), P(hw, deck, hd), P(hw, deck, -hd), P(-hw, deck, -hd), c.base);
      return;
    }
  }
}

/** Append one house to `out`. Returns the number of triangles added. */
export function appendHouse(out: HouseBuffers, lot: HouseLot): number {
  const before = out.indices.length;
  const P = frame(lot);
  const c = houseColours(lot);
  const roll = (n: number) =>
    hash2(Math.round(lot.x * 8) + n * 6007, Math.round(lot.z * 8) - n * 99991, SALT + 1);
  const { hw, hd, form } = lot;
  // sunk below the lowest ground so a slope never shows a gap under it
  const y0 = lot.groundMin - 1.2;
  const yc = lot.groundMax + BASE_COURSE;
  const floor = lot.groundMax;
  const ye = floor + form.eave;
  walls(out, P, hw, hd, y0, yc, c.base);
  walls(out, P, hw, hd, yc, ye, c.wall);
  openings(out, P, lot, 1, floor, c.shutter, roll);
  openings(out, P, lot, -1, floor, c.shutter, roll);
  roof(out, P, lot, ye, c);
  if (form.chimney) {
    const side = roll(40) < 0.5 ? -1 : 1;
    const u = side * hw * (0.45 + roll(41) * 0.25);
    const v = -hd * (0.2 + roll(42) * 0.3);
    const s = 0.4;
    const t = ye + form.roofRise + 0.9;
    const Q = (du: number, y: number, dv: number) => P(u + du, y, v + dv);
    walls(out, Q, s, s, ye, t, CHIMNEY);
    quad(out, Q(-s, t, s), Q(s, t, s), Q(s, t, -s), Q(-s, t, -s), CHIMNEY);
  }
  return (out.indices.length - before) / 3;
}
