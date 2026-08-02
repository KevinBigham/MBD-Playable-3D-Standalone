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
import { clamp } from '../core/constants';
import { FIRST_NAMES, LAST_NAMES, TRAITS } from './names';

/** The ten clubs of the Meridian Circuit, split into two five-team divisions. */
export const TEAM_IDENTITIES: TeamIdentity[] = [
  {
    id: 'ironport',
    city: 'Ironport',
    name: 'Anchors',
    abbr: 'IRN',
    division: 'tide',
    primary: 0x18324f,
    secondary: 0xf2c14e,
    accent: 0xe8eef5,
    logo: 'anchor',
    homeStadium: 'anchor-yard',
    motto: 'Hold the line.',
  },
  {
    id: 'novabay',
    city: 'Nova Bay',
    name: 'Comets',
    abbr: 'NVB',
    division: 'tide',
    primary: 0x4b2d8f,
    secondary: 0xc9c6dd,
    accent: 0x9df0ff,
    logo: 'comet',
    homeStadium: 'comet-dome',
    motto: 'Burn bright, land far.',
  },
  {
    id: 'coralkey',
    city: 'Coral Key',
    name: 'Stingrays',
    abbr: 'CRL',
    division: 'tide',
    primary: 0x0d7d7d,
    secondary: 0xff7a59,
    accent: 0xfdf6e3,
    logo: 'ray',
    homeStadium: 'bayou-bowl',
    motto: 'Glide, then strike.',
  },
  {
    id: 'bayoucity',
    city: 'Bayou City',
    name: 'Gators',
    abbr: 'BAY',
    division: 'tide',
    primary: 0x1f5c2e,
    secondary: 0xe0a92b,
    accent: 0xd9e8cf,
    logo: 'gator',
    homeStadium: 'bayou-bowl',
    motto: 'Patience, then teeth.',
  },
  {
    id: 'harborpoint',
    city: 'Harbor Point',
    name: 'Beacons',
    abbr: 'HBP',
    division: 'tide',
    primary: 0xb03a2e,
    secondary: 0xf6e6c3,
    accent: 0x2c3e50,
    logo: 'beacon',
    homeStadium: 'grove-park',
    motto: 'Somebody has to be the light.',
  },
  {
    id: 'cactusflats',
    city: 'Cactus Flats',
    name: 'Scorpions',
    abbr: 'CAC',
    division: 'ridge',
    primary: 0xd2641e,
    secondary: 0x231f20,
    accent: 0xf7d08a,
    logo: 'scorpion',
    homeStadium: 'sandpit',
    motto: 'Small. Fast. Regrettable.',
  },
  {
    id: 'alpinesummit',
    city: 'Alpine Summit',
    name: 'Yeti',
    abbr: 'ALP',
    division: 'ridge',
    primary: 0x2e6f9e,
    secondary: 0xeaf4fb,
    accent: 0x8fd3ff,
    logo: 'yeti',
    homeStadium: 'summit-field',
    motto: 'Thin air, thick gloves.',
  },
  {
    id: 'rustforge',
    city: 'Rustforge',
    name: 'Riveters',
    abbr: 'RST',
    division: 'ridge',
    primary: 0x8c4a24,
    secondary: 0x3a3a3a,
    accent: 0xffa447,
    logo: 'rivet',
    homeStadium: 'the-foundry',
    motto: 'Swing hard, apologise later.',
  },
  {
    id: 'prairierock',
    city: 'Prairie Rock',
    name: 'Thunderbirds',
    abbr: 'PRK',
    division: 'ridge',
    primary: 0x9b1b30,
    secondary: 0xf5c518,
    accent: 0x1b2a41,
    logo: 'bolt',
    homeStadium: 'thunder-ridge',
    motto: 'You will hear us first.',
  },
  {
    id: 'redwoodgrove',
    city: 'Redwood Grove',
    name: 'Loggers',
    abbr: 'RWG',
    division: 'ridge',
    primary: 0x27532f,
    secondary: 0x7a4b2a,
    accent: 0xf0e5c8,
    logo: 'pine',
    homeStadium: 'grove-park',
    motto: 'Timber travels.',
  },
];

interface TeamBias {
  contact: number;
  power: number;
  speed: number;
  defense: number;
  arm: number;
  discipline: number;
  pitchVelo: number;
  pitchControl: number;
  pitchMove: number;
  /** Pitch types this club's staff leans on. */
  staffFlavor: PitchType[];
}

/**
 * Each club's fingerprint. Values are additive attribute shifts (roughly
 * -8..+8), so a Rustforge hitter really does trade contact for power.
 */
const TEAM_BIAS: Record<string, TeamBias> = {
  ironport: {
    contact: 3, power: -1, speed: -1, defense: 5, arm: 4, discipline: 4,
    pitchVelo: 1, pitchControl: 7, pitchMove: 3,
    staffFlavor: ['sinker', 'cutter', 'slider', 'changeup'],
  },
  novabay: {
    contact: 4, power: 4, speed: 2, defense: 2, arm: 2, discipline: 3,
    pitchVelo: 4, pitchControl: 3, pitchMove: 3,
    staffFlavor: ['fastball', 'heater', 'curve', 'changeup'],
  },
  coralkey: {
    contact: 6, power: -4, speed: 7, defense: 4, arm: 0, discipline: 2,
    pitchVelo: -1, pitchControl: 5, pitchMove: 4,
    staffFlavor: ['changeup', 'screwball', 'sinker', 'curve'],
  },
  bayoucity: {
    contact: -2, power: 7, speed: -2, defense: 0, arm: 3, discipline: -3,
    pitchVelo: 5, pitchControl: -3, pitchMove: 4,
    staffFlavor: ['heater', 'splitter', 'slider', 'fastball'],
  },
  harborpoint: {
    contact: 6, power: 4, speed: 3, defense: 4, arm: 4, discipline: 8,
    pitchVelo: 0, pitchControl: 7, pitchMove: 9,
    staffFlavor: ['knuckler', 'curve', 'changeup', 'cutter'],
  },
  cactusflats: {
    contact: 5, power: -5, speed: 8, defense: 3, arm: -1, discipline: 1,
    pitchVelo: 2, pitchControl: 4, pitchMove: 1,
    staffFlavor: ['fastball', 'slider', 'changeup', 'cutter'],
  },
  alpinesummit: {
    contact: 2, power: 2, speed: -3, defense: 8, arm: 5, discipline: 2,
    pitchVelo: 0, pitchControl: 3, pitchMove: 6,
    staffFlavor: ['curve', 'slider', 'sinker', 'splitter'],
  },
  rustforge: {
    contact: -6, power: 9, speed: -3, defense: -2, arm: 4, discipline: -4,
    pitchVelo: 6, pitchControl: -4, pitchMove: 2,
    staffFlavor: ['heater', 'fastball', 'slider', 'splitter'],
  },
  prairierock: {
    contact: 0, power: 3, speed: 2, defense: 1, arm: 7, discipline: 0,
    pitchVelo: 8, pitchControl: -1, pitchMove: 2,
    staffFlavor: ['heater', 'fastball', 'curve', 'screwball'],
  },
  redwoodgrove: {
    contact: -3, power: 8, speed: -1, defense: 1, arm: 2, discipline: -1,
    pitchVelo: 3, pitchControl: 1, pitchMove: 3,
    staffFlavor: ['sinker', 'fastball', 'curve', 'cutter'],
  },
};

interface PosTemplate {
  contact: number;
  power: number;
  speed: number;
  arm: number;
  fielding: number;
  reaction: number;
  discipline: number;
}

const POS_TEMPLATE: Record<string, PosTemplate> = {
  C:  { contact: 0,  power: 2,  speed: -12, arm: 10, fielding: 9,  reaction: 6, discipline: 3 },
  '1B': { contact: 2,  power: 9,  speed: -8,  arm: -2, fielding: 1,  reaction: 0, discipline: 2 },
  '2B': { contact: 6,  power: -7, speed: 6,   arm: 0,  fielding: 8,  reaction: 6, discipline: 3 },
  '3B': { contact: -1, power: 7,  speed: -3,  arm: 8,  fielding: 4,  reaction: 5, discipline: 0 },
  SS: { contact: 3,  power: -5, speed: 7,   arm: 7,  fielding: 11, reaction: 8, discipline: 1 },
  LF: { contact: 1,  power: 5,  speed: 2,   arm: -1, fielding: 1,  reaction: 1, discipline: 1 },
  CF: { contact: 3,  power: -1, speed: 11,  arm: 3,  fielding: 8,  reaction: 6, discipline: 2 },
  RF: { contact: 0,  power: 6,  speed: 3,   arm: 10, fielding: 3,  reaction: 2, discipline: 1 },
  DH: { contact: 1,  power: 10, speed: -6,  arm: -6, fielding: -8, reaction: -4, discipline: 3 },
  P:  { contact: -22, power: -18, speed: -6, arm: 6, fielding: 2,  reaction: 0, discipline: -12 },
};

const LINEUP_POSITIONS: PositionCode[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
const BENCH_POSITIONS: PositionCode[] = ['C', 'SS', 'CF'];

function pickBody(rng: Rng, power: number, speed: number, fielding: number): BodyType {
  const bulk = power - speed * 0.7 + rng.normal(0, 6);
  if (bulk > 26) return 'huge';
  if (bulk > 10) return 'stocky';
  if (bulk < -18) return 'slim';
  if (fielding > 72 && speed > 62 && rng.chance(0.4)) return 'tall';
  return rng.chance(0.28) ? 'tall' : 'average';
}

function rollAttr(rng: Rng, base: number, tmpl: number, bias: number, spread = 11): number {
  return clamp(Math.round(base + tmpl + bias + rng.normal(0, spread)), 22, 99);
}

function makeHitter(
  rng: Rng,
  teamId: string,
  pos: PositionCode,
  qualityBase: number,
  usedNames: Set<string>,
): Player {
  const bias = TEAM_BIAS[teamId];
  const t = POS_TEMPLATE[pos] ?? POS_TEMPLATE.LF;

  const bat: BatterAttributes = {
    contact: rollAttr(rng, qualityBase, t.contact, bias.contact),
    power: rollAttr(rng, qualityBase, t.power, bias.power),
    speed: rollAttr(rng, qualityBase, t.speed, bias.speed),
    arm: rollAttr(rng, qualityBase, t.arm, bias.arm),
    fielding: rollAttr(rng, qualityBase, t.fielding, bias.defense),
    reaction: rollAttr(rng, qualityBase, t.reaction, Math.round(bias.defense * 0.5)),
    discipline: rollAttr(rng, qualityBase, t.discipline, bias.discipline),
  };

  const name = uniqueName(rng, usedNames);
  const bats: Handedness = rng.chance(0.06) ? 'S' : rng.chance(0.31) ? 'L' : 'R';

  return {
    id: `${teamId}-${name.first}-${name.last}`.toLowerCase().replace(/[^a-z0-9-]/g, ''),
    firstName: name.first,
    lastName: name.last,
    number: 0,
    bats,
    throws: bats === 'L' && rng.chance(0.75) ? 'L' : 'R',
    primary: pos,
    secondary: [],
    body: pickBody(rng, bat.power, bat.speed, bat.fielding),
    skinTone: rng.next(),
    bat,
    trait: rng.pick(TRAITS),
  };
}

function makePitcher(
  rng: Rng,
  teamId: string,
  starter: boolean,
  qualityBase: number,
  usedNames: Set<string>,
): Player {
  const bias = TEAM_BIAS[teamId];
  const t = POS_TEMPLATE.P;

  const pitch: PitcherAttributes = {
    velocity: rollAttr(rng, qualityBase, starter ? 0 : 5, bias.pitchVelo),
    control: rollAttr(rng, qualityBase, starter ? 4 : -3, bias.pitchControl),
    movement: rollAttr(rng, qualityBase, 0, bias.pitchMove),
    stamina: rollAttr(rng, qualityBase, starter ? 20 : -18, 0, 8),
    composure: rollAttr(rng, qualityBase, starter ? 3 : 0, 0),
  };

  const bat: BatterAttributes = {
    contact: rollAttr(rng, qualityBase, t.contact, 0, 8),
    power: rollAttr(rng, qualityBase, t.power, 0, 8),
    speed: rollAttr(rng, qualityBase, t.speed, 0, 9),
    arm: rollAttr(rng, qualityBase, t.arm, bias.arm),
    fielding: rollAttr(rng, qualityBase, t.fielding, bias.defense),
    reaction: rollAttr(rng, qualityBase, t.reaction, 0),
    discipline: rollAttr(rng, qualityBase, t.discipline, 0, 8),
  };

  // Repertoire: 3 for relievers, 4 for starters, always led by the club flavour.
  const flavor = [...bias.staffFlavor];
  rng.shuffle(flavor);
  const count = starter ? 4 : 3;
  const repertoire: PitchType[] = [];
  for (const p of flavor) {
    if (repertoire.length >= count) break;
    repertoire.push(p);
  }
  const extras: PitchType[] = ['fastball', 'curve', 'slider', 'changeup', 'sinker', 'cutter', 'splitter', 'screwball'];
  rng.shuffle(extras);
  for (const p of extras) {
    if (repertoire.length >= count) break;
    if (!repertoire.includes(p)) repertoire.push(p);
  }
  // Every arm needs something straight and hard to change speeds off.
  if (!repertoire.some((p) => p === 'fastball' || p === 'heater' || p === 'sinker')) {
    repertoire[repertoire.length - 1] = 'fastball';
  }

  const name = uniqueName(rng, usedNames);
  const throws: Handedness = rng.chance(0.3) ? 'L' : 'R';

  return {
    id: `${teamId}-${name.first}-${name.last}`.toLowerCase().replace(/[^a-z0-9-]/g, ''),
    firstName: name.first,
    lastName: name.last,
    number: 0,
    bats: throws,
    throws,
    primary: 'P',
    secondary: [],
    body: pickBody(rng, pitch.velocity - 20, bat.speed, bat.fielding),
    skinTone: rng.next(),
    bat,
    pitch,
    repertoire,
    trait: rng.pick(TRAITS),
  };
}

function uniqueName(rng: Rng, used: Set<string>): { first: string; last: string } {
  for (let i = 0; i < 200; i++) {
    const first = rng.pick(FIRST_NAMES);
    const last = rng.pick(LAST_NAMES);
    const key = `${first} ${last}`;
    if (!used.has(key)) {
      used.add(key);
      return { first, last };
    }
  }
  const first = rng.pick(FIRST_NAMES);
  const last = `${rng.pick(LAST_NAMES)}-${used.size}`;
  used.add(`${first} ${last}`);
  return { first, last };
}

/** Hand-authored faces of the league — one signature star per club. */
interface StarSpec {
  team: string;
  first: string;
  last: string;
  pos: PositionCode;
  bats: Handedness;
  body: BodyType;
  trait: string;
  bat?: Partial<BatterAttributes>;
  pitch?: Partial<PitcherAttributes>;
  repertoire?: PitchType[];
}

const STARS: StarSpec[] = [
  {
    team: 'ironport', first: 'Dez', last: 'Hallowell', pos: 'SS', bats: 'R', body: 'average',
    trait: 'Turns two in his sleep. Has never dropped anything.',
    bat: { contact: 88, power: 62, speed: 84, arm: 92, fielding: 97, reaction: 93, discipline: 79 },
  },
  {
    team: 'novabay', first: 'Rooster', last: 'Van Doorn', pos: 'CF', bats: 'L', body: 'tall',
    trait: 'The face of the Circuit. Hits it out, then catches yours.',
    bat: { contact: 91, power: 89, speed: 90, arm: 82, fielding: 90, reaction: 88, discipline: 86 },
  },
  {
    team: 'coralkey', first: 'Yuki', last: 'Nakagawa', pos: '2B', bats: 'S', body: 'slim',
    trait: 'Fastest player alive. Bunts for extra bases out of spite.',
    bat: { contact: 90, power: 41, speed: 99, arm: 68, fielding: 88, reaction: 91, discipline: 84 },
  },
  {
    team: 'bayoucity', first: 'Big', last: 'Thibodeaux', pos: '1B', bats: 'R', body: 'huge',
    trait: 'Three-hundred-pound man, four-hundred-foot swing.',
    bat: { contact: 63, power: 99, speed: 28, arm: 71, fielding: 55, reaction: 46, discipline: 44 },
  },
  {
    team: 'harborpoint', first: 'Wendell', last: 'Pomeroy', pos: 'P', bats: 'R', body: 'average',
    trait: 'Nobody has ever squared him up, including him.',
    pitch: { velocity: 34, control: 71, movement: 99, stamina: 96, composure: 88 },
    repertoire: ['knuckler', 'changeup', 'curve', 'fastball'],
  },
  {
    team: 'cactusflats', first: 'Milo', last: 'Sepulveda', pos: 'LF', bats: 'L', body: 'slim',
    trait: 'Sixty stolen bases, zero regrets, one hamstring.',
    bat: { contact: 87, power: 48, speed: 96, arm: 63, fielding: 82, reaction: 89, discipline: 88 },
  },
  {
    team: 'alpinesummit', first: 'Bruna', last: 'Kovacevic', pos: 'P', bats: 'L', body: 'tall',
    trait: 'The Avalanche. Curveball starts at your ear.',
    pitch: { velocity: 82, control: 89, movement: 95, stamina: 92, composure: 94 },
    repertoire: ['curve', 'slider', 'fastball', 'changeup'],
  },
  {
    team: 'rustforge', first: 'Hatchet', last: 'Wojcik', pos: 'DH', bats: 'R', body: 'huge',
    trait: 'Forty homers, one hundred and ninety strikeouts. Worth it.',
    bat: { contact: 48, power: 99, speed: 33, arm: 60, fielding: 38, reaction: 41, discipline: 30 },
  },
  {
    team: 'prairierock', first: 'Cyrus', last: 'Stallworth', pos: 'P', bats: 'R', body: 'huge',
    trait: 'One hundred and three on the gun. Location optional.',
    pitch: { velocity: 99, control: 52, movement: 74, stamina: 84, composure: 66 },
    repertoire: ['heater', 'fastball', 'slider', 'splitter'],
  },
  {
    team: 'redwoodgrove', first: 'Timber', last: 'Oakhart', pos: 'RF', bats: 'R', body: 'stocky',
    trait: 'Cuts down runners at the plate for fun.',
    bat: { contact: 74, power: 93, speed: 57, arm: 99, fielding: 78, reaction: 70, discipline: 58 },
  },
];

function applyStar(spec: StarSpec, base: Player): Player {
  const p: Player = {
    ...base,
    id: `${spec.team}-${spec.first}-${spec.last}`.toLowerCase().replace(/[^a-z0-9-]/g, ''),
    firstName: spec.first,
    lastName: spec.last,
    bats: spec.bats,
    throws: spec.pos === 'P' ? (spec.bats === 'S' ? 'R' : spec.bats) : base.throws,
    primary: spec.pos,
    body: spec.body,
    trait: spec.trait,
    star: true,
    bat: { ...base.bat, ...spec.bat },
  };
  if (spec.pitch) p.pitch = { ...(base.pitch ?? { velocity: 60, control: 60, movement: 60, stamina: 60, composure: 60 }), ...spec.pitch };
  if (spec.repertoire) p.repertoire = [...spec.repertoire];
  return p;
}

/**
 * Builds the full league. Deterministic in `seed`, so the same league seed
 * always yields the same 200 players with the same names and ratings.
 */
export function buildLeague(seed = hashString('meridian-circuit-v1')): Team[] {
  const rng = new Rng(seed);
  const usedNames = new Set<string>();
  const teams: Team[] = [];

  for (const identity of TEAM_IDENTITIES) {
    const teamRng = rng.fork(hashString(identity.id));
    // Club strength varies a little so the league is not flat, but the spread
    // is deliberately tight: identity should come from the bias table, not from
    // one club rolling badly and being a doormat all season.
    const strength = 53 + teamRng.normal(0, 2.2);

    const hitters: Player[] = [];
    for (const pos of LINEUP_POSITIONS) {
      hitters.push(makeHitter(teamRng, identity.id, pos, strength + teamRng.normal(4, 5), usedNames));
    }
    for (const pos of BENCH_POSITIONS) {
      hitters.push(makeHitter(teamRng, identity.id, pos, strength - 8 + teamRng.normal(0, 5), usedNames));
    }

    const pitchers: Player[] = [];
    for (let i = 0; i < 4; i++) {
      pitchers.push(makePitcher(teamRng, identity.id, true, strength + 10 - i * 4, usedNames));
    }
    for (let i = 0; i < 4; i++) {
      pitchers.push(makePitcher(teamRng, identity.id, false, strength + 6 - i * 3, usedNames));
    }

    // Slot in the club's signature star, replacing the same-position regular.
    const spec = STARS.find((s) => s.team === identity.id);
    if (spec) {
      if (spec.pos === 'P') {
        pitchers[0] = applyStar(spec, pitchers[0]);
      } else {
        const idx = hitters.findIndex((h) => h.primary === spec.pos);
        if (idx >= 0) hitters[idx] = applyStar(spec, hitters[idx]);
      }
    }

    const players = [...hitters, ...pitchers];
    assignNumbers(players, teamRng);

    const starters = hitters.slice(0, LINEUP_POSITIONS.length);
    const lineup = buildBattingOrder(starters).map((p) => p.id);
    const defense = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'].map((slot) => {
      if (slot === 'P') return pitchers[0].id;
      const found = starters.find((p) => p.primary === slot);
      return found ? found.id : starters[0].id;
    });

    teams.push({
      ...identity,
      players,
      lineup,
      defense,
      rotation: pitchers.slice(0, 4).map((p) => p.id),
      bullpen: pitchers.slice(4).map((p) => p.id),
    });
  }

  return teams;
}

function assignNumbers(players: Player[], rng: Rng): void {
  const pool = rng.shuffle(Array.from({ length: 76 }, (_, i) => i + 1));
  players.forEach((p, i) => {
    p.number = pool[i % pool.length];
  });
}

/**
 * Classic arcade batting order: speed and on-base up top, thump in the middle,
 * glove-first players at the bottom.
 */
export function buildBattingOrder(starters: Player[]): Player[] {
  const score = (p: Player, weightPower: number, weightSpeed: number, weightContact: number) =>
    p.bat.power * weightPower + p.bat.speed * weightSpeed + p.bat.contact * weightContact +
    p.bat.discipline * 0.2;

  const pool = [...starters];
  const order: Player[] = [];
  const take = (fn: (p: Player) => number) => {
    let best = 0;
    for (let i = 1; i < pool.length; i++) if (fn(pool[i]) > fn(pool[best])) best = i;
    order.push(pool.splice(best, 1)[0]);
  };

  take((p) => score(p, 0.1, 1.0, 0.8)); // leadoff: speed + contact
  take((p) => score(p, 0.4, 0.5, 1.0)); // 2: best pure hitter
  take((p) => score(p, 1.0, 0.2, 0.8)); // 3: best overall bat
  take((p) => score(p, 1.3, 0.0, 0.4)); // 4: most power
  take((p) => score(p, 1.1, 0.1, 0.5)); // 5: more power
  take((p) => score(p, 0.7, 0.3, 0.6)); // 6
  take((p) => score(p, 0.5, 0.5, 0.6)); // 7
  take((p) => score(p, 0.4, 0.6, 0.5)); // 8
  while (pool.length) order.push(pool.shift()!);
  return order;
}

export function teamById(teams: Team[], id: string): Team {
  return teams.find((t) => t.id === id) ?? teams[0];
}

export function playerById(team: Team, id: string): Player {
  return team.players.find((p) => p.id === id) ?? team.players[0];
}

export function displayName(p: Player): string {
  return `${p.firstName} ${p.lastName}`;
}

export function shortName(p: Player): string {
  return `${p.firstName[0]}. ${p.lastName}`;
}

/** Overall rating shown on the team-select screen. */
export function teamRating(team: Team): { off: number; def: number; pit: number } {
  const starters = team.lineup.map((id) => playerById(team, id));
  const off =
    starters.reduce((s, p) => s + p.bat.contact * 0.5 + p.bat.power * 0.4 + p.bat.speed * 0.1, 0) /
    starters.length;
  const def =
    starters.reduce((s, p) => s + p.bat.fielding * 0.6 + p.bat.arm * 0.25 + p.bat.reaction * 0.15, 0) /
    starters.length;
  const arms = [...team.rotation, ...team.bullpen].map((id) => playerById(team, id));
  const pit =
    arms.reduce(
      (s, p) =>
        s +
        ((p.pitch?.velocity ?? 50) * 0.3 +
          (p.pitch?.control ?? 50) * 0.4 +
          (p.pitch?.movement ?? 50) * 0.3),
      0,
    ) / arms.length;
  return { off: Math.round(off), def: Math.round(def), pit: Math.round(pit) };
}

// ------------------------------------------------------ navigating a league

/**
 * WALKING THE LEAGUE THAT IS ACTUALLY LOADED.
 *
 * These three used to walk `TEAM_IDENTITIES` — this game's own ten clubs — which
 * was correct for exactly as long as there was only one possible league. With an
 * imported MBD world in front of them they cycle through thirty-two clubs that
 * are not there, and every lookup falls through to a default: Quick Play's
 * left/right would change the label to a club that is not in the game, and every
 * ballpark would collapse to Anchor Yard, silently throwing away the park-factor
 * decision the bridge went to some trouble to make.
 *
 * So they take the loaded league. `homeStadiumOf` keeps the built-in table as a
 * *fallback* rather than a source, because a season save holds Meridian club ids
 * and has to keep finding its parks even while an MBD world is loaded for
 * exhibitions.
 */
export function nextTeamId(teams: Team[], id: string): string {
  const i = teams.findIndex((t) => t.id === id);
  return teams[(i + 1) % teams.length].id;
}

export function shiftTeam(teams: Team[], id: string, d: number, forbid: string): string {
  let i = teams.findIndex((t) => t.id === id);
  for (let n = 0; n < teams.length; n++) {
    i = (i + d + teams.length) % teams.length;
    if (teams[i].id !== forbid) return teams[i].id;
  }
  return id;
}

export function homeStadiumOf(teams: Team[], teamId: string): string {
  return (
    teams.find((t) => t.id === teamId)?.homeStadium ??
    TEAM_IDENTITIES.find((t) => t.id === teamId)?.homeStadium ??
    'anchor-yard'
  );
}
