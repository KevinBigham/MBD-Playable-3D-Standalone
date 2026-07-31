import type { Difficulty, GameResult, GameSetup, Team } from '../core/types';
import { Rng } from '../core/rng';
import { TEAM_IDENTITIES, teamById, teamRating } from '../data/teams';
import { simulateGame } from '../sim/autoplay';
import { SLOT, loadSlot, saveSlot } from '../save/storage';

/**
 * A standalone eight-team single-elimination tournament — the whole thing can
 * be finished in three games without touching Season mode.
 */

export interface CupMatch {
  id: string;
  round: number;
  slot: number;
  awayId: string | null;
  homeId: string | null;
  awayRuns: number;
  homeRuns: number;
  played: boolean;
  winnerId: string | null;
  stadiumId: string;
}

export interface ChampionshipState {
  id: string;
  seed: number;
  userTeamId: string;
  difficulty: Difficulty;
  innings: number;
  bracket: CupMatch[];
  championId: string | null;
  eliminated: boolean;
  createdAt: number;
}

export const CUP_ROUND_NAMES = ['QUARTER-FINAL', 'SEMI-FINAL', 'MERIDIAN CUP FINAL'];

const NEUTRAL_STADIUMS = ['comet-dome', 'anchor-yard', 'thunder-ridge', 'summit-field'];

export function createChampionship(opts: {
  userTeamId: string;
  difficulty: Difficulty;
  innings: number;
  seed: number;
  teams: Team[];
}): ChampionshipState {
  const rng = new Rng(opts.seed);

  // Seed by overall rating, with the user's club guaranteed a place.
  const ranked = [...TEAM_IDENTITIES]
    .map((t) => {
      const team = teamById(opts.teams, t.id);
      const r = teamRating(team);
      return { id: t.id, score: r.off + r.def + r.pit + rng.range(-12, 12) };
    })
    .sort((a, b) => b.score - a.score);

  // The user's club is guaranteed a place, but it is seeded on merit like every
  // other entrant — placing it first made the user the top seed every time and
  // always drew it against the weakest club in the field.
  const field: string[] = [];
  for (const t of ranked) {
    if (field.length >= 8) break;
    if (t.id === opts.userTeamId) continue;
    field.push(t.id);
  }
  if (!field.includes(opts.userTeamId)) {
    if (field.length >= 8) field.pop();
    field.push(opts.userTeamId);
  }
  field.sort((a, b) => {
    const sa = ranked.find((r) => r.id === a)?.score ?? 0;
    const sb = ranked.find((r) => r.id === b)?.score ?? 0;
    return sb - sa;
  });
  // Standard 1v8, 4v5, 2v7, 3v6 bracket ordering.
  const order = [0, 7, 3, 4, 1, 6, 2, 5];
  const seeded = order.map((i) => field[i]);

  const bracket: CupMatch[] = [];
  for (let i = 0; i < 4; i++) {
    bracket.push({
      id: `r0-${i}`,
      round: 0,
      slot: i,
      awayId: seeded[i * 2 + 1],
      homeId: seeded[i * 2],
      awayRuns: 0,
      homeRuns: 0,
      played: false,
      winnerId: null,
      stadiumId: rng.pick(NEUTRAL_STADIUMS),
    });
  }
  for (let i = 0; i < 2; i++) {
    bracket.push({
      id: `r1-${i}`,
      round: 1,
      slot: i,
      awayId: null,
      homeId: null,
      awayRuns: 0,
      homeRuns: 0,
      played: false,
      winnerId: null,
      stadiumId: rng.pick(NEUTRAL_STADIUMS),
    });
  }
  bracket.push({
    id: 'r2-0',
    round: 2,
    slot: 0,
    awayId: null,
    homeId: null,
    awayRuns: 0,
    homeRuns: 0,
    played: false,
    winnerId: null,
    stadiumId: 'comet-dome',
  });

  return {
    id: `cup-${opts.seed.toString(36)}`,
    seed: opts.seed,
    userTeamId: opts.userTeamId,
    difficulty: opts.difficulty,
    innings: opts.innings,
    bracket,
    championId: null,
    eliminated: false,
    createdAt: Date.now(),
  };
}

export function userMatch(state: ChampionshipState): CupMatch | null {
  return (
    state.bracket.find(
      (m) => !m.played && (m.awayId === state.userTeamId || m.homeId === state.userTeamId),
    ) ?? null
  );
}

export function setupForMatch(state: ChampionshipState, m: CupMatch): GameSetup {
  const userIsAway = m.awayId === state.userTeamId;
  return {
    awayTeamId: m.awayId!,
    homeTeamId: m.homeId!,
    stadiumId: m.stadiumId,
    innings: state.innings,
    difficulty: state.difficulty,
    awayControl: userIsAway ? 'human1' : 'cpu',
    homeControl: userIsAway ? 'cpu' : 'human1',
    night: m.round >= 1,
    seed: (state.seed ^ (m.round * 7919 + m.slot * 104729)) >>> 0,
    contextId: `cup:${m.id}`,
  };
}

/** Plays every CPU-only match in the current round. */
export function simulateRound(state: ChampionshipState, teams: Team[]): number {
  let count = 0;
  for (const m of state.bracket) {
    if (m.played || !m.awayId || !m.homeId) continue;
    if (m.awayId === state.userTeamId || m.homeId === state.userTeamId) continue;
    if (!roundReady(state, m.round)) continue;
    const setup: GameSetup = {
      awayTeamId: m.awayId,
      homeTeamId: m.homeId,
      stadiumId: m.stadiumId,
      innings: state.innings,
      difficulty: state.difficulty,
      awayControl: 'cpu',
      homeControl: 'cpu',
      night: m.round >= 1,
      seed: (state.seed ^ (m.round * 22571 + m.slot * 48611)) >>> 0,
    };
    const report = simulateGame(setup, teamById(teams, m.awayId), teamById(teams, m.homeId), {
      validate: false,
    });
    if (report.result) {
      applyMatchResult(state, m, report.result);
      count++;
    } else {
      // Never leave a bracket hole: fall back to the higher-rated club.
      applyMatchResult(state, m, {
        ...emptyResult(m.awayId, m.homeId, state.innings),
        homeRuns: 1,
      });
      count++;
    }
  }
  return count;
}

function roundReady(state: ChampionshipState, round: number): boolean {
  if (round === 0) return true;
  return state.bracket.filter((m) => m.round === round - 1).every((m) => m.played);
}

function emptyResult(awayId: string, homeId: string, innings: number): GameResult {
  return {
    awayTeamId: awayId,
    homeTeamId: homeId,
    awayRuns: 0,
    homeRuns: 0,
    awayHits: 0,
    homeHits: 0,
    awayErrors: 0,
    homeErrors: 0,
    innings,
    lineScore: { away: [], home: [] },
    batting: {},
    pitching: {},
    walkOff: false,
  };
}

export function applyMatchResult(state: ChampionshipState, m: CupMatch, result: GameResult): void {
  if (m.played) return;
  m.played = true;
  m.awayRuns = result.awayRuns;
  m.homeRuns = result.homeRuns;
  m.winnerId = result.homeRuns > result.awayRuns ? m.homeId : m.awayId;

  if (m.round === 2) {
    state.championId = m.winnerId;
  } else {
    const nextRound = m.round + 1;
    const nextSlot = Math.floor(m.slot / 2);
    const next = state.bracket.find((x) => x.round === nextRound && x.slot === nextSlot);
    if (next) {
      if (m.slot % 2 === 0) next.homeId = m.winnerId;
      else next.awayId = m.winnerId;
    }
  }

  if (
    (m.awayId === state.userTeamId || m.homeId === state.userTeamId) &&
    m.winnerId !== state.userTeamId
  ) {
    state.eliminated = true;
  }
}

export function championshipComplete(state: ChampionshipState): boolean {
  return state.championId !== null || state.eliminated;
}

export function saveChampionship(state: ChampionshipState): boolean {
  return saveSlot(SLOT.championship, state);
}

export function loadChampionship(): ChampionshipState | null {
  const s = loadSlot<ChampionshipState>(SLOT.championship);
  if (!s || !Array.isArray(s.bracket) || s.bracket.length !== 7) return null;
  return s;
}
