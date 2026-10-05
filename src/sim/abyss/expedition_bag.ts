// The expedition bag: what a player picks up below the rim is at stake until
// they carry it back out, and a death in the pit leaves it on the corpse.
// docs/design/abyss-world.md section 4.5; Daniel's decision (2026-10-05): for
// now ONLY the bag is lost, never equipment, money or experience.
//
// Rules, all deterministic and server-authoritative (draws no rng):
//  1. Ledger. Every world-sourced grant (loot, gathering, quest reward, craft,
//     a vendor buy) that lands while the living player stands in the pit
//     (abyss_region.ts) is at stake. Movement grants (trade, mail, market, an
//     enchant re-mint, restoring this very bag) never count: the bag holds
//     finds, not copies that changed hands.
//     - A payload-bearing copy (a rolled, signed or enchanted piece) is
//       remembered BY PAYLOAD in `found`, so a death can only ever take that
//       exact copy, never a different instance of the same item.
//     - A plain copy (and every material) is remembered as a unit count in
//       `ledger`. Plain copies of one item are identical, so which of them
//       leaves is immaterial; a death takes plain copies only, never an
//       instanced one in their place.
//  2. Secured. A living player outside the pit has nothing at stake: the
//     ledger empties on their next tick, so climbing out banks the haul.
//  3. Death in the pit. What the ledger names and is still in the BAGS (not
//     equipped; a used or sold find is simply gone) leaves the inventory and
//     waits on the body (`corpse`), with the corpse's position.
//  4. Settling. On the first living tick after the death (or at the next
//     death, whichever comes first) the bag is recovered when the player
//     stands within CORPSE_REZ_RANGE of the body, in 3D (the pit is deep: a
//     camp straight above the corpse is not the corpse), and lost otherwise
//     (the camp's Spirit Healer, unstuck, any revive that moves the body
//     away). A bag recovered inside the pit is at stake again: its copies are
//     re-ledgered by the grant hook (the restore is a movement grant, so this
//     module ledgers them itself).
//
// Known v1 limit: plain copies are counted, not tagged, so a find that was
// used or sold is "paid back" from an identical plain copy brought from the
// surface. Identical copies are interchangeable, so nothing of a different
// kind or value is ever taken.
//
// State lives on PlayerMeta.expeditionBag (persisted, so a relog neither
// banks the haul nor drops a waiting corpse bag; deleted again once empty);
// this module holds functions.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now.

import { instancedCountCap } from '../bags';
import { ITEMS } from '../data';
import type { InventoryGrantOptions } from '../inventory_grant';
import { boundCraftedRecipeIdOnLoad } from '../item_instance_load';
import { itemInstancePayloadsEqual } from '../item_instance_merge';
import { sanitizeEscrowSlot } from '../item_instance_transfer';
import { coalesceMaterialTransferSlots } from '../material_exchange_transfer';
import { isMaterialItemId, materialItemIds } from '../material_ids';
import { applyMaterialInventoryTake, planMaterialInventoryTake } from '../material_inventory_take';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { CORPSE_REZ_RANGE } from '../spirit';
import {
  cloneInvSlot,
  cloneItemInstancePayload,
  type Entity,
  type InvSlot,
  type ItemInstancePayload,
  type Vec3,
} from '../types';
import { isInAbyss } from './abyss_region';

export interface ExpeditionBagFind {
  itemId: string;
  /** The exact payload granted (deep clone), compared lock-blind. */
  instance: ItemInstancePayload;
  count: number;
}

export interface ExpeditionBagCorpse {
  /** Where the body fell. */
  pos: Vec3;
  /** The bag's contents, exact copies (payloads, provenance, material sources). */
  slots: InvSlot[];
}

export interface ExpeditionBagState {
  /** item id to PLAIN units (and material units) found below the rim. */
  ledger: Record<string, number>;
  /** Payload-bearing copies found below the rim, by exact payload. */
  found: ExpeditionBagFind[];
  /** The bag the last death left on the body, until it is recovered or lost. */
  corpse: ExpeditionBagCorpse | null;
}

/** The persisted shape (CharacterState.expeditionBag). */
export interface SavedExpeditionBag {
  ledger?: Record<string, number>;
  found?: ExpeditionBagFind[];
  corpse?: { pos: { x: number; y: number; z: number }; slots: InvSlot[] } | null;
}

function bagOf(meta: PlayerMeta): ExpeditionBagState {
  meta.expeditionBag ??= { ledger: {}, found: [], corpse: null };
  return meta.expeditionBag;
}

function stakeIsEmpty(bag: ExpeditionBagState): boolean {
  for (const _ in bag.ledger) return false;
  return bag.found.length === 0;
}

/** Whether anything is at stake or waiting on a corpse. */
export function expeditionBagIsEmpty(meta: PlayerMeta): boolean {
  const bag = meta.expeditionBag;
  return !bag || (bag.corpse === null && stakeIsEmpty(bag));
}

/** The units of an item currently at stake, plain and instanced (0 when none). */
export function expeditionBagUnits(meta: PlayerMeta, itemId: string): number {
  const bag = meta.expeditionBag;
  if (!bag) return 0;
  let n = bag.ledger[itemId] ?? 0;
  for (const f of bag.found) if (f.itemId === itemId) n += f.count;
  return n;
}

// The owner's item lock is a toggle on the payload; it must not change which
// copy a find is, or locking a find would hide it from the bag.
function sansLock(instance: ItemInstancePayload | undefined): ItemInstancePayload | undefined {
  if (!instance || instance.locked === undefined) return instance;
  const { locked: _locked, ...rest } = instance;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function ledgerCopy(
  bag: ExpeditionBagState,
  itemId: string,
  count: number,
  instance?: ItemInstancePayload,
): void {
  const identity = isMaterialItemId(itemId) ? undefined : sansLock(instance);
  if (!identity) {
    bag.ledger[itemId] = (bag.ledger[itemId] ?? 0) + count;
    return;
  }
  const held = bag.found.find(
    (f) => f.itemId === itemId && itemInstancePayloadsEqual(f.instance, identity),
  );
  if (held) held.count += count;
  else bag.found.push({ itemId, instance: cloneItemInstancePayload(identity), count });
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
  instance?: ItemInstancePayload,
): void {
  if (opts?.movement || count <= 0 || p.dead || !isInAbyss(p.pos)) return;
  ledgerCopy(bagOf(meta), itemId, count, instance);
}

function takeFromSlots(
  inventory: InvSlot[],
  matches: (slot: InvSlot) => boolean,
  units: number,
  out: InvSlot[],
): void {
  for (let i = inventory.length - 1; i >= 0 && units > 0; i--) {
    const s = inventory[i];
    if (!matches(s)) continue;
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
}

// Take up to `units` plain copies of one item out of the bags, newest slot first
// (the order removeItem consumes in), into `out`. Locked copies go too: the
// owner's lock guards against selling, not against dying.
function takePlainUnits(inventory: InvSlot[], itemId: string, units: number, out: InvSlot[]): void {
  if (units <= 0) return;
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
    if (!plan.ok) return;
    applyMaterialInventoryTake(inventory, plan.value);
    for (const s of coalesceMaterialTransferSlots(plan.value.taken)) out.push(s);
    return;
  }
  takeFromSlots(
    inventory,
    (s) => s.itemId === itemId && sansLock(s.instance) === undefined,
    units,
    out,
  );
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
  const dx = p.pos.x - corpse.pos.x;
  const dy = p.pos.y - corpse.pos.y;
  const dz = p.pos.z - corpse.pos.z;
  if (dx * dx + dy * dy + dz * dz > CORPSE_REZ_RANGE * CORPSE_REZ_RANGE) {
    ctx.notice(meta.entityId, 'Your expedition bag is lost.', '#f88');
    return;
  }
  const stillInPit = isInAbyss(p.pos);
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
    if (stillInPit) ledgerCopy(bag, slot.itemId, slot.count, slot.instance);
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
  const { ledger, found } = bag;
  bag.ledger = {};
  bag.found = [];
  if (!isInAbyss(p.pos)) {
    delete meta.expeditionBag;
    return;
  }
  const slots: InvSlot[] = [];
  // Exact copies first, in grant order; then plain units by sorted id, so the
  // take order (and the saved bag) never depends on map insertion order.
  for (const f of found) {
    takeFromSlots(
      meta.inventory,
      (s) => s.itemId === f.itemId && itemInstancePayloadsEqual(sansLock(s.instance), f.instance),
      f.count,
      slots,
    );
  }
  for (const id of Object.keys(ledger).sort()) {
    takePlainUnits(meta.inventory, id, ledger[id], slots);
  }
  if (slots.length === 0) {
    delete meta.expeditionBag;
    return;
  }
  bag.corpse = { pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z }, slots };
  ctx.onInventoryChangedForQuests(meta);
  ctx.notice(meta.entityId, 'Your expedition bag stays with your corpse.', '#f88');
}

/**
 * Rules 2 and 4 on the living-player tick: settle a waiting corpse bag, then
 * bank the haul once the player is out of the pit.
 */
export function tickExpeditionBag(ctx: SimContext, meta: PlayerMeta, p: Entity): void {
  if (!meta.expeditionBag || p.dead) return;
  settleExpeditionCorpseBag(ctx, meta, p);
  const bag = meta.expeditionBag;
  if (!isInAbyss(p.pos) || stakeIsEmpty(bag)) {
    // Nothing waits on a corpse here (settled just above): banked, and the
    // state goes away so the tick skips this player entirely.
    delete meta.expeditionBag;
  }
}

// --- persistence --------------------------------------------------------------

/** The sparse save field, spread into CharacterState: no key at all when
 *  nothing is at stake or waiting, so every other save stays byte-identical. */
export function saveExpeditionBag(meta: PlayerMeta): { expeditionBag?: SavedExpeditionBag } {
  if (expeditionBagIsEmpty(meta)) return {};
  const bag = meta.expeditionBag!;
  const out: SavedExpeditionBag = {};
  if (Object.keys(bag.ledger).length > 0) out.ledger = { ...bag.ledger };
  if (bag.found.length > 0) {
    out.found = bag.found.map((f) => ({
      itemId: f.itemId,
      instance: cloneItemInstancePayload(f.instance),
      count: f.count,
    }));
  }
  if (bag.corpse) {
    out.corpse = {
      pos: { x: bag.corpse.pos.x, y: bag.corpse.pos.y, z: bag.corpse.pos.z },
      slots: bag.corpse.slots.map((s) => cloneInvSlot(s)),
    };
  }
  return { expeditionBag: out };
}

const validCount = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;

/**
 * The one load path. Non-positive or non-integer counts are dropped; corpse
 * slots go through the exchange escrow sanitizer (unknown ids stay as dormant
 * recoverable data, counts clamp to what a stack could hold) plus the same
 * crafted-provenance re-attach the market and mail loaders use. A corpse whose
 * position is not three finite numbers is rejected whole, never guessed at.
 */
export function restoreExpeditionBag(
  meta: PlayerMeta,
  saved: SavedExpeditionBag | undefined,
): void {
  if (!saved || typeof saved !== 'object') return;
  const ledger: Record<string, number> = {};
  for (const [id, n] of Object.entries(saved.ledger ?? {})) if (validCount(n)) ledger[id] = n;
  const found: ExpeditionBagFind[] = [];
  for (const f of Array.isArray(saved.found) ? saved.found : []) {
    if (!f || typeof f.itemId !== 'string' || !validCount(f.count)) continue;
    if (!f.instance || typeof f.instance !== 'object') continue;
    found.push({
      itemId: f.itemId,
      instance: cloneItemInstancePayload(f.instance),
      count: f.count,
    });
  }
  let corpse: ExpeditionBagCorpse | null = null;
  const raw = saved.corpse;
  const pos = raw?.pos;
  if (
    raw &&
    Array.isArray(raw.slots) &&
    pos &&
    Number.isFinite(pos.x) &&
    Number.isFinite(pos.y) &&
    Number.isFinite(pos.z)
  ) {
    const dropped: string[] = [];
    const slots: InvSlot[] = [];
    for (const s of raw.slots) {
      if (!s || typeof s.itemId !== 'string' || !validCount(s.count)) continue;
      const slot: InvSlot = {
        ...sanitizeEscrowSlot(s, instancedCountCap(ITEMS[s.itemId], s.instance), dropped),
        ...(typeof s.craftedRecipeId === 'string' ? { craftedRecipeId: s.craftedRecipeId } : {}),
      };
      boundCraftedRecipeIdOnLoad(slot, dropped, 'expeditionBag');
      slots.push(slot);
    }
    if (slots.length > 0) corpse = { pos: { x: pos.x, y: pos.y, z: pos.z }, slots };
  }
  const bag: ExpeditionBagState = { ledger, found, corpse };
  if (expeditionBagIsEmptyState(bag)) return;
  meta.expeditionBag = bag;
}

function expeditionBagIsEmptyState(bag: ExpeditionBagState): boolean {
  return bag.corpse === null && stakeIsEmpty(bag);
}
