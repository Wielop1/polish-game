import { useId, useState } from 'react';
import { formatPLN } from '../../engine/money.ts';
import type { Grosze } from '../../engine/money.ts';
import { cx } from './ui.tsx';

export interface SeriesPoint {
  label: string;
  value: Grosze;
}

/** Zmniejsza liczbę punktów, zachowując pierwszy i ostatni. */
export function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = (items.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.round(i * step)]!);
  return out;
}

const compactFormat = new Intl.NumberFormat('pl-PL', { notation: 'compact', maximumFractionDigits: 1 });
/** Skrócony zapis osi (bez waluty — oś jest zawsze w zł). */
const compactPLN = (g: Grosze) => compactFormat.format(g / 100);

export function LineChart({ points, color = '#38bdf8', height = 220, ariaLabel }: { points: SeriesPoint[]; color?: string; height?: number; ariaLabel: string }) {
  const gid = useId();
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = height;
  const pad = { l: 56, r: 12, t: 14, b: 26 };
  if (points.length < 2) {
    return <div className="grid place-items-center text-sm text-slate-400" style={{ height }}>Za mało danych — przesuń czas, aby zobaczyć wykres.</div>;
  }
  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 100_00; max += 100_00; }
  const span = max - min;
  min -= span * 0.08;
  max += span * 0.08;
  const x = (i: number) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - pad.b} L${x(0).toFixed(1)},${H - pad.b} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + (max - min) * t);
  const active = hover !== null ? points[hover]! : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const rel = ((e.clientX - rect.left) / rect.width) * W;
          const idx = Math.round(((rel - pad.l) / (W - pad.l - pad.r)) * (points.length - 1));
          setHover(Math.min(points.length - 1, Math.max(0, idx)));
        }}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#2a3766" strokeOpacity="0.5" strokeDasharray="3 5" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#94a3b8">{compactPLN(Math.round(t))}</text>
          </g>
        ))}
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        <text x={pad.l} y={H - 8} fontSize="10" fill="#94a3b8">{points[0]!.label}</text>
        <text x={W - pad.r} y={H - 8} fontSize="10" fill="#94a3b8" textAnchor="end">{points[points.length - 1]!.label}</text>
        {active && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="#94a3b8" strokeOpacity="0.5" />
            <circle cx={x(hover)} cy={y(active.value)} r="4.5" fill={color} stroke="#0a0f1f" strokeWidth="2" />
          </g>
        )}
      </svg>
      {active && hover !== null && (
        <div
          className="pointer-events-none absolute top-1 rounded-lg border border-ink-600 bg-ink-900/95 px-2.5 py-1.5 text-xs shadow-xl"
          style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > points.length / 2 ? '-105%' : '5%'})` }}
        >
          <div className="text-slate-400">{active.label}</div>
          <div className="font-semibold text-slate-50 tabular">{formatPLN(active.value)}</div>
        </div>
      )}
    </div>
  );
}

export interface BarGroup {
  label: string;
  a: Grosze;
  b: Grosze;
}

export function BarChart({ groups, height = 200, aLabel, bLabel, ariaLabel }: { groups: BarGroup[]; height?: number; aLabel: string; bLabel: string; ariaLabel: string }) {
  const W = 640;
  const H = height;
  const pad = { l: 56, r: 8, t: 10, b: 24 };
  if (groups.length === 0) return <div className="grid place-items-center text-sm text-slate-400" style={{ height }}>Brak danych.</div>;
  const max = Math.max(1, ...groups.flatMap((g) => [g.a, g.b])) * 1.1;
  const innerW = W - pad.l - pad.r;
  const slot = innerW / groups.length;
  const barW = Math.min(22, slot * 0.34);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(max * t)} y2={y(max * t)} stroke="#2a3766" strokeOpacity="0.5" strokeDasharray="3 5" />
            <text x={pad.l - 8} y={y(max * t) + 4} textAnchor="end" fontSize="10" fill="#94a3b8">{compactPLN(Math.round(max * t))}</text>
          </g>
        ))}
        {groups.map((g, i) => {
          const cx0 = pad.l + slot * i + slot / 2;
          return (
            <g key={g.label}>
              <title>{`${g.label}: ${aLabel} ${formatPLN(g.a)}, ${bLabel} ${formatPLN(g.b)}`}</title>
              <rect x={cx0 - barW - 1} y={y(g.a)} width={barW} height={Math.max(0, H - pad.b - y(g.a))} rx="3" fill="#34d399" />
              <rect x={cx0 + 1} y={y(g.b)} width={barW} height={Math.max(0, H - pad.b - y(g.b))} rx="3" fill="#fb7185" />
              <text x={cx0} y={H - 8} textAnchor="middle" fontSize="10" fill="#94a3b8">{g.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-center gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-gain" />{aLabel}</span>
        <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-loss" />{bLabel}</span>
      </div>
    </div>
  );
}

export interface DonutSlice {
  label: string;
  value: Grosze;
  color: string;
}

export function Donut({ slices, centerLabel, ariaLabel }: { slices: DonutSlice[]; centerLabel: string; ariaLabel: string }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 140 140" className="size-36 shrink-0 -rotate-90" role="img" aria-label={ariaLabel}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="#1b2548" strokeWidth="16" />
        {total > 0 &&
          slices.map((s) => {
            const len = (s.value / total) * C;
            const el = (
              <circle key={s.label} cx="70" cy="70" r={R} fill="none" stroke={s.color} strokeWidth="16" strokeDasharray={`${Math.max(0, len - 1.5)} ${C - Math.max(0, len - 1.5)}`} strokeDashoffset={-offset}>
                <title>{`${s.label}: ${formatPLN(s.value)}`}</title>
              </circle>
            );
            offset += len;
            return el;
          })}
        <g className="rotate-90" transform="rotate(90 70 70)">
          <text x="70" y="66" textAnchor="middle" fontSize="9" fill="#94a3b8">{centerLabel}</text>
          <text x="70" y="82" textAnchor="middle" fontSize="12" fontWeight="600" fill="#f8fafc">{compactPLN(total)}</text>
        </g>
      </svg>
      <ul className="min-w-40 flex-1 space-y-1.5 text-sm">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-300"><i className="size-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>
            <span className="text-slate-400 tabular">{total > 0 ? Math.round((s.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProgressBar({ value, max, tone = 'gain', className }: { value: number; max: number; tone?: 'gain' | 'loss' | 'gold'; className?: string }) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  const tones = { gain: 'bg-gain', loss: 'bg-loss', gold: 'bg-gold' };
  return (
    <div className={cx('h-2 overflow-hidden rounded-full bg-ink-700', className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full transition-all', tones[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}
