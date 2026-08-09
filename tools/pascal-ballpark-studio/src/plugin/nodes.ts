import { BaseNode, nodeType, objectId } from '@pascal-app/core';
import { z } from 'zod';

const position = z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]);

export const FenceAnchor = z.object({
  angleDeg: z.number(),
  distanceM: z.number(),
  heightM: z.number(),
});
export type FenceAnchor = z.infer<typeof FenceAnchor>;

export const MbdBallparkRoot = BaseNode.extend({
  id: objectId('mbd-ballpark'),
  type: nodeType('mbd:ballpark-root'),
  stadiumId: z.string(),
  stadiumName: z.string(),
  city: z.string(),
  blurb: z.string(),
  carry: z.number(),
  windX: z.number(),
  windZ: z.number(),
  domed: z.boolean(),
  turf: z.boolean(),
  grass: z.number().int(),
  grassAlt: z.number().int(),
  dirt: z.number().int(),
  wall: z.number().int(),
  wallTrim: z.number().int(),
  stands: z.number().int(),
  sky: z.number().int(),
  skyNight: z.number().int(),
  structure: z.number().int(),
  skyline: z.enum(['towers', 'mesa', 'dome', 'bayou', 'peaks', 'stacks', 'forest', 'plains']),
  author: z.string().optional(),
  notes: z.string().optional(),
  importedHash: z.string().optional(),
});
export type MbdBallparkRoot = z.infer<typeof MbdBallparkRoot>;

export const MbdFieldReference = BaseNode.extend({
  id: objectId('mbd-field'),
  type: nodeType('mbd:field-reference'),
  position,
  locked: z.literal(true).default(true),
});
export type MbdFieldReference = z.infer<typeof MbdFieldReference>;

export const MbdFenceProfile = BaseNode.extend({
  id: objectId('mbd-fence'),
  type: nodeType('mbd:fence-profile'),
  anchors: z.array(FenceAnchor).min(3).max(33),
});
export type MbdFenceProfile = z.infer<typeof MbdFenceProfile>;

export const MbdStandProfile = BaseNode.extend({
  id: objectId('mbd-stands'),
  type: nodeType('mbd:stand-profile'),
  enabled: z.boolean().default(false),
  depthScale: z.number().default(1),
  heightScale: z.number().default(1),
  tiers: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(3),
});
export type MbdStandProfile = z.infer<typeof MbdStandProfile>;

export const MbdBatterEye = BaseNode.extend({
  id: objectId('mbd-batter-eye'),
  type: nodeType('mbd:batter-eye'),
  enabled: z.boolean().default(false),
  startAngleDeg: z.number().default(-8),
  endAngleDeg: z.number().default(8),
  heightM: z.number().default(10),
  depthM: z.number().default(3),
});
export type MbdBatterEye = z.infer<typeof MbdBatterEye>;

export const MbdScoreboard = BaseNode.extend({
  id: objectId('mbd-scoreboard'),
  type: nodeType('mbd:scoreboard'),
  enabled: z.boolean().default(false),
  angleDeg: z.number().default(0),
  distanceBeyondFenceM: z.number().default(9),
  widthM: z.number().default(26),
  heightM: z.number().default(12),
  elevationM: z.number().default(6),
});
export type MbdScoreboard = z.infer<typeof MbdScoreboard>;

export const MbdLightTower = BaseNode.extend({
  id: objectId('mbd-light'),
  type: nodeType('mbd:light-tower'),
  enabled: z.boolean().default(true),
  angleDeg: z.number(),
  distanceBeyondFenceM: z.number().default(26),
  heightM: z.number().default(34),
});
export type MbdLightTower = z.infer<typeof MbdLightTower>;

export type MbdSemanticNode =
  | MbdBallparkRoot
  | MbdFieldReference
  | MbdFenceProfile
  | MbdStandProfile
  | MbdBatterEye
  | MbdScoreboard
  | MbdLightTower;

export const MBD_NODE_SCHEMAS = {
  'mbd:ballpark-root': MbdBallparkRoot,
  'mbd:field-reference': MbdFieldReference,
  'mbd:fence-profile': MbdFenceProfile,
  'mbd:stand-profile': MbdStandProfile,
  'mbd:batter-eye': MbdBatterEye,
  'mbd:scoreboard': MbdScoreboard,
  'mbd:light-tower': MbdLightTower,
} as const;
