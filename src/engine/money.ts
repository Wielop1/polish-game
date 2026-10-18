/**
 * Pieniądze przechowujemy jako CAŁKOWITĄ liczbę groszy (number, safe integer).
 * Nigdy nie używamy float do przechowywania ani sumowania kwot.
 * Mnożenie przez ułamki robimy wyłącznie przez `mulBps` (punkty bazowe, 1% = 100 bps).
 */
export type Grosze = number;

export function assertGrosze(value: number, label = 'kwota'): asserts value is Grosze {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label}: oczekiwano całkowitej liczby groszy, otrzymano ${value}`);
  }
}

/** Złote (całkowite lub z groszami zapisanymi jako ułamek dziesiętny z max. 2 miejscami) -> grosze. */
export function zl(amount: number): Grosze {
  const grosze = Math.round(amount * 100);
  assertGrosze(grosze);
  return grosze;
}

/** Dzielenie całkowite z zaokrągleniem do najbliższej liczby całkowitej (połówki od zera). */
export function roundDiv(numerator: number, denominator: number): number {
  if (denominator === 0) throw new RangeError('dzielenie przez zero');
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  return sign * Math.floor((2 * n + d) / (2 * d));
}

/** amount * bps / 10 000, z zaokrągleniem do pełnego grosza. */
export function mulBps(amount: Grosze, bps: number): Grosze {
  assertGrosze(amount);
  if (!Number.isInteger(bps)) throw new RangeError('bps musi być liczbą całkowitą');
  return roundDiv(amount * bps, 10_000);
}

export function sum(values: readonly Grosze[]): Grosze {
  let total = 0;
  for (const v of values) total += v;
  assertGrosze(total, 'suma');
  return total;
}

const plnFormat = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const plnFormatRound = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Formatowanie wyłącznie do wyświetlania (nie do obliczeń). */
export function formatPLN(grosze: Grosze, opts: { round?: boolean } = {}): string {
  const value = grosze / 100;
  return (opts.round ? plnFormatRound : plnFormat).format(value);
}

/** Z jawnym plusem dla dodatnich wartości (do list transakcji). */
export function formatSignedPLN(grosze: Grosze): string {
  return (grosze > 0 ? '+' : '') + formatPLN(grosze);
}
