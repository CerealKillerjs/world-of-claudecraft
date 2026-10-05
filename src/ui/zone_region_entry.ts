// When has the player entered a new place? The HUD's zone-transition rule
// (banner, "Entering ..." line, welcome hint, vista pan), as a pure leaf.
//
// It commits the moment zoneAt flips: the old 1D z deadband never fired on an
// east-west crossing (the grid's column borders share the z band), so the
// banner and map lagged the border by a whole realm. Re-crossing costs only a
// banner re-emit; the map background is cached.
//
// Places are compared by REGION (sim/data.ts zoneRegionId): a round world pack
// tiles each named region into many rectangle zones, and walking from one
// tile of Rimholt into the next is not arriving anywhere. For every built-in
// zone the region is the zone itself, so this is the plain id comparison.

import { zoneRegionId } from '../sim/data';

export function enteredNewZoneRegion(currentZoneId: string, lastZoneId: string): boolean {
  return zoneRegionId(currentZoneId) !== zoneRegionId(lastZoneId);
}
