import { useState } from 'react';
import { commands } from '../../engine/commands.ts';
import { citAdvancesAccrued, citRateFor, companyBalance, companyTaxFigures, dealValuation, distributable, lossAvailable } from '../../engine/companyFinance.ts';
import { CORP, RESOLUTION_LABELS } from '../../engine/corpConfig.ts';
import { addDays, formatDatePL, parseIso } from '../../engine/date.ts';
import { formatPLN, mulBps, zl } from '../../engine/money.ts';
import { issuePriceEach, KIND_LABEL, STATUS_LABEL as NEG_STATUS_LABEL, subscriptionTerms } from '../../engine/negotiation.ts';
import { holderName } from '../../engine/partners.ts';
import { THRESHOLD_LABEL } from '../../engine/resolutions.ts';
import { activeHoldings, capitalBps, holdingOf } from '../../engine/shares.ts';
import type { Company, Negotiation, ResolutionPayload } from '../../engine/state.ts';
import { useGameStore } from '../../store/gameStore.ts';
import { Badge, Button, Card, Empty, Money, ScreenHeader, StatCard, cx } from '../components/ui.tsx';
import { LegalBadge } from './BusinessScreens.tsx';
import { CompanyPicker, CorpBanner, Field, NoCompany, Row, Th, inputCls, pct, useCorp } from './CorpCommon.tsx';

const RES_STATUS = { scheduled: 'zgromadzenie zwołane', passed: 'przyjęta', rejected: 'odrzucona', executed: 'przyjęta i wykonana', failed: 'przyjęta, niewykonalna', cancelled: 'odwołana' } as const;
const RES_TONE = { scheduled: 'sky', passed: 'gain', rejected: 'loss', executed: 'gain', failed: 'gold', cancelled: 'neutral' } as const;
const VOTE_LABEL = { for: 'za', against: 'przeciw', abstain: 'wstrzymał się', invalid: 'głos nieważny', not_cast: 'głos nieoddany' } as const;

/* ---------- 6. Uchwały ---------- */

function NewResolution({ c }: { c: Company }) {
  const { game, run } = useCorp();
  const [type, setType] = useState<'approve_statements' | 'allocate_profit' | 'capital_increase' | 'consent_acquisition'>('approve_statements');
  const unapproved = c.yearResults.filter((y) => !c.statementsApproved.includes(y.year));
  const [year, setYear] = useState<number>(unapproved[0]?.year ?? c.statementsApproved.at(-1) ?? new Date().getFullYear());
  const approvedYears = c.statementsApproved;
  const [gross, setGross] = useState(0);
  const [reserve, setReserve] = useState(0);
  const [payIn, setPayIn] = useState(14);
  const [maxAmt, setMaxAmt] = useState(100_000);
  const [months, setMonths] = useState(12);
  const agreed = game.corp.negotiations.filter((n) => n.companyId === c.id && n.kind === 'subscribe' && n.status === 'agreed' && !n.resolutionId);
  const [negId, setNegId] = useState<string>('');
  const sole = activeHoldings(game, c.id).length === 1;
  const assembly = sole ? game.clock.today : addDays(game.clock.today, CORP.assemblyNoticeDays);
  const payDay = addDays(assembly, payIn);
  const dist = distributable(game, c, payDay);
  const neg = agreed.find((n) => n.id === (negId || agreed[0]?.id));
  const tax = mulBps(zl(gross), CORP.dividendTaxBps);
  let payload: ResolutionPayload | null = null;
  if (type === 'approve_statements' && unapproved.length > 0) payload = { type, year: unapproved.some((y) => y.year === year) ? year : unapproved[0]!.year };
  if (type === 'allocate_profit' && approvedYears.length > 0) payload = { type, year: approvedYears.includes(year) ? year : approvedYears.at(-1)!, dividendGross: zl(gross), toReserve: zl(reserve), dividendDay: assembly, payDay };
  if (type === 'capital_increase' && neg) payload = { type, negotiationId: neg.id, subscriberId: neg.partnerId, shares: neg.terms.shares, issuePriceEach: issuePriceEach(neg.terms) };
  if (type === 'consent_acquisition') payload = { type, label: 'Nabycie środków trwałych', maxAmount: zl(maxAmt), validUntil: addDays(assembly, months * 30) };
  return (
    <Card title="Nowa uchwała wspólników">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Rodzaj uchwały">
        {(['approve_statements', 'allocate_profit', 'capital_increase', 'consent_acquisition'] as const).map((t) => (
          <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)} className={cx('rounded-xl border px-3 py-1.5 text-sm', type === t ? 'border-sky bg-sky/10 text-white' : 'border-ink-600 text-slate-300 hover:border-ink-500')}>{RESOLUTION_LABELS[t]}</button>
        ))}
      </div>
      <div className="mt-4 space-y-3 text-sm">
        {type === 'approve_statements' && (unapproved.length === 0 ? <Empty>Brak zamkniętych lat obrotowych do zatwierdzenia (rok obrotowy zamykany jest 31 grudnia).</Empty> : (
          <Field label="Rok obrotowy" id="res-year"><select id="res-year" value={year} onChange={(e) => setYear(Number(e.target.value))} className={cx(inputCls, 'w-40')}>{unapproved.map((y) => <option key={y.year} value={y.year}>{y.year} (wynik {formatPLN(y.netProfit, { round: true })})</option>)}</select></Field>
        ))}
        {type === 'allocate_profit' && (approvedYears.length === 0 ? <Empty>Najpierw zgromadzenie musi zatwierdzić sprawozdanie finansowe (art. 231 § 2 KSH).</Empty> : (
          <div>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Dywidenda brutto (zł)" id="res-gross" hint={`maks. ${formatPLN(dist.max, { round: true })}`}><input id="res-gross" type="number" min={0} step={1000} value={gross} onChange={(e) => setGross(Number(e.target.value))} className={cx(inputCls, 'w-40')} /></Field>
              <Field label="Na kapitał zapasowy (zł)" id="res-reserve"><input id="res-reserve" type="number" min={0} step={1000} value={reserve} onChange={(e) => setReserve(Number(e.target.value))} className={cx(inputCls, 'w-40')} /></Field>
              <Field label="Wypłata po (dni od zgromadzenia)" id="res-pay"><input id="res-pay" type="number" min={0} max={60} value={payIn} onChange={(e) => setPayIn(Number(e.target.value))} className={cx(inputCls, 'w-32')} /></Field>
            </div>
            <dl className="mt-3 grid gap-x-8 sm:grid-cols-2" data-testid="div-preview">
              <Row k="Kwota do podziału (art. 192 KSH)" v={formatPLN(dist.retained, { round: true })} />
              <Row k="Limit: aktywa netto − kapitał zakładowy" v={formatPLN(dist.byCapital, { round: true })} />
              <Row k="Limit: wolna gotówka" v={formatPLN(dist.byCash, { round: true })} />
              <Row k={`Podatek 19% (pobiera spółka)`} v={formatPLN(tax, { round: true })} />
              <Row k="Netto do wspólników" v={formatPLN(zl(gross) - tax, { round: true })} />
              <Row k="Termin wypłaty" v={formatDatePL(payDay)} />
            </dl>
            {dist.reasons.length > 0 && <p className="mt-1 text-xs text-loss">{dist.reasons.join('; ')}.</p>}
          </div>
        ))}
        {type === 'capital_increase' && (agreed.length === 0 ? <Empty>Brak uzgodnionej emisji. Najpierw uzgodnij warunki z inwestorem w „Inwestorzy i negocjacje”.</Empty> : (
          <Field label="Uzgodniona emisja" id="res-neg"><select id="res-neg" value={neg?.id ?? ''} onChange={(e) => setNegId(e.target.value)} className={cx(inputCls, 'w-96 max-w-full')}>{agreed.map((n) => <option key={n.id} value={n.id}>{holderName(game, n.partnerId)}: {n.terms.shares} udz. za {formatPLN(n.terms.amount, { round: true })} ({pct(n.terms.percentBps)})</option>)}</select></Field>
        ))}
        {type === 'consent_acquisition' && (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Maks. cena nabycia (zł)" id="res-max"><input id="res-max" type="number" min={1000} step={1000} value={maxAmt} onChange={(e) => setMaxAmt(Number(e.target.value))} className={cx(inputCls, 'w-40')} /></Field>
            <Field label="Ważność (miesięcy)" id="res-months"><input id="res-months" type="number" min={1} max={24} value={months} onChange={(e) => setMonths(Number(e.target.value))} className={cx(inputCls, 'w-28')} /></Field>
          </div>
        )}
      </div>
      <p className="mt-3 text-xs text-slate-500">Zgromadzenie: {sole ? 'jedyny wspólnik decyduje od razu (art. 156 KSH)' : `zwołane na ${formatDatePL(assembly)} (zawiadomienie co najmniej 2 tygodnie wcześniej, art. 238 KSH)`}. Próg: {type === 'capital_increase' ? THRESHOLD_LABEL.two_thirds : THRESHOLD_LABEL.absolute}. <LegalBadge id="CO-KSH-VOTING" /> <LegalBadge id="CO-KSH-ASSEMBLY" /></p>
      <Button className="mt-3" variant="primary" disabled={!payload} onClick={() => payload && run((g) => commands.proposeResolution(g, c.id, payload!))} data-testid="propose-resolution-btn">Zwołaj zgromadzenie / podejmij uchwałę</Button>
    </Card>
  );
}

export function CorpResolutionsScreen() {
  const { game, companies, company, select, run } = useCorp();
  if (!company) return (<div className="space-y-5"><ScreenHeader title="Uchwały wspólników" /><NoCompany /></div>);
  const c = company;
  const list = game.corp.resolutions.filter((r) => r.companyId === c.id).slice().reverse();
  const open = list.filter((r) => r.status === 'scheduled');
  const done = list.filter((r) => r.status !== 'scheduled');
  const due = c.yearResults.filter((y) => !c.statementsApproved.includes(y.year));
  return (
    <div className="space-y-5">
      <ScreenHeader title="Uchwały wspólników" subtitle="Nie każda uchwała zapada zwykłą większością: zmiana umowy (w tym podwyższenie kapitału) wymaga 2/3 głosów. Przegrana uchwała nie wykonuje decyzji." />
      <CorpBanner />
      <CompanyPicker companies={companies} company={company} select={select} />
      {due.map((y) => <p key={y.year} className="rounded-xl border border-gold/30 bg-gold/5 p-3 text-sm text-gold" data-testid="statements-due">Sprawozdanie finansowe za {y.year} czeka na zatwierdzenie — zwyczajne zgromadzenie powinno odbyć się do 30 czerwca {y.year + 1} (art. 231 KSH).</p>)}
      <Card title={`Zgromadzenia oczekujące (${open.length})`}>
        {open.length === 0 ? <Empty>Brak zwołanych zgromadzeń.</Empty> : (
          <ul className="space-y-3" data-testid="open-resolutions">
            {open.map((r) => {
              const mine = r.votes.find((v) => v.holderId === game.person.id);
              const voter = r.voters.find((v) => v.holderId === game.person.id);
              return (
                <li key={r.id} className="rounded-xl border border-ink-600 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-slate-100">{r.title}</span><Badge tone="sky">zgromadzenie {formatDatePL(r.assemblyOn)}</Badge></div>
                  <p className="text-xs text-slate-400">Próg: {THRESHOLD_LABEL[r.threshold.kind]} · inicjator: {holderName(game, r.proposedBy)} · Twój głos: {mine ? VOTE_LABEL[mine.vote] : 'brak (głos nieoddany — nie wlicza się do głosów oddanych)'}</p>
                  {voter && game.clock.today < r.assemblyOn && (
                    <div className="mt-2 flex gap-2">
                      {(['for', 'against', 'abstain'] as const).map((v) => <Button key={v} variant={mine?.vote === v ? 'primary' : 'secondary'} onClick={() => run((g) => commands.castVote(g, r.id, v))} data-testid={`vote-${v}-${r.id}`}>{v === 'for' ? 'Za' : v === 'against' ? 'Przeciw' : 'Wstrzymuję się'}</Button>)}
                      {r.proposedBy === game.person.id && <Button variant="ghost" onClick={() => run((g) => commands.cancelResolution(g, r.id))}>Odwołaj zgromadzenie</Button>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <NewResolution c={c} />
      <Card title="Historia uchwał">
        {done.length === 0 ? <Empty>Brak podjętych uchwał.</Empty> : (
          <ul className="space-y-3" data-testid="resolution-history">
            {done.slice(0, 15).map((r) => (
              <li key={r.id} className="rounded-xl border border-ink-700 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-slate-100">{r.title}</span><Badge tone={RES_TONE[r.status]}>{RES_STATUS[r.status]}</Badge></div>
                <p className="text-xs text-slate-400">{r.decidedOn ? formatDatePL(r.decidedOn) : ''} · próg: {THRESHOLD_LABEL[r.threshold.kind]} · {r.outcome}</p>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-500">{r.history.slice(-6).map((h, i) => <li key={i}>{h.text}</li>)}</ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ---------- 7. Finanse i CIT ---------- */

export function CorpFinanceScreen() {
  const { game, companies, company, select } = useCorp();
  if (!company) return (<div className="space-y-5"><ScreenHeader title="Finanse i CIT" /><NoCompany /></div>);
  const c = company;
  const bal = companyBalance(game, c);
  const year = parseIso(game.clock.today).year;
  const fig = companyTaxFigures(game, c, year);
  const rate = citRateFor(game, c, year, fig.revenue);
  const estTax = fig.income > 0 ? mulBps(fig.income, rate.rateBps) : 0;
  const advances = citAdvancesAccrued(game, c, year);
  const returns = game.corp.citReturns.filter((r) => r.companyId === c.id).slice().reverse();
  const losses = game.corp.citLosses.filter((l) => l.companyId === c.id);
  const lossNext = lossAvailable(game, c, year);
  const retained = c.yearResults.reduce((a, y) => a + y.netProfit, 0) - game.corp.resolutions.filter((r) => r.companyId === c.id && r.status === 'executed' && r.payload.type === 'allocate_profit').reduce((a, r) => a + (r.payload.type === 'allocate_profit' ? r.payload.dividendGross + r.payload.toReserve : 0), 0);
  const ytdResult = bal.netAssets - (c.yearResults.at(-1)?.netAssetsEnd ?? 0) - 0;
  return (
    <div className="space-y-5">
      <ScreenHeader title="Finanse i CIT" subtitle="Zysk księgowy, podstawa opodatkowania, gotówka i kapitały własne to cztery różne rzeczy — tu są pokazane osobno." />
      <CorpBanner />
      <CompanyPicker companies={companies} company={company} select={select} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Gotówka" icon="wallet" accent="gain" value={<Money value={bal.cash} round />} hint="rachunek spółki" />
        <StatCard label="Aktywa netto" icon="coins" accent="sky" value={<Money value={bal.netAssets} round />} hint={`aktywa ${formatPLN(bal.assets, { round: true })} − zobowiązania ${formatPLN(bal.liabilities, { round: true })}`} />
        <StatCard label="Dochód podatkowy YTD" icon="receipt" accent="gold" value={<Money value={fig.income} round />} hint={`przychody ${formatPLN(fig.revenue, { round: true })} − koszty ${formatPLN(fig.costs, { round: true })}`} />
        <StatCard label="Szac. CIT roku" icon="shield" accent="violet" value={<Money value={estTax} round />} hint={`stawka ${rate.rateBps / 100}%, zaliczki ${formatPLN(advances, { round: true })}`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Majątek spółki (uproszczony bilans)">
          <dl data-testid="balance-sheet">
            <Row k="Gotówka" v={formatPLN(bal.cash, { round: true })} />
            <Row k="Należności" v={formatPLN(bal.receivables, { round: true })} />
            <Row k="Zapasy materiałów" v={formatPLN(bal.inventory, { round: true })} />
            <Row k="Sprzęt (wartość księgowa)" v={formatPLN(bal.equipment, { round: true })} />
            <Row k="Pojazdy / przedpłaty" v={formatPLN(bal.vehicles + bal.prepaid, { round: true })} />
            <Row k="Zobowiązania (w tym podatki i VAT)" v={`−${formatPLN(bal.payables, { round: true })}`} tone="text-loss" />
            <Row k="Zaliczki klientów do czasu wykonania usługi" v={`−${formatPLN(bal.deferred, { round: true })}`} tone="text-loss" />
            <Row k="Wpłaty na podwyższenie kapitału (do wpisu)" v={`−${formatPLN(bal.pendingCapital, { round: true })}`} tone="text-loss" />
            <Row k="Aktywa netto" v={formatPLN(bal.netAssets, { round: true })} />
          </dl>
          <p className="mt-2 text-xs text-slate-500">Rachunkowość uproszczona — to nie sprawozdanie finansowe w rozumieniu ustawy o rachunkowości. <LegalBadge id="CO-ACCOUNTING" /></p>
        </Card>
        <Card title="Kapitały własne">
          <dl data-testid="equity">
            <Row k="Kapitał zakładowy" v={formatPLN(c.capital, { round: true })} />
            <Row k="Kapitał zapasowy" v={formatPLN(c.supplementary, { round: true })} />
            <Row k="Zysk zatrzymany z zamkniętych lat" v={formatPLN(retained, { round: true })} />
            <Row k="Wynik bieżącego roku (szac.)" v={formatPLN(ytdResult - (c.status === 'registered' && c.yearResults.length === 0 ? c.capital + c.supplementary : 0), { round: true })} />
          </dl>
          <p className="mt-2 text-xs text-slate-500">Dywidenda nie jest kosztem — zmniejsza kapitały własne po uchwale wspólników. Wpływ z objęcia udziałów (wkład) nie jest przychodem.</p>
        </Card>
      </div>
      <Card title={`CIT ${year}: stawka i zaliczki`}>
        <p className="text-sm text-slate-300" data-testid="cit-rate">{rate.reason}</p>
        <p className="mt-1 text-xs text-slate-500">9% nie jest automatyczne: wymaga przychodów roku do {CORP.citRevenueLimit2026 / 100} zł (2 mln € wg kursu NBP z 2.01.2026) i statusu małego podatnika albo roku rozpoczęcia działalności. Zaliczki: miesięcznie narastająco, do 20. dnia następnego miesiąca. <LegalBadge id="CO-CIT-RATES" /> <LegalBadge id="CO-CIT-SMALL" /> <LegalBadge id="CO-CIT-ADVANCES" /></p>
        {lossNext.total > 0 && <p className="mt-1 text-xs text-sky">Dostępna strata z lat ubiegłych do odliczenia w {year}: {formatPLN(lossNext.total, { round: true })} (nie więcej niż 50% straty rocznie). <LegalBadge id="CO-CIT-LOSS" /></p>}
      </Card>
      <Card title="Rozliczenia roczne (CIT-8, składane automatycznie 31 grudnia)">
        {returns.length === 0 ? <Empty>Pierwsze zeznanie powstanie 31 grudnia roku rejestracji.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm" data-testid="cit-returns">
            <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><Th>Rok</Th><Th right>Przychody</Th><Th right>Koszty</Th><Th right>Strata odliczona</Th><Th right>Podstawa</Th><Th right>Stawka</Th><Th right>Podatek</Th><Th right>Saldo</Th></tr></thead>
            <tbody className="divide-y divide-ink-700/60">
              {returns.map((r) => (
                <tr key={r.id} title={r.rateReason}><td className="py-2 text-slate-100">{r.year}</td><td className="py-2 text-right"><Money value={r.revenue} round /></td><td className="py-2 text-right"><Money value={r.costs} round /></td><td className="py-2 text-right"><Money value={r.lossDeducted} round /></td><td className="py-2 text-right"><Money value={r.base} round /></td><td className="py-2 text-right">{r.rateBps / 100}%</td><td className="py-2 text-right"><Money value={r.tax} round /></td><td className="py-2 text-right"><Money value={r.balance} round signed /></td></tr>
              ))}
            </tbody>
          </table></div>
        )}
        {losses.length > 0 && <p className="mt-2 text-xs text-slate-500">Straty: {losses.map((l) => `${l.year}: ${formatPLN(l.amount, { round: true })} (odliczono ${formatPLN(l.usages.reduce((a, u) => a + u.amount, 0), { round: true })})`).join('; ')}</p>}
        <p className="mt-2 text-xs text-slate-500">Podatek minimalny (art. 24ca) nie dotyczy spółek w grze (wspólnicy to osoby fizyczne; rok rozpoczęcia i dwa kolejne; mały podatnik). CIT estoński — poza zakresem. <LegalBadge id="CO-CIT-MINIMUM" /> <LegalBadge id="CO-CIT-ESTONIAN" /></p>
      </Card>
    </div>
  );
}

/* ---------- 8. Dywidendy ---------- */

export function CorpDividendsScreen() {
  const { game, companies, company, select } = useCorp();
  const navigate = useGameStore((st) => st.navigate);
  if (!company) return (<div className="space-y-5"><ScreenHeader title="Dywidendy" /><NoCompany /></div>);
  const c = company;
  const d = distributable(game, c);
  const divs = game.corp.dividends.filter((x) => x.companyId === c.id).slice().reverse();
  return (
    <div className="space-y-5">
      <ScreenHeader title="Dywidendy" subtitle="Spółka nie wypłaci dywidendy tylko dlatego, że ma gotówkę: potrzebny jest zysk do podziału, zatwierdzone sprawozdanie i uchwała wspólników." />
      <CorpBanner />
      <CompanyPicker companies={companies} company={company} select={select} />
      <Card title="Ile można wypłacić dziś" action={<Button onClick={() => navigate('corpResolutions')}>Przejdź do uchwał</Button>}>
        <dl className="grid gap-x-8 sm:grid-cols-2" data-testid="distributable">
          <Row k="Zysk do podziału (art. 192 KSH)" v={formatPLN(d.retained, { round: true })} />
          <Row k="Limit: aktywa netto − kapitał zakładowy (art. 189 § 2)" v={formatPLN(d.byCapital, { round: true })} />
          <Row k="Limit: wolna gotówka" v={formatPLN(d.byCash, { round: true })} />
          <Row k="Dostępne do wypłaty" v={formatPLN(d.max, { round: true })} tone={d.max > 0 ? 'text-gain' : 'text-loss'} />
          <Row k="Sprawozdania zatwierdzone za lata" v={c.statementsApproved.length ? c.statementsApproved.join(', ') : 'brak'} />
          <Row k="Podatek od dywidendy (osoba fizyczna)" v="19% zryczałtowany, pobiera spółka, do 20. następnego miesiąca" />
        </dl>
        {d.reasons.length > 0 && <p className="mt-2 text-xs text-loss" data-testid="div-blockers">Dlaczego nie teraz: {d.reasons.join('; ')}.</p>}
        <p className="mt-2 text-xs text-slate-500">Dywidenda nie jest kosztem operacyjnym spółki (nie obniża podstawy CIT). Zaliczki na poczet dywidendy, odbiorcy inni niż osoby fizyczne i zwolnienia — odłożone. <LegalBadge id="CO-KSH-DIVIDEND" /> <LegalBadge id="CO-PIT-DIVIDEND" /> <LegalBadge id="CO-DIVIDEND-OTHERS" /></p>
      </Card>
      <Card title="Wypłacone i uchwalone dywidendy">
        {divs.length === 0 ? <Empty>Spółka nie uchwaliła jeszcze dywidendy.</Empty> : (
          <ul className="space-y-3" data-testid="dividends">
            {divs.map((v) => (
              <li key={v.id} className="rounded-xl border border-ink-600 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-slate-100">Dywidenda za {v.year}: {formatPLN(v.grossTotal, { round: true })} brutto</span><Badge tone={v.status === 'paid' ? 'gain' : 'gold'}>{v.status === 'paid' ? 'wypłacona' : 'uchwalona'}</Badge></div>
                <p className="text-xs text-slate-400">uchwała {formatDatePL(v.declaredOn)} · wypłata {formatDatePL(v.payDay)} · podatek do {formatDatePL(v.taxDueDay)}</p>
                <ul className="mt-1 text-xs text-slate-300">{v.lines.map((l) => <li key={l.holderId}>{holderName(game, l.holderId)}: brutto {formatPLN(l.gross, { round: true })}, podatek {formatPLN(l.tax, { round: true })}, netto {formatPLN(l.net, { round: true })}{l.receivableId && game.obligations.find((o) => o.id === l.receivableId)?.status === 'open' ? ' (czeka na wypłatę przez spółkę)' : ''}</li>)}</ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ---------- 9. Inwestorzy i negocjacje ---------- */

export function CorpInvestorsScreen() {
  const { game, companies, company, select, run } = useCorp();
  const reg = company?.status === 'registered' ? company : null;
  const [kind, setKind] = useState<Negotiation['kind']>('subscribe');
  const [partnerId, setPartnerId] = useState<string>('');
  const [amount, setAmount] = useState(100_000);
  const [percent, setPercent] = useState(20);
  const [shares, setShares] = useState(100);
  const [role, setRole] = useState<'none' | 'board_member'>('none');
  if (!reg) return (<div className="space-y-5"><ScreenHeader title="Inwestorzy i negocjacje" /><CorpBanner /><NoCompany hint="Inwestorzy wchodzą do zarejestrowanej spółki z kilkumiesięczną historią wyników." /></div>);
  const c = reg;
  const pool = game.corp.partners.filter((p) => (kind === 'subscribe' ? p.kind === 'investor' : true));
  const pid = partnerId && pool.some((p) => p.id === partnerId) ? partnerId : pool[0]?.id ?? '';
  const myShares = holdingOf(game, c.id, game.person.id)?.count ?? 0;
  const sub = kind === 'subscribe' ? subscriptionTerms(c, zl(amount), percent * 100, role) : null;
  const val = kind === 'subscribe' && sub ? dealValuation(sub.amount, sub.percentBps) : null;
  const negs = game.corp.negotiations.filter((n) => n.companyId === c.id && n.kind !== 'found').slice().reverse();
  const submit = () => {
    if (!pid) return;
    if (kind === 'subscribe' && sub) run((g) => commands.proposeDeal(g, { kind, companyId: c.id, partnerId: pid, terms: sub }));
    else run((g) => commands.proposeDeal(g, { kind, companyId: c.id, partnerId: pid, terms: { shares, amount: zl(amount), percentBps: Math.round((shares * 10_000) / c.shareCount), role: 'none', dividendPolicy: 'none' } }));
  };
  return (
    <div className="space-y-5">
      <ScreenHeader title="Inwestorzy i negocjacje" subtitle="Objęcie nowych udziałów (pieniądze trafiają do SPÓŁKI) to coś innego niż zakup istniejących udziałów (zapłata trafia do SPRZEDAJĄCEGO)." />
      <CorpBanner />
      <CompanyPicker companies={companies} company={company} select={select} />
      <Card title="Nowa oferta">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Rodzaj transakcji">
          {(['subscribe', 'secondary_sell', 'secondary_buy'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cx('rounded-xl border px-3 py-1.5 text-sm', kind === k ? 'border-sky bg-sky/10 text-white' : 'border-ink-600 text-slate-300 hover:border-ink-500')}>{k === 'subscribe' ? 'Nowa emisja dla inwestora' : k === 'secondary_sell' ? 'Sprzedaj swoje udziały' : 'Kup udziały wspólnika'}</button>
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <Field label={kind === 'secondary_buy' ? 'Wspólnik (sprzedający)' : kind === 'secondary_sell' ? 'Kupujący' : 'Inwestor'} id="deal-partner">
            <select id="deal-partner" value={pid} onChange={(e) => setPartnerId(e.target.value)} className={inputCls}>
              {pool.map((p) => <option key={p.id} value={p.id}>{p.firstName} {p.lastName} · {p.kind === 'investor' ? 'inwestor' : 'wspólnik'} · kapitał {formatPLN(p.capital, { round: true })}</option>)}
            </select>
          </Field>
          <Field label={kind === 'subscribe' ? 'Wkład (zł)' : 'Cena za pakiet (zł)'} id="deal-amount"><input id="deal-amount" type="number" min={1000} step={1000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className={inputCls} /></Field>
          {kind === 'subscribe' ? (
            <>
              <Field label="Udział po emisji (%)" id="deal-pct"><input id="deal-pct" type="number" min={1} max={90} value={percent} onChange={(e) => setPercent(Number(e.target.value))} className={inputCls} /></Field>
              <Field label="Rola w spółce" id="deal-role"><select id="deal-role" value={role} onChange={(e) => setRole(e.target.value as 'none' | 'board_member')} className={inputCls}><option value="none">bez roli w zarządzie</option><option value="board_member">członek zarządu</option></select></Field>
            </>
          ) : (
            <Field label={`Liczba udziałów${kind === 'secondary_sell' ? ` (masz ${myShares})` : ''}`} id="deal-shares"><input id="deal-shares" type="number" min={1} value={shares} onChange={(e) => setShares(Number(e.target.value))} className={inputCls} /></Field>
          )}
        </div>
        {sub && val && (
          <dl className="mt-3 grid gap-x-8 sm:grid-cols-2" data-testid="deal-preview">
            <Row k="Nowe udziały (liczba całkowita)" v={`${sub.shares} po cenie emisyjnej ${formatPLN(issuePriceEach(sub))} (nominał ${formatPLN(c.nominal)})`} />
            <Row k="Faktyczny udział inwestora po emisji" v={pct(sub.percentBps)} />
            <Row k="Wycena pre-money / post-money" v={`${formatPLN(val.pre, { round: true })} / ${formatPLN(val.post, { round: true })}`} />
            <Row k="Wycena modelu gry (szacunek, bez tej emisji)" v={c.valuation ? formatPLN(c.valuation.estimate, { round: true }) : '—'} />
            <Row k="Twój udział po rozwodnieniu" v={`${pct(Math.round((capitalBps(game, c.id, game.person.id) * c.shareCount) / (c.shareCount + sub.shares)))} (teraz ${pct(capitalBps(game, c.id, game.person.id))})`} />
            <Row k="Nadwyżka do kapitału zapasowego" v={formatPLN(sub.amount - sub.shares * c.nominal, { round: true })} />
          </dl>
        )}
        <div className="mt-3"><Button variant="primary" onClick={submit} disabled={!pid} data-testid="propose-deal-btn">Złóż ofertę</Button></div>
        <p className="mt-2 text-xs text-slate-500">Inwestor ocenia ofertę na podstawie własnej wyceny spółki, swojego kapitału, tolerancji ryzyka, celu i horyzontu. Emisja wymaga uchwały 2/3 głosów i wpisu do KRS (udziały powstają dopiero po wpisie); koszty: opłata sądowa 200 zł i PCC 0,5% (płaci spółka). Sprzedaż udziałów: PIT 19% od zysku (Ty), PCC 1% płaci kupujący. <LegalBadge id="CO-KSH-INCREASE" /> <LegalBadge id="CO-PIT-SHARES" /> <LegalBadge id="CO-PCC-SALE" /></p>
      </Card>
      <Card title="Negocjacje">
        {negs.length === 0 ? <Empty>Brak negocjacji.</Empty> : (
          <ul className="space-y-3" data-testid="negotiations">
            {negs.map((n) => (
              <li key={n.id} className="rounded-xl border border-ink-600 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-100">{KIND_LABEL[n.kind]} — {holderName(game, n.partnerId)}: {n.terms.shares} udz. za {formatPLN(n.terms.amount, { round: true })}{n.kind === 'subscribe' ? ` (${pct(n.terms.percentBps)})` : ''}</span>
                  <Badge tone={n.status === 'agreed' ? 'gain' : n.status === 'declined' || n.status === 'expired' ? 'loss' : n.status === 'completed' ? 'sky' : 'gold'}>{NEG_STATUS_LABEL[n.status]}</Badge>
                </div>
                <p className="mt-1 text-xs text-slate-400">{n.reason}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {n.status === 'countered' && <Button variant="primary" onClick={() => run((g) => commands.acceptCounter(g, n.id))}>Przyjmij kontrofertę</Button>}
                  {n.status === 'agreed' && n.kind === 'subscribe' && !n.resolutionId && <Button variant="primary" onClick={() => run((g) => commands.proposeResolution(g, c.id, { type: 'capital_increase', negotiationId: n.id, subscriberId: n.partnerId, shares: n.terms.shares, issuePriceEach: issuePriceEach(n.terms) }))} data-testid={`start-increase-${n.id}`}>Uchwal podwyższenie kapitału</Button>}
                  {n.status === 'agreed' && n.kind !== 'subscribe' && <Button variant="primary" onClick={() => run((g) => commands.completeSecondary(g, n.id))} data-testid={`complete-${n.id}`}>Zrealizuj transakcję</Button>}
                  {(n.status === 'open' || n.status === 'countered' || n.status === 'agreed') && !n.resolutionId && <Button variant="ghost" onClick={() => run((g) => commands.withdrawDeal(g, n.id))}>Wycofaj</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
