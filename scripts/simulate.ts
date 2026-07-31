/**
 * Batch CPU-vs-CPU simulation harness.
 *
 *   npx tsx scripts/simulate.ts [games] [innings] [difficulty]
 *
 * Prints a distribution of results plus every anomaly detected by
 * validateState(). This is the tool used to hunt deadlocks and rule bugs.
 */
import { buildLeague } from '../src/data/teams';
import { simulateGame, summarize } from '../src/sim/autoplay';
import type { Difficulty, GameSetup } from '../src/core/types';
import { STADIUMS } from '../src/data/stadiums';

const games = Number(process.argv[2] ?? 100);
const innings = Number(process.argv[3] ?? 3);
const difficulty = (process.argv[4] ?? 'pro') as Difficulty;

const league = buildLeague();
const t0 = Date.now();

let completed = 0;
let totalRuns = 0;
let totalHits = 0;
let totalPitches = 0;
let extraInningGames = 0;
let walkOffs = 0;
let shutouts = 0;
let homers = 0;
let strikeouts = 0;
let walks = 0;
let errors = 0;
let forcedResolutions = 0;
let pa = 0;
let ab = 0;
let singles = 0;
let doubles = 0;
let triples = 0;
const d = { pitches: 0, inZone: 0, swings: 0, swingMisses: 0, fouls: 0, ballsInPlay: 0, called: 0, balls: 0 };
const issues: string[] = [];
const runDist = new Map<number, number>();

for (let i = 0; i < games; i++) {
  const away = league[i % league.length];
  const home = league[(i * 3 + 1) % league.length];
  if (away.id === home.id) continue;
  const stadium = STADIUMS[i % STADIUMS.length];
  const setup: GameSetup = {
    awayTeamId: away.id,
    homeTeamId: home.id,
    stadiumId: stadium.id,
    innings,
    difficulty,
    awayControl: 'cpu',
    homeControl: 'cpu',
    night: i % 2 === 0,
    seed: 1000 + i * 7919,
  };
  const report = simulateGame(setup, away, home);
  const s = summarize(report);
  if (report.completed) completed++;
  totalRuns += s.runs;
  totalHits += s.hits;
  totalPitches += s.pitches;
  forcedResolutions += report.state.diag.forcedResolutions;
  d.pitches += report.state.diag.pitches;
  d.inZone += report.state.diag.inZone;
  d.swings += report.state.diag.swings;
  d.swingMisses += report.state.diag.swingMisses;
  d.fouls += report.state.diag.fouls;
  d.ballsInPlay += report.state.diag.ballsInPlay;
  d.called += report.state.diag.calledStrikes;
  d.balls += report.state.diag.ballsThrown;
  if (s.innings > innings) extraInningGames++;
  if (report.result?.walkOff) walkOffs++;
  if (report.result && (report.result.awayRuns === 0 || report.result.homeRuns === 0)) shutouts++;
  for (const line of Object.values(report.result?.batting ?? {})) {
    homers += line.hr;
    strikeouts += line.so;
    walks += line.bb;
  }
  errors += (report.result?.awayErrors ?? 0) + (report.result?.homeErrors ?? 0);
  runDist.set(s.runs, (runDist.get(s.runs) ?? 0) + 1);
  for (const line of Object.values(report.result?.batting ?? {})) {
    pa += line.pa;
    ab += line.ab;
    singles += line.h - line.doubles - line.triples - line.hr;
    doubles += line.doubles;
    triples += line.triples;
  }
  if (s.issues.length) {
    issues.push(`game ${i} (${away.abbr}@${home.abbr}, seed ${setup.seed}): ${s.issues.join('; ')}`);
  }
  if ((i + 1) % 20 === 0) process.stdout.write(`  ...${i + 1}/${games}\n`);
}

const secs = (Date.now() - t0) / 1000;
console.log('\n================ SIMULATION REPORT ================');
console.log(`games            : ${games} (${innings} innings, ${difficulty})`);
console.log(`completed        : ${completed}/${games}`);
console.log(`wall clock       : ${secs.toFixed(1)}s  (${(secs / games).toFixed(2)}s per game)`);
console.log(`runs per game    : ${(totalRuns / games).toFixed(2)}`);
console.log(`hits per game    : ${(totalHits / games).toFixed(2)}`);
console.log(`HR per game      : ${(homers / games).toFixed(2)}`);
console.log(`K per game       : ${(strikeouts / games).toFixed(2)}`);
console.log(`BB per game      : ${(walks / games).toFixed(2)}`);
console.log(`E per game       : ${(errors / games).toFixed(2)}`);
console.log(`pitches per game : ${(totalPitches / games).toFixed(1)}`);
const bip = ab - strikeouts;
console.log(`PA / AB per game : ${(pa / games).toFixed(1)} / ${(ab / games).toFixed(1)}`);
console.log(`AVG              : ${(totalHits / Math.max(1, ab)).toFixed(3)}`);
console.log(`BABIP            : ${((totalHits - homers) / Math.max(1, bip - homers)).toFixed(3)}`);
console.log(`1B/2B/3B per game: ${(singles / games).toFixed(1)} / ${(doubles / games).toFixed(1)} / ${(triples / games).toFixed(1)}`);
console.log(`K% / BB%         : ${((strikeouts / Math.max(1, pa)) * 100).toFixed(1)}% / ${((walks / Math.max(1, pa)) * 100).toFixed(1)}%`);
const pct = (a: number, b: number) => ((a / Math.max(1, b)) * 100).toFixed(1) + '%';
console.log(`pitches per PA   : ${(d.pitches / Math.max(1, pa)).toFixed(2)}`);
console.log(`in-zone / swing  : ${pct(d.inZone, d.pitches)} / ${pct(d.swings, d.pitches)}`);
console.log(`whiff/swing      : ${pct(d.swingMisses, d.swings)}`);
console.log(`foul% of pitches : ${pct(d.fouls, d.pitches)}   inplay%: ${pct(d.ballsInPlay, d.pitches)}   ball%: ${pct(d.balls, d.pitches)}   called K%: ${pct(d.called, d.pitches)}`);
console.log(`extra innings    : ${extraInningGames}`);
console.log(`walk-offs        : ${walkOffs}`);
console.log(`shutouts         : ${shutouts}`);
console.log(`forced play ends : ${forcedResolutions}`);
console.log(`anomalies        : ${issues.length}`);
const dist = [...runDist.entries()].sort((a, b) => a[0] - b[0]);
console.log(`combined runs    : ${dist.map(([k, v]) => `${k}:${v}`).join(' ')}`);
if (issues.length) {
  console.log('\n--- ISSUES ---');
  for (const s of issues.slice(0, 40)) console.log('  ' + s);
  if (issues.length > 40) console.log(`  ...and ${issues.length - 40} more`);
}
console.log('===================================================\n');

process.exit(issues.length || completed < games ? 1 : 0);
