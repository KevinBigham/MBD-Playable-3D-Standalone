import type { AnyNodeDefinition, NodeDefinition, Plugin } from '@pascal-app/core';
import {
  MbdBallparkRoot,
  MbdBatterEye,
  MbdFenceProfile,
  MbdFieldReference,
  MbdLightTower,
  MbdScoreboard,
  MbdStandProfile,
} from './nodes';

const semanticRenderer = () => import('./renderers');

const rootDefinition: NodeDefinition<typeof MbdBallparkRoot> = {
  kind: 'mbd:ballpark-root',
  schemaVersion: 1,
  schema: MbdBallparkRoot,
  category: 'site',
  defaults: () => ({
    object: 'node', parentId: null, visible: true, metadata: {},
    stadiumId: 'studio-park', stadiumName: 'Studio Park', city: 'Studio Lab', blurb: 'Authored in MBD Ballpark Studio.',
    carry: 1, windX: 0, windZ: 0, domed: false, turf: false,
    grass: 0x2f7a3a, grassAlt: 0x368942, dirt: 0x9a6b3f, wall: 0x1f4d4a,
    wallTrim: 0xf2c14e, stands: 0x24384f, sky: 0x8ec8f0, skyNight: 0x0d1730,
    structure: 0x5a6a78, skyline: 'towers', author: 'MBD Ballpark Studio', notes: '', importedHash: undefined,
  }),
  capabilities: { selectable: { hitVolume: 'bbox' }, deletable: false, presettable: false },
  dirtyTracking: false,
  renderer: { kind: 'parametric', module: semanticRenderer },
  parametrics: { groups: [], customPanel: () => import('./root-panel') },
  presentation: {
    label: 'MBD Ballpark',
    description: 'Native MBD identity, gameplay settings, palette, and skyline.',
    icon: { kind: 'iconify', name: 'lucide:landmark' },
    paletteSection: 'structure',
  },
  mcp: {
    semantic: true,
    description: 'MBD ballpark root. Carries canonical gameplay settings and renderer palette; children carry fence and presentation nodes.',
  },
};

const fieldDefinition: NodeDefinition<typeof MbdFieldReference> = {
  kind: 'mbd:field-reference',
  schemaVersion: 1,
  schema: MbdFieldReference,
  category: 'utility',
  defaults: () => ({ object: 'node', parentId: null, visible: true, metadata: { isTransient: true }, position: [0, 0, 0], locked: true }),
  capabilities: { deletable: false, presettable: false },
  dirtyTracking: false,
  renderer: { kind: 'parametric', module: semanticRenderer },
  presentation: {
    label: 'Regulation Field Reference',
    description: 'Locked, transient, and excluded from MBD asset export.',
    icon: { kind: 'iconify', name: 'lucide:diamond' },
    paletteSection: 'structure',
    hidden: true,
  },
  mcp: { semantic: true, description: 'Locked non-exported baseball field reference. Do not mutate.' },
};

const fenceDefinition: NodeDefinition<typeof MbdFenceProfile> = {
  kind: 'mbd:fence-profile',
  schemaVersion: 1,
  schema: MbdFenceProfile,
  category: 'structure',
  snapProfile: 'structural',
  defaults: () => ({
    object: 'node', parentId: null, visible: true, metadata: {},
    anchors: [
      { angleDeg: -45, distanceM: 100, heightM: 3 },
      { angleDeg: 0, distanceM: 123, heightM: 3 },
      { angleDeg: 45, distanceM: 100, heightM: 3 },
    ],
  }),
  capabilities: { selectable: { hitVolume: 'bbox' }, deletable: false, presettable: false },
  dirtyTracking: false,
  renderer: { kind: 'parametric', module: semanticRenderer },
  parametrics: { groups: [], customPanel: () => import('./fence-panel') },
  presentation: {
    label: 'Canonical Fence Profile',
    description: 'Strictly ordered polar angle, distance, and height anchors shared by visuals and physics.',
    icon: { kind: 'iconify', name: 'lucide:move-3d' },
    paletteSection: 'structure',
  },
  mcp: {
    semantic: true,
    description: 'Canonical MBD fence anchors in metres. End angles stay -45/+45 and interior angles may not cross.',
  },
};

const standDefinition: NodeDefinition<typeof MbdStandProfile> = {
  kind: 'mbd:stand-profile',
  schemaVersion: 1,
  schema: MbdStandProfile,
  category: 'structure',
  defaults: () => ({ object: 'node', parentId: null, visible: true, metadata: {}, enabled: false, depthScale: 1, heightScale: 1, tiers: 3 }),
  capabilities: { selectable: { hitVolume: 'bbox' }, deletable: false },
  dirtyTracking: false,
  renderer: { kind: 'parametric', module: semanticRenderer },
  parametrics: { groups: [{ label: 'Stand Profile', fields: [
    { key: 'enabled', kind: 'boolean' },
    { key: 'depthScale', kind: 'number', min: 0.5, max: 2, step: 0.05 },
    { key: 'heightScale', kind: 'number', min: 0.5, max: 2, step: 0.05 },
    { key: 'tiers', kind: 'number', min: 1, max: 3, step: 1 },
  ] }] },
  presentation: { label: 'Stand Profile', description: 'Renderer-only bounded seating bowl controls.', icon: { kind: 'iconify', name: 'lucide:rows-3' }, paletteSection: 'structure' },
  mcp: { semantic: true, description: 'Renderer-only MBD stand depth, height, and tier controls.' },
};

const batterEyeDefinition: NodeDefinition<typeof MbdBatterEye> = {
  kind: 'mbd:batter-eye',
  schemaVersion: 1,
  schema: MbdBatterEye,
  category: 'structure',
  defaults: () => ({ object: 'node', parentId: null, visible: true, metadata: {}, enabled: false, startAngleDeg: -8, endAngleDeg: 8, heightM: 10, depthM: 3 }),
  capabilities: { selectable: { hitVolume: 'bbox' }, deletable: false },
  dirtyTracking: false,
  renderer: { kind: 'parametric', module: semanticRenderer },
  parametrics: { groups: [{ label: "Batter's Eye", fields: [
    { key: 'enabled', kind: 'boolean' },
    { key: 'startAngleDeg', kind: 'number', unit: '°', min: -45, max: 45, step: 0.5 },
    { key: 'endAngleDeg', kind: 'number', unit: '°', min: -45, max: 45, step: 0.5 },
    { key: 'heightM', kind: 'number', unit: 'm', min: 0.5, max: 40, step: 0.25 },
    { key: 'depthM', kind: 'number', unit: 'm', min: 0.25, max: 30, step: 0.25 },
  ] }] },
  presentation: { label: "Batter's Eye", description: 'Renderer-only interval and dimensions beyond the fence.', icon: { kind: 'iconify', name: 'lucide:rectangle-horizontal' }, paletteSection: 'structure' },
  mcp: { semantic: true, description: "Renderer-only batter's eye placed by an ordered outfield angle interval." },
};

const scoreboardDefinition: NodeDefinition<typeof MbdScoreboard> = {
  kind: 'mbd:scoreboard',
  schemaVersion: 1,
  schema: MbdScoreboard,
  category: 'structure',
  defaults: () => ({ object: 'node', parentId: null, visible: true, metadata: {}, enabled: false, angleDeg: 0, distanceBeyondFenceM: 9, widthM: 26, heightM: 12, elevationM: 6 }),
  capabilities: { selectable: { hitVolume: 'bbox' }, deletable: false },
  dirtyTracking: false,
  renderer: { kind: 'parametric', module: semanticRenderer },
  parametrics: { groups: [{ label: 'Scoreboard', fields: [
    { key: 'enabled', kind: 'boolean' },
    { key: 'angleDeg', kind: 'number', unit: '°', min: -45, max: 45, step: 0.5 },
    { key: 'distanceBeyondFenceM', kind: 'number', unit: 'm', min: 0, max: 80, step: 0.5 },
    { key: 'widthM', kind: 'number', unit: 'm', min: 2, max: 80, step: 0.5 },
    { key: 'heightM', kind: 'number', unit: 'm', min: 2, max: 50, step: 0.5 },
    { key: 'elevationM', kind: 'number', unit: 'm', min: 0, max: 60, step: 0.5 },
  ] }] },
  presentation: { label: 'Scoreboard', description: 'Renderer-only board positioned relative to the canonical fence.', icon: { kind: 'iconify', name: 'lucide:monitor-up' }, paletteSection: 'structure' },
  mcp: { semantic: true, description: 'Renderer-only scoreboard whose radial position is canonical fence distance plus a nonnegative offset.' },
};

const lightDefinition: NodeDefinition<typeof MbdLightTower> = {
  kind: 'mbd:light-tower',
  schemaVersion: 1,
  schema: MbdLightTower,
  category: 'utility',
  defaults: () => ({ object: 'node', parentId: null, visible: true, metadata: {}, enabled: true, angleDeg: 0, distanceBeyondFenceM: 26, heightM: 34 }),
  capabilities: { selectable: { hitVolume: 'bbox' }, deletable: true, duplicable: true },
  dirtyTracking: false,
  renderer: { kind: 'parametric', module: semanticRenderer },
  parametrics: { groups: [{ label: 'Light Tower', fields: [
    { key: 'enabled', kind: 'boolean' },
    { key: 'angleDeg', kind: 'number', unit: '°', min: -45, max: 45, step: 0.5 },
    { key: 'distanceBeyondFenceM', kind: 'number', unit: 'm', min: 0, max: 100, step: 0.5 },
    { key: 'heightM', kind: 'number', unit: 'm', min: 8, max: 80, step: 0.5 },
  ] }] },
  presentation: { label: 'Light Tower', description: 'Renderer-only tower positioned beyond the canonical fence.', icon: { kind: 'iconify', name: 'lucide:lamp-ceiling' }, paletteSection: 'structure' },
  mcp: { semantic: true, description: 'Renderer-only light tower positioned at fence distance plus a nonnegative offset.' },
};

export const mbdBallparkPlugin: Plugin = {
  id: 'mbd:ballpark-studio',
  apiVersion: 1,
  nodes: [
    rootDefinition,
    fieldDefinition,
    fenceDefinition,
    standDefinition,
    batterEyeDefinition,
    scoreboardDefinition,
    lightDefinition,
  ] as AnyNodeDefinition[],
};

export const MBD_BALLPARK_NODE_KINDS = mbdBallparkPlugin.nodes?.map((definition) => definition.kind) ?? [];
