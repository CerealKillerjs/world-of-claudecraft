// The expedition bag: what a player picks up below the rim is at stake until
// they carry it back out, and a death in the pit leaves it on the corpse.
// docs/design/abyss-world.md section 4.5; Daniel's decision (2026-10-05): for
// now ONLY the bag is lost, never equipment, money or experience.
//
// Rules, all deterministic and server-authoritative (draws no rng):
//  1. Ledger. Every world-sourced grant (loot, gathering, quest reward, craft)
//     that lands while the living player stands in the pit (abyss_region.ts)
//     adds its units to `ledger`. Movement grants (trade, mail, market,
//     restoring this very bag) never count: the bag holds finds, not copies
//     that changed hands.
//  2. Secured. A living player outside the pit has nothing at stake: the
//     ledger empties on their next tick, so climbing out banks the haul.
//  3. Death in the pit. The ledgered units still in the BAGS (not equipped;
//     sold or used ones are simply gone) leave the inventory and wait on the
//     body (`corpse`), with the corpse's position.
//  4. Settling. On the first living tick after the death (or at the next
//     death, whichever comes first) the bag is recovered when the player
//     stands within CORPSE_REZ_RANGE of the body (the corpse run, or a raise in
//     place), and lost otherwise (the camp's Spirit Healer, unstuck, any revive
//     that moves the body away). A recovered bag is at stake again: its units
//     go back on the ledger, so the next step out of the pit secures them.
//
// State lives on PlayerMeta.expeditionBag (persisted, so a relog neither
// banks the haul nor drops a waiting corpse bag); this module holds functions.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now.

import { instancedCountCap } from '../bags';
import { ITEMS } from '../data';
import type { InventoryGrantOptions } from '../inventory_grant';
import { sanitizeEscrowSlot } from '../item_instance_transfer';
import { coalesceMaterialTransferSlots } from '../material_exchange_transfer';
import { isMaterialItemId, materialItemIds } from '../material_ids';
import { applyMaterialInventoryTake, planMaterialInventoryTake } from '../material_inventory_take';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { CORPSE_REZ_RANGE } from '../spirit';
import { cloneInvSlot, dist2d, type Entity, type InvSlot, type Vec3 } from '../types';
import { isInAbyss } from './abyss_region';

export interface ExpeditionBagCorpse {
  /** Where the body fell. */
  pos: Vec3;
  /** The bag's contents, exact copies (payloads, provenance, material sources). */
  slots: InvSlot[];
}

export interface ExpeditionBagState {
  /** item id to units found below the rim and not yet carried out. */
  ledger: Record<string, number>;
  /** The bag the last death left on the body, until it is recovered or lost. */
  corpse: ExpeditionBagCorpse | null;
}

/** The persisted shape (CharacterState.expeditionBag). */
export interface SavedExpeditionBag {
  ledger?: Record<string, number>;
  corpse?: { pos: { x: number; y: number; z: number }; slots: InvSlot[] } | null;
}

function bagOf(meta: PlayerMeta): ExpeditionBagState {
  meta.expeditionBag ??= { ledger: {}, corpse: null };
  return meta.expeditionBag;
}

/** Whether anything is at stake or waiting on a corpse. */
export function expeditionBagIsEmpty(meta: PlayerMeta): boolean {
  const bag = meta.expeditionBag;
  return !bag || (bag.corpse === null && Object.keys(bag.ledger).length === 0);
}

/** The units of an item currently at stake (0 when none). */
export function expeditionBagUnits(meta: PlayerMeta, itemId: string): number {
  return meta.expeditionBag?.ledger[itemId] ?? 0;
}

/**
 * Rule 1: called from both inventory grant hubs (Sim.addItem / addItemInstance)
 * after the copies landed.
 */
export function noteExpeditionGrant(
  meta: PlayerMeta,
  p: Entity,
  itemId: string,
  count: number,
  opts?: InventoryGrantOptions,
): void {
  if (opts?.movement || count <= 0 || p.dead || !isInAbyss(p.pos)) return;
  const ledger = bagOf(meta).ledger;
  ledger[itemId] = (ledger[itemId] ?? 0) + count;
}

// Take up to `units` of one item out of the bags, newest slot first (the order
// removeItem consumes in), returning the exact copies removed. Locked copies go
// too: the owner's lock guards against selling, not against dying.
function takeUnits(inventory: InvSlot[], itemId: string, units: number): InvSlot[] {
  if (units <= 0) return [];
  if (isMaterialItemId(itemId)) {
    const plan = planMaterialInventoryTake({
      inventory,
      itemId,
      count: units,
      materialIds: materialItemIds(),
      allowPartial: true,
      includeLocked: true,
    });
    // A malformed stack is left exactly where it is rather than failing a death.
    if (!plan.ok) return [];
    applyMaterialInventoryTake(inventory, plan.value);
    return coalesceMaterialTransferSlots(plan.value.taken);
  }
  const out: InvSlot[] = [];
  for (let i = inventory.length - 1; i >= 0 && units > 0; i--) {
    const s = inventory[i];
    if (s.itemId !== itemId) continue;
    const take = Math.min(s.count, units);
    const copy = cloneInvSlot(s);
    copy.count = take;
    // The owner's bag-cell arrangement does not travel with the copy.
    delete copy.slot;
    delete copy.materialSeparated;
    out.push(copy);
    s.count -= take;
    units -= take;
    if (s.count <= 0) inventory.splice(i, 1);
  }
  return out;
}

/**
 * Rule 4: settle a bag waiting on a corpse against where the living player now
 * stands. A no-op when nothing waits.
 */
export function settleExpeditionCorpseBag(ctx: SimContext, meta: PlayerMeta, p: Entity): void {
  const bag = meta.expeditionBag;
  const corpse = bag?.corpse;
  if (!bag || !corpse) return;
  bag.corpse = null;
  if (dist2d(p.pos, corpse.pos) > CORPSE_REZ_RANGE) {
    ctx.notice(meta.entityId, 'Your expedition bag is lost.', '#f88');
    return;
  }
  for (const slot of corpse.slots) {
    // A restore moves copies the player already held: no Reliquary tally, and
    // this module's own notice replaces the per-item receipt lines.
    const opts: InventoryGrantOptions = {
      movement: true,
      silent: true,
      callerLogs: true,
      ...(slot.craftedRecipeId === undefined ? {} : { craftedRecipeId: slot.craftedRecipeId }),
      ...(slot.materialSources === undefined ? {} : { materialSources: slot.materialSources }),
    };
    if (slot.instance) {
      ctx.addItemInstance(slot.itemId, slot.instance, meta.entityId, slot.count, opts);
    } else {
      ctx.addItem(slot.itemId, slot.count, meta.entityId, opts);
    }
    bag.ledger[slot.itemId] = (bag.ledger[slot.itemId] ?? 0) + slot.count;
  }
  ctx.notice(meta.entityId, 'You recover your expedition bag.', '#8f8');
}

/**
 * Rule 3: called from the player arm of handleDeath while the player is still
 * alive (before `dead` is set).
 */
export function leaveExpeditionBagOnCorpse(ctx: SimContext, meta: PlayerMeta, p: Entity): void {
  if (expeditionBagIsEmpty(meta)) return;
  // A bag from an earlier death that never settled resolves first, so two
  // corpse bags can never stack up.
  settleExpeditionCorpseBag(ctx, meta, p);
  const bag = bagOf(meta);
  const ledger = bag.ledger;
  bag.ledger = {};
  if (!isInAbyss(p.pos)) return;
  const slots: InvSlot[] = [];
  // Sorted ids: the take order (and so the saved bag) never depends on the
  // order the finds happened to land in.
  for (const id of Object.keys(ledger).sort()) {
    for (const s of takeUnits(meta.inventory, id, ledger[id])) slots.push(s);
  }
  if (slots.length === 0) return;
  bag.corpse = { pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z }, slots };
  ctx.onInventoryChangedForQuests(meta);
  ctx.notice(meta.entityId, 'Your expedition bag stays with your corpse.', '#f88');
}

/**
 * Rules 2 and 4 on the living-player tick: settle a waiting corpse bag, then
 * bank the haul once the player is out of the pit.
 */
export function tickExpeditionBag(ctx: SimContext, meta: PlayerMeta, p: Entity): void {
  if (expeditionBagIsEmpty(meta) || p.dead) return;
  settleExpeditionCorpseBag(ctx, meta, p);
  const bag = meta.expeditionBag;
  if (bag && !isInAbyss(p.pos)) bag.ledger = {};
}

// --- persistence --------------------------------------------------------------

/** The sparse save field, spread into CharacterState: no key at all when
 *  nothing is at stake or waiting, so every other save stays byte-identical. */
export function saveExpeditionBag(meta: PlayerMeta): { expeditionBag?: SavedExpeditionBag } {
  if (expeditionBagIsEmpty(meta)) return {};
  const bag = meta.expeditionBag!;
  const out: SavedExpeditionBag = {};
  if (Object.keys(bag.ledger).length > 0) out.ledger = { ...bag.ledger };
  if (bag.corpse) {
    out.corpse = {
      pos: { x: bag.corpse.pos.x, y: bag.corpse.pos.y, z: bag.corpse.pos.z },
      slots: bag.corpse.slots.map((s) => cloneInvSlot(s)),
    };
  }
  return { expeditionBag: out };
}

/**
 * The one load path. Non-positive or non-integer ledger counts are dropped;
 * corpse slots go through the exchange escrow sanitizer (unknown ids stay as
 * dormant recoverable data, counts clamp to what a stack could hold).
 */
export function restoreExpeditionBag(
  meta: PlayerMeta,
  saved: SavedExpeditionBag | undefined,
): void {
  if (!saved || typeof saved !== 'object') return;
  const ledger: Record<string, number> = {};
  for (const [id, n] of Object.entries(saved.ledger ?? {})) {
    if (Number.isSafeInteger(n) && n > 0) ledger[id] = n;
  }
  let corpse: ExpeditionBagCorpse | null = null;
  const raw = saved.corpse;
  if (raw && Array.isArray(raw.slots) && raw.pos && Number.isFinite(raw.pos.x)) {
    const slots: InvSlot[] = [];
    for (const s of raw.slots) {
      if (!s || typeof s.itemId !== 'string' || !(s.count > 0)) continue;
      slots.push(sanitizeEscrowSlot(s, instancedCountCap(ITEMS[s.itemId], s.instance)));
    }
    if (slots.length > 0) {
      corpse = {
        pos: { x: raw.pos.x, y: Number(raw.pos.y) || 0, z: Number(raw.pos.z) || 0 },
        slots,
      };
    }
  }
  if (corpse === null && Object.keys(ledger).length === 0) return;
  meta.expeditionBag = { ledger, corpse };
}
