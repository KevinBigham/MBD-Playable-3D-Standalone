import { describe, expect, it } from 'vitest';
import { buildLeague, teamById } from '../data/teams';
import { simulateGame } from '../sim/autoplay';
import { createDerby, stepDerby, derbyStandings, OUTS_PER_TURN } from '../modes/homerun';
import { emptyInputPair } from '../sim/input';
import type { GameSetup } from '../core/types';

/**
 * Regressions for four bookkeeping defects that survived the first playable
 * build. Each one produced a plausible-looking box score that was quietly
 * wrong, which is exactly the class of bug that erodes a season save.
 */

const league = buildLeague();

function play(seed: number, innings = 3, stadiumId = 'grove-park') {
  const away = league[seed % 10];
  const home = league[(seed * 3 + 1) % 10];
  const a = away.id === home.id ? league[(seed + 1) % 10] : away;
  const setup: GameSetup = {
    awayTeamId: a.id,
    homeTeamId: home.id,
    stadiumId,
    innings,
    difficulty: 'pro',
    awayControl: 'cpu',
    homeControl: 'cpu',
    night: false,
    seed,
  };
  return simulateGame(setup, teamById(league, a.id), teamById(league, home.id), {
    validate: false,
  });
}

describe('game result bookkeeping', () => {
  const reports = Array.from({ length: 120 }, (_, i) => play((978983025 + i * 7919) >>> 0));

  it('never snapshots the result before the winning play is fully credited', () => {
    // The original defect froze GameResult the instant a walk-off run touched
    // home, which lost the batter's own run, hit and RBI.
    for (const rep of reports) {
      const r = rep.result!;
      expect({
        away: r.awayRuns,
        home: r.homeRuns,
      }).toEqual({
        away: rep.state.stats.away.runs,
        home: rep.state.stats.home.runs,
      });
      expect(r.awayHits).toBe(rep.state.stats.away.hits);
      expect(r.homeHits).toBe(rep.state.stats.home.hits);
    }
  });

  it('produces at least one walk-off across the sample and records it correctly', () => {
    const walkoffs = reports.filter((rep) => rep.result!.walkOff);
    expect(walkoffs.length).toBeGreaterThan(0);
    for (const rep of walkoffs) {
      const r = rep.result!;
      expect(r.homeRuns).toBeGreaterThan(r.awayRuns);
      // A walk-off necessarily happens in the bottom half, so the home team's
      // final frame must contain the winning run.
      expect(r.lineScore.home[r.lineScore.home.length - 1]).toBeGreaterThan(0);
    }
  });

  it('charges every run to exactly one pitcher', () => {
    for (const rep of reports) {
      const r = rep.result!;
      const charged = Object.values(r.pitching).reduce((s, l) => s + l.r, 0);
      expect(charged).toBe(r.awayRuns + r.homeRuns);
    }
  });

  it('never credits more runs batted in than runs actually scored', () => {
    for (const rep of reports) {
      const r = rep.result!;
      const rbi = Object.values(r.batting).reduce((s, l) => s + l.rbi, 0);
      expect(rbi).toBeLessThanOrEqual(r.awayRuns + r.homeRuns);
    }
  });

  it('reconciles walks and hit-by-pitches between the two ledgers', () => {
    // A hit batter used to be booked as a walk the hitter never drew, and was
    // never charged to the pitcher at all, so the box score did not balance in
    // roughly half of all games.
    for (const rep of reports) {
      const r = rep.result!;
      const batBB = Object.values(r.batting).reduce((s, l) => s + l.bb, 0);
      const pitBB = Object.values(r.pitching).reduce((s, l) => s + l.bb, 0);
      const batHBP = Object.values(r.batting).reduce((s, l) => s + l.hbp, 0);
      const pitHBP = Object.values(r.pitching).reduce((s, l) => s + l.hbp, 0);
      expect(batBB).toBe(pitBB);
      expect(batHBP).toBe(pitHBP);
    }
  });

  it('keeps home runs consistent between batting and pitching lines', () => {
    for (const rep of reports) {
      const r = rep.result!;
      const batted = Object.values(r.batting).reduce((s, l) => s + l.hr, 0);
      const allowed = Object.values(r.pitching).reduce((s, l) => s + l.hr, 0);
      expect(batted).toBe(allowed);
    }
  });
});

describe('derby swing-off', () => {
  /** Runs a derby to completion and returns the final state. */
  function runDerby(seed: number) {
    const pool = league
      .flatMap((t) => t.players.filter((p) => p.primary !== 'P').map((p) => ({ p, t })))
      .sort((a, b) => b.p.bat.power - a.p.bat.power)
      .slice(0, 4);
    const state = createDerby({
      stadiumId: 'the-foundry',
      entrants: pool.map((x) => ({ playerId: x.p.id, teamId: x.t.id, controller: null })),
      seed,
    });
    const inputs = emptyInputPair();
    for (let i = 0; i < 120 * 60 * 30 && state.phase !== 'final'; i++) {
      stepDerby(state, inputs, league);
    }
    return state;
  }

  it('only ever crowns a hitter who took part in the deciding round', () => {
    // The original defect compared reset swing-off totals against the stale
    // first-round totals of eliminated hitters, handing the trophy to someone
    // who never swung in the tiebreak.
    let tiebreaks = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const state = runDerby(seed * 104729);
      expect(state.phase).toBe('final');
      expect(state.winnerId).toBeTruthy();
      const winner = state.entrants.find((e) => e.playerId === state.winnerId)!;
      expect(winner).toBeTruthy();
      if (state.tiebreak) {
        tiebreaks++;
        expect(state.contenders).toContain(state.winnerId);
        // Everyone still alive took their swing-off cuts.
        for (const id of state.contenders) {
          const e = state.entrants.find((x) => x.playerId === id)!;
          expect(e.outs).toBeGreaterThan(0);
        }
      } else {
        const best = Math.max(...state.entrants.map((e) => e.homers));
        expect(winner.homers).toBe(best);
        for (const e of state.entrants) expect(e.outs).toBe(OUTS_PER_TURN);
      }
      expect(derbyStandings(state)).toHaveLength(state.entrants.length);
    }
    // The sample must actually exercise the tiebreak path at least once,
    // otherwise this test proves nothing about it.
    expect(tiebreaks).toBeGreaterThan(0);
  });
});
