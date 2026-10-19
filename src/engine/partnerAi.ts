import { CORP } from './corpConfig.ts';
import { distributable } from './companyFinance.ts';
import { CommandError, logEvent, nextCounter } from './core.ts';
import { addDays, diffDays } from './date.ts';
import type { IsoDate } from './date.ts';
import { formatPLN, roundDiv } from './money.ts';
import { adjustTrust, holderName, partnerById } from './partners.ts';
import { scheduleResolution } from './resolutions.ts';
import { activeHoldings, holdingCost, holdingOf } from './shares.ts';
import type { Company, GameState } from './state.ts';

/**
 * Inicjatywy postaci AI (v0.8): wspólnicy mają własne interesy — wnioskują o dywidendę, gdy spółka ma z czego ją wypłacić, a oni preferują dochód,
 * chcą sprzedać udziały, gdy ich cel to wyjście z inwestycji i wycena wzrosła. Zaufanie zmienia się wyłącznie z konkretnych powodów
 * ekonomicznych lub relacyjnych (wyniki spółki, zaległości, niewypłacane dywidendy) — nie ma losowych konfliktów bez uzasadnienia.
 */
export function reviewPartners(s: GameState, c: Company, date: IsoDate): void {
  if (c.status !== 'registered') return;
  const val = c.valuation;
  const profitable = (val?.profit12 ?? 0) > 0 && (val?.months ?? 0) >= 3;
  const overdue = s.obligations.some((o) => o.accountId === c.accountId && o.status === 'open' && o.direction === 'payable' && o.overdueSince !== null && diffDays(date, o.overdueSince) >= 30);
  const paidLast12m = s.corp.dividends.some((d) => d.companyId === c.id && diffDays(date, d.declaredOn) <= 365);
  const latestClosed = c.yearResults.at(-1)?.year ?? null;
  const approved = latestClosed !== null && c.statementsApproved.includes(latestClosed);
  const dist = approved ? distributable(s, c) : null;
  const open = s.corp.resolutions.some((r) => r.companyId === c.id && r.status === 'scheduled' && r.payload.type === 'allocate_profit');
  const month = date.slice(0, 7);
  for (const h of activeHoldings(s, c.id)) {
    const p = partnerById(s, h.holderId);
    if (!p || p.lastReviewMonth === month) continue;
    p.lastReviewMonth = month;
    // zaufanie: wyniki spółki i zgodność z interesem postaci
    if (profitable && (p.goal !== 'income' || paidLast12m)) adjustTrust(s, p.id, 1, `${c.name} sp. z o.o. wypracowuje zysk${p.goal === 'income' ? ' i wypłaca dywidendy' : ''}`);
    if (overdue) adjustTrust(s, p.id, -1, `${c.name} sp. z o.o. ma zaległe zobowiązania powyżej 30 dni`);
    if (p.goal === 'income' && dist && dist.max >= 100_000 && !open && !paidLast12m && p.dividendPreference >= 55) adjustTrust(s, p.id, -1, 'Spółka ma zysk do podziału, ale nie wypłaca dywidend');
    // wniosek o dywidendę
    const lastProposal = s.corp.resolutions.filter((r) => r.companyId === c.id && r.proposedBy === p.id && r.payload.type === 'allocate_profit').at(-1);
    const recently = lastProposal && diffDays(date, lastProposal.proposedOn) < 300;
    if (dist && dist.max >= Math.max(100_000, Math.round(dist.retained / 10)) && p.dividendPreference >= 55 && p.trust >= 35 && !open && !recently && h.count * 10_000 >= c.shareCount * 1_000) {
      const gross = Math.round((dist.max * Math.min(100, p.dividendPreference)) / 100 / 10_000) * 10_000;
      if (gross >= 100_000) {
        const assembly = addDays(date, CORP.assemblyNoticeDays);
        try {
          scheduleResolution(s, c, { type: 'allocate_profit', year: latestClosed!, dividendGross: gross, toReserve: 0, dividendDay: assembly, payDay: addDays(assembly, 14) }, p.id,
            `Wniosek wspólnika: dywidenda ${formatPLN(gross, { round: true })} za ${latestClosed}`);
          logEvent(s, { id: `corp.partner:${p.id}:div:${month}`, date, type: 'corp.partner', tone: 'neutral', title: `${holderName(s, p.id)} wnioskuje o dywidendę ${formatPLN(gross, { round: true })}`, detail: `Preferuje dochód z dywidend (${p.dividendPreference}/100); spółka ma do podziału ${formatPLN(dist.retained, { round: true })}.`, amount: null, category: null });
        } catch (e) { if (!(e instanceof CommandError)) throw e; }
      }
    }
    // chęć sprzedaży udziałów: cel „wyjście”, upłynęła część horyzontu, wycena wyraźnie wyższa niż cena wejścia
    const mine = holdingOf(s, c.id, p.id)!;
    const cost = holdingCost(mine);
    const worth = val && c.shareCount > 0 ? roundDiv(val.estimate * mine.count, c.shareCount) : 0;
    const since = mine.lots[0]?.acquiredOn ?? date;
    const waited = diffDays(date, since) >= (p.horizonMonths * 30) / 3;
    const hasOffer = s.corp.negotiations.some((n) => n.companyId === c.id && n.partnerId === p.id && n.kind === 'secondary_buy' && (n.status === 'open' || n.status === 'countered' || n.status === 'agreed'));
    const askedRecently = s.corp.negotiations.some((n) => n.companyId === c.id && n.partnerId === p.id && n.kind === 'secondary_buy' && diffDays(date, n.openedOn) < 365);
    if (p.goal === 'exit' && waited && worth >= Math.round(cost * 1.25) && !hasOffer && !askedRecently) {
      const ask = Math.round((worth * 1.05) / 100) * 100;
      const id = `neg:${nextCounter(s, 'negotiation')}`;
      const terms = { shares: mine.count, amount: ask, percentBps: Math.round((mine.count * 10_000) / c.shareCount), role: 'none' as const, dividendPolicy: 'none' as const };
      s.corp.negotiations.push({
        id, kind: 'secondary_buy', companyId: c.id, partnerId: p.id, status: 'countered', terms, rounds: [{ by: 'partner', date, terms, note: 'Wspólnik chce sprzedać udziały' }],
        openedOn: date, expiresOn: addDays(date, CORP.negotiationDays), resolutionId: null,
        reason: `Chce wyjść z inwestycji: wycena jego pakietu wzrosła z ${formatPLN(cost, { round: true })} do ok. ${formatPLN(worth, { round: true })}; prosi o ${formatPLN(ask, { round: true })}.`,
      });
      logEvent(s, { id: `corp.partner:${p.id}:sell:${month}`, date, type: 'corp.partner', tone: 'neutral', title: `${holderName(s, p.id)} chce sprzedać udziały ${c.name} sp. z o.o.`, detail: `Prosi o ${formatPLN(ask, { round: true })} za ${mine.count} udz. Możesz kupić pakiet (PCC 1% płacisz Ty) albo zignorować ofertę.`, amount: null, category: null });
    }
  }
}
