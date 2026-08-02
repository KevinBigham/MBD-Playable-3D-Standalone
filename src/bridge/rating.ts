import type { ArcadeRating } from './contract';

/**
 * RATINGS CROSS THE BRIDGE ONCE.
 * ==============================
 *
 * MBD keeps ratings on an internal 0–550 scale and publishes three derived
 * views of each one: a 20–80 scouting grade, a 0–1 normalized value, and a
 * 0–99 arcade convenience. MOONSHOT NINE keeps its attributes on 20–99, which
 * is a fourth scale, and getting between the two is the single most
 * consequential piece of arithmetic in the whole bridge — every swing, every
 * pitch and every throw in an imported game is downstream of it.
 *
 * Three rules, all of which exist because the obvious shortcut breaks something:
 *
 * 1. **Convert from `internal`, always.** `arcade99` is right there and is
 *    almost the right scale, which is exactly what makes it dangerous: it has
 *    already been rounded to 100 buckets, so using it throws away resolution
 *    that MBD paid for and that the contact model can actually feel. 550 source
 *    values into 80 arcade values is lossy enough without doing it twice.
 *
 * 2. **Never send a derived value home.** The contract is explicit: a 20–80 or
 *    0–99 value must not be round-tripped back into MBD. This module has no
 *    inverse function, and that absence is deliberate rather than unfinished.
 *
 * 3. **Monotonicity is not negotiable.** A higher source rating may not produce
 *    a lower arcade attribute, ever, for any rating, anywhere in the range.
 *    Tuning a curve is allowed; reordering two players is not. `bridge.test.ts`
 *    sweeps all 551 values of every rating and asserts it.
 */

/** MBD's canonical internal range. */
export const MBD_INTERNAL_MAX = 550;

/**
 * MOONSHOT's attribute range. `attr01()` in core/constants is `(v - 20) / 79`,
 * so 20 is the floor of the scale and 99 is the ceiling; these are that
 * function's own endpoints rather than a preference.
 */
export const MOONSHOT_ATTR_MIN = 20;
export const MOONSHOT_ATTR_MAX = 99;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * The exporter's own published conversion, reproduced exactly.
 *
 * Kept here even though MBD sends all four fields, for two reasons: the fixture
 * needs to build well-formed ratings without MBD running, and a bundle whose
 * derived fields disagree with its own `internal` is a bundle worth catching.
 */
export function makeRating(internal: number): ArcadeRating {
  const clamped = clamp(Math.round(internal), 0, MBD_INTERNAL_MAX);
  const normalized = clamped / MBD_INTERNAL_MAX;
  return {
    internal: clamped,
    display: Math.round(20 + normalized * 60),
    normalized,
    arcade99: Math.round(normalized * 99),
  };
}

/**
 * A source rating as a MOONSHOT attribute.
 *
 * Deliberately linear. A curve here would be a balance decision taken in the
 * one place nobody would look for it — halfway across a data bridge — and it
 * would silently disagree with MBD's own sense of what a 400 means. If imported
 * play needs rebalancing, that belongs in the contact model where the rest of
 * the balance lives and where the tests for it already are.
 */
export function toAttribute(r: ArcadeRating): number {
  const n = clamp(r.internal, 0, MBD_INTERNAL_MAX) / MBD_INTERNAL_MAX;
  return Math.round(MOONSHOT_ATTR_MIN + n * (MOONSHOT_ATTR_MAX - MOONSHOT_ATTR_MIN));
}

/**
 * A blend of source ratings as a MOONSHOT attribute, for the handful of places
 * where this game asks a question MBD answers with two numbers.
 *
 * Weights must be non-negative and are normalised, which is what keeps the
 * result monotone in every input: increasing any one source rating cannot
 * decrease the output. That property is the whole reason this exists as a
 * function rather than as arithmetic sprinkled through the adapter.
 */
export function blendAttribute(parts: Array<{ rating: ArcadeRating; weight: number }>): number {
  let total = 0;
  let sum = 0;
  for (const p of parts) {
    const w = Math.max(0, p.weight);
    total += w;
    sum += w * (clamp(p.rating.internal, 0, MBD_INTERNAL_MAX) / MBD_INTERNAL_MAX);
  }
  if (total <= 0) return MOONSHOT_ATTR_MIN;
  const n = sum / total;
  return Math.round(MOONSHOT_ATTR_MIN + n * (MOONSHOT_ATTR_MAX - MOONSHOT_ATTR_MIN));
}

/**
 * A 0–100 personality score as a MOONSHOT attribute.
 *
 * Personality is on its own scale in MBD and is allowed to reach exactly one
 * thing here — the pitcher's composure, from mental toughness, which the
 * contract sanctions as "bounded pressure behavior". It must never become a
 * hidden physics bonus, so nothing else reads this.
 */
export function personalityToAttribute(v: number): number {
  const n = clamp(v, 0, 100) / 100;
  return Math.round(MOONSHOT_ATTR_MIN + n * (MOONSHOT_ATTR_MAX - MOONSHOT_ATTR_MIN));
}

/**
 * Does a rating's derived fields agree with its own `internal`?
 *
 * A bundle that fails this is not corrupt in a way that would crash anything —
 * this game only reads `internal` — but it means the exporter and this contract
 * have drifted, and finding that out at import time is enormously cheaper than
 * finding it out from a player who says their ace feels wrong.
 */
export function ratingIsSelfConsistent(r: ArcadeRating): boolean {
  const expected = makeRating(r.internal);
  return (
    r.display === expected.display &&
    r.arcade99 === expected.arcade99 &&
    Math.abs(r.normalized - expected.normalized) < 1e-9
  );
}
