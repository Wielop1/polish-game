import { overdueObligations } from '../engine/selectors.ts';
import { liquidityForecast } from '../engine/profitability.ts';
import { activeEmployments, personById } from '../engine/workforce.ts';
import type { GameState } from '../engine/state.ts';
import type { Screen } from '../store/gameStore.ts';

/**
 * Powiadomienia przy pozycjach menu (kropka): liczba spraw, które czekają na decyzję lub uwagę gracza.
 * Większość to stan „do załatwienia” (znika po obsłużeniu); powiadomienia biura rachunkowego znikają po wejściu na ekran.
 */
export type NavAlerts = Partial<Record<Screen, { count: number; hint: string }>>;

export function computeNavAlerts(game: GameState, visited: Record<string, string>): NavAlerts {
  const out: NavAlerts = {};
  const add = (screen: Screen, count: number, hint: string) => { if (count > 0) out[screen] = { count, hint }; };
  const active = game.reno.jobs.filter((j) => j.stage !== 'done' && j.stage !== 'cancelled');

  add('renoEnquiries', game.reno.enquiries.filter((e) => e.status === 'open').length, 'nowe zapytania czekają na wycenę');
  add('renoQuotes', game.reno.quotes.filter((q) => q.status === 'counter' || q.status === 'accepted').length, 'negocjacje lub umowa do podpisu');
  add('renoContracts', active.filter((j) => j.blockedReason !== null && j.stage !== 'preparation').length, 'kontrakt stoi (materiały, sprzęt, brak wykonawców)');
  add('projects', game.reno.projects.filter((p) => p.status === 'counter' || p.status === 'accepted').length + game.reno.projects.filter((p) => p.status === 'enquiry' && p.requirements.minCompleted <= game.reno.jobs.filter((j) => j.stage === 'done').length).length, 'zapytanie lub umowa projektu czeka na decyzję');
  add('projectPackages', game.reno.projects.filter((p) => p.status === 'signed' && p.note !== '').length, 'pakiet projektu czeka na wykonawców');
  add('renoReputation', game.reno.complaints.filter((c) => c.status === 'open').length, 'reklamacja czeka na decyzję');
  add('renoStock', game.reno.equipment.filter((e) => e.conditionBps < 3_000).length, 'sprzęt wymaga konserwacji');
  add('hrRecruitment', game.ops.candidates.filter((c) => c.status === 'new' || c.status === 'countered').length, 'zgłoszenia kandydatów czekają na ofertę');
  add('hrEmployees', activeEmployments(game).filter((e) => { const p = personById(game, e.personId); return !!p && (p.morale < 35 || p.fatigue > 75); }).length, 'pracownik o niskim morale lub bardzo zmęczony');
  add('opsSubcontractors', game.ops.subcontracts.filter((c) => c.status === 'offered' || c.status === 'delivered').length, 'oferta lub praca podwykonawcy czeka na decyzję');
  add('opsVehicles', game.ops.vehicles.filter((v) => v.conditionBps < 3_000).length, 'pojazd mocno zużyty');
  if (game.businesses.some((b) => b.status === 'active')) {
    const f = liquidityForecast(game, 60);
    add('opsProfit', f.firstShortfall ? 1 : 0, 'prognoza płynności: zagrożenie brakiem środków');
  }
  add('bizFinance', overdueObligations(game).filter((o) => o.scope === 'business').length, 'zaległe zobowiązania firmy');
  // v0.8: spółki z o.o. — uchwały do głosowania, oferty wspólników, spółki bez uruchomionej działalności, zaległości spółek
  const myId = game.person.id;
  add('corpResolutions', game.corp.resolutions.filter((r) => r.status === 'scheduled' && r.voters.some((v) => v.holderId === myId) && !r.votes.some((v) => v.holderId === myId)).length, 'zgromadzenie czeka na Twój głos');
  add('corpInvestors', game.corp.negotiations.filter((n) => n.kind !== 'found' && (n.status === 'countered' || n.status === 'agreed')).length, 'oferta lub uzgodnienie czeka na decyzję');
  add('corpCompanies', game.corp.companies.filter((c) => c.status === 'registered' && !c.operation).length, 'zarejestrowana spółka bez uruchomionej działalności');
  add('corpFinance', game.obligations.filter((o) => o.scope === 'company' && o.status === 'open' && o.overdueSince !== null).length, 'zaległe zobowiązania spółki');
  const seen = visited.bizAccounting ?? game.clock.startDate;
  add('bizAccounting', game.events.filter((e) => e.type === 'accounting.notice' && e.date > seen).length, 'nowe powiadomienia biura rachunkowego');
  return out;
}
