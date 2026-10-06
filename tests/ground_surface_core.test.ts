// The built-surface terrain paint (src/render/ground_surface_core.ts): what a
// code-built world's paving, streets, wall faces and bare earth do to a
// terrain vertex, and that a garden plot stays grass in a tended green.

import { describe, expect, it } from 'vitest';
import {
  groundSurfacePaintInto,
  makeGroundSurfacePaint,
  surfaceGrassTint,
} from '../src/render/ground_surface_core';
import type { GroundSurface } from '../src/sim/types';

const LAYERS = { grass: 0, dirt: 1, rock: 2, sand: 3 } as const;

function paint(surface: GroundSurface, x = 10.3, z = -4.7, h = 3.2) {
  const out = makeGroundSurfacePaint();
  const applied = groundSurfacePaintInto(surface, x, z, h, out);
  return { applied, out };
}

function dominant(splat: readonly number[]): number {
  return splat.indexOf(Math.max(...splat));
}

const channels = (hex: number) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

describe('ground surface paint', () => {
  it('keeps a garden plot grass, in the fresh green of the guide', () => {
    const { applied, out } = paint('garden');
    expect(applied).toBe(true);
    expect(dominant(out.splat)).toBe(LAYERS.grass);
    const [r, g, b] = channels(out.tint);
    expect(g).toBeGreaterThan(r + 40);
    expect(g).toBeGreaterThan(b + 40);
    expect(g).toBeGreaterThan(140);
  });

  it('lays stone with no grass under every built surface', () => {
    for (const s of ['paving', 'street', 'masonry', 'earth'] as const) {
      const { applied, out } = paint(s);
      expect(applied, s).toBe(true);
      expect(out.splat.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      expect(out.splatWeight).toBe(1);
      expect(out.tintWeight).toBeGreaterThan(0.8);
      if (s !== 'earth') expect(out.splat[LAYERS.grass]).toBe(0);
    }
  });

  it('paves in pale sandstone, cobbles in stone, faces walls in stone, bares earth', () => {
    expect(dominant(paint('paving').out.splat)).toBe(LAYERS.sand);
    expect(dominant(paint('street').out.splat)).toBe(LAYERS.rock);
    expect(dominant(paint('masonry').out.splat)).toBe(LAYERS.rock);
    expect(dominant(paint('earth').out.splat)).toBe(LAYERS.dirt);
  });

  it('tints paving warm and light, with a few terracotta stones', () => {
    let brick = 0;
    let total = 0;
    for (let x = 0; x < 200; x += 2.2) {
      for (let z = 0; z < 200; z += 2.2) {
        const [r, g, b] = channels(paint('paving', x, z).out.tint);
        total++;
        expect(r).toBeGreaterThanOrEqual(g);
        expect(g).toBeGreaterThan(b);
        if (r - b > 90) brick++;
      }
    }
    expect(brick / total).toBeGreaterThan(0.01);
    expect(brick / total).toBeLessThan(0.1);
  });

  it('varies stone to stone and course to course, deterministically', () => {
    const tints = new Set<number>();
    for (let x = 0; x < 40; x += 2.2) tints.add(paint('paving', x, 0).out.tint);
    expect(tints.size).toBeGreaterThan(1);
    const courses = new Set<number>();
    for (let h = 0; h < 12; h += 0.9) courses.add(paint('masonry', 5, 5, h).out.tint);
    expect(courses.size).toBeGreaterThan(1);
    expect(paint('street', 7.1, 3.3).out).toEqual(paint('street', 7.1, 3.3).out);
  });

  it('grows garden blades in the same green the plot is painted, and no other surface', () => {
    const plot = paint('garden', 0.5, 0.5).out.tint;
    const blades = surfaceGrassTint('garden') as number;
    const [r, g, b] = channels(blades);
    expect(g).toBeGreaterThan(r + 40);
    expect(g).toBeGreaterThan(b + 40);
    // the plot alternates two greens by bed; the blades take the lighter one
    expect(channels(plot)[1]).toBeLessThanOrEqual(g);
    for (const s of ['paving', 'street', 'masonry', 'earth'] as const) {
      expect(surfaceGrassTint(s), s).toBeNull();
    }
    expect(surfaceGrassTint(null)).toBeNull();
  });
});
