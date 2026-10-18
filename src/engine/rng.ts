/**
 * Kontrolowana losowość. Silnik NIGDY nie używa Math.random().
 *
 * Strumień losowy jest wyprowadzany z pary (seed gry, identyfikator zdarzenia),
 * więc wynik konkretnego zdarzenia nie zależy od kolejności ani liczby innych losowań.
 * Dzięki temu zapis gry nie musi przechowywać stanu generatora, a wczytanie zapisu
 * daje dokładnie tę samą dalszą symulację.
 */

/** xmur3: hash napisu -> generator 32-bitowych ziaren. */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

/** mulberry32: szybki, mały PRNG o dobrych własnościach statystycznych jak na grę. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** Liczba całkowita z przedziału domkniętego [min, max]. */
  int(min: number, max: number): number;
  /** Liczba z przedziału [0, 1). Tylko do niefinansowych zastosowań. */
  next(): number;
}

export function createRng(seed: string, streamId: string): Rng {
  const seeder = xmur3(`${seed}::${streamId}`);
  const next = mulberry32(seeder());
  return {
    next,
    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        throw new RangeError(`Nieprawidłowy zakres losowania: [${min}, ${max}]`);
      }
      return min + Math.floor(next() * (max - min + 1));
    },
  };
}

/** Domyślne ziarno nowej gry (używane tylko w warstwie UI, nie w silniku). */
export function randomSeed(): string {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(8, '0')).join('');
}
