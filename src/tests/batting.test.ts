import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { BodyType } from '../core/types';
import {
  BATTING_MOTION_DATA,
  BATTING_MOTION_PHASES,
  BATTING_MOTION_SOURCE,
  BATTING_MOTION_STRIDE,
} from '../render/batting-motion.generated';
import {
  BATTING_PHASES,
  createBattingMotionSample,
  sampleBattingMotion,
  swingPoseProgress,
} from '../render/batting';
import {
  PLAYER_REPLAY_FLOATS,
  PlayerActor,
} from '../render/actors';
import { createTwoBoneIKScratch, solveTwoBoneIK } from '../render/kinematics';

const COLORS = { jersey: 0x17365d, trim: 0xf0f0f0, accent: 0xb51f2e, skin: 0xc68642 };
const BODIES: BodyType[] = ['slim', 'average', 'stocky', 'tall', 'huge'];

function actor(body: BodyType, handed: number, poseT: number, pose: 'batSwing' | 'bunt' = 'batSwing') {
  const result = new PlayerActor(COLORS, body, 'helmet');
  result.update(0, { x: 0, z: 0, speed: 0, facing: 0, pose, poseT, handed });
  return result;
}

describe('baked batting motion', () => {
  it('keeps the pinned source contract and an explicit contact sample', () => {
    expect(BATTING_MOTION_SOURCE.commit).toBe('09a07f54f3bbb58797325f009282d0b2048a2871');
    expect(BATTING_MOTION_SOURCE.sha256).toBe(
      'fe848034a77cac57ff49a77e9a57d2af3d714f549ced078b128e458910666ba4',
    );
    expect(BATTING_MOTION_PHASES).toHaveLength(33);
    expect([...BATTING_MOTION_PHASES]).toContain(BATTING_PHASES.contact);
    expect(BATTING_MOTION_DATA).toHaveLength(33 * BATTING_MOTION_STRIDE);
    expect([...BATTING_MOTION_DATA].every(Number.isFinite)).toBe(true);
  });

  it('samples normalized quaternions and exact mirrored handedness', () => {
    const right = createBattingMotionSample();
    const left = createBattingMotionSample();
    for (const phase of BATTING_MOTION_PHASES) {
      sampleBattingMotion(phase, -1, right);
      sampleBattingMotion(phase, 1, left);
      for (const q of [
        right.rootQuaternion,
        right.torsoQuaternion,
        right.headQuaternion,
        right.leftThighQuaternion,
        right.leftShinQuaternion,
        right.rightThighQuaternion,
        right.rightShinQuaternion,
        right.batQuaternion,
        left.rootQuaternion,
        left.torsoQuaternion,
        left.headQuaternion,
        left.leftThighQuaternion,
        left.leftShinQuaternion,
        left.rightThighQuaternion,
        left.rightShinQuaternion,
        left.batQuaternion,
      ]) expect(q.length()).toBeCloseTo(1, 5);
      expect(left.rootPosition.x).toBeCloseTo(-right.rootPosition.x, 6);
      expect(left.rootPosition.y).toBeCloseTo(right.rootPosition.y, 6);
      expect(left.rootPosition.z).toBeCloseTo(right.rootPosition.z, 6);
      expect(left.batPosition.x).toBeCloseTo(-right.batPosition.x, 6);
      expect(left.batPosition.y).toBeCloseTo(right.batPosition.y, 6);
      expect(left.batPosition.z).toBeCloseTo(right.batPosition.z, 6);
    }
  });

  it('maps every latency to the same authoritative contact phase', () => {
    for (const latency of [0.055, 0.125, 0.165]) {
      expect(swingPoseProgress(latency, latency)).toBe(BATTING_PHASES.contact);
      expect(swingPoseProgress(latency + 0.42, latency)).toBe(1);
    }
  });
});

describe('analytical two-bone IK', () => {
  it('hits a reachable target and safely clamps an unreachable target', () => {
    const parent = new THREE.Group();
    const shoulder = new THREE.Group();
    const elbow = new THREE.Group();
    const wrist = new THREE.Group();
    elbow.position.y = -0.3;
    wrist.position.y = -0.3;
    parent.add(shoulder);
    shoulder.add(elbow);
    elbow.add(wrist);
    const chain = { shoulder, elbow, wrist, upperLength: 0.3, lowerLength: 0.3 };
    const scratch = createTwoBoneIKScratch();
    const target = new THREE.Vector3(0.22, -0.42, 0.12);
    expect(solveTwoBoneIK(chain, target, new THREE.Quaternion(), new THREE.Vector3(1, 0, 0), 1, scratch)).toBe(true);
    parent.updateMatrixWorld(true);
    expect(wrist.getWorldPosition(new THREE.Vector3()).distanceTo(target)).toBeLessThan(1e-6);

    expect(solveTwoBoneIK(chain, new THREE.Vector3(4, 0, 0), new THREE.Quaternion(), new THREE.Vector3(), 1, scratch)).toBe(false);
    for (const q of [shoulder.quaternion, elbow.quaternion, wrist.quaternion]) {
      expect(q.toArray().every(Number.isFinite)).toBe(true);
      expect(q.length()).toBeCloseTo(1, 6);
    }
  });
});

describe('two-handed procedural batter', () => {
  it('builds articulated wrists, hand variants, anchors, and bat sockets', () => {
    const names: string[] = [];
    const built = actor('average', -1, 0);
    built.group.traverse((object) => { if (object.name) names.push(object.name); });
    for (const name of [
      'wrist-left', 'wrist-right', 'hand-left-relaxed', 'hand-right-relaxed',
      'hand-left-grip', 'hand-right-grip', 'hand-anchor-left', 'hand-anchor-right',
      'bat-grip-bottom', 'bat-grip-top', 'bat-bunt-support', 'bat-tip',
    ]) expect(names).toContain(name);
  });

  it('holds both sockets for every body, handedness, and swing sample', () => {
    for (const body of BODIES) {
      for (const handed of [-1, 1]) {
        const batter = new PlayerActor(COLORS, body, 'helmet');
        for (let i = 0; i <= 100; i++) {
          batter.update(0, { x: 0, z: 0, speed: 0, facing: 0, pose: 'batSwing', poseT: i / 100, handed });
          const d = batter.readBattingDiagnostics();
          const leftSocket = handed < 0 ? d.gripBottom : d.gripTop;
          const rightSocket = handed < 0 ? d.gripTop : d.gripBottom;
          expect(d.handAnchorLeft.distanceTo(leftSocket)).toBeLessThan(0.002);
          expect(d.handAnchorRight.distanceTo(rightSocket)).toBeLessThan(0.002);
          expect(d.handAnchorLeft.distanceTo(d.handAnchorRight)).toBeGreaterThan(0.055);
          expect(d.handAnchorLeft.distanceTo(d.handAnchorRight)).toBeLessThan(0.115);
          for (const q of [d.shoulderLeft, d.elbowLeft, d.wristLeft, d.shoulderRight, d.elbowRight, d.wristRight]) {
            expect(q.toArray().every(Number.isFinite)).toBe(true);
          }
        }
      }
    }
  });

  it('uses the bottom handle and barrel support sockets while bunting', () => {
    for (const body of BODIES) {
      for (const handed of [-1, 1]) {
        const d = actor(body, handed, 0, 'bunt').readBattingDiagnostics();
        expect(d.handAnchorLeft.distanceTo(handed < 0 ? d.gripBottom : d.buntSupport)).toBeLessThan(0.002);
        expect(d.handAnchorRight.distanceTo(handed < 0 ? d.buntSupport : d.gripBottom)).toBeLessThan(0.002);
      }
    }
  });

  it('mirrors the complete barrel path and never teleports', () => {
    let previousRight: THREE.Vector3 | null = null;
    let previousLeft: THREE.Vector3 | null = null;
    for (let i = 0; i <= 120; i++) {
      const phase = i / 120;
      const right = actor('average', -1, phase).readBattingDiagnostics().batTip;
      const left = actor('average', 1, phase).readBattingDiagnostics().batTip;
      expect(left.x).toBeCloseTo(-right.x, 6);
      expect(left.y).toBeCloseTo(right.y, 6);
      expect(left.z).toBeCloseTo(right.z, 6);
      if (previousRight && previousLeft) {
        expect(previousRight.distanceTo(right)).toBeLessThan(0.3);
        expect(previousLeft.distanceTo(left)).toBeLessThan(0.3);
      }
      previousRight = right;
      previousLeft = left;
    }
  });

  it('reconstructs derived wrists after replay without growing the payload', () => {
    expect(PLAYER_REPLAY_FLOATS).toBe(154);
    for (const handed of [-1, 1]) {
      const source = actor('average', handed, 0.82);
      const frame = new Float32Array(PLAYER_REPLAY_FLOATS);
      source.writeReplay(frame, 0);
      const restored = new PlayerActor(COLORS, 'average', 'helmet');
      restored.applyReplay(frame, 0);
      const replayed = new Float32Array(PLAYER_REPLAY_FLOATS);
      restored.writeReplay(replayed, 0);
      for (let i = 0; i < frame.length; i++) expect(replayed[i]).toBeCloseTo(frame[i], 5);
      const d = restored.readBattingDiagnostics();
      const normalError = Math.min(
        d.handAnchorLeft.distanceTo(d.gripBottom) + d.handAnchorRight.distanceTo(d.gripTop),
        d.handAnchorLeft.distanceTo(d.gripTop) + d.handAnchorRight.distanceTo(d.gripBottom),
      );
      expect(normalError).toBeLessThan(0.004);
    }
  });
});
