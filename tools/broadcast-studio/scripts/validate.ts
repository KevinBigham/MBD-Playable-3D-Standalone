import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseBroadcastSequenceV1 } from '../../../src/replay/contract';

const repo = resolve(import.meta.dirname, '../../..');
const staging = resolve(repo, 'broadcast-staging');
const files = readdirSync(staging).filter((file) => file.endsWith('.json')).sort();
if (!files.length) throw new Error('broadcast-staging contains no JSON sequences');
for (const file of files) {
  const parsed = parseBroadcastSequenceV1(JSON.parse(readFileSync(resolve(staging, file), 'utf8')));
  if (`${parsed.id}.json` !== file) throw new Error(`${file} does not match sequence id ${parsed.id}`);
  console.log(`valid ${file}: ${parsed.shots.length} shots, ${parsed.kind}`);
}
