// The abyss world pack (src/sim/abyss/ + src/sim/content/abyss_world.ts): the
// real-scale constants, the analytic terrain model, the region tiling, the
// boot parser, and an offline Sim standing on the new ground. The built-in
// world must stay exactly as it was whenever the pack is not active.

import { afterEach, describe, expect, it } from 'vitest';
import { parseWorldPackRequest } from '../src/game/world_pack_boot';
import {
  ABYSS_CENTER,
  ABYSS_LAYERS,
  ABYSS_PLAYER_START,
  ABYSS_REGIONS,
  ABYSS_TILE,
  abyssBiomeAt,
  abyssIsOpenSea,
  abyssRegionAt,
  abyssTerrainHeight,
  buildAbyssTiles,
  CITY_OUTER_RADIUS,
  CITY_TOP_HEIGHT,
  depthMetersAtY,
  LAYER1_CAMP_CENTER,
  LAYER1_FLOOR_RADIUS,
  LAYER1_FLOOR_Y,
  layerAtDepthMeters,
  layerFloorY,
  metersToYards,
  PIT_RADIUS,
  SPIRAL_END_PHI,
  SPIRAL_GRADE,
  SPIRAL_START_ANGLE,
  spiralHeightAt,
  spiralPointAt,
  WORLD_HALF_EXTENT,
} from '../src/sim/abyss';
import { abyssWorld } from '../src/sim/content/abyss_world';

const ABYSS_WORLD = abyssWorld();

import {
  NAMED_ZONES,
  setActiveWorldContent,
  WORLD_MAX_Z,
  WORLD_MIN_Z,
  zoneAt,
  zoneRegionId,
} from '../src/sim/data';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { Sim } from '../src/sim/sim';
import { isOpenSeaAt, terrainHeight, zoneBiomeAt } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';
import { enteredNewZoneRegion } from '../src/ui/zone_region_entry';

const SEED = WORLD_SEED;
const cx = ABYSS_CENTER.x;
const cz = ABYSS_CENTER.z;
const h = (x: number, z: number) => abyssTerrainHeight(x, z, SEED);
/** World point at radius r and angle theta around the pit's axis. */
const polar = (r: number, theta: number) => ({
  x: cx + Math.cos(theta) * r,
  z: cz + Math.sin(theta) * r,
});

afterEach(() => setActiveWorldContent(null));

describe('abyss geometry: the reference depths at 1:1 scale', () => {
  it('converts metres to yards and places layer floors by published depth', () => {
    expect(metersToYards(1000)).toBeCloseTo(1093.61, 1);
    expect(LAYER1_FLOOR_Y).toBeCloseTo(-1476.38, 1);
    expect(layerFloorY(2)).toBeCloseTo(-metersToYards(2600), 6);
    expect(() => layerFloorY(ABYSS_LAYERS.length)).toThrow();
  });

  it('reads depth below the rim and the layer it falls in', () => {
    expect(depthMetersAtY(5)).toBe(0);
    expect(layerAtDepthMeters(0)).toBe(0);
    expect(layerAtDepthMeters(10)).toBe(1);
    expect(layerAtDepthMeters(1350)).toBe(2);
    expect(layerAtDepthMeters(20000)).toBe(7);
    expect(layerAtDepthMeters(depthMetersAtY(LAYER1_FLOOR_Y + 1))).toBe(1);
  });

  it('keeps the island clear of the built-in world and inside the memo range', () => {
    expect(cz + WORLD_HALF_EXTENT).toBeLessThan(WORLD_MIN_Z);
    expect(WORLD_MAX_Z).toBeGreaterThan(cz);
    expect(Math.abs(cz - WORLD_HALF_EXTENT)).toBeLessThan(8192);
    // the pit's mouth is the reference's ~1,000 m opening
    expect(PIT_RADIUS * 2).toBeGreaterThan(metersToYards(990));
    expect(PIT_RADIUS * 2).toBeLessThan(metersToYards(1010));
  });
});

describe('abyss terrain: the spiral descent through layer 1', () => {
  it('leaves the rim at its top and ends on the layer 1 floor', () => {
    expect(spiralHeightAt(0)).toBe(0);
    expect(spiralHeightAt(SPIRAL_END_PHI)).toBe(LAYER1_FLOOR_Y);
    expect(SPIRAL_END_PHI / (Math.PI * 2)).toBeGreaterThan(2);
    expect(SPIRAL_END_PHI / (Math.PI * 2)).toBeLessThan(2.6);
    const start = spiralPointAt(0);
    expect(Math.atan2(start.z - cz, start.x - cx)).toBeCloseTo(SPIRAL_START_ANGLE, 6);
  });

  it('descends at the design grade along the ledge centre', () => {
    for (const phi of [0.5, 3, 7, SPIRAL_END_PHI - 1]) {
      const a = spiralPointAt(phi);
      const b = spiralPointAt(phi + 0.01);
      const run = Math.hypot(b.x - a.x, b.z - a.z);
      expect((a.y - b.y) / run).toBeCloseTo(SPIRAL_GRADE, 2);
      expect(SPIRAL_GRADE).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE);
    }
  });

  it('puts the ground on the ledge where the path says it is', () => {
    for (const phi of [0.4, 2.2, 5.1, 9, SPIRAL_END_PHI - 0.3]) {
      const p = spiralPointAt(phi);
      // meadow sectors roll a little; the path itself stays within a yard or two
      expect(Math.abs(h(p.x, p.z) - p.y)).toBeLessThan(2.5);
    }
  });

  it('walls the turns apart with cliffs too steep to walk', () => {
    for (const phi of [1, 4, 8]) {
      const p = spiralPointAt(phi);
      const r = Math.hypot(p.x - cx, p.z - cz);
      const inner = polar(r - 50, p.theta);
      const inner2 = polar(r - 54, p.theta);
      const slope = Math.abs(h(inner.x, inner.z) - h(inner2.x, inner2.z)) / 4;
      expect(slope).toBeGreaterThan(PLAYER_MAX_CLIMB_SLOPE);
    }
  });

  it('floors out at 1,350 m below the rim inside the last turn', () => {
    expect(LAYER1_FLOOR_RADIUS).toBeGreaterThan(200);
    for (const [dx, dz] of [
      [0, 0],
      [60, 40],
      [-120, 90],
    ]) {
      expect(Math.abs(h(cx + dx, cz + dz) - LAYER1_FLOOR_Y)).toBeLessThan(4);
    }
    expect(Math.hypot(LAYER1_CAMP_CENTER.x - cx, LAYER1_CAMP_CENTER.z - cz)).toBeLessThan(
      LAYER1_FLOOR_RADIUS - 30,
    );
  });

  it('holds no water in the pit although it sinks far below the sea', () => {
    expect(abyssIsOpenSea(cx, cz, SEED, -4.3)).toBe(false);
    const sea = polar(WORLD_HALF_EXTENT - 5, 0.3);
    expect(abyssIsOpenSea(sea.x, sea.z, SEED, -4.3)).toBe(true);
    setActiveWorldContent(ABYSS_WORLD);
    expect(isOpenSeaAt(cx + 30, cz - 20, SEED)).toBe(false);
    expect(isOpenSeaAt(sea.x, sea.z, SEED)).toBe(true);
  });

  it('is a pure function of position and seed', () => {
    const p = polar(300, 1.1);
    expect(h(p.x, p.z)).toBe(h(p.x, p.z));
    // the seed only roughens the ground, it never moves the structure
    expect(Math.abs(abyssTerrainHeight(cx, cz, SEED + 1) - h(cx, cz))).toBeLessThan(6);
  });
});

describe('abyss terrain: the terraced city around the rim', () => {
  // the street plan, walls, lanes and avenues are pinned in abyss_city.test.ts
  it('stands at the rim height on the plaza and climbs to the city edge', () => {
    const rim = polar(PIT_RADIUS + 5, 0.4);
    expect(Math.abs(h(rim.x, rim.z))).toBeLessThan(0.5);
    const top = polar(CITY_OUTER_RADIUS, SPIRAL_START_ANGLE + 0.4);
    expect(h(top.x, top.z)).toBeCloseTo(CITY_TOP_HEIGHT, 0);
    expect(CITY_TOP_HEIGHT).toBeGreaterThan(40);
  });
});

describe('abyss regions and streaming tiles', () => {
  it('names the pit, the city, and the island by distance from the axis', () => {
    expect(abyssRegionAt(cx, cz).id).toBe('the_sounding');
    const plaza = polar(PIT_RADIUS + 40, 2);
    expect(abyssRegionAt(plaza.x, plaza.z).id).toBe('rimholt');
    const farm = polar(CITY_OUTER_RADIUS + 300, 2);
    expect(abyssRegionAt(farm.x, farm.z).id).toBe('vaharra_isle');
    expect(abyssBiomeAt(cx, cz)).toBe('jungle');
    expect(NAMED_ZONES.map((z) => z.id)).toEqual(
      expect.arrayContaining(ABYSS_REGIONS.map((z) => z.id)),
    );
  });

  it('tiles the island square with unique ids that resolve to a region', () => {
    const tiles = buildAbyssTiles();
    const n = Math.round((WORLD_HALF_EXTENT * 2) / ABYSS_TILE);
    expect(tiles).toHaveLength(n * n);
    expect(new Set(tiles.map((t) => t.id)).size).toBe(tiles.length);
    const regionIds = new Set(ABYSS_REGIONS.map((r) => r.id));
    for (const t of tiles) {
      expect(regionIds.has(zoneRegionId(t.id))).toBe(true);
      const xMin = t.xMin ?? Number.NaN;
      const xMax = t.xMax ?? Number.NaN;
      expect(xMax - xMin).toBe(ABYSS_TILE);
      expect(t.hub.x).toBe((xMin + xMax) / 2);
    }
    const minX = Math.min(...tiles.map((t) => t.xMin ?? 0));
    const maxZ = Math.max(...tiles.map((t) => t.zMax));
    expect(minX).toBe(cx - WORLD_HALF_EXTENT);
    expect(maxZ).toBe(cz + WORLD_HALF_EXTENT);
  });

  it('normalizes tile ids to their region and leaves plain zone ids alone', () => {
    expect(zoneRegionId('rimholt@3_4')).toBe('rimholt');
    expect(zoneRegionId('eastbrook')).toBe('eastbrook');
    expect(enteredNewZoneRegion('rimholt@3_4', 'rimholt@4_4')).toBe(false);
    expect(enteredNewZoneRegion('the_sounding@5_5', 'rimholt@4_4')).toBe(true);
    expect(enteredNewZoneRegion('eastbrook', 'eastbrook')).toBe(false);
  });
});

describe('abyss world pack: boot and the live terrain seam', () => {
  it('parses a world-pack boot request from the URL', () => {
    const req = parseWorldPackRequest('?world=abyss&class=mage&name=%20Ilse%20');
    expect(req?.content).toBe(ABYSS_WORLD);
    expect(req?.playerClass).toBe('mage');
    expect(req?.playerName).toBe('Ilse');
    expect(req?.seed).toBe(WORLD_SEED);
    const fallback = parseWorldPackRequest('?world=abyss&class=dragon');
    expect(fallback?.playerClass).toBe('warrior');
    expect(fallback?.playerName).toBe('Sounder');
    expect(parseWorldPackRequest('?world=elsewhere')).toBeNull();
    expect(parseWorldPackRequest('')).toBeNull();
    expect(parseWorldPackRequest('?world=toString')).toBeNull();
  });

  it('routes terrain reads to the model only while the pack is active', () => {
    const p = polar(PIT_RADIUS + 60, 1.3);
    const builtin = terrainHeight(p.x, p.z, SEED);
    setActiveWorldContent(ABYSS_WORLD);
    expect(terrainHeight(p.x, p.z, SEED)).toBe(h(p.x, p.z));
    expect(zoneBiomeAt(cx, cz)).toBe('jungle');
    setActiveWorldContent(null);
    expect(terrainHeight(p.x, p.z, SEED)).toBe(builtin);
  });

  it('boots an offline Sim on the rim plaza and keeps it standing there', () => {
    setActiveWorldContent(ABYSS_WORLD);
    const sim = new Sim({
      seed: SEED,
      playerClass: 'hunter',
      playerName: 'Ilse',
      world: ABYSS_WORLD,
      riftPortals: false,
      compulsoryTutorial: false,
    });
    const player = sim.entities.get(sim.playerId);
    expect(player).toBeDefined();
    if (!player) return;
    expect(
      Math.hypot(player.pos.x - ABYSS_PLAYER_START.x, player.pos.z - ABYSS_PLAYER_START.z),
    ).toBeLessThan(3);
    for (let i = 0; i < 40; i++) sim.tick();
    expect(Math.abs(player.pos.y - terrainHeight(player.pos.x, player.pos.z, SEED))).toBeLessThan(
      0.5,
    );
    expect(zoneRegionId(zoneAt(player.pos.x, player.pos.z).id)).toBe('rimholt');
    expect(player.hp).toBeGreaterThan(0);
  });
});
