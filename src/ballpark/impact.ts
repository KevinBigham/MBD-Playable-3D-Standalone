import { TICK_DT, clamp } from '../core/constants';
import { Rng } from '../core/rng';
import type { Stadium } from '../core/types';
import { fenceAt } from '../data/stadiums';
import { horizontalDist, launchFree, makeBall, stepFree } from '../sim/physics';
import { hashBallparkAsset, type MbdBallparkAssetV1 } from './contract';

export const PARK_IMPACT_DEEP_THRESHOLD_M = 105;

export interface ParkImpactOptions {
  seed: number;
  samples: number;
}

interface LaunchSample {
  exitVeloMps: number;
  launchAngleDeg: number;
  sprayAngleDeg: number;
  spin: number;
  sideSpin: number;
}

interface ImpactBin {
  samples: number;
  homeRuns: number;
  wallHits: number;
  deepInPlay: number;
}

interface ImpactTally extends ImpactBin {
  bins: { left: ImpactBin; center: ImpactBin; right: ImpactBin };
}

export interface ParkImpactRates {
  homeRunRate: number;
  wallHitRate: number;
  deepInPlayRate: number;
  bySpray: Record<'left' | 'center' | 'right', {
    samples: number;
    homeRunRate: number;
    wallHitRate: number;
    deepInPlayRate: number;
  }>;
}

export interface ParkImpactReport {
  schema: 'mbd.ballpark-impact';
  version: 1;
  assetId: string;
  assetHash: string;
  seed: number;
  samples: number;
  model: {
    physics: 'src/sim/physics.stepFree';
    tickSeconds: number;
    launchDistribution: string;
    deepDistanceThresholdM: number;
    baseline: string;
  };
  park: ParkImpactRates & {
    carry: number;
    windMps: { x: number; z: number };
    fence: {
      distanceM: { mean: number; min: number; max: number };
      heightM: { mean: number; min: number; max: number };
    };
  };
  baseline: ParkImpactRates & { parkCount: number };
  deltaVsBaseline: {
    homeRunRate: number;
    wallHitRate: number;
    deepInPlayRate: number;
    bySpray: Record<'left' | 'center' | 'right', {
      homeRunRate: number;
      wallHitRate: number;
      deepInPlayRate: number;
    }>;
  };
}

function emptyBin(): ImpactBin {
  return { samples: 0, homeRuns: 0, wallHits: 0, deepInPlay: 0 };
}

function emptyTally(): ImpactTally {
  return { ...emptyBin(), bins: { left: emptyBin(), center: emptyBin(), right: emptyBin() } };
}

function sprayBin(angleDeg: number): 'left' | 'center' | 'right' {
  if (angleDeg < -15) return 'left';
  if (angleDeg > 15) return 'right';
  return 'center';
}

function launchSamples(seed: number, samples: number): LaunchSample[] {
  const rng = new Rng(seed);
  const launches: LaunchSample[] = [];
  for (let index = 0; index < samples; index++) {
    launches.push({
      exitVeloMps: clamp(rng.normal(40, 8), 18, 58),
      launchAngleDeg: clamp(rng.normal(22, 12), -5, 50),
      sprayAngleDeg: rng.range(-45, 45),
      spin: rng.range(0.6, 1.4),
      sideSpin: rng.range(-0.25, 0.25),
    });
  }
  return launches;
}

function simulateLaunch(stadium: Stadium, sample: LaunchSample): { homeRun: boolean; wallHit: boolean; deep: boolean } {
  const launch = (sample.launchAngleDeg * Math.PI) / 180;
  const spray = (sample.sprayAngleDeg * Math.PI) / 180;
  const horizontal = sample.exitVeloMps * Math.cos(launch);
  const ball = makeBall();
  launchFree(
    ball,
    0,
    1,
    0.62,
    horizontal * Math.sin(spray),
    sample.exitVeloMps * Math.sin(launch),
    horizontal * Math.cos(spray),
    'batted',
    sample.spin,
    sample.sideSpin,
  );

  let hitWall = false;
  let maxDistance = 0;
  for (let tick = 0; tick < 2_400; tick++) {
    const result = stepFree(ball, TICK_DT, stadium, stadium.carry);
    maxDistance = Math.max(maxDistance, horizontalDist(ball.x, ball.z));
    hitWall ||= result.hitWall;
    if (result.homeRun) return { homeRun: true, wallHit: hitWall, deep: false };
    if (result.stopped) break;
  }
  return { homeRun: false, wallHit: hitWall, deep: maxDistance >= PARK_IMPACT_DEEP_THRESHOLD_M };
}

function tallyPark(stadium: Stadium, launches: readonly LaunchSample[]): ImpactTally {
  const tally = emptyTally();
  for (const sample of launches) {
    const outcome = simulateLaunch(stadium, sample);
    const bin = tally.bins[sprayBin(sample.sprayAngleDeg)];
    tally.samples++;
    bin.samples++;
    if (outcome.homeRun) {
      tally.homeRuns++;
      bin.homeRuns++;
    }
    if (outcome.wallHit) {
      tally.wallHits++;
      bin.wallHits++;
    }
    if (outcome.deep) {
      tally.deepInPlay++;
      bin.deepInPlay++;
    }
  }
  return tally;
}

function addTally(target: ImpactTally, source: ImpactTally): void {
  target.samples += source.samples;
  target.homeRuns += source.homeRuns;
  target.wallHits += source.wallHits;
  target.deepInPlay += source.deepInPlay;
  for (const key of ['left', 'center', 'right'] as const) {
    target.bins[key].samples += source.bins[key].samples;
    target.bins[key].homeRuns += source.bins[key].homeRuns;
    target.bins[key].wallHits += source.bins[key].wallHits;
    target.bins[key].deepInPlay += source.bins[key].deepInPlay;
  }
}

function rounded(value: number): number {
  return Number(value.toFixed(8));
}

function rate(value: number, total: number): number {
  return rounded(value / Math.max(1, total));
}

function rates(tally: ImpactTally): ParkImpactRates {
  return {
    homeRunRate: rate(tally.homeRuns, tally.samples),
    wallHitRate: rate(tally.wallHits, tally.samples),
    deepInPlayRate: rate(tally.deepInPlay, tally.samples),
    bySpray: Object.fromEntries(
      (['left', 'center', 'right'] as const).map((key) => {
        const bin = tally.bins[key];
        return [key, {
          samples: bin.samples,
          homeRunRate: rate(bin.homeRuns, bin.samples),
          wallHitRate: rate(bin.wallHits, bin.samples),
          deepInPlayRate: rate(bin.deepInPlay, bin.samples),
        }];
      }),
    ) as ParkImpactRates['bySpray'],
  };
}

function fenceStats(stadium: Stadium): ParkImpactReport['park']['fence'] {
  const distances: number[] = [];
  const heights: number[] = [];
  for (let index = 0; index <= 180; index++) {
    const sample = fenceAt(stadium, -45 + index * 0.5);
    distances.push(sample.dist);
    heights.push(sample.height);
  }
  const summary = (values: number[]) => ({
    mean: rounded(values.reduce((sum, value) => sum + value, 0) / values.length),
    min: rounded(Math.min(...values)),
    max: rounded(Math.max(...values)),
  });
  return { distanceM: summary(distances), heightM: summary(heights) };
}

export function buildParkImpactReport(
  asset: MbdBallparkAssetV1,
  stadium: Stadium,
  baselineParks: readonly Stadium[],
  options: ParkImpactOptions,
): ParkImpactReport {
  if (!Number.isSafeInteger(options.seed)) throw new Error('seed must be a safe integer');
  if (!Number.isSafeInteger(options.samples) || options.samples < 1 || options.samples > 1_000_000) {
    throw new Error('samples must be an integer from 1 through 1,000,000');
  }
  if (baselineParks.length === 0) throw new Error('baseline requires at least one native stadium');
  const launches = launchSamples(options.seed, options.samples);
  const parkTally = tallyPark(stadium, launches);
  const baselineTally = emptyTally();
  for (const baseline of baselineParks) addTally(baselineTally, tallyPark(baseline, launches));
  const parkRates = rates(parkTally);
  const baselineRates = rates(baselineTally);
  const deltaBin = (key: 'left' | 'center' | 'right') => ({
    homeRunRate: rounded(parkRates.bySpray[key].homeRunRate - baselineRates.bySpray[key].homeRunRate),
    wallHitRate: rounded(parkRates.bySpray[key].wallHitRate - baselineRates.bySpray[key].wallHitRate),
    deepInPlayRate: rounded(parkRates.bySpray[key].deepInPlayRate - baselineRates.bySpray[key].deepInPlayRate),
  });
  return {
    schema: 'mbd.ballpark-impact',
    version: 1,
    assetId: asset.stadium.id,
    assetHash: hashBallparkAsset(asset),
    seed: options.seed,
    samples: options.samples,
    model: {
      physics: 'src/sim/physics.stepFree',
      tickSeconds: TICK_DT,
      launchDistribution: 'MBD seeded contact grid: bounded normal exit velocity/launch angle; uniform fair spray/spin',
      deepDistanceThresholdM: PARK_IMPACT_DEEP_THRESHOLD_M,
      baseline: `league-average aggregate across ${baselineParks.length} promoted parks using identical launches`,
    },
    park: {
      ...parkRates,
      carry: stadium.carry,
      windMps: { ...stadium.wind },
      fence: fenceStats(stadium),
    },
    baseline: { ...baselineRates, parkCount: baselineParks.length },
    deltaVsBaseline: {
      homeRunRate: rounded(parkRates.homeRunRate - baselineRates.homeRunRate),
      wallHitRate: rounded(parkRates.wallHitRate - baselineRates.wallHitRate),
      deepInPlayRate: rounded(parkRates.deepInPlayRate - baselineRates.deepInPlayRate),
      bySpray: { left: deltaBin('left'), center: deltaBin('center'), right: deltaBin('right') },
    },
  };
}
