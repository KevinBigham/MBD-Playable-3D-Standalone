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
});
