import { describe, expect, it } from 'vitest';
import { buildLeague, teamById } from '../data/teams';
import { createGameState } from '../sim/state';
import { stepGame } from '../sim/game';
import { emptyInputPair } from '../sim/input';
import { simulateGame } from '../sim/autoplay';
import { TICK_DT } from '../core/constants';
import type { GameSetup } from '../core/types';

/**
 * A foul fly that is caught is an out AND the end of the plate appearance.
 * Treating it as an ordinary foul left the retired batter at the plate, taking
 * pitches with three outs already on the scoreboard, and double-counted his
 * plate appearance so the batting order drifted.
 */

const league = buildLeague();

function setupFor(seed: number): { setup: GameSetup; awayId: string; homeId: string } {
  const away = league[seed % 10];
  const home = league[(seed * 3 + 1) % 10];
  const a = away.id === home.id ? league[(seed + 1) % 10] : away;
  return {
    awayId: a.id,
    homeId: home.id,
    setup: {
      awayTeamId: a.id,
      homeTeamId: home.id,
      stadiumId: 'thunder-ridge',
      innings: 9,
      difficulty: 'pro',
      awayControl: 'cpu',
      homeControl: 'cpu',
      night: false,
      seed,
    },
  };
}

describe('caught foul fly', () => {
  // The exact seeds an independent evaluator reproduced the defect on.
  const REPORTED = [56433, 1000, 88109, 499897, 761224, 832495, 1109660, 1252202, 1386825, 325679];

  it('never leaves a team batting with three outs recorded', () => {
    const inputs = emptyInputPair();
    for (const seed of REPORTED) {
      const { setup, awayId, homeId } = setupFor(seed);
      const state = createGameState(setup, teamById(league, awayId), teamById(league, homeId));
      let illegal = 0;
      for (let t = 0; t < 120 * 60 * 90 && state.phase !== 'final'; t++) {
        stepGame(state, inputs);
        const between =
          state.phase === 'preplay' || state.phase === 'windup' || state.phase === 'pitch';
        if (state.outs >= 3 && between) illegal++;
      }
      expect({ seed, illegalSeconds: +(illegal * TICK_DT).toFixed(2) }).toEqual({
        seed,
        illegalSeconds: 0,
      });
      expect(state.phase).toBe('final');
    }
  });

  it('keeps the batting order strictly cyclical across a full game', () => {
    for (const seed of REPORTED.slice(0, 5)) {
      const { setup, awayId, homeId } = setupFor(seed);
      const rep = simulateGame(setup, teamById(league, awayId), teamById(league, homeId), {});
      expect(rep.completed).toBe(true);
      expect(rep.anomalies).toEqual([]);
      // Within one club, no hitter may have two more plate appearances than
      // another: a strict order can only ever differ by one turn.
      for (const side of ['away', 'home'] as const) {
        const pas = Object.values(rep.state.stats[side].batting)
          .map((l) => l.pa)
          .filter((n) => n > 0);
        if (pas.length < 9) continue;
        expect({ seed, side, spread: Math.max(...pas) - Math.min(...pas) }).toEqual({
          seed,
          side,
          spread: expect.any(Number),
        });
        expect(Math.max(...pas) - Math.min(...pas)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('extra innings are bounded', () => {
  it('resolves one-inning games without running away', () => {
    let worst = 0;
    let extras = 0;
    for (let i = 0; i < 120; i++) {
      const seed = (12838 + i * 4271) >>> 0;
      const { setup, awayId, homeId } = setupFor(seed);
      const rep = simulateGame(
        { ...setup, innings: 1, stadiumId: 'comet-dome' },
        teamById(league, awayId),
        teamById(league, homeId),
        {},
      );
      expect(rep.completed).toBe(true);
      expect(rep.anomalies).toEqual([]);
      if (rep.state.inning > 1) extras++;
      worst = Math.max(worst, rep.state.inning);
    }
    // The sample must actually reach extra innings, or this proves nothing.
    expect(extras).toBeGreaterThan(20);
    // From two innings past regulation a runner starts on second, so a tie
    // cannot drag on for dozens of frames.
    expect(worst).toBeLessThanOrEqual(12);
  });
});
