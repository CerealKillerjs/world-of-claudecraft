// The per-player environment clocks the tick runs right after the door,
// rift and portal triggers: open-sea swim fatigue (fatigue.ts), then the
// abyss ascent toll (abyss_toll.ts). One entry point so the coordinator's
// per-player loop stays one call wide as clocks are added. Order inside is
// part of the tick contract: fatigue first, exactly where it always ran.

import { updateAbyssToll } from './abyss_toll';
import type { AbyssTollPlayerState } from './abyss_toll_core';
import { updateSwimFatigue } from './fatigue';
import type { SimContext } from './sim_context';
import type { Entity } from './types';

export type { AbyssTollPlayerState };

export function updateEnvironmentClocks(
  ctx: SimContext,
  p: Entity,
  meta: AbyssTollPlayerState,
): void {
  updateSwimFatigue(ctx, p);
  updateAbyssToll(ctx, p, meta);
}
