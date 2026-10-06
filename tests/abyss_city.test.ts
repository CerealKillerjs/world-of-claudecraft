// Rimholt, the rim city of the abyss world: its street plan
// (src/sim/abyss/city_plan.ts), the built blocks laid out on it
// (city_blocks.ts), and the ground surfaces the renderer paints (surface.ts).
//
// The owner's brief for the city is "organic and a little irregular, but
// plainly built by people", so beyond the walkability rules these pin that the
// plan really is irregular (no perfect rings, no even spokes) and still made of
// straight, hand-built runs, and that the districts build differently.

import { describe, expect, it } from 'vitest';
import {
  ABYSS_CENTER,
  ABYSS_PLAYER_START,
  abyssRoads,
  abyssSurfaceAt,
  abyssTerrainHeight,
  avenueAngleAt,
  avenueHalfWidth,
  buildAbyssProps,
  CITY_AVENUE_COUNT,
  CITY_EDGE_HEIGHT,
  CITY_OUTER_RADIUS,
  CITY_TOP_HEIGHT,
  CITY_WALLS,
  cityGround,
  districtAt,
  isGardenPlot,
  isRimholtBuilding,
  LANE_HALF_WIDTH,
  LANE_RUN,
  laneAngles,
  levelAt,
  levelBlocks,
  levelStreets,
  nearestAvenue,
  PIT_RADIUS,
  RIM_GRAVEYARD,
  RIM_HEIGHT,
  SOUTH_GATE_ANGLE,
  STREET_GRAIN,
  WALL_FACE_RUN,
  WALL_FOOT,
  WALL_TOP,
  wallCorners,
  wallRadiusAt,
} from '../src/sim/abyss';
import { cityStreetAt, ringRadius } from '../src/sim/abyss/city_streets';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { WORLD_SEED } from '../src/sim/world_seed';

const TAU = Math.PI * 2;
const cx = ABYSS_CENTER.x;
const cz = ABYSS_CENTER.z;
const h = (x: number, z: number) => abyssTerrainHeight(x, z, WORLD_SEED);
/** WORLD point at local polar (r, theta). */
const polar = (r: number, theta: number) => ({
  x: cx + Math.cos(theta) * r,
  z: cz + Math.sin(theta) * r,
});
/** Local ground record at polar (r, theta). */
const ground = (r: number, theta: number) => cityGround(Math.cos(theta) * r, Math.sin(theta) * r);

/** Steepest rise along a straight walk from a to b, sampled every `step`. */
function steepest(a: { x: number; z: number }, b: { x: number; z: number }, step: number): number {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.ceil(len / step);
  let worst = 0;
  let prev = h(a.x, a.z);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const y = h(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
    worst = Math.max(worst, Math.abs(y - prev) / (len / n));
    prev = y;
  }
  return worst;
}

const PROPS = buildAbyssProps();
const houses = (PROPS.decorProps ?? []).filter((d) => isRimholtBuilding(d.key));

describe('Rimholt plan: irregular terrace walls of straight runs', () => {
  it('wanders each wall around its ring instead of drawing a circle', () => {
    for (let k = 0; k < CITY_WALLS - 1; k++) {
      const radii = wallCorners(k).map((c) => Math.hypot(c.x, c.z));
      expect(Math.max(...radii) - Math.min(...radii), `wall ${k}`).toBeGreaterThan(20);
    }
  });

  it('builds every wall from straight runs of uneven length', () => {
    for (let k = 0; k < CITY_WALLS; k++) {
      const corners = wallCorners(k);
      expect(corners.length).toBeGreaterThan(20);
      const runs = corners.map((c, i) => {
        const n = corners[(i + 1) % corners.length];
        return Math.hypot(n.x - c.x, n.z - c.z);
      });
      // the closing run may be short; the rest are hand-length runs
      const body = runs.slice(0, -1);
      expect(Math.min(...body)).toBeGreaterThan(40);
      expect(Math.max(...body)).toBeLessThan(260);
      expect(Math.max(...body) - Math.min(...body)).toBeGreaterThan(40);
      // a point halfway along a run lies on the straight line between its corners
      const a = corners[3];
      const b = corners[4];
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      const theta = Math.atan2(mid.z, mid.x);
      expect(wallRadiusAt(k, theta)).toBeCloseTo(Math.hypot(mid.x, mid.z), 6);
    }
  });

  it('keeps the walls in order, apart, and inside the city edge', () => {
    for (let s = 0; s < 360; s++) {
      const theta = SOUTH_GATE_ANGLE + (s / 360) * TAU;
      let prev = PIT_RADIUS;
      for (let k = 0; k < CITY_WALLS; k++) {
        const r = wallRadiusAt(k, theta);
        expect(r - prev, `wall ${k} at ${s} deg`).toBeGreaterThan(70);
        prev = r;
      }
      expect(prev).toBeLessThan(CITY_OUTER_RADIUS);
    }
  });

  it('sets the avenues off an even spacing, the two main ones aside', () => {
    const offsets = Array.from({ length: CITY_AVENUE_COUNT }, (_, i) => {
      let d = avenueAngleAt(i, PIT_RADIUS) - (SOUTH_GATE_ANGLE + (i * TAU) / CITY_AVENUE_COUNT);
      d -= TAU * Math.round(d / TAU);
      return Math.abs(d);
    });
    expect(offsets[0]).toBeLessThan(1e-9);
    expect(offsets[4]).toBeLessThan(1e-9);
    expect(offsets.filter((d) => d > 0.02).length).toBeGreaterThanOrEqual(4);
    // and they bend as they climb (an avenue is not one straight spoke)
    const bends = Array.from(
      { length: CITY_AVENUE_COUNT },
      (_, i) => Math.abs(avenueAngleAt(i, 1300) - avenueAngleAt(i, PIT_RADIUS)) * 1300,
    );
    expect(bends.filter((b) => b > 8).length).toBeGreaterThanOrEqual(4);
  });
});

describe('Rimholt ground: terraces, walls, avenues and stair lanes', () => {
  it('climbs from the rim to the city edge and meets the island there', () => {
    expect(WALL_TOP[CITY_WALLS - 1]).toBe(CITY_EDGE_HEIGHT);
    expect(CITY_TOP_HEIGHT).toBe(CITY_EDGE_HEIGHT);
    for (let k = 1; k < CITY_WALLS; k++) {
      expect(WALL_FOOT[k]).toBeGreaterThan(WALL_TOP[k - 1]);
      expect(WALL_TOP[k] - WALL_FOOT[k]).toBeGreaterThan(5);
    }
    for (let s = 0; s < 24; s++) {
      const theta = SOUTH_GATE_ANGLE + 0.05 + (s / 24) * TAU;
      const edge = polar(PIT_RADIUS + 0.5, theta);
      expect(Math.abs(h(edge.x, edge.z) - RIM_HEIGHT)).toBeLessThan(0.5);
      const inCity = polar(CITY_OUTER_RADIUS - 0.01, theta);
      const onIsland = polar(CITY_OUTER_RADIUS + 0.01, theta);
      expect(Math.abs(h(inCity.x, inCity.z) - h(onIsland.x, onIsland.z))).toBeLessThan(0.1);
    }
  });

  it('makes every terrace wall too steep to climb away from lanes and avenues', () => {
    let checked = 0;
    for (let k = 0; k < CITY_WALLS; k++) {
      for (let s = 0; s < 48; s++) {
        const theta = SOUTH_GATE_ANGLE + ((s + 0.37) / 48) * TAU;
        const w = wallRadiusAt(k, theta);
        const g = ground(w - WALL_FACE_RUN / 2, theta);
        if (g.avenue > 0 || g.lane > 0) continue;
        const a = polar(w - WALL_FACE_RUN - 2, theta);
        const b = polar(w + 2, theta);
        expect(steepest(a, b, 0.25), `wall ${k} at sample ${s}`).toBeGreaterThan(
          PLAYER_MAX_CLIMB_SLOPE,
        );
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('cuts walkable stair lanes up through every wall', () => {
    for (let k = 0; k < CITY_WALLS; k++) {
      const lanes = laneAngles(k);
      expect(lanes.length, `wall ${k}`).toBeGreaterThan(k === CITY_WALLS - 1 ? 4 : 15);
      for (const theta of lanes.slice(0, 6)) {
        const w = wallRadiusAt(k, theta);
        if (ground(w - LANE_RUN / 2, theta).avenue > 0) continue;
        const a = polar(w - LANE_RUN - 4, theta);
        const b = polar(w + 4, theta);
        expect(steepest(a, b, 0.25), `lane on wall ${k}`).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE);
        expect(h(b.x, b.z) - h(a.x, a.z)).toBeGreaterThan(5);
      }
    }
  });

  it('lets every avenue ramp walkably along its bends from the rim to the edge', () => {
    for (let i = 0; i < CITY_AVENUE_COUNT; i++) {
      let worst = 0;
      for (let r = PIT_RADIUS; r < CITY_OUTER_RADIUS; r += 1) {
        const p = polar(r, avenueAngleAt(i, r));
        const q = polar(r + 1, avenueAngleAt(i, r + 1));
        worst = Math.max(
          worst,
          Math.abs(h(q.x, q.z) - h(p.x, p.z)) / Math.hypot(q.x - p.x, q.z - p.z),
        );
      }
      expect(worst, `avenue ${i}`).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE * 0.5);
    }
  });

  it('is a pure function of position', () => {
    const p = polar(1210, 0.83);
    expect(abyssTerrainHeight(p.x, p.z, 1)).toBe(abyssTerrainHeight(p.x, p.z, 99));
    expect(cityGround(300, -900)).toEqual(cityGround(300, -900));
  });
});

describe('Rimholt districts, gardens and surfaces', () => {
  it('splits the terraces into four quarters around the rim ring', () => {
    const seen = new Set<string>();
    for (let s = 0; s < 64; s++) {
      const theta = SOUTH_GATE_ANGLE + (s / 64) * TAU;
      seen.add(districtAt(1200, theta));
    }
    expect([...seen].sort()).toEqual(['east', 'north', 'south', 'west']);
    expect(districtAt(PIT_RADIUS + 50, 1)).toBe('centre');
    expect(districtAt(1200, SOUTH_GATE_ANGLE)).toBe('south');
    expect(districtAt(1200, Math.PI / 2)).toBe('north');
    expect(districtAt(1200, 0)).toBe('east');
    expect(districtAt(1200, Math.PI)).toBe('west');
  });

  it('leaves garden plots on the upper terraces, never on the rim or a street', () => {
    let gardens = 0;
    let westGardens = 0;
    let southGardens = 0;
    for (let r = PIT_RADIUS; r < CITY_OUTER_RADIUS; r += 9) {
      for (let s = 0; s < 240; s++) {
        const theta = SOUTH_GATE_ANGLE + (s / 240) * TAU;
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        if (!isGardenPlot(x, z)) continue;
        gardens++;
        expect(levelAt(r, theta)).toBeGreaterThanOrEqual(2);
        expect(cityGround(x, z).avenue).toBe(0);
        const d = districtAt(r, theta);
        if (d === 'west') westGardens++;
        if (d === 'south') southGardens++;
      }
    }
    expect(gardens).toBeGreaterThan(100);
    expect(westGardens).toBeGreaterThan(southGardens);
  });

  it('paves the city, cobbles its streets, faces its walls and leaves nature alone', () => {
    const plaza = polar(PIT_RADIUS + 40, 0.3);
    expect(abyssSurfaceAt(plaza.x, plaza.z)).toBe('paving');
    const avenue = polar(1000, avenueAngleAt(2, 1000));
    expect(abyssSurfaceAt(avenue.x, avenue.z)).toBe('street');
    const lane = laneAngles(1)[3];
    const lanePoint = polar(wallRadiusAt(1, lane) - LANE_RUN / 2, lane);
    expect(abyssSurfaceAt(lanePoint.x, lanePoint.z)).toBe('street');
    let faces = 0;
    for (let s = 0; s < 32; s++) {
      const theta = SOUTH_GATE_ANGLE + ((s + 0.5) / 32) * TAU;
      const p = polar(wallRadiusAt(2, theta) - WALL_FACE_RUN / 2, theta);
      if (abyssSurfaceAt(p.x, p.z) === 'masonry') faces++;
    }
    expect(faces).toBeGreaterThan(20);
    expect(abyssSurfaceAt(cx, cz)).toBeNull();
    const farm = polar(CITY_OUTER_RADIUS + 200, 1);
    expect(abyssSurfaceAt(farm.x, farm.z)).toBeNull();
  });
});

/** A house's footprint corners (WORLD), three.js yaw (local +z the front). */
function corners(d: { x: number; z: number; rot?: number; hw?: number; hd?: number }) {
  const c = Math.cos(d.rot ?? 0);
  const sn = Math.sin(d.rot ?? 0);
  const hw = d.hw ?? 0;
  const hd = d.hd ?? 0;
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([u, v]) => ({ x: d.x + u * c + v * sn, z: d.z - u * sn + v * c }));
}

const mid = (p: { x: number; z: number }, q: { x: number; z: number }) => ({
  x: (p.x + q.x) / 2,
  z: (p.z + q.z) / 2,
});

/** How far two yawed boxes interpenetrate (0 when apart), separating axes. */
function overlapDepth(
  a: { x: number; z: number; rot?: number; hw?: number; hd?: number },
  b: { x: number; z: number; rot?: number; hw?: number; hd?: number },
): number {
  const axes = (r: number) => [
    { x: Math.cos(r), z: -Math.sin(r) },
    { x: Math.sin(r), z: Math.cos(r) },
  ];
  const extent = (o: typeof a, ax: { x: number; z: number }) => {
    const [u, v] = axes(o.rot ?? 0);
    return (
      (o.hw ?? 0) * Math.abs(u.x * ax.x + u.z * ax.z) +
      (o.hd ?? 0) * Math.abs(v.x * ax.x + v.z * ax.z)
    );
  };
  let depth = Number.POSITIVE_INFINITY;
  for (const ax of [...axes(a.rot ?? 0), ...axes(b.rot ?? 0)]) {
    const d = extent(a, ax) + extent(b, ax) - Math.abs((b.x - a.x) * ax.x + (b.z - a.z) * ax.z);
    if (d <= 0) return 0;
    depth = Math.min(depth, d);
  }
  return depth;
}

/** The pinned layout (count and digest); see the determinism test. */
const GOLDEN = { houses: 14041, digest: 769800552 };

const districtOf = (d: { x: number; z: number }) => {
  const x = d.x - cx;
  const z = d.z - cz;
  return districtAt(Math.hypot(x, z), Math.atan2(z, x));
};

describe('Rimholt streets: ring streets, alleys and plazas', () => {
  it('splits every terrace with meandering ring streets that never cross', () => {
    for (let level = 0; level < CITY_WALLS; level++) {
      const { rings } = levelStreets(level);
      expect(rings.length).toBeGreaterThanOrEqual(1);
      for (let s = 0; s < 180; s++) {
        const theta = SOUTH_GATE_ANGLE + (s / 180) * TAU;
        let prev = 0;
        for (const ring of rings) {
          const r = ringRadius(ring, theta);
          // in order, with a block's depth between them
          expect(r - ring.halfWidth - prev).toBeGreaterThan(prev === 0 ? 0 : 8);
          prev = r + ring.halfWidth;
        }
      }
      // and they wander: not a constant offset from the walls
      const ring = rings[0];
      if (ring.fixedRadius === undefined) expect(ring.amp).toBeGreaterThan(1);
    }
  });

  it('cuts the south into a tighter warren of alleys than the north', () => {
    const grain = STREET_GRAIN;
    expect(grain.south.spacingMax).toBeLessThan(grain.north.spacingMin);
    expect(grain.south.deadEnd).toBeGreaterThan(grain.north.deadEnd);
    let south = 0;
    let north = 0;
    for (const st of levelStreets(3).stripes) {
      for (const a of st.alleys) {
        const r = 1300;
        const d = districtAt(r, a.theta0);
        if (d === 'south') south++;
        if (d === 'north') north++;
      }
    }
    expect(south).toBeGreaterThan(north * 1.5);
  });

  it('keeps every alley wide enough to walk, with dead ends and skewed runs among them', () => {
    let dead = 0;
    let skewed = 0;
    for (let level = 0; level < CITY_WALLS; level++) {
      for (const st of levelStreets(level).stripes) {
        for (const a of st.alleys) {
          expect(a.halfWidth * 2).toBeGreaterThanOrEqual(2.4);
          if (a.reach < 1) dead++;
          if (Math.abs(a.theta1 - a.theta0) * 1000 > 3) skewed++;
        }
      }
    }
    expect(dead).toBeGreaterThan(100);
    expect(skewed).toBeGreaterThan(500);
  });

  it('runs an alley down every stair lane so each one lands on a street', () => {
    for (let level = 1; level < CITY_WALLS; level++) {
      for (const lane of laneAngles(level - 1)) {
        const r = wallRadiusAt(level - 1, lane) + 12;
        expect(cityStreetAt(Math.cos(lane) * r, Math.sin(lane) * r)).toBe('street');
      }
    }
  });

  it('leaves plazas open in every district', () => {
    const seen = new Set<string>();
    let total = 0;
    for (let level = 0; level < CITY_WALLS; level++) {
      for (const b of levelBlocks(level)) {
        if (!b.plaza) continue;
        total++;
        const t = (b.a.theta0 + b.end0) / 2;
        seen.add(districtAt(wallRadiusAt(level, t) - 30, t));
      }
    }
    expect([...seen].sort()).toEqual(['centre', 'east', 'north', 'south', 'west']);
    expect(total).toBeGreaterThan(60);
    // one well per plaza, but for the few rim plazas left bare beside a landmark
    expect(PROPS.wells.length).toBeLessThanOrEqual(total);
    expect(PROPS.wells.length).toBeGreaterThan(total - 6);
  });

  it('cobbles the ring streets and alleys in the ground paint', () => {
    const ring = levelStreets(2).rings[0];
    const theta = 0.4;
    const r = ringRadius(ring, theta);
    const p = polar(r, theta);
    expect(abyssSurfaceAt(p.x, p.z)).toBe('street');
  });
});

describe('Rimholt blocks: houses on lots, plazas and parapets', () => {
  it('builds a dense city within a bounded budget', () => {
    expect(houses.length).toBeGreaterThan(10000);
    expect(houses.length).toBeLessThan(30000);
    const bad = houses.filter(
      (d) =>
        (d.hw ?? 0) <= 1.5 ||
        (d.hd ?? 0) <= 1.5 ||
        Math.abs((d.r ?? 0) - Math.hypot(d.hw ?? 0, d.hd ?? 0)) > 1e-6 ||
        (d.h ?? 0) <= 3,
    );
    expect(bad).toEqual([]);
  });

  it('keeps every house off the avenues, the wall faces and the stair lanes', () => {
    // collected, then asserted once: an expect per corner is too slow here
    const bad: string[] = [];
    for (const d of houses) {
      for (const p of [d, ...corners(d)]) {
        const x = p.x - cx;
        const z = p.z - cz;
        const hit = nearestAvenue(x, z);
        if (hit.distance <= avenueHalfWidth(hit.index)) bad.push(`avenue ${d.x},${d.z}`);
        const g = cityGround(x, z);
        if (g.face >= 0.5) bad.push(`wall face ${d.x},${d.z}`);
        const r = Math.hypot(x, z);
        const theta = Math.atan2(z, x);
        const level = levelAt(r, theta);
        // a lane's ramp up the wall behind, and its top from the wall below
        if (g.lane > 0 && wallRadiusAt(level, theta) - r <= LANE_RUN) {
          bad.push(`lane ramp ${d.x},${d.z}`);
        }
        for (const a of [...laneAngles(level), ...(level > 0 ? laneAngles(level - 1) : [])]) {
          let da = theta - a;
          da -= TAU * Math.round(da / TAU);
          if (Math.abs(da) * r <= LANE_HALF_WIDTH) bad.push(`lane ${d.x},${d.z}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('never builds on a ring street or an alley', () => {
    const onStreet: string[] = [];
    for (const d of houses) {
      const cs = corners(d);
      // the centre, and each corner and edge midpoint pulled in a little
      const probes = [d, ...cs, ...cs.map((p, i) => mid(p, cs[(i + 1) % 4]))].map((p) => ({
        x: d.x + (p.x - d.x) * 0.9,
        z: d.z + (p.z - d.z) * 0.9,
      }));
      if (probes.some((p) => cityStreetAt(p.x - cx, p.z - cz) === 'street')) {
        onStreet.push(`${d.x.toFixed(1)},${d.z.toFixed(1)}`);
      }
    }
    expect(onStreet).toEqual([]);
  });

  it('never stands one house inside another', () => {
    // separating axes on every pair of nearby boxes, after a coarse grid
    const grid = new Map<string, typeof houses>();
    for (const d of houses) {
      const k = `${Math.floor(d.x / 30)}:${Math.floor(d.z / 30)}`;
      grid.set(k, [...(grid.get(k) ?? []), d]);
    }
    let overlaps = 0;
    for (const d of houses) {
      const gx = Math.floor(d.x / 30);
      const gz = Math.floor(d.z / 30);
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          for (const o of grid.get(`${gx + i}:${gz + j}`) ?? []) {
            if (o !== d && overlapDepth(d, o) > 0.3) overlaps++;
          }
        }
      }
    }
    expect(overlaps).toBe(0);
  });

  it('fronts nearly every house onto a street or a walk', () => {
    let fronted = 0;
    const rows = houses.filter((d) => d.key !== 'rimTall');
    for (const d of rows) {
      const fx = Math.sin(d.rot ?? 0);
      const fz = Math.cos(d.rot ?? 0);
      for (let ahead = 0.5; ahead <= 6.5; ahead += 0.5) {
        const x = d.x + fx * ((d.hd ?? 0) + ahead) - cx;
        const z = d.z + fz * ((d.hd ?? 0) + ahead) - cz;
        const g = cityGround(x, z);
        const r = Math.hypot(x, z);
        const theta = Math.atan2(z, x);
        const level = levelAt(r, theta);
        const walk = level === 0 ? r < PIT_RADIUS + 50 : r < wallRadiusAt(level - 1, theta) + 8;
        if (cityStreetAt(x, z) !== null || g.avenue > 0.2 || g.lane > 0.2 || walk) {
          fronted++;
          break;
        }
      }
    }
    expect(fronted / rows.length).toBeGreaterThan(0.95);
  });

  it('builds each district its own way', () => {
    const of = (district: string) => houses.filter((d) => districtOf(d) === district);
    const meanWidth = (list: typeof houses) =>
      list.reduce((sum, d) => sum + (d.hw ?? 0) * 2, 0) / list.length;
    const share = (list: typeof houses, key: string) =>
      list.filter((d) => d.key === key).length / list.length;
    const south = of('south');
    const north = of('north');
    const east = of('east');
    const west = of('west');
    // the poor south: the most houses, the narrowest lots, the shacks
    expect(south.length).toBeGreaterThan(north.length * 1.5);
    expect(meanWidth(south)).toBeLessThan(meanWidth(north) * 0.7);
    expect(share(south, 'rimShack')).toBeGreaterThan(0.2);
    // the workshops of the east, the cottages of the west, the towers of the north
    expect(share(east, 'rimWorkshop')).toBeGreaterThan(0.25);
    expect(share(west, 'rimCottage')).toBeGreaterThan(0.3);
    expect(share(north, 'rimTower')).toBeGreaterThan(share(south, 'rimTower') * 2);
    // and the north builds taller than the west
    const meanH = (list: typeof houses) => list.reduce((s, d) => s + (d.h ?? 0), 0) / list.length;
    expect(meanH(north)).toBeGreaterThan(meanH(west) * 1.3);
  });

  it('keeps the arrival spot and the graveyard clear', () => {
    // every solid city prop, houses and trees alike, by its footprint
    const solid = (PROPS.decorProps ?? []).filter(
      (d) => isRimholtBuilding(d.key) || (d.key === 'oakTree' && (d.r ?? 0) > 0),
    );
    const near = solid.filter(
      (d) =>
        Math.hypot(d.x - ABYSS_PLAYER_START.x, d.z - ABYSS_PLAYER_START.z) - (d.r ?? 0) <= 8 ||
        Math.hypot(d.x - RIM_GRAVEYARD.x, d.z - RIM_GRAVEYARD.z) - (d.r ?? 0) <= 30,
    );
    expect(near).toEqual([]);
  });

  it('lays out the same city every time, and on every host', () => {
    const again = buildAbyssProps();
    expect(again.decorProps).toEqual(PROPS.decorProps);
    expect(again.fences).toEqual(PROPS.fences);
    // a golden digest of every house, rounded: the street network and lots
    // are cached at module load, so only a pinned value catches drift
    // between hosts or an unintended change to the plan
    let sum = 0;
    for (const d of houses) {
      sum +=
        Math.round(d.x * 4) * 3 +
        Math.round(d.z * 4) * 5 +
        Math.round((d.hw ?? 0) * 4) * 7 +
        Math.round((d.hd ?? 0) * 4) * 11 +
        Math.round((d.h ?? 0) * 4) * 13;
      sum = ((sum % 1_000_000_007) + 1_000_000_007) % 1_000_000_007;
    }
    expect({ houses: houses.length, digest: sum }).toEqual(GOLDEN);
  });

  it('runs a parapet along each wall top, open at the lanes and avenues', () => {
    const parapets = PROPS.fences.filter((f) => Math.hypot(f.x1 - cx, f.z1 - cz) > PIT_RADIUS + 50);
    expect(parapets.length).toBeGreaterThan(200);
    for (const f of parapets) {
      const mx = (f.x1 + f.x2) / 2 - cx;
      const mz = (f.z1 + f.z2) / 2 - cz;
      const theta = Math.atan2(mz, mx);
      const r = Math.hypot(mx, mz);
      const nearest = Math.min(
        ...Array.from({ length: CITY_WALLS }, (_, k) => Math.abs(r - wallRadiusAt(k, theta))),
      );
      expect(nearest).toBeLessThan(3);
      const hit = nearestAvenue(mx, mz);
      expect(hit.distance).toBeGreaterThan(avenueHalfWidth(hit.index));
    }
  });

  it('furnishes its plazas with wells and stalls, and lights its main streets', () => {
    expect(PROPS.stalls.length).toBeGreaterThanOrEqual(PROPS.wells.length);
    // eight avenues, the rim ring, and the main ring street of every terrace
    expect(abyssRoads()).toHaveLength(CITY_AVENUE_COUNT + CITY_WALLS);
  });
});
