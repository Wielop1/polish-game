import { SKILL_LABELS } from './config.ts';
import { CommandError, createObligation, ensureParty, logEvent } from './core.ts';
import { currentEmployment, currentLease } from './contracts.ts';
import { addDays, daysInMonth, formatDatePL, parseIso } from './date.ts';
import type { IsoDate } from './date.ts';
import { promoteEmployment, tenureDays, terminateEmployment, noticeEndDate } from './jobs.ts';
import { formatPLN, mulBps, zl } from './money.ts';
import { createRng } from './rng.ts';
import type { Rng } from './rng.ts';
import { totalBalance } from './selectors.ts';
import { SKILL_IDS } from './state.ts';
import type { GameState, LifeEvent, Skill } from './state.ts';
import { clampFatigue, firstOverload, performanceBps } from './time.ts';

/**
 * Katalog wydarzeń życiowych. Każdego miesiąca w `rollDay` silnik losuje (deterministycznie, z pary
 * seed + id wydarzenia) czy wydarzenie wystąpi, a prawdopodobieństwo zależy od stanu rozgrywki.
 * Skutki są liczone przez ten sam silnik zobowiązań/umów co reszta gry i nigdy nie wykonują się dwa razy.
 */

interface Draft {
  title: string;
  body: string;
  options: LifeEvent['options'];
  defaultOptionId: string | null;
  expiresInDays: number | null;
  params: LifeEvent['params'];
  tone: 'neutral' | 'warning' | 'positive';
}

interface Template {
  id: string;
  rollDay: number;
  weight(s: GameState, date: IsoDate): number;
  create(s: GameState, date: IsoDate, rng: Rng): Draft;
  /** `optionId === null` dla wydarzeń bez decyzji. Zwraca opis skutku; może rzucić CommandError (decyzja niewykonalna). */
  apply(s: GameState, ev: LifeEvent, optionId: string | null, rng: Rng, date: IsoDate): string;
}

const performance = (s: GameState) => performanceBps(s.life.fatigue);
const recentlyHad = (s: GameState, templateId: string, date: IsoDate, days: number) =>
  s.lifeEvents.some((e) => e.templateId === templateId && e.date > addDays(date, -days));
const hasPending = (s: GameState, templateId: string) => s.lifeEvents.some((e) => e.templateId === templateId && e.status === 'pending');

function lifeParty(s: GameState): string {
  ensureParty(s, { id: 'party:life', name: 'Różne wydatki życiowe', role: 'service' });
  return 'party:life';
}

function charge(s: GameState, ev: LifeEvent, date: IsoDate, key: string, amount: number, category: string, description: string, dueInDays: number): void {
  createObligation(s, {
    occurrenceId: `${ev.id}:${key}`, ruleId: `evt:${ev.templateId}`, direction: 'payable', counterpartyId: lifeParty(s),
    amount, issueDate: date, dueDate: addDays(date, dueInDays), category, description,
  });
}

const TEMPLATES: Template[] = [
  {
    id: 'appliance',
    rollDay: 9,
    weight: (s, date) => (currentLease(s, date) && !hasPending(s, 'appliance') && !recentlyHad(s, 'appliance', date, 60) ? 700 : 0),
    create(_s, _date, rng) {
      const item = ['pralka', 'lodówka', 'kuchenka', 'bojler', 'odkurzacz'][rng.int(0, 4)]!;
      return {
        title: `Awaria sprzętu: ${item}`,
        body: `Sprzęt domowy (${item}) przestał działać. Musisz zdecydować, co z tym zrobić — koszt zależy od wyboru, a dokładnej kwoty nie znasz z góry.`,
        options: [
          { id: 'repair', label: 'Zamów naprawę', hint: 'Zwykle 200–500 zł; sprzęt wraca do działania po kilku dniach.' },
          { id: 'replace', label: 'Kup nowy sprzęt', hint: 'Zwykle 1 000–1 600 zł; problem znika na dobre.' },
          { id: 'wait', label: 'Poczekaj i radź sobie', hint: 'Bez kosztu teraz, ale uciążliwe (rośnie zmęczenie), a awaria może się pogorszyć i wyjść drożej.' },
        ],
        defaultOptionId: 'wait',
        expiresInDays: 10,
        params: { item },
        tone: 'warning',
      };
    },
    apply(s, ev, optionId, rng, date) {
      const item = String(ev.params.item);
      if (optionId === 'repair') {
        const cost = zl(rng.int(200, 500));
        charge(s, ev, date, 'cost', cost, 'awaria', `Naprawa: ${item}`, 3);
        return `Naprawa kosztowała ${formatPLN(cost)}; sprzęt działa.`;
      }
      if (optionId === 'replace') {
        const cost = zl(rng.int(1000, 1600));
        charge(s, ev, date, 'cost', cost, 'awaria', `Nowy sprzęt: ${item}`, 3);
        return `Kupiono nowy sprzęt za ${formatPLN(cost)}.`;
      }
      s.life.fatigue = clampFatigue(s.life.fatigue + 8);
      if (rng.int(0, 99) < 40) {
        const cost = zl(rng.int(400, 900));
        charge(s, ev, date, 'cost', cost, 'awaria', `Pogorszona awaria: ${item}`, 3);
        return `Awaria się pogorszyła — pilna naprawa kosztowała ${formatPLN(cost)}. Zmęczenie wzrosło.`;
      }
      return 'Udało się przeczekać bez kosztów, ale zmęczenie wzrosło.';
    },
  },
  {
    id: 'unexpected_expense',
    rollDay: 17,
    weight: () => 900,
    create(_s, _date, rng) {
      const what = ['Mandat za parkowanie', 'Wizyta u lekarza i leki', 'Prezent dla bliskiej osoby', 'Naprawa telefonu', 'Nieplanowany wyjazd służbowy'][rng.int(0, 4)]!;
      return { title: `Niespodziewany wydatek: ${what}`, body: 'Pojawił się wydatek, którego nie planowałeś. Zostanie rozliczony w ciągu kilku dni.', options: [], defaultOptionId: null, expiresInDays: null, params: { what }, tone: 'warning' };
    },
    apply(s, ev, _o, rng, date) {
      const cost = zl(rng.int(150, 600));
      charge(s, ev, date, 'cost', cost, 'nieprzewidziane', String(ev.params.what), 5);
      return `Koszt: ${formatPLN(cost)} (termin płatności za 5 dni).`;
    },
  },
  {
    id: 'bonus',
    rollDay: 25,
    weight(s, date) {
      const c = currentEmployment(s, date);
      if (!c || c.endDate !== null || tenureDays(s, c) < 60 || performance(s) < 7_000) return 0;
      return Math.round((500 * performance(s)) / 10_000);
    },
    create() {
      return { title: 'Premia w pracy', body: 'Pracodawca docenił Twoje wyniki i przyznał premię.', options: [], defaultOptionId: null, expiresInDays: null, params: {}, tone: 'positive' };
    },
    apply(s, ev, _o, rng, date) {
      const c = currentEmployment(s, date);
      if (!c) return 'Premia nie została wypłacona (brak aktywnej umowy).';
      const pct = rng.int(10, 30);
      const amount = mulBps(c.monthlyAmount, pct * 100);
      createObligation(s, {
        occurrenceId: `${ev.id}:bonus`, ruleId: 'evt:bonus', direction: 'receivable', counterpartyId: c.partyId, amount,
        issueDate: date, dueDate: addDays(date, 10), category: 'premia', description: 'Premia',
      });
      return `Premia ${formatPLN(amount)} (ok. ${pct}% miesięcznej pensji netto) wpłynie za 10 dni.`;
    },
  },
  {
    id: 'promotion',
    rollDay: 12,
    weight(s, date) {
      const c = currentEmployment(s, date);
      if (!c || c.endDate !== null || tenureDays(s, c) < 180 || performance(s) < 8_000) return 0;
      if (hasPending(s, 'promotion')) return 0;
      if (s.lifeEvents.some((e) => e.templateId === 'promotion' && e.chosenOptionId === 'accept' && e.date > addDays(date, -365))) return 0;
      return 300;
    },
    create(s, date) {
      const c = currentEmployment(s, date)!;
      return {
        title: 'Propozycja awansu',
        body: `${s.parties[c.partyId]?.name ?? 'Pracodawca'} proponuje Ci awans (stanowisko wyżej, wyższa pensja). Wiąże się z większą odpowiedzialnością.`,
        options: [
          { id: 'accept', label: 'Przyjmij awans', hint: 'Wynagrodzenie wzrośnie o ok. 10–18% od 1. dnia następnego miesiąca; dokładny wzrost poznasz po przyjęciu.' },
          { id: 'decline', label: 'Odmów', hint: 'Zostajesz na obecnych warunkach.' },
        ],
        defaultOptionId: 'decline',
        expiresInDays: 14,
        params: { contractId: c.id },
        tone: 'positive',
      };
    },
    apply(s, _ev, optionId, rng) {
      if (optionId !== 'accept') return 'Odmówiono awansu — warunki bez zmian.';
      const pct = rng.int(10, 18);
      const { newContract, startDate } = promoteEmployment(s, pct);
      return `Awans przyjęty: „${newContract.title}”, wynagrodzenie netto ≈ ${formatPLN(newContract.monthlyAmount)} (+${pct}%, szacunek) od ${formatDatePL(startDate)}.`;
    },
  },
  {
    id: 'job_loss',
    rollDay: 27,
    weight(s, date) {
      const c = currentEmployment(s, date);
      if (!c || c.endDate !== null || tenureDays(s, c) < 90) return 0;
      const p = performance(s);
      return 120 * (1 + (p < 6_000 ? 3 : p < 8_000 ? 1 : 0));
    },
    create(s, date) {
      const c = currentEmployment(s, date)!;
      return { title: 'Utrata zatrudnienia', body: `${s.parties[c.partyId]?.name ?? 'Pracodawca'} wypowiedział Ci umowę o pracę.`, options: [], defaultOptionId: null, expiresInDays: null, params: { contractId: c.id }, tone: 'warning' };
    },
    apply(s, _ev, _o, _rng, date) {
      const c = currentEmployment(s, date);
      if (!c || c.endDate !== null) return 'Wypowiedzenie nie wywołało skutków (umowa już się kończy).';
      const end = noticeEndDate(date, c.noticeMonths);
      terminateEmployment(s, c, 'employer', end);
      return `Pracujesz i otrzymujesz wynagrodzenie do ${formatDatePL(end)} (okres wypowiedzenia: ${c.noticeMonths} mies.). Poszukaj nowej pracy w ofertach.`;
    },
  },
  {
    id: 'side_gig',
    rollDay: 5,
    weight(s, date) {
      if (hasPending(s, 'side_gig')) return 0;
      if (s.commitments.some((c) => c.label.startsWith('Dorywcza') && c.endDate >= date)) return 0;
      if (performance(s) < 5_000) return 0;
      return firstOverload(s, addDays(date, 1), addDays(date, 14), { extraHoursPerDay: 2 }) === null ? 700 : 0;
    },
    create() {
      return {
        title: 'Okazja do dodatkowego zarobku',
        body: 'Znajomy proponuje dorywcze zlecenie. Zajmie to wolny czas przez dwa tygodnie, a wypłata przyjdzie po zakończeniu.',
        options: [
          { id: 'accept', label: 'Podejmij zlecenie', hint: 'Ok. 2 godz. dziennie przez 14 dni (kosztem czasu wolnego i zmęczenia); wypłata ok. 700–1 100 zł tydzień po zakończeniu.' },
          { id: 'decline', label: 'Odmów', hint: 'Bez zmian.' },
        ],
        defaultOptionId: 'decline',
        expiresInDays: 5,
        params: {},
        tone: 'positive',
      };
    },
    apply(s, ev, optionId, rng, date) {
      if (optionId !== 'accept') return 'Odmówiono zlecenia.';
      const start = addDays(date, 1);
      const end = addDays(start, 13);
      if (firstOverload(s, start, end, { extraHoursPerDay: 2 })) throw new CommandError('Brak wolnych godzin na to zlecenie w najbliższych dwóch tygodniach.');
      s.commitments.push({ id: `commit:${ev.id}`, label: 'Dorywcza praca (zlecenie)', startDate: start, endDate: end, hoursPerDay: 2, sourceEventId: ev.id });
      const amount = zl(rng.int(700, 1100));
      ensureParty(s, { id: 'party:gig', name: 'Zleceniodawca (dorywcze zlecenie)', role: 'employer' });
      s.pending.push({
        id: `pending:${ev.id}:payout`, date: addDays(end, 1), type: 'obligation.issue',
        obligation: { occurrenceId: `${ev.id}:payout`, ruleId: 'evt:side_gig', direction: 'receivable', counterpartyId: 'party:gig', accountId: s.playerAccountId, amount, dueDate: addDays(end, 7), category: 'dodatkowy_zarobek', description: 'Wynagrodzenie za dorywcze zlecenie' },
      });
      return `Zlecenie ${formatDatePL(start)}–${formatDatePL(end)} (2 godz. dziennie). Kwota wynagrodzenia będzie znana po jego zakończeniu.`;
    },
  },
  {
    id: 'course',
    rollDay: 14,
    weight(s, date) {
      if (hasPending(s, 'course') || recentlyHad(s, 'course', date, 120)) return 0;
      if (totalBalance(s) < zl(900) + zl(500)) return 0;
      if (SKILL_IDS.every((k) => (s.life.skills[k] ?? 0) >= 5)) return 0;
      return firstOverload(s, addDays(date, 1), addDays(date, 30), { extraHoursPerDay: 2 }) === null ? 400 : 0;
    },
    create(s, _date, rng) {
      const candidates = SKILL_IDS.filter((k) => (s.life.skills[k] ?? 0) < 5);
      const skill = candidates[rng.int(0, candidates.length - 1)]!;
      const label = SKILL_LABELS[skill];
      return {
        title: `Kurs: ${label}`,
        body: `Dostępny jest kurs podnoszący umiejętność „${label}”. Wymaga pieniędzy i regularnego czasu.`,
        options: [
          { id: 'enroll', label: 'Zapisz się', hint: '900 zł i ok. 2 godz. dziennie przez 30 dni; po ukończeniu +1 poziom umiejętności.' },
          { id: 'decline', label: 'Nie teraz', hint: 'Bez kosztów i zobowiązań.' },
        ],
        defaultOptionId: 'decline',
        expiresInDays: 10,
        params: { skill },
        tone: 'neutral',
      };
    },
    apply(s, ev, optionId, _rng, date) {
      if (optionId !== 'enroll') return 'Nie zapisano się na kurs.';
      const skill = String(ev.params.skill) as Skill;
      const fee = zl(900);
      if (totalBalance(s) < fee) throw new CommandError('Brak środków na opłatę za kurs.');
      const start = addDays(date, 1);
      const end = addDays(start, 29);
      if (firstOverload(s, start, end, { extraHoursPerDay: 2 })) throw new CommandError('Brak wolnych godzin na kurs w najbliższych 30 dniach.');
      ensureParty(s, { id: 'party:school', name: 'Ośrodek szkoleniowy', role: 'service' });
      createObligation(s, {
        occurrenceId: `${ev.id}:fee`, ruleId: 'evt:course', direction: 'payable', counterpartyId: 'party:school', amount: fee,
        issueDate: date, dueDate: addDays(date, 1), category: 'szkolenie', description: `Kurs: ${SKILL_LABELS[skill]}`,
      });
      s.commitments.push({ id: `commit:${ev.id}`, label: `Kurs: ${SKILL_LABELS[skill]}`, startDate: start, endDate: end, hoursPerDay: 2, sourceEventId: ev.id });
      s.pending.push({ id: `pending:${ev.id}:skill`, date: addDays(end, 1), type: 'skill.gain', skill, levels: 1, label: `Ukończono kurs: ${SKILL_LABELS[skill]}` });
      return `Zapisano na kurs (opłata ${formatPLN(fee)}). Zajęcia: ${formatDatePL(start)}–${formatDatePL(end)}, 2 godz. dziennie.`;
    },
  },
];

const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

export function templateIds(): string[] {
  return TEMPLATES.map((t) => t.id);
}

function isRollDay(date: IsoDate, rollDay: number): boolean {
  const { year, month, day } = parseIso(date);
  return day === Math.min(rollDay, daysInMonth(year, month));
}

/** Losowanie wydarzeń na dany dzień. Idempotentne (po id wydarzenia), deterministyczne (seed + id). */
export function rollLifeEvents(s: GameState, date: IsoDate): void {
  if (!s.settings.lifeEvents || date <= s.clock.startDate) return;
  for (const tpl of TEMPLATES) {
    if (!isRollDay(date, tpl.rollDay)) continue;
    const id = `evt:${tpl.id}@${date}`;
    if (s.lifeEvents.some((e) => e.id === id)) continue;
    const weight = tpl.weight(s, date);
    if (weight <= 0) continue;
    if (createRng(s.seed, `evt-roll:${id}`).int(0, 9_999) >= weight) continue;

    const draft = tpl.create(s, date, createRng(s.seed, `evt-gen:${id}`));
    const decision = draft.options.length > 0;
    const ev: LifeEvent = {
      id, templateId: tpl.id, date, status: decision ? 'pending' : 'resolved', title: draft.title, body: draft.body,
      options: draft.options, defaultOptionId: draft.defaultOptionId,
      expiresOn: decision && draft.expiresInDays !== null ? addDays(date, draft.expiresInDays) : null,
      chosenOptionId: null, resolvedOn: null, outcome: null, params: draft.params,
    };
    s.lifeEvents.push(ev);
    s.processed[id] = true;
    if (decision && ev.expiresOn) {
      s.pending.push({ id: `pending:${id}:expire`, date: ev.expiresOn, type: 'event.expire', eventId: id });
    }
    logEvent(s, {
      id: `life.event:${id}`, date, type: 'life.event', tone: draft.tone === 'positive' ? 'positive' : draft.tone === 'warning' ? 'warning' : 'neutral',
      title: decision ? `Zdarzenie: ${draft.title} — wymaga decyzji` : `Zdarzenie: ${draft.title}`,
      detail: draft.body, amount: null, category: null,
    });
    if (!decision) {
      ev.outcome = tpl.apply(s, ev, null, createRng(s.seed, `${id}:auto`), date);
      ev.resolvedOn = date;
    }
  }
}

/** Decyzja gracza. Rzuca CommandError, gdy wybór jest niemożliwy (stan nietknięty dzięki runCommand). */
export function resolveLifeEvent(s: GameState, eventId: string, optionId: string): string {
  const ev = s.lifeEvents.find((e) => e.id === eventId);
  if (!ev) throw new CommandError('Nie ma takiego zdarzenia.');
  if (ev.status !== 'pending') throw new CommandError('To zdarzenie zostało już rozstrzygnięte.');
  const option = ev.options.find((o) => o.id === optionId);
  if (!option) throw new CommandError('Nieprawidłowy wybór.');
  const tpl = BY_ID.get(ev.templateId);
  if (!tpl) throw new CommandError('Nieznany typ zdarzenia.');
  const date = s.clock.today;
  const outcome = tpl.apply(s, ev, optionId, createRng(s.seed, `${ev.id}:${optionId}`), date);
  ev.status = 'resolved';
  ev.chosenOptionId = optionId;
  ev.resolvedOn = date;
  ev.outcome = outcome;
  logEvent(s, {
    id: `life.decision:${ev.id}`, date, type: 'life.decision', tone: 'neutral',
    title: `Decyzja: ${ev.title} — ${option.label}`, detail: outcome, amount: null, category: null,
  });
  return outcome;
}

/** Brak decyzji do terminu: stosowana jest opcja domyślna. Idempotentne (status). */
export function expireLifeEvent(s: GameState, eventId: string, date: IsoDate): void {
  const ev = s.lifeEvents.find((e) => e.id === eventId);
  if (!ev || ev.status !== 'pending') return;
  const tpl = BY_ID.get(ev.templateId);
  const optionId = ev.defaultOptionId;
  let outcome = 'Brak decyzji w terminie.';
  if (tpl && optionId) {
    try {
      outcome = `Brak decyzji w terminie — ${tpl.apply(s, ev, optionId, createRng(s.seed, `${ev.id}:${optionId}`), date)}`;
    } catch (e) {
      if (!(e instanceof CommandError)) throw e;
    }
  }
  ev.status = 'expired';
  ev.chosenOptionId = optionId;
  ev.resolvedOn = date;
  ev.outcome = outcome;
  logEvent(s, {
    id: `life.decision:${ev.id}`, date, type: 'life.decision', tone: 'neutral',
    title: `Termin minął: ${ev.title}`, detail: outcome, amount: null, category: null,
  });
}

export function pendingLifeEvents(s: GameState): LifeEvent[] {
  return s.lifeEvents.filter((e) => e.status === 'pending');
}
