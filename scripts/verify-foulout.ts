/**
 * Regression probe for the caught-foul-fly defect: a foul fly that is caught
 * must record an out AND end the plate appearance. The original bug left the
 * retired batter at the plate, taking pitches with three outs on the board.
 */
import { buildLeague, teamById } from '../src/data/teams';
import { createGameState } from '../src/sim/state';
import { stepGame } from '../src/sim/game';
import { emptyInputPair } from '../src/sim/input';
import { TICK_DT } from '../src/core/constants';
import type { GameSetup } from '../src/core/types';

const league = buildLeague();
const inputs = emptyInputPair();
let games = 0;
let illegalTicks = 0;
let illegalGames = 0;
const offenders: string[] = [];

const SEEDS = [
  56433, 1000, 88109, 499897, 761224, 832495, 1109660, 1252202, 1386825, 325679,
];
for (let i = 0; i < 150; i++) SEEDS.push((1000 + i * 7919) >>> 0);

for (const seed of SEEDS) {
  const away = league[seed % 10];
  const home = league[(seed * 3 + 1) % 10];
  const a = away.id === home.id ? league[(seed + 1) % 10] : away;
  const setup: GameSetup = {
    awayTeamId: a.id,
    homeTeamId: home.id,
    stadiumId: 'thunder-ridge',
    innings: 9,
    difficulty: 'pro',
    awayControl: 'cpu',
    homeControl: 'cpu',
    night: false,
    seed,
  };
  const state = createGameState(setup, teamById(league, a.id), teamById(league, home.id));
  games++;
  let bad = 0;
  for (let t = 0; t < 120 * 60 * 90 && state.phase !== 'final'; t++) {
    stepGame(state, inputs);
    // Three outs may exist only while the play that produced them is resolving.
    if (state.outs >= 3 && (state.phase === 'preplay' || state.phase === 'windup' || state.phase === 'pitch')) {
      bad++;
    }
  }
  if (bad > 0) {
    illegalGames++;
    offenders.push(`seed ${seed}: ${(bad * TICK_DT).toFixed(2)}s of live play with three outs`);
  }
  illegalTicks += bad;
}

console.log(`games checked            : ${games}`);
console.log(`games with 3 outs live   : ${illegalGames}`);
console.log(`total illegal seconds    : ${(illegalTicks * TICK_DT).toFixed(2)}`);
for (const o of offenders.slice(0, 10)) console.log('  ' + o);
process.exit(illegalGames ? 1 : 0);
