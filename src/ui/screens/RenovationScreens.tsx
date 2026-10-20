import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { businessState, profileOf } from '../../engine/business.ts';
import { addDays, formatDatePL, weekdayIndex } from '../../engine/date.ts';
import { formatPLN, mulBps, zl } from '../../engine/money.ts';
import {
  defaultQuoteInput, equipmentStatus, referencePrice, jobFinancials, jobForecast, materialAvailable, materialPrice, ownedEquipment, previewQuote, renoDashboard, reputation, skillLevel,
  skillProgress, speedBps, splitKey, stockKey, stockQty, grossOfNet, equipmentBookValue,
} from '../../engine/renovation.ts';
import type { QuoteInput } from '../../engine/renovation.ts';
import type { GameState, RenoEnquiry, RenoQuote } from '../../engine/state.ts';
import { memberLabel } from '../../engine/teams.ts';
import { commands } from '../../engine/commands.ts';
import {
  COMPLEXITY_LABEL, EQUIPMENT, MATERIALS, MATERIAL_BY_ID, QUALITY_REQ_LABEL, SERVICES, SERVICE_BY_ID, SKILL_THRESHOLD_CENTI, SPECIALIZATION_COURSE, STANDARDS,
} from '../../engine/renovationCatalog.ts';
import type { MaterialStandard } from '../../engine/state.ts';
import { budgetFor } from '../../engine/time.ts';
import { businessLiquidity } from '../../engine/selectors.ts';
import { liquidityForecast, teamLoad } from '../../engine/profitability.ts';
import { marketOverview, marketPrices } from '../../engine/marketAnalytics.ts';
import { SEGMENTS } from '../../engine/marketConfig.ts';
import { activeEmployments, monthlyEmployerCost, personById, personLevel, personName, wageOn } from '../../engine/workforce.ts';
import { vehicleDef } from '../../engine/fleet.ts';
import { subPrice } from '../../engine/subcontractors.ts';
import { resourceBusy } from '../../engine/teams.ts';
import { crewKey, parseCrewKey, quoteSchedule } from '../../engine/renovation.ts';
import type { CrewMember } from '../../engine/renovation.ts';
import { useGameStore } from '../../store/gameStore.ts';
import { useOpGame } from '../useOperator.ts';
import { currentOperator } from '../../engine/operator.ts';
import { ProgressBar } from '../components/charts.tsx';
import { Badge, Button, Card, Empty, Money, ScreenHeader, StatCard, cx, moneyTone } from '../components/ui.tsx';
import { parseZloty } from '../format.ts';
import { LegalBadge } from './BusinessScreens.tsx';
import { estimatePocket } from '../../engine/pocket.ts';
import { JobEconomicsRows, QuoteEconomicsPanel } from './EconomicsPanel.tsx';

const stars = (rating10: number) => `${(rating10 / 10).toFixed(1).replace('.', ',')}★`;
const STAGE_LABEL = { preparation: 'przygotowanie', materials: 'brak materiałów / sprzętu', execution: 'realizacja', handover: 'odbiór', settlement: 'rozliczenie', done: 'zakończony', cancelled: 'rozwiązany' } as const;
const STAGE_TONE = { preparation: 'neutral', materials: 'gold', execution: 'sky', handover: 'sky', settlement: 'sky', done: 'gain', cancelled: 'loss' } as const;
const RISK_TONE = { niskie: 'gain', średnie: 'gold', wysokie: 'loss' } as const;
const fmtPct = (bps: number) => `${(bps / 100).toFixed(1).replace('.', ',')}%`;

function useReno() {
  const game = useOpGame();
  const biz = currentOperator(game);
  return { game, biz, isReno: !!biz && profileOf(biz).industry === 'renovation' };
}

function NoReno({ title }: { title: string }) {
  const navigate = useGameStore((s) => s.navigate);
  return (
    <div className="space-y-5">
      <ScreenHeader title={title} />
      <Card>
        <Empty>
          Ten moduł wymaga prowadzonej działalności remontowo-wykończeniowej (profil „Usługi remontowo-wykończeniowe”).
          <div className="mt-3"><Button variant="primary" onClick={() => navigate('bizRegister')}>Zarejestruj działalność remontową</Button></div>
        </Empty>
      </Card>
    </div>
  );
}

const ParamNote = () => (
  <p className="text-xs text-slate-500" data-testid="reno-param-note">
    Ceny, stawki, normy czasu i zużycia w branży remontowej to <strong>parametry symulacyjne</strong> — nie oficjalny cennik ani dane rynkowe. Wszystkie kwoty w wycenach podano <strong>netto</strong>, chyba że napisano „brutto”.
  </p>
);

function Row({ k, v, tone }: { k: ReactNode; v: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <dt className="text-slate-400">{k}</dt>
      <dd className={cx('tabular text-right', tone ?? 'text-slate-100')}>{v}</dd>
    </div>
  );
}

/* ---------- 1. Pulpit firmy ---------- */

export function RenoDashboardScreen() {
  const { game, biz, isReno } = useReno();
  const navigate = useGameStore((s) => s.navigate);
  if (!biz || !isReno) return <NoReno title="Pulpit zleceń — Remonty" />;
  const d = renoDashboard(game);
  const liq = businessLiquidity(game);
  const active = game.reno.jobs.filter((j) => j.stage !== 'done' && j.stage !== 'cancelled');
  const attention: { text: string; to: 'renoEnquiries' | 'renoQuotes' | 'renoContracts' | 'renoReputation' }[] = [];
  if (d.openEnquiries) attention.push({ text: `${d.openEnquiries} zapytań czeka na wycenę`, to: 'renoEnquiries' });
  if (d.quotesAwaitingYou) attention.push({ text: `${d.quotesAwaitingYou} ofert wymaga Twojej decyzji (negocjacje / podpis umowy)`, to: 'renoQuotes' });
  if (d.complaintsOpen) attention.push({ text: `${d.complaintsOpen} reklamacji czeka na odpowiedź`, to: 'renoReputation' });
  if (d.jobsAtRisk) attention.push({ text: `${d.jobsAtRisk} kontraktów z wysokim ryzykiem opóźnienia`, to: 'renoContracts' });
  const delta = d.actualCostActive - d.plannedCostActive;
  return (
    <div className="space-y-5">
      <ScreenHeader title="Pulpit zleceń — Remonty" subtitle={`${biz.name} · reputacja ${d.reputation.stars.toString().replace('.', ',')}★ (${d.reputation.reviews} opinii)`} />
      <ParamNote />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard testId="reno-cash" label="Gotówka firmy" icon="wallet" accent="gain" value={<Money value={liq.balance} />} hint={<>płynność 30 dni: <Money value={liq.coverage} signed /></>} />
        <StatCard label="Należności (30 dni)" icon="receipt" accent="sky" value={<Money value={liq.receivablesDue} />} hint="od klientów i urzędów" />
        <StatCard label="Obciążenie harmonogramu" icon="clock" accent={d.scheduleLoadPct > 60 ? 'gold' : 'violet'} value={`${d.scheduleLoadPct}%`} hint="14 dni, względem 8 godz. dziennie" />
        <StatCard label="Kontrakty w toku" icon="briefcase" accent={d.jobsAtRisk ? 'loss' : 'gold'} value={d.activeJobs} hint={d.jobsAtRisk ? `${d.jobsAtRisk} z wysokim ryzykiem` : 'ryzyko opóźnień: niskie'} />
      </div>
      <Card title="Firma i zespół">
        {(() => {
          const emps = activeEmployments(game);
          const monthly = emps.reduce((a, e) => a + monthlyEmployerCost(wageOn(e, game.clock.today)), 0);
          const loads = game.ops.teams.map((tm) => teamLoad(game, tm.id).pct);
          const avgLoad = loads.length ? Math.round(loads.reduce((a, x) => a + x, 0) / loads.length) : 0;
          const f = liquidityForecast(game, 60);
          return (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5" data-testid="company-panel">
              <div><div className="text-xs text-slate-400">Pracownicy</div><div className="text-xl font-semibold text-slate-100">{emps.length}</div></div>
              <div><div className="text-xs text-slate-400">Koszt zatrudnienia / mies.</div><div className="text-xl font-semibold text-slate-100"><Money value={monthly} round /></div></div>
              <div><div className="text-xs text-slate-400">Aktywne kontrakty</div><div className="text-xl font-semibold text-slate-100">{d.activeJobs}</div></div>
              <div><div className="text-xs text-slate-400">Obłożenie ekip (14 dni)</div><div className="text-xl font-semibold text-slate-100">{loads.length ? `${avgLoad}%` : '—'}</div></div>
              <div><div className="text-xs text-slate-400">Prognoza płynności (60 dni)</div><div className={cx('text-xl font-semibold', f.min < 0 ? 'text-loss' : 'text-gain')}><Money value={f.min} round signed /></div><div className="text-xs text-slate-500">najniższe saldo{f.firstShortfall ? ` · brak środków od ${formatDatePL(f.firstShortfall)}` : ''}</div></div>
            </div>
          );
        })()}
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Koszty planowane i rzeczywiste (kontrakty w toku)">
          <dl className="divide-y divide-ink-700/60">
            <Row k="Wartość kontraktów (netto)" v={<Money value={d.contractedNet} />} />
            <Row k="Koszt planowany (z Twoją robocizną)" v={<Money value={d.plannedCostActive} />} />
            <Row k="Koszt rzeczywisty dotychczas" v={<Money value={d.actualCostActive} />} />
            <Row k="Różnica rzeczywisty − planowany" v={<Money value={delta} signed />} tone={moneyTone(-delta)} />
          </dl>
          <p className="mt-2 text-xs text-slate-500">Koszt rzeczywisty = zużyte materiały + transport + inne + poprawki + Twoja robocizna po stawce z wyceny. Zakup materiałów to wydatek (gotówka i koszt podatkowy), a koszt ekonomiczny powstaje przy zużyciu.</p>
        </Card>
        <Card title="Wynik zakończonych kontraktów">
          <dl className="divide-y divide-ink-700/60">
            <Row k="Zakończone kontrakty" v={d.doneJobs} />
            <Row k="Przychód netto" v={<Money value={d.revenueDone} />} />
            <Row k="Nadwyżka przed obciążeniami właściciela (ukończone)" v={<Money value={d.economicResultDone} signed />} tone={moneyTone(d.economicResultDone)} />
            <Row k="Zysk ekonomiczny po pracy właściciela (kalkulacyjnie, ukończone)" v={<Money value={d.economicProfitDone} signed />} tone={moneyTone(d.economicProfitDone)} />
            <Row k="Zapasy materiałów (aktywo)" v={<Money value={d.stockValue} />} />
            <Row k="Sprzęt — wartość księgowa (aktywo)" v={<Money value={d.equipmentValue} />} />
          </dl>
        </Card>
      </div>
      <Card title="Marża na kontraktach">
        {game.reno.jobs.length === 0 ? <Empty>Brak kontraktów. Zacznij od zapytań klientów.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm" data-testid="reno-margins">
              <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><th className="pb-2 font-medium">Kontrakt</th><th className="pb-2 text-right font-medium">Cena netto</th><th className="pb-2 text-right font-medium">Marża plan. (po pracy własnej)</th><th className="pb-2 text-right font-medium">Marża rzecz.</th><th className="pb-2 text-right font-medium">Nadwyżka przed obciążeniami</th><th className="pb-2 text-right font-medium">Zysk ekonomiczny</th><th className="pb-2 text-right font-medium">Za godz. własnej pracy</th></tr></thead>
              <tbody className="divide-y divide-ink-700/60">
                {[...game.reno.jobs].reverse().slice(0, 10).map((j) => {
                  const f = jobFinancials(j);
                  return (
                    <tr key={j.id}>
                      <td className="py-2 text-slate-300">{SERVICE_BY_ID.get(j.serviceId)!.label} · {j.units} {SERVICE_BY_ID.get(j.serviceId)!.unit} <span className="text-xs text-slate-500">({j.clientName.split(' (')[0]})</span></td>
                      <td className="py-2 text-right"><Money value={j.priceNet} /></td>
                      <td className="py-2 text-right text-slate-400">{fmtPct(f.plannedMarginBps)}</td>
                      <td className="py-2 text-right">{f.actualMarginBps === null ? '—' : fmtPct(f.actualMarginBps)}</td>
                      <td className={cx('py-2 text-right', moneyTone(f.surplusBeforeOwner))}><Money value={f.surplusBeforeOwner} signed /></td>
                      <td className={cx('py-2 text-right', moneyTone(f.economicProfit))}><Money value={f.economicProfit} signed /></td>
                      <td className="py-2 text-right">{f.hourlyPay === null ? '—' : <Money value={f.hourlyPay} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">Marża = (cena − koszt) / cena; narzut = (cena − koszt) / koszt — to dwie różne liczby. Wynik gotówkowy firmy widzisz w „Finanse firmy”, podatki w „Podatki i ZUS”.</p>
      </Card>
      <Card title="Wymaga uwagi">
        {attention.length === 0 ? <Empty>Nic nie wymaga Twojej decyzji.</Empty> : (
          <ul className="divide-y divide-ink-700/60" data-testid="reno-attention">
            {attention.map((a) => (
              <li key={a.text} className="flex items-center justify-between gap-3 py-2 text-sm text-slate-200"><span>{a.text}</span><Button variant="secondary" onClick={() => navigate(a.to)}>Przejdź</Button></li>
            ))}
          </ul>
        )}
        {active.length > 0 && <p className="mt-3 text-xs text-slate-500">Szczegóły terminów i ryzyka — w „Harmonogramie”.</p>}
      </Card>
    </div>
  );
}

/* ---------- 2. Zapytania klientów ---------- */

/** Werdykt „czy zdążę?” na karcie zapytania: czy oczekiwany termin klienta jest wolny, kto go zajmuje i kiedy najwcześniej mogę zacząć. */
function EnquiryAvailability({ game, enq }: { game: GameState; enq: RenoEnquiry }) {
  const v = useMemo(() => {
    const base = defaultQuoteInput(game, enq);
    const tomorrow = addDays(game.clock.today, 1);
    const wish = enq.desiredStart > tomorrow ? enq.desiredStart : tomorrow;
    const q: QuoteInput = { ...base, startDate: wish };
    const sch = quoteSchedule(game, q);
    const end = addDays(wish, base.durationDays - 1);
    const blocking = sch.busy.filter((b) => b.kind === 'job' && b.from <= end && wish <= b.to);
    const clash = sch.days.some((d) => d.date >= wish && d.date <= end && d.overload);
    const strip = sch.days.filter((d) => d.date >= addDays(wish, -3)).slice(0, 21);
    return { q, sch, wish, end, blocking, clash, strip, firstFree: sch.suggestedStart };
  }, [game, enq]);
  const { q, wish, end, blocking, clash, strip, firstFree } = v;
  const label = (d: string) => `${d.slice(8)}.${d.slice(5, 7)}`;
  const delay = firstFree ? Math.round((Date.parse(firstFree) - Date.parse(wish)) / 86_400_000) : null;
  const tooLate = delay !== null && delay > enq.flexDays;
  const inWish = (d: string) => d >= wish && d <= end;
  return (
    <div className={cx('mt-3 rounded-xl border p-3 text-xs', clash ? (tooLate || firstFree === null ? 'border-loss/40 bg-loss/5' : 'border-gold/40 bg-gold/5') : 'border-gain/30 bg-gain/5')} data-testid={`enquiry-availability-${enq.id}`} data-state={clash ? 'busy' : 'free'}>
      <div className={cx('text-sm font-semibold', clash ? (tooLate || firstFree === null ? 'text-loss' : 'text-gold') : 'text-gain')}>
        {clash ? '✖ Masz zajęty termin' : '✓ Termin klienta jest wolny'}
      </div>
      <p className="mt-0.5 text-slate-300">
        {clash
          ? <>Klient chce <strong>{label(wish)}–{label(end)}</strong> ({q.durationDays} dni po {q.hoursPerDay} godz.). {blocking.length > 0 ? <>W tym czasie trwa: {blocking.map((b) => `${b.label.split(' — ')[0]} (do ${label(b.to)})`).join(', ')}. </> : <>Doba się nie zmieści (etat, sen, obowiązki). </>}</>
          : <>Zmieścisz <strong>{label(wish)}–{label(end)}</strong> ({q.durationDays} dni po {q.hoursPerDay} godz.) bez kolizji z innymi kontraktami.</>}
        {clash && (firstFree
          ? <>Najwcześniej możesz zacząć <strong>{label(firstFree)}</strong> ({delay === 0 ? 'bez opóźnienia' : `${delay} dn. po życzeniu klienta`}){tooLate ? ` — klient dopuszcza tylko ±${enq.flexDays} dn., więc może odmówić lub poprosić o inną datę` : ''}.</>
          : ' W ciągu 120 dni nie ma wolnego terminu na tę pracę.')}
      </p>
      <div className="mt-2 grid gap-0.5" style={{ gridTemplateColumns: `repeat(${strip.length}, minmax(0, 1fr))` }} aria-label="Najbliższe dni" data-testid={`enquiry-strip-${enq.id}`}>
        {strip.map((d) => (
          <div
            key={d.date}
            title={`${formatDatePL(d.date)}: ${d.commitments > 0 ? `zajęte kontraktami ${d.commitments} godz.` : 'wolne'}${d.overload ? ' — ta praca się nie zmieści' : ''}`}
            className={cx(
              'rounded-sm py-0.5 text-center text-[10px] leading-tight',
              d.overload ? 'bg-loss/30 text-loss' : d.commitments > 0 ? 'bg-sky/20 text-sky' : 'bg-ink-800 text-slate-400',
              inWish(d.date) && 'ring-1 ring-gold',
            )}
          >{Number(d.date.slice(8))}</div>
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-slate-500">
        <span>szare — wolne</span><span className="text-sky">niebieskie — zajęte, ale się mieści</span><span className="text-loss">czerwone — nie zmieści się</span><span className="text-gold">ramka — termin klienta</span>
      </div>
    </div>
  );
}

export function RenoEnquiriesScreen() {
  const { game, biz, isReno } = useReno();
  const select = useGameStore((s) => s.selectEnquiry);
  const navigate = useGameStore((s) => s.navigate);
  const decline = useGameStore((s) => s.declineEnquiry);
  if (!biz || !isReno) return <NoReno title="Zapytania klientów" />;
  const open = game.reno.enquiries.filter((e) => e.status === 'open');
  const history = [...game.reno.enquiries].filter((e) => e.status !== 'open').reverse().slice(0, 8);
  const mkt = marketOverview(game);
  const stateNow = businessState(biz, game.clock.today);
  const openCount = game.reno.enquiries.filter((e) => e.status === 'open' || e.status === 'quoted').length;
  const noEnquiryReason =
    stateNow === 'suspended' ? 'Działalność jest zawieszona — zapytania nie przychodzą. Wznów ją w „Mojej działalności”.'
    : stateNow === 'closing' || stateNow === 'closed' ? 'Działalność się kończy — zapytania nie przychodzą.'
    : stateNow === 'pending' ? `Działalność rozpocznie się ${formatDatePL(biz.startDate)} — wtedy zaczną napływać zapytania.`
    : game.reno.specializations.length === 0 ? 'Nie masz żadnej specjalizacji — dodaj ją w „Magazyn i sprzęt”.'
    : openCount >= 6 ? 'Masz już maksymalną liczbę otwartych zapytań i ofert (6) — odpowiedz na część, aby przyjąć nowe.'
    : null;
  const label = (st: string) => ({ quoted: 'wyceniono', won: 'wygrane', lost: 'przegrane', expired: 'wygasło', declined: 'odrzucone' }[st] ?? st);
  return (
    <div className="space-y-5">
      <ScreenHeader title="Zapytania klientów" subtitle="Klienci indywidualni pytają o usługi z Twoich specjalizacji. Odpowiedz na czas — szybka oferta poprawia ocenę komunikacji." />
      <ParamNote />
      <Card title="Otwarte zapytania">
        {open.length === 0 ? <Empty><span data-testid="no-enquiries">Brak otwartych zapytań.</span> {noEnquiryReason ?? <>Zapytania zależą od popytu na rynku ({mkt.macro.phase}), sezonu, Twojego marketingu, opinii i konkurencji — średnio {mkt.inquiriesPerMonth.toFixed(1).replace('.', ',')} miesięcznie (ekrany „Rynek”, „Marketing”, „Analiza popytu”).</>}</Empty> : (
          <ul className="grid gap-3 lg:grid-cols-2" data-testid="enquiries-list">
            {open.map((e) => {
              const def = SERVICE_BY_ID.get(e.serviceId)!;
              const spec = game.reno.specializations.includes(e.serviceId);
              return (
                <li key={e.id} data-testid={`enquiry-${e.id}`} className="rounded-xl border border-ink-700 bg-ink-900/40 p-4 text-sm">
                  <div className="flex items-start justify-between gap-2"><strong className="text-slate-100">{def.label}</strong><Badge tone={spec ? 'gain' : 'neutral'}>{spec ? 'Twoja specjalizacja' : 'poza specjalizacją'}</Badge></div>
                  <div className="mt-1 text-slate-300">{e.units} {def.unit} · {e.location} · {COMPLEXITY_LABEL[e.complexity]}</div>
                  <dl className="mt-2 divide-y divide-ink-700/60">
                    <Row k="Klient" v={<>{e.clientName.split(' (')[0]} <Badge tone={e.segment === 'premium' ? 'gold' : e.segment === 'budget' ? 'neutral' : 'sky'}>{SEGMENTS[e.segment].label.toLowerCase()}</Badge></>} />
                    <Row k="Konkurencja" v={e.rivals === 0 ? 'pyta tylko Ciebie' : `porównuje oferty ${e.rivals + 1} firm`} tone={e.rivals === 0 ? 'text-gain' : 'text-slate-300'} />
                    <Row k="Szacowany budżet (brutto)" v={<Money value={e.budgetGross} round />} />
                    <Row k="Wymagania jakościowe" v={QUALITY_REQ_LABEL[e.qualityReq]} />
                    <Row k="Oczekiwany start" v={`${formatDatePL(e.desiredStart)} (±${e.flexDays} dn.)`} />
                    <Row k="Maks. czas realizacji" v={`${e.maxDays} dni`} />
                    <Row k="Odpowiedz do" v={formatDatePL(e.respondBy)} tone="text-gold" />
                  </dl>
                  <EnquiryAvailability game={game} enq={e} />
                  <div className="mt-3 flex gap-2">
                    <Button variant="primary" data-testid={`quote-${e.id}`} onClick={() => { select(e.id); navigate('renoQuotes'); }}>Wyceń</Button>
                    <Button variant="ghost" onClick={() => decline(e.id)}>Odrzuć</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {history.length > 0 && (
        <Card title="Ostatnie zapytania">
          <ul className="divide-y divide-ink-700/60 text-sm">
            {history.map((e) => <li key={e.id} className="flex justify-between gap-2 py-2 text-slate-300"><span>{SERVICE_BY_ID.get(e.serviceId)!.label}, {e.units} {SERVICE_BY_ID.get(e.serviceId)!.unit} — {e.clientName.split(' (')[0]}</span><Badge tone={e.status === 'won' ? 'gain' : e.status === 'quoted' ? 'sky' : 'neutral'}>{label(e.status)}</Badge></li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}

/* ---------- 3. Wyceny ---------- */

const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

/** Kalendarz zajętości przy wycenie: dni zajęte kontraktami, kolizje wycenianej pracy i najbliższy wolny termin. Kliknięcie dnia ustawia początek prac. */
function QuoteCalendar({ game, enq, q, planWarnings, onPick }: { game: GameState; enq: RenoEnquiry; q: QuoteInput; planWarnings: string[]; onPick: (date: string) => void }) {
  const sched = useMemo(() => quoteSchedule(game, q), [game, q.startDate, q.durationDays, q.hoursPerDay, q.teamId, q.supervision, q.vehicleId]); // eslint-disable-line react-hooks/exhaustive-deps
  const dur = Number.isInteger(q.durationDays) && q.durationDays >= 1 ? q.durationDays : 1;
  const selEnd = addDays(q.startDate, dur - 1);
  const inSel = (d: string) => d >= q.startDate && d <= selEnd;
  const windowOverload = sched.days.find((d) => inSel(d.date) && d.overload);
  const resourceClash = planWarnings.some((w) => /przydzielony do kontraktu|Pojazd jest już/.test(w));
  const ok = !windowOverload && !resourceClash;
  const lead = weekdayIndex(sched.days[0]!.date);
  const cells: (typeof sched.days[number] | null)[] = [...Array.from({ length: lead }, () => null), ...sched.days];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  const label = (d: string) => `${d.slice(8)}.${d.slice(5, 7)}`;
  return (
    <div className="space-y-3 rounded-xl border border-ink-700 p-3 text-sm" data-testid="quote-calendar">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-semibold text-slate-200">Twój kalendarz</h4>
        <span className="text-xs text-slate-500">Ta praca zajmie Ci {sched.ownerHours} godz. dziennie · kliknij dzień, by ustawić start</span>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] tracking-wide text-slate-500 uppercase">{['pn', 'wt', 'śr', 'cz', 'pt', 'so', 'nd'].map((x) => <div key={x}>{x}</div>)}</div>
      <div className="space-y-1">
        {weeks.map((wk, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1">
            {wk.map((d, di) => d === null ? <div key={di} /> : (
              <button
                key={d.date}
                type="button"
                onClick={() => onPick(d.date)}
                title={`${formatDatePL(d.date)}: kontrakty i obowiązki zajmują ${d.commitments} godz.; po tej wycenie zostaje ${d.free} godz.${d.overload ? ' — NIE MIEŚCI SIĘ' : ''}`}
                data-testid={`qcal-${d.date}`}
                data-state={d.overload ? 'overload' : d.commitments > 0 ? 'busy' : 'free'}
                className={cx(
                  'rounded-md px-0.5 py-1 text-center text-[11px] leading-tight transition hover:brightness-125',
                  d.overload ? 'bg-loss/25 text-loss' : d.commitments > 0 ? 'bg-sky/15 text-sky' : 'bg-ink-800 text-slate-300',
                  inSel(d.date) && 'ring-2 ring-gold',
                )}
              >
                <div className="font-semibold">{d.date.slice(8) === '01' || (wi === 0 && di === lead) ? `${Number(d.date.slice(8))} ${MONTHS_SHORT[Number(d.date.slice(5, 7)) - 1]}` : Number(d.date.slice(8))}</div>
                <div className="text-[10px] opacity-80">{d.commitments > 0 ? `zajęte ${d.commitments}h` : 'wolne'}</div>
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span><span className="mr-1 inline-block size-2 rounded-sm bg-ink-800 ring-1 ring-ink-600" />wolne</span>
        <span><span className="mr-1 inline-block size-2 rounded-sm bg-sky/40" />zajęte kontraktami (mieści się)</span>
        <span><span className="mr-1 inline-block size-2 rounded-sm bg-loss/50" />nie zmieści się</span>
        <span><span className="mr-1 inline-block size-2 rounded-sm ring-2 ring-gold" />wybrany termin</span>
      </div>
      <div className={cx('rounded-lg border px-3 py-2 text-xs', ok ? 'border-gain/30 bg-gain/5 text-gain' : 'border-loss/40 bg-loss/5 text-loss')} data-testid="quote-availability">
        {ok ? `✓ Termin ${label(q.startDate)}–${label(selEnd)} jest wolny.` : windowOverload ? `✖ Kolizja od ${label(windowOverload.date)}: brakuje ${-windowOverload.free} godz. w dobie.` : '✖ Ktoś z ekipy lub pojazd jest zajęty w tym terminie (szczegóły w ostrzeżeniach).'}
        {!ok && (sched.suggestedStart
          ? <> Najbliższy wolny start: <strong>{label(sched.suggestedStart)}</strong> <Button variant="secondary" className="ml-1 px-2 py-0.5 text-xs" onClick={() => onPick(sched.suggestedStart!)} data-testid="qcal-suggest">Ustaw {label(sched.suggestedStart)}</Button></>
          : ' Nie ma wolnego terminu w ciągu 120 dni — skróć czas, zmniejsz godziny dziennie albo zleć pracę ekipie.')}
      </div>
      <p className="text-xs text-slate-500">Klient chciałby zacząć od <strong className="text-slate-300">{formatDatePL(enq.desiredStart)}</strong> (elastyczność ±{enq.flexDays} dni), a skończyć w {enq.maxDays} dni od startu.</p>
      <div>
        <div className="mb-1 text-xs text-slate-400">Zajęte terminy</div>
        {sched.busy.length === 0 ? <p className="text-xs text-slate-500">Brak kontraktów ani ofert w kalendarzu — wszystko wolne.</p> : (
          <ul className="space-y-1 text-xs" data-testid="quote-busy">
            {sched.busy.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-slate-300">{b.label}</span>
                <span className="text-slate-400">{formatDatePL(b.from)} – {formatDatePL(b.to)} · {b.hoursPerDay} godz./dz. <Badge tone={b.kind === 'job' ? 'sky' : 'neutral'}>{b.kind === 'job' ? 'kontrakt' : 'oferta bez umowy'}</Badge></span>
              </li>
            ))}
          </ul>
        )}
        {sched.busy.some((b) => b.kind === 'pending') && <p className="mt-1 text-xs text-slate-500">Oferty bez podpisanej umowy jeszcze nie rezerwują czasu — jeśli klient je przyjmie, ich terminy też zajmą Ci kalendarz.</p>}
      </div>
    </div>
  );
}

function QuoteBuilder({ enquiryId }: { enquiryId: string }) {
  const game = useOpGame();
  const send = useGameStore((s) => s.sendQuote);
  const select = useGameStore((s) => s.selectEnquiry);
  const enq = game.reno.enquiries.find((e) => e.id === enquiryId);
  const base = useMemo(() => (enq ? defaultQuoteInput(game, enq, 8) : null), [enquiryId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [q, setQ] = useState<QuoteInput | null>(base);
  const [priceText, setPriceText] = useState(base ? String(base.priceNet / 100) : '');
  if (!enq || !q || !base || enq.status !== 'open') return <Card><Empty>To zapytanie nie jest już otwarte.</Empty></Card>;
  const def = SERVICE_BY_ID.get(enq.serviceId)!;
  const price = parseZloty(priceText);
  const input: QuoteInput = { ...q, priceNet: price ?? 0 };
  const p = previewQuote(game, input);
  const set = (patch: Partial<QuoteInput>) => setQ({ ...q, ...patch });
  const num = (v: string) => (v.trim() === '' ? NaN : Number(v.replace(',', '.')));
  const setMarkup = (bps: number) => { const net = Math.round((p.planned.total * (10_000 + bps)) / 10_000 / 1_000) * 1_000; setPriceText(String(net / 100)); };
  const field = 'w-full rounded-xl border border-ink-600 bg-ink-900/80 px-3 py-2 text-slate-100 focus:border-sky focus:outline-none';
  const mp = marketPrices(game);
  const refPrice = referencePrice(enq.serviceId, enq.units, enq.complexity, enq.qualityReq);
  // podwykonawcy gotowi wziąć całe zlecenie (poziom jakości ≥ trudność), z ceną za 100% zakresu
  const subLevel = (quality: number) => Math.max(1, Math.min(5, Math.round((quality - 40) / 10)));
  const subOptions = game.ops.subcontractors.filter((x) => x.services.includes(enq.serviceId)).map((x) => ({ sub: x, price: subPrice(x, enq.serviceId, enq.units, enq.complexity, 10_000), fits: subLevel(x.quality) >= p.difficulty, busyUntil: resourceBusy(game, 'sub', x.id, q.startDate, addDays(q.startDate, Math.max(1, Number.isNaN(q.durationDays) ? 1 : q.durationDays) - 1))?.to ?? null }));
  // skład wykonawców: z gotowej ekipy albo wybrany tu (właściciel / zatrudnieni pracownicy / podwykonawcy)
  const members: CrewMember[] = !q.teamId ? [{ kind: 'owner', id: 'owner' }] : parseCrewKey(q.teamId) ?? game.ops.teams.find((tm) => tm.id === q.teamId)?.members ?? [{ kind: 'owner', id: 'owner' }];
  const has = (kind: CrewMember['kind'], id: string) => members.some((m) => m.kind === kind && m.id === id);
  const ownerIn = members.some((m) => m.kind === 'owner');
  const customCrew = !!q.teamId && !game.ops.teams.some((tm) => tm.id === q.teamId);
  const employees = activeEmployments(game).map((e) => ({ e, name: personName(personById(game, e.personId)!), level: personLevel(personById(game, e.personId)!, enq.serviceId) }));
  const ownerBlocked = ownerIn && p.errors.some((e) => /umiejętności|specjalizacji|sprzęt/i.test(e));
  // ekipy założone przez gracza (te tworzone automatycznie przy wysyłaniu wycen mają nazwy „Zlecenie: …” i „Ekipa: …” i zaśmiecałyby listę)
  const ownTeams = game.ops.teams.filter((tm) => !/^(Zlecenie|Ekipa): /.test(tm.name));
  // godziny dziennie: domyślnie zawsze 8 (można zmienić ręcznie)
  const hoursFor = (_list: CrewMember[]) => 8;
  const setMembers = (next: CrewMember[]) => {
    if (next.length === 0) return;
    set(next.length === 1 && next[0]!.kind === 'owner' ? { teamId: null, supervision: 'worker', hoursPerDay: 8 } : { teamId: crewKey(next), supervision: next.some((m) => m.kind === 'owner') ? 'worker' : 'hands-off', hoursPerDay: hoursFor(next) });
  };
  const pickTeam = (teamId: string) => {
    const tm = game.ops.teams.find((x) => x.id === teamId);
    if (!tm) { set({ teamId: null, supervision: 'worker', hoursPerDay: 8 }); return; }
    const withOwner = tm.members.some((m) => m.kind === 'owner');
    set({ teamId: tm.id, supervision: withOwner ? 'worker' : 'hands-off', hoursPerDay: hoursFor(tm.members) });
  };
  const toggle = (kind: CrewMember['kind'], id: string) => setMembers(has(kind, id) ? members.filter((m) => !(m.kind === kind && m.id === id)) : [...members, { kind, id }]);
  /** Zlecenie pracy wskazanym wykonawcom (bez właściciela) jednym kliknięciem; jeśli cena nie pokrywa kosztów, ustawia ją z narzutem 25%. */
  const delegate = (to: CrewMember[]) => {
    const next: QuoteInput = { ...q, teamId: crewKey(to), supervision: 'hands-off', priceNet: price ?? 0 };
    set({ teamId: next.teamId, supervision: 'hands-off', hoursPerDay: 8 });
    const np = previewQuote(game, { ...next, hoursPerDay: 8 });
    if (price === null || np.planned.total > next.priceNet) setPriceText(String(Math.round((np.planned.total * 12_500) / 10_000 / 1_000) * 10));
  };
  return (
    <Card title={`Wycena: ${def.label}, ${enq.units} ${def.unit} (${enq.location})`} action={<Button variant="ghost" onClick={() => select(null)}>Zamknij</Button>}>
      <div className="grid gap-5 lg:grid-cols-2" data-testid="quote-builder">
        <div className="space-y-3 text-sm">
          <div>
            <div className="mb-1 text-xs text-slate-400">Standard materiałów</div>
            <div className="flex gap-2">{(Object.keys(STANDARDS) as MaterialStandard[]).map((st) => <button key={st} type="button" aria-pressed={q.standard === st} onClick={() => set({ standard: st })} className={cx('rounded-lg px-3 py-1.5 text-xs', q.standard === st ? 'bg-ink-600 text-white' : 'bg-ink-800 text-slate-400')}>{STANDARDS[st].label}</button>)}</div>
            <p className="mt-1 text-xs text-slate-500">Klient oczekuje: {QUALITY_REQ_LABEL[enq.qualityReq]} jakości.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label htmlFor="q-price" className="mb-1 block text-xs text-slate-400">Cena ofertowa netto (zł)</label><input id="q-price" className={field} value={priceText} onChange={(e) => setPriceText(e.target.value)} inputMode="decimal" /></div>
            <div><label htmlFor="q-labor" className="mb-1 block text-xs text-slate-400">Własna robocizna (zł/godz.)</label><input id="q-labor" className={field} defaultValue={q.laborRate / 100} onChange={(e) => { const v = parseZloty(e.target.value); if (v !== null) set({ laborRate: v }); }} inputMode="decimal" /></div>
            <div><label htmlFor="q-start" className="mb-1 block text-xs text-slate-400">Początek prac</label><input id="q-start" type="date" className={field} value={q.startDate} onChange={(e) => e.target.value && set({ startDate: e.target.value })} /></div>
            <div><label htmlFor="q-days" className="mb-1 block text-xs text-slate-400">Czas realizacji (dni)</label><input id="q-days" className={field} value={Number.isNaN(q.durationDays) ? '' : q.durationDays} onChange={(e) => set({ durationDays: num(e.target.value) })} inputMode="numeric" /></div>
            <div><label htmlFor="q-hpd" className="mb-1 block text-xs text-slate-400">Godzin dziennie</label><input id="q-hpd" className={field} value={Number.isNaN(q.hoursPerDay) ? '' : q.hoursPerDay} onChange={(e) => set({ hoursPerDay: num(e.target.value) })} inputMode="numeric" /></div>
            <div><label htmlFor="q-adv" className="mb-1 block text-xs text-slate-400">Zaliczka (% ceny, 0–50)</label><input id="q-adv" className={field} value={q.advanceBps / 100} onChange={(e) => set({ advanceBps: Math.round(num(e.target.value) * 100) })} inputMode="numeric" /></div>
            <div><label htmlFor="q-term" className="mb-1 block text-xs text-slate-400">Termin płatności reszty (dni)</label><input id="q-term" className={field} value={q.paymentTermDays} onChange={(e) => set({ paymentTermDays: num(e.target.value) })} inputMode="numeric" /></div>
          </div>
          <fieldset className="space-y-2 rounded-xl border border-ink-700 p-3" data-testid="quote-crew">
            <legend className="px-1 text-xs text-slate-400">Kto wykona pracę</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-slate-300"><input type="checkbox" className="size-4 accent-sky" checked={ownerIn} onChange={() => toggle('owner', 'owner')} data-testid="crew-owner" />Ja (właściciel) <span className="text-xs text-slate-500">· poziom {p.level}/{p.difficulty}</span></label>
              {employees.map(({ e, name, level }) => (
                <label key={e.id} className="flex items-center gap-2 text-slate-300"><input type="checkbox" className="size-4 accent-sky" checked={has('employee', e.id)} onChange={() => toggle('employee', e.id)} data-testid={`crew-employee-${e.id}`} />{name} <span className={cx('text-xs', level >= p.difficulty ? 'text-slate-500' : 'text-gold')}>· {e.role.toLowerCase()}, poziom {level}/{p.difficulty}</span></label>
              ))}
            </div>
            <details className="text-xs" open={members.some((m) => m.kind === 'sub')} data-testid="quote-subs">
              <summary className="cursor-pointer text-slate-400 hover:text-slate-200">Podwykonawcy ({subOptions.length}) — zleć komuś z zewnątrz</summary>
              <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {subOptions.map(({ sub, price: sp, fits, busyUntil }) => (
                <label key={sub.id} className="flex items-center gap-2 text-slate-300"><input type="checkbox" className="size-4 accent-sky" checked={has('sub', sub.id)} onChange={() => toggle('sub', sub.id)} data-testid={`crew-sub-${sub.id}`} />{sub.name.replace(' (fikcyjna)', '')} <span className={cx('text-xs', fits ? 'text-slate-500' : 'text-gold')}>· podwykonawca, {formatPLN(sp, { round: true })} za całość{fits ? '' : ' (słabsze kompetencje)'}</span>{busyUntil && <span className="text-xs text-loss"> · zajęty do {formatDatePL(busyUntil)}</span>}</label>
              ))}
              </div>
            </details>
            <p className="text-xs text-slate-400" data-testid="quote-crew-summary">Wybrani wykonawcy: <strong className="text-slate-200">{members.map((m) => memberLabel(game, m)).join(' + ')}</strong>{members.length > 1 ? ' — pracują razem przy tym zleceniu.' : '.'}</p>
            {employees.length === 0 && <p className="text-xs text-slate-500">Zatrudnieni pracownicy pojawią się tu automatycznie (od dnia rozpoczęcia pracy) — nie trzeba tworzyć ekipy.</p>}
            <div className="grid grid-cols-2 gap-3">
              {ownTeams.length > 0 && <div><label htmlFor="q-team" className="mb-1 block text-xs text-slate-400">Albo gotowa ekipa (z ekranu „Ekipy”)</label><select id="q-team" className={field} value={customCrew ? '__custom' : q.teamId ?? ''} onChange={(e) => e.target.value !== '__custom' && pickTeam(e.target.value)}><option value="">— skład wybrany wyżej —</option>{customCrew && <option value="__custom" hidden>własny skład</option>}{ownTeams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name} — {tm.members.map((m) => memberLabel(game, m)).join(' + ')}</option>)}</select></div>}
            <div><label htmlFor="q-veh" className="mb-1 block text-xs text-slate-400">Pojazd</label><select id="q-veh" className={field} value={q.vehicleId ?? ''} onChange={(e) => set({ vehicleId: e.target.value || null })}><option value="">bez pojazdu</option>{game.ops.vehicles.map((v) => <option key={v.id} value={v.id}>{vehicleDef(v).label}</option>)}</select></div>
              {!ownerIn && (
                <div className="col-span-2"><label htmlFor="q-sup" className="mb-1 block text-xs text-slate-400">Nadzór właściciela</label><select id="q-sup" className={field} value={q.supervision === 'supervise' ? 'supervise' : 'hands-off'} onChange={(e) => set({ supervision: e.target.value as 'supervise' | 'hands-off' })}><option value="hands-off">pełne delegowanie (0 godz., większe ryzyko)</option><option value="supervise">nadzoruje (1 godz. dziennie)</option></select></div>
              )}
            </div>
          </fieldset>
          {(ownerBlocked || !ownerIn) && (
            <div className="rounded-xl border border-gold/40 bg-gold/5 p-3 text-xs" data-testid="outsource-box">
              {!ownerIn ? (
                <p className="text-slate-300">Pracę wykonają wybrani wykonawcy, a Ty tylko ją nadzorujesz.{members.some((m) => m.kind === 'sub') && ' Umowa z podwykonawcą zawiera się sama przy podpisaniu kontraktu (zaliczka, jeśli ją stosuje, to przedpłata, nie koszt).'}{members.some((m) => m.kind === 'employee') && ' Pracownicy muszą mieć aktywną umowę w dniu startu i nie mogą pracować przy dwóch kontraktach naraz.'}</p>
              ) : (
                <>
                  <p className="mb-2 font-semibold text-gold">Nie możesz wykonać tego sam — przekaż zlecenie, żeby go nie stracić:</p>
                  {employees.every((x) => x.level < p.difficulty) && subOptions.every((o) => !o.fits) ? <p className="text-slate-400">Nikt z Twoich pracowników ani z puli podwykonawców nie ma wystarczających kompetencji do tego zakresu.</p> : (
                    <ul className="space-y-1.5">
                      {employees.filter((x) => x.level >= p.difficulty).map(({ e, name, level }) => (
                        <li key={e.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-slate-300">{name} <span className="text-slate-500">· Twój pracownik, poziom {level}</span></span>
                          <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => delegate([{ kind: 'employee', id: e.id }])} data-testid={`delegate-${e.id}`}>Zleć pracownikowi</Button>
                        </li>
                      ))}
                      {subOptions.filter((o) => o.fits).map(({ sub, price: sp }) => (
                        <li key={sub.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-slate-300">{sub.name} <span className="text-slate-500">· jakość {sub.quality}, niezawodność {Math.round(sub.reliabilityBps / 100)}%</span> · <strong>{formatPLN(sp, { round: true })}</strong> netto</span>
                          <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => delegate([{ kind: 'sub', id: sub.id }])} data-testid={`outsource-${sub.id}`}>Zleć i wyceń</Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2 text-xs"><span className="self-center text-slate-400">Cena = koszt (razem z Twoją pracą) + narzut:</span>{[1_500, 2_500, 3_500].map((m) => <Button key={m} variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setMarkup(m)}>{m / 100}%</Button>)}</div>
        </div>
        <div className="space-y-3 text-sm" data-testid="quote-preview">
          <p className="rounded-xl border border-sky/25 bg-sky/5 p-3 text-xs text-slate-300">Tu widzisz, <strong>ile faktycznie zostaje</strong>: koszty rzeczywiste to pieniądze, które wydasz, a „Zostaje do kieszeni” uwzględnia jeszcze koszty stałe firmy i podatek. Wartość Twojej pracy w zysku ekonomicznym to tylko miara porównawcza (nie wypłata) — nie traktuj jej jak kosztu. Plan nie zawiera problemów na budowie: średnio praca trwa o ok. 15–20% dłużej (problemy to zwykle +6–16 godz., do tego poprawki po odbiorze), więc zostaw zapas w terminie i cenie.</p>
          <QuoteEconomicsPanel e={p.economics} laborRate={input.laborRate} priceGross={p.priceGross} vatRateBps={p.vatRateBps} pocket={estimatePocket(game, p.economics.surplusBeforeOwner, p.economics.revenueNet, p.plannedCenti / 800)} />
          {p.errors.length > 0 && <ul className="space-y-1 text-xs text-loss" role="alert">{p.errors.map((e) => <li key={e}>✖ {e}</li>)}</ul>}
          {p.warnings.length > 0 && <ul className="space-y-1 text-xs text-gold">{p.warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>}
          {Object.keys(p.stockShortage).length > 0 && <p className="text-xs text-slate-400">Materiały do zakupu po podpisaniu umowy: {Object.entries(p.stockShortage).map(([k, n]) => `${MATERIAL_BY_ID.get(splitKey(k).materialId)!.label} × ${n}`).join(', ')}.</p>}
          <Button variant="primary" className="w-full" disabled={p.errors.length > 0 || price === null} onClick={() => send(enq.id, input)} data-testid="send-quote">Wyślij ofertę klientowi</Button>
          <p className="text-xs text-slate-500">Klient może zaakceptować, odrzucić, poprosić o rabat albo o zmianę terminu. Decyzja zapada w ciągu 1–3 dni.</p>
          <dl className="divide-y divide-ink-700/60 rounded-xl border border-ink-700 px-3">
            <Row k="Narzut od kosztów rzeczywistych i pracy własnej" v={fmtPct(p.markupBps)} tone={moneyTone(p.markupBps)} />
            <Row k="Marża nadwyżki (przed obciążeniami właściciela)" v={fmtPct(p.economics.surplusMarginBps)} tone={moneyTone(p.economics.surplusMarginBps)} />
            <Row k="Marża ekonomiczna (po pracy własnej)" v={fmtPct(p.economics.economicMarginBps)} tone={moneyTone(p.economics.economicMarginBps)} />
            <Row k="Minimalny czas pracy" v={`${p.minDays} dni po ${input.hoursPerDay} godz.`} />
            <Row k={`Poziom umiejętności / wymagany`} v={`${p.level} / ${p.difficulty}`} />
          </dl>
          <div className="rounded-xl border border-ink-700 p-3 text-xs text-slate-400" data-testid="quote-competition">
            <div className="mb-1 font-semibold text-slate-200">Klient {SEGMENTS[enq.segment].label.toLowerCase()} · {enq.rivals === 0 ? 'pyta tylko Ciebie' : `porównuje oferty ${enq.rivals + 1} firm`}</div>
            {mp && <div className="mb-1 text-slate-300" data-testid="market-price-hint">Orientacyjnie rynek wycenia to zlecenie na {formatPLN(mulBps(refPrice, mp.lowBps), { round: true })}–{formatPLN(mulBps(refPrice, mp.highBps), { round: true })} (cena referencyjna {formatPLN(refPrice, { round: true })}); budżet klienta to ok. {formatPLN(enq.budgetGross, { round: true })} brutto.</div>}
            {SEGMENTS[enq.segment].description} {enq.rivals > 0 ? 'Wygrasz z konkurencją ceną, jakością (standard materiałów), opiniami i terminem — nie samą najniższą ceną. Dopiero potem klient ocenia warunki oferty.' : 'Nie porównuje ofert, ale nadal może odrzucić zbyt drogą ofertę lub zły termin.'}
          </div>
          <QuoteCalendar game={game} enq={enq} q={q} planWarnings={p.warnings} onPick={(date) => set({ startDate: date })} />
        </div>
      </div>
    </Card>
  );
}

/** Podpisanie umowy z możliwością wskazania wykonawcy (np. podwykonawcy, gdy brakuje własnego sprzętu lub godzin). Podpowiada, czemu podpisanie jest zablokowane. */
function SignContract({ game, q }: { game: GameState; q: RenoQuote }) {
  const sign = useGameStore((s) => s.signContract);
  const quoted: CrewMember[] = !q.teamId ? [{ kind: 'owner', id: 'owner' }] : parseCrewKey(q.teamId) ?? game.ops.teams.find((t) => t.id === q.teamId)?.members ?? [{ kind: 'owner', id: 'owner' }];
  const [members, setMembers] = useState<CrewMember[]>(quoted);
  const same = (a: CrewMember[], b: CrewMember[]) => a.length === b.length && a.every((m) => b.some((x) => x.kind === m.kind && x.id === m.id));
  const crew: CrewMember[] | undefined = same(members, quoted) ? undefined : members;
  const has = (kind: CrewMember['kind'], id: string) => members.some((m) => m.kind === kind && m.id === id);
  const toggle = (kind: CrewMember['kind'], id: string) => {
    const next = has(kind, id) ? members.filter((m) => !(m.kind === kind && m.id === id)) : [...members, { kind, id }];
    if (next.length > 0) setMembers(next);
  };
  const subs = game.ops.subcontractors.filter((x) => x.services.includes(q.serviceId)).map((x) => ({ sub: x, price: subPrice(x, q.serviceId, q.units, q.complexity, 10_000) }));
  const staff = activeEmployments(game).map((e) => ({ e, name: personName(personById(game, e.personId)!), level: personLevel(personById(game, e.personId)!, q.serviceId) }));
  const who = members.map((m) => memberLabel(game, m)).join(' + ');
  // próba na kopii stanu: dokładnie te same reguły co przy prawdziwym podpisaniu, bez zmian w grze
  const probe = useMemo(() => commands.signContract(game, q.id, crew), [game, q.id, members]); // eslint-disable-line react-hooks/exhaustive-deps
  const onlySub = members.length === 1 && members[0]!.kind === 'sub' ? subs.find((x) => x.sub.id === members[0]!.id) : undefined;
  const profit = onlySub ? q.priceNet - onlySub.price - q.planned.materials - q.planned.other : null;
  return (
    <div className="mt-2 space-y-2" data-testid={`sign-box-${q.id}`}>
      <fieldset className="rounded-xl border border-ink-700 p-3" data-testid={`sign-who-${q.id}`}>
        <legend className="px-1 text-xs text-slate-400">Kto wykona pracę (można zaznaczyć kilka osób — pracują razem)</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" className="size-4 accent-sky" checked={has('owner', 'owner')} onChange={() => toggle('owner', 'owner')} data-testid={`sign-owner-${q.id}`} />Ja (właściciel)</label>
          {staff.map(({ e, name, level }) => (
            <label key={e.id} className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" className="size-4 accent-sky" checked={has('employee', e.id)} onChange={() => toggle('employee', e.id)} data-testid={`sign-emp-${q.id}-${e.id}`} />{name} <span className="text-xs text-slate-500">— pracownik, poziom {level}</span></label>
          ))}
        </div>
        <details className="mt-2 text-xs" open={members.some((m) => m.kind === 'sub')} data-testid={`sign-subs-${q.id}`}>
          <summary className="cursor-pointer text-slate-400 hover:text-slate-200">Podwykonawcy ({subs.length}) — zleć komuś z zewnątrz</summary>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
          {subs.map(({ sub, price }) => (
            <label key={sub.id} className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" className="size-4 accent-sky" checked={has('sub', sub.id)} onChange={() => toggle('sub', sub.id)} data-testid={`sign-sub-${q.id}-${sub.id}`} />{sub.name.replace(' (fikcyjna)', '')} <span className="text-xs text-slate-500">— podwykonawca, {formatPLN(price, { round: true })} netto za całość</span></label>
          ))}
          </div>
        </details>
        <p className="mt-2 text-xs text-slate-400">Wybrani wykonawcy: <strong className="text-slate-200">{who}</strong>{crew === undefined ? ' (jak w ofercie)' : ' (zmieniono względem oferty)'}.</p>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => sign(q.id, crew)} disabled={!probe.ok} data-testid={`sign-${q.id}`}>{members.some((m) => m.kind === 'sub') ? 'Zleć i podpisz umowę' : 'Podpisz umowę'}</Button>
        <span className="text-xs text-gold">Podpisz do {formatDatePL(q.signBy!)}.</span>
      </div>
      {!probe.ok && <p className="text-xs text-loss" role="alert" data-testid={`sign-blocked-${q.id}`}>Nie można podpisać: {probe.error}{crew === undefined && subs.length > 0 ? ' — zmień wykonawców powyżej (np. zaznacz podwykonawcę, który ma własny sprzęt), żeby nie stracić zlecenia.' : ''}</p>}
      {onlySub && probe.ok && profit !== null && <p className={cx('text-xs', profit < 0 ? 'text-loss' : 'text-slate-400')}>Podwykonawca <Money value={onlySub.price} round /> netto + materiały i drobne <Money value={q.planned.materials + q.planned.other} round /> przy cenie umowy <Money value={q.priceNet} round /> → zostaje <Money value={profit} round signed />.</p>}
    </div>
  );
}

export function RenoQuotesScreen() {
  const { game, biz, isReno } = useReno();
  const selected = useGameStore((s) => s.selectedEnquiryId);
  const respond = useGameStore((s) => s.respondToCounter);
  if (!biz || !isReno) return <NoReno title="Wyceny" />;
  const quotes = [...game.reno.quotes].reverse();
  const STATUS = { sent: ['czeka na decyzję klienta', 'sky'], counter: ['klient proponuje zmianę', 'gold'], accepted: ['zaakceptowana — podpisz umowę', 'gain'], rejected: ['odrzucona', 'loss'], declined: ['zrezygnowano', 'neutral'], signed: ['umowa podpisana', 'gain'], expired: ['wygasła', 'neutral'] } as const;
  return (
    <div className="space-y-5">
      <ScreenHeader title="Wyceny" subtitle="Przygotuj ofertę: cena ma pokryć koszty rzeczywiste i uczciwie wynagrodzić Twoją pracę. Potem negocjuj warunki i podpisz umowę." />
      <ParamNote />
      {selected && <QuoteBuilder key={selected} enquiryId={selected} />}
      <Card title="Wysłane oferty">
        {quotes.length === 0 ? <Empty>Nie wysłano jeszcze żadnej oferty. Wybierz zapytanie i kliknij „Wyceń”.</Empty> : (
          <ul className="divide-y divide-ink-700/60" data-testid="quotes-list">
            {quotes.map((q) => {
              const enq = game.reno.enquiries.find((e) => e.id === q.enquiryId)!;
              const def = SERVICE_BY_ID.get(q.serviceId)!;
              const [label, tone] = STATUS[q.status];
              return (
                <li key={q.id} data-testid={`quote-row-${q.id}`} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><strong className="text-slate-100">{def.label}, {q.units} {def.unit}</strong> <span className="text-slate-400">· {enq.clientName.split(' (')[0]} · {enq.location}</span></div>
                    <Badge tone={tone}>{label}</Badge>
                  </div>
                  <div className="mt-1 text-slate-300">Cena <Money value={q.priceNet} /> netto{q.vatRateBps ? <> (<Money value={grossOfNet(q.priceNet, q.vatRateBps)} /> brutto)</> : ' (bez VAT)'} · koszt planowany <Money value={q.planned.total} /> · zaliczka {q.advanceBps / 100}% · start {formatDatePL(q.startDate)}, {q.durationDays} dni</div>
                  {q.status === 'sent' && <div className="mt-1 text-xs text-slate-500">Odpowiedź klienta do {formatDatePL(q.decideOn)}.</div>}
                  {q.status === 'rejected' && <div className="mt-1 text-xs text-slate-500">Powód: {q.note}.</div>}
                  {q.status === 'counter' && q.counter && (
                    <div className="mt-2 rounded-xl border border-gold/30 bg-gold/5 p-3">
                      <div className="text-gold">{q.counter.kind === 'discount' ? `Klient prosi o rabat ${q.counter.discountBps / 100}% (nowa cena netto ${formatPLN(q.priceNet - Math.round((q.priceNet * q.counter.discountBps) / 10_000))}).` : `Klient prosi o zmianę terminu: start ${formatDatePL(q.counter.newStart!)}, czas realizacji ${q.counter.newDuration} dni.`}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button variant="primary" onClick={() => respond(q.id, 'accept')} data-testid={`counter-accept-${q.id}`}>Przyjmij zmianę</Button>
                        <Button variant="secondary" disabled={q.held} onClick={() => respond(q.id, 'hold')}>Podtrzymaj warunki</Button>
                        <Button variant="ghost" onClick={() => respond(q.id, 'decline')}>Zrezygnuj</Button>
                      </div>
                    </div>
                  )}
                  {q.status === 'accepted' && <SignContract game={game} q={q} />}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ---------- 4. Kontrakty ---------- */

export function RenoContractsScreen() {
  const { game, biz, isReno } = useReno();
  const buy = useGameStore((s) => s.buyMissingForJob);
  const terminate = useGameStore((s) => s.terminateJob);
  if (!biz || !isReno) return <NoReno title="Kontrakty" />;
  const jobs = [...game.reno.jobs].reverse();
  return (
    <div className="space-y-5">
      <ScreenHeader title="Kontrakty" subtitle="Umowy z klientami: zakres, cena, termin, zaliczka, warunki płatności i odpowiedzialność za opóźnienia." />
      <ParamNote />
      {jobs.length === 0 ? <Card><Empty>Brak kontraktów — podpisz umowę po zaakceptowaniu oferty przez klienta.</Empty></Card> : (
        <ul className="space-y-4" data-testid="jobs-list">
          {jobs.map((j) => {
            const def = SERVICE_BY_ID.get(j.serviceId)!;
            const f = jobFinancials(j);
            const fc = jobForecast(game, j);
            const finished = j.stage === 'done' || j.stage === 'cancelled';
            const docs = game.documents.filter((d) => d.orderId === j.orderId && d.kind === 'sales');
            return (
              <li key={j.id} data-testid={`job-${j.id}`}>
                <Card title={`${def.label}, ${j.units} ${def.unit} — ${j.clientName.split(' (')[0]} (${j.location})`} action={<Badge tone={STAGE_TONE[j.stage]}>{STAGE_LABEL[j.stage]}</Badge>}>
                  <div className="grid gap-5 lg:grid-cols-3 text-sm">
                    <dl className="divide-y divide-ink-700/60">
                      <Row k="Cena netto" v={<Money value={j.priceNet} />} />
                      <Row k="Zaliczka" v={j.advanceNet > 0 ? <Money value={j.advanceNet} /> : 'brak'} />
                      <Row k="Termin płatności reszty" v={`${j.paymentTermDays} dni`} />
                      <Row k="Kara za zwłokę" v="2% ceny za rozpoczęty tydzień (max 15%)" />
                      <Row k="Start → termin" v={`${formatDatePL(j.startDate)} → ${formatDatePL(j.deadline)}`} />
                      <Row k="Standard materiałów" v={STANDARDS[j.standard].label} />
                      <Row k="Wykonawcy" v={j.crew.teamId ? `${game.ops.teams.find((tm) => tm.id === j.crew.teamId)?.name ?? 'ekipa'} (${j.crew.supervision === 'hands-off' ? 'bez nadzoru' : j.crew.supervision === 'supervise' ? 'nadzór właściciela' : 'z właścicielem'})` : 'właściciel samodzielnie'} />
                    </dl>
                    <dl className="divide-y divide-ink-700/60">
                      <JobEconomicsRows f={f} laborRate={j.laborRate} />
                      <Row k="Koszt planowany (z wartością pracy własnej)" v={<Money value={j.planned.total} />} />
                      <Row k="Marża planowana / rzeczywista (po pracy własnej)" v={`${fmtPct(f.plannedMarginBps)} / ${f.actualMarginBps === null ? 'po rozliczeniu' : fmtPct(f.actualMarginBps)}`} />
                      <Row k="Jakość / opinia" v={j.quality === null ? '—' : `${j.quality}/100${game.reno.reviews.find((r) => r.jobId === j.id) ? ` · ${stars(game.reno.reviews.find((r) => r.jobId === j.id)!.rating10)}` : ''}`} />
                    </dl>
                    <div>
                      <div className="mb-1 text-xs text-slate-400">Postęp: {fc.progressPct}%{j.extraCenti > 0 ? ` (+${(j.extraCenti / 100).toFixed(1).replace('.', ',')} godz. dodatkowej pracy)` : ''}</div>
                      <ProgressBar value={fc.progressPct} max={100} tone={fc.risk === 'wysokie' ? 'loss' : fc.risk === 'średnie' ? 'gold' : 'gain'} />
                      {!finished && (
                        <div className="mt-3 space-y-1.5 text-xs text-slate-400">
                          <div>Ryzyko opóźnienia: <Badge tone={RISK_TONE[fc.risk]}>{fc.risk}</Badge>{fc.etaDate && <> · prognoza zakończenia {formatDatePL(fc.etaDate)}</>}</div>
                          {fc.reasons.map((r) => <div key={r} className="text-gold">⚠ {r}</div>)}
                          {j.blockedReason && <div className="text-loss">Przestój: {j.blockedReason}</div>}
                        </div>
                      )}
                      {j.issues.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-slate-500">{j.issues.slice(-3).map((i) => <li key={i.id}>• {formatDatePL(i.date)}: {i.title}</li>)}</ul>}
                      {docs.length > 0 && <p className="mt-2 text-xs text-slate-500">Dokumenty sprzedaży: {docs.map((d) => `${d.number} (${d.part === 'advance' ? 'zaliczka' : d.part === 'final' ? 'rozliczenie końcowe' : 'całość'})`).join(', ')}</p>}
                      {!finished && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button variant="secondary" onClick={() => buy(j.id)} data-testid={`buy-missing-${j.id}`}>Kup brakujące materiały</Button>
                          <Button variant="danger" onClick={() => { if (window.confirm('Rozwiązać umowę? Zaliczka zostanie zwrócona klientowi, a opinia firmy ucierpi.')) terminate(j.id); }}>Rozwiąż umowę</Button>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------- 5. Harmonogram ---------- */

export function RenoScheduleScreen() {
  const { game, biz, isReno } = useReno();
  if (!biz || !isReno) return <NoReno title="Harmonogram" />;
  const jobs = game.reno.jobs.filter((j) => j.stage !== 'done' && j.stage !== 'cancelled').sort((a, b) => a.startDate.localeCompare(b.startDate));
  const days = Array.from({ length: 14 }, (_, i) => budgetFor(game, addDays(game.clock.today, i + 1)));
  return (
    <div className="space-y-5">
      <ScreenHeader title="Harmonogram" subtitle="Kontrakty w toku, obciążenie najbliższych dni i ryzyko opóźnień. Godziny remontów dzielą dobę z etatem, snem i obowiązkami — nie nakładają się." />
      <Card title="Najbliższe 14 dni (godziny)">
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-center text-xs" data-testid="schedule-days">
          <thead className="text-slate-500"><tr><th className="pb-2 text-left font-medium">Dzień</th>{days.map((d) => <th key={d.date} className="pb-2 font-medium">{d.date.slice(8)}.{d.date.slice(5, 7)}</th>)}</tr></thead>
          <tbody>
            <tr><td className="py-1 text-left text-slate-400">Etat</td>{days.map((d) => <td key={d.date} className="text-slate-300">{d.work}</td>)}</tr>
            <tr><td className="py-1 text-left text-slate-400">Kontrakty</td>{days.map((d) => <td key={d.date} className={d.commitments > 0 ? 'text-sky' : 'text-slate-500'}>{d.commitments}</td>)}</tr>
            <tr><td className="py-1 text-left text-slate-400">Wolne</td>{days.map((d) => <td key={d.date} className={d.free < 2 ? 'text-loss' : 'text-gain'}>{d.free}</td>)}</tr>
          </tbody>
        </table></div>
        <p className="mt-2 text-xs text-slate-500">Czerwone: mniej niż 2 godz. wolnych — zmęczenie rośnie i spada wydajność (jakość pracy).</p>
      </Card>
      <Card title="Kontrakty w toku">
        {jobs.length === 0 ? <Empty>Brak kontraktów w toku.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm" data-testid="schedule-jobs">
            <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><th className="pb-2 font-medium">Kontrakt</th><th className="pb-2 font-medium">Okres</th><th className="pb-2 text-right font-medium">Godz./dzień</th><th className="pb-2 text-right font-medium">Postęp</th><th className="pb-2 font-medium">Prognoza</th><th className="pb-2 font-medium">Ryzyko</th></tr></thead>
            <tbody className="divide-y divide-ink-700/60">
              {jobs.map((j) => {
                const fc = jobForecast(game, j);
                return (
                  <tr key={j.id}>
                    <td className="py-2 text-slate-300">{SERVICE_BY_ID.get(j.serviceId)!.label}<div className="text-xs text-slate-500">{j.clientName.split(' (')[0]} · {STAGE_LABEL[j.stage]}</div></td>
                    <td className="py-2 text-slate-400">{formatDatePL(j.startDate)} – {formatDatePL(j.deadline)}</td>
                    <td className="py-2 text-right">{j.hoursPerDay}</td>
                    <td className="py-2 text-right">{fc.progressPct}%</td>
                    <td className="py-2 text-slate-400">{fc.etaDate ? formatDatePL(fc.etaDate) : '—'}</td>
                    <td className="py-2"><Badge tone={RISK_TONE[fc.risk]}>{fc.risk}</Badge><div className="text-xs text-slate-500">{fc.reasons[0] ?? ''}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}

/* ---------- 6. Magazyn i sprzęt ---------- */

export function RenoStockScreen() {
  const { game, biz, isReno } = useReno();
  const buyEq = useGameStore((s) => s.buyEquipment);
  const maintain = useGameStore((s) => s.maintainEquipment);
  const buyMat = useGameStore((s) => s.buyMaterial);
  const addSpec = useGameStore((s) => s.addSpecialization);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [std, setStd] = useState<MaterialStandard>('std');
  if (!biz || !isReno) return <NoReno title="Magazyn i sprzęt" />;
  const today = game.clock.today;
  const stockRows = MATERIALS.map((m) => ({ m, key: stockKey(m.id, std) }));
  const totalStock = Object.values(game.reno.stock).reduce((a, x) => a + x.value, 0);
  return (
    <div className="space-y-5">
      <ScreenHeader title="Magazyn i sprzęt" subtitle="Umiejętności, wyposażenie firmy i zapas materiałów." />
      <ParamNote />
      <Card title="Specjalizacje i umiejętności" action={<LegalBadge id="RENO-PKD" />}>
        <ul className="divide-y divide-ink-700/60 text-sm" data-testid="skills">
          {SERVICES.map((d) => {
            const spec = game.reno.specializations.includes(d.id);
            const sp = skillProgress(game, d.id);
            const eq = equipmentStatus(game, d);
            return (
              <li key={d.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto]">
                <div>
                  <div className="font-medium text-slate-100">{d.label} <span className="text-xs text-slate-500">· trudność {d.difficulty}/3 · {d.unit}</span></div>
                  {spec ? (
                    <div className="mt-1 text-xs text-slate-400">Poziom {skillLevel(game, d.id)}/5 · wydajność {fmtPct(speedBps(game, d.id))} normy · doświadczenie {(sp.xp / 100).toFixed(0)} godz.{sp.next ? ` (następny poziom: ${sp.next / 100} godz. pracy)` : ' (maksimum)'}
                      <ProgressBar className="mt-1" value={sp.xp} max={sp.next ?? Math.max(1, sp.xp)} />
                    </div>
                  ) : <div className="mt-1 text-xs text-slate-500">Brak specjalizacji. Poziom 2 na start po szkoleniu; kolejne poziomy zdobywasz wyłącznie wykonując prace.</div>}
                  {spec && (eq.missing.length > 0 || eq.broken.length > 0) && <div className="mt-1 text-xs text-gold">Wymagany sprzęt: {[...eq.missing.map((x) => `brak — ${x}`), ...eq.broken.map((x) => `do konserwacji — ${x}`)].join('; ')}</div>}
                </div>
                {!spec && <Button variant="secondary" onClick={() => addSpec(d.id)} data-testid={`add-spec-${d.id}`}>Dodaj ({formatPLN(SPECIALIZATION_COURSE, { round: true })} netto)</Button>}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-slate-500">Progi poziomów 3–5: {SKILL_THRESHOLD_CENTI.map((t) => `${t / 100} godz.`).join(', ')} efektywnej pracy. Doświadczenia nie da się „kliknąć”.</p>
      </Card>

      <Card title="Wyposażenie firmy" action={<LegalBadge id="RENO-EQUIPMENT-EXPENSING" />}>
        <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm" data-testid="equipment">
          <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><th className="pb-2 font-medium">Sprzęt</th><th className="pb-2 font-medium">Kategoria</th><th className="pb-2 text-right font-medium">Cena netto</th><th className="pb-2 font-medium">Stan techniczny</th><th className="pb-2 text-right font-medium">Wartość księgowa</th><th className="pb-2 font-medium">Efekt</th><th className="pb-2" /></tr></thead>
          <tbody className="divide-y divide-ink-700/60">
            {EQUIPMENT.map((e) => {
              const item = ownedEquipment(game, e.id);
              const working = game.reno.equipment.filter((x) => x.catalogId === e.id && x.conditionBps > 0).length; // silnik dopuszcza do 4 sprawnych egzemplarzy (po jednym na równoległą pracę)
              const effects = [...Object.entries(e.speedBps).map(([k, v]) => `+${v / 100}% szybkości${k === '*' ? '' : ` (${SERVICE_BY_ID.get(k)?.label ?? k})`}`), ...Object.entries(e.quality).map(([k, v]) => `+${v} jakości${k === '*' ? '' : ` (${SERVICE_BY_ID.get(k)?.label ?? k})`}`), ...(e.transportSaveBps ? [`−${e.transportSaveBps / 100}% kosztu transportu`] : [])];
              const used = SERVICES.filter((d) => d.requiredEquipment.includes(e.id)).map((d) => d.label);
              return (
                <tr key={e.id} data-testid={`eq-${e.id}`}>
                  <td className="py-2 text-slate-200">{e.label}{working > 1 && <span className="ml-2 text-xs text-slate-400" data-testid={`eq-count-${e.id}`}>× {working}</span>}{used.length > 0 && <div className="text-xs text-gold">wymagany: {used.join(', ')}</div>}</td>
                  <td className="py-2 text-slate-400">{e.category}</td>
                  <td className="py-2 text-right"><Money value={e.priceNet} round /></td>
                  <td className="py-2 w-40">{item ? <><ProgressBar value={item.conditionBps} max={10_000} tone={item.conditionBps < 3_000 ? 'loss' : item.conditionBps < 6_000 ? 'gold' : 'gain'} /><div className="mt-0.5 text-xs text-slate-500">{Math.round(item.conditionBps / 100)}%</div></> : <span className="text-xs text-slate-500">nie posiadasz</span>}</td>
                  <td className="py-2 text-right">{item ? <Money value={equipmentBookValue(item)} /> : '—'}</td>
                  <td className="py-2 text-xs text-slate-400">{effects.join(', ') || '—'}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {item && item.conditionBps < 9_500 && <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => maintain(item.id)}>Konserwacja ({formatPLN(e.maintenanceNet, { round: true })})</Button>}{' '}
                    {working < 4 && <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => buyEq(e.id)} data-testid={`buy-eq-${e.id}`} title={working > 0 ? 'Dokup kolejny egzemplarz — każda równoległa praca potrzebuje własnego kompletu (maks. 4)' : undefined}>{working > 0 ? 'Dokup' : 'Kup'}</Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        <p className="mt-2 text-xs text-slate-500">Zakup to wydatek firmy (koszt podatkowy w dacie zakupu — uproszczenie, wydatki do 10 000 zł) i jednocześnie aktywo wyceniane wg stanu technicznego: zużycie obniża wartość księgową bez wydatku gotówkowego.</p>
      </Card>

      <Card title="Materiały i zapas" action={<div className="flex items-center gap-2"><LegalBadge id="RENO-MATERIALS-TAX-COST" /><div role="group" aria-label="Standard" className="inline-flex rounded-xl border border-ink-700 bg-ink-900/70 p-0.5">{(Object.keys(STANDARDS) as MaterialStandard[]).map((st) => <button key={st} type="button" aria-pressed={std === st} onClick={() => setStd(st)} className={cx('rounded-lg px-2.5 py-1 text-xs', std === st ? 'bg-ink-600 text-white' : 'text-slate-400')}>{STANDARDS[st].label}</button>)}</div></div>}>
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm" data-testid="materials">
          <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><th className="pb-2 font-medium">Materiał</th><th className="pb-2 text-right font-medium">Cena netto / jedn.</th><th className="pb-2 font-medium">Dostępność dziś</th><th className="pb-2 text-right font-medium">Na stanie</th><th className="pb-2 text-right font-medium">Wartość zapasu</th><th className="pb-2" /></tr></thead>
          <tbody className="divide-y divide-ink-700/60">
            {stockRows.map(({ m, key }) => {
              const avail = materialAvailable(game, key, today);
              const st = game.reno.stock[key];
              return (
                <tr key={key} data-testid={`mat-${key}`}>
                  <td className="py-2 text-slate-200">{m.label}</td>
                  <td className="py-2 text-right"><Money value={materialPrice(game, key, today)} /> / {m.unit}</td>
                  <td className="py-2">{avail ? <Badge tone="gain">dostępny</Badge> : <Badge tone="loss">niedostępny</Badge>}</td>
                  <td className="py-2 text-right">{stockQty(game, key)} {m.unit}</td>
                  <td className="py-2 text-right">{st ? <Money value={st.value} /> : '—'}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <input aria-label={`Ilość: ${m.label}`} className="mr-2 w-16 rounded-lg border border-ink-600 bg-ink-900/80 px-2 py-1 text-right text-slate-100" value={qty[key] ?? ''} placeholder="ilość" inputMode="numeric" onChange={(e) => setQty({ ...qty, [key]: e.target.value })} />
                    <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={!avail} onClick={() => { const n = Number(qty[key]); if (Number.isInteger(n) && n > 0 && buyMat(key, n)) setQty({ ...qty, [key]: '' }); }}>Kup</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        <p className="mt-2 text-sm text-slate-300">Wartość zapasu (aktywo): <strong><Money value={totalStock} /></strong>. Zużycie materiałów podczas prac przenosi ich wartość do kosztu kontraktu — bez ponownego wydatku gotówkowego.</p>
      </Card>
    </div>
  );
}

/* ---------- 7. Reputacja i reklamacje ---------- */

export function RenoReputationScreen() {
  const { game, biz, isReno } = useReno();
  const navigate = useGameStore((s) => s.navigate);
  const resolve = useGameStore((s) => s.resolveComplaint);
  if (!biz || !isReno) return <NoReno title="Reputacja i reklamacje" />;
  const rep = reputation(game);
  const mkt = marketOverview(game);
  const reviews = [...game.reno.reviews].reverse().slice(0, 10);
  const complaints = [...game.reno.complaints].filter((c) => c.status !== 'pending').reverse();
  const CSTATUS = { pending: 'zaplanowana', open: 'czeka na decyzję', repairing: 'poprawki w toku', resolved: 'rozwiązana', refunded: 'rabat przyznany', escalated: 'eskalowana (negatywna opinia)' } as const;
  return (
    <div className="space-y-5">
      <ScreenHeader title="Reputacja i reklamacje" subtitle="Opinie klientów wpływają na liczbę zapytań i szanse na akceptację ofert." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard testId="reno-reputation" label="Reputacja" icon="trend" accent="gold" value={`${rep.stars.toString().replace('.', ',')}★`} hint={`${rep.reviews} opinii · start 3,5★`} />
        <StatCard label="Zapytania / mies." icon="bell" accent="sky" value={mkt.inquiriesPerMonth.toFixed(1).replace('.', ',')} hint="średnia z 6 mies. (rynek + marketing)" />
        <StatCard label="Koniunktura" icon="calendar" accent="violet" value={mkt.macro.phase} hint="wpływa na popyt i budżety klientów" />
        <StatCard label="Konwersja" icon="clock" accent="gain" value={mkt.conversionBps === null ? '—' : fmtPct(mkt.conversionBps)} hint="zapytania → umowy (6 mies.)" />
      </div>
      <Card title="Marketing i widoczność">
        <p className="text-sm text-slate-300">Opinie klientów zwiększają widoczność firmy w kanałach marketingowych i szanse w porównaniu ofert z konkurencją. Budżet reklamowy rozdzielasz między kanały na osobnym ekranie.</p>
        <div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" onClick={() => navigate('marketMarketing')} data-testid="go-marketing">Przejdź do Marketingu</Button><Button variant="ghost" onClick={() => navigate('marketStrategy')}>Strategia firmy</Button></div>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Opinie klientów">
          {reviews.length === 0 ? <Empty>Brak opinii — pojawią się po zakończeniu kontraktów.</Empty> : (
            <ul className="divide-y divide-ink-700/60 text-sm" data-testid="reviews">
              {reviews.map((r) => (
                <li key={r.id} className="py-2">
                  <div className="flex justify-between gap-2"><strong className="text-slate-100">{stars(r.rating10)}</strong><span className="text-xs text-slate-500">{formatDatePL(r.date)}</span></div>
                  <div className="text-slate-300">{r.comment}</div>
                  <div className="text-xs text-slate-500">jakość {stars(r.parts.quality)} · terminowość {stars(r.parts.punctuality)} · zgodność {stars(r.parts.conformity)} · cena {stars(r.parts.price)} · komunikacja {stars(r.parts.communication)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Reklamacje" action={<LegalBadge id="RENO-CONSUMER-RIGHTS" />}>
          {complaints.length === 0 ? <Empty>Brak reklamacji. Ich prawdopodobieństwo zależy od jakości prac, problemów, poprawek, opóźnień i dopasowania standardu materiałów.</Empty> : (
            <ul className="divide-y divide-ink-700/60 text-sm" data-testid="complaints">
              {complaints.map((c) => {
                const job = game.reno.jobs.find((j) => j.id === c.jobId)!;
                return (
                  <li key={c.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-slate-100">{job.clientName.split(' (')[0]} — {c.description}</span><Badge tone={c.status === 'open' ? 'gold' : c.status === 'escalated' ? 'loss' : 'neutral'}>{CSTATUS[c.status]}</Badge></div>
                    <div className="text-xs text-slate-500">Dotkliwość {c.severity}/3 · zgłoszona {formatDatePL(c.raisedOn)}{c.status === 'open' ? ` · odpowiedz do ${formatDatePL(c.deadline)}` : ''}</div>
                    {c.status === 'open' && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button variant="primary" onClick={() => resolve(c.id, 'repair')} data-testid={`repair-${c.id}`}>Napraw ({c.severity * 4} godz.)</Button>
                        <Button variant="secondary" onClick={() => resolve(c.id, 'discount')}>Rabat</Button>
                        <Button variant="ghost" onClick={() => resolve(c.id, 'reject')}>Odrzuć</Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-500">To mechanika ekonomiczna. Rękojmia, prawa konsumenta, spory i odpowiedzialność prawna nie są modelowane — zapisane jako przyszłe rozszerzenie.</p>
        </Card>
      </div>
    </div>
  );
}

void zl;
