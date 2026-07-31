import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildLeague } from '../data/teams';
import {
  ATTR_MAX,
  ATTR_MIN,
  HITTER_POINTS,
  PITCHER_POINTS,
  adjust,
  applyCustomPlayers,
  isValid,
  loadCustomPlayers,
  newCustomPlayer,
  pointsRemaining,
  saveCustomPlayers,
} from '../modes/creator';
import { simulateGame } from '../sim/autoplay';

const mem = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
let saved: unknown;

beforeAll(() => {
  saved = g.localStorage;
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  };
});

afterAll(() => {
  g.localStorage = saved;
  mem.clear();
});

describe('player creator', () => {
  it('enforces the rating point pool in both directions', () => {
    const p = newCustomPlayer('coralkey');
    const start = pointsRemaining(p);
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(HITTER_POINTS);

    // Spend the pool dry, then confirm nothing else can be raised...
    let spent = 0;
    while (adjust(p, 'bat', 'power', 1)) spent++;
    expect(spent).toBeGreaterThan(0);
    expect(pointsRemaining(p)).toBe(0);
    const contactBefore = p.bat.contact;
    expect(adjust(p, 'bat', 'contact', 1)).toBe(false);
    expect(p.bat.contact).toBe(contactBefore);

    // ...and that giving a point back frees exactly one point to spend again.
    expect(adjust(p, 'bat', 'speed', -1)).toBe(true);
    expect(pointsRemaining(p)).toBe(1);
    expect(adjust(p, 'bat', 'contact', 1)).toBe(true);
    expect(pointsRemaining(p)).toBe(0);

    // Ratings stay inside the legal band.
    for (let i = 0; i < 400; i++) adjust(p, 'bat', 'power', 1);
    expect(p.bat.power).toBeLessThanOrEqual(ATTR_MAX);
    for (let i = 0; i < 400; i++) adjust(p, 'bat', 'speed', -1);
    expect(p.bat.speed).toBe(ATTR_MIN);
  });

  it('uses a separate, smaller pool for pitchers', () => {
    const p = newCustomPlayer('ironport');
    p.primary = 'P';
    expect(pointsRemaining(p)).toBe(PITCHER_POINTS - 58 * 5);
  });

  it('rejects a nameless creation', () => {
    const p = newCustomPlayer('ironport');
    p.firstName = '   ';
    expect(isValid(p).ok).toBe(false);
    p.firstName = 'Kip';
    expect(isValid(p).ok).toBe(true);
  });

  it('round-trips through storage and rejects a corrupt payload', () => {
    const p = newCustomPlayer('novabay');
    p.firstName = 'Kip';
    p.lastName = 'Vandergriff';
    expect(saveCustomPlayers([p])).toBe(true);
    expect(loadCustomPlayers()).toHaveLength(1);

    mem.set('moonshot9:customPlayers', '{"v":3,"t":1,"data":"not an array"}');
    expect(loadCustomPlayers()).toEqual([]);
    mem.clear();
  });

  it('replaces exactly one player and keeps the roster the same size', () => {
    const league = buildLeague();
    const before = league.find((t) => t.id === 'coralkey')!.players.length;

    const p = newCustomPlayer('coralkey');
    p.firstName = 'Kip';
    p.lastName = 'Vandergriff';
    p.primary = '1B';
    applyCustomPlayers(league, [p]);

    const team = league.find((t) => t.id === 'coralkey')!;
    expect(team.players).toHaveLength(before);
    expect(team.players.filter((x) => x.custom)).toHaveLength(1);
    expect(team.lineup).toContain(p.id);
    expect(team.defense).toContain(p.id);
    // The line-up must still be nine distinct players.
    expect(new Set(team.lineup).size).toBe(9);
    expect(new Set(team.defense).size).toBe(9);
  });

  it('places a created pitcher on the staff and keeps the rotation valid', () => {
    const league = buildLeague();
    const p = newCustomPlayer('prairierock');
    p.firstName = 'Ada';
    p.lastName = 'Northcutt';
    p.primary = 'P';
    applyCustomPlayers(league, [p]);

    const team = league.find((t) => t.id === 'prairierock')!;
    const staff = [...team.rotation, ...team.bullpen];
    expect(staff).toContain(p.id);
    expect(new Set(staff).size).toBe(staff.length);
    expect(team.defense[0]).toBe(team.rotation[0]);
    for (const id of staff) {
      expect(team.players.find((x) => x.id === id)).toBeTruthy();
    }
  });

  it('leaves the league untouched when there are no creations', () => {
    const a = buildLeague();
    const b = buildLeague();
    applyCustomPlayers(b, []);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('a club containing a created player still completes a full game', () => {
    const league = buildLeague();
    const p = newCustomPlayer('coralkey');
    p.firstName = 'Kip';
    p.lastName = 'Vandergriff';
    p.primary = 'SS';
    const q = newCustomPlayer('ironport');
    q.firstName = 'Ada';
    q.lastName = 'Northcutt';
    q.primary = 'P';
    applyCustomPlayers(league, [p, q]);

    const away = league.find((t) => t.id === 'coralkey')!;
    const home = league.find((t) => t.id === 'ironport')!;
    const rep = simulateGame(
      {
        awayTeamId: away.id,
        homeTeamId: home.id,
        stadiumId: 'anchor-yard',
        innings: 3,
        difficulty: 'pro',
        awayControl: 'cpu',
        homeControl: 'cpu',
        night: false,
        seed: 8181,
      },
      away,
      home,
      {},
    );
    expect(rep.completed).toBe(true);
    expect(rep.anomalies).toEqual([]);
    expect(rep.result!.awayRuns).not.toBe(rep.result!.homeRuns);
  });
});
