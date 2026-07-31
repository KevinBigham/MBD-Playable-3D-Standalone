import { BASE_PATH, BASE_POS, RUNNER_BASE_SPEED, RUNNER_SPEED_SPAN, attr01, clamp, clamp01, dist } from '../core/constants';
import type { Player } from '../core/types';
import type { FielderState, RunnerState } from './state';
import { basePoint } from './fielders';

/** Runners take a small lead; this is how far off the bag they stand. */
export const LEAD_PROGRESS = 0.055;
/** Progress at or below this counts as still touching the bag for tag-ups. */
export const ON_BAG_PROGRESS = 0.09;

export function makeRunner(player: Player, base: number, isBatter: boolean): RunnerState {
  return {
    playerId: player.id,
    base,
    progress: isBatter ? 0 : LEAD_PROGRESS,
    target: base,
    cmdTarget: null,
    speed: RUNNER_BASE_SPEED + attr01(player.bat.speed) * RUNNER_SPEED_SPAN,
    out: false,
    scored: false,
    isBatter,
    mustTag: false,
    tagBase: base,
    slide: 0,
    leadHold: 0,
    justScored: false,
    stealing: false,
  };
}

export function runnerPos(r: RunnerState): { x: number; z: number } {
  const from = BASE_POS[clamp(r.base, 0, 4)];
  const to = BASE_POS[clamp(r.base + 1, 0, 4)];
  const t = clamp01(r.progress);
  return { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t };
}

/** Absolute continuous position along the basepath, in bases. */
export function runnerAbs(r: RunnerState): number {
  return r.base + clamp01(r.progress);
}

/** Distance in metres from the runner to a given base along the paths. */
export function distanceToBase(r: RunnerState, base: number): number {
  return Math.abs(base - runnerAbs(r)) * BASE_PATH;
}

export function timeToBase(r: RunnerState, base: number): number {
  return distanceToBase(r, base) / Math.max(1, r.speed);
}

/** Which bases currently hold a live runner (index 1..3). */
export function occupiedBases(runners: RunnerState[]): boolean[] {
  const occ = [false, false, false, false];
  for (const r of runners) {
    if (r.out || r.scored || r.isBatter) continue;
    occ[clamp(r.base, 0, 3)] = true;
  }
  return occ;
}

/**
 * Marks which runners are forced. The batter-runner is always forced to first
 * while alive; each runner behind an occupied base inherits the force.
 */
export function computeForces(runners: RunnerState[]): Map<RunnerState, number> {
  const forces = new Map<RunnerState, number>();
  const live = runners.filter((r) => !r.out && !r.scored);
  const batter = live.find((r) => r.isBatter);
  if (batter) forces.set(batter, 1);

  let chain = !!batter;
  for (let base = 1; base <= 3 && chain; base++) {
    const occupant = live.find((r) => !r.isBatter && r.base === base);
    if (occupant) {
      forces.set(occupant, base + 1);
    } else {
      chain = false;
    }
  }
  return forces;
}

/** Advances or retreats a runner one step toward their target. */
export function stepRunner(r: RunnerState, dt: number): void {
  if (r.out || r.scored) return;
  if (r.slide > 0) r.slide = Math.max(0, r.slide - dt);
  if (r.leadHold > 0) {
    r.leadHold = Math.max(0, r.leadHold - dt);
    return;
  }

  const abs = runnerAbs(r);
  const target = r.target;
  const perBase = 1 / BASE_PATH;

  if (target > abs + 1e-6) {
    const step = r.speed * dt * perBase;
    let next = abs + step;
    if (next >= target) next = target;
    setAbs(r, next);
  } else if (target < abs - 1e-6) {
    // Retreating is slower than running forward.
    const step = r.speed * 0.86 * dt * perBase;
    let next = abs - step;
    if (next <= target) next = target;
    setAbs(r, Math.max(0, next));
  }

  if (r.base >= 4 || runnerAbs(r) >= 4 - 1e-9) {
    r.base = 4;
    r.progress = 0;
    r.scored = true;
    r.justScored = true;
  }
}

/**
 * Runners may never pass one another, and two runners may never end up on the
 * same bag. This runs after every movement step as a hard invariant guard so
 * the base state can never become impossible, whatever the AI decides.
 */
export function enforceRunnerOrder(runners: RunnerState[]): boolean {
  const live = runners.filter((r) => !r.out && !r.scored).sort((a, b) => runnerAbs(b) - runnerAbs(a));
  let repaired = false;
  for (let i = 1; i < live.length; i++) {
    const ahead = live[i - 1];
    const r = live[i];
    const limit = runnerAbs(ahead) - 0.02;
    if (runnerAbs(r) > limit) {
      setAbs(r, Math.max(0, limit));
      if (r.target > limit) r.target = Math.max(0, Math.floor(limit));
      repaired = true;
    }
  }
  return repaired;
}

/**
 * Collapses every runner onto the last base they legally reached, resolving
 * collisions by dropping the trailing runner back a bag. Used when a play ends.
 */
export function settleRunnersToBases(runners: RunnerState[]): void {
  const live = runners.filter((r) => !r.out && !r.scored).sort((a, b) => runnerAbs(b) - runnerAbs(a));
  const taken = new Set<number>();
  for (const r of live) {
    let b = Math.floor(runnerAbs(r) + 1e-9);
    while (b > 0 && taken.has(b)) b--;
    taken.add(b);
    r.base = clamp(b, 0, 3);
    r.progress = 0;
    r.target = r.base;
    r.cmdTarget = null;
    r.mustTag = false;
    r.tagBase = r.base;
    r.stealing = false;
    r.isBatter = false;
  }
}

/** Places a runner at an absolute basepath position. Used by tests. */
export function setRunnerAbs(r: RunnerState, abs: number): void {
  setAbs(r, abs);
}

function setAbs(r: RunnerState, abs: number): void {
  const clamped = clamp(abs, 0, 4);
  const base = Math.floor(clamped);
  r.base = clamp(base, 0, 4);
  r.progress = clamped - r.base;
  if (r.base >= 4) {
    r.base = 4;
    r.progress = 0;
  }
}

export function isOnBase(r: RunnerState): boolean {
  return r.progress <= ON_BAG_PROGRESS + 1e-6;
}

/** True when a fielder holding the ball is close enough to apply a tag. */
export function canTag(f: FielderState, r: RunnerState): boolean {
  const p = runnerPos(r);
  return dist(f.x, f.z, p.x, p.z) < 1.35;
}

/**
 * Estimated seconds for the defence to get the ball to a base.
 *
 * When nobody has the ball this uses the interception point the fielder AI
 * actually solved for, not the ball's current position — otherwise a ball
 * rolling into the gap looks like it is already in somebody's glove and
 * runners never take the extra base.
 */
export function defenseTimeToBase(
  fielders: FielderState[],
  base: number,
  acquireX: number,
  acquireZ: number,
  ballHeldBy: FielderState | null,
  acquireTime: number,
  acquireArm: number,
): number {
  const bp = basePoint(base);
  const holder = ballHeldBy;
  if (holder) {
    const d = dist(holder.x, holder.z, bp.x, bp.z);
    if (d < 1.2) return 0.05;
    return holder.transfer + 0.26 + d / (holder.armSpeed * 0.82);
  }
  if (!fielders.length) return 99;
  const d = dist(acquireX, acquireZ, bp.x, bp.z);
  // Beyond about 65 m the ball goes through a cutoff man rather than on a line,
  // which is exactly why balls in the gap turn into doubles.
  const relay = d > 65 ? 1.0 : 0;
  return acquireTime + 0.4 + relay + d / (Math.max(18, acquireArm) * 0.82);
}

export interface BaserunDecisionCtx {
  runners: RunnerState[];
  fielders: FielderState[];
  forces: Map<RunnerState, number>;
  outs: number;
  ballX: number;
  ballZ: number;
  ballAirborne: boolean;
  ballHeldBy: FielderState | null;
  /** Where and when the defence will actually get its hands on the ball. */
  acquireX: number;
  acquireZ: number;
  acquireTime: number;
  acquireArm: number;
  /** Set once the ball has been caught on the fly. */
  caught: boolean;
  /** True once the play is a confirmed hit that got past the infield. */
  fair: boolean;
  /** Aggression 0..1: higher takes more chances. */
  aggression: number;
  /** True when a fly ball is very likely to be caught. */
  likelyCatch: boolean;
  hangRemaining: number;
}

/**
 * Chooses each runner's target base. Human commands override this, but the
 * default behaviour is deliberately competent so a player who never touches a
 * base button still gets sane baserunning.
 */
export function decideRunnerTargets(ctx: BaserunDecisionCtx): void {
  const { runners, forces, outs } = ctx;
  const live = runners.filter((r) => !r.out && !r.scored);
  // Farthest along first, so a lead runner's choice informs the one behind.
  live.sort((a, b) => runnerAbs(b) - runnerAbs(a));

  for (const r of live) {
    if (r.cmdTarget !== null) {
      r.target = clamp(r.cmdTarget, 0, 4);
      continue;
    }
    const forcedTo = forces.get(r);
    const abs = runnerAbs(r);
    const nextBase = Math.floor(abs) + 1;

    if (!ctx.fair) {
      // Foul ball or dead ball: return to the last legally held base.
      r.target = r.base;
      continue;
    }

    if (ctx.caught) {
      if (r.mustTag) {
        r.target = r.tagBase;
        continue;
      }
      // Legitimately tagged up: go only if it is clearly safe.
      const gain = shouldAdvance(ctx, r, r.base + 1, 0.55 - ctx.aggression * 0.2);
      r.target = gain ? r.base + 1 : r.base;
      continue;
    }

    if (ctx.ballAirborne && ctx.likelyCatch && !r.isBatter) {
      // Forced runners edge off; unforced runners get back to the bag so they
      // can tag. This is the behaviour that makes sacrifice flies work.
      if (forcedTo !== undefined) {
        r.target = Math.min(r.base + 0.45, nextBase) as number;
        // Keep them between bases without committing.
        r.target = r.base + (ctx.hangRemaining < 0.35 ? 0.75 : 0.4);
      } else {
        r.target = r.base;
      }
      continue;
    }

    if (r.isBatter && ctx.ballAirborne && ctx.likelyCatch) {
      r.target = 1;
      continue;
    }

    // Ball is on the ground or already fielded.
    let target = forcedTo !== undefined ? Math.max(forcedTo, r.base) : r.base;
    if (r.isBatter) target = Math.max(target, 1);

    // Try to take extra bases while the ball is loose. The margin required
    // depends on the base: a hitter who has just laced one into the gap runs
    // hard for two on instinct, while trying to score is a genuine gamble.
    const probe = Math.max(target, Math.floor(abs) + (abs % 1 > 0.02 ? 1 : 0));
    for (let extra = probe; extra <= 4; extra++) {
      if (extra <= target) continue;
      const margin = advanceMargin(r, extra, ctx.aggression, outs);
      if (shouldAdvance(ctx, r, extra, margin)) {
        target = extra;
      } else {
        break;
      }
    }
    // Never run into an occupied base.
    target = clamp(target, 0, 4);
    r.target = target;
  }

  preventStacking(live);
}

/** How much daylight a runner insists on before committing to a base. */
function advanceMargin(r: RunnerState, base: number, aggression: number, outs: number): number {
  const twoOut = outs === 2 ? -0.14 : 0;
  if (r.isBatter && base === 2) return -0.02 - aggression * 0.4 + twoOut;
  if (base === 4) return 0.52 - aggression * 0.26 + twoOut;
  return 0.38 - aggression * 0.2 + twoOut;
}

function shouldAdvance(
  ctx: BaserunDecisionCtx,
  r: RunnerState,
  base: number,
  margin: number,
): boolean {
  if (base > 4) return false;
  const tRunner = timeToBase(r, base);
  const tDefense = defenseTimeToBase(
    ctx.fielders,
    base % 4,
    ctx.acquireX,
    ctx.acquireZ,
    ctx.ballHeldBy,
    ctx.acquireTime,
    ctx.acquireArm,
  );
  return tRunner + margin < tDefense;
}

/** Two runners may never target the same base or pass one another. */
function preventStacking(live: RunnerState[]): void {
  const sorted = [...live].sort((a, b) => runnerAbs(b) - runnerAbs(a));
  let ceiling = 4;
  for (const r of sorted) {
    if (r.target > ceiling) r.target = ceiling;
    // A runner hovering at 2.4 still *owns* second base, so the runner behind
    // may only come as far as first.
    const owned = Math.floor(r.target + 1e-9);
    ceiling = Math.max(0, Math.min(ceiling, owned - 1));
  }
}

/** Human-friendly base label. */
export function baseName(base: number): string {
  switch (((base % 4) + 4) % 4) {
    case 0:
      return 'HOME';
    case 1:
      return '1ST';
    case 2:
      return '2ND';
    default:
      return '3RD';
  }
}
