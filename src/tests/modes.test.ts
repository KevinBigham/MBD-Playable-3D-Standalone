import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GameSetup, Team } from '../core/types';
import { TEAM_IDENTITIES, buildLeague, teamById } from '../data/teams';
import {
  type ChampionshipState,
  type CupMatch,
  applyMatchResult,
  createChampionship,
  setupForMatch,
  simulateRound,
  userMatch,
} from '../modes/championship';
import {
  type SeasonState,
  activeSeries,
  applyPlayoffGame,
  createSeason,
  loadSeason,
  nextSeriesMatchup,
  regularSeasonComplete,
  saveSeason,
  simulateScheduledGame,
  sortedStandings,
  startPlayoffs,
} from '../modes/season';
import { simulateGame } from '../sim/autoplay';

/**
 * Season and cup bookkeeping. A mode is only trustworthy if the schedule is
 * balanced, the standings always add up, and the bracket can never be left with
 * a hole in it — those are the failures that strand a player mid-run.
 */

const LEAGUE: Team[] = buildLeague();
const INNINGS = 3;

/** In-memory stand-in for the browser's localStorage. */
function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(k: string) {
      return store.has(k) ? store.get(k)! : null;
    },
    key(i: number) {
      return Array.from(store.keys())[i] ?? null;
    },
    removeItem(k: string) {
      store.delete(k);
    },
    setItem(k: string, v: string) {
      store.set(k, String(v));
    },
  } as unknown as Storage;
}

let season: SeasonState;
let playoffSeedIds: string[] = [];

beforeAll(() => {
  globalThis.localStorage = memoryStorage();

  season = createSeason({
    userTeamId: 'ironport',
    difficulty: 'pro',
    innings: INNINGS,
    length: 'short',
    seed: 20260731,
  });
  for (const game of season.schedule) simulateScheduledGame(season, game, LEAGUE);

  const series = startPlayoffs(season);
  playoffSeedIds = series.flatMap((s) => [s.highSeedId, s.lowSeedId]);

  let guard = 0;
  while (!season.championId && guard < 32) {
    guard++;
    const active = activeSeries(season);
    if (!active) break;
    const matchup = nextSeriesMatchup(active);
    const setup: GameSetup = {
      awayTeamId: matchup.awayId,
      homeTeamId: matchup.homeId,
      stadiumId: teamById(LEAGUE, matchup.homeId).homeStadium,
      innings: INNINGS,
      difficulty: 'pro',
      awayControl: 'cpu',
      homeControl: 'cpu',
      night: true,
      seed: (season.seed ^ (guard * 2654435761)) >>> 0,
    };
    const report = simulateGame(
      setup,
      teamById(LEAGUE, matchup.awayId),
      teamById(LEAGUE, matchup.homeId),
      { validate: false },
    );
    applyPlayoffGame(season, active, matchup.awayId, matchup.homeId, report.result!);
  }
}, 600_000);

afterAll(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('season schedule', () => {
  it('gives every club exactly the advertised number of games', () => {
    const appearances = new Map<string, number>(TEAM_IDENTITIES.map((t) => [t.id, 0]));
    for (const game of season.schedule) {
      appearances.set(game.awayId, appearances.get(game.awayId)! + 1);
      appearances.set(game.homeId, appearances.get(game.homeId)! + 1);
    }
    for (const [teamId, played] of appearances) {
      expect({ teamId, played }).toEqual({ teamId, played: season.gamesPerTeam });
    }
    expect(season.schedule).toHaveLength((season.gamesPerTeam * TEAM_IDENTITIES.length) / 2);
  });

  it('never schedules a club against itself and always uses the host’s park', () => {
    for (const game of season.schedule) {
      expect(game.awayId).not.toBe(game.homeId);
      expect(game.stadiumId).toBe(
        TEAM_IDENTITIES.find((t) => t.id === game.homeId)!.homeStadium,
      );
    }
  });

  it('is reproducible from the season seed', () => {
    const a = createSeason({
      userTeamId: 'ironport', difficulty: 'pro', innings: INNINGS, length: 'short', seed: 4242,
    });
    const b = createSeason({
      userTeamId: 'ironport', difficulty: 'pro', innings: INNINGS, length: 'short', seed: 4242,
    });
    expect(a.schedule).toEqual(b.schedule);
  });
});

describe('a fully simulated season', () => {
  it('leaves every scheduled game played', () => {
    expect(regularSeasonComplete(season)).toBe(true);
    expect(season.schedule.every((g) => g.played)).toBe(true);
    expect(season.schedule.every((g) => g.awayRuns !== g.homeRuns)).toBe(true);
  });

  it('records exactly one win for every loss', () => {
    const rows = Object.values(season.standings);
    const wins = sum(rows.map((r) => r.w));
    const losses = sum(rows.map((r) => r.l));
    expect(wins).toBe(losses);
    expect(wins).toBe(season.schedule.length);
    for (const row of rows) {
      expect(row.w + row.l).toBe(season.gamesPerTeam);
      expect(row.last10.length).toBeLessThanOrEqual(10);
    }
  });

  it('balances runs scored against runs allowed across the league', () => {
    const rows = Object.values(season.standings);
    // Every run scored by somebody was allowed by somebody else.
    expect(sum(rows.map((r) => r.rf))).toBe(sum(rows.map((r) => r.ra)));
    expect(sum(rows.map((r) => r.rf))).toBeGreaterThan(0);
  });

  it('accumulates player statistics that stay internally consistent', () => {
    const batting = Object.values(season.stats.batting);
    expect(batting.length).toBeGreaterThan(50);
    for (const line of batting) {
      expect(line.h).toBeLessThanOrEqual(line.ab);
      expect(line.ab).toBeLessThanOrEqual(line.pa);
      expect(line.doubles + line.triples + line.hr).toBeLessThanOrEqual(line.h);
    }
  });

  it('sorts the standings by record', () => {
    const table = sortedStandings(season);
    expect(table).toHaveLength(TEAM_IDENTITIES.length);
    for (let i = 1; i < table.length; i++) {
      expect(table[i - 1].w - table[i - 1].l).toBeGreaterThanOrEqual(table[i].w - table[i].l);
    }
    for (const division of ['tide', 'ridge'] as const) {
      expect(sortedStandings(season, division)).toHaveLength(5);
    }
  });
});

describe('the postseason', () => {
  it('seeds four distinct clubs', () => {
    expect(playoffSeedIds).toHaveLength(4);
    expect(new Set(playoffSeedIds).size).toBe(4);
    for (const id of playoffSeedIds) {
      expect(TEAM_IDENTITIES.some((t) => t.id === id)).toBe(true);
    }
  });

  it('includes both division winners', () => {
    const winners = [sortedStandings(season, 'tide')[0].teamId, sortedStandings(season, 'ridge')[0].teamId];
    for (const id of winners) expect(playoffSeedIds).toContain(id);
  });

  it('crowns exactly one champion once the bracket is played out', () => {
    expect(season.championId).not.toBeNull();
    const bracket = season.playoffs!;
    expect(bracket.map((s) => s.id).sort()).toEqual(['final', 'semi-1', 'semi-2']);
    for (const series of bracket) {
      expect(series.winnerId).not.toBeNull();
      expect([series.highSeedId, series.lowSeedId]).toContain(series.winnerId);
      expect(Math.max(series.highWins, series.lowWins)).toBe(series.wins);
      expect(series.games.length).toBeGreaterThanOrEqual(series.wins);
    }
    const final = bracket.find((s) => s.round === 'final')!;
    const semiWinners = bracket.filter((s) => s.round === 'semi').map((s) => s.winnerId);
    // The final has to be contested by the two semi-final winners, and the
    // champion has to be the club that won it.
    expect([final.highSeedId, final.lowSeedId].sort()).toEqual([...semiWinners].sort());
    expect(season.championId).toBe(final.winnerId);
  });

  it('alternates home field so the higher seed hosts games one and three', () => {
    const series = season.playoffs!.find((s) => s.round === 'final')!;
    const probe = { ...series, games: [] as typeof series.games };
    expect(nextSeriesMatchup(probe).homeId).toBe(series.highSeedId);
    probe.games = [series.games[0]];
    expect(nextSeriesMatchup(probe).homeId).toBe(series.lowSeedId);
    probe.games = [series.games[0], series.games[0]];
    expect(nextSeriesMatchup(probe).homeId).toBe(series.highSeedId);
  });
});

describe('the Meridian Cup', () => {
  let cup: ChampionshipState;

  beforeAll(() => {
    cup = createChampionship({
      userTeamId: 'coralkey',
      difficulty: 'pro',
      innings: INNINGS,
      seed: 8675309,
      teams: LEAGUE,
    });

    // simulateRound deliberately leaves the user's own match alone, so the test
    // plays that one itself — exactly as the game does when a human is involved.
    let guard = 0;
    while (!cup.championId && guard < 16) {
      guard++;
      simulateRound(cup, LEAGUE);
      const mine = userMatch(cup);
      if (mine && mine.awayId && mine.homeId) {
        const setup = setupForMatch(cup, mine);
        const report = simulateGame(
          setup,
          teamById(LEAGUE, mine.awayId),
          teamById(LEAGUE, mine.homeId),
          { validate: false },
        );
        applyMatchResult(cup, mine, report.result!);
      }
    }
  }, 300_000);

  it('builds a seven-match, three-round bracket', () => {
    expect(cup.bracket).toHaveLength(7);
    const byRound = (round: number) => cup.bracket.filter((m: CupMatch) => m.round === round);
    expect(byRound(0)).toHaveLength(4);
    expect(byRound(1)).toHaveLength(2);
    expect(byRound(2)).toHaveLength(1);
    // Eight distinct clubs open the tournament.
    const entrants = byRound(0).flatMap((m) => [m.awayId, m.homeId]);
    expect(entrants).toHaveLength(8);
    expect(new Set(entrants).size).toBe(8);
    expect(entrants).toContain('coralkey');
  });

  it('plays every match and leaves no hole in the bracket', () => {
    for (const m of cup.bracket) {
      expect({ id: m.id, played: m.played }).toEqual({ id: m.id, played: true });
      expect(m.awayId).toBeTruthy();
      expect(m.homeId).toBeTruthy();
      expect(m.winnerId).toBeTruthy();
      expect([m.awayId, m.homeId]).toContain(m.winnerId);
      expect(m.awayRuns).not.toBe(m.homeRuns);
    }
  });

  it('advances each winner into the correct later-round slot', () => {
    for (const m of cup.bracket) {
      if (m.round === 2) continue;
      const next = cup.bracket.find((x) => x.round === m.round + 1 && x.slot === Math.floor(m.slot / 2))!;
      const expectedSide = m.slot % 2 === 0 ? next.homeId : next.awayId;
      expect(expectedSide).toBe(m.winnerId);
    }
  });

  it('crowns exactly one champion', () => {
    const final = cup.bracket.find((m) => m.round === 2)!;
    expect(cup.championId).toBe(final.winnerId);
    expect(cup.championId).not.toBeNull();
    expect(TEAM_IDENTITIES.some((t) => t.id === cup.championId)).toBe(true);
  });
});

describe('save files', () => {
  /** The one storage key the season slot lives under. */
  function seasonKey(): string {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.includes('season')) return k;
    }
    throw new Error('season slot was never written');
  }

  it('round-trips a season through save and load', () => {
    expect(saveSeason(season)).toBe(true);
    const loaded = loadSeason();
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(season);
    // Loading must produce a detached copy, not a live reference.
    expect(loaded).not.toBe(season);
    expect(loaded!.schedule).toHaveLength(season.schedule.length);
    expect(loaded!.championId).toBe(season.championId);
  });

  it('returns null for a corrupted save rather than throwing', () => {
    saveSeason(season);
    const key = seasonKey();
    for (const junk of ['{{{ not json', '', 'null', '[]', '{"v":1,"t":0,"data":{}}']) {
      localStorage.setItem(key, junk);
      expect(() => loadSeason()).not.toThrow();
      expect(loadSeason()).toBeNull();
    }
  });

  it('returns null for a structurally invalid season payload', () => {
    saveSeason(season);
    const key = seasonKey();
    const envelope = JSON.parse(localStorage.getItem(key)!) as { v: number; t: number; data: unknown };
    // A save whose schedule has been mangled must be discarded, not half-loaded.
    localStorage.setItem(key, JSON.stringify({ ...envelope, data: { ...season, schedule: 'nope' } }));
    expect(loadSeason()).toBeNull();
    localStorage.setItem(key, JSON.stringify({ ...envelope, data: { ...season, cursor: 'nope' } }));
    expect(loadSeason()).toBeNull();
  });

  it('returns null when nothing has ever been saved', () => {
    localStorage.clear();
    expect(loadSeason()).toBeNull();
  });
});
