import { describe, expect, it } from 'vitest';
import { ZONE_CENTER_Y, ZONE_HALF_WIDTH } from '../core/constants';
import { Rng } from '../core/rng';
import type { BatterAttributes, BodyType, Handedness, Player } from '../core/types';
import {
  type ContactResult,
  inStrikeZone,
  pullDirection,
  resolveSwing,
  swingProfile,
  zoneBounds,
} from '../sim/contact';

/**
 * The swing model turns two error terms — timing and cursor placement — into
 * every batted-ball outcome. These tests protect the sign and shape of that
 * mapping: which way a mistimed swing sprays, which way a mis-aimed one lofts,
 * and what the two swing types trade against each other.
 *
 * Synthetic hitters are used throughout so the assertions describe the model
 * rather than whichever generated player happens to lead the league today.
 */

function makeBatter(opts: {
  contact: number;
  power: number;
  bats?: Handedness;
  body?: BodyType;
  id?: string;
}): Player {
  const bat: BatterAttributes = {
    contact: opts.contact,
    power: opts.power,
    speed: 60,
    arm: 60,
    fielding: 60,
    reaction: 60,
    discipline: 60,
  };
  return {
    id: opts.id ?? `test-${opts.contact}-${opts.power}-${opts.bats ?? 'R'}`,
    firstName: 'Test',
    lastName: 'Hitter',
    number: 1,
    bats: opts.bats ?? 'R',
    throws: 'R',
    primary: 'LF',
    secondary: [],
    body: opts.body ?? 'average',
    skinTone: 0.5,
    bat,
  };
}

const SLUGGER = makeBatter({ contact: 74, power: 93 });
const LEFTY = makeBatter({ contact: 74, power: 93, bats: 'L', id: 'test-lefty' });
const CONTACT_HITTER = makeBatter({ contact: 95, power: 45, id: 'test-hi-contact' });
const FREE_SWINGER = makeBatter({ contact: 25, power: 95, id: 'test-lo-contact' });

/** One swing, expressed in units of the swing's own tolerances. */
function swing(opts: {
  batter?: Player;
  kind?: 'contact' | 'power' | 'bunt';
  /** Timing error as a multiple of the profile window; negative = early. */
  timing?: number;
  /** Absolute timing error in seconds; overrides `timing` when present. */
  timingSeconds?: number;
  /** Vertical miss as a multiple of the profile's vertical half-height. */
  vertical?: number;
  /** Horizontal miss as a multiple of the profile's horizontal half-width. */
  horizontal?: number;
  seed: number;
}): ContactResult {
  const batter = opts.batter ?? SLUGGER;
  const kind = opts.kind ?? 'contact';
  const profile = swingProfile(batter, kind, 'pro', false);
  const timingError =
    opts.timingSeconds !== undefined ? opts.timingSeconds : (opts.timing ?? 0) * profile.window;
  return resolveSwing({
    batter,
    kind,
    profile,
    cursorX: 0,
    cursorY: ZONE_CENTER_Y,
    plateX: (opts.horizontal ?? 0) * profile.rx,
    plateY: ZONE_CENTER_Y + (opts.vertical ?? 0) * profile.ry,
    pitchSpeed: 40,
    timingError,
    pullDir: pullDirection(batter.bats, 'R'),
    rng: new Rng(opts.seed),
  });
}

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('perfect and hopeless swings', () => {
  it('barrels a perfectly timed, perfectly placed swing every time', () => {
    for (const seed of SEEDS) {
      const contact = swing({ seed });
      expect(contact.grade).toBe('barreled');
      expect(contact.quality).toBeCloseTo(1, 6);
      expect(contact.exitVelo).toBeGreaterThan(40);

      const power = swing({ seed, kind: 'power' });
      expect(power.grade).toBe('barreled');
      expect(power.exitVelo).toBeGreaterThan(45);
    }
  });

  it('misses entirely when the timing is badly wrong, early or late', () => {
    for (const seed of SEEDS) {
      for (const timing of [-3, -2, 2, 3]) {
        const res = swing({ seed, timing });
        expect(res.grade).toBe('miss');
        expect(res.exitVelo).toBe(0);
      }
    }
  });

  it('reports the signed errors it was given so the HUD can explain the result', () => {
    const profile = swingProfile(SLUGGER, 'contact', 'pro', false);
    const early = swing({ seed: 5, timing: -0.4 });
    expect(early.timingError).toBeCloseTo(-0.4 * profile.window, 9);
    const under = swing({ seed: 5, vertical: 0.3 });
    expect(under.vertMiss).toBeCloseTo(0.3 * profile.ry, 9);
    expect(under.vertMiss).toBeGreaterThan(0);
  });
});

describe('launch angle', () => {
  it('lofts the ball when the cursor is under it and drives it down when over', () => {
    // "Ball above the cursor" is the batter getting under the pitch, which is
    // the only way to elevate anything in this model.
    const under: number[] = [];
    const over: number[] = [];
    for (const seed of SEEDS) {
      const ballAboveCursor = swing({ seed, vertical: 0.4 });
      const ballBelowCursor = swing({ seed, vertical: -0.4 });
      expect(ballAboveCursor.grade).not.toBe('miss');
      expect(ballBelowCursor.grade).not.toBe('miss');
      // Same seed, same noise draws: the gap is the model, not luck.
      expect(ballAboveCursor.launchAngle).toBeGreaterThan(ballBelowCursor.launchAngle);
      under.push(ballAboveCursor.launchAngle);
      over.push(ballBelowCursor.launchAngle);
    }
    expect(mean(under)).toBeGreaterThan(mean(over) + 10);
  });

  it('gives the power swing extra loft over the contact swing', () => {
    const contactProfile = swingProfile(SLUGGER, 'contact', 'pro', false);
    const powerProfile = swingProfile(SLUGGER, 'power', 'pro', false);
    expect(powerProfile.loft).toBeGreaterThan(contactProfile.loft);
    expect(mean(SEEDS.map((seed) => swing({ seed, kind: 'power' }).launchAngle))).toBeGreaterThan(
      mean(SEEDS.map((seed) => swing({ seed }).launchAngle)),
    );
  });
});

describe('spray angle', () => {
  it('pulls an early swing and pushes a late one for a right-handed hitter', () => {
    expect(pullDirection('R', 'R')).toBe(-1);
    for (const seed of SEEDS) {
      const early = swing({ batter: SLUGGER, seed, timing: -0.5 });
      const late = swing({ batter: SLUGGER, seed, timing: 0.5 });
      // A right-hander pulls toward -X, which is left field.
      expect(early.sprayAngle).toBeLessThan(0);
      expect(late.sprayAngle).toBeGreaterThan(0);
      expect(early.sprayAngle).toBeLessThan(late.sprayAngle);
    }
  });

  it('mirrors that behaviour for a left-handed hitter', () => {
    expect(pullDirection('L', 'R')).toBe(1);
    for (const seed of SEEDS) {
      const early = swing({ batter: LEFTY, seed, timing: -0.5 });
      const late = swing({ batter: LEFTY, seed, timing: 0.5 });
      // A left-hander pulls toward +X, which is right field.
      expect(early.sprayAngle).toBeGreaterThan(0);
      expect(late.sprayAngle).toBeLessThan(0);
      expect(early.sprayAngle).toBeGreaterThan(late.sprayAngle);
    }
  });

  it('never sprays a ball outside the range the fielding code can handle', () => {
    for (const seed of SEEDS) {
      for (const timing of [-0.8, -0.4, 0, 0.4, 0.8]) {
        for (const horizontal of [-0.6, 0, 0.6]) {
          const res = swing({ seed, timing, horizontal });
          expect(res.sprayAngle).toBeGreaterThanOrEqual(-68);
          expect(res.sprayAngle).toBeLessThanOrEqual(68);
        }
      }
    }
  });
});

describe('power swing versus contact swing', () => {
  /** Largest timing error, in seconds, that still puts wood on the ball. */
  function timingTolerance(batter: Player, kind: 'contact' | 'power'): number {
    let best = 0;
    for (let t = 0; t < 0.4; t += 0.0005) {
      const res = swing({ batter, kind, timingSeconds: t, seed: 1 });
      if (res.grade === 'miss') break;
      best = t;
    }
    return best;
  }

  /** Largest vertical placement error that still puts wood on the ball. */
  function verticalTolerance(batter: Player, kind: 'contact' | 'power'): number {
    const profile = swingProfile(batter, kind, 'pro', false);
    let best = 0;
    for (let v = 0; v < 4; v += 0.005) {
      const res = swing({ batter, kind, vertical: v, seed: 1 });
      if (res.grade === 'miss') break;
      best = v * profile.ry;
    }
    return best;
  }

  it('hits the ball harder', () => {
    const contactEv = mean(SEEDS.map((seed) => swing({ seed }).exitVelo));
    const powerEv = mean(SEEDS.map((seed) => swing({ seed, kind: 'power' }).exitVelo));
    expect(powerEv).toBeGreaterThan(contactEv);
    expect(swingProfile(SLUGGER, 'power', 'pro', false).evMult).toBeGreaterThan(
      swingProfile(SLUGGER, 'contact', 'pro', false).evMult,
    );
  });

  it('pays for it with a smaller sweet spot in every dimension', () => {
    const contactProfile = swingProfile(SLUGGER, 'contact', 'pro', false);
    const powerProfile = swingProfile(SLUGGER, 'power', 'pro', false);
    expect(powerProfile.rx).toBeLessThan(contactProfile.rx);
    expect(powerProfile.ry).toBeLessThan(contactProfile.ry);
    expect(powerProfile.window).toBeLessThan(contactProfile.window);
    // The profile numbers have to actually change what the bat does.
    expect(timingTolerance(SLUGGER, 'power')).toBeLessThan(timingTolerance(SLUGGER, 'contact'));
    expect(verticalTolerance(SLUGGER, 'power')).toBeLessThan(verticalTolerance(SLUGGER, 'contact'));
  });

  it('starts later, so committing to power costs reaction time', () => {
    expect(swingProfile(SLUGGER, 'power', 'pro', false).latency).toBeGreaterThan(
      swingProfile(SLUGGER, 'contact', 'pro', false).latency,
    );
  });
});

describe('contact rating', () => {
  it('buys a wider timing window', () => {
    const good = swingProfile(CONTACT_HITTER, 'contact', 'pro', false);
    const bad = swingProfile(FREE_SWINGER, 'contact', 'pro', false);
    expect(good.window).toBeGreaterThan(bad.window);
    expect(good.rx).toBeGreaterThan(bad.rx);
    expect(good.ry).toBeGreaterThan(bad.ry);
  });

  it('turns that window into fewer whiffs on a mistimed swing', () => {
    const countMisses = (batter: Player) =>
      SEEDS.filter((seed) => swing({ batter, seed, timingSeconds: 0.085 }).grade === 'miss').length;
    expect(countMisses(CONTACT_HITTER)).toBeLessThan(countMisses(FREE_SWINGER));
  });

  it('gives a human hitter a wider window on rookie than on all-star', () => {
    // Documented assist: difficulty may only widen the human's window, never
    // the CPU's, and never the ball physics.
    const rookie = swingProfile(SLUGGER, 'contact', 'rookie', true).window;
    const pro = swingProfile(SLUGGER, 'contact', 'pro', true).window;
    const allstar = swingProfile(SLUGGER, 'contact', 'allstar', true).window;
    expect(rookie).toBeGreaterThan(pro);
    expect(pro).toBeGreaterThan(allstar);
    for (const d of ['rookie', 'pro', 'allstar'] as const) {
      expect(swingProfile(SLUGGER, 'contact', d, false).window).toBe(allstar);
    }
  });

  it('widens the sweet spot as well as the window, on every swing kind', () => {
    // The half of the assist that did not exist. On a phone the swing *is* a
    // touch at a place, so forgiving only the timing forgave only half of one
    // mistake — and the missing half was worth about four hits a game to a
    // player with a real thumb (scripts/hitting.ts).
    for (const kind of ['contact', 'power', 'bunt'] as const) {
      const rookie = swingProfile(SLUGGER, kind, 'rookie', true);
      const pro = swingProfile(SLUGGER, kind, 'pro', true);
      const ace = swingProfile(SLUGGER, kind, 'allstar', true);
      expect(rookie.rx).toBeGreaterThan(pro.rx);
      expect(pro.rx).toBeGreaterThan(ace.rx);
      expect(rookie.ry).toBeGreaterThan(pro.ry);
      expect(pro.ry).toBeGreaterThan(ace.ry);
      // Both axes scale together, so which pitches are hard to reach never
      // changes with the setting — only how wrong you are allowed to be.
      expect(rookie.rx / ace.rx).toBeCloseTo(rookie.ry / ace.ry, 9);
      // Ace promises no assist, and that has to stay literally true: a human on
      // Ace gets exactly the profile the CPU gets.
      const cpu = swingProfile(SLUGGER, kind, 'allstar', false);
      expect(ace.rx).toBe(cpu.rx);
      expect(ace.ry).toBe(cpu.ry);
      expect(ace.window).toBe(cpu.window);
      // And the assist never touches how hard the ball comes off the bat.
      expect(rookie.evMult).toBe(cpu.evMult);
      expect(rookie.latency).toBe(cpu.latency);
      expect(rookie.loft).toBe(cpu.loft);
    }
  });
});

describe('inStrikeZone and zoneBounds', () => {
  const bodies: BodyType[] = ['slim', 'average', 'stocky', 'tall', 'huge'];

  it('agree with each other for every body type', () => {
    for (const body of bodies) {
      const batter = makeBatter({ contact: 60, power: 60, body, id: `zone-${body}` });
      const zone = zoneBounds(batter);
      const midY = (zone.bottom + zone.top) / 2;

      expect(zone.halfWidth).toBe(ZONE_HALF_WIDTH);
      expect(zone.top).toBeGreaterThan(zone.bottom);

      // Dead centre of the drawn rectangle is unambiguously a strike.
      expect(inStrikeZone(0, midY, batter)).toBe(true);
      // Just inside each drawn edge is a strike.
      expect(inStrikeZone(zone.halfWidth - 0.005, midY, batter)).toBe(true);
      expect(inStrikeZone(-zone.halfWidth + 0.005, midY, batter)).toBe(true);
      expect(inStrikeZone(0, zone.bottom + 0.005, batter)).toBe(true);
      expect(inStrikeZone(0, zone.top - 0.005, batter)).toBe(true);
      // Clearly outside the rectangle, past the one-ball allowance, is a ball.
      expect(inStrikeZone(zone.halfWidth + 0.05, midY, batter)).toBe(false);
      expect(inStrikeZone(-zone.halfWidth - 0.05, midY, batter)).toBe(false);
      expect(inStrikeZone(0, zone.top + 0.05, batter)).toBe(false);
      expect(inStrikeZone(0, zone.bottom - 0.05, batter)).toBe(false);
      // The allowance itself is exactly one ball radius wide.
      expect(inStrikeZone(zone.halfWidth + 0.036, midY, batter)).toBe(true);
      expect(inStrikeZone(0, zone.top + 0.036, batter)).toBe(true);
    }
  });

  it('scales the zone with the hitter, taller hitters getting a taller zone', () => {
    const tall = zoneBounds(makeBatter({ contact: 60, power: 60, body: 'tall', id: 'z-tall' }));
    const average = zoneBounds(makeBatter({ contact: 60, power: 60, body: 'average', id: 'z-avg' }));
    const slim = zoneBounds(makeBatter({ contact: 60, power: 60, body: 'slim', id: 'z-slim' }));
    expect(tall.top).toBeGreaterThan(average.top);
    expect(average.top).toBeGreaterThan(slim.top);
    // Plate width never changes, whoever is standing there.
    expect(tall.halfWidth).toBe(slim.halfWidth);
  });
});
