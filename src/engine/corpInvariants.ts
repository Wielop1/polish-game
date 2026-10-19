import { CORP } from './corpConfig.ts';
import { passes } from './resolutions.ts';
import { shareRegistryErrors } from './shares.ts';
import type { GameState } from './state.ts';

/** Zrealizowany zysk (cena − koszt nabycia) ze sprzedaży udziałów przez gracza — składnik tożsamości księgowej majątku netto. */
export function realizedShareGains(s: GameState): number {
  return s.corp.shareEvents.reduce((a, e) => a + (e.kind === 'transfer' && e.fromId === s.person.id ? e.price - e.costBasis : 0), 0);
}

/**
 * Niezmienniki spółek (v0.8): rejestr udziałów, odrębność majątku, przepływy między osobą a spółką (tylko z podstawą), uchwały (progi i jednokrotne wykonanie),
 * dywidendy (brak duplikatów, kwoty), CIT (saldo, straty), historia zmian.
 */
export function corpInvariantErrors(s: GameState): string[] {
  const errors: string[] = [];
  const fail = (m: string) => errors.push(m);
  if (s.corp.context !== null) fail(`kontekst operatora ${s.corp.context} nie został przywrócony`);
  errors.push(...shareRegistryErrors(s));
  if (s.corp.companies.length === 0 && s.corp.holdings.length === 0) {
    for (const p of s.corp.partners) if (p.capital < 0) fail(`postać ${p.id}: ujemny kapitał`);
    return errors;
  }
  const ids = new Set<string>();
  const personIds = new Set<string>([s.person.id, ...s.corp.partners.map((p) => p.id)]);
  for (const p of s.corp.partners) {
    if (p.capital < 0) fail(`postać ${p.id}: ujemny kapitał`);
    if (ids.has(p.id)) fail(`zduplikowana postać ${p.id}`);
    ids.add(p.id);
  }
  const accOwner = (id: string) => s.accounts[id]?.ownerId;
  for (const c of s.corp.companies) {
    if (ids.has(c.id)) fail(`zduplikowana spółka ${c.id}`);
    ids.add(c.id);
    const acc = s.accounts[c.accountId];
    if (!acc || acc.type !== 'company' || acc.ownerId !== c.id) fail(`spółka ${c.id}: rachunek musi należeć do spółki (odrębny podmiot prawny)`);
    if (c.status === 'draft' && (c.board.length > 0 || c.agreementOn !== null)) fail(`spółka ${c.id}: szkic z zarządem lub umową`);
    if (c.status !== 'draft' && c.agreementOn === null) fail(`spółka ${c.id}: bez daty zawarcia umowy`);
    if (c.status === 'registered' && (!c.registeredOn || !c.krsNumber)) fail(`spółka ${c.id}: zarejestrowana bez wpisu`);
    if (c.status === 'organizing' && c.registeredOn) fail(`spółka ${c.id}: w organizacji, a ma datę wpisu`);
    if (c.operation && c.status !== 'registered') fail(`spółka ${c.id}: prowadzi działalność przed wpisem do KRS`);
    if (c.operation && (c.operation.ownerId !== c.id || c.operation.accountId !== c.accountId)) fail(`spółka ${c.id}: działalność nie należy do spółki`);
    const active = c.board.filter((m) => m.endedOn === null);
    if (c.status !== 'draft' && c.status !== 'closed' && active.length === 0) fail(`spółka ${c.id}: brak zarządu`);
    if (active.length > CORP.maxBoard) fail(`spółka ${c.id}: zbyt wielu członków zarządu`);
    if (active.length > 0 && active.filter((m) => m.role === 'president').length !== 1) fail(`spółka ${c.id}: musi być dokładnie jeden prezes spośród członków zarządu`);
    const seen = new Set<string>();
    for (const m of active) {
      if (seen.has(m.personId)) fail(`spółka ${c.id}: ${m.personId} dwa razy w zarządzie`);
      seen.add(m.personId);
      if (!personIds.has(m.personId)) fail(`spółka ${c.id}: nieznany członek zarządu ${m.personId}`);
    }
    // kapitał: wpłaty wspólników (rejestr) + oczekujące podwyższenie = wpływy kapitałowe na rachunek spółki
    let inflow = 0;
    for (const t of s.ledger) if (t.accountId === c.accountId && (t.category === 'wklad_kapitalowy' || t.category === 'wplaty_podwyzszenie')) inflow += t.amount;
    const paidIn = s.corp.shareEvents.filter((e) => e.companyId === c.id && e.kind !== 'transfer').reduce((a, e) => a + e.price, 0);
    if (c.status !== 'draft' && inflow !== paidIn + (c.pendingIncrease?.contribution ?? 0)) fail(`spółka ${c.id}: wpływy kapitałowe ${inflow} ≠ wkłady w rejestrze ${paidIn} + oczekujące ${c.pendingIncrease?.contribution ?? 0}`);
    // kapitał zapasowy = nadwyżki ponad nominał + przeniesienia z zysku
    const agio = s.corp.shareEvents.filter((e) => e.companyId === c.id && e.kind !== 'transfer').reduce((a, e) => a + e.price - e.count * e.nominal, 0);
    const toReserve = s.corp.resolutions.filter((r) => r.companyId === c.id && r.status === 'executed' && r.payload.type === 'allocate_profit').reduce((a, r) => a + (r.payload.type === 'allocate_profit' ? r.payload.toReserve : 0), 0);
    if (c.status !== 'draft' && c.supplementary !== agio + toReserve) fail(`spółka ${c.id}: kapitał zapasowy ${c.supplementary} ≠ nadwyżki ${agio} + przeniesienia ${toReserve}`);
    if (c.pendingIncrease && c.status !== 'registered') fail(`spółka ${c.id}: podwyższenie kapitału przed wpisem spółki`);
    for (let i = 1; i < c.yearResults.length; i++) if (c.yearResults[i]!.year <= c.yearResults[i - 1]!.year) fail(`spółka ${c.id}: lata obrotowe nie rosną`);
    for (const y of c.statementsApproved) if (!c.yearResults.some((r) => r.year === y)) fail(`spółka ${c.id}: zatwierdzono sprawozdanie za niezamknięty rok ${y}`);
    let prev = '';
    for (const h of c.soleHistory) {
      if (h.from < prev || (h.to !== null && h.to < h.from)) fail(`spółka ${c.id}: nieprawidłowa historia jedynego wspólnika`);
      prev = h.to ?? '9999-12-31';
    }
  }
  // przepływy między osobą a spółką: wyłącznie z podstawą (wkład na kapitał); brak ukrytych przelewów
  const coAccounts = new Set(s.corp.companies.map((c) => c.accountId));
  const coTransfers = new Set<string>();
  for (const t of s.ledger) {
    if (!coAccounts.has(t.accountId)) continue;
    if (t.transferId) coTransfers.add(t.transferId);
    if (t.category === 'przelew_wlasny') fail(`transakcja ${t.id}: przelew własny na rachunku spółki`);
  }
  if (coTransfers.size > 0) {
    const byTransfer = new Map<string, { owner: string | undefined; category: string }[]>();
    for (const t of s.ledger) if (t.transferId && coTransfers.has(t.transferId)) {
      const legs = byTransfer.get(t.transferId) ?? [];
      legs.push({ owner: accOwner(t.accountId), category: t.category });
      byTransfer.set(t.transferId, legs);
    }
    for (const [tid, legs] of byTransfer) if (new Set(legs.map((l) => l.owner)).size > 1 && legs.some((l) => l.category !== 'wklad_kapitalowy')) fail(`przelew ${tid} między osobą a spółką bez podstawy (dozwolony tylko wkład na kapitał)`);
  }
  // uchwały
  const resIds = new Set<string>();
  const execByKey = new Set<string>();
  for (const r of s.corp.resolutions) {
    if (resIds.has(r.id)) fail(`zduplikowana uchwała ${r.id}`);
    resIds.add(r.id);
    if (!s.corp.companies.some((c) => c.id === r.companyId)) fail(`uchwała ${r.id}: nieznana spółka`);
    if (r.status === 'executed' || r.status === 'passed' || r.status === 'failed') {
      if (!r.tally) { fail(`uchwała ${r.id}: podjęta bez wyniku głosowania`); continue; }
      const eligible = r.voters.filter((v) => !v.excluded).reduce((a, v) => a + v.votes, 0);
      if (!passes(r.threshold.kind, r.tally, eligible).ok) fail(`uchwała ${r.id}: wykonana mimo braku wymaganej większości (${r.threshold.kind})`);
    }
    if (r.status === 'rejected' && r.executedOn !== null) fail(`uchwała ${r.id}: odrzucona, a wykonana`);
    if (r.status === 'executed') {
      const key = JSON.stringify([r.companyId, r.id]);
      if (execByKey.has(key)) fail(`uchwała ${r.id}: wykonana dwa razy`);
      execByKey.add(key);
    }
    for (const v of r.votes) if (!r.voters.some((x) => x.holderId === v.holderId)) fail(`uchwała ${r.id}: głos oddany przez nieuprawnionego ${v.holderId}`);
    if (new Set(r.votes.map((v) => v.holderId)).size !== r.votes.length) fail(`uchwała ${r.id}: wielokrotne głosy tego samego wspólnika`);
  }
  // dywidendy
  const divByRes = new Set<string>();
  for (const d of s.corp.dividends) {
    const r = s.corp.resolutions.find((x) => x.id === d.resolutionId);
    if (!r || r.status !== 'executed' || r.payload.type !== 'allocate_profit') fail(`dywidenda ${d.id}: brak wykonanej uchwały o podziale zysku`);
    if (divByRes.has(d.resolutionId)) fail(`dywidenda ${d.id}: ta sama uchwała wypłacona dwa razy`);
    divByRes.add(d.resolutionId);
    if (d.lines.reduce((a, l) => a + l.gross, 0) !== d.grossTotal) fail(`dywidenda ${d.id}: linie nie sumują się do kwoty brutto`);
    if (d.grossTotal > d.distributableAtDeclaration) fail(`dywidenda ${d.id}: wypłata ${d.grossTotal} ponad kwotę do podziału ${d.distributableAtDeclaration}`);
    for (const l of d.lines) {
      if (l.net + l.tax !== l.gross) fail(`dywidenda ${d.id}: netto + podatek ≠ brutto dla ${l.holderId}`);
      const ob = s.obligations.find((o) => o.id === l.obligationId);
      if (!ob || ob.amount !== l.net || ob.category !== 'dywidenda_wyplata') fail(`dywidenda ${d.id}: brak zobowiązania wypłaty dla ${l.holderId}`);
      if (l.receivableId) {
        const rc = s.obligations.find((o) => o.id === l.receivableId);
        if (!rc || rc.amount !== l.net) fail(`dywidenda ${d.id}: należność gracza niezgodna z wypłatą`);
        else if (rc.status === 'settled' && ob?.status !== 'settled') fail(`dywidenda ${d.id}: gracz otrzymał dywidendę, której spółka jeszcze nie wypłaciła`);
      }
    }
    if (d.taxObligationId) {
      const t = s.obligations.find((o) => o.id === d.taxObligationId);
      if (!t || t.amount !== d.lines.reduce((a, l) => a + l.tax, 0)) fail(`dywidenda ${d.id}: podatek zryczałtowany niezgodny z liniami`);
    }
  }
  // CIT
  const retKeys = new Set<string>();
  for (const r of s.corp.citReturns) {
    const k = `${r.companyId}:${r.year}`;
    if (retKeys.has(k)) fail(`CIT-8 ${k}: zduplikowane zeznanie`);
    retKeys.add(k);
    if (r.balance !== r.tax - r.advances) fail(`CIT-8 ${k}: saldo ≠ podatek − zaliczki`);
    if (r.base % 100 !== 0 || r.tax % 100 !== 0) fail(`CIT-8 ${k}: podstawa i podatek w pełnych złotych`);
    if (r.rateBps !== CORP.citStandardBps && r.rateBps !== CORP.citSmallBps) fail(`CIT-8 ${k}: nieznana stawka ${r.rateBps}`);
    if (r.rateBps === CORP.citSmallBps && (r.revenue > CORP.citRevenueLimit2026 || (!r.smallTaxpayer && !r.startYear))) fail(`CIT-8 ${k}: stawka 9% bez spełnienia warunków (limit przychodów / status podatnika)`);
    if ((r.balance !== 0) !== (r.obligationId !== null)) fail(`CIT-8 ${k}: zobowiązanie niezgodne z saldem`);
  }
  for (const l of s.corp.citLosses) {
    let used = 0;
    const years = new Set<number>();
    for (const u of l.usages) {
      used += u.amount;
      if (years.has(u.year)) fail(`strata ${l.id}: dwa odliczenia w ${u.year}`);
      years.add(u.year);
      if (u.year <= l.year || u.year > l.year + 5) fail(`strata ${l.id}: odliczenie poza 5 latami`);
      if (u.amount * 2 > l.amount + 1) fail(`strata ${l.id}: odliczenie przekracza 50% straty`);
    }
    if (used > l.amount) fail(`strata ${l.id}: odliczono więcej niż strata`);
  }
  // negocjacje: umowa/wymiana zrealizowana ma ślad w rejestrze
  for (const n of s.corp.negotiations) {
    if (n.status === 'completed' && (n.kind === 'secondary_buy' || n.kind === 'secondary_sell') && !s.corp.shareEvents.some((e) => e.kind === 'transfer' && e.companyId === n.companyId && e.count === n.terms.shares && e.price === n.terms.amount)) fail(`negocjacja ${n.id}: zrealizowana bez przeniesienia udziałów`);
  }
  return errors;
}
