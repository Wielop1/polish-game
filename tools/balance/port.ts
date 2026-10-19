import { commands } from '../../src/engine/commands.ts';
import type { CommandResult } from '../../src/engine/commands.ts';
import { zl } from '../../src/engine/money.ts';
import type { GameState } from '../../src/engine/state.ts';

/**
 * Cienka warstwa między botem a silnikiem: wszystko, co zmienia się między wersjami modelu rynku, jest tutaj.
 * Bot korzysta wyłącznie z komend gracza (`commands.*`) — ten sam silnik co w grze.
 */
export type MarketingPreset = 'none' | 'basic' | 'active' | 'portals';
export type PositioningChoice = 'low' | 'balanced' | 'premium';

/** Miesięczne budżety netto per kanał dla gotowych profili marketingowych (bot nie dobiera ich „pod wynik”). */
export const MARKETING_PRESETS: Record<MarketingPreset, Record<string, number>> = {
  none: {},
  basic: { local_ads: zl(400), card: zl(150) },
  // „active”: mieszanka nastawiona na jakość zapytań (polecenia, współpraca z przedsiębiorcami: mało porównań, większe zlecenia) i szybkie kanały; bez portali (dużo porównań)
  active: { search: zl(500), local_ads: zl(400), card: zl(150), partnerships: zl(900), referrals: zl(600) },
  /** Profil portalowy — odwrotność „active”: dużo zapytań z porównywarek (do porównań w raporcie). */
  portals: { search: zl(800), local_ads: zl(400), portals: zl(1_200), card: zl(150) },
};

/** Ustawia budżety kanałów i pozycjonowanie; zwraca kolejne wyniki komend (do logu). */
export function applyMarketing(s: GameState, preset: MarketingPreset, positioning: PositioningChoice = 'balanced'): { state: GameState; results: CommandResult[] } {
  let cur = s;
  const results: CommandResult[] = [];
  for (const [channel, amount] of Object.entries(MARKETING_PRESETS[preset])) {
    const r = commands.setMarketingBudget(cur, channel, amount);
    results.push(r);
    if (r.ok) cur = r.state;
  }
  if (positioning !== cur.market.strategy.positioning) {
    const r = commands.setPositioning(cur, positioning);
    results.push(r);
    if (r.ok) cur = r.state;
  }
  return { state: cur, results };
}
