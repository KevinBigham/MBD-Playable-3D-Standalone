import './style.css';
import * as THREE from 'three';
import studio from '@theatre/studio';
import { onChange, val } from '@theatre/core';
import homeRunNative from '../../../src/assets/broadcast/home-run-primary.json';
import fixture from '../fixtures/home-run.fixture.json';
import projectState from '../projects/home-run-primary.theatre.json';
import { parseBroadcastSequenceV1 } from '../../../src/replay/contract';
import { buildStadium } from '../../../src/render/stadium';
import { getStadium } from '../../../src/data/stadiums';
import { BallActor, PlayerActor } from '../../../src/render/actors';
import { createAuthoringProject, nativeFromAuthoring, PROJECT_ID } from './authoring';

const app = document.getElementById('app');
if (!app) throw new Error('missing studio root');
app.innerHTML = `
  <div class="shell">
    <aside class="panel">
      <h1>MBD BROADCAST STUDIO</h1>
      <p>Theatre is the design-time camera desk. Production consumes only validated MBD JSON.</p>
      <label>Preview aspect</label>
      <select class="aspect"><option value="desktop">DESKTOP 16:9</option><option value="phone">PHONE 734×320</option></select>
      <button class="play">PLAY / PAUSE</button>
      <button class="seed">LOAD SHIPPING HOME-RUN VALUES</button>
      <button class="native">DOWNLOAD NATIVE SEQUENCE</button>
      <button class="project">DOWNLOAD THEATRE PROJECT STATE</button>
      <div class="status">Studio booting…</div>
      <p class="license">@theatre/core 0.7.2 — Apache-2.0<br>@theatre/studio 0.7.2 — AGPL-3.0-only<br>Studio is never imported by the game runtime.</p>
    </aside>
    <main class="viewport"><canvas></canvas><div class="safe"></div></main>
  </div>`;

const canvas = app.querySelector('canvas') as HTMLCanvasElement;
const viewport = app.querySelector('.viewport') as HTMLElement;
const status = app.querySelector('.status') as HTMLElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setClearColor(0x87ceeb);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x52624b, 1.6));
const sun = new THREE.DirectionalLight(0xfff2d5, 1.2);
sun.position.set(-50, 80, -30);
scene.add(sun);
const stadium = buildStadium(getStadium('anchor-yard'), false);
scene.add(stadium.root);
const athlete = new PlayerActor({ jersey: 0x142c5a, trim: 0xffd15c, accent: 0xf0eee7, skin: 0xc68642 }, 'average', 'helmet', 27);
scene.add(athlete.group);
const fielder = new PlayerActor({ jersey: 0x7b1f2b, trim: 0xf5d06f, accent: 0xe6e8ed, skin: 0x8d5524 }, 'stocky', 'cap', 8);
scene.add(fielder.group);
const ball = new BallActor();
ball.addTo(scene);
const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.25, 900);

await studio.initialize({ persistenceKey: 'mbd-broadcast-studio-v1' });
const authoring = createAuthoringProject(projectState);
await authoring.project.ready;
studio.setSelection([authoring.sheet, authoring.shots[0]]);

function setObjectFromShot(index: number): void {
  const shot = parseBroadcastSequenceV1(homeRunNative).shots[index];
  const vec = (value: readonly number[]) => ({ x: value[0], y: value[1], z: value[2] });
  studio.transaction(({ set }) => set(authoring.shots[index].props, {
    start: shot.start,
    end: shot.end,
    anchor: shot.anchor,
    fallbackAnchor: shot.fallbackAnchor,
    eyeFrom: vec(shot.eyeFrom),
    eyeTo: vec(shot.eyeTo),
    lookFrom: vec(shot.lookFrom),
    lookTo: vec(shot.lookTo),
    fovFrom: shot.fovFrom,
    fovTo: shot.fovTo,
    ease: shot.ease,
    cut: shot.cut,
  }));
}

function seed(): void {
  setObjectFromShot(0);
  setObjectFromShot(1);
  status.textContent = 'Shipping camera values loaded into Theatre objects. Export project state, then run the CLI exporter.';
}

function download(name: string, value: unknown): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function sampleFixture(t: number): { ball: number[]; primary: number[]; pose: number } {
  const time = Math.max(0, Math.min(fixture.duration, t * fixture.duration));
  let i = 0;
  while (i + 1 < fixture.samples.length && fixture.samples[i + 1].t < time) i++;
  const a = fixture.samples[i];
  const b = fixture.samples[Math.min(fixture.samples.length - 1, i + 1)];
  const k = (time - a.t) / Math.max(0.001, b.t - a.t);
  const lerp = (axis: number) => a.ball[axis] + (b.ball[axis] - a.ball[axis]) * k;
  const actor = (axis: number) => a.primary[axis] + (b.primary[axis] - a.primary[axis]) * k;
  return { ball: [lerp(0), lerp(1), lerp(2)], primary: [actor(0), actor(1), actor(2)], pose: a.pose + (b.pose - a.pose) * k };
}

const anchor = new THREE.Vector3();
const eye = new THREE.Vector3();
const look = new THREE.Vector3();
function renderAt(position: number): void {
  let native;
  try {
    native = parseBroadcastSequenceV1(nativeFromAuthoring(authoring));
  } catch (error) {
    status.textContent = `INVALID — ${error instanceof Error ? error.message : String(error)}`;
    return;
  }
  const u = Math.max(0, Math.min(1, position));
  const fixtureFrame = sampleFixture(u);
  ball.update(0, fixtureFrame.ball[0], fixtureFrame.ball[1], fixtureFrame.ball[2], 30, true);
  athlete.update(0, { x: fixtureFrame.primary[0], z: fixtureFrame.primary[2], speed: 2, facing: 0.4, pose: 'run', poseT: fixtureFrame.pose });
  fielder.update(0, { x: 19, z: 92, speed: 0, facing: Math.PI, pose: 'fieldReady', poseT: 0 });
  const shot = native.shots.find((item) => u >= item.start && u <= item.end) ?? native.shots.at(-1)!;
  const local = Math.max(0, Math.min(1, (u - shot.start) / Math.max(0.001, shot.end - shot.start)));
  const smooth = shot.ease === 'linear' ? local : local * local * (3 - 2 * local);
  if (shot.anchor === 'ball') anchor.fromArray(fixtureFrame.ball);
  else if (shot.anchor === 'primary-actor') anchor.fromArray(fixtureFrame.primary);
  else anchor.set(0, 0, 0);
  const add = (target: THREE.Vector3, from: readonly number[], to: readonly number[]) => target.set(
    anchor.x + from[0] + (to[0] - from[0]) * smooth,
    anchor.y + from[1] + (to[1] - from[1]) * smooth,
    anchor.z + from[2] + (to[2] - from[2]) * smooth,
  );
  add(eye, shot.eyeFrom, shot.eyeTo);
  add(look, shot.lookFrom, shot.lookTo);
  camera.position.copy(eye);
  camera.fov = shot.fovFrom + (shot.fovTo - shot.fovFrom) * smooth;
  camera.updateProjectionMatrix();
  camera.lookAt(look);
  renderer.render(scene, camera);
}

for (const object of authoring.shots) object.onValuesChange(() => renderAt(authoring.sheet.sequence.position));
onChange(authoring.sheet.sequence.pointer.position, (position) => renderAt(position));

function resize(): void {
  const rect = viewport.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / Math.max(1, rect.height);
  camera.updateProjectionMatrix();
  renderAt(authoring.sheet.sequence.position);
}
new ResizeObserver(resize).observe(viewport);

app.querySelector('.aspect')?.addEventListener('change', (event) => {
  viewport.style.aspectRatio = (event.target as HTMLSelectElement).value === 'phone' ? '734 / 320' : '';
  resize();
});
app.querySelector('.play')?.addEventListener('click', () => {
  if (val(authoring.sheet.sequence.pointer.playing)) authoring.sheet.sequence.pause();
  else void authoring.sheet.sequence.play({ range: [0, 1] });
});
app.querySelector('.seed')?.addEventListener('click', seed);
app.querySelector('.native')?.addEventListener('click', () => {
  const native = parseBroadcastSequenceV1(nativeFromAuthoring(authoring));
  download('home-run-primary.json', native);
  status.textContent = 'Native sequence validated and downloaded. CLI promotion remains the shipping gate.';
});
app.querySelector('.project')?.addEventListener('click', () => {
  download('home-run-primary.theatre.json', studio.createContentOfSaveFile(PROJECT_ID));
  status.textContent = 'Theatre project state downloaded.';
});

authoring.sheet.sequence.position = 0.35;
resize();
status.textContent = `Loaded fixture ${fixture.id}. Theatre values drive the real Anchor Yard preview.`;

(window as unknown as { mbdStudio: unknown }).mbdStudio = {
  seed,
  exportNative: () => parseBroadcastSequenceV1(nativeFromAuthoring(authoring)),
  exportProject: () => studio.createContentOfSaveFile(PROJECT_ID),
};
