import { addDays, addMonthsToKey, dateInMonth, daysInMonth, monthKey, monthKeyToYm, parseIso } from './date.ts';
import type { IsoDate } from './date.ts';
import type { Grosze } from './money.ts';
import type { GameState, ObligationRule } from './state.ts';

/** Czy `date` jest dniem naliczenia reguły (z uwzględnieniem krótkich miesięcy). */
export function isIssueDay(rule: ObligationRule, date: IsoDate): boolean {
  if (date < rule.startDate || (rule.endDate !== null && date > rule.endDate)) return false;
  const { year, month, day } = parseIso(date);
  const dim = daysInMonth(year, month);
  const expected = rule.issueDay === 'last' ? dim : Math.min(rule.issueDay, dim);
  return day === expected;
}

/** Termin płatności dla zobowiązania naliczonego w `issueDate`. */
export function computeDueDate(issueDate: IsoDate, due: ObligationRule['due']): IsoDate {
  const { year, month } = monthKeyToYm(addMonthsToKey(monthKey(issueDate), due.monthOffset));
  const dueDate = dateInMonth(year, month, due.day);
  if (dueDate < issueDate) {
    throw new RangeError(`Termin płatności ${dueDate} przypada przed datą naliczenia ${issueDate}`);
  }
  return dueDate;
}

/** Czy `date` to dzień urodzin (30 lutego nie istnieje: 29 lutego -> 28 lutego w latach nieprzestępnych). */
export function isBirthday(birthDate: IsoDate, date: IsoDate): boolean {
  const b = parseIso(birthDate);
  const d = parseIso(date);
  if (b.month === d.month && b.day === d.day) return true;
  return b.month === 2 && b.day === 29 && d.month === 2 && d.day === 28 && daysInMonth(d.year, 2) === 28;
}

export type ScheduledKind = 'issue' | 'due' | 'birthday';

export interface ScheduledItem {
  date: IsoDate;
  kind: ScheduledKind;
  ruleId: string;
  title: string;
  /** Kwota ze znakiem z perspektywy gracza (null dla zdarzeń bez kwoty). */
  amount: Grosze | null;
  /** True, gdy kwota jest losowa i pokazujemy wartość bazową. */
  approximate: boolean;
  category: string | null;
}

function projectedAmount(s: GameState, rule: ObligationRule): { amount: Grosze; approximate: boolean } {
  const spec = rule.amount;
  if (spec.type === 'fixed') return { amount: spec.amount, approximate: false };
  if (spec.type === 'variable') return { amount: spec.base, approximate: spec.spreadBps > 0 };
  const contract = s.contracts.find((c) => c.id === spec.contractId);
  if (!contract) throw new Error(`Brak umowy ${spec.contractId} dla reguły ${rule.id}`);
  return { amount: contract.monthlyAmount, approximate: false };
}

/**
 * Zdarzenia zaplanowane w przedziale [from, to] — wyłącznie przyszłe względem `today`
 * (przeszłość jest w dzienniku zdarzeń). Czysta projekcja: niczego nie księguje.
 */
export function scheduledItems(s: GameState, from: IsoDate, to: IsoDate): ScheduledItem[] {
  const today = s.clock.today;
  const start = from > today ? from : addDays(today, 1);
  if (start > to) return [];
  const items: ScheduledItem[] = [];

  // 1) Już naliczone, jeszcze nieopłacone, z terminem w przyszłości.
  for (const o of s.obligations) {
    if (o.status === 'open' && o.dueDate >= start && o.dueDate <= to) {
      items.push({
        date: o.dueDate,
        kind: 'due',
        ruleId: o.ruleId,
        title: o.description,
        amount: o.direction === 'receivable' ? o.amount : -o.amount,
        approximate: false,
        category: o.category,
      });
    }
  }

  // 2) Przyszłe naliczenia i ich terminy.
  const fromKey = addMonthsToKey(monthKey(start), -13);
  const toKey = monthKey(to);
  for (const rule of s.rules) {
    if (rule.kind === 'obligation') {
      const sign = rule.direction === 'receivable' ? 1 : -1;
      const { amount, approximate } = projectedAmount(s, rule);
      for (let key = fromKey; key <= toKey; key = addMonthsToKey(key, 1)) {
        const { year, month } = monthKeyToYm(key);
        const issueDate = dateInMonth(year, month, rule.issueDay);
        if (!isIssueDay(rule, issueDate) || issueDate <= today) continue;
        if (issueDate >= start && issueDate <= to) {
          items.push({ date: issueDate, kind: 'issue', ruleId: rule.id, title: rule.description, amount: sign * amount, approximate, category: rule.category });
        }
        const dueDate = computeDueDate(issueDate, rule.due);
        if (dueDate >= start && dueDate <= to && dueDate !== issueDate) {
          items.push({ date: dueDate, kind: 'due', ruleId: rule.id, title: rule.description, amount: sign * amount, approximate, category: rule.category });
        }
      }
    } else {
      const b = parseIso(s.person.birthDate);
      const y0 = parseIso(start).year;
      const y1 = parseIso(to).year;
      for (let y = y0; y <= y1; y++) {
        const date = dateInMonth(y, b.month, b.day);
        if (date >= start && date <= to && date >= rule.startDate) {
          items.push({ date, kind: 'birthday', ruleId: rule.id, title: 'Urodziny', amount: null, approximate: false, category: null });
        }
      }
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || a.kind.localeCompare(b.kind));
}
