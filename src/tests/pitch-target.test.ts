import { describe, expect, it } from 'vitest';
import { pitchTargetRadius } from '../ui/plateview';

describe('shrinking pitch target', () => {
  it('starts large, shrinks continuously, and finishes on the crossing point', () => {
    const zoneH = 180;
    const radii = Array.from({ length: 21 }, (_, i) => pitchTargetRadius(zoneH, i / 20));

    expect(radii[0]).toBeGreaterThan(zoneH * 0.45);
    expect(radii[0] / radii.at(-1)!).toBeGreaterThan(5);
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeLessThan(radii[i - 1]);
  });
});
