/**
 * Regression checks for the bookkeeping defects found during test development:
 * walk-off snapshots, home-run run/RBI double counting, and derby swing-offs.
 * Kept as a script so the exact reported reproductions stay runnable.
 */
import { buildLeague, teamById } from '../src/data/teams';
import { simulateGame } from '../src/sim/autoplay';
import type { GameSetup } from '../src/core/types';

const league = buildLeague();
let checked = 0;
let walkOffMismatch = 0;
let pitcherRunMismatch = 0;
let rbiMismatch = 0;

for (let i = 0; i < 200; i++) {
  const away = league[i % 10];
  const home = league[(i * 3 + 1) % 10];
  if (away.id === home.id) continue;
  const setup: GameSetup = {
    awayTeamId: away.id,
    homeTeamId: home.id,
    stadiumId: 'grove-park',
    innings: 3,
    difficulty: 'pro',
    awayControl: 'cpu',
    homeControl: 'cpu',
    night: false,
    seed: (978983025 + i * 7919) >>> 0,
  };
  const rep = simulateGame(setup, teamById(league, away.id), teamById(league, home.id), {
    validate: false,
  });
  const r = rep.result!;
  const s = rep.state.stats;
  checked++;
  if (r.awayRuns !== s.away.runs || r.homeRuns !== s.home.runs) walkOffMismatch++;

  let pr = 0;
  for (const line of Object.values(r.pitching)) pr += line.r;
  if (pr !== r.awayRuns + r.homeRuns) pitcherRunMismatch++;

  let rbi = 0;
  for (const line of Object.values(r.batting)) rbi += line.rbi;
  if (rbi > r.awayRuns + r.homeRuns) rbiMismatch++;
}

console.log(`games checked            : ${checked}`);
console.log(`result vs live-score gap : ${walkOffMismatch}`);
console.log(`pitcher runs != game runs: ${pitcherRunMismatch}`);
console.log(`RBI exceeding runs       : ${rbiMismatch}`);
process.exit(walkOffMismatch || pitcherRunMismatch || rbiMismatch ? 1 : 0);
