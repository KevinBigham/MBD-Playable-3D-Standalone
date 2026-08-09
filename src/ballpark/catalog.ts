import {
  BallparkAssetError,
  canonicalBallparkAsset,
  type BallparkValidationIssue,
  type MbdBallparkAssetV1,
  validateBallparkAsset,
} from './contract';

export const BALLPARK_CATALOG_SCHEMA = 'mbd.ballpark.catalog' as const;
export const BALLPARK_CATALOG_VERSION = 1 as const;

export interface MbdBallparkCatalogV1 {
  schema: typeof BALLPARK_CATALOG_SCHEMA;
  version: typeof BALLPARK_CATALOG_VERSION;
  assets: MbdBallparkAssetV1[];
}

export type BallparkCatalogValidationResult =
  | { ok: true; catalog: MbdBallparkCatalogV1; errors: [] }
  | { ok: false; errors: BallparkValidationIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateBallparkCatalog(value: unknown): BallparkCatalogValidationResult {
  const errors: BallparkValidationIssue[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: [{ path: '$', code: 'type', message: 'Expected a catalog object.' }] };
  }
  const allowed = new Set(['schema', 'version', 'assets']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push({
        path: `$.${key}`,
        code: 'unknown',
        message: `Unknown catalog field '${key}'.`,
      });
    }
  }
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      errors.push({ path: `$.${key}`, code: 'missing', message: 'Required catalog field is missing.' });
    }
  }
  if (value.schema !== BALLPARK_CATALOG_SCHEMA && value.schema !== undefined) {
    errors.push({
      path: '$.schema',
      code: 'literal',
      message: `Expected ${JSON.stringify(BALLPARK_CATALOG_SCHEMA)}.`,
    });
  }
  if (value.version !== BALLPARK_CATALOG_VERSION && value.version !== undefined) {
    errors.push({
      path: '$.version',
      code: 'literal',
      message: `Unsupported catalog version; expected ${BALLPARK_CATALOG_VERSION}.`,
    });
  }
  const assets: MbdBallparkAssetV1[] = [];
  if (!Array.isArray(value.assets)) {
    if (value.assets !== undefined) {
      errors.push({ path: '$.assets', code: 'type', message: 'Expected an array of ballpark assets.' });
    }
  } else {
    const ids = new Set<string>();
    for (let index = 0; index < value.assets.length; index++) {
      const result = validateBallparkAsset(value.assets[index]);
      if (!result.ok) {
        errors.push(
          ...result.errors.map((issue) => ({
            ...issue,
            path: issue.path === '$' ? `$.assets[${index}]` : `$.assets[${index}]${issue.path.slice(1)}`,
          })),
        );
        continue;
      }
      if (ids.has(result.asset.stadium.id)) {
        errors.push({
          path: `$.assets[${index}].stadium.id`,
          code: 'duplicate',
          message: `Duplicate stadium ID '${result.asset.stadium.id}' in promoted catalog.`,
        });
      }
      ids.add(result.asset.stadium.id);
      assets.push(result.asset);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    catalog: { schema: BALLPARK_CATALOG_SCHEMA, version: BALLPARK_CATALOG_VERSION, assets },
    errors: [],
  };
}

export function parseBallparkCatalog(value: unknown): MbdBallparkCatalogV1 {
  const result = validateBallparkCatalog(value);
  if (!result.ok) throw new BallparkAssetError(result.errors);
  return result.catalog;
}

export function serializeBallparkCatalog(catalog: MbdBallparkCatalogV1): string {
  const result = validateBallparkCatalog(catalog);
  if (!result.ok) throw new BallparkAssetError(result.errors);
  const canonical: MbdBallparkCatalogV1 = {
    schema: BALLPARK_CATALOG_SCHEMA,
    version: BALLPARK_CATALOG_VERSION,
    assets: result.catalog.assets.map((asset) => canonicalBallparkAsset(asset)),
  };
  return `${JSON.stringify(canonical, null, 2)}\n`;
}
