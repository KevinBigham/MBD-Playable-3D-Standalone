import core, { type IProject, type ISheetObject } from '@theatre/core';
import type { BroadcastSequenceV1, BroadcastShotV1 } from '../../../src/replay/contract';

const { getProject, types } = core;

const ANCHORS = {
  'recorded-camera': 'Recorded camera',
  ball: 'Ball',
  'primary-actor': 'Primary actor',
  'home-plate': 'Home plate',
} as const;
const FALLBACKS = {
  'recorded-camera': 'Recorded camera',
  ball: 'Ball',
  'home-plate': 'Home plate',
} as const;
const EASING = {
  linear: 'Linear',
  smoothstep: 'Smoothstep',
  'ease-in-out-cubic': 'Ease in/out cubic',
} as const;

const n = (value = 0, min = -200, max = 200) => types.number(value, { range: [min, max], nudgeMultiplier: 0.1 });
const v = (x = 0, y = 0, z = 0) => ({ x: n(x), y: n(y), z: n(z) });

export const PROJECT_ID = 'MBD Home Run Broadcast v1';
export const SHEET_ID = 'Home Run Replay';

export interface ShotObjectValue {
  start: number;
  end: number;
  anchor: BroadcastShotV1['anchor'];
  fallbackAnchor: BroadcastShotV1['fallbackAnchor'];
  eyeFrom: { x: number; y: number; z: number };
  eyeTo: { x: number; y: number; z: number };
  lookFrom: { x: number; y: number; z: number };
  lookTo: { x: number; y: number; z: number };
  fovFrom: number;
  fovTo: number;
  ease: BroadcastShotV1['ease'];
  cut: boolean;
}

type ShotObject = ISheetObject<ReturnType<typeof shotConfig>>;

function shotConfig() {
  return {
    start: n(0, 0, 1),
    end: n(1, 0, 1),
    anchor: types.stringLiteral('home-plate', ANCHORS),
    fallbackAnchor: types.stringLiteral('recorded-camera', FALLBACKS),
    eyeFrom: v(),
    eyeTo: v(),
    lookFrom: v(),
    lookTo: v(),
    fovFrom: n(45, 18, 90),
    fovTo: n(45, 18, 90),
    ease: types.stringLiteral('smoothstep', EASING),
    cut: true,
  };
}

export interface AuthoringProject {
  project: IProject;
  sheet: ReturnType<IProject['sheet']>;
  shots: [ShotObject, ShotObject];
}

export function createAuthoringProject(state?: unknown, projectId = PROJECT_ID): AuthoringProject {
  const project = getProject(projectId, state ? { state } : undefined);
  const sheet = project.sheet(SHEET_ID);
  const shots: [ShotObject, ShotObject] = [
    sheet.object('01 Flight Chase', shotConfig()),
    sheet.object('02 Plate Celebration', shotConfig()),
  ];
  return { project, sheet, shots };
}

function tuple(value: { x: number; y: number; z: number }): [number, number, number] {
  return [value.x, value.y, value.z];
}

export function nativeFromAuthoring(authoring: AuthoringProject): BroadcastSequenceV1 {
  const ids = ['flight-chase', 'plate-celebration'];
  return {
    version: 1,
    id: 'home-run-primary',
    label: 'Home Run — Flight and Batter',
    kind: 'home-run',
    shots: authoring.shots.map((object, index) => {
      const value = object.value as unknown as ShotObjectValue;
      return {
        id: ids[index],
        start: value.start,
        end: value.end,
        anchor: value.anchor,
        fallbackAnchor: value.fallbackAnchor,
        eyeFrom: tuple(value.eyeFrom),
        eyeTo: tuple(value.eyeTo),
        lookFrom: tuple(value.lookFrom),
        lookTo: tuple(value.lookTo),
        fovFrom: value.fovFrom,
        fovTo: value.fovTo,
        ease: value.ease,
        cut: value.cut,
      };
    }),
  };
}
