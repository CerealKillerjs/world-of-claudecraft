// The terrain paint for a BUILT surface: the stone paving, cobbled streets,
// and masonry wall faces a code-built world lays over its ground (the terrain
// model's surfaceAt hook; the abyss world's rim city is the first user).
//
// Pure decision logic (no Three, no DOM): which colour the terrain vertex
// tint moves toward and which splat layers the vertex takes. The chunk
// builder (terrain_chunk_build.ts) applies it after every natural-ground arm,
// so a paved street is never re-greened, re-rocked, or snowed on.
//
// The tint is an sRGB hex like the rest of the terrain palette; the builder
// converts it. Cells are jittered per laid stone so the vertex grid reads as
// set stones of slightly different shades, not one flat pour. The photo
// layers carry only part of the vertex tint, so the splat choice does most of
// the work: the beige sand layer for pale paving, the stone layer for worn
// cobbles and wall faces.

import { hash2 } from '../sim/rng';
import type { GroundSurface } from '../sim/types';

/** What a built surface does to one terrain vertex. */
export interface GroundSurfacePaint {
  /** sRGB hex the vertex tint moves toward, and how far (0..1). */
  tint: number;
  tintWeight: number;
  /** Target splat weights (grass, dirt, rock, sand; sum 1) and how far the
   *  vertex's weights move toward them (0..1). */
  splat: [number, number, number, number];
  splatWeight: number;
}

// The city palette from the art guide: sandstone with terracotta accents.
const SANDSTONE = 0xd9c3a0;
const SANDSTONE_DARK = 0xc4ad88;
const SANDSTONE_PALE = 0xe6d7bc;
const BRICK = 0xb86a48; // a weathered terracotta stone, a few per hundred
const COBBLE = 0xb5a587;
const COBBLE_DARK = 0xa08f72;
const COBBLE_PALE = 0xc6b79b;
const ASHLAR = 0xcbb28c;
const ASHLAR_DARK = 0xb39a75;
const EARTH = 0x8c6e4c;
const EARTH_DARK = 0x765b3e;
// tended plots: the guide's fresh green, a little darker in alternate beds
const GARDEN = 0x6aa452;
const GARDEN_DARK = 0x5e9e4a;

/** Side of one laid stone's colour cell (yards). */
const PAVING_CELL = 2.2;
const COBBLE_CELL = 1.6;
/** Height of one masonry course, and the length of one block along it. */
const COURSE = 0.9;
const BLOCK = 1.8;

const SALT = 0x51ab;

function cellHash(x: number, z: number, size: number, salt: number): number {
  return hash2(Math.floor(x / size), Math.floor(z / size), SALT + salt);
}

function set(
  out: GroundSurfacePaint,
  tint: number,
  tintWeight: number,
  grass: number,
  dirt: number,
  rock: number,
  sand: number,
): true {
  out.tint = tint;
  out.tintWeight = tintWeight;
  out.splat[0] = grass;
  out.splat[1] = dirt;
  out.splat[2] = rock;
  out.splat[3] = sand;
  out.splatWeight = 1;
  return true;
}

/** The colour a surface's grass blades and grass layer grow in, or null
 *  where the surface keeps the biome's own grass (or grows none). The
 *  garden paint moves the ground toward this same green, so the blades a
 *  tended plot grows match the plot under them. */
export function surfaceGrassTint(surface: GroundSurface | null): number | null {
  return surface === 'garden' ? GARDEN : null;
}

/** How far a surface's grass moves from the biome grass toward its tint. */
export const SURFACE_GRASS_TINT_WEIGHT = 0.75;

/** A reusable paint record for the hot loop. */
export function makeGroundSurfacePaint(): GroundSurfacePaint {
  return { tint: SANDSTONE, tintWeight: 0, splat: [1, 0, 0, 0], splatWeight: 0 };
}

/**
 * Fill `out` with the paint for `surface` at (x, z) on ground of height h.
 * Returns true when `out` holds a paint to apply (every surface today; false
 * is kept for a surface that leaves the natural ground alone).
 */
export function groundSurfacePaintInto(
  surface: GroundSurface,
  x: number,
  z: number,
  h: number,
  out: GroundSurfacePaint,
): boolean {
  switch (surface) {
    case 'paving': {
      const c = cellHash(x, z, PAVING_CELL, 1);
      const tint =
        c < 0.04 ? BRICK : c < 0.36 ? SANDSTONE_DARK : c < 0.62 ? SANDSTONE_PALE : SANDSTONE;
      return set(out, tint, 0.92, 0, 0, 0.35, 0.65);
    }
    case 'street': {
      const c = cellHash(x, z, COBBLE_CELL, 2);
      const tint = c < 0.33 ? COBBLE_DARK : c < 0.6 ? COBBLE_PALE : COBBLE;
      return set(out, tint, 0.92, 0, 0.1, 0.65, 0.25);
    }
    case 'masonry': {
      // courses run level; blocks in alternate courses are offset by half
      const course = Math.floor(h / COURSE);
      const along = (x + z) / BLOCK + (course % 2) * 0.5;
      const c = hash2(course, Math.floor(along), SALT + 3);
      return set(out, c < 0.4 ? ASHLAR_DARK : ASHLAR, 0.95, 0, 0, 0.85, 0.15);
    }
    case 'earth': {
      const c = cellHash(x, z, 3.5, 4);
      return set(out, c < 0.45 ? EARTH_DARK : EARTH, 0.85, 0.08, 0.8, 0.12, 0);
    }
    case 'garden': {
      // a watered, tended green rather than the island's dark wild grass;
      // the grass layer stays, so the plot still grows its blades
      const c = cellHash(x, z, 4, 5);
      out.tint = c < 0.5 ? GARDEN_DARK : GARDEN;
      out.tintWeight = 0.7;
      out.splat[0] = 0.85;
      out.splat[1] = 0.15;
      out.splat[2] = 0;
      out.splat[3] = 0;
      out.splatWeight = 0.6;
      return true;
    }
  }
}
