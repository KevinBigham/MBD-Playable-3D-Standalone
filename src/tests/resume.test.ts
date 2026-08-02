import { describe, expect, it } from 'vitest';
import type { GameSetup } from '../core/types';
import { TICK_DT } from '../core/constants';
import { buildLeague, teamById } from '../data/teams';
import { createGameState, type GameState } from '../sim/state';
import { stepGame } from '../sim/game';
import { emptyInputPair } from '../sim/input';
import {
  RESUME_VERSION,
  describeSituation,
  restoreGame,
  snapshotGame,
} from '../save/resume';

/**
 * A RESTORED GAME IS THE SAME GAME
 * --------------------------------
 * The claim the resume feature makes is strong: what comes back is not a
 * reconstruction of roughly where you were, it is the identical game, and it
 * will unfold identically from here. That is only true if *everything* that
 * feeds the next tick round-trips — the count and the runners obviously, but
 * also the fielder velocities, the reaction timers, the pitcher's fatigue, the
 * cached trajectory, and the position of the random number generator.
 *
 * The generator is the one that would fail quietly. A game restored with a
 * fresh Rng plays a plausible game; it just is not *your* game, and nothing on
 * screen would ever tell you. So the test below does not check a summary. It
 * runs both copies forward for minutes of simulated baseball and demands the
 * complete state match, byte for byte, through the same serialiser.
 */

const league = buildLeague();

function setupFor(seed: number): GameSetup {
  return {
    awayTeamId: 'coralkey',
    homeTeamId: 'ironport',
    stadiumId: 'anchor-yard',
    innings: 9,
    difficulty: 'pro',
    awayControl: 'cpu',
    homeControl: 'cpu',
    night: false,
    seed,
  };
}

function freshGame(seed: number): GameState {
  const setup = setupFor(seed);
  return createGameState(setup, teamById(league, setup.awayTeamId), teamById(league, setup.homeTeamId));
}

function run(state: GameState, ticks: number): void {
  const inputs = emptyInputPair();
  for (let i = 0; i < ticks && state.phase !== 'final'; i++) stepGame(state, inputs);
}

/** Exactly what localStorage does to a snapshot on the way out and back. */
function throughStorage(state: GameState): GameState {
  const wire = JSON.parse(JSON.stringify(snapshotGame(state, 'quick')));
  const restored = restoreGame(wire);
  expect(restored).not.toBeNull();
  return restored!.state;
}

/** A total ordering-stable fingerprint of a game, generator position included. */
function fingerprint(state: GameState): string {
  return JSON.stringify(snapshotGame(state, 'quick'));
}

describe('resuming a game', () => {
  it('restores a game that continues identically for minutes of play', () => {
    // Far enough in that there are runners, fatigue, statistics and a
    // generator that has been drawn from thousands of times.
    const original = freshGame(4471);
    run(original, 12_000);
    expect(original.phase).not.toBe('final');

    const restored = throughStorage(original);
    expect(fingerprint(restored)).toBe(fingerprint(original));

    // Six more minutes of simulated baseball on both copies.
    const more = Math.ceil(360 / TICK_DT);
    run(original, more);
    run(restored, more);

    expect(fingerprint(restored)).toBe(fingerprint(original));
    // Guards against the two copies having simply stalled in the same place.
    expect(original.diag.pitches).toBeGreaterThan(20);
  });

  it('survives a save taken mid-flight, with the ball in the air', () => {
    // The interesting moment is not between pitches. It is the one where a
    // pitch is in the air, a swing is pending, and a fielder is already moving.
    let caught = 0;
    for (const seed of [11, 907, 3311, 50021]) {
      const g = freshGame(seed);
      const inputs = emptyInputPair();
      for (let i = 0; i < 40_000 && g.phase !== 'final'; i++) {
        stepGame(g, inputs);
        if (g.phase !== 'inplay' || g.ball.y < 1.5) continue;
        caught++;
        const restored = throughStorage(g);
        expect(fingerprint(restored)).toBe(fingerprint(g));
        run(g, 4_000);
        run(restored, 4_000);
        expect(fingerprint(restored)).toBe(fingerprint(g));
        break;
      }
    }
    // The assertion above is worthless if the loop never found a live ball.
    expect(caught).toBe(4);
  });

  it('refuses anything it cannot vouch for', () => {
    const g = freshGame(77);
    run(g, 3_000);
    const good = JSON.parse(JSON.stringify(snapshotGame(g, 'season')));

    expect(restoreGame(good)?.context).toBe('season');
    expect(restoreGame(null)).toBeNull();
    expect(restoreGame({})).toBeNull();
    expect(restoreGame('nope')).toBeNull();
    expect(restoreGame({ ...good, v: RESUME_VERSION + 1 })).toBeNull();
    expect(restoreGame({ ...good, rng: 'x' })).toBeNull();
    expect(restoreGame({ ...good, state: { ...(good.state as object), fielders: [] } })).toBeNull();
    expect(restoreGame({ ...good, state: { ...(good.state as object), away: null } })).toBeNull();
    // A game that is over has nothing to go back to.
    expect(
      restoreGame({ ...good, state: { ...(good.state as object), gameOver: true } }),
    ).toBeNull();
    // An unrecognised context becomes a plain exhibition rather than a crash.
    expect(restoreGame({ ...good, context: 'wat' })?.context).toBe('quick');
  });

  it('describes the situation well enough to choose from a menu', () => {
    const g = freshGame(313);
    run(g, 9_000);
    const text = describeSituation(g);
    expect(text).toMatch(/^(Top|Bottom) \d+ · [A-Z]{2,3} \d+ — \d+ [A-Z]{2,3} · \d out, /);
    expect(text).toMatch(/bases empty|occupied/);
  });

  it('fits in a storage quota with room to spare', () => {
    // localStorage is 5 MB in every browser that matters and the season save
    // shares it. A snapshot that grew into megabytes would start silently
    // failing to write, which is exactly the failure this feature exists to
    // prevent — so the size is a test, not an assumption.
    const g = freshGame(2024);
    run(g, 20_000);
    const bytes = JSON.stringify(snapshotGame(g, 'quick')).length;
    expect(bytes).toBeGreaterThan(1_000);
    expect(bytes).toBeLessThan(600_000);
  });
});
