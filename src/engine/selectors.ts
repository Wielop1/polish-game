import { LIFESTYLE_QOL, STANDARD_QOL } from './config.ts';
import { activeLeases, currentLease, employmentStatus } from './contracts.ts';
import { addDays as addDaysIso, addMonthsToKey, ageOn, monthKey } from './date.ts';
import type { IsoDate } from './date.ts';
import { roundDiv } from './money.ts';
import type { Grosze } from './money.ts';
import { NON_FLOW_CATEGORIES } from './categories.ts';
import { projectedAmount } from './schedule.ts';
import { weeklyHours } from './time.ts';
import { playerSharesBook, playerSharesValue } from './shares.ts';
import type { Account, GameState, Obligation } from './state.ts';

export function playerAccount(s: GameState): Account {
  const acc = s.accounts[s.playerAccountId];
  if (!acc) throw new Error(`Brak rachunku gracza: ${s.playerAccountId}`);
  return acc;
}

export function cash(s: GameState): Grosze {
  return playerAccount(s).balance;
}

export function savingsAccount(s: GameState): Account | null {
  return Object.values(s.accounts).find((a) => a.type === 'savings') ?? null;
}

export function savingsBalance(s: GameState): Grosze {
  return savingsAccount(s)?.balance ?? 0;
}

/** Suma sald rachunków PRYWATNYCH (bieżący + oszczędnościowy; bez rachunku firmowego). */
export function totalBalance(s: GameState): Grosze {
  return Object.values(s.accounts).filter((a) => a.type === 'checking' || a.type === 'savings').reduce((a, acc) => a + acc.balance, 0);
}

/** Saldo rachunku firmowego JDG (0, gdy brak). */
export function businessBalance(s: GameState): Grosze {
  return Object.values(s.accounts).filter((a) => a.type === 'business').reduce((a, acc) => a + acc.balance, 0);
}

/** Zapasy materiałów w cenie nabycia (aktywo; koszt ekonomiczny powstaje przy zużyciu). */
export function inventoryValue(s: GameState): Grosze {
  return Object.values(s.reno.stock).reduce((a, x) => a + x.value, 0);
}

/** Wartość księgowa sprzętu: koszt zakupu × stan techniczny (zużycie obniża wartość, nie jest wydatkiem gotówkowym). */
export function equipmentValue(s: GameState): Grosze {
  return s.reno.equipment.reduce((a, e) => a + roundDiv(e.cost * e.conditionBps, 10_000), 0);
}

/** Wartość księgowa pojazdów firmowych: cena zakupu × stan techniczny. */
export function vehiclesValue(s: GameState): Grosze {
  return s.ops.vehicles.reduce((a, v) => a + roundDiv(v.cost * v.conditionBps, 10_000), 0);
}

/** Przedpłaty dla podwykonawców (zaliczki jeszcze nierozliczone) — aktywo, nie koszt. */
export function prepaidValue(s: GameState): Grosze {
  return s.ops.subcontracts.reduce((a, c) => a + c.prepaid, 0);
}

/** Zaliczki od klientów ujęte od v0.6: zobowiązanie do wykonania usługi do czasu odbioru (nie przychód). */
export function deferredAdvances(s: GameState): Grosze {
  return s.reno.jobs.filter((j) => j.advanceMode === 'deferred' && j.advanceDocId !== null && j.stage !== 'done' && j.stage !== 'cancelled').reduce((a, j) => a + j.advanceNet, 0);
}

export function heldDeposits(s: GameState): Grosze {
  return s.assets.filter((a) => a.status === 'held').reduce((a, x) => a + x.amount, 0);
}

export interface NetWorthBreakdown {
  /** Saldo rachunku bieżącego. */
  cash: Grosze;
  /** Saldo rachunku oszczędnościowego. */
  savings: Grosze;
  /** Saldo rachunku firmowego JDG (JDG nie jest osobą prawną — to nadal majątek właściciela). */
  business: Grosze;
  /** Kaucje zwrotne (aktywa) przechowywane przez wynajmujących. */
  deposits: Grosze;
  /** Zapasy materiałów firmy (aktywo). */
  inventory: Grosze;
  /** Wartość księgowa sprzętu firmy (aktywo). */
  equipment: Grosze;
  /** Pojazdy firmowe wg wartości księgowej (aktywo). */
  vehicles: Grosze;
  /** Przedpłaty dla podwykonawców (aktywo). */
  prepaid: Grosze;
  /** Zaliczki od klientów do czasu wykonania usługi (zobowiązanie, odejmowane od majątku). */
  deferred: Grosze;
  /** Otwarte należności gracza (np. naliczona, niewypłacona pensja). */
  receivables: Grosze;
  /** Otwarte zobowiązania gracza (np. naliczony, nieopłacony czynsz). */
  payables: Grosze;
  /** Szacunkowa wartość udziałów w spółkach z o.o. (udział w ostatniej wycenie; przed rejestracją — koszt nabycia). Nie dodajemy aktywów spółki ani jej gotówki. */
  shares: Grosze;
  /** Koszt nabycia udziałów (aktywo wg kosztu — podstawa tożsamości księgowej; w majątku netto wartość ujęta jest w polu `shares`). */
  sharesBook: Grosze;
  netWorth: Grosze;
}

/** Czy zobowiązanie należy do osoby gracza (jej rachunek osobisty lub rachunek JDG), a nie do spółki z o.o. */
export function isPlayerObligation(s: GameState, o: Obligation): boolean {
  return s.accounts[o.accountId]?.ownerId === s.person.id;
}

export function openObligations(s: GameState, direction?: Obligation['direction']): Obligation[] {
  return s.obligations.filter((o) => o.status === 'open' && (!direction || o.direction === direction));
}

/** Majątek netto = rachunki + kaucje + zapasy + sprzęt + pojazdy + przedpłaty (aktywa) + otwarte należności − otwarte zobowiązania − zaliczki do czasu wykonania usługi. */
export function netWorthBreakdown(s: GameState): NetWorthBreakdown {
  let receivables = 0;
  let payables = 0;
  for (const o of s.obligations) {
    if (o.status !== 'open' || o.scope === 'company') continue;
    if (o.direction === 'receivable') receivables += o.amount;
    else payables += o.amount;
  }
  const c = cash(s);
  const sv = savingsBalance(s);
  const dep = heldDeposits(s);
  const biz = businessBalance(s);
  const inv = inventoryValue(s);
  const eq = equipmentValue(s);
  const veh = vehiclesValue(s);
  const pre = prepaidValue(s);
  const def = deferredAdvances(s);
  const shares = s.corp.holdings.length > 0 ? playerSharesValue(s) : 0;
  const sharesBook = s.corp.holdings.length > 0 ? playerSharesBook(s) : 0;
  return { cash: c, savings: sv, business: biz, deposits: dep, inventory: inv, equipment: eq, vehicles: veh, prepaid: pre, deferred: def, receivables, payables, shares, sharesBook, netWorth: c + sv + biz + dep + inv + eq + veh + pre + receivables - payables - def + shares };
}

export function netWorth(s: GameState): Grosze {
  return netWorthBreakdown(s).netWorth;
}

export function overdueObligations(s: GameState): Obligation[] {
  return s.obligations.filter((o) => o.status === 'open' && o.overdueSince !== null);
}

export function playerAge(s: GameState, on: IsoDate = s.clock.today): number {
  return ageOn(s.person.birthDate, on);
}

export interface MonthSummary {
  month: string; // YYYY-MM
  /** Przychody memoriałowo (naliczone w miesiącu). */
  income: Grosze;
  /** Koszty memoriałowo (naliczone w miesiącu). */
  expenses: Grosze;
  result: Grosze;
  /** Przepływy pieniężne na rachunkach, bez kapitału początkowego, przelewów własnych i kaucji. */
  cashIn: Grosze;
  cashOut: Grosze;
  closingCash: Grosze | null;
  closingNetWorth: Grosze | null;
  expensesByCategory: Record<string, Grosze>;
  /** Czy miesiąc jest już zakończony (jego ostatni dzień został przetworzony). */
  complete: boolean;
}

/** Miesięczne podsumowania od miesiąca startu do bieżącego. */
export function monthlySummaries(s: GameState): MonthSummary[] {
  const firstKey = monthKey(s.clock.startDate);
  const lastKey = monthKey(s.clock.today);
  const map = new Map<string, MonthSummary>();
  for (let key = firstKey; key <= lastKey; key = addMonthsToKey(key, 1)) {
    map.set(key, {
      month: key,
      income: 0,
      expenses: 0,
      result: 0,
      cashIn: 0,
      cashOut: 0,
      closingCash: null,
      closingNetWorth: null,
      expensesByCategory: {},
      complete: false,
    });
  }
  for (const o of s.obligations) {
    if (o.scope !== 'personal') continue; // JDG ma odrębną ewidencję (businessSummaries), spółka — własną
    const m = map.get(monthKey(o.issueDate));
    if (!m) continue;
    if (o.direction === 'receivable') m.income += o.amount;
    else {
      m.expenses += o.amount;
      m.expensesByCategory[o.category] = (m.expensesByCategory[o.category] ?? 0) + o.amount;
    }
  }
  for (const tx of s.ledger) {
    if (NON_FLOW_CATEGORIES.has(tx.category) || s.accounts[tx.accountId]?.type === 'business' || s.accounts[tx.accountId]?.type === 'company') continue;
    const m = map.get(monthKey(tx.date));
    if (!m) continue;
    if (tx.amount > 0) m.cashIn += tx.amount;
    else m.cashOut += -tx.amount;
  }
  for (const p of s.history) {
    const m = map.get(monthKey(p.date));
    if (!m) continue;
    m.closingCash = p.cash + p.savings;
    m.closingNetWorth = p.netWorth;
  }
  const lastDay = s.clock.today;
  for (const m of map.values()) {
    m.result = m.income - m.expenses;
    m.complete = m.month < monthKey(lastDay);
  }
  return [...map.values()];
}

/** Szacunek miesięcznych kosztów stałych i stylu życia (do oceny bufora finansowego). */
export function monthlyCostEstimate(s: GameState): Grosze {
  let total = 0;
  for (const r of s.rules) {
    if (r.kind !== 'obligation' || r.direction !== 'payable') continue;
    if (r.endDate !== null && r.endDate < s.clock.today) continue;
    if (r.startDate > s.clock.today) continue;
    total += projectedAmount(s, r).amount;
  }
  return total;
}

export interface QolComponent {
  id: 'lifestyle' | 'housing' | 'rest' | 'fatigue' | 'security';
  label: string;
  weight: number;
  /** 0–100. */
  score: number;
  detail: string;
}

export interface QualityOfLife {
  score: number;
  components: QolComponent[];
}

const clamp100 = (v: number) => Math.min(100, Math.max(0, Math.round(v)));

/**
 * Wskaźnik jakości życia (0–100). NIE jest funkcją majątku: składa się ze stylu życia, standardu
 * mieszkania, czasu na odpoczynek, zmęczenia i bezpieczeństwa finansowego. To ostatnie to tylko
 * 15% wagi i ma sufit (bufor ≥ 3 miesięcy kosztów = 100), więc dodatkowe pieniądze nie podnoszą go bez końca.
 */
export function qualityOfLife(s: GameState): QualityOfLife {
  const today = s.clock.today;
  const lease = currentLease(s, today);
  const w = weeklyHours(s, today);
  const avgFree = w.free / 7;
  const monthly = monthlyCostEstimate(s);
  const bufferMonths = monthly > 0 ? totalBalance(s) / monthly : 0;
  const overdue = overdueObligations(s).length > 0;
  const unemployed = employmentStatus(s, today) === 'unemployed';
  let security = clamp100((bufferMonths / 3) * 100);
  if (overdue) security = clamp100(security - 50);
  if (unemployed) security = clamp100(security - 20);

  const components: QolComponent[] = [
    { id: 'lifestyle', label: 'Styl życia', weight: 25, score: LIFESTYLE_QOL[s.life.lifestyle], detail: 'poziom wydatków na codzienność' },
    { id: 'housing', label: 'Mieszkanie', weight: 20, score: lease?.standard ? STANDARD_QOL[lease.standard] : 60, detail: lease?.standard ? `standard: ${lease.standard}` : 'brak danych o standardzie' },
    { id: 'rest', label: 'Czas wolny', weight: 20, score: clamp100((avgFree - 1) * 14), detail: `średnio ${avgFree.toFixed(1)} godz. wolnych dziennie` },
    { id: 'fatigue', label: 'Kondycja', weight: 20, score: 100 - s.life.fatigue, detail: `zmęczenie ${s.life.fatigue}/100` },
    { id: 'security', label: 'Bezpieczeństwo finansowe', weight: 15, score: security, detail: `bufor ≈ ${bufferMonths.toFixed(1)} mies. kosztów${overdue ? ', zaległości' : ''}${unemployed ? ', brak pracy' : ''}` },
  ];
  const score = clamp100(components.reduce((a, c) => a + c.score * c.weight, 0) / 100);
  return { score, components };
}

/** Pomocnicze: ile umów najmu obowiązuje dziś (>1 = nakładanie się okresów, płacisz za oba). */
export function overlappingLeases(s: GameState): number {
  return activeLeases(s, s.clock.today).length;
}


export interface BusinessMonth {
  month: string;
  /** Przychód netto (sprzedaż). */
  revenue: Grosze;
  /** Koszty działalności (netto; przy zwolnieniu z VAT — brutto). */
  costs: Grosze;
  /** Dochód przed składkami i podatkiem. */
  income: Grosze;
  /** Składki ZUS (społeczne + zdrowotna). */
  zus: Grosze;
  /** Zaliczki i rozliczenia PIT. */
  pit: Grosze;
  /** Wynik po składkach i podatku (memoriałowo). */
  result: Grosze;
}

const isZus = (c: string) => c === 'zus_spoleczne' || c === 'zus_zdrowotna';

/** Odrębna ewidencja działalności: miesięczne przychody, koszty, składki, podatek i wynik (VAT jako przepływ przelotowy pominięty). */
export function businessSummaries(s: GameState): BusinessMonth[] {
  const map = new Map<string, BusinessMonth>();
  const get = (mk: string) => {
    let m = map.get(mk);
    if (!m) map.set(mk, (m = { month: mk, revenue: 0, costs: 0, income: 0, zus: 0, pit: 0, result: 0 }));
    return m;
  };
  // przychody i koszty (podatkowe) z dokumentów: zaliczki nie są przychodem do wykonania usługi, wynagrodzenia i składki pracodawcy są kosztem,
  // zakup pojazdu nie jest kosztem; zobowiązania (ZUS właściciela, PIT) — jak dotąd z kategorii zobowiązań
  for (const d of s.documents) {
    const m = get(monthKey(d.issueDate));
    if (d.kind === 'sales') m.revenue += d.taxAmount;
    else m.costs += d.taxAmount;
  }
  for (const o of s.obligations) {
    if (o.scope !== 'business') continue;
    const m = get(monthKey(o.issueDate));
    if (isZus(o.category)) m.zus += o.amount;
    else if (o.category === 'pit_zaliczka' || o.category === 'pit_roczny') m.pit += o.amount;
    else if (o.category === 'pit_zwrot') m.pit -= o.amount;
    else if (o.category === 'zus_zdrowotna_zwrot') m.zus -= o.amount;
  }
  for (const m of map.values()) {
    m.income = m.revenue - m.costs;
    m.result = m.income - m.zus - m.pit;
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Płynność firmy: saldo rachunku firmowego, należności i zobowiązania wymagalne w ciągu `days` dni. */
export function businessLiquidity(s: GameState, days = 30): { balance: Grosze; receivablesDue: Grosze; payablesDue: Grosze; coverage: Grosze } {
  // w kontekście spółki (widok operatora) — jej rachunek i jej zobowiązania; inaczej rachunek JDG
  const ctxCompany = s.corp.context !== null ? s.corp.companies.find((c) => c.id === s.corp.context) : undefined;
  const acc = ctxCompany ? s.accounts[ctxCompany.accountId] : Object.values(s.accounts).find((a) => a.type === 'business');
  const limit = addDaysIso(s.clock.today, days);
  let receivablesDue = 0;
  let payablesDue = 0;
  for (const o of s.obligations) {
    if (o.status !== 'open' || o.dueDate > limit || (ctxCompany ? o.accountId !== ctxCompany.accountId : o.scope !== 'business')) continue;
    if (o.direction === 'receivable') receivablesDue += o.amount;
    else payablesDue += o.amount;
  }
  const balance = acc?.balance ?? 0;
  return { balance, receivablesDue, payablesDue, coverage: balance - payablesDue };
}
