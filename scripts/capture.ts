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

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(380);
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
  await page.waitForTimeout(4400);
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
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(350);
    const inPlay = await page.evaluate(() => {
      const s = (
        window as unknown as {
          moonshot: { game: { phase: string; ball: { mode: string; y: number } } };
        }
      ).moonshot.game;
      return s.phase === 'inplay' && s.ball.mode === 'batted' && s.ball.y > 5;
    });
    if (inPlay) break;
  }
  await shot(page, '18-ball-in-play');

  for (let i = 0; i < 400; i++) {
    await page.waitForTimeout(200);
    const hr = await page.evaluate(
      () =>
        (window as unknown as { moonshot: { game?: { play?: { homeRunCelebration?: boolean } } } })
          .moonshot.game?.play?.homeRunCelebration ?? false,
    );
    if (hr) break;
  }
  await shot(page, '19-home-run');

  for (let i = 0; i < 2600; i++) {
    await page.waitForTimeout(140);
    const done = await page.evaluate(() => {
      const app = (window as unknown as { moonshot: { mode: string } }).moonshot;
      return app.mode === 'menu' && !!document.querySelector('.result-hero');
    });
    if (done) break;
  }
  await shot(page, '20-postgame');

  console.log(`\nconsole errors during screenshot pass: ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log('  ' + e);
  await context.close();

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
