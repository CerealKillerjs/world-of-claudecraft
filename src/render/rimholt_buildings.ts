// Rimholt's houses on screen: every procedural building the abyss world's
// city lays out (decorProps rows whose key is a Rimholt building kind,
// src/sim/abyss/city_blocks.ts) built as flat-shaded, vertex-coloured
// triangles by the pure core (rimholt_buildings_core.ts) and gathered into
// one mesh per city cell.
//
// GPU contract: ONE material for every house (vertex colours, no texture),
// prewarmed through the props material prewarm (props.ts lists
// rimholtBuildingsPrewarmParts). The cell meshes stay out of the props
// static merge (they are already merged, and its strips would copy them
// again at a coarser grain) and stay off the props fog cull: the terraces
// reading across the whole city is the look, so each cell is culled by the
// camera frustum alone.
// Geometry is indexed with byte normals and colours to keep the whole city
// (about a million triangles) small in memory. Built once into the
// props root at load; nothing here runs per frame. Every house is drawn on
// every tier: each one is a wall the player walks into.

import * as THREE from 'three';
import { isRimholtBuilding, rimholtBuildingForm } from '../sim/abyss';
import type { ZonePropsDef } from '../sim/types';
import { appendHouse, emptyHouseBuffers, type HouseBuffers } from './rimholt_buildings_core';

type DecorProp = NonNullable<ZonePropsDef['decorProps']>[number];

/** Side of the square cells the houses are gathered into, yards. */
const CELL = 160;

let material: THREE.MeshStandardMaterial | null = null;

function houseMaterial(): THREE.MeshStandardMaterial {
  material ??= new THREE.MeshStandardMaterial({
    name: 'rimholtHouses',
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
  });
  return material;
}

/** The attribute layout every house mesh (and its prewarm twin) shares. */
function houseGeometry(
  positions: Float32Array,
  normals: Int8Array,
  colors: Uint8Array,
  indices: Uint32Array,
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3, true));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

/** One cell's houses as a mesh, in world coordinates (the props cull list
 *  reads its bounds as world bounds). */
function cellMesh(buf: HouseBuffers): THREE.Mesh {
  const geo = houseGeometry(
    Float32Array.from(buf.positions),
    Int8Array.from(buf.normals),
    Uint8Array.from(buf.colors),
    Uint32Array.from(buf.indices),
  );
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, houseMaterial());
  mesh.name = 'rimholtHouses';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Build every Rimholt house among `decor` into cell meshes, standing on
 *  `ground`. Empty for a world without the city. */
export function buildRimholtBuildings(
  decor: readonly DecorProp[],
  ground: (x: number, z: number) => number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'rimholtBuildings';
  const cells = new Map<string, HouseBuffers>();
  for (const d of decor) {
    if (!isRimholtBuilding(d.key) || d.hw === undefined || d.hd === undefined) continue;
    const rot = d.rot ?? 0;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    let groundMin = ground(d.x, d.z);
    let groundMax = groundMin;
    for (const [u, v] of [
      [-d.hw, -d.hd],
      [d.hw, -d.hd],
      [d.hw, d.hd],
      [-d.hw, d.hd],
    ]) {
      const y = ground(d.x + u * c + v * s, d.z - u * s + v * c);
      groundMin = Math.min(groundMin, y);
      groundMax = Math.max(groundMax, y);
    }
    const key = `${Math.floor(d.x / CELL)}:${Math.floor(d.z / CELL)}`;
    let buf = cells.get(key);
    if (!buf) {
      buf = emptyHouseBuffers();
      cells.set(key, buf);
    }
    appendHouse(buf, {
      kind: d.key,
      x: d.x,
      z: d.z,
      rot,
      hw: d.hw,
      hd: d.hd,
      groundMin,
      // the floor at the highest corner, but never far above the lowest (a
      // lot astride a slope would lift its whole house otherwise)
      groundMax: Math.min(groundMax, groundMin + 1.5),
      form: rimholtBuildingForm(d.key, d.x, d.z, d.hw, d.hd),
    });
  }
  for (const buf of cells.values()) group.add(cellMesh(buf));
  return group;
}

/** The houses' one (geometry, material) program, for the props material
 *  prewarm (props.ts): a single triangle with the same attribute layout. */
export function rimholtBuildingsPrewarmParts(): {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}[] {
  const geometry = houseGeometry(
    new Float32Array(9),
    new Int8Array([0, 127, 0, 0, 127, 0, 0, 127, 0]),
    new Uint8Array(9).fill(255),
    new Uint32Array([0, 1, 2]),
  );
  return [{ geometry, material: houseMaterial() }];
}
