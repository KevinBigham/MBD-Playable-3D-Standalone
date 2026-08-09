/** Replay-only free-camera mode, lazy-load, BVH, presets, and cleanup receipt. */
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = process.env.CAMERA_URL ?? 'http://127.0.0.1:4173';

async function main(): Promise<void> {
  await mkdir('reports/replay', { recursive: true });
  await mkdir('docs/screenshots', { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!(window as any).mbd);
  await page.evaluate(() => (window as any).mbd.startGame({
    awayTeamId: 'prairierock', homeTeamId: 'bayoucity', stadiumId: 'anchor-yard', innings: 3,
    difficulty: 'pro', awayControl: 'cpu', homeControl: 'cpu', night: false, seed: 42,
  }));
  await page.waitForTimeout(4500);
  const preview = await page.evaluate(() => (window as any).mbd.previewReplay('home-run'));
  if (!preview) throw new Error('replay preview did not start');
  await page.locator('.replay-overlay:not(.hidden)').waitFor();
  await page.locator('.replay-free').click();
  await page.locator('.replay-overlay.free-camera').waitFor({ timeout: 15000 });
  await page.locator('[data-action="overhead"]').click();
  await page.waitForTimeout(1000);
  const active = await page.evaluate(() => (window as any).mbd.replayFreeCameraDiagnostics());
  await page.screenshot({ path: 'docs/screenshots/replay-free-camera-overhead.png' });
  await page.locator('[data-action="focus-ball"]').click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'docs/screenshots/replay-free-camera-ball.png' });
  const loadedResources = await page.evaluate(() => performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((name) => name.includes('free-camera') || name.includes('replay-camera') || name.includes('three-mesh-bvh')));
  await page.locator('[data-action="exit"]').click();
  await page.waitForTimeout(300);
  const afterExit = await page.evaluate(() => (window as any).mbd.replayFreeCameraDiagnostics());
  const receipt = { preview, active, afterExit, loadedResources, errors };
  await writeFile('reports/replay/free-camera-check.json', `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
  await browser.close();
  if (active.colliders !== 5 || active.bvhTrees !== 5 || afterExit.active || afterExit.colliders !== 0 || errors.length) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(1); });
