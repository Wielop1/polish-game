import { listOperators } from '../engine/operator.ts';
import type { GameState } from '../engine/state.ts';
import type { Screen } from '../store/gameStore.ts';
import { computeNavAlerts } from './navAlerts.ts';
import { SCREEN_LABEL, businessKind } from './nav.ts';

/** Podpowiedzi „co zrobić teraz?” i lista pierwszych kroków — czysto widokowe (nic nie zmieniają w stanie gry). */
export interface NextStep { id: string; title: string; why: string; screen: Screen; urgent: boolean }
export interface FirstStep { id: string; label: string; screen: Screen; done: boolean; hint: string }

const marketingSet = (game: GameState): boolean => {
  const sum = (b: Record<string, number>) => Object.values(b).reduce((a, x) => a + x, 0);
  return sum(game.market.marketing.budgets) > 0 || game.corp.companies.some((c) => c.slices?.marketing && sum(c.slices.marketing.budgets) > 0);
};

/** Priorytety: zaległości i płynność → decyzje klientów → praca w toku → rozwój. */
const ALERT_ORDER: { screen: Screen; title: (n: number) => string; urgent: boolean }[] = [
  { screen: 'bizFinance', title: (n) => `${n} zaległych zobowiązań firmy`, urgent: true },
  { screen: 'opsProfit', title: () => 'Prognoza płynności: grozi brak środków', urgent: true },
  { screen: 'renoQuotes', title: (n) => `${n} ${n === 1 ? 'oferta czeka' : 'ofert czeka'} na Twoją decyzję lub podpis`, urgent: true },
  { screen: 'renoEnquiries', title: (n) => `${n} ${n === 1 ? 'zapytanie klienta czeka' : 'zapytań klientów czeka'} na wycenę`, urgent: true },
  { screen: 'projects', title: (n) => `${n} ${n === 1 ? 'sprawa' : 'spraw'} w większych projektach czeka na decyzję`, urgent: true },
  { screen: 'renoContracts', title: (n) => `${n} ${n === 1 ? 'kontrakt stoi' : 'kontraktów stoi'} (materiały, sprzęt, wykonawcy)`, urgent: true },
  { screen: 'opsSubcontractors', title: () => 'Oferta lub praca podwykonawcy czeka na decyzję', urgent: true },
  { screen: 'renoReputation', title: (n) => `${n} ${n === 1 ? 'reklamacja' : 'reklamacji'} do rozpatrzenia`, urgent: true },
  { screen: 'projectPackages', title: () => 'Pakiet projektu czeka na wykonawców', urgent: true },
  { screen: 'hrRecruitment', title: (n) => `${n} ${n === 1 ? 'kandydat czeka' : 'kandydatów czeka'} na ofertę`, urgent: false },
  { screen: 'renoStock', title: () => 'Sprzęt wymaga konserwacji', urgent: false },
  { screen: 'corpResolutions', title: () => 'Zgromadzenie wspólników czeka na Twój głos', urgent: false },
  { screen: 'corpInvestors', title: () => 'Oferta inwestora czeka na decyzję', urgent: false },
  { screen: 'decisions', title: () => 'Zdarzenie życiowe czeka na decyzję', urgent: false },
];

export function nextSteps(game: GameState): NextStep[] {
  const out: NextStep[] = [];
  const kind = businessKind(game);
  if (!kind.business) {
    out.push({ id: 'register', title: 'Załóż własną firmę remontową', why: 'Dopiero firma daje zlecenia, rynek i szansę na zarobek większy niż etat. Wybierz profil „Remonty” w rejestracji JDG — wystarczy kilka kliknięć.', screen: 'bizRegister', urgent: true });
    return out;
  }
  const alerts = computeNavAlerts(game, {});
  for (const a of ALERT_ORDER) {
    const al = alerts[a.screen];
    if (al) out.push({ id: a.screen, title: a.title(al.count), why: al.hint, screen: a.screen, urgent: a.urgent });
  }
  if (kind.renovation) {
    if (!marketingSet(game)) out.push({ id: 'marketing', title: 'Ustaw budżet marketingowy', why: 'Bez marketingu dostaniesz tylko kilka zapytań miesięcznie. Nawet skromny budżet (reklamy lokalne, wizytówka) wyraźnie zwiększa liczbę klientów.', screen: 'marketMarketing', urgent: false });
    if (game.reno.equipment.length === 0) out.push({ id: 'equipment', title: 'Kup narzędzia do swojej specjalizacji', why: 'Bez wymaganego zestawu narzędzi nie wyślesz oferty — sprawdź „Magazyn i sprzęt”.', screen: 'renoStock', urgent: false });
  }
  if (out.length === 0) out.push({ id: 'wait', title: 'Nic pilnego — przesuń czas', why: 'Kliknij „Następny dzień” u góry. Nowe zapytania i płatności pojawią się same; kropki w menu wskażą, kiedy coś wymaga reakcji.', screen: 'dashboard', urgent: false });
  return out.slice(0, 5);
}

/** Pierwsze kroki w grze (od założenia firmy do pierwszego zarobku). */
export function firstSteps(game: GameState): FirstStep[] {
  const ops = listOperators(game);
  const biz = ops.length > 0;
  const done = game.reno.jobs.filter((j) => j.stage === 'done').length;
  return [
    { id: 'biz', label: 'Załóż firmę (Rejestracja JDG)', screen: 'bizRegister', done: biz, hint: 'Profil „Remonty”. Jedna firma na start wystarczy.' },
    { id: 'equip', label: 'Kup narzędzia do swojej usługi', screen: 'renoStock', done: game.reno.equipment.length > 0, hint: 'Np. zestaw malarski do malowania.' },
    { id: 'marketing', label: 'Ustaw skromny marketing', screen: 'marketMarketing', done: marketingSet(game), hint: 'Reklamy lokalne + wizytówka na początek.' },
    { id: 'quote', label: 'Wyślij pierwszą wycenę', screen: 'renoEnquiries', done: game.reno.quotes.length > 0, hint: 'Zapytania pojawiają się po kilku dniach działalności.' },
    { id: 'sign', label: 'Podpisz pierwszą umowę', screen: 'renoQuotes', done: game.reno.jobs.length > 0, hint: 'Klient musi najpierw zaakceptować ofertę.' },
    { id: 'finish', label: 'Wykonaj kontrakt i odbierz zapłatę', screen: 'renoContracts', done: done > 0, hint: 'Kup materiały przed startem i pilnuj terminu.' },
    { id: 'profit', label: 'Sprawdź, ile NAPRAWDĘ zarabiasz', screen: 'opsProfit', done: done >= 3, hint: 'Po 3 kontraktach zobaczysz realną stawkę za godzinę i zysk ekonomiczny.' },
  ];
}

export const stepLabel = (s: Screen): string => SCREEN_LABEL[s] ?? s;
