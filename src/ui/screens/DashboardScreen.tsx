import { useMemo, useState } from 'react';
import { addDays, formatDateShortPL, formatMonthPL } from '../../engine/date.ts';
import { categoryInfo } from '../../engine/categories.ts';
import { scheduledItems } from '../../engine/schedule.ts';
import { monthlySummaries, netWorthBreakdown, overdueObligations } from '../../engine/selectors.ts';
import { useGameStore } from '../../store/gameStore.ts';
import { BarChart, LineChart, ProgressBar, downsample } from '../components/charts.tsx';
import { Icon } from '../components/icons.tsx';
import { pendingLifeEvents } from '../../engine/lifeEvents.ts';
import { Badge, Button, Card, Empty, Money, Segmented, StatCard, ScreenHeader, moneyTone } from '../components/ui.tsx';

type Range = '30' | '90' | '365' | 'all';
type Series = 'netWorth' | 'cash' | 'savings';

export function DashboardScreen() {
  const game = useGameStore((s) => s.game)!;
  const navigate = useGameStore((s) => s.navigate);
  const [range, setRange] = useState<Range>('90');
  const [series, setSeries] = useState<Series>('netWorth');

  const nw = netWorthBreakdown(game);
  const summaries = useMemo(() => monthlySummaries(game), [game]);
  const current = summaries[summaries.length - 1]!;
  const completed = summaries.filter((m) => m.complete).slice(-12);
  const overdue = overdueObligations(game);
  const decisions = pendingLifeEvents(game).length + game.applications.filter((a) => a.status === 'offered').length;
  const upcoming = useMemo(
    () => scheduledItems(game, addDays(game.clock.today, 1), addDays(game.clock.today, 21)).filter((i) => i.kind !== 'issue').slice(0, 7),
    [game],
  );
  const recent = game.events.slice(-6).reverse();

  const points = useMemo(() => {
    const n = range === 'all' ? game.history.length : Number(range);
    const slice = game.history.slice(-n);
    return downsample(slice, 120).map((p) => ({ label: formatDateShortPL(p.date), value: series === 'netWorth' ? p.netWorth : series === 'cash' ? p.cash : p.savings }));
  }, [game.history, range, series]);

  const sinceStart = nw.netWorth - game.openingCash;

  return (
    <div className="space-y-5">
      <ScreenHeader title="Pulpit gracza" subtitle={`${game.person.firstName} ${game.person.lastName} · Olsztyn`} />

      {overdue.length > 0 && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-gold/40 bg-gold/10 p-4 text-sm text-gold">
          <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
          <div>
            <strong>Nieopłacone zobowiązania po terminie: {overdue.length}.</strong>{' '}
            Brakuje środków na rachunku — zostaną opłacone automatycznie, gdy pojawi się gotówka.
          </div>
        </div>
      )}

      {decisions > 0 && (
        <div role="status" data-testid="decisions-alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky/40 bg-sky/10 p-4 text-sm text-sky">
          <span>Czekają na Ciebie decyzje i propozycje: <strong>{decisions}</strong>.</span>
          <Button variant="secondary" onClick={() => navigate('decisions')}>Zobacz decyzje</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard testId="stat-cash" label="Gotówka" icon="wallet" accent="gain" value={<Money value={nw.cash} />} hint="rachunek bieżący" />
        <StatCard testId="stat-savings" label="Oszczędności" icon="coins" accent="violet" value={<Money value={nw.savings} />} hint="konto oszczędnościowe" />
        <StatCard
          testId="stat-networth"
          label="Majątek netto"
          icon="trend"
          accent="sky"
          value={<Money value={nw.netWorth} />}
          hint={<span className={moneyTone(sinceStart)}>{sinceStart >= 0 ? '▲' : '▼'} <Money value={Math.abs(sinceStart)} /> od startu{nw.deposits > 0 && <span className="text-slate-500"> · w tym kaucje <Money value={nw.deposits} round /></span>}</span>}
        />
        <StatCard testId="stat-receivables" label="Należności" icon="briefcase" accent="gold" value={<Money value={nw.receivables} />} hint="naliczone, jeszcze niewypłacone" />
        <StatCard testId="stat-payables" label="Zobowiązania" icon="home" accent="loss" value={<Money value={nw.payables} />} hint="naliczone, jeszcze nieopłacone" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card
            title="Majątek w czasie"
            action={
              <div className="flex flex-wrap gap-2">
                <Segmented label="Seria" value={series} onChange={setSeries} options={[{ value: 'netWorth', label: 'Majątek netto' }, { value: 'cash', label: 'Gotówka' }, { value: 'savings', label: 'Oszczędności' }]} />
                <Segmented label="Zakres" value={range} onChange={setRange} options={[{ value: '30', label: '30 dni' }, { value: '90', label: '90 dni' }, { value: '365', label: 'Rok' }, { value: 'all', label: 'Całość' }]} />
              </div>
            }
          >
            <LineChart points={points} color={series === 'netWorth' ? '#38bdf8' : series === 'cash' ? '#34d399' : '#a78bfa'} ariaLabel={series === 'netWorth' ? 'Wykres majątku netto' : series === 'cash' ? 'Wykres gotówki' : 'Wykres oszczędności'} />
          </Card>

          <Card title={`Bieżący miesiąc — ${formatMonthPL(current.month)}`}>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <div className="text-xs text-slate-400">Naliczone przychody</div>
                <div className="text-lg font-semibold text-gain"><Money value={current.income} /></div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Naliczone koszty</div>
                <div className="text-lg font-semibold text-loss"><Money value={current.expenses} /></div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Przepływ gotówki</div>
                <div className={`text-lg font-semibold ${moneyTone(current.cashIn - current.cashOut)}`}><Money value={current.cashIn - current.cashOut} signed /></div>
                <div className="text-xs text-slate-500">wpływy <Money value={current.cashIn} /> · wydatki <Money value={current.cashOut} /></div>
              </div>
            </div>
            {current.income > 0 && (
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-xs text-slate-400"><span>Koszty / przychody</span><span className="tabular">{Math.round((current.expenses / current.income) * 100)}%</span></div>
                <ProgressBar value={current.expenses} max={current.income} tone={current.expenses > current.income ? 'loss' : 'gain'} />
              </div>
            )}
            <p className="mt-3 text-xs text-slate-500">Przychód jest naliczany w dniu zasługi (pensja — ostatniego dnia miesiąca), a gotówka wpływa później. Dlatego przychody i wpływy gotówki to nie to samo.</p>
          </Card>

          <Card title="Przychody i koszty — zakończone miesiące">
            {completed.length === 0 ? (
              <Empty>Wykres pojawi się po zakończeniu pierwszego miesiąca gry.</Empty>
            ) : (
              <BarChart
                groups={completed.map((m) => ({ label: m.month.slice(5) + '/' + m.month.slice(2, 4), a: m.income, b: m.expenses }))}
                aLabel="Przychody"
                bLabel="Koszty"
                ariaLabel="Wykres przychodów i kosztów w zakończonych miesiącach"
              />
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Najbliższe płatności" action={<button type="button" className="text-xs text-sky hover:underline" onClick={() => navigate('calendar')}>Kalendarz →</button>}>
            {upcoming.length === 0 ? (
              <Empty>Brak zaplanowanych zdarzeń.</Empty>
            ) : (
              <ul className="divide-y divide-ink-700/70" data-testid="upcoming">
                {upcoming.map((i, idx) => (
                  <li key={`${i.date}-${i.ruleId}-${i.kind}-${idx}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <div className="truncate text-slate-100">{i.title}</div>
                      <div className="text-xs text-slate-400">{formatDateShortPL(i.date)}{i.kind === 'birthday' ? ' · urodziny' : ''}</div>
                    </div>
                    {i.amount !== null && (
                      <div className={`shrink-0 font-medium ${moneyTone(i.amount)}`}>
                        {i.approximate && <span className="mr-0.5 text-slate-500">~</span>}
                        <Money value={i.amount} signed />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Ostatnie zdarzenia" action={<button type="button" className="text-xs text-sky hover:underline" onClick={() => navigate('events')}>Wszystkie →</button>}>
            <ul className="space-y-3" data-testid="recent-events">
              {recent.map((e) => (
                <li key={e.id} className="flex gap-3 text-sm">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: e.tone === 'positive' ? '#34d399' : e.tone === 'negative' ? '#fb7185' : e.tone === 'warning' ? '#fbbf24' : '#64748b' }} />
                  <div className="min-w-0">
                    <div className="text-slate-200">{e.title}</div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      {formatDateShortPL(e.date)}
                      {e.category && <Badge>{categoryInfo(e.category).label}</Badge>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
