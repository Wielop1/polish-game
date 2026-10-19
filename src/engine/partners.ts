import { zl } from './money.ts';
import { FIRST_NAMES, LAST_NAMES, SERVICE_BY_ID } from './renovationCatalog.ts';
import { createRng } from './rng.ts';
import type { Corp, GameState, Partner } from './state.ts';

/**
 * Pula wspólników i inwestorów (postacie AI, deterministyczne z ziarna gry). Nie używają modeli językowych:
 * ich decyzje wynikają z atrybutów (kapitał, tolerancja ryzyka, cel, preferencja dywidend, horyzont, zaufanie) i sytuacji spółki.
 */

const TRADES = ['malowanie', 'gladzie', 'panele'] as const;
const BIO_GOAL = { income: 'ceni stały dochód z dywidend', growth: 'stawia na rozwój i reinwestycję zysku', exit: 'planuje wyjście z inwestycji z zyskiem' } as const;

export function buildPartnerPool(seed: string): Partner[] {
  const out: Partner[] = [];
  const used = new Set<string>();
  for (let i = 0; i < 10; i++) {
    const rng = createRng(seed, `partner:pool:${i}`);
    const kind: Partner['kind'] = i < 6 ? 'partner' : 'investor';
    let first: string;
    let last: string;
    do {
      first = FIRST_NAMES[rng.int(0, FIRST_NAMES.length - 1)]!;
      last = LAST_NAMES[rng.int(0, LAST_NAMES.length - 1)]!;
    } while (used.has(`${first} ${last}`));
    used.add(`${first} ${last}`);
    const capital = kind === 'partner' ? zl(rng.int(20, 120) * 1_000) : zl(rng.int(150, 900) * 1_000);
    const goal = kind === 'partner' ? (rng.int(0, 99) < 45 ? 'income' : 'growth') : (['growth', 'exit', 'income'] as const)[rng.int(0, 2)]!;
    const experience = rng.int(15, 90);
    const trade = kind === 'partner' && rng.int(0, 99) < 70 ? TRADES[rng.int(0, TRADES.length - 1)]! : null;
    const horizonMonths = kind === 'partner' ? rng.int(36, 120) : rng.int(24, 96);
    const birthYear = 2026 - rng.int(28, 58);
    const dividendPreference = goal === 'income' ? rng.int(60, 95) : goal === 'growth' ? rng.int(5, 40) : rng.int(25, 60);
    const riskTolerance = kind === 'investor' ? rng.int(35, 90) : rng.int(15, 75);
    out.push({
      id: `partner:${i + 1}`, firstName: first, lastName: last, birthYear, kind, capital,
      experience, competence: Math.min(100, Math.max(10, experience + rng.int(-15, 15))), riskTolerance, goal, dividendPreference, horizonMonths,
      trust: rng.int(40, 60), tradeSkill: trade,
      bio: `${kind === 'partner' ? 'Wspólnik' : 'Inwestor'}, ${2026 - birthYear} lat; ${experience >= 60 ? 'duże' : experience >= 35 ? 'średnie' : 'niewielkie'} doświadczenie${trade ? ` (${SERVICE_BY_ID.get(trade)?.label ?? trade})` : ''}; ${BIO_GOAL[goal]}.`,
      history: [], lastReviewMonth: null,
    });
  }
  return out;
}

export function emptyCorp(seed: string): Corp {
  return {
    companies: [], partners: buildPartnerPool(seed), holdings: [], shareEvents: [], resolutions: [], negotiations: [], dividends: [],
    citReturns: [], citLosses: [], selected: 'jdg', context: null,
  };
}

export const partnerById = (s: GameState, id: string): Partner | undefined => s.corp.partners.find((p) => p.id === id);

/** Nazwa wspólnika/członka zarządu: gracz albo postać AI. */
export function holderName(s: GameState, id: string): string {
  if (id === s.person.id) return `${s.person.firstName} ${s.person.lastName} (Ty)`;
  const p = partnerById(s, id);
  return p ? `${p.firstName} ${p.lastName}` : id;
}

export const isPlayer = (s: GameState, id: string): boolean => id === s.person.id;

/** Zmiana zaufania postaci z wpisem w historii współpracy (ostatnie 24 wpisy). */
export function adjustTrust(s: GameState, partnerId: string, delta: number, note: string): void {
  const p = partnerById(s, partnerId);
  if (!p || delta === 0) return;
  const before = p.trust;
  p.trust = Math.min(100, Math.max(0, p.trust + delta));
  p.history.push({ date: s.clock.today, note: note.slice(0, 240), trustDelta: p.trust - before });
  if (p.history.length > 24) p.history.splice(0, p.history.length - 24);
}
