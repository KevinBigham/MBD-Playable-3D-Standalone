import { beforeAll, describe, expect, it } from 'vitest';
import { buildLeague } from '../data/teams';
import { chooseAlignment, choosePitchAround, type DefenseSituation } from '../sim/ai';
import { ALIGNMENT, alignedHome } from '../sim/fielders';
import { simulateGame } from '../sim/autoplay';
import type { GameSetup, Player } from '../core/types';
import type { DefensiveAlignment } from '../sim/state';

/**
 * SITUATIONAL BASEBALL
 * --------------------
 * The engine could already hit, pitch, field and run. What it could not do was
 * play *baseball situations*: nobody moved the defence, the catcher never threw
 * to second, and a runner on third could not tag up and score.
 *
 * These tests hold the line on all three. Two of them exist because the
 * behaviour was measurably broken before this round:
 *
 *   - sacrifice flies ran at 0.03 per game because `mustTag` was never cleared
 *     once a runner re-touched, so a runner on third dutifully returned to the
 *     bag and then stood on it while the ball came in;
 *   - stolen bases were completely uncontested — a runner walked to the next
 *     base during the pitch and the catcher never threw — which is why the CPU
 *     was taking eight and a half free bases a game.
 */

const league = buildLeague();

const SLOT = { P: 0, C: 1, B1: 2, B2: 3, B3: 4, SS: 5, LF: 6, CF: 7, RF: 8 };

function player(overrides: Partial<Player['bat']>): Player {
  const p = league[0].players[0];
  return { ...p, bat: { ...p.bat, ...overrides } };
}

function situation(o: Partial<DefenseSituation> = {}): DefenseSituation {
  return {
    occupied: [false, false, false, false],
    outs: 0,
    inning: 3,
    totalInnings: 9,
    runDiff: 0,
    batter: league[0].players[0],
    ...o,
  };
}

// ---------------------------------------------------------------------------
// The alignments are geometry, not labels
// ---------------------------------------------------------------------------

describe('defensive alignments move real people', () => {
  it('infield in puts all four infielders closer to the plate', () => {
    for (const slot of [SLOT.B1, SLOT.B2, SLOT.B3, SLOT.SS]) {
      const normal = alignedHome(slot, 'normal');
      const inHome = alignedHome(slot, 'in');
      expect(inHome.z).toBeLessThan(normal.z - 3);
    }
  });

  it('double-play depth moves the middle infielders toward second base', () => {
    // Second base sits at x = 0, so "toward the bag" means a smaller |x|.
    for (const slot of [SLOT.B2, SLOT.SS]) {
      const normal = alignedHome(slot, 'normal');
      const dp = alignedHome(slot, 'dp');
      expect(Math.abs(dp.x)).toBeLessThan(Math.abs(normal.x));
      expect(dp.z).toBeLessThan(normal.z);
    }
  });

  it('no-doubles plays the outfield deeper and the corners on the lines', () => {
    for (const slot of [SLOT.LF, SLOT.CF, SLOT.RF]) {
      expect(alignedHome(slot, 'nodoubles').z).toBeGreaterThan(alignedHome(slot, 'normal').z + 4);
    }
    // First and third widen toward their foul lines.
    expect(alignedHome(SLOT.B1, 'nodoubles').x).toBeGreaterThan(alignedHome(SLOT.B1, 'normal').x);
    expect(alignedHome(SLOT.B3, 'nodoubles').x).toBeLessThan(alignedHome(SLOT.B3, 'normal').x);
  });

  it('corners in charges first and third for the bunt', () => {
    for (const slot of [SLOT.B1, SLOT.B3]) {
      expect(alignedHome(slot, 'corners').z).toBeLessThan(alignedHome(slot, 'normal').z - 6);
    }
  });

  it('never moves the pitcher or the catcher', () => {
    const all: DefensiveAlignment[] = ['normal', 'dp', 'in', 'nodoubles', 'corners'];
    for (const a of all) {
      for (const slot of [SLOT.P, SLOT.C]) {
        expect(alignedHome(slot, a)).toEqual({ x: ALIGNMENT[slot].x, z: ALIGNMENT[slot].z });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The manager reads the situation the way a bench coach would
// ---------------------------------------------------------------------------

describe('the defensive manager', () => {
  it('brings the infield in for the tying run on third with fewer than two outs', () => {
    const s = situation({ occupied: [false, false, false, true], outs: 1, runDiff: 1, inning: 8 });
    expect(chooseAlignment(s)).toBe('in');
  });

  it('does not play in with two outs — there is nothing to cut off', () => {
    const s = situation({ occupied: [false, false, false, true], outs: 2, runDiff: 0, inning: 8 });
    expect(chooseAlignment(s)).not.toBe('in');
  });

  it('does not concede base hits to save a meaningless run', () => {
    const s = situation({ occupied: [false, false, false, true], outs: 1, runDiff: 9, inning: 8 });
    expect(chooseAlignment(s)).not.toBe('in');
  });

  it('sets up the double play with a man on first', () => {
    expect(chooseAlignment(situation({ occupied: [false, true, false, false], outs: 1 }))).toBe('dp');
  });

  it('guards the lines protecting a late lead', () => {
    const s = situation({ inning: 9, totalInnings: 9, runDiff: 3 });
    expect(chooseAlignment(s)).toBe('nodoubles');
  });

  it('crashes the corners on a fast, powerless hitter in a tight game', () => {
    const s = situation({
      occupied: [false, true, false, false],
      outs: 0,
      batter: player({ power: 15, speed: 88 }),
    });
    expect(chooseAlignment(s)).toBe('corners');
  });

  it('stands normally with nobody on', () => {
    expect(chooseAlignment(situation())).toBe('normal');
  });
});

describe('pitching around a hitter', () => {
  it('puts a dangerous hitter on with two outs and first base open', () => {
    const s = situation({
      occupied: [false, false, true, false],
      outs: 2,
      inning: 8,
      batter: player({ power: 95, contact: 90 }),
    });
    expect(choosePitchAround(s, player({ power: 30, contact: 35 }), true)).toBe('intentional');
  });

  it('will not hand out a base to face an equally dangerous hitter', () => {
    const s = situation({
      occupied: [false, false, true, false],
      outs: 2,
      inning: 8,
      batter: player({ power: 95, contact: 90 }),
    });
    // Working carefully to a great hitter with a man in scoring position late
    // is right whoever is on deck — what is wrong is giving away the base when
    // it buys you nothing.
    expect(choosePitchAround(s, player({ power: 95, contact: 90 }), true)).not.toBe('intentional');
  });

  it('never walks a hitter when the game is out of hand', () => {
    const s = situation({
      occupied: [false, false, true, false],
      outs: 2,
      inning: 8,
      runDiff: 9,
      batter: player({ power: 95, contact: 90 }),
    });
    expect(choosePitchAround(s, player({ power: 20, contact: 20 }), true)).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// The situations actually happen in real games
// ---------------------------------------------------------------------------

describe('situational baseball shows up over a run of games', () => {
  const GAMES = 24;
  const tex = {
    doublePlays: 0,
    sacFlies: 0,
    stealAttempts: 0,
    stealsSafe: 0,
    wildPitches: 0,
    passedBalls: 0,
    runnersThrownOut: 0,
  };
  const align: Record<string, number> = { normal: 0, dp: 0, in: 0, nodoubles: 0, corners: 0 };
  let anomalies = 0;
  let forced = 0;

  beforeAll(() => {
    for (let i = 0; i < GAMES; i++) {
      const away = league[i % league.length];
      const home = league[(i * 3 + 1) % league.length];
      const setup: GameSetup = {
        awayTeamId: away.id,
        homeTeamId: home.id,
        stadiumId: 'meridian',
        innings: 9,
        difficulty: 'pro',
        awayControl: 'cpu',
        homeControl: 'cpu',
        night: false,
        seed: 5100 + i * 31,
      };
      const report = simulateGame(setup, away, home);
      const t = report.state.diag.texture;
      for (const k of Object.keys(tex) as (keyof typeof tex)[]) tex[k] += t[k];
      for (const k of Object.keys(align)) align[k] += t.alignment[k as keyof typeof t.alignment];
      anomalies += report.anomalies.length;
      forced += report.state.diag.forcedResolutions;
    }
  }, 120_000);

  it('completes every game cleanly', () => {
    expect(anomalies).toBe(0);
    expect(forced).toBe(0);
  });

  it('turns double plays', () => {
    expect(tex.doublePlays / GAMES).toBeGreaterThan(0.8);
  });

  it('scores runners from third on fly balls', () => {
    // Before `mustTag` was released on re-touch this ran at 0.03 per game,
    // which is to say sacrifice flies did not exist.
    expect(tex.sacFlies / GAMES).toBeGreaterThan(0.12);
  });

  it('contests stolen bases instead of handing them out', () => {
    expect(tex.stealAttempts).toBeGreaterThan(0);
    const safeRate = tex.stealsSafe / tex.stealAttempts;
    // Uncontested steals were 100% safe. Real baseball sits near three in four,
    // and the point of the throw-down is that it is neither 0 nor 1.
    expect(safeRate).toBeGreaterThan(0.4);
    expect(safeRate).toBeLessThan(0.95);
  });

  it('lets a ball get past the catcher occasionally, but not often', () => {
    const perGame = (tex.wildPitches + tex.passedBalls) / GAMES;
    expect(perGame).toBeGreaterThan(0.1);
    expect(perGame).toBeLessThan(2.5);
  });

  it('uses more than one defensive alignment', () => {
    const used = Object.entries(align).filter(([, v]) => v > 0);
    expect(used.length).toBeGreaterThanOrEqual(3);
    // The honest alignment should still be the common one.
    const total = Object.values(align).reduce((a, b) => a + b, 0);
    expect(align.normal / total).toBeGreaterThan(0.4);
    expect(align.normal / total).toBeLessThan(0.95);
  });

  it('throws runners out on the bases', () => {
    expect(tex.runnersThrownOut / GAMES).toBeGreaterThan(0.5);
  });
});
