import type { GameResult, GameSetup, Team } from '../core/types';
import { TICK_DT } from '../core/constants';
import { createGameState, type GameState } from './state';
import { stepGame } from './game';
import { emptyInputPair } from './input';
import { runnerAbs } from './runners';

export interface SimReport {
  state: GameState;
  result: GameResult | null;
  ticks: number;
  simSeconds: number;
  anomalies: string[];
  completed: boolean;
}

/**
 * Runs a full CPU-vs-CPU game with no rendering. This is the harness the
 * automated suite uses, and it exercises exactly the same engine the player
 * drives — there is no separate "quick sim" model.
 */
export function simulateGame(
  setup: GameSetup,
  away: Team,
  home: Team,
  opts: { maxSeconds?: number; validate?: boolean } = {},
): SimReport {
  const maxSeconds = opts.maxSeconds ?? 60 * 90;
  const validate = opts.validate ?? true;
  const state = createGameState({ ...setup, awayControl: 'cpu', homeControl: 'cpu' }, away, home);
  const inputs = emptyInputPair();
  const anomalies: string[] = [];

  const maxTicks = Math.ceil(maxSeconds / TICK_DT);
  let ticks = 0;
  while (state.phase !== 'final' && ticks < maxTicks) {
    stepGame(state, inputs);
    ticks++;
    if (validate && ticks % 30 === 0) {
      const issue = validateState(state);
      if (issue) {
        anomalies.push(`t=${(ticks * TICK_DT).toFixed(1)}s ${issue}`);
        if (anomalies.length > 20) break;
      }
    }
  }

  if (state.phase !== 'final') {
    anomalies.push(`Game did not finish within ${maxSeconds}s of simulated time`);
  }
  anomalies.push(...state.diag.warnings);

  return {
    state,
    result: state.result,
    ticks,
    simSeconds: ticks * TICK_DT,
    anomalies,
    completed: state.phase === 'final',
  };
}

/** Invariants that must hold at every moment of a legal game. */
export function validateState(state: GameState): string | null {
  if (state.outs < 0 || state.outs > 3) return `outs out of range: ${state.outs}`;
  if (state.balls < 0 || state.balls > 3) return `balls out of range: ${state.balls}`;
  if (state.strikes < 0 || state.strikes > 2) return `strikes out of range: ${state.strikes}`;
  if (state.stats.away.runs < 0 || state.stats.home.runs < 0) return 'negative runs';
  if (state.inning < 1 || state.inning > 40) return `inning out of range: ${state.inning}`;

  const live = state.runners.filter((r) => !r.out && !r.scored);
  if (live.length > 4) return `too many live runners: ${live.length}`;

  const batters = live.filter((r) => r.isBatter);
  if (batters.length > 1) return 'more than one batter-runner';

  const seenBases = new Set<number>();
  for (const r of live) {
    const abs = runnerAbs(r);
    if (!Number.isFinite(abs)) return 'runner position is not finite';
    if (abs < 0 || abs > 4) return `runner off the basepath: ${abs}`;
    if (r.progress <= 0.001) {
      if (seenBases.has(r.base) && r.base !== 0) return `two runners on base ${r.base}`;
      seenBases.add(r.base);
    }
  }

  // Runners must stay in order.
  const sorted = [...live].sort((a, b) => runnerAbs(a) - runnerAbs(b));
  for (let i = 1; i < sorted.length; i++) {
    if (runnerAbs(sorted[i]) < runnerAbs(sorted[i - 1]) - 1e-6) return 'runners out of order';
  }

  const ball = state.ball;
  if (!Number.isFinite(ball.x) || !Number.isFinite(ball.y) || !Number.isFinite(ball.z)) {
    return 'ball position is not finite';
  }
  if (Math.abs(ball.x) > 400 || Math.abs(ball.z) > 400 || ball.y > 200) {
    return `ball left the world: ${ball.x.toFixed(1)},${ball.y.toFixed(1)},${ball.z.toFixed(1)}`;
  }

  for (const f of state.fielders) {
    if (!Number.isFinite(f.x) || !Number.isFinite(f.z)) return 'fielder position is not finite';
    if (Math.abs(f.x) > 300 || Math.abs(f.z) > 300) return 'fielder left the world';
  }

  return null;
}

/** Aggregate box-score sanity used by the batch suite. */
export function summarize(report: SimReport): {
  runs: number;
  hits: number;
  innings: number;
  pitches: number;
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [...report.anomalies];
  const r = report.result;
  if (!r) {
    issues.push('no result produced');
    return { runs: 0, hits: 0, innings: 0, pitches: 0, valid: false, issues };
  }
  const lineAway = r.lineScore.away.reduce((a, b) => a + b, 0);
  const lineHome = r.lineScore.home.reduce((a, b) => a + b, 0);
  if (lineAway !== r.awayRuns) issues.push(`away line score ${lineAway} != ${r.awayRuns}`);
  if (lineHome !== r.homeRuns) issues.push(`home line score ${lineHome} != ${r.homeRuns}`);
  if (r.awayRuns === r.homeRuns) issues.push('game ended in a tie');
  if (r.awayRuns < 0 || r.homeRuns < 0) issues.push('negative final score');

  let pitches = 0;
  for (const line of Object.values(r.pitching)) pitches += line.pitches;

  return {
    runs: r.awayRuns + r.homeRuns,
    hits: r.awayHits + r.homeHits,
    innings: r.innings,
    pitches,
    valid: issues.length === 0,
    issues,
  };
}
