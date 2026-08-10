import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';

const SOURCE = {
  commit: '09a07f54f3bbb58797325f009282d0b2048a2871',
  file: 'data/124/124_07.bvh',
  sha256: 'fe848034a77cac57ff49a77e9a57d2af3d714f549ced078b128e458910666ba4',
  bytes: 991_671,
  frames: 1_298,
  frameTime: 0.0083333,
  stanceFrame: 264,
  contactFrame: 343,
  finishFrame: 425,
} as const;

const CONTACT_PHASE = 0.425;
const SAMPLE_PHASES = [
  ...Array.from({ length: 17 }, (_, i) => (i / 16) * CONTACT_PHASE),
  ...Array.from({ length: 16 }, (_, i) => CONTACT_PHASE + ((i + 1) / 16) * (1 - CONTACT_PHASE)),
];

const CHANNELS = [
  'rootPosition',
  'rootQuaternion',
  'torsoQuaternion',
  'headQuaternion',
  'leftThighQuaternion',
  'leftShinQuaternion',
  'rightThighQuaternion',
  'rightShinQuaternion',
  'batPosition',
  'batQuaternion',
  'leftElbowPole',
  'rightElbowPole',
] as const;

const CHANNEL_WIDTHS = [3, 4, 4, 4, 4, 4, 4, 4, 3, 4, 3, 3] as const;

// These eight bat anchors are the contact-authoritative transforms recorded
// from the shipping average-body right-handed swing before the bat was
// reparented. CMU has no bat prop and its hand joints are explicitly noisy, so
// the mocap drives the body and elbow intent while this measured curve keeps
// the game's barrel/ball presentation contract exact.
const BAT_ANCHORS = [
  { phase: 0.00, p: [0.030, 1.300, 0.300], axis: [0.35, 0.78, -0.52], roll: -0.18 },
  { phase: 0.12, p: [0.060, 1.320, 0.280], axis: [0.30, 0.82, -0.49], roll: -0.12 },
  { phase: 0.24, p: [0.060, 1.300, 0.320], axis: [0.25, 0.80, -0.55], roll: -0.06 },
  { phase: 0.34, p: [0.030, 1.240, 0.380], axis: [0.05, 0.55, 0.83], roll: 0.08 },
  // p + normalize(axis) * .855 = the pre-change authoritative tip
  // (approximately 0, 1.340, 1.243) while the grip stays in both-arm reach.
  { phase: CONTACT_PHASE, p: [-0.067, 1.193, 0.402], axis: [0.078, 0.172, 0.982], roll: 0.16 },
  { phase: 0.52, p: [-0.100, 1.170, 0.360], axis: [-0.90, -0.15, 0.40], roll: 0.24 },
  { phase: 0.60, p: [-0.140, 1.200, 0.300], axis: [-0.92, 0.05, 0.39], roll: 0.28 },
  { phase: 0.70, p: [-0.120, 1.250, 0.120], axis: [-0.40, -0.45, -0.80], roll: 0.33 },
  { phase: 0.80, p: [-0.080, 1.340, 0.020], axis: [0.80, 0.25, -0.55], roll: 0.38 },
  { phase: 0.90, p: [-0.100, 1.300, -0.040], axis: [-0.60, 0.72, -0.34], roll: 0.42 },
  { phase: 1.00, p: [-0.120, 1.270, -0.030], axis: [-0.68, 0.67, -0.31], roll: 0.45 },
] as const;

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`Usage: npm run mocap:bake:batting -- --input <124_07.bvh>`);
  return process.argv[i + 1];
}

function sourceFrame(phase: number): number {
  if (phase <= CONTACT_PHASE) {
    return THREE.MathUtils.lerp(SOURCE.stanceFrame, SOURCE.contactFrame, phase / CONTACT_PHASE);
  }
  return THREE.MathUtils.lerp(
    SOURCE.contactFrame,
    SOURCE.finishFrame,
    (phase - CONTACT_PHASE) / (1 - CONTACT_PHASE),
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
  const p = new THREE.Vector3();
  let total = 0;
  for (let i = -4; i <= 4; i++) {
    const weight = weights[i + 4];
    mixer.setTime((frame + i) / 120);
    root.updateMatrixWorld(true);
    bone.getWorldPosition(p);
    out.addScaledVector(p, weight);
    total += weight;
  }
  return out.multiplyScalar(1 / total);
}

function sampleBat(phase: number): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  let upper = 1;
  while (upper < BAT_ANCHORS.length && BAT_ANCHORS[upper].phase < phase) upper++;
  upper = Math.min(upper, BAT_ANCHORS.length - 1);
  const lower = Math.max(0, upper - 1);
  const a = BAT_ANCHORS[lower];
  const b = BAT_ANCHORS[upper];
  const span = Math.max(1e-6, b.phase - a.phase);
  const raw = THREE.MathUtils.clamp((phase - a.phase) / span, 0, 1);
  const t = raw * raw * (3 - 2 * raw);
  const up = new THREE.Vector3(0, 1, 0);
  const qa = new THREE.Quaternion()
    .setFromUnitVectors(up, new THREE.Vector3(...a.axis).normalize())
    .multiply(new THREE.Quaternion().setFromAxisAngle(up, a.roll));
  const qb = new THREE.Quaternion()
    .setFromUnitVectors(up, new THREE.Vector3(...b.axis).normalize())
    .multiply(new THREE.Quaternion().setFromAxisAngle(up, b.roll));
  return {
    position: new THREE.Vector3(...a.p).lerp(new THREE.Vector3(...b.p), t),
    quaternion: qa.slerp(qb, t).normalize(),
  };
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
mixer.setTime(SOURCE.stanceFrame / 120);
root.updateMatrixWorld(true);

const mapped = {
  root: requireBone('Hips'),
  torso: requireBone('Spine1'),
  head: requireBone('Head'),
  leftThigh: requireBone('LeftUpLeg'),
  leftShin: requireBone('LeftLeg'),
  rightThigh: requireBone('RightUpLeg'),
  rightShin: requireBone('RightLeg'),
};
const starts = Object.fromEntries(
  Object.entries(mapped).map(([name, bone]) => [name, bone.quaternion.clone()]),
) as Record<keyof typeof mapped, THREE.Quaternion>;
const hipStart = smoothWorldPosition(mixer, root, mapped.root, SOURCE.stanceFrame);
const leftShoulderStart = smoothWorldPosition(mixer, root, requireBone('LeftArm'), SOURCE.stanceFrame);
const rightShoulderStart = smoothWorldPosition(mixer, root, requireBone('RightArm'), SOURCE.stanceFrame);
const sourceRight = rightShoulderStart.clone().sub(leftShoulderStart).setY(0).normalize();
const sourceUp = new THREE.Vector3(0, 1, 0);
const sourceForward = new THREE.Vector3().crossVectors(sourceRight, sourceUp).normalize();
const toActor = (v: THREE.Vector3): THREE.Vector3 =>
  new THREE.Vector3(v.dot(sourceRight), v.y, v.dot(sourceForward));

const rows: number[][] = [];
for (const phase of SAMPLE_PHASES) {
  const frame = sourceFrame(phase);
  mixer.setTime(frame / 120);
  root.updateMatrixWorld(true);

  const rootPosition = toActor(
    smoothWorldPosition(mixer, root, mapped.root, frame).sub(hipStart),
  ).multiplyScalar(0.075);
  const horizontal = Math.hypot(rootPosition.x, rootPosition.z);
  if (horizontal > 0.12) {
    const scale = 0.12 / horizontal;
    rootPosition.x *= scale;
    rootPosition.z *= scale;
  }

  const leftShoulder = smoothWorldPosition(mixer, root, requireBone('LeftArm'), frame);
  const leftElbow = smoothWorldPosition(mixer, root, requireBone('LeftForeArm'), frame);
  const rightShoulder = smoothWorldPosition(mixer, root, requireBone('RightArm'), frame);
  const rightElbow = smoothWorldPosition(mixer, root, requireBone('RightForeArm'), frame);
  const leftPole = toActor(leftElbow.sub(leftShoulder)).normalize();
  const rightPole = toActor(rightElbow.sub(rightShoulder)).normalize();
  const bat = sampleBat(phase);

  const values: number[] = [];
  values.push(...rootPosition.toArray());
  values.push(...normalizedDelta(starts.root, mapped.root.quaternion).toArray());
  values.push(...normalizedDelta(starts.torso, mapped.torso.quaternion).toArray());
  values.push(...normalizedDelta(starts.head, mapped.head.quaternion).toArray());
  values.push(...normalizedDelta(starts.leftThigh, mapped.leftThigh.quaternion).toArray());
  values.push(...normalizedDelta(starts.leftShin, mapped.leftShin.quaternion).toArray());
  values.push(...normalizedDelta(starts.rightThigh, mapped.rightThigh.quaternion).toArray());
  values.push(...normalizedDelta(starts.rightShin, mapped.rightShin.quaternion).toArray());
  values.push(...bat.position.toArray(), ...bat.quaternion.toArray());
  values.push(...leftPole.toArray(), ...rightPole.toArray());
  rows.push(values);
}

const flat = rows.flat();
const output = `/* eslint-disable */
/**
 * Generated by scripts/mocap/bake-batting-motion.ts. Do not edit by hand.
 * Raw BVH data is deliberately not part of the application or repository.
 */
export const BATTING_MOTION_SOURCE = ${JSON.stringify(SOURCE, null, 2)} as const;
export const BATTING_MOTION_PHASES = [${fmt(SAMPLE_PHASES)}] as const;
export const BATTING_MOTION_CHANNELS = ${JSON.stringify(CHANNELS)} as const;
export const BATTING_MOTION_CHANNEL_WIDTHS = ${JSON.stringify(CHANNEL_WIDTHS)} as const;
export const BATTING_MOTION_STRIDE = ${CHANNEL_WIDTHS.reduce((sum, width) => sum + width, 0)};
export const BATTING_MOTION_DATA = new Float32Array([${fmt(flat)}]);
`;

const outputPath = resolve('src/render/batting-motion.generated.ts');
writeFileSync(outputPath, output);
console.log(`Wrote ${outputPath}: ${SAMPLE_PHASES.length} samples, ${flat.length} floats`);
