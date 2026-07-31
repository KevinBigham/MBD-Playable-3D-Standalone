import { beforeAll, describe, expect, it } from 'vitest';
import { TICK_DT } from '../core/constants';
import type { GameResult, GameSetup, Team } from '../core/types';
import { buildLeague } from '../data/teams';
import { validateState } from '../sim/autoplay';
import { stepGame } from '../sim/game';
import { emptyInputPair } from '../sim/input';
import { createGameState, type GameState } from '../sim/state';

/**
 * Rulebook tests. Everything here is driven through the same `stepGame` loop the
 * renderer calls, with empty inputs so both dugouts are on CPU control. Nothing
 * reaches inside the engine to force a situation; the assertions describe what
 * must be true of any legal baseball game, and the situations are found by
 * scanning seeds.
 */

const LEAGUE: Team[] = buildLeague();
const INNINGS = 3;
const SEEDS = Array.from({ length: 24 }, (_, i) => i);
/** Phases in which a half-inning is genuinely being played. */
const ACTIVE_PHASES = new Set<GameState['phase']>(['preplay', 'windup', 'pitch', 'inplay']);
const LINEUP_SIZE = 9;

interface PlayedGame {
  seed: number;
  state: GameState;
  result: GameResult;
  setup: GameSetup;
  /** Every `${inning}-${half}` that actually came to bat, in order. */
  activeHalves: string[];
  maxBalls: number;
  maxStrikes: number;
  maxOuts: number;
  battingOrderViolations: string[];
  invalidStates: string[];
  ticks: number;
}

function setupFor(seed: number): GameSetup {
  const away = LEAGUE[seed % LEAGUE.length];
  const home = LEAGUE[(seed + 3) % LEAGUE.length];
  return {
    awayTeamId: away.id,
    homeTeamId: home.id,
    stadiumId: home.homeStadium,
    innings: INNINGS,
    difficulty: 'pro',
    awayControl: 'cpu',
    homeControl: 'cpu',
    night: false,
    seed: (seed * 2654435761) >>> 0,
  };
}

/** Runs one full CPU-vs-CPU game, watching every tick for rule violations. */
function playGame(seed: number): PlayedGame {
  const setup = setupFor(seed);
  const away = LEAGUE[seed % LEAGUE.length];
  const home = LEAGUE[(seed + 3) % LEAGUE.length];
  const state = createGameState(setup, away, home);
  const inputs = emptyInputPair();

  const activeHalves: string[] = [];
  const battingOrderViolations: string[] = [];
  const invalidStates: string[] = [];
  let maxBalls = 0;
  let maxStrikes = 0;
  let maxOuts = 0;
  let lastAway = state.battingIdx.away;
  let lastHome = state.battingIdx.home;

  const maxTicks = Math.ceil((60 * 90) / TICK_DT);
  let ticks = 0;
  while (state.phase !== 'final' && ticks < maxTicks) {
    stepGame(state, inputs);
    ticks++;

    if (state.balls > maxBalls) maxBalls = state.balls;
    if (state.strikes > maxStrikes) maxStrikes = state.strikes;
    if (state.outs > maxOuts) maxOuts = state.outs;

    if (ACTIVE_PHASES.has(state.phase)) {
      const key = `${state.inning}-${state.half}`;
      if (activeHalves[activeHalves.length - 1] !== key) activeHalves.push(key);
    }

    for (const [side, previous] of [
      ['away', lastAway],
      ['home', lastHome],
    ] as const) {
      const now = state.battingIdx[side];
      if (now !== previous && now !== (previous + 1) % LINEUP_SIZE) {
        battingOrderViolations.push(`${side} jumped ${previous} -> ${now} at tick ${ticks}`);
      }
    }
    lastAway = state.battingIdx.away;
    lastHome = state.battingIdx.home;

    if (ticks % 5 === 0 && invalidStates.length < 5) {
      const issue = validateState(state);
      if (issue) invalidStates.push(`tick ${ticks}: ${issue}`);
    }
  }

  return {
    seed,
    state,
    result: state.result as GameResult,
    setup,
    activeHalves,
    maxBalls,
    maxStrikes,
    maxOuts,
    battingOrderViolations,
    invalidStates,
    ticks,
  };
}

const games: PlayedGame[] = [];

beforeAll(() => {
  for (const seed of SEEDS) games.push(playGame(seed));
}, 300_000);

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('the count', () => {
  it('never shows a fourth ball or a third strike', () => {
    // Four balls is a walk and three strikes is a strikeout; neither may ever be
    // visible on the board, because reaching them must end the plate appearance.
    const overflow = games.filter((g) => g.maxBalls > 3 || g.maxStrikes > 2).map((g) => g.seed);
    expect(overflow).toEqual([]);
    // The counters must actually be exercised, or the bound above proves nothing.
    expect(Math.max(...games.map((g) => g.maxBalls))).toBe(3);
    expect(Math.max(...games.map((g) => g.maxStrikes))).toBe(2);
  });

  it('never records a fourth out', () => {
    for (const g of games) expect(g.maxOuts).toBeLessThanOrEqual(3);
  });
});

describe('finishing a game', () => {
  it('always reaches the final phase and produces a result', () => {
    for (const g of games) {
      expect(g.state.phase).toBe('final');
      expect(g.state.gameOver).toBe(true);
      expect(g.result).not.toBeNull();
      expect(g.result.awayTeamId).toBe(g.setup.awayTeamId);
      expect(g.result.homeTeamId).toBe(g.setup.homeTeamId);
    }
  });

  it('never leaves the game tied', () => {
    for (const g of games) {
      expect(g.result.awayRuns).not.toBe(g.result.homeRuns);
      expect(g.result.awayRuns).toBeGreaterThanOrEqual(0);
      expect(g.result.homeRuns).toBeGreaterThanOrEqual(0);
    }
  });

  it('balances each line score against that team’s final run total', () => {
    for (const g of games) {
      expect(sum(g.result.lineScore.away)).toBe(g.result.awayRuns);
      expect(sum(g.result.lineScore.home)).toBe(g.result.homeRuns);
      expect(g.result.lineScore.away.length).toBeGreaterThanOrEqual(INNINGS);
      for (const n of [...g.result.lineScore.away, ...g.result.lineScore.home]) {
        expect(n).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('plays at least the scheduled number of innings', () => {
    for (const g of games) {
      expect(g.result.innings).toBeGreaterThanOrEqual(INNINGS);
      expect(g.activeHalves[0]).toBe('1-top');
    }
  });
});

describe('extra innings', () => {
  it('keeps playing when regulation ends level', () => {
    const extras = games.filter((g) => g.result.innings > INNINGS);
    // The scan has to actually find one; a suite that silently skips this test
    // would be worthless the day extra innings stop working.
    expect(extras.length).toBeGreaterThan(0);

    for (const g of extras) {
      const regAway = sum(g.result.lineScore.away.slice(0, INNINGS));
      const regHome = sum(g.result.lineScore.home.slice(0, INNINGS));
      // Extra innings may only happen out of a tie at the end of regulation.
      expect(regAway).toBe(regHome);
      // And the last frame must have broken that tie.
      expect(g.result.awayRuns).not.toBe(g.result.homeRuns);
      expect(g.activeHalves).toContain(`${INNINGS + 1}-top`);
      expect(g.state.inning).toBeGreaterThan(INNINGS);
    }
  });
});

describe('walk-offs', () => {
  it('ends the game the instant the home team goes ahead in the last frame', () => {
    const walkOffs = games.filter((g) => g.result.walkOff);
    expect(walkOffs.length).toBeGreaterThan(0);

    for (const g of walkOffs) {
      expect(g.result.homeRuns).toBeGreaterThan(g.result.awayRuns);
      expect(g.state.walkOff).toBe(true);
      expect(g.state.half).toBe('bottom');
      expect(g.state.inning).toBeGreaterThanOrEqual(INNINGS);
      // The last half-inning played was the bottom of the final frame.
      expect(g.activeHalves[g.activeHalves.length - 1]).toBe(`${g.state.inning}-bottom`);
      // The winning run scored in that frame, so it cannot have been empty.
      expect(g.result.lineScore.home[g.state.inning - 1]).toBeGreaterThan(0);
      // Nothing is played after the winning run crosses.
      expect(g.result.lineScore.away.length).toBe(g.result.lineScore.home.length);
    }
  });

  it('never flags a walk-off when the visitors win', () => {
    for (const g of games) {
      if (g.result.awayRuns > g.result.homeRuns) expect(g.result.walkOff).toBe(false);
    }
  });
});

describe('the bottom of the final inning', () => {
  it('is skipped when the home team is already ahead', () => {
    // A home win in regulation that is not a walk-off can only mean the home
    // team led after the top of the final inning, so it never came to bat.
    const skipped = games.filter(
      (g) =>
        g.result.homeRuns > g.result.awayRuns &&
        !g.result.walkOff &&
        g.result.innings === INNINGS,
    );
    expect(skipped.length).toBeGreaterThan(0);

    for (const g of skipped) {
      expect(g.activeHalves[g.activeHalves.length - 1]).toBe(`${INNINGS}-top`);
      expect(g.activeHalves).not.toContain(`${INNINGS}-bottom`);
      expect(g.result.lineScore.home[INNINGS - 1]).toBe(0);
    }
  });

  it('is played whenever the home team is behind or level', () => {
    for (const g of games) {
      const throughTop = {
        away: sum(g.result.lineScore.away.slice(0, INNINGS)),
        home: sum(g.result.lineScore.home.slice(0, INNINGS - 1)),
      };
      if (throughTop.home <= throughTop.away) {
        expect(g.activeHalves).toContain(`${INNINGS}-bottom`);
      }
    }
  });
});

describe('the batting order', () => {
  it('advances one hitter at a time and wraps back to the leadoff man', () => {
    for (const g of games) {
      expect({ seed: g.seed, violations: g.battingOrderViolations }).toEqual({
        seed: g.seed,
        violations: [],
      });
      expect(g.state.battingIdx.away).toBeGreaterThanOrEqual(0);
      expect(g.state.battingIdx.away).toBeLessThan(LINEUP_SIZE);
      expect(g.state.battingIdx.home).toBeLessThan(LINEUP_SIZE);
    }
  });

  it('gives every hitter in the order a plate appearance over a full game', () => {
    for (const g of games) {
      for (const side of ['away', 'home'] as const) {
        const team = side === 'away' ? g.state.away : g.state.home;
        const lineup = team.lineup;
        const pas = lineup.map((id) => g.state.stats[side].batting[id]?.pa ?? 0);
        const total = sum(pas);
        // The home team can be held to zero plate appearances only if it never
        // batted at all, which cannot happen in a completed game.
        expect(total).toBeGreaterThan(0);
        // Plate appearances must be spread across consecutive spots in the
        // order: the gap between the busiest and quietest hitter is at most one
        // trip through the lineup.
        expect(Math.max(...pas) - Math.min(...pas)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('state invariants', () => {
  it('validateState reports nothing at any sampled tick of any game', () => {
    for (const g of games) {
      expect({ seed: g.seed, issues: g.invalidStates }).toEqual({ seed: g.seed, issues: [] });
    }
  });

  it('never force-resolves a play or logs a diagnostic warning', () => {
    for (const g of games) {
      expect({ seed: g.seed, forced: g.state.diag.forcedResolutions }).toEqual({
        seed: g.seed,
        forced: 0,
      });
      expect(g.state.diag.warnings).toEqual([]);
    }
  });

  it('keeps the individual box score in step with the team totals', () => {
    for (const g of games) {
      for (const side of ['away', 'home'] as const) {
        const lines = Object.values(g.state.stats[side].batting);
        const runs = sum(lines.map((l) => l.r));
        const hits = sum(lines.map((l) => l.h));
        expect({ seed: g.seed, side, runs, hits }).toEqual({
          seed: g.seed,
          side,
          runs: g.state.stats[side].runs,
          hits: g.state.stats[side].hits,
        });
        for (const line of lines) {
          // A hitter cannot have more hits than at-bats, or more extra-base
          // hits than hits.
          expect(line.h).toBeLessThanOrEqual(line.ab);
          expect(line.doubles + line.triples + line.hr).toBeLessThanOrEqual(line.h);
          expect(line.ab).toBeLessThanOrEqual(line.pa);
          expect(line.so).toBeLessThanOrEqual(line.ab);
        }
      }
    }
  });
});
