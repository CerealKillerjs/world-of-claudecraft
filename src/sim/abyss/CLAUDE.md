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
  `WorldTerrainModel`. Shape constants for the pit (the spiral ledge, the
  hanging quarter) live here so the layout and the tests share them; the
  city's ground comes from `city_plan.ts`.
- `city_plan.ts`: Rimholt's street plan and the city ground it makes:
  irregular terrace walls built from straight runs (`wallRadiusAt`,
  `wallCorners`), the bending avenues, the stair lanes through each wall,
  the five districts, and the garden plots. `cityGround` is the one height
  and surface read the terrain, the layout and the paint all share.
- `city_streets.ts`: the street network inside each terrace: meandering
  ring streets, cross alleys (district grain in `STREET_GRAIN`: spacing,
  width, skew, dead ends), the stair lanes and avenues as forced alleys, the
  blocks between through alleys, the plazas, and the paint query
  `cityStreetAt`.
- `city_blocks.ts`: the lots on that network: two rows of attached houses
  back to back per block, district by district (`LOT_GRAIN`), courtyards,
  orchard lots on the garden plots, plaza wells, stalls and trees, the
  parapets on the wall tops, and the main ring streets as lit roads.
- `city_buildings.ts`: the procedural building kinds (`rimHouse`, `rimTall`,
  `rimTower`, `rimHall`, `rimWorkshop`, `rimShack`, `rimCottage`) and the
  form each takes (`rimholtBuildingForm`: storeys, roof, chimney). The sim
  reads it for the collider height; `src/render/rimholt_buildings_core.ts`
  builds the same form, so drawn and collided shapes match.
- `surface.ts`: what the ground is made of where it is built (paving, street,
  masonry, garden, earth), the pack's render-only `surfaceAt` hook; the
  painter is `src/render/ground_surface_core.ts`.
- `regions.ts`: the three named regions (names, welcome lines, points of
  interest; what the translation catalog keys) and the rectangle tiles the
  engine streams (`<region>@<col>_<row>`, normalized by `data.ts`
  `zoneRegionId`).
- `city_layout.ts`: the rim and pit props (landmarks, the descent arch,
  scaffolds, the hanging quarter, the rim parapet, the boundary camp), the
  road network, the mailboxes, and the assembly of the whole prop set. Every
  choice is a `hash2` of fixed inputs: no `Rng` draws.

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
- The city is meant to read as organic and a little irregular yet plainly
  man-made (owner's brief, 2026-10-05), dynamic and as unrepetitive as
  possible, with alleys and plazas, and its districts clearly told apart
  (2026-10-06): walls of straight runs at uneven corners, not circles;
  streets that meander, not rings; avenues that bend, not spokes; every
  district its own grain. Keep that when extending it.
- Size and layout follow the owner's reference plan (2026-10-06): the pit
  stays 1 km across, the city is about 2 km across in three tiers, and the
  districts are ring sectors per tier (`districtAt`).
- Tests: `tests/abyss_world.test.ts` (scale, pit, regions, boot),
  `tests/abyss_city.test.ts` (plan, ground, streets, blocks),
  `tests/rimholt_buildings_core.test.ts` (the house triangles), `tests/abyss_terrain_paint.test.ts`
  and `tests/ground_surface_core.test.ts` (the paint).
