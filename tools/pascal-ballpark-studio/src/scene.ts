import type { AnyNode, AnyNodeId } from '@pascal-app/core';
import { clearSceneHistory, useScene } from '@pascal-app/core';
import {
  BALLPARK_COORDINATE_SYSTEM,
  BALLPARK_SCHEMA,
  BALLPARK_UNITS,
  BALLPARK_VERSION,
  hashBallparkAsset,
  type MbdBallparkAssetV1,
  validateBallparkAsset,
} from '../../../src/ballpark/contract';
import {
  MbdBallparkRoot,
  MbdBatterEye,
  MbdFenceProfile,
  MbdFieldReference,
  MbdLightTower,
  MbdScoreboard,
  MbdStandProfile,
  type MbdSemanticNode,
} from './plugin/nodes';

export interface StudioScene {
  nodes: Record<string, MbdSemanticNode>;
  rootId: string;
}

function nodeId(prefix: string, stadiumId: string, suffix?: string | number): string {
  return `${prefix}_${stadiumId}${suffix === undefined ? '' : `-${suffix}`}`;
}

export function assetToStudioScene(asset: MbdBallparkAssetV1): StudioScene {
  const validation = validateBallparkAsset(asset);
  if (!validation.ok) throw new Error(validation.errors.map((error) => `${error.path}: ${error.message}`).join('\n'));
  const source = validation.asset;
  const rootId = nodeId('mbd-ballpark', source.stadium.id);
  const root = MbdBallparkRoot.parse({
    id: rootId,
    parentId: null,
    name: source.stadium.name,
    stadiumId: source.stadium.id,
    stadiumName: source.stadium.name,
    city: source.stadium.city,
    blurb: source.stadium.blurb,
    carry: source.stadium.carry,
    windX: source.stadium.windMps.x,
    windZ: source.stadium.windMps.z,
    domed: source.stadium.domed,
    turf: source.stadium.turf,
    ...source.stadium.palette,
    skyline: source.stadium.skyline,
    author: source.authoring?.author ?? 'MBD Ballpark Studio',
    notes: source.authoring?.notes ?? '',
    importedHash: hashBallparkAsset(source),
  });
  const field = MbdFieldReference.parse({
    id: nodeId('mbd-field', source.stadium.id),
    parentId: rootId,
    name: 'Regulation field reference (locked)',
    metadata: { isTransient: true, locked: true, exported: false },
  });
  const fence = MbdFenceProfile.parse({
    id: nodeId('mbd-fence', source.stadium.id),
    parentId: rootId,
    name: 'Canonical gameplay fence',
    anchors: source.stadium.fence,
  });
  const stands = MbdStandProfile.parse({
    id: nodeId('mbd-stands', source.stadium.id),
    parentId: rootId,
    name: 'Stand profile',
    enabled: source.presentation?.stands !== undefined,
    ...(source.presentation?.stands ?? {}),
  });
  const batterEye = MbdBatterEye.parse({
    id: nodeId('mbd-batter-eye', source.stadium.id),
    parentId: rootId,
    name: "Batter's eye",
    enabled: source.presentation?.batterEye !== undefined,
    ...(source.presentation?.batterEye ?? {}),
  });
  const scoreboard = MbdScoreboard.parse({
    id: nodeId('mbd-scoreboard', source.stadium.id),
    parentId: rootId,
    name: 'Scoreboard',
    enabled: source.presentation?.scoreboard !== undefined,
    ...(source.presentation?.scoreboard ?? {}),
  });
  const towerSources = source.presentation?.lightTowers ?? [
    { angleDeg: -44, distanceBeyondFenceM: 26, heightM: 34 },
    { angleDeg: -20, distanceBeyondFenceM: 26, heightM: 34 },
    { angleDeg: 20, distanceBeyondFenceM: 26, heightM: 34 },
    { angleDeg: 44, distanceBeyondFenceM: 26, heightM: 34 },
  ];
  const towers = towerSources.map((tower, index) => MbdLightTower.parse({
    id: nodeId('mbd-light', source.stadium.id, index),
    parentId: rootId,
    name: `Light tower ${index + 1}`,
    enabled: source.presentation?.lightTowers !== undefined,
    ...tower,
  }));
  const nodes = [root, field, fence, stands, batterEye, scoreboard, ...towers];
  return { nodes: Object.fromEntries(nodes.map((node) => [node.id, node])), rootId };
}

function onlyNode<T extends MbdSemanticNode['type']>(scene: StudioScene, type: T): Extract<MbdSemanticNode, { type: T }> {
  const found = Object.values(scene.nodes).find((node) => node.type === type);
  if (!found) throw new Error(`Studio scene is missing required semantic node '${type}'.`);
  return found as Extract<MbdSemanticNode, { type: T }>;
}

export function studioSceneToAsset(
  scene: StudioScene,
  options: { exportedAt?: string } = {},
): MbdBallparkAssetV1 {
  const root = onlyNode(scene, 'mbd:ballpark-root');
  const fence = onlyNode(scene, 'mbd:fence-profile');
  const stands = onlyNode(scene, 'mbd:stand-profile');
  const batterEye = onlyNode(scene, 'mbd:batter-eye');
  const scoreboard = onlyNode(scene, 'mbd:scoreboard');
  const towers = Object.values(scene.nodes)
    .filter((node): node is MbdLightTower => node.type === 'mbd:light-tower' && node.enabled)
    .sort((left, right) => left.angleDeg - right.angleDeg);

  const hasPresentation = stands.enabled || batterEye.enabled || scoreboard.enabled || towers.length > 0;
  const candidate: MbdBallparkAssetV1 = {
    schema: BALLPARK_SCHEMA,
    version: BALLPARK_VERSION,
    units: BALLPARK_UNITS,
    coordinateSystem: { ...BALLPARK_COORDINATE_SYSTEM },
    stadium: {
      id: root.stadiumId,
      name: root.stadiumName,
      city: root.city,
      blurb: root.blurb,
      fence: fence.anchors.map((anchor) => ({ ...anchor })),
      carry: root.carry,
      windMps: { x: root.windX, z: root.windZ },
      domed: root.domed,
      turf: root.turf,
      palette: {
        grass: root.grass,
        grassAlt: root.grassAlt,
        dirt: root.dirt,
        wall: root.wall,
        wallTrim: root.wallTrim,
        stands: root.stands,
        sky: root.sky,
        skyNight: root.skyNight,
        structure: root.structure,
      },
      skyline: root.skyline,
    },
    ...(hasPresentation
      ? {
          presentation: {
            ...(stands.enabled
              ? { stands: { depthScale: stands.depthScale, heightScale: stands.heightScale, tiers: stands.tiers } }
              : {}),
            ...(batterEye.enabled
              ? {
                  batterEye: {
                    startAngleDeg: batterEye.startAngleDeg,
                    endAngleDeg: batterEye.endAngleDeg,
                    heightM: batterEye.heightM,
                    depthM: batterEye.depthM,
                  },
                }
              : {}),
            ...(scoreboard.enabled
              ? {
                  scoreboard: {
                    angleDeg: scoreboard.angleDeg,
                    distanceBeyondFenceM: scoreboard.distanceBeyondFenceM,
                    widthM: scoreboard.widthM,
                    heightM: scoreboard.heightM,
                    elevationM: scoreboard.elevationM,
                  },
                }
              : {}),
            ...(towers.length > 0
              ? {
                  lightTowers: towers.map((tower) => ({
                    angleDeg: tower.angleDeg,
                    distanceBeyondFenceM: tower.distanceBeyondFenceM,
                    heightM: tower.heightM,
                  })),
                }
              : {}),
          },
        }
      : {}),
    authoring: {
      ...(root.author ? { author: root.author } : {}),
      ...(root.notes ? { notes: root.notes } : {}),
      pascalSceneVersion: '0.9.2',
      ...(options.exportedAt ? { exportedAt: options.exportedAt } : {}),
    },
  };
  const validation = validateBallparkAsset(candidate);
  if (!validation.ok) throw new Error(validation.errors.map((error) => `${error.path}: ${error.message}`).join('\n'));
  return validation.asset;
}

export function currentStudioScene(): StudioScene {
  const nodes = useScene.getState().nodes as unknown as Record<string, MbdSemanticNode>;
  const root = Object.values(nodes).find((node) => node.type === 'mbd:ballpark-root');
  if (!root) throw new Error('No MbdBallparkRoot is loaded.');
  return { nodes, rootId: root.id };
}

export function loadAssetIntoStudio(asset: MbdBallparkAssetV1): StudioScene {
  const scene = assetToStudioScene(asset);
  useScene.getState().setScene(
    scene.nodes as unknown as Record<AnyNodeId, AnyNode>,
    [scene.rootId as AnyNodeId],
    { installedPlugins: ['mbd:ballpark-studio'], hasExplicitPluginInstallState: true },
  );
  clearSceneHistory();
  return scene;
}

export interface GameplayDifference {
  field: string;
  summary: string;
}

export function gameplayDifferences(original: MbdBallparkAssetV1, current: MbdBallparkAssetV1): GameplayDifference[] {
  const differences: GameplayDifference[] = [];
  const compare = (field: string, left: unknown, right: unknown, summary: string) => {
    if (JSON.stringify(left) !== JSON.stringify(right)) differences.push({ field, summary });
  };
  compare('stadium.fence', original.stadium.fence, current.stadium.fence, 'Fence distance or wall height changed.');
  compare('stadium.carry', original.stadium.carry, current.stadium.carry, 'Carry changed.');
  compare('stadium.windMps', original.stadium.windMps, current.stadium.windMps, 'Wind changed.');
  compare('stadium.domed', original.stadium.domed, current.stadium.domed, 'Dome setting changed.');
  compare('stadium.turf', original.stadium.turf, current.stadium.turf, 'Playing surface changed.');
  return differences;
}
