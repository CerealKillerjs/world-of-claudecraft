// The Sounding: the fixed real-scale measurements of the abyss world.
//
// Pure data plus tiny conversions, no state and no imports beyond the yard
// constant, so the terrain model, the world pack, the renderer, and tests all
// read one set of numbers. The design source is
// docs/design/abyss-world.md (sections 2 and 4): the pit and the layer depths
// are 1:1 with the reference work (metres converted to engine yards), the city
// and island sizes are our own estimates (decided 2026-10-06: a compact city
// about 2 km across, three terraces, after the owner's reference plan).
//
// Coordinates: every radius here is measured from the pit's axis, ABYSS_CENTER.
// The island sits well south of the built-in world's rectangle so the two
// worlds never share ground: built-in systems that still key off absolute
// positions (walk lifts, border waters, scatter) simply never reach it. North
// is +z (the engine's convention). Y = 0 is the rim of the pit, so every point
// inside the pit has Y < 0 and its depth below the rim is simply -Y.

/** Engine yards per metre (1 m = 1.0936 yd). */
export const YARDS_PER_METER = 1 / 0.9144;

export function metersToYards(m: number): number {
  return m * YARDS_PER_METER;
}

export function yardsToMeters(yd: number): number {
  return yd / YARDS_PER_METER;
}

/** The pit's axis in world coordinates. The island (radius up to
 *  WORLD_HALF_EXTENT) stays clear of the built-in world (z >= -180) and inside
 *  the +/-8192 yd range the sim's per-cell memos pack. */
export const ABYSS_CENTER = { x: 0, z: -4200 } as const;

/** Radius of the pit's mouth: a ~1,000 m wide opening (1,094 yd across). */
export const PIT_RADIUS = 547;
/** Mean outer edge of the rim plaza (the lower tier: lifts, the explorers'
 *  hall, the market, and the poor quarter), where the first terrace wall rises. The wall
 *  itself wanders a little either side (city_plan.ts). */
export const RIM_OUTER_RADIUS = 720;
/** Outer edge of the city: about 2 km across (1,000 m, 1,094 yd radius). */
export const CITY_OUTER_RADIUS = 1094;
/** Where the island's farmland meets the beach. */
export const ISLAND_RADIUS = 2700;
/** Where the beach shelf has fallen to open sea floor. */
export const COAST_OUTER_RADIUS = 2950;
/** The playable square the world pack's zones tile (half-width). */
export const WORLD_HALF_EXTENT = 2970;

/** Height of the rim plaza: the zero of every depth reading. */
export const RIM_HEIGHT = 0;

/** One stratum of the pit. Depths are metres below the rim (positive down). */
export interface AbyssLayer {
  /** 1-based layer number. */
  index: number;
  topMeters: number;
  /** Infinity for the last layer (its true bottom is unknown). */
  bottomMeters: number;
}

/** The seven layers at the reference work's published depths (data, not text;
 *  design doc section 2). Names are deliberately absent: they are display
 *  content and live with the world pack's localized labels. */
export const ABYSS_LAYERS: readonly AbyssLayer[] = [
  { index: 1, topMeters: 0, bottomMeters: 1350 },
  { index: 2, topMeters: 1350, bottomMeters: 2600 },
  { index: 3, topMeters: 2600, bottomMeters: 7000 },
  { index: 4, topMeters: 7000, bottomMeters: 12000 },
  { index: 5, topMeters: 12000, bottomMeters: 13000 },
  { index: 6, topMeters: 13000, bottomMeters: 15500 },
  { index: 7, topMeters: 15500, bottomMeters: Number.POSITIVE_INFINITY },
];

/** Depth in metres below the rim for a world height (0 at or above the rim). */
export function depthMetersAtY(y: number): number {
  return y >= RIM_HEIGHT ? 0 : yardsToMeters(RIM_HEIGHT - y);
}

/** The layer a depth (metres below the rim) falls in; 0 means "not in the pit". */
export function layerAtDepthMeters(depth: number): number {
  if (!(depth > 0)) return 0;
  for (const layer of ABYSS_LAYERS) {
    if (depth < layer.bottomMeters) return layer.index;
  }
  return ABYSS_LAYERS[ABYSS_LAYERS.length - 1].index;
}

/** World Y of a layer's floor (its bottom boundary), in yards. */
export function layerFloorY(index: number): number {
  const layer = ABYSS_LAYERS[index - 1];
  if (!layer || !Number.isFinite(layer.bottomMeters)) {
    throw new Error(`layer ${index} has no finite floor`);
  }
  return RIM_HEIGHT - metersToYards(layer.bottomMeters);
}

/** Layer 1's floor: 1,350 m below the rim (about -1,476 yd). */
export const LAYER1_FLOOR_Y = layerFloorY(1);
