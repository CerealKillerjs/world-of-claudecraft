// The abyss world's named regions and the rectangle tiles the engine streams.
//
// The world is round (an island around a round pit), but the engine's zones
// are rectangles: the renderer streams terrain zone by zone (keyed by zone id,
// located by the zone's hub) and several systems walk the zone list. So the
// pack carries TWO views of one map:
//
// - Three named REGIONS (the island, the rim city, the first layer of the
//   pit). They own the names, welcome lines, and points of interest, and are
//   what the translation catalog keys (src/ui/world_entity_i18n.ts).
// - A grid of rectangle TILES covering the island. Each tile copies the region
//   its centre falls in under the id `<region>@<column>_<row>` (data.ts
//   zoneRegionId), so names and "Entering ..." banners follow the region while
//   the streamer still gets small rectangles with their own ids and hubs.
//   Tile naming is therefore as coarse as a tile: refining the borders is
//   follow-up work.
//
// The ground palette does follow the true round borders (abyssBiomeAt, the
// terrain model's biomeAt hook).
//
// Names are working names from the design doc glossary, IP-checked on
// 2026-10-05 (no game or franchise uses "Rimholt" or "Vaharra"; "The
// Sounding" is plain English). Player text is English here and localized at
// the client like every zone.

import type { BiomeId, ZoneDef } from '../types';
import {
  ABYSS_CENTER,
  CITY_OUTER_RADIUS,
  ISLAND_RADIUS,
  PIT_RADIUS,
  RIM_OUTER_RADIUS,
  WORLD_HALF_EXTENT,
} from './geometry';

const cx = ABYSS_CENTER.x;
const cz = ABYSS_CENTER.z;

/** Rim graveyard: on the rim plaza, east of the descent. */
export const RIM_GRAVEYARD = { x: cx + 120, z: cz - 640 };
/** Layer 1 boundary camp graveyard: on the floor, 1,350 m down. */
export const LAYER1_CAMP_CENTER = { x: cx + 60, z: cz + 40 };
export const LAYER1_GRAVEYARD = { x: LAYER1_CAMP_CENTER.x - 30, z: LAYER1_CAMP_CENTER.z + 18 };

/** Where a new character first stands: the south rim plaza, facing the pit. */
export const ABYSS_PLAYER_START = { x: cx - 24, z: cz - 652 };

const ISLE: ZoneDef = {
  id: 'vaharra_isle',
  name: 'Vaharra Isle',
  zMin: cz - WORLD_HALF_EXTENT,
  zMax: cz + WORLD_HALF_EXTENT,
  xMin: cx - WORLD_HALF_EXTENT,
  xMax: cx + WORLD_HALF_EXTENT,
  levelRange: [1, 5],
  biome: 'vale',
  hub: { x: cx, z: cz - ISLAND_RADIUS + 60, radius: 30, name: 'Vaharra Isle' },
  graveyard: RIM_GRAVEYARD,
  lakes: [],
  pois: [{ id: 'south_harbor', x: cx, z: cz - ISLAND_RADIUS + 40, label: 'South Harbor' }],
  welcome: 'Farmland and sea wind. Every road on the island runs uphill toward the city.',
};

const CITY: ZoneDef = {
  id: 'rimholt',
  name: 'Rimholt',
  zMin: cz - CITY_OUTER_RADIUS,
  zMax: cz + CITY_OUTER_RADIUS,
  xMin: cx - CITY_OUTER_RADIUS,
  xMax: cx + CITY_OUTER_RADIUS,
  levelRange: [1, 5],
  worldPvp: 'sanctuary',
  biome: 'garden',
  hub: { x: ABYSS_PLAYER_START.x, z: ABYSS_PLAYER_START.z, radius: 40, name: 'Rimholt' },
  graveyard: RIM_GRAVEYARD,
  lakes: [],
  pois: [
    { id: 'descent_arch', x: cx, z: cz - PIT_RADIUS - 8, label: 'The Descent Arch' },
    { id: 'hanging_quarter', x: cx + 230, z: cz - 470, label: 'The Hanging Quarter' },
    { id: 'rim_market', x: cx - 150, z: cz - 640, label: 'Rim Market' },
  ],
  welcome: 'The city of the rim. Every street runs down toward the edge.',
};

const LAYER1: ZoneDef = {
  id: 'the_sounding',
  name: 'The Sounding',
  zMin: cz - PIT_RADIUS,
  zMax: cz + PIT_RADIUS,
  xMin: cx - PIT_RADIUS,
  xMax: cx + PIT_RADIUS,
  levelRange: [5, 15],
  biome: 'jungle',
  hub: { x: LAYER1_CAMP_CENTER.x, z: LAYER1_CAMP_CENTER.z, radius: 30, name: 'The Sounding' },
  graveyard: LAYER1_GRAVEYARD,
  lakes: [],
  pois: [
    { id: 'boundary_camp', x: LAYER1_CAMP_CENTER.x, z: LAYER1_CAMP_CENTER.z, label: 'First Camp' },
  ],
  welcome: 'You are below the rim now. The way back up costs more than the way down.',
};

/** The three named regions, island first (the fallback). */
export const ABYSS_REGIONS: readonly ZoneDef[] = [ISLE, CITY, LAYER1];

/** The region a world point belongs to, by distance from the pit's axis. */
export function abyssRegionAt(x: number, z: number): ZoneDef {
  const r = Math.hypot(x - cx, z - cz);
  if (r < PIT_RADIUS) return LAYER1;
  if (r <= CITY_OUTER_RADIUS) return CITY;
  return ISLE;
}

/** Ground palette by true region (the terrain model's biomeAt hook). */
export function abyssBiomeAt(x: number, z: number): BiomeId {
  return abyssRegionAt(x, z).biome;
}

/** Side of one streaming tile (yards). 11 x 11 tiles cover the island. */
export const ABYSS_TILE = 540;

/** The streaming tiles, south-west to north-east. Each takes the region of its
 *  centre (a tile whose centre is within half the rim ring's radius is pit),
 *  its own id and a hub at its centre (the streamer prepares a zone at its
 *  hub), and no points of interest (they stay on the region records until
 *  subzone labels follow the round borders). */
export function buildAbyssTiles(): ZoneDef[] {
  const tiles: ZoneDef[] = [];
  const n = Math.round((WORLD_HALF_EXTENT * 2) / ABYSS_TILE);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const xMin = cx - WORLD_HALF_EXTENT + i * ABYSS_TILE;
      const zMin = cz - WORLD_HALF_EXTENT + j * ABYSS_TILE;
      const mx = xMin + ABYSS_TILE / 2;
      const mz = zMin + ABYSS_TILE / 2;
      const r = Math.hypot(mx - cx, mz - cz);
      const region = r < RIM_OUTER_RADIUS * 0.5 ? LAYER1 : r <= CITY_OUTER_RADIUS ? CITY : ISLE;
      tiles.push({
        ...region,
        id: `${region.id}@${i}_${j}`,
        xMin,
        xMax: xMin + ABYSS_TILE,
        zMin,
        zMax: zMin + ABYSS_TILE,
        hub: { ...region.hub, x: mx, z: mz },
        pois: [],
      });
    }
  }
  return tiles;
}
