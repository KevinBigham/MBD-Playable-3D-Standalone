/** Production-build replay smoke test and visual-regression capture.
 *
 * Start `vite preview --host 127.0.0.1 --port 4173 --strictPort`, then run
 * `npm run replay:shots`. It verifies simulation freeze/skip and writes desktop
 * plus phone-width images from the real native replay player. */
import { chromium, type Page } from 'playwright';

const BASE = process.env.REPLAY_URL ?? 'http://127.0.0.1:4173';
const OUT = process.env.SHOT_DIR ?? 'docs/screenshots';

type Kind = 'home-run' | 'great-catch' | 'final-out';

async function startGame(page: Page, night: boolean): Promise<void> {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean((window as unknown as { mbd?: unknown }).mbd));
  await page.evaluate((isNight) => {
    const app = (window as unknown as { mbd: { startGame: (setup: unknown) => void } }).mbd;
    app.startGame({
      awayTeamId: 'coralkey',
      homeTeamId: 'ironport',
      stadiumId: 'anchor-yard',
      innings: 3,
      difficulty: 'pro',
      awayControl: 'cpu',
      homeControl: 'cpu',
      night: isNight,
      seed: 872341,
    });
  }, night);
  await page.waitForFunction(() => {
    const app = (window as unknown as { mbd: { replayDiagnostics: () => { frames: number } } }).mbd;
    return app.replayDiagnostics().frames >= 55;
  });
}

async function capture(page: Page, kind: Kind, file: string): Promise<void> {
  const before = await page.evaluate((replayKind) => {
    const app = (window as unknown as { mbd: { previewReplay: (kind: Kind) => boolean }; }).mbd;
    const internal = app as unknown as { game: { clock: number } };
    const clock = internal.game.clock;
    if (!app.previewReplay(replayKind)) throw new Error(`could not start ${replayKind} replay`);
    return clock;
  }, kind);
  await page.waitForFunction(() => {
    const app = (window as unknown as { mbd: { replayDiagnostics: () => { active: boolean } } }).mbd;
    return app.replayDiagnostics().active;
  });
  await page.waitForTimeout(700);
  const during = await page.evaluate(() => {
    const app = (window as unknown as { mbd: { replayDiagnostics: () => { active: boolean } } }).mbd;
    const internal = app as unknown as { game: { clock: number } };
    return { active: app.replayDiagnostics().active, clock: internal.game.clock };
  });
  if (!during.active) throw new Error(`${kind} replay ended before the visual gate`);
  if (Math.abs(during.clock - before) > 1e-8) throw new Error(`${kind} replay advanced simulation ${before} -> ${during.clock}`);
  await page.screenshot({ path: `${OUT}/${file}` });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => {
    const app = (window as unknown as { mbd: { replayDiagnostics: () => { active: boolean } } }).mbd;
    return !app.replayDiagnostics().active;
  });
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const errors: string[] = [];

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  desktop.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await startGame(desktop, false);
  await capture(desktop, 'home-run', 'replay-home-run-desktop.png');
  await capture(desktop, 'great-catch', 'replay-great-catch-desktop.png');
  await capture(desktop, 'final-out', 'replay-final-out-desktop.png');
  const diagnostics = await desktop.evaluate(() => {
    const app = (window as unknown as { mbd: { replayDiagnostics: () => unknown } }).mbd;
    return app.replayDiagnostics();
  });
  console.log('desktop replay buffer', diagnostics);

  const phone = await browser.newPage({ viewport: { width: 734, height: 320 }, isMobile: true, hasTouch: true });
  phone.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await startGame(phone, true);
  await capture(phone, 'home-run', 'replay-home-run-phone.png');

  await browser.close();
  if (errors.length) throw new Error(`browser console errors:\n${errors.join('\n')}`);
  console.log('replay screenshots and freeze/skip checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
