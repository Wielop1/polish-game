import { CITIES, PLACEHOLDER_NOTICE, SKILL_LABELS, LIFESTYLE_LABELS } from '../../engine/config.ts';
import { currentEmployment, currentLease, employmentContracts, leaseContracts } from '../../engine/contracts.ts';
import { qualityOfLife } from '../../engine/selectors.ts';
import { fatigueLabel } from '../../engine/time.ts';
import type { Skill } from '../../engine/state.ts';
import { ProgressBar } from '../components/charts.tsx';
import { diffDays, formatDatePL } from '../../engine/date.ts';
import { playerAge } from '../../engine/selectors.ts';
import { useGameStore } from '../../store/gameStore.ts';
import { Badge, Card, Money, PlaceholderBadge, ScreenHeader } from '../components/ui.tsx';

export function CharacterScreen() {
  const game = useGameStore((s) => s.game)!;
  const { person } = game;
  const age = playerAge(game);
  const city = CITIES[person.cityId]?.name ?? person.cityId;
  const employment = currentEmployment(game) ?? employmentContracts(game).sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  const lease = currentLease(game) ?? leaseContracts(game).sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  const qol = qualityOfLife(game);
  const employer = employment && game.parties[employment.partyId];
  const landlord = lease && game.parties[lease.partyId];
  const dayLabel = (d: number | 'last') => (d === 'last' ? 'ostatniego dnia miesiąca' : `${d}. dnia miesiąca`);
  const salaryRule = game.rules.find((r) => r.kind === 'obligation' && r.id === 'rule:salary');
  const rentRule = game.rules.find((r) => r.kind === 'obligation' && r.id === 'rule:rent');
  const initials = `${person.firstName[0] ?? ''}${person.lastName[0] ?? ''}`.toUpperCase();

  return (
    <div className="space-y-5">
      <ScreenHeader title="Postać" subtitle="Dane osoby fizycznej — odrębnej od jakichkolwiek firm, które założysz w przyszłości." />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="grid size-24 place-items-center rounded-full bg-linear-to-br from-sky via-violet to-gain text-3xl font-extrabold text-ink-950 shadow-xl shadow-sky/20 ring-4 ring-ink-700">{initials}</div>
            <div>
              <div data-testid="character-name" className="text-xl font-bold text-white">{person.firstName} {person.lastName}</div>
              <div className="text-sm text-slate-400">{age} lata · {city}</div>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Badge tone="sky">osoba fizyczna</Badge>
              <Badge tone={currentEmployment(game) ? 'gain' : 'loss'}>{currentEmployment(game) ? 'zatrudniony na etacie' : 'bez pracy'}</Badge>
            </div>
          </div>
          <dl className="mt-6 space-y-3 border-t border-ink-700 pt-4 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-slate-400">Data urodzenia</dt><dd className="text-slate-100">{formatDatePL(person.birthDate)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-400">Miasto</dt><dd className="text-slate-100">{city}, woj. {CITIES[person.cityId]?.voivodeship}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-400">Start gry</dt><dd className="text-slate-100">{formatDatePL(game.clock.startDate)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-400">Dni w grze</dt><dd className="text-slate-100 tabular">{diffDays(game.clock.today, game.clock.startDate)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-400">Seed</dt><dd className="font-mono text-xs text-slate-300">{game.seed}</dd></div>
          </dl>
        </Card>

        <div className="space-y-5 lg:col-span-2">
          <Card title="Kondycja i umiejętności">
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-3">
                <div>
                  <div className="mb-1 flex justify-between text-sm"><span className="text-slate-300">Zmęczenie</span><span className="tabular text-slate-100">{game.life.fatigue}/100 · {fatigueLabel(game.life.fatigue)}</span></div>
                  <ProgressBar value={game.life.fatigue} max={100} tone={game.life.fatigue < 30 ? 'gain' : game.life.fatigue < 60 ? 'gold' : 'loss'} />
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-sm"><span className="text-slate-300">Jakość życia</span><span className="tabular text-slate-100">{qol.score}/100</span></div>
                  <ProgressBar value={qol.score} max={100} tone={qol.score < 35 ? 'loss' : qol.score < 60 ? 'gold' : 'gain'} />
                </div>
                <div className="text-sm text-slate-400">Styl życia: <strong className="text-slate-200">{LIFESTYLE_LABELS[game.life.lifestyle]}</strong></div>
              </div>
              <ul className="space-y-2.5" data-testid="skills">
                {(Object.keys(SKILL_LABELS) as Skill[]).map((k) => (
                  <li key={k}>
                    <div className="mb-1 flex justify-between text-sm"><span className="text-slate-300">{SKILL_LABELS[k]}</span><span className="tabular text-slate-100">{game.life.skills[k] ?? 0}/5</span></div>
                    <ProgressBar value={game.life.skills[k] ?? 0} max={5} tone="gain" />
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          {employment && (
            <Card title="Praca" action={<PlaceholderBadge />}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-lg font-semibold text-slate-50">{employment.title}</div>
                  <div className="text-sm text-slate-400">{employer?.name} · od {formatDatePL(employment.startDate)}{employment.endDate ? ` · do ${formatDatePL(employment.endDate)}` : ''}</div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-semibold text-gain"><Money value={employment.monthlyAmount} /></div>
                  <div className="text-xs text-slate-400">netto / mies. (szacunek){employment.grossMonthly ? <> · brutto <Money value={employment.grossMonthly} round /></> : ''}</div>
                </div>
              </div>
              <p className="mt-3 text-sm text-slate-400">
                {salaryRule?.kind === 'obligation'
                  ? `Wynagrodzenie jest naliczane ${dayLabel(salaryRule.issueDay)}, a wypłacane ${dayLabel(salaryRule.due.day)} ${salaryRule.due.monthOffset > 0 ? 'następnego miesiąca' : 'tego samego miesiąca'}.`
                  : ''}{' '}
                Model nie zawiera jeszcze podatków i składek (kwota netto).
              </p>
            </Card>
          )}

          {lease && (
            <Card title="Mieszkanie" action={<PlaceholderBadge />}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-lg font-semibold text-slate-50">{lease.title}</div>
                  <div className="text-sm text-slate-400">{landlord?.name} · umowa od {formatDatePL(lease.startDate)}{lease.endDate ? ` do ${formatDatePL(lease.endDate)}` : ''}</div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-semibold text-loss"><Money value={lease.monthlyAmount} /></div>
                  <div className="text-xs text-slate-400">czynsz / miesiąc{lease.utilitiesMonthly > 0 && <> + opłaty <Money value={lease.utilitiesMonthly} round /></>}</div>
                </div>
              </div>
              <p className="mt-3 text-sm text-slate-400">
                {rentRule?.kind === 'obligation' ? `Czynsz jest naliczany ${dayLabel(rentRule.issueDay)}, termin płatności — ${dayLabel(rentRule.due.day)}.` : ''}
              </p>
            </Card>
          )}

          <Card title="Miesięczne koszty życia" action={<PlaceholderBadge />}>
            <ul className="divide-y divide-ink-700/70 text-sm">
              {game.rules
                .filter((r) => r.kind === 'obligation' && r.direction === 'payable')
                .map((r) =>
                  r.kind === 'obligation' ? (
                    <li key={r.id} className="flex items-center justify-between py-2">
                      <span className="text-slate-200">{r.description}</span>
                      <span className="text-slate-300 tabular">
                        {r.amount.type === 'fixed' && <Money value={r.amount.amount} />}
                        {r.amount.type === 'variable' && <>~<Money value={r.amount.base} /> <span className="text-xs text-slate-500">±{r.amount.spreadBps / 100}%</span></>}
                        {r.amount.type === 'contract' && <Money value={game.contracts.find((c) => c.id === (r.amount as { contractId: string }).contractId)?.monthlyAmount ?? 0} />}
                      </span>
                    </li>
                  ) : null,
                )}
            </ul>
          </Card>
          <p className="text-xs text-slate-500">{PLACEHOLDER_NOTICE}</p>
        </div>
      </div>
    </div>
  );
}
