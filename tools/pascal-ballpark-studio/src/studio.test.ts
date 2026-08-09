import { describe, expect, it } from 'vitest';
import { BALLPARK_ASSETS } from '../../../src/ballpark/assets';
import { validateBallparkAsset } from '../../../src/ballpark/contract';
import { constrainFenceAnchor, deleteFenceAnchor, insertFenceAnchor } from './fence-edit';
import { MBD_BALLPARK_NODE_KINDS, mbdBallparkPlugin } from './plugin/definitions';
import { BALLPARK_PRESETS } from './presets';
import { assetToStudioScene, gameplayDifferences, studioSceneToAsset } from './scene';

describe('Pascal semantic ballpark plugin', () => {
  it('registers every required sports-specific node kind through Plugin API v1', () => {
    expect(mbdBallparkPlugin.apiVersion).toBe(1);
    expect(MBD_BALLPARK_NODE_KINDS).toEqual(expect.arrayContaining([
      'mbd:ballpark-root',
      'mbd:field-reference',
      'mbd:fence-profile',
      'mbd:batter-eye',
      'mbd:stand-profile',
      'mbd:scoreboard',
      'mbd:light-tower',
    ]));
  });

  it('imports and exports every promoted park through the shared strict adapter', () => {
    for (const asset of BALLPARK_ASSETS) {
      const scene = assetToStudioScene(asset);
      const field = Object.values(scene.nodes).find((node) => node.type === 'mbd:field-reference');
      expect(field?.metadata).toMatchObject({ isTransient: true, locked: true, exported: false });
      const exported = studioSceneToAsset(scene);
      expect(exported.stadium).toEqual(asset.stadium);
      expect(exported.presentation).toEqual(asset.presentation);
      expect(validateBallparkAsset(exported).ok).toBe(true);
    }
  });

  it('ships neutral, short-porch, deep-center, high-wall, and dome presets that all validate', () => {
    expect(Object.keys(BALLPARK_PRESETS)).toEqual(['neutral', 'short-porch', 'deep-center', 'high-wall', 'dome']);
    Object.values(BALLPARK_PRESETS).forEach((asset) => expect(validateBallparkAsset(asset).ok).toBe(true));
  });

  it('constrains handles, fixes endpoints, prevents crossing, and blocks deletion below minimum', () => {
    const anchors = [
      { angleDeg: -45, distanceM: 100, heightM: 3 },
      { angleDeg: 0, distanceM: 123, heightM: 3 },
      { angleDeg: 45, distanceM: 100, heightM: 3 },
    ];
    expect(constrainFenceAnchor(anchors, 0, [200, 100, 1])).toMatchObject({ angleDeg: -45, distanceM: 170, heightM: 30 });
    expect(constrainFenceAnchor(anchors, 1, [-200, -10, 1]).angleDeg).toBeGreaterThan(-45);
    expect(deleteFenceAnchor(anchors, 1)).toEqual(anchors);
    const inserted = insertFenceAnchor(anchors, 0);
    expect(inserted).toHaveLength(4);
    expect(deleteFenceAnchor(inserted, 1)).toHaveLength(3);
  });

  it('reports gameplay changes but ignores presentation-only edits', () => {
    const original = BALLPARK_ASSETS[1];
    const presented = structuredClone(original);
    presented.presentation = { stands: { depthScale: 1.5, heightScale: 1.2, tiers: 2 } };
    expect(gameplayDifferences(original, presented)).toEqual([]);
    presented.stadium.carry += 0.01;
    expect(gameplayDifferences(original, presented)).toEqual([{ field: 'stadium.carry', summary: 'Carry changed.' }]);
  });
});
