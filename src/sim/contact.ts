import type { Difficulty, Player } from '../core/types';
import { Rng } from '../core/rng';
import { attr01, clamp, clamp01, DEG, ZONE_BOTTOM, ZONE_HALF_WIDTH, ZONE_TOP } from '../core/constants';

/**
 * SWING MODEL
 * -----------
 * The batter aims a contact cursor inside the plate plane and starts a swing.
 * The bat arrives at the plate `latency` seconds after the button press, so the
 * player is predicting where and when the ball will be, not reacting to it.
 *
 * Two independent errors decide everything:
 *   timing error  = when the bat arrived vs. when the ball arrived
 *   position error = cursor centre vs. where the ball crossed
 *
 * Those two numbers produce launch angle, exit velocity and spray angle
 * through a single continuous function, which is why the feedback reads as
 * "you were under it" or "you were late" instead of "you rolled badly".
 */

export interface SwingProfile {
  /** Seconds between the button press and the bat reaching the plate. */
  latency: number;
  /** Half-width / half-height of the sweet spot, metres. */
  rx: number;
  ry: number;
  /** Timing tolerance in seconds either side of perfect. */
  window: number;
  /** Exit-velocity multiplier. */
  evMult: number;
  /** Extra loft added to the launch angle, degrees. */
  loft: number;
}

/**
 * HOW WRONG A PERSON IS ALLOWED TO BE.
 *
 * A swing has two independent errors — *when* the bat arrived and *where* it
 * was — and for a long time the assist forgave only the first. That is close to
 * backwards for this game. On a phone the swing **is** a touch at a place: one
 * act sets the cursor and starts the bat, so a player who is wrong about the
 * crossing point is wrong about position and timing at once, and only half of it
 * was ever forgiven.
 *
 * Measured with `scripts/hitting.ts`, which drives real games with a hitter that
 * is wrong on purpose: at the accuracy that produced the player report of about
 * one hit a game, the two errors did roughly equal damage. Widening the timing
 * window alone could not have fixed it — isolating that error still left five
 * hits a game on the table.
 *
 * `reach` scales the sweet spot, `window` the timing tolerance. Everything
 * downstream is expressed in units of these two, so widening them widens the
 * fair-ball band and the barrel with them, in proportion, for free.
 *
 * Neither is ever given to the CPU, and neither touches the ball's flight: the
 * pitch arrives at the same place at the same time whoever is hitting.
 */
const ASSIST: Record<Difficulty, { window: number; reach: number }> = {
  rookie: { window: 2.5, reach: 2.4 },
  pro: { window: 2.1, reach: 2.0 },
  allstar: { window: 1.0, reach: 1.0 },
};

const NO_ASSIST = { window: 1, reach: 1 };

/** Explicit player-facing tuning: human hitters get three times as long. */
export const HUMAN_TIMING_WINDOW_MULTIPLIER = 3;

export function swingProfile(
  batter: Player,
  kind: 'contact' | 'power' | 'bunt',
  difficulty: Difficulty,
  human: boolean,
): SwingProfile {
  const c = attr01(batter.bat.contact);
  const p = attr01(batter.bat.power);
  const a = human ? ASSIST[difficulty] : NO_ASSIST;
  const timingWindow = a.window * (human ? HUMAN_TIMING_WINDOW_MULTIPLIER : 1);

  if (kind === 'bunt') {
    return {
      latency: 0.055,
      rx: (0.17 + c * 0.09) * a.reach,
      ry: (0.2 + c * 0.1) * a.reach,
      window: (0.085 + c * 0.04) * timingWindow,
      evMult: 0.24,
      loft: -4,
    };
  }

  if (kind === 'power') {
    return {
      latency: 0.165,
      rx: (0.108 + c * 0.075) * 0.85 * a.reach,
      ry: (0.132 + c * 0.098) * 0.85 * a.reach,
      window: (0.056 + c * 0.044) * 0.86 * timingWindow,
      evMult: 1.085 + p * 0.05,
      loft: 9,
    };
  }

  return {
    latency: 0.125,
    rx: (0.108 + c * 0.075) * a.reach,
    ry: (0.132 + c * 0.098) * a.reach,
    window: (0.056 + c * 0.044) * timingWindow,
    evMult: 0.945,
    loft: 0,
  };
}

export type ContactGrade =
  | 'miss'
  | 'foul'
  | 'foultip'
  | 'weak'
  | 'ok'
  | 'solid'
  | 'barreled';

/** Where the bat was relative to the ball, in words the HUD can print. */
export type TimingLabel = 'WAY EARLY' | 'EARLY' | 'ON TIME' | 'LATE' | 'WAY LATE';
export type PlaneLabel = 'UNDER IT' | 'ON PLANE' | 'OVER IT';

export interface ContactResult {
  grade: ContactGrade;
  /** 0..1 overall contact quality. */
  quality: number;
  /** Metres per second off the bat. */
  exitVelo: number;
  /** Degrees above horizontal. */
  launchAngle: number;
  /** Degrees from dead centre; negative = left field. */
  sprayAngle: number;
  spin: number;
  sideSpin: number;
  /** Signed seconds; negative = early. */
  timingError: number;
  /** Signed metres; positive = the ball was above the cursor. */
  vertMiss: number;
  horizMiss: number;
  /**
   * The same three errors expressed in units of the swing's own tolerance,
   * so 1.0 always means "one sweet-spot away" whoever is hitting. These are
   * what the plate view draws; nothing else needs to know the profile.
   */
  timingNorm: number;
  vertNorm: number;
  horizNorm: number;
  timingLabel: TimingLabel;
  planeLabel: PlaneLabel;
  /** Short human-readable reason, shown in the feedback pip. */
  note: string;
}

/**
 * How wrong you have to be, vertically, before the ball goes foul instead of
 * fair. Deterministic on purpose: "half a bat under it goes straight back" is
 * a rule the hitter can learn, where a coin flip is not. The jitter band below
 * is the only stochastic part, and it shrinks as contact rating rises.
 */
const FOUL_PLANE = 0.66;

export interface SwingInput {
  batter: Player;
  kind: 'contact' | 'power' | 'bunt';
  profile: SwingProfile;
  /** Cursor position, frozen at the moment the swing started. */
  cursorX: number;
  cursorY: number;
  /** Where the pitch crossed the contact plane. */
  plateX: number;
  plateY: number;
  /** Pitch speed at the plate, m/s. */
  pitchSpeed: number;
  /** Bat arrival time minus ball arrival time, seconds. */
  timingError: number;
  /** -1 for a hitter who pulls toward -X (right-handed), +1 for a lefty. */
  pullDir: number;
  rng: Rng;
}

export function resolveSwing(input: SwingInput): ContactResult {
  const { profile, rng } = input;
  const dx = input.plateX - input.cursorX;
  const dy = input.plateY - input.cursorY;
  const tn = input.timingError / profile.window;
  const xn = dx / profile.rx;
  const yn = dy / profile.ry;

  // Distance in normalised "miss space". 1.0 is the edge of the sweet spot.
  const norm = Math.sqrt(xn * xn + yn * yn * 0.85 + tn * tn * 1.15);

  const contact01 = attr01(input.batter.bat.contact);

  const base: ContactResult = {
    grade: 'miss',
    quality: 0,
    exitVelo: 0,
    launchAngle: 0,
    sprayAngle: 0,
    spin: 0,
    sideSpin: 0,
    timingError: input.timingError,
    vertMiss: dy,
    horizMiss: dx,
    timingNorm: tn,
    vertNorm: yn,
    horizNorm: xn,
    timingLabel: timingLabelOf(tn),
    planeLabel: planeLabelOf(yn),
    note: '',
  };

  if (norm > 1.27) {
    base.grade = 'miss';
    base.note = describeMiss(tn, xn, yn);
    return base;
  }
  if (norm > 0.86) {
    // Edge-of-the-bat contact. Mostly an ordinary foul; occasionally the
    // catcher squeezes the tip, which is a live strike three.
    const tipped = rng.chance(0.13);
    base.grade = tipped ? 'foultip' : 'foul';
    base.quality = 0.05;
    base.note = tipped ? 'Tipped into the mitt' : 'Fouled it off';
    return base;
  }
  // Catching the ball well off the centre of the bat vertically sends it
  // straight back or off the handle: the classic count-extending foul. The
  // threshold is a line, not a lottery — a good hitter's line is just a little
  // fuzzier at the edges than a bad one's.
  if (input.kind !== 'bunt') {
    const edge = FOUL_PLANE + rng.normal(0, 0.05 + (1 - contact01) * 0.07);
    if (Math.abs(yn) > edge) {
      base.grade = 'foul';
      base.quality = 0.08;
      base.note = yn > 0 ? 'Fouled it straight back' : 'Chopped it foul';
      return base;
    }
  }

  const quality = clamp01(1 - norm);
  const power01 = attr01(input.batter.bat.power);

  /**
   * Noise scales with how badly the swing was missed. Squaring a ball up is
   * close to deterministic — that is the whole point of aiming and timing —
   * while a mishit off the end of the bat genuinely can go anywhere. Without
   * this, good contact and bad contact were equally unpredictable and the
   * game read as a dice roll.
   */
  const noise = 0.3 + 0.7 * (1 - quality);

  if (input.kind === 'bunt') {
    const ev = clamp(4.5 + quality * 5 + rng.normal(0, 0.7 * noise), 1.2, 12);
    const spray = clamp(input.cursorX * 90 + rng.normal(0, 7 * noise), -44, 44);
    return {
      ...base,
      grade: quality > 0.5 ? 'ok' : 'weak',
      quality,
      exitVelo: ev,
      launchAngle: clamp(2 + rng.normal(0, 4 * noise), -12, 22),
      sprayAngle: spray,
      spin: 0,
      sideSpin: 0,
      note: 'Bunt down',
    };
  }

  // --- Exit velocity -------------------------------------------------------
  const ceiling = 38 + power01 * 15; // 38 .. 53 m/s
  // Quality maps to a wide band so mishits are genuinely weak.
  const evFrac = 0.44 + 0.56 * Math.pow(quality, 0.66);
  // Hard pitches come off the bat faster, but only on good contact.
  const speedTransfer = (input.pitchSpeed - 35) * 0.16 * quality;
  let exitVelo = ceiling * evFrac * profile.evMult + speedTransfer;
  exitVelo += rng.normal(0, (0.9 + (1 - contact01) * 1.1) * noise);
  exitVelo = clamp(exitVelo, 6, 56);

  // --- Launch angle --------------------------------------------------------
  // Being under the ball (ball above the cursor, dy > 0) lifts it. A centred
  // contact swing produces a line drive; a centred power swing produces the
  // 20-25deg window that actually leaves the yard.
  const vertOff = clamp(yn, -2.2, 2.2);
  let launchAngle = 14 + vertOff * 24 + profile.loft;
  // Timing changes the plane, not just the direction. Out in front you meet the
  // ball early in the swing's upswing and lift it; beaten by the pitch you are
  // fighting it off with the barrel below your hands and it goes on the ground.
  // Both halves are deterministic, so "I was late and rolled over" is a lesson
  // rather than a shrug.
  launchAngle += -tn * 11 + Math.abs(tn) * 3;
  launchAngle += rng.normal(0, (2.6 + (1 - contact01) * 2.4) * noise);
  launchAngle = clamp(launchAngle, -32, 78);

  // Off-centre vertical contact bleeds energy.
  const mishit = clamp01(Math.abs(vertOff) - 0.45);
  exitVelo *= 1 - mishit * 0.24;
  // So does catching it off the end of the bat or in on the hands.
  exitVelo *= 1 - clamp01(Math.abs(xn) - 0.3) * 0.3;

  // --- Spray ---------------------------------------------------------------
  // Early contact pulls, late contact goes the other way, and an inside pitch
  // gets pulled harder than one on the outer half. Between them these spread
  // batted balls across the whole field instead of bunching them up the middle,
  // which is what creates gaps, corners and doubles.
  const inside = input.pullDir * input.plateX;
  let spray = input.pullDir * (-tn * 58 + inside * 46 + xn * 6);
  spray += rng.normal(0, (6.5 + (1 - contact01) * 4.5) * noise);
  spray = clamp(spray, -68, 68);

  // --- Spin ----------------------------------------------------------------
  const spin = clamp(0.35 + vertOff * 0.8 - Math.abs(tn) * 0.12, 0, 1.55);
  const sideSpin = clamp((spray / 45) * 0.32, -0.4, 0.4);

  let grade: ContactGrade;
  if (quality > 0.78) grade = 'barreled';
  else if (quality > 0.55) grade = 'solid';
  else if (quality > 0.3) grade = 'ok';
  else grade = 'weak';

  return {
    ...base,
    grade,
    quality,
    exitVelo,
    launchAngle,
    sprayAngle: spray,
    spin,
    sideSpin,
    note: describeContact(grade, tn, vertOff),
  };
}

/** Bat arrival vs ball arrival, bucketed for the timing bar. */
export function timingLabelOf(tn: number): TimingLabel {
  if (tn <= -0.75) return 'WAY EARLY';
  if (tn <= -0.28) return 'EARLY';
  if (tn < 0.28) return 'ON TIME';
  if (tn < 0.75) return 'LATE';
  return 'WAY LATE';
}

/** Cursor height vs where the ball crossed. Positive yn = the ball was higher. */
export function planeLabelOf(yn: number): PlaneLabel {
  if (yn >= 0.35) return 'UNDER IT';
  if (yn <= -0.35) return 'OVER IT';
  return 'ON PLANE';
}

function describeMiss(tn: number, xn: number, yn: number): string {
  if (tn < -0.9) return 'Way out in front';
  if (tn > 0.9) return 'Beaten by the pitch';
  if (Math.abs(yn) > 1) return yn > 0 ? 'Swung under it' : 'Swung over it';
  if (Math.abs(xn) > 1) return 'Missed inside/outside';
  return 'Swing and a miss';
}

function describeContact(grade: ContactGrade, tn: number, vertOff: number): string {
  if (grade === 'barreled') return 'Barreled it';
  if (grade === 'solid') return tn < -0.3 ? 'Pulled hard' : tn > 0.3 ? 'Driven the other way' : 'Squared up';
  if (grade === 'ok') return vertOff > 0.6 ? 'Got under it' : vertOff < -0.5 ? 'Topped it' : 'Fair contact';
  return vertOff > 0.5 ? 'Popped it up' : vertOff < -0.4 ? 'Rolled over' : 'Off the end of the bat';
}

/** Strike-zone test at the plate, with a small ball-width allowance. */
export function inStrikeZone(x: number, y: number, batter: Player): boolean {
  const h = zoneHeightScale(batter);
  const bottom = ZONE_BOTTOM * h;
  const top = ZONE_TOP * h;
  return Math.abs(x) <= ZONE_HALF_WIDTH + 0.037 && y >= bottom - 0.037 && y <= top + 0.037;
}

/** Taller hitters get a taller zone; the HUD draws exactly this rectangle. */
export function zoneHeightScale(batter: Player): number {
  switch (batter.body) {
    case 'slim':
      return 0.95;
    case 'tall':
      return 1.09;
    case 'stocky':
      return 0.97;
    case 'huge':
      return 1.06;
    default:
      return 1;
  }
}

export function zoneBounds(batter: Player): { bottom: number; top: number; halfWidth: number } {
  const h = zoneHeightScale(batter);
  return { bottom: ZONE_BOTTOM * h, top: ZONE_TOP * h, halfWidth: ZONE_HALF_WIDTH };
}

/** Converts a contact result into initial ball velocity components. */
export function contactVelocity(res: ContactResult): { vx: number; vy: number; vz: number } {
  const la = res.launchAngle * DEG;
  const sa = res.sprayAngle * DEG;
  const horiz = res.exitVelo * Math.cos(la);
  return {
    vx: horiz * Math.sin(sa),
    vy: res.exitVelo * Math.sin(la),
    vz: horiz * Math.cos(sa),
  };
}

/** Where a right/left-handed hitter stands, in world X. */
export function batterBoxX(bats: 'L' | 'R' | 'S', pitcherThrows: 'L' | 'R' | 'S'): number {
  const effective = bats === 'S' ? (pitcherThrows === 'L' ? 'R' : 'L') : bats;
  // Right-handed hitters stand on the third-base side, which is -X here.
  return effective === 'R' ? -0.78 : 0.78;
}

/** -1 pulls toward -X (left field), +1 pulls toward +X (right field). */
export function pullDirection(bats: 'L' | 'R' | 'S', pitcherThrows: 'L' | 'R' | 'S'): number {
  const effective = bats === 'S' ? (pitcherThrows === 'L' ? 'R' : 'L') : bats;
  return effective === 'R' ? -1 : 1;
}
