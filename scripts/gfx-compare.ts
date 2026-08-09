/**
 * Identical-frame profile captures plus a bounded live-play render benchmark.
 * Run against a freshly built preview:
 *   GFX_URL=http://127.0.0.1:4190 npm run gfx:compare
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';

const BASE = process.env.GFX_URL ?? 'http://127.0.0.1:4173';
const SECONDS = Number(process.env.GFX_SECONDS ?? 8);
const OUT = 'reports/visual';
const SHOTS = 'docs/screenshots';
type Profile = 'performance' | 'balanced' | 'high';

interface ProfileMetrics {
  profile: Profile;
  samples: number;
  medianSubmitMs: number;
  p95SubmitMs: number;
  medianFrameMs: number;
  p95FrameMs: number;
  maxDrawCalls: number;
  maxTriangles: number;
  geometries: number;
  textures: number;
  heapMB: number;
}

async function setProfile(page: Page, profile: Profile): Promise<void> {
  await page.evaluate((value) => {
    const app = (window as any).mbd;
    app.settings.quality = value;
    app.saveSettings();
  }, profile);
  await page.waitForTimeout(500);
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--expose-gc'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!(window as any).mbd);
  await page.evaluate(() => {
    const app = (window as any).mbd;
    app.startGame({
      awayTeamId: 'prairierock',
      homeTeamId: 'bayoucity',
      stadiumId: 'anchor-yard',
      innings: 9,
      difficulty: 'allstar',
      awayControl: 'cpu',
      homeControl: 'cpu',
      night: false,
      seed: 20260809,
    });
  });
  await page.waitForTimeout(3200);

  // Freeze one authoritative presentation and switch only the render profile.
  await page.evaluate(() => ((window as any).mbd.paused = true));
  for (const profile of ['performance', 'balanced', 'high'] as const) {
    await setProfile(page, profile);
    await page.screenshot({ path: `${SHOTS}/gfx-shipping-${profile}-day.png` });
  }
  await page.evaluate(() => ((window as any).mbd.paused = false));

  await page.evaluate(() => {
    const app = (window as any).mbd;
    const world = app.world;
    const original = world.render.bind(world);
    (window as any).__gfx = { submit: [], frame: [], calls: [], triangles: [], last: performance.now() };
    world.render = (dt: number) => {
      const stats = (window as any).__gfx;
      const now = performance.now();
      stats.frame.push(now - stats.last);
      stats.last = now;
      world.renderer.info.reset();
      const start = performance.now();
      original(dt);
      stats.submit.push(performance.now() - start);
      stats.calls.push(world.renderer.info.render.calls);
      stats.triangles.push(world.renderer.info.render.triangles);
    };
  });

  const metrics: ProfileMetrics[] = [];
  for (const profile of ['performance', 'balanced', 'high'] as const) {
    await setProfile(page, profile);
    await page.evaluate(() => {
      const stats = (window as any).__gfx;
      stats.submit.length = 0;
      stats.frame.length = 0;
      stats.calls.length = 0;
      stats.triangles.length = 0;
      stats.last = performance.now();
    });
    await page.waitForTimeout(SECONDS * 1000);
    metrics.push(await page.evaluate((value) => {
      const stats = (window as any).__gfx;
      const submit = [...stats.submit] as number[];
      const frame = [...stats.frame] as number[];
      for (let i = 1; i < submit.length; i++) {
        const valueAt = submit[i];
        let j = i - 1;
        while (j >= 0 && submit[j] > valueAt) { submit[j + 1] = submit[j]; j--; }
        submit[j + 1] = valueAt;
      }
      for (let i = 1; i < frame.length; i++) {
        const valueAt = frame[i];
        let j = i - 1;
        while (j >= 0 && frame[j] > valueAt) { frame[j + 1] = frame[j]; j--; }
        frame[j + 1] = valueAt;
      }
      const submitMedian = submit[Math.min(submit.length - 1, Math.floor(submit.length * 0.5))] ?? 0;
      const submitP95 = submit[Math.min(submit.length - 1, Math.floor(submit.length * 0.95))] ?? 0;
      const frameMedian = frame[Math.min(frame.length - 1, Math.floor(frame.length * 0.5))] ?? 0;
      const frameP95 = frame[Math.min(frame.length - 1, Math.floor(frame.length * 0.95))] ?? 0;
      if ((window as any).gc) (window as any).gc();
      const app = (window as any).mbd;
      const info = app.world.renderer.info;
      const memory = (performance as any).memory;
      return {
        profile: value,
        samples: stats.submit.length,
        medianSubmitMs: submitMedian,
        p95SubmitMs: submitP95,
        medianFrameMs: frameMedian,
        p95FrameMs: frameP95,
        maxDrawCalls: Math.max(0, ...stats.calls),
        maxTriangles: Math.max(0, ...stats.triangles),
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        heapMB: memory ? memory.usedJSHeapSize / 1048576 : -1,
      };
    }, profile));
  }

  // Night separation and phone landscape are required visual gates.
  await page.evaluate(() => {
    const app = (window as any).mbd;
    app.startGame({
      awayTeamId: 'coralkey', homeTeamId: 'ironport', stadiumId: 'bayou-bowl', innings: 3,
      difficulty: 'pro', awayControl: 'cpu', homeControl: 'cpu', night: true, seed: 20260810,
    });
  });
  await setProfile(page, 'high');
  await page.waitForTimeout(2600);
  await page.evaluate(() => ((window as any).mbd.paused = true));
  await page.screenshot({ path: `${SHOTS}/gfx-shipping-high-night.png` });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/gfx-shipping-high-phone-landscape.png` });

  const direct = metrics[0];
  const rows = metrics.map((row) => {
    const medianDelta = direct.medianSubmitMs > 0 ? ((row.medianSubmitMs / direct.medianSubmitMs) - 1) * 100 : 0;
    const p95Delta = direct.p95SubmitMs > 0 ? ((row.p95SubmitMs / direct.p95SubmitMs) - 1) * 100 : 0;
    return { ...row, medianDeltaPct: medianDelta, p95DeltaPct: p95Delta };
  });
  await writeFile(`${OUT}/gfx-shipping-profile-benchmark.json`, `${JSON.stringify({ seconds: SECONDS, rows, errors }, null, 2)}\n`);
  const table = rows.map((row) =>
    `| ${row.profile} | ${row.medianSubmitMs.toFixed(3)} | ${row.p95SubmitMs.toFixed(3)} | ` +
    `${row.medianDeltaPct.toFixed(1)}% | ${row.p95DeltaPct.toFixed(1)}% | ${row.medianFrameMs.toFixed(2)} | ` +
    `${row.maxDrawCalls} | ${row.maxTriangles} | ${row.heapMB.toFixed(1)} |`,
  ).join('\n');
  await writeFile(`${OUT}/SHIPPING_RENDER_BENCHMARK.md`, `# Shipping native render benchmark\n\n` +
    `Same production game, Chromium/ANGLE SwiftShader, 1600×900, ${SECONDS}s/profile. Submission time is CPU-side and ` +
    `is paired with frame pacing, resource counts, screenshots, phone checks, and the longer soak.\n\n` +
    `| Profile | median submit ms | p95 submit ms | median vs direct | p95 vs direct | median frame ms | max calls | max triangles | heap MB |\n` +
    `| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${table}\n\n` +
    `The rejected composer evidence remains in \`POSTPROCESSING_BENCHMARK.md\`. All shipping settings use ` +
    `the direct antialiased renderer. Visual gates: \`gfx-shipping-performance-day.png\`, ` +
    `\`gfx-shipping-balanced-day.png\`, \`gfx-shipping-high-day.png\`, ` +
    `\`gfx-shipping-high-night.png\`, and \`gfx-shipping-high-phone-landscape.png\`.\n\n` +
    `Console/page errors: ${errors.length}.\n`);
  console.table(rows);
  console.log(`errors: ${errors.length}`);
  await browser.close();
  process.exit(errors.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
