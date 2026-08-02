import type {
  BattingLine,
  Difficulty,
  GameResult,
  GameSetup,
  PitchType,
  PitchingLine,
  Player,
  Stadium,
  Team,
} from '../core/types';
import { emptyBattingLine, emptyPitchingLine } from '../core/types';
import { Rng } from '../core/rng';
import { getStadium } from '../data/stadiums';
import { playerById } from '../data/teams';
import { type Ball, makeBall } from './physics';
import { CONTACT_Z, ZONE_CENTER_Y } from '../core/constants';

export type Side = 'away' | 'home';

/**
 * How the defence is standing before the pitch. This is the manager's decision
 * in baseball and it is a genuine trade, not a cosmetic one:
 *
 * - `normal`    the honest alignment; no strength, no hole.
 * - `dp`        middle infielders cheat toward second so they can turn two,
 *               which widens the hole on both sides of the bag.
 * - `in`        the infield plays on the grass to cut a run off at the plate.
 *               Balls that would have been outs now shoot through.
 * - `nodoubles` outfielders play deep and the corners guard the lines. Nothing
 *               gets past you; ordinary singles fall in all day.
 * - `corners`   first and third crash for a bunt, leaving the corners exposed.
 */
export type DefensiveAlignment = 'normal' | 'dp' | 'in' | 'nodoubles' | 'corners';

export const ALIGNMENT_LABEL: Record<DefensiveAlignment, string> = {
  normal: 'NORMAL',
  dp: 'DOUBLE-PLAY DEPTH',
  in: 'INFIELD IN',
  nodoubles: 'NO DOUBLES',
  corners: 'CORNERS IN',
};

export const ALIGNMENT_SHORT: Record<DefensiveAlignment, string> = {
  normal: 'NORMAL',
  dp: 'DP DEPTH',
  in: 'INFIELD IN',
  nodoubles: 'NO DOUBLES',
  corners: 'CORNERS',
};

export type Phase =
  | 'lineup' // pre-game presentation
  | 'preplay' // defence set, pitcher choosing
  | 'windup' // pitcher committed
  | 'pitch' // ball in flight to the plate
  | 'inplay' // batted ball live
  | 'deadball' // play over, showing the result
  | 'inningbreak'
  | 'final';

export interface FielderState {
  playerId: string;
  /** 0..8, index into FIELD_SLOTS. */
  slot: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Home position for the current defensive alignment. */
  homeX: number;
  homeZ: number;
  /** Where this fielder is currently trying to be. */
  tx: number;
  tz: number;
  maxSpeed: number;
  armSpeed: number;
  fielding: number;
  reaction: number;
  /** Counts down before the fielder starts reacting to a batted ball. */
  reactDelay: number;
  hasBall: boolean;
  /** Seconds left before this fielder can release a throw. */
  transfer: number;
  role: 'chase' | 'cover' | 'backup' | 'cut' | 'idle';
  /** Base index this fielder is covering, or -1. */
  coverBase: number;
  diveT: number;
  diveDirX: number;
  diveDirZ: number;
  jumpT: number;
  /** Visual only: which way the model faces. */
  facing: number;
  /** True while a human is steering this fielder. */
  humanControlled: boolean;
  /** Set for one frame when the fielder makes an error. */
  errorFlash: number;
}

export interface RunnerState {
  playerId: string;
  /** Last base legally touched: 0 = batter's box, 1/2/3 = bases. */
  base: number;
  /** 0..1 along the path from `base` to `base + 1`. */
  progress: number;
  /** Absolute base this runner is trying to reach (1..4; 4 = home). */
  target: number;
  /** Human override of `target`, cleared when the play ends. */
  cmdTarget: number | null;
  speed: number;
  out: boolean;
  scored: boolean;
  isBatter: boolean;
  /** True while the runner must return and re-touch after a catch. */
  mustTag: boolean;
  /** Base the runner occupied when the pitch was thrown (for tag-ups). */
  tagBase: number;
  /** Visual slide timer. */
  slide: number;
  /** Seconds of hesitation left before the runner commits. */
  leadHold: number;
  /** Marks the runner who scored / was put out most recently, for callouts. */
  justScored: boolean;
  /** True while stealing, so the catcher AI can respond. */
  stealing: boolean;
}

export type SwingKind = 'contact' | 'power' | 'bunt' | 'none';

export interface BatterState {
  playerId: string;
  /** Contact-cursor centre, in the contact plane. */
  cx: number;
  cy: number;
  /** Seconds since the swing started; < 0 means not swinging. */
  swingT: number;
  swingKind: SwingKind;
  /** True once this swing has been resolved (hit or miss). */
  swingResolved: boolean;
  /** Set when the batter is squared to bunt. */
  bunting: boolean;
  /** Visual follow-through timer. */
  animT: number;
  /** Set for the check-swing ruling. */
  checked: boolean;
}

export interface PitcherRuntime {
  playerId: string;
  side: Side;
  /** 0..1, drops as the pitcher works. */
  stamina: number;
  pitchCount: number;
  /** Counts of each pitch type thrown this appearance, for the pattern AI. */
  usage: Partial<Record<PitchType, number>>;
  recent: PitchType[];
  outsRecorded: number;
  runsAllowed: number;
  earnedRuns: number;
  /** Aim reticle position in the contact plane. */
  aimX: number;
  aimY: number;
  selected: number;
  /** Seconds until the pitcher may throw again. */
  ready: number;
}

export interface PitchInFlight {
  type: PitchType;
  speedMs: number;
  /** Where the ball actually crosses the plate. */
  plateX: number;
  plateY: number;
  /** Where the pitcher aimed. */
  aimX: number;
  aimY: number;
  inZone: boolean;
  /** Total flight time. */
  T: number;
  /**
   * Where the pitch was *released* toward before break and steering, so the
   * plate view can draw the shape the ball is going to take.
   */
  entryX: number;
  entryY: number;
}

/** What a pitch did, once it is over. Presentation only — never read by rules. */
export type PitchLogResult =
  | 'ball'
  | 'called'
  | 'swinging'
  | 'foul'
  | 'inplay'
  | 'hitbypitch';

export interface PitchLogEntry {
  type: PitchType;
  /** Plate crossing point. */
  x: number;
  y: number;
  speedMs: number;
  inZone: boolean;
  result: PitchLogResult;
  /** The count *before* this pitch, so the log reads like a scorecard. */
  balls: number;
  strikes: number;
}

/**
 * The last swing, kept alive for a second or so purely so the HUD can explain
 * what went wrong. Nothing in the rules or the physics reads this.
 */
export interface SwingFeedback {
  kind: SwingKind;
  grade: string;
  /** Signed, in units of the swing's own tolerance. */
  timingNorm: number;
  vertNorm: number;
  horizNorm: number;
  timingLabel: string;
  planeLabel: string;
  note: string;
  /** Seconds of display life remaining. */
  t: number;
}

export type PlayOutcome =
  | 'single'
  | 'double'
  | 'triple'
  | 'homerun'
  | 'out'
  | 'error'
  | 'fielders-choice'
  | 'sacrifice'
  | 'foul'
  | 'strikeout'
  | 'walk'
  | 'hitbypitch'
  | 'none';

export interface PlayContext {
  live: boolean;
  /** null until the fair/foul call is locked in. */
  fair: boolean | null;
  caught: boolean;
  /** Outs recorded on this play. */
  outs: number;
  runs: number;
  rbi: number;
  batterId: string;
  batterSide: Side;
  outcome: PlayOutcome;
  /** Highest base the batter reached. */
  batterBase: number;
  batterOut: boolean;
  errorCharged: boolean;
  hardHit: boolean;
  exitVelo: number;
  launchAngle: number;
  sprayAngle: number;
  distance: number;
  hangTime: number;
  /** Seconds the play has been live; guards against stalls. */
  clock: number;
  /** True once everything has come to rest. */
  settleTimer: number;
  /** Set when the ball leaves the yard so presentation can react. */
  homeRunCelebration: boolean;
  /** True when this "play" is a stolen-base attempt rather than a batted ball. */
  steal: boolean;
  /** Set while a fly ball is still catchable, for baserunner logic. */
  likelyCatch: boolean;
  description: string;
}

export interface GameEvent {
  kind:
    | 'ball'
    | 'strike'
    | 'foul'
    | 'swingmiss'
    | 'contact'
    | 'catch'
    | 'groundfield'
    | 'throw'
    | 'out'
    | 'safe'
    | 'run'
    | 'homerun'
    | 'strikeout'
    | 'walk'
    | 'hitbypitch'
    | 'inning'
    | 'wall'
    | 'error'
    | 'steal'
    | 'gameover'
    | 'bigplay'
    | 'slide'
    | 'denied'
    | 'defense'
    | 'wildpitch'
    | 'pitchrelease';
  /** Free-form text shown by the HUD banner (may be empty). */
  text?: string;
  /** Extra magnitude 0..1 used to scale audio and camera reactions. */
  power?: number;
  x?: number;
  y?: number;
  z?: number;
  id?: number;
}

export interface TeamGameStats {
  runs: number;
  hits: number;
  errors: number;
  lob: number;
  batting: Record<string, BattingLine>;
  pitching: Record<string, PitchingLine>;
}

function emptyTeamStats(): TeamGameStats {
  return { runs: 0, hits: 0, errors: 0, lob: 0, batting: {}, pitching: {} };
}

export interface GameState {
  setup: GameSetup;
  stadium: Stadium;
  away: Team;
  home: Team;
  rng: Rng;
  difficulty: Difficulty;

  phase: Phase;
  phaseT: number;
  /** Total simulated seconds, for animation and diagnostics. */
  clock: number;

  inning: number;
  half: 'top' | 'bottom';
  outs: number;
  balls: number;
  strikes: number;

  lineScore: { away: number[]; home: number[] };
  stats: { away: TeamGameStats; home: TeamGameStats };

  battingIdx: { away: number; home: number };
  pitcherIdx: { away: number; home: number };
  /** Fielding assignments (player ids) per slot for each side. */
  defense: { away: string[]; home: string[] };

  ball: Ball;
  fielders: FielderState[];
  runners: RunnerState[];
  batter: BatterState;
  pitcher: PitcherRuntime;
  currentPitch: PitchInFlight | null;
  /** Every pitch of the current plate appearance, oldest first. Display only. */
  pitchLog: PitchLogEntry[];
  /** Display-only readout of the most recent swing; see SwingFeedback. */
  lastSwing: SwingFeedback | null;
  play: PlayContext;

  events: GameEvent[];
  /** Monotonic id so the presentation layer can consume events exactly once. */
  eventSeq: number;

  /** Banner text and its remaining lifetime. */
  banner: { text: string; sub: string; t: number; kind: string };

  gameOver: boolean;
  result: GameResult | null;
  walkOff: boolean;
  /** Walk-off detected but not yet finalised; see checkWalkOff in game.ts. */
  walkOffPending: boolean;

  /** Transient CPU-hitter read for the pitch currently in flight. */
  cpuRead: import('./ai').BatterRead | null;
  cpuSwingAt: number | null;
  /** Slot of the fielder currently pursuing the ball. */
  chaseSlot: number;

  /** How the defence is standing for this pitch. Read by the fielder AI. */
  alignment: DefensiveAlignment;
  /**
   * True when the human on defence chose this alignment rather than the manager
   * AI. A human choice sticks until they change it or the situation resets at
   * the start of a new plate appearance.
   */
  alignmentLocked: boolean;
  /**
   * Set when the pitcher is deliberately not giving the hitter anything to hit.
   * `around` still permits a strike on the black; `intentional` is the free pass.
   */
  pitchAround: 'none' | 'around' | 'intentional';
  /** Pull-side shift for this hitter, kept so alignment changes preserve it. */
  pullShift: number;

  /** Seconds the human on defence has given no movement input. */
  defenseIdleT: number;
  /** True while the CPU is pursuing on the human's behalf; see updateDefense. */
  autoFielding: boolean;
  /** Cached landing prediction, shared by fielder AI and the catch marker. */
  predictX: number;
  predictZ: number;
  predictT: number;
  /** Where the ball in the air is being thrown, and who is supposed to catch it. */
  throwTargetX: number;
  throwTargetZ: number;
  throwReceiver: number;
  /** Shared projection of the loose ball's path, recomputed at 20 Hz. */
  traj: import('./trajectory').TrajSample[];
  trajT: number;

  /** Diagnostics used by the automated simulation suite. */
  diag: {
    pitches: number;
    plays: number;
    forcedResolutions: number;
    /** Pitch-level outcome tally, used to balance the count game. */
    ballsThrown: number;
    calledStrikes: number;
    swingMisses: number;
    fouls: number;
    ballsInPlay: number;
    swings: number;
    inZone: number;
    /**
     * Baseball-texture tallies. Batting average alone cannot tell you whether a
     * game *feels* like baseball: two engines can both hit .275 while one turns
     * double plays and steals bases and the other never does. These counters are
     * what the balance harness reads to keep the situational game honest.
     */
    texture: {
      doublePlays: number;
      sacFlies: number;
      sacBunts: number;
      stealAttempts: number;
      stealsSafe: number;
      /** Runners stranded at the end of each half-inning. */
      lob: number;
      wildPitches: number;
      passedBalls: number;
      intentionalWalks: number;
      /** Outs recorded on runners other than the batter. */
      runnersThrownOut: number;
      /** Pitches thrown with each defensive alignment in force. */
      alignment: Record<DefensiveAlignment, number>;
    };
    warnings: string[];
  };
}

export function battingSide(state: GameState): Side {
  return state.half === 'top' ? 'away' : 'home';
}

export function fieldingSide(state: GameState): Side {
  return state.half === 'top' ? 'home' : 'away';
}

export function teamOf(state: GameState, side: Side): Team {
  return side === 'away' ? state.away : state.home;
}

export function currentBatter(state: GameState): Player {
  const side = battingSide(state);
  const team = teamOf(state, side);
  const id = team.lineup[state.battingIdx[side] % team.lineup.length];
  return playerById(team, id);
}

export function currentPitcher(state: GameState): Player {
  const side = fieldingSide(state);
  const team = teamOf(state, side);
  return playerById(team, state.pitcher.playerId || team.rotation[0]);
}

export function lookupPlayer(state: GameState, id: string): Player {
  const a = state.away.players.find((p) => p.id === id);
  if (a) return a;
  const h = state.home.players.find((p) => p.id === id);
  if (h) return h;
  return state.away.players[0];
}

export function battingLine(state: GameState, side: Side, playerId: string): BattingLine {
  const s = state.stats[side];
  if (!s.batting[playerId]) s.batting[playerId] = emptyBattingLine();
  return s.batting[playerId];
}

export function pitchingLine(state: GameState, side: Side, playerId: string): PitchingLine {
  const s = state.stats[side];
  if (!s.pitching[playerId]) s.pitching[playerId] = emptyPitchingLine();
  return s.pitching[playerId];
}

export function makePlayContext(batterId: string, batterSide: Side): PlayContext {
  return {
    live: false,
    fair: null,
    caught: false,
    outs: 0,
    runs: 0,
    rbi: 0,
    batterId,
    batterSide,
    outcome: 'none',
    batterBase: 0,
    batterOut: false,
    errorCharged: false,
    hardHit: false,
    exitVelo: 0,
    launchAngle: 0,
    sprayAngle: 0,
    distance: 0,
    hangTime: 0,
    clock: 0,
    settleTimer: 0,
    homeRunCelebration: false,
    steal: false,
    likelyCatch: false,
    description: '',
  };
}

export function createGameState(setup: GameSetup, away: Team, home: Team): GameState {
  const stadium: Stadium = getStadium(setup.stadiumId);
  const rng = new Rng(setup.seed);

  const state: GameState = {
    setup,
    stadium,
    away,
    home,
    rng,
    difficulty: setup.difficulty,
    phase: 'lineup',
    phaseT: 0,
    clock: 0,
    inning: 1,
    half: 'top',
    outs: 0,
    balls: 0,
    strikes: 0,
    lineScore: { away: [], home: [] },
    stats: { away: emptyTeamStats(), home: emptyTeamStats() },
    battingIdx: { away: 0, home: 0 },
    pitcherIdx: { away: 0, home: 0 },
    defense: { away: [...away.defense], home: [...home.defense] },
    ball: makeBall(),
    fielders: [],
    runners: [],
    batter: {
      playerId: '',
      cx: 0,
      cy: ZONE_CENTER_Y,
      swingT: -1,
      swingKind: 'none',
      swingResolved: false,
      bunting: false,
      animT: 0,
      checked: false,
    },
    pitcher: {
      playerId: '',
      side: 'home',
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
    },
    currentPitch: null,
    pitchLog: [],
    lastSwing: null,
    play: makePlayContext('', 'away'),
    events: [],
    eventSeq: 0,
    banner: { text: '', sub: '', t: 0, kind: '' },
    gameOver: false,
    result: null,
    walkOff: false,
    walkOffPending: false,
    cpuRead: null,
    cpuSwingAt: null,
    chaseSlot: 0,
    alignment: 'normal',
    alignmentLocked: false,
    pitchAround: 'none',
    pullShift: 0,
    defenseIdleT: 0,
    autoFielding: false,
    predictX: 0,
    predictZ: 0,
    predictT: 0,
    throwTargetX: 0,
    throwTargetZ: 0,
    throwReceiver: -1,
    traj: [],
    trajT: 0,
    diag: {
      pitches: 0,
      plays: 0,
      forcedResolutions: 0,
      ballsThrown: 0,
      calledStrikes: 0,
      swingMisses: 0,
      fouls: 0,
      ballsInPlay: 0,
      swings: 0,
      inZone: 0,
      texture: {
        doublePlays: 0,
        sacFlies: 0,
        sacBunts: 0,
        stealAttempts: 0,
        stealsSafe: 0,
        lob: 0,
        wildPitches: 0,
        passedBalls: 0,
        intentionalWalks: 0,
        runnersThrownOut: 0,
        alignment: { normal: 0, dp: 0, in: 0, nodoubles: 0, corners: 0 },
      },
      warnings: [],
    },
  };

  state.ball.z = CONTACT_Z;
  return state;
}

export function pushEvent(state: GameState, ev: GameEvent): void {
  state.eventSeq++;
  state.events.push({ ...ev, id: state.eventSeq });
  if (state.events.length > 64) state.events.splice(0, state.events.length - 64);
}

export function setBanner(state: GameState, text: string, sub = '', kind = 'info', t = 2.2): void {
  state.banner = { text, sub, t, kind };
}
