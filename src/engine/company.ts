import { PROFILE_BY_ID } from './businessCatalog.ts';
import { CORP, REPRESENTATION_LABELS } from './corpConfig.ts';
import { companyBalance, refreshValuation } from './companyFinance.ts';
import { CommandError, createObligation, ensureParty, logEvent, nextCounter, postTransaction } from './core.ts';
import { addDays, dateInMonth, firstOfNextMonth, formatDatePL, parseIso } from './date.ts';
import type { IsoDate } from './date.ts';
import { emptyOps, emptyReno } from './industryDefaults.ts';
import { industryOf } from './industry.ts';
import { initialMarketState } from './market.ts';
import { formatPLN, mulBps } from './money.ts';
import type { Grosze } from './money.ts';
import { companyById, companyFullName, currentOperator, inCompanyContext, listOperators, withOperator, JDG } from './operator.ts';
import { holderName, partnerById } from './partners.ts';
import { createRng } from './rng.ts';
import { SERVICE_BY_ID } from './renovationCatalog.ts';
import { activeHoldings, companyOf, grantFoundingShares, sharesOf, syncSole } from './shares.ts';
import type { BoardMember, Company, GameState, Operator } from './state.ts';

/**
 * Spółka z o.o. jako odrębny podmiot prawny (v0.8): własny rachunek, majątek, zobowiązania, dokumenty, pracownicy i kontrakty.
 * Etap organizacji (szkic → umowa spółki w organizacji → wniosek do KRS → wpis) jest rozdzielony od rejestracji; spółka nie działa przed wpisem.
 * Gracz (wspólnik) ≠ zarząd: prawo reprezentacji daje wyłącznie członkostwo w zarządzie (art. 201, 205 KSH).
 */

export const COURT: string = 'party:court';

export interface DraftInput {
  name: string;
  cityId: string;
  profileId: string;
  specialization: string;
  vatPlan: 'exempt' | 'active';
  capital: Grosze;
  nominal: Grosze;
  representation: Company['representation'];
}

export function validateDraft(s: GameState, i: DraftInput): string | null {
  const name = i.name.trim();
  if (name.length < 2 || name.length > 50) return 'Nazwa spółki: od 2 do 50 znaków (bez dopisku „sp. z o.o.”, dodajemy go automatycznie).';
  if (/sp\.?\s*z\s*o\.?\s*o/i.test(name)) return 'Podaj samą nazwę — dopisek „sp. z o.o.” dodajemy automatycznie.';
  if (s.corp.companies.some((c) => c.status !== 'closed' && c.name.toLowerCase() === name.toLowerCase())) return 'Spółka o takiej nazwie już istnieje.';
  if (s.corp.companies.filter((c) => c.status !== 'closed').length >= 3) return 'W grze możesz mieć najwyżej 3 spółki jednocześnie.';
  const prof = PROFILE_BY_ID.get(i.profileId);
  if (!prof || prof.industry !== 'renovation') return 'W tej wersji spółka może prowadzić działalność remontowo-wykończeniową.';
  if (!SERVICE_BY_ID.has(i.specialization)) return 'Wybierz specjalizację (pierwszą usługę spółki).';
  if (!Number.isSafeInteger(i.capital) || i.capital < CORP.capitalMin) return `Kapitał zakładowy: co najmniej ${formatPLN(CORP.capitalMin, { round: true })} (art. 154 § 1 KSH).`;
  if (!Number.isSafeInteger(i.nominal) || i.nominal < CORP.nominalMin) return `Wartość nominalna udziału: co najmniej ${formatPLN(CORP.nominalMin, { round: true })} (art. 154 § 2 KSH).`;
  if (i.capital % i.nominal !== 0) return 'Kapitał zakładowy musi dzielić się na całkowitą liczbę udziałów o równej wartości nominalnej.';
  if (i.capital / i.nominal > 10_000) return 'Zbyt dużo udziałów (maks. 10 000).';
  if (!['each_alone', 'joint_two', 'all_jointly'].includes(i.representation)) return 'Wybierz sposób reprezentacji.';
  if (!['exempt', 'active'].includes(i.vatPlan)) return 'Wybierz status VAT.';
  return null;
}

export function createCompanyDraft(s: GameState, i: DraftInput): string {
  const err = validateDraft(s, i);
  if (err) throw new CommandError(err);
  const prof = PROFILE_BY_ID.get(i.profileId)!;
  const n = nextCounter(s, 'company');
  const id = `co:${n}`;
  const accountId = `acc:${id}`;
  const partyId = `party:${id}`;
  const name = i.name.trim();
  s.accounts[accountId] = { id: accountId, ownerId: id, name: `Rachunek spółki — ${name} sp. z o.o.`, type: 'company', currency: 'PLN', balance: 0, interest: null };
  ensureParty(s, { id: partyId, name: `${name} sp. z o.o.`, role: 'service' });
  const c: Company = {
    id, name, cityId: i.cityId, profileId: prof.id, specialization: i.specialization, status: 'draft', createdOn: s.clock.today,
    agreementOn: null, filedOn: null, decisionOn: null, registeredOn: null, krsNumber: null,
    capital: i.capital, nominal: i.nominal, shareCount: i.capital / i.nominal, supplementary: 0, accountId, partyId, board: [], representation: i.representation,
    vatPlan: i.vatPlan, operation: null,
    slices: { reno: emptyReno(), ops: emptyOps(`${s.seed}:${id}`), marketing: initialMarketState().marketing, strategy: initialMarketState().strategy },
    pendingIncrease: null, statementsApproved: [], yearResults: [], monthly: [], valuation: null, soleHistory: [],
  };
  s.corp.companies.push(c);
  logEvent(s, {
    id: `corp.company:${id}:draft`, date: s.clock.today, type: 'corp.company', tone: 'neutral',
    title: `Szkic spółki: ${name} sp. z o.o.`, detail: `Kapitał ${formatPLN(i.capital, { round: true })} (${c.shareCount} udz. po ${formatPLN(i.nominal, { round: true })}) · umowa przez wzorzec S24 (wkłady pieniężne)`, amount: null, category: null,
  });
  return `Szkic spółki „${name} sp. z o.o.” gotowy. Zaproś wspólników (opcjonalnie), a potem zawrzyj umowę spółki.`;
}

export function deleteDraft(s: GameState, companyId: string): string {
  const c = companyOf(s, companyId);
  if (c.status !== 'draft') throw new CommandError('Można usunąć tylko szkic spółki.');
  s.corp.companies = s.corp.companies.filter((x) => x.id !== c.id);
  for (const n of s.corp.negotiations) if (n.companyId === c.id) n.status = 'void';
  delete s.accounts[c.accountId];
  if (s.corp.selected === c.id) s.corp.selected = JDG;
  return 'Szkic usunięty.';
}

/* ---------- Zarząd ---------- */

export const activeBoard = (c: Company): BoardMember[] => c.board.filter((m) => m.endedOn === null);
export const isBoardMember = (c: Company, personId: string): boolean => activeBoard(c).some((m) => m.personId === personId);

export function appointMember(s: GameState, c: Company, personId: string, role: BoardMember['role'], resolutionId: string | null, date: IsoDate): BoardMember {
  if (isBoardMember(c, personId)) throw new CommandError(`${holderName(s, personId)} jest już członkiem zarządu.`);
  if (activeBoard(c).length >= CORP.maxBoard) throw new CommandError(`Zarząd może mieć najwyżej ${CORP.maxBoard} członków.`);
  if (role === 'president' && activeBoard(c).some((m) => m.role === 'president')) role = 'member';
  const m: BoardMember = { id: `bm:${nextCounter(s, 'board')}`, personId, role, appointedOn: date, endedOn: null, endReason: null, resolutionId };
  c.board.push(m);
  if (!activeBoard(c).some((x) => x.role === 'president')) m.role = 'president';
  return m;
}

export function endMember(s: GameState, c: Company, memberId: string, reason: 'dismissed' | 'resigned', date: IsoDate): BoardMember {
  const m = c.board.find((x) => x.id === memberId && x.endedOn === null);
  if (!m) throw new CommandError('Nie ma takiego członka zarządu.');
  if (activeBoard(c).length <= 1) throw new CommandError('Spółka musi mieć zarząd — najpierw powołaj kolejnego członka (art. 163 pkt 3 KSH).');
  m.endedOn = date;
  m.endReason = reason;
  if (m.role === 'president') {
    const next = activeBoard(c)[0];
    if (next) next.role = 'president';
  }
  logEvent(s, {
    id: `corp.board:${m.id}:end`, date, type: 'corp.board', tone: 'neutral',
    title: `${reason === 'resigned' ? 'Rezygnacja' : 'Odwołanie'} członka zarządu: ${holderName(s, m.personId)} (${companyFullName(c)})`, detail: 'Zmiana wpisu w KRS: opłata 250 zł naliczona spółce.', amount: null, category: null,
  });
  chargeCourtChange(s, c, date, `zmiana zarządu (${m.id})`);
  return m;
}

/** Opłata sądowa za zmianę wpisu w KRS (art. 55 ust. 1 u.k.s.c.) — zobowiązanie spółki. */
export function chargeCourtChange(s: GameState, c: Company, date: IsoDate, what: string, amount: Grosze = CORP.courtFeeChange): void {
  ensureParty(s, { id: COURT, name: 'Sąd rejestrowy (KRS)', role: 'service' });
  createObligation(s, {
    occurrenceId: `court:${c.id}:${what}:${date}`, ruleId: 'rule:court', direction: 'payable', counterpartyId: COURT, accountId: c.accountId, scope: 'company', amount,
    issueDate: date, dueDate: addDays(date, 7), category: 'oplata_sadowa', description: `Opłata sądowa KRS: ${what} (${c.name} sp. z o.o.)`,
  });
}

export function resignFromBoard(s: GameState, companyId: string): string {
  const c = companyOf(s, companyId);
  const m = activeBoard(c).find((x) => x.personId === s.person.id);
  if (!m) throw new CommandError('Nie jesteś członkiem zarządu tej spółki.');
  endMember(s, c, m.id, 'resigned', s.clock.today);
  return 'Złożono rezygnację z zarządu. Udziały zachowujesz, ale nie reprezentujesz już spółki.';
}

/* ---------- Umowa spółki, wniosek do KRS, rejestracja ---------- */

export interface AgreementInput { companyId: string; board: { personId: string; role: BoardMember['role'] }[]; file: boolean }

export function agreementPreview(s: GameState, companyId: string): { partnerShares: number; playerShares: number; contributions: { holderId: string; shares: number; amount: Grosze }[]; pcc: Grosze; ready: string | null } {
  const c = companyOf(s, companyId);
  const agreed = s.corp.negotiations.filter((n) => n.companyId === c.id && n.kind === 'found' && n.status === 'agreed' && n.expiresOn >= s.clock.today);
  const partnerShares = agreed.reduce((a, n) => a + n.terms.shares, 0);
  const playerShares = c.shareCount - partnerShares;
  const contributions = [{ holderId: s.person.id, shares: playerShares, amount: playerShares * c.nominal }, ...agreed.map((n) => ({ holderId: n.partnerId, shares: n.terms.shares, amount: n.terms.shares * c.nominal }))];
  const pcc = mulBps(Math.max(0, c.capital - CORP.courtFeeRegistration), CORP.pccCompanyBps);
  let ready: string | null = null;
  if (c.status !== 'draft') ready = 'Umowa została już zawarta.';
  else if (playerShares < 1) ready = 'Ty musisz objąć co najmniej 1 udział.';
  else if (s.corp.negotiations.some((n) => n.companyId === c.id && n.kind === 'found' && (n.status === 'open' || n.status === 'countered'))) ready = 'Masz niedokończone negocjacje z zapraszanymi wspólnikami — przyjmij kontrofertę, zmień warunki albo wycofaj zaproszenie.';
  else if (s.accounts[s.playerAccountId]!.balance < playerShares * c.nominal) ready = `Na rachunku osobistym brakuje środków na wkład (${formatPLN(playerShares * c.nominal, { round: true })}).`;
  return { partnerShares, playerShares, contributions, pcc, ready };
}

export function signAgreement(s: GameState, input: AgreementInput): string {
  const c = companyOf(s, input.companyId);
  const pv = agreementPreview(s, c.id);
  if (pv.ready) throw new CommandError(pv.ready);
  const today = s.clock.today;
  const founders = new Set<string>([s.person.id, ...s.corp.negotiations.filter((n) => n.companyId === c.id && n.kind === 'found' && n.status === 'agreed').map((n) => n.partnerId)]);
  if (input.board.length < 1) throw new CommandError('Zarząd musi mieć co najmniej jednego członka (art. 163 pkt 3 KSH) — powołaj go w umowie spółki.');
  if (input.board.length > CORP.maxBoard) throw new CommandError(`Zarząd: najwyżej ${CORP.maxBoard} członków.`);
  const seen = new Set<string>();
  for (const b of input.board) {
    if (!founders.has(b.personId)) throw new CommandError('Do zarządu w umowie spółki możesz powołać tylko siebie i wspólników zakładających spółkę.');
    if (seen.has(b.personId)) throw new CommandError('Ta sama osoba nie może być dwa razy w zarządzie.');
    seen.add(b.personId);
  }
  // wkłady: pieniężne, w całości, przed zgłoszeniem (art. 163 pkt 2, art. 167 § 4 pkt 3 KSH)
  for (const ct of pv.contributions) {
    if (ct.holderId === s.person.id) continue;
    const p = partnerById(s, ct.holderId);
    if (!p || p.capital < ct.amount) throw new CommandError(`${holderName(s, ct.holderId)} nie ma już środków na wkład.`);
  }
  c.status = 'organizing';
  c.agreementOn = today;
  c.representation = c.representation;
  const day = today;
  // wkład gracza: przelew z rachunku osobistego na rachunek spółki (para wpisów o sumie zero — kapitał, nie przychód i nie koszt)
  const transferId = `capital:${c.id}:${nextCounter(s, 'capital')}`;
  const pl = pv.contributions[0]!;
  postTransaction(s, { eventId: `${transferId}:out`, accountId: s.playerAccountId, date: day, amount: -pl.amount, category: 'wklad_kapitalowy', description: `Wkład na kapitał zakładowy ${c.name} sp. z o.o. (${pl.shares} udz.)`, counterpartyId: c.partyId, obligationId: null, transferId });
  postTransaction(s, { eventId: `${transferId}:in`, accountId: c.accountId, date: day, amount: pl.amount, category: 'wklad_kapitalowy', description: `Wkład wspólnika ${holderName(s, s.person.id)} (${pl.shares} udz.)`, counterpartyId: null, obligationId: null, transferId });
  grantFoundingShares(s, c, s.person.id, pl.shares, pl.amount, day);
  for (const ct of pv.contributions.slice(1)) {
    const p = partnerById(s, ct.holderId)!;
    ensureParty(s, { id: `party:${p.id}`, name: holderName(s, p.id), role: 'service' });
    postTransaction(s, { eventId: `${transferId}:${p.id}`, accountId: c.accountId, date: day, amount: ct.amount, category: 'wklad_kapitalowy', description: `Wkład wspólnika ${holderName(s, p.id)} (${ct.shares} udz.)`, counterpartyId: `party:${p.id}`, obligationId: null });
    p.capital -= ct.amount;
    grantFoundingShares(s, c, p.id, ct.shares, ct.amount, day);
    p.history.push({ date: day, note: `Wszedł do spółki ${c.name} sp. z o.o. (${ct.shares} udz., wkład ${formatPLN(ct.amount, { round: true })})`, trustDelta: 0 });
  }
  for (const n of s.corp.negotiations) if (n.companyId === c.id && n.kind === 'found') n.status = n.status === 'agreed' ? 'completed' : 'void';
  input.board.forEach((b, idx) => appointMember(s, c, b.personId, b.role === 'president' ? 'president' : idx === 0 && !input.board.some((x) => x.role === 'president') ? 'president' : 'member', null, day));
  // PCC od umowy spółki płaci spółka (art. 4 pkt 9); podstawa: kapitał − opłata sądowa (art. 6 ust. 9 pkt 2)
  ensureParty(s, { id: 'party:us', name: 'Urząd Skarbowy', role: 'service' });
  if (pv.pcc > 0) {
    createObligation(s, {
      occurrenceId: `pcc:${c.id}:agreement`, ruleId: 'rule:pcc-company', direction: 'payable', counterpartyId: 'party:us', accountId: c.accountId, scope: 'company', amount: pv.pcc,
      issueDate: day, dueDate: addDays(day, CORP.pccDueDays), category: 'pcc', description: `PCC 0,5% od umowy spółki ${c.name} sp. z o.o. (podstawa: kapitał − opłata sądowa)`,
    });
  }
  logEvent(s, {
    id: `corp.company:${c.id}:agreement`, date: day, type: 'corp.company', tone: 'positive',
    title: `Zawarto umowę spółki: ${companyFullName(c)} (w organizacji)`,
    detail: `Kapitał ${formatPLN(c.capital, { round: true })} wpłacony w całości · wspólnicy: ${pv.contributions.map((x) => `${holderName(s, x.holderId)} ${x.shares} udz.`).join(', ')} · zarząd: ${input.board.map((b) => holderName(s, b.personId)).join(', ')}`.slice(0, 290),
    amount: null, category: null,
  });
  if (input.file) return `${fileForRegistration(s, c.id)}`;
  return 'Umowa spółki zawarta — spółka w organizacji. Złóż wniosek o wpis do KRS.';
}

export function fileForRegistration(s: GameState, companyId: string): string {
  const c = companyOf(s, companyId);
  if (c.status !== 'organizing') throw new CommandError('Wniosek składa się dla spółki w organizacji.');
  if (c.filedOn) throw new CommandError(`Wniosek został już złożony ${formatDatePL(c.filedOn)}.`);
  if (activeBoard(c).length === 0) throw new CommandError('Zarząd musi być powołany przed zgłoszeniem spółki do rejestru.');
  const cash = s.accounts[c.accountId]!.balance;
  if (cash < CORP.courtFeeRegistration) throw new CommandError(`Na rachunku spółki brakuje środków na opłatę sądową (${formatPLN(CORP.courtFeeRegistration)}).`);
  const today = s.clock.today;
  ensureParty(s, { id: COURT, name: 'Sąd rejestrowy (KRS)', role: 'service' });
  createObligation(s, {
    occurrenceId: `court:${c.id}:registration`, ruleId: 'rule:court', direction: 'payable', counterpartyId: COURT, accountId: c.accountId, scope: 'company', amount: CORP.courtFeeRegistration,
    issueDate: today, dueDate: today, category: 'oplata_sadowa', description: `Opłata sądowa za wpis do KRS (wzorzec S24) — ${c.name} sp. z o.o.`,
  });
  c.filedOn = today;
  c.decisionOn = addDays(today, CORP.krsDecisionDaysS24);
  logEvent(s, {
    id: `corp.company:${c.id}:filed`, date: today, type: 'corp.company', tone: 'neutral',
    title: `Wniosek o wpis do KRS złożony: ${companyFullName(c)}`, detail: `Opłata sądowa ${formatPLN(CORP.courtFeeRegistration)} (bez opłaty za ogłoszenie w MSiG) · sąd rozpozna wniosek do ${formatDatePL(c.decisionOn)} (symulacja)`, amount: null, category: null,
  });
  return `Wniosek o wpis złożony. Sąd rozpozna go do ${formatDatePL(c.decisionOn)}; do tego czasu spółka jest w organizacji i nie prowadzi działalności.`;
}

export function completeRegistration(s: GameState, c: Company, date: IsoDate): void {
  c.status = 'registered';
  c.registeredOn = date;
  c.krsNumber = `KRS 0000${String(createRng(s.seed, `krs:${c.id}`).int(100_000, 999_999))}`;
  syncSole(s, c, date);
  refreshValuation(s, c, date);
  for (const m of activeBoard(c)) void m;
  logEvent(s, {
    id: `corp.company:${c.id}:registered`, date, type: 'corp.company', tone: 'positive',
    title: `Spółka wpisana do KRS: ${companyFullName(c)}`, detail: `${c.krsNumber} (numer symulowany) · od dziś spółka istnieje jako osoba prawna i może uruchomić działalność`, amount: null, category: null,
  });
}

/* ---------- Uruchomienie działalności ---------- */

export function startOperation(s: GameState, companyId: string, input: { specialization?: string; vat?: 'exempt' | 'active' }): string {
  const c = companyOf(s, companyId);
  if (c.status !== 'registered') throw new CommandError('Działalność można uruchomić dopiero po wpisie spółki do KRS.');
  if (c.operation) throw new CommandError('Spółka prowadzi już działalność.');
  if (!isBoardMember(c, s.person.id)) throw new CommandError('Działalność uruchamia zarząd — nie jesteś jego członkiem (udziały nie dają prawa reprezentacji).');
  const prof = PROFILE_BY_ID.get(c.profileId)!;
  const start = firstOfNextMonth(s.clock.today);
  const vat = input.vat ?? c.vatPlan;
  const op: Operator = {
    id: `op:${c.id}`, ownerId: c.id, name: `${c.name} sp. z o.o.`, profileId: c.profileId, pkd: prof.pkd, registeredOn: s.clock.today, startDate: start, closeOn: null, status: 'active',
    vat: { status: vat, activeFrom: vat === 'active' ? start : null, limitExceededOn: null }, accountId: c.accountId, suspensions: [],
  };
  c.operation = op;
  const spec = input.specialization ?? c.specialization ?? undefined;
  withOperator(s, c.id, () => industryOf(op)?.onRegister?.(s, op, { specialization: spec }));
  refreshValuation(s, c);
  logEvent(s, {
    id: `corp.company:${c.id}:operation`, date: s.clock.today, type: 'corp.company', tone: 'positive',
    title: `${companyFullName(c)} uruchamia działalność od ${formatDatePL(start)}`, detail: `${prof.label} (PKD ${prof.pkd}) · VAT: ${vat === 'exempt' ? 'zwolnienie podmiotowe' : 'czynny podatnik'} · odrębny rachunek, pracownicy i kontrakty spółki`, amount: null, category: null,
  });
  return `Działalność spółki rozpocznie się ${formatDatePL(start)}. Przełącz aktywny podmiot na spółkę, by zarządzać jej zleceniami i pracownikami.`;
}

export function selectOperator(s: GameState, id: string): string {
  if (id === JDG) {
    s.corp.selected = JDG;
    return 'Aktywny podmiot: Twoja JDG (osoba fizyczna).';
  }
  const c = companyById(s, id);
  if (!c || c.status !== 'registered' || !c.operation) throw new CommandError('Ta spółka nie prowadzi jeszcze działalności.');
  s.corp.selected = c.id;
  return `Aktywny podmiot: ${companyFullName(c)}.`;
}

/* ---------- Reprezentacja i zgody ---------- */

function coSigner(s: GameState, c: Company, partnerId: string, label: string, amount: Grosze): { ok: boolean; reason: string } {
  const p = partnerById(s, partnerId);
  if (!p) return { ok: true, reason: '' };
  if (p.trust < 35) return { ok: false, reason: `${holderName(s, p.id)} odmawia podpisu: zaufanie do Ciebie (${p.trust}/100) jest zbyt niskie.` };
  const bal = companyBalance(s, c);
  const limit = Math.round((Math.max(0, bal.cash) * (5_000 + p.riskTolerance * 60)) / 10_000);
  if (amount > limit) return { ok: false, reason: `${holderName(s, p.id)} odmawia podpisu pod „${label}”: zobowiązanie ${formatPLN(amount, { round: true })} przekracza ${formatPLN(limit, { round: true })} (jego próg przy gotówce spółki ${formatPLN(Math.max(0, bal.cash), { round: true })} i tolerancji ryzyka ${p.riskTolerance}/100).` };
  return { ok: true, reason: '' };
}

/**
 * Czynność wiążąca spółkę (kontrakt, zatrudnienie, zakup sprzętu/pojazdu, podwykonawca). Obowiązuje w kontekście spółki:
 * gracz musi być członkiem zarządu; przy reprezentacji łącznej potrzebny jest podpis współzarządcy (decyzja postaci AI wynikająca z jej interesów).
 */
export function requireAuthority(s: GameState, label: string, amount: Grosze): void {
  if (!inCompanyContext(s)) return;
  const c = companyById(s, s.corp.context)!;
  const board = activeBoard(c);
  const me = board.find((m) => m.personId === s.person.id);
  if (!me) throw new CommandError(`Nie jesteś członkiem zarządu ${companyFullName(c)} — nie możesz jej reprezentować, choć możesz być wspólnikiem (art. 201, 205 KSH).`);
  const others = board.filter((m) => m.personId !== s.person.id);
  if (c.representation === 'each_alone' || others.length === 0) return;
  const need = c.representation === 'joint_two' ? [others[0]!] : others;
  for (const m of need) {
    const d = coSigner(s, c, m.personId, label, amount);
    if (!d.ok) throw new CommandError(`${REPRESENTATION_LABELS[c.representation]}: ${d.reason}`);
  }
}

/** Art. 229 KSH: nabycie środków trwałych za cenę > 1/4 kapitału (min. 50 000 zł) w ciągu 2 lat od rejestracji wymaga uchwały wspólników. */
export function requireAssetConsent(s: GameState, label: string, priceNet: Grosze): void {
  if (!inCompanyContext(s)) return;
  const c = companyById(s, s.corp.context)!;
  if (!c.registeredOn) return;
  const threshold = Math.max(CORP.art229MinAmount, Math.floor(c.capital / CORP.art229Fraction));
  if (priceNet <= threshold) return;
  const { year, month, day } = parseIso(c.registeredOn);
  const until = dateInMonth(year + CORP.art229Years, month, day);
  if (s.clock.today > until) return;
  const ok = s.corp.resolutions.some((r) => r.companyId === c.id && r.payload.type === 'consent_acquisition' && r.status === 'executed' && r.payload.maxAmount >= priceNet && r.payload.validUntil >= s.clock.today);
  if (!ok) throw new CommandError(`${label}: ${formatPLN(priceNet, { round: true })} przekracza próg ${formatPLN(threshold, { round: true })} (1/4 kapitału, min. 50 000 zł) w pierwszych 2 latach spółki — potrzebna uchwała wspólników „zgoda na nabycie” (art. 229 KSH).`);
}

/** Operator, którym kierują obecnie komendy gracza (wybór w interfejsie). */
export function activeOperatorLabel(s: GameState): string {
  const sel = listOperators(s).find((o) => o.id === s.corp.selected);
  return sel ? sel.label : 'JDG';
}

export function currentCompany(s: GameState): Company | undefined {
  return companyById(s, s.corp.context);
}

export { activeHoldings, sharesOf, currentOperator };
