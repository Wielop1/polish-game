import { CommandError, logEvent, nextCounter } from './core.ts';
import type { IsoDate } from './date.ts';
import { roundDiv } from './money.ts';
import type { Grosze } from './money.ts';
import { holderName } from './partners.ts';
import type { Company, GameState, ShareHolding } from './state.ts';

/**
 * Centralny rejestr udziałów (v0.8). Jeden wiersz = wspólnik w spółce; każdy wiersz ma partie nabycia (koszt), prawa głosu,
 * ograniczenia i historię zmian. Rozdzielone są: procent kapitału, prawa głosu, wartość rynkowa (wycena spółki — `valuation.ts`),
 * prawa do dywidendy (proporcjonalnie do udziałów — art. 191 § 3 KSH) i kompetencje zarządcze (członkostwo w zarządzie — `company.ts`).
 */

export const companyOf = (s: GameState, companyId: string): Company => {
  const c = s.corp.companies.find((x) => x.id === companyId);
  if (!c) throw new Error(`Nieznana spółka ${companyId}`);
  return c;
};

export const activeHoldings = (s: GameState, companyId: string): ShareHolding[] => s.corp.holdings.filter((h) => h.companyId === companyId && h.count > 0);
export const holdingOf = (s: GameState, companyId: string, holderId: string): ShareHolding | undefined => s.corp.holdings.find((h) => h.companyId === companyId && h.holderId === holderId);
export const sharesOf = (s: GameState, companyId: string, holderId: string): number => holdingOf(s, companyId, holderId)?.count ?? 0;
export const totalHeldShares = (s: GameState, companyId: string): number => activeHoldings(s, companyId).reduce((a, h) => a + h.count, 0);
export const votesOfHolding = (h: ShareHolding): number => h.count * h.votesPerShare;
export const totalVotes = (s: GameState, companyId: string): number => activeHoldings(s, companyId).reduce((a, h) => a + votesOfHolding(h), 0);

/** Procent kapitału zakładowego (pkt bazowe) wg liczby udziałów — oddzielnie od praw głosu. */
export function capitalBps(s: GameState, companyId: string, holderId: string): number {
  const total = totalHeldShares(s, companyId);
  return total === 0 ? 0 : roundDiv(sharesOf(s, companyId, holderId) * 10_000, total);
}

export function voteBps(s: GameState, companyId: string, holderId: string): number {
  const h = holdingOf(s, companyId, holderId);
  const total = totalVotes(s, companyId);
  return !h || total === 0 ? 0 : roundDiv(votesOfHolding(h) * 10_000, total);
}

/** Koszt nabycia posiadanych udziałów (suma partii). */
export const holdingCost = (h: ShareHolding): Grosze => h.lots.reduce((a, l) => a + l.paid, 0);

/** Koszt nabycia wszystkich udziałów gracza (aktywo wg kosztu — podstawa tożsamości księgowej). */
export function playerSharesBook(s: GameState): Grosze {
  let sum = 0;
  for (const h of s.corp.holdings) if (h.holderId === s.person.id) sum += holdingCost(h);
  return sum;
}

/** Szacunkowa wartość udziałów gracza: udział w ostatniej wycenie spółki (przed rejestracją — koszt nabycia). To szacunek, nie gotówka. */
export function playerSharesValue(s: GameState): Grosze {
  let sum = 0;
  for (const h of s.corp.holdings) {
    if (h.holderId !== s.person.id || h.count === 0) continue;
    const c = s.corp.companies.find((x) => x.id === h.companyId);
    if (!c) continue;
    if (c.status === 'registered' && c.valuation && c.shareCount > 0) sum += roundDiv(c.valuation.estimate * h.count, c.shareCount);
    else sum += holdingCost(h);
  }
  return sum;
}

/** Wartość udziałów danego wspólnika w spółce wg ostatniej wyceny (lub kosztu przed rejestracją). */
export function holdingValue(s: GameState, h: ShareHolding): Grosze {
  const c = companyOf(s, h.companyId);
  if (c.status === 'registered' && c.valuation && c.shareCount > 0) return roundDiv(c.valuation.estimate * h.count, c.shareCount);
  return holdingCost(h);
}

export function soleHolder(s: GameState, companyId: string): string | null {
  const hs = activeHoldings(s, companyId);
  return hs.length === 1 ? hs[0]!.holderId : null;
}

/** Aktualizuje historię okresów jedynego wspólnika (podstawa ubezpieczenia wspólnika jednoosobowej spółki). */
export function syncSole(s: GameState, c: Company, date: IsoDate): void {
  const sole = c.status === 'registered' ? soleHolder(s, c.id) : null;
  const open = c.soleHistory.find((x) => x.to === null);
  if (open && open.holderId === sole) return;
  if (open) open.to = date;
  if (sole) c.soleHistory.push({ holderId: sole, from: date, to: null });
}

function ensureHolding(s: GameState, c: Company, holderId: string): ShareHolding {
  let h = holdingOf(s, c.id, holderId);
  if (!h) {
    const n = nextCounter(s, 'share:holding');
    h = { id: `sh:${n}`, companyId: c.id, holderId, count: 0, nominal: c.nominal, votesPerShare: 1, restrictions: [], lots: [], history: [] };
    s.corp.holdings.push(h);
  }
  return h;
}

function newEventId(s: GameState): string {
  return `se:${nextCounter(s, 'share:event')}`;
}

/** Przydział udziałów przy zawarciu umowy spółki (kapitał zakładowy pokryty wkładami pieniężnymi). */
export function grantFoundingShares(s: GameState, c: Company, holderId: string, count: number, paid: Grosze, date: IsoDate): string {
  if (count < 1) throw new Error('Przydział musi obejmować co najmniej 1 udział');
  const eventId = newEventId(s);
  const h = ensureHolding(s, c, holderId);
  h.count += count;
  h.lots.push({ id: `lot:${eventId}`, count, acquiredOn: date, via: 'founding', paid, eventId });
  h.history.push({ date, kind: 'acquire', count, eventId, note: 'objęcie przy zawiązaniu spółki' });
  s.corp.shareEvents.push({ id: eventId, companyId: c.id, date, kind: 'founding', fromId: null, toId: holderId, count, nominal: c.nominal, price: paid, costBasis: 0, resolutionId: null, note: 'Zawiązanie spółki' });
  return eventId;
}

/** Nowe udziały z podwyższenia kapitału — dopiero po wpisie do KRS (art. 262 § 4 KSH). Zwiększa liczbę udziałów i kapitał spółki. */
export function grantIssuedShares(s: GameState, c: Company, holderId: string, count: number, paid: Grosze, date: IsoDate, resolutionId: string | null): string {
  if (count < 1) throw new Error('Emisja musi obejmować co najmniej 1 udział');
  const eventId = newEventId(s);
  const h = ensureHolding(s, c, holderId);
  h.count += count;
  h.lots.push({ id: `lot:${eventId}`, count, acquiredOn: date, via: 'issue', paid, eventId });
  h.history.push({ date, kind: 'acquire', count, eventId, note: 'objęcie nowych udziałów (podwyższenie kapitału)' });
  const nominalTotal = count * c.nominal;
  c.shareCount += count;
  c.capital += nominalTotal;
  c.supplementary += paid - nominalTotal;
  s.corp.shareEvents.push({ id: eventId, companyId: c.id, date, kind: 'issue', fromId: null, toId: holderId, count, nominal: c.nominal, price: paid, costBasis: 0, resolutionId, note: 'Podwyższenie kapitału zakładowego' });
  return eventId;
}

export interface TransferResult { eventId: string; costBasisRemoved: Grosze }

/**
 * Przeniesienie istniejących udziałów między wspólnikami (zapłata trafia do sprzedającego, nie do spółki). Koszt nabycia sprzedającego usuwany metodą FIFO.
 * `key` zabezpiecza przed podwójnym wykonaniem tej samej transakcji.
 */
export function transferShares(s: GameState, companyId: string, fromId: string, toId: string, count: number, price: Grosze, date: IsoDate, key: string, note: string, resolutionId: string | null = null): TransferResult {
  const c = companyOf(s, companyId);
  if (s.processed[`shares:${key}`]) throw new Error(`Podwójne przeniesienie udziałów: ${key}`);
  if (fromId === toId) throw new CommandError('Zbywca i nabywca muszą być różnymi osobami.');
  if (!Number.isInteger(count) || count < 1) throw new CommandError('Liczba udziałów musi być dodatnią liczbą całkowitą.');
  const from = holdingOf(s, companyId, fromId);
  if (!from || from.count < count) throw new CommandError(`${holderName(s, fromId)} nie posiada ${count} udziałów (posiada ${from?.count ?? 0}) — nie można zbyć udziałów, których się nie ma.`);
  const lock = from.restrictions.find((r) => r.kind === 'lockup' && (r.until === null || r.until > date));
  if (lock) throw new CommandError(`Udziały są objęte ograniczeniem zbywania${lock.until ? ` do ${lock.until}` : ''}: ${lock.note}`);
  if (from.restrictions.some((r) => r.kind === 'pledge')) throw new CommandError('Udziały są zastawione — zbycie niemożliwe.');
  s.processed[`shares:${key}`] = true;
  const eventId = newEventId(s);
  let left = count;
  let removed = 0;
  for (const lot of from.lots) {
    if (left === 0) break;
    const take = Math.min(left, lot.count);
    const cost = take === lot.count ? lot.paid : roundDiv(lot.paid * take, lot.count);
    lot.count -= take;
    lot.paid -= cost;
    removed += cost;
    left -= take;
  }
  from.lots = from.lots.filter((l) => l.count > 0);
  from.count -= count;
  from.history.push({ date, kind: 'dispose', count, eventId, note });
  const to = ensureHolding(s, c, toId);
  to.count += count;
  to.lots.push({ id: `lot:${eventId}`, count, acquiredOn: date, via: 'purchase', paid: price, eventId });
  to.history.push({ date, kind: 'acquire', count, eventId, note });
  s.corp.shareEvents.push({ id: eventId, companyId, date, kind: 'transfer', fromId, toId, count, nominal: c.nominal, price, costBasis: removed, resolutionId, note });
  logEvent(s, {
    id: `corp.shares:${eventId}`, date, type: 'corp.shares', tone: 'neutral',
    title: `Przeniesienie udziałów: ${count} szt. — ${c.name} sp. z o.o.`,
    detail: `${holderName(s, fromId)} → ${holderName(s, toId)} · cena ${(price / 100).toFixed(2)} zł (zapłata trafia do zbywcy, nie do spółki)`, amount: null, category: null,
  });
  syncSole(s, c, date);
  return { eventId, costBasisRemoved: removed };
}

/** Kontrola spójności rejestru udziałów (używana przez niezmienniki). */
export function shareRegistryErrors(s: GameState): string[] {
  const errors: string[] = [];
  const holdingKeys = new Set<string>();
  const eventIds = new Set<string>();
  for (const e of s.corp.shareEvents) {
    if (eventIds.has(e.id)) errors.push(`zduplikowane zdarzenie udziałowe ${e.id}`);
    eventIds.add(e.id);
  }
  for (const h of s.corp.holdings) {
    const k = `${h.companyId}:${h.holderId}`;
    if (holdingKeys.has(k)) errors.push(`zduplikowany wiersz rejestru udziałów ${k}`);
    holdingKeys.add(k);
    const c = s.corp.companies.find((x) => x.id === h.companyId);
    if (!c) { errors.push(`rejestr udziałów: nieznana spółka ${h.companyId}`); continue; }
    if (h.nominal !== c.nominal) errors.push(`rejestr udziałów ${h.id}: wartość nominalna ${h.nominal} ≠ ${c.nominal}`);
    const lotSum = h.lots.reduce((a, l) => a + l.count, 0);
    if (lotSum !== h.count) errors.push(`rejestr udziałów ${h.id}: partie (${lotSum}) ≠ liczba udziałów (${h.count})`);
    if (h.count > 0 && c.status === 'draft') errors.push(`rejestr udziałów ${h.id}: udziały w spółce w stanie szkicu`);
    if (h.nominal < 5_000) errors.push(`rejestr udziałów ${h.id}: wartość nominalna poniżej 50 zł`);
    const bought = h.history.filter((x) => x.kind === 'acquire').reduce((a, x) => a + x.count, 0);
    const sold = h.history.filter((x) => x.kind === 'dispose').reduce((a, x) => a + x.count, 0);
    if (bought - sold !== h.count) errors.push(`rejestr udziałów ${h.id}: historia (${bought} − ${sold}) ≠ stan ${h.count}`);
    for (const ev of h.history) if (!eventIds.has(ev.eventId)) errors.push(`rejestr udziałów ${h.id}: historia wskazuje nieznane zdarzenie ${ev.eventId}`);
  }
  for (const c of s.corp.companies) {
    if (c.status === 'draft') continue;
    const held = totalHeldShares(s, c.id);
    if (held !== c.shareCount) errors.push(`spółka ${c.id}: suma udziałów w rejestrze (${held}) ≠ liczba udziałów spółki (${c.shareCount})`);
    if (c.shareCount * c.nominal !== c.capital) errors.push(`spółka ${c.id}: liczba × nominał (${c.shareCount * c.nominal}) ≠ kapitał zakładowy (${c.capital})`);
    if (c.capital < 500_000) errors.push(`spółka ${c.id}: kapitał zakładowy poniżej 5 000 zł`);
    if (c.nominal < 5_000) errors.push(`spółka ${c.id}: wartość nominalna udziału poniżej 50 zł`);
    // historia zdarzeń musi sumować się do stanu: założycielskie + emisje − 0 (przeniesienia nie zmieniają sumy)
    const issued = s.corp.shareEvents.filter((e) => e.companyId === c.id && (e.kind === 'founding' || e.kind === 'issue')).reduce((a, e) => a + e.count, 0);
    if (issued !== c.shareCount) errors.push(`spółka ${c.id}: udziały z zawiązania i emisji (${issued}) ≠ liczba udziałów spółki (${c.shareCount})`);
    for (const h of s.corp.holdings) if (h.companyId === c.id) {
      const inFromEvents = s.corp.shareEvents.filter((e) => e.companyId === c.id && e.toId === h.holderId).reduce((a, e) => a + e.count, 0)
        - s.corp.shareEvents.filter((e) => e.companyId === c.id && e.fromId === h.holderId).reduce((a, e) => a + e.count, 0);
      if (inFromEvents !== h.count) errors.push(`rejestr udziałów ${h.id}: zdarzenia dają ${inFromEvents} udziałów, rejestr ${h.count}`);
    }
  }
  return errors;
}
