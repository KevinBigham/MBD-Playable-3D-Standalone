import { describe, expect, it } from 'vitest';
import type { GameSetup } from '../core/types';
import { TICK_DT } from '../core/constants';
import { buildLeague, teamById } from '../data/teams';
import { createGameState, type GameState } from '../sim/state';
import { stepGame } from '../sim/game';
import { clearEdges, emptyInputPair } from '../sim/input';

/**
 * WHEN YOU PRESSED, NOT WHEN WE NOTICED
 * -------------------------------------
 * Input is read once per rendered frame. A press therefore reaches the engine
 * somewhere between zero and one frame after the thumb moved — 0 to 17 ms on a
 * 60 Hz phone, and *which* is pure luck about where the frame boundary fell.
 * Against a swing tolerance measured in tens of milliseconds that is not a
 * rounding error; it is a random handicap applied to every swing, biased
 * entirely toward late.
 *
 * InputFrame.pressAge carries the measured delay, and the engine backdates the
 * swing by it. The test that matters is the second one below: pressing late by
 * exactly the delay, and declaring the delay, must be indistinguishable from
 * having pressed on time. If that holds, the correction is exact rather than
 * approximate — and `timingNorm` is a pure function of the numbers involved, no
 * random draw anywhere in it, so "indistinguishable" can mean identical.
 */

const league = buildLeague();

function situation(seed: number): GameState {
  const setup: GameSetup = {
    awayTeamId: 'coralkey',
    homeTeamId: 'ironport',
    stadiumId: 'anchor-yard',
    innings: 9,
    difficulty: 'pro',
    awayControl: 'human1',
    homeControl: 'cpu',
    night: false,
    seed,
  };
  return createGameState(
    setup,
    teamById(league, setup.awayTeamId),
    teamById(league, setup.homeTeamId),
  );
}

/**
 * Runs to the first pitch thrown to the human, then swings `delayTicks` after
 * the ball passes `swingAtT`, declaring `age` seconds of input lag. Returns the
 * timing the engine recorded, in units of the swing's own tolerance.
 */
function swingWith(seed: number, delayTicks: number, age: number): number {
  const state = situation(seed);
  const inputs = emptyInputPair();
  let armed = -1;

  for (let i = 0; i < 120 * 60 * 5; i++) {
    clearEdges(inputs.p1);
    clearEdges(inputs.p2);
    // The human bats in the top half; in the bottom the engine will not pitch
    // for them, so the game would sit on the mound forever.
    inputs.p1.pitchSlot =
      state.half === 'bottom' && state.phase === 'preplay' && state.pitcher.ready <= 0 ? 0 : -1;

    if (state.half === 'top' && state.phase === 'pitch' && state.currentPitch) {
      const p = state.currentPitch;
      // Park the cursor on the ball so the swing resolves on timing alone.
      state.batter.cx = p.plateX;
      state.batter.cy = p.plateY;
      if (armed < 0 && state.ball.t >= p.T - 0.2) armed = i;
      if (armed >= 0 && i === armed + delayTicks && state.batter.swingT < 0) {
        inputs.p1.swing = true;
        inputs.p1.pressAge = age;
      }
    }

    stepGame(state, inputs);
    if (state.lastSwing) return state.lastSwing.timingNorm;
  }
  throw new Error('never got a swing away');
}

describe('press timing', () => {
  it('reads an aged press as earlier than an unaged one', () => {
    const onTime = swingWith(8801, 0, 0);
    const aged = swingWith(8801, 0, 1 / 60);
    expect(aged).toBeLessThan(onTime);
  });

  it('makes a late press with a declared delay identical to an on-time one', () => {
    // Two rendered frames of lag at 60 Hz, expressed exactly in ticks so the
    // arithmetic has nowhere to hide.
    for (const [seed, ticks] of [
      [8801, 2],
      [8801, 4],
      [1229, 2],
      [1229, 6],
      [4404, 4],
    ] as const) {
      const onTime = swingWith(seed, 0, 0);
      const lateButDeclared = swingWith(seed, ticks, ticks * TICK_DT);
      expect(lateButDeclared).toBeCloseTo(onTime, 9);
    }
  });

  it('leaves an undeclared late press late, which is the problem being solved', () => {
    // The control: without the correction, those same two frames of lag are a
    // real and entirely accidental timing penalty.
    const onTime = swingWith(8801, 0, 0);
    const lateAndSilent = swingWith(8801, 4, 0);
    expect(lateAndSilent).toBeGreaterThan(onTime);
    expect(lateAndSilent - onTime).toBeGreaterThan(0.05);
  });

  it('refuses to be handed an implausible delay', () => {
    // A front end that reports half a second of lag — a stalled tab, a broken
    // clock, or somebody being creative — must not get half a second of free
    // prescience. The engine caps what it will backdate.
    const capped = swingWith(8801, 0, 0.5);
    // Whatever was claimed, what was credited is the ceiling: two frames at
    // 30 Hz, and not a millisecond of the remaining 433.
    expect(capped).toBeCloseTo(swingWith(8801, 0, 1 / 15), 9);
    expect(capped).toBeLessThan(swingWith(8801, 0, 1 / 60));
    expect(capped).toBeGreaterThan(swingWith(8801, 0, 0.5 - 0.001) - 1e-9);
  });
});
