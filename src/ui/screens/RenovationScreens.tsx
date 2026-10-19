import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { activeBusiness, businessState, profileOf } from '../../engine/business.ts';
import { addDays, formatDatePL } from '../../engine/date.ts';
import { formatPLN, zl } from '../../engine/money.ts';
import {
  defaultQuoteInput, enquiryRateBps, equipmentStatus, jobFinancials, jobForecast, materialAvailable, materialPrice, ownedEquipment, previewQuote, renoDashboard, reputation, skillLevel,
  skillProgress, speedBps, splitKey, stockKey, stockQty, grossOfNet, equipmentBookValue,
} from '../../engine/renovation.ts';
import type { QuoteInput } from '../../engine/renovation.ts';
import {
  ADVERTISING, COMPLEXITY_LABEL, EQUIPMENT, MATERIALS, MATERIAL_BY_ID, QUALITY_REQ_LABEL, SERVICES, SERVICE_BY_ID, SKILL_THRESHOLD_CENTI, SPECIALIZATION_COURSE, STANDARDS,
} from '../../engine/renovationCatalog.ts';
import type { MaterialStandard } from '../../engine/state.ts';
import { budgetFor } from '../../engine/time.ts';
import { businessLiquidity } from '../../engine/selectors.ts';
import { liquidityForecast, teamLoad } from '../../engine/profitability.ts';
import { activeEmployments, monthlyEmployerCost, personById, personLevel, personName, wageOn } from '../../engine/workforce.ts';
import { vehicleDef } from '../../engine/fleet.ts';
import { subPrice } from '../../engine/subcontractors.ts';
import { crewKey, parseCrewKey } from '../../engine/renovation.ts';
import type { CrewMember } from '../../engine/renovation.ts';
import { useGameStore } from '../../store/gameStore.ts';
import { ProgressBar } from '../components/charts.tsx';
import { Badge, Button, Card, Empty, Money, ScreenHeader, StatCard, cx, moneyTone } from '../components/ui.tsx';
import { parseZloty } from '../format.ts';
import { LegalBadge } from './BusinessScreens.tsx';

const stars = (rating10: number) => `${(rating10 / 10).toFixed(1).replace('.', ',')}★`;
const STAGE_LABEL = { preparation: 'przygotowanie', materials: 'brak materiałów / sprzętu', execution: 'realizacja', handover: 'odbiór', settlement: 'rozliczenie', done: 'zakończony', cancelled: 'rozwiązany' } as const;
const STAGE_TONE = { preparation: 'neutral', materials: 'gold', execution: 'sky', handover: 'sky', settlement: 'sky', done: 'gain', cancelled: 'loss' } as const;
const RISK_TONE = { niskie: 'gain', średnie: 'gold', wysokie: 'loss' } as const;
const fmtPct = (bps: number) => `${(bps / 100).toFixed(1).replace('.', ',')}%`;

function useReno() {
  const game = useGameStore((s) => s.game)!;
  const biz = activeBusiness(game);
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
            <Row k="Wynik ekonomiczny (bez własnej robocizny)" v={<Money value={d.economicResultDone} signed />} tone={moneyTone(d.economicResultDone)} />
            <Row k="Zapasy materiałów (aktywo)" v={<Money value={d.stockValue} />} />
            <Row k="Sprzęt — wartość księgowa (aktywo)" v={<Money value={d.equipmentValue} />} />
          </dl>
        </Card>
      </div>
      <Card title="Marża na kontraktach">
        {game.reno.jobs.length === 0 ? <Empty>Brak kontraktów. Zacznij od zapytań klientów.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm" data-testid="reno-margins">
              <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><th className="pb-2 font-medium">Kontrakt</th><th className="pb-2 text-right font-medium">Cena netto</th><th className="pb-2 text-right font-medium">Marża plan.</th><th className="pb-2 text-right font-medium">Marża rzecz.</th><th className="pb-2 text-right font-medium">Wynik ekon.</th><th className="pb-2 text-right font-medium">Zarobek / godz.</th></tr></thead>
              <tbody className="divide-y divide-ink-700/60">
                {[...game.reno.jobs].reverse().slice(0, 10).map((j) => {
                  const f = jobFinancials(j);
                  return (
                    <tr key={j.id}>
                      <td className="py-2 text-slate-300">{SERVICE_BY_ID.get(j.serviceId)!.label} · {j.units} {SERVICE_BY_ID.get(j.serviceId)!.unit} <span className="text-xs text-slate-500">({j.clientName.split(' (')[0]})</span></td>
                      <td className="py-2 text-right"><Money value={j.priceNet} /></td>
                      <td className="py-2 text-right text-slate-400">{fmtPct(f.plannedMarginBps)}</td>
                      <td className="py-2 text-right">{f.actualMarginBps === null ? '—' : fmtPct(f.actualMarginBps)}</td>
                      <td className={cx('py-2 text-right', moneyTone(f.economicResult))}><Money value={f.economicResult} signed /></td>
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

export function RenoEnquiriesScreen() {
  const { game, biz, isReno } = useReno();
  const select = useGameStore((s) => s.selectEnquiry);
  const navigate = useGameStore((s) => s.navigate);
  const decline = useGameStore((s) => s.declineEnquiry);
  if (!biz || !isReno) return <NoReno title="Zapytania klientów" />;
  const open = game.reno.enquiries.filter((e) => e.status === 'open');
  const history = [...game.reno.enquiries].filter((e) => e.status !== 'open').reverse().slice(0, 8);
  const rate = enquiryRateBps(game, game.clock.today);
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
        {open.length === 0 ? <Empty><span data-testid="no-enquiries">Brak otwartych zapytań.</span> {noEnquiryReason ?? <>Szansa na nowe zapytanie dziś: {fmtPct(rate.total)} — zależy od reputacji, reklamy, sezonu, dostępności i cen (ekran „Reputacja i reklamacje”).</>}</Empty> : (
          <ul className="grid gap-3 lg:grid-cols-2" data-testid="enquiries-list">
            {open.map((e) => {
              const def = SERVICE_BY_ID.get(e.serviceId)!;
              const spec = game.reno.specializations.includes(e.serviceId);
              return (
                <li key={e.id} data-testid={`enquiry-${e.id}`} className="rounded-xl border border-ink-700 bg-ink-900/40 p-4 text-sm">
                  <div className="flex items-start justify-between gap-2"><strong className="text-slate-100">{def.label}</strong><Badge tone={spec ? 'gain' : 'neutral'}>{spec ? 'Twoja specjalizacja' : 'poza specjalizacją'}</Badge></div>
                  <div className="mt-1 text-slate-300">{e.units} {def.unit} · {e.location} · {COMPLEXITY_LABEL[e.complexity]}</div>
                  <dl className="mt-2 divide-y divide-ink-700/60">
                    <Row k="Klient" v={e.clientName.split(' (')[0]} />
                    <Row k="Szacowany budżet (brutto)" v={<Money value={e.budgetGross} round />} />
                    <Row k="Wymagania jakościowe" v={QUALITY_REQ_LABEL[e.qualityReq]} />
                    <Row k="Oczekiwany start" v={`${formatDatePL(e.desiredStart)} (±${e.flexDays} dn.)`} />
                    <Row k="Maks. czas realizacji" v={`${e.maxDays} dni`} />
                    <Row k="Odpowiedz do" v={formatDatePL(e.respondBy)} tone="text-gold" />
                  </dl>
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

function QuoteBuilder({ enquiryId }: { enquiryId: string }) {
  const game = useGameStore((s) => s.game)!;
  const send = useGameStore((s) => s.sendQuote);
  const select = useGameStore((s) => s.selectEnquiry);
  const enq = game.reno.enquiries.find((e) => e.id === enquiryId);
  const base = useMemo(() => (enq ? defaultQuoteInput(game, enq) : null), [enquiryId]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // podwykonawcy gotowi wziąć całe zlecenie (poziom jakości ≥ trudność), z ceną za 100% zakresu
  const subLevel = (quality: number) => Math.max(1, Math.min(5, Math.round((quality - 40) / 10)));
  const subOptions = game.ops.subcontractors.filter((x) => x.services.includes(enq.serviceId)).map((x) => ({ sub: x, price: subPrice(x, enq.serviceId, enq.units, enq.complexity, 10_000), fits: subLevel(x.quality) >= p.difficulty }));
  // skład wykonawców: z gotowej ekipy albo wybrany tu (właściciel / zatrudnieni pracownicy / podwykonawcy)
  const members: CrewMember[] = !q.teamId ? [{ kind: 'owner', id: 'owner' }] : parseCrewKey(q.teamId) ?? game.ops.teams.find((tm) => tm.id === q.teamId)?.members ?? [{ kind: 'owner', id: 'owner' }];
  const has = (kind: CrewMember['kind'], id: string) => members.some((m) => m.kind === kind && m.id === id);
  const ownerIn = members.some((m) => m.kind === 'owner');
  const customCrew = !!q.teamId && !game.ops.teams.some((tm) => tm.id === q.teamId);
  const employees = activeEmployments(game).map((e) => ({ e, name: personName(personById(game, e.personId)!), level: personLevel(personById(game, e.personId)!, enq.serviceId) }));
  const ownerBlocked = ownerIn && p.errors.some((e) => /umiejętności|specjalizacji|sprzęt/i.test(e));
  const setMembers = (next: CrewMember[]) => {
    if (next.length === 0) return;
    set(next.length === 1 && next[0]!.kind === 'owner' ? { teamId: null, supervision: 'worker' } : { teamId: crewKey(next), supervision: next.some((m) => m.kind === 'owner') ? 'worker' : 'supervise' });
  };
  const toggle = (kind: CrewMember['kind'], id: string) => setMembers(has(kind, id) ? members.filter((m) => !(m.kind === kind && m.id === id)) : [...members, { kind, id }]);
  /** Zlecenie pracy wskazanym wykonawcom (bez właściciela) jednym kliknięciem; jeśli cena nie pokrywa kosztów, ustawia ją z narzutem 25%. */
  const delegate = (to: CrewMember[]) => {
    const next: QuoteInput = { ...q, teamId: crewKey(to), supervision: 'supervise', priceNet: price ?? 0 };
    set({ teamId: next.teamId, supervision: 'supervise' });
    const np = previewQuote(game, next);
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
              {subOptions.map(({ sub, price: sp, fits }) => (
                <label key={sub.id} className="flex items-center gap-2 text-slate-300"><input type="checkbox" className="size-4 accent-sky" checked={has('sub', sub.id)} onChange={() => toggle('sub', sub.id)} data-testid={`crew-sub-${sub.id}`} />{sub.name.replace(' (fikcyjna)', '')} <span className={cx('text-xs', fits ? 'text-slate-500' : 'text-gold')}>· podwykonawca, {formatPLN(sp, { round: true })} za całość{fits ? '' : ' (słabsze kompetencje)'}</span></label>
              ))}
            </div>
            {employees.length === 0 && <p className="text-xs text-slate-500">Zatrudnieni pracownicy pojawią się tu automatycznie (od dnia rozpoczęcia pracy) — nie trzeba tworzyć ekipy.</p>}
            <div className="grid grid-cols-2 gap-3">
              {game.ops.teams.length > 0 && <div><label htmlFor="q-team" className="mb-1 block text-xs text-slate-400">Albo gotowa ekipa</label><select id="q-team" className={field} value={customCrew ? '__custom' : q.teamId ?? ''} onChange={(e) => e.target.value !== '__custom' && set({ teamId: e.target.value || null, supervision: 'supervise' })}><option value="">— skład wybrany wyżej —</option>{customCrew && <option value="__custom" hidden>własny skład</option>}{game.ops.teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}</select></div>}
            <div><label htmlFor="q-veh" className="mb-1 block text-xs text-slate-400">Pojazd</label><select id="q-veh" className={field} value={q.vehicleId ?? ''} onChange={(e) => set({ vehicleId: e.target.value || null })}><option value="">bez pojazdu</option>{game.ops.vehicles.map((v) => <option key={v.id} value={v.id}>{vehicleDef(v).label}</option>)}</select></div>
              {!ownerIn && (
                <div className="col-span-2"><label htmlFor="q-sup" className="mb-1 block text-xs text-slate-400">Nadzór właściciela</label><select id="q-sup" className={field} value={q.supervision ?? 'supervise'} onChange={(e) => set({ supervision: e.target.value as 'supervise' | 'hands-off' })}><option value="supervise">nadzoruje (1 godz. dziennie)</option><option value="hands-off">pełne delegowanie (bez godzin, większe ryzyko)</option></select></div>
              )}
            </div>
          </fieldset>
          {(ownerBlocked || !ownerIn) && (
            <div className="rounded-xl border border-gold/40 bg-gold/5 p-3 text-xs" data-testid="outsource-box">
              {!ownerIn ? (
                <p className="text-slate-300">Pracę wykonają wybrani wykonawcy, a Ty tylko ją nadzorujesz.{members.some((m) => m.kind === 'sub') && ' Po podpisaniu umowy podwykonawcy przyślą oferty do zaakceptowania w „Podwykonawcy” (ważne 5 dni; zaliczka, jeśli ją stosują, to przedpłata, nie koszt).'}{members.some((m) => m.kind === 'employee') && ' Pracownicy muszą mieć aktywną umowę w dniu startu i nie mogą pracować przy dwóch kontraktach naraz.'}</p>
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
          <div className="flex flex-wrap gap-2 text-xs"><span className="self-center text-slate-400">Cena = koszt + narzut:</span>{[1_500, 2_500, 3_500].map((m) => <Button key={m} variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setMarkup(m)}>{m / 100}%</Button>)}</div>
        </div>
        <div className="space-y-3 text-sm" data-testid="quote-preview">
          <dl className="divide-y divide-ink-700/60 rounded-xl border border-ink-700 px-3">
            <Row k="Materiały (cena z dziś)" v={<Money value={p.planned.materials} />} />
            <Row k={`Robocizna (${(p.plannedCenti / 100).toFixed(1).replace('.', ',')} godz.)`} v={<Money value={p.planned.labor} />} />
            <Row k="Transport" v={<Money value={p.planned.transport} />} />
            <Row k="Pozostałe (odpady, drobiazgi 4%)" v={<Money value={p.planned.other} />} />
            <Row k="Koszt planowany" v={<strong><Money value={p.planned.total} /></strong>} />
            <Row k="Cena netto" v={<Money value={input.priceNet} />} />
            <Row k={p.vatRateBps ? `Cena brutto (VAT ${p.vatRateBps / 100}%)` : 'Cena dla klienta (bez VAT — zwolnienie)'} v={<Money value={p.priceGross} />} />
            <Row k="Narzut (od kosztu)" v={fmtPct(p.markupBps)} tone={moneyTone(p.markupBps)} />
            <Row k="Marża (od ceny)" v={fmtPct(p.marginBps)} tone={moneyTone(p.marginBps)} />
            <Row k="Zarobek / godz. (bez robocizny w kosztach)" v={<Money value={p.effectiveHourly} />} />
            <Row k="Minimalny czas pracy" v={`${p.minDays} dni po ${input.hoursPerDay} godz.`} />
            <Row k={`Poziom umiejętności / wymagany`} v={`${p.level} / ${p.difficulty}`} />
          </dl>
          {p.errors.length > 0 && <ul className="space-y-1 text-xs text-loss" role="alert">{p.errors.map((e) => <li key={e}>✖ {e}</li>)}</ul>}
          {p.warnings.length > 0 && <ul className="space-y-1 text-xs text-gold">{p.warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>}
          {Object.keys(p.stockShortage).length > 0 && <p className="text-xs text-slate-400">Materiały do zakupu po podpisaniu umowy: {Object.entries(p.stockShortage).map(([k, n]) => `${MATERIAL_BY_ID.get(splitKey(k).materialId)!.label} × ${n}`).join(', ')}.</p>}
          <Button variant="primary" className="w-full" disabled={p.errors.length > 0 || price === null} onClick={() => send(enq.id, input)} data-testid="send-quote">Wyślij ofertę klientowi</Button>
          <p className="text-xs text-slate-500">Klient może zaakceptować, odrzucić, poprosić o rabat albo o zmianę terminu. Decyzja zapada w ciągu 1–3 dni.</p>
        </div>
      </div>
    </Card>
  );
}

export function RenoQuotesScreen() {
  const { game, biz, isReno } = useReno();
  const selected = useGameStore((s) => s.selectedEnquiryId);
  const respond = useGameStore((s) => s.respondToCounter);
  const sign = useGameStore((s) => s.signContract);
  if (!biz || !isReno) return <NoReno title="Wyceny" />;
  const quotes = [...game.reno.quotes].reverse();
  const STATUS = { sent: ['czeka na decyzję klienta', 'sky'], counter: ['klient proponuje zmianę', 'gold'], accepted: ['zaakceptowana — podpisz umowę', 'gain'], rejected: ['odrzucona', 'loss'], declined: ['zrezygnowano', 'neutral'], signed: ['umowa podpisana', 'gain'], expired: ['wygasła', 'neutral'] } as const;
  return (
    <div className="space-y-5">
      <ScreenHeader title="Wyceny" subtitle="Przygotuj ofertę (koszt planowany + narzut), negocjuj warunki i podpisz umowę." />
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
                  {q.status === 'accepted' && (
                    <div className="mt-2 flex flex-wrap items-center gap-3"><Button variant="primary" onClick={() => sign(q.id)} data-testid={`sign-${q.id}`}>Podpisz umowę</Button><span className="text-xs text-gold">Podpisz do {formatDatePL(q.signBy!)}.</span></div>
                  )}
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
                      <Row k="Koszt planowany" v={<Money value={j.planned.total} />} />
                      <Row k="Koszt rzeczywisty (z robocizną)" v={<Money value={f.actualCost} />} />
                      <Row k="Marża planowana" v={fmtPct(f.plannedMarginBps)} />
                      <Row k="Marża rzeczywista" v={f.actualMarginBps === null ? 'po rozliczeniu' : fmtPct(f.actualMarginBps)} />
                      <Row k="Wynik ekonomiczny" v={<Money value={f.economicResult} signed />} tone={moneyTone(f.economicResult)} />
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
              const effects = [...Object.entries(e.speedBps).map(([k, v]) => `+${v / 100}% szybkości${k === '*' ? '' : ` (${SERVICE_BY_ID.get(k)?.label ?? k})`}`), ...Object.entries(e.quality).map(([k, v]) => `+${v} jakości${k === '*' ? '' : ` (${SERVICE_BY_ID.get(k)?.label ?? k})`}`), ...(e.transportSaveBps ? [`−${e.transportSaveBps / 100}% kosztu transportu`] : [])];
              const used = SERVICES.filter((d) => d.requiredEquipment.includes(e.id)).map((d) => d.label);
              return (
                <tr key={e.id} data-testid={`eq-${e.id}`}>
                  <td className="py-2 text-slate-200">{e.label}{used.length > 0 && <div className="text-xs text-gold">wymagany: {used.join(', ')}</div>}</td>
                  <td className="py-2 text-slate-400">{e.category}</td>
                  <td className="py-2 text-right"><Money value={e.priceNet} round /></td>
                  <td className="py-2 w-40">{item ? <><ProgressBar value={item.conditionBps} max={10_000} tone={item.conditionBps < 3_000 ? 'loss' : item.conditionBps < 6_000 ? 'gold' : 'gain'} /><div className="mt-0.5 text-xs text-slate-500">{Math.round(item.conditionBps / 100)}%</div></> : <span className="text-xs text-slate-500">nie posiadasz</span>}</td>
                  <td className="py-2 text-right">{item ? <Money value={equipmentBookValue(item)} /> : '—'}</td>
                  <td className="py-2 text-xs text-slate-400">{effects.join(', ') || '—'}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {item && item.conditionBps < 9_500 && <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => maintain(item.id)}>Konserwacja ({formatPLN(e.maintenanceNet, { round: true })})</Button>}{' '}
                    {(!item || item.conditionBps <= 0) && <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => buyEq(e.id)} data-testid={`buy-eq-${e.id}`}>Kup</Button>}
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
  const setAd = useGameStore((s) => s.setAdvertising);
  const resolve = useGameStore((s) => s.resolveComplaint);
  if (!biz || !isReno) return <NoReno title="Reputacja i reklamacje" />;
  const rep = reputation(game);
  const rate = enquiryRateBps(game, game.clock.today);
  const reviews = [...game.reno.reviews].reverse().slice(0, 10);
  const complaints = [...game.reno.complaints].filter((c) => c.status !== 'pending').reverse();
  const CSTATUS = { pending: 'zaplanowana', open: 'czeka na decyzję', repairing: 'poprawki w toku', resolved: 'rozwiązana', refunded: 'rabat przyznany', escalated: 'eskalowana (negatywna opinia)' } as const;
  return (
    <div className="space-y-5">
      <ScreenHeader title="Reputacja i reklamacje" subtitle="Opinie klientów wpływają na liczbę zapytań i szanse na akceptację ofert." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard testId="reno-reputation" label="Reputacja" icon="trend" accent="gold" value={`${rep.stars.toString().replace('.', ',')}★`} hint={`${rep.reviews} opinii · start 3,5★`} />
        <StatCard label="Szansa na zapytanie dziś" icon="bell" accent="sky" value={fmtPct(rate.total)} hint="łącznie z modyfikatorami" />
        <StatCard label="Sezon" icon="calendar" accent="violet" value={fmtPct(rate.parts.season)} hint="popyt miesiąca (parametr)" />
        <StatCard label="Dostępność terminów" icon="clock" accent="gain" value={fmtPct(rate.parts.availability)} hint="wolne godziny w 14 dni" />
      </div>
      <Card title="Reklama">
        <div className="grid gap-2 sm:grid-cols-3" data-testid="advertising">
          {ADVERTISING.map((a) => (
            <div key={a.id} className={cx('rounded-xl border p-3 text-sm', game.reno.advertising.level === a.id ? 'border-sky bg-sky/10' : 'border-ink-600')}>
              <div className="font-medium text-slate-100">{a.label}</div>
              <div className="mt-1 text-xs text-slate-400">{a.monthlyNet > 0 ? `${formatPLN(a.monthlyNet, { round: true })} netto / mies.` : 'bez kosztów'} · zapytań ×{(a.leadBps / 10_000).toFixed(1).replace('.', ',')}</div>
              <Button variant="secondary" className="mt-2" disabled={game.reno.advertising.level === a.id} onClick={() => setAd(a.id)} data-testid={`ad-${a.id}`}>{game.reno.advertising.level === a.id ? 'Aktywna' : 'Wybierz'}</Button>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">Opłata (dokument kosztowy) jest pobierana przy włączeniu i 1. dnia każdego miesiąca. Zmiana poziomu w tym samym miesiącu nie daje darmowego okresu.</p>
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
