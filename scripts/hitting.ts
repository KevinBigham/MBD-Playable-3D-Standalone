/**
 * How hard is it for a *person* to get a hit?
 *
 *   npx tsx scripts/hitting.ts [games] [innings] [difficulty]
 *
 * The CPU-vs-CPU harness cannot answer this. The CPU hitter reads the pitch's
 * true crossing point and true arrival time out of the state and swings at them,
 * so it measures the physics and the rules and says nothing at all about the one
 * thing a player experiences: aiming at a moving target with a thumb and being
 * a bit wrong about where and when.
 *
 * So this drives full games through the real engine with a synthetic hitter that
 * is *wrong on purpose*. It reads the truth — the crossing point and the arrival
 * time — and then corrupts both with a fixed error model before doing anything
 * with them. That corruption is the human. Everything downstream is the same
 * engine a person plays.
 *
 * The output is a sweep rather than a number, because the honest answer depends
 * on how accurate the player is, and nobody knows that figure for a real thumb
 * on real glass. A sweep says "at this accuracy you get this many hits", and the
 * player's own report — one hit a game — locates them on it.
 *
 * WHAT THIS IS NOT: a claim about real hardware. It models a person as unbiased
 * Gaussian error around the truth, which is generous in one direction (a real
 * player is sometimes fooled badly and systematically late on a good fastball)
 * and harsh in another (a real player learns a pitcher). It is a *comparator* —
 * good for "did this change help, and by how much" — not a predictor of anyone's
 * batting average.
 */
import { buildLeague } from '../src/data/teams';
import { createGameState, currentBatter } from '../src/sim/state';
import { stepGame } from '../src/sim/game';
import { emptyInputPair, clearEdges } from '../src/sim/input';
import { swingProfile } from '../src/sim/contact';
import { Rng } from '../src/core/rng';
import { TICK_DT, ZONE_BOTTOM, ZONE_HALF_WIDTH, ZONE_TOP } from '../src/core/constants';
import type { Difficulty, GameSetup } from '../src/core/types';

const GAMES = Number(process.argv[2] ?? 12);
const INNINGS = Number(process.argv[3] ?? 9);
const DIFFICULTY = (process.argv[4] ?? 'rookie') as Difficulty;

/**
 * How wrong the person is.
 *
 * `place` is the standard deviation of where they think the ball will cross, in
 * metres, applied to both axes. For scale: the strike zone is 43 cm wide and
 * 60 cm tall, and on a landscape phone it is about 90 screen pixels across — so
 * 0.06 m is roughly a finger's width of error.
 *
 * `time` is the standard deviation of when they think it gets there, in seconds.
 */
interface Hands {
  name: string;
  place: number;
  time: number;
}

/**
 * The last two rows exist to answer "which of the two errors is actually
 * killing me". They are not people — nobody has 2 cm hands and 150 ms timing —
 * they isolate one axis at a time so a fix can be aimed at the axis that hurts
 * instead of at whichever knob is easiest to turn.
 */
const HANDS: Hands[] = [
  { name: 'sharp', place: 0.03, time: 0.02 },
  { name: 'good', place: 0.05, time: 0.035 },
  { name: 'average', place: 0.08, time: 0.05 },
  { name: 'loose', place: 0.11, time: 0.07 },
  { name: 'flailing', place: 0.15, time: 0.09 },
  { name: 'lost', place: 0.2, time: 0.13 },
  { name: '· time only', place: 0.02, time: 0.13 },
  { name: '· place only', place: 0.2, time: 0.02 },
];

interface Tally {
  flightSum: number;
  flightN: number;
  pa: number;
  ab: number;
  hits: number;
  swings: number;
  misses: number;
  fouls: number;
  fair: number;
  strikeouts: number;
  walks: number;
  games: number;
}

function emptyTally(): Tally {
  return {
    flightSum: 0,
    flightN: 0,
    pa: 0,
    ab: 0,
    hits: 0,
    swings: 0,
    misses: 0,
    fouls: 0,
    fair: 0,
    strikeouts: 0,
    walks: 0,
    games: 0,
  };
}

/**
 * One pitch's worth of decision, made once and then committed to.
 *
 * A person forms a read and acts on it; they do not resample their opinion sixty
 * times a second on the way to the plate. Re-rolling the error every tick would
 * average it away and quietly report a hitter far better than the error model
 * describes.
 */
interface Read {
  estX: number;
  estY: number;
  estT: number;
  swinging: boolean;
  fired: boolean;
}

function playGame(
  setup: GameSetup,
  away: ReturnType<typeof buildLeague>[number],
  home: ReturnType<typeof buildLeague>[number],
  hands: Hands,
  rng: Rng,
  tally: Tally,
): void {
  const state = createGameState(setup, away, home);
  const inputs = emptyInputPair();
  let read: Read | null = null;
  let lastPitchKey = '';

  const maxTicks = Math.ceil((60 * 90) / TICK_DT);
  for (let t = 0; t < maxTicks && state.phase !== 'final'; t++) {
    clearEdges(inputs.p1);
    clearEdges(inputs.p2);

    const humanBatting = state.setup.awayControl === 'human1' && state.half === 'top';
    const info = state.currentPitch;

    // The human's side also has to pitch, and a side that never throws deadlocks
    // the game — the first run of this harness reported zero hits for every
    // hand, which was not a difficulty finding, it was nine innings that never
    // happened. First slot, down the middle, every time: enough to get back to
    // the top of the inning, which is the only half being measured.
    if (!humanBatting && state.phase === 'preplay') {
      inputs.p1.aimAbsolute = true;
      inputs.p1.aimX = 0;
      inputs.p1.aimY = (ZONE_BOTTOM + ZONE_TOP) / 2;
      inputs.p1.pitchSlot = 0;
    }

    if (humanBatting && state.phase === 'pitch' && info) {
      // A new pitch, so a new read. Keyed on the flight rather than a counter
      // because a foul keeps the same batter and a new pitch has to reset.
      const key = `${state.inning}:${state.half}:${state.balls}:${state.strikes}:${info.T.toFixed(4)}:${info.plateX.toFixed(4)}`;
      if (key !== lastPitchKey) {
        lastPitchKey = key;
        const estX = info.plateX + rng.normal(0, hands.place);
        const estY = info.plateY + rng.normal(0, hands.place);
        const estT = info.T + rng.normal(0, hands.time);
        // Swing at what they believe is hittable. The margin is what makes a
        // synthetic hitter take a ball rather than hack at everything, and it is
        // deliberately loose — a person chases.
        const chaseX = ZONE_HALF_WIDTH + 0.09;
        const swinging =
          Math.abs(estX) <= chaseX && estY >= ZONE_BOTTOM - 0.11 && estY <= ZONE_TOP + 0.11;
        read = { estX, estY, estT, swinging, fired: false };
        tally.flightSum += info.T;
        tally.flightN++;
      }

      if (read && read.swinging && !read.fired && state.batter.swingT < 0) {
        const profile = swingProfile(currentBatter(state), 'contact', state.difficulty, true);
        // Press so the bat arrives when they think the ball does.
        if (state.ball.t >= read.estT - profile.latency) {
          read.fired = true;
          inputs.p1.aimAbsolute = true;
          inputs.p1.aimX = read.estX;
          inputs.p1.aimY = read.estY;
          inputs.p1.swing = true;
          tally.swings++;
        }
      }
    }

    const beforeSwing = state.batter.swingResolved;
    stepGame(state, inputs);
    if (humanBatting && !beforeSwing && state.batter.swingResolved && state.lastSwing) {
      const g = state.lastSwing.grade;
      if (g === 'miss') tally.misses++;
      else if (g === 'foul' || g === 'foultip') tally.fouls++;
      else tally.fair++;
    }
  }

  // The away side is the human's. `awayHits` is the engine's own figure; the
  // rest is summed from the batting lines of that roster, because the result
  // keys them by player id with no side marker.
  const r = state.result;
  if (r) {
    tally.hits += r.awayHits;
    for (const p of away.players) {
      const b = r.batting[p.id];
      if (!b) continue;
      tally.pa += b.pa;
      tally.ab += b.ab;
      tally.strikeouts += b.so;
      tally.walks += b.bb;
    }
  }
  tally.games++;
}

function pct(n: number, d: number): string {
  return d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—';
}

function main(): void {
  const league = buildLeague();
  const away = league[0];
  const home = league[1];

  console.log(
    `\n${GAMES} games per row, ${INNINGS} innings, difficulty ${DIFFICULTY}. ` +
      `The human bats for ${away.name}.\n`,
  );
  console.log(
    'hands      place    time   |  H/game     AVG    K%     |  swings   miss    foul    fair  | flight',
  );
  console.log(
    '---------------------------+---------------------------+------------------------------+-------',
  );

  for (const hands of HANDS) {
    const tally = emptyTally();
    for (let g = 0; g < GAMES; g++) {
      const seed = 90210 + g * 7919;
      const setup: GameSetup = {
        awayTeamId: away.id,
        homeTeamId: home.id,
        stadiumId: 'meridian-park',
        innings: INNINGS,
        difficulty: DIFFICULTY,
        awayControl: 'human1',
        homeControl: 'cpu',
        night: false,
        seed,
      };
      playGame(setup, away, home, hands, new Rng(seed ^ 0x5f37), tally);
    }
    const hpg = tally.hits / Math.max(1, tally.games);
    const avg = tally.ab > 0 ? (tally.hits / tally.ab).toFixed(3).replace(/^0/, '') : '—';
    console.log(
      `${hands.name.padEnd(10)} ${hands.place.toFixed(2)}m  ${hands.time.toFixed(3)}s | ` +
        `${hpg.toFixed(1).padStart(7)}   ${avg.padStart(5)}  ${pct(tally.strikeouts, tally.pa).padStart(6)}    | ` +
        `${String(tally.swings).padStart(6)}  ${pct(tally.misses, tally.swings).padStart(6)}  ` +
        `${pct(tally.fouls, tally.swings).padStart(6)}  ${pct(tally.fair, tally.swings).padStart(6)}  | ` +
        `${(tally.flightSum / Math.max(1, tally.flightN)).toFixed(2)}s`,
    );
  }
  console.log('');
}

main();
