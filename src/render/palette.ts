import * as THREE from 'three';

/** Shared material/colour helpers so the whole game speaks one visual language. */

export const SKIN_TONES = [
  0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d, 0xffdbac, 0x6b4226, 0xa06840, 0x5c3317,
];

export function skinColor(t: number): number {
  const i = Math.min(SKIN_TONES.length - 1, Math.max(0, Math.floor(t * SKIN_TONES.length)));
  return SKIN_TONES[i];
}

export function shade(hex: number, amount: number): number {
  const c = new THREE.Color(hex);
  if (amount >= 0) c.lerp(new THREE.Color(0xffffff), amount);
  else c.lerp(new THREE.Color(0x000000), -amount);
  return c.getHex();
}

export function cssColor(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}

/**
 * Flat-shaded Lambert material. Flat shading is what gives the low-poly models
 * their faceted, chunky read; it also costs nothing.
 */
export function flatMat(color: number, opts: { flat?: boolean; emissive?: number } = {}): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    color,
    flatShading: opts.flat !== false,
    emissive: opts.emissive ?? 0x000000,
  });
}

export function basicMat(color: number, opts: { transparent?: boolean; opacity?: number } = {}): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
  });
}

/** Disposes a whole subtree's geometry and materials. */
export function disposeTree(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
  });
}
