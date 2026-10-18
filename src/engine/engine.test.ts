import { describe, expect, it } from 'vitest';
import { ECONOMY_V01, GAME_START, LIFESTYLE } from './config.ts';
import { addDays, ageOn, diffDays, monthKey } from './date.ts';
import { checkInvariants } from './invariants.ts';
import { zl } from './money.ts';
import { createNewGame } from './newGame.ts';
import { monthlySummaries, netWorth, netWorthBreakdown, overdueObligations, playerAccount } from './selectors.ts';
import { scheduledItems } from './schedule.ts';
import {
  advanceDays, advanceOneDay, advanceToNextMonth, applyScheduledOccurrences, postTransaction, processDay,
} from './simulate.ts';
import type { GameState } from './state.ts';

/** Gry testów mechaniki bazowej mają wyłączone losowe wydarzenia życiowe (testowane osobno w life.test.ts). */
const newGame = (seed = 'test-seed') => createNewGame({ firstName: 'Jan', lastName: 'Kowalski', seed, lifeEvents: false });
const E = ECONOMY_V01;

function expectConsistent(s: GameState) {
  expect(checkInvariants(s)).toEqual([]);
}
const txOn = (s: GameState, date: string, category: string) =>
  s.ledger.filter((t) => t.date === date && t.category === category);

describe('nowa gra', () => {
  it('startuje zgodnie ze specyfikacją v0.1', () => {
    const s = newGame();
    expect(s.clock.today).toBe('2026-01-01');
    expect(s.person.cityId).toBe('olsztyn');
    expect(ageOn(s.person.birthDate, '2026-01-01')).toBe(22);
    expect(playerAccount(s).balance).toBe(zl(5_000));
    expect(s.ledger).toHaveLength(1);
    expect(s.ledger[0]).toMatchObject({ category: 'kapital_poczatkowy', amount: GAME_START.cash });
    expectConsistent(s);
  });
  it('przetwarza zdarzenia dnia startu (czynsz naliczony 1 stycznia nie jest pominięty)', () => {
    const s = newGame();
    const rent = s.obligations.find((o) => o.ruleId === 'rule:rent');
    expect(rent).toMatchObject({ issueDate: '2026-01-01', dueDate: '2026-01-10', status: 'open', amount: E.monthlyRent });
  });
  it('waliduje dane postaci', () => {
    expect(() => createNewGame({ firstName: '', lastName: 'X', seed: 's' })).toThrow();
    expect(() => createNewGame({ firstName: '123', lastName: 'X', seed: 's' })).toThrow();
    expect(() => createNewGame({ firstName: 'A', lastName: 'B', seed: '  ' })).toThrow();
    expect(createNewGame({ firstName: '  Anna  Maria ', lastName: "O'Brien-Żółć", seed: 's' }).person.firstName).toBe('Anna Maria');
  });
  it('wiek 22 lata dla dowolnego seeda', () => {
    for (let i = 0; i < 200; i++) {
      expect(ageOn(newGame(`seed-${i}`).person.birthDate, '2026-01-01')).toBe(22);
    }
  });
});

describe('1. upływ czasu', () => {
  it('dzień po dniu, także przez granice miesięcy, lat i rok przestępny', () => {
    let s = newGame();
    expect(advanceOneDay(s).clock.today).toBe('2026-01-02');
    s = advanceDays(s, 30);
    expect(s.clock.today).toBe('2026-01-31');
    s = advanceOneDay(s);
    expect(s.clock.today).toBe('2026-02-01');
    s = advanceDays(s, 365 - 31);
    expect(s.clock.today).toBe('2027-01-01');
    expect(advanceDays(s, 2 * 365 + 59 + 1).clock.today).toBe('2029-03-01'); // przez 2028 (przestępny)
  });
  it('przyspieszenie do następnego miesiąca zatrzymuje się zawsze na 1. dniu', () => {
    let s = newGame();
    const days: string[] = [];
    for (let i = 0; i < 14; i++) {
      s = advanceToNextMonth(s);
      days.push(s.clock.today);
    }
    expect(days.slice(0, 3)).toEqual(['2026-02-01', '2026-03-01', '2026-04-01']);
    expect(days[11]).toBe('2027-01-01');
    expect(days.every((d) => d.endsWith('-01'))).toBe(true);
    const mid = advanceDays(newGame(), 14); // 15 stycznia
    expect(advanceToNextMonth(mid).clock.today).toBe('2026-02-01');
  });
  it('nie pomija zaplanowanych operacji: skok o 365 dni == 365 pojedynczych dni == 12 miesięcy', () => {
    const jump = advanceDays(newGame(), 365);
    let daily = newGame();
    for (let i = 0; i < 365; i++) daily = advanceOneDay(daily);
    let monthly = newGame();
    for (let i = 0; i < 12; i++) monthly = advanceToNextMonth(monthly);
    expect(daily).toEqual(jump);
    expect(monthly).toEqual(jump);
    // 6 reguł kosztowych * 12 miesięcy + czynsz naliczany 1.01.2027 (dzień 365) + 12 naliczeń pensji
    const issued = jump.events.filter((e) => e.type === 'obligation.issued');
    expect(issued).toHaveLength(6 * 12 + 1 + 12);
  });
  it('nie modyfikuje stanu wejściowego (czysta funkcja)', () => {
    const s = newGame();
    const snapshot = structuredClone(s);
    advanceToNextMonth(s);
    expect(s).toEqual(snapshot);
  });
  it('odrzuca nieprawidłową liczbę dni', () => {
    expect(() => advanceDays(newGame(), 0)).toThrow();
    expect(() => advanceDays(newGame(), 1.5)).toThrow();
    expect(() => advanceDays(newGame(), 100_000)).toThrow();
  });
  it('urodziny pojawiają się raz w roku we właściwym dniu', () => {
    const s = advanceDays(newGame(), 366);
    const b = s.events.filter((e) => e.type === 'life.birthday');
    expect(b).toHaveLength(1);
    expect(b[0]!.date.slice(5)).toBe(s.person.birthDate.slice(5));
  });
});

describe('2. wynagrodzenie (przychód ≠ wpływ gotówki)', () => {
  it('pensja za styczeń jest naliczona 31.01, a wpływa dopiero 10.02', () => {
    const s = advanceDays(newGame(), 45); // 15 lutego
    const accrual = s.obligations.find((o) => o.ruleId === 'rule:salary' && o.issueDate === '2026-01-31');
    expect(accrual).toMatchObject({ amount: E.netSalary, dueDate: '2026-02-10', status: 'settled', settledDate: '2026-02-10' });
    expect(txOn(s, '2026-02-10', 'wynagrodzenie')).toHaveLength(1);
    expect(s.ledger.filter((t) => t.category === 'wynagrodzenie' && t.date < '2026-02-10')).toHaveLength(0);
    expectConsistent(s);
  });
  it('między naliczeniem a wypłatą należność jest w majątku netto, ale nie w gotówce', () => {
    const s = advanceDays(newGame(), 30); // 31 stycznia (po naliczeniu)
    const b = netWorthBreakdown(s);
    expect(b.receivables).toBe(E.netSalary);
    expect(b.netWorth).toBe(b.cash + E.netSalary - b.payables);
    expect(playerAccount(s).balance).toBe(b.cash);
  });
  it('wynagrodzenie za luty naliczane 28.02 (miesiąc 28-dniowy) i wypłacane 10.03', () => {
    const s = advanceDays(newGame(), 31 + 28 + 11); // do 12 marca
    expect(s.obligations.some((o) => o.ruleId === 'rule:salary' && o.issueDate === '2026-02-28')).toBe(true);
    expect(txOn(s, '2026-03-10', 'wynagrodzenie')).toHaveLength(1);
  });
});

describe('3. koszty utrzymania', () => {
  it('każdy koszt jest księgowany w dniu terminu płatności, nie naliczenia', () => {
    const s = advanceToNextMonth(newGame()); // 1 lutego
    const paid = (date: string, cat: string, amount: number) => {
      const tx = txOn(s, date, cat);
      expect(tx, `${cat} ${date}`).toHaveLength(1);
      expect(tx[0]!.amount).toBe(-amount);
    };
    paid('2026-01-03', 'zywnosc', LIFESTYLE.groceries.standardowy);
    paid('2026-01-05', 'transport', LIFESTYLE.transport.standardowy);
    paid('2026-01-10', 'czynsz', E.monthlyRent); // naliczony 1.01, zapłacony 10.01
    paid('2026-01-12', 'lacznosc', E.phoneInternet.amount);
    paid('2026-01-15', 'media', E.startUtilities); // naliczone 5.01, zapłacone 15.01
    const leisure = txOn(s, '2026-01-20', 'rozrywka');
    expect(leisure).toHaveLength(1);
    expect(-leisure[0]!.amount).toBeGreaterThanOrEqual(LIFESTYLE.leisure.standardowy * 0.85);
    expect(-leisure[0]!.amount).toBeLessThanOrEqual(LIFESTYLE.leisure.standardowy * 1.15);
    expect(txOn(s, '2026-01-10', 'czynsz')[0]!.obligationId).toBe('obl:rule:rent@2026-01-01');
    expectConsistent(s);
  });
  it('czynsz jest zobowiązaniem otwartym między 1. a 10. dniem miesiąca', () => {
    const s = advanceDays(newGame(), 5); // 6 stycznia
    const rent = s.obligations.find((o) => o.ruleId === 'rule:rent')!;
    expect(rent.status).toBe('open');
    expect(netWorthBreakdown(s).payables).toBeGreaterThanOrEqual(E.monthlyRent);
  });
});

describe('4. saldo', () => {
  it('saldo po styczniu = kapitał − koszty zapłacone w styczniu', () => {
    const s = advanceToNextMonth(newGame());
    const leisure = -txOn(s, '2026-01-20', 'rozrywka')[0]!.amount;
    const fixed = LIFESTYLE.groceries.standardowy + LIFESTYLE.transport.standardowy + E.monthlyRent + E.phoneInternet.amount + E.startUtilities;
    expect(playerAccount(s).balance).toBe(GAME_START.cash - fixed - leisure);
  });
  it('saldo zawsze równe sumie rejestru i nigdy ujemne (po każdym dniu 2 lat)', () => {
    let s = newGame();
    for (let i = 0; i < 730; i++) {
      s = advanceOneDay(s);
      const sum = s.ledger.reduce((a, t) => a + t.amount, 0);
      expect(playerAccount(s).balance).toBe(sum);
      expect(playerAccount(s).balance).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('5. brak podwójnego księgowania', () => {
  it('ponowne zastosowanie tego samego dnia nie zmienia stanu', () => {
    const s = structuredClone(advanceToNextMonth(newGame()));
    const before = structuredClone(s);
    for (const date of ['2026-01-01', '2026-01-10', '2026-01-31', '2026-02-01']) {
      applyScheduledOccurrences(s, date);
      processDay(s, date);
    }
    expect(s.ledger).toEqual(before.ledger);
    expect(s.obligations).toEqual(before.obligations);
    expect(s.events).toEqual(before.events);
    expect(playerAccount(s).balance).toBe(playerAccount(before).balance);
  });
  it('próba ponownego zaksięgowania tego samego zdarzenia kończy się wyjątkiem', () => {
    const s = structuredClone(newGame());
    const input = { eventId: 'test:x', date: '2026-01-01', amount: 100, category: 'rozrywka', description: 'x', counterpartyId: null, obligationId: null };
    postTransaction(s, input);
    expect(() => postTransaction(s, input)).toThrow(/Podwójne księgowanie/);
  });
  it('odrzuca saldo ujemne i kwoty niecałkowite', () => {
    const s = structuredClone(newGame());
    const base = { date: '2026-01-01', category: 'x', description: 'x', counterpartyId: null, obligationId: null };
    expect(() => postTransaction(s, { ...base, eventId: 'a', amount: -zl(1_000_000) })).toThrow();
    expect(() => postTransaction(s, { ...base, eventId: 'b', amount: 10.5 })).toThrow();
    expect(() => postTransaction(s, { ...base, eventId: 'c', amount: 0 })).toThrow();
  });
  it('identyfikatory transakcji, zobowiązań i zdarzeń są unikalne po 10 latach', () => {
    const s = advanceDays(newGame(), 3650);
    for (const ids of [s.ledger.map((t) => t.id), s.obligations.map((o) => o.id), s.events.map((e) => e.id)]) {
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('6. majątek netto', () => {
  it('na starcie = kapitał − czynsz naliczony 1 stycznia', () => {
    const s = newGame();
    expect(netWorth(s)).toBe(GAME_START.cash - E.monthlyRent);
  });
  it('zawsze = kapitał początkowy + naliczone przychody − naliczone koszty', () => {
    let s = newGame();
    for (let i = 0; i < 400; i++) {
      s = advanceOneDay(s);
      const inc = s.obligations.filter((o) => o.direction === 'receivable').reduce((a, o) => a + o.amount, 0);
      const exp = s.obligations.filter((o) => o.direction === 'payable').reduce((a, o) => a + o.amount, 0);
      expect(netWorth(s)).toBe(s.openingCash + inc - exp);
    }
  });
  it('płacenie zobowiązania nie zmienia majątku netto (zmienia tylko jego strukturę)', () => {
    const before = advanceDays(newGame(), 8); // 9 stycznia
    const after = advanceOneDay(before); // 10 stycznia: czynsz zapłacony
    const rentOpenBefore = before.obligations.find((o) => o.ruleId === 'rule:rent')!.status === 'open';
    expect(rentOpenBefore).toBe(true);
    expect(after.obligations.find((o) => o.ruleId === 'rule:rent')!.status).toBe('settled');
    expect(netWorth(after)).toBe(netWorth(before));
  });
  it('historia majątku ma jeden punkt na dzień zgodny ze stanem', () => {
    const s = advanceDays(newGame(), 59);
    expect(s.history).toHaveLength(60);
    expect(s.history.at(-1)).toMatchObject({ date: s.clock.today, cash: playerAccount(s).balance, netWorth: netWorth(s) });
  });
});

describe('zaległości (brak środków)', () => {
  it('niezapłacone zobowiązanie czeka, jest oznaczone i opłacane po wpływie pensji', () => {
    const base = structuredClone(newGame());
    base.rules.push({
      kind: 'obligation', id: 'rule:test-big', direction: 'payable', counterpartyId: 'party:utilities', category: 'media',
      description: 'Duży rachunek (test)', issueDay: 15, due: { monthOffset: 0, day: 15 },
      amount: { type: 'fixed', amount: zl(3_000) }, startDate: '2026-01-15', endDate: '2026-01-31', contractId: null, dataStatus: 'placeholder',
    });
    const jan16 = advanceDays(base, 15);
    const big = jan16.obligations.find((o) => o.ruleId === 'rule:test-big')!;
    expect(big.status).toBe('open');
    expect(big.overdueSince).toBe('2026-01-15');
    expect(overdueObligations(jan16)).toHaveLength(1);
    expect(jan16.events.filter((e) => e.type === 'obligation.overdue')).toHaveLength(1);
    // dalsze dni nie dublują zdarzenia zaległości
    const feb9 = advanceDays(jan16, 24);
    expect(feb9.events.filter((e) => e.type === 'obligation.overdue')).toHaveLength(1);
    expect(feb9.obligations.find((o) => o.id === big.id)!.status).toBe('open');
    const feb10 = advanceOneDay(feb9);
    const settled = feb10.obligations.find((o) => o.id === big.id)!;
    expect(settled).toMatchObject({ status: 'settled', settledDate: '2026-02-10', overdueSince: '2026-01-15' });
    expect(feb10.events.find((e) => e.id === `settle:${big.id}`)!.detail).toContain('po terminie');
    expectConsistent(feb10);
  });
});

describe('7. powtarzalność (seed)', () => {
  it('ten sam seed -> identyczny stan po 24 miesiącach', () => {
    const run = (seed: string) => {
      let s = newGame(seed);
      for (let i = 0; i < 24; i++) s = advanceToNextMonth(s);
      return s;
    };
    expect(run('alfa')).toEqual(run('alfa'));
  });
  it('różne seedy -> różne losowe wydatki i data urodzenia', () => {
    const leisure = (seed: string) =>
      advanceDays(newGame(seed), 40).obligations.find((o) => o.ruleId === 'rule:leisure')!.amount;
    const amounts = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(leisure));
    expect(amounts.size).toBeGreaterThan(1);
    expect(newGame('a').person.birthDate).not.toBe(newGame('zzz-other').person.birthDate);
  });
  it('losowy wydatek zależy tylko od seeda i dnia, nie od sposobu dojścia do tego dnia', () => {
    const a = advanceDays(newGame('s1'), 100);
    let b = newGame('s1');
    for (let i = 0; i < 4; i++) b = advanceDays(b, 25);
    expect(a).toEqual(b);
  });
});

describe('9. symulacja 12 i 120 miesięcy', () => {
  for (const months of [12, 120]) {
    it(`${months} miesięcy bez utraty spójności (niezmienniki sprawdzane co miesiąc)`, () => {
      let s = newGame('long-run');
      for (let i = 0; i < months; i++) {
        s = advanceToNextMonth(s);
        expect(checkInvariants(s), `po miesiącu ${i + 1} (${s.clock.today})`).toEqual([]);
      }
      expect(s.clock.today).toBe(addDays('2026-01-01', diffDays(s.clock.today, '2026-01-01')));
      expect(s.clock.today.endsWith('-01-01')).toBe(true);
      expect(monthKey(s.clock.today)).toBe(`${2026 + months / 12}-01`);
      // Sensowność ekonomiczna przy przykładowych parametrach: gracz zarabia więcej, niż wydaje.
      expect(netWorth(s)).toBeGreaterThan(GAME_START.cash);
      expect(overdueObligations(s)).toHaveLength(0);
      const summaries = monthlySummaries(s);
      expect(summaries).toHaveLength(months + 1);
      for (const m of summaries.filter((x) => x.complete)) {
        expect(m.income).toBe(E.netSalary);
        expect(m.result).toBe(m.income - m.expenses);
      }
    });
  }
});

describe('harmonogram (projekcja)', () => {
  it('zwraca przyszłe naliczenia i terminy, bez zmian w stanie', () => {
    const s = newGame();
    const before = structuredClone(s);
    const items = scheduledItems(s, '2026-01-02', '2026-02-15');
    expect(items.some((i) => i.kind === 'due' && i.date === '2026-02-10' && i.category === 'wynagrodzenie')).toBe(true);
    expect(items.some((i) => i.kind === 'issue' && i.date === '2026-01-31' && i.category === 'wynagrodzenie')).toBe(true);
    expect(items.some((i) => i.kind === 'due' && i.date === '2026-01-10' && i.category === 'czynsz')).toBe(true); // już naliczony
    expect(items.every((i) => i.date > '2026-01-01')).toBe(true);
    expect(s).toEqual(before);
  });
  it('koszt płatny w dniu naliczenia jest jedną pozycją „termin płatności”', () => {
    const items = scheduledItems(newGame(), '2026-01-02', '2026-01-31').filter((i) => i.category === 'zywnosc');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ date: '2026-01-03', kind: 'due', amount: -LIFESTYLE.groceries.standardowy });
  });
  it('projekcja zgadza się z tym, co faktycznie się wydarzy', () => {
    const s = newGame();
    const items = scheduledItems(s, '2026-01-02', '2026-03-31').filter((i) => i.kind === 'due' && !i.approximate);
    const after = advanceDays(s, diffDays('2026-03-31', '2026-01-01'));
    for (const i of items) {
      const tx = after.ledger.filter((t) => t.date === i.date && t.category === i.category && t.amount === i.amount);
      expect(tx.length, `${i.date} ${i.title}`).toBeGreaterThanOrEqual(1);
    }
  });
});
