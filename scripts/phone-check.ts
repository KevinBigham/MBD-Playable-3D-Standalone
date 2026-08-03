/**
 * THE PHONE AUDIT — run against real WebKit, with real touches.
 *
 *   npm run build
 *   npx vite preview --port 4173 &
 *   npx tsx scripts/phone-check.ts
 *
 * Every phone claim this project has made until now was measured in Chromium
 * with synthesised pointer events and a resized window. That is a good proxy
 * for Android and a poor one for the iPhone, which is most of the phones this
 * will ever run on. Chromium will happily tell you that `user-scalable=no`
 * stopped the pinch zoom; iOS Safari has ignored that attribute since iOS 10
 * and will not.
 *
 * So this harness runs the *production build* in **WebKit** — the same engine
 * as Safari — with a touchscreen instead of a mouse, at an iPhone's size and
 * pixel density. It does not take pretty pictures. It asks the questions whose
 * answers differ between engines, and it fails the run when one comes back
 * wrong:
 *
 *   - can the page be zoomed, scrolled, or dragged out from under the game?
 *   - does a real `touchstart` — not a synthetic pointer event — turn the pad on?
 *   - is every control on-screen, clear of the notch, and big enough for a thumb?
 *   - are the *menus* usable with a thumb, on a phone held upright, which is the
 *     part somebody meets first and abandons the game over?
 *   - does a touch land on the pixel it touched — in both orientations?
 *   - is every part of the strike zone actually touchable, or is some of it
 *     behind a button?
 *   - does touching the crossing point hit the ball, in the engine that will
 *     run it?
 *   - does the quarter-turn rotation survive a real layout pass?
 *   - is a first-time player told what to touch, and shown how far off they were?
 *
 * A screenshot is written for each stage so a human can disagree with the
 * verdict, and the exit code is non-zero if any check failed.
 */
import { webkit, devices, type Page, type BrowserContext } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.CAPTURE_URL ?? 'http://localhost:4173';
const SHOT_DIR = 'docs/screenshots';

/**
 * An iPhone 15-class handset. Written out rather than taken from Playwright's
 * device registry so the numbers in the report mean something specific and do
 * not quietly change under us when the dependency updates.
 */
const IPHONE = {
  ...devices['iPhone 15'],
  viewport: { width: 393, height: 659 }, // portrait, with Safari's chrome present
};
const LANDSCAPE = { width: 734, height: 320 }; // the same phone turned, chrome present

/** Apple's own minimum for anything a finger has to hit. */
const MIN_TOUCH_PX = 44;

const failures: string[] = [];
const notes: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`;
  console.log(`  ${line}`);
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function note(text: string): void {
  console.log(`  ....  ${text}`);
  notes.push(text);
}

async function shot(page: Page, name: string, settleMs = 400): Promise<void> {
  if (settleMs > 0) await page.waitForTimeout(settleMs);
  await page.screenshot({ path: join(SHOT_DIR, `${name}.png`) });
}

/**
 * Blocks until the engine reaches one of `phases` *with the human at the
 * plate*, or the timeout expires.
 *
 * The half-inning matters, and leaving it out is a subtle way to measure the
 * wrong thing. Every game here is set up with the human batting away, so the
 * bottom half is the CPU's — and the CPU hitter drives the same `batter.cx/cy`
 * the touch controls do. Wait on the phase alone and a probe can land in the
 * CPU's half, where a touch is correctly ignored and the cursor is correctly
 * somewhere else, and report a working control scheme as broken by 130 pixels.
 */
async function waitPhase(page: Page, phases: string[], maxMs = 25000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const s = await page.evaluate(() => {
      const g = (window as unknown as { mbd: { game?: { phase: string; half: string } } })
        .mbd?.game;
      return g ? { phase: g.phase, half: g.half } : null;
    });
    if (s && s.half === 'top' && phases.includes(s.phase)) return true;
    await page.waitForTimeout(30);
  }
  return false;
}

async function startGame(page: Page, setup: Record<string, unknown>): Promise<void> {
  await page.evaluate((s) => {
    (window as unknown as { mbd: { startGame: (x: unknown) => void } }).mbd.startGame(s);
  }, setup);
}

/**
 * Turns the touch pad on the way a person does: by touching the screen. This is
 * the check, not a shortcut past it — the pad is supposed to appear on a real
 * `touchstart`, and WebKit is the engine most likely to disagree about what
 * counts as one.
 */
async function firstTouch(page: Page): Promise<void> {
  const box = page.viewportSize()!;
  await page.touchscreen.tap(box.width / 2, box.height / 2);
  await page.waitForTimeout(250);
}

/** Every visible control, with its on-screen box, measured after transforms. */
async function controlBoxes(page: Page): Promise<
  Array<{ id: string; x: number; y: number; w: number; h: number }>
> {
  return page.evaluate(() => {
    const out: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
    const sel = '#touch .t-btn, #touch .t-pause';
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
      const r = el.getBoundingClientRect();
      out.push({
        id: el.getAttribute('data-a') ?? el.className,
        // getBoundingClientRect is post-transform, so a rotated game reports the
        // box the finger actually has to find rather than the one it was
        // authored as. That is the number that matters.
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    });
    return out;
  });
}

// --------------------------------------------------------------------- stages

async function auditChrome(page: Page): Promise<void> {
  console.log('\n[1] The page itself — can it be moved, zoomed or scrolled?');

  // iOS Safari ignores user-scalable=no. `touch-action` is the attribute it
  // does honour, and it is the only thing standing between a double-tap on the
  // strike zone and a zoomed-in game.
  // `touch-action` is not an inherited property, so reading the computed value
  // off one element answers the wrong question. The browser intersects the
  // values along the whole chain from the hit element upwards, so a `manipulation`
  // on <html> really does disable double-tap over a child whose own computed
  // value still reads `auto`. This walks the chain the way the engine does.
  //
  // Written without helper functions on purpose: tsx compiles named function
  // expressions with a `__name` shim that does not exist inside the page.
  const actions = await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (const [key, sel] of [
      ['the field', '#gl'],
      ['the strike zone', '#touch .t-zone'],
      ['the menus', '#ui'],
      ['the game box', '#app'],
    ]) {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) {
        out[key] = 'missing';
        continue;
      }
      const chain: string[] = [];
      let node: HTMLElement | null = el;
      while (node) {
        chain.push(getComputedStyle(node).touchAction);
        node = node.parentElement;
      }
      out[key] = chain.join(' < ');
    }
    return out;
  });
  for (const [where, chain] of Object.entries(actions)) {
    const parts = chain.split(' < ');
    const ok = parts.some((v) => v === 'none' || v === 'manipulation');
    check(`double-tap zoom is off over ${where}`, ok, `touch-action chain: ${chain}`);
  }

  const scroll = await page.evaluate(() => ({
    docScroll: document.scrollingElement
      ? document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight
      : 0,
    bodyOverflow: getComputedStyle(document.body).overflowY,
    overscroll: getComputedStyle(document.documentElement).overscrollBehaviorY,
  }));
  check('nothing to scroll', scroll.docScroll <= 1, `${scroll.docScroll}px of overflow`);
  check(
    'pull-to-refresh cannot fire',
    scroll.overscroll === 'none' || scroll.overscroll === 'contain',
    `overscroll-behavior-y: ${scroll.overscroll}`,
  );

  // The pinch gesture on iOS arrives as a non-standard `gesturestart` event and
  // is the one zoom route touch-action does not close. Probed by firing one and
  // asking whether anybody refused it, rather than by looking for a flag the
  // game would only be carrying for this test's benefit.
  const guarded = await page.evaluate(() => {
    const ev = new Event('gesturestart', { cancelable: true, bubbles: true });
    document.getElementById('gl')!.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  check('pinch-zoom is refused', guarded, guarded ? '' : 'nothing preventDefault-ed gesturestart');
}

async function auditViewport(page: Page): Promise<void> {
  console.log('\n[2] The viewport — does the game know how big the screen really is?');

  const v = await page.evaluate(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    const app = document.getElementById('app')!.getBoundingClientRect();
    return {
      vh: root.style.getPropertyValue('--vh'),
      vw: root.style.getPropertyValue('--vw'),
      visual: vv ? { w: Math.round(vv.width), h: Math.round(vv.height) } : null,
      inner: { w: window.innerWidth, h: window.innerHeight },
      appBox: { w: Math.round(app.width), h: Math.round(app.height) },
    };
  });
  note(`visualViewport ${v.visual?.w}x${v.visual?.h}, innerWindow ${v.inner.w}x${v.inner.h}`);
  check(
    '--vh tracks the visible viewport, not the imaginary one',
    v.vh === `${v.visual?.h}px`,
    `--vh is ${v.vh || '(unset)'}, visualViewport is ${v.visual?.h}px`,
  );
  check(
    'the app box fills the visible viewport exactly',
    Math.abs(v.appBox.h - (v.visual?.h ?? 0)) <= 1 &&
      Math.abs(v.appBox.w - (v.visual?.w ?? 0)) <= 1,
    `app ${v.appBox.w}x${v.appBox.h} vs viewport ${v.visual?.w}x${v.visual?.h}`,
  );
}

async function auditTouchPad(page: Page): Promise<void> {
  console.log('\n[3] The pad — does a real touch turn it on, and can a thumb hit it?');

  const on = await page.evaluate(() => document.body.classList.contains('touch-mode'));
  check('a real touchstart enables the touch controls', on);

  const size = page.viewportSize()!;
  const boxes = await controlBoxes(page);
  check('controls are present', boxes.length > 0, `${boxes.length} found`);

  const offscreen = boxes.filter(
    (b) => b.x < -1 || b.y < -1 || b.x + b.w > size.width + 1 || b.y + b.h > size.height + 1,
  );
  check(
    'every control is fully on-screen',
    offscreen.length === 0,
    offscreen.map((b) => `${b.id} at ${b.x},${b.y} ${b.w}x${b.h}`).join('; '),
  );

  const small = boxes.filter((b) => b.w < MIN_TOUCH_PX || b.h < MIN_TOUCH_PX);
  check(
    `every control is at least ${MIN_TOUCH_PX}x${MIN_TOUCH_PX}`,
    small.length === 0,
    small.map((b) => `${b.id} ${b.w}x${b.h}`).join('; '),
  );

  // The notch and the home indicator. Anything inside those bands is either
  // covered by hardware or fighting the system's own swipe.
  const insets = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;top:0;left:0;padding-top:env(safe-area-inset-top);' +
      'padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);' +
      'padding-right:env(safe-area-inset-right);visibility:hidden';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const r = {
      top: parseFloat(cs.paddingTop) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0,
      right: parseFloat(cs.paddingRight) || 0,
    };
    probe.remove();
    return r;
  });
  note(
    `safe-area insets t${insets.top} r${insets.right} b${insets.bottom} l${insets.left} ` +
      '(a headless WebKit reports zero; a handset does not)',
  );
  const intruding = boxes.filter(
    (b) =>
      b.y < insets.top ||
      b.y + b.h > size.height - insets.bottom ||
      b.x < insets.left ||
      b.x + b.w > size.width - insets.right,
  );
  check(
    'no control sits under the notch or the home indicator',
    intruding.length === 0,
    intruding.map((b) => b.id).join('; '),
  );
}

/**
 * Which pixel is a given point at the plate?
 *
 * project() returns fractions of the *game* box. The finger lands in the
 * *phone's* frame, and when the game has turned itself those are a quarter turn
 * apart: the game's top-left corner is the phone's top-right, so its x runs
 * down the screen and its y runs right-to-left across it. Derived here from
 * `rotate(90deg) translateY(-100%)` about the top-left corner, and written out
 * deliberately — the game does the inverse of this in exactly one place, and a
 * forward map worked out independently is what makes the round trip evidence
 * rather than a tautology. getBoundingClientRect is already post-transform, so
 * its width and height are the phone's, not the game's.
 */
async function pixelForPlatePoint(
  page: Page,
  x: number,
  y: number,
): Promise<{ px: number; py: number; turned: boolean }> {
  return page.evaluate(([px, py]) => {
    const m = window as unknown as {
      mbd: { world: { project: (a: number, b: number, c: number) => { x: number; y: number } } };
    };
    const p = m.mbd.world.project(px, py, 0.62);
    const app = document.getElementById('app')!.getBoundingClientRect();
    const turned = document.documentElement.classList.contains('rotated');
    return {
      px: turned ? app.left + (1 - p.y) * app.width : app.left + p.x * app.width,
      py: turned ? app.top + p.x * app.height : app.top + p.y * app.height,
      turned,
    };
  }, [x, y]);
}

/**
 * Blocks until the camera has stopped moving.
 *
 * This round trip goes out through one projection and back through another a
 * few hundred milliseconds later, so it only means something while the two are
 * the same projection. The game itself has no such problem — it inverts the
 * live camera at the instant of the touch — but a measurement taken across a
 * camera that is still easing into place after a quarter-turn reports the
 * camera's motion as the control scheme's error. Probing the same plate point
 * twice and waiting for the pixel to stop changing is the cheapest way to ask.
 */
async function waitForStillCamera(page: Page, maxMs = 4000): Promise<void> {
  const deadline = Date.now() + maxMs;
  let last: { px: number; py: number } | null = null;
  while (Date.now() < deadline) {
    const now = await pixelForPlatePoint(page, 0, 0.95);
    if (last && Math.hypot(now.px - last.px, now.py - last.py) < 0.5) return;
    last = now;
    await page.waitForTimeout(150);
  }
}

async function auditAim(page: Page): Promise<void> {
  console.log('\n[4] The map — does a real touch land where the finger went?');
  await waitForStillCamera(page);

  // Measured between pitches on purpose. Mid-flight the cursor is a moving part
  // — the swing consumes it and the next hitter resets it — so reading it there
  // races the engine and measures the race rather than the map. Between pitches
  // a touch does exactly one thing: it aims.
  const ready = await waitPhase(page, ['preplay', 'windup']);
  check('the game settles between pitches', ready);
  if (!ready) return;

  // A brand new browser profile has never swung, so the first-swing coach is due
  // on screen. It will not be after this function has tapped three times.
  //
  // Waited for rather than sampled once, because there are moments when it is
  // *correctly* absent — it stands down while a swing verdict is up, and it
  // fades in over a fifth of a second. A single read catches one of those and
  // reports a working feature as broken, which is the worst kind of test.
  let coaching = { text: '', shown: false };
  const coachBy = Date.now() + 2500;
  while (Date.now() < coachBy && !coaching.shown) {
    coaching = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.pv-coach');
      if (!el) return { text: '', shown: false };
      return {
        text: el.textContent ?? '',
        shown: parseFloat(getComputedStyle(el).opacity || '0') > 0,
      };
    });
    if (!coaching.shown) await page.waitForTimeout(60);
  }
  check(
    'a first-time player is told what to touch',
    coaching.shown && /TOUCH/.test(coaching.text),
    `"${coaching.text}"${coaching.shown ? '' : ' (never appeared)'}`,
  );
  // Settled, because the hint fades in over a fifth of a second and a shot at
  // zero catches it half-transparent and makes it look broken.
  await shot(page, '31-phone-coach', 350);

  // Three points, including two corners of what a stick could reach, because a
  // projection that is right in the middle of the zone and wrong at the edges is
  // the normal way for this kind of solve to fail.
  const probes: Array<[number, number]> = [
    [0, 0.95],
    [-0.34, 1.3],
    [0.4, 0.42],
  ];
  let worst = 0;
  let turned = false;
  const detail: string[] = [];
  for (const [x, y] of probes) {
    // A touch only aims while somebody is standing in the box. Between a
    // strikeout and the next hitter the game is in `lineup`, where it ignores
    // the field entirely and correctly — so a probe that lands there measures
    // the game refusing an input, not the game mapping one, and reports a
    // working control scheme as 85 pixels wrong.
    //
    // Eligibility is therefore checked immediately before the touch AND again
    // immediately after, and a probe that straddled the boundary is thrown away
    // and repeated rather than recorded. Four attempts, because at some point
    // "it never settled" is itself the finding.
    let recorded = false;
    for (let attempt = 0; attempt < 4 && !recorded; attempt++) {
      if (!(await waitPhase(page, ['preplay', 'windup']))) break;
      const at = await pixelForPlatePoint(page, x, y);
      turned = at.turned;
      // Who would actually receive this touch? A pixel inside the strike zone
      // that lands on top of a button is not a mapping error — it is a hole in
      // the control scheme, and it needs to be named as one.
      const owner = await page.evaluate(
        ([px, py]) => {
          const el = document.elementFromPoint(px, py) as HTMLElement | null;
          if (!el) return 'nothing';
          return el.getAttribute('data-a') ?? (el.className || el.tagName.toLowerCase());
        },
        [at.px, at.py],
      );
      const before = await page.evaluate(() => {
        const g = (window as unknown as { mbd: { game?: { batter: { cx: number; cy: number } } } })
          .mbd.game!;
        return { cx: g.batter.cx, cy: g.batter.cy };
      });
      await page.touchscreen.tap(at.px, at.py);
      await page.waitForTimeout(120);
      const cur = await page.evaluate(() => {
        const g = (
          window as unknown as {
            mbd: { game?: { batter: { cx: number; cy: number }; phase: string; half: string } };
          }
        ).mbd.game!;
        return { cx: g.batter.cx, cy: g.batter.cy, phase: g.phase, half: g.half };
      });
      if (cur.half !== 'top' || !['preplay', 'windup', 'pitch'].includes(cur.phase)) continue;
      // A cursor that did not move at all, when it was asked to move somewhere
      // it was not, means the touch was refused — the game had already left the
      // state where the field is an input by the time the finger landed, which
      // over a network is a race and not a defect. That is a different fact
      // from "the map is wrong" and must not be reported as one: taking the
      // reading anyway measures the distance to the cursor's resting place and
      // calls it a mapping error.
      const asked = Math.hypot(x - before.cx, y - before.cy);
      const moved = Math.hypot(cur.cx - before.cx, cur.cy - before.cy);
      if (asked > 0.01 && moved < 1e-9) continue;

      // Measured in PIXELS, not millimetres. A phone held sideways gives the
      // strike zone about ninety pixels to work with, so one pixel of touch is
      // worth a centimetre at the plate — quoting the error in millimetres would
      // make a perfect answer look sloppy on a small screen and a sloppy one look
      // fine on a big one. The question is whether the game landed on the pixel
      // that was touched, and that has one right answer at every size.
      const back = await pixelForPlatePoint(page, cur.cx, cur.cy);
      const err = Math.hypot(back.px - at.px, back.py - at.py);
      worst = Math.max(worst, err);
      detail.push(`(${x}, ${y}) → ${owner}, off ${err.toFixed(2)}px`);
      recorded = true;
    }
    if (!recorded) detail.push(`(${x}, ${y}) → never got an eligible touch`);
  }
  check('every probe found a live plate appearance', detail.length === probes.length);
  check(
    `a real touch lands on the pixel it touched${turned ? ' (game turned)' : ''}`,
    // The tap coordinate itself is rounded to a whole pixel on the way in, so a
    // round trip cannot do better than half of one. Anything under a pixel is
    // the game agreeing with the finger as closely as the hardware allows.
    worst < 1,
    detail.join(' | '),
  );
}

/**
 * CAN A FINGER REACH THE WHOLE ZONE?
 *
 * The swing is a touch on the field, and the buttons are also on the field.
 * Anywhere they overlap, a hitter can aim at a spot on screen, watch the ball
 * cross it, touch it — and have a button answer instead. That is not a mapping
 * bug and no amount of accuracy in the solve fixes it; it is a part of the
 * strike zone the player simply does not have.
 *
 * So: walk the whole reachable cursor range, ask the page who owns each pixel,
 * and count the holes.
 */
async function auditZoneReach(page: Page): Promise<void> {
  console.log('\n[6] The reach — is every part of the zone actually touchable?');

  const cells: Array<{ x: number; y: number }> = [];
  for (let ix = 0; ix <= 8; ix++) {
    for (let iy = 0; iy <= 8; iy++) {
      // The full range a cursor can occupy, not just the called strike zone —
      // chasing a pitch off the plate is a swing too.
      cells.push({ x: -0.52 + (1.04 * ix) / 8, y: 0.28 + (1.18 * iy) / 8 });
    }
  }

  const blocked: string[] = [];
  for (const c of cells) {
    const at = await pixelForPlatePoint(page, c.x, c.y);
    const owner = await page.evaluate(
      ([px, py]) => {
        const el = document.elementFromPoint(px, py) as HTMLElement | null;
        if (!el) return 'offscreen';
        if (el.closest('.t-zone')) return 'zone';
        return el.getAttribute('data-a') ?? (el.className || el.tagName.toLowerCase());
      },
      [at.px, at.py],
    );
    if (owner !== 'zone') blocked.push(`${c.x.toFixed(2)},${c.y.toFixed(2)}→${owner}`);
  }
  check(
    'every point a cursor can reach belongs to the zone',
    blocked.length === 0,
    blocked.length ? `${blocked.length}/${cells.length} blocked: ${blocked.slice(0, 8).join(' ')}` : '',
  );
}

/**
 * THE PART BEFORE THE GAME.
 *
 * Everything else here measures the thing a person does for an hour. This
 * measures the thing they do first, once, and abandon the game over: picking
 * two clubs and a park out of a list with a thumb, on a phone held upright,
 * before they have any reason to persevere.
 *
 * The pad is built for fingers by hand. The menus were laid out for a keyboard
 * and a couch and then inherited a touchscreen, which is exactly the way a
 * 30-pixel row survives review — it looks fine on the machine it was written on.
 */
async function auditMenus(page: Page): Promise<void> {
  console.log('\n[8] The menus — can a thumb use them before the game starts?');

  const size = page.viewportSize()!;
  const rows = await page.evaluate(() => {
    const out: Array<{ label: string; y: number; h: number; w: number }> = [];
    document.querySelectorAll<HTMLElement>('#ui .menu-item').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const r = el.getBoundingClientRect();
      // Rows scrolled out of a list's own viewport are not a target problem.
      if (r.height < 1 || r.width < 1) return;
      out.push({
        label: (el.textContent ?? '').trim().slice(0, 24),
        y: Math.round(r.y),
        h: Math.round(r.height),
        w: Math.round(r.width),
      });
    });
    return out;
  });
  check('the menu has rows', rows.length > 0, `${rows.length} visible`);
  if (!rows.length) return;

  const short = rows.filter((r) => r.h < MIN_TOUCH_PX);
  check(
    `every menu row is at least ${MIN_TOUCH_PX}px tall`,
    short.length === 0,
    short.map((r) => `"${r.label}" ${r.h}px`).join('; '),
  );

  // A row that starts on screen and runs off the bottom is a row somebody has
  // to scroll to read, which is fine. A row wider than the screen is not.
  const tooWide = rows.filter((r) => r.w > size.width + 1);
  check(
    'no menu row is wider than the phone',
    tooWide.length === 0,
    tooWide.map((r) => `"${r.label}" ${r.w}px`).join('; '),
  );
  note(`${rows.length} rows, shortest ${Math.min(...rows.map((r) => r.h))}px`);
}

async function auditSwing(page: Page): Promise<void> {
  console.log('\n[5] The swing — does touching the zone hit the ball, in WebKit?');

  const reached = await waitPhase(page, ['pitch']);
  check('a pitch is thrown to the human hitter', reached);
  if (!reached) return;

  const pitch = await page.evaluate(() => {
    const g = (
      window as unknown as {
        mbd: { game?: { currentPitch: { plateX: number; plateY: number } | null } };
      }
    ).mbd.game;
    return g?.currentPitch ? { x: g.currentPitch.plateX, y: g.currentPitch.plateY } : null;
  });
  check('the crossing point is known at release', pitch !== null);
  if (!pitch) return;
  const at = await pixelForPlatePoint(page, pitch.x, pitch.y);

  // WHEN, not just where. The crossing point is fixed at release, so the pixel
  // was safe to work out early — but a touch that lands the instant the ball
  // leaves the hand is a swing at empty air, and grading that a miss would be
  // the engine being right rather than the control scheme being wrong. So this
  // waits in the page, one animation frame at a time, until the ball is about
  // 200 ms out and only then reaches for the glass.
  await page.waitForFunction(
    () => {
      const g = (
        window as unknown as {
          mbd: {
            game?: { phase: string; ball: { t: number }; currentPitch: { T: number } | null };
          };
        }
      ).mbd.game;
      if (!g || g.phase !== 'pitch' || !g.currentPitch) return false;
      return g.currentPitch.T - g.ball.t <= 0.2;
    },
    undefined,
    { polling: 'raf', timeout: 8000 },
  );
  await page.touchscreen.tap(at.px, at.py);

  // Polled rather than slept: the answer arrives when the engine says so, and a
  // fixed sleep either races it or wastes the difference.
  let grade = '';
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline && !grade) {
    grade = await page.evaluate(
      () =>
        (window as unknown as { mbd: { game?: { lastSwing: { grade: string } | null } } })
          .mbd.game?.lastSwing?.grade ?? '',
    );
    if (!grade) await page.waitForTimeout(40);
  }
  check('the touch produced a swing', grade !== '', grade && `graded ${grade}`);
  check(
    'and it was not a swing through the ball',
    grade !== '' && grade !== 'miss',
    `graded ${grade || 'nothing'}`,
  );
  note(`touched (${at.px.toFixed(0)}, ${at.py.toFixed(0)})px on the crossing point → ${grade}`);
}

/**
 * The picture a player gets after touching the wrong spot.
 *
 * Taken from a deliberate miss, high, because that is the case worth
 * documenting and the only one that stays on screen: a ball put in play takes
 * the camera to the field and the plate overlay goes with it.
 */
async function auditGapPicture(page: Page): Promise<void> {
  console.log('\n[7] The gap — after a miss, can you see how far off you were?');

  // Three pitches, because one is not a fair test of this particular thing.
  // The marks are supposed to be visible after a swing that did NOT put the
  // ball in play — a fair ball takes the camera to the field and the whole
  // plate overlay goes with it, correctly. Aiming 35 cm high is a miss on the
  // measured curve in tap.test.ts most of the time, and a pop-up occasionally,
  // and over a network the extra latency on the touch shifts the odds again.
  // Retrying is the difference between testing the drawing and testing the luck.
  let seen = false;
  let attempts = 0;
  for (; attempts < 3 && !seen; attempts++) {
    if (!(await waitPhase(page, ['pitch']))) break;
    const pitch = await page.evaluate(() => {
      const g = (
        window as unknown as {
          mbd: { game?: { currentPitch: { plateX: number; plateY: number } | null } };
        }
      ).mbd.game;
      return g?.currentPitch ? { x: g.currentPitch.plateX, y: g.currentPitch.plateY } : null;
    });
    if (!pitch) continue;
    const at = await pixelForPlatePoint(page, pitch.x, Math.min(1.42, pitch.y + 0.35));
    try {
      await page.waitForFunction(
        () => {
          const g = (
            window as unknown as {
              mbd: {
                game?: { phase: string; ball: { t: number }; currentPitch: { T: number } | null };
              };
            }
          ).mbd.game;
          if (!g || g.phase !== 'pitch' || !g.currentPitch) return false;
          return g.currentPitch.T - g.ball.t <= 0.2;
        },
        undefined,
        { polling: 'raf', timeout: 8000 },
      );
    } catch {
      continue;
    }
    await page.touchscreen.tap(at.px, at.py);

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !seen) {
      seen = await page.evaluate(() => {
        const g = document.querySelector<SVGGElement>('.pv-miss');
        if (!g || g.style.display === 'none') return false;
        // The overlay's own root hides between plays, and a mark inside a
        // hidden overlay is not a mark somebody can see.
        const root = document.querySelector<HTMLElement>('.plate-view');
        if (!root || root.style.display === 'none') return false;
        return parseFloat(g.style.opacity || '0') > 0.5;
      });
      if (!seen) await page.waitForTimeout(30);
    }
    if (seen) await shot(page, '30-phone-swing-gap', 0);
  }
  check('the miss is drawn on the zone', seen, `after ${attempts} swing(s)`);
}

async function auditRotation(page: Page): Promise<void> {
  console.log('\n[6] The quarter turn — does a portrait phone get a landscape game?');

  const gate = await page.locator('.rotate-gate').count();
  check('portrait mid-game offers the turn', gate > 0);
  if (gate === 0) return;
  await shot(page, '26-phone-webkit-rotate-gate');

  await page.locator('.rot-rotate').tap();
  await page.waitForTimeout(500);

  const size = page.viewportSize()!;
  const geom = await page.evaluate(() => {
    const r = document.getElementById('app')!.getBoundingClientRect();
    return {
      rotated: document.documentElement.classList.contains('rotated'),
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      gw: document.documentElement.style.getPropertyValue('--gw'),
      gh: document.documentElement.style.getPropertyValue('--gh'),
    };
  });
  check('the game turned', geom.rotated);
  check(
    'the turned game covers the portrait screen exactly',
    Math.abs(geom.w - size.width) <= 1 &&
      Math.abs(geom.h - size.height) <= 1 &&
      Math.abs(geom.x) <= 1 &&
      Math.abs(geom.y) <= 1,
    `box ${geom.x},${geom.y} ${geom.w}x${geom.h} vs screen ${size.width}x${size.height}`,
  );
  check(
    'the game box knows it is landscape',
    parseFloat(geom.gw) > parseFloat(geom.gh),
    `--gw ${geom.gw}, --gh ${geom.gh}`,
  );

  await auditTouchPad(page);
  await shot(page, '27-phone-webkit-rotated');
}

// ----------------------------------------------------------------------- main

async function main(): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true });

  const browser = await webkit.launch();
  const errors: string[] = [];

  const open = async (viewport: { width: number; height: number }): Promise<[BrowserContext, Page]> => {
    const context = await browser.newContext({ ...IPHONE, viewport });
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(
      () => !!(window as unknown as { mbd?: unknown }).mbd,
      undefined,
      { timeout: 20000 },
    );
    await page.waitForTimeout(1200);
    return [context, page];
  };

  console.log(`\nMr. Baseball Dynasty — phone audit in WebKit against ${BASE}`);
  console.log(`iPhone profile: ${IPHONE.viewport.width}x${IPHONE.viewport.height} @${IPHONE.deviceScaleFactor}x, touch=${IPHONE.hasTouch}\n`);

  // ---- portrait: the way a phone is picked up
  let [context, page] = await open(IPHONE.viewport);
  await firstTouch(page);
  await auditChrome(page);
  await auditViewport(page);
  // The menu, on a phone held upright, which is how it is actually met. The
  // first touch above already dismissed the title card, which is what a real
  // first touch does.
  await auditMenus(page);
  await shot(page, '28-phone-webkit-menu');

  await startGame(page, {
    awayTeamId: 'coralkey',
    homeTeamId: 'ironport',
    stadiumId: 'anchor-yard',
    innings: 3,
    difficulty: 'rookie',
    awayControl: 'human1',
    homeControl: 'cpu',
    night: false,
    seed: 20260802,
  });
  await page.waitForTimeout(900);
  await auditRotation(page);
  await auditAim(page);
  await auditZoneReach(page);
  await auditSwing(page);
  await context.close();

  // ---- landscape: the way it is meant to be held
  console.log('\n=== the same phone, turned sideways ===');
  [context, page] = await open(LANDSCAPE);
  await firstTouch(page);
  await auditChrome(page);
  await auditViewport(page);
  await startGame(page, {
    awayTeamId: 'coralkey',
    homeTeamId: 'ironport',
    stadiumId: 'anchor-yard',
    innings: 3,
    difficulty: 'rookie',
    awayControl: 'human1',
    homeControl: 'cpu',
    night: false,
    seed: 20260802,
  });
  await page.waitForTimeout(900);
  await auditTouchPad(page);
  await auditAim(page);
  await auditZoneReach(page);
  await auditSwing(page);
  await auditGapPicture(page);
  await shot(page, '29-phone-webkit-landscape');
  await context.close();

  await browser.close();

  console.log('\n=== console ===');
  check('WebKit reported no errors', errors.length === 0, errors.slice(0, 6).join(' | '));

  console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`}`);
  for (const f of failures) console.log(`  - ${f}`);
  if (notes.length) {
    console.log('\nfor the record:');
    for (const n of notes) console.log(`  - ${n}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
