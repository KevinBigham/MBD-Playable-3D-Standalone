import { BALLPARK_LIMITS } from '../../../src/ballpark/contract';
import type { FenceAnchor } from './plugin/nodes';

export const MIN_ANCHOR_GAP_DEG = 0.25;

export function anchorPosition(anchor: FenceAnchor): [number, number, number] {
  const radians = (anchor.angleDeg * Math.PI) / 180;
  return [Math.sin(radians) * anchor.distanceM, anchor.heightM, Math.cos(radians) * anchor.distanceM];
}

export function constrainFenceAnchor(
  anchors: readonly FenceAnchor[],
  index: number,
  position: readonly [number, number, number],
): FenceAnchor {
  const current = anchors[index];
  if (!current) throw new Error(`Fence anchor ${index} does not exist.`);
  const distanceM = Math.min(
    BALLPARK_LIMITS.distanceM.max,
    Math.max(BALLPARK_LIMITS.distanceM.min, Math.hypot(position[0], position[2])),
  );
  const rawAngle = (Math.atan2(position[0], Math.max(0.0001, position[2])) * 180) / Math.PI;
  const lower = index === 0 ? -45 : (anchors[index - 1]?.angleDeg ?? -45) + MIN_ANCHOR_GAP_DEG;
  const upper = index === anchors.length - 1 ? 45 : (anchors[index + 1]?.angleDeg ?? 45) - MIN_ANCHOR_GAP_DEG;
  const angleDeg = index === 0 ? -45 : index === anchors.length - 1 ? 45 : Math.min(upper, Math.max(lower, rawAngle));
  const heightM = Math.min(
    BALLPARK_LIMITS.wallHeightM.max,
    Math.max(BALLPARK_LIMITS.wallHeightM.min, position[1]),
  );
  return { angleDeg, distanceM, heightM };
}

export function deleteFenceAnchor(anchors: readonly FenceAnchor[], index: number): FenceAnchor[] {
  if (anchors.length <= BALLPARK_LIMITS.fenceAnchors.min) return [...anchors];
  if (index <= 0 || index >= anchors.length - 1) return [...anchors];
  return anchors.filter((_, candidate) => candidate !== index);
}

export function insertFenceAnchor(anchors: readonly FenceAnchor[], afterIndex: number): FenceAnchor[] {
  if (anchors.length >= BALLPARK_LIMITS.fenceAnchors.max) return [...anchors];
  const left = anchors[afterIndex];
  const right = anchors[afterIndex + 1];
  if (!left || !right) return [...anchors];
  const inserted: FenceAnchor = {
    angleDeg: (left.angleDeg + right.angleDeg) / 2,
    distanceM: (left.distanceM + right.distanceM) / 2,
    heightM: (left.heightM + right.heightM) / 2,
  };
  return [...anchors.slice(0, afterIndex + 1), inserted, ...anchors.slice(afterIndex + 1)];
}
