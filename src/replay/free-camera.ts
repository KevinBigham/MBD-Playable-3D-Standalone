import * as THREE from 'three';
import CameraControls from 'camera-controls';

CameraControls.install({
  THREE: {
    Vector2: THREE.Vector2,
    Vector3: THREE.Vector3,
    Vector4: THREE.Vector4,
    Quaternion: THREE.Quaternion,
    Matrix4: THREE.Matrix4,
    Spherical: THREE.Spherical,
    Box3: THREE.Box3,
    Sphere: THREE.Sphere,
    Raycaster: THREE.Raycaster,
    MathUtils: THREE.MathUtils,
  },
});

export type ReplayCameraPreset = 'plate' | 'foul-line' | 'outfield' | 'overhead';

interface BvhApi {
  acceleratedRaycast: THREE.Mesh['raycast'];
  computeBoundsTree: (this: THREE.BufferGeometry, options?: { maxLeafTris?: number }) => unknown;
  disposeBoundsTree: (this: THREE.BufferGeometry) => void;
}

export function canUseReplayFreeCamera(replayActive: boolean, simulationFrozen: boolean): boolean {
  return replayActive && simulationFrozen;
}

/**
 * Presentation-only orbit camera. This entire module (including both external
 * libraries) is lazy-loaded after replay has frozen authoritative play.
 */
export class ReplayFreeCamera {
  private controls: CameraControls | null = null;
  private colliders: THREE.Mesh[] = [];
  private colliderMaterial: THREE.MeshBasicMaterial | null = null;
  private bvh: BvhApi | null = null;
  private readonly savedEye = new THREE.Vector3();
  private readonly savedTarget = new THREE.Vector3();
  private readonly target = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
  ) {}

  get active(): boolean {
    return this.controls !== null;
  }

  async enter(target: THREE.Vector3): Promise<void> {
    if (this.controls) return;
    // Vite deliberately never sees this package import. The self-contained
    // local module is fetched only after replay has frozen the simulation.
    const vendorUrl = new URL('./vendor/three-mesh-bvh-adapter.js', document.baseURI).href;
    this.bvh = await import(/* @vite-ignore */ vendorUrl) as BvhApi;
    this.target.copy(target);
    this.savedEye.copy(this.camera.position);
    this.camera.getWorldDirection(this.savedTarget).multiplyScalar(18).add(this.savedEye);
    const controls = new CameraControls(this.camera, this.canvas);
    controls.minDistance = 1.6;
    controls.maxDistance = 165;
    controls.minPolarAngle = 0.06;
    controls.maxPolarAngle = Math.PI * 0.515;
    controls.smoothTime = 0.16;
    controls.draggingSmoothTime = 0.08;
    controls.dollyToCursor = true;
    controls.truckSpeed = 1.25;
    controls.setBoundary(new THREE.Box3(
      new THREE.Vector3(-112, 0.15, -38),
      new THREE.Vector3(112, 72, 195),
    ));
    controls.boundaryEnclosesCamera = true;
    this.colliders = this.buildStaticCollisionProxies();
    controls.colliderMeshes = this.colliders;
    controls.setLookAt(
      this.savedEye.x, this.savedEye.y, this.savedEye.z,
      target.x, target.y, target.z,
      false,
    );
    this.controls = controls;
  }

  update(dt: number): void {
    this.controls?.update(Math.max(0, Math.min(0.05, dt)));
  }

  focus(point: THREE.Vector3): void {
    if (!this.controls) return;
    this.target.copy(point);
    void this.controls.setTarget(point.x, point.y, point.z, true);
  }

  preset(preset: ReplayCameraPreset, anchor: THREE.Vector3): void {
    if (!this.controls) return;
    this.target.copy(anchor);
    const eye = new THREE.Vector3();
    if (preset === 'plate') eye.set(0, 5.4, -15.5);
    else if (preset === 'foul-line') eye.set(34, 7.5, 18);
    else if (preset === 'outfield') eye.set(0, 15, 125);
    else eye.set(anchor.x, 70, anchor.z + 0.01);
    void this.controls.setLookAt(
      eye.x, eye.y, eye.z,
      anchor.x, Math.max(0.8, anchor.y), anchor.z,
      true,
    );
  }

  reset(): void {
    if (!this.controls) return;
    void this.controls.setLookAt(
      this.savedEye.x, this.savedEye.y, this.savedEye.z,
      this.savedTarget.x, this.savedTarget.y, this.savedTarget.z,
      true,
    );
  }

  dispose(): void {
    this.controls?.dispose();
    this.controls = null;
    for (const mesh of this.colliders) {
      this.bvh?.disposeBoundsTree.call(mesh.geometry);
      mesh.geometry.dispose();
    }
    this.colliders.length = 0;
    this.colliderMaterial?.dispose();
    this.colliderMaterial = null;
    this.bvh = null;
  }

  diagnostics(): { active: boolean; colliders: number; bvhTrees: number } {
    return {
      active: this.active,
      colliders: this.colliders.length,
      bvhTrees: this.colliders.filter((mesh) =>
        !!(mesh.geometry as THREE.BufferGeometry & { boundsTree?: unknown }).boundsTree,
      ).length,
    };
  }

  private buildStaticCollisionProxies(): THREE.Mesh[] {
    const bvh = this.bvh;
    if (!bvh) return [];
    const material = new THREE.MeshBasicMaterial({ visible: false });
    this.colliderMaterial = material;
    const definitions: Array<[number, number, number, number, number, number]> = [
      [0, -1.2, 72, 220, 2.5, 230],
      [-105, 18, 76, 4, 38, 220],
      [105, 18, 76, 4, 38, 220],
      [0, 20, 188, 215, 42, 4],
      [0, 12, -36, 100, 26, 3],
    ];
    return definitions.map(([x, y, z, w, h, d]) => {
      const geometry = new THREE.BoxGeometry(w, h, d);
      bvh.computeBoundsTree.call(geometry, { maxLeafTris: 4 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.updateMatrixWorld(true);
      mesh.raycast = bvh.acceleratedRaycast;
      return mesh;
    });
  }
}
