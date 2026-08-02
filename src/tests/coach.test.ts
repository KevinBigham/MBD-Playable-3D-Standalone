import { describe, expect, it } from 'vitest';
import type { GameSetup } from '../core/types';
import { buildLeague, teamById } from '../data/teams';
import { createGameState, type GameState } from '../sim/state';
import { stepGame } from '../sim/game';
import { clearEdges, emptyInputPair } from '../sim/input';
import { Coach, LEARNED_AFTER } from '../ui/coach';

/**
 * TEACHING THE TOUCH SCHEME, AND THEN SHUTTING UP
 * -----------------------------------------------
 * Two halves of one idea, tested together because either alone is a bug.
 *
 * The hint has to appear, or the best control scheme in the game is invisible
 * and a new player presses the button marked CONTACT and watches strike three.
 * And it has to go away — permanently, after a handful of swings — or it stops
 * being a hint and becomes a caption, which is a thing people learn to stop
 * seeing and which sits on the screen forever taking up the space the verdict
 * needs.
 *
 * The second half also tests where the picture comes from: the engine records
 * where the bat was and where the ball was on every swing, and those four
 * numbers are the entire "here is how far off you were" display. If they drift
 * from the swing they describe, the game teaches the wrong lesson confidently,
 * which is worse than teaching nothing.
 */

describe('the first-swing coach', () => {
  it('tells a new player what to touch, at the plate and on the mound', () => {
    const coach = new Coach({ swings: 0, pitches: 0 });
    expect(coach.hint('swing')).toContain('TOUCH');
    expect(coach.hint('aim')).toContain('TOUCH');
    expect(coach.hint('pitch')).toContain('TOUCH');
    // Different jobs, different sentences.
    expect(coach.hint('swing')).not.toBe(coach.hint('pitch'));
  });

  it('says nothing at all when the field is not the control', () => {
    const coach = new Coach({ swings: 0, pitches: 0 });
    expect(coach.hint('off')).toBeNull();
  });

  it('stops after a handful of swings, and stays stopped', () => {
    const coach = new Coach({ swings: 0, pitches: 0 });
    for (let i = 0; i < LEARNED_AFTER; i++) {
      expect(coach.hint('swing')).not.toBeNull();
      coach.note('contact');
    }
    expect(coach.hint('swing')).toBeNull();
    // And a fourth swing does not wrap a counter back around.
    coach.note('power');
    expect(coach.hint('swing')).toBeNull();
  });

  it('does not count moving the cursor as having swung', () => {
    // Somebody sliding a finger around the zone waiting on the windup has not
    // yet done the thing the hint is asking for. Counting it would retire the
    // hint before it taught anybody anything.
    const coach = new Coach({ swings: 0, pitches: 0 });
    for (let i = 0; i < LEARNED_AFTER * 3; i++) coach.note('aim');
    expect(coach.hint('swing')).not.toBeNull();
    expect(coach.counts.swings).toBe(0);
  });

  it('learns batting and pitching separately', () => {
    const coach = new Coach({ swings: 0, pitches: 0 });
    for (let i = 0; i < LEARNED_AFTER; i++) coach.note('contact');
    expect(coach.hint('swing')).toBeNull();
    // A hundred swings says nothing about whether this person has ever stood on
    // a mound.
    expect(coach.hint('pitch')).not.toBeNull();
  });

  it('survives a memory that has been corrupted or hand-edited', () => {
    const bad = { swings: NaN, pitches: -8 } as unknown as { swings: number; pitches: number };
    const coach = new Coach(bad);
    expect(coach.counts).toEqual({ swings: 0, pitches: 0 });
    expect(coach.hint('swing')).not.toBeNull();
  });

  it('can be handed back', () => {
    const coach = new Coach({ swings: 9, pitches: 9 });
    expect(coach.learned).toBe(true);
    coach.reset();
    expect(coach.hint('swing')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------

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

describe('what the swing picture is drawn from', () => {
  it('records where the bat was and where the ball was, on the swing it describes', () => {
    const state = situation(7788);
    const inputs = emptyInputPair();

    // Run to a live pitch thrown at the human.
    let sawPitch = false;
    for (let i = 0; i < 120 * 60 * 4 && !sawPitch; i++) {
      clearEdges(inputs.p1);
      inputs.p1.pitchSlot =
        state.half === 'bottom' && state.phase === 'preplay' && state.pitcher.ready <= 0 ? 0 : -1;
      stepGame(state, inputs);
      sawPitch = state.half === 'top' && state.phase === 'pitch' && !!state.currentPitch;
    }
    expect(sawPitch).toBe(true);
    const info = state.currentPitch!;

    // Swing deliberately high and inside of it, so the two points are far apart
    // and a mix-up between them could not pass unnoticed.
    const aimX = info.plateX - 0.18;
    const aimY = info.plateY + 0.22;
    for (let i = 0; i < 120 * 4 && !state.lastSwing; i++) {
      clearEdges(inputs.p1);
      if (state.phase === 'pitch' && state.batter.swingT < 0 && state.ball.t >= info.T - 0.16) {
        inputs.p1.aimAbsolute = true;
        inputs.p1.aimX = aimX;
        inputs.p1.aimY = aimY;
        inputs.p1.swing = true;
      }
      stepGame(state, inputs);
    }

    const s = state.lastSwing;
    expect(s).not.toBeNull();
    // Where the finger went…
    expect(s!.atX).toBeCloseTo(aimX, 9);
    expect(s!.atY).toBeCloseTo(aimY, 9);
    // …and where the ball actually was. The gap between them is the whole
    // display, so they must be two different measurements and not the same one
    // written down twice.
    expect(s!.ballX).toBeCloseTo(info.plateX, 9);
    expect(s!.ballY).toBeCloseTo(info.plateY, 9);
    expect(Math.hypot(s!.atX - s!.ballX, s!.atY - s!.ballY)).toBeGreaterThan(0.2);
  });
});
