import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseBroadcastSequenceV1 } from '../../../src/replay/contract';

const repo = resolve(import.meta.dirname, '../../..');
const id = process.argv[2] ?? 'home-run-primary';
const staged = resolve(repo, `broadcast-staging/${id}.json`);
const parsed = parseBroadcastSequenceV1(JSON.parse(readFileSync(staged, 'utf8')));
if (parsed.id !== id) throw new Error(`staged id ${parsed.id} does not match requested ${id}`);
const destination = resolve(repo, `src/assets/broadcast/${id}.json`);
writeFileSync(destination, `${JSON.stringify(parsed, null, 2)}\n`);
console.log(`promoted validated ${id} -> ${destination}`);
