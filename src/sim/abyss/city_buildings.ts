// Rimholt's buildings as SHAPES: what kind each lot holds, and the form a
// kind takes in its district (storeys, storey height, roof, chimney). The
// sim reads the form for the collider's height; the renderer reads the same
// form to build the house (src/render/rimholt_buildings_core.ts), so what is
// drawn and what the camera stops against never come apart.
//
// Every choice is a hash of the lot's position: no Rng, no world seed.

import { hash2 } from '../rng';
import { type CityDistrict, districtAt } from './city_plan';
import { ABYSS_CENTER } from './geometry';

const SALT = 0x4b1d;

/** The decor keys Rimholt's procedural buildings use. */
export const RIMHOLT_BUILDING_KINDS = [
  'rimHouse',
  'rimTall',
  'rimTower',
  'rimHall',
  'rimWorkshop',
  'rimShack',
  'rimCottage',
] as const;
export type RimholtBuildingKind = (typeof RIMHOLT_BUILDING_KINDS)[number];

const KIND_SET: ReadonlySet<string> = new Set(RIMHOLT_BUILDING_KINDS);

export function isRimholtBuilding(key: string): key is RimholtBuildingKind {
  return KIND_SET.has(key);
}

export type RoofForm = 'gable' | 'gableFront' | 'hip' | 'pyramid' | 'shed' | 'flat';

export interface BuildingForm {
  district: CityDistrict;
  storeys: number;
  storeyHeight: number;
  /** Eave height above the ground. */
  eave: number;
  roof: RoofForm;
  roofRise: number;
  chimney: boolean;
}

/** Storey range per district for an ordinary house. */
const HOUSE_STOREYS: Readonly<Record<CityDistrict, readonly [number, number]>> = {
  centre: [3, 4],
  south: [2, 3],
  east: [2, 3],
  north: [3, 4],
  west: [1, 2],
};

function between(lo: number, hi: number, roll: number): number {
  return lo + Math.min(hi - lo, Math.floor(roll * (hi - lo + 1)));
}

/** The form of a building of `kind` standing at WORLD (x, z) with half
 *  extents hw (along its street) and hd (its depth). */
export function rimholtBuildingForm(
  kind: RimholtBuildingKind,
  x: number,
  z: number,
  hw: number,
  hd: number,
): BuildingForm {
  const lx = x - ABYSS_CENTER.x;
  const lz = z - ABYSS_CENTER.z;
  const district = districtAt(Math.hypot(lx, lz), Math.atan2(lz, lx));
  // hashed on the position rounded to an eighth of a yard: the lot's float
  // coordinates come out of trig, and a last-bit difference between JS
  // engines must not change a house's height between hosts
  const qx = Math.round(x * 8);
  const qz = Math.round(z * 8);
  const roll = (n: number) => hash2(qx + n * 7919, qz - n * 104729, SALT);
  const [lo, hi] = HOUSE_STOREYS[district];
  let storeys = between(lo, hi, roll(1));
  let storeyHeight = 3.2;
  let roof: RoofForm;
  let chimney = false;
  const pick = roll(2);
  switch (kind) {
    case 'rimTall':
      storeys += 2;
      roof = pick < 0.5 ? 'gable' : pick < 0.8 ? 'hip' : 'flat';
      chimney = roll(3) < 0.4;
      break;
    case 'rimTower':
      storeys = between(5, 7, roll(1));
      roof = 'pyramid';
      break;
    case 'rimHall':
      storeys = 3;
      storeyHeight = 4.2;
      roof = 'hip';
      break;
    case 'rimWorkshop':
      storeys = between(1, 2, roll(1));
      storeyHeight = 3.8;
      roof = pick < 0.5 ? 'shed' : 'gable';
      chimney = roll(3) < 0.75;
      break;
    case 'rimShack':
      storeys = between(1, 2, roll(1));
      storeyHeight = 2.8;
      roof = 'shed';
      break;
    case 'rimCottage':
      storeys = between(1, 2, roll(1));
      storeyHeight = 3;
      roof = pick < 0.8 ? 'gable' : 'hip';
      chimney = roll(3) < 0.6;
      break;
    default: {
      const flat = district === 'centre' || district === 'north' ? 0.15 : 0.08;
      roof =
        pick < flat
          ? 'flat'
          : pick < flat + 0.5
            ? 'gable'
            : pick < flat + 0.72 && hd > hw
              ? 'gableFront'
              : 'hip';
      chimney = roll(3) < 0.35;
    }
  }
  const eave = storeys * storeyHeight;
  const span = roof === 'gableFront' ? hw : Math.min(hw, hd);
  const roofRise =
    roof === 'flat'
      ? 0.9
      : roof === 'shed'
        ? 1.4 + span * 0.15
        : roof === 'pyramid'
          ? Math.max(hw, hd) * 1.3
          : span * (0.6 + roll(4) * 0.25);
  return { district, storeys, storeyHeight, eave, roof, roofRise, chimney };
}
