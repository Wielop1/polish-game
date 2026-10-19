import type { Company, GameState, Operator } from './state.ts';

/**
 * Abstrakcja operatora gospodarczego (v0.8): działalność prowadzi JDG osoby fizycznej albo spółka z o.o. (odrębny podmiot prawny).
 * Moduły wspólnego silnika (renowacje, pracownicy, ekipy, pojazdy, marketing) pracują na „bieżącym operatorze”:
 * `withOperator` na czas wywołania podstawia stan operatora (`reno`, `ops`, marketing i strategia) w miejsce stanu JDG,
 * a po wywołaniu przywraca go (także po wyjątku). Dzięki temu nie ma drugiego silnika remontowego ani drugiego kalkulatora —
 * te same funkcje liczą dla JDG i dla spółki, a majątek każdego podmiotu leży w jego własnych strukturach i na jego rachunku.
 */

export const JDG = 'jdg';

export function companyById(s: GameState, id: string | null | undefined): Company | undefined {
  return id ? s.corp.companies.find((c) => c.id === id) : undefined;
}

/** Aktywna JDG gracza (jak `activeBusiness`, bez zależności od business.ts). */
export function jdgOperator(s: GameState): Operator | null {
  return s.businesses.find((b) => b.status === 'active') ?? null;
}

/** Identyfikator operatora, na którym pracują moduły w tej chwili: 'jdg' albo id spółki. */
export function contextId(s: GameState): string {
  return s.corp.context ?? JDG;
}

/** Operator, na którym pracują moduły wspólnego silnika (zgodnie z kontekstem). */
export function currentOperator(s: GameState): Operator | null {
  const c = companyById(s, s.corp.context);
  if (s.corp.context !== null) return c?.operation ?? null;
  return jdgOperator(s);
}

/** Czy bieżący kontekst to spółka (właściciel nie pracuje fizycznie w spółce; patrz `ownerAvailable`). */
export const inCompanyContext = (s: GameState): boolean => s.corp.context !== null;

/**
 * Czy właściciel (osoba gracza) może być wykonawcą w bieżącym kontekście. W JDG tak. W spółce nie:
 * praca właściciela na rzecz spółki wymagałaby odrębnej umowy (praca/zlecenie/B2B) między nim a spółką — niezaimplementowane (DEFERRED),
 * więc spółka zatrudnia pracowników i podwykonawców.
 */
export const ownerAvailable = (s: GameState): boolean => s.corp.context === null;

function swap(s: GameState, c: Company): void {
  const reno = s.reno; s.reno = c.slices.reno; c.slices.reno = reno;
  const ops = s.ops; s.ops = c.slices.ops; c.slices.ops = ops;
  const marketing = s.market.marketing; s.market.marketing = c.slices.marketing; c.slices.marketing = marketing;
  const strategy = s.market.strategy; s.market.strategy = c.slices.strategy; c.slices.strategy = strategy;
}

/** Wykonuje `fn` w kontekście operatora (`'jdg'` albo id spółki). Zagnieżdżenie w innym operatorze jest błędem programisty. */
export function withOperator<T>(s: GameState, id: string | null | undefined, fn: () => T): T {
  const target = id && id !== JDG ? id : null;
  if (s.corp.context === target) return fn();
  if (s.corp.context !== null || target === null) throw new Error(`Zagnieżdżony kontekst operatora: ${s.corp.context ?? JDG} → ${target ?? JDG}`);
  const c = companyById(s, target);
  if (!c) throw new Error(`Nieznana spółka ${target}`);
  swap(s, c);
  s.corp.context = c.id;
  try {
    return fn();
  } finally {
    swap(s, c);
    s.corp.context = null;
  }
}

/**
 * Widok tylko do odczytu na stan z punktu widzenia operatora (płytka kopia z podstawionymi częściami) — dla interfejsu i selektorów.
 * Nie mutuje stanu źródłowego. Nie wolno przez niego zmieniać stanu (zmiany idą wyłącznie przez `commands.*`).
 */
export function operatorView(s: GameState, id: string | null | undefined): GameState {
  const c = id && id !== JDG ? companyById(s, id) : undefined;
  if (!c) return s;
  return {
    ...s, reno: c.slices.reno, ops: c.slices.ops,
    market: { ...s.market, marketing: c.slices.marketing, strategy: c.slices.strategy },
    corp: { ...s.corp, context: c.id },
  };
}

/** Wybrany przez gracza operator (jeśli spółka nie prowadzi już działalności, wracamy do JDG). */
export function selectedOperatorId(s: GameState): string {
  const c = companyById(s, s.corp.selected);
  return c && c.status === 'registered' && c.operation ? c.id : JDG;
}

export interface OperatorRef {
  id: string;
  kind: 'jdg' | 'company';
  label: string;
  operator: Operator;
  company: Company | null;
}

/** Operatory, na których można prowadzić działalność (aktywna JDG i zarejestrowane spółki z uruchomioną działalnością). */
export function listOperators(s: GameState): OperatorRef[] {
  const out: OperatorRef[] = [];
  const j = jdgOperator(s);
  if (j) out.push({ id: JDG, kind: 'jdg', label: `JDG: ${j.name}`, operator: j, company: null });
  for (const c of s.corp.companies) {
    if (c.status === 'registered' && c.operation && c.operation.status === 'active') out.push({ id: c.id, kind: 'company', label: `${c.name} sp. z o.o.`, operator: c.operation, company: c });
  }
  return out;
}

/** Wszystkie operacje gospodarcze do codziennego przetwarzania (JDG jest przetwarzana osobno w `processBusiness`). */
export function companyOperations(s: GameState): Company[] {
  return s.corp.companies.filter((c) => c.status === 'registered' && c.operation !== null && c.operation.status === 'active');
}

export const companyFullName = (c: Pick<Company, 'name'>): string => `${c.name} sp. z o.o.`;
