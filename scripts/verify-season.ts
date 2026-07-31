/**
 * End-to-end season integrity check: play a whole season the way the UI does,
 * then run the postseason, then reload it from a save.
 */
import { buildLeague, teamById } from '../src/data/teams';
import {
  activeSeries,
  advanceToUserGame,
  applyPlayoffGame,
  createSeason,
  loadSeason,
  nextSeriesMatchup,
  nextUserGame,
  regularSeasonComplete,
  saveSeason,
  simulateScheduledGame,
  sortedStandings,
  startPlayoffs,
} from '../src/modes/season';
import { simulateGame } from '../src/sim/autoplay';

const g: any = globalThis;
const mem = new Map<string, string>();
g.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};

const league = buildLeague();
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
};

for (const length of ['short', 'standard'] as const) {
  const season = createSeason({
    userTeamId: 'ironport',
    difficulty: 'pro',
    innings: 3,
    length,
    seed: 4242,
  });
  const expectedGames = (season.gamesPerTeam * 10) / 2;
  check(`${length}: schedule size`, season.schedule.length === expectedGames,
    `${season.schedule.length}/${expectedGames}`);

  const perTeam = new Map<string, number>();
  for (const gm of season.schedule) {
    perTeam.set(gm.awayId, (perTeam.get(gm.awayId) ?? 0) + 1);
    perTeam.set(gm.homeId, (perTeam.get(gm.homeId) ?? 0) + 1);
  }
  check(`${length}: every club plays ${season.gamesPerTeam}`,
    [...perTeam.values()].every((v) => v === season.gamesPerTeam),
    [...perTeam.values()].join(','));

  advanceToUserGame(season, league);
  let guard = 0;
  while (nextUserGame(season) && guard++ < 500) {
    const gm = nextUserGame(season)!;
    simulateScheduledGame(season, gm, league);
    advanceToUserGame(season, league);
  }
  advanceToUserGame(season, league);
  check(`${length}: regular season completes`, regularSeasonComplete(season));

  const rows = sortedStandings(season);
  const w = rows.reduce((a, r) => a + r.w, 0);
  const l = rows.reduce((a, r) => a + r.l, 0);
  const rf = rows.reduce((a, r) => a + r.rf, 0);
  const ra = rows.reduce((a, r) => a + r.ra, 0);
  check(`${length}: wins equal losses`, w === l, `${w}/${l}`);
  check(`${length}: runs for equal runs against`, rf === ra, `${rf}/${ra}`);
  check(`${length}: games equal wins`, w === expectedGames, `${w}/${expectedGames}`);

  startPlayoffs(season);
  guard = 0;
  while (!season.championId && guard++ < 40) {
    const series = activeSeries(season);
    if (!series) break;
    const m = nextSeriesMatchup(series);
    const rep = simulateGame(
      {
        awayTeamId: m.awayId,
        homeTeamId: m.homeId,
        stadiumId: 'comet-dome',
        innings: 3,
        difficulty: 'pro',
        awayControl: 'cpu',
        homeControl: 'cpu',
        night: true,
        seed: 700 + guard,
      },
      teamById(league, m.awayId),
      teamById(league, m.homeId),
      { validate: false },
    );
    applyPlayoffGame(season, series, m.awayId, m.homeId, rep.result!);
  }
  check(`${length}: champion crowned`, !!season.championId, season.championId ?? 'none');
  check(`${length}: bracket has 3 series`, season.playoffs?.length === 3);

  saveSeason(season);
  const back = loadSeason();
  check(`${length}: save round-trip`, back?.championId === season.championId);

  mem.set('moonshot9:season', '{"v":3,"t":1,"data":{"broken":true}}');
  check(`${length}: corrupt save rejected`, loadSeason() === null);
  mem.clear();
}

process.exit(failures ? 1 : 0);
