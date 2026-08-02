/** Shared data model for MOONSHOT NINE. */

export type Handedness = 'L' | 'R' | 'S';

export type PositionCode = 'P' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF' | 'DH';

/** Fielding slots, indexed the way scorekeepers number them (1..9 => 0..8). */
export const FIELD_SLOTS: readonly PositionCode[] = [
  'P',
  'C',
  '1B',
  '2B',
  '3B',
  'SS',
  'LF',
  'CF',
  'RF',
];

export type PitchType =
  | 'fastball'
  | 'heater'
  | 'changeup'
  | 'curve'
  | 'slider'
  | 'screwball'
  | 'sinker'
  | 'cutter'
  | 'knuckler'
  | 'splitter';

export interface PitchProfile {
  type: PitchType;
  /** Display name shown in the pitch selector. */
  label: string;
  /** Short tag for the HUD. */
  short: string;
  /** Base velocity in m/s before the pitcher's velocity attribute is applied. */
  speed: number;
  /** How much the pitcher's velocity rating moves this pitch, m/s. */
  speedSpan: number;
  /** Horizontal break, metres, positive = toward the pitcher's arm side. */
  breakX: number;
  /** Vertical break, metres. Positive = "rises" (fights gravity), negative = drops. */
  breakY: number;
  /** Extra spread on execution error (knuckleballs are wild by nature). */
  wildness: number;
  /** How late in the flight the break arrives (0 = immediate, 1 = all at the end). */
  lateness: number;
  /** Colour used for the pitch trail and the selector chip. */
  color: number;
}

export interface BatterAttributes {
  contact: number;
  power: number;
  speed: number;
  arm: number;
  fielding: number;
  reaction: number;
  discipline: number;
}

export interface PitcherAttributes {
  velocity: number;
  control: number;
  movement: number;
  stamina: number;
  composure: number;
}

export type BodyType = 'slim' | 'average' | 'stocky' | 'tall' | 'huge';

export interface Player {
  id: string;
  firstName: string;
  lastName: string;
  number: number;
  bats: Handedness;
  throws: Handedness;
  primary: PositionCode;
  secondary: PositionCode[];
  body: BodyType;
  /** 0..1 — drives the low-poly skin swatch index. */
  skinTone: number;
  bat: BatterAttributes;
  pitch?: PitcherAttributes;
  repertoire?: PitchType[];
  /** Marked on the handful of league-defining stars. */
  star?: boolean;
  /** Short flavour line shown on the player card. */
  trait?: string;
  /** True for user-created players so the editor can find them. */
  custom?: boolean;
}

export interface TeamIdentity {
  id: string;
  city: string;
  name: string;
  abbr: string;
  division: 'tide' | 'ridge';
  primary: number;
  secondary: number;
  accent: number;
  /** Which of the eight logo glyphs this club uses. */
  logo: string;
  homeStadium: string;
  motto: string;
}

export interface Team extends TeamIdentity {
  players: Player[];
  /** Player ids, batting order 1..9. */
  lineup: string[];
  /** Player id per fielding slot, aligned with FIELD_SLOTS. */
  defense: string[];
  /** Player ids: starters then relievers. */
  rotation: string[];
  bullpen: string[];
}

export interface FenceNode {
  /** Spray angle in degrees, -45 (LF line) .. +45 (RF line). */
  angle: number;
  /** Distance from home plate, metres. */
  dist: number;
  /** Wall height, metres. */
  height: number;
}

export interface Stadium {
  id: string;
  name: string;
  city: string;
  blurb: string;
  fence: FenceNode[];
  /** Multiplies batted-ball carry. 1.0 = neutral. */
  carry: number;
  /** Steady wind, m/s, in world space. Small by design. */
  wind: { x: number; z: number };
  /** true = always lit like a night game regardless of the day/night toggle. */
  domed: boolean;
  turf: boolean;
  palette: {
    grass: number;
    grassAlt: number;
    dirt: number;
    wall: number;
    wallTrim: number;
    stands: number;
    sky: number;
    skyNight: number;
    structure: number;
  };
  /** Decorative silhouette behind the outfield wall. */
  skyline: 'towers' | 'mesa' | 'dome' | 'bayou' | 'peaks' | 'stacks' | 'forest' | 'plains';
}

export type Difficulty = 'rookie' | 'pro' | 'allstar';

export type ControlMode = 'human1' | 'human2' | 'cpu';

export type PracticeDrill = 'batting' | 'pitching' | 'fielding' | 'baserunning';

export interface GameSetup {
  awayTeamId: string;
  homeTeamId: string;
  stadiumId: string;
  innings: number;
  difficulty: Difficulty;
  awayControl: ControlMode;
  homeControl: ControlMode;
  night: boolean;
  seed: number;
  /** Season/championship games carry this so results can be routed back. */
  contextId?: string;
  /** When set, the game runs as an endless drill instead of a real contest. */
  practice?: PracticeDrill;
}

export interface BattingLine {
  ab: number;
  r: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  bb: number;
  /** Hit by pitch. Kept separate from BB so the two ledgers reconcile. */
  hbp: number;
  so: number;
  sb: number;
  pa: number;
}

export interface PitchingLine {
  outs: number;
  h: number;
  r: number;
  er: number;
  bb: number;
  hbp: number;
  so: number;
  hr: number;
  pitches: number;
  w: number;
  l: number;
  sv: number;
  /** Wild pitches charged to this pitcher. */
  wp: number;
}

export function emptyBattingLine(): BattingLine {
  return { ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, hbp: 0, so: 0, sb: 0, pa: 0 };
}

export function emptyPitchingLine(): PitchingLine {
  return { outs: 0, h: 0, r: 0, er: 0, bb: 0, hbp: 0, so: 0, hr: 0, pitches: 0, w: 0, l: 0, sv: 0, wp: 0 };
}

export interface GameResult {
  awayTeamId: string;
  homeTeamId: string;
  awayRuns: number;
  homeRuns: number;
  awayHits: number;
  homeHits: number;
  awayErrors: number;
  homeErrors: number;
  innings: number;
  lineScore: { away: number[]; home: number[] };
  batting: Record<string, BattingLine>;
  pitching: Record<string, PitchingLine>;
  winningPitcherId?: string;
  losingPitcherId?: string;
  savePitcherId?: string;
  walkOff: boolean;
  contextId?: string;
}
