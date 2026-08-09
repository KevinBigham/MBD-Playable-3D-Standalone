import { describe, expect, it } from 'vitest';
import { BASE_PATH, RUNNER_BASE_SPEED, RUNNER_SPEED_SPAN, attr01 } from '../core/constants';
import type { BatterAttributes, Player } from '../core/types';
import type { RunnerState } from '../sim/state';
import {
  LEAD_PROGRESS,
  ON_BAG_PROGRESS,
  distanceToBase,
  enforceRunnerOrder,
  isOnBase,
  makeRunner,
  occupiedBases,
  computeForces,
  runnerAbs,
  runnerPos,
  setRunnerAbs,
  settleRunnersToBases,
  stepRunner,
  timeToBase,
} from '../sim/runners';

/**
 * Baserunning is the part of the engine most able to produce an impossible
 * board state — two men on a bag, a runner who passed the man ahead, a force
 * that does not exist. These are the guard rails that make those states
 * unreachable no matter what the AI decides.
 */

let uid = 0;
function makePlayer(speed = 60): Player {
  const bat: BatterAttributes = {
    contact: 60,
    power: 60,
    speed,
    arm: 60,
    fielding: 60,
    reaction: 60,
    discipline: 60,
  };
  return {
    id: `runner-${uid++}`,
    firstName: 'Test',
    lastName: 'Runner',
    number: 9,
    bats: 'R',
    throws: 'R',
    primary: 'CF',
    secondary: [],
    body: 'average',
    skinTone: 0.5,
    bat,
  };
}

/** A live runner parked at an exact position along the basepath. */
function runnerAt(abs: number, opts: { isBatter?: boolean; speed?: number } = {}): RunnerState {
  const r = makeRunner(makePlayer(opts.speed ?? 60), 0, opts.isBatter ?? false);
  setRunnerAbs(r, abs);
  r.target = Math.floor(abs);
  return r;
}

describe('computeForces', () => {
  /** Builds the base state for one occupancy pattern and reads back the forces. */
  function forcesFor(occupied: number[], withBatter: boolean): Map<number, number> {
    const runners: RunnerState[] = [];
    const byBase = new Map<RunnerState, number>();
    for (const base of occupied) {
      const r = makeRunner(makePlayer(), base, false);
      runners.push(r);
      byBase.set(r, base);
    }
    let batter: RunnerState | null = null;
    if (withBatter) {
      batter = makeRunner(makePlayer(), 0, true);
      runners.push(batter);
    }
    const forces = computeForces(runners);
    const out = new Map<number, number>();
    for (const [r, target] of forces) {
      // Key the batter as base 0 so the expectations read like a scorecard.
      out.set(r === batter ? 0 : byBase.get(r)!, target);
    }
    return out;
  }

  const ALL_COMBINATIONS: number[][] = [[], [1], [2], [3], [1, 2], [1, 3], [2, 3], [1, 2, 3]];

  it('forces the batter-runner and every runner in an unbroken chain behind him', () => {
    const expected = new Map<string, Array<[number, number]>>([
      ['', [[0, 1]]],
      ['1', [[0, 1], [1, 2]]],
      ['2', [[0, 1]]],
      ['3', [[0, 1]]],
      ['1,2', [[0, 1], [1, 2], [2, 3]]],
      ['1,3', [[0, 1], [1, 2]]],
      ['2,3', [[0, 1]]],
      ['1,2,3', [[0, 1], [1, 2], [2, 3], [3, 4]]],
    ]);
    for (const combo of ALL_COMBINATIONS) {
      const forces = forcesFor(combo, true);
      const want = new Map(expected.get(combo.join(','))!);
      expect({ combo, forces: [...forces].sort() }).toEqual({
        combo,
        forces: [...want].sort(),
      });
    }
  });

  it('forces nobody at all once the batter is no longer a live runner', () => {
    // With no batter-runner there is no lead force, so a runner on first may
    // hold; this is what makes a runner on second taggable rather than forced.
    for (const combo of ALL_COMBINATIONS) {
      expect(forcesFor(combo, false).size).toBe(0);
    }
  });

  it('ignores runners who are already out or have scored', () => {
    const onFirst = makeRunner(makePlayer(), 1, false);
    onFirst.out = true;
    const onSecond = makeRunner(makePlayer(), 2, false);
    onSecond.scored = true;
    const batter = makeRunner(makePlayer(), 0, true);
    const forces = computeForces([onFirst, onSecond, batter]);
    expect(forces.size).toBe(1);
    expect(forces.get(batter)).toBe(1);
    expect(forces.has(onFirst)).toBe(false);
  });

  it('drops the force when the batter himself is out', () => {
    const onFirst = makeRunner(makePlayer(), 1, false);
    const batter = makeRunner(makePlayer(), 0, true);
    batter.out = true;
    expect(computeForces([onFirst, batter]).size).toBe(0);
  });
});

describe('enforceRunnerOrder', () => {
  it('leaves a legal, well-spread set of runners untouched', () => {
    const runners = [runnerAt(1.0), runnerAt(2.0), runnerAt(3.0)];
    const before = runners.map(runnerAbs);
    expect(enforceRunnerOrder(runners)).toBe(false);
    expect(runners.map(runnerAbs)).toEqual(before);
  });

  it('pushes a runner back when he has caught the man in front of him', () => {
    const lead = runnerAt(2.0);
    const trail = runnerAt(2.0); // stacked on the same spot
    expect(enforceRunnerOrder([lead, trail])).toBe(true);

    const positions = [runnerAbs(lead), runnerAbs(trail)].sort((a, b) => b - a);
    expect(positions[0]).toBeCloseTo(2.0, 9);
    expect(positions[0] - positions[1]).toBeGreaterThanOrEqual(0.02 - 1e-9);
  });

  it('repairs a whole pile-up into a strictly ordered line', () => {
    const runners = [runnerAt(2.0), runnerAt(2.0), runnerAt(2.0), runnerAt(2.005)];
    expect(enforceRunnerOrder(runners)).toBe(true);
    const sorted = [...runners].sort((a, b) => runnerAbs(b) - runnerAbs(a));
    for (let i = 1; i < sorted.length; i++) {
      expect(runnerAbs(sorted[i - 1]) - runnerAbs(sorted[i])).toBeGreaterThanOrEqual(0.02 - 1e-9);
    }
  });

  it('pulls back the repaired runner’s target so he does not immediately re-pass', () => {
    const lead = runnerAt(2.0);
    lead.target = 2;
    const trail = runnerAt(2.0);
    trail.target = 4; // was trying to run through the man in front
    enforceRunnerOrder([lead, trail]);
    const pushed = runnerAbs(lead) < runnerAbs(trail) ? lead : trail;
    expect(pushed.target).toBeLessThanOrEqual(Math.floor(2.0 - 0.02));
  });

  it('ignores runners who are out or have scored', () => {
    const live = runnerAt(2.0);
    const dead = runnerAt(2.0);
    dead.out = true;
    const home = runnerAt(2.0);
    home.scored = true;
    expect(enforceRunnerOrder([live, dead, home])).toBe(false);
    expect(runnerAbs(live)).toBeCloseTo(2.0, 9);
    expect(runnerAbs(dead)).toBeCloseTo(2.0, 9);
  });

  it('never pushes a runner behind home plate', () => {
    const runners = [runnerAt(0), runnerAt(0), runnerAt(0)];
    enforceRunnerOrder(runners);
    for (const r of runners) expect(runnerAbs(r)).toBeGreaterThanOrEqual(0);
  });
});

describe('settleRunnersToBases', () => {
  it('drops every runner back to the last base he reached', () => {
    const runners = [runnerAt(1.9), runnerAt(2.4), runnerAt(3.7)];
    settleRunnersToBases(runners);
    expect(runners.map((r) => r.base)).toEqual([1, 2, 3]);
    for (const r of runners) {
      expect(r.progress).toBe(0);
      expect(r.target).toBe(r.base);
      expect(r.isBatter).toBe(false);
      expect(r.mustTag).toBe(false);
      expect(r.cmdTarget).toBeNull();
      expect(r.tagBase).toBe(r.base);
    }
  });

  it('never leaves two runners on the same bag, however they collided', () => {
    const scenarios: number[][] = [
      [2.5, 2.1],
      [1.9, 1.5, 1.1],
      [3.9, 3.4, 3.05],
      [2.99, 2.98, 2.97, 2.96],
      [3.5, 2.5, 1.5, 0.5],
      [1.05, 1.02],
    ];
    for (const positions of scenarios) {
      const runners = positions.map((p) => runnerAt(p));
      settleRunnersToBases(runners);
      const occupied = runners.map((r) => r.base).filter((b) => b >= 1 && b <= 3);
      expect(new Set(occupied).size).toBe(occupied.length);
      for (const r of runners) {
        expect(r.base).toBeGreaterThanOrEqual(0);
        expect(r.base).toBeLessThanOrEqual(3);
      }
    }
  });

  it('never promotes a runner to a base he had not reached', () => {
    const positions = [3.4, 2.9, 2.2];
    const runners = positions.map((p) => runnerAt(p));
    settleRunnersToBases(runners);
    runners.forEach((r, i) => {
      expect(r.base).toBeLessThanOrEqual(Math.floor(positions[i]));
    });
  });

  it('agrees with occupiedBases afterwards', () => {
    const runners = [runnerAt(2.5), runnerAt(2.1), runnerAt(3.6)];
    settleRunnersToBases(runners);
    const occ = occupiedBases(runners);
    for (const r of runners) {
      if (r.base >= 1 && r.base <= 3) expect(occ[r.base]).toBe(true);
    }
  });
});

describe('runner position helpers', () => {
  it('keeps runnerAbs, distanceToBase and timeToBase mutually consistent', () => {
    for (const abs of [0, 0.25, 1, 1.5, 2.75, 3, 3.99]) {
      for (const speedAttr of [20, 55, 99]) {
        const r = runnerAt(abs, { speed: speedAttr });
        expect(runnerAbs(r)).toBeCloseTo(abs, 9);
        expect(r.speed).toBeCloseTo(
          RUNNER_BASE_SPEED + attr01(speedAttr) * RUNNER_SPEED_SPAN,
          9,
        );
        for (const target of [0, 1, 2, 3, 4]) {
          const d = distanceToBase(r, target);
          expect(d).toBeCloseTo(Math.abs(target - abs) * BASE_PATH, 9);
          expect(d).toBeGreaterThanOrEqual(0);
          expect(timeToBase(r, target)).toBeCloseTo(d / Math.max(1, r.speed), 9);
        }
      }
    }
  });

  it('predicts how long a runner actually takes to reach the next bag', () => {
    // timeToBase is what the fielding AI decides throws with, so it has to match
    // the motion the runner really produces.
    const r = runnerAt(1, { speed: 70 });
    const predicted = timeToBase(r, 2);
    r.target = 2;
    let t = 0;
    const dt = 1 / 480;
    while (runnerAbs(r) < 2 - 1e-9 && t < 30) {
      stepRunner(r, dt);
      t += dt;
    }
    expect(runnerAbs(r)).toBeCloseTo(2, 6);
    expect(t).toBeGreaterThan(predicted - 0.02);
    expect(t).toBeLessThan(predicted + 0.02);
  });

  it('marks a runner as scored once he reaches home', () => {
    const r = runnerAt(3.5);
    r.target = 4;
    for (let i = 0; i < 2000 && !r.scored; i++) stepRunner(r, 1 / 120);
    expect(r.scored).toBe(true);
    expect(r.justScored).toBe(true);
    expect(r.base).toBe(4);
    expect(r.progress).toBe(0);
  });

  it('treats a runner taking his lead as still on the bag', () => {
    const r = makeRunner(makePlayer(), 2, false);
    expect(r.progress).toBe(LEAD_PROGRESS);
    expect(LEAD_PROGRESS).toBeLessThanOrEqual(ON_BAG_PROGRESS);
    expect(isOnBase(r)).toBe(true);
    setRunnerAbs(r, 2 + ON_BAG_PROGRESS + 0.05);
    expect(isOnBase(r)).toBe(false);
  });

  it('places runners on the actual bags at whole-number positions', () => {
    const home = runnerPos(runnerAt(0));
    expect(home.x).toBeCloseTo(0, 6);
    expect(home.z).toBeCloseTo(0, 6);
    const second = runnerPos(runnerAt(2));
    expect(second.x).toBeCloseTo(0, 6);
    expect(second.z).toBeCloseTo(BASE_PATH * Math.SQRT2, 6);
    const first = runnerPos(runnerAt(1));
    expect(first.x).toBeLessThan(0);
    const third = runnerPos(runnerAt(3));
    expect(third.x).toBeGreaterThan(0);
    expect(first.z).toBeCloseTo(third.z, 6);
  });

  it('sends a batter-runner from home toward visible first base, not third', () => {
    const halfway = runnerPos(runnerAt(0.5, { isBatter: true }));
    // The behind-home game camera maps -X to the right side of the diamond,
    // where first base appears to the player.
    expect(halfway.x).toBeLessThan(0);
    expect(halfway.z).toBeGreaterThan(0);
  });
});
