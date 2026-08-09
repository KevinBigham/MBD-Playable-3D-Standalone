import { describe, expect, it } from 'vitest';
import type { BodyType } from '../core/types';
import {
  PLAYER_REPLAY_FLOATS,
  PlayerActor,
  SWING_CONTACT_FRAME,
  actorResourceCounts,
  poseTransitionDuration,
  type PlayerEquipment,
} from '../render/actors';

const COLORS = { jersey: 0x17365d, trim: 0xf0f0f0, accent: 0xb51f2e, skin: 0xc68642 };

function frame(actor: PlayerActor): Float32Array {
  const result = new Float32Array(PLAYER_REPLAY_FLOATS);
  actor.writeReplay(result, 0);
  return result;
}

function names(actor: PlayerActor): string[] {
  const result: string[] = [];
  actor.group.traverse((object) => {
    if (object.name) result.push(object.name);
  });
  return result;
}

/** Quaternion X for one object in PlayerActor's stable replay layout. */
function replayQuaternionX(frame: Float32Array, object: number): number {
  return frame[object * 11 + 3];
}

function replayQuaternion(frame: Float32Array, object: number): [number, number, number, number] {
  const offset = object * 11 + 3;
  return [frame[offset], frame[offset + 1], frame[offset + 2], frame[offset + 3]];
}

function quaternionAngle(a: [number, number, number, number], b: [number, number, number, number]): number {
  const dot = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  return 2 * Math.acos(dot);
}

describe('procedural athlete equipment', () => {
  it('builds role-specific catcher and first-base silhouettes', () => {
    const catcher = new PlayerActor(COLORS, 'stocky', 'catcher', 22, 'catcher');
    const firstBase = new PlayerActor(COLORS, 'tall', 'cap', 18, 'firstBase');
    const catcherNames = names(catcher);
    const firstBaseNames = names(firstBase);

    expect(catcherNames).toContain('catcher-mask-cage');
    expect(catcherNames).toContain('catcher-chest-protector');
    expect(catcherNames).toContain('catcher-shin-guard-left');
    expect(catcherNames).toContain('catcher-shin-guard-right');
    expect(catcherNames).toContain('catcher-glove');
    expect(firstBaseNames).toContain('firstBase-glove');
    expect(firstBaseNames).not.toContain('catcher-chest-protector');
  });

  it('reuses cached geometry and materials after every body/equipment variant is warm', () => {
    const bodies: BodyType[] = ['slim', 'average', 'stocky', 'tall', 'huge'];
    const equipment: PlayerEquipment[] = ['standard', 'catcher', 'firstBase'];
    const buildSet = () => {
      for (const body of bodies) {
        for (const kind of equipment) {
          const actor = new PlayerActor(
            COLORS,
            body,
            kind === 'catcher' ? 'catcher' : 'cap',
            27,
            kind,
          );
          actor.dispose();
        }
      }
    };

    buildSet();
    const warm = actorResourceCounts();
    buildSet();
    expect(actorResourceCounts()).toEqual(warm);
  });
});

describe('native pose transitions', () => {
  it('blends an abrupt semantic pose change from the actually rendered pose', () => {
    const actor = new PlayerActor(COLORS, 'average');
    actor.update(0, { x: 0, z: 0, speed: 0, facing: 0, pose: 'idle', poseT: 0 });
    const idle = frame(actor);
    actor.update(0, { x: 0, z: 0, speed: 0, facing: 0, pose: 'crouch', poseT: 0 });
    const transitionStart = frame(actor);
    expect(transitionStart[12]).toBe(idle[12]);

    actor.update(0.12, { x: 0, z: 0, speed: 0, facing: 0, pose: 'crouch', poseT: 0 });
    expect(frame(actor)[12]).toBeLessThan(-0.2);
  });

  it('never blends across the authoritative bat-contact frame', () => {
    const direct = new PlayerActor(COLORS, 'average', 'helmet');
    const transitioned = new PlayerActor(COLORS, 'average', 'helmet');
    direct.update(0, {
      x: 0,
      z: 0,
      speed: 0,
      facing: 0,
      pose: 'batSwing',
      poseT: SWING_CONTACT_FRAME,
      handed: -1,
    });
    transitioned.update(0, {
      x: 0,
      z: 0,
      speed: 0,
      facing: 0,
      pose: 'batStance',
      poseT: 0,
      handed: -1,
    });
    transitioned.update(0, {
      x: 0,
      z: 0,
      speed: 0,
      facing: 0,
      pose: 'batSwing',
      poseT: SWING_CONTACT_FRAME,
      handed: -1,
    });

    expect([...frame(transitioned)]).toEqual([...frame(direct)]);
    expect(poseTransitionDuration('batStance', 'batSwing')).toBeLessThan(0.06);
  });

  it('folds the trailing knee so the run cycle faces the direction of travel', () => {
    const actor = new PlayerActor(COLORS, 'average');
    const speed = 6;
    // PlayerActor advances phase by dt * (3.2 + speed * 1.5), and poseRun uses
    // sin(phase * 2). Put the left leg at the back of its stride exactly.
    const dt = Math.PI / (4 * (3.2 + speed * 1.5));
    actor.update(dt, { x: 0, z: 0, speed, facing: 0, pose: 'run', poseT: 0 });
    const running = frame(actor);

    // Replay objects 10/11 are the left/right shins. At this phase the left
    // leg trails and must be the bent one; bending the right leg reads backward.
    expect(Math.abs(replayQuaternionX(running, 10))).toBeGreaterThan(0.4);
    expect(Math.abs(replayQuaternionX(running, 11))).toBeLessThan(1e-6);
  });

  it('keeps the bat moving through the full follow-through', () => {
    const atExtension = new PlayerActor(COLORS, 'average', 'helmet');
    const finished = new PlayerActor(COLORS, 'average', 'helmet');
    const opts = { x: 0, z: 0, speed: 0, facing: 0, pose: 'batSwing' as const, handed: -1 };
    atExtension.update(0, { ...opts, poseT: 0.6 });
    finished.update(0, { ...opts, poseT: 1 });

    // Replay object 12 is the bat. The old pose stopped it completely at 60%
    // and spent the rest of the swing changing only root height.
    expect(quaternionAngle(replayQuaternion(frame(atExtension), 12), replayQuaternion(frame(finished), 12)))
      .toBeGreaterThan(0.7);
  });
});
