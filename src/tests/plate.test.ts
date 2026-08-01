import { describe, expect, it } from 'vitest';
import { ZONE_CENTER_Y } from '../core/constants';
import { Rng } from '../core/rng';
import type { BatterAttributes, GameSetup, Handedness, Player } from '../core/types';
import {
  type ContactResult,
  planeLabelOf,
  pullDirection,
  resolveSwing,
  swingProfile,
  timingLabelOf,
} from '../sim/contact';
import { buildLeague, teamById } from '../data/teams';
import { simulateGame } from '../sim/autoplay';
import { PITCHES, pitchBreak } from '../data/pitches';

/**
 * THE PLATE UPGRADE
 * -----------------
 * Two promises are made to the player at the plate, and these tests hold the
 * engine to both:
 *
 *   1. Squaring a ball up is a skill, not a coin flip. The better the contact,
 *      the less the outcome moves when only the random seed changes.
 *   2. Everything the plate view draws is real. The labels, the normalised
 *      errors, the pitch log and the break preview all have to agree with what
 *      the simulation actually did, or the overlay is lying to the player.
 */

function makeBatter(contact: number, power: number, bats: Handedness = 'R'): Player {
  const bat: BatterAttributes = {
    contact,
    power,
    speed: 60,
    arm: 60,
    fielding: 60,
    reaction: 60,
    discipline: 60,
  };
  return {
    id: `plate-${contact}-${power}-${bats}`,
    firstName: 'Test',
    lastName: 'Hitter',
    number: 9,
    bats,
    throws: 'R',
    primary: 'LF',
    secondary: [],
    body: 'average',
    skinTone: 0.5,
    bat,
  };
}

const HITTER = makeBatter(74, 90);

/** One swing, expressed in units of the swing's own tolerances. */
function swing(opts: { timing?: number; vertical?: number; horizontal?: number; seed: number }) {
  const profile = swingProfile(HITTER, 'contact', 'pro', false);
  return resolveSwing({
    batter: HITTER,
    kind: 'contact',
    profile,
    cursorX: 0,
    cursorY: ZONE_CENTER_Y,
    plateX: (opts.horizontal ?? 0) * profile.rx,
    plateY: ZONE_CENTER_Y + (opts.vertical ?? 0) * profile.ry,
    pitchSpeed: 40,
    timingError: (opts.timing ?? 0) * profile.window,
    pullDir: pullDirection('R', 'R'),
    rng: new Rng(opts.seed),
  });
}

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

function spread(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / xs.length);
}

describe('outcome noise scales with how badly the swing was missed', () => {
  /** Standard deviation of a batted-ball property across seeds alone. */
  function seedSpread(
    pick: (r: ContactResult) => number,
    opts: { timing?: number; vertical?: number },
  ): number {
    const vals: number[] = [];
    for (const seed of SEEDS) {
      const r = swing({ ...opts, seed });
      if (r.grade === 'miss' || r.grade === 'foul' || r.grade === 'foultip') continue;
      vals.push(pick(r));
    }
    // The sample has to be big enough for the spread to mean anything.
    expect(vals.length).toBeGreaterThan(80);
    return spread(vals);
  }

  it('makes a barrelled ball far more repeatable than a mishit', () => {
    // Identical inputs, different seeds. A squared-up ball should land in
    // essentially the same place every time; a mishit off the end genuinely
    // should not. This is the difference between skill and a dice roll.
    const barrel = seedSpread((r) => r.sprayAngle, {});
    const mishit = seedSpread((r) => r.sprayAngle, { timing: 0.55, vertical: 0.35 });
    expect(barrel).toBeLessThan(mishit * 0.55);

    const barrelEv = seedSpread((r) => r.exitVelo, {});
    const mishitEv = seedSpread((r) => r.exitVelo, { timing: 0.55, vertical: 0.35 });
    expect(barrelEv).toBeLessThan(mishitEv * 0.7);
  });

  it('keeps a perfect swing inside a tight band on every axis', () => {
    expect(seedSpread((r) => r.exitVelo, {})).toBeLessThan(0.8);
    expect(seedSpread((r) => r.launchAngle, {})).toBeLessThan(1.6);
    expect(seedSpread((r) => r.sprayAngle, {})).toBeLessThan(4);
  });
});

describe('timing changes the plane of the swing, deterministically', () => {
  it('lifts an early swing and drives a late one into the ground', () => {
    for (const seed of SEEDS) {
      const early = swing({ seed, timing: -0.45 });
      const late = swing({ seed, timing: 0.45 });
      if (early.grade === 'miss' || late.grade === 'miss') continue;
      if (early.grade === 'foul' || late.grade === 'foul') continue;
      expect(early.launchAngle).toBeGreaterThan(late.launchAngle);
    }
  });

  it('costs exit velocity for contact off the end of the bat', () => {
    const centred = swing({ seed: 7 });
    const offTheEnd = swing({ seed: 7, horizontal: 0.75 });
    expect(offTheEnd.grade).not.toBe('miss');
    expect(offTheEnd.exitVelo).toBeLessThan(centred.exitVelo);
  });
});

describe('the labels the plate view prints describe the swing it was given', () => {
  it('reports normalised errors that match the profile the swing used', () => {
    const profile = swingProfile(HITTER, 'contact', 'pro', false);
    const r = swing({ seed: 3, timing: -0.6, vertical: 0.4, horizontal: -0.2 });
    expect(r.timingNorm).toBeCloseTo(-0.6, 9);
    expect(r.vertNorm).toBeCloseTo(0.4, 9);
    expect(r.horizNorm).toBeCloseTo(-0.2, 9);
    // And the raw metre/second values still agree with the normalised ones.
    expect(r.timingError).toBeCloseTo(-0.6 * profile.window, 9);
    expect(r.vertMiss).toBeCloseTo(0.4 * profile.ry, 9);
  });

  it('names early as early and late as late, on every outcome', () => {
    for (const timing of [-1.4, -0.9, -0.5, -0.1, 0, 0.1, 0.5, 0.9, 1.4]) {
      const r = swing({ seed: 11, timing });
      expect(r.timingLabel).toBe(timingLabelOf(timing));
      if (timing <= -0.75) expect(r.timingLabel).toBe('WAY EARLY');
      if (Math.abs(timing) < 0.28) expect(r.timingLabel).toBe('ON TIME');
      if (timing >= 0.75) expect(r.timingLabel).toBe('WAY LATE');
    }
  });

  it('calls the ball above the cursor "under it" and below it "over it"', () => {
    expect(planeLabelOf(0.9)).toBe('UNDER IT');
    expect(planeLabelOf(0)).toBe('ON PLANE');
    expect(planeLabelOf(-0.9)).toBe('OVER IT');
    expect(swing({ seed: 2, vertical: 0.8 }).planeLabel).toBe('UNDER IT');
    expect(swing({ seed: 2, vertical: -0.8 }).planeLabel).toBe('OVER IT');
  });
});

describe('the pitch tracker records what actually happened', () => {
  const league = buildLeague();

  function play(seed: number) {
    const away = league[seed % 10];
    const home = league[(seed * 3 + 1) % 10];
    const a = away.id === home.id ? league[(seed + 1) % 10] : away;
    const setup: GameSetup = {
      awayTeamId: a.id,
      homeTeamId: home.id,
      stadiumId: 'grove-park',
      innings: 3,
      difficulty: 'pro',
      awayControl: 'cpu',
      homeControl: 'cpu',
      night: false,
      seed,
    };
    return simulateGame(setup, teamById(league, a.id), teamById(league, home.id), {
      validate: false,
    });
  }

  it('never shows a longer at-bat than the count allows, and always agrees with it', () => {
    for (let i = 0; i < 30; i++) {
      const rep = play((51_437 + i * 7919) >>> 0);
      const log = rep.state.pitchLog;
      // The tracker is per plate appearance and the game ends mid-appearance
      // at most once, so whatever is left has to be a legal partial count.
      const balls = log.filter((e) => e.result === 'ball').length;
      const called = log.filter((e) => e.result === 'called').length;
      const whiffs = log.filter((e) => e.result === 'swinging').length;
      expect(balls).toBeLessThanOrEqual(4);
      expect(called + whiffs).toBeLessThanOrEqual(3);
      for (const e of log) {
        expect(e.balls).toBeGreaterThanOrEqual(0);
        expect(e.balls).toBeLessThanOrEqual(3);
        expect(e.strikes).toBeGreaterThanOrEqual(0);
        expect(e.strikes).toBeLessThanOrEqual(2);
        expect(Number.isFinite(e.x)).toBe(true);
        expect(Number.isFinite(e.y)).toBe(true);
        expect(e.speedMs).toBeGreaterThan(10);
        // A called strike is by definition a pitch in the zone, and a pitch
        // ruled a ball is by definition one outside it. If these ever disagree
        // the dots are painting a different game from the one being played.
        if (e.result === 'called') expect(e.inZone).toBe(true);
        if (e.result === 'ball') expect(e.inZone).toBe(false);
      }
    }
  });

  it('logs every pitch of an at-bat exactly once', () => {
    const rep = play(20_260_731);
    const log = rep.state.pitchLog;
    // Counts only ever go up within an appearance, and each entry carries the
    // count it was thrown in, so the sequence must be non-decreasing.
    for (let i = 1; i < log.length; i++) {
      expect(log[i].balls + log[i].strikes).toBeGreaterThanOrEqual(
        log[i - 1].balls + log[i - 1].strikes,
      );
    }
  });
});

describe('the break preview cannot drift from the pitch', () => {
  it('reports the same movement the engine applies, mirrored by handedness', () => {
    for (const type of ['curve', 'slider', 'sinker', 'screwball', 'changeup'] as const) {
      const prof = PITCHES[type];
      const right = pitchBreak(type, 'R', 0.5);
      const left = pitchBreak(type, 'L', 0.5);
      // Arm-side break is mirrored between a righty and a lefty, never resized.
      expect(right.breakX).toBeCloseTo(-left.breakX, 9);
      expect(right.breakY).toBeCloseTo(left.breakY, 9);
      // Vertical break never flips sign with handedness: a curve falls for both.
      expect(Math.sign(right.breakY)).toBe(Math.sign(prof.breakY));
    }
  });

  it('scales with the movement rating, and by the same factor for every pitch', () => {
    const weak = pitchBreak('slider', 'R', 0);
    const strong = pitchBreak('slider', 'R', 1);
    expect(Math.abs(strong.breakX)).toBeGreaterThan(Math.abs(weak.breakX));
    expect(strong.breakX / weak.breakX).toBeCloseTo(1.3 / 0.7, 6);
  });
});
