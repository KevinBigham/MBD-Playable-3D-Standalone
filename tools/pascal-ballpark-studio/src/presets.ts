import { BALLPARK_ASSETS } from '../../../src/ballpark/assets';
import { canonicalBallparkAsset, type MbdBallparkAssetV1, validateBallparkAsset } from '../../../src/ballpark/contract';

function preset(
  id: string,
  name: string,
  mutate: (asset: MbdBallparkAssetV1) => void,
): MbdBallparkAssetV1 {
  const asset = canonicalBallparkAsset(structuredClone(BALLPARK_ASSETS[2]));
  asset.stadium.id = id;
  asset.stadium.name = name;
  asset.stadium.city = 'Studio Lab';
  asset.stadium.blurb = `${name} authoring preset. Every value already passes the MBD v1 safety contract.`;
  asset.presentation = undefined;
  asset.authoring = { author: 'MBD Ballpark Studio', notes: `Built-in ${name.toLowerCase()} preset.` };
  mutate(asset);
  const result = validateBallparkAsset(asset);
  if (!result.ok) throw new Error(result.errors.map((error) => `${error.path}: ${error.message}`).join('\n'));
  return result.asset;
}

export const BALLPARK_PRESETS: Readonly<Record<string, MbdBallparkAssetV1>> = Object.freeze({
  neutral: preset('studio-neutral', 'Neutral Park', (asset) => {
    asset.stadium.carry = 1;
    asset.stadium.windMps = { x: 0, z: 0 };
    asset.stadium.domed = false;
    asset.stadium.turf = false;
  }),
  'short-porch': preset('studio-short-porch', 'Short-Porch Asymmetric Park', (asset) => {
    asset.stadium.fence = [
      { angleDeg: -45, distanceM: 99, heightM: 3 },
      { angleDeg: -25, distanceM: 113, heightM: 3 },
      { angleDeg: 0, distanceM: 122, heightM: 3 },
      { angleDeg: 24, distanceM: 101, heightM: 2.5 },
      { angleDeg: 45, distanceM: 86, heightM: 2.5 },
    ];
  }),
  'deep-center': preset('studio-deep-center', 'Deep-Center Park', (asset) => {
    asset.stadium.fence = [
      { angleDeg: -45, distanceM: 101, heightM: 2.5 },
      { angleDeg: -25, distanceM: 122, heightM: 2.5 },
      { angleDeg: 0, distanceM: 145, heightM: 2.5 },
      { angleDeg: 25, distanceM: 122, heightM: 2.5 },
      { angleDeg: 45, distanceM: 101, heightM: 2.5 },
    ];
  }),
  'high-wall': preset('studio-high-wall', 'High-Wall Park', (asset) => {
    asset.stadium.fence = asset.stadium.fence.map((anchor) => ({ ...anchor, heightM: 18 }));
  }),
  dome: preset('studio-dome', 'Dome Park', (asset) => {
    asset.stadium.domed = true;
    asset.stadium.turf = true;
    asset.stadium.windMps = { x: 0, z: 0 };
    asset.stadium.skyline = 'dome';
  }),
});
