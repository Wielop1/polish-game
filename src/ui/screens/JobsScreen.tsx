import { JOB_CATALOG, PAYROLL_NOTICE } from '../../engine/config.ts';
import { typicalMonthlyNet } from '../../engine/payroll.ts';
import type { JobOffer } from '../../engine/config.ts';
import { companyTenureDays, currentEmployment, employmentStatus, positionTenureDays, upcomingEmployment } from '../../engine/contracts.ts';
import { CLIMATE_LABEL, layoffRisk } from '../../engine/labor.ts';
import { formatDatePL } from '../../engine/date.ts';
import { applicationBlocker, applicationChanceBps, chanceLabel, employmentHistory, noticeEndDate, offerById, skillGaps, startDateForNewJob } from '../../engine/jobs.ts';
import { workHoursPerWorkday } from '../../engine/time.ts';
import { useGameStore } from '../../store/gameStore.ts';
import { Badge, Button, Card, Empty, Money, ScreenHeader, cx } from '../components/ui.tsx';

const STATUS_LABEL = { employed: 'zatrudniony', notice: 'okres wypowiedzenia', unemployed: 'bez pracy' } as const;
const APP_STATUS: Record<string, { label: string; tone: 'neutral' | 'gain' | 'loss' | 'gold' | 'sky' }> = {
  pending: { label: 'w rozpatrywaniu', tone: 'sky' },
  offered: { label: 'propozycja pracy', tone: 'gain' },
  rejected: { label: 'odmowa', tone: 'loss' },
  accepted: { label: 'przyjęta', tone: 'gain' },
  declined: { label: 'odrzucona przez Ciebie', tone: 'neutral' },
  expired: { label: 'wygasła', tone: 'gold' },
};

function OfferCard({ offer }: { offer: JobOffer }) {
  const game = useGameStore((s) => s.game)!;
  const apply = useGameStore((s) => s.applyForJob);
  const blocker = applicationBlocker(game, offer.id);
  const gaps = skillGaps(game, offer);
  const chance = chanceLabel(applicationChanceBps(game, offer));
  const net = typicalMonthlyNet(offer.grossMonthly, game.person.birthDate, game.clock.today);
  const hoursPerDay = workHoursPerWorkday(offer.hoursPerMonth);
  return (
    <div data-testid={`offer-${offer.id}`} className="rounded-xl border border-ink-700 bg-ink-900/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-50">{offer.title}</h3>
          <div className="text-sm text-slate-400">{offer.employerName} · {offer.location}</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold text-gain"><Money value={offer.grossMonthly} round /> <span className="text-xs font-normal text-slate-400">brutto</span></div>
          <div className="text-xs text-slate-400">netto ≈ <Money value={net} round /> (kalkulator)</div>
        </div>
      </div>
      <p className="mt-2 text-sm text-slate-300">{offer.description}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400 sm:grid-cols-4">
        <div><dt className="text-slate-500">Forma</dt><dd className="text-slate-200">umowa o pracę</dd></div>
        <div><dt className="text-slate-500">Wymiar</dt><dd className="text-slate-200">{offer.hoursPerMonth} godz./mies. (~{hoursPerDay} godz./dzień)</dd></div>
        <div><dt className="text-slate-500">Wypowiedzenie</dt><dd className="text-slate-200">{offer.noticeMonths} mies.</dd></div>
        <div><dt className="text-slate-500">Szansa</dt><dd className={cx('font-medium', chance === 'brak szans' ? 'text-loss' : chance === 'niska' ? 'text-gold' : 'text-gain')}>{chance}</dd></div>
      </dl>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {gaps.map((g) => (
            <Badge key={g.skill} tone={g.have >= g.required ? 'gain' : 'loss'} title={`Masz ${g.have}, wymagane ${g.required}`}>
              {g.label} {g.have}/{g.required}
            </Badge>
          ))}
        </div>
        <Button variant="primary" disabled={blocker !== null} title={blocker ?? undefined} onClick={() => apply(offer.id)} data-testid={`apply-${offer.id}`}>
          Aplikuj
        </Button>
      </div>
      {blocker && <p className="mt-2 text-xs text-slate-500">{blocker}</p>}
    </div>
  );
}

function tenureLabel(days: number): string {
  if (days < 31) return `${days} dni`;
  const months = Math.floor(days / 30.4);
  return months < 24 ? `${months} mies.` : `${Math.floor(months / 12)} lat ${months % 12} mies.`;
}

function RiskLine() {
  const game = useGameStore((s) => s.game)!;
  const risk = layoffRisk(game);
  const level = risk.totalBps === 0 ? 'niskie' : risk.totalBps < 100 ? 'podwyższone' : 'wysokie';
  return (
    <div data-testid="layoff-risk" className="mt-2 text-xs text-slate-400">
      Ryzyko utraty pracy: <strong className={risk.totalBps === 0 ? 'text-gain' : risk.totalBps < 100 ? 'text-gold' : 'text-loss'}>{level}</strong>
      {' '}· koniunktura: {CLIMATE_LABEL[risk.climate]}
      {risk.factors.length > 0 ? <> · czynniki: {risk.factors.map((f) => f.label).join('; ')}</> : <> · brak czynników ryzyka</>}
    </div>
  );
}

export function JobsScreen() {
  const game = useGameStore((s) => s.game)!;
  const respond = useGameStore((s) => s.respondToJobOffer);
  const resign = useGameStore((s) => s.resignFromJob);
  const today = game.clock.today;
  const status = employmentStatus(game);
  const cur = currentEmployment(game);
  const next = upcomingEmployment(game);
  const history = employmentHistory(game);
  const applications = [...game.applications].sort((a, b) => b.appliedOn.localeCompare(a.appliedOn));

  const confirmResign = () => {
    if (!cur) return;
    const end = noticeEndDate(today, cur.noticeMonths);
    if (window.confirm(`Złożyć wypowiedzenie? Pracujesz i dostajesz pensję do ${formatDatePL(end)}, potem tracisz dochód (jeśli nie masz nowej umowy).`)) resign();
  };

  return (
    <div className="space-y-5">
      <ScreenHeader title="Oferty pracy" subtitle="Tylko umowa o pracę (inne formy zatrudnienia — w kolejnych wersjach). Oferty są fikcyjne." />

      <Card title="Twoje zatrudnienie" action={<Badge tone={status === 'employed' ? 'gain' : status === 'notice' ? 'gold' : 'loss'}>{STATUS_LABEL[status]}</Badge>}>
        {cur ? (
          <div data-testid="current-job" className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-lg font-semibold text-slate-50">{cur.title}</div>
              <div className="text-sm text-slate-400">{game.parties[cur.partyId]?.name} · {cur.location} · od {formatDatePL(cur.startDate)}</div>
              <div className="mt-1 text-xs text-slate-500">{cur.hoursPerMonth} godz./mies. · wypowiedzenie {cur.noticeMonths} mies. · umowa o pracę</div>
              <div data-testid="tenure" className="mt-1 text-xs text-slate-500">staż w firmie {tenureLabel(companyTenureDays(game, cur))} · na stanowisku {tenureLabel(positionTenureDays(cur, today))}</div>
              {cur.endDate === null && <RiskLine />}
              {cur.endDate && <div className="mt-2 text-sm text-gold">Umowa kończy się {formatDatePL(cur.endDate)} ({cur.terminatedBy === 'employer' ? 'wypowiedział pracodawca' : 'Twoje wypowiedzenie'}).</div>}
            </div>
            <div className="text-right">
              <div className="text-xl font-semibold text-gain"><Money value={cur.monthlyAmount} /></div>
              <div className="text-xs text-slate-400">netto/mies. (kalkulator){cur.grossMonthly ? <> · brutto <Money value={cur.grossMonthly} round /></> : ' · brutto: brak danych'}</div>
              {cur.endDate === null && !next && <Button variant="danger" className="mt-3" onClick={confirmResign} data-testid="resign">Zrezygnuj z pracy</Button>}
            </div>
          </div>
        ) : (
          <Empty>Nie masz obecnie pracy — brak wpływów pensji. Aplikuj na oferty poniżej (odpowiedź przychodzi po kilku dniach).</Empty>
        )}
        {next && (
          <div data-testid="upcoming-job" className="mt-4 rounded-xl border border-sky/30 bg-sky/5 p-3 text-sm">
            <strong className="text-sky">Nowa umowa od {formatDatePL(next.startDate)}:</strong> {next.title}, {game.parties[next.partyId]?.name} · netto ≈ <Money value={next.monthlyAmount} /> (kalkulator)
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">{PAYROLL_NOTICE}</p>
      </Card>

      {applications.length > 0 && (
        <Card title="Aplikacje i propozycje">
          <ul className="space-y-3" data-testid="applications">
            {applications.map((a) => {
              const offer = offerById(a.offerId);
              const st = APP_STATUS[a.status]!;
              return (
                <li key={a.id} className="rounded-xl border border-ink-700 bg-ink-900/50 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-100">{offer?.title ?? a.offerId}</div>
                      <div className="text-xs text-slate-400">
                        {offer?.employerName} · aplikacja {formatDatePL(a.appliedOn)}
                        {a.status === 'pending' && ` · odpowiedź do ${formatDatePL(a.decisionOn)}`}
                        {a.status === 'offered' && a.offerExpiresOn && ` · odpowiedz do ${formatDatePL(a.offerExpiresOn)}`}
                        {a.status === 'accepted' && a.startDate && ` · start ${formatDatePL(a.startDate)}`}
                      </div>
                    </div>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                  {a.status === 'offered' && offer && (
                    <div className="mt-3 space-y-2">
                      <p className="text-sm text-slate-300">
                        Netto ≈ <Money value={typicalMonthlyNet(offer.grossMonthly, game.person.birthDate, today)} /> (kalkulator 2026), start <strong>{formatDatePL(startDateForNewJob(game))}</strong>.
                        {cur && cur.endDate === null && <> Przyjęcie oznacza <strong>wypowiedzenie obecnej umowy</strong> (pracujesz do {formatDatePL(noticeEndDate(today, cur.noticeMonths))}).</>}
                      </p>
                      <div className="flex gap-2">
                        <Button variant="primary" onClick={() => respond(a.id, true)} data-testid={`accept-${a.id}`}>Przyjmij i podpisz umowę</Button>
                        <Button variant="secondary" onClick={() => respond(a.id, false)}>Odrzuć</Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card title={`Dostępne oferty (${JOB_CATALOG.length})`}>
        <div className="grid gap-3 lg:grid-cols-2" data-testid="offers">
          {JOB_CATALOG.map((o) => <OfferCard key={o.id} offer={o} />)}
        </div>
      </Card>

      {history.length > 0 && (
        <Card title="Historia zatrudnienia">
          <ul className="divide-y divide-ink-700/70 text-sm">
            {history.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-slate-200">{c.title} · <span className="text-slate-400">{game.parties[c.partyId]?.name}</span></span>
                <span className="text-slate-400">{formatDatePL(c.startDate)} → {c.endDate ? formatDatePL(c.endDate) : 'obecnie'} · <Money value={c.monthlyAmount} round /> netto</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
