/**
 * Screenshot and video capture harness.
 *
 *   npm run build
 *   npx vite preview --port 4173 &
 *   npx tsx scripts/capture.ts
 *
 * Drives the real production build in a real Chromium and writes evidence to
 * docs/screenshots and docs/recordings. Every shot is taken against the running
 * game, never a mock-up.
 *
 * Navigation clicks menu rows by their visible text rather than counting key
 * presses, so a shot can never silently drift onto the wrong screen when a menu
 * gains an item — and it exercises the mouse path at the same time.
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.CAPTURE_URL ?? 'http://localhost:4173';
const SHOT_DIR = 'docs/screenshots';
const VIDEO_DIR = 'docs/recordings';
const W = 1600;
const H = 900;

mkdirSync(SHOT_DIR, { recursive: true });
mkdirSync(VIDEO_DIR, { recursive: true });

async function shot(page: Page, name: string, settleMs = 380): Promise<void> {
  if (settleMs > 0) await page.waitForTimeout(settleMs);
  await page.screenshot({ path: join(SHOT_DIR, `${name}.png`) });
  console.log(`  captured ${name}.png`);
}

/** Clicks the menu row whose label starts with `text`. */
async function choose(page: Page, text: string): Promise<void> {
  const row = page.locator('.menu-item .label', { hasText: new RegExp(`^${text}`, 'i') }).first();
  await row.waitFor({ state: 'visible', timeout: 8000 });
  await row.click();
  await page.waitForTimeout(360);
}

/** Blocks until the engine reaches one of `phases`, or the timeout expires. */
async function waitPhase(page: Page, phases: string[], maxMs = 15000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const p = await page.evaluate(
      () => (window as unknown as { moonshot: { game?: { phase: string } } }).moonshot.game?.phase,
    );
    if (p && phases.includes(p)) return;
    await page.waitForTimeout(30);
  }
}

/** Fraction of the current pitch's flight already elapsed, or 0 if none. */
async function flightProgress(page: Page): Promise<number> {
  return page.evaluate(() => {
    const g = (
      window as unknown as {
        moonshot: {
          game?: { phase: string; ball: { t: number }; currentPitch: { T: number } | null };
        };
      }
    ).moonshot.game;
    if (!g || g.phase !== 'pitch' || !g.currentPitch) return 0;
    return g.ball.t / g.currentPitch.T;
  });
}

/**
 * Captures a frame with a pitch in flight.
 *
 * A pitch lasts about 0.4 s and the game does not stop for the camera, so the
 * naive "wait for the right moment, then screenshot" races the shutter and
 * usually lands after the ball has already crossed. This fires early, then
 * checks afterwards whether the ball really was still in the air; if it was
 * not, it waits for the next pitch and tries again. Bounded, and it reports
 * when it gives up rather than quietly shipping the wrong frame.
 */
async function shotInFlight(page: Page, name: string, target = 0.68, attempts = 14): Promise<void> {
  // The first screenshot after an idle period is much slower than the rest, so
  // one is thrown away before the timing matters.
  await page.screenshot();
  for (let i = 0; i < attempts; i++) {
    const t0 = Date.now();
    while (Date.now() - t0 < 20000 && (await flightProgress(page)) < target) {
      await page.waitForTimeout(6);
    }
    await page.screenshot({ path: join(SHOT_DIR, `${name}.png`) });
    const after = await flightProgress(page);
    if (after > target && after <= 1) {
      console.log(`  captured ${name}.png (ball ${Math.round(after * 100)}% to the plate)`);
      return;
    }
    await page.waitForTimeout(120);
  }
  console.log(`  captured ${name}.png (WARNING: could not land the shutter mid-flight)`);
}

async function menu(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as { moonshot: { gotoMainMenu(): void } }).moonshot.gotoMainMenu(),
  );
  await page.waitForTimeout(500);
}

async function startGame(page: Page, setup: Record<string, unknown>): Promise<void> {
  await page.evaluate((s) => {
    (window as unknown as { moonshot: { startGame(x: unknown): void } }).moonshot.startGame(s);
  }, setup);
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  // Screenshots are taken without recording so the clip is not half an hour of
  // menu navigation; a short focused gameplay clip is recorded afterwards.
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => !!(window as unknown as { moonshot?: unknown }).moonshot,
    undefined,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1400);

  await shot(page, '01-title');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  await shot(page, '02-main-menu');

  await choose(page, 'Quick Play');
  await shot(page, '03-quick-play');
  await choose(page, 'Away club');
  await shot(page, '04-team-select');

  await menu(page);
  await choose(page, 'Season');
  await shot(page, '05-season-setup');
  await choose(page, 'Start season');
  await page.waitForTimeout(3200);
  await shot(page, '06-season-hub');
  await choose(page, 'League leaders');
  await shot(page, '07-league-leaders');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);

  await menu(page);
  await choose(page, 'Championship');
  await choose(page, 'Enter the cup');
  await page.waitForTimeout(900);
  await shot(page, '08-championship-bracket');

  await menu(page);
  await choose(page, 'Moonshot Derby');
  await shot(page, '09-derby-setup');

  await menu(page);
  await choose(page, 'Practice');
  await shot(page, '10-practice-setup');

  await menu(page);
  await choose(page, 'Player Creator');
  await choose(page, 'Create a new player');
  await shot(page, '11-player-creator');

  await menu(page);
  await choose(page, 'Clubs & Rosters');
  await page.locator('.team-card').nth(3).click();
  await page.waitForTimeout(600);
  await shot(page, '12-roster');

  await menu(page);
  await choose(page, 'Controls');
  await shot(page, '13-controls');

  await menu(page);
  await choose(page, 'Settings');
  await shot(page, '14-settings');

  // --- gameplay ------------------------------------------------------------
  await menu(page);
  await startGame(page, {
    awayTeamId: 'coralkey',
    homeTeamId: 'ironport',
    stadiumId: 'anchor-yard',
    innings: 3,
    difficulty: 'pro',
    awayControl: 'cpu',
    homeControl: 'human1',
    night: false,
    seed: 31337,
  });
  // Held until the pitcher is set, so the shot shows the aim bracket and the
  // preview arc for every pitch in the repertoire rather than an empty zone.
  await waitPhase(page, ['preplay']);
  await page.waitForTimeout(700);
  await shot(page, '15-at-bat-pitching');

  await startGame(page, {
    awayTeamId: 'rustforge',
    homeTeamId: 'bayoucity',
    stadiumId: 'bayou-bowl',
    innings: 3,
    difficulty: 'pro',
    awayControl: 'human1',
    homeControl: 'cpu',
    night: true,
    seed: 4242,
  });
  await page.waitForTimeout(4600);
  await shot(page, '16-at-bat-night');

  // A pitch on its way to the plate: the flight path, the crossing marker and
  // the tracker dots from earlier in the at-bat all on screen together.
  await shotInFlight(page, '21-plate-view-pitch');

  // The manager's card, open. The capture holds the modifier and verifies the
  // card is actually on screen before shooting, so this can never quietly ship
  // a picture of an empty corner.
  await startGame(page, {
    awayTeamId: 'coralkey',
    homeTeamId: 'ironport',
    stadiumId: 'anchor-yard',
    innings: 3,
    difficulty: 'pro',
    awayControl: 'cpu',
    homeControl: 'human1',
    night: false,
    seed: 31337,
  });
  await waitPhase(page, ['preplay']);
  // The half-inning banner runs for about two seconds and would otherwise sit
  // across the middle of the shot.
  await page.waitForTimeout(2800);
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyJ'); // infield in
  await page.waitForTimeout(900);
  const cardOpen = await page.evaluate(() => {
    const el = document.querySelector('.hud-defense');
    return !!el && el.classList.contains('on') && el.textContent!.includes('INFIELD IN');
  });
  if (!cardOpen) console.log('  (warning: defensive card was not on screen for 22-defensive-card)');
  await shot(page, '22-defensive-card', 0);
  await page.keyboard.up('Shift');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(550);
  await shot(page, '17-pause');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);

  await startGame(page, {
    awayTeamId: 'prairierock',
    homeTeamId: 'redwoodgrove',
    stadiumId: 'grove-park',
    innings: 3,
    difficulty: 'allstar',
    awayControl: 'cpu',
    homeControl: 'cpu',
    night: false,
    seed: 5137,
  });
  // A ball actually in the air and out into the outfield, so the shot shows the
  // chase camera and the fielders converging rather than whatever happened to
  // be on screen when a timeout expired.
  let airborne = false;
  for (let i = 0; i < 2200; i++) {
    await page.waitForTimeout(35);
    airborne = await page.evaluate(() => {
      const s = (
        window as unknown as {
          moonshot: {
            game: { phase: string; ball: { mode: string; x: number; y: number; z: number } };
          };
        }
      ).moonshot.game;
      const d = Math.hypot(s.ball.x, s.ball.z);
      return s.phase === 'inplay' && s.ball.mode === 'batted' && s.ball.y > 6 && d > 28;
    });
    if (airborne) break;
  }
  if (!airborne) console.log('  (warning: never caught a fly ball for 18-ball-in-play)');
  await shot(page, '18-ball-in-play', 0);

  // Home runs are ~2 per nine innings, so a three-inning game can easily finish
  // without one. Keep restarting hitter-friendly matchups until a ball actually
  // leaves the yard, rather than shipping whatever was on screen when a timer
  // ran out and calling the file 19-home-run.
  let sawHomeRun = false;
  const hrSeeds = [5137, 424242, 90210, 31415, 271828, 8675309];
  for (const seed of hrSeeds) {
    if (sawHomeRun) break;
    await startGame(page, {
      awayTeamId: 'prairierock',
      homeTeamId: 'redwoodgrove',
      stadiumId: 'the-foundry',
      innings: 3,
      difficulty: 'allstar',
      awayControl: 'cpu',
      homeControl: 'cpu',
      night: false,
      seed,
    });
    for (let i = 0; i < 600; i++) {
      await page.waitForTimeout(80);
      sawHomeRun = await page.evaluate(
        () =>
          (window as unknown as { moonshot: { game?: { play?: { homeRunCelebration?: boolean } } } })
            .moonshot.game?.play?.homeRunCelebration ?? false,
      );
      if (sawHomeRun) break;
    }
  }
  if (!sawHomeRun) console.log('  (warning: no home run was hit for 19-home-run)');
  await shot(page, '19-home-run', 0);

  for (let i = 0; i < 2600; i++) {
    await page.waitForTimeout(140);
    const done = await page.evaluate(() => {
      const app = (window as unknown as { moonshot: { mode: string } }).moonshot;
      return app.mode === 'menu' && !!document.querySelector('.result-hero');
    });
    if (done) break;
  }
  await shot(page, '20-postgame');

  await context.close();

  // --- the phone build -----------------------------------------------------
  // A real handset context: coarse pointer, touch events, handset viewport. The
  // shot is verified to contain a labelled pad before it is written, so this
  // can never quietly ship a picture of the desktop layout at a small size.
  const phoneCtx = await browser.newContext({
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const phone = await phoneCtx.newPage();
  phone.on('console', (m) => {
    if (m.type() === 'error') errors.push('[phone] ' + m.text());
  });
  phone.on('pageerror', (e) => errors.push('[phone] ' + String(e)));
  await phone.goto(BASE, { waitUntil: 'networkidle' });
  await phone.waitForFunction(
    () => !!(window as unknown as { moonshot?: unknown }).moonshot,
    undefined,
    { timeout: 30000 },
  );
  await phone.waitForTimeout(1200);
  // The pad turns itself on for a coarse pointer; a tap on the field settles
  // any doubt and is also the gesture that unlocks audio on a real device.
  await phone.touchscreen.tap(422, 195);
  await phone.waitForTimeout(400);
  await startGame(phone, {
    awayTeamId: 'coralkey',
    homeTeamId: 'ironport',
    stadiumId: 'anchor-yard',
    innings: 3,
    difficulty: 'pro',
    awayControl: 'human1',
    homeControl: 'cpu',
    night: false,
    seed: 8802,
  });
  await waitPhase(phone, ['preplay']);
  await phone.waitForTimeout(2800);
  const padOk = await phone.evaluate(() => {
    const t = document.getElementById('touch');
    const labels = [...document.querySelectorAll('#touch .t-btn b')].map((b) => b.textContent);
    return {
      on: !!t && t.classList.contains('on') && t.classList.contains('playing'),
      labels,
    };
  });
  if (!padOk.on || !padOk.labels.includes('SWING')) {
    console.log(`  (warning: touch pad not ready for 23-phone-at-bat: ${JSON.stringify(padOk)})`);
  }
  await phone.screenshot({ path: join(SHOT_DIR, '23-phone-at-bat.png') });
  await phoneCtx.close();

  // --- the same game on a phone that will not rotate -----------------------
  // A portrait handset, rotation locked, taking the game up on its offer to
  // turn itself instead. Verified to actually be rotated and to be rendering a
  // landscape canvas before the shot is written.
  const lockedCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const locked = await lockedCtx.newPage();
  locked.on('console', (m) => {
    if (m.type() === 'error') errors.push('[portrait] ' + m.text());
  });
  locked.on('pageerror', (e) => errors.push('[portrait] ' + String(e)));
  await locked.goto(BASE, { waitUntil: 'networkidle' });
  await locked.waitForFunction(
    () => !!(window as unknown as { moonshot?: unknown }).moonshot,
    undefined,
    { timeout: 30000 },
  );
  await locked.waitForTimeout(1200);
  await locked.touchscreen.tap(195, 420);
  await locked.waitForTimeout(400);
  await startGame(locked, {
    awayTeamId: 'coralkey',
    homeTeamId: 'ironport',
    stadiumId: 'anchor-yard',
    innings: 3,
    difficulty: 'pro',
    awayControl: 'human1',
    homeControl: 'cpu',
    night: false,
    seed: 8802,
  });
  await waitPhase(locked, ['preplay']);
  // Press the card's own button rather than calling the method: the point of
  // the shot is that the offer works, not that the method exists.
  await locked.waitForTimeout(600);
  const turned = await locked.evaluate(() => {
    const btn = document.querySelector('.rot-rotate') as HTMLButtonElement | null;
    btn?.click();
    return !!btn;
  });
  await locked.waitForTimeout(2400);
  const rotOk = await locked.evaluate(() => {
    const gl = document.getElementById('gl') as HTMLCanvasElement;
    return {
      rotated: document.documentElement.classList.contains('rotated'),
      canvas: [gl.width, gl.height] as [number, number],
      pad: document.getElementById('touch')?.className ?? '',
    };
  });
  if (!turned || !rotOk.rotated || rotOk.canvas[0] <= rotOk.canvas[1]) {
    console.log(`  (warning: rotation not applied for 24-phone-rotation-locked: ${JSON.stringify(rotOk)})`);
  }
  await locked.screenshot({ path: join(SHOT_DIR, '24-phone-rotation-locked.png') });
  await lockedCtx.close();

  console.log(`\nconsole errors during screenshot pass: ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log('  ' + e);

  // --- gameplay recording --------------------------------------------------
  // Recorded smaller and shorter than the screenshots: this is evidence of the
  // game moving, not a trailer, and it lives in the repository.
  const vidCtx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } },
  });
  const vp = await vidCtx.newPage();
  const vidErrors: string[] = [];
  vp.on('console', (m) => {
    if (m.type() === 'error') vidErrors.push(m.text());
  });
  vp.on('pageerror', (e) => vidErrors.push(String(e)));

  await vp.goto(BASE, { waitUntil: 'networkidle' });
  await vp.waitForFunction(
    () => !!(window as unknown as { moonshot?: unknown }).moonshot,
    undefined,
    { timeout: 30000 },
  );
  await vp.waitForTimeout(900);
  await startGame(vp, {
    awayTeamId: 'rustforge',
    homeTeamId: 'bayoucity',
    stadiumId: 'bayou-bowl',
    innings: 3,
    difficulty: 'allstar',
    awayControl: 'cpu',
    homeControl: 'cpu',
    night: false,
    seed: 5137,
  });
  await vp.waitForTimeout(50_000);
  console.log(`console errors during recording: ${vidErrors.length}`);
  errors.push(...vidErrors);
  await vidCtx.close();
  await browser.close();

  const target = join(VIDEO_DIR, 'gameplay.webm');
  const vids = readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.webm') && f !== 'gameplay.webm');
  if (vids.length) {
    if (existsSync(target)) rmSync(target);
    renameSync(join(VIDEO_DIR, vids[0]), target);
    for (const v of vids.slice(1)) rmSync(join(VIDEO_DIR, v));
    console.log('recording written to docs/recordings/gameplay.webm');
  }

  process.exit(errors.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
