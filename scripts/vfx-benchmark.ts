/** Production native VFX benchmark and visual receipt. */
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = process.env.VFX_URL ?? 'http://127.0.0.1:4173';
const SECONDS = Number(process.env.VFX_SECONDS ?? 6);

async function main(): Promise<void> {
  await mkdir('reports/visual', { recursive: true });
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--expose-gc'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction('window.mbd');
  await page.evaluate(`(() => {
    const app = window.mbd;
    app.startGame({ awayTeamId:'prairierock', homeTeamId:'bayoucity', stadiumId:'anchor-yard', innings:3,
      difficulty:'pro', awayControl:'cpu', homeControl:'cpu', night:false, seed:20260811 });
  })()`);
  await page.waitForTimeout(2600);
  await page.evaluate(`(() => {
    const app = window.mbd;
    app.paused = true;
    app.settings.quality = 'high';
    app.saveSettings();
    const field = app.world.particles;
    const original = field.update.bind(field);
    window.__vfxNative = { samples:[], peak:0 };
    field.update = function(dt) {
      const start = performance.now();
      original(dt);
      window.__vfxNative.samples.push(performance.now() - start);
      window.__vfxNative.peak = Math.max(window.__vfxNative.peak, field.activeCount);
    };
    window.__emitNativeVfx = function() {
      field.clear();
      field.emitPreset('dirt-spray', -3.4, 0.15, 9, 5);
      field.emitPreset('grass-fragments', 0, 0.15, 9, 5.5);
      field.emitPreset('chalk-puff', 3.4, 0.15, 9, 6.5);
    };
    window.__emitNativeVfx();
    window.__vfxTimer = setInterval(window.__emitNativeVfx, 460);
  })()`);
  await page.waitForTimeout(120);
  await page.screenshot({ path: 'reports/visual/native-vfx-production.png' });
  await page.waitForTimeout(SECONDS * 1000);
  const metrics = await page.evaluate(`(() => {
    clearInterval(window.__vfxTimer);
    const app = window.mbd;
    const field = app.world.particles;
    field.clear();
    if (window.gc) window.gc();
    const values = window.__vfxNative.samples.slice();
    for (let i=1;i<values.length;i++) { const value=values[i]; let j=i-1; while(j>=0&&values[j]>value){values[j+1]=values[j];j--;} values[j+1]=value; }
    const at = p => values[Math.min(values.length-1, Math.floor(values.length*p))] || 0;
    return { samples:values.length, medianUpdateMs:at(.5), p95UpdateMs:at(.95), peakParticles:window.__vfxNative.peak,
      capacity:field.capacity, drawMeshes:1, geometries:app.world.renderer.info.memory.geometries,
      textures:app.world.renderer.info.memory.textures,
      heapMB:performance.memory ? performance.memory.usedJSHeapSize/1048576 : -1 };
  })()`) as Record<string, number>;
  const payload = { seconds: SECONDS, ...metrics, errors };
  await writeFile('reports/visual/native-vfx-benchmark.json', `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
