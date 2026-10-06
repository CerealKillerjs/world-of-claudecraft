// Rimholt's procedural houses (src/render/rimholt_buildings_core.ts): the
// triangles every city lot becomes. Pins that each roof form closes over its
// walls and faces the sky, that the house stands on (and into) its ground,
// that colours are the district's and stay in range, and that the build is a
// pure function of the lot.

import { describe, expect, it } from 'vitest';
import {
  appendHouse,
  emptyHouseBuffers,
  type HouseBuffers,
  houseColours,
} from '../src/render/rimholt_buildings_core';
import {
  type BuildingForm,
  buildAbyssProps,
  isRimholtBuilding,
  type RoofForm,
  rimholtBuildingForm,
} from '../src/sim/abyss';

const empty = (): HouseBuffers => emptyHouseBuffers();

function form(roof: RoofForm, over: Partial<BuildingForm> = {}): BuildingForm {
  return {
    district: 'centre',
    storeys: 3,
    storeyHeight: 3.2,
    eave: 9.6,
    roof,
    roofRise: 3,
    chimney: false,
    ...over,
  };
}

const lot = (f: BuildingForm, x = 10, z = -20, rot = 0.6) => ({
  kind: 'rimHouse' as const,
  x,
  z,
  rot,
  hw: 4,
  hd: 6,
  groundMin: 1,
  groundMax: 2,
  form: f,
});

describe('Rimholt house triangles', () => {
  it('closes every roof form over the walls, rising to its ridge', () => {
    for (const roof of ['gable', 'gableFront', 'hip', 'pyramid', 'shed', 'flat'] as const) {
      const buf = empty();
      const tris = appendHouse(buf, lot(form(roof)));
      expect(tris, roof).toBeGreaterThan(20);
      expect(buf.indices.length).toBe(tris * 3);
      expect(buf.normals.length).toBe(buf.positions.length);
      expect(buf.colors.length).toBe(buf.positions.length);
      let top = Number.NEGATIVE_INFINITY;
      let up = 0;
      for (let i = 0; i < buf.positions.length; i += 3) {
        top = Math.max(top, buf.positions[i + 1]);
        if (buf.normals[i + 1] > 0.3 * 127) up++;
      }
      // eave 9.6 above the floor (ground 2), then the roof's rise
      expect(top, roof).toBeCloseTo(2 + 9.6 + 3, 5);
      // something faces the sky (the roof)
      expect(up, roof).toBeGreaterThan(0);
    }
  });

  it('turns every face outward with unit normals', () => {
    const buf = empty();
    const x = 10;
    const z = -20;
    appendHouse(buf, lot(form('hip'), x, z));
    for (let t = 0; t < buf.indices.length; t += 3) {
      const [a, b, c] = [buf.indices[t], buf.indices[t + 1], buf.indices[t + 2]];
      const nx = buf.normals[a * 3] / 127;
      const ny = buf.normals[a * 3 + 1] / 127;
      const nz = buf.normals[a * 3 + 2] / 127;
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 1);
      // a face's centre sits on the side of the house its normal points to
      // (walls and openings outward, roof upward), so nothing is inside out
      const px = (i: number) => buf.positions[i * 3];
      const pz = (i: number) => buf.positions[i * 3 + 2];
      const fx = (px(a) + px(b) + px(c)) / 3 - x;
      const fz = (pz(a) + pz(b) + pz(c)) / 3 - z;
      if (Math.abs(ny) < 0.5 && Math.hypot(fx, fz) > 1.5) {
        expect(nx * fx + nz * fz).toBeGreaterThan(0);
      }
    }
  });

  it('sinks the walls below the lowest ground', () => {
    const buf = empty();
    appendHouse(buf, lot(form('gable')));
    let bottom = Number.POSITIVE_INFINITY;
    for (let i = 1; i < buf.positions.length; i += 3) bottom = Math.min(bottom, buf.positions[i]);
    expect(bottom).toBeLessThan(1);
  });

  it('paints in the district palette, in range, the same every time', () => {
    const north = houseColours(lot(form('gable', { district: 'north' })));
    const east = houseColours(lot(form('gable', { district: 'east' })));
    const luma = (c: readonly number[]) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
    // the limewashed north is lighter than the brick and soot of the east,
    // over a street of houses
    const meanWall = (district: BuildingForm['district']) => {
      let sum = 0;
      for (let i = 0; i < 60; i++) {
        sum += luma(houseColours(lot(form('gable', { district }), i * 9.5, -20)).wall);
      }
      return sum / 60;
    };
    expect(meanWall('north')).toBeGreaterThan(meanWall('east') * 1.3);
    for (const c of [north.wall, north.roof, east.wall, east.roof]) {
      for (const v of c) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    // terracotta: most roofs are red-dominant (a few slate ones in the north)
    let red = 0;
    for (let i = 0; i < 60; i++) {
      const roof = houseColours(lot(form('gable', { district: 'north' }), i * 9.5, -20)).roof;
      if (roof[0] > roof[2] * 1.5) red++;
    }
    expect(red).toBeGreaterThan(36);
    expect(red).toBeLessThan(60);
    const a = empty();
    const b = empty();
    appendHouse(a, lot(form('hip')));
    appendHouse(b, lot(form('hip')));
    expect(a).toEqual(b);
  });

  it('builds every lot the city lays out within a bounded triangle budget', () => {
    const houses = (buildAbyssProps().decorProps ?? []).filter((d) => isRimholtBuilding(d.key));
    const buf = empty();
    let tris = 0;
    for (const d of houses) {
      if (!isRimholtBuilding(d.key)) continue;
      tris += appendHouse(buf, {
        kind: d.key,
        x: d.x,
        z: d.z,
        rot: d.rot ?? 0,
        hw: d.hw ?? 0,
        hd: d.hd ?? 0,
        groundMin: 0,
        groundMax: 0,
        form: rimholtBuildingForm(d.key, d.x, d.z, d.hw ?? 0, d.hd ?? 0),
      });
      buf.positions.length = 0;
      buf.normals.length = 0;
      buf.colors.length = 0;
      buf.indices.length = 0;
    }
    // the whole city, every house on every tier
    expect(tris / houses.length).toBeLessThan(160);
    expect(tris).toBeLessThan(2_600_000);
  });
});
