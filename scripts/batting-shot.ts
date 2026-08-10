/** Deterministic phase gallery for the real procedural batter and renderer. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { BATTING_PHASES } from '../src/render/batting';

const BASE = process.env.SHOT_URL ?? 'http://localhost:4178';
const OUT = process.env.SHOT_DIR ?? 'docs/screenshots/batting';
const FILTER = new Set((process.env.SHOT_FILTER ?? '').split(',').filter(Boolean));
const W = 1000;
const H = 800;

type Camera = { eye: [number, number, number]; look: [number, number, number]; fov: number };

function writeShot(name: string, png: string): void {
  if (FILTER.size && !FILTER.has(name)) return;
  const file = `${OUT}/${name}.png`;
  writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
  console.log(`wrote ${file}`);
}

const cameras = (handed: number): Record<string, Camera> => ({
  rear: { eye: [0, 1.7, -3.0], look: [0, 1.18, 0.28], fov: 29 },
  open: { eye: [-handed * 2.65, 1.55, 1.35], look: [0, 1.15, 0.22], fov: 31 },
  hands: { eye: [-handed * 1.6, 1.55, -0.25], look: [0, 1.28, 0.32], fov: 18 },
});

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!(window as unknown as { mbd?: unknown }).mbd, undefined, {
    timeout: 30_000,
  });
  await page.evaluate(() => {
    (window as unknown as { mbd: { startGame: (setup: unknown) => void } }).mbd.startGame({
      awayTeamId: 'bos',
      homeTeamId: 'nym',
      innings: 9,
      difficulty: 'pro',
      awayControl: 'cpu',
      homeControl: 'cpu',
      night: false,
      seed: 20260809,
      practice: 'batting',
    });
  });
  await page.waitForFunction(
    () => !!(window as unknown as { mbd: { world: { batter?: unknown } } }).mbd.world.batter,
    undefined,
    { timeout: 30_000 },
  );

  const phases = Object.entries(BATTING_PHASES);
  for (const handed of [-1, 1]) {
    const side = handed < 0 ? 'right' : 'left';
    for (const [name, phase] of phases) {
      for (const view of ['rear', 'open']) {
        const camera = cameras(handed)[view];
        const png = await page.evaluate(
          ({ phase, handed, camera }) => {
            const mbd = (window as unknown as {
              mbd: {
                world: {
                  batter: { actor: { update: (dt: number, options: unknown) => void; setVisible: (visible: boolean) => void } };
                  renderer: { render: (scene: unknown, camera: unknown) => void; domElement: HTMLCanvasElement };
                  scene: unknown;
                  director: {
                    camera: {
                      position: { set: (x: number, y: number, z: number) => void };
                      lookAt: (x: number, y: number, z: number) => void;
                      fov: number;
                      updateProjectionMatrix: () => void;
                    };
                  };
                };
              };
            }).mbd;
            const actor = mbd.world.batter.actor;
            actor.setVisible(true);
            actor.update(0, {
              x: 0,
              z: 0,
              speed: 0,
              facing: 0,
              pose: phase === 0 ? 'batStance' : 'batSwing',
              poseT: phase,
              handed,
            });
            const c = mbd.world.director.camera;
            c.position.set(...camera.eye);
            c.lookAt(...camera.look);
            c.fov = camera.fov;
            c.updateProjectionMatrix();
            mbd.world.renderer.render(mbd.world.scene, c);
            return mbd.world.renderer.domElement.toDataURL('image/png');
          },
          { phase, handed, camera },
        );
        writeShot(`${side}-${name}-${view}`, png);
      }
      if (name === 'stance' || name === 'contact' || name === 'finish') {
        const camera = cameras(handed).hands;
        const png = await page.evaluate(
          ({ phase, handed, camera }) => {
            const mbd = (window as unknown as { mbd: any }).mbd;
            const actor = mbd.world.batter.actor;
            actor.update(0, { x: 0, z: 0, speed: 0, facing: 0, pose: phase === 0 ? 'batStance' : 'batSwing', poseT: phase, handed });
            const d = actor.readBattingDiagnostics();
            const focus = {
              x: (d.handAnchorLeft.x + d.handAnchorRight.x) / 2,
              y: (d.handAnchorLeft.y + d.handAnchorRight.y) / 2,
              z: (d.handAnchorLeft.z + d.handAnchorRight.z) / 2,
            };
            const c = mbd.world.director.camera;
            c.position.set(focus.x - handed * .68, focus.y + .22, focus.z - .82);
            c.lookAt(focus.x, focus.y, focus.z);
            c.fov = camera.fov;
            c.updateProjectionMatrix();
            mbd.world.renderer.render(mbd.world.scene, c);
            return mbd.world.renderer.domElement.toDataURL('image/png');
          },
          { phase, handed, camera },
        );
        writeShot(`${side}-${name}-hands`, png);
      }
    }
  }

  await browser.close();
  if (errors.length) throw new Error(errors.join('\n'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
