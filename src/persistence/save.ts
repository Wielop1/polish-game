import { z } from 'zod';
import { checkInvariants } from '../engine/invariants.ts';
import { netWorth, playerAccount } from '../engine/selectors.ts';
import { GameStateSchema } from '../engine/state.ts';
import type { GameState } from '../engine/state.ts';
import { migrateV1ToV2 } from './migrations.ts';

/**
 * Format zapisu gry.
 *
 * `SAVE_VERSION` zwiększamy przy KAŻDEJ zmianie kształtu GameState. Wtedy dodajemy
 * migrację w `MIGRATIONS[staraWersja]` (przekształca stan z wersji N do N+1);
 * starych zapisów nigdy nie wyrzucamy. Zapis z NOWSZEJ wersji niż znana jest odrzucany.
 */
export const SAVE_FORMAT = 'polski-tycoon-save';
export const SAVE_VERSION = 2;

export const SaveMetaSchema = z.object({
  playerName: z.string(),
  gameDate: z.string(),
  netWorth: z.number(),
  cash: z.number(),
});
export type SaveMeta = z.infer<typeof SaveMetaSchema>;

const EnvelopeSchema = z.object({
  format: z.literal(SAVE_FORMAT),
  version: z.number().int().min(1),
  savedAt: z.string(),
  meta: SaveMetaSchema,
  state: z.unknown(),
});

/** MIGRATIONS[n] przekształca surowy stan zapisu w wersji n do wersji n+1. */
export const MIGRATIONS: Record<number, (state: unknown) => unknown> = {
  1: migrateV1ToV2,
};

export function metaOf(state: GameState): SaveMeta {
  return {
    playerName: `${state.person.firstName} ${state.person.lastName}`,
    gameDate: state.clock.today,
    netWorth: netWorth(state),
    cash: playerAccount(state).balance,
  };
}

/** `savedAt` przekazujemy z zewnątrz (znacznik czasu to rzecz UI, nie silnika). */
export function serializeSave(state: GameState, savedAt: string): string {
  const errors = checkInvariants(state);
  if (errors.length > 0) throw new Error(`Odmowa zapisu niespójnego stanu: ${errors[0]}`);
  return JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION, savedAt, meta: metaOf(state), state });
}

export type ParseResult =
  | { ok: true; state: GameState; meta: SaveMeta; savedAt: string }
  | { ok: false; error: string };

export function migrateState(version: number, state: unknown): unknown {
  let current = state;
  for (let v = version; v < SAVE_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`Brak migracji zapisu z wersji ${v} do ${v + 1}`);
    current = step(current);
  }
  return current;
}

export function parseSave(json: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Zapis jest uszkodzony (nieprawidłowy JSON).' };
  }
  const envelope = EnvelopeSchema.safeParse(raw);
  if (!envelope.success) return { ok: false, error: 'To nie jest zapis gry Polski Tycoon.' };
  const { version, savedAt, meta } = envelope.data;
  if (version > SAVE_VERSION) {
    return { ok: false, error: `Zapis pochodzi z nowszej wersji gry (format ${version}, ta wersja zna ${SAVE_VERSION}).` };
  }
  let stateRaw: unknown;
  try {
    stateRaw = migrateState(version, envelope.data.state);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Migracja zapisu nie powiodła się.' };
  }
  const parsed = GameStateSchema.safeParse(stateRaw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `Zapis ma nieprawidłową strukturę (${issue?.path.join('.') ?? '?'}: ${issue?.message ?? 'błąd'}).` };
  }
  const violations = checkInvariants(parsed.data);
  if (violations.length > 0) {
    return { ok: false, error: `Zapis jest niespójny finansowo: ${violations[0]}` };
  }
  return { ok: true, state: parsed.data, meta, savedAt };
}
