import type { Stadium } from '../core/types';

export const BALLPARK_SCHEMA = 'mbd.ballpark' as const;
export const BALLPARK_VERSION = 1 as const;
export const BALLPARK_UNITS = 'meters' as const;
export const BALLPARK_COORDINATE_SYSTEM = {
  x: 'left-right',
  y: 'up',
  z: 'home-to-center',
  sprayAngleDeg: 'left-negative-right-positive',
} as const;

export const BALLPARK_LIMITS = {
  fenceAnchors: { min: 3, max: 33 },
  fenceAngleToleranceDeg: 1e-9,
  distanceM: { min: 70, max: 170 },
  wallHeightM: { min: 0.6, max: 30 },
  carry: { min: 0.8, max: 1.25 },
  windMps: { min: -10, max: 10 },
  standsScale: { min: 0.5, max: 2 },
  batterEyeHeightM: { min: 0.5, max: 40 },
  batterEyeDepthM: { min: 0.25, max: 30 },
  scoreboardOffsetM: { min: 0, max: 80 },
  scoreboardWidthM: { min: 2, max: 80 },
  scoreboardHeightM: { min: 2, max: 50 },
  scoreboardElevationM: { min: 0, max: 60 },
  lightTowerOffsetM: { min: 0, max: 100 },
  lightTowerHeightM: { min: 8, max: 80 },
  lightTowers: { max: 12 },
} as const;

export const BALLPARK_SKYLINES = [
  'towers',
  'mesa',
  'dome',
  'bayou',
  'peaks',
  'stacks',
  'forest',
  'plains',
] as const;

export type BallparkSkyline = (typeof BALLPARK_SKYLINES)[number];

export interface MbdBallparkAssetV1 {
  schema: typeof BALLPARK_SCHEMA;
  version: typeof BALLPARK_VERSION;
  units: typeof BALLPARK_UNITS;
  coordinateSystem: typeof BALLPARK_COORDINATE_SYSTEM;
  stadium: {
    id: string;
    name: string;
    city: string;
    blurb: string;
    fence: Array<{
      angleDeg: number;
      distanceM: number;
      heightM: number;
    }>;
    carry: number;
    windMps: { x: number; z: number };
    domed: boolean;
    turf: boolean;
    palette: {
      grass: number;
      grassAlt: number;
      dirt: number;
      wall: number;
      wallTrim: number;
      stands: number;
      sky: number;
      skyNight: number;
      structure: number;
    };
    skyline: BallparkSkyline;
  };
  presentation?: {
    stands?: {
      depthScale: number;
      heightScale: number;
      tiers: 1 | 2 | 3;
    };
    batterEye?: {
      startAngleDeg: number;
      endAngleDeg: number;
      heightM: number;
      depthM: number;
    };
    scoreboard?: {
      angleDeg: number;
      distanceBeyondFenceM: number;
      widthM: number;
      heightM: number;
      elevationM: number;
    };
    lightTowers?: Array<{
      angleDeg: number;
      distanceBeyondFenceM: number;
      heightM: number;
    }>;
  };
  authoring?: {
    author?: string;
    notes?: string;
    pascalSceneVersion?: string;
    exportedAt?: string;
  };
}

export type BallparkPresentationV1 = NonNullable<MbdBallparkAssetV1['presentation']>;

export interface BallparkValidationIssue {
  path: string;
  code:
    | 'missing'
    | 'unknown'
    | 'type'
    | 'literal'
    | 'range'
    | 'format'
    | 'order'
    | 'duplicate';
  message: string;
}

export type BallparkValidationResult =
  | { ok: true; asset: MbdBallparkAssetV1; errors: [] }
  | { ok: false; errors: BallparkValidationIssue[] };

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordAt(
  value: unknown,
  path: string,
  errors: BallparkValidationIssue[],
): RecordValue | undefined {
  if (!isRecord(value)) {
    errors.push({ path, code: 'type', message: 'Expected an object.' });
    return undefined;
  }
  return value;
}

function exactKeys(
  value: RecordValue,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
  errors: BallparkValidationIssue[],
): void {
  const allow = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allow.has(key)) {
      errors.push({
        path: `${path}.${key}`,
        code: 'unknown',
        message: `Unknown field '${key}' is not part of the v1 contract.`,
      });
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      errors.push({ path: `${path}.${key}`, code: 'missing', message: 'Required field is missing.' });
    }
  }
}

function stringField(
  object: RecordValue,
  key: string,
  path: string,
  errors: BallparkValidationIssue[],
  options: { nonempty?: boolean; max?: number } = {},
): string | undefined {
  const value = object[key];
  if (typeof value !== 'string') {
    if (Object.prototype.hasOwnProperty.call(object, key)) {
      errors.push({ path: `${path}.${key}`, code: 'type', message: 'Expected a string.' });
    }
    return undefined;
  }
  if (options.nonempty && value.trim().length === 0) {
    errors.push({ path: `${path}.${key}`, code: 'format', message: 'Must not be empty.' });
  }
  if (options.max !== undefined && value.length > options.max) {
    errors.push({
      path: `${path}.${key}`,
      code: 'range',
      message: `Must contain at most ${options.max} characters.`,
    });
  }
  return value;
}

function finiteNumberField(
  object: RecordValue,
  key: string,
  path: string,
  errors: BallparkValidationIssue[],
  bounds?: { min: number; max: number },
  integer = false,
): number | undefined {
  const value = object[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    if (Object.prototype.hasOwnProperty.call(object, key)) {
      errors.push({
        path: `${path}.${key}`,
        code: 'type',
        message: 'Expected a finite number (numeric strings, NaN, and infinities are rejected).',
      });
    }
    return undefined;
  }
  if (integer && !Number.isInteger(value)) {
    errors.push({ path: `${path}.${key}`, code: 'type', message: 'Expected an integer.' });
  }
  if (bounds && (value < bounds.min || value > bounds.max)) {
    errors.push({
      path: `${path}.${key}`,
      code: 'range',
      message: `Must be between ${bounds.min} and ${bounds.max}, inclusive.`,
    });
  }
  return value;
}

function booleanField(
  object: RecordValue,
  key: string,
  path: string,
  errors: BallparkValidationIssue[],
): boolean | undefined {
  const value = object[key];
  if (typeof value !== 'boolean') {
    if (Object.prototype.hasOwnProperty.call(object, key)) {
      errors.push({ path: `${path}.${key}`, code: 'type', message: 'Expected a boolean.' });
    }
    return undefined;
  }
  return value;
}

function literalField(
  object: RecordValue,
  key: string,
  expected: string | number,
  path: string,
  errors: BallparkValidationIssue[],
): void {
  if (object[key] !== expected && Object.prototype.hasOwnProperty.call(object, key)) {
    errors.push({
      path: `${path}.${key}`,
      code: 'literal',
      message: `Expected the exact v1 marker ${JSON.stringify(expected)}.`,
    });
  }
}

function validateCoordinateSystem(value: unknown, errors: BallparkValidationIssue[]): void {
  const path = '$.coordinateSystem';
  const object = recordAt(value, path, errors);
  if (!object) return;
  const keys = ['x', 'y', 'z', 'sprayAngleDeg'] as const;
  exactKeys(object, keys, keys, path, errors);
  for (const key of keys) literalField(object, key, BALLPARK_COORDINATE_SYSTEM[key], path, errors);
}

function validateFence(value: unknown, errors: BallparkValidationIssue[]): void {
  const path = '$.stadium.fence';
  if (!Array.isArray(value)) {
    errors.push({ path, code: 'type', message: 'Expected an array of canonical polar anchors.' });
    return;
  }
  if (value.length < BALLPARK_LIMITS.fenceAnchors.min || value.length > BALLPARK_LIMITS.fenceAnchors.max) {
    errors.push({
      path,
      code: 'range',
      message: `Fence must contain ${BALLPARK_LIMITS.fenceAnchors.min}..${BALLPARK_LIMITS.fenceAnchors.max} anchors.`,
    });
  }
  const angles: Array<number | undefined> = [];
  for (let index = 0; index < value.length; index++) {
    const itemPath = `${path}[${index}]`;
    const anchor = recordAt(value[index], itemPath, errors);
    if (!anchor) {
      angles.push(undefined);
      continue;
    }
    const keys = ['angleDeg', 'distanceM', 'heightM'] as const;
    exactKeys(anchor, keys, keys, itemPath, errors);
    angles.push(finiteNumberField(anchor, 'angleDeg', itemPath, errors, { min: -45, max: 45 }));
    finiteNumberField(anchor, 'distanceM', itemPath, errors, BALLPARK_LIMITS.distanceM);
    finiteNumberField(anchor, 'heightM', itemPath, errors, BALLPARK_LIMITS.wallHeightM);
  }
  if (angles.length > 0 && angles[0] !== undefined) {
    if (Math.abs(angles[0] + 45) > BALLPARK_LIMITS.fenceAngleToleranceDeg) {
      errors.push({
        path: `${path}[0].angleDeg`,
        code: 'literal',
        message: 'The first fence anchor must be exactly -45 degrees (within 1e-9 degrees).',
      });
    }
  }
  if (angles.length > 0 && angles[angles.length - 1] !== undefined) {
    if (Math.abs((angles[angles.length - 1] as number) - 45) > BALLPARK_LIMITS.fenceAngleToleranceDeg) {
      errors.push({
        path: `${path}[${angles.length - 1}].angleDeg`,
        code: 'literal',
        message: 'The last fence anchor must be exactly +45 degrees (within 1e-9 degrees).',
      });
    }
  }
  for (let index = 1; index < angles.length; index++) {
    const previous = angles[index - 1];
    const current = angles[index];
    if (previous !== undefined && current !== undefined && current <= previous) {
      errors.push({
        path: `${path}[${index}].angleDeg`,
        code: current === previous ? 'duplicate' : 'order',
        message: 'Fence angles must be strictly increasing with no duplicates.',
      });
    }
  }
}

const PALETTE_KEYS = [
  'grass',
  'grassAlt',
  'dirt',
  'wall',
  'wallTrim',
  'stands',
  'sky',
  'skyNight',
  'structure',
] as const;

function validatePalette(value: unknown, errors: BallparkValidationIssue[]): void {
  const path = '$.stadium.palette';
  const object = recordAt(value, path, errors);
  if (!object) return;
  exactKeys(object, PALETTE_KEYS, PALETTE_KEYS, path, errors);
  for (const key of PALETTE_KEYS) finiteNumberField(object, key, path, errors, { min: 0, max: 0xffffff }, true);
}

function validateStadium(value: unknown, errors: BallparkValidationIssue[]): void {
  const path = '$.stadium';
  const object = recordAt(value, path, errors);
  if (!object) return;
  const keys = [
    'id',
    'name',
    'city',
    'blurb',
    'fence',
    'carry',
    'windMps',
    'domed',
    'turf',
    'palette',
    'skyline',
  ] as const;
  exactKeys(object, keys, keys, path, errors);
  const id = stringField(object, 'id', path, errors, { nonempty: true, max: 64 });
  if (id !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    errors.push({
      path: `${path}.id`,
      code: 'format',
      message: 'ID must be a lowercase slug containing letters, digits, and single hyphens.',
    });
  }
  stringField(object, 'name', path, errors, { nonempty: true, max: 100 });
  stringField(object, 'city', path, errors, { nonempty: true, max: 100 });
  stringField(object, 'blurb', path, errors, { nonempty: true, max: 500 });
  validateFence(object.fence, errors);
  finiteNumberField(object, 'carry', path, errors, BALLPARK_LIMITS.carry);

  const windPath = `${path}.windMps`;
  const wind = recordAt(object.windMps, windPath, errors);
  if (wind) {
    const windKeys = ['x', 'z'] as const;
    exactKeys(wind, windKeys, windKeys, windPath, errors);
    finiteNumberField(wind, 'x', windPath, errors, BALLPARK_LIMITS.windMps);
    finiteNumberField(wind, 'z', windPath, errors, BALLPARK_LIMITS.windMps);
  }
  booleanField(object, 'domed', path, errors);
  booleanField(object, 'turf', path, errors);
  validatePalette(object.palette, errors);
  const skyline = stringField(object, 'skyline', path, errors);
  if (skyline !== undefined && !BALLPARK_SKYLINES.includes(skyline as BallparkSkyline)) {
    errors.push({
      path: `${path}.skyline`,
      code: 'literal',
      message: `Unsupported skyline. Expected one of: ${BALLPARK_SKYLINES.join(', ')}.`,
    });
  }
}

function validatePresentation(value: unknown, errors: BallparkValidationIssue[]): void {
  const path = '$.presentation';
  const object = recordAt(value, path, errors);
  if (!object) return;
  const keys = ['stands', 'batterEye', 'scoreboard', 'lightTowers'] as const;
  exactKeys(object, keys, [], path, errors);

  if (object.stands !== undefined) {
    const itemPath = `${path}.stands`;
    const stands = recordAt(object.stands, itemPath, errors);
    if (stands) {
      const itemKeys = ['depthScale', 'heightScale', 'tiers'] as const;
      exactKeys(stands, itemKeys, itemKeys, itemPath, errors);
      finiteNumberField(stands, 'depthScale', itemPath, errors, BALLPARK_LIMITS.standsScale);
      finiteNumberField(stands, 'heightScale', itemPath, errors, BALLPARK_LIMITS.standsScale);
      const tiers = finiteNumberField(stands, 'tiers', itemPath, errors, { min: 1, max: 3 }, true);
      if (tiers !== undefined && tiers !== 1 && tiers !== 2 && tiers !== 3) {
        errors.push({ path: `${itemPath}.tiers`, code: 'literal', message: 'Tiers must be 1, 2, or 3.' });
      }
    }
  }

  if (object.batterEye !== undefined) {
    const itemPath = `${path}.batterEye`;
    const eye = recordAt(object.batterEye, itemPath, errors);
    if (eye) {
      const itemKeys = ['startAngleDeg', 'endAngleDeg', 'heightM', 'depthM'] as const;
      exactKeys(eye, itemKeys, itemKeys, itemPath, errors);
      const start = finiteNumberField(eye, 'startAngleDeg', itemPath, errors, { min: -45, max: 45 });
      const end = finiteNumberField(eye, 'endAngleDeg', itemPath, errors, { min: -45, max: 45 });
      if (start !== undefined && end !== undefined && start >= end) {
        errors.push({
          path: `${itemPath}.endAngleDeg`,
          code: 'order',
          message: 'Batter-eye end angle must be greater than its start angle.',
        });
      }
      finiteNumberField(eye, 'heightM', itemPath, errors, BALLPARK_LIMITS.batterEyeHeightM);
      finiteNumberField(eye, 'depthM', itemPath, errors, BALLPARK_LIMITS.batterEyeDepthM);
    }
  }

  if (object.scoreboard !== undefined) {
    const itemPath = `${path}.scoreboard`;
    const board = recordAt(object.scoreboard, itemPath, errors);
    if (board) {
      const itemKeys = ['angleDeg', 'distanceBeyondFenceM', 'widthM', 'heightM', 'elevationM'] as const;
      exactKeys(board, itemKeys, itemKeys, itemPath, errors);
      finiteNumberField(board, 'angleDeg', itemPath, errors, { min: -45, max: 45 });
      finiteNumberField(board, 'distanceBeyondFenceM', itemPath, errors, BALLPARK_LIMITS.scoreboardOffsetM);
      finiteNumberField(board, 'widthM', itemPath, errors, BALLPARK_LIMITS.scoreboardWidthM);
      finiteNumberField(board, 'heightM', itemPath, errors, BALLPARK_LIMITS.scoreboardHeightM);
      finiteNumberField(board, 'elevationM', itemPath, errors, BALLPARK_LIMITS.scoreboardElevationM);
    }
  }

  if (object.lightTowers !== undefined) {
    const listPath = `${path}.lightTowers`;
    if (!Array.isArray(object.lightTowers)) {
      errors.push({ path: listPath, code: 'type', message: 'Expected an array of light towers.' });
    } else {
      if (object.lightTowers.length > BALLPARK_LIMITS.lightTowers.max) {
        errors.push({
          path: listPath,
          code: 'range',
          message: `At most ${BALLPARK_LIMITS.lightTowers.max} light towers are supported.`,
        });
      }
      for (let index = 0; index < object.lightTowers.length; index++) {
        const itemPath = `${listPath}[${index}]`;
        const tower = recordAt(object.lightTowers[index], itemPath, errors);
        if (!tower) continue;
        const itemKeys = ['angleDeg', 'distanceBeyondFenceM', 'heightM'] as const;
        exactKeys(tower, itemKeys, itemKeys, itemPath, errors);
        finiteNumberField(tower, 'angleDeg', itemPath, errors, { min: -45, max: 45 });
        finiteNumberField(tower, 'distanceBeyondFenceM', itemPath, errors, BALLPARK_LIMITS.lightTowerOffsetM);
        finiteNumberField(tower, 'heightM', itemPath, errors, BALLPARK_LIMITS.lightTowerHeightM);
      }
    }
  }
}

function validateAuthoring(value: unknown, errors: BallparkValidationIssue[]): void {
  const path = '$.authoring';
  const object = recordAt(value, path, errors);
  if (!object) return;
  const keys = ['author', 'notes', 'pascalSceneVersion', 'exportedAt'] as const;
  exactKeys(object, keys, [], path, errors);
  for (const key of keys) {
    if (object[key] !== undefined) stringField(object, key, path, errors, { max: key === 'notes' ? 2000 : 200 });
  }
  if (
    typeof object.exportedAt === 'string' &&
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(object.exportedAt)
  ) {
    errors.push({
      path: `${path}.exportedAt`,
      code: 'format',
      message: 'exportedAt must be an ISO-8601 UTC timestamp ending in Z.',
    });
  }
}

export function validateBallparkAsset(value: unknown): BallparkValidationResult {
  const errors: BallparkValidationIssue[] = [];
  const root = recordAt(value, '$', errors);
  if (!root) return { ok: false, errors };
  const keys = ['schema', 'version', 'units', 'coordinateSystem', 'stadium', 'presentation', 'authoring'] as const;
  const required = ['schema', 'version', 'units', 'coordinateSystem', 'stadium'] as const;
  exactKeys(root, keys, required, '$', errors);
  literalField(root, 'schema', BALLPARK_SCHEMA, '$', errors);
  literalField(root, 'version', BALLPARK_VERSION, '$', errors);
  literalField(root, 'units', BALLPARK_UNITS, '$', errors);
  validateCoordinateSystem(root.coordinateSystem, errors);
  validateStadium(root.stadium, errors);
  if (root.presentation !== undefined) validatePresentation(root.presentation, errors);
  if (root.authoring !== undefined) validateAuthoring(root.authoring, errors);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, asset: canonicalBallparkAsset(value as MbdBallparkAssetV1), errors: [] };
}

function normalNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

/** Returns a deep, stable-key-order copy suitable for deterministic serialization. */
export function canonicalBallparkAsset(
  asset: MbdBallparkAssetV1,
  options: { omitVolatileAuthoring?: boolean } = {},
): MbdBallparkAssetV1 {
  const presentation = asset.presentation;
  const authoring = asset.authoring;
  return {
    schema: BALLPARK_SCHEMA,
    version: BALLPARK_VERSION,
    units: BALLPARK_UNITS,
    coordinateSystem: { ...BALLPARK_COORDINATE_SYSTEM },
    stadium: {
      id: asset.stadium.id,
      name: asset.stadium.name,
      city: asset.stadium.city,
      blurb: asset.stadium.blurb,
      fence: asset.stadium.fence.map((anchor) => ({
        angleDeg: normalNumber(anchor.angleDeg),
        distanceM: normalNumber(anchor.distanceM),
        heightM: normalNumber(anchor.heightM),
      })),
      carry: normalNumber(asset.stadium.carry),
      windMps: { x: normalNumber(asset.stadium.windMps.x), z: normalNumber(asset.stadium.windMps.z) },
      domed: asset.stadium.domed,
      turf: asset.stadium.turf,
      palette: {
        grass: asset.stadium.palette.grass,
        grassAlt: asset.stadium.palette.grassAlt,
        dirt: asset.stadium.palette.dirt,
        wall: asset.stadium.palette.wall,
        wallTrim: asset.stadium.palette.wallTrim,
        stands: asset.stadium.palette.stands,
        sky: asset.stadium.palette.sky,
        skyNight: asset.stadium.palette.skyNight,
        structure: asset.stadium.palette.structure,
      },
      skyline: asset.stadium.skyline,
    },
    ...(presentation
      ? {
          presentation: {
            ...(presentation.stands
              ? {
                  stands: {
                    depthScale: normalNumber(presentation.stands.depthScale),
                    heightScale: normalNumber(presentation.stands.heightScale),
                    tiers: presentation.stands.tiers,
                  },
                }
              : {}),
            ...(presentation.batterEye
              ? {
                  batterEye: {
                    startAngleDeg: normalNumber(presentation.batterEye.startAngleDeg),
                    endAngleDeg: normalNumber(presentation.batterEye.endAngleDeg),
                    heightM: normalNumber(presentation.batterEye.heightM),
                    depthM: normalNumber(presentation.batterEye.depthM),
                  },
                }
              : {}),
            ...(presentation.scoreboard
              ? {
                  scoreboard: {
                    angleDeg: normalNumber(presentation.scoreboard.angleDeg),
                    distanceBeyondFenceM: normalNumber(presentation.scoreboard.distanceBeyondFenceM),
                    widthM: normalNumber(presentation.scoreboard.widthM),
                    heightM: normalNumber(presentation.scoreboard.heightM),
                    elevationM: normalNumber(presentation.scoreboard.elevationM),
                  },
                }
              : {}),
            ...(presentation.lightTowers
              ? {
                  lightTowers: presentation.lightTowers.map((tower) => ({
                    angleDeg: normalNumber(tower.angleDeg),
                    distanceBeyondFenceM: normalNumber(tower.distanceBeyondFenceM),
                    heightM: normalNumber(tower.heightM),
                  })),
                }
              : {}),
          },
        }
      : {}),
    ...(authoring
      ? {
          authoring: {
            ...(authoring.author !== undefined ? { author: authoring.author } : {}),
            ...(authoring.notes !== undefined ? { notes: authoring.notes } : {}),
            ...(authoring.pascalSceneVersion !== undefined
              ? { pascalSceneVersion: authoring.pascalSceneVersion }
              : {}),
            ...(!options.omitVolatileAuthoring && authoring.exportedAt !== undefined
              ? { exportedAt: authoring.exportedAt }
              : {}),
          },
        }
      : {}),
  };
}

export function serializeBallparkAsset(asset: MbdBallparkAssetV1, pretty = true): string {
  return `${JSON.stringify(canonicalBallparkAsset(asset), null, pretty ? 2 : 0)}\n`;
}

/** Stable non-security content receipt; volatile authoring.exportedAt is deliberately excluded. */
export function hashBallparkAsset(asset: MbdBallparkAssetV1): string {
  const content = JSON.stringify(canonicalBallparkAsset(asset, { omitVolatileAuthoring: true }));
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < content.length; index++) {
    hash ^= BigInt(content.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return `fnv1a64-${hash.toString(16).padStart(16, '0')}`;
}

export class BallparkAssetError extends Error {
  constructor(readonly issues: BallparkValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
    this.name = 'BallparkAssetError';
  }
}

export function stadiumToBallparkAsset(
  stadium: Stadium,
  presentation?: BallparkPresentationV1,
): MbdBallparkAssetV1 {
  const asset: MbdBallparkAssetV1 = {
    schema: BALLPARK_SCHEMA,
    version: BALLPARK_VERSION,
    units: BALLPARK_UNITS,
    coordinateSystem: { ...BALLPARK_COORDINATE_SYSTEM },
    stadium: {
      id: stadium.id,
      name: stadium.name,
      city: stadium.city,
      blurb: stadium.blurb,
      fence: stadium.fence.map((node) => ({
        angleDeg: node.angle,
        distanceM: node.dist,
        heightM: node.height,
      })),
      carry: stadium.carry,
      windMps: { x: stadium.wind.x, z: stadium.wind.z },
      domed: stadium.domed,
      turf: stadium.turf,
      palette: { ...stadium.palette },
      skyline: stadium.skyline,
    },
    ...(presentation ? { presentation } : {}),
  };
  const result = validateBallparkAsset(asset);
  if (!result.ok) throw new BallparkAssetError(result.errors);
  return result.asset;
}

export function ballparkAssetToStadium(value: unknown): Stadium {
  const result = validateBallparkAsset(value);
  if (!result.ok) throw new BallparkAssetError(result.errors);
  const source = result.asset.stadium;
  return {
    id: source.id,
    name: source.name,
    city: source.city,
    blurb: source.blurb,
    fence: source.fence.map((anchor) => ({
      angle: anchor.angleDeg,
      dist: anchor.distanceM,
      height: anchor.heightM,
    })),
    carry: source.carry,
    wind: { x: source.windMps.x, z: source.windMps.z },
    domed: source.domed,
    turf: source.turf,
    palette: { ...source.palette },
    skyline: source.skyline,
  };
}

export function presentationFromBallparkAsset(value: unknown): BallparkPresentationV1 | undefined {
  const result = validateBallparkAsset(value);
  if (!result.ok) throw new BallparkAssetError(result.errors);
  return result.asset.presentation;
}
