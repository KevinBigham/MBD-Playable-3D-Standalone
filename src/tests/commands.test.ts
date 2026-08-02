import { describe, expect, it } from 'vitest';
import type { GameSetup } from '../core/types';
import { buildLeague, teamById } from '../data/teams';
import { createGameState, type GameState } from '../sim/state';
import { stepGame } from '../sim/game';
import { clearEdges, emptyInputPair } from '../sim/input';
import { controlLabels } from '../ui/controls';

/**
 * WHAT THE PLAYER PRESSED, AND WHAT THE GAME DID
 * ----------------------------------------------
 * The prompt bar and the on-screen pad both promise the modifier plus a base
 * calls a steal. It did not: before the pitch the modifier is the key that says
 * "this is a baserunning command at all", and the command handler then read the
 * same flag a second time as "go back" — so the called steal was routed into
 * the branch that sends the runner to the bag he is already standing on, and a
 * human could not call a steal at any point in the game.
 *
 * Nothing caught it because the CPU calls its own steals through a different
 * path, so every simulated game looked fine.
 */

const league = buildLeague();

function situation(seed = 909): GameState {
  const setup: GameSetup = {
    awayTeamId: 'coralkey',
    homeTeamId: 'ironport',
    stadiumId: 'anchor-yard',
    innings: 9,
    difficulty: 'pro',
    awayControl: 'human1',
    homeControl: 'cpu',
    night: false,
    seed,
  };
  return createGameState(
    setup,
    teamById(league, setup.awayTeamId),
    teamById(league, setup.homeTeamId),
  );
}

/**
 * Puts a runner on first and parks the game in the pre-pitch phase, with the
 * human club batting.
 *
 * The human here controls the away club, so it has to throw its own pitches in
 * the bottom half or the game simply waits on the mound forever — the engine
 * never pitches for a human. Taking every pitch at the plate is what eventually
 * produces the walk.
 */
function runnerOnFirst(state: GameState): void {
  const inputs = emptyInputPair();
  for (let i = 0; i < 120 * 60 * 20; i++) {
    const humanFielding = state.half === 'bottom';
    inputs.p1.pitchSlot =
      humanFielding && state.phase === 'preplay' && state.pitcher.ready <= 0 ? 0 : -1;
    stepGame(state, inputs);
    clearEdges(inputs.p1);
    clearEdges(inputs.p2);
    if (state.half !== 'top' || state.phase !== 'preplay') continue;
    const onFirst = state.runners.some(
      (r) => !r.out && !r.scored && !r.isBatter && r.base === 1 && r.progress < 0.05,
    );
    if (onFirst) return;
  }
  throw new Error('never got a runner to first base');
}

describe('a human can call the plays the prompts advertise', () => {
  it('sends the runner on a steal when the modifier and a base are pressed', () => {
    const state = situation();
    runnerOnFirst(state);
    const runner = state.runners.find((r) => !r.isBatter && r.base === 1)!;
    expect(runner.stealing).toBe(false);

    const inputs = emptyInputPair();
    inputs.p1.modifier = true;
    inputs.p1.base = 2; // the diamond's UP is second base
    stepGame(state, inputs);

    expect(runner.stealing).toBe(true);
    // And he is actually going, rather than being told to stand on the bag he
    // is already on — which is exactly what the old branch did.
    expect(runner.cmdTarget).toBe(2);
  });

  it('still sends a runner back on a live ball', () => {
    // "Go back" is a live-ball decision and has to survive the fix. Contact is
    // not guaranteed on any one seed, so this walks a few until a ball is
    // genuinely in play with the runner still alive — and fails if none is,
    // rather than passing by quietly skipping itself.
    let tested = 0;
    for (const seed of [414, 515, 616, 717, 818]) {
      const state = situation(seed);
      runnerOnFirst(state);
      const runner = state.runners.find((r) => !r.isBatter && r.base === 1)!;

      const inputs = emptyInputPair();
      for (let i = 0; i < 120 * 40 && state.phase !== 'inplay'; i++) {
        inputs.p1.pitchSlot = -1;
        // Swing like a hitter who has already read it: cursor on the ball, bat
        // started so it arrives on time. Hacking blind almost never connects,
        // and this test is about the baserunning command, not the swing.
        if (state.phase === 'pitch' && state.currentPitch && state.batter.swingT < 0) {
          const p = state.currentPitch;
          state.batter.cx = p.plateX;
          state.batter.cy = p.plateY;
          inputs.p1.swing = state.ball.t >= p.T - 0.14;
        } else {
          inputs.p1.swing = false;
        }
        stepGame(state, inputs);
        clearEdges(inputs.p1);
        clearEdges(inputs.p2);
      }
      if (state.phase !== 'inplay' || runner.out || runner.scored) continue;

      inputs.p1.modifier = true;
      inputs.p1.base = 2; // "second base" — with the modifier, that means retreat
      stepGame(state, inputs);
      expect(runner.cmdTarget).toBe(1);
      tested++;
      break;
    }
    expect(tested).toBe(1);
  });
});

describe('the buttons say what they are about to do', () => {
  it('turns the diamond into the bases when the modifier is armed at the plate', () => {
    const state = situation();
    runnerOnFirst(state);
    const idle = controlLabels(state, false);
    const armed = controlLabels(state, true);

    expect(idle.diamondDown).toBe('SWING');
    expect(armed.verb).toBe('STEAL');
    expect(armed.diamondUp).toBe('2ND');
    expect(armed.diamondLeft).toBe('3RD');
    expect(armed.diamondRight).toBe('1ST');
    expect(armed.diamondDown).toBe('HOME');
  });

  it('does not offer a steal with nobody on', () => {
    const state = situation();
    // Opening pitch of the game: bases empty.
    expect(controlLabels(state, false).modifier).toBe('');
    // Arming it changes nothing, so a stray press cannot strand the pad in a
    // mode with no way out.
    expect(controlLabels(state, true).diamondDown).toBe('SWING');
  });

  it('names the pitcher’s actual repertoire on the pitching diamond', () => {
    const state = situation();
    // Bottom of an inning is not needed: fieldingSide is the home club here,
    // which the CPU has — so flip control to read the human-pitching labels.
    state.setup.homeControl = 'human1';
    state.setup.awayControl = 'cpu';
    const labels = controlLabels(state, false);
    expect(labels.situation).toBe('pitching');
    // Four slots, each a real pitch code rather than a slot number.
    const shown = [labels.diamondLeft, labels.diamondDown, labels.diamondRight, labels.diamondUp];
    expect(shown.filter(Boolean).length).toBeGreaterThanOrEqual(1);
    for (const s of shown.filter(Boolean)) expect(s).toMatch(/^[A-Z]{2,3}$/);
  });

  it('offers the manager’s card when the modifier is armed on the mound', () => {
    const state = situation();
    state.setup.homeControl = 'human1';
    state.setup.awayControl = 'cpu';
    const armed = controlLabels(state, true);
    expect(armed.verb).toBe('SET DEFENCE');
    // The reset has to be reachable: on a touch pad an unlabelled button is
    // disabled, so 'normal' would be unreachable without this.
    expect(armed.special).toBe('NORMAL');
  });
});
