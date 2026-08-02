import type { ArcadeDivision } from './contract';

/**
 * THE MBD FRANCHISE CATALOG.
 *
 * Thirty-two clubs, transcribed from the arcade-world handoff. These IDs are
 * permanent joins — never match a club by name — and the park factors are MBD's
 * own team/advanced-stat adjustments where 1.00 is neutral.
 *
 * **This is a copy, and copies rot.** The handoff is explicit that an
 * implementation must re-check the live source rather than trust a transcription
 * indefinitely; the authority is `packages/sim-core/src/league/teams.ts` for the
 * franchises and divisions, and `apps/web/src/shared/components/TeamLogo.tsx`
 * for the colours, which currently live in a React component rather than in
 * shared data. When a real exporter exists, a bundle carries all of this and
 * this file becomes fixture material only.
 *
 * Transcribed 2026-08-02 against the handoff dated to MBD snapshot schema 48.
 */

export interface MbdFranchise {
  id: string;
  city: string;
  name: string;
  fullName: string;
  abbr: string;
  division: ArcadeDivision;
  parkFactor: number;
  background: string;
  text: string;
  accent: string;
  logoAsset: string;
}

export const MBD_FRANCHISES: MbdFranchise[] = [
  f('nym', 'New York', 'Tycoons', 'NYT', 'AL_EAST', 1.01, '#1a1a4e', '#f0e68c', '#c5a000'),
  f('phi', 'Philadelphia', 'Liberty Bells', 'PHI', 'AL_EAST', 1.02, '#002b5c', '#d4a843', '#b5942f'),
  f('bos', 'Boston', 'Noreasters', 'BOS', 'AL_EAST', 1.04, '#1c3652', '#8ec8f0', '#4da8da'),
  f('bal', 'Baltimore', 'Crab Cakes', 'BAL', 'AL_EAST', 0.99, '#e04d2d', '#ffffff', '#ff7b54'),
  f('wsh', 'Washington', 'Monuments', 'WSH', 'AL_EAST', 1.0, '#3c3b6e', '#ffffff', '#b22234'),
  f('chi', 'Chicago', 'Deep Dish', 'CHI', 'AL_CENTRAL', 1.03, '#c41e3a', '#ffffff', '#f4c430'),
  f('det', 'Detroit', 'Motor Kings', 'DET', 'AL_CENTRAL', 0.99, '#0d1b2a', '#6ca4c0', '#4a8eb5'),
  f('cle', 'Cleveland', 'Forge', 'CLE', 'AL_CENTRAL', 0.98, '#4a4a4a', '#ff6b35', '#e05030'),
  f('col', 'Columbus', 'Wayfinders', 'CLB', 'AL_CENTRAL', 1.0, '#bb0000', '#d1d1d1', '#666666'),
  f('pit', 'Pittsburgh', 'Smokestack', 'PIT', 'AL_CENTRAL', 0.98, '#1a1a1a', '#f5c542', '#e0a000'),
  f('kc', 'Kansas City', 'BBQ Fountains', 'KCF', 'AL_WEST', 1.0, '#c41230', '#f8f0e0', '#f97316'),
  f('msp', 'Minneapolis', 'Frost Giants', 'MSP', 'AL_WEST', 1.01, '#0f2540', '#aed6f1', '#5dade2'),
  f('stl', 'St. Louis', 'Archers', 'STL', 'AL_WEST', 0.99, '#6b0a0a', '#c9a857', '#b59540'),
  f('ind', 'Indianapolis', 'Speedsters', 'IND', 'AL_WEST', 1.0, '#001b44', '#e74c3c', '#c0392b'),
  f('mil', 'Milwaukee', 'Suds', 'MIL', 'AL_WEST', 1.0, '#14325a', '#f4d47c', '#d4b44c'),
  f('nas', 'Nashville', 'Honky Tonks', 'NAS', 'AL_WEST', 1.01, '#1a1a1a', '#ff6b6b', '#e55555'),
  f('mia', 'Miami', 'Palms', 'MIA', 'NL_EAST', 0.96, '#003b5c', '#ff8c42', '#ff6b1a'),
  f('atl', 'Atlanta', 'Peach Kings', 'ATL', 'NL_EAST', 1.01, '#ce1141', '#ffd700', '#e6c200'),
  f('cha', 'Charlotte', 'Weavers', 'CHA', 'NL_EAST', 1.0, '#1d1160', '#00b6a0', '#009e8a'),
  f('orl', 'Orlando', 'Sunbursts', 'ORL', 'NL_EAST', 1.0, '#004878', '#ffffff', '#fbb034'),
  f('ral', 'Raleigh', 'Pines', 'RAL', 'NL_EAST', 0.99, '#2c5234', '#c0e0c8', '#88c098'),
  f('hou', 'Houston', 'Starliners', 'HOU', 'NL_CENTRAL', 1.02, '#002d62', '#ff6a00', '#e06000'),
  f('dal', 'Dallas', 'Lone Stars', 'DAL', 'NL_CENTRAL', 1.03, '#00205b', '#ffffff', '#b3995d'),
  f('sat', 'San Antonio', 'Riverwalk', 'SAT', 'NL_CENTRAL', 1.0, '#4a2c00', '#7ec8e3', '#5eb0cc'),
  f('den', 'Denver', 'Altitude', 'DEN', 'NL_CENTRAL', 1.12, '#3b1c75', '#c084fc', '#a855f7'),
  f('aus', 'Austin', 'Bat Colony', 'AUS', 'NL_CENTRAL', 1.01, '#1a1a2e', '#6bc700', '#52a000'),
  f('lax', 'Los Angeles', 'Sunset Strip', 'LAX', 'NL_WEST', 0.99, '#ff6347', '#1a1a4e', '#ff4500'),
  f('sfb', 'San Francisco', 'Sourdoughs', 'SFB', 'NL_WEST', 0.95, '#d2a96a', '#2c1810', '#b8924e'),
  f('phx', 'Phoenix', 'Copperbirds', 'PHX', 'NL_WEST', 1.02, '#c2420a', '#f5deb3', '#ff8c42'),
  f('sea', 'Seattle', 'Drizzle', 'SEA', 'NL_WEST', 0.97, '#003b4d', '#69be94', '#4da378'),
  f('sdg', 'San Diego', 'Surf Hounds', 'SDG', 'NL_WEST', 0.97, '#0c2340', '#ffc72c', '#e6b425'),
  f('por', 'Portland', 'Sasquatch', 'POR', 'NL_WEST', 1.0, '#2d4a1e', '#d4c5a0', '#8fbc60'),
];

/** MBD's opening historical rivalries. Dynamic save state supersedes these. */
export const MBD_OPENING_RIVALRIES = [
  { id: 'nym-bos', teamA: 'nym', teamB: 'bos', intensity: 78 },
  { id: 'lax-sfb', teamA: 'lax', teamB: 'sfb', intensity: 76 },
  { id: 'chi-det', teamA: 'chi', teamB: 'det', intensity: 72 },
];

function f(
  id: string,
  city: string,
  name: string,
  abbr: string,
  division: ArcadeDivision,
  parkFactor: number,
  background: string,
  text: string,
  accent: string,
): MbdFranchise {
  return {
    id,
    city,
    name,
    fullName: `${city} ${name}`,
    abbr,
    division,
    parkFactor,
    background,
    text,
    accent,
    logoAsset: `logos/${id}.svg`,
  };
}
