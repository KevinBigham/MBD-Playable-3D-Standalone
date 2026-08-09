import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = process.cwd();
const excluded = new Set(['node_modules', 'dist', '.git']);
const includedRoots = ['src', 'scripts', 'public', 'tools', 'docs', 'reports', 'README.md', 'ARCHITECTURE.md', 'GAME_DESIGN.md', 'CHANGELOG.md', 'package.json', 'package-lock.json'];

async function walk(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    if (excluded.has(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) result.push(...await walk(child));
    else result.push(child);
  }
  return result;
}

const files: string[] = [];
for (const rootEntry of includedRoots) {
  const path = join(root, rootEntry);
  try { files.push(...(rootEntry.includes('.') ? [path] : await walk(path))); } catch { /* optional legacy doc */ }
}
const lines: string[] = [];
for (const path of [...new Set(files)].sort()) {
  if (relative(root, path).split('\\').join('/') === 'reports/final/FILE_MANIFEST.sha256') continue;
  const hash = createHash('sha256').update(await readFile(path)).digest('hex');
  lines.push(`${hash}  ${relative(root, path).split('\\').join('/')}`);
}
await writeFile(join(root, 'reports/final/FILE_MANIFEST.sha256'), `${lines.join('\n')}\n`);
console.log(`file manifest: ${lines.length} files`);
