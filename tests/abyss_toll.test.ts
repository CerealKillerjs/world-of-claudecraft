// The abyss ascent toll ("the Weight"): the depth/layer leaf, the pure climb
// tracker, each layer's charge, and the live tick path end to end. Design:
// docs/design/abyss-world.md section 4.3.

import { afterEach, describe, expect, it } from 'vitest';
import {
  ABYSS_LAYER_COUNT,
  type AbyssDef,
  abyssDepthYd,
  abyssLayerAtDepthYd,
  activeAbyss,
  YD_PER_M,
} from '../src/sim/abyss_depth';
import { applyAbyssToll } from '../src/sim/abyss_toll';
import {
  ABYSS_TOLL_CAUSE,
  ABYSS_TOLL_DEFORMATION_ID,
  ABYSS_TOLL_DIZZINESS_ID,
  ABYSS_TOLL_HOLLOWING_ID,
  ABYSS_TOLL_LAYERS,
  ABYSS_TOLL_NAUSEA_ID,
  ABYSS_TOLL_RENDING_ID,
  ABYSS_TOLL_TREMBLING_ID,
  ABYSS_TOLL_VISIONS_ID,
  type AbyssTollPlayerState,
  RELOCATE_YD,
  stepAbyssToll,
  TOLL_RISE_YD,
} from '../src/sim/abyss_toll_core';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { localizeAbyssTollName } from '../src/ui/abyss_toll_i18n';
import { deathRecapFeedback } from '../src/ui/death_recap_feedback';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

const M = YD_PER_M;

afterEach(() => setActiveWorldContent(null));

describe('abyss depth and layers', () => {
  const abyss: AbyssDef = {
    rimY: 100,
    regions: [
      { kind: 'circle', x: 0, z: 0, r: 547 },
      { kind: 'rect', minX: 5000, maxX: 6000, minZ: -500, maxZ: 500 },
    ],
  };

  it('the built-in world declares no abyss, so nothing reads as inside it', () => {
    expect(activeAbyss()).toBeUndefined();
    expect(abyssDepthYd(0, -5000, 0)).toBeNull();
  });

  it('measures depth below the rim inside any region, and nothing outside', () => {
    expect(abyssDepthYd(0, 90, 0, abyss)).toBe(10);
    expect(abyssDepthYd(5500, -900, 0, abyss)).toBe(1000);
    // outside every footprint, at or above the rim
    expect(abyssDepthYd(600, 0, 0, abyss)).toBeNull();
    expect(abyssDepthYd(0, 100, 0, abyss)).toBeNull();
    expect(abyssDepthYd(0, 150, 0, abyss)).toBeNull();
  });

  it('reads the active world content', () => {
    setActiveWorldContent({ ...BUILTIN_WORLD, abyss });
    expect(abyssDepthYd(0, 0, 0)).toBe(100);
  });

  it('maps depth to the seven 1:1 layers at the reference metre bounds', () => {
    expect(ABYSS_LAYER_COUNT).toBe(7);
    const cases: [number, number][] = [
      [1, 1],
      [1349, 1],
      [1350, 2],
      [2599, 2],
      [2600, 3],
      [6999, 3],
      [7000, 4],
      [11999, 4],
      [12000, 5],
      [12999, 5],
      [13000, 6],
      [15499, 6],
      [15500, 7],
      [20000, 7],
    ];
    for (const [metres, layer] of cases) expect(abyssLayerAtDepthYd(metres * M)).toBe(layer);
  });
});

describe('the climb tracker', () => {
  function sample(y: number, tick: number, depthYd: number | null = 1000 - y, x = 0) {
    return { x, y, z: 0, tick, depthYd };
  }

  it('charges once on a 10 m rise above the low mark, then re-anchors', () => {
    expect(TOLL_RISE_YD).toBeCloseTo(10 * M, 9);
    const h: AbyssTollPlayerState = {};
    let tick = 0;
    expect(stepAbyssToll(h, sample(-100, tick++))).toBe(0);
    // descend 20 yd, then climb back up a yard at a time
    for (let y = -101; y >= -120; y--) expect(stepAbyssToll(h, sample(y, tick++))).toBe(0);
    const charges: number[] = [];
    for (let y = -119; y <= -100; y++) {
      const c = stepAbyssToll(h, sample(y, tick++));
      if (c) charges.push(y);
    }
    // the charge lands at the first sample at least 10.94 yd above -120
    expect(charges).toEqual([-109]);
    // the mark moved to where the toll was paid; the last 9 yd stay under the bar
    expect(h.abyssToll?.lowY).toBe(-109);
  });

  it('never charges on jump-height bobbing', () => {
    const h: AbyssTollPlayerState = {};
    for (let t = 0; t < 400; t++) {
      expect(stepAbyssToll(h, sample(-500 + (t % 20 < 10 ? 0 : 1.1), t))).toBe(0);
    }
  });

  it('charges the DEEPEST layer reached since the last payment', () => {
    const h: AbyssTollPlayerState = {};
    const rim = 0;
    const at = (depthM: number) => rim - depthM * M;
    let tick = 0;
    const step = (y: number) => stepAbyssToll(h, { x: 0, y, z: 0, tick: tick++, depthYd: rim - y });
    // stand in layer 3, dip into layer 4 (in small steps), climb back to layer 3
    for (let d = 6990; d <= 7005; d += 0.5) expect(step(at(d))).toBe(0);
    let charged = 0;
    for (let d = 7005; d >= 6990 && !charged; d -= 0.5) charged = step(at(d));
    expect(charged).toBe(4);
    // after paying, the next charge prices only where the player now is
    charged = 0;
    for (let d = 6994; d >= 6970 && !charged; d -= 0.5) charged = step(at(d));
    expect(charged).toBe(3);
  });

  it('a teleport or a missed tick re-anchors without charging, keeping the deepest layer', () => {
    const h: AbyssTollPlayerState = {};
    expect(stepAbyssToll(h, sample(-300, 0))).toBe(0);
    // a revive at a camp far above: more than RELOCATE_YD in one tick
    expect(stepAbyssToll(h, sample(-300 + RELOCATE_YD + 1, 1))).toBe(0);
    expect(h.abyssToll?.lowY).toBe(-300 + RELOCATE_YD + 1);
    // a gap in samples (dead, or out of the tick) also re-anchors
    expect(stepAbyssToll(h, sample(-200, 10))).toBe(0);
    expect(h.abyssToll?.lowY).toBe(-200);
    // but a continuous rise of 11 yd under the relocation bound does charge
    expect(stepAbyssToll(h, sample(-189, 11))).toBe(1);
  });

  it('leaving the abyss clears the tracking', () => {
    const h: AbyssTollPlayerState = {};
    stepAbyssToll(h, sample(-300, 0));
    expect(stepAbyssToll(h, sample(5, 1, null))).toBe(0);
    expect(h.abyssToll).toBeUndefined();
  });
});

describe('what each layer charges', () => {
  function fresh(seed = 7) {
    const sim = new Sim({ seed, playerClass: 'warrior' });
    const p = sim.player;
    p.maxHp = 10_000;
    p.hp = 10_000;
    return { sim, p };
  }
  const ids = (sim: Sim) =>
    sim.player.auras
      .map((a) => a.id)
      .filter((id) => id.startsWith('abyss_toll_'))
      .sort();

  it('every layer has a toll entry, deepest last', () => {
    expect(ABYSS_TOLL_LAYERS.map((l) => l.layer)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('layer 1: healing received halved, undispellable', () => {
    const { sim, p } = fresh();
    applyAbyssToll(sim.ctx, p, 1);
    const a = p.auras.find((x) => x.id === ABYSS_TOLL_DIZZINESS_ID);
    expect(a?.kind).toBe('mortal_wound');
    expect(a?.value).toBe(0.5);
    expect(a?.undispellable).toBe(true);
    expect(sim.ctx.healingTakenMult(p)).toBe(0.5);
  });

  it('each layer adds its own effect on top of every shallower one', () => {
    const expected = [
      [ABYSS_TOLL_DIZZINESS_ID],
      [ABYSS_TOLL_DIZZINESS_ID, ABYSS_TOLL_NAUSEA_ID, ABYSS_TOLL_TREMBLING_ID],
      [
        ABYSS_TOLL_DIZZINESS_ID,
        ABYSS_TOLL_NAUSEA_ID,
        ABYSS_TOLL_TREMBLING_ID,
        ABYSS_TOLL_VISIONS_ID,
      ],
      [
        ABYSS_TOLL_DIZZINESS_ID,
        ABYSS_TOLL_NAUSEA_ID,
        ABYSS_TOLL_TREMBLING_ID,
        ABYSS_TOLL_VISIONS_ID,
        ABYSS_TOLL_RENDING_ID,
      ],
      [
        ABYSS_TOLL_DIZZINESS_ID,
        ABYSS_TOLL_NAUSEA_ID,
        ABYSS_TOLL_TREMBLING_ID,
        ABYSS_TOLL_VISIONS_ID,
        ABYSS_TOLL_RENDING_ID,
        ABYSS_TOLL_HOLLOWING_ID,
      ],
    ];
    expected.forEach((want, i) => {
      const { sim, p } = fresh();
      applyAbyssToll(sim.ctx, p, i + 1);
      expect(ids(sim)).toEqual([...want].sort());
    });
  });

  it('layer 4 rends a fixed share of max health every 2 sec', () => {
    const { sim, p } = fresh();
    applyAbyssToll(sim.ctx, p, 4);
    const dot = p.auras.find((a) => a.id === ABYSS_TOLL_RENDING_ID);
    expect(dot?.kind).toBe('dot');
    // the share is of the max health the wearer has when the toll lands
    expect(dot?.value).toBe(Math.max(1, Math.round(p.maxHp * 0.04)));
    expect(dot?.tickInterval).toBe(2);
    const ticks: number[] = [];
    for (let t = 0; t < 20 * 6; t++) {
      for (const e of sim.tick()) {
        if (e.type === 'damage' && e.targetId === p.id && e.ability === 'Rending')
          ticks.push(e.amount);
      }
    }
    // 6 sec: three 2 sec ticks of the resolved share
    expect(ticks).toEqual([dot?.value, dot?.value, dot?.value]);
  });

  it('layer 5 drops the target and silences', () => {
    const { sim, p } = fresh();
    p.targetId = 12345;
    applyAbyssToll(sim.ctx, p, 5);
    expect(p.targetId).toBeNull();
    expect(p.auras.some((a) => a.id === ABYSS_TOLL_HOLLOWING_ID && a.kind === 'silence')).toBe(
      true,
    );
  });

  it('layer 6 kills or deforms on one Rng roll, deterministically per seed', () => {
    // Two worlds on one seed charge layer 6 thirty times each (reviving in
    // between): both see the same sequence of fates, and both fates occur.
    const fates = () => {
      const { sim, p } = fresh(7);
      const out: string[] = [];
      for (let i = 0; i < 30; i++) {
        applyAbyssToll(sim.ctx, p, 6);
        const deformed = p.auras.some((a) => a.id === ABYSS_TOLL_DEFORMATION_ID);
        out.push(p.dead ? 'dead' : deformed ? 'deformed' : '?');
        p.dead = false;
        p.hp = p.maxHp;
        p.auras = [];
      }
      return out;
    };
    const first = fates();
    expect(fates()).toEqual(first);
    expect([...new Set(first)].sort()).toEqual(['dead', 'deformed']);
  });

  it('layer 7 always kills, carrying the toll as the cause', () => {
    const { sim, p } = fresh();
    const events: { type: string; killerAbility?: string | null }[] = [];
    const emit = sim.ctx.emit;
    sim.ctx.emit = (e) => {
      events.push(e as { type: string });
      emit(e);
    };
    applyAbyssToll(sim.ctx, p, 7);
    expect(p.dead).toBe(true);
    const death = events.find((e) => e.type === 'playerDeath');
    expect(death?.killerAbility).toBe(ABYSS_TOLL_CAUSE);
  });
});

describe('the live tick path', () => {
  function abyssWorldSim(seed = 11) {
    // A rim far above the ground puts the whole spawn area deep in layer 1.
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      abyss: { rimY: 1000, regions: [{ kind: 'circle', x: 0, z: 0, r: 100_000 }] },
    });
    const sim = new Sim({ seed, playerClass: 'warrior' });
    const p = sim.player;
    p.maxHp = 1_000_000;
    p.hp = 1_000_000;
    return { sim, p };
  }

  it('standing still in the abyss charges nothing', () => {
    const { sim, p } = abyssWorldSim();
    for (let t = 0; t < 200; t++) sim.tick();
    expect(p.auras.some((a) => a.id.startsWith('abyss_toll_'))).toBe(false);
    expect(sim.players.get(p.id)?.abyssToll).toBeDefined();
  });

  it('a 12 yd lift charges the toll through Sim.tick', () => {
    const { sim, p } = abyssWorldSim();
    for (let t = 0; t < 20; t++) sim.tick();
    p.pos.y += 12; // a lift raises the player in one tick
    sim.tick();
    expect(p.auras.some((a) => a.id === ABYSS_TOLL_DIZZINESS_ID)).toBe(true);
  });

  it('stepping past the footprint edge below the rim keeps the debt', () => {
    const { sim, p } = abyssWorldSim();
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      abyss: { rimY: 1000, regions: [{ kind: 'circle', x: p.pos.x, z: p.pos.z, r: 1 }] },
    });
    for (let t = 0; t < 20; t++) sim.tick();
    expect(sim.players.get(p.id)?.abyssToll).toBeDefined();
    p.pos.x += 5; // a side ledge outside the footprint, still below the rim
    sim.tick();
    expect(sim.players.get(p.id)?.abyssToll).toBeDefined();
    p.pos.y += 12;
    sim.tick();
    expect(p.auras.some((a) => a.id === ABYSS_TOLL_DIZZINESS_ID)).toBe(true);
  });

  it('the same climb in the built-in world charges nothing', () => {
    const sim = new Sim({ seed: 11, playerClass: 'warrior' });
    const p = sim.player;
    p.maxHp = 1_000_000;
    p.hp = 1_000_000;
    for (let t = 0; t < 20; t++) sim.tick();
    p.pos.y += 12;
    sim.tick();
    expect(p.auras.some((a) => a.id.startsWith('abyss_toll_'))).toBe(false);
    expect(sim.players.get(p.id)?.abyssToll).toBeUndefined();
  });
});

describe('client names', () => {
  it('every toll aura name and the cause resolve through the sim aura matcher', () => {
    const names = new Set<string>([ABYSS_TOLL_CAUSE]);
    for (const l of ABYSS_TOLL_LAYERS) {
      for (const a of [...l.auras, ...(l.survivorAuras ?? [])]) names.add(a.name);
    }
    for (const n of names) {
      expect(localizeAbyssTollName(n), n).toBeTruthy();
      expect(localizeSimAuraName(n), n).toBe(localizeAbyssTollName(n));
    }
  });

  it('a toll death reads as its own sentence in the recap', () => {
    expect(deathRecapFeedback(undefined, ABYSS_TOLL_CAUSE, undefined).key).toBe(
      'hud.system.deathRecapAbyssToll',
    );
  });
});
