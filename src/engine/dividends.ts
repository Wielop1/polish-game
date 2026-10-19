import { CORP } from './corpConfig.ts';
import { distributable, refreshValuation, roundToZl } from './companyFinance.ts';
import { CommandError, createObligation, ensureParty, logEvent, nextCounter, settleOne } from './core.ts';
import { dateInMonth, parseIso } from './date.ts';
import type { IsoDate } from './date.ts';
import { formatPLN, mulBps } from './money.ts';
import { holderName, partnerById } from './partners.ts';
import { activeHoldings, totalHeldShares } from './shares.ts';
import type { Company, Dividend, GameState, Resolution } from './state.ts';

/**
 * Dywidendy (v0.8): uchwała wspólników o podziale zysku → weryfikacja kwoty do podziału (art. 192 KSH, art. 189 § 2) i gotówki →
 * naliczenie zryczałtowanego podatku 19% od dywidend osób fizycznych (pobiera spółka) → termin wypłaty → przelew netto do wspólników.
 * Wypłata dywidendy nie jest kosztem operacyjnym spółki (nie wpływa na podstawę CIT) — pomniejsza kapitały własne.
 * Zobowiązanie spółki wobec wspólnika i należność gracza są rozliczane razem: gracz dostaje dywidendę dopiero, gdy spółka ją faktycznie zapłaciła.
 */

export const DIV_RULE_PREFIX = 'div:';

export function validateAllocation(s: GameState, c: Company, p: { year: number; dividendGross: number; toReserve: number; payDay: IsoDate }): string | null {
  const y = c.yearResults.find((x) => x.year === p.year);
  if (!y) return `Rok obrotowy ${p.year} nie został jeszcze zamknięty.`;
  if (!c.statementsApproved.includes(p.year)) return `Najpierw zgromadzenie wspólników musi zatwierdzić sprawozdanie finansowe za ${p.year} (art. 231 § 2 KSH).`;
  if (p.dividendGross < 0 || p.toReserve < 0 || p.dividendGross + p.toReserve === 0) return 'Podaj kwotę dywidendy lub przeniesienia na kapitał zapasowy.';
  const d = distributable(s, c, p.payDay);
  if (p.dividendGross + p.toReserve > d.retained) return `Kwota do podziału wynosi ${formatPLN(d.retained)} (zysk za ostatni rok + niepodzielone zyski − straty − wcześniejsze wypłaty, art. 192 KSH).`;
  if (p.dividendGross > d.byCapital) return `Wypłata obniżyłaby aktywa netto poniżej kapitału zakładowego (dostępne ${formatPLN(d.byCapital)}; art. 189 § 2 KSH).`;
  if (p.dividendGross > d.byCash) return `Spółka nie ma tyle wolnej gotówki (dostępne ${formatPLN(d.byCash)} po zobowiązaniach wymagalnych do dnia wypłaty) — zysk księgowy to nie gotówka.`;
  return null;
}

/** Wykonanie uchwały o podziale zysku (po jej podjęciu). */
export function declareDividend(s: GameState, c: Company, r: Resolution, date: IsoDate): string {
  if (r.payload.type !== 'allocate_profit') throw new Error('Nieprawidłowa uchwała');
  const p = r.payload;
  const err = validateAllocation(s, c, p);
  if (err) throw new CommandError(err);
  if (p.payDay < date) throw new CommandError('Termin wypłaty dywidendy już minął.');
  const dist = distributable(s, c, p.payDay);
  const holders = activeHoldings(s, c.id);
  const total = totalHeldShares(s, c.id);
  if (p.toReserve > 0) c.supplementary += p.toReserve;
  if (p.dividendGross === 0) return `Przeniesiono ${formatPLN(p.toReserve)} na kapitał zapasowy.`;
  // zysk dzieli się proporcjonalnie do udziałów (art. 191 § 3); reszta z zaokrągleń trafia do największego udziałowca
  const rows = holders.map((h) => ({ h, gross: Math.floor((p.dividendGross * h.count) / total) }));
  const diff = p.dividendGross - rows.reduce((a, x) => a + x.gross, 0);
  const biggest = rows.reduce((a, x) => (x.h.count > a.h.count ? x : a), rows[0]!);
  biggest.gross += diff;
  const id = `div:${nextCounter(s, 'dividend')}`;
  ensureParty(s, { id: 'party:us', name: 'Urząd Skarbowy', role: 'service' });
  const lines: Dividend['lines'] = [];
  let taxTotal = 0;
  for (const row of rows) {
    if (row.gross <= 0) continue;
    // podatek zryczałtowany 19% (osoby fizyczne), pobierany przez spółkę jako płatnika; zaokrąglenie do pełnych złotych
    const tax = roundToZl(mulBps(row.gross, CORP.dividendTaxBps));
    const net = row.gross - tax;
    const partyId = `party:holder:${row.h.holderId}`;
    ensureParty(s, { id: partyId, name: holderName(s, row.h.holderId), role: 'service' });
    const ob = createObligation(s, {
      occurrenceId: `${id}:${row.h.holderId}:pay`, ruleId: `${DIV_RULE_PREFIX}${id}`, direction: 'payable', counterpartyId: partyId, accountId: c.accountId, scope: 'company', amount: net,
      issueDate: date, dueDate: p.payDay, category: 'dywidenda_wyplata', description: `Dywidenda za ${p.year} dla ${holderName(s, row.h.holderId)} (netto, po podatku ${formatPLN(tax, { round: true })})`,
    });
    let receivableId: string | null = null;
    if (row.h.holderId === s.person.id) {
      const rc = createObligation(s, {
        occurrenceId: `${id}:${row.h.holderId}:recv`, ruleId: `${DIV_RULE_PREFIX}${id}:recv`, direction: 'receivable', counterpartyId: c.partyId, accountId: s.playerAccountId, scope: 'personal', amount: net,
        issueDate: date, dueDate: p.payDay, category: 'dywidenda', description: `Dywidenda z ${c.name} sp. z o.o. za ${p.year} (netto)`,
      });
      receivableId = rc?.id ?? null;
    }
    taxTotal += tax;
    lines.push({ holderId: row.h.holderId, shares: row.h.count, gross: row.gross, tax, net, obligationId: ob!.id, receivableId });
  }
  const pay = parseIso(p.payDay);
  const next = pay.month === 12 ? { y: pay.year + 1, m: 1 } : { y: pay.year, m: pay.month + 1 };
  const taxDue = dateInMonth(next.y, next.m, CORP.dividendTaxDueDay);
  let taxId: string | null = null;
  if (taxTotal > 0) {
    const t = createObligation(s, {
      occurrenceId: `${id}:tax`, ruleId: `${DIV_RULE_PREFIX}${id}:tax`, direction: 'payable', counterpartyId: 'party:us', accountId: c.accountId, scope: 'company', amount: taxTotal,
      issueDate: date, dueDate: taxDue, category: 'dywidenda_podatek', description: `Zryczałtowany podatek 19% od dywidend za ${p.year} (${c.name} sp. z o.o. jako płatnik)`,
    });
    taxId = t?.id ?? null;
  }
  const d: Dividend = {
    id, companyId: c.id, year: p.year, resolutionId: r.id, grossTotal: p.dividendGross, declaredOn: date, dividendDay: p.dividendDay, payDay: p.payDay, taxDueDay: taxDue,
    distributableAtDeclaration: dist.retained, lines, taxObligationId: taxId, status: 'declared',
  };
  s.corp.dividends.push(d);
  refreshValuation(s, c, date);
  logEvent(s, {
    id: `corp.dividend:${id}`, date, type: 'corp.dividend', tone: 'positive',
    title: `Dywidenda uchwalona: ${formatPLN(p.dividendGross, { round: true })} brutto (${c.name} sp. z o.o.)`,
    detail: `Podatek zryczałtowany 19% (${formatPLN(taxTotal, { round: true })}) pobiera spółka · wypłata netto do ${p.payDay} · wspólnicy: ${lines.map((l) => `${holderName(s, l.holderId)} ${formatPLN(l.net, { round: true })}`).join(', ')}`.slice(0, 290),
    amount: null, category: null,
  });
  return `Uchwalono dywidendę ${formatPLN(p.dividendGross)} brutto (netto do wspólników ${formatPLN(p.dividendGross - taxTotal)}), wypłata ${p.payDay}.`;
}

/**
 * Po rozliczeniach dnia: gdy spółka zapłaciła wspólnikowi dywidendę, rozliczamy jego należność (gracz) albo zwiększamy jego kapitał prywatny (postać AI).
 * Dzięki temu pieniądze gracza pojawiają się dopiero wtedy, gdy spółka je faktycznie wypłaciła — nie ma dywidendy „z powietrza”.
 */
export function syncDividends(s: GameState, date: IsoDate): void {
  for (const d of s.corp.dividends) {
    if (d.status === 'paid') continue;
    let allPaid = true;
    for (const l of d.lines) {
      const payable = s.obligations.find((o) => o.id === l.obligationId)!;
      if (payable.status !== 'settled') { allPaid = false; continue; }
      if (l.holderId === s.person.id) {
        const rc = l.receivableId ? s.obligations.find((o) => o.id === l.receivableId) : undefined;
        if (rc && rc.status === 'open') settleOne(s, rc, date);
      } else {
        const key = `div:credit:${d.id}:${l.holderId}`;
        if (!s.processed[key]) {
          s.processed[key] = true;
          const p = partnerById(s, l.holderId);
          if (p) p.capital += l.net;
        }
      }
    }
    const tax = d.taxObligationId ? s.obligations.find((o) => o.id === d.taxObligationId) : null;
    if (allPaid && (!tax || tax.status === 'settled')) d.status = 'paid';
  }
}
