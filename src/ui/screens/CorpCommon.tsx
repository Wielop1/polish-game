import type { ReactNode } from 'react';
import { CORP } from '../../engine/corpConfig.ts';
import { companyFullName } from '../../engine/operator.ts';
import type { Company, GameState } from '../../engine/state.ts';
import { useGameStore } from '../../store/gameStore.ts';
import { Badge, Button, Card, Empty, cx } from '../components/ui.tsx';
import { LegalBadge } from './BusinessScreens.tsx';

/** Wspólne elementy ekranów „Spółki i inwestycje prywatne” (v0.8). */

export const STATUS_LABEL = { draft: 'szkic', organizing: 'w organizacji', registered: 'zarejestrowana', closed: 'zamknięta' } as const;
export const STATUS_TONE = { draft: 'neutral', organizing: 'gold', registered: 'gain', closed: 'neutral' } as const;

export function useCorp(): {
  game: GameState; companies: Company[]; company: Company | null; select: (id: string | null) => void; run: ReturnType<typeof useGameStore.getState>['run'];
} {
  const game = useGameStore((s) => s.game)!;
  const selId = useGameStore((s) => s.selectedCompanyId);
  const select = useGameStore((s) => s.selectCompany);
  const run = useGameStore((s) => s.run);
  const companies = game.corp.companies.filter((c) => c.status === 'organizing' || c.status === 'registered');
  const company = companies.find((c) => c.id === selId) ?? companies[0] ?? null;
  return { game, companies, company, select, run };
}

export function CorpBanner() {
  return (
    <div role="note" data-testid="corp-banner" className="mb-5 rounded-xl border border-gold/30 bg-gold/5 p-3 text-xs leading-relaxed text-gold/90">
      <strong>Symulacja — nie porada prawna ani podatkowa.</strong> Spółka z o.o. jest odrębnym podmiotem prawnym: ma własny rachunek, majątek, zobowiązania i podatki; Ty masz w niej udziały, a prawo ją reprezentować daje wyłącznie członkostwo w zarządzie.
      Zasady (KSH, CIT, PIT, ZUS, KRS) zweryfikowano na tekstach urzędowych dla 2026 r.; uproszczenia i odłożone funkcje są oznaczone w rejestrze reguł (<em>docs/LEGAL_SOURCES.md</em>).
      Ograniczona odpowiedzialność wspólnika nie oznacza braku ryzyka osobistego: członek zarządu odpowiada za zobowiązania spółki przy bezskutecznej egzekucji (art. 299 KSH) — gra nie symuluje roszczeń, ale ostrzega przy zaległościach. <LegalBadge id="CO-KSH-LIABILITY" />
    </div>
  );
}

export function CompanyPicker({ companies, company, select }: { companies: Company[]; company: Company | null; select: (id: string | null) => void }) {
  if (companies.length <= 1) return null;
  return (
    <div role="group" aria-label="Wybór spółki" className="mb-5 flex flex-wrap gap-2" data-testid="company-picker">
      {companies.map((c) => (
        <button key={c.id} type="button" aria-pressed={company?.id === c.id} onClick={() => select(c.id)}
          className={cx('rounded-xl border px-3 py-1.5 text-sm', company?.id === c.id ? 'border-sky bg-sky/10 text-white' : 'border-ink-600 text-slate-300 hover:border-ink-500')}>
          {companyFullName(c)} <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
        </button>
      ))}
    </div>
  );
}

export function NoCompany({ title, hint }: { title?: string; hint?: ReactNode }) {
  const navigate = useGameStore((s) => s.navigate);
  return (
    <Card title={title}>
      <Empty>
        {hint ?? 'Nie masz jeszcze zarejestrowanej spółki ani spółki w organizacji.'}
        <div className="mt-3"><Button variant="primary" onClick={() => navigate('corpFound')}>Załóż spółkę</Button></div>
      </Empty>
    </Card>
  );
}

export function Row({ k, v, tone }: { k: ReactNode; v: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <dt className="text-slate-400">{k}</dt>
      <dd className={cx('tabular text-right', tone ?? 'text-slate-100')}>{v}</dd>
    </div>
  );
}

export const pct = (bps: number): string => `${(bps / 100).toFixed(1).replace('.', ',')}%`;

export function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return <th className={cx('pb-2 font-medium', right && 'text-right')}>{children}</th>;
}

export const inputCls = 'w-full rounded-xl border border-ink-600 bg-ink-900/80 px-3 py-2 text-slate-100 focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30';

export function Field({ label, id, children, hint }: { label: string; id: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-200">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export const CIT_LIMIT_NOTE = `limit 2 mln € = ${(CORP.citRevenueLimit2026 / 100).toLocaleString('pl-PL')} zł`;
