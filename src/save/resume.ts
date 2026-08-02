import { Rng } from '../core/rng';
import type { GameState } from '../sim/state';

/**
 * RESUMING A GAME THE PHONE THREW AWAY.
 *
 * A desktop browser keeps a background tab alive for hours. A phone does not.
 * iOS Safari discards backgrounded tabs under memory pressure and Android's
 * Chrome freezes and then evicts them, so the ordinary sequence of "answer a
 * text, come back" ends a nine-inning game in the sixth. Nothing about that is
 * the player's fault and nothing on screen warns them it is about to happen.
 *
 * So the game state is written to localStorage at the moments it is about to be
 * lost, and the main menu offers it back. This is only possible because the
 * simulation is pure data: `GameState` holds numbers, strings, arrays and plain
 * objects, plus exactly one class instance — the Rng, which is one uint32 with
 * a method table. Serialising it is JSON plus that one integer.
 *
 * The restored game is not an approximation of where you were. It is the same
 * game: same seed position, same count, same runners, same fatigue, same
 * pending walk-off. Stepping a restored state and stepping the original state
 * with identical inputs produces identical games, and a test asserts exactly
 * that over several hundred ticks.
 */

/**
 * Bumped whenever the shape of GameState changes in a way an old snapshot
 * cannot satisfy. A stale snapshot is dropped, not repaired: a half-restored
 * game is worse than no offer at all.
 */
export const RESUME_VERSION = 1;

export type ResumeContext = 'quick' | 'season' | 'playoff' | 'cup' | 'practice';

export interface ResumeSnapshot {
  v: number;
  context: ResumeContext;
  /** Mulberry32 position, so the restored game draws the same numbers next. */
  rng: number;
  /** Everything else, verbatim. */
  state: unknown;
}

export function snapshotGame(state: GameState, context: ResumeContext): ResumeSnapshot {
  const { rng, ...rest } = state;
  return { v: RESUME_VERSION, context, rng: rng.getState(), state: rest };
}

/**
 * Rebuilds a live GameState, or null if the snapshot is from another version,
 * structurally wrong, or describes a game that is already over. Every failure
 * mode ends the same way — the offer disappears — because a resume that lands
 * the player in a broken game is worse than one that never appears.
 */
export function restoreGame(
  snap: unknown,
): { state: GameState; context: ResumeContext } | null {
  try {
    const s = snap as ResumeSnapshot | null;
    if (!s || typeof s !== 'object') return null;
    if (s.v !== RESUME_VERSION) return null;
    if (typeof s.rng !== 'number' || !Number.isFinite(s.rng)) return null;

    const state = s.state as GameState;
    if (!isPlausibleGame(state)) return null;

    const rng = new Rng(1);
    rng.setState(s.rng);
    state.rng = rng;
    return { state, context: normaliseContext(s.context) };
  } catch {
    return null;
  }
}

/** The cheapest structural check that would catch a truncated or foreign blob. */
function isPlausibleGame(g: unknown): g is GameState {
  if (!g || typeof g !== 'object') return false;
  const s = g as Partial<GameState>;
  return (
    typeof s.phase === 'string' &&
    typeof s.inning === 'number' &&
    (s.half === 'top' || s.half === 'bottom') &&
    !!s.setup &&
    !!s.stadium &&
    !!s.away &&
    !!s.home &&
    !!s.ball &&
    !!s.batter &&
    !!s.pitcher &&
    Array.isArray(s.fielders) &&
    s.fielders.length === 9 &&
    Array.isArray(s.runners) &&
    Array.isArray(s.events) &&
    // A finished game has nothing to go back to.
    s.gameOver === false &&
    s.phase !== 'final'
  );
}

function normaliseContext(c: unknown): ResumeContext {
  return c === 'season' || c === 'playoff' || c === 'cup' || c === 'practice' ? c : 'quick';
}

/** "Bottom 6 · HAV 3 — 2 MER · 2 out, runners on the corners". */
export function describeSituation(state: GameState): string {
  const half = state.half === 'top' ? 'Top' : 'Bottom';
  const score = `${state.away.abbr} ${state.stats.away.runs} — ${state.stats.home.runs} ${state.home.abbr}`;
  const outs = `${state.outs} out`;
  const on = state.runners
    .filter((r) => !r.out && !r.scored && !r.isBatter && r.base >= 1 && r.base <= 3)
    .map((r) => r.base)
    .sort();
  const bases = on.length === 0 ? 'bases empty' : `${on.map(ordinal).join(' and ')} occupied`;
  return `${half} ${state.inning} · ${score} · ${outs}, ${bases}`;
}

function ordinal(base: number): string {
  return base === 1 ? '1st' : base === 2 ? '2nd' : '3rd';
}
