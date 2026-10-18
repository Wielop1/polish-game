import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { formatPLN } from '../../engine/money.ts';
import type { Grosze } from '../../engine/money.ts';
import { Icon } from './icons.tsx';
import type { IconName } from './icons.tsx';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx('rounded-2xl border border-ink-700/70 bg-linear-to-b from-ink-800/80 to-ink-850/80 p-5 shadow-lg shadow-black/20 backdrop-blur', className)}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-wide text-slate-300 uppercase">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-linear-to-b from-gain to-emerald-500 text-ink-950 font-semibold hover:brightness-110 shadow-md shadow-emerald-500/20',
  secondary: 'bg-ink-700 text-slate-100 hover:bg-ink-600 border border-ink-600',
  ghost: 'text-slate-300 hover:bg-ink-700/70',
  danger: 'text-loss border border-loss/30 hover:bg-loss/10',
};

export function Button({ variant = 'secondary', icon, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: IconName }) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky disabled:cursor-not-allowed disabled:opacity-40',
        VARIANTS[variant],
        className,
      )}
    >
      {icon && <Icon name={icon} className="size-4" />}
      {children}
    </button>
  );
}

export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'gain' | 'loss' | 'gold' | 'sky'; title?: string }) {
  const tones = {
    neutral: 'bg-ink-700 text-slate-300',
    gain: 'bg-gain/15 text-gain',
    loss: 'bg-loss/15 text-loss',
    gold: 'bg-gold/15 text-gold',
    sky: 'bg-sky/15 text-sky',
  };
  return (
    <span title={title} className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone])}>
      {children}
    </span>
  );
}

export function PlaceholderBadge() {
  return (
    <Badge tone="gold" title="Wartość przykładowa — niezweryfikowana z danymi rzeczywistymi">
      przykładowe
    </Badge>
  );
}

export function Money({ value, signed, round, className }: { value: Grosze; signed?: boolean; round?: boolean; className?: string }) {
  const text = (signed && value > 0 ? '+' : '') + formatPLN(value, { round });
  return <span className={cx('tabular', className)}>{text}</span>;
}

export function moneyTone(value: Grosze): string {
  return value > 0 ? 'text-gain' : value < 0 ? 'text-loss' : 'text-slate-300';
}

export function StatCard({
  label, value, hint, accent = 'sky', icon, testId,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: 'sky' | 'gain' | 'gold' | 'loss' | 'violet';
  icon: IconName;
  testId?: string;
}) {
  const accents = {
    sky: 'from-sky/20 text-sky',
    gain: 'from-gain/20 text-gain',
    gold: 'from-gold/20 text-gold',
    loss: 'from-loss/20 text-loss',
    violet: 'from-violet/20 text-violet',
  };
  return (
    <div data-testid={testId} className="relative overflow-hidden rounded-2xl border border-ink-700/70 bg-ink-800/80 p-4 shadow-lg shadow-black/20">
      <div className={cx('pointer-events-none absolute -top-8 -right-8 size-28 rounded-full bg-radial to-transparent blur-xl', accents[accent].split(' ')[0])} />
      <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-slate-400 uppercase">
        <span className={accents[accent].split(' ')[1]}>
          <Icon name={icon} className="size-4" />
        </span>
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-50 tabular">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export function ScreenHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-50">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-ink-600 p-6 text-center text-sm text-slate-400">{children}</div>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-xl border border-ink-700 bg-ink-900/70 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-lg px-3 py-1 text-xs font-medium transition',
            o.value === value ? 'bg-ink-600 text-white shadow' : 'text-slate-400 hover:text-slate-200',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
