import { describe, expect, it } from 'vitest';
import { Rng, hashString } from '../core/rng';

/**
 * The whole simulation is reproducible only because every stochastic decision
 * comes from this generator. If any of these guarantees slip, saved seeds stop
 * replaying and every other test in this suite loses its meaning.
 */

function draws(rng: Rng, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(rng.nextUint32());
  return out;
}

describe('Rng determinism', () => {
  it('reproduces the same raw sequence for the same seed', () => {
    expect(draws(new Rng(20260731), 64)).toEqual(draws(new Rng(20260731), 64));
  });

  it('produces different sequences for different seeds', () => {
    expect(draws(new Rng(1), 16)).not.toEqual(draws(new Rng(2), 16));
  });

  it('reproduces every derived helper, not just the raw draw', () => {
    const a = new Rng(4242);
    const b = new Rng(4242);
    const pool = ['alpha', 'beta', 'gamma', 'delta'];
    for (let i = 0; i < 200; i++) {
      expect(a.next()).toBe(b.next());
      expect(a.range(-3, 9)).toBe(b.range(-3, 9));
      expect(a.int(0, 100)).toBe(b.int(0, 100));
      expect(a.chance(0.37)).toBe(b.chance(0.37));
      expect(a.pick(pool)).toBe(b.pick(pool));
      expect(a.normal(2, 0.5)).toBe(b.normal(2, 0.5));
    }
  });

  it('stays inside the documented output ranges', () => {
    const rng = new Rng(777);
    for (let i = 0; i < 20000; i++) {
      const u = rng.next();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      const r = rng.range(-2, 5);
      expect(r).toBeGreaterThanOrEqual(-2);
      expect(r).toBeLessThan(5);
      const n = rng.int(3, 7);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
    }
    // A degenerate range must not throw or produce NaN.
    expect(rng.int(5, 5)).toBe(5);
    expect(rng.int(9, 2)).toBe(9);
  });

  it('round-trips its internal state so save files can resume mid-game', () => {
    const rng = new Rng(31337);
    draws(rng, 25);
    const snapshot = rng.getState();
    const expected = draws(rng, 25);

    const restored = new Rng(1);
    restored.setState(snapshot);
    expect(draws(restored, 25)).toEqual(expected);
  });

  it('never latches to the zero state', () => {
    // A zero seed would freeze mulberry32 in place; the constructor must reject it.
    const zero = new Rng(0);
    const first = draws(zero, 8);
    expect(new Set(first).size).toBe(8);
    expect(draws(new Rng(0), 8)).toEqual(first);
  });
});

describe('Rng.fork', () => {
  it('is deterministic for a given parent state and salt', () => {
    const childA = new Rng(999).fork(42);
    const childB = new Rng(999).fork(42);
    expect(draws(childA, 32)).toEqual(draws(childB, 32));
  });

  it('gives different streams for different salts', () => {
    const a = new Rng(999).fork(42);
    const b = new Rng(999).fork(43);
    expect(draws(a, 16)).not.toEqual(draws(b, 16));
  });

  it('advances the parent, so two forks in a row differ', () => {
    const parent = new Rng(555);
    const first = parent.fork(7);
    const second = parent.fork(7);
    expect(draws(first, 16)).not.toEqual(draws(second, 16));
  });
});

describe('Rng.normal', () => {
  it('stays within +/- 3 sigma and keeps its mean and spread', () => {
    const rng = new Rng(20260101);
    const N = 200_000;
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < N; i++) {
      const v = rng.normal(0, 1);
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      sumSq += v * v;
    }
    // The Bates construction is hard-bounded; nothing may ever escape 3 sigma.
    expect(min).toBeGreaterThanOrEqual(-3);
    expect(max).toBeLessThanOrEqual(3);
    const mean = sum / N;
    const sd = Math.sqrt(sumSq / N - mean * mean);
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(sd).toBeGreaterThan(0.97);
    expect(sd).toBeLessThan(1.03);
  });

  it('honours the requested mean and standard deviation', () => {
    const rng = new Rng(24);
    const N = 50_000;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const v = rng.normal(10, 2);
      expect(v).toBeGreaterThanOrEqual(10 - 3 * 2);
      expect(v).toBeLessThanOrEqual(10 + 3 * 2);
      sum += v;
    }
    expect(Math.abs(sum / N - 10)).toBeLessThan(0.05);
  });
});

describe('Rng.shuffle', () => {
  it('is a permutation of the input', () => {
    const original = Array.from({ length: 120 }, (_, i) => i);
    const shuffled = new Rng(8080).shuffle([...original]);
    expect(shuffled).toHaveLength(original.length);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(original);
  });

  it('actually reorders and is reproducible for a seed', () => {
    const identity = Array.from({ length: 60 }, (_, i) => i);
    const a = new Rng(2024).shuffle([...identity]);
    const b = new Rng(2024).shuffle([...identity]);
    expect(a).toEqual(b);
    expect(a).not.toEqual(identity);
  });

  it('shuffles in place and returns the same array reference', () => {
    const arr = [1, 2, 3, 4, 5];
    const result = new Rng(11).shuffle(arr);
    expect(result).toBe(arr);
  });

  it('handles empty and single-element arrays', () => {
    expect(new Rng(3).shuffle([])).toEqual([]);
    expect(new Rng(3).shuffle(['only'])).toEqual(['only']);
  });
});

describe('hashString', () => {
  it('returns stable values, so derived seeds survive a rebuild', () => {
    expect(hashString('meridian-circuit-v1')).toBe(65339202);
    expect(hashString('ironport')).toBe(250786980);
    expect(hashString('')).toBe(2166136261);
    expect(hashString('a')).toBe(3826002220);
    expect(hashString('MOONSHOT NINE')).toBe(1052969904);
  });

  it('is always an unsigned 32-bit integer', () => {
    for (const s of ['', 'a', 'anchor-yard', 'season-42', 'é你好', 'x'.repeat(500)]) {
      const h = hashString(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('separates similar strings', () => {
    expect(hashString('ironport')).not.toBe(hashString('ironporu'));
    expect(hashString('ab')).not.toBe(hashString('ba'));
  });
});
