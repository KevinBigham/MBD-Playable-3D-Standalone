import type { Stadium } from '../core/types';
import { clamp } from '../core/constants';

/**
 * Eight original ballparks. Fence nodes are (spray angle, distance, wall height)
 * control points from the left-field line (-45deg) to the right-field line
 * (+45deg); the engine interpolates between them, so asymmetric parks bend the
 * way their shape suggests.
 */
export const STADIUMS: Stadium[] = [
  {
    id: 'anchor-yard',
    name: 'Anchor Yard',
    city: 'Ironport',
    blurb: 'Riveted steel and a 12-metre wall in left. The short porch in right is a rumour that keeps coming true.',
    fence: [
      { angle: -45, dist: 96, height: 11.5 },
      { angle: -30, dist: 106, height: 11.5 },
      { angle: -14, dist: 118, height: 3.2 },
      { angle: 0, dist: 121, height: 3.2 },
      { angle: 16, dist: 112, height: 2.4 },
      { angle: 32, dist: 98, height: 2.4 },
      { angle: 45, dist: 92, height: 2.4 },
    ],
    carry: 1.0,
    wind: { x: 0.6, z: -0.4 },
    domed: false,
    turf: false,
    palette: {
      grass: 0x2f7a3a,
      grassAlt: 0x368942,
      dirt: 0x9a6b3f,
      wall: 0x1f4d4a,
      wallTrim: 0xf2c14e,
      stands: 0x24384f,
      sky: 0x8ec8f0,
      skyNight: 0x0d1730,
      structure: 0x5a6a78,
    },
    skyline: 'towers',
  },
  {
    id: 'sandpit',
    name: 'The Sandpit',
    city: 'Cactus Flats',
    blurb: 'Enormous foul ground and gaps that swallow line drives. Bring a hat and a lot of patience.',
    fence: [
      { angle: -45, dist: 101, height: 2.6 },
      { angle: -28, dist: 120, height: 2.6 },
      { angle: -12, dist: 128, height: 2.6 },
      { angle: 0, dist: 130, height: 3.0 },
      { angle: 12, dist: 127, height: 2.6 },
      { angle: 28, dist: 119, height: 2.6 },
      { angle: 45, dist: 100, height: 2.6 },
    ],
    carry: 1.03,
    wind: { x: -0.9, z: 0.5 },
    domed: false,
    turf: false,
    palette: {
      grass: 0x5e8a44,
      grassAlt: 0x6b9a4e,
      dirt: 0xc08b52,
      wall: 0x8a5433,
      wallTrim: 0xffd479,
      stands: 0xa9714a,
      sky: 0xf2c98a,
      skyNight: 0x1a1030,
      structure: 0xc4a06a,
    },
    skyline: 'mesa',
  },
  {
    id: 'comet-dome',
    name: 'The Comet Dome',
    city: 'Nova Bay',
    blurb: 'Perfectly symmetrical, permanently lit, permanently loud. The turf plays fast and the roof holds the noise in.',
    fence: [
      { angle: -45, dist: 100, height: 3.0 },
      { angle: -25, dist: 114, height: 3.0 },
      { angle: 0, dist: 123, height: 3.0 },
      { angle: 25, dist: 114, height: 3.0 },
      { angle: 45, dist: 100, height: 3.0 },
    ],
    carry: 0.99,
    wind: { x: 0, z: 0 },
    domed: true,
    turf: true,
    palette: {
      grass: 0x2b8f6d,
      grassAlt: 0x33a37d,
      dirt: 0x6d4f66,
      wall: 0x2a2350,
      wallTrim: 0xb388ff,
      stands: 0x3a2f6b,
      sky: 0x1b1440,
      skyNight: 0x140f33,
      structure: 0x9d8ce0,
    },
    skyline: 'dome',
  },
  {
    id: 'bayou-bowl',
    name: 'Bayou Bowl',
    city: 'Bayou City',
    blurb: 'Thick air, close walls and a crowd that starts stomping in the first. Fly balls do not come down where you expect.',
    fence: [
      { angle: -45, dist: 92, height: 3.4 },
      { angle: -24, dist: 104, height: 3.4 },
      { angle: 0, dist: 115, height: 4.6 },
      { angle: 24, dist: 103, height: 3.4 },
      { angle: 45, dist: 91, height: 3.4 },
    ],
    carry: 1.07,
    wind: { x: 0.2, z: 1.1 },
    domed: false,
    turf: false,
    palette: {
      grass: 0x2c6b34,
      grassAlt: 0x347a3c,
      dirt: 0x7d5a34,
      wall: 0x1e3f26,
      wallTrim: 0xd9a441,
      stands: 0x2b4a35,
      sky: 0xa8d6c0,
      skyNight: 0x0b1f1a,
      structure: 0x4b6b4a,
    },
    skyline: 'bayou',
  },
  {
    id: 'summit-field',
    name: 'Summit Field',
    city: 'Alpine Summit',
    blurb: 'Two kilometres up. The ball carries like a rumour and centre field runs forever to compensate.',
    fence: [
      { angle: -45, dist: 103, height: 2.6 },
      { angle: -26, dist: 121, height: 2.6 },
      { angle: 0, dist: 134, height: 2.6 },
      { angle: 26, dist: 122, height: 2.6 },
      { angle: 45, dist: 104, height: 2.6 },
    ],
    carry: 1.11,
    wind: { x: -0.3, z: 0.3 },
    domed: false,
    turf: false,
    palette: {
      grass: 0x357f52,
      grassAlt: 0x3d9160,
      dirt: 0x8a7150,
      wall: 0x2c4a63,
      wallTrim: 0xe8f4ff,
      stands: 0x40607d,
      sky: 0x7fc4ef,
      skyNight: 0x0a1428,
      structure: 0xdfeaf5,
    },
    skyline: 'peaks',
  },
  {
    id: 'the-foundry',
    name: 'The Foundry',
    city: 'Rustforge',
    blurb: 'Short everywhere, walled everywhere. Every fly ball is an argument with a sheet of corrugated steel.',
    fence: [
      { angle: -45, dist: 90, height: 8.5 },
      { angle: -22, dist: 100, height: 8.5 },
      { angle: 0, dist: 110, height: 9.5 },
      { angle: 22, dist: 99, height: 8.5 },
      { angle: 45, dist: 89, height: 8.5 },
    ],
    carry: 1.02,
    wind: { x: 0, z: -0.7 },
    domed: false,
    turf: false,
    palette: {
      grass: 0x3a6b3c,
      grassAlt: 0x437a45,
      dirt: 0x77563a,
      wall: 0x5c3a2a,
      wallTrim: 0xff9d3d,
      stands: 0x4a4038,
      sky: 0xd7b78f,
      skyNight: 0x1c1410,
      structure: 0x7a5c46,
    },
    skyline: 'stacks',
  },
  {
    id: 'grove-park',
    name: 'Grove Park',
    city: 'Redwood Grove',
    blurb: 'Low walls, an absurd centre-field cavern and actual trees over the batter’s eye. Triples happen here.',
    fence: [
      { angle: -45, dist: 98, height: 1.6 },
      { angle: -26, dist: 118, height: 1.6 },
      { angle: -6, dist: 133, height: 1.6 },
      { angle: 6, dist: 132, height: 1.6 },
      { angle: 26, dist: 116, height: 1.6 },
      { angle: 45, dist: 97, height: 1.6 },
    ],
    carry: 0.98,
    wind: { x: 0.4, z: -0.5 },
    domed: false,
    turf: false,
    palette: {
      grass: 0x27632f,
      grassAlt: 0x2e7337,
      dirt: 0x6f4f33,
      wall: 0x1d3a22,
      wallTrim: 0xf0e0b0,
      stands: 0x33452f,
      sky: 0x9dcfe8,
      skyNight: 0x0a1a18,
      structure: 0x3f6b3a,
    },
    skyline: 'forest',
  },
  {
    id: 'thunder-ridge',
    name: 'Thunder Ridge',
    city: 'Prairie Rock',
    blurb: 'Nothing between the plate and the horizon but weather. The wind decides at least one game a week.',
    fence: [
      { angle: -45, dist: 99, height: 3.6 },
      { angle: -24, dist: 116, height: 3.6 },
      { angle: 0, dist: 126, height: 4.2 },
      { angle: 24, dist: 115, height: 3.6 },
      { angle: 45, dist: 98, height: 3.6 },
    ],
    carry: 1.01,
    wind: { x: 1.6, z: 1.4 },
    domed: false,
    turf: false,
    palette: {
      grass: 0x4a8340,
      grassAlt: 0x559349,
      dirt: 0x9c7a48,
      wall: 0x7a2f36,
      wallTrim: 0xffd76a,
      stands: 0x8a3c42,
      sky: 0xbcd9ef,
      skyNight: 0x101a2c,
      structure: 0xb8a06a,
    },
    skyline: 'plains',
  },
];

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
