/**
 * ICON RASTERISER —  npx tsx scripts/icons.ts
 *
 * The icons are authored as SVG because that is the honest format for flat
 * shapes, and for a long time this project shipped nothing else. That was a
 * quiet bug on the platform it matters most on: **iOS ignores an SVG
 * `apple-touch-icon` entirely**. Add to Home Screen with no PNG to fall back on
 * does not fail loudly — it puts a thumbnail of the *page* on the home screen,
 * so the game gets a grey rectangle of its own loading card and looks broken
 * before it has run once. Android's install dialog is likewise happier with a
 * raster.
 *
 * So the SVGs stay the source of truth and the PNGs are generated from them,
 * here, by a real browser — the same renderer that will draw them. Rerun this
 * after editing either SVG and commit the output; a hundred lines of hand-rolled
 * PNG encoder to avoid checking in four small files would be the wrong trade.
 *
 * Three shapes, because three launchers want different things:
 *
 *   apple-touch-icon  square corners, opaque. iOS applies its own rounding, and
 *                     an icon that arrives pre-rounded gets rounded twice, with
 *                     the page colour showing through the gap.
 *   icon-N            the app icon as drawn, corners and all, for anything that
 *                     places it as-is.
 *   icon-maskable-N   art inside the middle 80%, for the launchers that crop.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC = 'public';

interface Target {
  out: string;
  src: string;
  size: number;
  /** Remove the corner radius — for the platforms that add their own. */
  squareCorners?: boolean;
}

const TARGETS: Target[] = [
  { out: 'apple-touch-icon.png', src: 'icon.svg', size: 180, squareCorners: true },
  { out: 'icon-192.png', src: 'icon.svg', size: 192 },
  { out: 'icon-512.png', src: 'icon.svg', size: 512 },
  { out: 'icon-maskable-512.png', src: 'icon-maskable.svg', size: 512 },
];

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });

  for (const t of TARGETS) {
    let svg = readFileSync(join(PUBLIC, t.src), 'utf8');
    if (t.squareCorners) {
      // One source of truth, one documented transform. The alternative is a
      // third SVG that has to be kept in step with the first by hand.
      svg = svg.replace(/\srx="\d+"/, '');
    }
    await page.setViewportSize({ width: t.size, height: t.size });
    await page.setContent(
      `<!doctype html><style>
         html,body{margin:0;padding:0;background:#0b1020}
         svg{display:block;width:${t.size}px;height:${t.size}px}
       </style>${svg}`,
      { waitUntil: 'load' },
    );
    const png = await page.screenshot({ omitBackground: false });
    writeFileSync(join(PUBLIC, t.out), png);
    console.log(`  wrote ${t.out} (${t.size}x${t.size}, ${png.length} bytes) from ${t.src}`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
