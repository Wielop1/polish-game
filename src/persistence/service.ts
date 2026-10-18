import type { GameState } from '../engine/state.ts';
import type { SaveRepository } from './repository.ts';
import { metaOf, parseSave, serializeSave } from './save.ts';
import type { ParseResult } from './save.ts';

export async function saveGame(repo: SaveRepository, slot: string, state: GameState, savedAt: string): Promise<void> {
  await repo.put(slot, serializeSave(state, savedAt), savedAt, metaOf(state));
}

export async function loadGame(repo: SaveRepository, slot: string): Promise<ParseResult> {
  const json = await repo.get(slot);
  if (json === null) return { ok: false, error: 'Brak zapisu w tym slocie.' };
  return parseSave(json);
}
