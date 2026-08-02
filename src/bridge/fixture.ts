import { Rng, hashString } from '../core/rng';
import { FIRST_NAMES, LAST_NAMES, TRAITS } from '../data/names';
import type {
  ArcadeGameSide,
  ArcadeHitterRatings,
  ArcadeOrganizationRoster,
  ArcadePitcherRatings,
  ArcadePlayer,
  ArcadePosition,
  ArcadeTeam,
  BundleMode,
  MbdArcadeWorldBundleV1,
} from './contract';
import { BRIDGE_VERSION, BUNDLE_FORMAT } from './contract';
import { MBD_FRANCHISES, MBD_OPENING_RIVALRIES } from './franchises';
import { makeRating } from './rating';

/**
 * A WORLD THAT DOES NOT EXIST YET.
 * ================================
 *
 * MBD has no arcade exporter. That is gap #1 in the handoff's own list, and it
 * is not this repository's to close — the exporter has to run inside MBD, over
 * a real save, through MBD's save coordinator.
 *
 * Waiting for it would mean building the entire consuming half of a bridge with
 * nothing to point it at: no way to test the validator's rejections, no way to
 * know whether the ratings map sensibly, no way to see thirty-two clubs on a
 * team-select screen and find out that the layout breaks at more than ten. So
 * this generates a bundle that obeys the contract exactly, from the real
 * franchise catalog, with deterministic rosters.
 *
 * What it IS: proof that a conforming bundle loads, validates, adapts and plays.
 * What it is NOT: MBD's data. Every player here is invented by this file. The
 * moment a real export exists, this stays as test material and nothing else —
 * which is why it lives under `bridge/` next to the contract rather than
 * anywhere a menu could mistake it for a save.
 */

const HITTER_SLOTS: ArcadePosition[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
const BENCH_SLOTS: ArcadePosition[] = ['C', 'SS', 'CF', 'LF'];

/** MBD's internal scale. A league-average regular sits near the middle. */
function roll(rng: Rng, centre: number, spread = 60): number {
  return Math.round(Math.max(0, Math.min(550, centre + rng.normal(0, spread))));
}

function hitterRatings(rng: Rng, centre: number, pos: ArcadePosition): ArcadeHitterRatings {
  // Position shapes the profile the way it does in any baseball world: a
  // shortstop is quick and sure-handed, a first baseman is paid to hit.
  const up = (bonus: number) => roll(rng, centre + bonus);
  const power = pos === '1B' || pos === 'DH' || pos === 'RF' ? up(70) : up(-20);
  const speed = pos === 'CF' || pos === 'SS' || pos === '2B' ? up(70) : up(-30);
  const defense = pos === 'C' || pos === 'SS' || pos === 'CF' ? up(60) : up(-10);
  return {
    contact: makeRating(up(0)),
    power: makeRating(power),
    eye: makeRating(up(0)),
    speed: makeRating(speed),
    defense: makeRating(defense),
    durability: makeRating(up(0)),
  };
}

function pitcherRatings(rng: Rng, centre: number, starter: boolean): ArcadePitcherRatings {
  return {
    stuff: makeRating(roll(rng, centre + (starter ? 0 : 40))),
    control: makeRating(roll(rng, centre + (starter ? 30 : -10))),
    // A starter's whole job is the third time through the order.
    stamina: makeRating(roll(rng, starter ? centre + 90 : centre - 120)),
    velocity: makeRating(roll(rng, centre + (starter ? 0 : 50))),
    movement: makeRating(roll(rng, centre)),
  };
}

/** MBD's overall is its own roll-up; here it is the mean of the components. */
function overallOf(h: ArcadeHitterRatings, p: ArcadePitcherRatings | null): number {
  const vals = p
    ? [p.stuff, p.control, p.stamina, p.velocity, p.movement].map((r) => r.internal)
    : [h.contact, h.power, h.eye, h.speed, h.defense].map((r) => r.internal);
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function makePlayer(
  rng: Rng,
  teamId: string,
  pos: ArcadePosition,
  centre: number,
  used: Set<string>,
): ArcadePlayer {
  let first = rng.pick(FIRST_NAMES);
  let last = rng.pick(LAST_NAMES);
  for (let i = 0; i < 40 && used.has(`${first} ${last}`); i++) {
    first = rng.pick(FIRST_NAMES);
    last = rng.pick(LAST_NAMES);
  }
  used.add(`${first} ${last}`);

  const isPitcher = pos === 'SP' || pos === 'RP' || pos === 'CL';
  const hitter = hitterRatings(rng, isPitcher ? centre - 190 : centre, pos);
  const pitcher = isPitcher ? pitcherRatings(rng, centre, pos === 'SP') : null;

  return {
    id: `mbd-${teamId}-${first}-${last}`.toLowerCase().replace(/[^a-z0-9-]/g, ''),
    teamId,
    firstName: first,
    lastName: last,
    displayName: `${first} ${last}`,
    age: rng.int(21, 38),
    nationality: rng.chance(0.62) ? 'american' : rng.chance(0.6) ? 'latin' : 'asian',
    primaryPosition: pos,
    rosterStatus: 'MLB',
    minorLeagueLevel: null,
    canPitch: isPitcher,
    hitter,
    pitcher,
    overall: makeRating(overallOf(hitter, pitcher)),
    personality: {
      workEthic: rng.int(20, 99),
      mentalToughness: rng.int(20, 99),
      leadership: rng.int(20, 99),
      competitiveness: rng.int(20, 99),
      traits: [rng.pick(TRAITS)],
    },
    availability: {
      eligible: true,
      reason: 'available',
      injuryType: null,
      injurySeverity: null,
      daysRemaining: null,
      injuryAttributePenalty: null,
      rehabPlan: null,
      workloadMode: null,
      workloadLimitOuts: null,
    },
    presentationOnly: {
      // Null, not guessed. MBD genuinely does not carry these, and a fixture
      // that filled them in would hide the fact that the adapter has to.
      bats: null,
      throws: null,
      jerseyNumber: null,
      heightInches: null,
      weightPounds: null,
      pitchTypes: [],
      secondaryPositions: [],
      provenance: 'unknown',
    },
  };
}

interface Org {
  team: ArcadeTeam;
  players: ArcadePlayer[];
  roster: ArcadeOrganizationRoster;
}

function makeOrg(seed: number, src: (typeof MBD_FRANCHISES)[number]): Org {
  const rng = new Rng(hashString(`${seed}:${src.id}`));
  const used = new Set<string>();
  // Clubs differ, but not by much: identity should come from the roster, not
  // from one franchise rolling badly and being unplayable.
  const centre = 300 + rng.normal(0, 22);

  const starters = HITTER_SLOTS.map((pos) => makePlayer(rng, src.id, pos, centre + 20, used));
  const bench = BENCH_SLOTS.map((pos) => makePlayer(rng, src.id, pos, centre - 70, used));
  const rotation = Array.from({ length: 5 }, (_, i) =>
    makePlayer(rng, src.id, 'SP', centre + 60 - i * 30, used),
  );
  const relievers = Array.from({ length: 7 }, (_, i) =>
    makePlayer(rng, src.id, i === 0 ? 'CL' : 'RP', centre + 30 - i * 12, used),
  );
  const players = [...starters, ...bench, ...rotation, ...relievers];

  const team: ArcadeTeam = {
    id: src.id,
    city: src.city,
    name: src.name,
    fullName: src.fullName,
    abbreviation: src.abbr,
    division: src.division,
    parkFactor: src.parkFactor,
    branding: {
      background: src.background,
      text: src.text,
      accent: src.accent,
      logoAsset: src.logoAsset,
    },
    identity: { archetype: null, franchiseHook: null, marketSize: null },
  };

  const roster: ArcadeOrganizationRoster = {
    teamId: src.id,
    active26PlayerIds: players.map((p) => p.id),
    fortyManPlayerIds: players.map((p) => p.id),
    affiliates: [],
    defaults: {
      lineupPlayerIds: starters.map((p) => p.id),
      rotationPlayerIds: rotation.map((p) => p.id),
      bullpen: {
        closerId: relievers[0].id,
        setupIds: relievers.slice(1, 3).map((p) => p.id),
        longReliefId: relievers[relievers.length - 1].id,
        otherRelieverIds: relievers.slice(3, -1).map((p) => p.id),
      },
      benchPlayerIds: bench.map((p) => p.id),
    },
  };

  return { team, players, roster };
}

export interface FixtureOptions {
  seed?: number;
  mode?: BundleMode;
  /** How many franchises to include, from the top of the catalog. */
  teams?: number;
  /** For a dynasty package: which two clubs are playing. */
  matchup?: { awayTeamId: string; homeTeamId: string };
}

/**
 * A conforming bundle. Deterministic in `seed`: the same seed produces the same
 * thirty-two rosters, byte for byte, on any machine.
 */
export function buildFixtureBundle(opts: FixtureOptions = {}): MbdArcadeWorldBundleV1 {
  const seed = opts.seed ?? hashString('mbd-fixture-v1');
  const mode = opts.mode ?? 'exhibition';
  const catalog = MBD_FRANCHISES.slice(0, opts.teams ?? MBD_FRANCHISES.length);
  const orgs = catalog.map((src) => makeOrg(seed, src));

  const teams = orgs.map((o) => o.team);
  const players = orgs.flatMap((o) => o.players);
  const organizations = orgs.map((o) => o.roster);
  const byId = new Map(orgs.map((o) => [o.team.id, o]));

  let game: MbdArcadeWorldBundleV1['game'] = null;
  if (mode === 'dynasty_scheduled_game') {
    const awayId = opts.matchup?.awayTeamId ?? catalog[0].id;
    const homeId = opts.matchup?.homeTeamId ?? catalog[1].id;
    const side = (id: string): ArcadeGameSide => {
      const o = byId.get(id)!;
      return {
        teamId: id,
        activePlayerIds: o.roster.active26PlayerIds,
        lineupPlayerIds: o.roster.defaults.lineupPlayerIds,
        startingPitcherId: o.roster.defaults.rotationPlayerIds[0],
        bullpenPlayerIds: [
          ...o.roster.defaults.bullpen.setupIds,
          ...o.roster.defaults.bullpen.otherRelieverIds,
          ...(o.roster.defaults.bullpen.closerId ? [o.roster.defaults.bullpen.closerId] : []),
        ],
        benchPlayerIds: o.roster.defaults.benchPlayerIds,
        unavailablePlayerIds: [],
      };
    };
    game = {
      // The handoff's own derivation: season, day, away, home, and that
      // matchup's zero-based occurrence among the same day's schedule rows.
      gameKey: `1:1:${awayId}:${homeId}:0`,
      season: 1,
      day: 1,
      dateLabel: 'Opening Day',
      isPlayoff: false,
      homeTeamId: homeId,
      awayTeamId: awayId,
      home: side(homeId),
      away: side(awayId),
      rules: {
        regulationInnings: 9,
        designatedHitter: true,
        extraInningRuleId: 'mbd.extra.standard',
        mercyRule: null,
      },
      environment: {
        parkFactor: byId.get(homeId)!.team.parkFactor,
        stadiumAsset: null,
        weather: null,
      },
      explicitModifiers: [],
      contextHash: `sha256:fixture-context-${awayId}-${homeId}`,
    };
  }

  const rivalry = MBD_OPENING_RIVALRIES.find(
    (r) => byId.has(r.teamA) && byId.has(r.teamB),
  );

  return {
    format: BUNDLE_FORMAT,
    bridgeVersion: BRIDGE_VERSION,
    mode,
    source: {
      game: 'Mr. Baseball Dynasty',
      snapshotSchemaVersion: 48,
      // A fixture is not a save. A dynasty package must name one, so the
      // fixture says so plainly rather than inventing a plausible save id.
      saveId: mode === 'dynasty_scheduled_game' ? 'fixture-save' : null,
      season: 1,
      day: 1,
      phase: 'regular',
      sourceSnapshotHash: `sha256:fixture-source-${seed}`,
      bundleHash: `sha256:fixture-bundle-${seed}`,
    },
    league: {
      id: 'mbd',
      name: 'Mr. Baseball Dynasty',
      positions: ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP', 'CL'],
      organizationLevels: ['MLB', 'AAA', 'AA', 'A_PLUS', 'A', 'ROOKIE', 'INTERNATIONAL'],
      playerStatuses: [
        'MLB',
        'AAA',
        'AA',
        'A_PLUS',
        'A',
        'ROOKIE',
        'INTERNATIONAL',
        'FREE_AGENT',
        'RETIRED',
      ],
      rules: {
        regulationInnings: 9,
        battingOrderSize: 9,
        activeRosterLimit: 26,
        fortyManRosterLimit: 40,
        defaultRotationSize: 5,
        designatedHitter: true,
      },
    },
    teams,
    organizations,
    players,
    presentation: {
      standings: teams.map((t) => ({
        teamId: t.id,
        wins: 0,
        losses: 0,
        gamesBack: 0,
        streak: '-',
      })),
      rivalry: rivalry
        ? {
            id: rivalry.id,
            teamA: rivalry.teamA,
            teamB: rivalry.teamB,
            intensity: rivalry.intensity,
            summary: 'Opening historical rivalry.',
          }
        : null,
      playerNicknames: [],
      featuredMoments: [],
      recordsInReach: [],
    },
    game,
  };
}
