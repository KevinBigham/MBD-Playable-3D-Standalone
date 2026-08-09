import type { Stadium } from '../core/types';
import { clamp } from '../core/constants';
import { BALLPARK_ASSETS } from '../ballpark/assets';
import { ballparkAssetToStadium } from '../ballpark/contract';

/**
 * Promoted semantic assets compile to the native Stadium model once. Physics
 * and rendering receive the same object and continue sharing fenceAt() and
 * fenceOutline(); Pascal/editor metadata never enters that native model.
 */
export const STADIUMS: Stadium[] = BALLPARK_ASSETS.map((asset) => ballparkAssetToStadium(asset));

export const STADIUM_BY_ID: Record<string, Stadium> = Object.fromEntries(
  STADIUMS.map((s) => [s.id, s]),
);

export function getStadium(id: string): Stadium {
  return STADIUM_BY_ID[id] ?? STADIUMS[0];
}

/**
 * Distance from home plate to the wall at a given spray angle (degrees),
 * plus the wall height there. Linear interpolation between control points.
 */
export function fenceAt(stadium: Stadium, angleDeg: number): { dist: number; height: number } {
  const nodes = stadium.fence;
  const a = clamp(angleDeg, nodes[0].angle, nodes[nodes.length - 1].angle);
  for (let i = 0; i < nodes.length - 1; i++) {
    const n0 = nodes[i];
    const n1 = nodes[i + 1];
    if (a >= n0.angle && a <= n1.angle) {
      const t = (a - n0.angle) / (n1.angle - n0.angle);
      return {
        dist: n0.dist + (n1.dist - n0.dist) * t,
        height: n0.height + (n1.height - n0.height) * t,
      };
    }
  }
  const last = nodes[nodes.length - 1];
  return { dist: last.dist, height: last.height };
}

/** Sampled outline of the wall, for building geometry and for HUD minimaps. */
export function fenceOutline(stadium: Stadium, samples = 64): { x: number; z: number; h: number }[] {
  const pts: { x: number; z: number; h: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const angle = -45 + (90 * i) / samples;
    const { dist, height } = fenceAt(stadium, angle);
    const rad = (angle * Math.PI) / 180;
    pts.push({ x: Math.sin(rad) * dist, z: Math.cos(rad) * dist, h: height });
  }
  return pts;
}
