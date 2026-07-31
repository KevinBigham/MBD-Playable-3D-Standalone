import type { GameResult } from '../core/types';
import type { GameState } from './state';

/** Snapshots a finished game into the record the season/tournament modes store. */
export function finishGame(state: GameState): GameResult {
  const away = state.stats.away;
  const home = state.stats.home;

  const awayRuns = away.runs;
  const homeRuns = home.runs;
  const homeWon = homeRuns > awayRuns;

  const winSide = homeWon ? 'home' : 'away';
  const loseSide = homeWon ? 'away' : 'home';

  // Winning pitcher: the arm of record with the most outs on the winning side.
  const winPitcher = bestPitcher(state, winSide);
  const losePitcher = bestPitcher(state, loseSide);
  if (winPitcher) state.stats[winSide].pitching[winPitcher].w++;
  if (losePitcher) state.stats[loseSide].pitching[losePitcher].l++;

  // Save: a different pitcher who finished a game the winners never trailed by
  // more than three at handover. Simplified but consistent.
  let savePitcher: string | undefined;
  const winArms = Object.entries(state.stats[winSide].pitching);
  if (winArms.length > 1 && Math.abs(awayRuns - homeRuns) <= 3) {
    const last = winArms[winArms.length - 1];
    if (last[0] !== winPitcher && last[1].outs > 0) {
      last[1].sv++;
      savePitcher = last[0];
    }
  }

  const padded = padLineScore(state);

  return {
    awayTeamId: state.away.id,
    homeTeamId: state.home.id,
    awayRuns,
    homeRuns,
    awayHits: away.hits,
    homeHits: home.hits,
    awayErrors: away.errors,
    homeErrors: home.errors,
    innings: Math.max(state.setup.innings, padded.away.length),
    lineScore: padded,
    batting: { ...away.batting, ...home.batting },
    pitching: { ...away.pitching, ...home.pitching },
    winningPitcherId: winPitcher ?? undefined,
    losingPitcherId: losePitcher ?? undefined,
    savePitcherId: savePitcher,
    walkOff: state.walkOff,
    contextId: state.setup.contextId,
  };
}

function bestPitcher(state: GameState, side: 'away' | 'home'): string | null {
  let best: string | null = null;
  let bestOuts = -1;
  for (const [id, line] of Object.entries(state.stats[side].pitching)) {
    if (line.outs > bestOuts) {
      bestOuts = line.outs;
      best = id;
    }
  }
  return best;
}

function padLineScore(state: GameState): { away: number[]; home: number[] } {
  const n = Math.max(state.lineScore.away.length, state.lineScore.home.length, state.setup.innings);
  const away = [...state.lineScore.away];
  const home = [...state.lineScore.home];
  while (away.length < n) away.push(0);
  while (home.length < n) home.push(0);
  // A half-inning slot is allocated before the game-over check runs, so an
  // empty trailing frame past regulation is bookkeeping, not extra innings.
  while (
    away.length > state.setup.innings &&
    away[away.length - 1] === 0 &&
    home[home.length - 1] === 0
  ) {
    away.pop();
    home.pop();
  }
  // The home team does not bat in the final frame when it is already ahead.
  return { away, home };
}
