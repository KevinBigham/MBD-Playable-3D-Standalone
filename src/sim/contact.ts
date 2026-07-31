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

export function swingProfile(
  batter: Player,
  kind: 'contact' | 'power' | 'bunt',
  difficulty: Difficulty,
  human: boolean,
): SwingProfile {
  const c = attr01(batter.bat.contact);
  const p = attr01(batter.bat.power);

  // Documented, user-facing assist: Rookie widens the human timing window.
  // The CPU never receives this bonus, and the ball physics are untouched.
  const assist = human ? (difficulty === 'rookie' ? 1.3 : difficulty === 'pro' ? 1.1 : 1.0) : 1.0;

  if (kind === 'bunt') {
    return {
      latency: 0.055,
      rx: 0.17 + c * 0.09,
      ry: 0.2 + c * 0.1,
      window: (0.085 + c * 0.04) * assist,
      evMult: 0.24,
      loft: -4,
    };
  }

  if (kind === 'power') {
    return {
      latency: 0.165,
      rx: (0.108 + c * 0.075) * 0.85,
      ry: (0.132 + c * 0.098) * 0.85,
      window: (0.056 + c * 0.044) * 0.86 * assist,
      evMult: 1.085 + p * 0.05,
      loft: 9,
    };
  }

  return {
    latency: 0.125,
    rx: 0.108 + c * 0.075,
    ry: 0.132 + c * 0.098,
    window: (0.056 + c * 0.044) * assist,
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
  /** Short human-readable reason, shown in the feedback pip. */
  note: string;
}

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
  // straight back or off the handle: the classic count-extending foul.
  if (input.kind !== 'bunt' && Math.abs(yn) > 0.5 && rng.chance(clamp01((Math.abs(yn) - 0.5) * 2.2))) {
    base.grade = 'foul';
    base.quality = 0.08;
    base.note = yn > 0 ? 'Fouled it straight back' : 'Chopped it foul';
    return base;
  }

  const quality = clamp01(1 - norm);
  const power01 = attr01(input.batter.bat.power);
  const contact01 = attr01(input.batter.bat.contact);

  if (input.kind === 'bunt') {
    const ev = clamp(4.5 + quality * 5 + rng.normal(0, 0.7), 1.2, 12);
    const spray = clamp(input.cursorX * 90 + rng.normal(0, 7), -44, 44);
    return {
      ...base,
      grade: quality > 0.5 ? 'ok' : 'weak',
      quality,
      exitVelo: ev,
      launchAngle: clamp(2 + rng.normal(0, 4), -12, 22),
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
  exitVelo += rng.normal(0, 0.9 + (1 - contact01) * 1.1);
  exitVelo = clamp(exitVelo, 6, 56);

  // --- Launch angle --------------------------------------------------------
  // Being under the ball (ball above the cursor, dy > 0) lifts it. A centred
  // contact swing produces a line drive; a centred power swing produces the
  // 20-25deg window that actually leaves the yard.
  const vertOff = clamp(yn, -2.2, 2.2);
  let launchAngle = 14 + vertOff * 24 + profile.loft;
  // Very late or very early contact adds a little unintended loft.
  launchAngle += Math.abs(tn) * 7;
  launchAngle += rng.normal(0, 2.6 + (1 - contact01) * 2.4);
  launchAngle = clamp(launchAngle, -32, 78);

  // Off-centre vertical contact bleeds energy.
  const mishit = clamp01(Math.abs(vertOff) - 0.45);
  exitVelo *= 1 - mishit * 0.24;

  // --- Spray ---------------------------------------------------------------
  // Early contact pulls, late contact goes the other way, and an inside pitch
  // gets pulled harder than one on the outer half. Between them these spread
  // batted balls across the whole field instead of bunching them up the middle,
  // which is what creates gaps, corners and doubles.
  const inside = input.pullDir * input.plateX;
  let spray = input.pullDir * (-tn * 58 + inside * 46 + xn * 6);
  spray += rng.normal(0, 6.5 + (1 - contact01) * 4.5);
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
    grade,
    quality,
    exitVelo,
    launchAngle,
    sprayAngle: spray,
    spin,
    sideSpin,
    timingError: input.timingError,
    vertMiss: dy,
    horizMiss: dx,
    note: describeContact(grade, tn, vertOff),
  };
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
