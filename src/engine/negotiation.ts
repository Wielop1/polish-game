import { CORP } from './corpConfig.ts';
import { refreshValuation, roundToZl } from './companyFinance.ts';
import { CommandError, createObligation, ensureParty, logEvent, nextCounter, postTransaction } from './core.ts';
import { addDays, dateInMonth, parseIso } from './date.ts';
import type { IsoDate } from './date.ts';
import { formatPLN, mulBps, roundDiv } from './money.ts';
import type { Grosze } from './money.ts';
import { holderName, partnerById } from './partners.ts';
import { createRng } from './rng.ts';
import { companyOf, sharesOf, transferShares } from './shares.ts';
import type { Company, DealTerms, GameState, Negotiation, Partner } from './state.ts';

/**
 * Negocjacje ze wspólnikami i inwestorami (v0.8). Decyzje postaci AI wynikają z ich atrybutów (kapitał, tolerancja ryzyka, cel,
 * preferencja dywidend, horyzont, zaufanie) i sytuacji spółki — bez losowych konfliktów i bez modeli językowych.
 * Rozróżnienie: `subscribe` (objęcie nowych udziałów — pieniądze trafiają do SPÓŁKI) vs `secondary_*` (zakup istniejących udziałów — zapłata trafia do SPRZEDAJĄCEGO).
 */

export interface Evaluation { outcome: 'accept' | 'counter' | 'decline'; terms: DealTerms; reason: string }

export const emptyTerms = (): DealTerms => ({ shares: 0, amount: 0, percentBps: 0, role: 'none', dividendPolicy: 'none' });

const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

/** Liczba nowych udziałów dająca udział `percentBps` po emisji (N/(S+N) ≈ p) oraz faktyczne warunki emisji (cena emisyjna w pełnych groszach). */
export function subscriptionTerms(c: Company, amount: Grosze, targetPercentBps: number, role: DealTerms['role'] = 'none', dividendPolicy: DealTerms['dividendPolicy'] = 'none'): DealTerms {
  const S = c.shareCount;
  const p = Math.min(9_000, Math.max(100, targetPercentBps));
  const n = Math.max(1, roundDiv(S * p, 10_000 - p));
  const issueEach = Math.floor(amount / n);
  const exact = issueEach * n;
  return { shares: n, amount: exact, percentBps: roundDiv(n * 10_000, S + n), role, dividendPolicy };
}

export const issuePriceEach = (t: DealTerms): Grosze => (t.shares > 0 ? Math.floor(t.amount / t.shares) : 0);

/* ---------- Ocena wspólnika zakładającego spółkę ---------- */

function evaluateFounding(c: Company, p: Partner, t: DealTerms): Evaluation {
  const nominal = c.nominal;
  const maxExp = 1_500 + p.riskTolerance * 35;
  if (p.kind !== 'partner') return { outcome: 'decline', terms: t, reason: 'Inwestorzy nie wchodzą do spółek w organizacji — zaproś wspólnika albo wróć do inwestora po kilku miesiącach działalności.' };
  if (p.trust < 30) return { outcome: 'decline', terms: t, reason: `Zaufanie do Ciebie jest zbyt niskie (${p.trust}/100), żeby wspólnie zakładać spółkę.` };
  if (t.shares < 1 || t.shares >= c.shareCount) return { outcome: 'decline', terms: t, reason: 'Nieprawidłowa liczba udziałów (Ty musisz zachować co najmniej 1 udział).' };
  const contribution = t.shares * nominal;
  const exposure = Math.round((contribution * 10_000) / Math.max(1, p.capital));
  if (contribution > p.capital) return { outcome: 'decline', terms: t, reason: `Wkład ${formatPLN(contribution, { round: true })} przekracza dostępny kapitał tej osoby.` };
  if (exposure > Math.round(maxExp * 1.5)) return { outcome: 'decline', terms: t, reason: `Wkład to ${pct(exposure)} jej oszczędności — przy jej tolerancji ryzyka (${p.riskTolerance}/100) to za dużo.` };
  const adj = { ...t };
  const notes: string[] = [];
  if (exposure > maxExp) {
    adj.shares = Math.max(1, Math.floor((maxExp * p.capital) / 10_000 / nominal));
    notes.push(`proponuje mniejszy wkład (${adj.shares} udz.) — ${pct(exposure)} jej oszczędności to więcej, niż akceptuje`);
  }
  const share = Math.round((adj.shares * 10_000) / c.shareCount);
  const wantsBoard = (p.competence >= 55 && share >= 2_000) || (p.goal === 'growth' && share >= 3_000);
  if (wantsBoard && adj.role === 'none') { adj.role = 'board_member'; notes.push('chce mieć miejsce w zarządzie (kompetencje i znaczący udział)'); }
  const wantPolicy: DealTerms['dividendPolicy'] = p.dividendPreference >= 60 ? 'distribute' : p.dividendPreference <= 35 ? 'reinvest' : adj.dividendPolicy;
  if (adj.dividendPolicy !== wantPolicy && wantPolicy !== 'none') { adj.dividendPolicy = wantPolicy; notes.push(wantPolicy === 'distribute' ? 'oczekuje regularnych dywidend' : 'woli reinwestować zysk'); }
  adj.amount = adj.shares * nominal;
  adj.percentBps = Math.round((adj.shares * 10_000) / c.shareCount);
  if (notes.length === 0) return { outcome: 'accept', terms: adj, reason: 'Warunki odpowiadają jej interesom — zgoda na wejście do spółki.' };
  return { outcome: 'counter', terms: adj, reason: `Kontroferta: ${notes.join('; ')}.` };
}

/* ---------- Ocena inwestora (nowe udziały) ---------- */

/** Własna wycena inwestora (jego analiza z niewielkim, ale stałym odchyleniem od modelu gry). */
function investorView(s: GameState, c: Company, p: Partner): number {
  const base = c.valuation?.estimate ?? 0;
  const rng = createRng(s.seed, `dd:${p.id}:${c.id}`);
  const noise = rng.int(-1_500, 1_500);
  return Math.max(0, mulBps(base, 10_000 + noise));
}

function evaluateSubscribe(s: GameState, c: Company, p: Partner, t: DealTerms): Evaluation {
  if (p.kind !== 'investor') return { outcome: 'decline', terms: t, reason: 'Ta osoba nie jest inwestorem kapitałowym — emisję dla wspólnika załatwiasz zakupem udziałów albo wybierz inwestora.' };
  if (c.status !== 'registered' || !c.operation) return { outcome: 'decline', terms: t, reason: 'Inwestor wchodzi tylko do zarejestrowanej spółki z uruchomioną działalnością.' };
  const history = c.monthly.length;
  const minMonths = p.riskTolerance >= 70 ? 3 : p.riskTolerance >= 50 ? 6 : 9;
  if (history < minMonths) return { outcome: 'decline', terms: t, reason: `Chce zobaczyć co najmniej ${minMonths} miesięcy wyników (spółka ma ${history}).` };
  if (p.trust < 25) return { outcome: 'decline', terms: t, reason: `Zaufanie do Ciebie jest zbyt niskie (${p.trust}/100).` };
  const maxExp = 3_000 + p.riskTolerance * 50;
  if (t.amount > Math.round((p.capital * maxExp) / 10_000)) return { outcome: 'decline', terms: t, reason: `Kwota przekracza ${pct(maxExp)} jego kapitału — poza jego tolerancją ryzyka.` };
  const pre = investorView(s, c, p);
  const profitable = (c.valuation?.profit12 ?? 0) > 0;
  if (p.goal === 'income' && !profitable) return { outcome: 'decline', terms: t, reason: 'Szuka dochodu z dywidend, a spółka nie wypracowuje zysku.' };
  const fairPost = pre + t.amount;
  const fairPercent = fairPost > 0 ? Math.round((t.amount * 10_000) / fairPost) : 10_000;
  const premium = Math.round(((100 - p.riskTolerance) * 30 + (p.goal === 'exit' ? 500 : 0) + (profitable ? 0 : 600)) * 1);
  const required = Math.min(9_000, Math.round((fairPercent * (10_000 + premium)) / 10_000));
  const wantsBoard = p.competence >= 50 && required >= 2_500;
  const role: DealTerms['role'] = wantsBoard ? 'board_member' : 'none';
  const policy: DealTerms['dividendPolicy'] = p.dividendPreference >= 60 ? 'distribute' : p.dividendPreference <= 35 ? 'reinvest' : 'none';
  if (t.percentBps >= required) {
    if ((wantsBoard && t.role === 'none') || (policy !== 'none' && t.dividendPolicy !== policy)) {
      const adj = { ...t, role: wantsBoard ? role : t.role, dividendPolicy: policy !== 'none' ? policy : t.dividendPolicy };
      return { outcome: 'counter', terms: adj, reason: `Cena jest akceptowalna (jego wycena przed emisją: ok. ${formatPLN(pre, { round: true })}), ale ${wantsBoard && t.role === 'none' ? 'chce miejsca w zarządzie' : 'oczekuje innej polityki dywidendowej'}.` };
    }
    return { outcome: 'accept', terms: t, reason: `Akceptuje: ${pct(t.percentBps)} za ${formatPLN(t.amount, { round: true })} odpowiada jego wycenie spółki (ok. ${formatPLN(pre, { round: true })} przed emisją).` };
  }
  if (t.percentBps * 4 >= required * 3) {
    const adj = subscriptionTerms(c, t.amount, required, wantsBoard ? role : t.role, policy !== 'none' ? policy : t.dividendPolicy);
    return { outcome: 'counter', terms: adj, reason: `Przy jego wycenie spółki (ok. ${formatPLN(pre, { round: true })} przed emisją) za ${formatPLN(t.amount, { round: true })} oczekuje ok. ${pct(adj.percentBps)} udziałów.` };
  }
  return { outcome: 'decline', terms: t, reason: `Wycena jest dla niego zbyt wysoka: za ${formatPLN(t.amount, { round: true })} oczekiwałby co najmniej ${pct(required)} udziałów (oferta: ${pct(t.percentBps)}).` };
}

/* ---------- Transakcje na istniejących udziałach ---------- */

/** Wartość pakietu udziałów wg wyceny spółki i modelu postaci (minus dyskonto za mniejszościowy, niepłynny pakiet). */
function stakeValue(s: GameState, c: Company, shares: number, p: Partner, discountBps: number): Grosze {
  const est = investorView(s, c, p);
  const full = c.shareCount > 0 ? roundDiv(est * shares, c.shareCount) : 0;
  return mulBps(full, 10_000 - discountBps);
}

function evaluateSecondarySell(s: GameState, c: Company, p: Partner, t: DealTerms): Evaluation {
  if (p.kind !== 'investor' && p.kind !== 'partner') return { outcome: 'decline', terms: t, reason: 'Nieznany kupujący.' };
  if (sharesOf(s, c.id, s.person.id) < t.shares) return { outcome: 'decline', terms: t, reason: 'Nie masz tylu udziałów.' };
  if (p.trust < 25) return { outcome: 'decline', terms: t, reason: 'Zbyt niskie zaufanie do Ciebie.' };
  if (t.amount > p.capital) return { outcome: 'decline', terms: t, reason: `Kupujący nie dysponuje taką kwotą (kapitał: ${formatPLN(p.capital, { round: true })}).` };
  if ((c.valuation?.months ?? 0) < 3) return { outcome: 'decline', terms: t, reason: 'Spółka ma zbyt krótką historię, by wycenić pakiet.' };
  const disc = 1_000 + (100 - p.riskTolerance) * 15;
  const worth = stakeValue(s, c, t.shares, p, disc);
  if (t.amount <= worth) return { outcome: 'accept', terms: t, reason: `Akceptuje cenę — jego wycena pakietu: ok. ${formatPLN(worth, { round: true })} (z dyskontem ${pct(disc)} za mniejszościowy pakiet).` };
  if (t.amount <= mulBps(worth, 12_500)) return { outcome: 'counter', terms: { ...t, amount: worth }, reason: `Proponuje ${formatPLN(worth, { round: true })} — tyle wart jest dla niego pakiet po dyskoncie ${pct(disc)}.` };
  return { outcome: 'decline', terms: t, reason: `Cena znacznie przekracza jego wycenę pakietu (ok. ${formatPLN(worth, { round: true })}).` };
}

function evaluateSecondaryBuy(s: GameState, c: Company, p: Partner, t: DealTerms): Evaluation {
  if (sharesOf(s, c.id, p.id) < t.shares) return { outcome: 'decline', terms: t, reason: 'Ta osoba nie posiada tylu udziałów.' };
  const exitPremium = p.goal === 'exit' ? 200 : p.goal === 'income' ? 1_500 : 800;
  const reservation = mulBps(stakeValue(s, c, t.shares, p, 0), 10_000 + exitPremium);
  if (t.amount >= reservation) return { outcome: 'accept', terms: t, reason: `Zgoda na sprzedaż — cena nie jest niższa niż jego wycena pakietu (ok. ${formatPLN(reservation, { round: true })}).` };
  if (t.amount * 100 >= reservation * 85) return { outcome: 'counter', terms: { ...t, amount: reservation }, reason: `Sprzeda za ${formatPLN(reservation, { round: true })} (tyle wart jest dla niego pakiet, który daje dywidendy i udział w rozwoju).` };
  return { outcome: 'decline', terms: t, reason: `Cena jest za niska — jego wycena pakietu to ok. ${formatPLN(reservation, { round: true })}.` };
}

export function evaluateDeal(s: GameState, kind: Negotiation['kind'], c: Company, p: Partner, t: DealTerms): Evaluation {
  switch (kind) {
    case 'found': return evaluateFounding(c, p, t);
    case 'subscribe': return evaluateSubscribe(s, c, p, t);
    case 'secondary_sell': return evaluateSecondarySell(s, c, p, t);
    case 'secondary_buy': return evaluateSecondaryBuy(s, c, p, t);
  }
}

/* ---------- Komendy ---------- */

function applyEvaluation(s: GameState, n: Negotiation, ev: Evaluation, by: 'partner'): void {
  n.reason = ev.reason.slice(0, 300);
  if (ev.outcome === 'accept') { n.status = 'agreed'; n.terms = ev.terms; }
  else if (ev.outcome === 'counter') { n.status = 'countered'; n.terms = ev.terms; }
  else n.status = 'declined';
  n.rounds.push({ by, date: s.clock.today, terms: ev.terms, note: ev.reason.slice(0, 260) });
}

export function proposeDeal(s: GameState, input: { kind: Negotiation['kind']; companyId: string; partnerId: string; terms: DealTerms }): string {
  const c = companyOf(s, input.companyId);
  const p = partnerById(s, input.partnerId);
  if (!p) throw new CommandError('Nie ma takiej postaci.');
  if (input.kind === 'found' && c.status !== 'draft') throw new CommandError('Wspólników zapraszasz przed zawarciem umowy spółki.');
  if (input.kind !== 'found' && c.status !== 'registered') throw new CommandError('Transakcje na udziałach dotyczą zarejestrowanej spółki.');
  if (s.corp.negotiations.some((n) => n.companyId === c.id && n.partnerId === p.id && (n.status === 'open' || n.status === 'countered' || n.status === 'agreed') && n.kind === input.kind)) {
    throw new CommandError('Z tą osobą trwa już negocjacja tego rodzaju — zmień jej warunki albo ją wycofaj.');
  }
  const t = input.terms;
  if (!Number.isInteger(t.shares) || t.shares < 0 || !Number.isSafeInteger(t.amount) || t.amount < 0) throw new CommandError('Nieprawidłowe warunki (liczby całkowite, grosze).');
  if (input.kind === 'subscribe') {
    if (t.amount < c.nominal) throw new CommandError('Wkład musi pokrywać co najmniej wartość nominalną nowych udziałów.');
    if (t.percentBps < 100 || t.percentBps > 9_000) throw new CommandError('Udział po emisji: od 1% do 90%.');
  }
  if (input.kind === 'secondary_sell' || input.kind === 'secondary_buy') {
    if (t.shares < 1) throw new CommandError('Podaj liczbę udziałów.');
    if (t.amount < 1) throw new CommandError('Podaj cenę.');
  }
  if (input.kind === 'found' && s.corp.negotiations.filter((n) => n.companyId === c.id && n.kind === 'found' && n.status !== 'declined' && n.status !== 'void' && n.status !== 'expired').length >= CORP.maxShareholders - 1) {
    throw new CommandError('Osiągnięto maksymalną liczbę wspólników.');
  }
  const n: Negotiation = {
    id: `neg:${nextCounter(s, 'negotiation')}`, kind: input.kind, companyId: c.id, partnerId: p.id, status: 'open', terms: t,
    rounds: [{ by: 'player', date: s.clock.today, terms: t, note: 'Oferta gracza' }], openedOn: s.clock.today, expiresOn: addDays(s.clock.today, CORP.negotiationDays), resolutionId: null, reason: '',
  };
  s.corp.negotiations.push(n);
  applyEvaluation(s, n, evaluateDeal(s, input.kind, c, p, t), 'partner');
  logEvent(s, {
    id: `corp.negotiation:${n.id}:0`, date: s.clock.today, type: 'corp.negotiation', tone: n.status === 'declined' ? 'negative' : 'neutral',
    title: `Negocjacje (${KIND_LABEL[input.kind]}): ${holderName(s, p.id)} — ${STATUS_LABEL[n.status]}`, detail: n.reason.slice(0, 280), amount: null, category: null,
  });
  return resultMessage(n);
}

function resultMessage(n: Negotiation): string {
  return n.status === 'declined' ? `Odmowa: ${n.reason}` : n.status === 'agreed' ? `Zgoda: ${n.reason}` : `Kontroferta: ${n.reason}`;
}

export const KIND_LABEL = { found: 'zakładanie spółki', subscribe: 'objęcie nowych udziałów', secondary_sell: 'sprzedaż Twoich udziałów', secondary_buy: 'zakup udziałów' } as const;
export const STATUS_LABEL = { open: 'otwarta', countered: 'kontroferta', agreed: 'uzgodniona', declined: 'odmowa', expired: 'wygasła', completed: 'zrealizowana', void: 'wycofana' } as const;

const negotiationOf = (s: GameState, id: string): Negotiation => {
  const n = s.corp.negotiations.find((x) => x.id === id);
  if (!n) throw new CommandError('Nie ma takiej negocjacji.');
  return n;
};

export function reviseDeal(s: GameState, negotiationId: string, terms: DealTerms): string {
  const n = negotiationOf(s, negotiationId);
  if (n.status !== 'countered' && n.status !== 'declined' && n.status !== 'open') throw new CommandError('Tej negocjacji nie można już zmienić.');
  if (n.rounds.filter((r) => r.by === 'player').length >= CORP.maxNegotiationRounds) throw new CommandError(`Limit rund negocjacji (${CORP.maxNegotiationRounds}) wyczerpany.`);
  if (s.clock.today > n.expiresOn) { n.status = 'expired'; throw new CommandError('Negocjacja wygasła.'); }
  const c = companyOf(s, n.companyId);
  const p = partnerById(s, n.partnerId)!;
  n.terms = terms;
  n.rounds.push({ by: 'player', date: s.clock.today, terms, note: 'Zmiana warunków przez gracza' });
  applyEvaluation(s, n, evaluateDeal(s, n.kind, c, p, terms), 'partner');
  return resultMessage(n);
}

export function acceptCounter(s: GameState, negotiationId: string): string {
  const n = negotiationOf(s, negotiationId);
  if (n.status !== 'countered') throw new CommandError('Brak kontroferty do przyjęcia.');
  if (s.clock.today > n.expiresOn) { n.status = 'expired'; throw new CommandError('Negocjacja wygasła.'); }
  n.status = 'agreed';
  n.rounds.push({ by: 'player', date: s.clock.today, terms: n.terms, note: 'Gracz przyjął kontrofertę' });
  return 'Przyjęto kontrofertę — warunki uzgodnione.';
}

export function withdrawDeal(s: GameState, negotiationId: string): string {
  const n = negotiationOf(s, negotiationId);
  if (n.status === 'completed' || n.status === 'void') throw new CommandError('Negocjacja jest już zamknięta.');
  if (n.resolutionId) {
    const r = s.corp.resolutions.find((x) => x.id === n.resolutionId);
    if (r && (r.status === 'scheduled' || r.status === 'passed')) throw new CommandError('Trwa uchwała dotycząca tej emisji — nie można wycofać negocjacji.');
  }
  n.status = 'void';
  return 'Negocjacja wycofana.';
}

/** Wygaszanie przeterminowanych negocjacji (codziennie). */
export function expireNegotiations(s: GameState, date: IsoDate): void {
  for (const n of s.corp.negotiations) {
    if ((n.status === 'open' || n.status === 'countered' || n.status === 'agreed') && date > n.expiresOn && !n.resolutionId) {
      n.status = 'expired';
      n.reason = `${n.reason} (wygasła ${date})`.slice(0, 300);
    }
  }
}

/** Realizuje uzgodnioną transakcję na istniejących udziałach (sprzedaż/zakup); zapłata trafia do sprzedającego, nie do spółki. */
export function completeSecondary(s: GameState, negotiationId: string): string {
  const n = negotiationOf(s, negotiationId);
  if (n.status !== 'agreed') throw new CommandError('Transakcja nie jest uzgodniona.');
  if (n.kind !== 'secondary_sell' && n.kind !== 'secondary_buy') throw new CommandError('To nie jest transakcja na istniejących udziałach.');
  if (s.clock.today > n.expiresOn) { n.status = 'expired'; throw new CommandError('Uzgodnienie wygasło.'); }
  const c = companyOf(s, n.companyId);
  const p = partnerById(s, n.partnerId)!;
  const t = n.terms;
  const today = s.clock.today;
  const playerId = s.person.id;
  if (n.kind === 'secondary_sell') {
    if (sharesOf(s, c.id, playerId) < t.shares) throw new CommandError('Nie masz już tylu udziałów.');
    if (p.capital < t.amount) throw new CommandError('Kupujący nie ma już takiej kwoty.');
    const r = transferShares(s, c.id, playerId, p.id, t.shares, t.amount, today, `deal:${n.id}`, `Sprzedaż udziałów (${n.id})`);
    p.capital -= t.amount;
    ensureParty(s, { id: `party:${p.id}`, name: holderName(s, p.id), role: 'service' });
    postTransaction(s, { eventId: `deal:${n.id}:proceeds`, date: today, amount: t.amount, category: 'sprzedaz_udzialow', description: `Sprzedaż ${t.shares} udz. ${c.name} sp. z o.o.`, counterpartyId: `party:${p.id}`, obligationId: null });
    const gain = t.amount - r.costBasisRemoved;
    const tax = gain > 0 ? mulBps(gain, CORP.shareSaleTaxBps) : 0;
    if (tax > 0) {
      const { year } = parseIso(today);
      createObligation(s, {
        occurrenceId: `deal:${n.id}:pit`, ruleId: 'rule:pit-shares', direction: 'payable', counterpartyId: 'party:us', amount: roundToZl(tax), issueDate: today,
        dueDate: dateInMonth(year + 1, 4, 30), category: 'pit_udzialy', description: `PIT 19% od zysku ze sprzedaży udziałów ${c.name} sp. z o.o. (zysk ${formatPLN(gain, { round: true })})`,
      });
    }
    adjustAfterTrade(s, c, p, 'sold');
    n.status = 'completed';
    return `Sprzedano ${t.shares} udz. za ${formatPLN(t.amount)}.${tax > 0 ? ` Podatek od zysku (19%): ${formatPLN(roundToZl(tax))}, płatny do 30 kwietnia.` : gain < 0 ? ' Strata na sprzedaży nie obniża podatku w grze (DEFERRED).' : ''}`;
  }
  // secondary_buy
  if (sharesOf(s, c.id, p.id) < t.shares) throw new CommandError('Sprzedający nie ma już tylu udziałów.');
  const acc = s.accounts[s.playerAccountId]!;
  const pcc = mulBps(t.amount, CORP.pccSaleBps);
  if (acc.balance < t.amount + pcc) throw new CommandError(`Za mało środków na rachunku osobistym (cena ${formatPLN(t.amount)} + PCC ${formatPLN(pcc)}).`);
  transferShares(s, c.id, p.id, playerId, t.shares, t.amount, today, `deal:${n.id}`, `Zakup udziałów (${n.id})`);
  p.capital += t.amount;
  ensureParty(s, { id: `party:${p.id}`, name: holderName(s, p.id), role: 'service' });
  postTransaction(s, { eventId: `deal:${n.id}:price`, date: today, amount: -t.amount, category: 'zakup_udzialow', description: `Zakup ${t.shares} udz. ${c.name} sp. z o.o.`, counterpartyId: `party:${p.id}`, obligationId: null });
  if (pcc > 0) {
    createObligation(s, {
      occurrenceId: `deal:${n.id}:pcc`, ruleId: 'rule:pcc-shares', direction: 'payable', counterpartyId: 'party:us', amount: pcc, issueDate: today, dueDate: addDays(today, CORP.pccDueDays),
      category: 'pcc', description: `PCC 1% od zakupu udziałów ${c.name} sp. z o.o.`,
    });
  }
  adjustAfterTrade(s, c, p, 'bought');
  n.status = 'completed';
  return `Kupiono ${t.shares} udz. za ${formatPLN(t.amount)} (PCC ${formatPLN(pcc)} do ${addDays(today, CORP.pccDueDays)}).`;
}

function adjustAfterTrade(s: GameState, c: Company, p: Partner, what: 'sold' | 'bought'): void {
  p.history.push({ date: s.clock.today, note: what === 'sold' ? `Kupił udziały ${c.name} sp. z o.o. od gracza` : `Sprzedał udziały ${c.name} sp. z o.o. graczowi`, trustDelta: 0 });
  refreshValuation(s, c);
}
