// Which biome a world point belongs to: the zone-band biome every sim and
// render read uses (zoneBiomeAt), and the editor's painted override on top
// of it (biomeAt). Moved out of world.ts (a monolith under the ratchet) as a
// pure leaf: it reads only the active world content, never the heightfield.

import { getActiveWorldContent, zoneAt } from './data';
import type { BiomeId } from './types';

export function zoneBiomeAt(x: number, z: number): BiomeId {
  // Delegates to zoneAt rather than repeating its rect walk over the static
  // ZONES const: zoneAt resolves the ACTIVE content's zones (builtin
  // fallback), and a private copy here was the one place the biome could
  // disagree with every other zone read on a custom map.
  return getActiveWorldContent().terrainModel?.biomeAt?.(x, z) ?? zoneAt(x, z).biome;
}

// Paint grid id -> biome. APPEND-ONLY: the id is persisted in map documents.
export const BIOME_BY_ID: BiomeId[] = [
  'vale',
  'marsh',
  'peaks',
  'beach',
  'desert',
  'volcano',
  'cave',
];

// The painted biome at (x,z), or null if unpainted / no paint layer. Cheap grid
// lookup; absent for the built-in world (getActiveWorldContent has no biomePaint).
function paintedBiomeAt(x: number, z: number): BiomeId | null {
  const bp = getActiveWorldContent().biomePaint;
  if (!bp) return null;
  const c = Math.floor((x - bp.originX) / bp.cell);
  const r = Math.floor((z - bp.originZ) / bp.cell);
  if (c < 0 || c >= bp.cols || r < 0 || r >= bp.rows) return null;
  const id = bp.ids[r * bp.cols + c];
  return id >= 0 && id < BIOME_BY_ID.length ? BIOME_BY_ID[id] : null;
}

// Biome at a world point: the painted override if any (map editor), else the
// zone-band biome. This is the 2D biome the renderer colours by; zoneBiomeAt
// stays the grid version. With no paint layer this equals zoneBiomeAt(x, z).
export function biomeAt(x: number, z: number): BiomeId {
  return paintedBiomeAt(x, z) ?? zoneBiomeAt(x, z);
}
