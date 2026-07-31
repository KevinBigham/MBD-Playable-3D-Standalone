import type { Player, Stadium, Team } from '../core/types';
import { Rng } from '../core/rng';
import { CONTACT_Z, TICK_DT, ZONE_CENTER_Y, clamp } from '../core/constants';
import { getStadium } from '../data/stadiums';
import { playerById } from '../data/teams';
import {
  type Ball,
  horizontalDist,
  isFair,
  launchFree,
  launchPitch,
  makeBall,
  sprayAngleDeg,
  stepFree,
  stepPitch,
} from '../sim/physics';
import { contactVelocity, pullDirection, resolveSwing, swingProfile } from '../sim/contact';
import type { InputFrame, InputPair } from '../sim/input';

/**
 * MOONSHOT DERBY — the home-run challenge.
 *
 * Rules (deliberately simple and stated on screen):
 *   - Each hitter gets ten outs.
 *   - Every swing that is not a home run is an out. Taking a pitch is free.
 *   - Ties are broken by sudden-death rounds of three outs, then by the single
 *     longest blast of the contest.
 */

export const OUTS_PER_TURN = 10;
export const TIEBREAK_OUTS = 3;

export type DerbyPhase = 'intro' | 'ready' | 'pitch' | 'flight' | 'result' | 'turnover' | 'final';

export interface DerbyEntrant {
  playerId: string;
  teamId: string;
  human: boolean;
  /** 'p1' | 'p2' | null */
  controller: 'p1' | 'p2' | null;
  /** Home runs in the CURRENT round; a swing-off resets this to zero. */
  homers: number;
  /** Home runs across the whole contest; never reset, used for records. */
  contestHomers: number;
  outs: number;
  /** Longest blast of the whole contest, which settles a dead-heat swing-off. */
  longest: number;
  totalDistance: number;
  done: boolean;
}

export interface DerbyState {
  stadium: Stadium;
  entrants: DerbyEntrant[];
  current: number;
  round: number;
  tiebreak: boolean;
  phase: DerbyPhase;
  phaseT: number;
  ball: Ball;
  cursorX: number;
  cursorY: number;
  swingT: number;
  swingKind: 'contact' | 'power';
  swingResolved: boolean;
  pitchT: number;
  lastResult: { hr: boolean; distance: number; note: string } | null;
  banner: string;
  bannerSub: string;
  bannerT: number;
  rng: Rng;
  winnerId: string | null;
  events: string[];
  /** Player ids still alive in the contest; a swing-off narrows this list. */
  contenders: string[];
}

export interface DerbySetup {
  stadiumId: string;
  entrants: { playerId: string; teamId: string; controller: 'p1' | 'p2' | null }[];
  seed: number;
}

export function createDerby(setup: DerbySetup): DerbyState {
  return {
    stadium: getStadium(setup.stadiumId),
    entrants: setup.entrants.map((e) => ({
      playerId: e.playerId,
      teamId: e.teamId,
      human: e.controller !== null,
      controller: e.controller,
      homers: 0,
      contestHomers: 0,
      outs: 0,
      longest: 0,
      totalDistance: 0,
      done: false,
    })),
    current: 0,
    round: 1,
    tiebreak: false,
    phase: 'intro',
    phaseT: 0,
    ball: makeBall(),
    cursorX: 0,
    cursorY: ZONE_CENTER_Y,
    swingT: -1,
    swingKind: 'contact',
    swingResolved: false,
    pitchT: 0,
    lastResult: null,
    banner: 'MOONSHOT DERBY',
    bannerSub: 'TEN OUTS EACH',
    bannerT: 2.4,
    rng: new Rng(setup.seed),
    winnerId: null,
    events: [],
    contenders: setup.entrants.map((e) => e.playerId),
  };
}

function outsAllowed(state: DerbyState): number {
  return state.tiebreak ? TIEBREAK_OUTS : OUTS_PER_TURN;
}

export function currentEntrant(state: DerbyState): DerbyEntrant {
  return state.entrants[state.current];
}

export function derbyBatter(state: DerbyState, teams: Team[]): Player {
  const e = currentEntrant(state);
  const team = teams.find((t) => t.id === e.teamId) ?? teams[0];
  return playerById(team, e.playerId);
}

function inputForEntrant(state: DerbyState, inputs: InputPair): InputFrame | null {
  const e = currentEntrant(state);
  if (!e.controller) return null;
  return inputs[e.controller];
}

/** Lobs a very hittable batting-practice pitch. */
function throwBP(state: DerbyState): void {
  const targetX = state.rng.range(-0.09, 0.09);
  const targetY = ZONE_CENTER_Y + state.rng.range(-0.09, 0.09);
  launchPitch(state.ball, {
    speed: 24 + state.rng.range(0, 2.5),
    targetX,
    targetY,
    breakX: 0,
    breakY: 0.04,
    lateness: 0.2,
    releaseX: -0.3,
  });
  state.pitchT = state.ball.pitch!.T;
  state.swingT = -1;
  state.swingResolved = false;
  state.phase = 'pitch';
  state.phaseT = 0;
}

export function stepDerby(state: DerbyState, inputs: InputPair, teams: Team[]): void {
  const dt = TICK_DT;
  state.phaseT += dt;
  if (state.bannerT > 0) state.bannerT = Math.max(0, state.bannerT - dt);

  const batter = derbyBatter(state, teams);
  const input = inputForEntrant(state, inputs);

  switch (state.phase) {
    case 'intro':
      if (state.phaseT > 2.2) {
        state.phase = 'ready';
        state.phaseT = 0;
      }
      break;

    case 'ready': {
      if (input) moveCursor(state, input, dt);
      const wait = input ? 0.7 : 0.5;
      if (state.phaseT > wait) throwBP(state);
      break;
    }

    case 'pitch': {
      stepPitch(state.ball, dt, 0, 0, 0);
      if (input) {
        if (state.swingT < 0) {
          moveCursor(state, input, dt);
          if (input.swing || input.power) {
            state.swingT = 0;
            state.swingKind = input.power ? 'power' : 'contact';
          }
        } else {
          state.swingT += dt;
        }
      } else if (state.swingT < 0) {
        cpuDerbySwing(state, batter);
      } else {
        state.swingT += dt;
      }

      if (state.swingT >= 0 && !state.swingResolved) {
        const profile = swingProfile(batter, state.swingKind, 'pro', input !== null);
        const pressT = state.ball.t - state.swingT;
        if (state.ball.t >= pressT + profile.latency) {
          resolveDerbySwing(state, batter, pressT + profile.latency - state.pitchT, input !== null);
          return;
        }
      }
      if (state.ball.t > state.pitchT + 0.2) {
        // Taken. Free pitch; line up another.
        state.phase = 'ready';
        state.phaseT = 0;
      }
      break;
    }

    case 'flight': {
      const res = stepFree(state.ball, dt, state.stadium, state.stadium.carry);
      const angle = sprayAngleDeg(state.ball.x, state.ball.z);
      if (res.homeRun && Math.abs(angle) <= 45) {
        finishSwing(state, true, horizontalDist(state.ball.x, state.ball.z));
        return;
      }
      if (res.landed || res.hitWall || state.ball.t > 9) {
        const d = horizontalDist(state.ball.x, state.ball.z);
        finishSwing(state, false, isFair(state.ball.x, state.ball.z) ? d : 0);
        return;
      }
      break;
    }

    case 'result':
      if (state.phaseT > (state.lastResult?.hr ? 1.5 : 0.9)) {
        const e = currentEntrant(state);
        if (e.outs >= outsAllowed(state)) {
          e.done = true;
          state.phase = 'turnover';
          state.phaseT = 0;
          state.banner = 'THAT IS THE TURN';
          state.bannerSub = `${e.homers} ${e.homers === 1 ? 'HOMER' : 'HOMERS'}`;
          state.bannerT = 2;
        } else {
          state.phase = 'ready';
          state.phaseT = 0;
        }
      }
      break;

    case 'turnover':
      if (state.phaseT > 2) advanceTurn(state);
      break;

    case 'final':
      break;
  }
}

function moveCursor(state: DerbyState, input: InputFrame, dt: number): void {
  state.cursorX = clamp(state.cursorX + input.moveX * 1.42 * dt, -0.52, 0.52);
  state.cursorY = clamp(state.cursorY + input.moveY * 1.42 * dt, 0.28, 1.46);
}

function cpuDerbySwing(state: DerbyState, batter: Player): void {
  const profile = swingProfile(batter, 'power', 'pro', false);
  const decisionAt = Math.max(0.05, state.pitchT - 0.22);
  if (state.ball.t < decisionAt) return;
  // The CPU aims a hair under the ball, which is how you elevate it.
  state.cursorX = state.ball.pitch!.px + state.rng.normal(0, 0.045);
  state.cursorY = state.ball.pitch!.py - 0.055 + state.rng.normal(0, 0.05);
  const pressAt = state.pitchT - profile.latency + state.rng.normal(0, 0.014);
  if (state.ball.t >= pressAt) {
    state.swingT = 0;
    state.swingKind = 'power';
  }
}

function resolveDerbySwing(
  state: DerbyState,
  batter: Player,
  timingError: number,
  human: boolean,
): void {
  state.swingResolved = true;
  const profile = swingProfile(batter, state.swingKind, 'pro', human);
  const p = state.ball.pitch!;
  const plateX = p.px + p.breakX;
  const plateY = p.py + p.breakY;

  const res = resolveSwing({
    batter,
    kind: state.swingKind,
    profile,
    cursorX: state.cursorX,
    cursorY: state.cursorY,
    plateX,
    plateY,
    pitchSpeed: p.speed,
    timingError,
    pullDir: pullDirection(batter.bats, 'R'),
    rng: state.rng,
  });

  if (res.grade === 'miss' || res.grade === 'foul' || res.grade === 'foultip') {
    finishSwing(state, false, 0, res.note || 'Swing and a miss');
    return;
  }

  const v = contactVelocity(res);
  launchFree(state.ball, plateX, plateY, CONTACT_Z, v.vx, v.vy, v.vz, 'batted', res.spin, res.sideSpin);
  state.phase = 'flight';
  state.phaseT = 0;
}

function finishSwing(state: DerbyState, hr: boolean, distance: number, note = ''): void {
  const e = currentEntrant(state);
  if (hr) {
    e.homers++;
    e.contestHomers++;
    e.longest = Math.max(e.longest, distance);
    e.totalDistance += distance;
    state.banner = distance * 3.28084 > 450 ? 'ABSOLUTE MOONSHOT' : 'GONE!';
    state.bannerSub = `${Math.round(distance * 3.28084)} FEET`;
    state.bannerT = 1.6;
  } else {
    e.outs++;
    state.banner = 'OUT';
    state.bannerSub = `${outsAllowed(state) - e.outs} LEFT`;
    state.bannerT = 1.0;
  }
  state.lastResult = { hr, distance, note };
  state.events.push(hr ? `HR ${Math.round(distance * 3.28084)} ft` : 'out');
  state.phase = 'result';
  state.phaseT = 0;
}

function advanceTurn(state: DerbyState): void {
  const next = state.entrants.findIndex((e) => !e.done);
  if (next >= 0) {
    state.current = next;
    state.phase = 'ready';
    state.phaseT = 0;
    resetForTurn(state);
    return;
  }

  // Everyone has hit. Decide, or start a tiebreak round.
  //
  // Only entrants still in the contest are compared. After a swing-off the
  // eliminated hitters keep their stale first-round totals, so including them
  // here would hand the trophy to somebody who never took a tiebreak cut.
  const alive = state.entrants.filter((e) => state.contenders.includes(e.playerId));
  const pool = alive.length ? alive : state.entrants;
  const best = Math.max(...pool.map((e) => e.homers));
  const leaders = pool.filter((e) => e.homers === best);
  if (leaders.length === 1) {
    state.winnerId = leaders[0].playerId;
    state.phase = 'final';
    state.phaseT = 0;
    state.banner = 'DERBY CHAMPION';
    state.bannerT = 5;
    return;
  }

  if (state.round >= 4) {
    // Longest blast settles it rather than swinging forever.
    let winner = leaders[0];
    for (const l of leaders) if (l.longest > winner.longest) winner = l;
    state.winnerId = winner.playerId;
    state.phase = 'final';
    state.banner = 'DERBY CHAMPION';
    state.bannerSub = 'DECIDED ON DISTANCE';
    state.bannerT = 5;
    return;
  }

  state.round++;
  state.tiebreak = true;
  state.contenders = leaders.map((e) => e.playerId);
  for (const e of state.entrants) {
    e.done = !leaders.includes(e);
    if (!e.done) {
      e.outs = 0;
      e.homers = 0;
    }
  }
  state.current = state.entrants.findIndex((e) => !e.done);
  state.banner = 'SWING-OFF';
  state.bannerSub = 'THREE OUTS EACH';
  state.bannerT = 2.4;
  state.phase = 'ready';
  state.phaseT = 0;
  resetForTurn(state);
}

function resetForTurn(state: DerbyState): void {
  state.cursorX = 0;
  state.cursorY = ZONE_CENTER_Y;
  state.swingT = -1;
  state.swingResolved = false;
  state.lastResult = null;
  state.ball.mode = 'held';
}

export function derbyStandings(state: DerbyState): DerbyEntrant[] {
  return [...state.entrants].sort(
    (a, b) => b.homers - a.homers || b.longest - a.longest || b.totalDistance - a.totalDistance,
  );
}
