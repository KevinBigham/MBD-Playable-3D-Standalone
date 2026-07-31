/**
 * Deterministic, seedable pseudo-random number generation.
 *
 * Every stochastic element in MOONSHOT NINE draws from an Rng instance so that
 * a (seed, input-sequence) pair always reproduces the same game. Nothing in the
 * simulation may call Math.random().
 */

export class Rng {
  private s: number;

  constructor(seed: number) {
    // Force to a non-zero uint32.
    this.s = (seed >>> 0) || 0x9e3779b9;
  }

  /** Raw uint32 draw (mulberry32). */
  nextUint32(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max <= min) return min;
    return min + (this.nextUint32() % (max - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Uniform element of a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.nextUint32() % arr.length];
  }

  /**
   * Approximately normal draw, bounded to +/- 3 sigma so the simulation can
   * never produce a wild outlier. Sum of 3 uniforms (Bates) scaled to unit
   * standard deviation.
   */
  normal(mean = 0, sd = 1): number {
    const u = this.next() + this.next() + this.next() - 1.5; // sd = 0.5
    return mean + u * 2 * sd;
  }

  /** In-place Fisher-Yates shuffle. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextUint32() % (i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /** Snapshot of internal state, for save files. */
  getState(): number {
    return this.s >>> 0;
  }

  setState(s: number): void {
    this.s = (s >>> 0) || 0x9e3779b9;
  }

  fork(salt: number): Rng {
    return new Rng((this.nextUint32() ^ Math.imul(salt, 0x85ebca6b)) >>> 0);
  }
}

/** Deterministic 32-bit hash of a string — used to derive stable seeds. */
export function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A time-based seed for "random" sessions; never used inside the simulation. */
export function freshSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}
