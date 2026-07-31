/**
 * Extra-innings tiebreaker probe.
 *
 * One-inning games tie constantly, which makes them the cheapest way to
 * exercise extra innings hard. From two innings past regulation each half
 * starts with a runner on second, so a tie cannot run away.
 */
import { buildLeague, teamById } from '../src/data/teams';
import { simulateGame } from '../src/sim/autoplay';
import type { GameSetup } from '../src/core/types';

const league = buildLeague();
let games = 0;
let extras = 0;
let worst = 0;
let worstSeed = 0;
let total = 0;
let unfinished = 0;
let anomalies = 0;

for (let i = 0; i < 300; i++) {
  const seed = (12838 + i * 4271) >>> 0;
  const away = league[seed % 10];
  const home = league[(seed * 3 + 1) % 10];
  const a = away.id === home.id ? league[(seed + 1) % 10] : away;
  const setup: GameSetup = {
    awayTeamId: a.id,
    homeTeamId: home.id,
    stadiumId: 'comet-dome',
    innings: 1,
    difficulty: 'pro',
    awayControl: 'cpu',
    homeControl: 'cpu',
    night: true,
    seed,
  };
  const rep = simulateGame(setup, teamById(league, a.id), teamById(league, home.id), {});
  games++;
  if (!rep.completed) unfinished++;
  anomalies += rep.anomalies.length;
  const innings = rep.state.inning;
  total += innings;
  if (innings > 1) extras++;
  if (innings > worst) {
    worst = innings;
    worstSeed = seed;
  }
}

console.log(`games                 : ${games} (one-inning regulation, CPU vs CPU)`);
console.log(`went to extra innings : ${extras}`);
console.log(`unfinished            : ${unfinished}`);
console.log(`anomalies             : ${anomalies}`);
console.log(`longest game (innings): ${worst}  (seed ${worstSeed})`);
console.log(`mean innings          : ${(total / games).toFixed(2)}`);
process.exit(unfinished || anomalies || worst > 10 ? 1 : 0);
