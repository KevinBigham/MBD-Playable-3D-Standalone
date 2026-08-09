/**
 * Close-up model harness.
 *
 *   npm run build && npx vite preview --port 4178 &
 *   npx tsx scripts/model-shot.ts
 *
 * Parks the game camera a couple of metres from a player, renders one frame and
 * writes a PNG. Nothing else here changes the game — it borrows the real scene,
 * the real lights and the real actors, so what lands in the file is what the
 * renderer actually produces rather than a preview built out of look-alikes.
 *
 * This exists because model work was being checked on a 1600x900 wide shot where
 * a head is nine pixels tall. A cap whose crown sat below the top of the skull —
 * a bare scalp poking out of every hat on the field — survived a whole pass that
 * way, and it is obvious in the first frame this script writes.
 *
 * The canvas is grabbed inside the same evaluate() that renders it. WebGL clears
 * its drawing buffer on the next composite unless `preserveDrawingBuffer` is on,
 * and it is deliberately off for performance; doing both in one synchronous
 * block is what makes the read legal. It also means the app's own animation
 * frame cannot restore the camera in between.
 */
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.SHOT_URL ?? 'http://localhost:4178';
const OUT = process.env.SHOT_DIR ?? 'docs/screenshots';
const W = 1000;
const H = 1000;

type Vec = [number, number, number];
type Shot = { name: string; eye: Vec; look: Vec; fov: number; forceEquipment?: string };
type Spot = { slot: number; x: number; z: number };

/**
 * Every framing is computed from where the players actually are, never written
 * down. The first version of this script had the mound coordinates typed in from
 * a constant and produced two immaculate photographs of an empty outfield, which
 * is a harness that reports on nothing while looking like it works.
 *
 * `head` is the framing that matters. A cap is roughly 30 cm of a two-metre
 * figure, so any shot wide enough to hold a whole player is too wide to judge
 * one — that is precisely how a cap with a bare scalp coming out the top of it
 * passed a review.
 */
function shotsFor(spots: Spot[], hand: number): Shot[] {
  const at = (slot: number): Spot => spots.find((s) => s.slot === slot) ?? { slot, x: 0, z: 18 };
  const p = at(0);
  const catcher = at(1);
  const firstBase = at(2);
  const ss = at(5);
  const out: Shot[] = [];

  // Toward home plate, which is the origin: the direction a fielder faces, and
  // so the direction a camera has to come from to see a face rather than a back.
  const toward = (s: Spot, d: number, side = 0): Vec => {
    const len = Math.max(0.001, Math.hypot(s.x, s.z));
    const ux = s.x / len;
    const uz = s.z / len;
    return [s.x - ux * d + -uz * side, 0, s.z - uz * d + ux * side];
  };

  const front = toward(p, 3.2, 0.6);
  out.push({ name: 'pitcher-front', eye: [front[0], 2.05, front[2]], look: [p.x, 1.72, p.z], fov: 26 });

  const head = toward(p, 1.5, 0.35);
  out.push({ name: 'pitcher-head', eye: [head[0], 1.98, head[2]], look: [p.x, 1.86, p.z], fov: 24 });

  const catcherFront = toward(catcher, 1.75, 0.28);
  out.push({
    name: 'catcher-equipment',
    eye: [catcherFront[0], 1.45, catcherFront[2]],
    look: [catcher.x, 1.05, catcher.z],
    fov: 27,
    forceEquipment: 'catcher',
  });
  const catcherFull = toward(catcher, 3.15, 0.45);
  out.push({
    name: 'catcher-full-kit',
    eye: [catcherFull[0], 1.72, catcherFull[2]],
    look: [catcher.x, .78, catcher.z],
    fov: 31,
    forceEquipment: 'catcher',
  });

  const firstBaseFront = toward(firstBase, 2.25, 0.45);
  out.push({
    name: 'first-base-mitt',
    eye: [firstBaseFront[0], 1.82, firstBaseFront[2]],
    look: [firstBase.x, 1.28, firstBase.z],
    fov: 27,
    forceEquipment: 'firstBase',
  });

  // High and behind, the angle the fielding camera actually uses: the top of a
  // cap is the part of a fielder a player looks at for most of a game.
  const above = toward(ss, 2.6, 0.8);
  out.push({ name: 'fielder-above', eye: [above[0], 3.5, above[2]], look: [ss.x, 1.5, ss.z], fov: 30 });

  // From further out than the fielder, looking back in. A fielder always faces
  // the plate, so this is the only reliable look at the back of a uniform —
  // where the number belongs and, for one release, was not.
  const behind = toward(ss, -2.8, 0.5);
  out.push({ name: 'fielder-behind', eye: [behind[0], 2.3, behind[2]], look: [ss.x, 1.5, ss.z], fov: 30 });

  // Behind the hitter, which is where the plate camera lives and therefore the
  // only shot that can tell you whether the number on the back of a jersey is
  // on the back of the jersey. It also doubles as the control: the batting
  // helmet already reads, so a cap change that quietly damages it shows up here
  // rather than in a game three days later. `hand` is -1 for a left-handed
  // hitter, so the camera swaps boxes with him.
  out.push({
    name: 'batter-back',
    eye: [0.62 * hand, 1.92, -2.5],
    look: [0.62 * hand, 1.42, 0.35],
    fov: 30,
  });
  return out;
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!(window as unknown as { mbd?: unknown }).mbd, undefined, {
    timeout: 30000,
  });

  await page.evaluate(() => {
    (window as unknown as { mbd: { startGame: (x: unknown) => void } }).mbd.startGame({
      awayTeamId: 'bos',
      homeTeamId: 'nym',
      innings: 9,
      difficulty: 'pro',
      awayControl: 'cpu',
      homeControl: 'cpu',
      night: false,
      seed: 20260802,
    });
  });
  // Wait for the defence to actually take the field. The state carries an empty
  // `fielders` array through the opening banner, and a framing computed from an
  // empty array is a framing computed from a default.
  await page.waitForFunction(
    () => {
      const g = (window as unknown as { mbd: { game?: { fielders: unknown[] } } }).mbd.game;
      return (g?.fielders.length ?? 0) === 9;
    },
    undefined,
    { timeout: 30000 },
  );
  // And then long enough for the camera ease and the shadow pass to settle.
  await page.waitForTimeout(2600);

  const live = await page.evaluate(() => {
    const m = (
      window as unknown as {
        mbd: {
          game?: { fielders: { slot: number; x: number; z: number }[] };
          world: { scene: { children: { position: { x: number; z: number } }[] } };
        };
      }
    ).mbd;
    // Which batter's box is occupied, found by looking. Handedness depends on
    // the hitter and on the pitcher he is facing, and neither is on the public
    // surface; a guess puts the camera in the empty box half the time, which is
    // how this shot came back as a photograph of an unoccupied batting circle.
    let hand = 1;
    for (const c of m.world.scene.children) {
      const p = c.position;
      if (p && Math.abs(Math.abs(p.x) - 0.78) < 0.2 && Math.abs(p.z - 0.35) < 0.3) {
        hand = p.x < 0 ? -1 : 1;
      }
    }
    return {
      spots: (m.game?.fielders ?? []).map((f) => ({ slot: f.slot, x: f.x, z: f.z })),
      hand,
    };
  });
  console.log(
    `fielders: ${live.spots.map((s) => `${s.slot}@${s.x.toFixed(1)},${s.z.toFixed(1)}`).join('  ')}`,
  );
  console.log(`batter box: ${live.hand < 0 ? 'third-base side' : 'first-base side'}`);

  for (const shot of shotsFor(live.spots, live.hand)) {
    const dataUrl = await page.evaluate((s) => {
      const w = (
        window as unknown as {
          mbd: {
            world: {
              renderer: {
                domElement: HTMLCanvasElement;
                render: (scene: unknown, cam: unknown) => void;
              };
              scene: unknown;
              director: {
                camera: {
                  position: { set: (x: number, y: number, z: number) => void };
                  fov: number;
                  lookAt: (x: number, y: number, z: number) => void;
                  updateProjectionMatrix: () => void;
                  updateMatrixWorld: (f?: boolean) => void;
                };
              };
            };
          };
        }
      ).mbd.world;
      const cam = w.director.camera;
      if (s.forceEquipment) {
        (w.scene as { traverse: (visit: (object: { visible: boolean; userData?: Record<string, unknown> }) => void) => void })
          .traverse((object) => {
            if (object.userData?.equipment === s.forceEquipment) object.visible = true;
          });
      }
      cam.fov = s.fov;
      cam.updateProjectionMatrix();
      cam.position.set(s.eye[0], s.eye[1], s.eye[2]);
      cam.lookAt(s.look[0], s.look[1], s.look[2]);
      cam.updateMatrixWorld(true);
      w.renderer.render(w.scene, cam);
      return w.renderer.domElement.toDataURL('image/png');
    }, shot);
    const file = `${OUT}/model-${shot.name}.png`;
    writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`wrote ${file}`);
  }

  if (errors.length) {
    console.error(`\n${errors.length} console error(s):`);
    for (const e of errors.slice(0, 5)) console.error(`  ${e}`);
  }
  await browser.close();
  process.exit(errors.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
