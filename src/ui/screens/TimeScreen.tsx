import { useState } from 'react';
import { TIME } from '../../engine/config.ts';
import { addDays, formatDatePL, weekdayIndex } from '../../engine/date.ts';
import { fatigueLabel, performanceBps, validatePlan, weeklyHours, budgetFor } from '../../engine/time.ts';
import type { DayBudget } from '../../engine/time.ts';
import { useGameStore } from '../../store/gameStore.ts';
import { ProgressBar } from '../components/charts.tsx';
import { Badge, Button, Card, Empty, ScreenHeader, cx } from '../components/ui.tsx';

const PARTS: { key: keyof Pick<DayBudget, 'work' | 'sleep' | 'duties' | 'business' | 'commitments' | 'free'>; label: string; color: string }[] = [
  { key: 'work', label: 'Praca', color: '#38bdf8' },
  { key: 'sleep', label: 'Sen', color: '#a78bfa' },
  { key: 'duties', label: 'Podstawowe obowiązki', color: '#94a3b8' },
  { key: 'business', label: 'Przyszła działalność', color: '#fbbf24' },
  { key: 'commitments', label: 'Kursy i zlecenia', color: '#f472b6' },
  { key: 'free', label: 'Czas wolny', color: '#34d399' },
];

function DayBar({ title, date, b }: { title: string; date: string; b: DayBudget }) {
  return (
    <div data-testid={`day-${b.workday ? 'work' : 'weekend'}`}>
      <div className="mb-2 flex items-baseline justify-between"><h3 className="text-sm font-semibold text-slate-200">{title}</h3><span className="text-xs text-slate-500">{formatDatePL(date)}</span></div>
      <div className="flex h-7 overflow-hidden rounded-lg bg-ink-700" role="img" aria-label={`${title}: ${PARTS.map((p) => `${p.label} ${Math.max(0, b[p.key])} godz.`).join(', ')}`}>
        {PARTS.map((p) => (b[p.key] > 0 ? <div key={p.key} style={{ width: `${(b[p.key] / 24) * 100}%`, background: p.color }} title={`${p.label}: ${b[p.key]} godz.`} /> : null))}
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        {PARTS.map((p) => (
          <li key={p.key} className="flex items-center justify-between gap-2 text-slate-400"><span className="flex items-center gap-1.5"><i className="size-2 rounded-sm" style={{ background: p.color }} />{p.label}</span><span className="tabular whitespace-nowrap text-slate-200">{b[p.key]} h</span></li>
        ))}
      </ul>
      {b.free < 0 && <p role="alert" className="mt-1 text-xs text-loss">Przekroczono 24 godziny o {-b.free}.</p>}
    </div>
  );
}

function nextWeekday(from: string, wantWork: boolean): string {
  let d = from;
  while ((weekdayIndex(d) < 5) !== wantWork) d = addDays(d, 1);
  return d;
}

export function TimeScreen() {
  const game = useGameStore((s) => s.game)!;
  const setTimePlan = useGameStore((s) => s.setTimePlan);
  const saved = game.life.timePlan;
  const [sleep, setSleep] = useState(saved.sleepHours);
  const [business, setBusiness] = useState(saved.businessHours);
  const plan = { sleepHours: sleep, businessHours: business };
  const error = validatePlan(game, plan);
  const changed = sleep !== saved.sleepHours || business !== saved.businessHours;

  const workDate = nextWeekday(game.clock.today, true);
  const weekendDate = nextWeekday(game.clock.today, false);
  const workBudget = budgetFor(game, workDate, { plan });
  const weekendBudget = budgetFor(game, weekendDate, { plan });
  const week = weeklyHours(game);
  const fatigue = game.life.fatigue;
  const perf = performanceBps(fatigue);
  const upcoming = game.commitments.filter((c) => c.endDate >= game.clock.today);

  return (
    <div className="space-y-5">
      <ScreenHeader title="Budżet czasu" subtitle="Doba ma 24 godziny. Czas wolny to to, co zostaje — tych samych godzin nie da się przeznaczyć na dwie rzeczy." />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Plan dnia">
          <div className="space-y-5">
            <div>
              <label htmlFor="sleep" className="mb-1 flex justify-between text-sm font-medium text-slate-200"><span>Sen</span><span className="tabular text-sky">{sleep} godz.</span></label>
              <input id="sleep" type="range" min={TIME.sleepMin} max={TIME.sleepMax} value={sleep} onChange={(e) => setSleep(Number(e.target.value))} className="w-full accent-sky" />
              <div className="flex justify-between text-xs text-slate-500"><span>{TIME.sleepMin}</span><span>{TIME.sleepMax}</span></div>
            </div>
            <div>
              <label htmlFor="business" className="mb-1 flex justify-between text-sm font-medium text-slate-200"><span>Przyszła działalność (rezerwa)</span><span className="tabular text-gold">{business} godz.</span></label>
              <input id="business" type="range" min={0} max={TIME.businessMax} value={business} onChange={(e) => setBusiness(Number(e.target.value))} className="w-full accent-amber-400" />
              <p className="mt-1 text-xs text-slate-500">Zarezerwowane na własną firmę (dostępna w późniejszych wersjach). Na razie godziny tylko zabierają czas wolny i męczą.</p>
            </div>
            <div className="rounded-xl border border-ink-700 bg-ink-900/50 p-3 text-xs text-slate-400">
              Stałe: praca według umowy (dni robocze), podstawowe obowiązki {TIME.dutiesHours} godz. dziennie{' '}+ {TIME.commuteHours} godz. dojazdu w dni robocze przy zatrudnieniu.
            </div>
            {error && <p role="alert" className="text-sm text-loss" data-testid="plan-error">{error}</p>}
            <div className="flex gap-2">
              <Button variant="primary" disabled={!!error || !changed} onClick={() => setTimePlan(plan)} data-testid="save-plan">Zapisz plan dnia</Button>
              <Button variant="secondary" disabled={!changed} onClick={() => { setSleep(saved.sleepHours); setBusiness(saved.businessHours); }}>Cofnij</Button>
            </div>
          </div>
        </Card>

        <Card title="Kondycja i wydajność">
          <div className="space-y-4">
            <div>
              <div className="mb-1 flex items-center justify-between text-sm"><span className="text-slate-300">Zmęczenie</span><span className="flex items-center gap-2"><Badge tone={fatigue < 30 ? 'gain' : fatigue < 60 ? 'gold' : 'loss'}>{fatigueLabel(fatigue)}</Badge><span data-testid="fatigue" className="tabular text-slate-100">{fatigue}/100</span></span></div>
              <ProgressBar value={fatigue} max={100} tone={fatigue < 30 ? 'gain' : fatigue < 60 ? 'gold' : 'loss'} />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-sm"><span className="text-slate-300">Wydajność w pracy</span><span data-testid="performance" className="tabular text-slate-100">{Math.round(perf / 100)}%</span></div>
              <ProgressBar value={perf} max={10_000} tone={perf > 8_000 ? 'gain' : perf > 6_000 ? 'gold' : 'loss'} />
            </div>
            <p className="text-xs leading-relaxed text-slate-500">
              Zmęczenie rośnie od krótkiego snu, bardzo długiego dnia i braku czasu wolnego, a maleje w weekendy i przy dłuższym odpoczynku. Niska wydajność zmniejsza szanse na premię i awans, zwiększa ryzyko utraty pracy i pogarsza wynik rozmów kwalifikacyjnych.
            </p>
          </div>
        </Card>
      </div>

      <Card title={changed ? 'Podgląd budżetu dla zmienionego planu' : 'Budżet dnia'}>
        <div className="grid gap-6 lg:grid-cols-2">
          <DayBar title="Dzień roboczy" date={workDate} b={workBudget} />
          <DayBar title="Weekend" date={weekendDate} b={weekendBudget} />
        </div>
        <div className="mt-5 border-t border-ink-700 pt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-200">Bieżący tydzień (zapisany plan): {Object.values(week).reduce((a, b) => a + b, 0)} godz.</h3>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-6">
            {PARTS.map((p) => <div key={p.key}><div className="text-xs text-slate-500">{p.label}</div><div className={cx('tabular font-semibold', p.key === 'free' ? 'text-gain' : 'text-slate-100')}>{week[p.key]} h</div></div>)}
          </div>
        </div>
      </Card>

      <Card title="Zobowiązania czasowe (kursy, zlecenia)">
        {upcoming.length === 0 ? <Empty>Brak. Pojawią się po przyjęciu kursu lub dorywczego zlecenia z ekranu „Decyzje”.</Empty> : (
          <ul className="divide-y divide-ink-700/70 text-sm">
            {upcoming.map((c) => <li key={c.id} className="flex flex-wrap justify-between gap-2 py-2"><span className="text-slate-100">{c.label}</span><span className="text-slate-400">{formatDatePL(c.startDate)} – {formatDatePL(c.endDate)} · {c.hoursPerDay} godz. dziennie</span></li>)}
          </ul>
        )}
      </Card>
    </div>
  );
}
