/**
 * Deterministic pitching release gallery for the production actor and scene.
 *
 * Run after building and starting a local preview, for example:
 *   npx vite preview --port 4178 & npx tsx scripts/pitching-shot.ts
 *
 * This deliberately borrows the live scene instead of driving UI controls. A
 * release pose is presentation-only and it is much less brittle to wait for the
 * public game/world surface than to depend on a menu label or a particular CPU
 * at-bat. The JSON receipt records the world-space release socket actually used
 * to frame each image.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { MOUND_Z, PITCH_RELEASE_X, RELEASE_Y, RELEASE_Z } from '../src/core/constants';
import { PITCH_RELEASE_FRAME, PITCH_THROW_DURATION } from '../src/render/pitching';

const BASE = process.env.SHOT_URL ?? 'http://localhost:4178';
const OUT = process.env.SHOT_DIR ?? 'docs/screenshots/pitching';
const FILTER = new Set((process.env.SHOT_FILTER ?? '').split(',').filter(Boolean));
const W = 1000;
const H = 800;

type Vec = { x: number; y: number; z: number };
type Receipt = {
  name: string;
  arm: 'right' | 'left';
  phase: number;
  releaseSocket: Vec;
  releaseTarget: Vec;
  alignmentError: number;
};

function writeShot(name: string, png: string): void {
  if (FILTER.size && !FILTER.has(name)) return;
  const file = `${OUT}/${name}.png`;
  writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
  console.log(`wrote ${file}`);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!(window as unknown as { mbd?: unknown }).mbd, undefined, { timeout: 30_000 });
  await page.evaluate(() => {
    (window as unknown as { mbd: { startGame: (setup: unknown) => void } }).mbd.startGame({
      awayTeamId: 'bos', homeTeamId: 'nym', innings: 9, difficulty: 'pro',
      awayControl: 'cpu', homeControl: 'cpu', night: false, seed: 20260810,
    });
  });
  await page.waitForFunction(() => {
    const mbd = (window as unknown as { mbd: { game?: { fielders: unknown[] }; world?: unknown } }).mbd;
    return (mbd.game?.fielders.length ?? 0) === 9 && !!mbd.world;
  }, undefined, { timeout: 30_000 });

  const receipts: Receipt[] = [];
  for (const armSign of [-1, 1]) {
    const arm: Receipt['arm'] = armSign < 0 ? 'right' : 'left';
    for (const [label, phase] of [
      ['set', 0],
      ['release', PITCH_RELEASE_FRAME],
      ['finish', 1],
    ] as const) {
      const result = await page.evaluate(({
        armSign,
        label,
        moundZ,
        releaseX,
        releaseY,
        releaseZ,
        throwDuration,
      }) => {
        type V = { x: number; y: number; z: number };
        const mbd = (window as unknown as {
          mbd: {
            world: {
              fielders: Array<{ actor: {
                group: { position: V };
                setVisible: (visible: boolean) => void;
                update: (dt: number, options: unknown) => void;
                readPitchReleaseSocket: (sign: number, out: V) => V;
              } }>;
              ball: {
                update: (dt: number, x: number, y: number, z: number, speed: number, visible: boolean) => void;
                clearTrail: () => void;
                setScale: (scale: number) => void;
              };
              renderer: { render: (scene: unknown, camera: unknown) => void; domElement: HTMLCanvasElement };
              scene: unknown;
              director: { camera: {
                position: { set: (x: number, y: number, z: number) => void; clone: () => V };
                lookAt: (x: number, y: number, z: number) => void;
                fov: number; updateProjectionMatrix: () => void;
              } };
            };
          };
        }).mbd;
        const world = mbd.world;
        const pitcher = world.fielders[0].actor;
        pitcher.setVisible(true);
        const releaseTarget = { x: armSign * releaseX, y: releaseY, z: releaseZ };
        const base = { x: 0, z: moundZ, speed: 0, facing: Math.PI, armSign, releaseTarget };
        pitcher.update(1, { ...base, pose: 'pitchSet', poseT: 0 });
        if (label !== 'set') {
          for (let frame = 1; frame <= 25; frame++) {
            pitcher.update(1 / 60, { ...base, pose: 'pitchSet', poseT: frame / 25 });
          }
          const frames = label === 'release' ? 0 : Math.ceil(throwDuration * 60);
          for (let frame = 0; frame <= frames; frame++) {
            pitcher.update(1 / 60, {
              ...base,
              pose: 'pitchThrow',
              poseT: label === 'release' ? 0 : Math.min(1, frame / (throwDuration * 60)),
            });
          }
        }
        const release = pitcher.readPitchReleaseSocket(armSign, world.director.camera.position.clone());
        // Receipt-only ball placement uses the simulation's immutable release
        // coordinates. Any handoff error therefore remains visible instead of
        // moving the proof ball to wherever the sampled hand happens to be.
        world.ball.clearTrail();
        world.ball.setScale(1);
        world.ball.update(
          0,
          releaseTarget.x,
          releaseTarget.y,
          releaseTarget.z,
          0,
          label === 'release',
        );
        // Frame the entire delivery rather than only the hand. The first receipt
        // camera was close enough to hide the stride and made a correct mirrored
        // release look like the ball was inside the glove.
        const side = armSign * 3.6;
        const camera = world.director.camera;
        camera.position.set(side, 2.7, moundZ - 4.4);
        camera.lookAt(0, 1.05, moundZ - 0.65);
        camera.fov = 32;
        camera.updateProjectionMatrix();
        world.renderer.render(world.scene, camera);
        return {
          png: world.renderer.domElement.toDataURL('image/png'),
          releaseSocket: { x: release.x, y: release.y, z: release.z },
          releaseTarget,
          alignmentError: Math.hypot(
            release.x - releaseTarget.x,
            release.y - releaseTarget.y,
            release.z - releaseTarget.z,
          ),
        };
      }, {
        armSign,
        label,
        moundZ: MOUND_Z,
        releaseX: PITCH_RELEASE_X,
        releaseY: RELEASE_Y,
        releaseZ: RELEASE_Z,
        throwDuration: PITCH_THROW_DURATION,
      });
      const name = `${arm}-${label}`;
      writeShot(name, result.png);
      receipts.push({
        name,
        arm,
        phase,
        releaseSocket: result.releaseSocket,
        releaseTarget: result.releaseTarget,
        alignmentError: result.alignmentError,
      });
    }
  }

  writeFileSync(`${OUT}/receipt.json`, `${JSON.stringify({ source: BASE, releaseFrame: PITCH_RELEASE_FRAME, receipts }, null, 2)}\n`);
  await browser.close();
  if (errors.length) throw new Error(errors.join('\n'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
