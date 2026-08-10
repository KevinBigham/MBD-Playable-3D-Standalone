import * as THREE from 'three';
import {
  PITCHING_MOTION_DATA,
  PITCHING_MOTION_PHASES,
  PITCHING_MOTION_SOURCE,
  PITCHING_MOTION_STRIDE,
} from './pitching-motion.generated';

export const PITCHING_PHASES = {
  set: 0,
  legLift: 0.2,
  drive: 0.48,
  armCock: 0.64,
  release: PITCHING_MOTION_SOURCE.releasePhase,
  followThrough: 0.9,
  finish: 1,
} as const;

/** Pose-curve phase at the source's measured ball-release frame. */
export const PITCH_RELEASE_FRAME = PITCHING_PHASES.release;
/** Presentation time allotted to the post-release delivery. */
export const PITCH_THROW_DURATION = 0.68;
export { PITCHING_MOTION_SOURCE };

export interface PitchingMotionSample {
  rootPosition: THREE.Vector3;
  torsoQuaternion: THREE.Quaternion;
  headQuaternion: THREE.Quaternion;
  leftArmQuaternion: THREE.Quaternion;
  leftForearmQuaternion: THREE.Quaternion;
  rightArmQuaternion: THREE.Quaternion;
  rightForearmQuaternion: THREE.Quaternion;
  leftThighQuaternion: THREE.Quaternion;
  leftShinQuaternion: THREE.Quaternion;
  rightThighQuaternion: THREE.Quaternion;
  rightShinQuaternion: THREE.Quaternion;
  /** Unit directions in actor space; the IK layer turns these into poles. */
  leftElbowPole: THREE.Vector3;
  rightElbowPole: THREE.Vector3;
}

export function createPitchingMotionSample(): PitchingMotionSample {
  return {
    rootPosition: new THREE.Vector3(),
    torsoQuaternion: new THREE.Quaternion(),
    headQuaternion: new THREE.Quaternion(),
    leftArmQuaternion: new THREE.Quaternion(),
    leftForearmQuaternion: new THREE.Quaternion(),
    rightArmQuaternion: new THREE.Quaternion(),
    rightForearmQuaternion: new THREE.Quaternion(),
    leftThighQuaternion: new THREE.Quaternion(),
    leftShinQuaternion: new THREE.Quaternion(),
    rightThighQuaternion: new THREE.Quaternion(),
    rightShinQuaternion: new THREE.Quaternion(),
    leftElbowPole: new THREE.Vector3(),
    rightElbowPole: new THREE.Vector3(),
  };
}

const TEMP_QUATERNION = new THREE.Quaternion();

function vectorAt(target: THREE.Vector3, a: number, b: number, t: number): void {
  target.set(
    THREE.MathUtils.lerp(PITCHING_MOTION_DATA[a], PITCHING_MOTION_DATA[b], t),
    THREE.MathUtils.lerp(PITCHING_MOTION_DATA[a + 1], PITCHING_MOTION_DATA[b + 1], t),
    THREE.MathUtils.lerp(PITCHING_MOTION_DATA[a + 2], PITCHING_MOTION_DATA[b + 2], t),
  );
}

function quaternionAt(target: THREE.Quaternion, a: number, b: number, t: number): void {
  target
    .set(
      PITCHING_MOTION_DATA[a],
      PITCHING_MOTION_DATA[a + 1],
      PITCHING_MOTION_DATA[a + 2],
      PITCHING_MOTION_DATA[a + 3],
    )
    .normalize();
  if (t > 0) {
    TEMP_QUATERNION
      .set(
        PITCHING_MOTION_DATA[b],
        PITCHING_MOTION_DATA[b + 1],
        PITCHING_MOTION_DATA[b + 2],
        PITCHING_MOTION_DATA[b + 3],
      )
      .normalize();
    target.slerp(TEMP_QUATERNION, t).normalize();
  }
}

function mirrorVectorX(value: THREE.Vector3): void {
  value.x = -value.x;
}

/** Reflection across actor-local X, equivalent to M * R * M. */
export function mirrorPitchingQuaternionX(value: THREE.Quaternion): void {
  value.y = -value.y;
  value.z = -value.z;
}

function swapAndMirrorQuaternion(
  left: THREE.Quaternion,
  right: THREE.Quaternion,
): void {
  const x = left.x;
  const y = left.y;
  const z = left.z;
  const w = left.w;
  left.copy(right);
  right.set(x, y, z, w);
  mirrorPitchingQuaternionX(left);
  mirrorPitchingQuaternionX(right);
}

function swapAndMirrorVector(left: THREE.Vector3, right: THREE.Vector3): void {
  const x = left.x;
  const y = left.y;
  const z = left.z;
  left.copy(right);
  right.set(x, y, z);
  mirrorVectorX(left);
  mirrorVectorX(right);
}

/**
 * Samples the compact native pitching curve without allocating. `armSign=-1`
 * is the canonical right-arm source motion; `armSign=1` is its true reflection.
 */
export function samplePitchingMotion(
  phase: number,
  armSign: number,
  out: PitchingMotionSample,
): void {
  const clampedPhase = THREE.MathUtils.clamp(phase, 0, 1);
  let upper = 1;
  while (upper < PITCHING_MOTION_PHASES.length && PITCHING_MOTION_PHASES[upper] < clampedPhase) upper++;
  upper = Math.min(upper, PITCHING_MOTION_PHASES.length - 1);
  const lower = Math.max(0, upper - 1);
  const aPhase = PITCHING_MOTION_PHASES[lower];
  const bPhase = PITCHING_MOTION_PHASES[upper];
  const mix = THREE.MathUtils.clamp(
    (clampedPhase - aPhase) / Math.max(1e-6, bPhase - aPhase),
    0,
    1,
  );
  const a = lower * PITCHING_MOTION_STRIDE;
  const b = upper * PITCHING_MOTION_STRIDE;
  let offset = 0;

  vectorAt(out.rootPosition, a + offset, b + offset, mix); offset += 3;
  quaternionAt(out.torsoQuaternion, a + offset, b + offset, mix); offset += 4;
  quaternionAt(out.headQuaternion, a + offset, b + offset, mix); offset += 4;
  quaternionAt(out.leftArmQuaternion, a + offset, b + offset, mix); offset += 4;
  quaternionAt(out.leftForearmQuaternion, a + offset, b + offset, mix); offset += 4;
  quaternionAt(out.rightArmQuaternion, a + offset, b + offset, mix); offset += 4;
  quaternionAt(out.rightForearmQuaternion, a + offset, b + offset, mix); offset += 4;
  quaternionAt(out.leftThighQuaternion, a + offset, b + offset, mix); offset += 4;
  quaternionAt(out.leftShinQuaternion, a + offset, b + offset, mix); offset += 4;
  quaternionAt(out.rightThighQuaternion, a + offset, b + offset, mix); offset += 4;
  quaternionAt(out.rightShinQuaternion, a + offset, b + offset, mix); offset += 4;
  vectorAt(out.leftElbowPole, a + offset, b + offset, mix); offset += 3;
  vectorAt(out.rightElbowPole, a + offset, b + offset, mix);

  if (armSign > 0) {
    mirrorVectorX(out.rootPosition);
    mirrorPitchingQuaternionX(out.torsoQuaternion);
    mirrorPitchingQuaternionX(out.headQuaternion);
    swapAndMirrorQuaternion(out.leftArmQuaternion, out.rightArmQuaternion);
    swapAndMirrorQuaternion(out.leftForearmQuaternion, out.rightForearmQuaternion);
    swapAndMirrorQuaternion(out.leftThighQuaternion, out.rightThighQuaternion);
    swapAndMirrorQuaternion(out.leftShinQuaternion, out.rightShinQuaternion);
    swapAndMirrorVector(out.leftElbowPole, out.rightElbowPole);
  }
}
