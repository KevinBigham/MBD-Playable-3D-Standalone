import { chromium } from 'playwright';

const base = process.env.PAGES_URL ?? 'http://127.0.0.1:4188/MBD-Playable-3D-Standalone/';
const origin = new URL(base).origin;
const prefix = new URL(base).pathname;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
const failures: string[] = [];
page.on('requestfailed', (request) => failures.push(`${request.url()} — ${request.failure()?.errorText ?? 'failed'}`));
page.on('response', (response) => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!(window as any).mbd);
await page.evaluate(async () => await navigator.serviceWorker.ready);
const receipt = await page.evaluate(async () => {
  const registration = await navigator.serviceWorker.getRegistration();
  return { controller: !!navigator.serviceWorker.controller, scope: registration?.scope ?? null };
});
const requests = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
const wrongRoot = requests.filter((url) => url.startsWith(`${origin}/assets/`) || url.startsWith(`${origin}/vendor/`));
const wrongOrigin = requests.filter((url) => url.startsWith(origin) && !url.includes('/MBD-Playable-3D-Standalone/'));
await browser.close();
console.log(JSON.stringify({ base, prefix, receipt, failures, wrongRoot, wrongOrigin }, null, 2));
if (failures.length || wrongRoot.length || wrongOrigin.length || !receipt.controller || !receipt.scope?.endsWith('/MBD-Playable-3D-Standalone/')) process.exit(1);
