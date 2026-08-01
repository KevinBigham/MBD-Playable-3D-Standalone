import type { PitchProfile, PitchType } from '../core/types';

/**
 * Pitch repertoire definitions.
 *
 * `breakX` is expressed in the pitcher's ARM-SIDE direction: positive numbers
 * move the ball toward the pitcher's throwing hand. A right-hander faces -Z so
 * his arm side is -X; a left-hander's is +X. The engine multiplies by that sign,
 * so a slider (negative breakX = glove side) sweeps away from a same-handed
 * hitter no matter who is on the mound.
 *
 * `breakY` is metres of vertical deviation from the plain gravity arc at the
 * plate. Positive = the ball resists gravity (the classic "rising" four-seamer);
 * negative = it dives.
 */
export const PITCHES: Record<PitchType, PitchProfile> = {
  fastball: {
    type: 'fastball',
    label: 'Four-Seam',
    short: 'FB',
    speed: 38.4,
    speedSpan: 4.6,
    breakX: 0.06,
    breakY: 0.13,
    wildness: 0.55,
    lateness: 0.25,
    color: 0xffe066,
  },
  heater: {
    type: 'heater',
    label: 'Heater',
    short: 'HTR',
    speed: 40.9,
    speedSpan: 4.8,
    breakX: 0.04,
    breakY: 0.17,
    wildness: 1.05,
    lateness: 0.2,
    color: 0xff6b3d,
  },
  changeup: {
    type: 'changeup',
    label: 'Change',
    short: 'CH',
    speed: 33.9,
    speedSpan: 3.4,
    breakX: 0.15,
    breakY: -0.17,
    wildness: 0.7,
    lateness: 0.6,
    color: 0x7ee081,
  },
  curve: {
    type: 'curve',
    label: 'Curveball',
    short: 'CB',
    speed: 32.4,
    speedSpan: 3.3,
    breakX: -0.2,
    breakY: -0.48,
    wildness: 0.9,
    lateness: 0.55,
    color: 0x6ec8ff,
  },
  slider: {
    type: 'slider',
    label: 'Slider',
    short: 'SL',
    speed: 36.1,
    speedSpan: 3.6,
    breakX: -0.36,
    breakY: -0.17,
    wildness: 0.8,
    lateness: 0.65,
    color: 0xc08bff,
  },
  screwball: {
    type: 'screwball',
    label: 'Screwball',
    short: 'SCR',
    speed: 33.4,
    speedSpan: 3.2,
    breakX: 0.4,
    breakY: -0.15,
    wildness: 1.0,
    lateness: 0.6,
    color: 0xff8ad4,
  },
  sinker: {
    type: 'sinker',
    label: 'Sinker',
    short: 'SNK',
    speed: 37.4,
    speedSpan: 4.0,
    breakX: 0.27,
    breakY: -0.31,
    wildness: 0.65,
    lateness: 0.5,
    color: 0xffb347,
  },
  cutter: {
    type: 'cutter',
    label: 'Cutter',
    short: 'CUT',
    speed: 37.8,
    speedSpan: 3.8,
    breakX: -0.19,
    breakY: -0.05,
    wildness: 0.6,
    lateness: 0.75,
    color: 0xa8d8ff,
  },
  knuckler: {
    type: 'knuckler',
    label: 'Knuckler',
    short: 'KNK',
    speed: 29.2,
    speedSpan: 2.4,
    breakX: 0.0,
    breakY: -0.12,
    wildness: 2.6,
    lateness: 0.45,
    color: 0xd8d8d8,
  },
  splitter: {
    type: 'splitter',
    label: 'Splitter',
    short: 'SPL',
    speed: 36.2,
    speedSpan: 3.4,
    breakX: 0.05,
    breakY: -0.44,
    wildness: 0.95,
    lateness: 0.82,
    color: 0x9ef0e0,
  },
};

export const ALL_PITCH_TYPES = Object.keys(PITCHES) as PitchType[];

/** Knuckleballs get a fresh random break every pitch; everything else is fixed. */
export function isChaotic(type: PitchType): boolean {
  return type === 'knuckler';
}

/**
 * World-space break for a specific pitcher's version of a pitch, in metres at
 * the plate. Shared by the engine (which launches the ball) and the plate view
 * (which draws the shape before it is thrown) so the preview can never drift
 * away from what the pitch actually does.
 *
 * `movement01` is the pitcher's movement rating on a 0..1 scale.
 */
export function pitchBreak(
  type: PitchType,
  throws: 'L' | 'R' | 'S',
  movement01: number,
): { breakX: number; breakY: number } {
  const prof = PITCHES[type];
  const armSign = throws === 'L' ? 1 : -1;
  const scale = 0.7 + movement01 * 0.6;
  return { breakX: prof.breakX * armSign * scale, breakY: prof.breakY * scale };
}
