// The terrain chunk paint with the abyss world pack active
// (src/render/terrain_chunk_build.ts on a code-built world's terrain model):
// the city's built surfaces reach the vertex splat, the dry pit below the
// waterline never reads as a beach, and the built-in world's rim haze and
// snowline never paint the island.

import { afterEach, describe, expect, it } from 'vitest';
import {
  beginChunkGeometry,
  type ChunkGeometryBuildState,
  fillChunkVertexRow,
} from '../src/render/terrain_chunk_build';
import { ABYSS_CENTER, avenueAngleAt, CITY_OUTER_RADIUS, PIT_RADIUS } from '../src/sim/abyss';
import { abyssWorld } from '../src/sim/content/abyss_world';
import { setActiveWorldContent } from '../src/sim/data';
import { WORLD_SEED } from '../src/sim/world_seed';

afterEach(() => setActiveWorldContent(null));

const SIZE = 8;
const SPACING = 2;

/** Build one small chunk centred on WORLD (x, z) and return its middle
 *  vertex's splat (grass, dirt, rock, sand) and extras (mud, snow, ...). */
function vertexAt(x: number, z: number) {
  const state: ChunkGeometryBuildState = beginChunkGeometry(
    x - SIZE / 2,
    z - SIZE / 2,
    SIZE,
    SPACING,
    WORLD_SEED,
    true,
    SPACING,
    false,
  );
  for (let gj = 0; gj < state.gh; gj++) fillChunkVertexRow(state, gj);
  const mid = Math.floor(state.gh / 2) * state.gw + Math.floor(state.gw / 2);
  const splats = state.splats ?? new Float32Array(0);
  const extras = state.extras ?? new Float32Array(0);
  return {
    splat: Array.from(splats.subarray(mid * 4, mid * 4 + 4)),
    snow: extras[mid * 4 + 1],
    color: Array.from(state.colors.subarray(mid * 3, mid * 3 + 3)),
  };
}

const polar = (r: number, theta: number) => ({
  x: ABYSS_CENTER.x + Math.cos(theta) * r,
  z: ABYSS_CENTER.z + Math.sin(theta) * r,
});

describe('terrain paint on the abyss world', () => {
  it('paves the rim plaza and cobbles the avenues', () => {
    setActiveWorldContent(abyssWorld());
    // a rim plaza point between two stair lanes, off every street
    const plaza = polar(PIT_RADIUS + 40, 0.38);
    const p = vertexAt(plaza.x, plaza.z);
    expect(p.splat[0]).toBeLessThan(0.05); // no grass
    expect(p.splat[3]).toBeGreaterThan(0.5); // pale sand-stone paving
    const av = polar(1000, avenueAngleAt(2, 1000));
    const a = vertexAt(av.x, av.z);
    expect(a.splat[2]).toBeGreaterThan(0.5); // cobbles on the stone layer
  });

  it('never paints the dry pit as a beach', () => {
    setActiveWorldContent(abyssWorld());
    const floor = polar(60, 1.2);
    const f = vertexAt(floor.x, floor.z);
    expect(f.splat[3]).toBeLessThan(0.05);
  });

  it('keeps the built-in rim haze and snowline off the island', () => {
    setActiveWorldContent(abyssWorld());
    const farm = polar(CITY_OUTER_RADIUS + 120, 2.2);
    const v = vertexAt(farm.x, farm.z);
    expect(v.snow).toBe(0);
    expect(v.splat[0]).toBeGreaterThan(0.4); // grassland, not rim rock
    // a green field, not the pale blue rim haze
    expect(v.color[1]).toBeGreaterThan(v.color[2]);
  });
});
