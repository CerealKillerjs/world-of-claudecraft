// Offline boot into a code-built world pack (the abyss world) from the URL:
// `/?world=abyss` (optionally `&class=mage&name=Ilse`). Like the editor
// play-test handoff it only shapes the local OFFLINE Sim: no server, no saved
// character, nothing authoritative. It exists so the fork's new world can be
// walked in a browser while the server-side world selection is still to come.
//
// `takeBootWorldRequest` is the one call main.ts makes: a pending editor
// play-test wins (it was asked for explicitly by the editor), then a world
// pack named in the URL, else null and the normal start screen runs.

import { ABYSS_WORLD_ID, abyssWorld } from '../sim/content/abyss_world';
import type { PlayerClass, WorldContent } from '../sim/types';
import { WORLD_SEED } from '../sim/world_seed';
import { type EditorPlaytestRequest, takeEditorPlaytestRequest } from './editor_playtest';

// Builders, not records: a pack is assembled only when the URL asks for it.
const WORLD_PACKS: Readonly<Record<string, () => WorldContent>> = {
  [ABYSS_WORLD_ID]: abyssWorld,
};

const PACK_CLASSES: ReadonlySet<string> = new Set([
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'mage',
  'warlock',
  'druid',
  'shaman',
]);

/** Parse a world-pack boot request out of a query string (pure, testable). */
export function parseWorldPackRequest(search: string): EditorPlaytestRequest | null {
  const params = new URLSearchParams(search);
  const id = params.get('world');
  if (!id || !Object.hasOwn(WORLD_PACKS, id)) return null;
  const cls = params.get('class') ?? '';
  const name = (params.get('name') ?? '').trim().slice(0, 24);
  return {
    content: WORLD_PACKS[id](),
    seed: WORLD_SEED,
    playerClass: PACK_CLASSES.has(cls) ? (cls as PlayerClass) : 'warrior',
    playerName: name || 'Sounder',
  };
}

export function takeBootWorldRequest(): EditorPlaytestRequest | null {
  return takeEditorPlaytestRequest() ?? parseWorldPackRequest(location.search);
}
