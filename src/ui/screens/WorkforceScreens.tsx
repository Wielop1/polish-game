import { useState } from 'react';
import type { ReactNode } from 'react';
import { addDays, formatDatePL, monthKey } from '../../engine/date.ts';
import { formatPLN, zl } from '../../engine/money.ts';
import { crewProfitability, fixedCosts, liquidityForecast, teamLoad } from '../../engine/profitability.ts';
import { jobFinancials, jobForecast } from '../../engine/renovation.ts';
import { LISTING_TIERS, MARKET_GROSS_BY_LEVEL, ROLES, ROLE_BY_ID, SERVICE_BY_ID, VEHICLES } from '../../engine/renovationCatalog.ts';
import { subHistory, subPrice, subcontractsOfJob } from '../../engine/subcontractors.ts';
import { memberLabel } from '../../engine/teams.ts';
import { vehicleBookValue, vehicleDef } from '../../engine/fleet.ts';
import {
  activeEmployments, candidateView, employerContributions, minGrossFor, monthlyEmployerCost, noticePeriod, personById, personLevel, personName, wageOn,
} from '../../engine/workforce.ts';
import { useGameStore } from '../../store/gameStore.ts';
import { useOpGame } from '../useOperator.ts';
import { currentOperator } from '../../engine/operator.ts';
import { ProgressBar } from '../components/charts.tsx';
import { Badge, Button, Card, Empty, Money, ScreenHeader, StatCard, cx, moneyTone } from '../components/ui.tsx';
import { parseZloty, splitMemberKey } from '../format.ts';
import { LegalBadge } from './BusinessScreens.tsx';

const input = 'rounded-xl border border-ink-600 bg-ink-900/80 px-3 py-2 text-slate-100 focus:border-sky focus:outline-none';
const fmtPct = (bps: number) => `${(bps / 100).toFixed(1).replace('.', ',')}%`;

function Row({ k, v, tone }: { k: ReactNode; v: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <dt className="text-slate-400">{k}</dt>
      <dd className={cx('tabular text-right', tone ?? 'text-slate-100')}>{v}</dd>
    </div>
  );
}

function useBiz() {
  const game = useOpGame();
  return { game, biz: currentOperator(game) };
}

function NoBiz({ title }: { title: string }) {
  const navigate = useGameStore((s) => s.navigate);
  return (
    <div className="space-y-5">
      <ScreenHeader title={title} />
      <Card><Empty>Ten ekran dotyczy prowadzonej działalności.<div className="mt-3"><Button variant="primary" onClick={() => navigate('bizRegister')}>Zarejestruj JDG</Button></div></Empty></Card>
    </div>
  );
}

const Param = () => (
  <p className="text-xs text-slate-500" data-testid="ops-param-note">
    Wynagrodzenia rynkowe, ceny podwykonawców i pojazdów to <strong>parametry symulacyjne</strong>. Składki pracodawcy 2026 (emerytalna 9,76%, rentowa 6,5%, wypadkowa 1,67%, FP 2,45%, FGŚP 0,10%) pochodzą ze stron ZUS — szczegóły i uproszczenia w rejestrze reguł (EMP-*).
    Urlopy, L4, PPK, nadgodziny i zaawansowane prawo pracy nie są jeszcze modelowane.
  </p>
);

/* ---------- Pracownicy ---------- */

export function HrEmployeesScreen() {
  const { game, biz } = useBiz();
  const notice = useGameStore((s) => s.giveNotice);
  const setWage = useGameStore((s) => s.setWage);
  const [wageText, setWageText] = useState<Record<string, string>>({});
  if (!biz) return <NoBiz title="Pracownicy" />;
  const today = game.clock.today;
  const active = activeEmployments(game);
  const ended = game.ops.employments.filter((e) => e.status === 'ended');
  const monthly = active.reduce((a, e) => a + monthlyEmployerCost(wageOn(e, today)), 0);
  return (
    <div className="space-y-5">
      <ScreenHeader title="Pracownicy" subtitle="Zatrudnieni na umowę o pracę: umiejętności, morale, koszt pracodawcy i historia wynagrodzeń. Osoba i umowa to osobne dane — historia osoby zostaje po zakończeniu zatrudnienia." />
      <Param />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard testId="hr-count" label="Zatrudnieni" icon="user" accent="sky" value={active.length} hint="limit 8 (stopa wypadkowa 1,67%)" />
        <StatCard label="Koszt zatrudnienia / mies." icon="wallet" accent="gold" value={<Money value={monthly} round />} hint="brutto + składki pracodawcy" />
        <StatCard label="Brutto razem / mies." icon="coins" accent="violet" value={<Money value={active.reduce((a, e) => a + wageOn(e, today), 0)} round />} hint="wynagrodzenia przed potrąceniami" />
        <StatCard label="Listy płac" icon="receipt" accent="gain" value={game.ops.payslips.length} hint="zaksięgowane miesiące" />
      </div>
      {game.ops.employments.some((e) => e.status === 'active' && e.startDate > today) && (
        <Card title="Przyjęci — start wkrótce">
          <ul className="divide-y divide-ink-700/60 text-sm" data-testid="upcoming-hires">
            {game.ops.employments.filter((e) => e.status === 'active' && e.startDate > today).map((e) => <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2 text-slate-300"><span>{personName(personById(game, e.personId)!)} ({ROLE_BY_ID.get(e.role)?.label ?? e.role}) · <Money value={e.grossMonthly} round /> brutto</span><span className="text-slate-500">start {formatDatePL(e.startDate)}</span></li>)}
          </ul>
        </Card>
      )}
      <Card title="Zatrudnieni teraz" action={<LegalBadge id="EMP-CONTRIB-2026" />}>
        {active.length === 0 ? <Empty>Nikogo nie zatrudniasz. Opublikuj ogłoszenie w „Rekrutacji”.</Empty> : (
          <ul className="divide-y divide-ink-700/60" data-testid="employees-list">
            {active.map((e) => {
              const p = personById(game, e.personId)!;
              const role = ROLE_BY_ID.get(e.role);
              const skill = role?.skillId ?? 'ogolne';
              const gross = wageOn(e, today);
              const c = employerContributions(gross, gross, gross);
              const np = noticePeriod(e, today);
              return (
                <li key={e.id} data-testid={`employee-${e.id}`} className="grid gap-4 py-4 lg:grid-cols-3">
                  <div>
                    <div className="font-medium text-slate-100">{personName(p)} <Badge tone={e.noticeGivenOn ? 'gold' : 'gain'}>{e.noticeGivenOn ? `wypowiedzenie do ${formatDatePL(e.endDate!)}` : 'aktywny'}</Badge></div>
                    <div className="text-sm text-slate-400">{role?.label ?? e.role} · poziom {personLevel(p, skill)}/5 · od {formatDatePL(e.startDate)}</div>
                    <dl className="mt-2 divide-y divide-ink-700/60 text-sm">
                      <Row k="Wymiar" v={`${e.hoursPerMonth} godz./mies.`} />
                      <Row k="Brutto" v={<Money value={gross} />} />
                      <Row k="Składki pracodawcy" v={<Money value={c.total} />} />
                      <Row k="Koszt całkowity" v={<strong><Money value={monthlyEmployerCost(gross)} /></strong>} />
                      <Row k="Koszt godziny" v={<Money value={e.hourlyCost} />} />
                    </dl>
                  </div>
                  <div className="text-sm">
                    <div className="mb-1 text-xs text-slate-400">Morale {p.morale}/100</div>
                    <ProgressBar value={p.morale} max={100} tone={p.morale < 35 ? 'loss' : p.morale < 55 ? 'gold' : 'gain'} />
                    <div className="mb-1 mt-3 text-xs text-slate-400">Zmęczenie {p.fatigue}/100</div>
                    <ProgressBar value={p.fatigue} max={100} tone={p.fatigue > 60 ? 'loss' : p.fatigue > 35 ? 'gold' : 'gain'} />
                    <div className="mt-3 text-xs text-slate-500">Staranność {p.diligence} · lojalność {p.loyalty} · oczekiwania {formatPLN(p.expectedGross, { round: true })}</div>
                    <div className="mt-2 text-xs text-slate-500">Historia wynagrodzeń: {e.wageHistory.map((w) => `${formatDatePL(w.from)}: ${formatPLN(w.gross, { round: true })}`).join(' → ')}</div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex flex-wrap items-end gap-2">
                      <div>
                        <label htmlFor={`wage-${e.id}`} className="mb-1 block text-xs text-slate-400">Nowe brutto (od następnego miesiąca)</label>
                        <input id={`wage-${e.id}`} className={cx(input, 'w-32')} value={wageText[e.id] ?? ''} placeholder={String(gross / 100)} onChange={(ev) => setWageText({ ...wageText, [e.id]: ev.target.value })} inputMode="decimal" />
                      </div>
                      <Button variant="secondary" onClick={() => { const g = parseZloty(wageText[e.id] ?? ''); if (g !== null && setWage(e.id, g)) setWageText({ ...wageText, [e.id]: '' }); }}>Zmień</Button>
                    </div>
                    {!e.noticeGivenOn && (
                      <Button variant="danger" onClick={() => { if (window.confirm(`Wypowiedzieć umowę? Okres wypowiedzenia: ${np.label}, koniec ${formatDatePL(np.endDate)}. Do tego czasu płacisz wynagrodzenie i składki.`)) notice(e.id); }} data-testid={`notice-${e.id}`}>Wypowiedz umowę ({np.label})</Button>
                    )}
                    <div className="text-xs text-slate-500">Minimalne brutto dla tego wymiaru: {formatPLN(minGrossFor(e.hoursPerMonth), { round: true })}.</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card title="Listy płac">
        {game.ops.payslips.length === 0 ? <Empty>Pierwsza lista płac powstanie ostatniego dnia miesiąca zatrudnienia. Netto płacisz do 10., ZUS i PIT do 20. następnego miesiąca.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm" data-testid="payslips">
            <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><th className="pb-2 font-medium">Miesiąc</th><th className="pb-2 font-medium">Pracownik</th><th className="pb-2 text-right font-medium">Brutto</th><th className="pb-2 text-right font-medium">Netto</th><th className="pb-2 text-right font-medium">ZUS + zdrowotna pracownika</th><th className="pb-2 text-right font-medium">Zaliczka PIT</th><th className="pb-2 text-right font-medium">Składki pracodawcy</th><th className="pb-2 text-right font-medium">Koszt całkowity</th></tr></thead>
            <tbody className="divide-y divide-ink-700/60">
              {[...game.ops.payslips].reverse().slice(0, 18).map((p) => (
                <tr key={p.id}>
                  <td className="py-2 text-slate-300">{p.month}{p.factorBps < 10_000 && <span className="text-xs text-gold"> ({fmtPct(p.factorBps)} miesiąca)</span>}</td>
                  <td className="py-2 text-slate-300">{personName(personById(game, p.personId)!)}</td>
                  <td className="py-2 text-right"><Money value={p.gross} /></td>
                  <td className="py-2 text-right"><Money value={p.net} /></td>
                  <td className="py-2 text-right text-slate-400"><Money value={p.socialTotal + p.health} /></td>
                  <td className="py-2 text-right text-slate-400"><Money value={p.pitAdvance} /></td>
                  <td className="py-2 text-right text-slate-400"><Money value={p.employer.total} /></td>
                  <td className="py-2 text-right"><Money value={p.totalCost} /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <p className="mt-3 text-xs text-slate-500">Koszt całkowity = brutto + składki pracodawcy; to koszt podatkowy firmy w miesiącu naliczenia. Płaca netto, składki i zaliczka PIT to trzy osobne zobowiązania (bez podwójnego księgowania).</p>
      </Card>
      {ended.length > 0 && (
        <Card title="Zakończone zatrudnienia">
          <ul className="divide-y divide-ink-700/60 text-sm">
            {ended.map((e) => <li key={e.id} className="flex justify-between gap-2 py-2 text-slate-300"><span>{personName(personById(game, e.personId)!)} ({ROLE_BY_ID.get(e.role)?.label ?? e.role})</span><span className="text-slate-500">{formatDatePL(e.startDate)} – {formatDatePL(e.endDate!)}</span></li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}

/* ---------- Rekrutacja ---------- */

export function HrRecruitmentScreen() {
  const { game, biz } = useBiz();
  const publish = useGameStore((s) => s.publishListing);
  const close = useGameStore((s) => s.closeListing);
  const offer = useGameStore((s) => s.makeOffer);
  const reject = useGameStore((s) => s.rejectCandidate);
  const [role, setRole] = useState<string>(ROLES[0]!.id);
  const [minLevel, setMinLevel] = useState(2);
  const [tier, setTier] = useState<'basic' | 'premium'>('basic');
  const [grossText, setGrossText] = useState<Record<string, string>>({});
  const [hours, setHours] = useState<Record<string, string>>({});
  const [start, setStart] = useState<Record<string, string>>({});
  if (!biz) return <NoBiz title="Rekrutacja" />;
  const today = game.clock.today;
  const listings = game.ops.listings.filter((l) => l.status === 'active');
  const cands = game.ops.candidates.filter((c) => c.status === 'new' || c.status === 'countered');
  const history = [...game.ops.candidates].filter((c) => c.status !== 'new' && c.status !== 'countered').reverse().slice(0, 8);
  const STATUS = { hired: 'zatrudniony(-a)', declined: 'odmówił(a)', rejected: 'odrzucony(-a)', expired: 'wygasło' } as const;
  return (
    <div className="space-y-5">
      <ScreenHeader title="Rekrutacja" subtitle="Ogłoszenie kosztuje pieniądze i Twój czas (1 godz. dziennie przez 5 dni). Kandydaci mają różne umiejętności i oczekiwania — nie wszyscy są idealni i mogą odmówić." />
      <Param />
      <Card title="Nowe ogłoszenie" action={<LegalBadge id="EMP-CONTRIB-2026" />}>
        <div className="flex flex-wrap items-end gap-3" data-testid="listing-form">
          <div><label htmlFor="l-role" className="mb-1 block text-xs text-slate-400">Stanowisko</label><select id="l-role" className={input} value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></div>
          <div><label htmlFor="l-level" className="mb-1 block text-xs text-slate-400">Minimalny poziom</label><select id="l-level" className={input} value={minLevel} onChange={(e) => setMinLevel(Number(e.target.value))}>{[1, 2, 3, 4, 5].map((l) => <option key={l} value={l}>{l} (rynkowo ok. {formatPLN(MARKET_GROSS_BY_LEVEL[l]!, { round: true })} brutto)</option>)}</select></div>
          <div><label htmlFor="l-tier" className="mb-1 block text-xs text-slate-400">Rodzaj ogłoszenia</label><select id="l-tier" className={input} value={tier} onChange={(e) => setTier(e.target.value as 'basic' | 'premium')}>{(Object.keys(LISTING_TIERS) as ('basic' | 'premium')[]).map((t) => <option key={t} value={t}>{LISTING_TIERS[t].label} — {formatPLN(LISTING_TIERS[t].costNet, { round: true })} netto</option>)}</select></div>
          <Button variant="primary" onClick={() => publish({ role, minLevel, tier })} data-testid="publish-listing">Opublikuj</Button>
        </div>
        {listings.length > 0 && (
          <ul className="mt-4 divide-y divide-ink-700/60 text-sm" data-testid="listings">
            {listings.map((l) => <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-slate-300"><span>{ROLE_BY_ID.get(l.role)!.label} · min. poziom {l.minLevel} · {LISTING_TIERS[l.tier].label} · do {formatDatePL(l.endsOn)}</span><Button variant="ghost" onClick={() => close(l.id)}>Zamknij</Button></li>)}
          </ul>
        )}
      </Card>
      <Card title={`Zgłoszenia (${cands.length})`}>
        {cands.length === 0 ? <Empty>Brak zgłoszeń do rozpatrzenia. Zgłoszenia napływają, dopóki ogłoszenie jest aktywne.</Empty> : (
          <ul className="grid gap-3 lg:grid-cols-2" data-testid="candidates">
            {cands.map((c) => {
              const { person, listing, level } = candidateView(game, c);
              const expected = c.counterGross ?? person.expectedGross;
              const age = Number(today.slice(0, 4)) - Number(person.birthDate.slice(0, 4));
              const startDefault = start[c.id] ?? (person.availableFrom > addDays(today, 1) ? person.availableFrom : addDays(today, 1));
              const h = Number(hours[c.id] ?? 160);
              return (
                <li key={c.id} data-testid={`cand-${c.id}`} className="rounded-xl border border-ink-700 bg-ink-900/40 p-4 text-sm">
                  <div className="flex items-start justify-between gap-2"><strong className="text-slate-100">{personName(person)}, {age} lat</strong><Badge tone={c.status === 'countered' ? 'gold' : level >= listing.minLevel ? 'gain' : 'neutral'}>{c.status === 'countered' ? 'kontrpropozycja' : level >= listing.minLevel ? 'spełnia wymagania' : 'poniżej wymaganego poziomu'}</Badge></div>
                  <dl className="mt-2 divide-y divide-ink-700/60">
                    <Row k={ROLE_BY_ID.get(listing.role)!.label} v={`poziom ${level}/5 · ${(person.xp[listing.skillId] ?? 0) / 100} godz. doświadczenia`} />
                    <Row k="Oczekuje (pełny etat, brutto)" v={<Money value={expected} />} />
                    <Row k="Dostępny od" v={formatDatePL(person.availableFrom)} />
                    <Row k="Staranność / lojalność" v={`${person.diligence} / ${person.loyalty}`} />
                    {c.note && <Row k="Uwaga" v={c.note} tone="text-gold" />}
                  </dl>
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <div><label htmlFor={`g-${c.id}`} className="mb-1 block text-xs text-slate-400">Oferta brutto (zł)</label><input id={`g-${c.id}`} className={cx(input, 'w-28')} value={grossText[c.id] ?? ''} placeholder={String(Math.round((expected * h) / 160 / 100))} onChange={(e) => setGrossText({ ...grossText, [c.id]: e.target.value })} inputMode="decimal" /></div>
                    <div><label htmlFor={`h-${c.id}`} className="mb-1 block text-xs text-slate-400">Godz./mies.</label><input id={`h-${c.id}`} className={cx(input, 'w-20')} value={hours[c.id] ?? '160'} onChange={(e) => setHours({ ...hours, [c.id]: e.target.value })} inputMode="numeric" /></div>
                    <div><label htmlFor={`s-${c.id}`} className="mb-1 block text-xs text-slate-400">Start</label><input id={`s-${c.id}`} type="date" className={input} value={startDefault} onChange={(e) => setStart({ ...start, [c.id]: e.target.value })} /></div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button variant="primary" data-testid={`offer-${c.id}`} onClick={() => { const g = parseZloty(grossText[c.id] ?? '') ?? Math.round((expected * h) / 160); offer(c.id, { gross: g, hoursPerMonth: h, startDate: startDefault }); }}>Złóż ofertę</Button>
                    <Button variant="ghost" onClick={() => reject(c.id)}>Odrzuć</Button>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Koszt pracodawcy przy {formatPLN(Math.round((expected * h) / 160), { round: true })} brutto: {formatPLN(monthlyEmployerCost(Math.round((expected * h) / 160)), { round: true })} miesięcznie.</p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {history.length > 0 && (
        <Card title="Ostatnie rozmowy">
          <ul className="divide-y divide-ink-700/60 text-sm">
            {history.map((c) => <li key={c.id} className="flex justify-between gap-2 py-2 text-slate-300"><span>{personName(personById(game, c.personId)!)}{c.note ? ` — ${c.note}` : ''}</span><Badge tone={c.status === 'hired' ? 'gain' : 'neutral'}>{STATUS[c.status as keyof typeof STATUS] ?? c.status}</Badge></li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}

/* ---------- Podwykonawcy ---------- */

export function SubcontractorsScreen() {
  const { game, biz } = useBiz();
  const request = useGameStore((s) => s.requestSubOffer);
  const accept = useGameStore((s) => s.acceptSubOffer);
  const decline = useGameStore((s) => s.declineSubOffer);
  const cancel = useGameStore((s) => s.cancelSubcontract);
  const acceptWork = useGameStore((s) => s.acceptSubWork);
  const [sel, setSel] = useState<Record<string, string>>({});
  const [scope, setScope] = useState<Record<string, number>>({});
  if (!biz) return <NoBiz title="Podwykonawcy" />;
  const jobs = game.reno.jobs.filter((j) => j.stage !== 'done' && j.stage !== 'cancelled');
  const contracts = [...game.ops.subcontracts].reverse().filter((c) => c.status !== 'declined' && c.status !== 'expired').slice(0, 12);
  const STATUS = { offered: ['oferta czeka na decyzję', 'gold'], accepted: ['umowa zawarta', 'sky'], in_progress: ['w trakcie prac', 'sky'], delivered: ['gotowe do odbioru', 'gain'], settled: ['rozliczona', 'neutral'], cancelled: ['anulowana', 'neutral'], declined: ['odrzucona', 'neutral'], expired: ['wygasła', 'neutral'] } as const;
  return (
    <div className="space-y-5">
      <ScreenHeader title="Podwykonawcy" subtitle="Współpraca B2B: firma wykonuje część kontraktu za umówioną cenę. Nie jest pracownikiem — brak ZUS i płacy etatowej; zaliczka to przedpłata, a koszt powstaje przy odbiorze pracy." />
      <Param />
      <Card title="Cennik i historia" action={<LegalBadge id="SUB-B2B" />}>
        <div className="grid gap-3 lg:grid-cols-2" data-testid="sub-pool">
          {game.ops.subcontractors.map((sub) => {
            const h = subHistory(game, sub.id);
            return (
              <div key={sub.id} className="rounded-xl border border-ink-700 bg-ink-900/40 p-4 text-sm" data-testid={`sub-${sub.id}`}>
                <div className="font-medium text-slate-100">{sub.name}</div>
                <div className="mt-1 text-xs text-slate-400">Jakość {sub.quality}/100 · terminowość ok. {Math.round(sub.reliabilityBps / 100)}% · {sub.services.map((x) => SERVICE_BY_ID.get(x)?.label).join(', ')}</div>
                <ul className="mt-2 space-y-0.5 text-xs text-slate-300">
                  {sub.services.map((sv) => <li key={sv}>{SERVICE_BY_ID.get(sv)!.label}: <Money value={subPrice(sub, sv, 1, 'standard', 10_000)} /> / {SERVICE_BY_ID.get(sv)!.unit} (robocizna, materiały po stronie zleceniodawcy)</li>)}
                </ul>
                <div className="mt-2 text-xs text-slate-500">Historia: {h.contracts} umów{h.avgQuality !== null ? ` · śr. jakość ${h.avgQuality}` : ''}{h.onTimeBps !== null ? ` · terminowość ${Math.round(h.onTimeBps / 100)}%` : ''}{h.defects ? ` · wady: ${h.defects}` : ''}</div>
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <select aria-label={`Kontrakt dla ${sub.name}`} className={input} value={sel[sub.id] ?? ''} onChange={(e) => setSel({ ...sel, [sub.id]: e.target.value })}>
                    <option value="">— wybierz kontrakt —</option>
                    {jobs.filter((j) => sub.services.includes(j.serviceId)).map((j) => <option key={j.id} value={j.id}>{SERVICE_BY_ID.get(j.serviceId)!.label}, {j.units} {SERVICE_BY_ID.get(j.serviceId)!.unit} — {j.clientName.split(' (')[0]}</option>)}
                  </select>
                  <select aria-label={`Zakres dla ${sub.name}`} className={input} value={scope[sub.id] ?? 10_000} onChange={(e) => setScope({ ...scope, [sub.id]: Number(e.target.value) })}>
                    {[2_500, 5_000, 7_500, 10_000].map((x) => <option key={x} value={x}>{x / 100}% zakresu</option>)}
                  </select>
                  <Button variant="secondary" disabled={!sel[sub.id]} onClick={() => request(sub.id, sel[sub.id]!, scope[sub.id] ?? 10_000)} data-testid={`req-${sub.id}`}>Poproś o ofertę</Button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      <Card title="Oferty i umowy">
        {contracts.length === 0 ? <Empty>Brak ofert i umów z podwykonawcami.</Empty> : (
          <ul className="divide-y divide-ink-700/60" data-testid="sub-contracts">
            {contracts.map((c) => {
              const sub = game.ops.subcontractors.find((x) => x.id === c.subId)!;
              const job = game.reno.jobs.find((j) => j.id === c.jobId)!;
              const [label, tone] = STATUS[c.status];
              return (
                <li key={c.id} data-testid={`subc-${c.id}`} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2"><div><strong className="text-slate-100">{sub.name}</strong> <span className="text-slate-400">· {SERVICE_BY_ID.get(c.serviceId)!.label} · {c.scopeBps / 100}% zakresu · {job.clientName.split(' (')[0]}</span></div><Badge tone={tone}>{label}</Badge></div>
                  <div className="mt-1 text-slate-300">Cena <Money value={c.priceNet} /> netto (bez VAT) · zaliczka {c.advanceBps / 100}% (<Money value={c.advanceNet} />){c.prepaid > 0 ? <> · przedpłata <Money value={c.prepaid} /></> : ''} · start {formatDatePL(c.startDate)}{c.delayDays ? <span className="text-gold"> (+{c.delayDays} dn. opóźnienia)</span> : ''} · postęp {Math.round((c.performedCenti * 100) / c.requiredCenti)}%</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {c.status === 'offered' && <><Button variant="primary" onClick={() => accept(c.id)} data-testid={`accept-sub-${c.id}`}>Zaakceptuj i zapłać zaliczkę</Button><Button variant="ghost" onClick={() => decline(c.id)}>Odrzuć</Button></>}
                    {c.status === 'accepted' && <Button variant="ghost" onClick={() => cancel(c.id)}>Odstąp od umowy</Button>}
                    {c.status === 'delivered' && <Button variant="primary" onClick={() => acceptWork(c.id)} data-testid={`accept-work-${c.id}`}>Odbierz pracę i rozlicz</Button>}
                    {c.status === 'settled' && <span className="text-xs text-slate-500">Rozliczono {formatPLN(c.settledNet)} netto · jakość {c.qualityScore}/100{c.defects ? ' · wady' : ''}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ---------- Ekipy ---------- */

export function TeamsScreen() {
  const { game, biz } = useBiz();
  const create = useGameStore((s) => s.createTeam);
  const remove = useGameStore((s) => s.deleteTeam);
  const assign = useGameStore((s) => s.assignCrew);
  const [name, setName] = useState('');
  const [members, setMembers] = useState<Record<string, boolean>>({});
  const [pick, setPick] = useState<Record<string, { team: string; sup: 'worker' | 'supervise' | 'hands-off'; veh: string }>>({});
  if (!biz) return <NoBiz title="Ekipy" />;
  const today = game.clock.today;
  const employees = activeEmployments(game);
  const candidates = [{ key: 'owner:owner', label: 'Właściciel (Ty)' }, ...employees.map((e) => ({ key: `employee:${e.id}`, label: `${personName(personById(game, e.personId)!)} (pracownik)` })), ...game.ops.subcontractors.map((x) => ({ key: `sub:${x.id}`, label: `${x.name} (podwykonawca)` }))];
  const submit = () => {
    const list = Object.entries(members).filter(([, v]) => v).map(([k]) => { return splitMemberKey(k); });
    if (create(name, list)) { setName(''); setMembers({}); }
  };
  const upcoming = game.reno.jobs.filter((j) => j.stage === 'preparation' && today < j.startDate);
  return (
    <div className="space-y-5">
      <ScreenHeader title="Ekipy" subtitle="Zespoły z właściciela, pracowników i podwykonawców. Wydajność wynika ze składu, kompletów narzędzi i dostępności; ten sam człowiek ani zasób nie pracuje przy dwóch kontraktach naraz." />
      <Param />
      <Card title="Nowa ekipa">
        <div className="space-y-3 text-sm" data-testid="team-form">
          <div><label htmlFor="team-name" className="mb-1 block text-xs text-slate-400">Nazwa ekipy</label><input id="team-name" className={cx(input, 'w-64')} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <fieldset><legend className="mb-1 text-xs text-slate-400">Członkowie</legend>
            <div className="grid gap-1 sm:grid-cols-2">{candidates.map((c) => <label key={c.key} className="flex items-center gap-2 text-slate-300"><input type="checkbox" className="size-4 accent-sky" checked={!!members[c.key]} onChange={(e) => setMembers({ ...members, [c.key]: e.target.checked })} />{c.label}</label>)}</div>
          </fieldset>
          <Button variant="primary" onClick={submit} data-testid="create-team">Utwórz ekipę</Button>
        </div>
      </Card>
      <Card title="Ekipy">
        {game.ops.teams.length === 0 ? <Empty>Brak ekip. Zatrudnij pracowników i utwórz pierwszą ekipę.</Empty> : (
          <ul className="grid gap-3 lg:grid-cols-2" data-testid="teams">
            {game.ops.teams.map((t) => {
              const load = teamLoad(game, t.id);
              const job = game.reno.jobs.find((j) => j.crew.teamId === t.id && j.stage !== 'done' && j.stage !== 'cancelled');
              return (
                <li key={t.id} data-testid={`team-${t.id}`} className="rounded-xl border border-ink-700 bg-ink-900/40 p-4 text-sm">
                  <div className="flex items-center justify-between"><strong className="text-slate-100">{t.name}</strong><Badge tone={job ? 'sky' : 'neutral'}>{job ? 'przy kontrakcie' : 'wolna'}</Badge></div>
                  <ul className="mt-2 space-y-0.5 text-slate-300">{t.members.map((m) => <li key={`${m.kind}:${m.id}`}>• {memberLabel(game, m)}</li>)}</ul>
                  <div className="mt-2 text-xs text-slate-400">Obłożenie (14 dni): {load.pct}% · {job ? `kontrakt: ${job.clientName.split(' (')[0]}, ${formatDatePL(job.startDate)} – ${formatDatePL(job.deadline)}` : 'brak kontraktu'}</div>
                  <ProgressBar className="mt-1" value={load.pct} max={100} tone={load.pct > 85 ? 'gold' : 'gain'} />
                  <Button variant="ghost" className="mt-2" disabled={!!job} onClick={() => remove(t.id)}>Usuń ekipę</Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card title="Przydział do kontraktów (przed rozpoczęciem prac)">
        {upcoming.length === 0 ? <Empty>Brak kontraktów czekających na start. Ekipę możesz też wybrać już przy wycenie.</Empty> : (
          <ul className="divide-y divide-ink-700/60" data-testid="assign-list">
            {upcoming.map((j) => {
              const cur = pick[j.id] ?? { team: j.crew.teamId ?? '', sup: j.crew.supervision, veh: j.vehicleId ?? '' };
              return (
                <li key={j.id} className="grid gap-2 py-3 text-sm lg:grid-cols-[1fr_auto]">
                  <div className="text-slate-300">{SERVICE_BY_ID.get(j.serviceId)!.label}, {j.units} {SERVICE_BY_ID.get(j.serviceId)!.unit} — {j.clientName.split(' (')[0]} · {formatDatePL(j.startDate)} → {formatDatePL(j.deadline)} · teraz: {j.crew.teamId ? game.ops.teams.find((t) => t.id === j.crew.teamId)?.name : 'właściciel samodzielnie'}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select aria-label={`Ekipa dla ${j.id}`} className={input} value={cur.team} onChange={(e) => setPick({ ...pick, [j.id]: { ...cur, team: e.target.value } })}><option value="">Właściciel samodzielnie</option>{game.ops.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                    <select aria-label={`Nadzór dla ${j.id}`} className={input} value={cur.sup} onChange={(e) => setPick({ ...pick, [j.id]: { ...cur, sup: e.target.value as typeof cur.sup } })}><option value="worker">właściciel pracuje</option><option value="supervise">nadzoruje (1 godz./dzień)</option><option value="hands-off">bez nadzoru</option></select>
                    <select aria-label={`Pojazd dla ${j.id}`} className={input} value={cur.veh} onChange={(e) => setPick({ ...pick, [j.id]: { ...cur, veh: e.target.value } })}><option value="">bez pojazdu</option>{game.ops.vehicles.map((v) => <option key={v.id} value={v.id}>{vehicleDef(v).label}</option>)}</select>
                    <Button variant="secondary" onClick={() => assign(j.id, cur.team || null, cur.sup, cur.veh || null)} data-testid={`assign-${j.id}`}>Przydziel</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ---------- Harmonogram wielu kontraktów ---------- */

export function MultiScheduleScreen() {
  const { game, biz } = useBiz();
  if (!biz) return <NoBiz title="Harmonogram wielu kontraktów" />;
  const today = game.clock.today;
  const days = Array.from({ length: 28 }, (_, i) => addDays(today, i + 1));
  const jobs = game.reno.jobs.filter((j) => j.stage !== 'done' && j.stage !== 'cancelled').sort((a, b) => a.startDate.localeCompare(b.startDate));
  const resources: { key: string; label: string; kind: string }[] = [
    ...activeEmployments(game).map((e) => ({ key: `employee:${e.id}`, label: personName(personById(game, e.personId)!), kind: 'pracownik' })),
    ...game.ops.subcontractors.filter((x) => game.ops.assignments.some((a) => a.kind === 'sub' && a.resourceId === x.id)).map((x) => ({ key: `sub:${x.id}`, label: x.name, kind: 'podwykonawca' })),
    ...game.reno.equipment.map((x) => ({ key: `equipment:${x.id}`, label: x.catalogId, kind: 'sprzęt' })),
    ...game.ops.vehicles.map((v) => ({ key: `vehicle:${v.id}`, label: vehicleDef(v).label, kind: 'pojazd' })),
  ];
  const busy = (res: string, d: string) => {
    const [kind, id] = res.split(':') as [string, string];
    return game.ops.assignments.find((a) => a.kind === kind && a.resourceId === id && a.from <= d && d <= a.to);
  };
  const cell = (on: boolean, label?: string) => <td className={cx('h-5 min-w-4 border border-ink-800 text-center', on ? 'bg-sky/50' : '')} title={label} />;
  return (
    <div className="space-y-5">
      <ScreenHeader title="Harmonogram wielu kontraktów" subtitle="Okna kontraktów i rezerwacje zasobów na najbliższe 4 tygodnie. Kontrakty realizowane równolegle muszą mieć osobne ekipy, komplety sprzętu i pojazdy." />
      <Card title="Kontrakty">
        {jobs.length === 0 ? <Empty>Brak aktywnych kontraktów.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-xs" data-testid="gantt">
            <thead className="text-slate-500"><tr><th className="pb-2 text-left font-medium">Kontrakt</th>{days.map((d) => <th key={d} className="pb-2 font-medium">{d.slice(8)}</th>)}</tr></thead>
            <tbody>
              {jobs.map((j) => {
                const fc = jobForecast(game, j);
                return (
                  <tr key={j.id} data-testid={`gantt-${j.id}`}>
                    <td className="py-1 pr-2 text-left whitespace-nowrap text-slate-300">{SERVICE_BY_ID.get(j.serviceId)!.label} <span className="text-slate-500">· {j.crew.teamId ? game.ops.teams.find((t) => t.id === j.crew.teamId)?.name : 'właściciel'} · {fc.progressPct}% · <span className={fc.risk === 'wysokie' ? 'text-loss' : fc.risk === 'średnie' ? 'text-gold' : 'text-gain'}>{fc.risk}</span></span></td>
                    {days.map((d) => cell(j.startDate <= d && d <= j.deadline, `${formatDatePL(j.startDate)} – ${formatDatePL(j.deadline)}`))}
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </Card>
      <Card title="Zasoby (rezerwacje)">
        {resources.length === 0 ? <Empty>Brak zasobów do pokazania.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-xs" data-testid="resources">
            <thead className="text-slate-500"><tr><th className="pb-2 text-left font-medium">Zasób</th>{days.map((d) => <th key={d} className="pb-2 font-medium">{d.slice(8)}</th>)}</tr></thead>
            <tbody>
              {resources.map((r) => (
                <tr key={r.key}><td className="py-1 pr-2 text-left whitespace-nowrap text-slate-300">{r.label} <span className="text-slate-500">({r.kind})</span></td>{days.map((d) => { const a = busy(r.key, d); return cell(!!a, a ? `kontrakt ${a.jobId}` : 'wolny'); })}</tr>
              ))}
            </tbody>
          </table></div>
        )}
        <p className="mt-2 text-xs text-slate-500">Niebieskie pole = zasób zarezerwowany do kontraktu. Rezerwacje obejmują okno umowne; przy opóźnieniu wcześniejszy kontrakt ma pierwszeństwo do zasobów.</p>
      </Card>
    </div>
  );
}

/* ---------- Pojazdy ---------- */

export function VehiclesScreen() {
  const { game, biz } = useBiz();
  const buy = useGameStore((s) => s.buyVehicle);
  const assign = useGameStore((s) => s.assignVehicle);
  const [sel, setSel] = useState<Record<string, string>>({});
  if (!biz) return <NoBiz title="Pojazdy" />;
  const jobs = game.reno.jobs.filter((j) => j.stage !== 'done' && j.stage !== 'cancelled');
  return (
    <div className="space-y-5">
      <ScreenHeader title="Pojazdy" subtitle="Firmowe pojazdy skracają dojazdy i wożą materiały, ale mają koszty stałe i zmienne. Pojemność ładunku jest wąskim gardłem dużych kontraktów." />
      <Param />
      <Card title="Katalog (parametry symulacyjne)" action={<LegalBadge id="VEH-TAX-DEFERRED" />}>
        <div className="grid gap-3 lg:grid-cols-3" data-testid="vehicle-catalog">
          {VEHICLES.map((v) => (
            <div key={v.id} className="flex flex-col rounded-xl border border-ink-700 bg-ink-900/40 p-4 text-sm">
              <div className="font-medium text-slate-100">{v.label}</div>
              <p className="mt-1 flex-1 text-xs text-slate-400">{v.description}</p>
              <dl className="mt-2 divide-y divide-ink-700/60">
                <Row k="Cena" v={<Money value={v.priceNet} round />} />
                <Row k="Pojemność" v={`${v.capacity} pkt ładunku`} />
                <Row k="Eksploatacja / dzień pracy" v={<Money value={v.runPerDay} round />} />
                <Row k="Koszty stałe / mies." v={<Money value={v.fixedMonthly} round />} />
              </dl>
              <Button variant="primary" className="mt-3" onClick={() => buy(v.id)} data-testid={`buy-veh-${v.id}`}>Kup za gotówkę</Button>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">Zakup to wydatek gotówkowy i aktywo wyceniane wg stanu technicznego; nie jest kosztem podatkowym (amortyzacja, limity i VAT od pojazdów — niezaimplementowane).</p>
      </Card>
      <Card title="Moja flota">
        {game.ops.vehicles.length === 0 ? <Empty>Brak pojazdów.</Empty> : (
          <ul className="divide-y divide-ink-700/60" data-testid="fleet">
            {game.ops.vehicles.map((v) => {
              const def = vehicleDef(v);
              const job = game.reno.jobs.find((j) => j.vehicleId === v.id && j.stage !== 'done' && j.stage !== 'cancelled');
              return (
                <li key={v.id} className="grid gap-2 py-3 text-sm lg:grid-cols-[1fr_auto]" data-testid={`veh-${v.id}`}>
                  <div>
                    <div className="text-slate-100">{def.label} <Badge tone={job ? 'sky' : 'neutral'}>{job ? 'przy kontrakcie' : 'wolny'}</Badge></div>
                    <div className="text-xs text-slate-400">Kupiony {formatDatePL(v.purchasedOn)} · wartość <Money value={vehicleBookValue(v)} round /> (zakup <Money value={v.cost} round />) · dni pracy {v.usedDays} · stan {Math.round(v.conditionBps / 100)}%</div>
                    <ProgressBar className="mt-1 max-w-xs" value={v.conditionBps} max={10_000} tone={v.conditionBps < 3_000 ? 'loss' : 'gain'} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select aria-label={`Kontrakt dla ${v.id}`} className={input} value={sel[v.id] ?? ''} onChange={(e) => setSel({ ...sel, [v.id]: e.target.value })}><option value="">— kontrakt —</option>{jobs.map((j) => <option key={j.id} value={j.id}>{SERVICE_BY_ID.get(j.serviceId)!.label} — {j.clientName.split(' (')[0]}</option>)}</select>
                    <Button variant="secondary" disabled={!sel[v.id]} onClick={() => assign(sel[v.id]!, v.id)}>Przydziel</Button>
                    {job && <Button variant="ghost" onClick={() => assign(job.id, null)}>Odłącz</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ---------- Rentowność ---------- */

export function ProfitabilityScreen() {
  const { game, biz } = useBiz();
  if (!biz) return <NoBiz title="Rentowność" />;
  const today = game.clock.today;
  const crews = crewProfitability(game);
  const month = monthKey(today);
  const prev = monthKey(addDays(`${month}-01`, -1));
  const costs = [fixedCosts(game, prev), fixedCosts(game, month)];
  const fc = liquidityForecast(game, 60);
  const done = game.reno.jobs.filter((j) => j.stage === 'done' || j.stage === 'execution' || j.stage === 'handover' || j.stage === 'materials').slice(-12).reverse();
  return (
    <div className="space-y-5">
      <ScreenHeader title="Rentowność" subtitle="Wynik ekip i kontraktów oraz koszty stałe firmy. Wynagrodzenie pracownika jest dzielone między kontrakty według godzin pracy; godziny bez zlecenia to koszt stały." />
      <Param />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard testId="profit-burn" label="Miesięczne obciążenia stałe (szac.)" icon="trend" accent="gold" value={<Money value={fc.monthlyBurn} round />} hint="płace, ZUS, pojazdy, składki właściciela" />
        <StatCard label="Najniższe saldo (60 dni)" icon="wallet" accent={fc.min < 0 ? 'loss' : 'gain'} value={<Money value={fc.min} round signed />} hint={fc.firstShortfall ? `brak środków od ${formatDatePL(fc.firstShortfall)}` : 'bez zagrożenia płynności'} />
        <StatCard label="Ekipy z kontraktami" icon="user" accent="sky" value={crews.filter((c) => c.teamId).length} hint="osobno właściciel samodzielnie" />
        <StatCard label="Zakończone kontrakty" icon="briefcase" accent="violet" value={crews.reduce((a, c) => a + c.doneJobs, 0)} hint="ze wszystkich wykonawców" />
      </div>
      <Card title="Rentowność ekip (zakończone kontrakty)">
        {crews.length === 0 ? <Empty>Brak kontraktów.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm" data-testid="crew-profit">
            <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><th className="pb-2 font-medium">Wykonawca</th><th className="pb-2 text-right font-medium">Kontrakty</th><th className="pb-2 text-right font-medium">Przychód netto</th><th className="pb-2 text-right font-medium">Koszty bezpośrednie</th><th className="pb-2 text-right font-medium">Wkład na pokrycie kosztów stałych</th><th className="pb-2 text-right font-medium">Marża</th><th className="pb-2 text-right font-medium">Opóźnione</th></tr></thead>
            <tbody className="divide-y divide-ink-700/60">
              {crews.map((c) => (
                <tr key={c.teamId ?? 'owner'}>
                  <td className="py-2 text-slate-200">{c.name}</td><td className="py-2 text-right">{c.doneJobs}/{c.jobs}</td>
                  <td className="py-2 text-right"><Money value={c.revenueNet} /></td><td className="py-2 text-right text-slate-400"><Money value={c.directCosts} /></td>
                  <td className={cx('py-2 text-right', moneyTone(c.contribution))}><Money value={c.contribution} signed /></td><td className="py-2 text-right">{c.contributionBps === null ? '—' : fmtPct(c.contributionBps)}</td><td className="py-2 text-right">{c.delayedJobs}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <p className="mt-2 text-xs text-slate-500">Koszty bezpośrednie: materiały, transport/inne, praca pracowników (wg godzin), podwykonawcy, eksploatacja pojazdów. Własna robocizna właściciela nie jest kosztem gotówkowym.</p>
      </Card>
      <Card title="Koszty stałe (nieprzypisane do kontraktów)">
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm" data-testid="fixed-costs">
          <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><th className="pb-2 font-medium">Pozycja</th>{costs.map((c) => <th key={c.month} className="pb-2 text-right font-medium">{c.month}</th>)}</tr></thead>
          <tbody className="divide-y divide-ink-700/60">
            {([['Płace — godziny bez zlecenia (bezczynność)', 'payrollIdle'], ['Płace — razem (koszt pracodawcy)', 'payrollTotal'], ['Płace przypisane do kontraktów', 'payrollAllocated'], ['Pojazdy — koszty stałe', 'vehicleFixed'], ['Reklama', 'advertising'], ['Księgowość', 'accounting'], ['Rekrutacja', 'recruitment'], ['Składki właściciela (ZUS)', 'ownerContributions'], ['Razem koszty stałe', 'total']] as const).map(([label, k]) => (
              <tr key={k} className={k === 'total' ? 'font-semibold' : ''}><td className="py-2 text-slate-300">{label}</td>{costs.map((c) => <td key={c.month} className="py-2 text-right"><Money value={c[k]} /></td>)}</tr>
            ))}
          </tbody>
        </table></div>
      </Card>
      <Card title="Marża kontraktów (planowana i rzeczywista)">
        {done.length === 0 ? <Empty>Brak kontraktów.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm" data-testid="contract-margins">
            <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><th className="pb-2 font-medium">Kontrakt</th><th className="pb-2 text-right font-medium">Cena netto</th><th className="pb-2 text-right font-medium">Koszt plan.</th><th className="pb-2 text-right font-medium">Praca ekipy</th><th className="pb-2 text-right font-medium">Podwykonawcy</th><th className="pb-2 text-right font-medium">Pojazd</th><th className="pb-2 text-right font-medium">Wynik ekon.</th></tr></thead>
            <tbody className="divide-y divide-ink-700/60">
              {done.map((j) => { const f = jobFinancials(j, subcontractsOfJob(game, j.id)); return (
                <tr key={j.id}><td className="py-2 text-slate-300">{SERVICE_BY_ID.get(j.serviceId)!.label} <span className="text-xs text-slate-500">({j.crew.teamId ? game.ops.teams.find((t) => t.id === j.crew.teamId)?.name : 'właściciel'})</span></td>
                  <td className="py-2 text-right"><Money value={j.priceNet} /></td><td className="py-2 text-right text-slate-400"><Money value={j.planned.total} /></td><td className="py-2 text-right"><Money value={f.actualEmployees} /></td><td className="py-2 text-right"><Money value={f.actualSubcontract} /></td><td className="py-2 text-right"><Money value={f.actualVehicle} /></td><td className={cx('py-2 text-right', moneyTone(f.economicResult))}><Money value={f.economicResult} signed /></td></tr>
              ); })}
            </tbody>
          </table></div>
        )}
      </Card>
      <Card title="Prognoza płynności (60 dni)">
        <div className="flex flex-wrap items-end gap-1" data-testid="liquidity" role="img" aria-label="Prognozowane saldo rachunku firmowego">
          {fc.points.map((p) => {
            const max = Math.max(...fc.points.map((x) => Math.abs(x.balance)), 1);
            return <div key={p.date} className="flex flex-col items-center text-[10px] text-slate-500"><div className={cx('w-6 rounded-t', p.balance < 0 ? 'bg-loss' : 'bg-gain')} style={{ height: `${Math.max(2, Math.round((Math.abs(p.balance) / max) * 80))}px` }} title={`${formatDatePL(p.date)}: ${formatPLN(p.balance)}`} />{p.date.slice(5)}</div>;
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">Prognoza nie księguje niczego: saldo + należności − zobowiązania w terminach + szacowane płace, składki i koszty stałe. Nie zakłada nowych kontraktów.</p>
      </Card>
    </div>
  );
}

void zl;
