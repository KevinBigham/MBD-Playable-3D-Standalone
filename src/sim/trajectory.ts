import type { Stadium } from '../core/types';
import { type Ball, horizontalDist, stepFree } from './physics';
import type { FielderState } from './state';
import { catchReach, reachHeight } from './fielders';

export interface TrajSample {
  x: number;
  y: number;
  z: number;
  t: number;
}

/**
 * Projects the ball's future path — including bounces and the roll — so
 * fielders can chase an interception point instead of chasing the ball's
 * current position. Without this, a ground ball skips past everybody while
 * they all converge on the spot where it first touched the grass.
 */
export function projectBall(
  ball: Ball,
  stadium: Stadium,
  carry: number,
  horizon = 6,
  step = 1 / 40,
  out: TrajSample[] = [],
): TrajSample[] {
  out.length = 0;
  if (ball.mode === 'held' || ball.mode === 'idle' || ball.mode === 'pitch') {
    out.push({ x: ball.x, y: ball.y, z: ball.z, t: 0 });
    return out;
  }

  const ghost: Ball = { ...ball, pitch: undefined };
  let t = 0;
  out.push({ x: ghost.x, y: ghost.y, z: ghost.z, t: 0 });
  while (t < horizon) {
    stepFree(ghost, step, stadium, carry);
    t += step;
    out.push({ x: ghost.x, y: ghost.y, z: ghost.z, t });
    if (ghost.rolling && Math.hypot(ghost.vx, ghost.vz) < 0.35) break;
    if (horizontalDist(ghost.x, ghost.z) > 200) break;
  }
  return out;
}

export interface Intercept {
  x: number;
  z: number;
  /** Seconds from now until the fielder could be there. */
  t: number;
  /** True when the fielder can actually beat the ball to that point. */
  feasible: boolean;
  index: number;
}

/**
 * Earliest point on the projected path this fielder can physically reach.
 * `extraDelay` folds in reaction time so a slow-reacting fielder commits late.
 */
export function findIntercept(
  f: FielderState,
  traj: TrajSample[],
  extraDelay = 0,
): Intercept {
  const reach = catchReach(f) * 0.85;
  const maxHeight = reachHeight(f);
  let fallback: Intercept | null = null;

  for (let i = 0; i < traj.length; i++) {
    const s = traj[i];
    if (s.y > maxHeight) continue;
    const dx = s.x - f.x;
    const dz = s.z - f.z;
    const need = Math.hypot(dx, dz) - reach;
    const avail = Math.max(0, s.t - extraDelay) * f.maxSpeed;
    if (need <= avail) {
      return { x: s.x, z: s.z, t: s.t, feasible: true, index: i };
    }
    if (!fallback && i === traj.length - 1) {
      fallback = { x: s.x, z: s.z, t: s.t, feasible: false, index: i };
    }
  }
  const last = traj[traj.length - 1] ?? { x: f.x, z: f.z, t: 0, y: 0 };
  return fallback ?? { x: last.x, z: last.z, t: last.t, feasible: false, index: traj.length - 1 };
}
