import { useState } from 'react';
import type { ReactNode } from 'react';
import { activeBusiness, allowedResumeDates, formForYear, isSuspendedOn, malyZusStatus, ryczaltAllowed } from '../../engine/business.ts';
import { formatDatePL, formatMonthPL, parseIso } from '../../engine/date.ts';
import { lossRemaining } from '../../engine/annual.ts';
import { DEFAULT_ASSUMPTIONS, runPlanning, standardScenarios } from '../../engine/planning.ts';
import type { PlanAssumptions, PlanResult } from '../../engine/planning.ts';
import { reportYears, yearReport } from '../../engine/report.ts';
import { formatPLN, zl } from '../../engine/money.ts';
import type { TaxForm } from '../../engine/state.ts';
import { useGameStore } from '../../store/gameStore.ts';
import { Badge, Button, Card, Empty, Money, ScreenHeader, cx, moneyTone } from '../components/ui.tsx';
import { parseZloty } from '../format.ts';
import { LegalBadge } from './BusinessScreens.tsx';

const FORM_NAME: Record<TaxForm, string> = { skala: 'Skala (12% / 32%)', liniowy: 'Liniowy 19%', ryczalt: 'Ryczałt' };
const FORM_FACTS: Record<TaxForm, string> = {
  skala: 'Dochód łączy się z etatem w jednym zeznaniu (PIT-36), kwota zmniejszająca 3 600 zł raz; składka zdrowotna 9% dochodu (min. podstawa).',
  liniowy: '19% dochodu, osobne zeznanie PIT-36L (etat osobno, w skali); składka zdrowotna 4,9% dochodu (min. podstawa).',
  ryczalt: 'Podatek od przychodu (koszty nie obniżają podstawy), osobne zeznanie PIT-28; składka zdrowotna zależy od progów przychodu.',
};

function Row({ k, v, tone }: { k: ReactNode; v: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <dt className="text-slate-400">{k}</dt>
      <dd className={cx('tabular text-right', tone ?? 'text-slate-100')}>{v}</dd>
    </div>
  );
}

function useBiz() {
  const game = useGameStore((s) => s.game)!;
  return { game, biz: activeBusiness(game) };
}

/* ---------- karty w „Mojej działalności” ---------- */

export function SuspensionCard() {
  const { game, biz } = useBiz();
  const suspend = useGameStore((s) => s.suspendBusiness);
  const resume = useGameStore((s) => s.resumeBusiness);
  const [date, setDate] = useState('');
  if (!biz) return null;
  const today = game.clock.today;
  const open = biz.suspensions.find((x) => x.to === null);
  const suspendedNow = open ? isSuspendedOn(biz, today) : false;
  const dates = allowedResumeDates(game);
  const planned = open && !suspendedNow;
  return (
    <Card title="Zawieszenie działalności" action={<LegalBadge id="SUSP-RULES" />}>
      {!open && (
        <>
          <p className="text-sm text-slate-400">
            Zawieszenie obowiązuje od 1. dnia następnego miesiąca, na minimum 30 dni. W tym czasie nie płacisz składek ani zaliczek i nie przyjmujesz nowych zleceń; zaległe zobowiązania i należności zostają, a zeznanie roczne nadal obowiązuje.
            Nie możesz zawiesić działalności z trwającym zleceniem.
          </p>
          <Button variant="secondary" className="mt-3" onClick={() => suspend()} data-testid="suspend-business">Zawieś działalność</Button>
        </>
      )}
      {open && (
        <>
          <p className="text-sm text-slate-300" data-testid="suspension-status">
            {suspendedNow ? <>Działalność jest <strong className="text-gold">zawieszona</strong> od {formatDatePL(open.from)}.</> : <>Zawieszenie zaplanowane od <strong className="text-gold">{formatDatePL(open.from)}</strong>.</>}
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="resume-date" className="mb-1 block text-xs text-slate-400">{planned ? 'Anuluj zawieszenie (data wznowienia = początek)' : 'Wznów działalność od'}</label>
              <select id="resume-date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-xl border border-ink-600 bg-ink-900/80 px-3 py-2 text-slate-100 focus:border-sky focus:outline-none">
                <option value="">— wybierz datę —</option>
                {(planned ? [open.from] : dates).map((d) => <option key={d} value={d}>{formatDatePL(d)}</option>)}
              </select>
            </div>
            <Button variant="primary" disabled={!date} onClick={() => { if (resume(date)) setDate(''); }} data-testid="resume-business">{planned ? 'Anuluj zawieszenie' : 'Wznów działalność'}</Button>
          </div>
        </>
      )}
      {biz.suspensions.filter((x) => x.to !== null).length > 0 && (
        <p className="mt-3 text-xs text-slate-500">Zakończone zawieszenia: {biz.suspensions.filter((x) => x.to !== null).map((x) => `${formatDatePL(x.from)} – ${formatDatePL(x.to!)}`).join('; ')}</p>
      )}
    </Card>
  );
}

export function TaxFormCard() {
  const { game, biz } = useBiz();
  const plan = useGameStore((s) => s.planTaxFormChange);
  if (!biz) return null;
  const year = parseIso(game.clock.today).year;
  const nextYear = year + 1;
  const current = formForYear(biz, year);
  const upcoming = formForYear(biz, nextYear);
  const ryc = ryczaltAllowed(game, biz, nextYear);
  return (
    <Card title="Forma opodatkowania" action={<LegalBadge id="PIT-FORM-CHANGE" />}>
      <dl className="divide-y divide-ink-700/60">
        <Row k={`Obowiązuje w ${year} r.`} v={FORM_NAME[current]} />
        <Row k={`Od 1 stycznia ${nextYear} r.`} v={<span data-testid="next-form">{FORM_NAME[upcoming]}{biz.taxFormPlan ? ' (zaplanowana zmiana)' : ''}</span>} tone={biz.taxFormPlan ? 'text-gold' : undefined} />
      </dl>
      <p className="mt-3 text-xs text-slate-500">Formę można zmienić tylko od nowego roku — wybór dotyczy całego {nextYear} r. Dotychczasowe rozliczenia i historia form zostają bez zmian.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {(['skala', 'liniowy', 'ryczalt'] as const).map((f) => {
          const disabled = f === upcoming || (f === 'ryczalt' && !ryc.ok);
          return (
            <div key={f} className={cx('flex flex-col rounded-xl border p-3 text-xs', f === upcoming ? 'border-sky bg-sky/10' : 'border-ink-600')}>
              <div className="text-sm font-medium text-slate-100">{FORM_NAME[f]}</div>
              <p className="mt-1 flex-1 text-slate-400">{FORM_FACTS[f]}</p>
              {f === 'ryczalt' && !ryc.ok && <p className="mt-1 text-loss">{ryc.reason}</p>}
              <Button variant="secondary" className="mt-2" disabled={disabled} onClick={() => plan(f)} data-testid={`plan-form-${f}`}>
                {f === upcoming ? 'Wybrana' : f === current && biz.taxFormPlan ? 'Anuluj zmianę' : `Od ${nextYear}: wybierz`}
              </Button>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-slate-500">Nie wiesz, co się opłaca? Porównaj warianty w ekranie „Planowanie” (prognoza, nic nie księguje).</p>
    </Card>
  );
}

export function MalyZusCard() {
  const { game, biz } = useBiz();
  const declare = useGameStore((s) => s.declareMalyZusPlus);
  const resign = useGameStore((s) => s.resignMalyZusPlus);
  if (!biz) return null;
  const st = malyZusStatus(game, biz, game.clock.today);
  const mp = biz.zus.malyPlus;
  return (
    <Card title="Mały ZUS Plus" action={<LegalBadge id="ZUS-MALY-PLUS" />}>
      {mp.active ? (
        <>
          <dl className="divide-y divide-ink-700/60">
            <Row k="Status" v={<Badge tone="gain">korzystasz</Badge>} />
            <Row k="Podstawa składek" v={mp.base !== null ? <Money value={mp.base} /> : '—'} />
            <Row k="Od" v={mp.since ? formatDatePL(mp.since) : '—'} />
          </dl>
          <Button variant="secondary" className="mt-3" onClick={() => resign()} data-testid="resign-mzp">Zrezygnuj</Button>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-400">Niższa podstawa składek społecznych dla małych firm (przychód w poprzednim roku do {formatPLN(st.revenueLimit, { round: true })}). Nie jest przyznawany automatycznie — składasz deklarację, a 1 stycznia sprawdzamy, czy nadal spełniasz warunki.</p>
          <dl className="mt-2 divide-y divide-ink-700/60">
            <Row k="Przychód w poprzednim roku" v={<Money value={st.priorRevenue} round />} />
            <Row k="Dni prowadzenia działalności" v={st.daysOperated} />
            <Row k="Miesiące w ostatnich 60" v={`${st.monthsUsedIn60} / 36`} />
            {st.base !== null && <Row k="Wyliczona podstawa" v={<Money value={st.base} />} />}
          </dl>
          {st.reasons.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-gold" data-testid="mzp-reasons">{st.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          <Button variant="primary" className="mt-3" disabled={!st.eligible} onClick={() => declare()} data-testid="declare-mzp">Zadeklaruj Mały ZUS Plus</Button>
        </>
      )}
    </Card>
  );
}

/* ---------- Rozliczenie roczne ---------- */

export function BizSettlementScreen() {
  const game = useGameStore((s) => s.game)!;
  const claim = useGameStore((s) => s.claimHealthRefund);
  const today = game.clock.today;
  const returns = [...game.taxReturns].sort((a, b) => b.year - a.year || a.form.localeCompare(b.form));
  const health = [...game.healthSettlements].sort((a, b) => b.year - a.year);
  const losses = [...game.taxLosses].sort((a, b) => b.year - a.year);
  const statusLabel = (s: string) => ({ none: 'bez dopłaty', due: 'do dopłaty', refund_available: 'nadpłata — do wniosku', refund_claimed: 'wniosek złożony', refund_expired: 'termin wniosku minął' }[s] ?? s);
  return (
    <div className="space-y-5">
      <ScreenHeader title="Rozliczenie roczne" subtitle="Zeznania PIT za zamknięte lata, roczne rozliczenie składki zdrowotnej i ewidencja strat podatkowych." />
      <Card title="Zeznania podatkowe" action={<LegalBadge id="PIT-ANNUAL-SOURCES" />}>
        {returns.length === 0 ? <Empty>Pierwsze zeznanie powstanie po zamknięciu roku (31 grudnia). Zapłata do 30 kwietnia, zwrot nadpłaty w 45 dni od terminu.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm" data-testid="tax-returns">
              <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><th className="pb-2 font-medium">Rok</th><th className="pb-2 font-medium">Zeznanie</th><th className="pb-2 text-right font-medium">Dochód</th><th className="pb-2 text-right font-medium">Odliczona strata</th><th className="pb-2 text-right font-medium">Podstawa</th><th className="pb-2 text-right font-medium">Podatek</th><th className="pb-2 text-right font-medium">Zaliczki</th><th className="pb-2 text-right font-medium">Wynik</th></tr></thead>
              <tbody className="divide-y divide-ink-700/60">
                {returns.map((r) => (
                  <tr key={r.id} title={`Reguły: ${r.ruleIds.join(', ')}`}>
                    <td className="py-2 text-slate-300">{r.year}</td>
                    <td className="py-2 text-slate-300">{r.form}{r.form === 'PIT-36' && ' (etat + JDG)'}</td>
                    <td className="py-2 text-right"><Money value={r.income} /></td>
                    <td className="py-2 text-right text-slate-400"><Money value={r.lossDeducted} /></td>
                    <td className="py-2 text-right"><Money value={r.base} round /></td>
                    <td className="py-2 text-right"><Money value={r.tax} round /></td>
                    <td className="py-2 text-right text-slate-400"><Money value={r.advances} /></td>
                    <td className="py-2 text-right">
                      {r.balance === 0 ? <Badge>0</Badge> : r.balance > 0 ? <span className="text-loss">dopłata <Money value={r.balance} /> · do {formatDatePL(r.dueDate)}</span> : <span className="text-gain">nadpłata <Money value={-r.balance} /></span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">Ze skalą łączą się dochody z etatu i JDG (kwota zmniejszająca 3 600 zł raz). Liniowy i ryczałt rozlicza się osobno — etat zostaje w PIT-37. Przychód z etatu liczy się w roku wypłaty. Podstawa i podatek są zaokrąglane do pełnych złotych.</p>
      </Card>

      <Card title="Roczne rozliczenie składki zdrowotnej" action={<LegalBadge id="HEALTH-ANNUAL-2026" />}>
        {health.length === 0 ? <Empty>Rozliczenie pojawi się po zamknięciu roku. Dopłatę płacisz do 20 maja; nadpłata nie wraca automatycznie.</Empty> : (
          <ul className="divide-y divide-ink-700/60" data-testid="health-settlements">
            {health.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                <div>
                  <div className="text-slate-200">{h.year} · {FORM_NAME[h.form]} · {h.months} mies.</div>
                  <div className="text-xs text-slate-500">Podstawa roczna <Money value={h.annualBase} round /> · należna <Money value={h.annualContribution} /> · zapłacona <Money value={h.monthlyTotal} /></div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={h.status === 'due' ? 'loss' : h.status === 'refund_available' ? 'gain' : 'neutral'}>{statusLabel(h.status)}</Badge>
                  {h.diff !== 0 && <span className={cx('tabular', moneyTone(-h.diff))}>{h.diff > 0 ? 'dopłata ' : 'nadpłata '}<Money value={Math.abs(h.diff)} />{h.dueDate && h.status === 'due' && ` · do ${formatDatePL(h.dueDate)}`}</span>}
                  {h.status === 'refund_available' && h.claimDeadline && today <= h.claimDeadline && (
                    <Button variant="primary" onClick={() => claim(h.id)} data-testid={`claim-${h.year}`}>Złóż wniosek o zwrot (do {formatDatePL(h.claimDeadline)})</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Straty podatkowe" action={<LegalBadge id="PIT-LOSS-5Y" />}>
        {losses.length === 0 ? <Empty>Brak strat. Strata podatkowa powstaje, gdy koszty przekroczą przychody w roku (skala/liniowy) — to nie to samo co ujemny przepływ gotówki.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm" data-testid="tax-losses">
              <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><th className="pb-2 font-medium">Rok</th><th className="pb-2 font-medium">Forma</th><th className="pb-2 text-right font-medium">Strata</th><th className="pb-2 font-medium">Okres odliczenia</th><th className="pb-2 text-right font-medium">Odliczono</th><th className="pb-2 text-right font-medium">Pozostało</th></tr></thead>
              <tbody className="divide-y divide-ink-700/60">
                {losses.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 text-slate-300">{l.year}</td>
                    <td className="py-2 text-slate-400">{FORM_NAME[l.form]}</td>
                    <td className="py-2 text-right"><Money value={l.amount} /></td>
                    <td className="py-2 text-slate-400">{l.year + 1}–{l.year + 5}, do 50% rocznie</td>
                    <td className="py-2 text-right text-slate-400"><Money value={l.amount - lossRemaining(l)} /></td>
                    <td className="py-2 text-right"><Money value={lossRemaining(l)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------- Podsumowanie roku ---------- */

export function BizReportScreen() {
  const game = useGameStore((s) => s.game)!;
  const years = reportYears(game);
  const [year, setYear] = useState(years[years.length - 1]!);
  const r = yearReport(game, year);
  return (
    <div className="space-y-5">
      <ScreenHeader title="Podsumowanie roku" subtitle="Wynik firmy oddzielony od prywatnych przepływów właściciela. Przelewy między Twoimi rachunkami nie są przychodem ani kosztem." />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Rok">
        {years.map((y) => <button key={y} type="button" aria-pressed={y === year} onClick={() => setYear(y)} className={cx('rounded-lg px-3 py-1.5 text-sm', y === year ? 'bg-ink-600 text-white' : 'bg-ink-800 text-slate-400')}>{y}</button>)}
      </div>
      {!r.complete && <div role="note" className="rounded-xl border border-gold/30 bg-gold/5 p-3 text-xs text-gold" data-testid="report-partial">Rok {year} trwa — dane na dzień {formatDatePL(r.asOf)} (częściowe).</div>}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Wynik firmy (memoriał)">
          {!r.hasBusiness ? <Empty>W {year} r. nie prowadzono działalności.</Empty> : (
            <dl className="divide-y divide-ink-700/60" data-testid="report-business">
              <Row k="Przychody" v={<Money value={r.revenue} />} />
              <Row k="Koszty" v={<Money value={-r.costs} signed />} />
              <Row k="Dochód przed składkami i podatkiem" v={<Money value={r.income} signed />} />
              <Row k="Składki ZUS (społeczne + zdrowotna)" v={<Money value={-r.zus} signed />} />
              <Row k="Podatek dochodowy (zaliczki i rozliczenie)" v={<Money value={-r.pit} signed />} />
              <Row k="Wynik netto firmy" v={<Money value={r.result} signed />} tone={moneyTone(r.result)} />
              {r.taxLossCreated > 0 && <Row k="Powstała strata podatkowa" v={<Money value={r.taxLossCreated} />} tone="text-gold" />}
            </dl>
          )}
        </Card>
        <Card title="Przepływy gotówkowe rachunku firmowego">
          {!r.hasBusiness ? <Empty>—</Empty> : (
            <dl className="divide-y divide-ink-700/60">
              <Row k="Wpłaty od klientów" v={<Money value={r.customerPayments} />} />
              <Row k="Wypłaty (koszty, składki, podatki)" v={<Money value={-r.cashOut} signed />} />
              <Row k="VAT zapłacony netto" v={<Money value={r.vatPaidNet} signed />} />
              <Row k="Wkłady własne (przelewy prywatne → firma)" v={<Money value={r.ownerContributions} />} />
              <Row k="Pobrania właściciela (firma → prywatne)" v={<Money value={-r.ownerWithdrawals} signed />} />
              <Row k="Należności na koniec okresu" v={<Money value={r.receivables} />} />
              <Row k="Zobowiązania na koniec okresu" v={<Money value={r.payables} />} />
              <Row k="Saldo rachunku firmowego" v={<Money value={r.businessCash} />} />
            </dl>
          )}
        </Card>
        <Card title="Przepływy prywatne" className="lg:col-span-2">
          <dl className="grid gap-x-8 divide-y divide-ink-700/60 sm:grid-cols-2 sm:divide-y-0">
            <Row k="Wynagrodzenie netto z etatu" v={<Money value={r.salaryNet} />} />
            <Row k="Wydatki prywatne" v={<Money value={-r.privateExpenses} signed />} />
            <Row k="Majątek netto na początek" v={<Money value={r.netWorthStart} />} />
            <Row k="Majątek netto na koniec" v={<Money value={r.netWorthEnd} />} />
            <Row k="Zmiana majątku netto" v={<Money value={r.netWorthChange} signed />} tone={moneyTone(r.netWorthChange)} />
          </dl>
          <p className="mt-3 text-xs text-slate-500">Wynik firmy ≠ zmiana majątku: majątek zależy też od wynagrodzenia z etatu, wydatków prywatnych i zwrotów podatku. Reguły: {r.ruleIds.join(', ') || '—'}.</p>
        </Card>
      </div>
    </div>
  );
}

/* ---------- Planowanie ---------- */

export function PlanningScreen() {
  const game = useGameStore((s) => s.game)!;
  const [months, setMonths] = useState(String(DEFAULT_ASSUMPTIONS.months));
  const [rate, setRate] = useState('150');
  const [hours, setHours] = useState(String(DEFAULT_ASSUMPTIONS.desiredHoursPerDay));
  const [cost, setCost] = useState(String(DEFAULT_ASSUMPTIONS.costShareBps / 100));
  const [results, setResults] = useState<{ asOf: string; list: PlanResult[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = () => {
    const m = Number(months);
    const rt = parseZloty(rate);
    const h = Number(hours.replace(',', '.'));
    const c = Number(cost.replace(',', '.'));
    if (!Number.isInteger(m) || m < 3 || m > 36) return setErr('Horyzont: 3–36 miesięcy.');
    if (rt === null || rt <= 0 || rt > zl(5_000)) return setErr('Stawka za godzinę: kwota dodatnia do 5 000 zł.');
    if (!Number.isFinite(h) || h < 0 || h > 12) return setErr('Godziny dziennie dla firmy: 0–12.');
    if (!Number.isFinite(c) || c < 0 || c > 90) return setErr('Koszty: 0–90% przychodu.');
    setErr(null);
    setBusy(true);
    const a: PlanAssumptions = { months: m, hourlyRate: rt, costShareBps: Math.round(c * 100), desiredHoursPerDay: h };
    setTimeout(() => {
      try {
        setResults({ asOf: game.clock.today, list: runPlanning(game, a, standardScenarios(game)) });
      } finally {
        setBusy(false);
      }
    }, 20);
  };
  const stale = results && results.asOf !== game.clock.today;
  const field = 'w-28 rounded-xl border border-ink-600 bg-ink-900/80 px-3 py-2 text-slate-100 focus:border-sky focus:outline-none';
  return (
    <div className="space-y-5">
      <ScreenHeader title="Planowanie" subtitle="Porównanie scenariuszy na kopii Twojego stanu gry. To PROGNOZA przy założeniach poniżej — niczego nie zmienia i nie księguje." />
      <div role="note" className="rounded-xl border border-sky/30 bg-sky/5 p-3 text-xs leading-relaxed text-sky" data-testid="plan-notice">
        <strong>Prognoza, nie gwarancja.</strong> Zakładamy stałą sprzedaż (godziny × stawka), brak zdarzeń losowych i brak opóźnień płatności. Wyniki używają tego samego silnika podatków, ZUS i czasu co gra.
      </div>
      <Card title="Założenia">
        <form className="flex flex-wrap items-end gap-4" onSubmit={(e) => { e.preventDefault(); run(); }} noValidate>
          <div><label htmlFor="pl-months" className="mb-1 block text-xs text-slate-400">Horyzont (mies.)</label><input id="pl-months" className={field} value={months} onChange={(e) => setMonths(e.target.value)} inputMode="numeric" /></div>
          <div><label htmlFor="pl-rate" className="mb-1 block text-xs text-slate-400">Stawka netto / godz. (zł)</label><input id="pl-rate" className={field} value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" /></div>
          <div><label htmlFor="pl-hours" className="mb-1 block text-xs text-slate-400">Godz. dla firmy / dzień</label><input id="pl-hours" className={field} value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" /></div>
          <div><label htmlFor="pl-cost" className="mb-1 block text-xs text-slate-400">Koszty (% przychodu)</label><input id="pl-cost" className={field} value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" /></div>
          <Button type="submit" variant="primary" disabled={busy} data-testid="plan-run">{busy ? 'Liczę…' : 'Oblicz prognozę'}</Button>
        </form>
        {err && <p role="alert" className="mt-3 text-sm text-loss">{err}</p>}
      </Card>
      {results && (
        <Card title={`PROGNOZA na dzień ${formatDatePL(results.asOf)}`}>
          {stale && <p className="mb-3 text-xs text-gold">Stan gry zmienił się od obliczenia — policz prognozę ponownie.</p>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm" data-testid="plan-results">
              <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><th className="pb-2 font-medium">Scenariusz</th><th className="pb-2 text-right font-medium">Wolne godz./dzień</th><th className="pb-2 text-right font-medium">Pensja netto</th><th className="pb-2 text-right font-medium">Przychód firmy</th><th className="pb-2 text-right font-medium">Podatki i ZUS</th><th className="pb-2 text-right font-medium">Zmiana majątku</th><th className="pb-2 text-right font-medium">Min. płynność</th></tr></thead>
              <tbody className="divide-y divide-ink-700/60">
                {results.list.map((r) => (
                  <tr key={r.scenarioId} className={cx(!r.feasible && 'opacity-60')} data-testid={`plan-${r.scenarioId}`}>
                    <td className="py-2 align-top text-slate-200">
                      {r.label}<span className="text-xs text-slate-500"> · {r.months} mies.</span>
                      {r.warnings.map((w) => <div key={w} className="text-xs text-gold">{w}</div>)}
                    </td>
                    {r.feasible ? (
                      <>
                        <td className="py-2 text-right align-top">{r.freeHoursPerDay} (firma: {r.businessHoursPerDay})</td>
                        <td className="py-2 text-right align-top"><Money value={r.salaryNet} round /></td>
                        <td className="py-2 text-right align-top"><Money value={r.businessRevenue} round /></td>
                        <td className="py-2 text-right align-top"><Money value={r.taxesAndZus} round /></td>
                        <td className={cx('py-2 text-right align-top', moneyTone(r.netWorthChange))}><Money value={r.netWorthChange} signed round /></td>
                        <td className={cx('py-2 text-right align-top', moneyTone(r.minLiquidity))}><Money value={r.minLiquidity} round />{r.overdueCount > 0 && <div className="text-xs text-loss">{r.overdueCount} zaległ.</div>}</td>
                      </>
                    ) : <td colSpan={6} className="py-2 text-right text-xs text-slate-500">scenariusz niemożliwy</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">{results.list[0] ? `Pierwszy miesiąc prognozy: ${formatMonthPL(results.list[0].monthly[0]?.month ?? results.asOf.slice(0, 7))}.` : ''} Zmiana formy opodatkowania działa od najbliższego 1 stycznia; scenariusze z nią mają dłuższy horyzont.</p>
        </Card>
      )}
    </div>
  );
}
