import { TIME } from './config.ts';
import { currentEmployment } from './contracts.ts';
import { addDays, weekdayIndex } from './date.ts';
import type { IsoDate } from './date.ts';
import type { GameState, Life } from './state.ts';

/**
 * Budżet czasu: każdy dzień ma 24 godziny dzielone między pracę, sen, obowiązki,
 * działalność (przyszłość), zobowiązania czasowe (kursy, zlecenia) i czas wolny.
 * Czas wolny jest WYNIKIEM (reszta) — tych samych godzin nie da się przeznaczyć na dwie rzeczy.
 */
export interface DayBudget {
  date: IsoDate;
  workday: boolean;
  work: number;
  sleep: number;
  duties: number;
  business: number;
  commitments: number;
  free: number;
}

export type TimePlan = Life['timePlan'];

export interface BudgetOverrides {
  plan?: TimePlan;
  /** Hipotetyczne godziny pracy w miesiącu zamiast tych z umowy (np. weryfikacja oferty). */
  hoursPerMonth?: number | null;
  /** Dodatkowe godziny dziennie (np. nowe zobowiązanie czasowe). */
  extraHoursPerDay?: number;
}

export function isWorkday(date: IsoDate): boolean {
  return weekdayIndex(date) < 5;
}

export function workHoursPerWorkday(hoursPerMonth: number): number {
  return Math.round(hoursPerMonth / TIME.workdaysPerMonth);
}

export function commitmentHoursOn(s: GameState, date: IsoDate): number {
  let h = 0;
  for (const c of s.commitments) if (c.startDate <= date && date <= c.endDate) h += c.hoursPerDay;
  return h;
}

export function budgetFor(s: GameState, date: IsoDate, o: BudgetOverrides = {}): DayBudget {
  const plan = o.plan ?? s.life.timePlan;
  const workday = isWorkday(date);
  const employment = currentEmployment(s, date);
  const monthly = o.hoursPerMonth !== undefined ? o.hoursPerMonth : (employment?.hoursPerMonth ?? null);
  const employed = monthly !== null && monthly > 0;
  const work = workday && employed ? workHoursPerWorkday(monthly) : 0;
  const duties = TIME.dutiesHours + (workday && employed ? TIME.commuteHours : 0);
  const commitments = commitmentHoursOn(s, date) + (o.extraHoursPerDay ?? 0);
  const free = TIME.hoursPerDay - work - plan.sleepHours - duties - plan.businessHours - commitments;
  return { date, workday, work, sleep: plan.sleepHours, duties, business: plan.businessHours, commitments, free };
}

/** Dzienna zmiana zmęczenia (liczby całkowite). Dodatnia = bardziej zmęczony. */
export function fatigueDelta(b: DayBudget): number {
  const active = b.work + b.duties + b.business + b.commitments;
  let d = 0;
  d += 2 * Math.max(0, active - 10); // dzień wypełniony obowiązkami ponad 10 godzin
  d += 5 * Math.max(0, 8 - b.sleep); // niedobór snu
  d -= 2 * Math.max(0, b.sleep - 8); // nadwyżka snu
  d += 2 * Math.max(0, 2 - b.free); // prawie brak czasu wolnego
  d -= Math.max(0, b.free - 3); // regeneracja w czasie wolnym
  return d;
}

export function clampFatigue(v: number): number {
  return Math.min(100, Math.max(0, Math.round(v)));
}

/** Wydajność w pracy w pkt bazowych (10 000 = 100%); spada od zmęczenia powyżej 30. */
export function performanceBps(fatigue: number): number {
  return 10_000 - Math.max(0, fatigue - 30) * 70;
}

export function fatigueLabel(fatigue: number): string {
  if (fatigue < 30) return 'wypoczęty';
  if (fatigue < 60) return 'zmęczony';
  if (fatigue < 80) return 'przeciążony';
  return 'wyczerpany';
}

/**
 * Sprawdza, czy zmiana (plan / nowa praca / nowe zobowiązanie) mieści się w 24 godzinach
 * w KAŻDYM dniu najbliższego okresu `[from, to]` (uwzględnia już podpisane przyszłe umowy i zobowiązania).
 * Zwraca opis pierwszego naruszenia albo null.
 */
export function firstOverload(s: GameState, from: IsoDate, to: IsoDate, o: BudgetOverrides = {}): { date: IsoDate; missing: number } | null {
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const b = budgetFor(s, d, o);
    if (b.free < 0) return { date: d, missing: -b.free };
  }
  return null;
}

/** Walidacja nowego planu dnia względem bieżących i przyszłych umów oraz zobowiązań (rok do przodu). */
export function validatePlan(s: GameState, plan: TimePlan): string | null {
  if (plan.sleepHours < TIME.sleepMin || plan.sleepHours > TIME.sleepMax) return `Sen: od ${TIME.sleepMin} do ${TIME.sleepMax} godzin.`;
  if (plan.businessHours < 0 || plan.businessHours > TIME.businessMax) return `Działalność: od 0 do ${TIME.businessMax} godzin.`;
  const today = s.clock.today;
  const o = firstOverload(s, today, addDays(today, 366), { plan });
  return o ? `Nie mieści się w 24 godzinach (brakuje ${o.missing} godz. dnia ${o.date}). Zmniejsz sen lub czas na działalność.` : null;
}

export function weeklyHours(s: GameState, date: IsoDate = s.clock.today): { work: number; sleep: number; duties: number; business: number; commitments: number; free: number } {
  // Tydzień kalendarzowy zaczynający się od poniedziałku tygodnia, w którym jest `date`.
  const monday = addDays(date, -weekdayIndex(date));
  const acc = { work: 0, sleep: 0, duties: 0, business: 0, commitments: 0, free: 0 };
  for (let i = 0; i < 7; i++) {
    const b = budgetFor(s, addDays(monday, i));
    acc.work += b.work;
    acc.sleep += b.sleep;
    acc.duties += b.duties;
    acc.business += b.business;
    acc.commitments += b.commitments;
    acc.free += b.free;
  }
  return acc;
}
