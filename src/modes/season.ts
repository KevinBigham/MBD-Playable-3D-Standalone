import type { BattingLine, Difficulty, GameResult, GameSetup, PitchingLine, Team } from '../core/types';
import { emptyBattingLine, emptyPitchingLine } from '../core/types';
import { Rng } from '../core/rng';
import { TEAM_IDENTITIES, teamById } from '../data/teams';
import { simulateGame } from '../sim/autoplay';
import { SLOT, loadSlot, saveSlot } from '../save/storage';

export type SeasonLength = 'short' | 'standard' | 'long';

export const SEASON_LENGTHS: Record<SeasonLength, { games: number; label: string; blurb: string }> = {
  short: { games: 18, label: 'SHORT', blurb: '18 games. One evening.' },
  standard: { games: 36, label: 'STANDARD', blurb: '36 games. A proper run.' },
  long: { games: 54, label: 'MARATHON', blurb: '54 games. Commit.' },
};

export interface ScheduledGame {
  id: number;
  day: number;
  awayId: string;
  homeId: string;
  stadiumId: string;
  played: boolean;
  awayRuns: number;
  homeRuns: number;
}

export interface StandingsRow {
  teamId: string;
  w: number;
  l: number;
  rf: number;
  ra: number;
  streak: number;
  last10: ('W' | 'L')[];
}

export interface SeasonPlayerStats {
  batting: Record<string, BattingLine>;
  pitching: Record<string, PitchingLine>;
}

export type PlayoffRoundId = 'semi' | 'final';

export interface PlayoffSeries {
  id: string;
  round: PlayoffRoundId;
  highSeedId: string;
  lowSeedId: string;
  /** Wins needed. Semi-finals are one game; the final is best of three. */
  wins: number;
  highWins: number;
  lowWins: number;
  games: { awayId: string; homeId: string; awayRuns: number; homeRuns: number }[];
  winnerId: string | null;
}

export interface SeasonState {
  id: string;
  seed: number;
  userTeamId: string;
  difficulty: Difficulty;
  innings: number;
  length: SeasonLength;
  gamesPerTeam: number;
  schedule: ScheduledGame[];
  /** Index of the next unplayed game overall. */
  cursor: number;
  standings: Record<string, StandingsRow>;
  stats: SeasonPlayerStats;
  playoffs: PlayoffSeries[] | null;
  championId: string | null;
  createdAt: number;
}

const TEAM_IDS = TEAM_IDENTITIES.map((t) => t.id);

function emptyStandings(): Record<string, StandingsRow> {
  const rows: Record<string, StandingsRow> = {};
  for (const id of TEAM_IDS) {
    rows[id] = { teamId: id, w: 0, l: 0, rf: 0, ra: 0, streak: 0, last10: [] };
  }
  return rows;
}

/**
 * Round-robin schedule. Each "day" pairs every club exactly once, so the
 * standings stay balanced no matter where the user stops playing.
 */
export function buildSchedule(rng: Rng, gamesPerTeam: number): ScheduledGame[] {
  const teams = [...TEAM_IDS];
  const n = teams.length;
  const rounds = n - 1;
  const half = n / 2;
  const games: ScheduledGame[] = [];
  let id = 0;
  let day = 0;

  const rotation = teams.slice(1);
  const fixed = teams[0];

  for (let cycle = 0; games.length < (gamesPerTeam * n) / 2; cycle++) {
    for (let r = 0; r < rounds && games.length < (gamesPerTeam * n) / 2; r++) {
      const dayTeams = [fixed, ...rotation];
      const pairs: [string, string][] = [];
      for (let i = 0; i < half; i++) {
        pairs.push([dayTeams[i], dayTeams[n - 1 - i]]);
      }
      for (const [a, b] of pairs) {
        // Alternate home field between cycles so nobody gets a permanent edge.
        const homeFirst = (cycle + r) % 2 === 0;
        const homeId = homeFirst ? b : a;
        const awayId = homeFirst ? a : b;
        games.push({
          id: id++,
          day,
          awayId,
          homeId,
          stadiumId: teamStadium(homeId),
          played: false,
          awayRuns: 0,
          homeRuns: 0,
        });
      }
      day++;
      rotation.unshift(rotation.pop()!);
    }
  }

  // Light shuffle within each day so the user's game is not always first.
  const byDay = new Map<number, ScheduledGame[]>();
  for (const g of games) {
    if (!byDay.has(g.day)) byDay.set(g.day, []);
    byDay.get(g.day)!.push(g);
  }
  const out: ScheduledGame[] = [];
  for (const d of [...byDay.keys()].sort((a, b) => a - b)) {
    out.push(...rng.shuffle(byDay.get(d)!));
  }
  out.forEach((g, i) => {
    g.id = i;
  });
  return out;
}

function teamStadium(teamId: string): string {
  return TEAM_IDENTITIES.find((t) => t.id === teamId)?.homeStadium ?? 'anchor-yard';
}

export function createSeason(opts: {
  userTeamId: string;
  difficulty: Difficulty;
  innings: number;
  length: SeasonLength;
  seed: number;
}): SeasonState {
  const rng = new Rng(opts.seed);
  const gamesPerTeam = SEASON_LENGTHS[opts.length].games;
  return {
    id: `season-${opts.seed.toString(36)}`,
    seed: opts.seed,
    userTeamId: opts.userTeamId,
    difficulty: opts.difficulty,
    innings: opts.innings,
    length: opts.length,
    gamesPerTeam,
    schedule: buildSchedule(rng, gamesPerTeam),
    cursor: 0,
    standings: emptyStandings(),
    stats: { batting: {}, pitching: {} },
    playoffs: null,
    championId: null,
    createdAt: Date.now(),
  };
}

/** The next game involving the user's club, or null when the season is over. */
export function nextUserGame(season: SeasonState): ScheduledGame | null {
  for (let i = season.cursor; i < season.schedule.length; i++) {
    const g = season.schedule[i];
    if (g.played) continue;
    if (g.awayId === season.userTeamId || g.homeId === season.userTeamId) return g;
  }
  return null;
}

export function setupForScheduledGame(season: SeasonState, game: ScheduledGame, seedSalt = 0): GameSetup {
  const userIsAway = game.awayId === season.userTeamId;
  return {
    awayTeamId: game.awayId,
    homeTeamId: game.homeId,
    stadiumId: game.stadiumId,
    innings: season.innings,
    difficulty: season.difficulty,
    awayControl: userIsAway ? 'human1' : 'cpu',
    homeControl: userIsAway ? 'cpu' : 'human1',
    night: game.id % 3 !== 0,
    seed: (season.seed ^ (game.id * 2654435761) ^ seedSalt) >>> 0,
    contextId: `season:${game.id}`,
  };
}

/**
 * Plays out every CPU-only game up to (but not including) the user's next one.
 *
 * Once the user has no games left, the rest of the schedule is played out in
 * full: otherwise games scheduled after the user's final appearance would stay
 * unplayed forever and the postseason could never begin.
 */
export function advanceToUserGame(season: SeasonState, teams: Team[]): number {
  let simmed = 0;
  const userHasGamesLeft = !!nextUserGame(season);
  while (season.cursor < season.schedule.length) {
    const g = season.schedule[season.cursor];
    if (g.played) {
      season.cursor++;
      continue;
    }
    if (userHasGamesLeft && (g.awayId === season.userTeamId || g.homeId === season.userTeamId)) break;
    simulateScheduledGame(season, g, teams);
    simmed++;
    season.cursor++;
  }
  return simmed;
}

/** Simulates one scheduled game headlessly and folds the result into the season. */
export function simulateScheduledGame(season: SeasonState, g: ScheduledGame, teams: Team[]): GameResult {
  const away = teamById(teams, g.awayId);
  const home = teamById(teams, g.homeId);
  const setup: GameSetup = {
    awayTeamId: g.awayId,
    homeTeamId: g.homeId,
    stadiumId: g.stadiumId,
    innings: season.innings,
    difficulty: season.difficulty,
    awayControl: 'cpu',
    homeControl: 'cpu',
    night: g.id % 3 !== 0,
    seed: (season.seed ^ (g.id * 40503) ^ 0x5bf03635) >>> 0,
    contextId: `season:${g.id}`,
  };
  const report = simulateGame(setup, away, home, { validate: false });
  const result =
    report.result ??
    ({
      awayTeamId: g.awayId,
      homeTeamId: g.homeId,
      awayRuns: 0,
      homeRuns: 1,
      awayHits: 0,
      homeHits: 0,
      awayErrors: 0,
      homeErrors: 0,
      innings: season.innings,
      lineScore: { away: [], home: [] },
      batting: {},
      pitching: {},
      walkOff: false,
    } as GameResult);
  applyResult(season, g, result);
  return result;
}

/** Records a finished game (played or simulated) into the season tables. */
export function applyResult(season: SeasonState, g: ScheduledGame, result: GameResult): void {
  if (g.played) return;
  g.played = true;
  g.awayRuns = result.awayRuns;
  g.homeRuns = result.homeRuns;

  const homeWon = result.homeRuns > result.awayRuns;
  bump(season.standings[g.homeId], homeWon, result.homeRuns, result.awayRuns);
  bump(season.standings[g.awayId], !homeWon, result.awayRuns, result.homeRuns);
  mergeStats(season.stats, result);
  // The cursor is owned by whoever is walking the schedule; advancing it here
  // too made advanceToUserGame skip every other game.
}

function bump(row: StandingsRow, won: boolean, rf: number, ra: number): void {
  if (!row) return;
  if (won) {
    row.w++;
    row.streak = row.streak >= 0 ? row.streak + 1 : 1;
  } else {
    row.l++;
    row.streak = row.streak <= 0 ? row.streak - 1 : -1;
  }
  row.rf += rf;
  row.ra += ra;
  row.last10.push(won ? 'W' : 'L');
  if (row.last10.length > 10) row.last10.shift();
}

export function mergeStats(into: SeasonPlayerStats, result: GameResult): void {
  for (const [id, line] of Object.entries(result.batting)) {
    const t = (into.batting[id] ??= emptyBattingLine());
    t.ab += line.ab;
    t.r += line.r;
    t.h += line.h;
    t.doubles += line.doubles;
    t.triples += line.triples;
    t.hr += line.hr;
    t.rbi += line.rbi;
    t.bb += line.bb;
    t.hbp += line.hbp;
    t.so += line.so;
    t.sb += line.sb;
    t.pa += line.pa;
  }
  for (const [id, line] of Object.entries(result.pitching)) {
    const t = (into.pitching[id] ??= emptyPitchingLine());
    t.outs += line.outs;
    t.h += line.h;
    t.r += line.r;
    t.er += line.er;
    t.bb += line.bb;
    t.hbp += line.hbp;
    t.so += line.so;
    t.hr += line.hr;
    t.pitches += line.pitches;
    t.w += line.w;
    t.l += line.l;
    t.sv += line.sv;
  }
}

export function regularSeasonComplete(season: SeasonState): boolean {
  return season.schedule.every((g) => g.played);
}

export function sortedStandings(season: SeasonState, division?: 'tide' | 'ridge'): StandingsRow[] {
  const rows = Object.values(season.standings).filter((r) => {
    if (!division) return true;
    return TEAM_IDENTITIES.find((t) => t.id === r.teamId)?.division === division;
  });
  return rows.sort((a, b) => {
    const pa = a.w - a.l;
    const pb = b.w - b.l;
    if (pb !== pa) return pb - pa;
    if (b.w !== a.w) return b.w - a.w;
    return b.rf - b.ra - (a.rf - a.ra);
  });
}

/**
 * Seeds the four-team postseason: both division winners plus the two best
 * remaining records. Semi-finals are one game, the final is best of three.
 */
export function startPlayoffs(season: SeasonState): PlayoffSeries[] {
  if (season.playoffs) return season.playoffs;
  const tide = sortedStandings(season, 'tide');
  const ridge = sortedStandings(season, 'ridge');
  const winners = [tide[0], ridge[0]];
  const rest = sortedStandings(season).filter((r) => !winners.some((w) => w.teamId === r.teamId));
  const wildcards = rest.slice(0, 2);
  const seeds = [...winners, ...wildcards].sort((a, b) => b.w - a.w || b.rf - b.ra - (a.rf - a.ra));

  season.playoffs = [
    {
      id: 'semi-1',
      round: 'semi',
      highSeedId: seeds[0].teamId,
      lowSeedId: seeds[3].teamId,
      wins: 1,
      highWins: 0,
      lowWins: 0,
      games: [],
      winnerId: null,
    },
    {
      id: 'semi-2',
      round: 'semi',
      highSeedId: seeds[1].teamId,
      lowSeedId: seeds[2].teamId,
      wins: 1,
      highWins: 0,
      lowWins: 0,
      games: [],
      winnerId: null,
    },
  ];
  return season.playoffs;
}

export function activeSeries(season: SeasonState): PlayoffSeries | null {
  if (!season.playoffs) return null;
  return season.playoffs.find((s) => !s.winnerId) ?? null;
}

/** Applies one postseason game and advances the bracket when a series ends. */
export function applyPlayoffGame(
  season: SeasonState,
  series: PlayoffSeries,
  awayId: string,
  homeId: string,
  result: GameResult,
): void {
  series.games.push({
    awayId,
    homeId,
    awayRuns: result.awayRuns,
    homeRuns: result.homeRuns,
  });
  mergeStats(season.stats, result);
  const winnerId = result.homeRuns > result.awayRuns ? homeId : awayId;
  if (winnerId === series.highSeedId) series.highWins++;
  else series.lowWins++;

  if (series.highWins >= series.wins) series.winnerId = series.highSeedId;
  else if (series.lowWins >= series.wins) series.winnerId = series.lowSeedId;

  if (series.winnerId && series.round === 'semi') {
    const semis = season.playoffs!.filter((s) => s.round === 'semi');
    if (semis.every((s) => s.winnerId) && !season.playoffs!.some((s) => s.round === 'final')) {
      season.playoffs!.push({
        id: 'final',
        round: 'final',
        highSeedId: semis[0].winnerId!,
        lowSeedId: semis[1].winnerId!,
        wins: 2,
        highWins: 0,
        lowWins: 0,
        games: [],
        winnerId: null,
      });
    }
  }
  const final = season.playoffs!.find((s) => s.round === 'final');
  if (final?.winnerId) season.championId = final.winnerId;
}

/** Home/away assignment for the next game of a series. */
export function nextSeriesMatchup(series: PlayoffSeries): { awayId: string; homeId: string } {
  // The higher seed hosts games 1 and 3.
  const gameNo = series.games.length;
  const highHosts = gameNo !== 1;
  return highHosts
    ? { awayId: series.lowSeedId, homeId: series.highSeedId }
    : { awayId: series.highSeedId, homeId: series.lowSeedId };
}

export function seriesLabel(series: PlayoffSeries): string {
  return series.round === 'final' ? 'MERIDIAN CUP FINAL' : 'SEMI-FINAL';
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function saveSeason(season: SeasonState): boolean {
  return saveSlot(SLOT.season, season);
}

export function loadSeason(): SeasonState | null {
  const s = loadSlot<SeasonState>(SLOT.season);
  if (!s) return null;
  // Guard against a partially written or hand-edited save.
  if (!Array.isArray(s.schedule) || !s.standings || typeof s.cursor !== 'number') return null;
  for (const id of TEAM_IDS) {
    if (!s.standings[id]) {
      s.standings[id] = { teamId: id, w: 0, l: 0, rf: 0, ra: 0, streak: 0, last10: [] };
    }
  }
  if (!s.stats) s.stats = { batting: {}, pitching: {} };
  return s;
}
