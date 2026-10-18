import type { SaveMeta } from './save.ts';

export const SAVE_SLOTS = ['autosave', 'slot-1', 'slot-2', 'slot-3'] as const;
export type SaveSlot = (typeof SAVE_SLOTS)[number];

export interface SaveListItem {
  slot: string;
  savedAt: string;
  meta: SaveMeta;
}

/** Magazyn zapisów. Przechowuje gotowy JSON; walidacja należy do `parseSave`. */
export interface SaveRepository {
  list(): Promise<SaveListItem[]>;
  get(slot: string): Promise<string | null>;
  put(slot: string, json: string, savedAt: string, meta: SaveMeta): Promise<void>;
  remove(slot: string): Promise<void>;
}

interface StoredRecord extends SaveListItem {
  json: string;
}

const DB_NAME = 'polski-tycoon';
const STORE = 'saves';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Błąd IndexedDB'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Błąd transakcji IndexedDB'));
    tx.onabort = () => reject(tx.error ?? new Error('Transakcja IndexedDB przerwana'));
  });
}

export function createIndexedDbRepository(factory: IDBFactory = indexedDB, dbName = DB_NAME): SaveRepository {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const open = () => {
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'slot' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Nie można otworzyć IndexedDB'));
    });
    return dbPromise;
  };

  return {
    async list() {
      const db = await open();
      const all = await request<StoredRecord[]>(db.transaction(STORE).objectStore(STORE).getAll());
      return all
        .map(({ slot, savedAt, meta }) => ({ slot, savedAt, meta }))
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    },
    async get(slot) {
      const db = await open();
      const rec = await request<StoredRecord | undefined>(db.transaction(STORE).objectStore(STORE).get(slot));
      return rec?.json ?? null;
    },
    async put(slot, json, savedAt, meta) {
      const db = await open();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ slot, savedAt, meta, json } satisfies StoredRecord);
      await done(tx);
    },
    async remove(slot) {
      const db = await open();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(slot);
      await done(tx);
    },
  };
}

/** Repozytorium w pamięci — do testów i jako awaryjny zapas, gdy IndexedDB jest niedostępne. */
export function createMemoryRepository(): SaveRepository {
  const data = new Map<string, StoredRecord>();
  return {
    async list() {
      return [...data.values()]
        .map(({ slot, savedAt, meta }) => ({ slot, savedAt, meta }))
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    },
    async get(slot) {
      return data.get(slot)?.json ?? null;
    },
    async put(slot, json, savedAt, meta) {
      data.set(slot, { slot, json, savedAt, meta });
    },
    async remove(slot) {
      data.delete(slot);
    },
  };
}

/**
 * Repozytorium odporne na awarie: gdy `primary` (IndexedDB) zgłosi błąd — np. zablokowane
 * w trybie prywatnym — przełącza się na `fallback` (pamięć) i ponawia operację.
 * Zapisy w pamięci nie przetrwają przeładowania strony; UI ostrzega o tym użytkownika.
 */
export function createResilientRepository(
  primary: SaveRepository,
  fallback: SaveRepository,
  onFallback?: (cause: unknown) => void,
): SaveRepository & { isFallback(): boolean } {
  let active = primary;
  let usingFallback = false;
  const run = async <T>(op: (repo: SaveRepository) => Promise<T>): Promise<T> => {
    try {
      return await op(active);
    } catch (cause) {
      if (usingFallback) throw cause;
      usingFallback = true;
      active = fallback;
      onFallback?.(cause);
      return op(active);
    }
  };
  return {
    isFallback: () => usingFallback,
    list: () => run((r) => r.list()),
    get: (slot) => run((r) => r.get(slot)),
    put: (slot, json, savedAt, meta) => run((r) => r.put(slot, json, savedAt, meta)),
    remove: (slot) => run((r) => r.remove(slot)),
  };
}
