// Localization for the abyss ascent toll's sim-emitted names: the aura each
// layer's charge applies and the curse's own name (the cause a toll death
// carries). The sim emits the English names (src/sim/abyss_toll_core.ts);
// localizeSimAuraName routes them here, so the buff bar, combat log and death
// recap all read the same keys. Pure leaf: no DOM, no IWorld.

import type { TranslationKey } from './i18n';
import { t } from './i18n';

export const ABYSS_TOLL_NAME_KEYS: Readonly<Record<string, TranslationKey>> = Object.freeze({
  'The Weight': 'hud.abyssToll.weight',
  Dizziness: 'hud.abyssToll.dizziness',
  Nausea: 'hud.abyssToll.nausea',
  Trembling: 'hud.abyssToll.trembling',
  Visions: 'hud.abyssToll.visions',
  Rending: 'hud.abyssToll.rending',
  Hollowing: 'hud.abyssToll.hollowing',
  Deformation: 'hud.abyssToll.deformation',
});

/** The localized display name for a toll aura or cause, or null when `name`
 *  is not one of the toll's names. */
export function localizeAbyssTollName(name: string): string | null {
  const key = ABYSS_TOLL_NAME_KEYS[name];
  return key ? t(key) : null;
}
