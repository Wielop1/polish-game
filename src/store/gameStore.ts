import { create } from 'zustand';
import { ZodError } from 'zod';
import { createNewGame, NewGameInputSchema } from '../engine/newGame.ts';
import type { NewGameInput } from '../engine/newGame.ts';
import { advanceOneDay, advanceToNextMonth } from '../engine/simulate.ts';
import type { GameState } from '../engine/state.ts';
import { createIndexedDbRepository, createMemoryRepository, createResilientRepository } from '../persistence/repository.ts';
import type { SaveListItem, SaveRepository } from '../persistence/repository.ts';
import { loadGame, saveGame } from '../persistence/service.ts';

export type Screen = 'dashboard' | 'character' | 'finances' | 'calendar' | 'events' | 'game';

export interface Notice {
  kind: 'info' | 'success' | 'error';
  text: string;
}

export type FieldErrors = Partial<Record<'firstName' | 'lastName' | 'seed', string>>;

let repository: (SaveRepository & { isFallback(): boolean }) | null = null;
let overrideActive = false;

export function getRepository(): SaveRepository {
  if (!repository) {
    const primary = typeof indexedDB === 'undefined' ? createMemoryRepository() : createIndexedDbRepository();
    repository = createResilientRepository(primary, createMemoryRepository());
  }
  return repository;
}
/** Do testów: podmiana magazynu zapisów. */
export function setRepository(repo: SaveRepository): void {
  repository = Object.assign(repo, { isFallback: () => false });
  overrideActive = true;
}
export function isUsingMemoryFallback(): boolean {
  return !overrideActive && (typeof indexedDB === 'undefined' || (repository?.isFallback() ?? false));
}

interface GameStore {
  game: GameState | null;
  screen: Screen;
  saves: SaveListItem[];
  notice: Notice | null;
  loadingSaves: boolean;

  init: () => Promise<void>;
  navigate: (screen: Screen) => void;
  dismissNotice: () => void;
  startNewGame: (input: NewGameInput) => FieldErrors | null;
  advanceDay: () => void;
  advanceMonth: () => void;
  saveToSlot: (slot: string) => Promise<void>;
  loadFromSlot: (slot: string) => Promise<void>;
  deleteSlot: (slot: string) => Promise<void>;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useGameStore = create<GameStore>((set, get) => {
  const refreshSaves = async () => {
    try {
      set({ saves: await getRepository().list(), loadingSaves: false });
    } catch (e) {
      set({ loadingSaves: false, notice: { kind: 'error', text: `Nie można odczytać zapisów: ${errMsg(e)}` } });
    }
  };

  const autosave = async (state: GameState) => {
    try {
      await saveGame(getRepository(), 'autosave', state, new Date().toISOString());
      await refreshSaves();
    } catch (e) {
      set({ notice: { kind: 'error', text: `Autozapis nie powiódł się: ${errMsg(e)}` } });
    }
  };

  const applyAdvance = (fn: (s: GameState) => GameState) => {
    const game = get().game;
    if (!game) return;
    try {
      const next = fn(game);
      set({ game: next, notice: null });
      void autosave(next);
    } catch (e) {
      set({ notice: { kind: 'error', text: `Błąd symulacji: ${errMsg(e)}` } });
    }
  };

  return {
    game: null,
    screen: 'game',
    saves: [],
    notice: null,
    loadingSaves: true,

    init: refreshSaves,
    navigate: (screen) => set({ screen, notice: null }),
    dismissNotice: () => set({ notice: null }),

    startNewGame: (input) => {
      const parsed = NewGameInputSchema.safeParse(input);
      if (!parsed.success) {
        const errors: FieldErrors = {};
        for (const issue of (parsed.error as ZodError).issues) {
          const key = issue.path[0];
          if ((key === 'firstName' || key === 'lastName' || key === 'seed') && !errors[key]) errors[key] = issue.message;
        }
        return errors;
      }
      const game = createNewGame(input);
      set({ game, screen: 'dashboard', notice: { kind: 'success', text: `Nowa gra: ${game.person.firstName} ${game.person.lastName}` } });
      void autosave(game);
      return null;
    },

    advanceDay: () => applyAdvance(advanceOneDay),
    advanceMonth: () => applyAdvance(advanceToNextMonth),

    saveToSlot: async (slot) => {
      const game = get().game;
      if (!game) return;
      try {
        await saveGame(getRepository(), slot, game, new Date().toISOString());
        await refreshSaves();
        set({ notice: { kind: 'success', text: 'Gra zapisana.' } });
      } catch (e) {
        set({ notice: { kind: 'error', text: `Zapis nie powiódł się: ${errMsg(e)}` } });
      }
    },

    loadFromSlot: async (slot) => {
      try {
        const result = await loadGame(getRepository(), slot);
        if (!result.ok) {
          set({ notice: { kind: 'error', text: result.error } });
          return;
        }
        set({ game: result.state, screen: 'dashboard', notice: { kind: 'success', text: 'Gra wczytana.' } });
      } catch (e) {
        set({ notice: { kind: 'error', text: `Wczytanie nie powiodło się: ${errMsg(e)}` } });
      }
    },

    deleteSlot: async (slot) => {
      try {
        await getRepository().remove(slot);
        await refreshSaves();
        set({ notice: { kind: 'info', text: 'Zapis usunięty.' } });
      } catch (e) {
        set({ notice: { kind: 'error', text: `Nie można usunąć zapisu: ${errMsg(e)}` } });
      }
    },
  };
});
