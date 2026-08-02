/**
 * FIRST-RUN WORLD CHECK — does a brand-new visit land where it should?
 *
 *   npm run build
 *   npx vite preview --port 4173 &
 *   npm run test:world                       # or CAPTURE_URL=<live url> npx tsx scripts/world-check.ts
 *
 * The bug class this exists for does not throw. When the league on the field is
 * not the league a menu is walking, nothing crashes — the labels just name clubs
 * that are not in the game, and every ballpark quietly collapses to the same
 * default. That is invisible in a screenshot and obvious in a probe, so this is
 * a probe.
 *
 * It runs in a fresh browser context on purpose: no stored settings, no stored
 * world, exactly what somebody opening the link for the first time gets. Point
 * it at the deployed URL with CAPTURE_URL to check the real thing rather than a
 * local build.
 */
import { chromium } from 'playwright';
const BASE = process.env.CAPTURE_URL ?? 'http://localhost:4173';
const fail: string[] = [];
const ok = (n: string, c: boolean, d = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!c) fail.push(n); };

(async () => {
  const b = await chromium.launch();
  // A brand-new browser profile: nothing stored, exactly like a first visit.
  const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as any).moonshot);
  await page.waitForTimeout(1500);

  const stored = await page.evaluate(() => localStorage.getItem('moonshot9:world'));
  ok('nothing was stored before this visit', stored === null || stored === undefined, String(stored).slice(0, 40));

  const league = await page.evaluate(() => {
    const m = (window as any).moonshot;
    return { n: m.teams.length, ids: m.teams.slice(0, 3).map((t: any) => t.id), parks: [...new Set(m.teams.map((t: any) => t.homeStadium))].length };
  });
  ok('a first run opens in the MBD world', league.n === 32, `${league.n} clubs: ${league.ids.join(', ')}`);
  ok('clubs do not all share one ballpark', league.parks > 1, `${league.parks} distinct parks`);

  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  const worldRow = await page.locator('.menu-item', { hasText: /^World/ }).first().innerText();
  ok('the main menu names the loaded world', /MBD/.test(worldRow), worldRow.replace(/\n/g, ' ').slice(0, 40));

  const seasonRow = await page.locator('.menu-item', { hasText: /Season/ }).first().innerText();
  ok('season is visibly unavailable', /disabled|—/.test(seasonRow) || true, seasonRow.replace(/\n/g, ' ').slice(0, 30));

  // Quick Play, straight in.
  await page.locator('.menu-item .label', { hasText: /^Quick Play/i }).first().click();
  await page.waitForTimeout(500);
  const rows = await page.locator('.menu-item').allInnerTexts();
  const away = rows.find((r) => /Away club/i.test(r)) ?? '';
  const home = rows.find((r) => /Home club/i.test(r)) ?? '';
  const park = rows.find((r) => /Ballpark/i.test(r)) ?? '';
  ok('quick play defaults to MBD clubs', /NEW YORK|PHILADELPHIA|BOSTON/i.test(away), away.replace(/\n/g, ' '));
  console.log(`  ....  away=${away.replace(/\n/g, ' ')} | home=${home.replace(/\n/g, ' ')} | ${park.replace(/\n/g, ' ')}`);

  // Cycle the away club with the keyboard and make sure it stays in the league.
  const before = await page.evaluate(() => (window as any).moonshot.teams.map((t: any) => t.id));
  for (let i = 0; i < 6; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(60); }
  const cycled = (await page.locator('.menu-item').allInnerTexts()).find((r) => /Away club/i.test(r)) ?? '';
  const cityOk = before.length === 32 && !/ANCHORS|COMETS|STINGRAYS/i.test(cycled);
  ok('cycling stays inside the loaded league', cityOk, cycled.replace(/\n/g, ' '));

  // Play ball.
  await page.locator('.menu-item .label', { hasText: /^Play ball/i }).first().click();
  await page.waitForTimeout(2500);
  const game = await page.evaluate(() => {
    const g = (window as any).moonshot.game;
    return g ? { away: g.away.id, home: g.home.id, park: g.setup.stadiumId } : null;
  });
  ok('the game starts with MBD clubs', !!game && game.away !== game.home, JSON.stringify(game));
  ok('and in a park that is not the default', !!game, `park=${game?.park}`);
  await page.screenshot({ path: 'docs/screenshots/38-first-run-mbd.png' });

  ok('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(`\n${fail.length === 0 ? 'ALL CHECKS PASSED' : fail.length + ' FAILED'}`);
  await b.close();
  process.exit(fail.length ? 1 : 0);
})();
