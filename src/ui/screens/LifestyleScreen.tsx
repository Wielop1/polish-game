import { LIFESTYLE_LABELS, LIFESTYLE_QOL } from '../../engine/config.ts';
import { monthlyCostEstimate, qualityOfLife } from '../../engine/selectors.ts';
import type { Lifestyle, ObligationRule } from '../../engine/state.ts';
import { useGameStore } from '../../store/gameStore.ts';
import { ProgressBar } from '../components/charts.tsx';
import { Badge, Button, Card, Money, PlaceholderBadge, ScreenHeader, cx } from '../components/ui.tsx';

const LEVELS: Lifestyle[] = ['oszczedny', 'standardowy', 'komfortowy'];
const DESCRIPTION: Record<Lifestyle, string> = {
  oszczedny: 'Gotowanie w domu, komunikacja publiczna, minimum rozrywek. Najniższe koszty, ale też niższy komfort na co dzień.',
  standardowy: 'Zbilansowane wydatki: normalne zakupy, okazjonalne wyjścia i wygodny dojazd.',
  komfortowy: 'Droższa żywność, częste wyjścia i wygodny transport. Wysokie koszty miesięczne — wymagają stabilnych dochodów.',
};

export function LifestyleScreen() {
  const game = useGameStore((s) => s.game)!;
  const setLifestyle = useGameStore((s) => s.setLifestyle);
  const current = game.life.lifestyle;
  const qol = qualityOfLife(game);
  const rules = game.rules.filter((r): r is ObligationRule => r.kind === 'obligation' && r.amount.type === 'lifestyle');
  const monthly = (level: Lifestyle) => rules.reduce((a, r) => a + (r.amount.type === 'lifestyle' ? r.amount.levels[level] : 0), 0);

  return (
    <div className="space-y-5">
      <ScreenHeader title="Styl życia" subtitle="Poziom codziennych wydatków. Koszty są księgowane jak każde inne zobowiązanie, od najbliższego naliczenia." />

      <div className="grid gap-4 lg:grid-cols-3">
        {LEVELS.map((level) => {
          const active = level === current;
          return (
            <section key={level} data-testid={`lifestyle-${level}`} className={cx('rounded-2xl border p-5', active ? 'border-gain/60 bg-gain/5' : 'border-ink-700/70 bg-ink-800/70')}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-50">{LIFESTYLE_LABELS[level]}</h2>
                {active && <Badge tone="gain">aktualny</Badge>}
              </div>
              <p className="mt-2 min-h-16 text-sm text-slate-300">{DESCRIPTION[level]}</p>
              <dl className="mt-3 divide-y divide-ink-700/60 text-sm">
                {rules.map((r) => (
                  <div key={r.id} className="flex justify-between py-1.5"><dt className="text-slate-400">{r.description}</dt><dd className="tabular text-slate-100"><Money value={r.amount.type === 'lifestyle' ? r.amount.levels[level] : 0} round /></dd></div>
                ))}
                <div className="flex justify-between py-1.5 font-semibold"><dt className="text-slate-200">Razem miesięcznie</dt><dd className="tabular text-loss"><Money value={monthly(level)} round /></dd></div>
              </dl>
              <div className="mt-3 text-xs text-slate-400">Bazowy poziom jakości życia: <strong className="text-slate-200">{LIFESTYLE_QOL[level]}/100</strong></div>
              <Button className="mt-4 w-full" variant={active ? 'secondary' : 'primary'} disabled={active} onClick={() => setLifestyle(level)} data-testid={`set-lifestyle-${level}`}>
                {active ? 'Wybrany' : 'Przejdź na ten styl'}
              </Button>
            </section>
          );
        })}
      </div>

      <Card title="Wskaźnik jakości życia" action={<PlaceholderBadge />}>
        <div className="flex flex-wrap items-center gap-6">
          <div className="text-center">
            <div data-testid="qol-score" className="text-5xl font-extrabold tracking-tight text-white tabular">{qol.score}</div>
            <div className="text-xs text-slate-400">na 100</div>
          </div>
          <ul className="min-w-72 flex-1 space-y-3">
            {qol.components.map((c) => (
              <li key={c.id}>
                <div className="mb-1 flex justify-between text-sm"><span className="text-slate-200">{c.label} <span className="text-xs text-slate-500">(waga {c.weight}%)</span></span><span className="tabular text-slate-300">{c.score}</span></div>
                <ProgressBar value={c.score} max={100} tone={c.score < 35 ? 'loss' : c.score < 60 ? 'gold' : 'gain'} />
                <div className="mt-0.5 text-xs text-slate-500">{c.detail}</div>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          Jakość życia <strong>nie</strong> jest prostą funkcją pieniędzy: składają się na nią styl życia, standard mieszkania, czas na odpoczynek i zmęczenie oraz bezpieczeństwo finansowe (tylko 15% wagi, z sufitem przy buforze 3 miesięcy kosztów — dodatkowe pieniądze jej nie podnoszą).
          Obecne miesięczne koszty życia (szacunek): <Money value={monthlyCostEstimate(game)} round />.
        </p>
      </Card>
    </div>
  );
}
