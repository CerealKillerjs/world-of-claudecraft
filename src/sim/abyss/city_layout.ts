// Rimholt's built fabric and the first layer's boundary camp, laid out by rule
// on the analytic ground (terrain.ts).
//
// The look comes from the art guide (project design notes, "guia-referencias",
// section 3): a warm, crowded stone town whose streets all fall toward the pit,
// terraces of houses facing the opening, scaffolds and cranes hung over the
// void along the rim, a poor quarter that has crept out over the edge, and a
// stone arch overgrown with green as the ceremonial way down. We take the
// feeling and the composition, never a specific building.
//
// Everything is a pure function of fixed constants (no world seed, no Rng):
// placements are content, identical on every host and every boot. hash2 with
// a fixed salt stands in for hand placement.

import { hash2 } from '../rng';
import type { CampDef, MailboxDef, ZonePropsDef } from '../types';
import {
  ABYSS_CENTER,
  CITY_OUTER_RADIUS,
  ISLAND_RADIUS,
  PIT_RADIUS,
  RIM_OUTER_RADIUS,
} from './geometry';
import { LAYER1_CAMP_CENTER, RIM_GRAVEYARD } from './regions';
import {
  CITY_AVENUES,
  CITY_TERRACES,
  distanceToAvenue,
  HANGING_QUARTER_FROM,
  HANGING_QUARTER_TO,
  HANGING_SHELF_DEPTH,
  SPIRAL_START_ANGLE,
} from './terrain';

type DecorProp = NonNullable<ZonePropsDef['decorProps']>[number];

const TAU = Math.PI * 2;
const cx = ABYSS_CENTER.x;
const cz = ABYSS_CENTER.z;
const SALT = 0x5a1d;
const TERRACE_RUN = (CITY_OUTER_RADIUS - RIM_OUTER_RADIUS) / CITY_TERRACES;

// World point at local polar (r, theta) around the pit axis.
function at(r: number, theta: number): { x: number; z: number } {
  return { x: cx + Math.cos(theta) * r, z: cz + Math.sin(theta) * r };
}

// Yaw that turns a model's +z front toward the pit's axis from angle theta.
function facePit(theta: number): number {
  return Math.atan2(-Math.cos(theta), -Math.sin(theta));
}

// Yaw along the ring (tangent), for walls and platforms.
function alongRing(theta: number): number {
  return Math.atan2(-Math.sin(theta), Math.cos(theta));
}

function rand(i: number, j: number): number {
  return hash2(i, j, SALT);
}

/** A house kind with its measured scale, collider radius, and height
 *  (mirrors the Evergarden town's authored hex-kit entries). */
interface HouseKind {
  key: string;
  scale: number;
  r: number;
  h: number;
}

const HOUSES: readonly HouseKind[] = [
  { key: 'hexHomeA', scale: 7.5, r: 5.2, h: 11 },
  { key: 'hexHomeB', scale: 7.5, r: 5.2, h: 11 },
  { key: 'hexbHomeA', scale: 7.5, r: 5.2, h: 11 },
  { key: 'hexbHomeB', scale: 7.5, r: 5.2, h: 11 },
  { key: 'hexrHomeA', scale: 7.5, r: 5.2, h: 11 },
  { key: 'hexrHomeB', scale: 7.5, r: 5.2, h: 11 },
];
const LANDMARKS: readonly HouseKind[] = [
  { key: 'hexTavern', scale: 8, r: 6, h: 13 },
  { key: 'hexbWorkshop', scale: 8, r: 6, h: 12 },
  { key: 'hexChurch', scale: 8, r: 5.6, h: 15 },
  { key: 'hexTower', scale: 8, r: 4, h: 17 },
  { key: 'hexbTowerA', scale: 8, r: 4.5, h: 18 },
];

/** Gap left clear around each avenue so the view down it reaches the pit. */
const AVENUE_CLEAR = 22;

/** The terraced houses: two rows per terrace, one backed against the upper
 *  retaining wall and one along the lower edge, with a ring street between.
 *  Inner terraces (nearest the pit) are packed tight, outer ones thin out into
 *  clusters with gardens between, like a town that grew outward from the rim. */
function terraceHouses(): DecorProp[] {
  const out: DecorProp[] = [];
  for (let k = 0; k < CITY_TERRACES; k++) {
    const start = RIM_OUTER_RADIUS + k * TERRACE_RUN;
    const rows = [start + 14, start + TERRACE_RUN - 16];
    const spacing = k < 3 ? 17 : 24;
    const keepChance = k < 2 ? 1 : k < 4 ? 0.82 : 0.6;
    rows.forEach((r, row) => {
      const count = Math.floor((TAU * r) / spacing);
      for (let i = 0; i < count; i++) {
        const theta = SPIRAL_START_ANGLE + (i / count) * TAU;
        const p = at(r, theta);
        if (distanceToAvenue(p.x - cx, p.z - cz) < AVENUE_CLEAR) continue;
        // clustered thinning: neighbourhoods, not salt-and-pepper
        const cluster = rand(Math.floor(i / 6), k * 7 + row);
        if (cluster > keepChance) continue;
        const pick = rand(i, k * 31 + row * 3 + 1);
        const kind = pick < 0.06 ? LANDMARKS[Math.floor(rand(i, k + 99) * LANDMARKS.length)] : null;
        const house = kind ?? HOUSES[Math.floor(pick * HOUSES.length) % HOUSES.length];
        out.push({
          key: house.key,
          x: p.x,
          z: p.z,
          rot: facePit(theta) + (rand(i, k + 7) - 0.5) * 0.3,
          scale: house.scale,
          r: house.r,
          h: house.h,
        });
      }
    });
  }
  return out;
}

/** The rim district: the explorers' hall on the north rim (seen across the
 *  pit from the descent), the market by the arch, watchtowers along the ring. */
function rimLandmarks(): DecorProp[] {
  const out: DecorProp[] = [];
  const north = Math.PI / 2;
  const hall = at(PIT_RADIUS + 60, north);
  out.push({
    key: 'hexrCastle',
    x: hall.x,
    z: hall.z,
    rot: facePit(north),
    scale: 10,
    r: 12,
    h: 26,
  });
  for (const side of [-1, 1]) {
    const tower = at(PIT_RADIUS + 52, north + side * 0.09);
    out.push({
      key: 'hexbTowerB',
      x: tower.x,
      z: tower.z,
      rot: facePit(north),
      scale: 9,
      r: 4.5,
      h: 22,
    });
  }
  // watchtowers every eighth of the ring, between the avenues
  for (let i = 0; i < CITY_AVENUES; i++) {
    const theta = SPIRAL_START_ANGLE + ((i + 0.5) / CITY_AVENUES) * TAU;
    if (Math.abs(Math.sin((theta - north) / 2)) < 0.1) continue; // the hall stands there
    const p = at(PIT_RADIUS + 30, theta);
    out.push({ key: 'hexWatchtower', x: p.x, z: p.z, rot: facePit(theta), scale: 7, r: 3.2, h: 9 });
  }
  // the rim market: stalls in two arcs west of the arch
  for (let i = 0; i < 10; i++) {
    const theta = SPIRAL_START_ANGLE - 0.12 - i * 0.022;
    for (const [r, key] of [
      [PIT_RADIUS + 70, 'stand1'],
      [PIT_RADIUS + 92, 'stand2'],
    ] as const) {
      const p = at(r, theta);
      out.push({ key, x: p.x, z: p.z, rot: facePit(theta), scale: 1, r: 1.6, h: 3 });
    }
  }
  // rim-ring houses between the plaza and the first terrace
  const count = Math.floor((TAU * (RIM_OUTER_RADIUS - 24)) / 18);
  for (let i = 0; i < count; i++) {
    const theta = SPIRAL_START_ANGLE + (i / count) * TAU;
    const p = at(RIM_OUTER_RADIUS - 24, theta);
    if (distanceToAvenue(p.x - cx, p.z - cz) < AVENUE_CLEAR) continue;
    if (Math.abs(Math.sin((theta - north) / 2)) < 0.12) continue;
    const house = HOUSES[Math.floor(rand(i, 501) * HOUSES.length) % HOUSES.length];
    out.push({
      key: house.key,
      x: p.x,
      z: p.z,
      rot: facePit(theta),
      scale: house.scale,
      r: house.r,
      h: house.h,
    });
  }
  return out;
}

/** The descent: an overgrown stone arch where the spiral leaves the rim. */
function descentArch(): DecorProp[] {
  const theta = SPIRAL_START_ANGLE;
  const p = at(PIT_RADIUS + 6, theta);
  const out: DecorProp[] = [
    { key: 'gardenArch', x: p.x, z: p.z, rot: alongRing(theta) + Math.PI / 2, scale: 4 },
  ];
  for (let i = 0; i < 8; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const q = at(PIT_RADIUS + 4 + (i >> 1) * 3, theta + side * (0.018 + rand(i, 7) * 0.01));
    out.push({ key: 'shrubFlowering', x: q.x, z: q.z, rot: rand(i, 8) * TAU, scale: 1.3 });
  }
  return out;
}

/** Scaffolds and cranes hung over the void, outside the rim parapet. Pure
 *  dressing (no colliders): nothing out there is ground to stand on. */
function rimScaffolds(): DecorProp[] {
  const out: DecorProp[] = [];
  const count = 64;
  for (let i = 0; i < count; i++) {
    const theta = SPIRAL_START_ANGLE + ((i + 0.5) / count) * TAU;
    if (Math.abs(Math.sin((theta - SPIRAL_START_ANGLE) / 2)) < 0.05) continue; // the arch
    if (rand(i, 301) < 0.3) continue;
    const deck = at(PIT_RADIUS - 5, theta);
    out.push({ key: 'dockPlatform', x: deck.x, z: deck.z, rot: facePit(theta), scale: 1.4 });
    for (const off of [-0.006, 0.006]) {
      const post = at(PIT_RADIUS - 8, theta + off);
      out.push({ key: 'timberPillar', x: post.x, z: post.z, rot: facePit(theta), scale: 1.6 });
    }
    if (rand(i, 302) < 0.35) {
      const crane = at(PIT_RADIUS + 3, theta);
      out.push({ key: 'hexbShipyard', x: crane.x, z: crane.z, rot: facePit(theta), scale: 6 });
    }
  }
  return out;
}

/** The hanging quarter: shacks crowded onto the shelf that slopes into the pit. */
function hangingQuarter(): DecorProp[] {
  const out: DecorProp[] = [];
  let n = 0;
  for (let base = HANGING_QUARTER_FROM + 0.1; base < HANGING_QUARTER_TO - 0.1; base += 0.03) {
    const theta = SPIRAL_START_ANGLE - base; // the spiral winds clockwise
    for (let d = 12; d < HANGING_SHELF_DEPTH - 6; d += 15) {
      n++;
      if (rand(n, 401) < 0.25) continue;
      const p = at(PIT_RADIUS - d, theta + (rand(n, 402) - 0.5) * 0.01);
      const key = rand(n, 403) < 0.5 ? 'hexrHomeA' : 'hexrHomeB';
      out.push({
        key,
        x: p.x,
        z: p.z,
        rot: facePit(theta) + (rand(n, 404) - 0.5),
        scale: 5.5,
        r: 3.8,
        h: 8,
      });
    }
    // stilts under the shelf's lip
    const lip = at(PIT_RADIUS - HANGING_SHELF_DEPTH - 2, theta);
    out.push({ key: 'timberPillar', x: lip.x, z: lip.z, rot: facePit(theta), scale: 2.2 });
  }
  return out;
}

/** Low stone parapet along the rim edge, open at the arch and the quarter. */
function rimParapet(): ZonePropsDef['fences'] {
  const out: ZonePropsDef['fences'] = [];
  const count = 160;
  for (let i = 0; i < count; i++) {
    const a0 = SPIRAL_START_ANGLE + (i / count) * TAU;
    const a1 = SPIRAL_START_ANGLE + ((i + 1) / count) * TAU;
    const mid = (a0 + a1) / 2;
    const fromStart = (((SPIRAL_START_ANGLE - mid) % TAU) + TAU) % TAU; // base angle
    if (fromStart < 0.04 || fromStart > TAU - 0.04) continue; // the arch opening
    if (fromStart > HANGING_QUARTER_FROM && fromStart < HANGING_QUARTER_TO) continue;
    const p0 = at(PIT_RADIUS + 1.5, a0);
    const p1 = at(PIT_RADIUS + 1.5, a1);
    out.push({ x1: p0.x, z1: p0.z, x2: p1.x, z2: p1.z, kind: 'stone' });
  }
  return out;
}

/** The boundary camp on the layer 1 floor: the first place to rest. */
function campProps(): Pick<ZonePropsDef, 'tents' | 'campfires' | 'crates'> {
  const c = LAYER1_CAMP_CENTER;
  const tents: ZonePropsDef['tents'] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    tents.push({
      x: c.x + Math.cos(a) * 16,
      z: c.z + Math.sin(a) * 16,
      rot: -a + Math.PI / 2,
      scale: 1.2,
    });
  }
  return {
    tents,
    campfires: [[c.x, c.z]],
    crates: [
      [c.x + 7, c.z - 9, 2],
      [c.x + 9, c.z - 7],
      [c.x - 8, c.z + 8],
    ],
  };
}

/** Roads: the eight avenues from the arch ring out to the coast, plus the rim
 *  ring road and one ring street per terrace pair. Streetlamps follow them. */
export function abyssRoads(): { x: number; z: number }[][] {
  const roads: { x: number; z: number }[][] = [];
  for (let i = 0; i < CITY_AVENUES; i++) {
    const theta = SPIRAL_START_ANGLE + (i / CITY_AVENUES) * TAU;
    const line: { x: number; z: number }[] = [];
    for (let r = PIT_RADIUS + 12; r <= ISLAND_RADIUS - 140; r += 60) line.push(at(r, theta));
    roads.push(line);
  }
  for (const r of [
    PIT_RADIUS + 115,
    RIM_OUTER_RADIUS + TERRACE_RUN * 1.5,
    RIM_OUTER_RADIUS + TERRACE_RUN * 3.5,
  ]) {
    const ring: { x: number; z: number }[] = [];
    const segs = Math.ceil((TAU * r) / 40);
    for (let i = 0; i <= segs; i++) ring.push(at(r, (i / segs) * TAU));
    roads.push(ring);
  }
  return roads;
}

export const ABYSS_MAILBOXES: readonly MailboxDef[] = [
  { x: RIM_GRAVEYARD.x - 40, z: RIM_GRAVEYARD.z - 8 },
  { x: LAYER1_CAMP_CENTER.x + 4, z: LAYER1_CAMP_CENTER.z + 10 },
];

/** No creature camps yet: the first layer's fauna is content phase 4. */
export const ABYSS_CAMPS: CampDef[] = [];

/** The whole prop set for the pack. */
export function buildAbyssProps(): ZonePropsDef {
  const camp = campProps();
  return {
    buildings: [],
    wells: [],
    stalls: [],
    mines: [],
    docks: [],
    tents: camp.tents,
    marshReeds: [],
    crates: camp.crates,
    campfires: camp.campfires,
    mudHuts: [],
    ruinRings: [],
    fences: rimParapet(),
    graveyards: [RIM_GRAVEYARD],
    decorProps: [
      ...descentArch(),
      ...rimLandmarks(),
      ...rimScaffolds(),
      ...hangingQuarter(),
      ...terraceHouses(),
    ],
  };
}
