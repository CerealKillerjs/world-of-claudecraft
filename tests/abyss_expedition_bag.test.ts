// The abyss expedition bag (src/sim/abyss/expedition_bag.ts): finds picked up
// below the rim are at stake until carried out; a death in the pit leaves them
// on the corpse; the corpse run recovers them and a revive away from the body
// loses them. Nothing else (equipment, money, experience) is ever taken.
// Exercised against a real Sim so the grant hub, handleDeath and the spirit
// loop are the live code paths.

import { describe, expect, it } from 'vitest';
import { stripLegendaryNames } from '../server/clear_item_name';
import { ABYSS_PIT, isInAbyss } from '../src/sim/abyss/abyss_region';
import {
  expeditionBagUnits,
  restoreExpeditionBag,
  saveExpeditionBag,
  tickExpeditionBag,
} from '../src/sim/abyss/expedition_bag';
import { rekeyInstanceSigner } from '../src/sim/character_rename';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { CORPSE_REZ_RANGE } from '../src/sim/spirit';
import type { Entity, SimEvent, WorldContent } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;

const TEST_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

const makeSim = (seed = 42): AnySim =>
  new Sim({ seed, playerClass: 'warrior', world: TEST_WORLD }) as AnySim;

// 50 yd below the rim, a little off the pit's centre line.
const IN_PIT = { x: ABYSS_PIT.x + 20, y: ABYSS_PIT.rimY - 50, z: ABYSS_PIT.z - 10 };

function place(sim: AnySim, pos: { x: number; y: number; z: number }): Entity {
  const p = sim.player as Entity;
  p.pos = { ...pos };
  p.prevPos = { ...pos };
  sim.rebucket(p);
  return p;
}

function meta(sim: AnySim) {
  const m = sim.meta(sim.playerId);
  if (!m) throw new Error('no player meta');
  return m;
}

function notices(events: SimEvent[]): string[] {
  return events.flatMap((e) => (e.type === 'log' && typeof e.text === 'string' ? [e.text] : []));
}

function bagsSnapshot(sim: AnySim): string {
  const rows = meta(sim).inventory.map((s) => JSON.stringify(s));
  return JSON.stringify(rows.sort());
}

function dieInPlace(sim: AnySim): void {
  sim.ctx.handleDeath(sim.player, null);
}

describe('abyss region', () => {
  it('is inside only within the opening AND below the rim', () => {
    expect(isInAbyss(IN_PIT)).toBe(true);
    // on the rim itself, and above it, is the surface
    expect(isInAbyss({ ...IN_PIT, y: ABYSS_PIT.rimY })).toBe(false);
    expect(isInAbyss({ ...IN_PIT, y: ABYSS_PIT.rimY + 5 })).toBe(false);
    // the edge of the opening counts, one yard past it does not
    const edge = { x: ABYSS_PIT.x + ABYSS_PIT.radius, y: -1, z: ABYSS_PIT.z };
    expect(isInAbyss(edge)).toBe(true);
    expect(isInAbyss({ ...edge, x: edge.x + 1 })).toBe(false);
  });

  it('the placeholder pit is clear of the shipped world start', () => {
    const sim = makeSim();
    expect(isInAbyss(sim.player.pos)).toBe(false);
  });
});

describe('expedition bag: what goes in', () => {
  it('ledgers world grants while alive in the pit, nothing on the surface', () => {
    const sim = makeSim();
    sim.addItem('wolf_fang', 2); // surface find: never at stake
    place(sim, IN_PIT);
    sim.addItem('wolf_fang', 3);
    expect(expeditionBagUnits(meta(sim), 'wolf_fang')).toBe(3);
  });

  it('ignores movement grants (trade, mail, market)', () => {
    const sim = makeSim();
    place(sim, IN_PIT);
    sim.addItem('wolf_fang', 4, sim.playerId, { movement: true });
    expect(expeditionBagUnits(meta(sim), 'wolf_fang')).toBe(0);
  });

  it('climbing out banks the haul on the next living tick', () => {
    const sim = makeSim();
    const p = place(sim, IN_PIT);
    sim.addItem('wolf_fang', 3);
    tickExpeditionBag(sim.ctx, meta(sim), p);
    expect(expeditionBagUnits(meta(sim), 'wolf_fang')).toBe(3); // still below the rim
    place(sim, { ...IN_PIT, y: ABYSS_PIT.rimY + 1 });
    tickExpeditionBag(sim.ctx, meta(sim), p);
    expect(expeditionBagUnits(meta(sim), 'wolf_fang')).toBe(0);
    // a later death back in the pit takes nothing that was carried out
    place(sim, IN_PIT);
    dieInPlace(sim);
    expect(sim.countItem('wolf_fang')).toBe(3);
    expect(meta(sim).expeditionBag?.corpse ?? null).toBeNull();
  });

  it('the live tick secures it too (wired into the player loop)', () => {
    const sim = makeSim();
    place(sim, IN_PIT);
    sim.addItem('wolf_fang', 1);
    // the player starts back on surface ground (the placeholder pit is not carved yet)
    place(sim, sim.groundPos(sim.player.pos.x, sim.player.pos.z));
    if (isInAbyss(sim.player.pos)) throw new Error('fixture expects surface ground');
    sim.tick();
    expect(expeditionBagUnits(meta(sim), 'wolf_fang')).toBe(0);
  });
});

describe('expedition bag: death in the pit', () => {
  it('leaves exactly the ledgered units on the corpse and nothing else', () => {
    const sim = makeSim();
    sim.addItem('wolf_fang', 2); // brought from the surface
    const copperBefore = meta(sim).copper;
    const xpBefore = meta(sim).xp;
    const gearBefore = JSON.stringify(meta(sim).equipment);
    place(sim, IN_PIT);
    sim.addItem('wolf_fang', 3);
    sim.addItem('copper_ore', 5);
    sim.drainEvents();
    dieInPlace(sim);

    expect(sim.player.dead).toBe(true);
    expect(sim.countItem('wolf_fang')).toBe(2);
    expect(sim.countItem('copper_ore')).toBe(0);
    const corpse = meta(sim).expeditionBag?.corpse;
    expect(corpse?.pos).toEqual(IN_PIT);
    expect(corpse?.slots.map((s) => [s.itemId, s.count]).sort()).toEqual([
      ['copper_ore', 5],
      ['wolf_fang', 3],
    ]);
    expect(notices(sim.drainEvents())).toContain('Your expedition bag stays with your corpse.');
    // Daniel's rule: only the bag is lost
    expect(meta(sim).copper).toBe(copperBefore);
    expect(meta(sim).xp).toBe(xpBefore);
    expect(JSON.stringify(meta(sim).equipment)).toBe(gearBefore);
  });

  it('takes only what is still in the bags (used or sold finds are just gone)', () => {
    const sim = makeSim();
    place(sim, IN_PIT);
    sim.addItem('wolf_fang', 3);
    sim.removeItem('wolf_fang', 2);
    dieInPlace(sim);
    expect(meta(sim).expeditionBag?.corpse?.slots).toMatchObject([
      { itemId: 'wolf_fang', count: 1 },
    ]);
  });

  it('a death outside the pit drops nothing and clears the ledger', () => {
    const sim = makeSim();
    const p = place(sim, IN_PIT);
    sim.addItem('wolf_fang', 3);
    p.pos = { ...IN_PIT, y: ABYSS_PIT.rimY + 2 }; // stepped out this very tick
    dieInPlace(sim);
    expect(sim.countItem('wolf_fang')).toBe(3);
    expect(meta(sim).expeditionBag?.corpse ?? null).toBeNull();
    expect(expeditionBagUnits(meta(sim), 'wolf_fang')).toBe(0);
  });
});

describe('expedition bag: recovering or losing it', () => {
  it('the corpse run recovers the exact copies', () => {
    const sim = makeSim();
    place(sim, IN_PIT);
    sim.addItemInstance('linen_pouch', { signer: 'Provenance' }, sim.playerId, 1);
    sim.addItem('copper_ore', 4);
    const before = bagsSnapshot(sim);
    dieInPlace(sim);
    expect(sim.countItem('linen_pouch')).toBe(0);
    sim.releaseSpirit();
    const p = place(sim, IN_PIT); // the ghost runs back to its body
    sim.resurrectAtCorpse();
    expect(p.dead).toBe(false);
    // the revive grounds the body; the placeholder pit is not carved yet, so put
    // it back on the corpse spot the real pit floor would hold it at
    place(sim, IN_PIT);
    sim.drainEvents();
    tickExpeditionBag(sim.ctx, meta(sim), p);

    expect(sim.countItem('linen_pouch')).toBe(1);
    expect(sim.countItem('copper_ore')).toBe(4);
    const pouch = meta(sim).inventory.find((s) => s.itemId === 'linen_pouch');
    expect(pouch?.instance).toEqual({ signer: 'Provenance' });
    // the same copies come back (stack order aside: the bag restores by item id)
    expect(bagsSnapshot(sim)).toBe(before);
    expect(notices(sim.drainEvents())).toEqual(['You recover your expedition bag.']);
    expect(meta(sim).expeditionBag?.corpse).toBeNull();
  });

  it('a recovered bag is at stake again until carried out', () => {
    const sim = makeSim();
    place(sim, IN_PIT);
    sim.addItem('wolf_fang', 3);
    dieInPlace(sim);
    sim.releaseSpirit();
    place(sim, IN_PIT);
    sim.resurrectAtCorpse();
    const p = place(sim, IN_PIT); // still standing in the pit
    tickExpeditionBag(sim.ctx, meta(sim), p);
    expect(sim.countItem('wolf_fang')).toBe(3);
    expect(expeditionBagUnits(meta(sim), 'wolf_fang')).toBe(3);
    // and a second death takes it again
    dieInPlace(sim);
    expect(sim.countItem('wolf_fang')).toBe(0);
  });

  it('a revive away from the body (the camp Spirit Healer) loses it', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    place(sim, IN_PIT);
    sim.addItem('wolf_fang', 3);
    dieInPlace(sim);
    sim.releaseSpirit(); // rises at a graveyard, an angel in reach
    expect(sim.resurrectAtSpiritHealer()).toBe(true);
    const p = sim.player as Entity;
    sim.drainEvents();
    tickExpeditionBag(sim.ctx, meta(sim), p);
    expect(sim.countItem('wolf_fang')).toBe(0);
    expect(notices(sim.drainEvents())).toEqual(['Your expedition bag is lost.']);
    expect(meta(sim).expeditionBag).toBeUndefined();
  });

  it('recovery is gated on the corpse-run range', () => {
    const sim = makeSim();
    place(sim, IN_PIT);
    sim.addItem('wolf_fang', 1);
    dieInPlace(sim);
    const p = sim.player as Entity;
    p.dead = false; // raised somewhere just past the corpse-run range
    place(sim, { ...IN_PIT, x: IN_PIT.x + CORPSE_REZ_RANGE + 1 });
    tickExpeditionBag(sim.ctx, meta(sim), p);
    expect(sim.countItem('wolf_fang')).toBe(0);
  });
});

describe('expedition bag: only the finds themselves', () => {
  it('never takes a pre-owned instance of the same item in place of the found one', () => {
    const sim = makeSim();
    sim.addItemInstance('linen_pouch', { signer: 'Heirloom' }, sim.playerId, 1);
    place(sim, IN_PIT);
    sim.addItemInstance('linen_pouch', { signer: 'Found' }, sim.playerId, 1);
    dieInPlace(sim);
    const left = meta(sim).inventory.filter((s) => s.itemId === 'linen_pouch');
    expect(left.map((s) => s.instance)).toEqual([{ signer: 'Heirloom' }]);
    expect(meta(sim).expeditionBag?.corpse?.slots.map((s) => s.instance)).toEqual([
      { signer: 'Found' },
    ]);
  });

  it('a found instance that was given away is not paid back from another one', () => {
    const sim = makeSim();
    sim.addItemInstance('linen_pouch', { signer: 'Heirloom' }, sim.playerId, 1);
    place(sim, IN_PIT);
    sim.addItemInstance('linen_pouch', { signer: 'Found' }, sim.playerId, 1);
    // the find leaves the bags (traded, sold) before the death
    const idx = meta(sim).inventory.findIndex((s) => s.instance?.signer === 'Found');
    meta(sim).inventory.splice(idx, 1);
    dieInPlace(sim);
    expect(sim.countItem('linen_pouch')).toBe(1);
    expect(meta(sim).expeditionBag).toBeUndefined();
  });

  it('plain finds are paid in plain copies, never an instanced copy', () => {
    const sim = makeSim();
    sim.addItemInstance('linen_pouch', { signer: 'Heirloom' }, sim.playerId, 1);
    place(sim, IN_PIT);
    sim.addItem('linen_pouch', 1);
    dieInPlace(sim);
    const left = meta(sim).inventory.filter((s) => s.itemId === 'linen_pouch');
    expect(left.map((s) => s.instance)).toEqual([{ signer: 'Heirloom' }]);
  });

  it('locking a find does not hide it from the bag, and the lock comes back with it', () => {
    const sim = makeSim();
    place(sim, IN_PIT);
    sim.addItemInstance('linen_pouch', { signer: 'Found' }, sim.playerId, 1);
    const slot = meta(sim).inventory.find((s) => s.itemId === 'linen_pouch')!;
    slot.instance = { ...slot.instance, locked: true };
    dieInPlace(sim);
    expect(sim.countItem('linen_pouch')).toBe(0);
    sim.releaseSpirit();
    const p = place(sim, IN_PIT);
    sim.resurrectAtCorpse();
    place(sim, IN_PIT);
    tickExpeditionBag(sim.ctx, meta(sim), p);
    const back = meta(sim).inventory.find((s) => s.itemId === 'linen_pouch');
    expect(back?.instance).toEqual({ signer: 'Found', locked: true });
  });

  it('a second death before any living tick settles the first bag, then drops it again', () => {
    const sim = makeSim();
    place(sim, IN_PIT);
    sim.addItem('wolf_fang', 3);
    dieInPlace(sim);
    sim.releaseSpirit();
    place(sim, IN_PIT);
    sim.resurrectAtCorpse();
    place(sim, IN_PIT);
    dieInPlace(sim); // killed again on the spot, before the tick ran
    expect(sim.countItem('wolf_fang')).toBe(0);
    expect(meta(sim).expeditionBag?.corpse?.slots).toMatchObject([
      { itemId: 'wolf_fang', count: 3 },
    ]);
  });

  it('a revive straight above the corpse is not the corpse (the pit is deep)', () => {
    const sim = makeSim();
    place(sim, IN_PIT);
    sim.addItem('wolf_fang', 1);
    dieInPlace(sim);
    const p = sim.player as Entity;
    p.dead = false;
    place(sim, { ...IN_PIT, y: IN_PIT.y + CORPSE_REZ_RANGE + 1 });
    tickExpeditionBag(sim.ctx, meta(sim), p);
    expect(sim.countItem('wolf_fang')).toBe(0);
  });
});

describe('expedition bag: persistence', () => {
  it('the moderated-name strip reaches the corpse bag and the finds at stake', () => {
    const sim = makeSim();
    place(sim, IN_PIT);
    sim.addItemInstance('linen_pouch', { name: 'Rude' }, sim.playerId, 1);
    dieInPlace(sim);
    sim.player.dead = false;
    sim.addItemInstance('linen_pouch', { name: 'Ruder' }, sim.playerId, 1);
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(stripLegendaryNames(state, { kind: 'all' })).toBe(3); // corpse, find, and bags
    expect(state.expeditionBag?.corpse?.slots[0].instance?.name).toBeUndefined();
    expect(state.expeditionBag?.found?.[0].instance.name).toBeUndefined();
  });

  it('keeps crafted provenance on a corpse bag across a relog', () => {
    const sim = makeSim();
    place(sim, IN_PIT);
    sim.addItem('linen_pouch', 1, sim.playerId, { craftedRecipeId: 'tailor_linen_pouch' });
    dieInPlace(sim);
    const state = sim.serializeCharacter(sim.playerId)!;
    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: TEST_WORLD });
    const pid = sim2.addPlayer('warrior', 'Relog', { state });
    expect(sim2.meta(pid)!.expeditionBag?.corpse?.slots).toMatchObject([
      { itemId: 'linen_pouch', count: 1, craftedRecipeId: 'tailor_linen_pouch' },
    ]);
  });

  it('a rename re-keys signers inside the corpse bag and the finds at stake', () => {
    const sim = makeSim();
    place(sim, IN_PIT);
    sim.addItemInstance('linen_pouch', { signer: 'Oldname' }, sim.playerId, 1);
    dieInPlace(sim);
    sim.player.dead = false; // standing again (not yet ticked), finds one more
    sim.addItemInstance('linen_pouch', { signer: 'Oldname' }, sim.playerId, 1);
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(rekeyInstanceSigner(state, 'Oldname', 'Newname')).toBe(true);
    expect(state.expeditionBag?.corpse?.slots[0].instance?.signer).toBe('Newname');
    expect(state.expeditionBag?.found?.[0].instance.signer).toBe('Newname');
  });

  it('a save with nothing at stake carries no expeditionBag key', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId)!;
    expect('expeditionBag' in state).toBe(false);
  });

  it('round-trips the ledger and a waiting corpse bag through a relog', () => {
    const sim = makeSim();
    place(sim, IN_PIT);
    sim.addItem('wolf_fang', 2);
    sim.addItemInstance('linen_pouch', { signer: 'Provenance' }, sim.playerId, 1);
    dieInPlace(sim);
    place(sim, IN_PIT);
    sim.addItem('copper_ore', 1, sim.playerId, { movement: true }); // not in the bag
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.expeditionBag?.corpse?.slots.length).toBe(2);

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: TEST_WORLD });
    const pid = sim2.addPlayer('warrior', 'Relog', { state });
    const m2 = sim2.meta(pid)!;
    expect(m2.expeditionBag?.corpse?.slots).toEqual(
      sim.meta(sim.playerId)!.expeditionBag?.corpse?.slots,
    );
    expect(m2.expeditionBag?.corpse?.pos).toEqual(IN_PIT);
  });

  it('load drops malformed ledger counts and empty corpse bags', () => {
    const sim = makeSim();
    const m = meta(sim);
    restoreExpeditionBag(m, {
      ledger: { wolf_fang: 2, bad_neg: -1, bad_frac: 1.5 },
      corpse: { pos: { x: 1, y: 2, z: 3 }, slots: [] },
    });
    expect(m.expeditionBag).toEqual({ ledger: { wolf_fang: 2 }, found: [], corpse: null });
    expect(saveExpeditionBag(m)).toEqual({ expeditionBag: { ledger: { wolf_fang: 2 } } });
  });
});

describe('expedition bag: determinism', () => {
  it('the same inputs build the same bag and inventory on every host', () => {
    const run = () => {
      const sim = makeSim(7);
      place(sim, IN_PIT);
      sim.addItem('copper_ore', 3);
      sim.addItem('wolf_fang', 2);
      sim.addItemInstance('linen_pouch', { signer: 'A' }, sim.playerId, 1);
      dieInPlace(sim);
      return JSON.stringify([meta(sim).expeditionBag, meta(sim).inventory, sim.rng.next()]);
    };
    expect(run()).toBe(run());
  });
});
