/**
 * Does the bat actually meet the ball?
 *
 *   npm run build && npx vite preview --port 4178 &
 *   npm run swing
 *
 * Drives real human swings and writes a strip of frames from the real plate
 * camera, centred on the instant of contact. The instant is read from the
 * simulation — the swing clock and `play.clock` both live in state — so the
 * frames are labelled with the truth rather than with a guess about when the
 * interesting part was.
 *
 * This exists because three separate things were hiding contact, and none of
 * them was visible in a still frame:
 *
 *   1. the swing animation ran on a fixed 0.42 s clock while the engine struck
 *      the ball at the swing's latency, 0.125 s — so at the moment the ball
 *      left, the bat was 6% of the way through its arc;
 *   2. the batter was replaced by a runner on the same tick, deleting the
 *      follow-through;
 *   3. the camera hard-cut to the field on that tick too.
 *
 * Any one of them alone would have been enough to make a player report never
 * seeing the bat hit anything. A strip across the contact frame is the only way
 * to see whether all three are fixed.
 */
import { readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';

const BASE = process.env.SHOT_URL ?? 'http://localhost:4178';
const OUT = process.env.SHOT_DIR ?? 'docs/screenshots';
const W = 900;
const H = 700;

/** Where in the swing the engine strikes the ball, seconds after the press. */
const CONTACT_AT = 0.125;

interface Frame {
  swingT: number;
  clock: number;
  phase: string;
  grade: string;
  png: string;
}

/**
 * Waits until a pitch is in the air with the human hitting.
 *
 * The harness runs the **batting drill** rather than a game, which is what makes
 * this a one-liner. A human-controlled side in a real game has to pitch as well
 * as hit, and a side that never throws deadlocks the game — so the first version
 * of this script waited forever for a top half that was never coming, once the
 * hitter's half-inning ended. The drill is endless pitches to a hitter and has
 * no other half.
 */
async function toLiveStrike(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const g = (window as unknown as { mbd: { game?: { phase: string } } }).mbd.game;
      return g?.phase === 'pitch';
    },
    undefined,
    { timeout: 60000 },
  );
}

/**
 * Swings at the pitch currently in the air and captures every frame from the
 * press through the follow-through.
 *
 * The frames are collected *inside the page*, one per animation frame, and
 * shipped out in one transfer. Two reasons: reading `toDataURL` from Playwright
 * between frames returns a blank canvas, because WebGL clears its drawing buffer
 * on composite unless `preserveDrawingBuffer` is on and it is deliberately off;
 * and a round trip per frame samples at about 10 Hz, which is three frames
 * across a swing that lasts a third of a second.
 */
async function swingOnce(page: Page): Promise<Frame[]> {
  const target = await page.evaluate(() => {
    const m = window as unknown as {
      mbd: {
        game: { currentPitch: { plateX: number; plateY: number; T: number }; ball: { t: number } };
        world: { project: (x: number, y: number, z: number) => { x: number; y: number } };
      };
    };
    const info = m.mbd.game.currentPitch;
    const p = m.mbd.world.project(info.plateX, info.plateY, 0.62);
    return { x: p.x, y: p.y };
  });
  // Wait on the *simulation's* clock, not on wall time. `waitForTimeout` assumes
  // the two run together, and under a software renderer they do not — a slow
  // frame is clamped by MAX_FRAME_DT, so game time falls behind and every tap
  // lands early. Polling the ball's own flight time removes the assumption.
  await page.waitForFunction(
    () => {
      const g = (
        window as unknown as { mbd: { game?: { currentPitch: { T: number } | null; ball: { t: number } } } }
      ).mbd.game;
      const info = g?.currentPitch;
      return !!info && g.ball.t >= info.T - 0.125;
    },
    undefined,
    { timeout: 30000, polling: 'raf' },
  );
  await page.touchscreen.tap(target.x, target.y);

  return page.evaluate(async () => {
    const m = window as unknown as {
      mbd: {
        game?: {
          phase: string;
          play: { clock: number; live: boolean };
          batter: { swingT: number };
          lastSwing: { grade: string } | null;
        };
        world: {
          renderer: { domElement: HTMLCanvasElement; render: (s: unknown, c: unknown) => void };
          scene: unknown;
          director: { camera: unknown };
        };
      };
    };
    const out: { swingT: number; clock: number; phase: string; grade: string; png: string }[] = [];
    // A plain loop awaiting one animation frame at a time, deliberately: a named
    // recursive callback inside evaluate() picks up esbuild's keepNames shim and
    // dies in the page with "__name is not defined".
    for (let n = 0; n < 45; n++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const g = m.mbd.game;
      const w = m.mbd.world;
      // Re-render on top of whatever the app just drew, with the app's own
      // camera, so the buffer is valid when it is read one line later.
      w.renderer.render(w.scene, w.director.camera);
      out.push({
        // Keyed on the swing rather than on the play, because a swing that
        // misses never makes the play live — and a miss is still a swing whose
        // animation has to be right.
        swingT: g?.batter.swingT ?? -1,
        clock: g?.play.live ? g.play.clock : -1,
        phase: g?.phase ?? '',
        grade: g?.lastSwing?.grade ?? '',
        png: w.renderer.domElement.toDataURL('image/png'),
      });
      if (g?.play.live && g.play.clock > 0.45) break;
    }
    return out;
  });
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  // A touch-capable context, because the swing being checked is the one a player
  // actually makes: a tap that carries the place and the instant together.
  // Synthesised MouseEvents do not reach that path — the first version of this
  // script dispatched them and captured six identical frames of a pitch nobody
  // swung at.
  const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true });
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
      awayControl: 'human1',
      homeControl: 'cpu',
      night: false,
      seed: 31337,
      practice: 'batting',
    });
  });

  // One touch first, to put the game into touch mode.
  await toLiveStrike(page);
  await page.touchscreen.tap(W / 2, H / 2);

  // Several attempts, because the strip is only worth having for a swing that
  // *connects*, and a tap timed from outside the page carries tens of
  // milliseconds of slop. Stops at the first one that put a ball in play.
  let frames: Frame[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    await toLiveStrike(page);
    const shot = await swingOnce(page);
    if (!frames.length) frames = shot;
    if (shot.some((f) => f.clock >= 0)) {
      frames = shot;
      break;
    }
  }

  const swung = frames.filter((f) => f.swingT >= 0);
  const connected = frames.some((f) => f.clock >= 0);
  console.log(
    `${frames.length} frames, ${swung.length} during the swing, ` +
      `${connected ? 'ball in play' : 'no contact'}`,
  );
  if (!swung.length) {
    console.error('no swing was ever made — the tap did not reach the engine');
    await browser.close();
    process.exit(1);
  }

  // Centre the strip on the contact instant. The bat is due at the plate
  // CONTACT_AT after the press, which is the whole thing being checked, so the
  // frames worth keeping are the ones either side of it.
  const dist = (f: Frame): number => (f.swingT < 0 ? Infinity : Math.abs(f.swingT - CONTACT_AT));
  let best = 0;
  for (let i = 1; i < frames.length; i++) if (dist(frames[i]) < dist(frames[best])) best = i;

  // Clear the previous strip first. The filenames carry the millisecond each
  // frame was taken at, which is the useful part of them and also means a second
  // run leaves its predecessor's frames lying beside its own — a set of stills
  // from two different swings, presented as one.
  for (const f of readdirSync(OUT)) {
    if (f.startsWith('swing-') && f.endsWith('.png')) unlinkSync(`${OUT}/${f}`);
  }

  const picked = frames.slice(Math.max(0, best - 2), best + 5);
  picked.forEach((f, i) => {
    const label =
      f.clock >= 0 ? `after${Math.round(f.clock * 1000)}` : `swing${Math.round(f.swingT * 1000)}`;
    const file = `${OUT}/swing-${i}-${label}.png`;
    writeFileSync(file, Buffer.from(f.png.split(',')[1], 'base64'));
    console.log(`wrote ${file}  (${f.phase}${f.grade ? `, ${f.grade}` : ''})`);
  });

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
