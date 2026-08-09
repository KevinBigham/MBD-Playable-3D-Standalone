import * as THREE from 'three';
import {
  configureMBDCatcherMaskRenderer,
  createMBDCatcherMaskLookDevLights,
  frameMBDCatcherMaskCamera,
} from './createCatcherMaskPrototype';
import { createCatcherMaskNativePrototype } from './createCatcherMaskNativePrototype';

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const captureMode = new URLSearchParams(location.search).get('capture');
if (captureMode) document.body.classList.add('capture');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
configureMBDCatcherMaskRenderer(renderer);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(captureMode ? 0xd2d2d3 : 0x161d25, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 20);
const model = createCatcherMaskNativePrototype();
scene.add(model, createMBDCatcherMaskLookDevLights('neutral'));

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(1.8, 64),
  new THREE.MeshStandardMaterial({ color: 0x252d36, roughness: 0.92, metalness: 0 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.55;
ground.receiveShadow = true;
ground.visible = !captureMode;
scene.add(ground);

const runtime = model.userData.sculptRuntime as { meshes: Record<string, THREE.Mesh> };
if (captureMode === 'mask') {
  for (const mesh of Object.values(runtime.meshes)) {
    mesh.material = new THREE.MeshBasicMaterial({ color: 0x050505 });
  }
}
const triangles = Object.values(runtime.meshes).reduce((total, mesh) => {
  const geometry = mesh.geometry;
  return total + (geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3);
}, 0);
document.querySelector('#metrics')!.textContent = `${Object.keys(runtime.meshes).length} semantic meshes · ${Math.round(triangles)} triangles · source PBR evidence 0.86`;

let viewAzimuth = captureMode ? 0 : 22;
let viewElevation = captureMode ? 0 : 4;
let lastWidth = 0;
let lastHeight = 0;

function frameReviewCamera(): void {
  camera.clearViewOffset();
  frameMBDCatcherMaskCamera(camera, model, { margin: captureMode ? 1.22 : 1.3, azimuthDeg: viewAzimuth, elevationDeg: viewElevation });
  if (captureMode) camera.setViewOffset(512, 512, 24, 27, 512, 512);
}

function resize(): void {
  const { clientWidth, clientHeight } = canvas;
  if (clientWidth === lastWidth && clientHeight === lastHeight) return;
  lastWidth = clientWidth;
  lastHeight = clientHeight;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / Math.max(1, clientHeight);
  camera.updateProjectionMatrix();
  frameReviewCamera();
}

function render(): void {
  resize();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

render();

Object.assign(window, {
  equipmentForge: {
    ready: true,
    triangles: Math.round(triangles),
    meshes: Object.keys(runtime.meshes),
    setView(azimuthDeg: number, elevationDeg = 4) {
      viewAzimuth = azimuthDeg;
      viewElevation = elevationDeg;
      frameReviewCamera();
      renderer.render(scene, camera);
    },
  },
});
