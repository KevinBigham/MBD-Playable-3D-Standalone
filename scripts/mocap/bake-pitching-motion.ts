import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';

// CMU subject 124, trial 01 is a right-arm overhand throw. The crop starts as
// the lead leg begins to lift and ends after the throwing hand has decelerated.
const SOURCE = {
  commit: '09a07f54f3bbb58797325f009282d0b2048a2871',
  file: 'data/124/124_01.bvh',
  sha256: 'eee88ea11954d3448e13c847a403ab9a88f264d575c21427f61e722bb0d3cd58',
  bytes: 491_121,
  frames: 644,
  frameTime: 0.0083333,
  startFrame: 160,
  releaseFrame: 448,
  finishFrame: 540,
  releasePhase: 0.76,
} as const;

const SAMPLE_PHASES = [
  ...Array.from({ length: 17 }, (_, i) => (i / 16) * SOURCE.releasePhase),
  ...Array.from({ length: 16 }, (_, i) => SOURCE.releasePhase + ((i + 1) / 16) * (1 - SOURCE.releasePhase)),
];

// The CMU skeleton is not the shipping player's mound-scale rig. Keep its
// joints and timing intact, but calibrate the root trajectory to the game's
// measured release socket in the same way batting owns its authoritative bat
// presentation path. These values are deliberately presentation-only.
const ROOT_PRESENTATION = {
  forwardScale: 1.422,
  releaseLift: 0.25,
  finishLift: 0.1,
  maxHorizontalStride: 1.75,
} as const;

const CHANNELS = [
  'rootPosition',
  'torsoQuaternion',
  'headQuaternion',
  'leftArmQuaternion',
  'leftForearmQuaternion',
  'rightArmQuaternion',
  'rightForearmQuaternion',
  'leftThighQuaternion',
  'leftShinQuaternion',
  'rightThighQuaternion',
  'rightShinQuaternion',
  'leftElbowPole',
  'rightElbowPole',
] as const;

const CHANNEL_WIDTHS = [3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3] as const;

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) {
    throw new Error('Usage: tsx scripts/mocap/bake-pitching-motion.ts --input <124_01.bvh>');
  }
  return process.argv[i + 1];
}

function sourceFrame(phase: number): number {
  if (phase <= SOURCE.releasePhase) {
    return THREE.MathUtils.lerp(SOURCE.startFrame, SOURCE.releaseFrame, phase / SOURCE.releasePhase);
  }
  return THREE.MathUtils.lerp(
    SOURCE.releaseFrame,
    SOURCE.finishFrame,
    (phase - SOURCE.releasePhase) / (1 - SOURCE.releasePhase),
  );
}

function smoothstep(value: number): number {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function presentationRootLift(phase: number): number {
  if (phase <= SOURCE.releasePhase) {
    return ROOT_PRESENTATION.releaseLift * smoothstep(phase / SOURCE.releasePhase);
  }
  return THREE.MathUtils.lerp(
    ROOT_PRESENTATION.releaseLift,
    ROOT_PRESENTATION.finishLift,
    smoothstep((phase - SOURCE.releasePhase) / (1 - SOURCE.releasePhase)),
  );
}

function normalizedDelta(start: THREE.Quaternion, current: THREE.Quaternion): THREE.Quaternion {
  return start.clone().invert().multiply(current).normalize();
}

function smoothWorldPosition(
  mixer: THREE.AnimationMixer,
  root: THREE.Object3D,
  bone: THREE.Bone,
  frame: number,
): THREE.Vector3 {
  const weights = [1, 2, 3, 4, 5, 4, 3, 2, 1];
  const out = new THREE.Vector3();
  const point = new THREE.Vector3();
  let total = 0;
  for (let i = -4; i <= 4; i++) {
    const weight = weights[i + 4];
    mixer.setTime((frame + i) / 120);
    root.updateMatrixWorld(true);
    bone.getWorldPosition(point);
    out.addScaledVector(point, weight);
    total += weight;
  }
  return out.multiplyScalar(1 / total);
}

function fmt(values: number[]): string {
  return values.map((value) => Number(value.toFixed(7))).join(', ');
}

const input = resolve(arg('--input'));
const bytes = readFileSync(input);
const hash = createHash('sha256').update(bytes).digest('hex');
if (bytes.byteLength !== SOURCE.bytes || hash !== SOURCE.sha256) {
  throw new Error(`Unexpected BVH input: bytes=${bytes.byteLength}, sha256=${hash}`);
}

const text = bytes.toString('utf8');
const frameMatch = text.match(/Frames:\s+(\d+)/);
const timeMatch = text.match(/Frame Time:\s+([\d.]+)/);
if (Number(frameMatch?.[1]) !== SOURCE.frames || Math.abs(Number(timeMatch?.[1]) - SOURCE.frameTime) > 1e-7) {
  throw new Error(`Unexpected BVH timing: frames=${frameMatch?.[1]}, frameTime=${timeMatch?.[1]}`);
}

const parsed = new BVHLoader().parse(text);
const root = parsed.skeleton.bones[0];
const bones = new Map(parsed.skeleton.bones.map((bone) => [bone.name, bone]));
const requireBone = (name: string): THREE.Bone => {
  const bone = bones.get(name);
  if (!bone) throw new Error(`BVH is missing ${name}`);
  return bone;
};
const mixer = new THREE.AnimationMixer(root);
mixer.clipAction(parsed.clip).play();
mixer.setTime(SOURCE.startFrame / 120);
root.updateMatrixWorld(true);

const mapped = {
  root: requireBone('Hips'),
  torso: requireBone('Spine1'),
  head: requireBone('Head'),
  leftArm: requireBone('LeftArm'),
  leftForeArm: requireBone('LeftForeArm'),
  rightArm: requireBone('RightArm'),
  rightForeArm: requireBone('RightForeArm'),
  leftThigh: requireBone('LeftUpLeg'),
  leftShin: requireBone('LeftLeg'),
  rightThigh: requireBone('RightUpLeg'),
  rightShin: requireBone('RightLeg'),
};
const starts = Object.fromEntries(
  Object.entries(mapped)
    .filter(([name]) => name !== 'root')
    .map(([name, bone]) => [name, bone.quaternion.clone()]),
) as Omit<Record<keyof typeof mapped, THREE.Quaternion>, 'root'>;
const hipStart = smoothWorldPosition(mixer, root, mapped.root, SOURCE.startFrame);
const sourceUp = new THREE.Vector3(0, 1, 0);
// The pitching source travels substantially through its delivery. Derive the
// actor's longitudinal axis from the measured hip stride instead of the
// shoulder line used by the mostly stationary batting source.
const hipRelease = smoothWorldPosition(mixer, root, mapped.root, SOURCE.releaseFrame);
const sourceForward = hipRelease.clone().sub(hipStart).setY(0).normalize();
if (sourceForward.lengthSq() < 1e-8) throw new Error('Pitching source has no horizontal hip stride');
const sourceRight = new THREE.Vector3().crossVectors(sourceUp, sourceForward).normalize();
const toActor = (value: THREE.Vector3): THREE.Vector3 =>
  new THREE.Vector3(value.dot(sourceRight), value.y, value.dot(sourceForward));

const rows: number[][] = [];
for (const phase of SAMPLE_PHASES) {
  const frame = sourceFrame(phase);
  mixer.setTime(frame / 120);
  root.updateMatrixWorld(true);

  const rootPosition = toActor(
    smoothWorldPosition(mixer, root, mapped.root, frame).sub(hipStart),
  ).multiplyScalar(0.075);
  rootPosition.z *= ROOT_PRESENTATION.forwardScale;
  rootPosition.y += presentationRootLift(phase);
  const horizontal = Math.hypot(rootPosition.x, rootPosition.z);
  if (horizontal > ROOT_PRESENTATION.maxHorizontalStride) {
    const scale = ROOT_PRESENTATION.maxHorizontalStride / horizontal;
    rootPosition.x *= scale;
    rootPosition.z *= scale;
  }

  const leftShoulder = smoothWorldPosition(mixer, root, mapped.leftArm, frame);
  const leftElbow = smoothWorldPosition(mixer, root, mapped.leftForeArm, frame);
  const rightShoulder = smoothWorldPosition(mixer, root, mapped.rightArm, frame);
  const rightElbow = smoothWorldPosition(mixer, root, mapped.rightForeArm, frame);
  const leftPole = toActor(leftElbow.sub(leftShoulder)).normalize();
  const rightPole = toActor(rightElbow.sub(rightShoulder)).normalize();
  // The position smoother intentionally seeks surrounding frames; restore the
  // exact frame before recording local rotations for this row.
  mixer.setTime(frame / 120);
  root.updateMatrixWorld(true);

  const values: number[] = [];
  values.push(...rootPosition.toArray());
  values.push(...normalizedDelta(starts.torso, mapped.torso.quaternion).toArray());
  values.push(...normalizedDelta(starts.head, mapped.head.quaternion).toArray());
  values.push(...normalizedDelta(starts.leftArm, mapped.leftArm.quaternion).toArray());
  values.push(...normalizedDelta(starts.leftForeArm, mapped.leftForeArm.quaternion).toArray());
  values.push(...normalizedDelta(starts.rightArm, mapped.rightArm.quaternion).toArray());
  values.push(...normalizedDelta(starts.rightForeArm, mapped.rightForeArm.quaternion).toArray());
  values.push(...normalizedDelta(starts.leftThigh, mapped.leftThigh.quaternion).toArray());
  values.push(...normalizedDelta(starts.leftShin, mapped.leftShin.quaternion).toArray());
  values.push(...normalizedDelta(starts.rightThigh, mapped.rightThigh.quaternion).toArray());
  values.push(...normalizedDelta(starts.rightShin, mapped.rightShin.quaternion).toArray());
  values.push(...leftPole.toArray(), ...rightPole.toArray());
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(`Non-finite sample at phase=${phase}, frame=${frame}`);
  }
  rows.push(values);
}

const flat = rows.flat();
const output = `/* eslint-disable */
/**
 * Generated by scripts/mocap/bake-pitching-motion.ts. Do not edit by hand.
 * Raw BVH data is deliberately not part of the application or repository.
 */
export const PITCHING_MOTION_SOURCE = ${JSON.stringify(SOURCE, null, 2)} as const;
export const PITCHING_MOTION_PHASES = [${fmt(SAMPLE_PHASES)}] as const;
export const PITCHING_MOTION_CHANNELS = ${JSON.stringify(CHANNELS)} as const;
export const PITCHING_MOTION_CHANNEL_WIDTHS = ${JSON.stringify(CHANNEL_WIDTHS)} as const;
export const PITCHING_MOTION_STRIDE = ${CHANNEL_WIDTHS.reduce((sum, width) => sum + width, 0)};
export const PITCHING_MOTION_DATA = new Float32Array([${fmt(flat)}]);
`;

const outputPath = resolve('src/render/pitching-motion.generated.ts');
writeFileSync(outputPath, output);
console.log(`Wrote ${outputPath}: ${SAMPLE_PHASES.length} samples, ${flat.length} floats`);
