// The abyss world pack: a whole second world (island, rim city, first layer of
// the pit) for the abyss-inspired fork. Design: docs/design/abyss-world.md.
//
// Loaded INSTEAD of the built-in world through the WorldContent seam
// (setActiveWorldContent + SimConfig.world); the built-in world is untouched
// and still the default. Its ground is the analytic terrain model in
// src/sim/abyss/terrain.ts, which replaces the built-in generator wholesale.
// Layout logic lives in src/sim/abyss/; this file only assembles the record.

import {
  ABYSS_CAMPS,
  ABYSS_MAILBOXES,
  ABYSS_PLAYER_START,
  ABYSS_REGIONS,
  abyssBiomeAt,
  abyssIsOpenSea,
  abyssRoads,
  abyssSurfaceAt,
  abyssTerrainHeight,
  buildAbyssProps,
  buildAbyssTiles,
  LAYER1_GRAVEYARD,
  RIM_GRAVEYARD,
} from '../abyss';
import type { WorldContent } from '../types';

export { ABYSS_REGIONS };

/** The pack's id, as a boot URL names it (?world=abyss). */
export const ABYSS_WORLD_ID = 'abyss';

let built: WorldContent | null = null;

/** The pack's content record, built on first use and then shared: the city
 *  layout places a few thousand props, a cost only a session that actually
 *  boots into this world should pay. */
export function abyssWorld(): WorldContent {
  built ??= {
    zones: buildAbyssTiles(),
    camps: ABYSS_CAMPS,
    npcs: {},
    groundObjects: [],
    roads: abyssRoads(),
    props: buildAbyssProps(),
    playerStart: ABYSS_PLAYER_START,
    services: {
      mailboxes: ABYSS_MAILBOXES,
      graveyards: [
        { id: 'gy_rimholt', name: 'Rimholt Rest', ...RIM_GRAVEYARD },
        { id: 'gy_first_camp', name: 'First Camp', ...LAYER1_GRAVEYARD },
      ],
    },
    terrainModel: {
      height: abyssTerrainHeight,
      isOpenSea: abyssIsOpenSea,
      biomeAt: abyssBiomeAt,
      surfaceAt: abyssSurfaceAt,
    },
  };
  return built;
}
