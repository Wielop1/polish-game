import type { IsoDate } from './date.ts';
import type { Operator, GameState } from './state.ts';

/**
 * Prosty interfejs modułów branżowych (v0.5). Moduł dostarcza treści i mechanikę specyficzną dla branży
 * (usługi, umiejętności, sprzęt, materiały, zapytania, wyceny, realizacja, reklamacje), ale NIE liczy podatków, nie księguje
 * ani nie tworzy własnych należności: korzysta z `issueDocument`, obowiązków, czasu i rachunków wspólnego silnika.
 * Kolejne branże (handel, gastronomia, transport…) dodaje się przez `registerIndustry`.
 */
export interface IndustryModule {
  id: string;
  label: string;
  /** Profile działalności (`BusinessProfile.id`) obsługiwane przez moduł. */
  profileIds: readonly string[];
  /** Inicjalizacja stanu modułu przy rejestracji działalności (np. pierwsza specjalizacja). */
  onRegister?(s: GameState, b: Operator, input: { specialization?: string }): void;
  /** Przetwarzanie jednego dnia dla aktywnej (niezawieszonej) działalności; musi być idempotentne. */
  processDay(s: GameState, b: Operator, date: IsoDate): void;
  /** Braki widoczne dla księgowości (np. brak materiałów na kontrakt) — krótkie komunikaty z kluczem idempotencji. */
  gaps?(s: GameState, b: Operator, date: IsoDate): { key: string; text: string }[];
}

const registry = new Map<string, IndustryModule>();

export function registerIndustry(m: IndustryModule): void {
  registry.set(m.id, m);
}

export function industryForProfile(profileId: string): IndustryModule | null {
  for (const m of registry.values()) if (m.profileIds.includes(profileId)) return m;
  return null;
}

export function industryOf(b: Operator): IndustryModule | null {
  return industryForProfile(b.profileId);
}
