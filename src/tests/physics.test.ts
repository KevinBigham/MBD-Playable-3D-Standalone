import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../core/constants';
import type { Stadium } from '../core/types';
import { getStadium } from '../data/stadiums';
import {
  horizontalDist,
  canBeFlyOut,
  isFair,
  launchFree,
  makeBall,
  predictLanding,
  sprayAngleDeg,
  stepFree,
} from '../sim/physics';

/**
 * These tests pin the ball-flight calibration in place. The numbers come from
 * scripts/tune-physics.ts; if DRAG_K, MAGNUS_K or the integrator are retuned,
 * this file is the thing that has to be argued with first.
 */

/**
 * A wall-less, windless clone of a real park. Fly-ball carry has to be measured
 * without a fence in the way, otherwise a "distance" reading is really a
 * measurement of where the outfield wall happens to be.
 */
function openPark(carry: number): Stadium {
  const base = getStadium('comet-dome');
  return {
    ...base,
    carry,
    wind: { x: 0, z: 0 },
    fence: [
      { angle: -45, dist: 600, height: 200 },
      { angle: 0, dist: 600, height: 200 },
      { angle: 45, dist: 600, height: 200 },
    ],
  };
}

const NEUTRAL = openPark(1.0);

interface Flight {
  dist: number;
  x: number;
  z: number;
  hang: number;
}

/** Integrates a batted ball until it first touches the ground. */
function fly(
  opts: {
    exitVelo: number;
    angleDeg: number;
    spin?: number;
    sideSpin?: number;
    stadium?: Stadium;
    carry?: number;
    dt?: number;
    sprayDeg?: number;
  },
): Flight {
  const stadium = opts.stadium ?? NEUTRAL;
  const carry = opts.carry ?? stadium.carry;
  const dt = opts.dt ?? TICK_DT;
  const la = (opts.angleDeg * Math.PI) / 180;
  const sa = ((opts.sprayDeg ?? 0) * Math.PI) / 180;
  const horiz = opts.exitVelo * Math.cos(la);
  const ball = makeBall();
  launchFree(
    ball,
    0,
    1.0,
    0.62,
    horiz * Math.sin(sa),
    opts.exitVelo * Math.sin(la),
    horiz * Math.cos(sa),
    'batted',
    opts.spin ?? 1.0,
    opts.sideSpin ?? 0,
  );
  let t = 0;
  for (let i = 0; i < 200_000; i++) {
    const res = stepFree(ball, dt, stadium, carry);
    t += dt;
    if (res.landed) break;
  }
  return { dist: horizontalDist(ball.x, ball.z), x: ball.x, z: ball.z, hang: t };
}

describe('batted-ball carry calibration', () => {
  it('sends 45 m/s at 28 degrees roughly 120 m in a neutral park', () => {
    // The reference point the whole hitting model is balanced around: a
    // well-struck ball is a home run in most parks but not all of them.
    const d = fly({ exitVelo: 45, angleDeg: 28 }).dist;
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(130);
  });

  it('carries further the harder the ball is hit, at every fixed launch angle', () => {
    for (const angle of [12, 20, 28, 35]) {
      let previous = 0;
      for (const exitVelo of [20, 25, 30, 35, 40, 45, 50, 55]) {
        const d = fly({ exitVelo, angleDeg: angle }).dist;
        expect(d).toBeGreaterThan(previous);
        previous = d;
      }
    }
  });

  it('carries further in a high-altitude park than in a neutral one', () => {
    const summit = getStadium('summit-field');
    // The park's carry rating is a balance-facing number; lock it explicitly.
    expect(summit.carry).toBeCloseTo(1.11, 5);

    const thin = fly({ exitVelo: 45, angleDeg: 28, stadium: openPark(summit.carry) }).dist;
    const neutral = fly({ exitVelo: 45, angleDeg: 28, stadium: NEUTRAL }).dist;
    expect(thin).toBeGreaterThan(neutral + 5);

    // And it holds in the real parks, fences and wind included.
    const realThin = fly({ exitVelo: 45, angleDeg: 28, stadium: summit }).dist;
    const realNeutral = fly({ exitVelo: 45, angleDeg: 28, stadium: getStadium('comet-dome') }).dist;
    expect(realThin).toBeGreaterThan(realNeutral);
  });

  it('is frame-rate independent between 120 Hz and 240 Hz', () => {
    // The engine runs on a fixed step, but nothing about the result may depend
    // on what that step happens to be.
    for (const [exitVelo, angleDeg] of [
      [45, 28],
      [40, 20],
      [50, 35],
      [30, 12],
      [55, 45],
    ] as [number, number][]) {
      const slow = fly({ exitVelo, angleDeg, dt: 1 / 120 });
      const fast = fly({ exitVelo, angleDeg, dt: 1 / 240 });
      const gap = Math.hypot(slow.x - fast.x, slow.z - fast.z);
      expect(gap).toBeLessThan(1.5);
    }
  });
});

describe('ground balls', () => {
  it('always come to a complete stop within a bounded time', () => {
    for (const [exitVelo, angleDeg] of [
      [15, 0],
      [25, 0],
      [35, 2],
      [45, -5],
      [50, 5],
      [40, 8],
    ] as [number, number][]) {
      const la = (angleDeg * Math.PI) / 180;
      const ball = makeBall();
      launchFree(
        ball,
        0,
        0.9,
        0.62,
        0,
        exitVelo * Math.sin(la),
        exitVelo * Math.cos(la),
        'batted',
        0.3,
        0,
      );
      let t = 0;
      let stopped = false;
      for (let i = 0; i < 200_000; i++) {
        stepFree(ball, TICK_DT, NEUTRAL, 1.0);
        t += TICK_DT;
        if (ball.rolling && ball.vx === 0 && ball.vz === 0) {
          stopped = true;
          break;
        }
      }
      // A ball that never stops rolling is a play that never ends.
      expect(stopped).toBe(true);
      expect(t).toBeLessThan(20);
      expect(ball.vy).toBe(0);
    }
  });
});

describe('wall rebounds', () => {
  it('become live balls that cannot be caught for a fly out', () => {
    const stadium = getStadium('comet-dome');
    const fence = stadium.fence.find((point) => point.angle === 0) ?? stadium.fence[0];
    const ball = makeBall();
    launchFree(ball, 0, Math.min(2, fence.height - 0.5), fence.dist - 0.2, 0, 0, 36, 'batted', 0, 0);

    expect(canBeFlyOut(ball)).toBe(true);
    const result = stepFree(ball, TICK_DT, stadium, stadium.carry);

    expect(result.hitWall).toBe(true);
    expect(ball.touched).toBe(true);
    expect(ball.bounces).toBe(0);
    expect(ball.rolling).toBe(false);
    expect(canBeFlyOut(ball)).toBe(false);
  });
});

describe('isFair', () => {
  it('treats the foul lines themselves as fair', () => {
    expect(isFair(10, 10)).toBe(true);
    expect(isFair(-10, 10)).toBe(true);
    expect(isFair(60, 60)).toBe(true);
  });

  it('rejects anything outside the lines', () => {
    expect(isFair(10.01, 10)).toBe(false);
    expect(isFair(-10.01, 10)).toBe(false);
    expect(isFair(1, 0.5)).toBe(false);
    expect(isFair(-1, 0.5)).toBe(false);
  });

  it('accepts balls up the middle and rejects anything behind the plate', () => {
    expect(isFair(0, 1)).toBe(true);
    expect(isFair(0, 130)).toBe(true);
    expect(isFair(0, 0)).toBe(false);
    expect(isFair(0, -1)).toBe(false);
    expect(isFair(5, -5)).toBe(false);
  });

  it('agrees with the spray angle convention at the 45-degree lines', () => {
    // -45 deg is the left-field line, +45 deg the right-field line.
    expect(sprayAngleDeg(-70.71, 70.71)).toBeCloseTo(-45, 3);
    expect(sprayAngleDeg(70.71, 70.71)).toBeCloseTo(45, 3);
    expect(isFair(-70.71, 70.71)).toBe(true);
    expect(isFair(70.71, 70.71)).toBe(true);
  });
});

describe('integrator robustness', () => {
  it('never produces a non-finite value over 2000 steps', () => {
    const stadiums = [getStadium('the-foundry'), getStadium('grove-park'), NEUTRAL];
    const launches: [number, number, number][] = [
      [55, 45, 0], // towering fly that clears everything
      [50, 8, -30], // screamer into the left-field corner
      [12, 60, 5], // pop-up
      [45, -12, 25], // chopper
      [30, 0, 44], // liner down the right-field line
    ];
    for (const stadium of stadiums) {
      for (const [exitVelo, angleDeg, sprayDeg] of launches) {
        const la = (angleDeg * Math.PI) / 180;
        const sa = (sprayDeg * Math.PI) / 180;
        const horiz = exitVelo * Math.cos(la);
        const ball = makeBall();
        launchFree(
          ball,
          0,
          1.0,
          0.62,
          horiz * Math.sin(sa),
          exitVelo * Math.sin(la),
          horiz * Math.cos(sa),
          'batted',
          1.1,
          0.25,
        );
        for (let i = 0; i < 2000; i++) {
          stepFree(ball, TICK_DT, stadium, stadium.carry);
          for (const v of [
            ball.x,
            ball.y,
            ball.z,
            ball.vx,
            ball.vy,
            ball.vz,
            ball.apex,
            ball.groundDist,
            ball.spin,
            ball.sideSpin,
          ]) {
            expect(Number.isFinite(v)).toBe(true);
          }
          // A ball that has left the world is a bug even if it is still finite.
          expect(Math.abs(ball.x)).toBeLessThan(400);
          expect(Math.abs(ball.z)).toBeLessThan(400);
          expect(ball.y).toBeLessThan(200);
          expect(ball.y).toBeGreaterThan(-0.001);
        }
      }
    }
  });
});

describe('predictLanding', () => {
  it('lands within 3 m of the true landing spot for typical fly balls', () => {
    // Fielder routes and the catch marker are both built on this estimate, so
    // the cheap 30 Hz integration has to track the real 120 Hz flight closely.
    for (const [exitVelo, angleDeg, sprayDeg] of [
      [40, 30, 0],
      [45, 28, -20],
      [35, 40, 15],
      [30, 22, 35],
      [48, 25, -8],
    ] as [number, number, number][]) {
      const la = (angleDeg * Math.PI) / 180;
      const sa = (sprayDeg * Math.PI) / 180;
      const horiz = exitVelo * Math.cos(la);
      const ball = makeBall();
      launchFree(
        ball,
        0,
        1.0,
        0.62,
        horiz * Math.sin(sa),
        exitVelo * Math.sin(la),
        horiz * Math.cos(sa),
        'batted',
        1.0,
        0,
      );
      const predicted = predictLanding(ball, NEUTRAL, NEUTRAL.carry);
      const actual = fly({ exitVelo, angleDeg, sprayDeg });
      expect(Math.hypot(predicted.x - actual.x, predicted.z - actual.z)).toBeLessThan(3);
      expect(Math.abs(predicted.t - actual.hang)).toBeLessThan(0.35);
    }
  });

  it('reports the current position for a ball that is already rolling', () => {
    const ball = makeBall();
    launchFree(ball, 4, 0.037, 30, 6, 0, 12, 'batted', 0, 0);
    ball.rolling = true;
    const p = predictLanding(ball, NEUTRAL, NEUTRAL.carry);
    expect(p.x).toBe(ball.x);
    expect(p.z).toBe(ball.z);
    expect(p.t).toBe(0);
  });
});
