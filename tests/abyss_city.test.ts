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
  LANE_RUN,
  laneAngles,
  levelAt,
  nearestAvenue,
  PIT_RADIUS,
  RIM_HEIGHT,
  SOUTH_GATE_ANGLE,
  WALL_FACE_RUN,
  WALL_FOOT,
  WALL_TOP,
  wallCorners,
  wallRadiusAt,
} from '../src/sim/abyss';
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
const HOUSE_KEYS =
  /^hex[rb]?(Home|Tavern|Tower|Church|Townhall|Workshop|Blacksmith|Market|Stables|Windmill)/;
const houses = (PROPS.decorProps ?? []).filter((d) => {
  if (!HOUSE_KEYS.test(d.key)) return false;
  const r = Math.hypot(d.x - cx, d.z - cz);
  return r > PIT_RADIUS + 120 && r < CITY_OUTER_RADIUS;
});

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

describe('Rimholt blocks: rows of houses, plazas and parapets', () => {
  it('builds a dense city within a bounded prop budget', () => {
    expect(houses.length).toBeGreaterThan(2500);
    expect(houses.length).toBeLessThan(9000);
  });

  it('keeps every house off the avenues, the wall faces and the lane ramps', () => {
    for (const d of houses) {
      const x = d.x - cx;
      const z = d.z - cz;
      const hit = nearestAvenue(x, z);
      expect(hit.distance).toBeGreaterThan(avenueHalfWidth(hit.index) + (d.r ?? 0));
      const g = cityGround(x, z);
      expect(g.face).toBeLessThan(0.5);
      // a lane's weight marks its whole bearing across the level, but only the
      // last LANE_RUN yards before the wall behind are ramp
      const r = Math.hypot(x, z);
      const theta = Math.atan2(z, x);
      const level = levelAt(r, theta);
      if (g.lane > 0) {
        expect(wallRadiusAt(level, theta) - r).toBeGreaterThan(LANE_RUN + (d.r ?? 0));
      }
      // and the top of every lane climbing from the level below stays open
      if (level > 0 && r - wallRadiusAt(level - 1, theta) < 12) {
        for (const a of laneAngles(level - 1)) {
          let da = theta - a;
          da -= TAU * Math.round(da / TAU);
          expect(Math.abs(da) * r).toBeGreaterThan(2.6 + (d.r ?? 0));
        }
      }
    }
  });

  it('turns every house front toward the pit', () => {
    for (const d of houses) {
      const toPit = Math.atan2(-(d.x - cx), -(d.z - cz));
      let diff = (d.rot ?? 0) - toPit;
      diff -= TAU * Math.round(diff / TAU);
      expect(Math.abs(diff)).toBeLessThan(0.75);
    }
  });

  it('packs the poor south tighter than the north', () => {
    const count = (district: string) =>
      houses.filter((d) => {
        const r = Math.hypot(d.x - cx, d.z - cz);
        return districtAt(r, Math.atan2(d.z - cz, d.x - cx)) === district;
      }).length;
    expect(count('south')).toBeGreaterThan(count('north'));
  });

  it('lays out the same city every time', () => {
    const again = buildAbyssProps();
    expect(again.decorProps).toEqual(PROPS.decorProps);
    expect(again.fences).toEqual(PROPS.fences);
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

  it('gives the city plazas with wells and stalls, and ring streets to light', () => {
    expect(PROPS.wells.length).toBeGreaterThanOrEqual(15);
    expect(PROPS.stalls.length).toBeGreaterThanOrEqual(PROPS.wells.length);
    // eight avenues, the rim ring, and three terrace ring streets
    expect(abyssRoads()).toHaveLength(CITY_AVENUE_COUNT + 4);
  });
});
