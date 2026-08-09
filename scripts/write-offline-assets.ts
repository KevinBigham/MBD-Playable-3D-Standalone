import { readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = join(process.cwd(), 'dist');

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (!entry.name.endsWith('.map') && entry.name !== 'offline-assets.json') {
      files.push(`./${relative(root, path).split('\\').join('/')}`);
    }
  }
  return files.sort();
}

const assets = await walk(root);
await writeFile(join(root, 'offline-assets.json'), `${JSON.stringify({ version: 1, assets }, null, 2)}\n`);
console.log(`offline precache manifest: ${assets.length} assets`);
