import { describe, expect, it } from 'vitest';
import { buildLeague, teamById } from '../data/teams';
import { createGameState } from '../sim/state';
import { stepGame } from '../sim/game';
import { validateState } from '../sim/autoplay';
import { clearEdges, emptyInputPair } from '../sim/input';
import type { GameSetup } from '../core/types';

/**
 * THE HANDS-OFF DEFENCE DEADLOCK
 * ------------------------------
 * A player reported a batted ball that simply stopped: the play hung for half a
 * minute and then the half-inning jumped.
 *
 * The cause was structural rather than random. The human on defence is always
 * attached to whichever fielder the coverage solver picked as the chaser. Every
 * other fielder is covering a base. So if the human does not steer — because
 * they are new, because they looked away, or because the camera did not show
 * them where the ball went — the one player who was going to run the ball down
 * stands still, and nothing on the field is pursuing it. The play then burns the
 * full 26-second guard before being force-resolved.
 *
 * These tests drive the real engine with a defence input frame that is
 * *present but never moves*, which is exactly that situation, and assert that
 * play still resolves promptly.
 */

const league = buildLeague();

interface Report {
  plays: number;
  longestPlay: number;
  forced: number;
  sawAutoFielding: boolean;
  anomalies: string[];
}

/**
 * Plays a game with the home side under human control, pitching every time it
 * is asked to and never once touching the fielding controls.
 */
function play(seed: number, handsOff: boolean, innings = 3): Report {
  const setup: GameSetup = {
    awayTeamId: 'coralkey',
    homeTeamId: 'ironport',
    stadiumId: 'anchor-yard',
    innings,
    difficulty: 'pro',
    awayControl: 'cpu',
    homeControl: handsOff ? 'human1' : 'cpu',
    night: false,
    seed,
  };
  const state = createGameState(
    setup,
    teamById(league, setup.awayTeamId),
    teamById(league, setup.homeTeamId),
  );
  const inputs = emptyInputPair();
  const report: Report = {
    plays: 0,
    longestPlay: 0,
    forced: 0,
    sawAutoFielding: false,
    anomalies: [],
  };

  const maxTicks = 120 * 60 * 25;
  for (let i = 0; i < maxTicks && !state.gameOver; i++) {
    // The only input this player ever gives is "throw pitch one". Movement,
    // swings, throws and dives are all left at zero for the entire game.
    inputs.p1.pitchSlot =
      handsOff && state.phase === 'preplay' && state.pitcher.ready <= 0 ? 0 : -1;
    stepGame(state, inputs);
    clearEdges(inputs.p1);
    clearEdges(inputs.p2);

    if (state.phase === 'inplay') {
      report.longestPlay = Math.max(report.longestPlay, state.play.clock);
      if (state.autoFielding) report.sawAutoFielding = true;
    }
    if (i % 30 === 0) {
      const bad = validateState(state);
      if (bad) report.anomalies.push(bad);
    }
  }
  report.plays = state.diag.plays;
  report.forced = state.diag.forcedResolutions;
  return report;
}

const SEEDS = [11, 8812, 4242, 99991];

describe('a human who never touches the fielding controls', () => {
  const reports = SEEDS.map((s) => play(s, true));
  // The same games with nobody at the controls at all, as the yardstick for
  // what "promptly" means on this engine.
  const cpu = SEEDS.map((s) => play(s, false));

  it('still gets balls put in play and fielded', () => {
    for (const r of reports) {
      expect(r.plays).toBeGreaterThan(4);
      expect(r.anomalies).toEqual([]);
    }
  });

  it('never needs the 26-second play guard to rescue it', () => {
    // This is the assertion that would have failed before auto-fielding: the
    // ball sat in the outfield until the guard fired.
    for (const r of reports) expect(r.forced).toBe(0);
  });

  it('resolves plays about as quickly as a fully CPU defence does', () => {
    // The honest comparison is not against an arbitrary number of seconds but
    // against the same engine playing itself: a passive human should cost the
    // defence roughly the two takeover delays (0.55 s to start chasing, 1.2 s
    // to start throwing) and nothing more.
    const worstHuman = Math.max(...reports.map((r) => r.longestPlay));
    const worstCpu = Math.max(...cpu.map((r) => r.longestPlay));
    expect(worstHuman).toBeGreaterThan(0);
    expect(worstHuman).toBeLessThan(worstCpu + 4);
  });

  it('leaves no play running long enough for the guard to be near firing', () => {
    // PLAY_TIME_LIMIT is 26 s. Nothing should come close.
    for (const r of reports) expect(r.longestPlay).toBeLessThan(18);
  });

  it('reports that the CPU took over, so the HUD can say so', () => {
    expect(reports.some((r) => r.sawAutoFielding)).toBe(true);
  });
});

describe('steering takes control straight back', () => {
  it('stops auto-fielding on the first frame of movement input, with no cooldown', () => {
    const setup: GameSetup = {
      awayTeamId: 'coralkey',
      homeTeamId: 'ironport',
      stadiumId: 'anchor-yard',
      innings: 3,
      difficulty: 'pro',
      awayControl: 'cpu',
      homeControl: 'human1',
      night: false,
      seed: 5150,
    };
    const state = createGameState(
      setup,
      teamById(league, setup.awayTeamId),
      teamById(league, setup.homeTeamId),
    );
    const inputs = emptyInputPair();

    let checked = false;
    for (let i = 0; i < 120 * 60 * 12 && !checked && !state.gameOver; i++) {
      inputs.p1.pitchSlot = state.phase === 'preplay' && state.pitcher.ready <= 0 ? 0 : -1;
      stepGame(state, inputs);
      clearEdges(inputs.p1);

      if (state.phase === 'inplay' && state.autoFielding) {
        // One frame of a held direction must hand control back immediately.
        inputs.p1.moveX = 1;
        inputs.p1.moveZ = 0;
        stepGame(state, inputs);
        expect(state.autoFielding).toBe(false);
        expect(state.defenseIdleT).toBe(0);

        // Letting go does not hand it back instantly either — there is a grace
        // period, so a momentary pause between pushes is not a takeover.
        inputs.p1.moveX = 0;
        stepGame(state, inputs);
        expect(state.autoFielding).toBe(false);
        expect(state.defenseIdleT).toBeGreaterThan(0);
        expect(state.defenseIdleT).toBeLessThan(0.55);
        checked = true;
      }
    }
    expect(checked).toBe(true);
  });
});

describe('the pitch gives the hitter a workable window', () => {
  it('takes longer to reach the plate than a regulation mound would allow', () => {
    const setup: GameSetup = {
      awayTeamId: 'rustforge',
      homeTeamId: 'bayoucity',
      stadiumId: 'grove-park',
      innings: 3,
      difficulty: 'pro',
      awayControl: 'cpu',
      homeControl: 'cpu',
      night: false,
      seed: 20260801,
    };
    const state = createGameState(
      setup,
      teamById(league, setup.awayTeamId),
      teamById(league, setup.homeTeamId),
    );
    const inputs = emptyInputPair();
    const flights: number[] = [];
    for (let i = 0; i < 120 * 60 * 6 && flights.length < 40; i++) {
      stepGame(state, inputs);
      if (state.phase === 'pitch' && state.currentPitch) flights.push(state.currentPitch.T);
    }
    expect(flights.length).toBeGreaterThan(10);
    const fastest = Math.min(...flights);
    const slowest = Math.max(...flights);
    // Even the hardest thrower in the league has to give the hitter more than
    // four tenths of a second, and the slowest stuff floats up near seven.
    expect(fastest).toBeGreaterThan(0.42);
    expect(slowest).toBeLessThan(0.75);
  });
});
