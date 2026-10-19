import { appointMember, chargeCourtChange, endMember, activeBoard, isBoardMember } from './company.ts';
import { CORP } from './corpConfig.ts';
import { distributable, refreshValuation } from './companyFinance.ts';
import { CommandError, createObligation, ensureParty, logEvent, nextCounter, postTransaction } from './core.ts';
import { declareDividend, validateAllocation } from './dividends.ts';
import { addDays, formatDatePL } from './date.ts';
import type { IsoDate } from './date.ts';
import { formatPLN, mulBps } from './money.ts';
import { adjustTrust, holderName, partnerById } from './partners.ts';
import { createRng } from './rng.ts';
import { activeHoldings, companyOf, grantIssuedShares, holdingOf, soleHolder, votesOfHolding } from './shares.ts';
import type { Company, GameState, Partner, Resolution, ResolutionPayload } from './state.ts';

/**
 * Uchwały wspólników (v0.8). Progi z KSH — nie ma jednej „większości 50%” dla wszystkich spraw:
 *  • bezwzględna większość głosów (art. 245): powołanie/odwołanie zarządu, zatwierdzenie sprawozdania, podział zysku, zgoda na nabycie (art. 229);
 *  • 2/3 głosów (art. 246 § 1): zmiana umowy spółki (reprezentacja, podwyższenie kapitału — art. 255);
 *  • 3/4 głosów: istotna zmiana przedmiotu działalności (niedostępna w grze, ale próg jest zapisany).
 * Na udział przypada 1 głos (art. 242), zgromadzenie jest ważne bez względu na kworum (art. 241). Przegrana uchwała nie wykonuje decyzji.
 */

export type ThresholdKind = Resolution['threshold']['kind'];

export function thresholdFor(p: ResolutionPayload): Resolution['threshold'] {
  switch (p.type) {
    case 'capital_increase': return { kind: 'two_thirds', ruleId: 'CO-KSH-VOTING (art. 246 § 1, art. 255 KSH — zmiana umowy: 2/3 głosów)' };
    case 'change_representation': return { kind: 'two_thirds', ruleId: 'CO-KSH-VOTING (art. 246 § 1 KSH — zmiana umowy: 2/3 głosów)' };
    default: return { kind: 'absolute', ruleId: 'CO-KSH-VOTING (art. 245 KSH — bezwzględna większość głosów)' };
  }
}

export const THRESHOLD_LABEL: Record<ThresholdKind, string> = {
  absolute: 'bezwzględna większość (> ½ głosów oddanych)', two_thirds: '2/3 głosów', three_quarters: '3/4 głosów', unanimous: 'jednomyślność',
};

/** Czy uchwała przechodzi: wstrzymanie się liczy się jako głos oddany (SIMPLIFIED, CO-KSH-VOTING). */
export function passes(kind: ThresholdKind, v: { for: number; against: number; abstain: number }, eligibleVotes: number): { ok: boolean; needed: number; cast: number } {
  const cast = v.for + v.against + v.abstain;
  switch (kind) {
    case 'absolute': return { ok: cast > 0 && v.for * 2 > cast, needed: Math.floor(cast / 2) + 1, cast };
    case 'two_thirds': return { ok: cast > 0 && v.for * 3 >= cast * 2, needed: Math.ceil((cast * 2) / 3), cast };
    case 'three_quarters': return { ok: cast > 0 && v.for * 4 >= cast * 3, needed: Math.ceil((cast * 3) / 4), cast };
    case 'unanimous': return { ok: cast === eligibleVotes && v.for === cast, needed: eligibleVotes, cast };
  }
}

const log = (r: Resolution, date: IsoDate, text: string) => { r.history.push({ date, text: text.slice(0, 240) }); };

/* ---------- Walidacja i zgłoszenie ---------- */

function validatePayload(s: GameState, c: Company, p: ResolutionPayload, assemblyOn: IsoDate): void {
  switch (p.type) {
    case 'appoint_board': {
      if (isBoardMember(c, p.personId)) throw new CommandError('Ta osoba jest już członkiem zarządu.');
      if (p.personId !== s.person.id && !partnerById(s, p.personId)) throw new CommandError('Nieznany kandydat.');
      if (activeBoard(c).length >= CORP.maxBoard) throw new CommandError(`Zarząd może mieć najwyżej ${CORP.maxBoard} członków.`);
      return;
    }
    case 'dismiss_board': {
      const m = c.board.find((x) => x.id === p.memberId && x.endedOn === null);
      if (!m) throw new CommandError('Nie ma takiego członka zarządu.');
      if (activeBoard(c).length <= 1) throw new CommandError('Nie można odwołać jedynego członka zarządu — najpierw powołaj następcę.');
      return;
    }
    case 'approve_statements': {
      if (!c.yearResults.some((y) => y.year === p.year)) throw new CommandError(`Rok obrotowy ${p.year} nie został jeszcze zamknięty (zamknięcie 31 grudnia).`);
      if (c.statementsApproved.includes(p.year)) throw new CommandError(`Sprawozdanie za ${p.year} jest już zatwierdzone.`);
      return;
    }
    case 'allocate_profit': {
      if (p.dividendDay !== assemblyOn) throw new CommandError('Dzień dywidendy to dzień podjęcia uchwały (art. 193 § 3 KSH).');
      if (p.payDay < assemblyOn) throw new CommandError('Termin wypłaty nie może poprzedzać dnia dywidendy.');
      if (p.payDay > addDays(assemblyOn, 60)) throw new CommandError('Termin wypłaty: najpóźniej 60 dni po uchwale (założenie symulacji).');
      const err = validateAllocation(s, c, p);
      if (err) throw new CommandError(err);
      return;
    }
    case 'capital_increase': {
      const n = s.corp.negotiations.find((x) => x.id === p.negotiationId);
      if (!n || n.kind !== 'subscribe' || n.companyId !== c.id || n.status !== 'agreed') throw new CommandError('Emisja wymaga uzgodnionej negocjacji z inwestorem.');
      if (n.partnerId !== p.subscriberId || n.terms.shares !== p.shares) throw new CommandError('Warunki emisji nie zgadzają się z negocjacją.');
      if (c.pendingIncrease) throw new CommandError('Trwa już podwyższenie kapitału oczekujące na wpis do KRS.');
      if (p.issuePriceEach < c.nominal) throw new CommandError('Udziały nie mogą być obejmowane poniżej wartości nominalnej (art. 154 § 3 KSH).');
      if (s.corp.resolutions.some((r) => r.companyId === c.id && r.status === 'scheduled' && r.payload.type === 'capital_increase')) throw new CommandError('Uchwała o podwyższeniu kapitału już czeka na zgromadzenie.');
      return;
    }
    case 'change_representation': {
      if (p.mode === c.representation) throw new CommandError('To już obowiązujący sposób reprezentacji.');
      return;
    }
    case 'consent_acquisition': {
      if (p.maxAmount <= 0) throw new CommandError('Podaj kwotę zgody.');
      if (p.validUntil < assemblyOn) throw new CommandError('Termin ważności zgody jest wcześniejszy niż zgromadzenie.');
      return;
    }
  }
}

export function proposeResolution(s: GameState, input: { companyId: string; payload: ResolutionPayload; title?: string }): string {
  const c = companyOf(s, input.companyId);
  if (c.status !== 'registered') throw new CommandError('Uchwały podejmuje zarejestrowana spółka.');
  const playerId = s.person.id;
  const mine = holdingOf(s, c.id, playerId);
  const capitalBps = mine ? Math.round((mine.count * 10_000) / Math.max(1, c.shareCount)) : 0;
  if (!isBoardMember(c, playerId) && capitalBps < 1_000) {
    throw new CommandError('Zgromadzenie zwołuje zarząd; wspólnik może tego żądać dopiero z co najmniej 10% kapitału (art. 235–236 KSH).');
  }
  return scheduleResolution(s, c, input.payload, playerId, input.title);
}

/** Zwołanie zgromadzenia i zapisanie uchwały (dla gracza i dla postaci AI, które zgłaszają własne propozycje). */
export function scheduleResolution(s: GameState, c: Company, payload: ResolutionPayload, proposedBy: string, title?: string): string {
  const playerId = s.person.id;
  const mine = holdingOf(s, c.id, playerId);
  const sole = soleHolder(s, c.id);
  const today = s.clock.today;
  const assemblyOn = sole ? today : addDays(today, CORP.assemblyNoticeDays);
  validatePayload(s, c, payload, assemblyOn);
  const dupe = s.corp.resolutions.find((r) => r.companyId === c.id && r.status === 'scheduled' && JSON.stringify(r.payload) === JSON.stringify(payload));
  if (dupe) throw new CommandError('Taka uchwała już czeka na zgromadzenie.');
  const holdings = activeHoldings(s, c.id);
  const r: Resolution = {
    id: `res:${nextCounter(s, 'resolution')}`, companyId: c.id, title: (title ?? titleOf(s, c, payload)).slice(0, 160), payload, proposedOn: today, proposedBy,
    assemblyOn, threshold: thresholdFor(payload), voters: holdings.map((h) => ({ holderId: h.holderId, votes: votesOfHolding(h), excluded: null })), votes: [],
    status: 'scheduled', tally: null, decidedOn: null, executedOn: null, outcome: '', history: [],
  };
  s.corp.resolutions.push(r);
  log(r, today, sole ? 'Jedyny wspólnik podejmuje uchwałę sam (art. 156 KSH).' : `Zwołano zgromadzenie wspólników na ${formatDatePL(assemblyOn)} (zawiadomienie co najmniej 2 tygodnie wcześniej — art. 238 KSH).`);
  if (proposedBy !== playerId) {
    const pv = holdings.find((h) => h.holderId === proposedBy);
    if (pv) r.votes.push({ holderId: proposedBy, vote: 'for', votes: votesOfHolding(pv), castOn: today });
    logEvent(s, { id: `corp.resolution:${r.id}:proposed`, date: today, type: 'corp.resolution', tone: 'warning', title: `${holderName(s, proposedBy)} zwołuje zgromadzenie: ${r.title}`, detail: `${c.name} sp. z o.o. · zgromadzenie ${formatDatePL(assemblyOn)} · oddaj głos w „Uchwały” (bez głosu — wstrzymujący się)`, amount: null, category: null });
    return `Zwołano zgromadzenie na ${formatDatePL(assemblyOn)}.`;
  }
  if (mine && mine.count > 0) r.votes.push({ holderId: playerId, vote: 'for', votes: votesOfHolding(mine), castOn: today });
  if (assemblyOn <= today) {
    decide(s, r, today);
    return `Uchwała ${r.status === 'executed' ? 'podjęta i wykonana' : r.status === 'rejected' ? 'odrzucona' : r.status === 'failed' ? 'podjęta, ale nie dała się wykonać' : 'podjęta'}: ${r.outcome}`;
  }
  return `Zgromadzenie wspólników zwołane na ${formatDatePL(assemblyOn)}. Twój głos „za” został zapisany; pozostali wspólnicy zagłosują w dniu zgromadzenia.`;
}

function titleOf(s: GameState, c: Company, p: ResolutionPayload): string {
  switch (p.type) {
    case 'appoint_board': return `Powołanie do zarządu: ${holderName(s, p.personId)}`;
    case 'dismiss_board': return `Odwołanie z zarządu: ${holderName(s, c.board.find((m) => m.id === p.memberId)?.personId ?? '')}`;
    case 'approve_statements': return `Zatwierdzenie sprawozdania finansowego za ${p.year}`;
    case 'allocate_profit': return `Podział zysku za ${p.year}: dywidenda ${formatPLN(p.dividendGross, { round: true })}${p.toReserve > 0 ? `, kapitał zapasowy ${formatPLN(p.toReserve, { round: true })}` : ''}`;
    case 'capital_increase': return `Podwyższenie kapitału: ${p.shares} nowych udz. dla ${holderName(s, p.subscriberId)}`;
    case 'change_representation': return `Zmiana sposobu reprezentacji spółki`;
    case 'consent_acquisition': return `Zgoda na nabycie środków trwałych do ${formatPLN(p.maxAmount, { round: true })}`;
  }
}

export function castVote(s: GameState, resolutionId: string, vote: 'for' | 'against' | 'abstain'): string {
  const r = s.corp.resolutions.find((x) => x.id === resolutionId);
  if (!r) throw new CommandError('Nie ma takiej uchwały.');
  if (r.status !== 'scheduled') throw new CommandError('Głosowanie nad tą uchwałą się zakończyło.');
  if (s.clock.today >= r.assemblyOn) throw new CommandError('Zgromadzenie odbywa się dziś — głosy należało oddać wcześniej.');
  const voter = r.voters.find((v) => v.holderId === s.person.id);
  if (!voter) throw new CommandError('Nie jesteś wspólnikiem uprawnionym do głosowania.');
  if (voter.excluded) throw new CommandError(`Nie możesz głosować: ${voter.excluded}`);
  r.votes = r.votes.filter((v) => v.holderId !== s.person.id);
  r.votes.push({ holderId: s.person.id, vote, votes: voter.votes, castOn: s.clock.today });
  return `Głos zapisany: ${vote === 'for' ? 'za' : vote === 'against' ? 'przeciw' : 'wstrzymujący się'}.`;
}

export function cancelResolution(s: GameState, resolutionId: string): string {
  const r = s.corp.resolutions.find((x) => x.id === resolutionId);
  if (!r || r.status !== 'scheduled') throw new CommandError('Można odwołać tylko uchwałę czekającą na zgromadzenie.');
  if (r.proposedBy !== s.person.id) throw new CommandError('Zgromadzenie może odwołać zwołujący.');
  r.status = 'cancelled';
  r.outcome = 'Zgromadzenie odwołane przez zwołującego.';
  return r.outcome;
}

/* ---------- Głosowanie postaci AI ---------- */

interface VoteDecision { vote: 'for' | 'against' | 'abstain'; reason: string }

const verdict = (u: number, forAbove = 5, againstBelow = -10): 'for' | 'against' | 'abstain' => (u >= forAbove ? 'for' : u <= againstBelow ? 'against' : 'abstain');

export function partnerVote(s: GameState, p: Partner, c: Company, r: Resolution): VoteDecision {
  const noise = createRng(s.seed, `vote:${r.id}:${p.id}`).int(-6, 6);
  const pl = r.payload;
  const bal = c.valuation;
  let u = 0;
  let reason = '';
  switch (pl.type) {
    case 'appoint_board': {
      if (pl.personId === p.id) { u = 100; reason = 'to jego własna kandydatura'; break; }
      if (pl.personId === s.person.id) { u = (p.trust - 50) + 6; reason = p.trust >= 50 ? `ufa Tobie (${p.trust}/100)` : `zaufanie do Ciebie jest niskie (${p.trust}/100)`; break; }
      const cand = partnerById(s, pl.personId);
      u = (cand?.competence ?? 40) - 45; reason = `kompetencje kandydata: ${cand?.competence ?? '?'}/100`;
      break;
    }
    case 'dismiss_board': {
      const m = c.board.find((x) => x.id === pl.memberId);
      if (m?.personId === p.id) { u = -100; reason = 'odwołanie dotyczy jego samego'; break; }
      if (m?.personId === s.person.id) { u = (50 - p.trust) - 10; reason = p.trust >= 50 ? `ufa Tobie (${p.trust}/100), więc nie widzi powodu odwołania` : `zaufanie do Ciebie jest niskie (${p.trust}/100)`; break; }
      const other = partnerById(s, m?.personId ?? '');
      u = 40 - (other?.competence ?? 40); reason = `kompetencje odwoływanego: ${other?.competence ?? '?'}/100`;
      break;
    }
    case 'approve_statements': {
      const y = c.yearResults.find((x) => x.year === pl.year);
      const profit = y?.netProfit ?? 0;
      u = profit >= 0 ? 15 + Math.round((p.trust - 50) / 2) : Math.round((p.trust - 55) / 1.5) - 5;
      reason = profit >= 0 ? `spółka wypracowała zysk ${formatPLN(profit, { round: true })}` : `spółka poniosła stratę ${formatPLN(-profit, { round: true })}`;
      break;
    }
    case 'allocate_profit': {
      const d = distributable(s, c, pl.payDay);
      const retained = Math.max(1, d.retained);
      const f = Math.min(1, pl.dividendGross / retained);
      const want = p.dividendPreference / 100;
      u = Math.round((1 - Math.abs(f - want)) * 60) - 25 + (p.goal === 'income' && f >= 0.3 ? 15 : 0) - (p.goal === 'growth' && f > 0.6 ? 20 : 0);
      reason = `proponowana wypłata to ${(f * 100).toFixed(0)}% zysku do podziału, a on woli ok. ${(want * 100).toFixed(0)}% (cel: ${p.goal === 'income' ? 'dochód' : p.goal === 'growth' ? 'rozwój' : 'wyjście'})`;
      break;
    }
    case 'capital_increase': {
      if (pl.subscriberId === p.id) { u = 100; reason = 'obejmuje udziały sam'; break; }
      const S = c.shareCount;
      const dilBps = Math.round((pl.shares * 10_000) / (S + pl.shares));
      const fair = bal && S > 0 ? Math.round(bal.estimate / S) : c.nominal;
      const premium = fair > 0 ? Math.max(-60, Math.min(60, Math.round(((pl.issuePriceEach - fair) * 100) / fair))) : 0;
      u = Math.round(premium * 0.6) - Math.round(dilBps / 150) + (p.goal === 'growth' ? 12 : 0) + Math.round((p.riskTolerance - 50) / 5) - (p.dividendPreference > 70 ? 8 : 0);
      reason = `cena emisyjna ${formatPLN(pl.issuePriceEach, { round: true })}/udz. vs jego wycena ${formatPLN(fair, { round: true })}, rozwodnienie ${(dilBps / 100).toFixed(1)}%`;
      break;
    }
    case 'change_representation': {
      const inBoard = isBoardMember(c, p.id);
      const stricter = ['each_alone', 'joint_two', 'all_jointly'].indexOf(pl.mode) > ['each_alone', 'joint_two', 'all_jointly'].indexOf(c.representation);
      u = inBoard ? (stricter ? -20 : 15) : (stricter ? 18 : -8);
      reason = inBoard ? 'jako członek zarządu woli swobodę działania' : 'jako wspólnik spoza zarządu chce większej kontroli';
      break;
    }
    case 'consent_acquisition': {
      u = (p.riskTolerance - 35) + (p.trust >= 35 ? 5 : -15);
      reason = `jego tolerancja ryzyka ${p.riskTolerance}/100, zaufanie ${p.trust}/100`;
      break;
    }
  }
  const vote = verdict(u + noise);
  return { vote, reason };
}

/* ---------- Dzień zgromadzenia ---------- */

export function processResolutionsDay(s: GameState, date: IsoDate): void {
  for (const r of s.corp.resolutions) if (r.status === 'scheduled' && r.assemblyOn <= date) decide(s, r, date);
}

function decide(s: GameState, r: Resolution, date: IsoDate): void {
  const c = companyOf(s, r.companyId);
  for (const v of r.voters) {
    if (v.excluded || r.votes.some((x) => x.holderId === v.holderId)) continue;
    if (v.holderId === s.person.id) { r.votes.push({ holderId: v.holderId, vote: 'abstain', votes: v.votes, castOn: date }); log(r, date, 'Nie oddałeś głosu — wstrzymujący się.'); continue; }
    const p = partnerById(s, v.holderId);
    if (!p) continue;
    const d = partnerVote(s, p, c, r);
    r.votes.push({ holderId: v.holderId, vote: d.vote, votes: v.votes, castOn: date });
    log(r, date, `${holderName(s, p.id)}: ${d.vote === 'for' ? 'za' : d.vote === 'against' ? 'przeciw' : 'wstrzymał się'} — ${d.reason}.`);
  }
  const sum = { for: 0, against: 0, abstain: 0 };
  for (const v of r.votes) sum[v.vote] += v.votes;
  const eligible = r.voters.filter((v) => !v.excluded).reduce((a, v) => a + v.votes, 0);
  const res = passes(r.threshold.kind, sum, eligible);
  r.tally = { ...sum, cast: res.cast, needed: res.needed };
  r.decidedOn = date;
  r.status = res.ok ? 'passed' : 'rejected';
  r.outcome = res.ok ? `Przyjęta: ${sum.for} za, ${sum.against} przeciw, ${sum.abstain} wstrzymujących się (próg: ${THRESHOLD_LABEL[r.threshold.kind]}).` : `Odrzucona: ${sum.for} za, ${sum.against} przeciw, ${sum.abstain} wstrzymujących się (potrzeba ${res.needed} głosów „za”; próg: ${THRESHOLD_LABEL[r.threshold.kind]}).`;
  logEvent(s, {
    id: `corp.resolution:${r.id}:decided`, date, type: 'corp.resolution', tone: res.ok ? 'positive' : 'negative',
    title: `Uchwała ${res.ok ? 'przyjęta' : 'odrzucona'}: ${r.title} (${c.name} sp. z o.o.)`, detail: r.outcome.slice(0, 290), amount: null, category: null,
  });
  // wpływ na zaufanie: decyzja sprzeczna z głosem postaci obniża zaufanie, zgodna z jej interesem — podnosi
  for (const v of r.votes) {
    if (v.holderId === s.person.id || r.proposedBy !== s.person.id) continue;
    if (res.ok && v.vote === 'against') adjustTrust(s, v.holderId, -2, `Uchwała „${r.title}” przeszła wbrew jego głosowi`);
    else if (!res.ok && v.vote === 'for') adjustTrust(s, v.holderId, -1, `Uchwała „${r.title}”, za którą głosował, została odrzucona`);
    else if (res.ok && v.vote === 'for') adjustTrust(s, v.holderId, 1, `Uchwała „${r.title}” przeszła zgodnie z jego głosem`);
  }
  if (res.ok) execute(s, c, r, date);
}

function execute(s: GameState, c: Company, r: Resolution, date: IsoDate): void {
  try {
    const msg = apply(s, c, r, date);
    r.status = 'executed';
    r.executedOn = date;
    r.outcome = `${r.outcome} Wykonanie: ${msg}`.slice(0, 400);
  } catch (e) {
    if (!(e instanceof CommandError)) throw e;
    r.status = 'failed';
    r.outcome = `${r.outcome} Nie wykonano: ${e.message}`.slice(0, 400);
    logEvent(s, { id: `corp.resolution:${r.id}:failed`, date, type: 'corp.resolution', tone: 'warning', title: `Uchwała podjęta, ale niewykonalna: ${r.title}`, detail: e.message.slice(0, 290), amount: null, category: null });
  }
}

function apply(s: GameState, c: Company, r: Resolution, date: IsoDate): string {
  const p = r.payload;
  switch (p.type) {
    case 'appoint_board': {
      if (p.personId !== s.person.id) {
        const cand = partnerById(s, p.personId);
        if (!cand || cand.trust < 35 || cand.competence < 30) throw new CommandError('Kandydat nie wyraził zgody na powołanie (art. 19a ust. 5 ustawy o KRS wymaga jego oświadczenia).');
      }
      const m = appointMember(s, c, p.personId, p.role, r.id, date);
      chargeCourtChange(s, c, date, `powołanie członka zarządu (${m.id})`);
      logEvent(s, { id: `corp.board:${m.id}:start`, date, type: 'corp.board', tone: 'positive', title: `Powołano do zarządu: ${holderName(s, p.personId)} (${c.name} sp. z o.o.)`, detail: 'Funkcja zarządcza jest niezależna od udziałów i od umowy o pracę (bez wynagrodzenia w grze).', amount: null, category: null });
      return `${holderName(s, p.personId)} jest członkiem zarządu.`;
    }
    case 'dismiss_board': {
      const m = endMember(s, c, p.memberId, 'dismissed', date);
      return `${holderName(s, m.personId)} odwołany z zarządu.`;
    }
    case 'approve_statements': {
      c.statementsApproved.push(p.year);
      return `sprawozdanie za ${p.year} zatwierdzone.`;
    }
    case 'allocate_profit': return declareDividend(s, c, r, date);
    case 'capital_increase': return startIncrease(s, c, r, date);
    case 'change_representation': {
      c.representation = p.mode;
      chargeCourtChange(s, c, date, 'zmiana sposobu reprezentacji', CORP.courtFeeChange);
      return 'zmieniono sposób reprezentacji (wpis w KRS — opłata naliczona).';
    }
    case 'consent_acquisition': return `zgoda na nabycie do ${formatPLN(p.maxAmount, { round: true })} ważna do ${formatDatePL(p.validUntil)}.`;
  }
}

/* ---------- Podwyższenie kapitału ---------- */

function startIncrease(s: GameState, c: Company, r: Resolution, date: IsoDate): string {
  if (r.payload.type !== 'capital_increase') throw new Error('Nieprawidłowa uchwała');
  const p = r.payload;
  const n = s.corp.negotiations.find((x) => x.id === p.negotiationId)!;
  const contribution = p.shares * p.issuePriceEach;
  const nominalTotal = p.shares * c.nominal;
  if (c.pendingIncrease) throw new CommandError('Trwa już podwyższenie kapitału oczekujące na wpis.');
  const sub = partnerById(s, p.subscriberId);
  if (p.subscriberId === s.person.id) {
    if (s.accounts[s.playerAccountId]!.balance < contribution) throw new CommandError('Za mało środków na rachunku osobistym na pokrycie objętych udziałów.');
    const tid = `capital:${c.id}:${nextCounter(s, 'capital')}`;
    postTransaction(s, { eventId: `${tid}:out`, accountId: s.playerAccountId, date, amount: -contribution, category: 'wklad_kapitalowy', description: `Wpłata na podwyższenie kapitału ${c.name} sp. z o.o. (${p.shares} udz.)`, counterpartyId: c.partyId, obligationId: null, transferId: tid });
    postTransaction(s, { eventId: `${tid}:in`, accountId: c.accountId, date, amount: contribution, category: 'wklad_kapitalowy', description: `Wpłata subskrybenta na podwyższenie kapitału (do wpisu w KRS)`, counterpartyId: null, obligationId: null, transferId: tid });
  } else {
    if (!sub || sub.capital < contribution) throw new CommandError('Subskrybent nie ma już środków na pokrycie wkładu.');
    ensureParty(s, { id: `party:${sub.id}`, name: holderName(s, sub.id), role: 'service' });
    postTransaction(s, { eventId: `inc:${r.id}:in`, accountId: c.accountId, date, amount: contribution, category: 'wplaty_podwyzszenie', description: `Wkład ${holderName(s, sub.id)} na podwyższenie kapitału (do wpisu w KRS)`, counterpartyId: `party:${sub.id}`, obligationId: null });
    sub.capital -= contribution;
  }
  const delay = createRng(s.seed, `krs:inc:${r.id}`).int(CORP.krsChangeDaysMin, CORP.krsChangeDaysMax);
  c.pendingIncrease = { resolutionId: r.id, subscriberId: p.subscriberId, shares: p.shares, contribution, nominalTotal, filedOn: date, decisionOn: addDays(date, delay), negotiationId: n.id };
  n.resolutionId = r.id;
  // koszty: opłata sądowa za zmianę wpisu (wzorzec uchwały z systemu — 200 zł, art. 55 ust. 2 u.k.s.c.) i PCC 0,5% od kwoty podwyższenia (płaci spółka)
  chargeCourtChange(s, c, date, 'podwyższenie kapitału zakładowego', CORP.courtFeeChangeTemplate);
  const pcc = mulBps(Math.max(0, nominalTotal - CORP.courtFeeChangeTemplate), CORP.pccCompanyBps);
  if (pcc > 0) {
    ensureParty(s, { id: 'party:us', name: 'Urząd Skarbowy', role: 'service' });
    createObligation(s, {
      occurrenceId: `pcc:${c.id}:${r.id}`, ruleId: 'rule:pcc-company', direction: 'payable', counterpartyId: 'party:us', accountId: c.accountId, scope: 'company', amount: pcc,
      issueDate: date, dueDate: addDays(date, CORP.pccDueDays), category: 'pcc', description: `PCC 0,5% od podwyższenia kapitału ${c.name} sp. z o.o. (podstawa: wartość nominalna nowych udziałów − opłata sądowa)`,
    });
  }
  refreshValuation(s, c, date);
  return `wkład ${formatPLN(contribution, { round: true })} wpłacony do spółki; wniosek o wpis podwyższenia (${p.shares} udz.) złożony — skuteczne dopiero z wpisem do KRS (do ${formatDatePL(c.pendingIncrease.decisionOn)}).`;
}

/** Wpis podwyższenia kapitału do KRS: nowe udziały powstają dopiero teraz (art. 262 § 4 KSH). */
export function finalizeIncrease(s: GameState, c: Company, date: IsoDate): void {
  const inc = c.pendingIncrease;
  if (!inc) return;
  const { subscriberId, shares, contribution } = inc;
  grantIssuedShares(s, c, subscriberId, shares, contribution, date, inc.resolutionId);
  c.pendingIncrease = null;
  const n = inc.negotiationId ? s.corp.negotiations.find((x) => x.id === inc.negotiationId) : undefined;
  if (n) {
    n.status = 'completed';
    if (n.terms.role !== 'none' && !isBoardMember(c, subscriberId) && activeBoard(c).length < CORP.maxBoard) {
      appointMember(s, c, subscriberId, n.terms.role === 'president' ? 'president' : 'member', inc.resolutionId, date);
    }
  }
  const sub = partnerById(s, subscriberId);
  if (sub) sub.history.push({ date, note: `Objął ${shares} nowych udziałów ${c.name} sp. z o.o. za ${formatPLN(contribution, { round: true })}`, trustDelta: 0 });
  refreshValuation(s, c, date);
  logEvent(s, {
    id: `corp.shares:${c.id}:increase:${inc.resolutionId}`, date, type: 'corp.shares', tone: 'positive',
    title: `Podwyższenie kapitału zarejestrowane: ${c.name} sp. z o.o. — nowy kapitał ${formatPLN(c.capital, { round: true })}`,
    detail: `${holderName(s, subscriberId)} objął ${shares} udz. za ${formatPLN(contribution, { round: true })} (nominał ${formatPLN(inc.nominalTotal, { round: true })}, nadwyżka ${formatPLN(contribution - inc.nominalTotal, { round: true })} → kapitał zapasowy). Pieniądze trafiły do spółki.`.slice(0, 290), amount: null, category: null,
  });
}

