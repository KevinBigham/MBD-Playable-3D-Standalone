import { describe, expect, it } from 'vitest';
import { BALLPARK_ASSETS } from '../ballpark/assets';
import { ballparkAssetToStadium, type MbdBallparkAssetV1 } from '../ballpark/contract';
import { buildParkImpactReport } from '../ballpark/impact';
import { STADIUMS } from '../data/stadiums';

describe('deterministic park-impact lab', () => {
  it('returns byte-identical fixed-seed reports from the real physics integrator', () => {
    const asset = BALLPARK_ASSETS[0];
    const stadium = ballparkAssetToStadium(asset);
    const options = { seed: 12345, samples: 30 };
    const first = buildParkImpactReport(asset, stadium, STADIUMS.slice(0, 3), options);
    const second = buildParkImpactReport(asset, stadium, STADIUMS.slice(0, 3), options);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.model.physics).toBe('src/sim/physics.stepFree');
  });

  it('produces identical physics when only presentation changes', () => {
    const plain = structuredClone(BALLPARK_ASSETS[1]) as MbdBallparkAssetV1;
    const presented = structuredClone(plain);
    presented.presentation = {
      stands: { depthScale: 1.8, heightScale: 0.7, tiers: 2 },
      batterEye: { startAngleDeg: -8, endAngleDeg: 8, heightM: 10, depthM: 3 },
    };
    const options = { seed: 90210, samples: 24 };
    const first = buildParkImpactReport(plain, ballparkAssetToStadium(plain), STADIUMS.slice(0, 2), options);
    const second = buildParkImpactReport(presented, ballparkAssetToStadium(presented), STADIUMS.slice(0, 2), options);
    expect(second.park).toEqual(first.park);
    expect(second.deltaVsBaseline).toEqual(first.deltaVsBaseline);
  });
});
