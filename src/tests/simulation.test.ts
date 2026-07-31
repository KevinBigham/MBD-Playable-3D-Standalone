import { beforeAll, describe, expect, it } from 'vitest';
import type { BattingLine, GameSetup, PitchingLine, Team } from '../core/types';
import { buildLeague } from '../data/teams';
import { type SimReport, simulateGame, summarize } from '../sim/autoplay';

/**
 * The batch harness. One broken game is a bug; a hundred games that quietly
 * drift out of a believable statistical band is a balance regression, and that
 * is the thing this file exists to catch. Every game here runs through exactly
 * the same engine a human plays.
 */

const LEAGUE: Team[] = buildLeague();
const GAME_COUNT = 100;
const INNINGS = 3;

function setupFor(index: number): { setup: GameSetup; away: Team; home: Team } {
  const away = LEAGUE[index % LEAGUE.length];
  const home = LEAGUE[(index + 3 + Math.floor(index / LEAGUE.length)) % LEAGUE.length];
  const opponent = home.id === away.id ? LEAGUE[(index + 5) % LEAGUE.length] : home;
  return {
    setup: {
      awayTeamId: away.id,
      homeTeamId: opponent.id,
      stadiumId: opponent.homeStadium,
      innings: INNINGS,
      difficulty: 'pro',
      awayControl: 'cpu',
      homeControl: 'cpu',
      night: index % 2 === 0,
      seed: (index * 2654435761 + 0x9e3779b9) >>> 0,
    },
    away,
    home: opponent,
  };
}

interface Batch {
  reports: SimReport[];
  summaries: ReturnType<typeof summarize>[];
  batting: BattingLine;
  pitching: PitchingLine;
  totalRuns: number;
  totalHits: number;
  totalInnings: number;
}

const batch: Batch = {
  reports: [],
  summaries: [],
  batting: {
    ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, hbp: 0, so: 0, sb: 0, pa: 0,
  },
  pitching: { outs: 0, h: 0, r: 0, er: 0, bb: 0, hbp: 0, so: 0, hr: 0, pitches: 0, w: 0, l: 0, sv: 0 },
  totalRuns: 0,
  totalHits: 0,
  totalInnings: 0,
};

beforeAll(() => {
  for (let i = 0; i < GAME_COUNT; i++) {
    const { setup, away, home } = setupFor(i);
    const report = simulateGame(setup, away, home, { validate: true });
    batch.reports.push(report);
    batch.summaries.push(summarize(report));

    const result = report.result;
    if (!result) continue;
    batch.totalRuns += result.awayRuns + result.homeRuns;
    batch.totalHits += result.awayHits + result.homeHits;
    batch.totalInnings += result.innings;
    for (const line of Object.values(result.batting)) {
      batch.batting.ab += line.ab;
      batch.batting.r += line.r;
      batch.batting.h += line.h;
      batch.batting.doubles += line.doubles;
      batch.batting.triples += line.triples;
      batch.batting.hr += line.hr;
      batch.batting.rbi += line.rbi;
      batch.batting.bb += line.bb;
      batch.batting.so += line.so;
      batch.batting.pa += line.pa;
    }
    for (const line of Object.values(result.pitching)) {
      batch.pitching.outs += line.outs;
      batch.pitching.h += line.h;
      batch.pitching.r += line.r;
      batch.pitching.bb += line.bb;
      batch.pitching.so += line.so;
      batch.pitching.hr += line.hr;
      batch.pitching.pitches += line.pitches;
    }
  }
}, 600_000);

describe(`${GAME_COUNT} CPU-vs-CPU games`, () => {
  it('all reach a final score', () => {
    const unfinished = batch.reports
      .map((r, i) => ({ i, completed: r.completed, hasResult: r.result !== null }))
      .filter((r) => !r.completed || !r.hasResult);
    expect(unfinished).toEqual([]);
  });

  it('produce no anomalies at all', () => {
    const issues = batch.summaries.flatMap((s, i) => s.issues.map((msg) => `game ${i}: ${msg}`));
    expect(issues).toEqual([]);
    expect(batch.summaries.every((s) => s.valid)).toBe(true);
  });

  it('never need a play force-resolved', () => {
    // A forced resolution means the engine could not work out how a play ends
    // on its own. It is a stall, and it must never happen.
    const forced = batch.reports
      .map((r, i) => ({ i, forced: r.state.diag.forcedResolutions }))
      .filter((r) => r.forced > 0);
    expect(forced).toEqual([]);
  });

  it('never post a negative score or a tie', () => {
    for (const report of batch.reports) {
      const r = report.result!;
      expect(r.awayRuns).toBeGreaterThanOrEqual(0);
      expect(r.homeRuns).toBeGreaterThanOrEqual(0);
      expect(r.awayRuns).not.toBe(r.homeRuns);
      expect(r.awayErrors).toBeGreaterThanOrEqual(0);
      expect(r.homeErrors).toBeGreaterThanOrEqual(0);
    }
  });

  it('assign a winning and a losing pitcher to every game', () => {
    for (const report of batch.reports) {
      const r = report.result!;
      expect(r.winningPitcherId).toBeTruthy();
      expect(r.losingPitcherId).toBeTruthy();
      expect(r.winningPitcherId).not.toBe(r.losingPitcherId);
    }
  });
});

describe('aggregate balance', () => {
  it('scores a believable number of runs', () => {
    // Normalised to a nine-inning game so the band means the same thing however
    // long the test games are.
    const runsPerNine = (batch.totalRuns / batch.totalInnings) * 9;
    expect(runsPerNine).toBeGreaterThan(5);
    expect(runsPerNine).toBeLessThan(18);
  });

  it('collects a believable number of hits', () => {
    const hitsPerNine = (batch.totalHits / batch.totalInnings) * 9;
    expect(hitsPerNine).toBeGreaterThan(4);
    expect(hitsPerNine).toBeLessThan(26);
  });

  it('produces a league batting average in a major-league band', () => {
    expect(batch.batting.ab).toBeGreaterThan(2000);
    const avg = batch.batting.h / batch.batting.ab;
    expect(avg).toBeGreaterThan(0.2);
    expect(avg).toBeLessThan(0.36);
  });

  it('strikes out between 12% and 32% of hitters', () => {
    const rate = batch.batting.so / batch.batting.pa;
    expect(rate).toBeGreaterThan(0.12);
    expect(rate).toBeLessThan(0.32);
  });

  it('walks a plausible fraction of hitters', () => {
    const rate = batch.batting.bb / batch.batting.pa;
    expect(rate).toBeGreaterThan(0.01);
    expect(rate).toBeLessThan(0.2);
  });

  it('hits home runs often enough to matter and rarely enough to mean something', () => {
    const hrPerNine = (batch.batting.hr / batch.totalInnings) * 9;
    expect(hrPerNine).toBeGreaterThan(0.5);
    expect(hrPerNine).toBeLessThan(8);
    expect(batch.batting.hr).toBeLessThanOrEqual(batch.batting.h);
  });

  it('keeps the batting and pitching sides of the box score in agreement', () => {
    // Every strikeout, hit and home run is written to both sides of the book at
    // the same moment, so these totals have to match exactly.
    expect(batch.pitching.so).toBe(batch.batting.so);
    expect(batch.pitching.h).toBe(batch.batting.h);
    expect(batch.pitching.hr).toBe(batch.batting.hr);
    // Walks are charged to the pitcher; a hit batsman reaches without one.
    expect(batch.pitching.bb).toBeLessThanOrEqual(batch.batting.bb);
    expect(batch.pitching.bb).toBeGreaterThan(0);
  });

  it('records three outs per completed half-inning of pitching', () => {
    // Outs recorded can never exceed three per half-inning actually played.
    const maxHalves = batch.reports.reduce((acc, r) => acc + r.result!.innings * 2, 0);
    expect(batch.pitching.outs).toBeGreaterThan(0);
    expect(batch.pitching.outs).toBeLessThanOrEqual(maxHalves * 3);
  });

  it('throws a sane number of pitches per plate appearance', () => {
    const perPa = batch.pitching.pitches / batch.batting.pa;
    expect(perPa).toBeGreaterThan(2);
    expect(perPa).toBeLessThan(7);
  });
});

describe('determinism', () => {
  it('reproduces a byte-identical result for the same seed', () => {
    const { setup, away, home } = setupFor(7);
    const first = simulateGame(setup, away, home, { validate: false });
    const second = simulateGame(setup, away, home, { validate: false });
    expect(first.result).not.toBeNull();
    expect(JSON.stringify(second.result)).toBe(JSON.stringify(first.result));
    expect(second.ticks).toBe(first.ticks);
  });

  it('produces a different game for a different seed', () => {
    const { setup, away, home } = setupFor(7);
    const a = simulateGame(setup, away, home, { validate: false });
    const b = simulateGame({ ...setup, seed: (setup.seed ^ 0x5bf03635) >>> 0 }, away, home, {
      validate: false,
    });
    expect(JSON.stringify(b.result)).not.toBe(JSON.stringify(a.result));
  });

  it('builds the same league from the same seed', () => {
    expect(JSON.stringify(buildLeague(1234))).toBe(JSON.stringify(buildLeague(1234)));
    expect(JSON.stringify(buildLeague(1235))).not.toBe(JSON.stringify(buildLeague(1234)));
  });
});
