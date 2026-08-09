import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { fenceAt } from '../data/stadiums';
import { getStadium } from '../data/stadiums';
import { getBallparkPresentation } from '../render/ballpark-presentations';
import { buildStadium, stadiumWallProfile } from '../render/stadium';

describe('canonical visual and physics fence identity', () => {
  it('samples the visible wall from the same distance and height source as physics', () => {
    for (const stadiumId of ['anchor-yard', 'sandpit', 'grove-park']) {
      const stadium = getStadium(stadiumId);
      const samples = stadiumWallProfile(stadium, 360);
      expect(samples).toHaveLength(361);
      for (let index = 0; index < samples.length; index++) {
        const angle = -45 + (90 * index) / 360;
        const physicsFence = fenceAt(stadium, angle);
        const rendered = samples[index];
        expect(Math.hypot(rendered.x, rendered.z)).toBeCloseTo(physicsFence.dist, 10);
        expect(rendered.h).toBeCloseTo(physicsFence.height, 10);
      }
    }
  });
});

describe('promoted renderer-only presentation', () => {
  it('renders the authored showcase while a legacy park uses procedural fallbacks', () => {
    const showcase = getStadium('anchor-yard');
    const legacy = getStadium('sandpit');
    expect(getBallparkPresentation(showcase.id)).toBeDefined();
    expect(getBallparkPresentation(legacy.id)).toBeUndefined();

    const authoredBuild = buildStadium(showcase, true);
    const legacyBuild = buildStadium(legacy, true);
    try {
      expect(authoredBuild.presentationApplied).toBe(true);
      expect(authoredBuild.root.getObjectByName('mbd-batter-eye')).toBeInstanceOf(THREE.Group);
      const board = authoredBuild.root.getObjectByName('mbd-scoreboard');
      expect(board?.position.x).not.toBe(0);
      expect(legacyBuild.presentationApplied).toBe(false);
      expect(legacyBuild.root.getObjectByName('mbd-batter-eye')).toBeUndefined();
      expect(legacyBuild.root.getObjectByName('mbd-scoreboard')?.position.x).toBe(0);
    } finally {
      authoredBuild.dispose();
      legacyBuild.dispose();
    }
  });

  it('disposes every geometry and material introduced by an authored park', () => {
    const build = buildStadium(getStadium('anchor-yard'), true);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    build.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (Array.isArray(mesh.material)) mesh.material.forEach((material) => materials.add(material));
      else if (mesh.material) materials.add(mesh.material);
    });
    let disposedGeometries = 0;
    let disposedMaterials = 0;
    geometries.forEach((geometry) => geometry.addEventListener('dispose', () => disposedGeometries++));
    materials.forEach((material) => material.addEventListener('dispose', () => disposedMaterials++));
    build.dispose();
    expect(disposedGeometries).toBeGreaterThanOrEqual(geometries.size);
    expect(disposedMaterials).toBeGreaterThanOrEqual(materials.size);
  });
});
