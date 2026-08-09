import * as THREE from 'three';
import {
  ApplyForce,
  BatchedRenderer,
  ColorRange,
  ConstantValue,
  IntervalValue,
  ParticleSystem,
  PointEmitter,
  RenderMode,
  Vector3 as QuarksVector3,
  Vector4 as QuarksVector4,
} from 'three.quarks';

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const readout = document.querySelector<HTMLPreElement>('#readout')!;
document.body.style.cssText = 'margin:0;overflow:hidden;background:#07131b;color:#dcefff;font:14px ui-monospace,monospace';
canvas.style.cssText = 'display:block;width:100vw;height:100vh';
readout.style.cssText = 'position:fixed;left:18px;top:14px;margin:0;padding:12px 14px;background:#07131bdd;border:1px solid #5ce1ff66;white-space:pre-wrap';

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x07131b);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 5.5, 13);
camera.lookAt(0, 1.3, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x345040, 2));
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 11),
  new THREE.MeshStandardMaterial({ color: 0x285d32, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const batched = new BatchedRenderer();
scene.add(batched);
const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, vertexColors: true });

function systemAt(x: number, colorA: number, colorB: number, count: number, size: [number, number]): ParticleSystem {
  const a = new THREE.Color(colorA);
  const b = new THREE.Color(colorB);
  const system = new ParticleSystem({
    duration: 2.4,
    looping: true,
    startLife: new IntervalValue(0.55, 1.15),
    startSpeed: new IntervalValue(2.8, 6.2),
    startSize: new IntervalValue(size[0], size[1]),
    startColor: new ColorRange(
      new QuarksVector4(a.r, a.g, a.b, 1),
      new QuarksVector4(b.r, b.g, b.b, 1),
    ),
    emissionOverTime: new ConstantValue(0),
    emissionBursts: [{ time: 0.12, count: new ConstantValue(count), cycle: 1, interval: 0, probability: 1 }],
    shape: new PointEmitter(),
    material,
    renderMode: RenderMode.BillBoard,
    behaviors: [new ApplyForce(new QuarksVector3(0, -1, 0), new ConstantValue(7.5))],
    worldSpace: true,
  });
  system.emitter.position.set(x, 0.15, 0);
  scene.add(system.emitter);
  batched.addSystem(system);
  return system;
}

const systems = [
  systemAt(-3.4, 0xc7955b, 0x7e4a28, 110, [0.08, 0.17]),
  systemAt(0, 0x4d8b3b, 0x9eb85c, 110, [0.06, 0.14]),
  systemAt(3.4, 0xffffff, 0xbec8cc, 110, [0.05, 0.12]),
];

const labels = ['DIRT SPRAY', 'TURF FRAGMENTS', 'CHALK / WALL'];
for (let i = 0; i < labels.length; i++) {
  const board = document.createElement('div');
  board.textContent = labels[i];
  board.style.cssText = `position:fixed;left:${22 + i * 33}%;bottom:7%;transform:translateX(-50%);letter-spacing:.16em;color:#fff`;
  document.body.appendChild(board);
}

const updateSamples: number[] = [];
const drawSamples: number[] = [];
let last = performance.now();
let frames = 0;
function resize(): void {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
resize();
addEventListener('resize', resize);

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  let mark = performance.now();
  batched.update(dt);
  updateSamples.push(performance.now() - mark);
  renderer.info.reset();
  mark = performance.now();
  renderer.render(scene, camera);
  drawSamples.push(performance.now() - mark);
  if (updateSamples.length > 600) updateSamples.shift();
  if (drawSamples.length > 600) drawSamples.shift();
  frames++;
  if (frames % 30 === 0) {
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    const metrics = {
      particles: systems.reduce((sum, system) => sum + system.particleNum, 0),
      intendedPeakParticles: systems.length * 110,
      batches: batched.batches.length,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      meanUpdateMs: mean(updateSamples),
      meanDrawSubmitMs: mean(drawSamples),
      three: THREE.REVISION,
      quarks: '0.17.1',
    };
    (window as any).vfxLab = metrics;
    readout.textContent = `three.quarks isolated prototype\n\nparticles  ${metrics.particles}/${metrics.intendedPeakParticles} intended peak\nbatches    ${metrics.batches}\ndraw calls ${metrics.drawCalls}\ntriangles  ${metrics.triangles}\nupdate     ${metrics.meanUpdateMs.toFixed(3)} ms\ndraw submit ${metrics.meanDrawSubmitMs.toFixed(3)} ms\n\nThree r${metrics.three} · quarks ${metrics.quarks}\nDevelopment-only: production stays on Three r169.`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
