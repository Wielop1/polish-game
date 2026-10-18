import { zl } from './money.ts';

/**
 * Parametry startowe v0.1.
 *
 * WSZYSTKIE wartości ekonomiczne poniżej są PRZYKŁADOWE (placeholder) i NIE zostały
 * zweryfikowane z danymi rzeczywistymi (płace, czynsze, ceny). Po utworzeniu gry trafiają
 * do stanu (umowy i reguły z `dataStatus: 'placeholder'`), więc zmiana tego pliku nie
 * zmienia już istniejących zapisów.
 */

export const GAME_START = {
  date: '2026-01-01',
  age: 22,
  cityId: 'olsztyn',
  cash: zl(5_000),
} as const;

export const CITIES: Record<string, { id: string; name: string; voivodeship: string }> = {
  olsztyn: { id: 'olsztyn', name: 'Olsztyn', voivodeship: 'warmińsko-mazurskie' },
};

export const PLACEHOLDER_NOTICE =
  'Wartości przykładowe — niezweryfikowane z danymi rzeczywistymi. Docelowo będą konfigurowalne i wersjonowane datami.';

export const ECONOMY_V01 = {
  /** Wynagrodzenie netto/mies.; wypłata do 10. dnia następnego miesiąca (placeholder). */
  netSalary: zl(4_600),
  salaryPayDay: 10,
  jobTitle: 'Pracownik biurowy (etat)',
  /** Czynsz najmu mieszkania/pokoju w Olsztynie (placeholder). */
  monthlyRent: zl(1_700),
  rentIssueDay: 1,
  rentDueDay: 10,
  utilities: { amount: zl(300), issueDay: 5, dueDay: 15 },
  phoneInternet: { amount: zl(70), issueDay: 12, dueDay: 12 },
  groceries: { amount: zl(1_000), issueDay: 3, dueDay: 3 },
  transport: { amount: zl(180), issueDay: 5, dueDay: 5 },
  leisure: { base: zl(300), spreadBps: 1_500, issueDay: 20, dueDay: 20 },
} as const;
