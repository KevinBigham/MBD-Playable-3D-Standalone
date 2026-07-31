import {
  BASE_POS,
  FIELDER_BASE_SPEED,
  FIELDER_SPEED_SPAN,
  GRAVITY,
  MOUND_Z,
  THROW_BASE_SPEED,
  THROW_SPEED_SPAN,
  attr01,
  clamp,
  clamp01,
  dist,
} from '../core/constants';
import type { Player } from '../core/types';
import { type Ball, launchFree } from './physics';
import type { FielderState } from './state';
import { DRAG_K } from '../core/constants';

/** Standing defensive alignment, in world metres. */
export const ALIGNMENT: ReadonlyArray<{ x: number; z: number }> = [
  { x: 0, z: MOUND_Z },      // P
  { x: 0.42, z: -2.45 },     // C
  { x: 17.4, z: 24.6 },      // 1B
  { x: 9.6, z: 34.0 },       // 2B
  { x: -17.0, z: 24.2 },     // 3B
  { x: -9.9, z: 34.2 },      // SS
  { x: -38.0, z: 74.0 },     // LF
  { x: 0, z: 88.0 },         // CF
  { x: 38.0, z: 74.0 },      // RF
];

export const CATCHER_SLOT = 1;
export const PITCHER_SLOT = 0;

/** Preferred cover order for each base, by fielding slot. */
const BASE_COVER_PRIORITY: ReadonlyArray<readonly number[]> = [
  [1, 0, 4],       // home: C, P, 3B
  [2, 3, 0, 5],    // first: 1B, 2B, P, SS
  [5, 3, 0, 8],    // second: SS, 2B, P, RF
  [4, 5, 0, 1],    // third: 3B, SS, P, C
];

export function makeFielder(player: Player, slot: number): FielderState {
  const a = ALIGNMENT[slot];
  return {
    playerId: player.id,
    slot,
    x: a.x,
    z: a.z,
    vx: 0,
    vz: 0,
    homeX: a.x,
    homeZ: a.z,
    tx: a.x,
    tz: a.z,
    maxSpeed: FIELDER_BASE_SPEED + attr01(player.bat.speed) * FIELDER_SPEED_SPAN,
    armSpeed: THROW_BASE_SPEED + attr01(player.bat.arm) * THROW_SPEED_SPAN,
    fielding: player.bat.fielding,
    reaction: player.bat.reaction,
    reactDelay: 0,
    hasBall: false,
    transfer: 0,
    role: 'idle',
    coverBase: -1,
    diveT: 0,
    diveDirX: 0,
    diveDirZ: 0,
    jumpT: 0,
    facing: 0,
    humanControlled: false,
    errorFlash: 0,
  };
}

export function resetAlignment(fielders: FielderState[], shiftPull: number): void {
  for (const f of fielders) {
    const a = ALIGNMENT[f.slot];
    // A gentle shift toward the hitter's pull side keeps defences from feeling
    // static without ever leaving a base uncovered.
    const shift = f.slot >= 2 ? shiftPull * (f.slot >= 6 ? 5.5 : 2.6) : 0;
    f.homeX = a.x + shift;
    f.homeZ = a.z;
    f.tx = f.homeX;
    f.tz = f.homeZ;
    f.x = f.homeX;
    f.z = f.homeZ;
    f.vx = 0;
    f.vz = 0;
    f.hasBall = false;
    f.transfer = 0;
    f.role = 'idle';
    f.coverBase = -1;
    f.diveT = 0;
    f.jumpT = 0;
    f.reactDelay = 0;
    f.errorFlash = 0;
    f.humanControlled = false;
  }
}

export function fielderSpeedNow(f: FielderState): number {
  if (f.diveT > 0) return 0;
  return f.maxSpeed;
}

/** Moves a fielder toward (tx, tz) with a little inertia. */
export function moveFielder(f: FielderState, dt: number, tx: number, tz: number): void {
  if (f.diveT > 0) {
    f.diveT -= dt;
    const dv = Math.max(0, f.diveT) * 9;
    f.x += f.diveDirX * dv * dt;
    f.z += f.diveDirZ * dv * dt;
    return;
  }
  if (f.jumpT > 0) f.jumpT -= dt;

  const dx = tx - f.x;
  const dz = tz - f.z;
  const d = Math.hypot(dx, dz);
  const speed = fielderSpeedNow(f);
  if (d < 0.05) {
    f.vx = 0;
    f.vz = 0;
    return;
  }
  const desiredVx = (dx / d) * Math.min(speed, d / dt);
  const desiredVz = (dz / d) * Math.min(speed, d / dt);
  // Acceleration limit keeps direction changes from being instant.
  const accel = 26 * dt;
  f.vx += clamp(desiredVx - f.vx, -accel, accel);
  f.vz += clamp(desiredVz - f.vz, -accel, accel);
  f.x += f.vx * dt;
  f.z += f.vz * dt;
  if (Math.hypot(f.vx, f.vz) > 0.4) f.facing = Math.atan2(f.vx, f.vz);
}

/** Steers a fielder with a raw human input vector. */
export function driveFielder(f: FielderState, dt: number, ix: number, iz: number): void {
  if (f.diveT > 0) {
    moveFielder(f, dt, f.x, f.z);
    return;
  }
  const mag = Math.hypot(ix, iz);
  if (mag < 0.08) {
    const decel = 30 * dt;
    f.vx -= clamp(f.vx, -decel, decel);
    f.vz -= clamp(f.vz, -decel, decel);
  } else {
    const speed = fielderSpeedNow(f);
    const desiredVx = (ix / Math.max(1, mag)) * speed;
    const desiredVz = (iz / Math.max(1, mag)) * speed;
    const accel = 30 * dt;
    f.vx += clamp(desiredVx - f.vx, -accel, accel);
    f.vz += clamp(desiredVz - f.vz, -accel, accel);
  }
  f.x += f.vx * dt;
  f.z += f.vz * dt;
  if (Math.hypot(f.vx, f.vz) > 0.4) f.facing = Math.atan2(f.vx, f.vz);
}

export function startDive(f: FielderState, dirX: number, dirZ: number): void {
  if (f.diveT > 0) return;
  const m = Math.hypot(dirX, dirZ) || 1;
  f.diveT = 0.55;
  f.diveDirX = dirX / m;
  f.diveDirZ = dirZ / m;
  f.vx = 0;
  f.vz = 0;
}

/** Horizontal reach for a catch, in metres. */
export function catchReach(f: FielderState): number {
  const base = 0.99 + attr01(f.fielding) * 0.34;
  if (f.diveT > 0) return base + 1.85;
  return base;
}

/** Highest ball a fielder can glove, in metres. */
export function reachHeight(f: FielderState): number {
  const base = 2.42 + attr01(f.fielding) * 0.22;
  if (f.jumpT > 0) return base + 0.82;
  return base;
}

export interface ThrowSolution {
  vx: number;
  vy: number;
  vz: number;
  flightTime: number;
}

/**
 * Solves a throw that lands at (tx, tz) at catch height, accounting for drag by
 * binary-searching the launch angle against the same integrator the ball uses.
 * Returns null when the target is genuinely out of range, which is what makes
 * the relay man necessary.
 */
export function solveThrow(
  fromX: number,
  fromY: number,
  fromZ: number,
  toX: number,
  toZ: number,
  speed: number,
  catchHeight = 1.15,
): ThrowSolution | null {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const d = Math.hypot(dx, dz);
  if (d < 0.4) return null;
  const targetDy = catchHeight - fromY;

  let lo = -0.18;
  let hi = 0.95;
  let best: ThrowSolution | null = null;
  for (let iter = 0; iter < 22; iter++) {
    const ang = (lo + hi) / 2;
    const r = simulateThrow(d, targetDy, speed, ang);
    if (r === null) {
      lo = ang; // fell short: aim higher
      continue;
    }
    if (r.heightAtTarget < targetDy) {
      lo = ang;
    } else {
      hi = ang;
    }
    if (Math.abs(r.heightAtTarget - targetDy) < 0.05 || iter === 21) {
      best = {
        vx: (dx / d) * speed * Math.cos(ang),
        vy: speed * Math.sin(ang),
        vz: (dz / d) * speed * Math.cos(ang),
        flightTime: r.time,
      };
      if (Math.abs(r.heightAtTarget - targetDy) < 0.05) break;
    }
  }
  if (!best) return null;
  // Reject solutions that would have to be lobbed absurdly high.
  const maxAngle = Math.atan2(best.vy, Math.hypot(best.vx, best.vz));
  if (maxAngle > 0.93) return null;
  return best;
}

function simulateThrow(
  d: number,
  _targetDy: number,
  speed: number,
  angle: number,
): { heightAtTarget: number; time: number } | null {
  const dt = 1 / 90;
  let x = 0;
  let y = 0;
  let vx = speed * Math.cos(angle);
  let vy = speed * Math.sin(angle);
  for (let t = 0; t < 6; t += dt) {
    const sp = Math.hypot(vx, vy) || 0.0001;
    vx += -DRAG_K * sp * vx * dt;
    vy += (-GRAVITY - DRAG_K * sp * vy) * dt;
    const nx = x + vx * dt;
    const ny = y + vy * dt;
    if (nx >= d) {
      const f = (d - x) / Math.max(0.0001, nx - x);
      return { heightAtTarget: y + (ny - y) * f, time: t + dt * f };
    }
    x = nx;
    y = ny;
    if (y < -3) return null;
  }
  return null;
}

/** Where the ball should be thrown for a given base index (0=home..3=third). */
export function basePoint(base: number): { x: number; z: number } {
  const b = BASE_POS[((base % 4) + 4) % 4];
  return { x: b.x, z: b.z };
}

/**
 * Launches a throw. Returns the estimated flight time, or null when the throw
 * could not be made (caller should relay instead).
 */
export function throwBall(
  ball: Ball,
  f: FielderState,
  toX: number,
  toZ: number,
  accuracyError: { x: number; z: number },
  speedScale = 1,
): number | null {
  const fromY = 1.62;
  const speed = f.armSpeed * speedScale;
  const sol = solveThrow(f.x, fromY, f.z, toX + accuracyError.x, toZ + accuracyError.z, speed);
  if (!sol) return null;
  launchFree(ball, f.x, fromY, f.z, sol.vx, sol.vy, sol.vz, 'thrown', 0, 0);
  f.hasBall = false;
  return sol.flightTime;
}

export function maxThrowRange(f: FielderState): number {
  // Empirical: with drag, a 45deg throw carries roughly this far.
  const v = f.armSpeed;
  return clamp(v * v * 0.062, 20, 105);
}

/** Picks the best cover assignment for each base given the current chaser. */
export function assignCoverage(fielders: FielderState[], chaserSlot: number): void {
  const taken = new Set<number>([chaserSlot]);
  for (let base = 0; base < 4; base++) {
    const pref = BASE_COVER_PRIORITY[base];
    let chosen = -1;
    for (const slot of pref) {
      if (!taken.has(slot)) {
        chosen = slot;
        break;
      }
    }
    if (chosen < 0) continue;
    taken.add(chosen);
    const f = fielders[chosen];
    f.role = 'cover';
    f.coverBase = base;
  }
  for (const f of fielders) {
    if (f.slot === chaserSlot) {
      f.role = 'chase';
      f.coverBase = -1;
    } else if (f.role !== 'cover') {
      f.role = 'backup';
      f.coverBase = -1;
    }
  }
}

/** How far a slot normally ranges; used to weight who chases a ball. */
const RANGE_WEIGHT = [1.15, 1.2, 1.05, 0.95, 1.05, 0.95, 0.95, 0.92, 0.95];

/** Chooses the fielder who should pursue the ball. */
export function pickChaser(
  fielders: FielderState[],
  landX: number,
  landZ: number,
  landT: number,
): number {
  let best = -1;
  let bestScore = Infinity;
  for (const f of fielders) {
    const d = dist(f.x, f.z, landX, landZ);
    const timeToReach = d / f.maxSpeed;
    // Penalise fielders who cannot get there, but keep them in contention so a
    // ball in the gap still gets chased by the nearest body.
    const late = Math.max(0, timeToReach - landT);
    const score = (timeToReach + late * 1.6) * RANGE_WEIGHT[f.slot];
    if (score < bestScore) {
      bestScore = score;
      best = f.slot;
    }
  }
  return best;
}

/** Backup positions so nobody stands around doing nothing. */
export function backupTarget(
  f: FielderState,
  ballX: number,
  ballZ: number,
): { x: number; z: number } {
  const d = Math.hypot(ballX, ballZ);
  const ux = d > 0.001 ? ballX / d : 0;
  const uz = d > 0.001 ? ballZ / d : 1;
  switch (f.slot) {
    case PITCHER_SLOT:
      return { x: ballX * 0.28, z: clamp(ballZ * 0.28 + 6, 4, MOUND_Z + 6) };
    case CATCHER_SLOT:
      return { x: 0, z: -1.7 };
    default:
      // Drift toward the ball but stay in position shape.
      return {
        x: f.homeX + ux * 5 + (ballX - f.homeX) * 0.12,
        z: f.homeZ + uz * 3 + (ballZ - f.homeZ) * 0.12,
      };
  }
}

/** Probability a fielder cleanly handles a ball, 0..1. */
export function fieldingSuccess(
  f: FielderState,
  ballSpeed: number,
  movingFast: boolean,
  airborne: boolean,
  diving: boolean,
): number {
  const skill = attr01(f.fielding);
  // Tuned against scripts/simulate.ts for roughly one error per team per nine
  // innings — enough that a bad glove matters, rare enough to stay a moment.
  let p = 0.982 + skill * 0.016;
  if (airborne) p += 0.008;
  p -= clamp01((ballSpeed - 24) / 45) * (0.055 - skill * 0.032);
  if (movingFast) p -= 0.014 - skill * 0.009;
  if (diving) p -= 0.16 - skill * 0.09;
  return clamp(p, 0.62, 0.9995);
}

/** Throw scatter in metres, grows with distance and shrinks with arm skill. */
export function throwError(
  f: FielderState,
  distance: number,
  rush: boolean,
  rand: () => number,
): { x: number; z: number } {
  const skill = attr01(f.fielding) * 0.5 + attr01(f.reaction) * 0.5;
  const sigma = (0.13 + distance * 0.0125) * (1.45 - skill) * (rush ? 1.5 : 1);
  return { x: (rand() * 2 - 1) * sigma, z: (rand() * 2 - 1) * sigma };
}

