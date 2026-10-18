import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../engine/invariants.ts';
import { createNewGame } from '../engine/newGame.ts';
import { advanceDays, advanceToNextMonth } from '../engine/simulate.ts';
import { netWorth } from '../engine/selectors.ts';
import { createIndexedDbRepository, createMemoryRepository, createResilientRepository } from './repository.ts';
import type { SaveRepository } from './repository.ts';
import { loadGame, saveGame } from './service.ts';
import { SAVE_FORMAT, SAVE_VERSION, migrateState, parseSave, serializeSave } from './save.ts';

const game = () => advanceDays(createNewGame({ firstName: 'Anna', lastName: 'Nowak', seed: 'save-test' }), 75);
const NOW = '2026-10-18T12:00:00.000Z';

describe('8. zapis i odczyt rozgrywki', () => {
  it('round-trip: wczytany stan jest identyczny z zapisanym', () => {
    const s = game();
    const parsed = parseSave(serializeSave(s, NOW));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.state).toEqual(s);
    expect(parsed.savedAt).toBe(NOW);
    expect(parsed.meta).toMatchObject({ playerName: 'Anna Nowak', gameDate: s.clock.today, netWorth: netWorth(s) });
    expect(checkInvariants(parsed.state)).toEqual([]);
  });

  it('gra po wczytaniu toczy się dokładnie tak samo jak bez zapisu (losowość nie zależy od zapisu)', () => {
    const s = game();
    const parsed = parseSave(serializeSave(s, NOW));
    if (!parsed.ok) throw new Error(parsed.error);
    let a = s;
    let b = parsed.state;
    for (let i = 0; i < 18; i++) {
      a = advanceToNextMonth(a);
      b = advanceToNextMonth(b);
    }
    expect(b).toEqual(a);
  });

  it('format zawiera znacznik i wersję', () => {
    const raw = JSON.parse(serializeSave(game(), NOW));
    expect(raw.format).toBe(SAVE_FORMAT);
    expect(raw.version).toBe(SAVE_VERSION);
  });

  it('odrzuca uszkodzony JSON i obce pliki', () => {
    expect(parseSave('{nie json')).toMatchObject({ ok: false });
    expect(parseSave('{"foo":1}')).toMatchObject({ ok: false, error: expect.stringContaining('nie jest zapis gry') });
    expect(parseSave('[]')).toMatchObject({ ok: false });
  });

  it('odrzuca zapis z nowszej wersji formatu', () => {
    const raw = JSON.parse(serializeSave(game(), NOW));
    raw.version = SAVE_VERSION + 1;
    const r = parseSave(JSON.stringify(raw));
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('nowszej wersji') });
  });

  it('odrzuca nieprawidłową strukturę (np. zła data, ułamek groszy)', () => {
    const raw = JSON.parse(serializeSave(game(), NOW));
    raw.state.clock.today = '2026-02-30';
    expect(parseSave(JSON.stringify(raw))).toMatchObject({ ok: false, error: expect.stringContaining('struktur') });
    const raw2 = JSON.parse(serializeSave(game(), NOW));
    raw2.state.accounts[raw2.state.playerAccountId].balance = 10.5;
    expect(parseSave(JSON.stringify(raw2))).toMatchObject({ ok: false });
  });

  it('odrzuca zapis zmanipulowany finansowo (saldo ≠ suma rejestru)', () => {
    const raw = JSON.parse(serializeSave(game(), NOW));
    raw.state.accounts[raw.state.playerAccountId].balance += 100_000;
    expect(parseSave(JSON.stringify(raw))).toMatchObject({ ok: false, error: expect.stringContaining('niespójny finansowo') });
  });

  it('odrzuca usunięcie transakcji z rejestru', () => {
    const raw = JSON.parse(serializeSave(game(), NOW));
    raw.state.ledger.pop();
    expect(parseSave(JSON.stringify(raw)).ok).toBe(false);
  });

  it('odmawia zapisania niespójnego stanu', () => {
    const s = structuredClone(game());
    s.accounts[s.playerAccountId]!.balance += 1;
    expect(() => serializeSave(s, NOW)).toThrow(/niespójnego/);
  });

  it('migracje: brak kroku migracji zgłasza błąd, aktualna wersja jest przepuszczana bez zmian', () => {
    expect(migrateState(SAVE_VERSION, { a: 1 })).toEqual({ a: 1 });
    expect(() => migrateState(0, {})).toThrow(/Brak migracji/);
  });
});

describe('repozytoria zapisów', () => {
  const suites: [string, () => ReturnType<typeof createMemoryRepository>][] = [
    ['pamięć', () => createMemoryRepository()],
    ['IndexedDB (fake-indexeddb)', () => createIndexedDbRepository(new IDBFactory(), 'test-db')],
  ];
  for (const [name, make] of suites) {
    it(`${name}: zapis, odczyt, nadpisanie, lista i usuwanie`, async () => {
      const repo = make();
      const s1 = game();
      const s2 = advanceToNextMonth(s1);
      expect(await repo.list()).toEqual([]);
      expect(await loadGame(repo, 'slot-1')).toMatchObject({ ok: false });

      await saveGame(repo, 'slot-1', s1, '2026-10-18T10:00:00.000Z');
      await saveGame(repo, 'slot-2', s2, '2026-10-18T11:00:00.000Z');
      const loaded = await loadGame(repo, 'slot-1');
      expect(loaded.ok && loaded.state).toEqual(s1);

      let list = await repo.list();
      expect(list.map((i) => i.slot)).toEqual(['slot-2', 'slot-1']); // najnowszy pierwszy
      expect(list[0]!.meta.gameDate).toBe(s2.clock.today);

      await saveGame(repo, 'slot-1', s2, '2026-10-18T12:00:00.000Z'); // nadpisanie
      list = await repo.list();
      expect(list).toHaveLength(2);
      expect(list[0]!.slot).toBe('slot-1');
      const reloaded = await loadGame(repo, 'slot-1');
      expect(reloaded.ok && reloaded.state.clock.today).toBe(s2.clock.today);

      await repo.remove('slot-1');
      expect((await repo.list()).map((i) => i.slot)).toEqual(['slot-2']);
      expect(await repo.get('slot-1')).toBeNull();
    });
  }
});

describe('repozytorium odporne na awarie', () => {
  const broken: SaveRepository = {
    list: () => Promise.reject(new Error('IndexedDB zablokowane')),
    get: () => Promise.reject(new Error('IndexedDB zablokowane')),
    put: () => Promise.reject(new Error('IndexedDB zablokowane')),
    remove: () => Promise.reject(new Error('IndexedDB zablokowane')),
  };

  it('przełącza się na pamięć po błędzie głównego magazynu i działa dalej', async () => {
    let notified = 0;
    const repo = createResilientRepository(broken, createMemoryRepository(), () => notified++);
    expect(repo.isFallback()).toBe(false);
    await saveGame(repo, 'slot-1', game(), NOW); // pierwszy zapis wywołuje przełączenie
    expect(repo.isFallback()).toBe(true);
    expect(notified).toBe(1);
    const loaded = await loadGame(repo, 'slot-1');
    expect(loaded.ok).toBe(true);
    expect((await repo.list()).map((i) => i.slot)).toEqual(['slot-1']);
    expect(notified).toBe(1); // przełączenie tylko raz
  });

  it('nie maskuje błędów, gdy sprawny jest główny magazyn', async () => {
    const repo = createResilientRepository(createMemoryRepository(), broken);
    await saveGame(repo, 'slot-1', game(), NOW);
    expect(repo.isFallback()).toBe(false);
  });
});
