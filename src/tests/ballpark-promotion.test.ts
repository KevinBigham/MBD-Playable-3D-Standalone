import { execFile } from 'node:child_process';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const root = process.cwd();
const staging = path.join(root, 'ballpark-staging');
const invalidAsset = path.join(staging, 'invalid-promotion.json');
const catalog = path.join(root, 'src/assets/ballparks/catalog.json');

afterEach(async () => {
  await rm(invalidAsset, { force: true });
});

describe('atomic ballpark promotion', () => {
  it('fails nonzero on invalid input without partially modifying the tracked catalog', async () => {
    await mkdir(staging, { recursive: true });
    await writeFile(invalidAsset, JSON.stringify({ schema: 'mbd.ballpark', version: 99 }), 'utf8');
    const before = await readFile(catalog, 'utf8');
    await expect(
      run(path.join(root, 'node_modules/.bin/tsx'), [
        'scripts/ballpark-tool.ts',
        'promote',
        '--asset',
        path.relative(root, invalidAsset),
      ], { cwd: root }),
    ).rejects.toMatchObject({ code: 1 });
    expect(await readFile(catalog, 'utf8')).toBe(before);
  });
});
