import * as THREE from 'three';

export type RenderProfile = 'performance' | 'balanced' | 'high';

export interface RenderPipeline {
  render(dt: number): void;
  resize(width: number, height: number, pixelRatio: number): void;
  setProfile(profile: RenderProfile): void;
  setReplayPresentation(active: boolean): void;
  dispose(): void;
}

/**
 * Shipping render pipeline. The pmndrs/postprocessing experiment proved that
 * an intermediate target removed the renderer's edge antialiasing and missed
 * the median frame budgets, so every production profile deliberately preserves
 * the crisp direct path. The adapter remains so a future candidate can be
 * benchmarked without touching simulation or world presentation code.
 */
export class NativeRenderPipeline implements RenderPipeline {
  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {}

  render(_dt: number): void {
    this.renderer.render(this.scene, this.camera);
  }

  resize(_width: number, _height: number, _pixelRatio: number): void {}
  setProfile(_profile: RenderProfile): void {}
  setReplayPresentation(_active: boolean): void {}
  dispose(): void {}
}
