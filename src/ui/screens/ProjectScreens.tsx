import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { addDays, diffDays, formatDatePL } from '../../engine/date.ts';
import { formatPLN, zl } from '../../engine/money.ts';
import { commands } from '../../engine/commands.ts';
import { ownerAvailable } from '../../engine/operator.ts';
import { B2B_KINDS, PROJECT_TEMPLATES, STAGE_LABEL, STAGE_ORDER, TIER_LABEL, TIER_REQUIREMENTS } from '../../engine/projectsCatalog.ts';
import { PROJECT_STATUS_LABEL, SEGMENT_LABEL, companyReferences, defaultPlanInput, planProject, projectAcceptance, requirementChecks, segmentComparison } from '../../engine/projects.ts';
import type { ProjectPlan, ProjectPlanInput } from '../../engine/projects.ts';
import { SERVICE_BY_ID } from '../../engine/renovationCatalog.ts';
import { crewKey, jobFinancials, jobForecast } from '../../engine/renovation.ts';
import type { RenoProject } from '../../engine/state.ts';
import { activeEmployments, personById, personName } from '../../engine/workforce.ts';
import { currentOperator } from '../../engine/operator.ts';
import { useGameStore } from '../../store/gameStore.ts';
import { useOpGame } from '../useOperator.ts';
import { ProgressBar } from '../components/charts.tsx';
import { Badge, Button, Card, Empty, Money, ScreenHeader, StatCard, cx, moneyTone } from '../components/ui.tsx';
import { parseZloty } from '../format.ts';
import { Head, Row } from './EconomicsPanel.tsx';

const field = 'w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky';
const pct = (bps: number) => `${(bps / 100).toFixed(0)}%`;
const stars = (x: number | null) => (x === null ? '—' : `${(x / 10).toFixed(1).replace('.', ',')}★`);

function useProjects() {
  const game = useOpGame();
  const biz = currentOperator(game);
  return { game, biz };
}

function NoBusiness({ title }: { title: string }) {
  return (
    <div className="space-y-5">
      <ScreenHeader title={title} subtitle="Większe projekty i klienci B2B dotyczą firmy remontowej." />
      <Card><Empty>Załóż firmę w branży remontowej (Firma → Rejestracja), aby zobaczyć klientów B2B, projekty i referencje.</Empty></Card>
    </div>
  );
}

const Calibration = () => <p className="text-xs text-slate-500" data-testid="project-calibration">Ceny B2B, wymagania referencyjne, terminy płatności i częstość zapytań to parametry <strong>kalibracyjne</strong> (nie dane rynkowe). Klienci są fikcyjni.</p>;

const STATUS_TONE: Record<RenoProject['status'], 'neutral' | 'gain' | 'loss' | 'gold' | 'sky'> = {
  enquiry: 'sky', quoted: 'neutral', counter: 'gold', accepted: 'gain', signed: 'sky', done: 'gain', rejected: 'loss', declined: 'neutral', expired: 'neutral', cancelled: 'loss',
};

function Checks({ checks }: { checks: ReturnType<typeof requirementChecks> }) {
  return (
    <ul className="space-y-1 text-xs" data-testid="requirement-checks">
      {checks.map((c) => (
        <li key={c.label} className={c.ok ? 'text-gain' : 'text-loss'}>{c.ok ? '✔' : '✖'} {c.label}: potrzeba {c.need}, masz {c.have}</li>
      ))}
    </ul>
  );
}

/* ---------- 1. Klienci B2B ---------- */

export function B2BClientsScreen() {
  const { game, biz } = useProjects();
  if (!biz) return <NoBusiness title="Klienci B2B" />;
  const clients = game.reno.b2bClients;
  const open = game.reno.projects.filter((p) => ['enquiry', 'quoted', 'counter', 'accepted'].includes(p.status));
  const refs = companyReferences(game);
  return (
    <div className="space-y-5">
      <ScreenHeader title="Klienci B2B" subtitle="Zarządcy, inwestorzy, firmy budowlane, generalni wykonawcy i deweloperzy — większe kontrakty z dłuższymi terminami płatności." />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon="user" label="Twój poziom dostępu" value={refs.tier === 0 ? 'brak' : `poziom ${refs.tier}`} hint={TIER_LABEL[refs.tier]} accent={refs.tier > 0 ? 'gain' : 'gold'} testId="b2b-tier" />
        <StatCard icon="user" label="Otwarte zapytania" value={`${open.length}`} hint="najwyżej 2 naraz — zapytania B2B są rzadkie" accent="sky" />
        <StatCard icon="briefcase" label="Ukończone projekty" value={`${refs.projectsDone.reduce((a, x) => a + x, 0)}`} hint="budują referencje i zaufanie klientów" accent="gain" />
      </div>
      <Card title="Klienci">
        {clients.length === 0 ? <Empty>Lista klientów powstaje wraz z pierwszym tygodniem działalności. Zapytania B2B pojawiają się rzadko — po kilku ukończonych kontraktach i dobrych opiniach.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm" data-testid="b2b-clients">
              <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><th className="pb-2 font-medium">Klient</th><th className="pb-2 font-medium">Typ</th><th className="pb-2 text-right font-medium">Płatność</th><th className="pb-2 text-right font-medium">Rzetelność płatnika</th><th className="pb-2 text-right font-medium">Zaufanie do Ciebie</th><th className="pb-2 text-right font-medium">Projekty</th></tr></thead>
              <tbody className="divide-y divide-ink-700/60">
                {clients.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2 text-slate-200">{c.name}</td>
                    <td className="py-2 text-slate-400">{B2B_KINDS[c.kind].label}</td>
                    <td className="py-2 text-right">{c.termDays} dni</td>
                    <td className="py-2 text-right"><Badge tone={c.reliability >= 75 ? 'gain' : c.reliability >= 60 ? 'gold' : 'loss'}>{c.reliability}/100</Badge></td>
                    <td className="py-2 text-right">{c.relationship}/100</td>
                    <td className="py-2 text-right">{c.projectsDone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Typy klientów — czego się spodziewać">
        <ul className="grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
          {Object.values(B2B_KINDS).map((k) => (
            <li key={k.id} className="rounded-xl border border-ink-700 p-3"><div className="font-semibold text-slate-100">{k.label}</div><div className="text-xs text-slate-400">{k.description}</div><div className="mt-1 text-xs text-slate-500">cena ok. {pct(k.priceFactorBps)} ceny prywatnej · płatność {k.termDays[0]}–{k.termDays[1]} dni · kara {pct(k.penaltyBpsPerWeek)} za tydzień zwłoki · zaliczka do {pct(k.advanceMaxBps)}</div></li>
          ))}
        </ul>
      </Card>
      <Calibration />
    </div>
  );
}

/* ---------- 2. Większe projekty ---------- */

function crewOptions(game: ReturnType<typeof useOpGame>): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const emps = activeEmployments(game);
  if (ownerAvailable(game)) out.push({ value: '', label: 'Właściciel samodzielnie' });
  for (const e of emps) { const p = personById(game, e.personId); if (p) out.push({ value: crewKey([{ kind: 'employee', id: e.id }]), label: `Pracownik: ${personName(p)}` }); }
  if (ownerAvailable(game)) for (const e of emps) { const p = personById(game, e.personId); if (p) out.push({ value: crewKey([{ kind: 'owner', id: 'owner' }, { kind: 'employee', id: e.id }]), label: `Właściciel + ${personName(p)}` }); }
  if (emps.length > 1) out.push({ value: crewKey(emps.map((e) => ({ kind: 'employee' as const, id: e.id }))), label: `Wszyscy pracownicy (${emps.length})` });
  for (const sub of game.ops.subcontractors) out.push({ value: `sub:${sub.id}`, label: `Podwykonawca: ${sub.name.replace(' (fikcyjna)', '').replace(' (fikcyjny)', '')}` });
  return out;
}

function PlanSummary({ plan, p }: { plan: ProjectPlan; p: RenoProject }) {
  const e = plan.economics;
  return (
    <dl className="divide-y divide-ink-700/60 rounded-xl border border-ink-700 px-3" data-testid="project-plan">
      <Head>Przychód i koszty projektu</Head>
      <Row k="Cena projektu netto" v={<strong><Money value={e.revenueNet} /></strong>} hint={`Budżet klienta ok. ${formatPLN(p.budgetNet, { round: true })} — powyżej ${formatPLN(p.walkAwayNet, { round: true })} oferta zostanie odrzucona.`} />
      <Row k="Koszty rzeczywiste (materiały, płace, podwykonawcy, transport)" v={<Money value={e.externalCost} />} />
      <Row k="Nadwyżka przed obciążeniami właściciela" v={<strong><Money value={e.surplus} signed /></strong>} tone={moneyTone(e.surplus)} hint="Z niej firma płaci składki, podatek i księgowość. To jeszcze nie jest wypłata." />
      <Row k={`Kalkulacyjna wartość Twojej pracy (${Math.round(e.ownerCenti / 100)} godz.)`} v={<Money value={e.ownerLabor} />} hint="Nie jest wypłatą ani kosztem podatkowym." />
      <Row k="Zysk ekonomiczny (po pracy własnej)" v={<strong><Money value={e.economicProfit} signed /></strong>} tone={moneyTone(e.economicProfit)} />
      <Row k="Zarobek za godzinę własnej pracy" v={e.ownerHourly === null ? '— (delegujesz)' : <span><Money value={e.ownerHourly} /> / godz.</span>} />
      <Head>Harmonogram i płynność</Head>
      <Row k="Czas realizacji" v={`${plan.chainDays} dni (okno klienta: ${p.maxDays})`} tone={plan.chainDays > p.maxDays ? 'text-gold' : undefined} hint={`${formatDatePL(plan.startDate)} → ${formatDatePL(plan.endDate)}`} />
      <Row k="Maksymalne zapotrzebowanie na gotówkę" v={<Money value={plan.cash.peakNeed} />} tone={plan.cash.shortfall > 0 ? 'text-loss' : undefined} hint={`Na rachunku firmy: ${formatPLN(plan.cash.available, { round: true })}.`} />
    </dl>
  );
}

function QuoteBuilder({ project }: { project: RenoProject }) {
  const { game } = useProjects();
  const run = useGameStore((s) => s.run);
  const [input, setInput] = useState<ProjectPlanInput>(() => defaultPlanInput(game, project));
  const [priceText, setPriceText] = useState(() => String(Math.round((input.totalPriceNet ?? 0) / 100)));
  const price = parseZloty(priceText);
  const eff: ProjectPlanInput = { ...input, totalPriceNet: price ?? input.totalPriceNet };
  const plan = useMemo(() => planProject(game, project, eff), [game, project, input, price]); // eslint-disable-line react-hooks/exhaustive-deps
  const options = crewOptions(game);
  const accept = projectAcceptanceHint(plan, project);
  return (
    <div className="mt-3 grid gap-4 lg:grid-cols-2" data-testid={`quote-builder-${project.id}`}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><label htmlFor={`pq-start-${project.id}`} className="mb-1 block text-xs text-slate-400">Start prac</label><input id={`pq-start-${project.id}`} type="date" className={field} value={input.startDate} min={addDays(game.clock.today, 1)} onChange={(e) => setInput({ ...input, startDate: e.target.value })} /></div>
          <div><label htmlFor={`pq-price-${project.id}`} className="mb-1 block text-xs text-slate-400">Cena projektu netto (zł)</label><input id={`pq-price-${project.id}`} className={field} value={priceText} onChange={(e) => setPriceText(e.target.value)} inputMode="decimal" /></div>
          <div><label htmlFor={`pq-term-${project.id}`} className="mb-1 block text-xs text-slate-400">Termin płatności (dni, do {project.maxTermDays})</label><input id={`pq-term-${project.id}`} type="number" className={field} value={input.paymentTermDays} min={0} max={project.maxTermDays} onChange={(e) => setInput({ ...input, paymentTermDays: Number(e.target.value) })} /></div>
          <div><label htmlFor={`pq-adv-${project.id}`} className="mb-1 block text-xs text-slate-400">Zaliczka etapu (% ceny, do {project.advanceMaxBps / 100}%)</label><input id={`pq-adv-${project.id}`} type="number" className={field} value={input.advanceBps / 100} min={0} max={project.advanceMaxBps / 100} onChange={(e) => setInput({ ...input, advanceBps: Math.round(Number(e.target.value) * 100) })} /></div>
        </div>
        <div className="rounded-xl border border-ink-700 p-3">
          <div className="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">Pakiety robót i wykonawcy</div>
          <ul className="space-y-2 text-sm">
            {plan.packages.map((x) => (
              <li key={x.pkg.id} className="grid grid-cols-[1fr_auto] gap-2" data-testid={`pkg-row-${x.pkg.id}`}>
                <div>
                  <div className="text-slate-200">{x.pkg.label} <span className="text-xs text-slate-500">· {x.pkg.units} {SERVICE_BY_ID.get(x.pkg.serviceId)!.unit}{x.pkg.complexity === 'trudne' ? ' · trudne' : ''}</span></div>
                  <div className="text-xs text-slate-500">{formatDatePL(x.startDate)} → {formatDatePL(x.endDate)} ({x.durationDays} dni{x.hoursPerDay < (input.hoursPerDay ?? 6) ? `, ${x.hoursPerDay} godz./dzień` : ''}) · nadwyżka <Money value={x.preview.economics.surplusBeforeOwner} signed /></div>
                </div>
                <select aria-label={`Wykonawcy: ${x.pkg.label}`} className={cx(field, 'w-56')} value={x.crewKey ?? ''} onChange={(e) => setInput({ ...input, crews: { ...(input.crews ?? {}), [x.pkg.id]: e.target.value === '' ? null : e.target.value } })}>
                  {!options.some((o) => o.value === (x.crewKey ?? '')) && <option value={x.crewKey ?? ''}>{x.crewKey ?? 'Właściciel'}</option>}
                  {options.map((o) => <option key={o.value || 'owner'} value={o.value}>{o.label}</option>)}
                </select>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="space-y-3">
        <PlanSummary plan={plan} p={project} />
        {plan.blockers.length > 0 && <ul className="space-y-1 text-xs text-loss" role="alert" data-testid="project-blockers">{plan.blockers.map((b) => <li key={b}>✖ {b}</li>)}</ul>}
        {plan.risks.length > 0 && <ul className="space-y-1 text-xs text-gold">{plan.risks.map((r) => <li key={r}>⚠ {r}</li>)}</ul>}
        <p className="text-xs text-slate-400">{accept}</p>
        <Button variant="primary" className="w-full" disabled={plan.blockers.length > 0} onClick={() => run((g) => commands.sendProjectQuote(g, project.id, eff))} data-testid={`send-project-${project.id}`}>Wyślij ofertę klientowi</Button>
      </div>
    </div>
  );
}

function projectAcceptanceHint(plan: ProjectPlan, p: RenoProject): string {
  const ratio = plan.totalPriceNet / p.budgetNet;
  if (plan.totalPriceNet > p.walkAwayNet) return 'Cena przekracza granicę klienta — oferta zostanie odrzucona.';
  if (ratio > 1) return 'Cena powyżej budżetu klienta: możliwa kontroferta (rabat) albo odrzucenie.';
  if (ratio > 0.9) return 'Cena w budżecie klienta. Szansa zależy też od referencji, terminu płatności i konkurencji.';
  return 'Cena wyraźnie poniżej budżetu — szansa wysoka, ale sprawdź, czy projekt nadal się opłaca (zysk ekonomiczny).';
}

function ProjectCard({ p }: { p: RenoProject }) {
  const { game } = useProjects();
  const run = useGameStore((s) => s.run);
  const [open, setOpen] = useState(false);
  const refs = companyReferences(game);
  const checks = requirementChecks(refs, p.requirements);
  const tpl = PROJECT_TEMPLATES[p.templateId];
  const ready = checks.every((c) => c.ok);
  return (
    <div className="rounded-xl border border-ink-700 p-4" data-testid={`project-${p.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-100">{p.title}</div>
          <div className="text-xs text-slate-400">{p.clientName.split(' (')[0]} · {p.location} · {tpl.label}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="sky" title={TIER_LABEL[p.tier]}>poziom {p.tier}</Badge>
          <Badge tone={STATUS_TONE[p.status]}>{PROJECT_STATUS_LABEL[p.status]}</Badge>
        </div>
      </div>
      <div className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <Row k="Orientacyjny budżet klienta (netto)" v={<Money value={p.budgetNet} round />} />
        <Row k="Termin płatności klienta" v={`${p.paymentTermDays} dni (do ${p.maxTermDays})`} />
        <Row k="Okno realizacji" v={`${p.maxDays} dni od startu`} />
        <Row k="Kara za zwłokę" v={`${pct(p.penaltyBpsPerWeek)} ceny pakietu / tydzień`} />
        <Row k="Odpowiedz do" v={formatDatePL(p.respondBy)} />
        <Row k="Pakiety" v={`${p.packages.length}`} />
      </div>
      {p.status === 'enquiry' && (
        <>
          <div className="mt-2"><div className="mb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">Wymagania klienta wobec wykonawcy</div><Checks checks={checks} /></div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setOpen(!open)} data-testid={`prepare-${p.id}`}>{open ? 'Zwiń kalkulator' : ready ? 'Przygotuj ofertę' : 'Zobacz kalkulator (brakuje referencji)'}</Button>
            <Button variant="secondary" onClick={() => run((g) => commands.declineProject(g, p.id))}>Odrzuć zapytanie</Button>
          </div>
          {open && <QuoteBuilder project={p} />}
        </>
      )}
      {p.status === 'quoted' && p.quote && <p className="mt-2 text-sm text-slate-300">Oferta {formatPLN(p.quote.priceNet, { round: true })} netto czeka na decyzję klienta do {formatDatePL(p.quote.decideOn)}. Szansa akceptacji: <strong>{Math.round(projectAcceptance(game, p).pAccept / 100)}%</strong> ({projectAcceptance(game, p).notes.join(', ') || 'brak szczególnych czynników'}).</p>}
      {p.status === 'counter' && p.quote?.counter && (
        <div className="mt-2 space-y-2 text-sm text-slate-300">
          <p>Klient proponuje rabat <strong>{pct(p.quote.counter.discountBps)}</strong> i płatność <strong>{p.quote.counter.termDays} dni</strong>. Odpowiedz do {formatDatePL(p.signBy!)}.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => run((g) => commands.respondProjectCounter(g, p.id, 'accept'))}>Przyjmij warunki klienta</Button>
            {!p.quote.held && <Button variant="secondary" onClick={() => run((g) => commands.respondProjectCounter(g, p.id, 'hold'))}>Podtrzymaj moje warunki</Button>}
            <Button variant="secondary" onClick={() => run((g) => commands.respondProjectCounter(g, p.id, 'decline'))}>Odrzuć</Button>
          </div>
        </div>
      )}
      {p.status === 'accepted' && (
        <div className="mt-2 space-y-2 text-sm text-slate-300">
          <p>Klient zaakceptował ofertę ({formatPLN(p.quote!.priceNet, { round: true })} netto, płatność {p.quote!.paymentTermDays} dni). Podpisz umowę do {formatDatePL(p.signBy!)}: pierwszy pakiet ruszy od razu, kolejne po odbiorze poprzednich.</p>
          <Button variant="primary" onClick={() => run((g) => commands.signProject(g, p.id))} data-testid={`sign-project-${p.id}`}>Podpisz umowę projektu</Button>
        </div>
      )}
      {p.status === 'signed' && <p className="mt-2 text-sm text-slate-300">Projekt w realizacji — szczegóły etapów i pakietów w „Pakiety robót”.{p.note && <span className="text-gold"> {p.note}</span>}</p>}
      {p.status === 'done' && p.outcome && <p className="mt-2 text-sm text-slate-300">Zakończony {formatDatePL(p.finishedOn!)}: przychód <Money value={p.outcome.revenueNet} round />, nadwyżka <Money value={p.outcome.surplusNet} round signed />, opóźnienie {p.outcome.lateDays} dni, kary <Money value={p.outcome.penaltiesNet} round />, ocena {stars(p.outcome.avgRating10)}.</p>}
      {(p.status === 'rejected' || p.status === 'expired' || p.status === 'cancelled') && p.note && <p className="mt-2 text-xs text-slate-500">{p.note}</p>}
    </div>
  );
}

export function ProjectsScreen() {
  const { game, biz } = useProjects();
  if (!biz) return <NoBusiness title="Większe projekty" />;
  const refs = companyReferences(game);
  const list = [...game.reno.projects].reverse();
  const active = list.filter((p) => ['enquiry', 'quoted', 'counter', 'accepted', 'signed'].includes(p.status));
  const past = list.filter((p) => !['enquiry', 'quoted', 'counter', 'accepted', 'signed'].includes(p.status));
  return (
    <div className="space-y-5">
      <ScreenHeader title="Większe projekty" subtitle="Wykończenie całego mieszkania, remont lokalu, pakiet prac, seria lokali i podzlecenia. Projekt składa się z pakietów robót, które ruszają po odbiorze poprzednich." />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon="shield" label="Dostęp do projektów" value={refs.tier === 0 ? 'jeszcze brak' : `poziom ${refs.tier}`} hint={TIER_LABEL[refs.tier]} accent={refs.tier > 0 ? 'gain' : 'gold'} />
        <StatCard icon="trend" label="W realizacji" value={`${game.reno.projects.filter((p) => p.status === 'signed').length}`} hint="najwyżej 3 naraz" accent="sky" />
        <StatCard icon="briefcase" label="Ukończone kontrakty" value={`${refs.completedJobs}`} hint={`ocena ${stars(refs.avgRating10)}`} accent="gain" />
      </div>
      <Card title="Zapytania i projekty w toku">
        {active.length === 0 ? <Empty>Brak zapytań o większe projekty. Pojawiają się rzadko — częściej przy dobrych opiniach, ukończonych projektach i marketingu „współpraca z przedsiębiorcami”. Zobacz „Referencje firmy”, co odblokowuje kolejne poziomy.</Empty> : <div className="space-y-3">{active.map((p) => <ProjectCard key={p.id} p={p} />)}</div>}
      </Card>
      {past.length > 0 && <Card title="Historia">{<div className="space-y-3">{past.map((p) => <ProjectCard key={p.id} p={p} />)}</div>}</Card>}
      <Calibration />
    </div>
  );
}

/* ---------- 3. Pakiety robót ---------- */

const STAGE_TONE = { preparation: 'neutral', materials: 'gold', execution: 'sky', handover: 'sky', settlement: 'sky', done: 'gain', cancelled: 'loss' } as const;
const STAGE_NAME: Record<string, string> = { preparation: 'przygotowanie', materials: 'brak materiałów', execution: 'w realizacji', handover: 'odbiór', settlement: 'rozliczenie', done: 'odebrany', cancelled: 'anulowany' };

export function ProjectPackagesScreen() {
  const { game, biz } = useProjects();
  const run = useGameStore((s) => s.run);
  if (!biz) return <NoBusiness title="Pakiety robót" />;
  const projects = game.reno.projects.filter((p) => p.status === 'signed' || p.status === 'done' || p.status === 'cancelled');
  return (
    <div className="space-y-5">
      <ScreenHeader title="Pakiety robót" subtitle="Projekt → etapy → pakiety → zadania. Każdy pakiet ma kosztorys, materiały, wykonawców, termin, postęp, jakość i odbiór; pakiet rusza po odbiorze poprzedników." />
      {projects.length === 0 ? <Card><Empty>Brak podpisanych projektów. Pakiety pojawią się po podpisaniu umowy projektu w „Większe projekty”.</Empty></Card> : projects.map((p) => (
        <Card key={p.id} title={p.title} action={<Badge tone={STATUS_TONE[p.status]}>{PROJECT_STATUS_LABEL[p.status]}</Badge>}>
          <div className="space-y-4" data-testid={`packages-${p.id}`}>
            {STAGE_ORDER.map((stage) => {
              const pkgs = p.packages.filter((k) => k.stage === stage);
              if (pkgs.length === 0) return null;
              return (
                <div key={stage}>
                  <div className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Etap: {STAGE_LABEL[stage]}</div>
                  <div className="space-y-2">
                    {pkgs.map((k) => {
                      const job = k.jobId ? game.reno.jobs.find((j) => j.id === k.jobId) : undefined;
                      const f = job ? jobFinancials(job) : null;
                      const fc = job ? jobForecast(game, job) : null;
                      const deps = k.dependsOn.map((d) => p.packages.find((x) => x.id === d)?.label ?? d);
                      const shortage = job ? Object.keys(job.need).some((key) => (job.consumed[key]?.qty ?? 0) < job.need[key]!) : false;
                      return (
                        <div key={k.id} className="rounded-xl border border-ink-700 p-3 text-sm" data-testid={`package-${k.id}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-slate-100">{k.label} <span className="text-xs text-slate-500">· {k.units} {SERVICE_BY_ID.get(k.serviceId)!.unit}</span></div>
                            <Badge tone={job ? STAGE_TONE[job.stage] : 'neutral'}>{job ? STAGE_NAME[job.stage] : 'oczekuje na poprzedników'}</Badge>
                          </div>
                          <div className="mt-1 grid gap-x-6 gap-y-0.5 text-xs text-slate-400 sm:grid-cols-2">
                            <div>Cena: <Money value={k.priceNet} round /> netto</div>
                            <div>Zależy od: {deps.length ? deps.join(', ') : 'brak (start od razu)'}</div>
                            <div>Termin: {job ? `${formatDatePL(job.startDate)} → ${formatDatePL(job.deadline)}` : k.startDate ? `plan od ${formatDatePL(k.startDate)} (${k.durationDays} dni)` : '—'}</div>
                            <div>Wykonawcy: {k.crewKey === null ? 'właściciel' : k.crewKey.startsWith('sub:') ? 'podwykonawca' : 'ekipa'}</div>
                            {job && f && <div>Koszty rzeczywiste do tej pory: <Money value={f.externalCost} round /> · plan <Money value={job.planned.materials + job.planned.transport + job.planned.other + (job.planned.labor - job.planned.ownerLabor)} round /></div>}
                            {job && <div>Jakość: {job.quality === null ? 'po odbiorze' : `${job.quality}/100`} · opóźnienie: {job.lateDays} dni</div>}
                          </div>
                          {job && fc && job.stage !== 'done' && job.stage !== 'cancelled' && (
                            <div className="mt-2 space-y-1">
                              <div className="text-xs text-slate-400">Postęp {fc.progressPct}% {job.blockedReason && <span className="text-gold">· {job.blockedReason}</span>}</div>
                              <ProgressBar value={fc.progressPct} max={100} tone={fc.risk === 'wysokie' ? 'loss' : fc.risk === 'średnie' ? 'gold' : 'gain'} />
                            </div>
                          )}
                          <ul className="mt-2 flex flex-wrap gap-x-4 text-xs text-slate-500" aria-label="Zadania pakietu">
                            <li className={job && !shortage ? 'text-gain' : undefined}>{job && !shortage ? '✔' : '○'} materiały zakupione</li>
                            <li className={job && job.progressCenti >= job.normCenti ? 'text-gain' : undefined}>{job && job.progressCenti >= job.normCenti ? '✔' : '○'} wykonanie</li>
                            <li className={job?.stage === 'done' ? 'text-gain' : undefined}>{job?.stage === 'done' ? '✔' : '○'} odbiór i rozliczenie</li>
                          </ul>
                          {job && shortage && job.stage !== 'done' && job.stage !== 'cancelled' && <Button variant="secondary" className="mt-2 px-2.5 py-1 text-xs" onClick={() => run((g) => commands.buyMissingForJob(g, job.id))}>Kup brakujące materiały</Button>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}


/** Porównanie rentowności: mali klienci prywatni, większe remonty, kontrakty B2B i model mieszany (dane z ukończonych kontraktów). */
export function SegmentComparisonCard({ game }: { game: ReturnType<typeof useOpGame> }) {
  const seg = segmentComparison(game);
  const cell = (n: ReactNode) => <td className="py-2 text-right">{n}</td>;
  return (
    <Card title="Porównanie: małe zlecenia, większe remonty, B2B i model mieszany">
      {seg[3]!.contracts === 0 ? <Empty>Brak ukończonych kontraktów do porównania.</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm" data-testid="segment-comparison">
            <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><th className="pb-2 font-medium">Segment</th><th className="pb-2 text-right font-medium">Kontrakty</th><th className="pb-2 text-right font-medium">Śr. wartość</th><th className="pb-2 text-right font-medium">Koszty rzeczywiste</th><th className="pb-2 text-right font-medium">Nadwyżka</th><th className="pb-2 text-right font-medium">Marża</th><th className="pb-2 text-right font-medium">Zysk ekon.</th><th className="pb-2 text-right font-medium">Godz.</th><th className="pb-2 text-right font-medium">Nadw./godz.</th><th className="pb-2 text-right font-medium">Należności</th><th className="pb-2 text-right font-medium">Zwłoka</th><th className="pb-2 text-right font-medium">Opóźn.</th></tr></thead>
            <tbody className="divide-y divide-ink-700/60">
              {seg.map((x) => (
                <tr key={x.key} className={x.key === 'mixed' ? 'font-semibold' : undefined}>
                  <td className="py-2 text-slate-200">{SEGMENT_LABEL[x.key]}</td>
                  {cell(x.contracts)}{cell(<Money value={x.avgValueNet} round />)}{cell(<Money value={x.externalCost} round />)}{cell(<span className={moneyTone(x.surplusNet)}><Money value={x.surplusNet} round signed /></span>)}
                  {cell(`${pct(x.surplusMarginBps)}`)}{cell(<span className={moneyTone(x.economicProfit)}><Money value={x.economicProfit} round signed /></span>)}{cell(Math.round(x.hours))}
                  {cell(x.surplusPerHour === null ? '—' : <Money value={x.surplusPerHour} round />)}{cell(<Money value={x.openReceivables} round />)}{cell(`${x.avgPaymentDelay} dni`)}{cell(x.lateContracts)}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">Większy przychód nie zawsze oznacza większy zysk: B2B daje większe kontrakty, ale niższe ceny, dłuższe terminy płatności i kary za zwłokę. Zysk ekonomiczny = nadwyżka − kalkulacyjna wartość Twojej pracy (nie jest wypłatą).</p>
        </div>
      )}
    </Card>
  );
}

/* ---------- 4. Referencje firmy ---------- */

export function ProjectReferencesScreen() {
  const { game, biz } = useProjects();
  if (!biz) return <NoBusiness title="Referencje firmy" />;
  const refs = companyReferences(game);
  const done = game.reno.projects.filter((p) => p.status === 'done');
  return (
    <div className="space-y-5">
      <ScreenHeader title="Referencje firmy" subtitle="Doświadczenie firmy wynika wyłącznie z rzeczywiście wykonanych robót. Forma prawna (JDG albo sp. z o.o.) nie odblokowuje większych projektów — liczą się referencje i zdolność realizacyjna." />
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard icon="shield" label="Ukończone kontrakty" value={`${refs.completedJobs}`} hint={`wartość ${formatPLN(refs.completedValueNet, { round: true })} netto`} accent="gain" testId="ref-completed" />
        <StatCard icon="trend" label="Średnia ocena" value={stars(refs.avgRating10)} hint="ostatnie 12 kontraktów" accent="gold" />
        <StatCard icon="list" label="Terminowość" value={refs.onTimePct === null ? '—' : `${refs.onTimePct}%`} hint="kontrakty bez opóźnienia" accent="sky" />
        <StatCard icon="coins" label="Wykonawcy" value={`${refs.workers}`} hint="właściciel, pracownicy, sprawdzeni podwykonawcy" accent="sky" />
      </div>
      <Card title="Poziomy dostępu do projektów">
        <div className="grid gap-4 lg:grid-cols-3" data-testid="tier-ladder">
          {([1, 2, 3] as const).map((t) => {
            const checks = requirementChecks(refs, TIER_REQUIREMENTS[t]);
            const ok = checks.every((c) => c.ok);
            return (
              <div key={t} className="rounded-xl border border-ink-700 p-3">
                <div className="mb-1 flex items-center justify-between"><div className="font-semibold text-slate-100">Poziom {t}</div><Badge tone={ok ? 'gain' : 'neutral'}>{ok ? 'odblokowany' : 'zablokowany'}</Badge></div>
                <div className="mb-2 text-xs text-slate-400">{TIER_LABEL[t]}</div>
                <Checks checks={checks} />
              </div>
            );
          })}
        </div>
      </Card>
      <SegmentComparisonCard game={game} />
      <Card title="Historia ukończonych projektów">
        {done.length === 0 ? <Empty>Żaden projekt nie został jeszcze ukończony.</Empty> : (
          <ul className="space-y-2 text-sm" data-testid="project-history">
            {[...done].reverse().map((p) => (
              <li key={p.id} className="rounded-xl border border-ink-700 p-3"><div className="text-slate-100">{p.title} <Badge tone="sky">poziom {p.tier}</Badge></div><div className="text-xs text-slate-400">{p.clientName.split(' (')[0]} · zakończony {formatDatePL(p.finishedOn!)} · przychód <Money value={p.outcome!.revenueNet} round /> · nadwyżka <Money value={p.outcome!.surplusNet} round signed /> · opóźnienie {p.outcome!.lateDays} dni · ocena {stars(p.outcome!.avgRating10)} · {Math.round(diffDays(p.finishedOn!, p.signedOn!) )} dni realizacji</div></li>
            ))}
          </ul>
        )}
      </Card>
      <Calibration />
    </div>
  );
}
void zl;
