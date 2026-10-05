<!-- src/sim/abyss/: the abyss world pack's sim half. Root + src + src/sim
     CLAUDE.md apply (determinism, sim purity, module-first); not repeated. -->

# src/sim/abyss/: the abyss world (island, rim city, the pit)

The ground and layout of the fork's second world, a round island around a
round pit, loaded INSTEAD of the built-in world through the `WorldContent`
seam (`src/sim/content/abyss_world.ts` assembles the record; the built-in
world stays the default and is untouched). Design source:
`docs/design/abyss-world.md`.

## Files
- `geometry.ts`: the fixed real-scale numbers (pit radius, city and island
  radii, the seven layer depths at 1:1, metres to yards). Pure data plus tiny
  conversions; everything else reads them from here.
- `terrain.ts`: the analytic heightfield (`abyssTerrainHeight`) and the
  open-sea rule (`abyssIsOpenSea`) the pack hands the sim as its
  `WorldTerrainModel`. Shape constants (the spiral ledge, terraces, avenues,
  the hanging quarter) live here so the layout and the tests share them.
- `regions.ts`: the three named regions (names, welcome lines, points of
  interest; what the translation catalog keys) and the rectangle tiles the
  engine streams (`<region>@<col>_<row>`, normalized by `data.ts`
  `zoneRegionId`).
- `city_layout.ts`: the rule-built props (houses, landmarks, the descent arch,
  scaffolds, the hanging quarter, the rim parapet, the boundary camp), roads,
  and mailboxes. Every choice is a `hash2` of fixed inputs: no `Rng` draws.

## Rules
- Coordinates: every radius is measured from `ABYSS_CENTER`, which sits far
  south of the built-in world so the two never share ground; keep the island
  inside the +/-8192 yd range the sim's per-cell memos pack.
- Y = 0 is the rim. The heightfield holds ONE height per (x, z), which is why
  the spiral ledge steps inward each turn (`terrain.ts` header).
- Everything here is a pure function of position and seed: the renderer,
  colliders, pathfinding, and all three hosts sample the same ground.
- Every new player-visible name is IP-checked first (root CLAUDE.md); the
  current ones are recorded in `regions.ts`.
- Tests: `tests/abyss_world.test.ts`.
