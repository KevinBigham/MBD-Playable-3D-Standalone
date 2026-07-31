/**
 * Ball-flight tuning table.
 *
 *   npx tsx scripts/tune-physics.ts
 *
 * Prints carry distance and hang time across the exit-velocity / launch-angle
 * grid so DRAG_K and MAGNUS_K can be adjusted against known reference points
 * rather than by feel. The expectations asserted in src/tests/physics.test.ts
 * come from this table.
 */
import { makeBall, launchFree, stepFree, horizontalDist } from '../src/sim/physics';
import { STADIUMS } from '../src/data/stadiums';
import { TICK_DT } from '../src/core/constants';

const stadium = STADIUMS[2]; // Comet Dome: neutral, no wind

function fly(exitMs: number, angleDeg: number, spin = 1.0, carry = 1.0) {
  const b = makeBall();
  const a = (angleDeg * Math.PI) / 180;
  launchFree(b, 0, 1.0, 0.6, 0, exitMs * Math.sin(a), exitMs * Math.cos(a), 'batted', spin, 0);
  let t = 0;
  let apex = 0;
  for (let i = 0; i < 20000; i++) {
    const r = stepFree(b, TICK_DT, stadium, carry);
    t += TICK_DT;
    apex = Math.max(apex, b.y);
    if (r.landed) break;
  }
  return { dist: horizontalDist(b.x, b.z), t, apex };
}

const mph = (v: number) => (v / 0.44704).toFixed(0);
const ft = (m: number) => (m * 3.28084).toFixed(0);

console.log('exit(mph)  angle  dist(m)  dist(ft)  hang(s)  apex(m)');
for (const v of [30, 35, 40, 45, 48, 50]) {
  for (const ang of [8, 15, 22, 28, 35, 45]) {
    const r = fly(v, ang);
    console.log(
      `${mph(v).padStart(6)}  ${String(ang).padStart(5)}  ${r.dist.toFixed(1).padStart(7)}  ${ft(
        r.dist,
      ).padStart(8)}  ${r.t.toFixed(2).padStart(7)}  ${r.apex.toFixed(1).padStart(7)}`,
    );
  }
}
console.log('\nCarry sensitivity at 45 m/s / 28deg:');
for (const c of [0.98, 1.0, 1.03, 1.07, 1.11]) {
  const r = fly(45, 28, 1.0, c);
  console.log(`  carry ${c.toFixed(2)} -> ${r.dist.toFixed(1)} m (${ft(r.dist)} ft)`);
}
