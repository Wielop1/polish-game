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
  { id: 'przeprowadzka', label: 'Przeprowadzka', kind: 'expense', color: '#f9a8d4' },
  { id: 'awaria', label: 'Awarie i naprawy', kind: 'expense', color: '#fca5a5' },
  { id: 'nieprzewidziane', label: 'Nieprzewidziane wydatki', kind: 'expense', color: '#fdba74' },
  { id: 'szkolenie', label: 'Szkolenia', kind: 'expense', color: '#c4b5fd' },
  { id: 'podatek_odsetki', label: 'Podatek od odsetek', kind: 'expense', color: '#94a3b8' },
  { id: 'premia', label: 'Premie', kind: 'income', color: '#6ee7b7' },
  { id: 'dodatkowy_zarobek', label: 'Dodatkowy zarobek', kind: 'income', color: '#86efac' },
  { id: 'odsetki', label: 'Odsetki od oszczędności', kind: 'income', color: '#7dd3fc' },
  { id: 'kaucja', label: 'Kaucja (aktywo)', kind: 'capital', color: '#a8a29e' },
  { id: 'zwrot_kaucji', label: 'Zwrot kaucji', kind: 'capital', color: '#a8a29e' },
  { id: 'przelew_wlasny', label: 'Przelew własny', kind: 'capital', color: '#94a3b8' },
  { id: 'przychod_dzialalnosci', label: 'Przychód z działalności', kind: 'income', color: '#34d399' },
  { id: 'koszt_dzialalnosci', label: 'Koszt działalności', kind: 'expense', color: '#fb7185' },
  { id: 'zus_spoleczne', label: 'Składki społeczne ZUS', kind: 'expense', color: '#a78bfa' },
  { id: 'zus_zdrowotna', label: 'Składka zdrowotna', kind: 'expense', color: '#c4b5fd' },
  { id: 'zus_zdrowotna_zwrot', label: 'Zwrot składki zdrowotnej', kind: 'income', color: '#7dd3fc' },
  { id: 'pit_zaliczka', label: 'Zaliczka PIT', kind: 'expense', color: '#fbbf24' },
  { id: 'pit_roczny', label: 'Rozliczenie roczne PIT', kind: 'expense', color: '#f59e0b' },
  { id: 'pit_zwrot', label: 'Zwrot nadpłaty PIT', kind: 'income', color: '#6ee7b7' },
  { id: 'vat_nalezny', label: 'VAT należny', kind: 'expense', color: '#94a3b8' },
  { id: 'vat_naliczony', label: 'VAT naliczony', kind: 'income', color: '#94a3b8' },
  { id: 'vat_od_klienta', label: 'VAT od kontrahenta', kind: 'income', color: '#94a3b8' },
  { id: 'vat_do_dostawcy', label: 'VAT dla dostawcy', kind: 'expense', color: '#94a3b8' },
  { id: 'wynagrodzenie_pracownika', label: 'Wynagrodzenia pracowników (netto)', kind: 'expense', color: '#f472b6' },
  { id: 'skladki_pracownicze', label: 'Składki ZUS za pracowników', kind: 'expense', color: '#a78bfa' },
  { id: 'zaliczka_pit_pracownicza', label: 'Zaliczki PIT pracowników', kind: 'expense', color: '#fbbf24' },
  { id: 'zaliczka_klienta', label: 'Zaliczka od klienta (zobowiązanie do wykonania usługi)', kind: 'capital', color: '#7dd3fc' },
  { id: 'zaliczka_podwykonawcy', label: 'Zaliczka dla podwykonawcy (przedpłata)', kind: 'capital', color: '#a8a29e' },
  { id: 'zwrot_zaliczki', label: 'Zwrot zaliczki', kind: 'capital', color: '#a8a29e' },
  { id: 'zakup_pojazdu', label: 'Zakup pojazdu (aktywo)', kind: 'capital', color: '#a8a29e' },
];

/** Kategorie, które nie są przychodem ani kosztem (ruchy kapitałowe/własne) — pomijane w przepływach miesięcznych. */
export const NON_FLOW_CATEGORIES: ReadonlySet<string> = new Set(['kapital_poczatkowy', 'przelew_wlasny', 'kaucja', 'zwrot_kaucji', 'zaliczka_klienta', 'zaliczka_podwykonawcy', 'zwrot_zaliczki', 'zakup_pojazdu']);

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function categoryInfo(id: string): CategoryInfo {
  return BY_ID.get(id) ?? { id, label: id, kind: 'expense', color: '#64748b' };
}
