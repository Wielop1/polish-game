import { z } from 'zod';
import { CITIES, ECONOMY_V01, GAME_START } from './config.ts';
import { addDays, addMonths, diffDays } from './date.ts';
import { createRng } from './rng.ts';
import { logEvent, postTransaction, processDay } from './simulate.ts';
import type { Contract, GameState, Party, Rule } from './state.ts';
import { formatPLN } from './money.ts';

const NAME_RE = /^[\p{L}][\p{L}' .-]*$/u;
const NameSchema = z
  .string()
  .transform((v) => v.trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(1, 'Podaj wartość')
      .max(40, 'Maksymalnie 40 znaków')
      .regex(NAME_RE, 'Dozwolone są litery, spacje, apostrof, kropka i myślnik'),
  );

export const NewGameInputSchema = z.object({
  firstName: NameSchema,
  lastName: NameSchema,
  seed: z.string().trim().min(1, 'Seed nie może być pusty').max(100),
});
export type NewGameInput = z.input<typeof NewGameInputSchema>;

export const PLAYER_ID = 'person:player';
export const PLAYER_ACCOUNT_ID = 'acc:player:main';

const PARTIES: Party[] = [
  { id: 'party:employer', name: 'Pracodawca', role: 'employer' },
  { id: 'party:landlord', name: 'Wynajmujący', role: 'landlord' },
  { id: 'party:utilities', name: 'Dostawcy mediów', role: 'utility' },
  { id: 'party:telecom', name: 'Operator telekomunikacyjny', role: 'utility' },
  { id: 'party:grocery', name: 'Sklepy spożywcze', role: 'retail' },
  { id: 'party:transport', name: 'Komunikacja i paliwo', role: 'service' },
  { id: 'party:leisure', name: 'Rozrywka i usługi', role: 'service' },
];

function buildContracts(startDate: string): Contract[] {
  return [
    {
      id: 'contract:employment',
      type: 'employment',
      partyId: 'party:employer',
      title: ECONOMY_V01.jobTitle,
      startDate,
      endDate: null,
      monthlyAmount: ECONOMY_V01.netSalary,
      dataStatus: 'placeholder',
    },
    {
      id: 'contract:lease',
      type: 'lease',
      partyId: 'party:landlord',
      title: 'Najem mieszkania w Olsztynie',
      startDate,
      endDate: null,
      monthlyAmount: ECONOMY_V01.monthlyRent,
      dataStatus: 'placeholder',
    },
  ];
}

function buildRules(startDate: string): Rule[] {
  const base = { startDate, endDate: null, dataStatus: 'placeholder' } as const;
  const E = ECONOMY_V01;
  return [
    {
      ...base,
      kind: 'obligation',
      id: 'rule:salary',
      direction: 'receivable',
      counterpartyId: 'party:employer',
      category: 'wynagrodzenie',
      description: 'Wynagrodzenie netto',
      issueDay: 'last',
      due: { monthOffset: 1, day: E.salaryPayDay },
      amount: { type: 'contract', contractId: 'contract:employment' },
    },
    {
      ...base,
      kind: 'obligation',
      id: 'rule:rent',
      direction: 'payable',
      counterpartyId: 'party:landlord',
      category: 'czynsz',
      description: 'Czynsz',
      issueDay: E.rentIssueDay,
      due: { monthOffset: 0, day: E.rentDueDay },
      amount: { type: 'contract', contractId: 'contract:lease' },
    },
    {
      ...base,
      kind: 'obligation',
      id: 'rule:utilities',
      direction: 'payable',
      counterpartyId: 'party:utilities',
      category: 'media',
      description: 'Media (prąd, ogrzewanie, woda)',
      issueDay: E.utilities.issueDay,
      due: { monthOffset: 0, day: E.utilities.dueDay },
      amount: { type: 'fixed', amount: E.utilities.amount },
    },
    {
      ...base,
      kind: 'obligation',
      id: 'rule:phone',
      direction: 'payable',
      counterpartyId: 'party:telecom',
      category: 'lacznosc',
      description: 'Telefon i internet',
      issueDay: E.phoneInternet.issueDay,
      due: { monthOffset: 0, day: E.phoneInternet.dueDay },
      amount: { type: 'fixed', amount: E.phoneInternet.amount },
    },
    {
      ...base,
      kind: 'obligation',
      id: 'rule:groceries',
      direction: 'payable',
      counterpartyId: 'party:grocery',
      category: 'zywnosc',
      description: 'Zakupy spożywcze',
      issueDay: E.groceries.issueDay,
      due: { monthOffset: 0, day: E.groceries.dueDay },
      amount: { type: 'fixed', amount: E.groceries.amount },
    },
    {
      ...base,
      kind: 'obligation',
      id: 'rule:transport',
      direction: 'payable',
      counterpartyId: 'party:transport',
      category: 'transport',
      description: 'Transport',
      issueDay: E.transport.issueDay,
      due: { monthOffset: 0, day: E.transport.dueDay },
      amount: { type: 'fixed', amount: E.transport.amount },
    },
    {
      ...base,
      kind: 'obligation',
      id: 'rule:leisure',
      direction: 'payable',
      counterpartyId: 'party:leisure',
      category: 'rozrywka',
      description: 'Rozrywka i drobne wydatki',
      issueDay: E.leisure.issueDay,
      due: { monthOffset: 0, day: E.leisure.dueDay },
      amount: { type: 'variable', base: E.leisure.base, spreadBps: E.leisure.spreadBps },
    },
    { kind: 'birthday', id: 'rule:birthday', startDate },
  ];
}

/** Data urodzenia dająca dokładnie `age` lat w dniu `on` — wybierana deterministycznie z seeda. */
function pickBirthDate(seed: string, on: string, age: number): string {
  const latest = addMonths(on, -12 * age); // urodziny dokładnie w dniu startu
  const earliest = addDays(addMonths(on, -12 * (age + 1)), 1);
  const span = diffDays(latest, earliest);
  return addDays(earliest, createRng(seed, 'person.birthDate').int(0, span));
}

/** Tworzy nową grę. Rzuca ZodError przy nieprawidłowych danych wejściowych. */
export function createNewGame(input: NewGameInput): GameState {
  const { firstName, lastName, seed } = NewGameInputSchema.parse(input);
  const startDate = GAME_START.date;
  if (!CITIES[GAME_START.cityId]) throw new Error(`Nieznane miasto: ${GAME_START.cityId}`);

  const state: GameState = {
    gameId: `game:${seed}`,
    seed,
    clock: { startDate, today: startDate },
    person: {
      id: PLAYER_ID,
      firstName,
      lastName,
      birthDate: pickBirthDate(seed, startDate, GAME_START.age),
      cityId: GAME_START.cityId,
    },
    parties: Object.fromEntries(PARTIES.map((p) => [p.id, p])),
    accounts: {
      [PLAYER_ACCOUNT_ID]: {
        id: PLAYER_ACCOUNT_ID,
        ownerId: PLAYER_ID,
        name: 'Rachunek osobisty',
        currency: 'PLN',
        balance: 0,
      },
    },
    playerAccountId: PLAYER_ACCOUNT_ID,
    contracts: buildContracts(startDate),
    rules: buildRules(startDate),
    ledger: [],
    obligations: [],
    events: [],
    processed: {},
    history: [],
    openingCash: GAME_START.cash,
  };

  postTransaction(state, {
    eventId: 'init:opening-balance',
    date: startDate,
    amount: GAME_START.cash,
    category: 'kapital_poczatkowy',
    description: 'Środki na start',
    counterpartyId: null,
    obligationId: null,
  });
  logEvent(state, {
    id: 'game.started',
    date: startDate,
    type: 'game.started',
    tone: 'neutral',
    title: `Początek gry — ${firstName} ${lastName}, ${CITIES[GAME_START.cityId]!.name}`,
    detail: `Kapitał na start: ${formatPLN(GAME_START.cash)}`,
    amount: GAME_START.cash,
    category: 'kapital_poczatkowy',
  });
  // Dzień startu jest „zamknięty” dopiero po przetworzeniu jego zdarzeń.
  processDay(state, startDate);
  return state;
}
