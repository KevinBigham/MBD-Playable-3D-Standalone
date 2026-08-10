import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { BodyType } from '../core/types';
import { MOUND_Z, PITCH_RELEASE_X, RELEASE_Y, RELEASE_Z } from '../core/constants';
import {
  PITCHING_MOTION_DATA,
  PITCHING_MOTION_PHASES,
  PITCHING_MOTION_SOURCE,
  PITCHING_MOTION_STRIDE,
} from '../render/pitching-motion.generated';
import {
  PITCHING_PHASES,
  PITCH_RELEASE_FRAME,
  PITCH_THROW_DURATION,
  createPitchingMotionSample,
  samplePitchingMotion,
  type PitchingMotionSample,
} from '../render/pitching';
import { PLAYER_REPLAY_FLOATS, PLAYER_REPLAY_OBJECT_INDEX, PlayerActor } from '../render/actors';

const COLORS = { jersey: 0x17365d, trim: 0xf0f0f0, accent: 0xb51f2e, skin: 0xc68642 };
const BODIES: BodyType[] = ['slim', 'average', 'stocky', 'tall', 'huge'];

function quaternionChannels(sample: PitchingMotionSample): THREE.Quaternion[] {
  return [
    sample.torsoQuaternion, sample.headQuaternion,
    sample.leftArmQuaternion, sample.leftForearmQuaternion,
    sample.rightArmQuaternion, sample.rightForearmQuaternion,
    sample.leftThighQuaternion, sample.leftShinQuaternion,
    sample.rightThighQuaternion, sample.rightShinQuaternion,
  ];
}

function expectReflectedQuaternion(left: THREE.Quaternion, right: THREE.Quaternion): void {
  expect(left.x).toBeCloseTo(right.x, 6);
  expect(left.y).toBeCloseTo(-right.y, 6);
  expect(left.z).toBeCloseTo(-right.z, 6);
  expect(left.w).toBeCloseTo(right.w, 6);
}

function pitchActor(body: BodyType, armSign: number, phase = 0): PlayerActor {
  const result = new PlayerActor(COLORS, body, 'cap');
  result.update(0, {
    x: 0.24, z: 18.2, speed: 0, facing: Math.PI,
    pose: 'pitchThrow', poseT: phase, armSign,
  });
  return result;
}

function actorResources(actor: PlayerActor): { geometries: Set<THREE.BufferGeometry>; materials: Set<THREE.Material> } {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  actor.group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  return { geometries, materials };
}

/** Root position is already part of the fixed replay contract; use it to
 * measure delivery continuity without exposing actor implementation details. */
function replayRootPosition(actor: PlayerActor, out: THREE.Vector3): THREE.Vector3 {
  const frame = new Float32Array(PLAYER_REPLAY_FLOATS);
  actor.writeReplay(frame, 0);
  const offset = PLAYER_REPLAY_OBJECT_INDEX.root * 11;
  return out.set(frame[offset], frame[offset + 1], frame[offset + 2]);
}

describe('baked pitching motion', () => {
  it('keeps the pinned CMU source contract and compact numeric payload', () => {
    expect(PITCHING_MOTION_SOURCE).toMatchObject({
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
    });
    expect(PITCHING_MOTION_PHASES).toHaveLength(33);
    expect(PITCHING_MOTION_PHASES).toContain(PITCH_RELEASE_FRAME);
    expect(PITCHING_MOTION_DATA).toHaveLength(33 * PITCHING_MOTION_STRIDE);
    expect(PITCHING_MOTION_STRIDE).toBe(49);
    expect([...PITCHING_MOTION_DATA].every(Number.isFinite)).toBe(true);
    expect(PITCHING_PHASES.release).toBe(PITCH_RELEASE_FRAME);
  });

  it('samples finite normalized rotations and an exact left-arm reflection', () => {
    const right = createPitchingMotionSample();
    const left = createPitchingMotionSample();
    for (const phase of PITCHING_MOTION_PHASES) {
      samplePitchingMotion(phase, -1, right);
      samplePitchingMotion(phase, 1, left);
      for (const quaternion of [...quaternionChannels(right), ...quaternionChannels(left)]) {
        expect(quaternion.toArray().every(Number.isFinite)).toBe(true);
        expect(quaternion.length()).toBeCloseTo(1, 5);
      }
      expect(left.rootPosition.x).toBeCloseTo(-right.rootPosition.x, 6);
      expect(left.rootPosition.y).toBeCloseTo(right.rootPosition.y, 6);
      expect(left.rootPosition.z).toBeCloseTo(right.rootPosition.z, 6);
      expectReflectedQuaternion(left.torsoQuaternion, right.torsoQuaternion);
      expectReflectedQuaternion(left.headQuaternion, right.headQuaternion);
      expectReflectedQuaternion(left.leftArmQuaternion, right.rightArmQuaternion);
      expectReflectedQuaternion(left.leftForearmQuaternion, right.rightForearmQuaternion);
      expectReflectedQuaternion(left.rightArmQuaternion, right.leftArmQuaternion);
      expectReflectedQuaternion(left.rightForearmQuaternion, right.leftForearmQuaternion);
      expectReflectedQuaternion(left.leftThighQuaternion, right.rightThighQuaternion);
      expectReflectedQuaternion(left.leftShinQuaternion, right.rightShinQuaternion);
      expectReflectedQuaternion(left.rightThighQuaternion, right.leftThighQuaternion);
      expectReflectedQuaternion(left.rightShinQuaternion, right.leftShinQuaternion);
      expect(left.leftElbowPole.x).toBeCloseTo(-right.rightElbowPole.x, 6);
      expect(left.leftElbowPole.y).toBeCloseTo(right.rightElbowPole.y, 6);
      expect(left.leftElbowPole.z).toBeCloseTo(right.rightElbowPole.z, 6);
      expect(left.rightElbowPole.x).toBeCloseTo(-right.leftElbowPole.x, 6);
      expect(left.rightElbowPole.y).toBeCloseTo(right.leftElbowPole.y, 6);
      expect(left.rightElbowPole.z).toBeCloseTo(right.leftElbowPole.z, 6);
    }
  });
});

describe('procedural pitcher', () => {
  it('keeps the real mound-release socket aligned for every body type and throwing side', () => {
    for (const body of BODIES) {
      for (const armSign of [-1, 1]) {
        const pitcher = new PlayerActor(COLORS, body, 'cap');
        const target = new THREE.Vector3(armSign * PITCH_RELEASE_X, RELEASE_Y, RELEASE_Z);
        const socket = new THREE.Vector3();
        // Physics establishes immutable x0/y0/z0 before windup. Model the
        // live 60 Hz path so the socket is calibrated continuously, rather
        // than correcting it visibly on the windup-to-pitch boundary.
        for (let frame = 0; frame <= 25; frame++) {
          pitcher.update(1 / 60, {
            x: 0, z: MOUND_Z, speed: 0, facing: Math.PI,
            pose: 'pitchSet', poseT: frame / 25, armSign, releaseTarget: target,
          });
        }
        const preRelease = pitcher.readPitchReleaseSocket(armSign, socket).clone();
        // `pitchThrow` local time zero is the global PITCH_RELEASE_FRAME.
        pitcher.update(1 / 60, {
          x: 0, z: MOUND_Z, speed: 0, facing: Math.PI,
          pose: 'pitchThrow', poseT: 0, armSign, releaseTarget: target,
        });
        expect(pitcher.readPitchReleaseSocket(armSign, socket)).toBe(socket);
        const diagnostics = pitcher.readPitchReleaseDiagnostics(new THREE.Vector3());
        expect(diagnostics.z).toBe(1);
        expect(diagnostics.x).toBeLessThanOrEqual(0.4);
        expect(diagnostics.y).toBeLessThanOrEqual(0.25);
        expect(socket.distanceTo(target)).toBeLessThanOrEqual(0.02);
        expect(preRelease.distanceTo(socket)).toBeLessThanOrEqual(0.1);
        expect(socket.toArray().every(Number.isFinite)).toBe(true);
      }
    }
  });

  it('keeps a finite safe pitching fallback when no release target is supplied', () => {
    for (const body of BODIES) {
      for (const armSign of [-1, 1]) {
        const pitcher = new PlayerActor(COLORS, body, 'cap');
        pitcher.update(0.1, {
          x: 0, z: MOUND_Z, speed: 0, facing: Math.PI,
          pose: 'pitchSet', poseT: 1, armSign,
        });
        pitcher.update(1 / 60, {
          x: 0, z: MOUND_Z, speed: 0, facing: Math.PI,
          pose: 'pitchThrow', poseT: 0, armSign,
        });
        const socket = pitcher.readPitchReleaseSocket(armSign, new THREE.Vector3());
        expect(socket.toArray().every(Number.isFinite)).toBe(true);
        expect(socket.length()).toBeLessThan(30);
      }
    }
  });

  it('decays release calibration smoothly through follow-through without target dependence', () => {
    // At 60 Hz the delivery pose reaches its one-shot endpoint in the authored
    // post-release duration. A
    // <=0.40 m hand step and <=0.18 m root step permit the fast natural arm
    // finish (measured max: 0.358 m / 0.164 m) while rejecting the prior
    // 0.928–1.008 m target-cutoff pop.
    const maxSocketStep = 0.4;
    const maxRootStep = 0.18;
    const throwFrames = Math.ceil(PITCH_THROW_DURATION * 60) + 8;
    const followThroughT =
      (PITCHING_PHASES.followThrough - PITCH_RELEASE_FRAME) / (1 - PITCH_RELEASE_FRAME);

    for (const body of BODIES) {
      for (const armSign of [-1, 1]) {
        const target = new THREE.Vector3(armSign * PITCH_RELEASE_X, RELEASE_Y, RELEASE_Z);
        const calibrated = new PlayerActor(COLORS, body, 'cap');
        const uncalibrated = new PlayerActor(COLORS, body, 'cap');
        for (let frame = 0; frame <= 25; frame++) {
          const opts = {
            x: 0, z: MOUND_Z, speed: 0, facing: Math.PI,
            pose: 'pitchSet' as const, poseT: frame / 25, armSign,
          };
          calibrated.update(1 / 60, { ...opts, releaseTarget: target });
          uncalibrated.update(1 / 60, opts);
        }

        let previousSocket = calibrated.readPitchReleaseSocket(armSign, new THREE.Vector3());
        let previousRoot = replayRootPosition(calibrated, new THREE.Vector3());
        for (let frame = 0; frame <= throwFrames; frame++) {
          const poseT = Math.min(1, frame / (PITCH_THROW_DURATION * 60));
          const opts = {
            x: 0, z: MOUND_Z, speed: 0, facing: Math.PI,
            pose: 'pitchThrow' as const, poseT, armSign,
          };
          calibrated.update(1 / 60, { ...opts, releaseTarget: target });
          uncalibrated.update(1 / 60, opts);
          const socket = calibrated.readPitchReleaseSocket(armSign, new THREE.Vector3());
          const root = replayRootPosition(calibrated, new THREE.Vector3());
          expect(socket.distanceTo(previousSocket)).toBeLessThanOrEqual(maxSocketStep);
          expect(root.distanceTo(previousRoot)).toBeLessThanOrEqual(maxRootStep);
          previousSocket = socket;
          previousRoot = root;

          if (poseT >= followThroughT) {
            const naturalSocket = uncalibrated.readPitchReleaseSocket(armSign, new THREE.Vector3());
            const naturalRoot = replayRootPosition(uncalibrated, new THREE.Vector3());
            expect(socket.distanceTo(naturalSocket)).toBeLessThan(1e-5);
            expect(root.distanceTo(naturalRoot)).toBeLessThan(1e-5);
          }
        }
      }
    }
  });

  it('puts the field glove on the non-throwing arm for both pitching sides', () => {
    for (const body of BODIES) {
      for (const armSign of [-1, 1]) {
        const pitcher = new PlayerActor(COLORS, body, 'cap');
        for (const [pose, poseT] of [['pitchSet', 1], ['pitchThrow', 0]] as const) {
          pitcher.update(0.1, {
            x: 0, z: MOUND_Z, speed: 0, facing: Math.PI,
            pose, poseT, armSign,
          });
          // API signs describe glove side (-1 left, +1 right), whereas an
          // armSign describes the throwing side (+1 left, -1 right). Equal
          // signs therefore mean right throw/left glove or left throw/right
          // glove: always the anatomical non-throwing arm.
          expect(pitcher.readPitchGloveSide()).toBe(armSign);
        }
      }
    }
  });

  it('refuses an absurd finite release target without changing the baked pose', () => {
    const baseline = new PlayerActor(COLORS, 'average', 'cap');
    const guarded = new PlayerActor(COLORS, 'average', 'cap');
    const options = { x: 0, z: MOUND_Z, speed: 0, facing: Math.PI, pose: 'pitchSet' as const, poseT: 1, armSign: -1 };
    baseline.update(0.1, options);
    guarded.update(0.1, options);
    const absurd = new THREE.Vector3(50, 50, 50);
    baseline.update(1 / 60, { ...options, pose: 'pitchThrow', poseT: 0 });
    guarded.update(1 / 60, {
      ...options,
      pose: 'pitchThrow',
      poseT: 0,
      releaseTarget: absurd,
    });
    const diagnostics = guarded.readPitchReleaseDiagnostics(new THREE.Vector3());
    expect(diagnostics.x).toBeGreaterThan(0.4);
    expect(diagnostics.y).toBe(Infinity);
    expect(diagnostics.z).toBe(0);
    const expected = new Float32Array(PLAYER_REPLAY_FLOATS);
    const actual = new Float32Array(PLAYER_REPLAY_FLOATS);
    baseline.writeReplay(expected, 0);
    guarded.writeReplay(actual, 0);
    expect([...actual].every(Number.isFinite)).toBe(true);
    for (let i = 0; i < actual.length; i++) expect(actual[i]).toBeCloseTo(expected[i], 6);
  });

  it('rejects a canonical target when a misoriented actor cannot reach it at release', () => {
    const baseline = new PlayerActor(COLORS, 'average', 'cap');
    const guarded = new PlayerActor(COLORS, 'average', 'cap');
    // This is a coordinate-valid physics target. The actor is deliberately
    // facing away from the mound-to-plate delivery direction, so the exact
    // release-phase precheck must reject it before intermediate clamping or IK.
    const options = { x: 0, z: MOUND_Z, speed: 0, facing: 0, pose: 'pitchSet' as const, poseT: 1, armSign: -1 };
    const target = new THREE.Vector3(-0.42, RELEASE_Y, RELEASE_Z);
    baseline.update(0.1, options);
    guarded.update(0.1, options);
    baseline.update(1 / 60, { ...options, pose: 'pitchThrow', poseT: 0 });
    guarded.update(1 / 60, {
      ...options,
      pose: 'pitchThrow',
      poseT: 0,
      releaseTarget: target,
    });
    const diagnostics = guarded.readPitchReleaseDiagnostics(new THREE.Vector3());
    expect(diagnostics.x).toBeGreaterThan(0.4);
    expect(diagnostics.y).toBe(Infinity);
    expect(diagnostics.z).toBe(0);
    const expected = new Float32Array(PLAYER_REPLAY_FLOATS);
    const actual = new Float32Array(PLAYER_REPLAY_FLOATS);
    baseline.writeReplay(expected, 0);
    guarded.writeReplay(actual, 0);
    expect([...actual].every(Number.isFinite)).toBe(true);
    for (let i = 0; i < actual.length; i++) expect(actual[i]).toBeCloseTo(expected[i], 6);
  });

  it('rejects non-finite release targets before IK without poisoning replay', () => {
    for (const target of [
      new THREE.Vector3(Number.NaN, RELEASE_Y, RELEASE_Z),
      new THREE.Vector3(0.42, Number.POSITIVE_INFINITY, RELEASE_Z),
    ]) {
      const pitcher = new PlayerActor(COLORS, 'average', 'cap');
      pitcher.update(0.1, {
        x: 0, z: MOUND_Z, speed: 0, facing: Math.PI,
        pose: 'pitchSet', poseT: 1, armSign: -1, releaseTarget: target,
      });
      const diagnostics = pitcher.readPitchReleaseDiagnostics(new THREE.Vector3());
      expect(diagnostics.x).toBe(Infinity);
      expect(diagnostics.y).toBe(Infinity);
      expect(diagnostics.z).toBe(0);
      const replay = new Float32Array(PLAYER_REPLAY_FLOATS);
      pitcher.writeReplay(replay, 0);
      expect([...replay].every(Number.isFinite)).toBe(true);
    }
  });

  it('reuses cached geometry and materials throughout a full bilateral delivery sweep', () => {
    const first = pitchActor('average', -1);
    const second = pitchActor('average', -1);
    const baseline = actorResources(first);
    const sibling = actorResources(second);
    expect(sibling.geometries.size).toBe(baseline.geometries.size);
    expect(sibling.materials.size).toBe(baseline.materials.size);
    for (const geometry of sibling.geometries) expect(baseline.geometries.has(geometry)).toBe(true);
    for (const material of sibling.materials) expect(baseline.materials.has(material)).toBe(true);

    for (const body of BODIES) {
      for (const armSign of [-1, 1]) {
        const pitcher = pitchActor(body, armSign);
        const resources = actorResources(pitcher);
        for (let i = 0; i <= 100; i++) {
          pitcher.update(0, {
            x: 0, z: 18.2, speed: 0, facing: Math.PI,
            pose: 'pitchThrow', poseT: i / 100, armSign,
          });
        }
        const after = actorResources(pitcher);
        expect(after.geometries.size).toBe(resources.geometries.size);
        expect(after.materials.size).toBe(resources.materials.size);
        for (const geometry of after.geometries) expect(resources.geometries.has(geometry)).toBe(true);
        for (const material of after.materials) expect(resources.materials.has(material)).toBe(true);
      }
    }
  });

  it('keeps the fixed 154-float replay payload and round-trips a delivery', () => {
    expect(PLAYER_REPLAY_FLOATS).toBe(154);
    for (const armSign of [-1, 1]) {
      const source = pitchActor('average', armSign, 0.42);
      expect(source.readPitchGloveSide()).toBe(armSign);
      const frame = new Float32Array(PLAYER_REPLAY_FLOATS);
      source.writeReplay(frame, 0);
      const restored = new PlayerActor(COLORS, 'average', 'cap');
      restored.applyReplay(frame, 0);
      expect(restored.readPitchGloveSide()).toBe(armSign);
      const replayed = new Float32Array(PLAYER_REPLAY_FLOATS);
      restored.writeReplay(replayed, 0);
      for (let i = 0; i < frame.length; i++) expect(replayed[i]).toBeCloseTo(frame[i], 5);
    }
  });
});
