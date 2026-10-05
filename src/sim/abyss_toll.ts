// The ascent toll ("the Weight"), sim half: run per live player in the tick
// (through player_environment.ts), it samples the player's depth, steps the
// pure tracker in abyss_toll_core.ts, and applies a charged layer's toll.
// Authoritative like every other sim system: the server runs it, clients only
// see the resulting auras, damage and death.
//
// Draws rng ONLY when a charge lands on a layer with a partial death chance,
// and only in a world that declares an abyss, so the built-in world's draw
// order is untouched.

import { abyssDepthYd, activeAbyss } from './abyss_depth';
import {
  ABYSS_TOLL_CAUSE,
  type AbyssTollAuraSpec,
  type AbyssTollPlayerState,
  abyssTollAurasFor,
  abyssTollClearsTarget,
  abyssTollLayer,
  stepAbyssToll,
} from './abyss_toll_core';
import type { SimContext } from './sim_context';
import type { Entity } from './types';

export function updateAbyssToll(ctx: SimContext, p: Entity, meta: AbyssTollPlayerState): void {
  if (p.kind !== 'player') return;
  const abyss = activeAbyss();
  if (!abyss && !meta.abyssToll) return;
  const charged = stepAbyssToll(meta, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z,
    tick: ctx.tickCount,
    depthYd: p.dead ? null : abyssDepthYd(p.pos.x, p.pos.y, p.pos.z, abyss),
  });
  if (charged > 0) applyAbyssToll(ctx, p, charged);
}

function landAura(ctx: SimContext, p: Entity, spec: AbyssTollAuraSpec): void {
  const value =
    spec.pctMaxHpPerTick !== undefined
      ? Math.max(1, Math.round(p.maxHp * spec.pctMaxHpPerTick))
      : spec.value;
  ctx.applyAura(p, {
    id: spec.id,
    name: spec.name,
    kind: spec.kind,
    remaining: spec.duration,
    duration: spec.duration,
    value,
    ...(spec.tickInterval !== undefined
      ? { tickInterval: spec.tickInterval, tickTimer: spec.tickInterval }
      : {}),
    // Self-sourced: no attacker to credit, and the periodic-harm gate always
    // lets a self-sourced dot tick.
    sourceId: p.id,
    school: spec.kind === 'dot' ? 'physical' : 'shadow',
    undispellable: true,
  });
}

/** Charge the toll of `layer` on a living player: the death roll first (if
 *  the layer has one), then every aura up to that layer. Exported for tests
 *  and for future sources (a mitigation consumable may charge a lower layer). */
export function applyAbyssToll(ctx: SimContext, p: Entity, layer: number): void {
  if (p.dead) return;
  const entry = abyssTollLayer(layer);
  const chance = entry.deathChance ?? 0;
  if (chance >= 1 || (chance > 0 && ctx.rng.chance(chance))) {
    ctx.handleDeath(p, null, ABYSS_TOLL_CAUSE);
    return;
  }
  if (abyssTollClearsTarget(layer)) p.targetId = null;
  for (const spec of abyssTollAurasFor(layer)) landAura(ctx, p, spec);
  for (const spec of entry.survivorAuras ?? []) landAura(ctx, p, spec);
}
