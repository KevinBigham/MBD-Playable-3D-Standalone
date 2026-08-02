import { describe, expect, it } from 'vitest';
import type { GameSetup } from '../core/types';
import { buildLeague, teamById } from '../data/teams';
import { createGameState, type GameState } from '../sim/state';
import { stepGame } from '../sim/game';
import { clearEdges, emptyInputPair } from '../sim/input';
import { screenToZone } from '../ui/zonepick';
import { controlLabels } from '../ui/controls';

/**
 * TOUCH WHERE THE BALL WILL CROSS
 * ------------------------------
 * The phone control scheme makes one promise, and it is a large one: put a
 * finger on the spot the pitch is going to cross and the swing happens *there*.
 * Not near there, not steered toward there — there.
 *
 * That promise has two halves, and both are tested below.
 *
 *   1. The engine takes a place, not a direction. A tap is a single act of
 *      pointing and the cursor lands on it exactly, clamped to the same limits
 *      a stick could reach and no further.
 *   2. Doing it produces a hit. A tap at the crossing point, at the right
 *      moment, has to actually barrel the ball — otherwise the scheme is a
 *      gesture that looks right and plays wrong.
 *
 * The second is the one worth having, and it is written as the whole precision
 * curve rather than a pass mark: on the spot is hard contact every time, a
 * hand's width off is in play but never hard, a forearm off is a foul, and
 * forty centimetres off is a swing through it. Stating it that way means the
 * test fails if the scheme ever stops rewarding accuracy — which would make it
 * a button with extra steps — as readily as if it stopped working at all.
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

/** Runs to the first pitch thrown to the human and stops with it in the air. */
function toLivePitch(state: GameState): boolean {
  const inputs = emptyInputPair();
  for (let i = 0; i < 120 * 60 * 4; i++) {
    clearEdges(inputs.p1);
    clearEdges(inputs.p2);
    inputs.p1.pitchSlot =
      state.half === 'bottom' && state.phase === 'preplay' && state.pitcher.ready <= 0 ? 0 : -1;
    stepGame(state, inputs);
    if (state.half === 'top' && state.phase === 'pitch' && state.currentPitch) return true;
  }
  return false;
}

/**
 * Swings by touching (`offX`, `offY`) metres away from where the pitch will
 * actually cross, at the moment it crosses. Returns how well it was struck.
 */
function tapAt(seed: number, offX: number, offY: number): { grade: string } {
  const state = situation(seed);
  if (!toLivePitch(state)) throw new Error('never saw a pitch');
  const info = state.currentPitch!;
  const inputs = emptyInputPair();

  for (let i = 0; i < 120 * 4; i++) {
    clearEdges(inputs.p1);
    clearEdges(inputs.p2);
    // One touch, at the moment a hitter would commit. It carries the place and
    // the instant together, which is the whole idea.
    if (state.phase === 'pitch' && state.batter.swingT < 0 && state.ball.t >= info.T - 0.16) {
      inputs.p1.aimAbsolute = true;
      inputs.p1.aimX = info.plateX + offX;
      inputs.p1.aimY = info.plateY + offY;
      inputs.p1.swing = true;
    }
    stepGame(state, inputs);
    if (state.lastSwing) {
      return { grade: state.lastSwing.grade };
    }
  }
  throw new Error('the swing never resolved');
}

describe('touching the zone', () => {
  it('puts the cursor exactly where it was told, not near it', () => {
    const state = situation(4242);
    expect(toLivePitch(state)).toBe(true);
    const inputs = emptyInputPair();
    inputs.p1.aimAbsolute = true;
    inputs.p1.aimX = -0.19;
    inputs.p1.aimY = 1.07;
    stepGame(state, inputs);
    expect(state.batter.cx).toBeCloseTo(-0.19, 9);
    expect(state.batter.cy).toBeCloseTo(1.07, 9);
  });

  it('cannot reach anywhere a stick could not', () => {
    const state = situation(4242);
    expect(toLivePitch(state)).toBe(true);
    const inputs = emptyInputPair();
    inputs.p1.aimAbsolute = true;
    inputs.p1.aimX = 40;
    inputs.p1.aimY = -40;
    stepGame(state, inputs);
    // The same clamp the relative path uses: half a metre either side of the
    // plate, and between the shins and the shoulders of the tallest hitter.
    expect(state.batter.cx).toBeCloseTo(0.52, 6);
    expect(state.batter.cy).toBeCloseTo(0.28, 6);
  });

  it('leaves the stick alone when nothing was touched', () => {
    const state = situation(4242);
    expect(toLivePitch(state)).toBe(true);
    state.batter.cx = 0;
    state.batter.cy = 1;
    const inputs = emptyInputPair();
    inputs.p1.moveX = 1;
    for (let i = 0; i < 20; i++) stepGame(state, inputs);
    // Steering still steers. The absolute path is an addition, not a takeover.
    expect(state.batter.cx).toBeGreaterThan(0.05);
  });

  it('turns a touch on the crossing point into hard contact, and rewards precision', () => {
    // The promise, measured, and written as the whole curve rather than a
    // threshold — because "does touching the right spot work" and "does missing
    // it cost you" are the same question asked twice, and a control scheme is
    // only honest if the second answer is yes.
    const seeds = [101, 202, 303, 404, 505, 606, 707, 808];
    const grades = (ox: number, oy: number) => seeds.map((s) => tapAt(s, ox, oy).grade);
    const hard = (g: string) => g === 'solid' || g === 'barreled';

    // On the spot: struck hard, every single time.
    expect(grades(0, 0).every(hard)).toBe(true);
    // A hand's width high: still in play, never hard.
    const nearMiss = grades(0, 0.12);
    expect(nearMiss.every((g) => g !== 'miss')).toBe(true);
    expect(nearMiss.some(hard)).toBe(false);
    // A forearm's width: fouled off, every time.
    expect(grades(0, 0.24).every((g) => g === 'foul' || g === 'foultip')).toBe(true);
    // Forty centimetres: swung straight through it.
    expect(grades(0, 0.4).every((g) => g === 'miss')).toBe(true);
    // The zone is narrower than it is tall, so sideways is less forgiving.
    expect(grades(0.3, 0).filter((g) => g === 'miss').length).toBeGreaterThanOrEqual(5);
  });

  it('places a pitch where the mound touched, not where the last one went', () => {
    const state = situation(9001);
    const inputs = emptyInputPair();
    // Run to the bottom half, where the human is on the mound.
    for (let i = 0; i < 120 * 60 * 4 && !(state.half === 'bottom' && state.phase === 'preplay'); i++) {
      clearEdges(inputs.p1);
      stepGame(state, inputs);
    }
    expect(state.half).toBe('bottom');
    state.pitcher.ready = 0;
    for (let i = 0; i < 240 && state.phase !== 'preplay'; i++) stepGame(state, inputs);

    clearEdges(inputs.p1);
    inputs.p1.aimAbsolute = true;
    inputs.p1.aimX = -0.28;
    inputs.p1.aimY = 0.62;
    inputs.p1.pitchSlot = 0;
    stepGame(state, inputs);

    // The aim is taken from the touch in the same step that throws it, so a
    // pitcher never throws to the spot he was looking at a moment ago.
    expect(state.pitcher.aimX).toBeCloseTo(-0.28, 9);
    expect(state.pitcher.aimY).toBeCloseTo(0.62, 9);
    expect(state.currentPitch?.aimX).toBeCloseTo(-0.28, 9);
    expect(state.currentPitch?.aimY).toBeCloseTo(0.62, 9);
  });

  it('relabels the diamond so it stops claiming to swing', () => {
    const state = situation(4242);
    expect(toLivePitch(state)).toBe(true);
    const buttons = controlLabels(state, false);
    const touching = controlLabels(state, false, { active: true, swingMode: 'contact' });
    // The button that used to say SWING now says which swing, because the
    // swinging is done with a finger on the zone.
    expect(buttons.diamondDown).toBe('SWING');
    expect(touching.diamondDown).toBe('CONTACT');
    expect(touching.stick).toContain('TOUCH');
    expect(touching.verb).toBe('CONTACT SWING');
    expect(controlLabels(state, false, { active: true, swingMode: 'power' }).verb).toBe(
      'POWER SWING',
    );
  });
});

/**
 * The screen-to-plate solve, against a hand-written camera. A pinhole with a
 * perspective divide is enough to catch the failures that matter: an inverse
 * that is subtly wrong, or one that silently returns a plausible answer when
 * the camera is not looking at the plate at all.
 */
describe('finding the plate from a pixel', () => {
  /** Camera 20 m behind the plate at head height, looking down the line. */
  const project = (x: number, y: number, z: number) => {
    const d = 20 + z;
    return { x: 0.5 + (x * 1.6) / d, y: 0.5 - ((y - 1.0) * 1.6) / d };
  };

  it('inverts its own projection to sub-millimetre accuracy', () => {
    for (const [x, y] of [
      [0, 1.0],
      [0.2, 0.6],
      [-0.35, 1.4],
      [0.48, 0.31],
      [-0.5, 1.45],
    ] as const) {
      const s = project(x, y, 0.62);
      const back = screenToZone(project, s.x, s.y);
      expect(back).not.toBeNull();
      expect(back!.x).toBeCloseTo(x, 6);
      expect(back!.y).toBeCloseTo(y, 6);
    }
  });

  it('converges from a bad starting guess', () => {
    const s = project(0.44, 0.35, 0.62);
    const back = screenToZone(project, s.x, s.y, { x: -0.5, y: 1.45 });
    expect(back!.x).toBeCloseTo(0.44, 6);
    expect(back!.y).toBeCloseTo(0.35, 6);
  });

  it('says nothing rather than guessing when the camera is edge-on', () => {
    // A projection with no horizontal extent: every point on the plate lands on
    // the same pixel, so a pixel cannot name a point. The honest answer is null.
    const degenerate = (_x: number, y: number) => ({ x: 0.5, y: 0.5 - y * 0.1 });
    expect(screenToZone(degenerate, 0.3, 0.5)).toBeNull();
  });
});
