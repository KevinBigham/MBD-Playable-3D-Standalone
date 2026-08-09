import {
  BASE_PATH,
  CONTACT_Z,
  DEFAULT_PITCH_TEMPO,
  MOUND_Z,
  PITCH_TEMPO,
  TICK_DT,
  ZONE_CENTER_Y,
  attr01,
  clamp,
  clamp01,
  dist,
} from '../core/constants';
import { FIELD_SLOTS, type PitchType, type Player } from '../core/types';
import { PITCHES, pitchBreak } from '../data/pitches';
import { playerById } from '../data/teams';
import {
  BALL_RADIUS,
  canBeFlyOut,
  horizontalDist,
  isFair,
  launchFree,
  launchPitch,
  predictLanding,
  sprayAngleDeg,
  stepFree,
  stepPitch,
} from './physics';
import {
  CATCHER_SLOT,
  PITCHER_SLOT,
  assignCoverage,
  backupTarget,
  basePoint,
  catchReach,
  driveFielder,
  fieldingSuccess,
  makeFielder,
  maxThrowRange,
  moveFielder,
  reachHeight,
  resetAlignment,
  restand,
  startDive,
  throwBall,
  throwError,
} from './fielders';
import {
  ON_BAG_PROGRESS,
  baseName,
  enforceRunnerOrder,
  settleRunnersToBases,
  canTag,
  computeForces,
  decideRunnerTargets,
  distanceToBase,
  isOnBase,
  makeRunner,
  occupiedBases,
  runnerAbs,
  stepRunner,
  timeToBase,
} from './runners';
import {
  batterBoxX,
  contactVelocity,
  inStrikeZone,
  pullDirection,
  resolveSwing,
  swingProfile,
  zoneBounds,
} from './contact';
import {
  DIFFICULTY,
  type DefenseSituation,
  chooseAlignment,
  choosePitchAround,
  familiarityOf,
  planPitch,
  readPitch,
  shouldPullPitcher,
} from './ai';
import { findIntercept, projectBall } from './trajectory';
import type { InputFrame, InputPair } from './input';
import { emptyInput } from './input';
import {
  ALIGNMENT_SHORT,
  type DefensiveAlignment,
  type GameState,
  type PitchLogResult,
  type PlayContext,
  type RunnerState,
  type Side,
  battingLine,
  battingSide,
  currentBatter,
  fieldingSide,
  lookupPlayer,
  makePlayContext,
  pitchingLine,
  pushEvent,
  setBanner,
  teamOf,
} from './state';
import { finishGame } from './result';

const CURSOR_SPEED = 1.42;
const AIM_SPEED = 1.15;
const CURSOR_X_LIMIT = 0.52;
const CURSOR_Y_MIN = 0.28;
const CURSOR_Y_MAX = 1.46;

/** Max seconds a single play may stay live before it is force-resolved. */
const PLAY_TIME_LIMIT = 26;

/**
 * The most a swing may be backdated by InputFrame.pressAge. Two rendered frames
 * at 30 Hz — generous for the delay this is meant to remove, and far too small
 * to be worth gaming even if a front end tried to.
 */
const MAX_PRESS_AGE = 1 / 15;

/** The normal post-plate hold, retained for CPU hitters and unassisted play. */
const BASE_LATE_SWING_GRACE = 0.16;

/**
 * Latest useful human button press after plate arrival.
 *
 * A three-times-wider timing profile is not real if the taken-pitch rule ends
 * the pitch at the old 160 ms boundary. Keep the pitch live until even the
 * slowest available swing would fall beyond the contact model's outer edge.
 */
function lateSwingGrace(
  batter: Player,
  difficulty: GameState['difficulty'],
  human: boolean,
): number {
  if (!human) return BASE_LATE_SWING_GRACE;
  let latest = BASE_LATE_SWING_GRACE;
  for (const kind of ['contact', 'power', 'bunt'] as const) {
    const profile = swingProfile(batter, kind, difficulty, true);
    latest = Math.max(latest, profile.window * 1.27 - profile.latency + TICK_DT);
  }
  return latest;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Advances the simulation by one fixed step. Never call with a variable dt —
 * the render loop accumulates real time and calls this at TICK_DT.
 */
export function stepGame(state: GameState, inputs: InputPair): void {
  const dt = TICK_DT;
  state.clock += dt;
  state.phaseT += dt;
  if (state.banner.t > 0) state.banner.t = Math.max(0, state.banner.t - dt);
  if (state.lastSwing && state.lastSwing.t > 0) {
    state.lastSwing.t = Math.max(0, state.lastSwing.t - dt);
  }
  // Pitch resolution and presentation are separate clocks. A miss or foul can
  // end the pitch immediately without making the athlete stop mid-swing.
  if (state.batter.animT >= 0) state.batter.animT += dt;

  switch (state.phase) {
    case 'lineup':
      if (state.phaseT > 2.6) startHalfInning(state);
      break;
    case 'preplay':
      updatePrePlay(state, dt, inputs);
      break;
    case 'windup':
      updateWindup(state, dt, inputs);
      break;
    case 'pitch':
      updatePitchFlight(state, dt, inputs);
      break;
    case 'inplay':
      updateInPlay(state, dt, inputs);
      break;
    case 'deadball':
      updateDeadBall(state, dt);
      break;
    case 'inningbreak':
      if (state.phaseT > 1.9) startHalfInning(state);
      break;
    case 'final':
      break;
  }

  for (const f of state.fielders) {
    if (f.errorFlash > 0) f.errorFlash = Math.max(0, f.errorFlash - dt);
  }
}

function setPhase(state: GameState, phase: GameState['phase']): void {
  state.phase = phase;
  state.phaseT = 0;
}

// ---------------------------------------------------------------------------
// Control routing
// ---------------------------------------------------------------------------

export function controllerFor(state: GameState, side: Side): 'p1' | 'p2' | null {
  const mode = side === 'away' ? state.setup.awayControl : state.setup.homeControl;
  if (mode === 'human1') return 'p1';
  if (mode === 'human2') return 'p2';
  return null;
}

function inputFor(state: GameState, side: Side, inputs: InputPair): InputFrame | null {
  const c = controllerFor(state, side);
  if (!c) return null;
  return inputs[c];
}

export function humanIsBatting(state: GameState): boolean {
  return controllerFor(state, battingSide(state)) !== null;
}

export function humanIsPitching(state: GameState): boolean {
  return controllerFor(state, fieldingSide(state)) !== null;
}

// ---------------------------------------------------------------------------
// Half innings and at-bats
// ---------------------------------------------------------------------------

/** Extra innings from this one onward start with a runner already on second. */
export const TIEBREAK_EXTRA_INNING = 2;

export function startHalfInning(state: GameState): void {
  state.outs = 0;
  state.runners = [];
  const bs = battingSide(state);
  while (state.lineScore[bs].length < state.inning) state.lineScore[bs].push(0);

  installDefense(state);

  // Tiebreaker: once a game has gone two innings past regulation, each half
  // starts with the previous hitter in the order standing on second base.
  // Without it a passive or overmatched player can produce an unbounded game;
  // with it, extra innings resolve in a handful of frames.
  const extras = state.inning - state.setup.innings;
  if (!state.setup.practice && extras >= TIEBREAK_EXTRA_INNING) {
    const team = teamOf(state, bs);
    const idx = state.battingIdx[bs];
    const prior = team.lineup[(idx - 1 + team.lineup.length) % team.lineup.length];
    const runner = makeRunner(playerById(team, prior), 2, false);
    state.runners.push(runner);
    setBanner(state, 'EXTRAS', 'RUNNER STARTS ON SECOND', 'inning', 2.2);
  }

  startAtBat(state);
  const half = state.half === 'top' ? 'TOP' : 'BOTTOM';
  setBanner(state, `${half} ${ordinal(state.inning)}`, teamOf(state, bs).city.toUpperCase(), 'inning', 2.1);
  pushEvent(state, { kind: 'inning', text: `${half} ${ordinal(state.inning)}` });
}

function installDefense(state: GameState): void {
  const side = fieldingSide(state);
  const team = teamOf(state, side);
  const ids = state.defense[side];
  state.fielders = ids.map((id, slot) => makeFielder(playerById(team, id), slot));

  const pitcherId = ids[PITCHER_SLOT];
  if (state.pitcher.playerId !== pitcherId || state.pitcher.side !== side) {
    const p = playerById(team, pitcherId);
    state.pitcher = {
      playerId: pitcherId,
      side,
      stamina: 1,
      pitchCount: 0,
      usage: {},
      recent: [],
      outsRecorded: 0,
      runsAllowed: 0,
      earnedRuns: 0,
      aimX: 0,
      aimY: ZONE_CENTER_Y,
      selected: 0,
      ready: 0,
    };
    void p;
  }
}

/** Sets up the next batter, resets the count and puts everyone back in place. */
export function startAtBat(state: GameState): void {
  const bs = battingSide(state);
  const batter = currentBatter(state);
  state.balls = 0;
  state.strikes = 0;
  state.currentPitch = null;
  // The pitch tracker is per plate appearance: it should show this hitter's
  // at-bat, not a rolling window across two of them.
  state.pitchLog = [];
  state.lastSwing = null;

  const pitcher = lookupPlayer(state, state.pitcher.playerId);
  state.batter = {
    playerId: batter.id,
    cx: 0,
    cy: ZONE_CENTER_Y * (batter.body === 'tall' ? 1.06 : 1),
    swingT: -1,
    swingKind: 'none',
    swingResolved: false,
    bunting: false,
    animT: -1,
    checked: false,
  };

  // Every plate appearance is a fresh situation, so the manager gets to call
  // the defence again. A human who set the alignment by hand keeps it only
  // until the situation changes underneath them.
  state.alignmentLocked = false;
  state.pitchAround = 'none';
  state.alignment = decideDefense(state);

  // Defensive alignment shifts a little toward the hitter's pull side.
  const pull = pullDirection(batter.bats, pitcher.throws);
  const pullStrength = (attr01(batter.bat.power) - 0.45) * 1.2;
  state.pullShift = pull * clamp(pullStrength, -0.4, 0.9);
  resetAlignment(state.fielders, state.pullShift, state.alignment);

  // Runners reset to their bases with a lead.
  for (const r of state.runners) {
    if (r.out || r.scored) continue;
    r.progress = Math.min(r.progress, 0.055);
    r.target = r.base;
    r.cmdTarget = null;
    r.mustTag = false;
    r.tagBase = r.base;
    r.stealing = false;
    r.justScored = false;
  }
  state.runners = state.runners.filter((r) => !r.out && !r.scored);

  if (state.setup.practice === 'baserunning' && state.runners.length === 0) {
    seedPracticeRunners(state);
  }

  state.play = makePlayContext(batter.id, bs);
  const ball = state.ball;
  ball.mode = 'held';
  ball.x = 0;
  ball.y = 1.7;
  ball.z = MOUND_Z;
  ball.vx = ball.vy = ball.vz = 0;
  ball.pitch = undefined;
  ball.rolling = false;

  state.pitcher.aimX = 0;
  state.pitcher.aimY = ZONE_CENTER_Y;
  state.pitcher.ready = humanIsPitching(state) ? 0.35 : 0.8 + state.rng.range(0, 0.5);
  setPhase(state, 'preplay');

  maybeChangePitcher(state);
}

/**
 * Situation the defensive manager reads. Built here rather than in ai.ts so
 * the AI module stays free of GameState and testable on its own.
 */
function defenseSituation(state: GameState): DefenseSituation {
  const fs = fieldingSide(state);
  const bs = battingSide(state);
  return {
    occupied: occupiedBases(state.runners),
    outs: state.outs,
    inning: state.inning,
    totalInnings: state.setup.innings,
    runDiff: state.stats[fs].runs - state.stats[bs].runs,
    batter: currentBatter(state),
  };
}

/** Alignment for the current situation, respecting a human's manual choice. */
function decideDefense(state: GameState): DefensiveAlignment {
  if (state.alignmentLocked) return state.alignment;
  if (humanIsPitching(state)) return 'normal';
  return chooseAlignment(defenseSituation(state));
}

/** The hitter on deck, used for intentional-walk decisions. */
function onDeckBatter(state: GameState): Player {
  const bs = battingSide(state);
  const team = teamOf(state, bs);
  const idx = (state.battingIdx[bs] + 1) % team.lineup.length;
  return playerById(team, team.lineup[idx]);
}

/** Puts runners on for the baserunning drill so there is something to command. */
function seedPracticeRunners(state: GameState): void {
  const bs = battingSide(state);
  const team = teamOf(state, bs);
  const idx = state.battingIdx[bs];
  for (const base of [1, 2]) {
    const id = team.lineup[(idx + base + 3) % team.lineup.length];
    state.runners.push(makeRunner(playerById(team, id), base, false));
  }
}

function ordinal(n: number): string {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

// ---------------------------------------------------------------------------
// Pre-play: aiming, pitch selection, steals
// ---------------------------------------------------------------------------

function updatePrePlay(state: GameState, dt: number, inputs: InputPair): void {
  const pitchInput = inputFor(state, fieldingSide(state), inputs);
  const batInput = inputFor(state, battingSide(state), inputs);
  const pr = state.pitcher;
  pr.ready = Math.max(0, pr.ready - dt);

  const batter = currentBatter(state);
  const zone = zoneBounds(batter);

  // Batter cursor is live before the pitch so the hitter can set up.
  if (batInput) {
    aimCursor(state, batInput, dt);
    if (batInput.bunt) state.batter.bunting = !state.batter.bunting;
    // Before the pitch the diamond is the swing selector, so a steal has to be
    // asked for explicitly (hold the modifier). This is what stops a hitter
    // from accidentally sending a runner every time he picks a swing.
    if (batInput.modifier) handleRunnerCommands(state, batInput, true);
  } else {
    cpuPreplayOffense(state, dt);
  }

  if (pitchInput) {
    // Holding the modifier turns the diamond into the defensive card. Holding
    // it is also what makes the card appear on screen, so the mapping never has
    // to be memorised.
    if (pitchInput.modifier) {
      if (pitchInput.base >= 0) setAlignment(state, ALIGN_BY_BASE[pitchInput.base], true);
      // `advanceAll` is suppressed while the modifier is down, so the reset
      // rides on `dive`, which is the raw special button.
      if (pitchInput.dive) setAlignment(state, 'normal', true);
    } else {
      // Pointing beats steering here for the same reason it does at the plate,
      // and the order matters: the target is set before the pitch is read, so a
      // front end that says "this pitch, to that spot" in one act gets the spot
      // it asked for rather than the one left over from the last hitter.
      if (pitchInput.aimAbsolute) {
        pr.aimX = clamp(pitchInput.aimX, -CURSOR_X_LIMIT, CURSOR_X_LIMIT);
        pr.aimY = clamp(pitchInput.aimY, CURSOR_Y_MIN, CURSOR_Y_MAX);
      } else {
        pr.aimX = clamp(pr.aimX + pitchInput.moveX * AIM_SPEED * dt, -CURSOR_X_LIMIT, CURSOR_X_LIMIT);
        pr.aimY = clamp(pr.aimY + pitchInput.moveY * AIM_SPEED * dt, CURSOR_Y_MIN, CURSOR_Y_MAX);
      }
      if (pitchInput.pitchSlot >= 0) {
        if (pr.ready > 0) {
          pushEvent(state, { kind: 'denied', text: 'Not set yet' });
        } else {
          const rep = repertoireOf(state);
          const idx = clamp(pitchInput.pitchSlot, 0, rep.length - 1);
          pr.selected = idx;
          beginWindup(state, rep[idx], pr.aimX, pr.aimY);
        }
      }
    }
    // Switch-fielder doubles as the "put him on" button while you are pitching.
    if (pitchInput.switchFielder) cyclePitchAround(state);
  } else if (pr.ready <= 0) {
    const rep = repertoireOf(state);
    const pitcher = lookupPlayer(state, pr.playerId);
    const d = DIFFICULTY[state.difficulty];
    const plan = planPitch(
      pitcher,
      pr,
      batter,
      state.balls,
      state.strikes,
      state.outs,
      state.runners.length > 0,
      d,
      state.rng,
      state.pitchAround,
    );
    pr.selected = clamp(plan.index, 0, rep.length - 1);
    // CURSOR_X_LIMIT is more than twice the half-width of any strike zone, so
    // an intentional ball aimed at the clamp is still unmistakably a ball.
    pr.aimX = clamp(plan.aimX, -CURSOR_X_LIMIT, CURSOR_X_LIMIT);
    pr.aimY = clamp(plan.aimY, CURSOR_Y_MIN, CURSOR_Y_MAX);
    beginWindup(state, rep[pr.selected], pr.aimX, pr.aimY);
  }

  void zone;
  idleFielders(state, dt);
  stepRunnersPreplay(state, dt);
}

/** The diamond, read as the defensive card. Order is home, first, second, third. */
const ALIGN_BY_BASE: ReadonlyArray<DefensiveAlignment> = ['nodoubles', 'corners', 'dp', 'in'];

/** Applies an alignment and walks the fielders to it. */
function setAlignment(state: GameState, next: DefensiveAlignment, byHuman: boolean): void {
  if (byHuman) state.alignmentLocked = true;
  if (state.alignment === next) return;
  state.alignment = next;
  restand(state.fielders, state.pullShift, next);
  if (byHuman) {
    pushEvent(state, { kind: 'defense', text: ALIGNMENT_SHORT[next] });
  }
}

/** Human toggle: pitch him carefully, then put him on, then never mind. */
function cyclePitchAround(state: GameState): void {
  const order = ['none', 'around', 'intentional'] as const;
  const next = order[(order.indexOf(state.pitchAround) + 1) % order.length];
  state.pitchAround = next;
  pushEvent(state, {
    kind: 'defense',
    text: next === 'none' ? 'PITCH TO HIM' : next === 'around' ? 'PITCH AROUND' : 'PUT HIM ON',
  });
}

/**
 * Re-reads the situation between pitches. The manager may move the defence
 * mid-count — a runner who steals second changes what the infield should be
 * doing, and a defence that only ever set up once would look asleep.
 */
function reconsiderDefense(state: GameState): void {
  if (state.alignmentLocked) return;
  if (humanIsPitching(state)) return;
  const sit = defenseSituation(state);
  setAlignment(state, chooseAlignment(sit), false);
  const occ = sit.occupied;
  state.pitchAround = choosePitchAround(sit, onDeckBatter(state), !occ[1]);
}

function repertoireOf(state: GameState): PitchType[] {
  const p = lookupPlayer(state, state.pitcher.playerId);
  return (p.repertoire && p.repertoire.length ? p.repertoire : ['fastball']) as PitchType[];
}

/**
 * Where the hitter is trying to make contact.
 *
 * Two ways to say it, and they are genuinely different statements. A stick says
 * "further left", integrated for as long as it is held. A finger says "here".
 * The second one cannot be expressed by the first at any speed, which is why
 * `aimAbsolute` exists rather than the touch layer faking a very fast stick.
 *
 * Both end at the same clamp, so pointing cannot reach anywhere steering could
 * not.
 */
function aimCursor(state: GameState, input: InputFrame, dt: number): void {
  const b = state.batter;
  if (input.aimAbsolute) {
    b.cx = clamp(input.aimX, -CURSOR_X_LIMIT, CURSOR_X_LIMIT);
    b.cy = clamp(input.aimY, CURSOR_Y_MIN, CURSOR_Y_MAX);
    return;
  }
  moveCursor(state, input, dt);
}

function moveCursor(state: GameState, input: InputFrame, dt: number): void {
  const b = state.batter;
  b.cx = clamp(b.cx + input.moveX * CURSOR_SPEED * dt, -CURSOR_X_LIMIT, CURSOR_X_LIMIT);
  b.cy = clamp(b.cy + input.moveY * CURSOR_SPEED * dt, CURSOR_Y_MIN, CURSOR_Y_MAX);
}

function idleFielders(state: GameState, dt: number): void {
  for (const f of state.fielders) {
    if (f.slot === PITCHER_SLOT) {
      moveFielder(f, dt, 0, MOUND_Z);
    } else if (f.slot === CATCHER_SLOT) {
      moveFielder(f, dt, -0.42, -2.45);
    } else {
      moveFielder(f, dt, f.homeX, f.homeZ);
    }
  }
}

function stepRunnersPreplay(state: GameState, dt: number): void {
  for (const r of state.runners) {
    if (r.out || r.scored) continue;
    if (r.stealing) {
      r.target = clamp(r.base + 1, 0, 4);
    } else if (r.cmdTarget !== null && r.cmdTarget > r.base) {
      r.stealing = true;
      r.target = clamp(r.cmdTarget, 0, 4);
      state.diag.texture.stealAttempts++;
      pushEvent(state, { kind: 'steal', text: `${lookupPlayer(state, r.playerId).lastName} goes!` });
    } else {
      r.target = r.base + 0.055;
    }
    stepRunner(r, dt);
  }
}

/**
 * Whether the CPU sends a runner on this pitch.
 *
 * This used to roll the dice on every simulation tick, which at 120 Hz meant a
 * fast runner attempted a steal on essentially every pitch — eight and a half
 * attempts a game. It is now decided once per pitch, at a rate that reads like
 * baseball, and the decision accounts for the situation the way a third-base
 * coach would: don't run when you are already in scoring position for nothing,
 * don't run down big, and run more when the run actually matters.
 */
function cpuPreplayOffense(state: GameState, dt: number): void {
  void dt;
  // One decision per pitch, taken the instant the defence is set.
  if (state.phaseT < 0.25 || state.phaseT - dt >= 0.25) return;

  const d = DIFFICULTY[state.difficulty];
  const bs = battingSide(state);
  const fs = fieldingSide(state);
  const deficit = state.stats[fs].runs - state.stats[bs].runs;

  for (const r of state.runners) {
    if (r.out || r.scored || r.stealing || r.base >= 3) continue;
    if (r.leadHold > 0) continue;
    const occupiedAhead = state.runners.some(
      (o) => o !== r && !o.out && !o.scored && o.base === r.base + 1,
    );
    if (occupiedAhead) continue;
    const runner = lookupPlayer(state, r.playerId);
    const speed = attr01(runner.bat.speed);
    if (speed < 0.52) continue;

    // Base rate per pitch. Second is worth taking; third is a bigger gamble and
    // is only worth it with fewer than two outs, when a single would score him.
    let chance = d.stealDrive * (speed - 0.45) * 0.72;
    if (r.base === 2) chance *= state.outs < 2 ? 0.4 : 0.12;
    // Down by a lot, station-to-station; up by a lot, no need to force it.
    if (Math.abs(deficit) >= 5) chance *= 0.3;
    if (state.strikes === 2) chance *= 0.7;

    if (state.rng.chance(clamp01(chance))) {
      r.cmdTarget = r.base + 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Delivering a pitch
// ---------------------------------------------------------------------------

function beginWindup(state: GameState, type: PitchType, aimX: number, aimY: number): void {
  state.diag.texture.alignment[state.alignment]++;
  const pr = state.pitcher;
  const pitcher = lookupPlayer(state, pr.playerId);
  const prof = PITCHES[type];
  const pa = pitcher.pitch ?? { velocity: 55, control: 55, movement: 55, stamina: 55, composure: 55 };

  const control01 = attr01(pa.control);
  const velo01 = attr01(pa.velocity);
  const move01 = attr01(pa.movement);

  const fatigue = 1 - pr.stamina;
  const speed = (prof.speed + velo01 * prof.speedSpan) * (1 - fatigue * 0.075);

  // Execution error: worse control, more fatigue and wilder pitches all widen it.
  const aimStress = clamp01((Math.abs(aimX) - 0.2) * 1.6 + Math.abs(aimY - ZONE_CENTER_Y) * 0.8);
  const sigma =
    (0.032 + (1 - control01) * 0.078) *
    (0.6 + prof.wildness * 0.45) *
    (1 + fatigue * 0.85) *
    (1 + aimStress * 0.35);

  const errX = state.rng.normal(0, sigma);
  const errY = state.rng.normal(0, sigma);

  const armSign = pitcher.throws === 'L' ? 1 : -1;
  const moveScale = 0.7 + move01 * 0.6;
  const nominal = pitchBreak(type, pitcher.throws, move01);
  let breakX = nominal.breakX;
  let breakY = nominal.breakY;
  if (type === 'knuckler') {
    breakX = state.rng.range(-0.42, 0.42) * moveScale;
    breakY = (-0.1 + state.rng.range(-0.3, 0.18)) * moveScale;
  }

  // `aimX`/`aimY` are where the pitcher wants the ball to CROSS THE PLATE, so
  // the break has to be subtracted from the launch line — a curveball starts
  // high and lands on the spot, rather than starting on the spot and diving
  // out of the zone.
  const targetX = clamp(aimX + errX - breakX, -1.2, 1.2);
  const targetY = clamp(aimY + errY - breakY, 0.06, 2.4);

  launchPitch(state.ball, {
    speed,
    targetX,
    targetY,
    breakX,
    breakY,
    lateness: prof.lateness,
    releaseX: armSign * 0.42,
    timeScale: PITCH_TEMPO[state.setup.pitchTempo ?? DEFAULT_PITCH_TEMPO],
  });

  const batter = currentBatter(state);
  const plateX = targetX + breakX;
  const plateY = targetY + breakY;
  state.cpuSwingAt = null;

  state.currentPitch = {
    type,
    speedMs: speed,
    plateX,
    plateY,
    aimX,
    aimY,
    inZone: inStrikeZone(plateX, plateY, batter),
    T: state.ball.pitch!.T,
    // Where the ball would cross with no break at all. The gap between this
    // and (plateX, plateY) is exactly the movement, which is what the plate
    // view draws as the break arc.
    entryX: targetX,
    entryY: targetY,
  };

  state.diag.pitches++;
  if (state.currentPitch.inZone) state.diag.inZone++;
  pr.pitchCount++;
  pr.usage[type] = (pr.usage[type] ?? 0) + 1;
  pr.recent.push(type);
  if (pr.recent.length > 12) pr.recent.shift();

  // Stamina drain: high-effort pitches cost more; so does pitching from a mess.
  const staminaAttr = attr01(pa.stamina);
  const drain = 1 / (46 + staminaAttr * 74);
  const effort = type === 'heater' ? 1.35 : type === 'knuckler' ? 0.5 : 1;
  const pressure = state.runners.length > 0 ? 1.12 : 1;
  pr.stamina = clamp01(pr.stamina - drain * effort * pressure);

  pitchingLine(state, pr.side, pr.playerId).pitches++;

  state.batter.swingT = -1;
  state.batter.swingResolved = false;
  state.batter.checked = false;
  state.cpuRead = null;
  setPhase(state, 'windup');
}

function updateWindup(state: GameState, dt: number, inputs: InputPair): void {
  const batInput = inputFor(state, battingSide(state), inputs);
  if (batInput) aimCursor(state, batInput, dt);
  stepRunnersPreplay(state, dt);
  idleFielders(state, dt);
  if (state.phaseT >= 0.42) {
    pushEvent(state, { kind: 'pitchrelease', power: state.currentPitch?.speedMs ?? 38 });
    setPhase(state, 'pitch');
  }
}

// ---------------------------------------------------------------------------
// Pitch in flight
// ---------------------------------------------------------------------------

function updatePitchFlight(state: GameState, dt: number, inputs: InputPair): void {
  const ball = state.ball;
  const pitchInfo = state.currentPitch!;
  const pitchInput = inputFor(state, fieldingSide(state), inputs);
  const batInput = inputFor(state, battingSide(state), inputs);
  const batter = currentBatter(state);

  // --- Pitcher steering ----------------------------------------------------
  const pitcher = lookupPlayer(state, state.pitcher.playerId);
  const steerPower = 0.45 + attr01(pitcher.pitch?.movement ?? 50) * 0.75;
  let sx = 0;
  let sy = 0;
  if (pitchInput) {
    sx = pitchInput.moveX;
    sy = pitchInput.moveY;
  } else if (state.rng.chance(0.4)) {
    // The CPU nudges its own pitches slightly toward the intended spot.
    const d = DIFFICULTY[state.difficulty];
    sx = clamp((pitchInfo.aimX - ball.x) * 2.2, -1, 1) * d.command * 0.55;
    sy = clamp((pitchInfo.aimY - ball.y) * 2.2, -1, 1) * d.command * 0.55;
  }
  const done = stepPitch(ball, dt, sx, sy, steerPower);

  // Recompute where the pitch will actually arrive after steering.
  const p = ball.pitch!;
  pitchInfo.plateX = p.px + p.breakX + p.steerX;
  pitchInfo.plateY = p.py + p.breakY + p.steerY;
  pitchInfo.inZone = inStrikeZone(pitchInfo.plateX, pitchInfo.plateY, batter);

  // --- Batter --------------------------------------------------------------
  const bs = state.batter;
  if (batInput) {
    if (bs.swingT < 0) {
      aimCursor(state, batInput, dt);
      if (batInput.bunt) bs.bunting = !bs.bunting;
      if (batInput.swing || batInput.power || (bs.bunting && batInput.take === false && false)) {
        startSwing(
          state,
          batInput.power ? 'power' : bs.bunting ? 'bunt' : 'contact',
          batInput.pressAge,
        );
      } else if (bs.bunting && batInput.swing) {
        startSwing(state, 'bunt', batInput.pressAge);
      }
    } else {
      bs.swingT += dt;
      if (batInput.take && bs.swingT < 0.1 && !bs.swingResolved) {
        // Check swing: the bat was held up in time.
        bs.checked = true;
        bs.swingT = -1;
        bs.swingKind = 'none';
        pushEvent(state, { kind: 'strike', text: 'Checked' });
      }
    }
  } else {
    cpuBatting(state, dt);
    if (bs.swingT >= 0) bs.swingT += dt;
  }

  // --- Resolution ----------------------------------------------------------
  if (bs.swingT >= 0 && !bs.swingResolved) {
    const profile = swingProfile(
      batter,
      bs.swingKind === 'none' ? 'contact' : bs.swingKind,
      state.difficulty,
      batInput !== null,
    );
    const pressT = ball.t - bs.swingT;
    const arrival = pressT + profile.latency;
    if (ball.t >= arrival) {
      resolveSwingNow(state, arrival - pitchInfo.T, profile);
      return;
    }
  }

  if (done && ball.t >= pitchInfo.T + lateSwingGrace(batter, state.difficulty, batInput !== null)) {
    if (bs.swingT >= 0 && !bs.swingResolved) {
      const profile = swingProfile(batter, bs.swingKind === 'none' ? 'contact' : bs.swingKind, state.difficulty, batInput !== null);
      const pressT = ball.t - bs.swingT;
      resolveSwingNow(state, pressT + profile.latency - pitchInfo.T, profile);
      return;
    }
    resolveTakenPitch(state);
    return;
  }

  stepRunnersPreplay(state, dt);
  idleFielders(state, dt);
}

/**
 * Records the pitch that just finished on the at-bat tracker. Display only —
 * the count, the rules and the box score are all handled elsewhere, and this
 * deliberately runs before the count is updated so each dot carries the count
 * it was thrown in.
 */
function logPitch(state: GameState, result: PitchLogResult): void {
  const info = state.currentPitch;
  if (!info) return;
  state.pitchLog.push({
    type: info.type,
    x: info.plateX,
    y: info.plateY,
    speedMs: info.speedMs,
    inZone: info.inZone,
    result,
    balls: state.balls,
    strikes: state.strikes,
  });
  if (state.pitchLog.length > 24) state.pitchLog.shift();
}

/**
 * `age` backdates the swing to when the button was actually pressed rather than
 * when the engine found out about it — see InputFrame.pressAge. It is capped
 * hard: a plausible age is one rendered frame, and anything past a couple of
 * frames is a stalled tab or a lying clock, not a human being early.
 */
function startSwing(
  state: GameState,
  kind: 'contact' | 'power' | 'bunt',
  age = 0,
): void {
  const bs = state.batter;
  bs.swingT = clamp(age, 0, MAX_PRESS_AGE);
  bs.swingKind = kind;
  bs.animT = 0;
  bs.swingResolved = false;
}

function cpuBatting(state: GameState, dt: number): void {
  void dt;
  const bs = state.batter;
  if (bs.swingT >= 0 || bs.swingResolved) return;
  const ball = state.ball;
  const info = state.currentPitch!;
  const batter = currentBatter(state);
  const d = DIFFICULTY[state.difficulty];

  // Decide once, part-way through the flight. Reaction time is a real budget:
  // the CPU cannot wait until the ball is at the plate.
  const react = 0.235 - attr01(batter.bat.reaction) * 0.05;
  const decisionAt = Math.max(0.06, info.T - react);
  if (state.cpuRead) {
    if (state.cpuSwingAt !== null && ball.t >= state.cpuSwingAt) {
      startSwing(state, state.cpuRead.kind);
      state.cpuSwingAt = null;
    }
    return;
  }
  if (ball.t < decisionAt) return;

  const fam = familiarityOf(state.pitcher, info.type);
  const read = readPitch(
    batter,
    info.plateX,
    info.plateY,
    info.T,
    info.type,
    fam,
    state.balls,
    state.strikes,
    state.outs,
    state.inning >= state.setup.innings,
    d,
    state.rng,
  );
  state.cpuRead = read;
  if (!read.swing) return;

  const profile = swingProfile(batter, read.kind, state.difficulty, false);
  // Aim the cursor at the estimate and press so the bat arrives at estT.
  bs.cx = clamp(read.estX, -CURSOR_X_LIMIT, CURSOR_X_LIMIT);
  bs.cy = clamp(read.estY, CURSOR_Y_MIN, CURSOR_Y_MAX);
  const pressAt = read.estT - profile.latency;
  state.cpuSwingAt = Math.max(ball.t, pressAt);
  if (ball.t >= state.cpuSwingAt) {
    startSwing(state, read.kind);
    state.cpuSwingAt = null;
  }
}

function resolveSwingNow(state: GameState, timingError: number, profile: ReturnType<typeof swingProfile>): void {
  const bs = state.batter;
  bs.swingResolved = true;
  const batter = currentBatter(state);
  const pitcher = lookupPlayer(state, state.pitcher.playerId);
  const info = state.currentPitch!;

  const res = resolveSwing({
    batter,
    kind: bs.swingKind === 'none' ? 'contact' : bs.swingKind,
    profile,
    cursorX: bs.cx,
    cursorY: bs.cy,
    plateX: info.plateX,
    plateY: info.plateY,
    pitchSpeed: info.speedMs,
    timingError,
    pullDir: pullDirection(batter.bats, pitcher.throws),
    rng: state.rng,
  });

  state.diag.swings++;
  // Every swing leaves a readable trace of *why* it did what it did.
  state.lastSwing = {
    kind: bs.swingKind,
    grade: res.grade,
    timingNorm: res.timingNorm,
    vertNorm: res.vertNorm,
    horizNorm: res.horizNorm,
    timingLabel: res.timingLabel,
    planeLabel: res.planeLabel,
    note: res.note,
    atX: bs.cx,
    atY: bs.cy,
    ballX: info.plateX,
    ballY: info.plateY,
    t: 1.6,
  };

  if (res.grade === 'miss') {
    state.diag.swingMisses++;
    pushEvent(state, { kind: 'swingmiss', text: res.note });
    logPitch(state, 'swinging');
    if (state.strikes + 1 < 3) checkBallInDirt(state);
    addStrike(state, 'swinging');
    return;
  }
  if (res.grade === 'foul') {
    state.diag.fouls++;
    pushEvent(state, { kind: 'foul', text: res.note, power: 0.25 });
    logPitch(state, 'foul');
    addStrike(state, 'foul');
    return;
  }
  if (res.grade === 'foultip') {
    state.diag.fouls++;
    pushEvent(state, { kind: 'foul', text: res.note, power: 0.2 });
    logPitch(state, 'foul');
    addStrike(state, 'foultip');
    return;
  }
  logPitch(state, 'inplay');

  // Ball in play.
  const v = contactVelocity(res);
  launchFree(
    state.ball,
    info.plateX,
    info.plateY,
    CONTACT_Z,
    v.vx,
    v.vy,
    v.vz,
    'batted',
    res.spin,
    res.sideSpin,
  );

  const play = state.play;
  play.live = true;
  play.fair = null;
  play.exitVelo = res.exitVelo;
  play.launchAngle = res.launchAngle;
  play.sprayAngle = res.sprayAngle;
  play.hardHit = res.exitVelo > 42;
  play.description = res.note;
  play.clock = 0;
  state.diag.ballsInPlay++;

  pushEvent(state, {
    kind: 'contact',
    text: res.note,
    power: clamp01((res.exitVelo - 12) / 38),
    x: info.plateX,
    y: info.plateY,
  });

  // The batter becomes a runner.
  const runner = makeRunner(batter, 0, true);
  runner.target = 1;
  runner.progress = 0;
  state.runners.push(runner);
  for (const r of state.runners) {
    r.tagBase = r.base;
    r.mustTag = false;
    r.cmdTarget = null;
    r.stealing = false;
  }

  // Fielders react after a human-scale delay.
  const d = DIFFICULTY[state.difficulty];
  for (const f of state.fielders) {
    f.reactDelay = d.fielderDelay + 0.08 + (1 - attr01(f.reaction)) * 0.14;
    f.hasBall = false;
    f.transfer = 0;
    f.role = 'idle';
    f.coverBase = -1;
  }

  state.diag.plays++;
  setPhase(state, 'inplay');
}

function resolveTakenPitch(state: GameState): void {
  const info = state.currentPitch!;
  const batter = currentBatter(state);
  const boxX = batterBoxX(batter.bats, lookupPlayer(state, state.pitcher.playerId).throws);

  // Hit by pitch: the ball arrives where the hitter is standing.
  if (
    Math.abs(info.plateX - boxX) < 0.26 &&
    info.plateY > 0.35 &&
    info.plateY < 1.65 &&
    !info.inZone
  ) {
    logPitch(state, 'hitbypitch');
    hitByPitch(state);
    return;
  }

  if (info.inZone && !state.batter.checked) {
    state.diag.calledStrikes++;
    pushEvent(state, { kind: 'strike', text: 'Called strike' });
    logPitch(state, 'called');
    addStrike(state, 'called');
  } else if (info.inZone && state.batter.checked) {
    pushEvent(state, { kind: 'strike', text: 'Checked — strike' });
    logPitch(state, 'called');
    addStrike(state, 'called');
  } else {
    logPitch(state, 'ball');
    // Ball four already moves everybody; checking here as well would advance
    // the same runners twice.
    if (state.balls + 1 < 4) checkBallInDirt(state);
    addBall(state);
  }
}

/**
 * A pitch the catcher has to block. Only interesting with somebody on base —
 * a ball skipping to the backstop with the bases empty is not a moment, it is
 * a delay — so this deliberately does nothing otherwise.
 *
 * A pitch that crossed well below the knees is the pitcher's fault and goes in
 * the book as a wild pitch; one the catcher simply missed is a passed ball.
 * Both let every runner take a base, which is what makes a breaking ball with
 * a man on third an actual decision instead of a free strikeout.
 */
function checkBallInDirt(state: GameState): void {
  const info = state.currentPitch;
  if (!info) return;
  const live = state.runners.filter((r) => !r.out && !r.scored && !r.isBatter);
  if (live.length === 0) return;

  const zone = zoneBounds(currentBatter(state));
  // How far below the bottom of the zone the ball crossed, in metres.
  const below = zone.bottom - info.plateY;
  if (below < 0.16) return;

  const catcher = state.fielders[CATCHER_SLOT];
  const skill = attr01(catcher.fielding);
  const move = Math.abs(PITCHES[info.type].breakX) + Math.abs(PITCHES[info.type].breakY);
  // Scaled so a good catcher blocks nearly everything and a bad one behind a
  // sharp breaking ball in the dirt genuinely loses one now and then.
  const p = clamp01((below - 0.16) * 1.7 + move * 0.2) * (0.36 - skill * 0.25);
  if (!state.rng.chance(clamp01(p))) return;

  const wild = below > 0.235;
  if (wild) state.diag.texture.wildPitches++;
  else state.diag.texture.passedBalls++;

  const pitching = pitchingLine(state, state.pitcher.side, state.pitcher.playerId);
  if (wild) pitching.wp++;

  for (const r of [...live].sort((a, b) => b.base - a.base)) {
    if (r.base >= 3) {
      r.base = 4;
      r.progress = 0;
      r.scored = true;
      scoreRun(state, r);
    } else {
      r.base += 1;
      r.progress = 0;
      r.target = r.base;
    }
  }
  state.runners = state.runners.filter((r) => !r.out && !r.scored);

  pushEvent(state, { kind: 'wildpitch', text: wild ? 'WILD PITCH' : 'PASSED BALL', power: 0.7 });
  setBanner(state, wild ? 'WILD PITCH' : 'PASSED BALL', 'RUNNERS MOVE UP', 'error', 1.5);
  checkWalkOff(state);
}

// ---------------------------------------------------------------------------
// Count handling
// ---------------------------------------------------------------------------

function addStrike(state: GameState, kind: 'swinging' | 'called' | 'foul' | 'foultip'): void {
  const isFoul = kind === 'foul';
  if (isFoul && state.strikes >= 2) {
    // Ordinary fouls with two strikes do not add a strike.
    endPitch(state, false);
    return;
  }
  state.strikes++;
  if (state.strikes >= 3) {
    strikeout(state, kind === 'called');
    return;
  }
  endPitch(state, false);
}

function addBall(state: GameState): void {
  state.diag.ballsThrown++;
  state.balls++;
  pushEvent(state, { kind: 'ball', text: 'Ball' });
  if (state.balls >= 4) {
    walk(state);
    return;
  }
  endPitch(state, false);
}

function strikeout(state: GameState, looking: boolean): void {
  const bs = battingSide(state);
  const batter = currentBatter(state);
  const line = battingLine(state, bs, batter.id);
  line.ab++;
  line.pa++;
  line.so++;
  pitchingLine(state, state.pitcher.side, state.pitcher.playerId).so++;
  pushEvent(state, {
    kind: 'strikeout',
    text: looking ? 'STRUCK OUT LOOKING' : 'STRUCK HIM OUT',
    power: 1,
  });
  setBanner(state, 'STRIKE THREE', `${batter.lastName.toUpperCase()} GOES DOWN`, 'strikeout', 1.7);
  recordOut(state, 1);
  state.play.outcome = 'strikeout';
  finishPlateAppearance(state);
}

function walk(state: GameState): void {
  const bs = battingSide(state);
  const batter = currentBatter(state);
  const line = battingLine(state, bs, batter.id);
  line.pa++;
  line.bb++;
  pitchingLine(state, state.pitcher.side, state.pitcher.playerId).bb++;
  const free = state.pitchAround === 'intentional';
  if (free) state.diag.texture.intentionalWalks++;
  pushEvent(state, { kind: 'walk', text: free ? 'PUT HIM ON' : 'BALL FOUR' });
  setBanner(
    state,
    free ? 'INTENTIONAL' : 'BALL FOUR',
    `${batter.lastName.toUpperCase()} TAKES FIRST`,
    'walk',
    1.6,
  );
  awardBases(state, batter, 1);
  state.play.outcome = 'walk';
  checkWalkOff(state);
  finishPlateAppearance(state);
}

function hitByPitch(state: GameState): void {
  const bs = battingSide(state);
  const batter = currentBatter(state);
  const line = battingLine(state, bs, batter.id);
  line.pa++;
  line.hbp++;
  pitchingLine(state, state.pitcher.side, state.pitcher.playerId).hbp++;
  pushEvent(state, { kind: 'hitbypitch', text: 'HIT BY PITCH' });
  setBanner(state, 'HIT BY PITCH', `${batter.lastName.toUpperCase()} TAKES FIRST`, 'walk', 1.6);
  awardBases(state, batter, 1);
  state.play.outcome = 'hitbypitch';
  checkWalkOff(state);
  finishPlateAppearance(state);
}

/** Forces runners up by one base as needed and puts the batter on first. */
function awardBases(state: GameState, batter: Player, _bases: number): void {
  void _bases;
  const occupied = new Set(state.runners.filter((r) => !r.out && !r.scored).map((r) => r.base));
  let base = 1;
  const pushChain: RunnerState[] = [];
  while (occupied.has(base)) {
    const r = state.runners.find((x) => !x.out && !x.scored && x.base === base)!;
    pushChain.push(r);
    base++;
  }
  for (const r of pushChain.reverse()) {
    r.base += 1;
    r.progress = 0;
    r.target = r.base;
    if (r.base >= 4) {
      r.scored = true;
      scoreRun(state, r);
    }
  }
  const runner = makeRunner(batter, 1, false);
  runner.progress = 0;
  runner.target = 1;
  state.runners.push(runner);
}

function endPitch(state: GameState, _playEnded: boolean): void {
  void _playEnded;
  state.currentPitch = null;
  state.batter.swingT = -1;
  state.batter.swingResolved = false;
  // Keep swingKind and animT until the next windup so the renderer can finish
  // a miss or foul after the pitch has already been ruled.
  state.batter.checked = false;
  state.cpuRead = null;
  state.cpuSwingAt = null;
  state.ball.mode = 'held';
  state.ball.x = 0;
  state.ball.y = 1.7;
  state.ball.z = MOUND_Z;
  state.ball.pitch = undefined;
  state.pitcher.ready = humanIsPitching(state) ? 0.3 : 0.55 + state.rng.range(0, 0.4);

  // Somebody broke for the next bag on that pitch. The catcher has the ball and
  // a decision to make, so this becomes a live play rather than a free base.
  const stealers = state.runners.filter((r) => !r.out && !r.scored && r.stealing);
  if (stealers.length && state.outs < 3) {
    startThrowDown(state, stealers);
    return;
  }

  for (const r of state.runners) {
    r.cmdTarget = null;
    r.stealing = false;
    r.target = r.base;
  }
  reconsiderDefense(state);
  setPhase(state, 'preplay');
}

/**
 * The catcher's throw to second.
 *
 * Before this existed a runner simply walked to the next base while the pitch
 * was in the air and nobody contested it — eight and a half free bases a game,
 * and not one throw. Now it is an ordinary live play: the catcher gathers, the
 * middle infielder covers, and the tag either beats the runner or it does not.
 * Every part of that is machinery the engine already had for balls in play.
 */
function startThrowDown(state: GameState, stealers: RunnerState[]): void {
  const catcher = state.fielders[CATCHER_SLOT];
  const ball = state.ball;

  state.play = makePlayContext(state.batter.playerId, battingSide(state));
  state.play.live = true;
  state.play.steal = true;
  state.play.fair = true;

  catcher.hasBall = true;
  // Pop time: gathering the pitch and getting rid of it. A good defensive
  // catcher is roughly a fifth of a second quicker than a bad one, which is
  // very close to the difference it makes in the real game.
  catcher.transfer = 0.72 - attr01(catcher.fielding) * 0.2;
  catcher.role = 'chase';
  ball.mode = 'held';
  ball.x = catcher.x;
  ball.y = 1.3;
  ball.z = catcher.z;
  ball.vx = ball.vy = ball.vz = 0;
  ball.rolling = false;
  ball.pitch = undefined;

  for (const r of stealers) {
    r.cmdTarget = null;
    r.target = clamp(r.base + 1, 0, 4);
  }
  for (const r of state.runners) {
    if (r.stealing) continue;
    r.cmdTarget = null;
    r.target = r.base;
  }

  assignCoverage(state.fielders, CATCHER_SLOT);
  state.chaseSlot = CATCHER_SLOT;
  state.diag.plays++;
  setPhase(state, 'inplay');
}

/** Ends the plate appearance and moves to the next hitter (or the next half). */
function finishPlateAppearance(state: GameState): void {
  state.currentPitch = null;
  state.cpuRead = null;
  state.cpuSwingAt = null;
  state.balls = 0;
  state.strikes = 0;
  const bs = battingSide(state);
  state.battingIdx[bs] = (state.battingIdx[bs] + 1) % teamOf(state, bs).lineup.length;
  if (state.walkOffPending) finalize(state, true);
  setPhase(state, 'deadball');
}

// ---------------------------------------------------------------------------
// Ball in play
// ---------------------------------------------------------------------------

function updateInPlay(state: GameState, dt: number, inputs: InputPair): void {
  const ball = state.ball;
  const play = state.play;
  play.clock += dt;

  if (ball.mode === 'batted' || ball.mode === 'thrown') {
    const res = stepFree(ball, dt, state.stadium, state.stadium.carry);
    if (res.homeRun && ball.mode === 'batted' && play.fair !== false) {
      const angle = sprayAngleDeg(ball.x, ball.z);
      if (Math.abs(angle) <= 45) {
        handleHomeRun(state);
        return;
      }
    }
    if (res.hitWall) {
      pushEvent(state, { kind: 'wall', power: 0.7, x: ball.x, z: ball.z });
      if (play.fair === null) play.fair = true;
    }
    if (res.landed && ball.mode === 'batted') {
      handleLanding(state, res.landX, res.landZ);
    }
    if (ball.mode === 'batted' && !play.distance && (ball.rolling || res.landed)) {
      play.distance = horizontalDist(ball.x, ball.z);
      play.hangTime = ball.t;
    }
  }

  // A foul ball that gets this far from the plate is in the seats. Calling it
  // here stops fielders chasing uncatchable balls halfway to the parking lot.
  if (
    play.fair === null &&
    ball.mode === 'batted' &&
    !isFair(ball.x, ball.z) &&
    horizontalDist(ball.x, ball.z) > 30 &&
    (ball.vy < 0 || ball.rolling || ball.bounces > 0)
  ) {
    foulBall(state);
    return;
  }

  // Foul balls in the infield can roll into fair territory and vice versa.
  if (play.fair === null && ball.rolling && ball.mode === 'batted') {
    const d = horizontalDist(ball.x, ball.z);
    if (d > BASE_PATH) play.fair = isFair(ball.x, ball.z);
    else if (!isFair(ball.x, ball.z)) {
      foulBall(state);
      return;
    }
  }

  updateFlyBallOutlook(state);
  updateDefense(state, dt, inputs);
  updateOffense(state, dt, inputs);
  checkOuts(state);
  checkPlayEnd(state, dt);
}

function updateFlyBallOutlook(state: GameState): void {
  const ball = state.ball;
  const play = state.play;
  if (!canBeFlyOut(ball) || ball.y < 1.2) {
    play.likelyCatch = false;
    return;
  }
  const pred = predictLanding(ball, state.stadium, state.stadium.carry);
  if (pred.t < 0.55) {
    play.likelyCatch = false;
    return;
  }
  let best = Infinity;
  for (const f of state.fielders) {
    const t = dist(f.x, f.z, pred.x, pred.z) / f.maxSpeed;
    best = Math.min(best, t);
  }
  play.likelyCatch = best < pred.t - 0.05 && isFair(pred.x, pred.z);
}

function handleLanding(state: GameState, x: number, z: number): void {
  const play = state.play;
  if (play.fair !== null) return;
  const d = horizontalDist(x, z);
  if (isFair(x, z)) {
    if (d > BASE_PATH) {
      play.fair = true;
    }
    // Inside the infield the call stays open until it passes a base or is touched.
  } else {
    foulBall(state);
  }
}

function foulBall(state: GameState): void {
  const play = state.play;
  state.diag.fouls++;
  play.fair = false;
  play.live = false;
  pushEvent(state, { kind: 'foul', text: 'Foul ball', power: 0.35 });

  // A bunt fouled off with two strikes is a strikeout.
  if (state.batter.swingKind === 'bunt' && state.strikes >= 2) {
    strikeout(state, false);
    return;
  }

  // Remove the batter-runner and send everyone back.
  state.runners = state.runners.filter((r) => !r.isBatter);
  settleRunnersToBases(state.runners);
  addStrike(state, 'foul');
}

function handleHomeRun(state: GameState): void {
  const play = state.play;
  play.fair = true;
  play.live = false;
  play.homeRunCelebration = true;
  play.outcome = 'homerun';
  play.distance = horizontalDist(state.ball.x, state.ball.z);

  const bs = battingSide(state);
  const batter = currentBatter(state);
  const line = battingLine(state, bs, batter.id);
  const pl = pitchingLine(state, state.pitcher.side, state.pitcher.playerId);

  line.ab++;
  line.pa++;
  line.h++;
  line.hr++;
  state.stats[bs].hits++;
  pl.h++;
  pl.hr++;

  // Every runner scores, lead runner first. scoreRun() already credits the run,
  // the RBI and the pitcher's line, so nothing here may add them a second time.
  const live = state.runners
    .filter((r) => !r.out && !r.scored)
    .sort((a, b) => runnerAbs(b) - runnerAbs(a));
  for (const r of live) {
    r.base = 4;
    r.progress = 0;
    r.scored = true;
    scoreRun(state, r);
  }

  // ...and then the batter's own trip around.
  line.r++;
  line.rbi++;
  state.stats[bs].runs++;
  addRunToLineScore(state, bs, 1);
  pl.r++;
  if (!play.errorCharged) pl.er++;
  state.pitcher.runsAllowed++;
  play.runs++;
  play.rbi++;

  const distFt = Math.round(play.distance * 3.28084);
  pushEvent(state, { kind: 'homerun', text: `${distFt} FEET`, power: 1 });
  setBanner(
    state,
    live.length === 3 ? 'GRAND SLAM!' : 'GONE!',
    `${batter.lastName.toUpperCase()} — ${distFt} FT`,
    'homerun',
    3.2,
  );
  state.runners = [];
  checkWalkOff(state);
  finishPlateAppearance(state);
}

// ---------------------------------------------------------------------------
// Defence
// ---------------------------------------------------------------------------

function updateDefense(state: GameState, dt: number, inputs: InputPair): void {
  const ball = state.ball;
  const fielders = state.fielders;
  const holder = fielders.find((f) => f.hasBall) ?? null;

  for (const f of fielders) {
    if (f.reactDelay > 0) f.reactDelay = Math.max(0, f.reactDelay - dt);
    if (f.transfer > 0) f.transfer = Math.max(0, f.transfer - dt);
  }

  // --- Role assignment -----------------------------------------------------
  if (!holder && (ball.mode === 'batted' || ball.mode === 'thrown')) {
    state.trajT -= dt;
    if (state.trajT <= 0) {
      projectBall(ball, state.stadium, state.stadium.carry, 6, 1 / 40, state.traj);
      state.trajT = 0.05;
    }

    // Everyone solves for the earliest point they could physically meet the
    // ball. The best solution becomes the chaser and everyone else covers.
    let chaser = -1;
    let bestT = Infinity;
    for (const f of fielders) {
      const ic = findIntercept(f, state.traj, f.reactDelay);
      f.tx = ic.x;
      f.tz = ic.z;
      const score = ic.feasible ? ic.t : ic.t + 4 + dist(f.x, f.z, ic.x, ic.z) / f.maxSpeed;
      if (score < bestT) {
        bestT = score;
        chaser = f.slot;
      }
    }
    if (chaser < 0) chaser = 0;
    assignCoverage(fielders, chaser);
    state.chaseSlot = chaser;
    const landing =
      ball.mode === 'batted' && !ball.rolling
        ? predictLanding(ball, state.stadium, state.stadium.carry)
        : { x: ball.x, z: ball.z, t: 0, y: ball.y };
    state.predictX = landing.x;
    state.predictZ = landing.z;
    state.predictT = landing.t;

    if (ball.mode !== 'thrown' || ball.rolling || ball.bounces > 0) state.throwReceiver = -1;
    // A throw already in the air keeps its receiver, whatever coverage says.
    if (ball.mode === 'thrown' && state.throwReceiver >= 0) {
      const r = fielders[state.throwReceiver];
      r.role = 'cut';
      r.tx = state.throwTargetX;
      r.tz = state.throwTargetZ;
    }
  }
  if (holder) state.throwReceiver = -1;

  // --- Human fielder selection --------------------------------------------
  const defInput = inputFor(state, fieldingSide(state), inputs);
  let humanSlot = -1;
  if (defInput) {
    if (holder) {
      humanSlot = holder.slot;
    } else {
      humanSlot = state.chaseSlot;
    }
    if (defInput.switchFielder) {
      // Cycle to the next-closest fielder to the ball.
      const sorted = [...fielders].sort(
        (a, b) => dist(a.x, a.z, ball.x, ball.z) - dist(b.x, b.z, ball.x, ball.z),
      );
      const idx = sorted.findIndex((f) => f.slot === humanSlot);
      humanSlot = sorted[(idx + 1) % sorted.length].slot;
      state.chaseSlot = humanSlot;
    }
  }

  for (const f of fielders) {
    f.humanControlled = defInput !== null && f.slot === humanSlot;
  }

  /*
   * AUTO-FIELDING
   *
   * The human on defence is always attached to whichever fielder the coverage
   * solver picked as the chaser — which means that if they stop steering, the
   * one player who was going to run the ball down stops running. Nobody else
   * takes over, because everybody else is covering a base. The ball then sits
   * in the outfield until the 26-second play guard force-resolves it, which is
   * exactly the deadlock a player hit: a fly ball, a camera they could not read,
   * and half a minute of nothing.
   *
   * So: hands off the stick for half a second and the fielder resumes doing its
   * job on its own. Touching a direction takes control straight back, with no
   * cooldown. The HUD says which of the two is happening.
   */
  const acting =
    !!defInput &&
    (Math.abs(defInput.moveX) + Math.abs(defInput.moveZ) > 0.25 ||
      defInput.base >= 0 ||
      defInput.dive ||
      defInput.switchFielder);
  if (!defInput || acting) state.defenseIdleT = 0;
  else state.defenseIdleT += dt;

  // Chasing resumes quickly, because a ball nobody is running toward is dead
  // time. Throwing waits longer — deciding where to go with it is a real
  // decision and the player deserves a moment to make it.
  const autoChase = !holder && !!defInput && state.defenseIdleT > 0.55;
  const autoThrow = !!holder && !!defInput && state.defenseIdleT > 1.2;
  state.autoFielding = autoChase || autoThrow;

  // --- Movement ------------------------------------------------------------
  for (const f of fielders) {
    if (f.reactDelay > 0 && !f.humanControlled) {
      moveFielder(f, dt, f.x, f.z);
      continue;
    }
    if (f.humanControlled && defInput) {
      if (defInput.dive && f.diveT <= 0) {
        const dx = ball.x - f.x;
        const dz = ball.z - f.z;
        startDive(f, dx, dz);
        if (ball.y > 1.6) f.jumpT = 0.5;
      }
      if (!autoChase || f.diveT > 0) {
        driveFielder(f, dt, defInput.moveX, defInput.moveZ);
        continue;
      }
    }
    moveFielderByRole(state, f, dt);
  }

  // --- Interactions --------------------------------------------------------
  tryCatches(state, dt);
  const newHolder = fielders.find((f) => f.hasBall) ?? null;
  if (!newHolder && defInput && defInput.base >= 0) {
    pushEvent(state, { kind: 'denied', text: 'Nobody has the ball' });
  }
  if (newHolder) {
    if (newHolder.humanControlled && defInput) {
      if (defInput.base >= 0) {
        if (newHolder.transfer > 0) pushEvent(state, { kind: 'denied', text: 'Still gathering it' });
        else executeThrow(state, newHolder, defInput.base);
      } else if (autoThrow && newHolder.transfer <= 0) {
        // Fetching the ball and then standing on it is not much better than
        // never fetching it: the runners simply keep going. If the human is not
        // going to throw, the CPU finishes the play.
        cpuThrowDecision(state, newHolder);
      }
    } else if (newHolder.transfer <= 0) {
      cpuThrowDecision(state, newHolder);
    }
  }
}

function moveFielderByRole(state: GameState, f: ReturnType<typeof makeFielder>, dt: number): void {
  const ball = state.ball;
  if (f.hasBall) {
    // Hold position while deciding, but move toward the infield if deep.
    moveFielder(f, dt, f.x, f.z);
    return;
  }
  switch (f.role) {
    case 'chase': {
      moveFielder(f, dt, f.tx, f.tz);
      // Lay out for a ball that is only just out of reach.
      const gap = dist(f.x, f.z, ball.x, ball.z);
      if (
        f.diveT <= 0 &&
        gap > catchReach(f) &&
        gap < catchReach(f) + 2.0 &&
        ball.y < 2.2 &&
        !ball.rolling &&
        ball.mode === 'batted' &&
        state.rng.chance(0.09)
      ) {
        startDive(f, ball.x - f.x, ball.z - f.z);
      }
      if (ball.y > 2.2 && ball.y < 3.5 && gap < 1.7 && f.jumpT <= 0) f.jumpT = 0.5;
      break;
    }
    case 'cover': {
      const bp = basePoint(f.coverBase);
      moveFielder(f, dt, bp.x, bp.z);
      break;
    }
    case 'cut': {
      moveFielder(f, dt, f.tx, f.tz);
      break;
    }
    default: {
      const t = backupTarget(f, ball.x, ball.z);
      moveFielder(f, dt, t.x, t.z);
      break;
    }
  }
}

function tryCatches(state: GameState, dt: number): void {
  void dt;
  const ball = state.ball;
  if (ball.mode !== 'batted' && ball.mode !== 'thrown') return;

  for (const f of state.fielders) {
    if (f.hasBall) continue;
    if (f.reactDelay > 0 && !f.humanControlled) continue;
    const d = dist(f.x, f.z, ball.x, ball.z);
    const reach = catchReach(f);
    if (d > reach) continue;

    const airborne = !ball.rolling && ball.y > 0.42;
    if (airborne && ball.y > reachHeight(f)) continue;

    const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
    const movingFast = Math.hypot(f.vx, f.vz) > f.maxSpeed * 0.7;
    const diving = f.diveT > 0;

    if (ball.mode === 'thrown') {
      // Receiving a throw is much easier than fielding a batted ball.
      const p = clamp01(0.96 + attr01(f.fielding) * 0.035 - (movingFast ? 0.05 : 0));
      if (state.rng.chance(p)) {
        acquireBall(state, f, false);
      } else {
        deflect(state, f, 'error');
      }
      return;
    }

    const success = fieldingSuccess(f, speed, movingFast, airborne, diving);
    const routine = success > 0.93 && !diving;
    if (state.rng.chance(success)) {
      // Fair and foul flies are both outs only before anything else touches
      // the ball. In particular, catching a rebound directly off the wall is
      // the same as fielding it after a bounce: possession, but no batter out.
      if (airborne && canBeFlyOut(ball)) catchFlyBall(state, f);
      else acquireBall(state, f, true);
    } else {
      deflect(state, f, routine ? 'error' : 'muff');
    }
    return;
  }
}

function acquireBall(state: GameState, f: ReturnType<typeof makeFielder>, batted: boolean): void {
  const ball = state.ball;
  const ballX = ball.x;
  const ballZ = ball.z;
  f.hasBall = true;
  f.transfer = 0.14 + (1 - attr01(f.fielding)) * 0.18;
  ball.mode = 'held';
  ball.x = f.x;
  ball.z = f.z;
  ball.y = 1.3;
  ball.vx = ball.vy = ball.vz = 0;
  ball.rolling = false;
  if (state.play.fair === null) state.play.fair = isFair(ballX, ballZ);
  ball.touched = true;
  if (batted) pushEvent(state, { kind: 'groundfield', x: f.x, z: f.z, power: 0.4 });
}

function catchFlyBall(state: GameState, f: ReturnType<typeof makeFielder>): void {
  const play = state.play;
  const ball = state.ball;
  const ballX = ball.x;
  const ballZ = ball.z;
  f.hasBall = true;
  f.transfer = 0.16 + (1 - attr01(f.fielding)) * 0.16;
  ball.mode = 'held';
  ball.x = f.x;
  ball.z = f.z;
  ball.y = 1.55;
  ball.vx = ball.vy = ball.vz = 0;
  play.caught = true;
  if (!play.distance) play.distance = horizontalDist(ballX, ballZ);
  if (!play.hangTime) play.hangTime = ball.t;
  if (play.fair === null) play.fair = isFair(ballX, ballZ);

  const spectacular = f.diveT > 0 || f.jumpT > 0 || play.hangTime > 3.4;
  pushEvent(state, {
    kind: 'catch',
    text: spectacular ? 'WHAT A CATCH!' : 'Caught',
    power: spectacular ? 1 : 0.5,
    x: f.x,
    z: f.z,
  });
  if (spectacular) {
    setBanner(state, 'ROBBED!', `${FIELD_SLOTS[f.slot]} MAKES THE PLAY`, 'bigplay', 2);
    pushEvent(state, { kind: 'bigplay', power: 1 });
  }

  // Batter is out; runners must retouch.
  if (!play.batterOut && state.outs < 3) {
    play.batterOut = true;
    recordOut(state, 1);
    play.outs++;
  }
  const batterRunner = state.runners.find((r) => r.isBatter);
  if (batterRunner) {
    batterRunner.out = true;
  }
  for (const r of state.runners) {
    if (r.out || r.scored || r.isBatter) continue;
    if (!isOnBase(r)) {
      r.mustTag = true;
      r.target = r.tagBase;
    }
  }
}

function deflect(state: GameState, f: ReturnType<typeof makeFielder>, kind: 'error' | 'muff'): void {
  const ball = state.ball;
  f.errorFlash = 0.9;
  // Knock the ball down nearby rather than letting it pass through.
  const away = state.rng.range(0, Math.PI * 2);
  const mag = kind === 'error' ? 3.4 : 5.2;
  ball.x = f.x + Math.cos(away) * 0.5;
  ball.z = f.z + Math.sin(away) * 0.5;
  ball.y = Math.max(BALL_RADIUS, Math.min(ball.y, 0.9));
  ball.vx = Math.cos(away) * mag;
  ball.vz = Math.sin(away) * mag;
  ball.vy = 1.2;
  ball.rolling = false;
  ball.bounces = Math.max(1, ball.bounces);
  ball.mode = 'batted';
  ball.spin = 0;
  ball.sideSpin = 0;
  ball.touched = true;
  f.reactDelay = 0.34;
  if (state.play.fair === null) state.play.fair = isFair(f.x, f.z);
  if (kind === 'error' && !state.play.errorCharged) {
    state.play.errorCharged = true;
    state.stats[fieldingSide(state)].errors++;
    pushEvent(state, { kind: 'error', text: 'ERROR', power: 0.6 });
  }
}

/** Chooses the base a CPU fielder throws to, or holds the ball. */
function cpuThrowDecision(state: GameState, f: ReturnType<typeof makeFielder>): void {
  const d = DIFFICULTY[state.difficulty];
  const forces = computeForces(state.runners);
  const live = state.runners.filter((r) => !r.out && !r.scored);

  interface Candidate {
    base: number;
    value: number;
    margin: number;
  }
  const candidates: Candidate[] = [];

  for (const r of live) {
    const forcedTo = forces.get(r);
    const targets: number[] = [];
    if (forcedTo !== undefined && runnerAbs(r) < forcedTo) targets.push(forcedTo);
    if (r.mustTag && !isOnBase(r)) targets.push(r.tagBase === 0 ? 4 : r.tagBase);
    if (!r.mustTag && forcedTo === undefined && r.target > r.base) targets.push(r.target);

    for (const t of targets) {
      const baseIdx = t % 4;
      const bp = basePoint(baseIdx);
      const throwDist = dist(f.x, f.z, bp.x, bp.z);
      const flight = f.transfer + 0.2 + throwDist / (f.armSpeed * 0.8);
      const runnerT = r.mustTag ? distanceToBase(r, r.tagBase) / r.speed : timeToBase(r, t);
      const margin = runnerT - flight;
      if (throwDist > maxThrowRange(f) * 0.98) continue;
      const importance = baseIdx === 0 ? 2.6 : baseIdx === 3 ? 1.5 : baseIdx === 2 ? 1.25 : 1;
      const noisyMargin = margin + state.rng.normal(0, (1 - d.throwSense) * 0.45);
      if (noisyMargin < 0.03) continue;
      candidates.push({ base: baseIdx, value: importance + clamp(noisyMargin, 0, 1.2), margin });
    }
  }

  if (candidates.length === 0) {
    // Nobody can be thrown out. If nobody is even running, hold the ball and
    // let the play die — throwing it around is how fielding loops start.
    const anyRunning = live.some((r) => r.target > runnerAbs(r) + 1e-6);
    if (!anyRunning) return;
    // Runners are still moving: get it back to the infield to keep them honest.
    const distHome = horizontalDist(f.x, f.z);
    if (distHome > 36) {
      const lead = live.reduce((a, b) => (runnerAbs(a) > runnerAbs(b) ? a : b));
      const relay = pickRelay(state, f, Math.min(3, Math.floor(runnerAbs(lead)) + 1) % 4);
      if (relay) {
        executeThrowTo(state, f, relay.x, relay.z, true);
        return;
      }
    }
    return;
  }

  candidates.sort((a, b) => b.value - a.value);
  executeThrow(state, f, candidates[0].base);
}

function pickRelay(
  state: GameState,
  from: ReturnType<typeof makeFielder>,
  targetBase: number,
): { x: number; z: number } | null {
  const bp = basePoint(targetBase);
  let best: { x: number; z: number } | null = null;
  let bestScore = Infinity;
  for (const f of state.fielders) {
    if (f.slot === from.slot || f.slot >= 6) continue;
    const d1 = dist(from.x, from.z, f.x, f.z);
    const d2 = dist(f.x, f.z, bp.x, bp.z);
    if (d1 > maxThrowRange(from) * 0.9) continue;
    const score = d1 + d2;
    if (score < bestScore) {
      bestScore = score;
      best = { x: f.x, z: f.z };
    }
  }
  return best;
}

function executeThrow(state: GameState, f: ReturnType<typeof makeFielder>, base: number): void {
  const bp = basePoint(base);
  const throwDist = dist(f.x, f.z, bp.x, bp.z);
  if (throwDist > maxThrowRange(f) * 0.98) {
    const relay = pickRelay(state, f, base);
    if (relay) {
      executeThrowTo(state, f, relay.x, relay.z, true);
      return;
    }
  }
  executeThrowTo(state, f, bp.x, bp.z, false);
}

/**
 * Picks who is expected to catch a throw and sends them to the spot. Without
 * this the ball gets thrown to an empty patch of grass and the play stalls.
 */
function assignReceiver(
  state: GameState,
  thrower: ReturnType<typeof makeFielder>,
  x: number,
  z: number,
): number {
  let best = -1;
  let bestD = Infinity;
  for (const f of state.fielders) {
    if (f.slot === thrower.slot) continue;
    const d = dist(f.x, f.z, x, z);
    if (d < bestD) {
      bestD = d;
      best = f.slot;
    }
  }
  if (best >= 0) {
    const r = state.fielders[best];
    r.role = 'cut';
    r.coverBase = -1;
    r.tx = x;
    r.tz = z;
  }
  return best;
}

function executeThrowTo(
  state: GameState,
  f: ReturnType<typeof makeFielder>,
  x: number,
  z: number,
  relay: boolean,
): void {
  const d = dist(f.x, f.z, x, z);
  const err = throwError(f, d, false, () => state.rng.next());
  const t = throwBall(state.ball, f, x, z, err, relay ? 0.92 : 1);
  if (t === null) {
    // Cannot make the throw: hold on to it.
    f.transfer = 0.3;
    return;
  }
  f.transfer = 0.25;
  f.reactDelay = 0.12;
  state.throwTargetX = x;
  state.throwTargetZ = z;
  state.throwReceiver = assignReceiver(state, f, x, z);
  pushEvent(state, { kind: 'throw', power: clamp01(d / 60), x: f.x, z: f.z });
}

// ---------------------------------------------------------------------------
// Offence during a live ball
// ---------------------------------------------------------------------------

function updateOffense(state: GameState, dt: number, inputs: InputPair): void {
  const offInput = inputFor(state, battingSide(state), inputs);
  if (offInput) handleRunnerCommands(state, offInput, false);

  const holder = state.fielders.find((f) => f.hasBall) ?? null;
  const d = DIFFICULTY[state.difficulty];
  const aggression = offInput ? 0.5 : d.aggression;

  const settle =
    state.ball.mode === 'batted' && !state.ball.rolling
      ? predictLanding(state.ball, state.stadium, state.stadium.carry).t
      : 0;

  // Where the defence will actually pick the ball up, from the same
  // interception solve the fielders are running to.
  let acquireX = state.ball.x;
  let acquireZ = state.ball.z;
  let acquireTime = 0;
  let acquireArm = 30;
  if (!holder && state.traj.length > 1) {
    let best = Infinity;
    for (const f of state.fielders) {
      const ic = findIntercept(f, state.traj, f.reactDelay);
      const score = ic.feasible ? ic.t : ic.t + 3;
      if (score < best) {
        best = score;
        acquireX = ic.x;
        acquireZ = ic.z;
        acquireTime = score;
        acquireArm = f.armSpeed;
      }
    }
  }

  decideRunnerTargets({
    runners: state.runners,
    fielders: state.fielders,
    forces: computeForces(state.runners),
    outs: state.outs,
    ballX: state.ball.x,
    ballZ: state.ball.z,
    ballAirborne: state.ball.mode === 'batted' && !state.ball.rolling && state.ball.y > 1.0,
    ballHeldBy: holder,
    acquireX,
    acquireZ,
    acquireTime,
    acquireArm,
    caught: state.play.caught,
    fair: state.play.fair !== false,
    aggression,
    likelyCatch: state.play.likelyCatch,
    hangRemaining: settle,
  });

  for (const r of state.runners) {
    if (r.out || r.scored) continue;
    const before = r.scored;
    stepRunner(r, dt);
    if (!before && r.scored) scoreRun(state, r);
  }
  enforceRunnerOrder(state.runners);
}

function handleRunnerCommands(state: GameState, input: InputFrame, preplay: boolean): void {
  const live = state.runners.filter((r) => !r.out && !r.scored);
  if (live.length === 0) return;

  if (input.advanceAll) {
    for (const r of live) r.cmdTarget = Math.min(4, Math.floor(runnerAbs(r)) + 1);
    return;
  }
  if (input.returnAll) {
    for (const r of live) r.cmdTarget = r.base;
    return;
  }
  if (input.base < 0) return;

  // Map the pressed base to the runner most relevant to it.
  const targetBase = input.base === 0 ? 4 : input.base;
  // Before the pitch the modifier is what got us in here at all — it is the
  // "this is a baserunning command, not a swing" key — so it cannot *also*
  // select "go back", or a called steal would send the runner to the bag he is
  // already standing on. That is what it did: the prompt bar advertised STEAL
  // and the branch below quietly reversed it, which made a human-called steal
  // unreachable. Going back is a live-ball decision and stays one.
  if (input.modifier && !preplay) {
    // "Go back": pick the runner ahead of that base and send them back.
    const candidate = live
      .filter((r) => runnerAbs(r) > 0 && Math.floor(runnerAbs(r)) + 1 >= targetBase)
      .sort((a, b) => Math.abs(runnerAbs(a) - targetBase) - Math.abs(runnerAbs(b) - targetBase))[0];
    if (candidate) candidate.cmdTarget = Math.max(0, targetBase - 1);
    return;
  }

  const candidate = live
    .filter((r) => runnerAbs(r) < targetBase)
    .sort((a, b) => runnerAbs(b) - runnerAbs(a))[0];
  if (candidate) {
    candidate.cmdTarget = targetBase;
    if (preplay && targetBase === candidate.base + 1) candidate.stealing = true;
  } else {
    pushEvent(state, { kind: 'denied', text: `No runner can go to ${baseName(input.base)}` });
  }
}

function scoreRun(state: GameState, r: RunnerState): void {
  const bs = state.play.batterSide;
  const scorer = lookupPlayer(state, r.playerId);
  battingLine(state, bs, scorer.id).r++;
  state.stats[bs].runs++;
  addRunToLineScore(state, bs, 1);
  state.play.runs++;

  const pl = pitchingLine(state, state.pitcher.side, state.pitcher.playerId);
  pl.r++;
  if (!state.play.errorCharged) pl.er++;
  state.pitcher.runsAllowed++;

  // RBI credit unless the run scored purely on an error or a double play.
  if (!state.play.errorCharged && state.play.outcome !== 'strikeout') {
    const batter = lookupPlayer(state, state.play.batterId);
    battingLine(state, bs, batter.id).rbi++;
    state.play.rbi++;
  }
  r.justScored = true;
  pushEvent(state, { kind: 'run', text: `${scorer.lastName} scores!`, power: 0.8 });
  checkWalkOff(state);
}

function addRunToLineScore(state: GameState, side: Side, n: number): void {
  const arr = state.lineScore[side];
  while (arr.length < state.inning) arr.push(0);
  arr[state.inning - 1] += n;
}

// ---------------------------------------------------------------------------
// Outs
// ---------------------------------------------------------------------------

function checkOuts(state: GameState): void {
  const holder = state.fielders.find((f) => f.hasBall);
  if (!holder) return;
  const forces = computeForces(state.runners);

  for (let base = 0; base < 4; base++) {
    const bp = basePoint(base);
    if (dist(holder.x, holder.z, bp.x, bp.z) > 1.15) continue;
    const absBase = base === 0 ? 4 : base;

    for (const r of state.runners) {
      if (r.out || r.scored) continue;
      // Force out.
      const forcedTo = forces.get(r);
      if (forcedTo !== undefined && forcedTo === absBase && runnerAbs(r) < absBase - 1e-6) {
        callOut(state, r, 'force', base);
        continue;
      }
      // Doubling a runner off after a catch.
      if (r.mustTag && r.tagBase === base && !isOnBase(r)) {
        callOut(state, r, 'appeal', base);
      }
    }
  }

  // Tag plays.
  for (const r of state.runners) {
    if (r.out || r.scored) continue;
    if (isOnBase(r) && !r.mustTag) continue;
    const forcedTo = forces.get(r);
    // A runner standing on a base they legally hold cannot be tagged out.
    if (isOnBase(r) && forcedTo === undefined) continue;
    if (canTag(holder, r)) {
      callOut(state, r, 'tag', Math.floor(runnerAbs(r)));
    }
  }
}

function callOut(state: GameState, r: RunnerState, kind: 'force' | 'tag' | 'appeal', base: number): void {
  if (state.outs >= 3) return;
  r.out = true;
  state.play.outs++;
  if (r.isBatter) state.play.batterOut = true;
  else state.diag.texture.runnersThrownOut++;
  recordOut(state, 1);
  const p = lookupPlayer(state, r.playerId);
  pushEvent(state, {
    kind: 'out',
    text: `${p.lastName} out at ${baseName(base)}`,
    power: kind === 'tag' ? 0.7 : 0.5,
  });
}

function recordOut(state: GameState, n: number): void {
  if (state.outs >= 3) return;
  state.outs += n;
  state.pitcher.outsRecorded += n;
  pitchingLine(state, state.pitcher.side, state.pitcher.playerId).outs += n;
}

// ---------------------------------------------------------------------------
// Ending a play
// ---------------------------------------------------------------------------

function checkPlayEnd(state: GameState, dt: number): void {
  const play = state.play;
  if (!play.live) return;

  if (state.outs >= 3 || state.walkOffPending) {
    endPlay(state);
    return;
  }

  const holder = state.fielders.find((f) => f.hasBall);
  const live = state.runners.filter((r) => !r.out && !r.scored);

  // No live runners means no further outcome is possible. Ending here is both
  // correct baseball and the thing that makes fielding loops impossible.
  if (live.length === 0) {
    play.settleTimer += dt;
    if (play.settleTimer > 0.5) {
      endPlay(state);
      return;
    }
  }

  const allSettled = live.every(
    (r) => r.progress <= ON_BAG_PROGRESS + 1e-6 && r.target <= r.base + ON_BAG_PROGRESS,
  );
  const ballCalm = !!holder || (state.ball.rolling && Math.hypot(state.ball.vx, state.ball.vz) < 0.4);

  if (holder && allSettled && ballCalm) {
    play.settleTimer += dt;
    if (play.settleTimer > 0.75) {
      endPlay(state);
      return;
    }
  } else {
    play.settleTimer = 0;
  }

  if (play.clock > PLAY_TIME_LIMIT) {
    state.diag.forcedResolutions++;
    state.diag.warnings.push(
      `Play force-resolved after ${PLAY_TIME_LIMIT}s (inning ${state.inning} ${state.half}) ` +
        `ball=${state.ball.mode}@${state.ball.x.toFixed(1)},${state.ball.y.toFixed(2)},${state.ball.z.toFixed(1)} ` +
        `roll=${state.ball.rolling} holder=${holder ? holder.slot : 'none'} ` +
        `runners=[${live
          .map((r) => `${r.base}+${r.progress.toFixed(2)}->${r.target.toFixed(2)}${r.mustTag ? 'T' : ''}`)
          .join(' ')}] caught=${play.caught} fair=${play.fair}`,
    );
    for (const r of live) {
      r.target = Math.round(runnerAbs(r));
      r.progress = 0;
      r.base = clamp(Math.floor(r.target), 0, 4);
      if (r.base >= 4) {
        r.scored = true;
        scoreRun(state, r);
      }
    }
    endPlay(state);
  }
}

function endPlay(state: GameState): void {
  const play = state.play;
  play.live = false;
  const bs = play.batterSide;
  const batter = lookupPlayer(state, play.batterId);
  const line = battingLine(state, bs, batter.id);

  if (play.outcome === 'none') {
    if (play.steal) {
      // Steal attempts do not touch the plate appearance.
      resumeAfterSteal(state);
      return;
    }
    const batterRunner = state.runners.find((r) => r.isBatter);
    const reached = batterRunner && !batterRunner.out ? Math.floor(runnerAbs(batterRunner)) : 0;
    play.batterBase = batterRunner?.scored ? 4 : reached;
    line.pa++;

    if (play.fair === false) {
      // A foul fly that was CAUGHT is an out, and the plate appearance is over.
      // Falling through to endPitch here left a retired batter standing at the
      // plate with three outs on the board, still taking pitches.
      if (play.caught || play.batterOut) {
        play.outcome = 'out';
        line.ab++;
        setBanner(state, 'CAUGHT', `${batter.lastName.toUpperCase()} FOULS OUT`, 'out', 1.5);
        state.runners = state.runners.filter((r) => !r.out && !r.scored);
        settleRunnersToBases(state.runners);
        finishPlateAppearance(state);
        return;
      }
      // An uncaught foul is handled by foulBall(); arriving here means the play
      // ended some other way, so give the count back and carry on.
      line.pa--;
      endPitch(state, true);
      return;
    }

    const sacFly = play.caught && play.runs > 0 && state.outs < 3;
    const sacBunt = state.batter.swingKind === 'bunt' && play.batterOut && play.outs >= 1 && play.runs === 0 && advancedARunner(state);

    if (play.outs >= 2) state.diag.texture.doublePlays++;
    if (sacFly) state.diag.texture.sacFlies++;
    if (sacBunt) state.diag.texture.sacBunts++;

    if (play.batterOut || !batterRunner || batterRunner.out) {
      if (sacFly || sacBunt) {
        play.outcome = 'sacrifice';
      } else {
        play.outcome = 'out';
        line.ab++;
      }
      if (sacFly || sacBunt) {
        // Sacrifices do not count as at-bats.
      }
    } else if (play.errorCharged) {
      play.outcome = 'error';
      line.ab++;
    } else if (play.outs > 0 && play.batterBase === 1) {
      play.outcome = 'fielders-choice';
      line.ab++;
    } else {
      line.ab++;
      line.h++;
      state.stats[bs].hits++;
      pitchingLine(state, state.pitcher.side, state.pitcher.playerId).h++;
      if (play.batterBase >= 4) {
        play.outcome = 'homerun';
      } else if (play.batterBase === 3) {
        play.outcome = 'triple';
        line.triples++;
      } else if (play.batterBase === 2) {
        play.outcome = 'double';
        line.doubles++;
      } else {
        play.outcome = 'single';
      }
    }
    announcePlay(state, play);
  }

  state.runners = state.runners.filter((r) => !r.out && !r.scored);
  settleRunnersToBases(state.runners);
  finishPlateAppearance(state);
}

function advancedARunner(state: GameState): boolean {
  return state.runners.some((r) => !r.isBatter && !r.out && runnerAbs(r) > r.tagBase);
}

function resumeAfterSteal(state: GameState): void {
  const bs = battingSide(state);
  if (state.play.outs === 0) {
    state.diag.texture.stealsSafe++;
    for (const r of state.runners) {
      if (!r.stealing || r.out || r.scored) continue;
      battingLine(state, bs, r.playerId).sb++;
    }
    setBanner(state, 'SAFE', 'STOLEN BASE', 'hit', 1.3);
  }
  for (const r of state.runners) r.stealing = false;
  state.play = makePlayContext(state.batter.playerId, battingSide(state));
  state.runners = state.runners.filter((r) => !r.out && !r.scored);
  settleRunnersToBases(state.runners);
  endPitch(state, true);
}

function announcePlay(state: GameState, play: PlayContext): void {
  const batter = lookupPlayer(state, play.batterId);
  const name = batter.lastName.toUpperCase();
  switch (play.outcome) {
    case 'single':
      setBanner(state, 'BASE HIT', `${name} SINGLES`, 'hit', 1.7);
      break;
    case 'double':
      setBanner(state, 'INTO THE GAP', `${name} DOUBLES`, 'hit', 1.9);
      pushEvent(state, { kind: 'bigplay', power: 0.6 });
      break;
    case 'triple':
      setBanner(state, 'HE IS FLYING', `${name} TRIPLES`, 'hit', 2.1);
      pushEvent(state, { kind: 'bigplay', power: 0.8 });
      break;
    case 'error':
      setBanner(state, 'ERROR', `${name} REACHES`, 'error', 1.7);
      break;
    case 'fielders-choice':
      setBanner(state, "FIELDER'S CHOICE", `${name} REACHES`, 'out', 1.6);
      break;
    case 'sacrifice':
      setBanner(state, 'SACRIFICE', `${name} GETS HIM OVER`, 'out', 1.6);
      break;
    case 'out':
      if (play.outs >= 2) {
        setBanner(state, 'DOUBLE PLAY', 'TWO OF THEM', 'bigplay', 2.1);
        pushEvent(state, { kind: 'bigplay', power: 0.9 });
      } else if (play.caught) {
        setBanner(state, 'CAUGHT', `${name} FLIES OUT`, 'out', 1.4);
      } else {
        setBanner(state, 'OUT', `${name} GROUNDS OUT`, 'out', 1.4);
      }
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Dead ball, inning changes, game end
// ---------------------------------------------------------------------------

function updateDeadBall(state: GameState, dt: number): void {
  idleFielders(state, dt);
  for (const r of state.runners) {
    if (r.out || r.scored) continue;
    r.target = r.base;
    stepRunner(r, dt);
  }
  const wait = state.play.homeRunCelebration ? 3.4 : 1.35;
  if (state.phaseT < wait) return;

  if (state.gameOver) {
    setPhase(state, 'final');
    return;
  }
  if (state.setup.practice && state.outs >= 3) {
    endHalfInning(state);
    return;
  }
  if (state.outs >= 3) {
    endHalfInning(state);
    return;
  }
  startAtBat(state);
}

function endHalfInning(state: GameState): void {
  // Practice drills never change sides or end: three outs simply resets the
  // situation so the player keeps repeating the thing they are learning.
  if (state.setup.practice) {
    state.runners = [];
    state.outs = 0;
    setBanner(state, 'RESET', 'THREE OUTS — KEEP GOING', 'info', 1.4);
    startAtBat(state);
    return;
  }
  const bs = battingSide(state);
  const stranded = state.runners.filter((r) => !r.out && !r.scored).length;
  state.stats[bs].lob += stranded;
  state.diag.texture.lob += stranded;
  state.runners = [];
  state.outs = 0;

  if (state.half === 'top') {
    state.half = 'bottom';
  } else {
    state.half = 'top';
    state.inning++;
  }

  const os = battingSide(state);
  while (state.lineScore[os].length < state.inning) state.lineScore[os].push(0);

  if (checkGameEnd(state)) return;
  setPhase(state, 'inningbreak');
}

/** Returns true when the game is over. */
function checkGameEnd(state: GameState): boolean {
  const regulation = state.setup.innings;
  const away = state.stats.away.runs;
  const home = state.stats.home.runs;

  // We arrive here after a half-inning flip, so `state.half` is the upcoming half.
  const completed = state.half === 'top' ? state.inning - 1 : state.inning;

  if (completed >= regulation) {
    if (state.half === 'top' && away !== home) {
      finalize(state, false);
      return true;
    }
    // Home team leads after the top of the final inning: no need to bat.
    if (state.half === 'bottom' && home > away) {
      finalize(state, false);
      return true;
    }
  }
  return false;
}

/**
 * Marks a walk-off. Finalisation is deliberately deferred to the end of the
 * plate appearance: snapshotting the result the instant the winning run touches
 * home would freeze the box score before the hit, the RBI and the batter's own
 * run had been credited.
 */
function checkWalkOff(state: GameState): void {
  if (state.gameOver || state.walkOffPending) return;
  const regulation = state.setup.innings;
  if (state.half !== 'bottom' || state.inning < regulation) return;
  if (state.stats.home.runs > state.stats.away.runs) {
    state.walkOff = true;
    state.walkOffPending = true;
  }
}

function finalize(state: GameState, walkOff: boolean): void {
  if (state.gameOver) return;
  state.gameOver = true;
  state.walkOff = walkOff;
  state.result = finishGame(state);
  const away = state.stats.away.runs;
  const home = state.stats.home.runs;
  const winner = home > away ? state.home : state.away;
  setBanner(
    state,
    walkOff ? 'WALK-OFF!' : 'FINAL',
    `${winner.city.toUpperCase()} ${winner.name.toUpperCase()} WIN ${Math.max(away, home)}-${Math.min(away, home)}`,
    'final',
    4,
  );
  pushEvent(state, { kind: 'gameover', text: 'FINAL', power: 1 });
  if (state.phase !== 'deadball') setPhase(state, 'final');
}

// ---------------------------------------------------------------------------
// Pitching changes
// ---------------------------------------------------------------------------

function maybeChangePitcher(state: GameState): void {
  const side = fieldingSide(state);
  const team = teamOf(state, side);
  const isHuman = controllerFor(state, side) !== null;
  if (isHuman) return; // humans change arms from the pause menu

  const used = state.pitcherIdx[side];
  const bullpen = team.bullpen;
  if (used >= bullpen.length) return;

  const runDiff = state.stats[side].runs - state.stats[side === 'away' ? 'home' : 'away'].runs;
  if (
    shouldPullPitcher(state.pitcher, state.inning, state.setup.innings, runDiff, bullpen.length - used)
  ) {
    changePitcher(state, side, bullpen[used]);
    state.pitcherIdx[side] = used + 1;
  }
}

export function changePitcher(state: GameState, side: Side, newPitcherId: string): void {
  const team = teamOf(state, side);
  const p = playerById(team, newPitcherId);
  state.defense[side][PITCHER_SLOT] = p.id;
  if (fieldingSide(state) === side) {
    state.fielders[PITCHER_SLOT] = makeFielder(p, PITCHER_SLOT);
    state.pitcher = {
      playerId: p.id,
      side,
      stamina: 1,
      pitchCount: 0,
      usage: {},
      recent: [],
      outsRecorded: 0,
      runsAllowed: 0,
      earnedRuns: 0,
      aimX: 0,
      aimY: ZONE_CENTER_Y,
      selected: 0,
      ready: 0.5,
    };
    setBanner(state, 'PITCHING CHANGE', `${p.firstName} ${p.lastName}`.toUpperCase(), 'info', 2);
  }
}

// ---------------------------------------------------------------------------
// Helpers used by the presentation layer
// ---------------------------------------------------------------------------

export { emptyInput };
