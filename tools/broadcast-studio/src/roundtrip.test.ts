import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import projectState from '../projects/home-run-primary.theatre.json';
import shippingRaw from '../../../src/assets/broadcast/home-run-primary.json';
import { parseBroadcastSequenceV1 } from '../../../src/replay/contract';
import { createAuthoringProject, nativeFromAuthoring } from './authoring';

describe('Theatre to native promotion contract', () => {
  it('exports checked-in Theatre state to the shipping sequence without drift', async () => {
    const authoring = createAuthoringProject(projectState, `MBD Roundtrip ${Date.now()}`);
    await authoring.project.ready;
    const exported = parseBroadcastSequenceV1(nativeFromAuthoring(authoring));
    const roundTrip = parseBroadcastSequenceV1(JSON.parse(JSON.stringify(exported)));
    expect(roundTrip).toEqual(exported);
    expect(exported).toEqual(parseBroadcastSequenceV1(shippingRaw));
  });

  it('keeps Theatre packages out of the production source graph', () => {
    const repo = resolve(import.meta.dirname, '../../..');
    const runtime = [
      readFileSync(resolve(repo, 'src/replay/runtime.ts'), 'utf8'),
      readFileSync(resolve(repo, 'src/replay/contract.ts'), 'utf8'),
    ].join('\n');
    expect(runtime).not.toMatch(/@theatre\//);
  });
});
