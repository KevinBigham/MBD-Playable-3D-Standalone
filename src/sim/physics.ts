import {
  BOUNCE_RESTITUTION,
  CONTACT_Z,
  DRAG_K,
  GRAVITY,
  GROUND_FRICTION,
  MAGNUS_K,
  RELEASE_Y,
  RELEASE_Z,
  WALL_RESTITUTION,
  clamp,
} from '../core/constants';
import type { Stadium } from '../core/types';
import { fenceAt } from '../data/stadiums';

export const BALL_RADIUS = 0.037;

export type BallMode = 'idle' | 'pitch' | 'batted' | 'thrown' | 'held';

export interface Ball {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  mode: BallMode;
  /** Backspin factor for Magnus lift, 0..1.6. */
  spin: number;
  /** Sidespin; positive curves the ball toward +X. */
  sideSpin: number;
  /** Bounces since the ball was last airborne off the bat. */
  bounces: number;
  /** True once the ball has settled into a roll. */
  rolling: boolean;
  /** Metres travelled from home plate along the ground, cached for HUD. */
  groundDist: number;
  /** Elapsed seconds in the current mode. */
  t: number;
  /** Pitch-only kinematic parameters. */
  pitch?: PitchFlight;
  /** Set once for a batted ball so the HUD can show a projected landing spot. */
  apex: number;
  /** True when the ball has touched anything after being batted. */
  touched: boolean;
}

export interface PitchFlight {
  /** Total flight time from release to the contact plane. */
  T: number;
  x0: number;
  y0: number;
  z0: number;
  /** Where it crosses the contact plane, before steering. */
  px: number;
  py: number;
  breakX: number;
  breakY: number;
  lateness: number;
  /** Accumulated player steering offset. */
  steerX: number;
  steerY: number;
  steerVX: number;
  steerVY: number;
  /** Nominal release velocity magnitude, for the radar readout. */
  speed: number;
}

export function makeBall(): Ball {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    mode: 'idle',
    spin: 0,
    sideSpin: 0,
    bounces: 0,
    rolling: false,
    groundDist: 0,
    t: 0,
    apex: 0,
    touched: false,
  };
}

/**
 * Starts a pitch. `targetX`/`targetY` are where the ball should cross the
 * contact plane; execution error has already been folded in by the caller.
 */
export function launchPitch(
  ball: Ball,
  opts: {
    speed: number;
    targetX: number;
    targetY: number;
    breakX: number;
    breakY: number;
    lateness: number;
    releaseX: number;
  },
): void {
  const dz = RELEASE_Z - CONTACT_Z;
  const T = dz / Math.max(12, opts.speed);
  ball.mode = 'pitch';
  ball.t = 0;
  ball.spin = 0;
  ball.sideSpin = 0;
  ball.bounces = 0;
  ball.rolling = false;
  ball.touched = false;
  ball.apex = 0;
  ball.pitch = {
    T,
    x0: opts.releaseX,
    y0: RELEASE_Y,
    z0: RELEASE_Z,
    px: opts.targetX,
    py: opts.targetY,
    breakX: opts.breakX,
    breakY: opts.breakY,
    lateness: opts.lateness,
    steerX: 0,
    steerY: 0,
    steerVX: 0,
    steerVY: 0,
    speed: opts.speed,
  };
  evaluatePitchAt(ball, 0);
}

/** Break shape: 0 at release, 1 at the plate, biased late by `lateness`. */
function breakShape(u: number, lateness: number): number {
  const p = 1 + 2.6 * lateness;
  return Math.pow(clamp(u, 0, 1), p);
}

/**
 * Closed-form pitch position at time `t`. Using a closed form (rather than
 * integration) means the pitch is bit-identical at any frame rate and the
 * batter's timing window is exactly reproducible.
 */
export function pitchPositionAt(p: PitchFlight, t: number): { x: number; y: number; z: number } {
  const u = clamp(t / p.T, 0, 1.35);
  const s = breakShape(u, p.lateness);
  const gravSag = 0.5 * GRAVITY * p.T * p.T * (u - u * u);
  return {
    x: p.x0 + (p.px - p.x0) * u + p.breakX * s + p.steerX * s,
    y: p.y0 + (p.py - p.y0) * u + gravSag + p.breakY * s + p.steerY * s,
    z: p.z0 + (CONTACT_Z - p.z0) * u,
  };
}

function evaluatePitchAt(ball: Ball, t: number): void {
  const p = ball.pitch!;
  const prev = pitchPositionAt(p, Math.max(0, t - 1 / 240));
  const cur = pitchPositionAt(p, t);
  ball.x = cur.x;
  ball.y = cur.y;
  ball.z = cur.z;
  const dt = t - Math.max(0, t - 1 / 240) || 1 / 240;
  ball.vx = (cur.x - prev.x) / dt;
  ball.vy = (cur.y - prev.y) / dt;
  ball.vz = (cur.z - prev.z) / dt;
}

/** Advances a pitch. Returns true once the ball has reached the contact plane. */
export function stepPitch(ball: Ball, dt: number, steerX: number, steerY: number, steerPower: number): boolean {
  const p = ball.pitch!;
  // Steering is an acceleration on an offset that saturates, so mashing a
  // direction cannot teleport the ball; it bends it.
  const accel = 2.6 * steerPower;
  p.steerVX = clamp(p.steerVX + steerX * accel * dt, -0.9, 0.9);
  p.steerVY = clamp(p.steerVY + steerY * accel * dt, -0.9, 0.9);
  p.steerVX *= Math.pow(0.02, dt);
  p.steerVY *= Math.pow(0.02, dt);
  const maxSteer = 0.34 * steerPower;
  p.steerX = clamp(p.steerX + p.steerVX * dt, -maxSteer, maxSteer);
  p.steerY = clamp(p.steerY + p.steerVY * dt, -maxSteer, maxSteer);

  ball.t += dt;
  evaluatePitchAt(ball, ball.t);
  return ball.t >= p.T;
}

/** Launches a batted or thrown ball into the projectile integrator. */
export function launchFree(
  ball: Ball,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  mode: 'batted' | 'thrown',
  spin = 0,
  sideSpin = 0,
): void {
  ball.x = x;
  ball.y = y;
  ball.z = z;
  ball.vx = vx;
  ball.vy = vy;
  ball.vz = vz;
  ball.mode = mode;
  ball.spin = spin;
  ball.sideSpin = sideSpin;
  ball.bounces = 0;
  ball.rolling = false;
  ball.t = 0;
  ball.apex = y;
  ball.touched = false;
  ball.pitch = undefined;
}

export interface StepResult {
  /** The ball crossed the outfield wall in the air, over the wall height. */
  homeRun: boolean;
  /** The ball hit the wall this step. */
  hitWall: boolean;
  /** The ball touched the ground this step. */
  landed: boolean;
  /** Ground contact point, valid when `landed`. */
  landX: number;
  landZ: number;
  /** The ball has effectively stopped. */
  stopped: boolean;
}

const EMPTY_STEP: StepResult = {
  homeRun: false,
  hitWall: false,
  landed: false,
  landX: 0,
  landZ: 0,
  stopped: false,
};

export function sprayAngleDeg(x: number, z: number): number {
  return (Math.atan2(x, Math.max(0.0001, z)) * 180) / Math.PI;
}

export function horizontalDist(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

/**
 * Fixed-step projectile integration with quadratic drag, backspin lift,
 * sidespin curve, wall collisions and ground bounce/roll.
 */
export function stepFree(ball: Ball, dt: number, stadium: Stadium, carryScale = 1): StepResult {
  const res: StepResult = { ...EMPTY_STEP };
  ball.t += dt;

  if (ball.rolling) {
    stepRoll(ball, dt);
    res.stopped = ball.vx === 0 && ball.vz === 0;
    ball.groundDist = horizontalDist(ball.x, ball.z);
    return res;
  }

  const relVx = ball.vx - stadium.wind.x * 0.35;
  const relVz = ball.vz - stadium.wind.z * 0.35;
  const relVy = ball.vy;
  const speed = Math.sqrt(relVx * relVx + relVy * relVy + relVz * relVz) || 0.0001;
  // Park carry is applied with an exponent so the difference between a sea-level
  // bandbox and a mountain park is actually visible on the scoreboard.
  const dragK = DRAG_K / Math.pow(carryScale, 2.6);

  let ax = -dragK * speed * relVx;
  let ay = -GRAVITY - dragK * speed * relVy;
  let az = -dragK * speed * relVz;

  if (ball.spin > 0 && ball.mode === 'batted') {
    const vh = Math.sqrt(relVx * relVx + relVz * relVz) || 0.0001;
    const lift = MAGNUS_K * speed * speed * ball.spin * carryScale;
    // Unit vector perpendicular to velocity, in the vertical plane, pointing up.
    ax += lift * ((-relVy * relVx) / (speed * vh));
    ay += lift * (vh / speed);
    az += lift * ((-relVy * relVz) / (speed * vh));

    if (ball.sideSpin !== 0) {
      const side = MAGNUS_K * speed * speed * ball.sideSpin * 0.85;
      // Perpendicular to horizontal velocity, in the ground plane.
      ax += (side * -relVz) / vh;
      az += (side * relVx) / vh;
    }
  }

  ball.vx += ax * dt;
  ball.vy += ay * dt;
  ball.vz += az * dt;

  const nx = ball.x + ball.vx * dt;
  const ny = ball.y + ball.vy * dt;
  const nz = ball.z + ball.vz * dt;

  // --- Wall / home run test -------------------------------------------------
  const distNow = horizontalDist(ball.x, ball.z);
  const distNext = horizontalDist(nx, nz);
  const angleNext = sprayAngleDeg(nx, nz);
  if (nz > 0 && Math.abs(angleNext) <= 45.5) {
    const fence = fenceAt(stadium, angleNext);
    if (distNow <= fence.dist && distNext > fence.dist) {
      const tCross = (fence.dist - distNow) / Math.max(0.0001, distNext - distNow);
      const yCross = ball.y + (ny - ball.y) * tCross;
      if (yCross > fence.height) {
        res.homeRun = true;
      } else if (yCross > 0) {
        // Bounce off the wall, killing most of the outward speed.
        res.hitWall = true;
        const outX = nx / Math.max(0.0001, distNext);
        const outZ = nz / Math.max(0.0001, distNext);
        const vOut = ball.vx * outX + ball.vz * outZ;
        ball.vx -= (1 + WALL_RESTITUTION) * vOut * outX;
        ball.vz -= (1 + WALL_RESTITUTION) * vOut * outZ;
        ball.vy *= 0.55;
        ball.x = outX * (fence.dist - 0.35);
        ball.z = outZ * (fence.dist - 0.35);
        ball.y = Math.max(BALL_RADIUS, yCross);
        ball.touched = true;
        ball.groundDist = horizontalDist(ball.x, ball.z);
        return res;
      }
    }
  }

  ball.x = nx;
  ball.z = nz;
  ball.y = ny;
  if (ball.y > ball.apex) ball.apex = ball.y;

  // --- Ground --------------------------------------------------------------
  if (ball.y <= BALL_RADIUS) {
    const overshoot = BALL_RADIUS - ball.y;
    ball.y = BALL_RADIUS;
    res.landed = true;
    res.landX = ball.x;
    res.landZ = ball.z;
    ball.bounces++;
    ball.touched = true;

    if (ball.vy < -0.8) {
      ball.vy = -ball.vy * BOUNCE_RESTITUTION;
      // Horizontal speed bleeds off on each hop; turf bleeds less.
      const keep = stadium.turf ? 0.88 : 0.78;
      ball.vx *= keep;
      ball.vz *= keep;
      ball.y += Math.min(overshoot, 0.05);
      ball.spin *= 0.35;
      ball.sideSpin *= 0.4;
    } else {
      ball.vy = 0;
      ball.rolling = true;
      ball.spin = 0;
      ball.sideSpin = 0;
    }
  }

  ball.groundDist = horizontalDist(ball.x, ball.z);
  return res;
}

function stepRoll(ball: Ball, dt: number): void {
  ball.y = BALL_RADIUS;
  ball.vy = 0;
  const sp = Math.sqrt(ball.vx * ball.vx + ball.vz * ball.vz);
  if (sp < 0.35) {
    ball.vx = 0;
    ball.vz = 0;
    return;
  }
  const dec = GROUND_FRICTION * dt;
  const ns = Math.max(0, sp - dec);
  const k = ns / sp;
  ball.vx *= k;
  ball.vz *= k;
  ball.x += ball.vx * dt;
  ball.z += ball.vz * dt;
}

/** True when the point is inside fair territory (between the foul lines). */
export function isFair(x: number, z: number): boolean {
  return z > 0 && Math.abs(x) <= z + 1e-6;
}

/**
 * Ballistic estimate of where a fly ball will next touch the ground.
 * Used by fielder AI and the catch indicator. Runs a lightweight forward
 * integration at 30 Hz — accurate enough to chase, cheap enough to run often.
 */
export function predictLanding(
  ball: Ball,
  _stadium: Stadium,
  carryScale: number,
  maxTime = 8,
): { x: number; z: number; t: number; y: number } {
  if (ball.rolling || ball.mode === 'held') {
    return { x: ball.x, z: ball.z, t: 0, y: ball.y };
  }
  const dt = 1 / 30;
  let x = ball.x;
  let y = ball.y;
  let z = ball.z;
  let vx = ball.vx;
  let vy = ball.vy;
  let vz = ball.vz;
  const dragK = DRAG_K / Math.pow(carryScale, 2.6);
  for (let t = 0; t < maxTime; t += dt) {
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz) || 0.0001;
    let ax = -dragK * speed * vx;
    let ay = -GRAVITY - dragK * speed * vy;
    let az = -dragK * speed * vz;
    if (ball.spin > 0) {
      const vh = Math.sqrt(vx * vx + vz * vz) || 0.0001;
      const lift = MAGNUS_K * speed * speed * ball.spin * carryScale;
      ax += lift * ((-vy * vx) / (speed * vh));
      ay += lift * (vh / speed);
      az += lift * ((-vy * vz) / (speed * vh));
    }
    vx += ax * dt;
    vy += ay * dt;
    vz += az * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    if (y <= BALL_RADIUS) {
      return { x, z, t: t + dt, y: BALL_RADIUS };
    }
  }
  return { x, z, t: maxTime, y };
}
