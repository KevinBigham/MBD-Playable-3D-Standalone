import { describe, expect, it } from 'vitest';
import type { GameSetup } from '../core/types';
import { buildLeague, teamById } from '../data/teams';
import { createGameState, currentBatter, type GameState } from '../sim/state';
import { swingProfile } from '../sim/contact';
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
 * curve rather than a pass mark: on the spot is hard contact every time, part of
 * a sweet spot off is in play but never hard, past the foul plane is a foul, and
 * well outside it is a swing through the ball. Stating it that way means the
 * test fails if the scheme ever stops rewarding accuracy — which would make it a
 * button with extra steps — as readily as if it stopped working at all.
 *
 * The curve is measured in units of the hitter's own sweet spot rather than in
 * centimetres, so it keeps testing the *shape* of the promise when the scale of
 * it is tuned. Written in centimetres it was a test of one difficulty setting
 * wearing the costume of a test of the control scheme.
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
 * Swings by touching (`offX`, `offY`) away from where the pitch will actually
 * cross, at the moment it crosses. Returns how well it was struck.
 *
 * The offsets are in units of *this hitter's own sweet spot*, not centimetres.
 * A given number of centimetres means different things to different hitters and
 * at different difficulties — that is what the contact rating and the assist
 * are — so a test written in centimetres is quietly a test of one hitter on one
 * setting, and it breaks the moment either is tuned. Which it did.
 */
function tapAt(
  seed: number,
  offX: number,
  offY: number,
): { grade: string; vertNorm: number; horizNorm: number } {
  const state = situation(seed);
  if (!toLivePitch(state)) throw new Error('never saw a pitch');
  const info = state.currentPitch!;
  const profile = swingProfile(currentBatter(state), 'contact', state.difficulty, true);
  // Sideways offsets are applied toward the *far* side of the plate. The cursor
  // cannot be pushed outward past the bat's reach — that clamp is what stops a
  // player aiming somewhere a bat cannot go — so on an outside pitch there is
  // no outward offset large enough to miss with, however big a number is asked
  // for. Crossing through the ball to the other side is a real way to be wrong
  // and is the one the clamp does not swallow.
  const away = info.plateX > 0 ? -1 : 1;
  const offMetresX = offX * profile.rx * away;
  const offMetresY = offY * profile.ry;
  const inputs = emptyInputPair();

  for (let i = 0; i < 120 * 4; i++) {
    clearEdges(inputs.p1);
    clearEdges(inputs.p2);
    // One touch, at the moment a hitter would commit. It carries the place and
    // the instant together, which is the whole idea.
    if (state.phase === 'pitch' && state.batter.swingT < 0 && state.ball.t >= info.T - 0.16) {
      inputs.p1.aimAbsolute = true;
      inputs.p1.aimX = info.plateX + offMetresX;
      inputs.p1.aimY = info.plateY + offMetresY;
      inputs.p1.swing = true;
    }
    stepGame(state, inputs);
    if (state.lastSwing) {
      // The achieved offset, not the requested one. The cursor is clamped to
      // where a bat can go, so a tap aimed 60 cm above a high pitch lands lower
      // than it asked to — and a test that assumes otherwise is asserting a
      // swing the game never allowed.
      return {
        grade: state.lastSwing.grade,
        vertNorm: state.lastSwing.vertNorm,
        horizNorm: state.lastSwing.horizNorm,
      };
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

  it('keeps the presentation swing running after a miss ends the pitch', () => {
    const state = situation(4242);
    expect(toLivePitch(state)).toBe(true);
    const info = state.currentPitch!;
    const inputs = emptyInputPair();

    for (let i = 0; i < 120 * 3 && !state.lastSwing; i++) {
      clearEdges(inputs.p1);
      if (state.phase === 'pitch' && state.batter.swingT < 0 && state.ball.t >= info.T - 0.16) {
        inputs.p1.aimAbsolute = true;
        inputs.p1.aimX = info.plateX;
        inputs.p1.aimY = info.plateY > 0.87 ? 0.28 : 1.46;
        inputs.p1.swing = true;
      }
      stepGame(state, inputs);
    }

    expect(state.lastSwing?.grade).toBe('miss');
    expect(state.batter.swingT).toBe(-1);
    expect(state.batter.swingKind).toBe('contact');
    const ruledAt = state.batter.animT;
    expect(ruledAt).toBeGreaterThanOrEqual(0);

    for (let i = 0; i < 24; i++) {
      clearEdges(inputs.p1);
      stepGame(state, inputs);
    }
    expect(state.batter.animT).toBeGreaterThan(ruledAt + 0.15);
    expect(state.batter.swingKind).toBe('contact');
  });

  it('keeps a crossed pitch live for the tripled late timing window', () => {
    const state = situation(4242);
    expect(toLivePitch(state)).toBe(true);
    const info = state.currentPitch!;
    const profile = swingProfile(currentBatter(state), 'contact', state.difficulty, true);
    const inputs = emptyInputPair();
    const targetTimingNorm = 0.6;
    const pressAt = info.T + profile.window * targetTimingNorm - profile.latency;

    // This is well past the old hard 160 ms taken-pitch boundary.
    expect(pressAt - info.T).toBeGreaterThan(0.16);
    for (let i = 0; i < 120 * 3 && !state.lastSwing; i++) {
      clearEdges(inputs.p1);
      if (state.phase === 'pitch' && state.batter.swingT < 0 && state.ball.t >= pressAt) {
        inputs.p1.aimAbsolute = true;
        inputs.p1.aimX = info.plateX;
        inputs.p1.aimY = info.plateY;
        inputs.p1.swing = true;
      }
      stepGame(state, inputs);
    }

    expect(state.lastSwing).not.toBeNull();
    expect(state.lastSwing!.grade).not.toBe('miss');
    expect(state.lastSwing!.timingNorm).toBeCloseTo(targetTimingNorm, 1);
  });

  it('turns a touch on the crossing point into hard contact, and rewards precision', () => {
    // The promise, measured, and written as the whole curve rather than a
    // threshold — because "does touching the right spot work" and "does missing
    // it cost you" are the same question asked twice, and a control scheme is
    // only honest if the second answer is yes.
    const seeds = [101, 202, 303, 404, 505, 606, 707, 808];
    const grades = (ox: number, oy: number) => seeds.map((s) => tapAt(s, ox, oy).grade);
    const hardResult = (r: { grade: string }) => r.grade === 'solid' || r.grade === 'barreled';
    const hard = (g: string) => g === 'solid' || g === 'barreled';

    // On the spot: struck hard, every single time.
    expect(grades(0, 0).every(hard)).toBe(true);
    // Two thirds of a sweet spot high: still in play, never hard.
    const nearMiss = grades(0, 0.62);
    expect(nearMiss.every((g) => g !== 'miss')).toBe(true);
    expect(nearMiss.some(hard)).toBe(false);
    // Past the foul plane: fouled off, every time.
    expect(grades(0, 1.05).every((g) => g === 'foul' || g === 'foultip')).toBe(true);
    // Well outside it: swung straight through. Judged on where the cursor
    // actually ended up, because the clamp stops a tap this far above a high
    // pitch from getting there at all.
    const far = seeds.map((s) => tapAt(s, 0, 1.9));
    const reached = far.filter((r) => Math.abs(r.vertNorm) > 1.38);
    expect(reached.length).toBeGreaterThanOrEqual(4);
    expect(reached.every((r) => r.grade === 'miss')).toBe(true);
    // And nothing that far off was struck well, clamped or not.
    expect(far.some(hardResult)).toBe(false);
    // The sweet spot is narrower than it is tall, so the same miss in
    // centimetres costs more sideways — and stays that way however the assist is
    // tuned, because both axes are scaled by the same figure.
    const profile = swingProfile(currentBatter(situation(101)), 'contact', 'pro', true);
    expect(profile.rx).toBeLessThan(profile.ry);
    // Sideways behaves the same as vertically: what the cursor actually reached
    // past the edge of the bat was swung through.
    const wide = seeds.map((s) => tapAt(s, 1.6, 0));
    const wideReached = wide.filter((r) => Math.abs(r.horizNorm) > 1.3);
    expect(wideReached.length).toBeGreaterThanOrEqual(6);
    expect(wideReached.every((r) => r.grade === 'miss')).toBe(true);
    expect(wide.some(hardResult)).toBe(false);
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
