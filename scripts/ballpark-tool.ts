import { randomUUID } from 'node:crypto';
import { deepStrictEqual } from 'node:assert';
import { mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BALLPARK_ASSETS } from '../src/ballpark/assets';
import {
  BALLPARK_CATALOG_SCHEMA,
  parseBallparkCatalog,
  serializeBallparkCatalog,
  validateBallparkCatalog,
  type MbdBallparkCatalogV1,
} from '../src/ballpark/catalog';
import {
  BallparkAssetError,
  ballparkAssetToStadium,
  type MbdBallparkAssetV1,
  stadiumToBallparkAsset,
  validateBallparkAsset,
} from '../src/ballpark/contract';
import { buildParkImpactReport } from '../src/ballpark/impact';
import { STADIUMS } from '../src/data/stadiums';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = path.join(ROOT, 'src/assets/ballparks/catalog.json');
const STAGING_PATH = path.join(ROOT, 'ballpark-staging');

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function printIssues(errors: Array<{ path: string; message: string }>): void {
  for (const error of errors) console.error(`${error.path}: ${error.message}`);
}

async function readJson(filename: string): Promise<unknown> {
  const content = await readFile(filename, 'utf8');
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(`${filename}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assetFromJson(value: unknown, id?: string): MbdBallparkAssetV1 {
  if (typeof value === 'object' && value !== null && (value as { schema?: unknown }).schema === BALLPARK_CATALOG_SCHEMA) {
    const catalog = parseBallparkCatalog(value);
    if (!id) throw new Error('A catalog input requires --id <stadium-id>.');
    const asset = catalog.assets.find((candidate) => candidate.stadium.id === id);
    if (!asset) throw new Error(`Catalog does not contain stadium '${id}'.`);
    return asset;
  }
  const result = validateBallparkAsset(value);
  if (!result.ok) throw new BallparkAssetError(result.errors);
  return result.asset;
}

async function validateFile(filename: string): Promise<void> {
  const value = await readJson(filename);
  if (typeof value === 'object' && value !== null && (value as { schema?: unknown }).schema === BALLPARK_CATALOG_SCHEMA) {
    const result = validateBallparkCatalog(value);
    if (!result.ok) {
      printIssues(result.errors);
      throw new Error(`Catalog validation failed: ${filename}`);
    }
    console.log(`VALID catalog ${path.relative(ROOT, filename)} (${result.catalog.assets.length} assets)`);
    return;
  }
  const result = validateBallparkAsset(value);
  if (!result.ok) {
    printIssues(result.errors);
    throw new Error(`Asset validation failed: ${filename}`);
  }
  console.log(`VALID asset ${path.relative(ROOT, filename)} (${result.asset.stadium.id})`);
}

async function validateCommand(): Promise<void> {
  const requested = option('--asset');
  if (requested) {
    await validateFile(path.resolve(ROOT, requested));
    return;
  }
  await validateFile(CATALOG_PATH);
  try {
    const staged = (await readdir(STAGING_PATH)).filter((name) => name.endsWith('.json')).sort();
    for (const name of staged) await validateFile(path.join(STAGING_PATH, name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function roundtripCommand(): void {
  for (const stadium of STADIUMS) {
    const sourceAsset = BALLPARK_ASSETS.find((asset) => asset.stadium.id === stadium.id);
    if (!sourceAsset) throw new Error(`Native stadium '${stadium.id}' has no source asset.`);
    const exported = stadiumToBallparkAsset(stadium, sourceAsset.presentation);
    const validation = validateBallparkAsset(exported);
    if (!validation.ok) throw new BallparkAssetError(validation.errors);
    const imported = ballparkAssetToStadium(validation.asset);
    deepStrictEqual(imported, stadium);
  }
  console.log(`ROUNDTRIP ${STADIUMS.length}/${STADIUMS.length} native stadiums semantically equal`);
}

async function assertStagedAsset(filename: string): Promise<string> {
  const stagingReal = await realpath(STAGING_PATH);
  const assetReal = await realpath(filename);
  if (assetReal !== stagingReal && !assetReal.startsWith(`${stagingReal}${path.sep}`)) {
    throw new Error(`Promotion only accepts validated exports inside ${STAGING_PATH}.`);
  }
  return assetReal;
}

async function promoteCommand(): Promise<void> {
  const requested = option('--asset');
  if (!requested) throw new Error('Usage: npm run ballpark:promote -- --asset ballpark-staging/<id>.json [--replace]');
  const filename = await assertStagedAsset(path.resolve(ROOT, requested));
  const candidate = assetFromJson(await readJson(filename));
  const current = parseBallparkCatalog(await readJson(CATALOG_PATH));
  const duplicateIndex = current.assets.findIndex((asset) => asset.stadium.id === candidate.stadium.id);
  if (duplicateIndex >= 0 && !flag('--replace')) {
    throw new Error(`Stadium '${candidate.stadium.id}' already exists; pass --replace for an explicit safe replacement.`);
  }
  const assets = [...current.assets];
  if (duplicateIndex >= 0) assets[duplicateIndex] = candidate;
  else assets.push(candidate);
  const next: MbdBallparkCatalogV1 = { ...current, assets };
  const serialized = serializeBallparkCatalog(next);

  await mkdir(path.dirname(CATALOG_PATH), { recursive: true });
  const temporary = path.join(path.dirname(CATALOG_PATH), `.${path.basename(CATALOG_PATH)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, CATALOG_PATH);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(`${duplicateIndex >= 0 ? 'REPLACED' : 'PROMOTED'} ${candidate.stadium.id} -> ${path.relative(ROOT, CATALOG_PATH)}`);
}

async function impactCommand(): Promise<void> {
  const requested = option('--asset');
  if (!requested) throw new Error('Usage: npm run ballpark:impact -- --asset <asset-or-catalog.json> [--id id] --seed 12345 --samples 10000');
  const asset = assetFromJson(await readJson(path.resolve(ROOT, requested)), option('--id'));
  const stadium = ballparkAssetToStadium(asset);
  const seed = Number(option('--seed') ?? 12345);
  const samples = Number(option('--samples') ?? 10_000);
  const report = buildParkImpactReport(asset, stadium, STADIUMS, { seed, samples });
  console.log(JSON.stringify(report, null, 2));
}

async function main(): Promise<void> {
  const command = process.argv[2];
  switch (command) {
    case 'validate':
      await validateCommand();
      break;
    case 'roundtrip':
      roundtripCommand();
      break;
    case 'promote':
      await promoteCommand();
      break;
    case 'impact':
      await impactCommand();
      break;
    default:
      throw new Error('Expected one of: validate, roundtrip, promote, impact');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
