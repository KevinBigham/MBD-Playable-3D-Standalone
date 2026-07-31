import type {
  BatterAttributes,
  BodyType,
  Handedness,
  PitchType,
  PitcherAttributes,
  Player,
  PositionCode,
  Team,
} from '../core/types';
import { clamp } from '../core/constants';
import { SLOT, loadSlot, saveSlot } from '../save/storage';
import { buildBattingOrder } from '../data/teams';

/**
 * Player creator.
 *
 * Created players are stored on their own and injected into the league at
 * start-up, replacing the weakest player at their position on the club they
 * were assigned to. Keeping them separate from the generated pool means a save
 * can never be corrupted by a roster edit, and deleting a creation restores the
 * original roster exactly.
 */

export const ATTR_MIN = 20;
export const ATTR_MAX = 99;

/** Total points a hitter may distribute across seven ratings. */
export const HITTER_POINTS = 430;
/** Total points a pitcher may distribute across five ratings. */
export const PITCHER_POINTS = 320;

export interface CustomPlayer {
  id: string;
  firstName: string;
  lastName: string;
  number: number;
  teamId: string;
  primary: PositionCode;
  bats: Handedness;
  throws: Handedness;
  body: BodyType;
  skinTone: number;
  bat: BatterAttributes;
  pitch?: PitcherAttributes;
  repertoire?: PitchType[];
  createdAt: number;
}

export const BODY_TYPES: BodyType[] = ['slim', 'average', 'stocky', 'tall', 'huge'];
export const POSITIONS: PositionCode[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'P'];

export function newCustomPlayer(teamId: string): CustomPlayer {
  return {
    id: `custom-${Math.abs(hash(`${teamId}-${Date.now()}`)).toString(36)}`,
    firstName: 'New',
    lastName: 'Player',
    number: 0,
    teamId,
    primary: 'CF',
    bats: 'R',
    throws: 'R',
    body: 'average',
    skinTone: 0.5,
    // A balanced starting point that deliberately leaves headroom, so the very
    // first thing a player does can be to improve something.
    bat: { contact: 57, power: 57, speed: 57, arm: 57, fielding: 57, reaction: 57, discipline: 58 },
    pitch: { velocity: 58, control: 58, movement: 58, stamina: 58, composure: 58 },
    repertoire: ['fastball', 'slider', 'changeup', 'curve'],
    createdAt: Date.now(),
  };
}

function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

export function hitterPointsUsed(p: CustomPlayer): number {
  const b = p.bat;
  return b.contact + b.power + b.speed + b.arm + b.fielding + b.reaction + b.discipline;
}

export function pitcherPointsUsed(p: CustomPlayer): number {
  const q = p.pitch;
  if (!q) return 0;
  return q.velocity + q.control + q.movement + q.stamina + q.composure;
}

export function pointsRemaining(p: CustomPlayer): number {
  return p.primary === 'P'
    ? PITCHER_POINTS - pitcherPointsUsed(p)
    : HITTER_POINTS - hitterPointsUsed(p);
}

/** Adjusts one rating, refusing to overspend the pool. */
export function adjust(
  p: CustomPlayer,
  group: 'bat' | 'pitch',
  key: string,
  delta: number,
): boolean {
  const target = group === 'bat' ? (p.bat as unknown as Record<string, number>) : (p.pitch as unknown as Record<string, number>);
  if (!target) return false;
  const current = target[key] ?? ATTR_MIN;
  const next = clamp(current + delta, ATTR_MIN, ATTR_MAX);
  if (next === current) return false;
  const spent = next - current;
  if (spent > 0 && pointsRemaining(p) < spent) return false;
  target[key] = next;
  return true;
}

export function isValid(p: CustomPlayer): { ok: boolean; reason: string } {
  if (!p.firstName.trim() || !p.lastName.trim()) return { ok: false, reason: 'Needs a first and last name.' };
  if (p.firstName.length > 14 || p.lastName.length > 18) return { ok: false, reason: 'Name is too long.' };
  if (pointsRemaining(p) < 0) return { ok: false, reason: 'Too many rating points spent.' };
  return { ok: true, reason: '' };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function loadCustomPlayers(): CustomPlayer[] {
  const raw = loadSlot<CustomPlayer[]>(SLOT.customPlayers);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p) => p && typeof p.id === 'string' && typeof p.teamId === 'string' && p.bat,
  );
}

export function saveCustomPlayers(list: CustomPlayer[]): boolean {
  return saveSlot(SLOT.customPlayers, list);
}

// ---------------------------------------------------------------------------
// Injection into the league
// ---------------------------------------------------------------------------

function toPlayer(c: CustomPlayer): Player {
  const p: Player = {
    id: c.id,
    firstName: c.firstName.trim(),
    lastName: c.lastName.trim(),
    number: c.number || 0,
    bats: c.bats,
    throws: c.throws,
    primary: c.primary,
    secondary: [],
    body: c.body,
    skinTone: c.skinTone,
    bat: { ...c.bat },
    trait: 'Created by you.',
    custom: true,
  };
  if (c.primary === 'P') {
    p.pitch = { ...(c.pitch ?? { velocity: 60, control: 60, movement: 60, stamina: 60, composure: 60 }) };
    p.repertoire = [...(c.repertoire ?? ['fastball'])];
  }
  return p;
}

/**
 * Replaces the weakest same-position player on the assigned club with each
 * creation. Mutates the supplied league in place and re-derives the affected
 * club's batting order, line-up and staff so the change is immediately live.
 */
export function applyCustomPlayers(teams: Team[], customs: CustomPlayer[]): void {
  for (const c of customs) {
    const team = teams.find((t) => t.id === c.teamId);
    if (!team) continue;
    const created = toPlayer(c);

    if (created.primary === 'P') {
      const arms = team.players.filter((p) => p.primary === 'P');
      if (!arms.length) continue;
      const weakest = arms.reduce((a, b) => (rate(a) <= rate(b) ? a : b));
      swap(team, weakest.id, created);
      team.rotation = team.rotation.map((id) => (id === weakest.id ? created.id : id));
      team.bullpen = team.bullpen.map((id) => (id === weakest.id ? created.id : id));
      if (!team.rotation.includes(created.id) && !team.bullpen.includes(created.id)) {
        team.rotation[team.rotation.length - 1] = created.id;
      }
      team.defense[0] = team.rotation[0];
      continue;
    }

    const samePos = team.players.filter((p) => p.primary === created.primary && p.primary !== 'P');
    const pool = samePos.length ? samePos : team.players.filter((p) => p.primary !== 'P');
    if (!pool.length) continue;
    const weakest = pool.reduce((a, b) => (rate(a) <= rate(b) ? a : b));
    swap(team, weakest.id, created);

    team.lineup = team.lineup.map((id) => (id === weakest.id ? created.id : id));
    team.defense = team.defense.map((id) => (id === weakest.id ? created.id : id));

    // Reorder the batting order so a created star is not buried at the bottom.
    const starters = team.lineup.map((id) => team.players.find((p) => p.id === id)!).filter(Boolean);
    if (starters.length === team.lineup.length) {
      team.lineup = buildBattingOrder(starters).map((p) => p.id);
    }
  }
}

function rate(p: Player): number {
  if (p.primary === 'P') {
    const q = p.pitch;
    if (!q) return 0;
    return q.velocity * 0.3 + q.control * 0.4 + q.movement * 0.3;
  }
  return p.bat.contact * 0.4 + p.bat.power * 0.3 + p.bat.fielding * 0.2 + p.bat.speed * 0.1;
}

function swap(team: Team, oldId: string, created: Player): void {
  const idx = team.players.findIndex((p) => p.id === oldId);
  if (idx < 0) return;
  if (!created.number) {
    created.number = team.players[idx].number;
  }
  team.players[idx] = created;
}
