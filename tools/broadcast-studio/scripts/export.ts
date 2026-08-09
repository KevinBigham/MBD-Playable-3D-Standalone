import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import projectState from '../projects/home-run-primary.theatre.json';
import { parseBroadcastSequenceV1 } from '../../../src/replay/contract';
import { createAuthoringProject, nativeFromAuthoring } from '../src/authoring';

const repo = resolve(import.meta.dirname, '../../..');
const authoring = createAuthoringProject(projectState, `MBD Export ${process.pid}`);
await authoring.project.ready;
const native = parseBroadcastSequenceV1(nativeFromAuthoring(authoring));
const out = resolve(repo, `broadcast-staging/${native.id}.json`);
mkdirSync(resolve(repo, 'broadcast-staging'), { recursive: true });
writeFileSync(out, `${JSON.stringify(native, null, 2)}\n`);
console.log(`exported ${native.id} from Theatre project state -> ${out}`);
