import * as THREE from 'three';
import { SWING_FOLLOW_THROUGH } from '../core/constants';
import {
  BATTING_MOTION_DATA,
  BATTING_MOTION_PHASES,
  BATTING_MOTION_SOURCE,
  BATTING_MOTION_STRIDE,
} from './batting-motion.generated';

export const BATTING_PHASES = {
  stance: 0,
  gather: 0.12,
  stride: 0.24,
  heelPlant: 0.34,
  contact: 0.425,
  extension: 0.6,
  wrap: 0.8,
  finish: 1,
} as const;

export const SWING_CONTACT_FRAME = BATTING_PHASES.contact;
export { BATTING_MOTION_SOURCE };

export interface BattingMotionSample {
  rootPosition: THREE.Vector3;
  rootQuaternion: THREE.Quaternion;
  torsoQuaternion: THREE.Quaternion;
  headQuaternion: THREE.Quaternion;
  leftThighQuaternion: THREE.Quaternion;
  leftShinQuaternion: THREE.Quaternion;
  rightThighQuaternion: THREE.Quaternion;
  rightShinQuaternion: THREE.Quaternion;
  /** Contact-authoritative bat transform in actor-root space. */
  batPosition: THREE.Vector3;
  batQuaternion: THREE.Quaternion;
  /** Unit directions in actor/torso space; the IK layer turns these into poles. */
  leftElbowPole: THREE.Vector3;
  rightElbowPole: THREE.Vector3;
}

export function createBattingMotionSample(): BattingMotionSample {
  return {
    rootPosition: new THREE.Vector3(),
    rootQuaternion: new THREE.Quaternion(),
    torsoQuaternion: new THREE.Quaternion(),
    headQuaternion: new THREE.Quaternion(),
    leftThighQuaternion: new THREE.Quaternion(),
    leftShinQuaternion: new THREE.Quaternion(),
    rightThighQuaternion: new THREE.Quaternion(),
    rightShinQuaternion: new THREE.Quaternion(),
    batPosition: new THREE.Vector3(),
    batQuaternion: new THREE.Quaternion(),
    leftElbowPole: new THREE.Vector3(),
    rightElbowPole: new THREE.Vector3(),
  };
}

const IDENTITY = new THREE.Quaternion();

function vectorAt(target: THREE.Vector3, a: number, b: number, t: number): void {
  target.set(
    THREE.MathUtils.lerp(BATTING_MOTION_DATA[a], BATTING_MOTION_DATA[b], t),
    THREE.MathUtils.lerp(BATTING_MOTION_DATA[a + 1], BATTING_MOTION_DATA[b + 1], t),
    THREE.MathUtils.lerp(BATTING_MOTION_DATA[a + 2], BATTING_MOTION_DATA[b + 2], t),
  );
}

function quaternionAt(target: THREE.Quaternion, a: number, b: number, t: number): void {
  target
    .set(
      BATTING_MOTION_DATA[a],
      BATTING_MOTION_DATA[a + 1],
      BATTING_MOTION_DATA[a + 2],
      BATTING_MOTION_DATA[a + 3],
    )
    .normalize();
  if (t > 0) {
    IDENTITY
      .set(
        BATTING_MOTION_DATA[b],
        BATTING_MOTION_DATA[b + 1],
        BATTING_MOTION_DATA[b + 2],
        BATTING_MOTION_DATA[b + 3],
      )
      .normalize();
    target.slerp(IDENTITY, t).normalize();
  }
}

function mirrorVectorX(value: THREE.Vector3): void {
  value.x = -value.x;
}

/** Reflection across actor-local X, equivalent to M * R * M. */
export function mirrorQuaternionX(value: THREE.Quaternion): void {
  value.y = -value.y;
  value.z = -value.z;
}

/**
 * Samples the compact native batting curve without allocating. `handed=-1`
 * is the canonical right-handed motion; `handed=1` is its true reflection.
 */
export function sampleBattingMotion(
  phase: number,
  handed: number,
  out: BattingMotionSample,
): void {
  const t = THREE.MathUtils.clamp(phase, 0, 1);
  let upper = 1;
  while (upper < BATTING_MOTION_PHASES.length && BATTING_MOTION_PHASES[upper] < t) upper++;
  upper = Math.min(upper, BATTING_MOTION_PHASES.length - 1);
  const lower = Math.max(0, upper - 1);
  const aPhase = BATTING_MOTION_PHASES[lower];
  const bPhase = BATTING_MOTION_PHASES[upper];
  const mix = THREE.MathUtils.clamp((t - aPhase) / Math.max(1e-6, bPhase - aPhase), 0, 1);
  const a = lower * BATTING_MOTION_STRIDE;
  const b = upper * BATTING_MOTION_STRIDE;
  let o = 0;

  vectorAt(out.rootPosition, a + o, b + o, mix); o += 3;
  quaternionAt(out.rootQuaternion, a + o, b + o, mix); o += 4;
  quaternionAt(out.torsoQuaternion, a + o, b + o, mix); o += 4;
  quaternionAt(out.headQuaternion, a + o, b + o, mix); o += 4;
  quaternionAt(out.leftThighQuaternion, a + o, b + o, mix); o += 4;
  quaternionAt(out.leftShinQuaternion, a + o, b + o, mix); o += 4;
  quaternionAt(out.rightThighQuaternion, a + o, b + o, mix); o += 4;
  quaternionAt(out.rightShinQuaternion, a + o, b + o, mix); o += 4;
  vectorAt(out.batPosition, a + o, b + o, mix); o += 3;
  quaternionAt(out.batQuaternion, a + o, b + o, mix); o += 4;
  vectorAt(out.leftElbowPole, a + o, b + o, mix); o += 3;
  vectorAt(out.rightElbowPole, a + o, b + o, mix);

  if (handed > 0) {
    mirrorVectorX(out.rootPosition);
    mirrorQuaternionX(out.rootQuaternion);
    mirrorQuaternionX(out.torsoQuaternion);
    mirrorQuaternionX(out.headQuaternion);
    mirrorVectorX(out.batPosition);
    mirrorQuaternionX(out.batQuaternion);

    const ltx = out.leftThighQuaternion.x;
    const lty = out.leftThighQuaternion.y;
    const ltz = out.leftThighQuaternion.z;
    const ltw = out.leftThighQuaternion.w;
    const lsx = out.leftShinQuaternion.x;
    const lsy = out.leftShinQuaternion.y;
    const lsz = out.leftShinQuaternion.z;
    const lsw = out.leftShinQuaternion.w;
    const lpx = out.leftElbowPole.x;
    const lpy = out.leftElbowPole.y;
    const lpz = out.leftElbowPole.z;
    out.leftThighQuaternion.copy(out.rightThighQuaternion);
    out.leftShinQuaternion.copy(out.rightShinQuaternion);
    out.leftElbowPole.copy(out.rightElbowPole);
    out.rightThighQuaternion.set(ltx, lty, ltz, ltw);
    out.rightShinQuaternion.set(lsx, lsy, lsz, lsw);
    out.rightElbowPole.set(lpx, lpy, lpz);
    mirrorQuaternionX(out.leftThighQuaternion);
    mirrorQuaternionX(out.leftShinQuaternion);
    mirrorQuaternionX(out.rightThighQuaternion);
    mirrorQuaternionX(out.rightShinQuaternion);
    mirrorVectorX(out.leftElbowPole);
    mirrorVectorX(out.rightElbowPole);
  }
}

/** Maps elapsed real swing time onto the contact-authoritative pose curve. */
export function swingPoseProgress(elapsedSeconds: number, latencySeconds: number): number {
  if (elapsedSeconds <= 0) return 0;
  const latency = Math.max(0.001, latencySeconds);
  if (elapsedSeconds <= latency) {
    return THREE.MathUtils.clamp(elapsedSeconds / latency, 0, 1) * SWING_CONTACT_FRAME;
  }
  if (elapsedSeconds >= latency + SWING_FOLLOW_THROUGH) return 1;
  return THREE.MathUtils.clamp(
    SWING_CONTACT_FRAME +
      ((elapsedSeconds - latency) / SWING_FOLLOW_THROUGH) * (1 - SWING_CONTACT_FRAME),
    0,
    1,
  );
}
