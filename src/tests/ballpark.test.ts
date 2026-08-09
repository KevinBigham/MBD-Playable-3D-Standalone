import { describe, expect, it } from 'vitest';
import { BALLPARK_ASSETS } from '../ballpark/assets';
import {
  ballparkAssetToStadium,
  hashBallparkAsset,
  serializeBallparkAsset,
  stadiumToBallparkAsset,
  validateBallparkAsset,
  type MbdBallparkAssetV1,
} from '../ballpark/contract';
import { STADIUMS } from '../data/stadiums';

function cloneAsset(asset = BALLPARK_ASSETS[0]): MbdBallparkAssetV1 {
  return structuredClone(asset);
}

function paths(value: unknown): string[] {
  const result = validateBallparkAsset(value);
  return result.ok ? [] : result.errors.map((error) => error.path);
}

describe('MbdBallparkAssetV1 validation', () => {
  it('accepts every promoted built-in park', () => {
    expect(BALLPARK_ASSETS).toHaveLength(8);
    for (const asset of BALLPARK_ASSETS) expect(validateBallparkAsset(asset)).toMatchObject({ ok: true });
  });

  it('rejects malformed schema, version, units, coordinates, and unknown fields', () => {
    const asset = cloneAsset() as MbdBallparkAssetV1 & { executable?: string };
    asset.schema = 'mbd.ballpark' as MbdBallparkAssetV1['schema'];
    (asset as { version: number }).version = 2;
    (asset as { units: string }).units = 'feet';
    (asset.coordinateSystem as { y: string }).y = 'down';
    asset.executable = '<script>alert(1)</script>';
    expect(paths(asset)).toEqual(expect.arrayContaining([
      '$.version',
      '$.units',
      '$.coordinateSystem.y',
      '$.executable',
    ]));
  });

  it('rejects missing, unsorted, duplicate, and out-of-range fence anchors', () => {
    const missing = cloneAsset();
    (missing.stadium.fence[0] as Partial<(typeof missing.stadium.fence)[number]>).heightM = undefined;
    expect(paths(missing)).toContain('$.stadium.fence[0].heightM');

    const unsorted = cloneAsset();
    unsorted.stadium.fence[2].angleDeg = -35;
    expect(paths(unsorted)).toContain('$.stadium.fence[2].angleDeg');

    const duplicate = cloneAsset();
    duplicate.stadium.fence[2].angleDeg = duplicate.stadium.fence[1].angleDeg;
    expect(paths(duplicate)).toContain('$.stadium.fence[2].angleDeg');

    const outOfRange = cloneAsset();
    outOfRange.stadium.fence[0].distanceM = 69.99;
    outOfRange.stadium.fence[0].heightM = 30.01;
    expect(paths(outOfRange)).toEqual(expect.arrayContaining([
      '$.stadium.fence[0].distanceM',
      '$.stadium.fence[0].heightM',
    ]));
  });

  it('requires exact foul-line endpoint angles', () => {
    const asset = cloneAsset();
    asset.stadium.fence[0].angleDeg = -44.999;
    asset.stadium.fence[asset.stadium.fence.length - 1].angleDeg = 44.999;
    expect(paths(asset)).toEqual(expect.arrayContaining([
      '$.stadium.fence[0].angleDeg',
      `$.stadium.fence[${asset.stadium.fence.length - 1}].angleDeg`,
    ]));
  });

  it('rejects numeric strings, invalid colors, wind, carry, and presentation dimensions', () => {
    const asset = cloneAsset();
    (asset.stadium as unknown as { carry: string }).carry = '1.0';
    asset.stadium.windMps.x = 11;
    asset.stadium.palette.wall = 0x1000000;
    asset.presentation = {
      stands: { depthScale: 0.2, heightScale: 1, tiers: 3 },
      batterEye: { startAngleDeg: 10, endAngleDeg: -10, heightM: 0, depthM: 31 },
      scoreboard: { angleDeg: 0, distanceBeyondFenceM: -1, widthM: 0, heightM: 100, elevationM: -1 },
      lightTowers: [{ angleDeg: 50, distanceBeyondFenceM: -1, heightM: 2 }],
    };
    expect(paths(asset)).toEqual(expect.arrayContaining([
      '$.stadium.carry',
      '$.stadium.windMps.x',
      '$.stadium.palette.wall',
      '$.presentation.stands.depthScale',
      '$.presentation.batterEye.endAngleDeg',
      '$.presentation.batterEye.heightM',
      '$.presentation.batterEye.depthM',
      '$.presentation.scoreboard.distanceBeyondFenceM',
      '$.presentation.lightTowers[0].angleDeg',
    ]));
  });
});

describe('native asset adapters', () => {
  it('round-trips every park without semantic drift or fence reordering', () => {
    for (const stadium of STADIUMS) {
      const source = BALLPARK_ASSETS.find((asset) => asset.stadium.id === stadium.id);
      expect(source).toBeDefined();
      const asset = stadiumToBallparkAsset(stadium, source?.presentation);
      expect(ballparkAssetToStadium(asset)).toEqual(stadium);
      expect(asset.stadium.fence.map((node) => node.angleDeg)).toEqual(stadium.fence.map((node) => node.angle));
    }
  });

  it('never compiles presentation or authoring fields into native simulation data', () => {
    const plain = cloneAsset();
    const authored = cloneAsset();
    plain.presentation = undefined;
    plain.authoring = undefined;
    authored.presentation = {
      stands: { depthScale: 2, heightScale: 2, tiers: 1 },
      batterEye: { startAngleDeg: -20, endAngleDeg: 20, heightM: 30, depthM: 20 },
      scoreboard: { angleDeg: 40, distanceBeyondFenceM: 70, widthM: 70, heightM: 40, elevationM: 50 },
      lightTowers: [{ angleDeg: -40, distanceBeyondFenceM: 90, heightM: 75 }],
    };
    authored.authoring = { author: 'Ignored by physics', notes: 'Also ignored.' };
    expect(ballparkAssetToStadium(authored)).toEqual(ballparkAssetToStadium(plain));
  });
});

describe('canonical ballpark serialization', () => {
  it('has stable key order and normalizes insignificant negative zero', () => {
    const asset = cloneAsset();
    asset.stadium.windMps.x = -0;
    const first = serializeBallparkAsset(asset);
    const reparsed = validateBallparkAsset(JSON.parse(first));
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(serializeBallparkAsset(reparsed.asset)).toBe(first);
    expect(Object.is(JSON.parse(first).stadium.windMps.x, -0)).toBe(false);
  });

  it('excludes volatile exportedAt from the stable content hash', () => {
    const first = cloneAsset();
    const second = cloneAsset();
    first.authoring = { ...first.authoring, exportedAt: '2026-08-09T12:00:00.000Z' };
    second.authoring = { ...second.authoring, exportedAt: '2026-08-09T13:00:00.000Z' };
    expect(hashBallparkAsset(first)).toBe(hashBallparkAsset(second));
    expect(serializeBallparkAsset(first)).not.toBe(serializeBallparkAsset(second));
  });
});
