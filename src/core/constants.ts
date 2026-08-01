/**
 * World constants for MOONSHOT NINE.
 *
 * COORDINATE SYSTEM (right-handed, metres):
 *   origin = the back tip of home plate
 *   +X     = toward first base / right field
 *   +Z     = toward centre field
 *   +Y     = up
 *
 * A batted ball's "spray angle" is measured from the +Z (centre field) axis:
 *   -45deg = left-field foul line, 0deg = dead centre, +45deg = right-field line.
 */

export const BASE_PATH = 27.432; // 90 ft
export const BASE_DIAG = BASE_PATH * Math.SQRT2; // home -> 2B
export const HALF_DIAG = BASE_DIAG / 2;

export const BASES = {
  HOME: { x: 0, z: 0 },
  FIRST: { x: HALF_DIAG, z: HALF_DIAG },
  SECOND: { x: 0, z: BASE_DIAG },
  THIRD: { x: -HALF_DIAG, z: HALF_DIAG },
} as const;

/** Index 0 = home, 1 = first, 2 = second, 3 = third. Index 4 wraps to home. */
export const BASE_POS: ReadonlyArray<{ x: number; z: number }> = [
  BASES.HOME,
  BASES.FIRST,
  BASES.SECOND,
  BASES.THIRD,
  BASES.HOME,
];

/**
 * THE MOUND IS DELIBERATELY DEEP.
 *
 * Regulation is 60 ft 6 in. The Meridian Circuit plays at 68 ft, and that is a
 * design decision rather than an error.
 *
 * A real hitter gets about 0.42 s from release to the plate and has spent two
 * decades training for it. A player at a keyboard has to read the pitch, move a
 * cursor to it and commit a swing in the same window, and at regulation depth
 * that window is simply too short to feel like a decision — it feels like a
 * reflex test you keep failing.
 *
 * Moving the rubber back buys the hitter ~15% more time (0.42 s to 0.48 s on a
 * fastball) while keeping the physics completely honest: the ball travels at
 * exactly the speed the radar readout claims, over a longer path. The
 * alternative — quietly stretching the flight clock, or slowing the ball but
 * still printing 95 on the scoreboard — would be lying to the player.
 *
 * The CPU hitter gains nothing from this. Its read is budgeted in seconds
 * before arrival (see `react` in cpuBatting), not as a fraction of the flight,
 * so a longer trip moves its decision point later by exactly the same amount.
 */
export const MOUND_Z = 20.9; // 68 ft
export const MOUND_HEIGHT = 0.254;

/** Ball is released in front of the rubber, from roughly shoulder height. */
export const RELEASE_Z = 19.0;
export const RELEASE_Y = 1.85;

/** The plane the batter actually makes contact on, just in front of the plate. */
export const CONTACT_Z = 0.62;

/** Strike zone, in metres, centred on x = 0. Scaled per-batter at runtime. */
export const ZONE_HALF_WIDTH = 0.2159; // 17 in plate / 2
export const ZONE_BOTTOM = 0.52;
export const ZONE_TOP = 1.12;
export const ZONE_HALF_HEIGHT = (ZONE_TOP - ZONE_BOTTOM) / 2;
export const ZONE_CENTER_Y = (ZONE_TOP + ZONE_BOTTOM) / 2;

export const GRAVITY = 9.81;

/**
 * Net aerodynamic coefficient: a_drag = DRAG_K * |v|^2, opposing velocity.
 * Real baseball drag is ~0.0059/m; we run slightly lighter because part of the
 * backspin lift is folded in here. Calibrated with scripts/tune-physics.ts and
 * locked by src/tests/physics.test.ts: 45 m/s at 28deg carries ~120 m (394 ft).
 */
export const DRAG_K = 0.0052;

/** Lift from backspin, applied perpendicular to velocity in the vertical plane. */
export const MAGNUS_K = 0.00125;

/** Fraction of vertical speed retained after a bounce on grass/dirt. */
export const BOUNCE_RESTITUTION = 0.42;
export const GROUND_FRICTION = 1.9; // m/s^2 of horizontal decel while rolling
export const WALL_RESTITUTION = 0.5;

export const FOUL_POLE_HEIGHT = 12;

/** Simulation runs on a fixed step; rendering interpolates between steps. */
export const TICK_HZ = 120;
export const TICK_DT = 1 / TICK_HZ;
/** Never advance more than this much wall-clock in one frame (tab-switch guard). */
export const MAX_FRAME_DT = 0.25;

export const OUTFIELD_GRASS_RADIUS = 140;

/**
 * Documented, human-only presentation assist, shared by the plate view and the
 * ball renderer so the two never disagree.
 *
 * The value is the fraction of the pitch's flight that must elapse before the
 * hitter is shown what the pitch is and where it is going to cross. Rookie
 * shows it early enough to react to; Pro shows it late enough that you have
 * already had to commit; on Ace it is never shown at all.
 *
 * This changes nothing about the ball. The CPU hitter reads pitches through its
 * own noisy estimate in ai.ts and receives none of this.
 */
export const PITCH_TELL_REVEAL: Record<'rookie' | 'pro' | 'allstar', number> = {
  rookie: 0.34,
  pro: 0.62,
  allstar: 2,
};

/** Player movement caps, m/s, before attribute scaling. */
export const RUNNER_BASE_SPEED = 6.4;
export const RUNNER_SPEED_SPAN = 3.0;
export const FIELDER_BASE_SPEED = 5.6;
export const FIELDER_SPEED_SPAN = 3.2;

export const THROW_BASE_SPEED = 28;
export const THROW_SPEED_SPAN = 14;

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : clamp01((v - a) / (b - a));
}

export function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

export function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.sqrt(dist2(ax, az, bx, bz));
}

/** Attribute values are 20..99; this maps them to a 0..1 skill fraction. */
export function attr01(v: number): number {
  return clamp01((v - 20) / 79);
}
