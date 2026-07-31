import type { Difficulty, PitchType, Player } from '../core/types';
import { Rng } from '../core/rng';
import { attr01, clamp01, ZONE_CENTER_Y } from '../core/constants';
import { PITCHES } from '../data/pitches';
import { zoneBounds } from './contact';
import type { PitcherRuntime } from './state';

export interface DifficultyParams {
  label: string;
  blurb: string;
  /** 0..1 — how accurately the CPU hitter reads pitch location. */
  perception: number;
  /** 0..1 — how accurately the CPU hitter reads pitch timing. */
  timingSense: number;
  /** 0..1 — how often the CPU pitcher hits its intended spot. */
  command: number;
  /** 0..1 — quality of CPU pitch sequencing. */
  sequencing: number;
  /** Extra seconds before CPU fielders react to a batted ball. */
  fielderDelay: number;
  /** 0..1 — quality of CPU throw target choices. */
  throwSense: number;
  /** 0..1 — how often CPU baserunners take an extra base. */
  aggression: number;
  /** 0..1 — chance the CPU attempts a steal in a good spot. */
  stealDrive: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyParams> = {
  rookie: {
    label: 'ROOKIE',
    blurb: 'Wider timing window for you. CPU misses spots and lets balls drop.',
    perception: 0.42,
    timingSense: 0.4,
    command: 0.45,
    sequencing: 0.3,
    fielderDelay: 0.24,
    throwSense: 0.55,
    aggression: 0.3,
    stealDrive: 0.12,
  },
  pro: {
    label: 'PRO',
    blurb: 'The honest setting. CPU works the count and hits its spots often.',
    perception: 0.66,
    timingSense: 0.66,
    command: 0.7,
    sequencing: 0.65,
    fielderDelay: 0.12,
    throwSense: 0.8,
    aggression: 0.55,
    stealDrive: 0.3,
  },
  allstar: {
    label: 'ACE',
    blurb: 'CPU sequences, chases nothing and throws to the right base. No assist.',
    perception: 0.86,
    timingSense: 0.85,
    command: 0.9,
    sequencing: 0.92,
    fielderDelay: 0.04,
    throwSense: 0.96,
    aggression: 0.78,
    stealDrive: 0.5,
  },
};

// ---------------------------------------------------------------------------
// CPU pitching
// ---------------------------------------------------------------------------

export interface PitchPlan {
  index: number;
  type: PitchType;
  aimX: number;
  aimY: number;
  /** Intent, used only for commentary. */
  intent: 'attack' | 'chase' | 'waste' | 'setup';
}

/**
 * Chooses the next pitch. The CPU never sees the human's cursor or input; it
 * works from the count, the hitter's ratings and its own recent usage.
 */
export function planPitch(
  pitcher: Player,
  runtime: PitcherRuntime,
  batter: Player,
  balls: number,
  strikes: number,
  outs: number,
  runnersOn: boolean,
  d: DifficultyParams,
  rng: Rng,
): PitchPlan {
  const repertoire = pitcher.repertoire ?? ['fastball'];
  const zone = zoneBounds(batter);
  const control = attr01(pitcher.pitch?.control ?? 50);

  // --- What kind of pitch does the situation call for? ---------------------
  const behind = balls > strikes;
  const ahead = strikes > balls;
  const twoStrikes = strikes === 2;
  const threeBalls = balls === 3;

  const scores = repertoire.map((type, index) => {
    const prof = PITCHES[type];
    const used = runtime.usage[type] ?? 0;
    const total = Math.max(1, runtime.pitchCount);
    const share = used / total;

    let s = 1;
    // Strike-throwing pitches when the pitcher must find the zone.
    const strikeability = 1 - prof.wildness * 0.28;
    if (threeBalls) s += strikeability * 1.5;
    if (behind) s += strikeability * 0.7;
    // Chase pitches when ahead.
    if (twoStrikes) s += (Math.abs(prof.breakX) + Math.abs(prof.breakY)) * 1.6;
    if (ahead) s += (Math.abs(prof.breakX) + Math.abs(prof.breakY)) * 0.7;
    // Speed changes are valuable after hard stuff.
    const last = runtime.recent[runtime.recent.length - 1];
    if (last && PITCHES[last].speed - prof.speed > 3.5) s += 0.55 * d.sequencing;
    if (last === type) s -= 0.9 * d.sequencing;
    // Punish leaning on one pitch — this is what stops fastball spam.
    s -= Math.max(0, share - 0.34) * 4.2 * d.sequencing;
    // Fatigue pushes toward easier pitches.
    s += (1 - runtime.stamina) * strikeability * 0.8;
    // A little noise so sequences are not perfectly predictable.
    s += rng.normal(0, 0.42 + (1 - d.sequencing) * 0.7);
    return { index, type, s };
  });

  scores.sort((a, b) => b.s - a.s);
  const chosen = scores[0];

  // --- Where? --------------------------------------------------------------
  const disc = attr01(batter.bat.discipline);
  const power = attr01(batter.bat.power);
  // Mix of intents by count. Overall this lands near half of all pitches in
  // the zone, which is what makes both walks and chase strikeouts possible.
  const roll = rng.next();
  let intent: PitchPlan['intent'];
  if (threeBalls) {
    intent = roll < 0.88 ? 'attack' : 'setup';
  } else if (twoStrikes) {
    const chaseP = 0.6 - disc * 0.15;
    intent = roll < chaseP ? 'chase' : roll < chaseP + 0.25 ? 'setup' : 'attack';
  } else if (ahead) {
    intent = roll < 0.5 ? 'chase' : roll < 0.78 ? 'setup' : 'attack';
  } else if (runnersOn && outs < 2 && power > 0.82 && balls < 2 && roll < 0.14) {
    intent = 'waste';
  } else {
    intent = roll < 0.4 ? 'attack' : roll < 0.76 ? 'setup' : 'chase';
  }

  let aimX = 0;
  let aimY = ZONE_CENTER_Y;
  const halfW = zone.halfWidth;
  const zoneMidY = (zone.top + zone.bottom) / 2;
  const halfH = (zone.top - zone.bottom) / 2;

  // Attack the edges rather than the middle; better command means closer to
  // the black without leaving the zone.
  const edge = 0.55 + control * 0.35;
  const sideSign = rng.chance(0.5) ? 1 : -1;
  const vertSign = rng.chance(0.55) ? -1 : 1;

  switch (intent) {
    case 'attack':
      aimX = sideSign * halfW * edge * (threeBalls ? 0.35 : 1);
      aimY = zoneMidY + vertSign * halfH * edge * (threeBalls ? 0.3 : 0.85);
      break;
    case 'setup':
      // Right on the black: roughly a coin flip for the umpire.
      aimX = sideSign * halfW * 1.06;
      aimY = zoneMidY + vertSign * halfH * 1.06;
      break;
    case 'chase':
      aimX = sideSign * halfW * (1.25 + rng.range(0, 0.5));
      aimY = zoneMidY + vertSign * halfH * (1.3 + rng.range(0, 0.6));
      break;
    case 'waste':
      aimX = sideSign * halfW * 1.9;
      aimY = zoneMidY + halfH * 0.6;
      break;
  }

  // A pitcher who cannot command still aims at the right idea, then misses.
  const spread = (1 - d.command) * 0.16;
  aimX += rng.normal(0, spread);
  aimY += rng.normal(0, spread);

  return { index: chosen.index, type: chosen.type, aimX, aimY, intent };
}

// ---------------------------------------------------------------------------
// CPU hitting
// ---------------------------------------------------------------------------

export interface BatterRead {
  /** Estimated plate crossing position. */
  estX: number;
  estY: number;
  /** Estimated total flight time. */
  estT: number;
  /** True when the CPU has decided to swing. */
  swing: boolean;
  kind: 'contact' | 'power' | 'bunt';
}

/**
 * The CPU hitter's read of a pitch. Called once, part-way through the flight,
 * with the true values plus perception noise. The CPU can never see the exact
 * numbers, which is why it chases and gets fooled.
 */
export function readPitch(
  batter: Player,
  trueX: number,
  trueY: number,
  trueT: number,
  pitchType: PitchType,
  familiarity: number,
  balls: number,
  strikes: number,
  outs: number,
  inningLate: boolean,
  d: DifficultyParams,
  rng: Rng,
): BatterRead {
  const eye = attr01(batter.bat.discipline) * 0.55 + attr01(batter.bat.reaction) * 0.45;
  const skill = clamp01(eye * 0.55 + d.perception * 0.45);
  const move = Math.abs(PITCHES[pitchType].breakX) + Math.abs(PITCHES[pitchType].breakY);

  // Familiarity: the more a pitcher leans on one pitch, the better it is read.
  const fam = clamp01(familiarity);
  const posSigma = (0.034 + (1 - skill) * 0.138 + move * 0.062) * (1 - fam * 0.42);
  const timeSigma = (0.010 + (1 - clamp01(eye * 0.5 + d.timingSense * 0.5)) * 0.046) * (1 - fam * 0.4);

  const estX = trueX + rng.normal(0, posSigma);
  const estY = trueY + rng.normal(0, posSigma);
  const estT = trueT + rng.normal(0, timeSigma);

  const zone = zoneBounds(batter);
  const looksLikeStrike =
    Math.abs(estX) <= zone.halfWidth + 0.06 && estY >= zone.bottom - 0.05 && estY <= zone.top + 0.05;
  const closeCall =
    Math.abs(estX) <= zone.halfWidth + 0.17 && estY >= zone.bottom - 0.16 && estY <= zone.top + 0.16;

  const disc = attr01(batter.bat.discipline);
  const contact = attr01(batter.bat.contact);
  const power = attr01(batter.bat.power);

  // Per-count aggression. Hitters protect with two strikes and take with three
  // balls; without this the CPU hacks at everything and never walks.
  const zoneSwing = ZONE_SWING[countKey(balls, strikes)];
  const chaseSwing = CHASE_SWING[countKey(balls, strikes)];

  let swingProb: number;
  if (looksLikeStrike) {
    swingProb = zoneSwing + contact * 0.12 - disc * 0.1;
  } else if (closeCall) {
    swingProb = chaseSwing * 1.55 - disc * 0.13;
  } else {
    swingProb = chaseSwing * 0.55 - disc * 0.05;
  }
  swingProb = clamp01(swingProb);

  const swing = rng.chance(swingProb);

  // Power hacks early in the count and with the bases empty of pressure.
  let kind: 'contact' | 'power' | 'bunt' = 'contact';
  if (swing) {
    const powerBias = power * 0.6 + (strikes < 2 ? 0.25 : -0.1) + (inningLate ? 0.05 : 0);
    kind = rng.chance(clamp01(powerBias)) ? 'power' : 'contact';
    // Small-ball: fast, low-power hitters bunt for a hit occasionally.
    if (
      strikes < 2 &&
      outs < 2 &&
      attr01(batter.bat.speed) > 0.72 &&
      power < 0.42 &&
      rng.chance(0.06)
    ) {
      kind = 'bunt';
    }
  }

  return { estX, estY, estT, swing, kind };
}

function countKey(balls: number, strikes: number): string {
  return `${Math.min(3, balls)}-${Math.min(2, strikes)}`;
}

/**
 * Swing rates by count, calibrated against scripts/simulate.ts so that walks,
 * strikeouts and pitches-per-plate-appearance all land in a believable range.
 * Left column = pitches the hitter reads as strikes, right = chases.
 */
const ZONE_SWING: Record<string, number> = {
  '0-0': 0.52, '0-1': 0.72, '0-2': 0.92,
  '1-0': 0.6, '1-1': 0.76, '1-2': 0.93,
  '2-0': 0.55, '2-1': 0.78, '2-2': 0.94,
  '3-0': 0.09, '3-1': 0.62, '3-2': 0.94,
};

const CHASE_SWING: Record<string, number> = {
  '0-0': 0.11, '0-1': 0.18, '0-2': 0.33,
  '1-0': 0.12, '1-1': 0.19, '1-2': 0.34,
  '2-0': 0.09, '2-1': 0.18, '2-2': 0.35,
  '3-0': 0.01, '3-1': 0.08, '3-2': 0.32,
};

/** How heavily a pitcher has leaned on one pitch this appearance, 0..1. */
export function familiarityOf(runtime: PitcherRuntime, type: PitchType): number {
  const used = runtime.usage[type] ?? 0;
  const total = Math.max(1, runtime.pitchCount);
  const share = used / total;
  const recentSame = runtime.recent.slice(-4).filter((t) => t === type).length / 4;
  return clamp01((share - 0.3) * 1.6 + recentSame * 0.55);
}

// ---------------------------------------------------------------------------
// Pitching changes
// ---------------------------------------------------------------------------

/** True when the CPU manager should go to the bullpen. */
export function shouldPullPitcher(
  runtime: PitcherRuntime,
  inning: number,
  totalInnings: number,
  runDiff: number,
  bullpenLeft: number,
): boolean {
  if (bullpenLeft <= 0) return false;
  if (runtime.stamina > 0.42) return false;
  if (runtime.stamina < 0.18) return true;
  const late = inning >= Math.max(2, totalInnings - 2);
  if (late && runDiff > -4) return true;
  return runtime.runsAllowed >= 5;
}
