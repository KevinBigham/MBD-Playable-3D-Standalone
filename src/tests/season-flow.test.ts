import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildLeague, teamById } from '../data/teams';
import {
  activeSeries,
  advanceToUserGame,
  applyPlayoffGame,
  applyResult,
  createSeason,
  loadSeason,
  nextSeriesMatchup,
  nextUserGame,
  regularSeasonComplete,
  saveSeason,
  setupForScheduledGame,
  simulateScheduledGame,
  sortedStandings,
  startPlayoffs,
} from '../modes/season';
import { simulateGame } from '../sim/autoplay';

/**
 * Walks a season exactly the way the user interface does — play the user's
 * game, then let advanceToUserGame catch the rest of the league up — rather
 * than iterating the schedule array directly. Driving it any other way hides
 * cursor bugs, which is how a double-advance that silently skipped half the
 * schedule survived the first pass.
 */

const league = buildLeague();
const mem = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
let saved: unknown;

beforeAll(() => {
  saved = g.localStorage;
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  };
});

afterAll(() => {
  g.localStorage = saved;
  mem.clear();
});

describe('season progression through the UI path', () => {
  it('plays every scheduled game exactly once and finishes the regular season', () => {
    const season = createSeason({
      userTeamId: 'ironport',
      difficulty: 'pro',
      innings: 3,
      length: 'short',
      seed: 4242,
    });
    const total = season.schedule.length;
    expect(total).toBe(90);

    advanceToUserGame(season, league);
    let guard = 0;
    while (nextUserGame(season) && guard++ < 400) {
      const gm = nextUserGame(season)!;
      // The user's own game is played, then routed back through applyResult
      // exactly as the postgame screen does.
      const setup = setupForScheduledGame(season, gm, 11);
      const rep = simulateGame(
        { ...setup, awayControl: 'cpu', homeControl: 'cpu' },
        teamById(league, gm.awayId),
        teamById(league, gm.homeId),
        { validate: false },
      );
      applyResult(season, gm, rep.result!);
      advanceToUserGame(season, league);
    }

    expect(regularSeasonComplete(season)).toBe(true);
    expect(season.schedule.filter((x) => x.played).length).toBe(total);

    const rows = sortedStandings(season);
    const wins = rows.reduce((s, r) => s + r.w, 0);
    const losses = rows.reduce((s, r) => s + r.l, 0);
    expect(wins).toBe(total);
    expect(losses).toBe(total);
    expect(rows.reduce((s, r) => s + r.rf, 0)).toBe(rows.reduce((s, r) => s + r.ra, 0));
    for (const r of rows) expect(r.w + r.l).toBe(season.gamesPerTeam);
  });

  it('runs the postseason to a single champion and survives a save round-trip', () => {
    const season = createSeason({
      userTeamId: 'cactusflats',
      difficulty: 'pro',
      innings: 3,
      length: 'short',
      seed: 777,
    });
    advanceToUserGame(season, league);
    let guard = 0;
    while (nextUserGame(season) && guard++ < 400) {
      simulateScheduledGame(season, nextUserGame(season)!, league);
      advanceToUserGame(season, league);
    }
    expect(regularSeasonComplete(season)).toBe(true);

    const bracket = startPlayoffs(season);
    expect(bracket).toHaveLength(2);
    expect(new Set(bracket.flatMap((s) => [s.highSeedId, s.lowSeedId])).size).toBe(4);

    guard = 0;
    while (!season.championId && guard++ < 40) {
      const series = activeSeries(season);
      if (!series) break;
      const m = nextSeriesMatchup(series);
      const rep = simulateGame(
        {
          awayTeamId: m.awayId,
          homeTeamId: m.homeId,
          stadiumId: 'comet-dome',
          innings: 3,
          difficulty: 'pro',
          awayControl: 'cpu',
          homeControl: 'cpu',
          night: true,
          seed: 700 + guard,
        },
        teamById(league, m.awayId),
        teamById(league, m.homeId),
        { validate: false },
      );
      applyPlayoffGame(season, series, m.awayId, m.homeId, rep.result!);
    }

    expect(season.championId).toBeTruthy();
    expect(season.playoffs).toHaveLength(3);
    const final = season.playoffs!.find((s) => s.round === 'final')!;
    expect(final.winnerId).toBe(season.championId);
    // Best of three: never more than three games, never fewer than two.
    expect(final.games.length).toBeGreaterThanOrEqual(2);
    expect(final.games.length).toBeLessThanOrEqual(3);

    expect(saveSeason(season)).toBe(true);
    const back = loadSeason();
    expect(back?.championId).toBe(season.championId);
    expect(back?.schedule.length).toBe(season.schedule.length);
  });
});
