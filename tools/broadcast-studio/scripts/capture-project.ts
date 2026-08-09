/** Captures the browser-authored Theatre project state and native export. This
 * is intentionally a development tool; neither Playwright nor Theatre Studio
 * is reachable from the production game. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const REPO = resolve(ROOT, '../..');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (message) => console.log(`[browser:${message.type()}] ${message.text()}`));
page.on('pageerror', (error) => console.error('[browser:pageerror]', error));
await page.goto('http://127.0.0.1:4186', { waitUntil: 'networkidle' });
await page.waitForFunction(() => Boolean((window as unknown as { mbdStudio?: unknown }).mbdStudio));
const exportValue = await page.evaluate(() => {
  const api = (window as unknown as {
    mbdStudio: { seed: () => void; exportNative: () => unknown; exportProject: () => unknown };
  }).mbdStudio;
  api.seed();
  return { project: api.exportProject(), native: api.exportNative() };
});
mkdirSync(resolve(ROOT, 'projects'), { recursive: true });
mkdirSync(resolve(REPO, 'broadcast-staging'), { recursive: true });
mkdirSync(resolve(REPO, 'reports/replay'), { recursive: true });
writeFileSync(resolve(ROOT, 'projects/home-run-primary.theatre.json'), `${JSON.stringify(exportValue.project, null, 2)}\n`);
writeFileSync(resolve(REPO, 'broadcast-staging/home-run-primary.json'), `${JSON.stringify(exportValue.native, null, 2)}\n`);
await page.screenshot({ path: resolve(REPO, 'reports/replay/broadcast-studio.png') });
await browser.close();
console.log('captured Theatre project state, staged native sequence, and studio screenshot');
