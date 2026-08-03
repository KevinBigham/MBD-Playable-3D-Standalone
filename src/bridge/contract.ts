/**
 * THE MBD ARCADE WORLD BRIDGE — v1 contract.
 * ==========================================
 *
 * MBD, the dynasty sim, owns a world: thirty-two franchises, their rosters,
 * every player's ratings and age and injury and story. The arcade game owns a
 * game: a bat, a ball, nine fielders and a person holding a phone. This file is
 * the seam between them, and it is deliberately only a *description* — no
 * behaviour, no defaults, no conveniences. Everything here is transcribed from
 * the handoff contract rather than invented locally, because the entire value
 * of a bridge is that both ends agree about what the words mean.
 *
 * THE RULE THAT SHAPES EVERYTHING ELSE: **MBD is the world authority.** This
 * game never owns contracts, promotions, trades, ratings development, schedule
 * progression, standings, or save history. It owns the game in progress, and it
 * hands back a receipt of what happened. Anything in here that looks like it
 * could become a place to store a fact about the world is a mistake.
 *
 * Two consequences worth stating out loud, because they are easy to violate by
 * being helpful:
 *
 *   IDs ARE THE JOINS. Never match a player or a team by name. Names change,
 *   names collide, and two brothers on the same club is a normal thing that
 *   would silently corrupt a save.
 *
 *   DERIVED IS NOT CANONICAL. MBD has no handedness, jersey number, height,
 *   pitch repertoire, stadium or weather. This game needs all of those to draw
 *   anything at all, so it makes them up — visibly, deterministically, and
 *   marked as `derived_arcade_v1` so nothing ever writes them back as truth.
 *
 * A NOTE ON THE NAME. The arcade game is now called Mr. Baseball Dynasty too,
 * which makes "MBD" ambiguous in exactly the place it can least afford to be.
 * Throughout `bridge/`, **MBD** means the dynasty sim — the world authority on
 * the other side of this seam — and **the arcade game** means this one. The
 * wire format keeps its `mbd-arcade-*` names, which were agreed in the handoff
 * and are not ours to rename.
 *
 * The canonical source map lives in the handoff. Re-check it rather than
 * trusting this file forever; these are someone else's facts.
 */

// ---------------------------------------------------------------- the envelope

export const BRIDGE_VERSION = 1;
export const BUNDLE_FORMAT = 'mbd-arcade-world';
export const RECEIPT_FORMAT = 'mbd-arcade-game-receipt';

export type BundleMode = 'exhibition' | 'dynasty_scheduled_game';

export interface MbdArcadeWorldBundleV1 {
  format: typeof BUNDLE_FORMAT;
  bridgeVersion: 1;
  mode: BundleMode;
  source: ArcadeSourceBinding;
  league: ArcadeLeague;
  teams: ArcadeTeam[];
  organizations: ArcadeOrganizationRoster[];
  players: ArcadePlayer[];
  presentation: ArcadePresentationContext;
  game: ArcadeGameContext | null;
}

export interface ArcadeSourceBinding {
  game: 'Mr. Baseball Dynasty';
  /** Observed live value when the contract was written: 48. */
  snapshotSchemaVersion: number;
  /** Supplied by MBD's save coordinator; it is not inside GameSnapshot. */
  saveId: string | null;
  season: number;
  day: number;
  phase: 'preseason' | 'regular' | 'playoffs' | 'offseason';
  /** Hash of the canonical accepted source snapshot, not a wall-clock token. */
  sourceSnapshotHash: string;
  /** Hash of this bundle with this field omitted. */
  bundleHash: string;
}

// -------------------------------------------------------------- league & rules

export type ArcadePosition =
  | 'C'
  | '1B'
  | '2B'
  | '3B'
  | 'SS'
  | 'LF'
  | 'CF'
  | 'RF'
  | 'DH'
  | 'SP'
  | 'RP'
  | 'CL';

export type ArcadeLevel = 'MLB' | 'AAA' | 'AA' | 'A_PLUS' | 'A' | 'ROOKIE' | 'INTERNATIONAL';

export type ArcadeRosterStatus = ArcadeLevel | 'FREE_AGENT' | 'RETIRED';

export type ArcadeDivision =
  | 'AL_EAST'
  | 'AL_CENTRAL'
  | 'AL_WEST'
  | 'NL_EAST'
  | 'NL_CENTRAL'
  | 'NL_WEST';

export interface ArcadeLeague {
  id: 'mbd';
  name: 'Mr. Baseball Dynasty';
  positions: ArcadePosition[];
  organizationLevels: ArcadeLevel[];
  playerStatuses: ArcadeRosterStatus[];
  rules: {
    regulationInnings: 9;
    battingOrderSize: 9;
    activeRosterLimit: 26;
    fortyManRosterLimit: 40;
    defaultRotationSize: 5;
    designatedHitter: true;
  };
}

// ----------------------------------------------------------------------- teams

export interface ArcadeTeam {
  id: string;
  city: string;
  name: string;
  fullName: string;
  abbreviation: string;
  division: ArcadeDivision;
  /**
   * MBD's team/advanced-stat park adjustment; 1.00 is neutral.
   *
   * Read the handoff's warning carefully: MBD's own season simulator does not
   * currently pass this into plate-appearance resolution, so there is no
   * "simulation parity" to inherit. A receiving game has to make one explicit,
   * tested decision about what a park factor means in actual play. Ours is in
   * `adapt.ts`: it picks the ballpark, it is not a multiplier laid on top of one.
   */
  parkFactor: number;
  branding: {
    /** CSS hex, e.g. `#1a1a4e`. */
    background: string;
    text: string;
    accent: string;
    /** Path relative to the MBD web public root. */
    logoAsset: string;
  };
  identity: {
    archetype: string | null;
    franchiseHook: string | null;
    marketSize: 'large' | 'medium' | 'small' | null;
  };
}

// --------------------------------------------------------------------- players

/**
 * One rating, in every scale anyone downstream might want.
 *
 * `internal` is the only canonical one. The other three are conveniences, and
 * the contract is explicit that a derived 20–80 or 0–99 value must never be
 * round-tripped back into MBD — doing so would quietly degrade the source
 * rating to whatever precision this game happened to like. Everything in this
 * codebase therefore derives from `internal` and ignores the rest.
 */
export interface ArcadeRating {
  /** Canonical MBD gameplay value. Integer 0..550. */
  internal: number;
  /** Canonical MBD public/scouting scale. Integer 20..80. */
  display: number;
  /** Receiver convenience derived from internal. 0..1. */
  normalized: number;
  /** Arcade UI convenience; never becomes MBD truth. Integer 0..99. */
  arcade99: number;
}

export interface ArcadeHitterRatings {
  contact: ArcadeRating;
  power: ArcadeRating;
  eye: ArcadeRating;
  speed: ArcadeRating;
  defense: ArcadeRating;
  durability: ArcadeRating;
}

export interface ArcadePitcherRatings {
  stuff: ArcadeRating;
  control: ArcadeRating;
  stamina: ArcadeRating;
  velocity: ArcadeRating;
  movement: ArcadeRating;
}

export type ArcadeAvailabilityReason =
  | 'available'
  | 'injured'
  | 'rehab'
  | 'shutdown'
  | 'workload_limit_reached'
  | 'not_active';

export interface ArcadePlayer {
  id: string;
  teamId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  age: number;
  nationality: 'american' | 'latin' | 'asian';
  primaryPosition: ArcadePosition;
  rosterStatus: ArcadeRosterStatus;
  minorLeagueLevel: Exclude<ArcadeLevel, 'MLB'> | null;
  /**
   * True only when canonical pitcher attributes are present. Position text
   * alone is not enough — and note the reverse is not a special case either:
   * *every* MBD player has hitter attributes, so a pitcher who can hit is
   * simply a pitcher who can hit, and stays that way here.
   */
  canPitch: boolean;
  hitter: ArcadeHitterRatings;
  pitcher: ArcadePitcherRatings | null;
  overall: ArcadeRating;
  personality: {
    workEthic: number;
    mentalToughness: number;
    leadership: number;
    competitiveness: number;
    traits: string[];
  };
  availability: {
    eligible: boolean;
    reason: ArcadeAvailabilityReason;
    injuryType: string | null;
    injurySeverity: 'day_to_day' | 'il_10' | 'il_15' | 'il_60' | 'season_ending' | null;
    daysRemaining: number | null;
    injuryAttributePenalty: number | null;
    rehabPlan: 'accelerated' | 'standard' | 'cautious' | null;
    workloadMode: 'innings_limit' | 'shutdown' | null;
    workloadLimitOuts: 360 | 450 | 540 | null;
  };
  /**
   * Facts MBD does not have and this game cannot draw a player without.
   *
   * `provenance` is the load-bearing field. `derived_arcade_v1` means this game
   * made it up from the player's ID, deterministically, so it is stable across
   * sessions and machines — and so nothing downstream ever mistakes it for
   * something MBD said.
   */
  presentationOnly: {
    bats: 'L' | 'R' | 'S' | null;
    throws: 'L' | 'R' | null;
    jerseyNumber: number | null;
    heightInches: number | null;
    weightPounds: number | null;
    pitchTypes: string[];
    secondaryPositions: string[];
    provenance: 'canonical' | 'derived_arcade_v1' | 'unknown';
  };
}

// ------------------------------------------------------------------- rosters

export interface ArcadeOrganizationRoster {
  teamId: string;
  active26PlayerIds: string[];
  fortyManPlayerIds: string[];
  affiliates: Array<{
    level: Exclude<ArcadeLevel, 'MLB'>;
    name: string | null;
    shortName: string | null;
    identityNote: string | null;
    playerIds: string[];
  }>;
  defaults: {
    /** Exactly nine when a legal lineup is available. */
    lineupPlayerIds: string[];
    /** Up to five, ordered. */
    rotationPlayerIds: string[];
    bullpen: {
      closerId: string | null;
      setupIds: string[];
      longReliefId: string | null;
      otherRelieverIds: string[];
    };
    benchPlayerIds: string[];
  };
}

// -------------------------------------------------------------- scheduled game

export interface ArcadeGameSide {
  teamId: string;
  activePlayerIds: string[];
  lineupPlayerIds: string[];
  startingPitcherId: string;
  bullpenPlayerIds: string[];
  benchPlayerIds: string[];
  unavailablePlayerIds: string[];
}

export interface ArcadeGameContext {
  /**
   * Stable derivation from season, day, away ID, home ID, and that matchup's
   * zero-based occurrence among same-day schedule rows. MBD's schedule rows
   * have no explicit ID yet, so this key *is* the identity of the game.
   */
  gameKey: string;
  season: number;
  day: number;
  dateLabel: string;
  isPlayoff: boolean;
  homeTeamId: string;
  awayTeamId: string;
  home: ArcadeGameSide;
  away: ArcadeGameSide;
  rules: {
    regulationInnings: 9;
    designatedHitter: true;
    extraInningRuleId: string;
    mercyRule: null;
  };
  environment: {
    parkFactor: number;
    stadiumAsset: string | null;
    weather: null;
  };
  /**
   * Applied exactly once by the receiver, which then records that it did. The
   * contract calls this out as its own rule because applying a matchup modifier
   * on both sides of a bridge is invisible, plausible, and wrong.
   */
  explicitModifiers: Array<{
    id: string;
    side: 'home' | 'away' | 'both';
    kind: string;
    value: number;
    source: string;
  }>;
  /** Hash of this game context with this field omitted. */
  contextHash: string;
}

// ---------------------------------------------------------------- presentation

export interface ArcadePresentationContext {
  standings: Array<{
    teamId: string;
    wins: number;
    losses: number;
    gamesBack: number;
    streak: string;
  }>;
  rivalry: {
    id: string;
    teamA: string;
    teamB: string;
    intensity: number;
    summary: string;
  } | null;
  playerNicknames: Array<{
    playerId: string;
    nicknameId: string;
    displayText: string;
  }>;
  featuredMoments: Array<{
    id: string;
    playerIds: string[];
    teamIds: string[];
    headline: string;
    summary: string;
  }>;
  recordsInReach: Array<{
    id: string;
    label: string;
    holderPlayerId: string | null;
    value: number;
  }>;
}

// --------------------------------------------------------------------- receipt

export type ArcadePlateAppearanceOutcome =
  | 'BB'
  | 'K'
  | 'SINGLE'
  | 'DOUBLE'
  | 'TRIPLE'
  | 'HR'
  | 'GB_OUT'
  | 'FB_OUT'
  | 'LD_OUT'
  | 'HBP'
  | 'DOUBLE_PLAY'
  | 'SAC_FLY';

export interface ArcadePlateAppearanceReceipt {
  sequence: number;
  inning: number;
  halfInning: 'top' | 'bottom';
  batterId: string;
  pitcherId: string;
  outcome: ArcadePlateAppearanceOutcome;
  outsBefore: number;
  runnersBefore: number;
  scoreBefore: [number, number];
  scoreAfter: [number, number];
  rbiOnPlay: number;
  isWalkOff: boolean;
}

export interface ArcadePlayerGameLine {
  playerId: string;
  teamId: string;
  batting: {
    plateAppearances: number;
    atBats: number;
    hits: number;
    doubles: number;
    triples: number;
    homeRuns: number;
    runs: number;
    runsBattedIn: number;
    walks: number;
    strikeouts: number;
    hitByPitch: number;
    sacrificeFlies: number;
  };
  pitching: {
    /** Integer outs. Avoids ambiguous values such as "6.2 innings". */
    outsRecorded: number;
    earnedRuns: number;
    strikeouts: number;
    walks: number;
    hitsAllowed: number;
    homeRunsAllowed: number;
    hitBatters: number;
    flyBallsAllowed: number;
    decision: 'win' | 'loss' | 'save' | 'none';
  };
}

export interface ArcadeSubstitutionReceipt {
  sequence: number;
  teamId: string;
  outgoingPlayerId: string;
  incomingPlayerId: string;
  role: 'pinch_hitter' | 'pinch_runner' | 'defense' | 'pitcher';
}

export interface MbdArcadeGameReceiptV1 {
  format: typeof RECEIPT_FORMAT;
  bridgeVersion: 1;
  source: Pick<
    ArcadeSourceBinding,
    'saveId' | 'sourceSnapshotHash' | 'bundleHash' | 'season' | 'day'
  >;
  gameKey: string;
  contextHash: string;
  arcadeBuildId: string;
  gameplayMode: string;
  difficultyId: string;
  homeTeamId: string;
  awayTeamId: string;
  final: {
    homeScore: number;
    awayScore: number;
    innings: number;
    homeHits: number;
    awayHits: number;
    winningPitcherId: string | null;
    losingPitcherId: string | null;
    savePitcherId: string | null;
  };
  plateAppearances: ArcadePlateAppearanceReceipt[];
  playerLines: ArcadePlayerGameLine[];
  substitutions: ArcadeSubstitutionReceipt[];
  /** Every modifier from the context this game actually applied. */
  appliedModifierIds: string[];
  receiptHash: string;
}
