export interface CategoryInfo {
  id: string;
  label: string;
  kind: 'income' | 'expense' | 'capital';
  /** Kolor wykresów (hex). */
  color: string;
}

export const CATEGORIES: readonly CategoryInfo[] = [
  { id: 'wynagrodzenie', label: 'Wynagrodzenie', kind: 'income', color: '#34d399' },
  { id: 'kapital_poczatkowy', label: 'Kapitał początkowy', kind: 'capital', color: '#94a3b8' },
  { id: 'czynsz', label: 'Czynsz', kind: 'expense', color: '#f472b6' },
  { id: 'media', label: 'Media', kind: 'expense', color: '#fbbf24' },
  { id: 'lacznosc', label: 'Telefon i internet', kind: 'expense', color: '#38bdf8' },
  { id: 'zywnosc', label: 'Żywność', kind: 'expense', color: '#fb923c' },
  { id: 'transport', label: 'Transport', kind: 'expense', color: '#a78bfa' },
  { id: 'rozrywka', label: 'Rozrywka i drobne wydatki', kind: 'expense', color: '#2dd4bf' },
];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function categoryInfo(id: string): CategoryInfo {
  return BY_ID.get(id) ?? { id, label: id, kind: 'expense', color: '#64748b' };
}
