import { describe, expect, it } from 'vitest';
import { assertGrosze, mulBps, roundDiv, sum, zl } from './money.ts';
import { createRng } from './rng.ts';

describe('pieniądze', () => {
  it('przechowuje całkowite grosze bez błędów float', () => {
    expect(zl(0.1) + zl(0.2)).toBe(30); // 0.1 + 0.2 !== 0.3 w float
    expect(zl(19.99)).toBe(1999);
    expect(sum([zl(0.1), zl(0.2), zl(0.7)])).toBe(100);
  });
  it('odrzuca ułamki groszy', () => {
    expect(() => assertGrosze(10.5)).toThrow();
    expect(() => assertGrosze(Number.NaN)).toThrow();
    expect(() => assertGrosze(2 ** 60)).toThrow();
  });
  it('roundDiv zaokrągla połówki od zera, także dla ujemnych', () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(-5, 2)).toBe(-3);
    expect(roundDiv(4, 3)).toBe(1);
    expect(roundDiv(-4, 3)).toBe(-1);
  });
  it('mulBps liczy procenty w groszach', () => {
    expect(mulBps(zl(300), 1500)).toBe(zl(45));
    expect(mulBps(zl(300), -1500)).toBe(-zl(45));
    expect(mulBps(1, 5000)).toBe(1); // 0,5 grosza -> 1
  });
});

describe('losowość kontrolowana', () => {
  it('ten sam seed i strumień dają ten sam ciąg', () => {
    const a = createRng('abc', 'x');
    const b = createRng('abc', 'x');
    expect([a.int(0, 999), a.int(0, 999), a.int(0, 999)]).toEqual([b.int(0, 999), b.int(0, 999), b.int(0, 999)]);
  });
  it('różne strumienie i seedy dają różne ciągi, a wynik nie zależy od kolejności', () => {
    const first = createRng('abc', 'x').int(0, 1_000_000);
    createRng('abc', 'y').int(0, 1_000_000); // „inne losowanie” między nimi
    expect(createRng('abc', 'x').int(0, 1_000_000)).toBe(first);
    expect(createRng('abd', 'x').int(0, 1_000_000)).not.toBe(first);
  });
  it('int mieści się w zakresie domkniętym', () => {
    const r = createRng('seed', 's');
    for (let i = 0; i < 2000; i++) {
      const v = r.int(-3, 3);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThanOrEqual(3);
    }
  });
});
