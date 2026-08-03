import { beforeAll, describe, expect, it } from 'vitest';
import type { Team } from '../core/types';
import { buildLeague } from '../data/teams';
import {
  type DerbyEntrant,
  type DerbyState,
  OUTS_PER_TURN,
  TIEBREAK_OUTS,
  createDerby,
  derbyStandings,
  stepDerby,
} from '../modes/homerun';
import { emptyInputPair } from '../sim/input';

/**
 * The home run derby, driven by the same fixed-step loop the screen uses with every
 * entrant on CPU control. The published rules are: ten outs each, every swing
 * that is not a home run is an out, most home runs wins.
 */

const LEAGUE: Team[] = buildLeague();
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
const STADIUM = 'the-foundry';

/** The biggest bat on each of the first four clubs. */
function fieldOfFour() {
  return LEAGUE.slice(0, 4).map((team) => ({
    playerId: [...team.players].sort((a, b) => b.bat.power - a.bat.power)[0].id,
    teamId: team.id,
    controller: null,
  }));
}

function runDerby(seed: number): { state: DerbyState; ticks: number } {
  const state = createDerby({ stadiumId: STADIUM, entrants: fieldOfFour(), seed });
  const inputs = emptyInputPair();
  let ticks = 0;
  const maxTicks = 120 * 60 * 60; // one hour of simulated derby
  while (state.phase !== 'final' && ticks < maxTicks) {
    stepDerby(state, inputs, LEAGUE);
    ticks++;
  }
  return { state, ticks };
}

const derbies: { seed: number; state: DerbyState; ticks: number }[] = [];

beforeAll(() => {
  for (const seed of SEEDS) derbies.push({ seed, ...runDerby(seed) });
}, 300_000);

/** Derbies settled outright in the first round, with nobody tied at the top. */
const outright = () => derbies.filter((d) => !d.state.tiebreak);

describe('an all-CPU derby', () => {
  it('always reaches the final phase with a declared winner', () => {
    for (const { seed, state, ticks } of derbies) {
      expect({ seed, phase: state.phase }).toEqual({ seed, phase: 'final' });
      expect(state.winnerId).not.toBeNull();
      expect(state.entrants.some((e) => e.playerId === state.winnerId)).toBe(true);
      expect(ticks).toBeGreaterThan(0);
    }
  });

  it('retires every entrant before it declares anybody the champion', () => {
    for (const { seed, state } of derbies) {
      expect({ seed, unfinished: state.entrants.filter((e) => !e.done).length }).toEqual({
        seed,
        unfinished: 0,
      });
    }
  });

  it('is decided outright in the first round most of the time', () => {
    // The strict rules below only apply to a derby that needed no swing-off, so
    // the suite has to be sure it is actually exercising them.
    expect(outright().length).toBeGreaterThanOrEqual(8);
  });

  it('is reproducible from its seed', () => {
    const a = runDerby(3).state;
    const b = runDerby(3).state;
    expect(a.winnerId).toBe(b.winnerId);
    expect(a.entrants).toEqual(b.entrants);
    expect(a.events).toEqual(b.events);
  });
});

describe('the ten-out rule', () => {
  it('gives every entrant exactly ten outs when the derby needs no swing-off', () => {
    expect(OUTS_PER_TURN).toBe(10);
    expect(TIEBREAK_OUTS).toBeLessThan(OUTS_PER_TURN);
    for (const { seed, state } of outright()) {
      for (const e of state.entrants) {
        expect({ seed, hitter: e.playerId, outs: e.outs }).toEqual({
          seed,
          hitter: e.playerId,
          outs: OUTS_PER_TURN,
        });
      }
    }
  });

  it('logs one event for every swing, and every swing is a homer or an out', () => {
    for (const { seed, state } of outright()) {
      const swings = state.entrants.reduce((acc, e) => acc + e.homers + e.outs, 0);
      expect({ seed, events: state.events.length }).toEqual({ seed, events: swings });
      const homers = state.events.filter((e) => e.startsWith('HR')).length;
      expect(homers).toBe(state.entrants.reduce((acc, e) => acc + e.homers, 0));
    }
  });
});

describe('the champion', () => {
  it('is the entrant with the most home runs', () => {
    for (const { seed, state } of outright()) {
      const winner = state.entrants.find((e) => e.playerId === state.winnerId)!;
      const best = Math.max(...state.entrants.map((e) => e.homers));
      expect({ seed, homers: winner.homers }).toEqual({ seed, homers: best });
      // No swing-off happened, so the lead must have been outright.
      const leaders = state.entrants.filter((e) => e.homers === best);
      expect(leaders).toHaveLength(1);
      for (const other of state.entrants) {
        if (other === winner) continue;
        expect(other.homers).toBeLessThan(winner.homers);
      }
    }
  });

  it('tops the standings table', () => {
    for (const { seed, state } of outright()) {
      const table = derbyStandings(state);
      expect({ seed, top: table[0].playerId }).toEqual({ seed, top: state.winnerId });
      for (let i = 1; i < table.length; i++) {
        expect(table[i - 1].homers).toBeGreaterThanOrEqual(table[i].homers);
      }
      // Sorting must not disturb the entrant list itself.
      expect(table).toHaveLength(state.entrants.length);
      expect(new Set(table.map((e) => e.playerId)).size).toBe(state.entrants.length);
    }
  });
});

describe('recorded distances', () => {
  it('tracks a longest blast and a running total for anyone who went deep', () => {
    for (const { seed, state } of derbies) {
      for (const e of state.entrants as DerbyEntrant[]) {
        // `homers` is the current round's total and is reset by a swing-off,
        // so the distance records have to be checked against the contest total.
        if (e.contestHomers === 0) {
          expect({ seed, longest: e.longest }).toEqual({ seed, longest: 0 });
          continue;
        }
        expect(e.longest).toBeGreaterThan(0);
        expect(e.totalDistance).toBeGreaterThanOrEqual(e.longest);
        // Nothing in this game has ever been hit 250 m, and the shortest wall
        // in the park is 89 m, so every homer has to sit between them.
        expect(e.longest).toBeGreaterThan(80);
        expect(e.longest).toBeLessThan(250);
        expect(Number.isFinite(e.totalDistance)).toBe(true);
      }
    }
  });

  it('produces a believable number of home runs across a full field', () => {
    for (const { seed, state } of outright()) {
      const homers = state.entrants.reduce((acc, e) => acc + e.homers, 0);
      // Four of the league's biggest bats, ten outs each: a derby that produced
      // none at all, or one that never made an out, would both be broken.
      expect({ seed, tooFew: homers < 4, tooMany: homers > 200 }).toEqual({
        seed,
        tooFew: false,
        tooMany: false,
      });
    }
  });
});
