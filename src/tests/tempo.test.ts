import { describe, expect, it } from 'vitest';
import { DEFAULT_PITCH_TEMPO, PITCH_TEMPO } from '../core/constants';
import { PITCHES } from '../data/pitches';
import { launchPitch, makeBall, pitchPositionAt, stepPitch } from '../sim/physics';
import { buildLeague } from '../data/teams';
import { simulateGame } from '../sim/autoplay';
import type { GameSetup, PitchTempo } from '../core/types';

/**
 * PITCH TEMPO
 * -----------
 * The pitch clock is stretched so a human has time to read a pitch and pick a
 * swing. The claim that makes that defensible rather than a fudge is a narrow
 * one, and it is the claim these tests hold:
 *
 *   1. the ball travels the same line through space at every tempo — only
 *      slower, never on a loopier arc;
 *   2. the pitcher gains no extra steering authority from the extra seconds;
 *   3. the CPU is not made worse by it, because it commits a fixed number of
 *      seconds before arrival rather than a fraction of the flight.
 */

const ORDER: PitchTempo[] = ['brisk', 'standard', 'relaxed'];

function fire(timeScale: number, speed = 40) {
  const ball = makeBall();
  launchPitch(ball, {
    speed,
    targetX: 0.1,
    targetY: 0.8,
    breakX: -0.3,
    breakY: -0.4,
    lateness: 0.6,
    releaseX: -0.42,
    timeScale,
  });
  return ball;
}

describe('the pitch clock stretches without bending the pitch', () => {
  it('takes strictly longer as the tempo relaxes', () => {
    const times = ORDER.map((t) => fire(PITCH_TEMPO[t]).pitch!.T);
    expect(times[0]).toBeLessThan(times[1]);
    expect(times[1]).toBeLessThan(times[2]);
  });

  it('leaves the ball on exactly the same path in space', () => {
    // This is the whole justification for scaling the clock instead of the
    // speed: shape the gravity term with the stretched T and a relaxed tempo
    // turns every pitch into an eephus.
    const base = fire(1).pitch!;
    for (const t of ORDER) {
      const slow = fire(PITCH_TEMPO[t]).pitch!;
      for (let u = 0; u <= 1.0001; u += 0.02) {
        const a = pitchPositionAt(base, u * base.T);
        const b = pitchPositionAt(slow, u * slow.T);
        expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(1e-9);
      }
    }
  });

  it('crosses the plate on the same spot at every tempo', () => {
    const at = (t: PitchTempo) => {
      const p = fire(PITCH_TEMPO[t]).pitch!;
      return pitchPositionAt(p, p.T);
    };
    const a = at('brisk');
    for (const t of ORDER) {
      const b = at(t);
      expect(b.x).toBeCloseTo(a.x, 9);
      expect(b.y).toBeCloseTo(a.y, 9);
    }
  });

  it('gives the pitcher no extra steering for the extra seconds', () => {
    // Steering integrates on the pitch's own clock. Without that, a relaxed
    // tempo would quietly hand the pitcher back the advantage it just gave the
    // hitter — and steering is how a pitcher rescues a badly aimed pitch.
    const steer = (timeScale: number) => {
      const ball = fire(timeScale);
      const dt = 1 / 480;
      while (!stepPitch(ball, dt, 1, 1, 1)) {
        /* hold the stick hard the whole way */
      }
      return { x: ball.pitch!.steerX, y: ball.pitch!.steerY };
    };
    const brisk = steer(1);
    for (const t of ORDER) {
      const s = steer(PITCH_TEMPO[t]);
      // Not bit-identical: the steering integrator takes a different number of
      // Euler steps to cover the same pitch-clock distance. A ~2e-4 m residual
      // against a 0.34 m saturation cap is discretisation, not authority.
      expect(s.x).toBeCloseTo(brisk.x, 3);
      expect(s.y).toBeCloseTo(brisk.y, 3);
    }
  });

  it('defaults to a window a person can actually think inside', () => {
    // A four-seamer from an average arm. Real baseball is ~0.42 s; the deeper
    // mound alone got to 0.45 s, which still is not a decision.
    const p = PITCHES.fastball;
    const speed = p.speed + p.speedSpan * 0.5;
    const T = fire(PITCH_TEMPO[DEFAULT_PITCH_TEMPO], speed).pitch!.T;
    expect(T).toBeGreaterThan(0.55);
    expect(T).toBeLessThan(0.72);
  });
});

describe('tempo does not disturb the game underneath it', () => {
  const league = buildLeague();

  function play(tempo: PitchTempo, seed: number) {
    const setup: GameSetup = {
      awayTeamId: league[0].id,
      homeTeamId: league[1].id,
      stadiumId: 'meridian',
      innings: 9,
      difficulty: 'pro',
      awayControl: 'cpu',
      homeControl: 'cpu',
      night: false,
      seed,
      pitchTempo: tempo,
    };
    return simulateGame(setup, league[0], league[1]);
  }

  it('completes cleanly at every tempo', () => {
    for (const t of ORDER) {
      const r = play(t, 7714);
      expect(r.anomalies).toEqual([]);
      expect(r.state.diag.forcedResolutions).toBe(0);
    }
  });

  it('does not turn the CPU into a different hitter', () => {
    // The CPU reads a pitch `react` seconds before it arrives, not a fraction
    // of the way through, so a longer flight moves its decision later by the
    // same amount and its results should stay in the same neighbourhood.
    const GAMES = 8;
    const runs: Record<string, number> = {};
    const ks: Record<string, number> = {};
    for (const t of ORDER) {
      let r = 0;
      let k = 0;
      for (let i = 0; i < GAMES; i++) {
        const rep = play(t, 4400 + i * 97);
        r += rep.state.stats.away.runs + rep.state.stats.home.runs;
        for (const side of ['away', 'home'] as const) {
          for (const line of Object.values(rep.state.stats[side].batting)) k += line.so;
        }
      }
      runs[t] = r / GAMES;
      ks[t] = k / GAMES;
    }
    for (const t of ORDER) {
      expect(Math.abs(runs[t] - runs.brisk)).toBeLessThan(4);
      expect(Math.abs(ks[t] - ks.brisk)).toBeLessThan(5);
    }
  }, 60_000);
});
