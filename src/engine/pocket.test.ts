import { describe, expect, it } from 'vitest';
import { estimatePocket } from './pocket.ts';
import { zl } from './money.ts';
import { advanceDays } from './simulate.ts';
import { opsGame } from './testkit.ts';

describe('szacunek „zostaje do kieszeni”', () => {
  it('odejmuje udział w kosztach stałych i podatek od nadwyżki; po miesiącu działalności zna koszty stałe', () => {
    let s = opsGame({ seed: 'pocket-1' });
    s = advanceDays(s, 45);
    const e = estimatePocket(s, zl(4_200), zl(6_000), 7)!;
    expect(e.fixedKnown).toBe(true);
    expect(e.fixedMonthly).toBeGreaterThan(zl(100)); // składki właściciela (ulga na start: bez społecznych) i stałe koszty
    expect(e.fixedShare).toBe(Math.round((e.fixedMonthly * 7) / 21));
    expect(e.taxEstimate).toBeGreaterThan(0);
    expect(e.pocket).toBe(zl(4_200) - e.fixedShare - e.taxEstimate);
    expect(e.pocket).toBeLessThan(zl(4_200));
    expect(e.perDay).toBe(Math.round(e.pocket / 7));
  });

  it('strata na zleceniu nie daje ujemnego podatku', () => {
    let s = opsGame({ seed: 'pocket-2' });
    s = advanceDays(s, 45);
    const e = estimatePocket(s, -zl(500), zl(2_000), 3)!;
    expect(e.taxEstimate).toBe(0);
    expect(e.pocket).toBeLessThan(-zl(500) + 1);
  });
});
