/** Cold-install proof: install the PWA online, never open Free Cam online,
 * switch the same fresh context offline, then enter it for the first time. */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = process.env.OFFLINE_URL ?? 'http://127.0.0.1:4173';
const SW_URL = new URL('sw.js', BASE).href;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 734, height: 320 }, hasTouch: true, isMobile: true });
const page = await context.newPage();
const failed: string[] = [];
const errors: string[] = [];
page.on('requestfailed', (request) => failed.push(`${request.url()} — ${request.failure()?.errorText ?? 'failed'}`));
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text()); });
await page.goto(BASE, { waitUntil: 'networkidle' });
console.log('online shell loaded');
await page.waitForFunction(() => !!(window as any).mbd);
await page.evaluate(async (swUrl) => { await navigator.serviceWorker.register(swUrl); }, SW_URL);
await page.evaluate(async () => await navigator.serviceWorker.ready);
console.log('service worker ready');
// A fresh online reload is the install boundary: it gives the newly activated
// worker control of the page before the offline portion begins.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => !!navigator.serviceWorker.controller && !!(window as any).mbd);
const cacheReceipt = await page.evaluate(async () => {
  const keys = await caches.keys();
  const urls = (await Promise.all(keys.map(async (key) => (await caches.open(key)).keys()))).flat().map((request) => request.url);
  const probes = await Promise.all(urls.filter((url) => /free-camera|replay-camera-vendor|three-mesh-bvh/.test(url)).map(async (url) => {
    const response = await caches.match(url);
    return { url, status: response?.status ?? 0, type: response?.type ?? 'missing' };
  }));
  return { keys, urls, probes, controller: !!navigator.serviceWorker.controller };
});
if (!cacheReceipt.urls.some((url) => url.includes('three-mesh-bvh-adapter')) || !cacheReceipt.urls.some((url) => url.includes('free-camera'))) {
  throw new Error(`service worker did not precache Free Camera assets: ${JSON.stringify(cacheReceipt)}`);
}
console.log(`precache verified (${cacheReceipt.urls.length} assets)`);
await context.setOffline(true);
console.log('browser offline');
await page.evaluate(() => (window as any).mbd.startGame({
  awayTeamId: 'prairierock', homeTeamId: 'bayoucity', stadiumId: 'anchor-yard', innings: 3,
  difficulty: 'pro', awayControl: 'cpu', homeControl: 'cpu', night: false, seed: 42,
}));
await page.waitForTimeout(4500);
if (!await page.evaluate(() => (window as any).mbd.replayFixtureEvent('homerun'))) throw new Error('normal event path did not start replay offline');
console.log('fixture event accepted');
await page.waitForTimeout(1800);
if (!await page.evaluate(() => (window as any).mbd.replayFixtureStartAtSafePhase())) throw new Error('normal event path did not select replay at safe phase');
console.log('automatic replay selected');
await page.setViewportSize({ width: 320, height: 734 });
await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
await page.setViewportSize({ width: 734, height: 320 });
await page.evaluate(() => window.dispatchEvent(new Event('resize')));
await page.locator('.replay-overlay:not(.hidden)').waitFor();
await page.locator('.replay-free').tap();
await page.waitForTimeout(2000);
if (!await page.locator('.replay-overlay.free-camera').isVisible()) {
  throw new Error(`Free Camera did not enter offline: ${JSON.stringify({ cacheReceipt, failed, errors, diagnostics: await page.evaluate(() => (window as any).mbd.replayFreeCameraDiagnostics()) })}`);
}
for (const action of ['focus-ball', 'focus-athlete', 'next-athlete', 'plate', 'foul-line', 'outfield', 'overhead', 'toggle-hud', 'capture-photo', 'reset']) {
  await page.locator(`[data-action="${action}"]`).tap();
}
await mkdir('reports/closeout/screenshots', { recursive: true });
await page.screenshot({ path: 'reports/closeout/screenshots/free-camera-cold-offline.png' });
const diagnostics = await page.evaluate(() => (window as any).mbd.replayFreeCameraDiagnostics());
await page.locator('[data-action="exit"]').tap();
const afterExit = await page.evaluate(() => (window as any).mbd.replayFreeCameraDiagnostics());
await writeFile('reports/closeout/offline-free-camera.json', `${JSON.stringify({ cacheReceipt, diagnostics, afterExit, failed }, null, 2)}\n`);
await browser.close();
if (failed.length || !diagnostics.active || diagnostics.colliders !== 5 || diagnostics.bvhTrees !== 5 || afterExit.active || afterExit.colliders !== 0) process.exit(1);
console.log(JSON.stringify({ cacheAssets: cacheReceipt.urls.length, diagnostics, afterExit, failed }, null, 2));
