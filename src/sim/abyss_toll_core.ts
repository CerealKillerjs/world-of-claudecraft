// The ascent toll ("the Weight"), pure half: when does climbing inside the
// abyss charge, and what does each layer's charge consist of. No SimContext,
// no rng, no clock: abyss_toll.ts feeds it one sample per live player per tick
// and applies whatever it returns.
//
// The rule (docs/design/abyss-world.md section 4.3): inside the abyss the
// player carries a LOW MARK, the lowest point reached since the toll was last
// paid, and the DEEPEST LAYER reached in that span. Rising TOLL_RISE_YD (10 m)
// above the low mark charges the toll of that deepest layer and moves the
// mark to the current height. A jump (about 1.1 yd) never reaches it; lifts
// and ropes do, by design.
//
// Only a continuous climb counts. A sample that does not follow the previous
// one (the player was dead, or out of the abyss, on the tick before) or that
// moved further than RELOCATE_YD in one tick (a teleport: a graveyard revive,
// a return-to-surface item) re-anchors the mark where the player now stands
// instead of charging. The deepest layer survives a re-anchor, so the next
// charge still prices the deepest point since the last payment.

import { ABYSS_LAYER_COUNT, abyssLayerAtDepthYd, YD_PER_M } from './abyss_depth';
import type { AuraKind } from './types';

/** Rise above the low mark that charges the toll: 10 m. */
export const TOLL_RISE_YD = 10 * YD_PER_M;

/** A one-tick move longer than this is a relocation, never a climb. Far above
 *  any locomotion (running is 0.35 yd per tick; Blink and leaps stay under it),
 *  far below any graveyard or camp hop. */
export const RELOCATE_YD = 40;

/** Per-player tracking while inside the abyss. Session-only, never saved: a
 *  relog re-anchors at the current height, which never lets a climb skip a
 *  charge (the mark can only start where the player already stands). */
export interface AbyssTollTrack {
  lowY: number;
  deepestLayer: number;
  lastX: number;
  lastY: number;
  lastZ: number;
  lastTick: number;
}

/** Mixed into PlayerMeta (sim.ts) so the state stays on the Sim. */
export interface AbyssTollPlayerState {
  abyssToll?: AbyssTollTrack;
}

export interface AbyssTollSample {
  x: number;
  y: number;
  z: number;
  tick: number;
  /** Depth below the rim in yards, null when not in the abyss. */
  depthYd: number | null;
}

/**
 * Advance one player's toll tracking by one sample. Mutates `holder.abyssToll`
 * in place (no allocation on the steady path) and returns the layer whose toll
 * is charged on this sample, or 0 when nothing is charged.
 */
export function stepAbyssToll(holder: AbyssTollPlayerState, s: AbyssTollSample): number {
  if (s.depthYd === null) {
    holder.abyssToll = undefined;
    return 0;
  }
  const layerHere = abyssLayerAtDepthYd(s.depthYd);
  const t = holder.abyssToll;
  if (!t) {
    holder.abyssToll = {
      lowY: s.y,
      deepestLayer: layerHere,
      lastX: s.x,
      lastY: s.y,
      lastZ: s.z,
      lastTick: s.tick,
    };
    return 0;
  }
  const dx = s.x - t.lastX;
  const dy = s.y - t.lastY;
  const dz = s.z - t.lastZ;
  const continuous =
    t.lastTick === s.tick - 1 && dx * dx + dy * dy + dz * dz <= RELOCATE_YD * RELOCATE_YD;
  t.lastX = s.x;
  t.lastY = s.y;
  t.lastZ = s.z;
  t.lastTick = s.tick;
  if (layerHere > t.deepestLayer) t.deepestLayer = layerHere;
  if (!continuous || s.y < t.lowY) {
    t.lowY = s.y;
    return 0;
  }
  if (s.y - t.lowY < TOLL_RISE_YD) return 0;
  const charged = t.deepestLayer;
  t.lowY = s.y;
  t.deepestLayer = layerHere;
  return charged;
}

// ---------------------------------------------------------------------------
// What each layer charges. A layer's toll is its own effect PLUS every
// shallower layer's, so the price only grows with depth. Durations and
// magnitudes reuse classic analogues (Mortal Strike's halved healing,
// Hamstring's halved speed, a Curse of Tongues cast slow) and are the design
// placeholders the doc asks to calibrate in play. All are undispellable: no
// cleanse lifts the toll, only its timer (countermeasures are a later phase).

/** One aura a layer applies. `pctMaxHpPerTick` turns a dot's value into a
 *  fraction of the wearer's max health, resolved when the toll lands. */
export interface AbyssTollAuraSpec {
  id: string;
  name: string;
  kind: AuraKind;
  duration: number;
  value: number;
  tickInterval?: number;
  pctMaxHpPerTick?: number;
}

export interface AbyssTollLayer {
  layer: number;
  auras: readonly AbyssTollAuraSpec[];
  /** Drop the current target (the senses go dark). */
  clearTarget?: boolean;
  /** Chance (0 to 1) that the charge kills outright, rolled once through Rng. */
  deathChance?: number;
  /** Auras applied INSTEAD of death when a deathChance roll spares the player. */
  survivorAuras?: readonly AbyssTollAuraSpec[];
}

/** The killing "ability" name the death event carries for a toll death. */
export const ABYSS_TOLL_CAUSE = 'The Weight';

export const ABYSS_TOLL_DIZZINESS_ID = 'abyss_toll_dizziness';
export const ABYSS_TOLL_NAUSEA_ID = 'abyss_toll_nausea';
export const ABYSS_TOLL_TREMBLING_ID = 'abyss_toll_trembling';
export const ABYSS_TOLL_VISIONS_ID = 'abyss_toll_visions';
export const ABYSS_TOLL_RENDING_ID = 'abyss_toll_rending';
export const ABYSS_TOLL_HOLLOWING_ID = 'abyss_toll_hollowing';
export const ABYSS_TOLL_DEFORMATION_ID = 'abyss_toll_deformation';

export const ABYSS_TOLL_LAYERS: readonly AbyssTollLayer[] = Object.freeze([
  {
    layer: 1,
    // Mareo: healing received halved, so the climb's attrition lingers.
    auras: [
      {
        id: ABYSS_TOLL_DIZZINESS_ID,
        name: 'Dizziness',
        kind: 'mortal_wound',
        duration: 30,
        value: 0.5,
      },
    ],
  },
  {
    layer: 2,
    // Nausea: movement halved; casts take half again as long.
    auras: [
      { id: ABYSS_TOLL_NAUSEA_ID, name: 'Nausea', kind: 'slow', duration: 30, value: 0.5 },
      { id: ABYSS_TOLL_TREMBLING_ID, name: 'Trembling', kind: 'tongues', duration: 30, value: 1.5 },
    ],
  },
  {
    layer: 3,
    // Visions: weapon swings miss a quarter more often. The false echoes the
    // design calls for are a client-only visual keyed on this aura id (later).
    auras: [
      { id: ABYSS_TOLL_VISIONS_ID, name: 'Visions', kind: 'blind', duration: 30, value: 0.25 },
    ],
  },
  {
    layer: 4,
    // Rending: 4% of max health every 2 sec for 30 sec (60% in all), with
    // healing already halved by layer 1.
    auras: [
      {
        id: ABYSS_TOLL_RENDING_ID,
        name: 'Rending',
        kind: 'dot',
        duration: 30,
        value: 0,
        tickInterval: 2,
        pctMaxHpPerTick: 0.04,
      },
    ],
  },
  {
    layer: 5,
    // Hollowing: the target drops and no spell can be cast for 10 sec. Hiding
    // the map and muting sound are client follow-ups keyed on this aura id.
    auras: [
      { id: ABYSS_TOLL_HOLLOWING_ID, name: 'Hollowing', kind: 'silence', duration: 10, value: 0 },
    ],
    clearTarget: true,
  },
  {
    layer: 6,
    // Deformation or death: an even Rng roll. The survivor keeps half of
    // every attribute for 10 min (the recovery sicknesses' stat-drain shape).
    auras: [],
    deathChance: 0.5,
    survivorAuras: [
      {
        id: ABYSS_TOLL_DEFORMATION_ID,
        name: 'Deformation',
        kind: 'buff_allstats_pct',
        duration: 600,
        value: -0.5,
      },
    ],
  },
  {
    layer: 7,
    // Certain death.
    auras: [],
    deathChance: 1,
  },
]);

if (ABYSS_TOLL_LAYERS.length !== ABYSS_LAYER_COUNT) {
  throw new Error('abyss toll: one toll entry per abyss layer');
}

/** Every aura a charge of `layer` applies before any death roll, shallowest
 *  first (the layer's own plus every shallower layer's). */
export function abyssTollAurasFor(layer: number): AbyssTollAuraSpec[] {
  const out: AbyssTollAuraSpec[] = [];
  for (const l of ABYSS_TOLL_LAYERS) {
    if (l.layer > layer) break;
    out.push(...l.auras);
  }
  return out;
}

/** The deepest-layer entry for a charge (where the death roll and the target
 *  drop are decided). A shallower clearTarget also applies, so it is folded in. */
export function abyssTollLayer(layer: number): AbyssTollLayer {
  return ABYSS_TOLL_LAYERS[Math.min(Math.max(layer, 1), ABYSS_LAYER_COUNT) - 1];
}

/** Whether a charge of `layer` drops the current target. */
export function abyssTollClearsTarget(layer: number): boolean {
  return ABYSS_TOLL_LAYERS.some((l) => l.layer <= layer && l.clearTarget === true);
}
