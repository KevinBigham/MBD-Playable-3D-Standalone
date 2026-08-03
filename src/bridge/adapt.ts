import type {
  BatterAttributes,
  BodyType,
  Handedness,
  PitchType,
  PitcherAttributes,
  Player,
  PositionCode,
  Team,
  TeamIdentity,
} from '../core/types';
import { Rng, hashString } from '../core/rng';
import { STADIUMS } from '../data/stadiums';
import { buildBattingOrder } from '../data/teams';
import type {
  ArcadeOrganizationRoster,
  ArcadePlayer,
  ArcadeTeam,
  MbdArcadeWorldBundleV1,
} from './contract';
import { blendAttribute, personalityToAttribute, toAttribute } from './rating';

/**
 * TURNING A DYNASTY INTO NINE PEOPLE ON A FIELD.
 * ==============================================
 *
 * MBD knows who is on the roster and how good they are. It does not know which
 * hand they bat from, what number is on their back, how tall they are, what
 * their ballpark looks like, or what a curveball is. This game cannot draw a
 * single frame without all of those. So this module does two different jobs
 * and is careful never to confuse them:
 *
 *   TRANSLATION   MBD said a thing; say the same thing in this game's words.
 *                 Ratings, names, ages, positions, availability, colours.
 *
 *   INVENTION     MBD has no opinion; make one up, deterministically, from the
 *                 player's own ID so it is identical on every device and in
 *                 every session — and write down that it was invented.
 *
 * The second is the dangerous one, and the mitigation is that everything
 * invented lands in `BridgeReport.derived` and nothing invented is ever sent
 * home. The contract's phrase for this is "never writes those defaults back as
 * MBD truth"; the mechanism is that the receipt has nowhere to put them.
 *
 * WHAT PARK FACTOR MEANS HERE
 * ---------------------------
 * This is the one genuine design decision in the file, and the handoff
 * explicitly asks for it to be made once and made explicitly.
 *
 * MBD carries a park factor per club (0.95 to 1.12) and does *not* feed it into
 * its own plate-appearance resolution, so there is no simulation behaviour to
 * copy. The tempting move is to multiply something — carry, exit velocity,
 * home-run distance — by it. That would be a second modifier on top of a
 * ballpark this game already simulates in full: real fences at real distances
 * with real heights and real air. Denver would get thin air *and* a 12% bonus.
 *
 * So the park factor picks the ballpark. MOONSHOT's eight parks carry from 0.98
 * to 1.11, which covers MBD's range almost exactly, and choosing the nearest
 * one applies the factor once — as geometry a player can see and hit over,
 * rather than as an invisible coefficient. `appliedModifierIds` records that
 * this is what happened.
 */

export interface BridgeReport {
  /** Franchises that became playable clubs. */
  teams: number;
  players: number;
  /** Facts this game invented because MBD does not carry them. */
  derived: string[];
  /** Things MBD carries that this game has nowhere to put. */
  ignored: string[];
  /** Modifier ids, and the one-per-club park decisions, that were applied. */
  applied: string[];
  /** Anything that survived validation but is still worth saying out loud. */
  notes: string[];
}

export interface AdaptedWorld {
  teams: Team[];
  report: BridgeReport;
  /** Team id -> the stadium its park factor resolved to. */
  homeParks: Record<string, string>;
}

/** MOONSHOT's eight logo glyphs. A club gets one deterministically. */
const GLYPHS = ['anchor', 'comet', 'ray', 'gator', 'beacon', 'scorpion', 'yeti', 'rivet'];

/** Pitch families, ordered from "everyone has one" to "that is a real weapon". */
const ARSENAL: PitchType[] = [
  'fastball',
  'slider',
  'curve',
  'changeup',
  'sinker',
  'cutter',
  'splitter',
  'screwball',
];

/** MBD's own division names, for a screen that should say what MBD says. */
const DIVISION_LABEL: Record<string, string> = {
  AL_EAST: 'AL East',
  AL_CENTRAL: 'AL Central',
  AL_WEST: 'AL West',
  NL_EAST: 'NL East',
  NL_CENTRAL: 'NL Central',
  NL_WEST: 'NL West',
};

/** MBD position codes that are not MOONSHOT fielding positions. */
const POSITION_MAP: Record<string, PositionCode> = {
  C: 'C',
  '1B': '1B',
  '2B': '2B',
  '3B': '3B',
  SS: 'SS',
  LF: 'LF',
  CF: 'CF',
  RF: 'RF',
  DH: 'DH',
  SP: 'P',
  RP: 'P',
  CL: 'P',
};

function hexToInt(hex: string, fallback: number): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  return m ? parseInt(m[1], 16) : fallback;
}

/**
 * The ballpark whose carry sits closest to this club's park factor. Ties go to
 * the earlier park, which keeps the choice a pure function of the number.
 */
export function parkForFactor(factor: number): string {
  let best = STADIUMS[0];
  let bestGap = Math.abs(STADIUMS[0].carry - factor);
  for (const s of STADIUMS) {
    const gap = Math.abs(s.carry - factor);
    if (gap < bestGap) {
      best = s;
      bestGap = gap;
    }
  }
  return best.id;
}

function bodyFor(rng: Rng, power: number, speed: number): BodyType {
  if (power > 78 && speed < 55) return rng.chance(0.5) ? 'huge' : 'stocky';
  if (speed > 78) return rng.chance(0.5) ? 'slim' : 'average';
  if (power > 68) return 'stocky';
  return rng.chance(0.3) ? 'tall' : 'average';
}

/**
 * A pitcher's arsenal, from `stuff`.
 *
 * MOONSHOT has no `stuff` attribute, and adding one would mean retuning the
 * whole pitching model — a balance change smuggled in as an import feature. But
 * "stuff" in MBD means deception and swing-and-miss quality, and this game
 * already expresses exactly that: through what a pitcher can throw. A power
 * arm with two pitches is hittable; the same arm with a splitter is not.
 *
 * So stuff becomes arsenal depth. It is recorded in the report as an applied
 * mapping rather than buried, because a reader deserves to know where a source
 * rating went.
 */
function arsenalFor(rng: Rng, stuff: number, starter: boolean): PitchType[] {
  const depth = Math.max(2, Math.min(5, 2 + Math.floor(((stuff - 20) / 79) * 3.4) + (starter ? 1 : 0)));
  const picked: PitchType[] = ['fastball'];
  const pool = rng.shuffle(ARSENAL.slice(1));
  for (const p of pool) {
    if (picked.length >= depth) break;
    picked.push(p);
  }
  return picked;
}

function adaptPlayer(src: ArcadePlayer): Player {
  // Every invented fact is a pure function of the player's own MBD id, so two
  // machines importing the same save produce byte-identical people.
  const rng = new Rng(hashString(`mbd:${src.id}`));
  const h = src.hitter;

  const bat: BatterAttributes = {
    contact: toAttribute(h.contact),
    power: toAttribute(h.power),
    speed: toAttribute(h.speed),
    // MBD has one defensive rating. The contract calls it "the neutral starting
    // point for throw/field accuracy", so it is exactly that for all three —
    // one source number, three destinations, no invented spread between them.
    arm: toAttribute(h.defense),
    fielding: toAttribute(h.defense),
    reaction: toAttribute(h.defense),
    discipline: toAttribute(h.eye),
  };

  let pitch: PitcherAttributes | undefined;
  let repertoire: PitchType[] | undefined;
  if (src.canPitch && src.pitcher) {
    const p = src.pitcher;
    pitch = {
      velocity: toAttribute(p.velocity),
      control: toAttribute(p.control),
      // Movement carries MBD's movement, nudged by stuff — both of which mean
      // "the ball does something the hitter did not expect". Blended rather
      // than summed, so raising either source rating can only help.
      movement: blendAttribute([
        { rating: p.movement, weight: 3 },
        { rating: p.stuff, weight: 1 },
      ]),
      stamina: toAttribute(p.stamina),
      // The one sanctioned use of personality: the contract permits mental
      // toughness to guide "bounded pressure behavior", which is precisely what
      // composure is. Nothing else in this file reads personality, because a
      // personality score must never become a hidden physics bonus.
      composure: personalityToAttribute(src.personality?.mentalToughness ?? 50),
    };
    const starter = src.primaryPosition === 'SP';
    repertoire = arsenalFor(rng, toAttribute(p.stuff), starter);
  }

  const bats: Handedness = rng.chance(0.06) ? 'S' : rng.chance(0.31) ? 'L' : 'R';
  const canonical = src.presentationOnly?.provenance === 'canonical';

  return {
    id: src.id,
    firstName: src.firstName,
    lastName: src.lastName,
    number: src.presentationOnly?.jerseyNumber ?? rng.int(1, 76),
    bats: (canonical && src.presentationOnly.bats) || bats,
    throws:
      (canonical && src.presentationOnly.throws) ||
      (bats === 'L' && rng.chance(0.75) ? 'L' : 'R'),
    primary: POSITION_MAP[src.primaryPosition] ?? 'LF',
    secondary: (src.presentationOnly?.secondaryPositions ?? [])
      .map((s) => POSITION_MAP[s])
      .filter((s): s is PositionCode => !!s),
    body: bodyFor(rng, bat.power, bat.speed),
    skinTone: rng.next(),
    bat,
    pitch,
    repertoire,
    // Overall drives menus and sorting only. The contract is explicit that it
    // must not be applied again on top of the component ratings, so it reaches
    // nothing in the simulation — it only decides who gets a star on the card.
    star: src.overall ? src.overall.internal >= 470 : false,
    trait: src.personality?.traits?.[0],
  };
}

/** The eight defensive slots a designated-hitter lineup has to cover. */
const FIELD_SLOTS: PositionCode[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

/**
 * PUTTING THE NINE HITTERS SOMEWHERE, RATHER THAN FINDING NINE FIELDERS.
 *
 * MBD picks who plays: without a saved plan its policy is the nine best hitters
 * by overall rating, full stop. That is MBD's decision and this game does not
 * get to overrule it — but it means a real MBD lineup is frequently *not* one
 * of each position. Kansas City's opening day is a shortstop, a centre fielder,
 * two catchers, two left fielders, a right fielder and two first basemen. No
 * second baseman anywhere in it.
 *
 * The obvious implementation — for each defensive slot, find the lineup player
 * who plays there, else pull somebody off the bench — produces a team where two
 * men field and never bat, which is not baseball. It also passed every test,
 * because the fixture's lineups were built from a position template and never
 * had a gap.
 *
 * So the assignment runs the other way round: the nine who bat are the nine who
 * play, and this works out where they stand. Primary positions are honoured
 * first, then whoever is left fills whatever is left, and the last man out is
 * the designated hitter. A first baseman ends up at second sometimes. That is a
 * manager's problem, it is visible on the roster screen, and it is enormously
 * better than a phantom.
 */
function fieldFromLineup(lineup: string[], byId: Map<string, Player>): string[] {
  const pool = lineup.map((id) => byId.get(id)).filter((p): p is Player => !!p);
  const taken = new Set<string>();
  const out: string[] = [];

  for (const slot of FIELD_SLOTS) {
    const natural = pool.find((p) => !taken.has(p.id) && p.primary === slot);
    if (natural) {
      taken.add(natural.id);
      out.push(natural.id);
    } else {
      out.push('');
    }
  }
  // Second pass for the slots nobody plays naturally, in lineup order so the
  // choice is deterministic rather than dependent on iteration luck.
  const spare = pool.filter((p) => !taken.has(p.id));
  for (let i = 0; i < out.length; i++) {
    if (out[i]) continue;
    const next = spare.shift();
    // A lineup shorter than eight cannot cover the field; repeating the first
    // hitter is wrong but survivable, and validation has already refused any
    // bundle that could get here.
    out[i] = next ? next.id : (pool[0]?.id ?? '');
    if (next) taken.add(next.id);
  }
  return out;
}

/**
 * A club, its people, and a legal way to line them up.
 *
 * The bundle's own lineup and rotation are used whenever they are present —
 * they are MBD's decision, or the user's inside MBD, and re-deriving them here
 * would be this game overruling the world authority about its own roster.
 * Order is only invented where the bundle left a gap.
 */
function adaptTeam(
  src: ArcadeTeam,
  org: ArcadeOrganizationRoster | undefined,
  players: Player[],
  report: BridgeReport,
): { team: Team; park: string } {
  const byId = new Map(players.map((p) => [p.id, p]));
  const park = parkForFactor(src.parkFactor);

  const identity: TeamIdentity = {
    id: src.id,
    city: src.city,
    name: src.name,
    abbr: src.abbreviation,
    // Six MBD divisions into two. The league split is a MOONSHOT structure, not
    // an MBD fact, so it is a presentation decision: the two circuits are the
    // two leagues, which is the division line a person already understands.
    division: src.division.startsWith('AL_') ? 'tide' : 'ridge',
    // ...but shown under MBD's own name, because "Tidewater Division" is this
    // game's word for a structure that belongs to somebody else's world.
    divisionLabel: DIVISION_LABEL[src.division],
    primary: hexToInt(src.branding?.background, 0x18324f),
    secondary: hexToInt(src.branding?.text, 0xf2c14e),
    accent: hexToInt(src.branding?.accent, 0xe8eef5),
    // MBD ships real SVG logos this build cannot load, so a glyph stands in.
    logo: GLYPHS[Math.abs(hashString(src.id)) % GLYPHS.length],
    homeStadium: park,
    motto: src.identity?.franchiseHook ?? src.identity?.archetype ?? '',
  };

  const roster = players.filter((p) => byId.has(p.id));
  const pitchers = roster.filter((p) => p.pitch);
  const hitters = roster.filter((p) => !p.pitch);

  const declared = (org?.defaults.lineupPlayerIds ?? []).filter((id) => byId.has(id));
  const lineup =
    declared.length === 9
      ? declared
      : buildBattingOrder(hitters.slice(0, 9)).map((p) => p.id);

  const rotation = (org?.defaults.rotationPlayerIds ?? []).filter((id) => byId.get(id)?.pitch);
  const bull = org?.defaults.bullpen;
  const bullpen = [
    ...(bull?.setupIds ?? []),
    ...(bull?.otherRelieverIds ?? []),
    ...(bull?.longReliefId ? [bull.longReliefId] : []),
    ...(bull?.closerId ? [bull.closerId] : []),
  ].filter((id) => byId.get(id)?.pitch);

  const onMound = byId.get(rotation[0] ?? '') ?? pitchers[0] ?? roster[0];
  const defense = [onMound.id, ...fieldFromLineup(lineup, byId)];

  report.applied.push(
    `park:${src.id}=${park} (factor ${src.parkFactor.toFixed(2)} -> nearest carry)`,
  );
  if (declared.length !== 9) {
    report.notes.push(`${src.id}: no exported lineup, batting order derived from the roster`);
  }
  return {
    team: {
      ...identity,
      players: roster,
      lineup,
      defense,
      rotation: rotation.length ? rotation : pitchers.slice(0, 4).map((p) => p.id),
      bullpen: bullpen.length ? bullpen : pitchers.slice(4).map((p) => p.id),
    },
    park,
  };
}

/**
 * A validated bundle as a playable league.
 *
 * Only players who can actually take the field are carried through: the
 * contract says to exclude injured, rehab-ineligible, shutdown, released, free
 * agent and retired players from the *playable* roster, while keeping them in
 * the wider payload for a roster screen. This game has no roster screen for
 * absent players, so they are counted in the report and left out of the club.
 */
export function adaptWorld(bundle: MbdArcadeWorldBundleV1): AdaptedWorld {
  const report: BridgeReport = {
    teams: 0,
    players: 0,
    derived: [
      'handedness, jersey number, body type and skin tone (per player, from the MBD player id)',
      'pitch repertoire (from `stuff`, as arsenal depth)',
      'club logo glyph (from the MBD team id)',
      'home ballpark (from `parkFactor`, nearest carry)',
      'division split (AL -> tide, NL -> ridge)',
    ],
    ignored: [
      'durability — this game does not model hitter fatigue within one game',
      'age, nationality, personality beyond mental toughness, injury detail',
      'affiliate rosters, standings, nicknames, moments, records in reach',
    ],
    applied: [],
    notes: [],
  };

  const orgById = new Map(bundle.organizations.map((o) => [o.teamId, o]));
  const playersByTeam = new Map<string, Player[]>();
  let benched = 0;

  for (const src of bundle.players) {
    if (!src.availability?.eligible) {
      benched++;
      continue;
    }
    const list = playersByTeam.get(src.teamId) ?? [];
    list.push(adaptPlayer(src));
    playersByTeam.set(src.teamId, list);
  }
  if (benched) {
    report.notes.push(`${benched} unavailable player(s) left out of the playable rosters`);
  }

  const teams: Team[] = [];
  const homeParks: Record<string, string> = {};
  for (const src of bundle.teams) {
    const roster = playersByTeam.get(src.id) ?? [];
    // A club with nobody left to field is not playable, and pretending
    // otherwise produces a crash three screens later instead of a sentence here.
    if (roster.length < 10) {
      report.notes.push(`${src.id}: only ${roster.length} available player(s), club skipped`);
      continue;
    }
    const { team, park } = adaptTeam(src, orgById.get(src.id), roster, report);
    teams.push(team);
    homeParks[src.id] = park;
  }

  for (const m of bundle.game?.explicitModifiers ?? []) {
    // Recorded but not applied: bridge v1 defines no modifier kinds, and
    // applying one this game does not understand would be worse than declining
    // to. The receipt reports only what was genuinely applied.
    report.notes.push(`modifier "${m.id}" (${m.kind}) was exported but this build applies none`);
  }

  report.teams = teams.length;
  report.players = teams.reduce((n, t) => n + t.players.length, 0);
  return { teams, report, homeParks };
}
