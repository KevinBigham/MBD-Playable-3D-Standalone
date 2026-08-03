/**
 * Performance and memory harness.
 *
 *   npm run build && npx vite preview --port 4177 &
 *   npx tsx scripts/perf.ts
 *
 * Measures live frame rate during real gameplay and checks that starting many
 * games back to back does not grow the heap or the scene graph.
 */
import { chromium } from 'playwright';

const BASE = process.env.PERF_URL ?? 'http://localhost:4177';
const W = Number(process.env.PERF_W ?? 1920);
const H = Number(process.env.PERF_H ?? 1080);
const SECONDS = Number(process.env.PERF_SECONDS ?? 60);

async function main(): Promise<void> {
  const browser = await chromium.launch({
    args: [
      '--use-gl=angle',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--js-flags=--expose-gc',
    ],
  });
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!(window as any).mbd, undefined, { timeout: 30000 });
  const bootMs = Date.now() - t0;
  console.log(`page load to interactive: ${bootMs} ms  (viewport ${W}x${H})`);

  await page.evaluate(() => {
    (window as any).mbd.startGame({
      awayTeamId: 'prairierock',
      homeTeamId: 'bayoucity',
      stadiumId: 'bayou-bowl',
      innings: 9,
      difficulty: 'allstar',
      awayControl: 'cpu',
      homeControl: 'cpu',
      night: true,
      seed: 20260731,
    });
  });
  await page.waitForTimeout(2500);

  // Sample the app's own rolling frame-rate figure once a second.
  const samples: number[] = [];
  for (let i = 0; i < SECONDS; i++) {
    await page.waitForTimeout(1000);
    samples.push(await page.evaluate(() => (window as any).mbd.fps()));
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const p5 = samples[Math.floor(samples.length * 0.05)];
  console.log(
    `fps over ${SECONDS}s of live play — min ${samples[0].toFixed(1)}  p5 ${p5.toFixed(1)}  mean ${mean.toFixed(1)}  max ${samples[samples.length - 1].toFixed(1)}`,
  );

  // Leak check: eight games back to back. GPU geometries and HUD nodes are
  // counted alongside the heap because neither shows up in usedJSHeapSize —
  // an earlier build leaked 1500 geometries with a completely flat heap.
  const rows: {
    game: number;
    heapMB: number;
    sceneChildren: number;
    geometries: number;
    hudNodes: number;
  }[] = [];
  const stadiums = [
    'anchor-yard',
    'sandpit',
    'comet-dome',
    'bayou-bowl',
    'summit-field',
    'the-foundry',
    'grove-park',
    'thunder-ridge',
  ];
  for (let i = 0; i < stadiums.length; i++) {
    await page.evaluate(
      ([stadiumId, seed]) => {
        (window as any).mbd.startGame({
          awayTeamId: 'coralkey',
          homeTeamId: 'ironport',
          stadiumId,
          innings: 3,
          difficulty: 'pro',
          awayControl: 'cpu',
          homeControl: 'cpu',
          night: (seed as number) % 2 === 0,
          seed,
        });
      },
      [stadiums[i], 1000 + i] as [string, number],
    );
    await page.waitForTimeout(4000);
    const snap = await page.evaluate(() => {
      const w = window as any;
      if (w.gc) w.gc();
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      const info = w.mbd.world.renderer.info.memory;
      return {
        heapMB: mem ? mem.usedJSHeapSize / 1048576 : -1,
        sceneChildren: w.mbd.world.scene.children.length,
        geometries: info.geometries as number,
        hudNodes: document.querySelectorAll('#hud *').length,
      };
    });
    rows.push({ game: i + 1, ...snap });
  }

  console.log('\ngame  heap(MB)  scene children  GPU geometries  HUD nodes');
  for (const r of rows) {
    console.log(
      `${String(r.game).padStart(4)}  ${r.heapMB.toFixed(1).padStart(8)}  ` +
        `${String(r.sceneChildren).padStart(14)}  ${String(r.geometries).padStart(14)}  ` +
        `${String(r.hudNodes).padStart(9)}`,
    );
  }
  const first = rows[0];
  const last = rows[rows.length - 1];
  const grew = last.heapMB - first.heapMB;
  console.log(
    `\nheap change across 8 games: ${grew >= 0 ? '+' : ''}${grew.toFixed(1)} MB` +
      `   scene children ${first.sceneChildren} -> ${last.sceneChildren}` +
      `   geometries ${first.geometries} -> ${last.geometries}` +
      `   HUD nodes ${first.hudNodes} -> ${last.hudNodes}`,
  );
  console.log(`console errors: ${errors.length}`);
  for (const e of errors.slice(0, 8)) console.log('  ' + e);

  await context.close();
  await browser.close();
  process.exit(errors.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
