import { describe, expect, it } from 'vitest';
import homeRunRaw from '../assets/broadcast/home-run-primary.json';
import { buildLeague, teamById } from '../data/teams';
import { emptyInputPair } from '../sim/input';
import { stepGame } from '../sim/game';
import { createGameState } from '../sim/state';
import { snapshotGame } from '../save/resume';
import { PresentationRingBuffer } from '../replay/buffer';
import { parseBroadcastSequenceV1 } from '../replay/contract';
import { ReplayHighlightSelector, SemanticCueBuffer } from '../replay/highlights';
import { ReplayRuntime } from '../replay/runtime';
import { CameraDirector } from '../render/camera';
import type { GameWorld } from '../render/world';
import type { GameState } from '../sim/state';
import { canUseReplayFreeCamera } from '../replay/free-camera';

describe('native replay contract', () => {
  it('accepts the checked-in home-run sequence', () => {
    const sequence = parseBroadcastSequenceV1(homeRunRaw);
    expect(sequence.id).toBe('home-run-primary');
    expect(sequence.shots.at(-1)?.end).toBe(1);
  });

  it('rejects unknown keys and broken timelines', () => {
    expect(() => parseBroadcastSequenceV1({ ...homeRunRaw, theatreProject: {} })).toThrow(/keys/);
    const broken = structuredClone(homeRunRaw);
    broken.shots[1].start = 0.4;
    expect(() => parseBroadcastSequenceV1(broken)).toThrow(/timeline/);
  });
});

describe('presentation ring buffer', () => {
  it('is bounded and interpolates between the surrounding rendered samples', () => {
    const buffer = new PresentationRingBuffer({ seconds: 1, hz: 2, floatCount: 2 });
    for (let time = 0; time < 4; time++) {
      buffer.push(time, (frame) => frame.set([time, time * 10]));
    }
    expect(buffer.size).toBe(2);
    expect(buffer.oldestTime()).toBe(2);
    const sample = new Float32Array(2);
    expect(buffer.sample(2.5, sample)).toBe(true);
    expect([...sample]).toEqual([2.5, 25]);
  });

  it('slerps packed quaternions, clamps exact boundaries, and remains deterministic after wraparound', () => {
    const buffer = new PresentationRingBuffer({ seconds: 1, hz: 2, floatCount: 4 });
    const q0 = [0, 0, 0, 1];
    const q1 = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
    buffer.push(0, (frame) => frame.set(q0));
    buffer.push(0.5, (frame) => frame.set(q1));
    buffer.push(1, (frame) => frame.set(q0));
    const midpoint = new Float32Array(4);
    expect(buffer.sample(0.75, midpoint, [0])).toBe(true);
    expect(midpoint[1]).toBeCloseTo(Math.sin(Math.PI / 8), 5);
    expect(midpoint[3]).toBeCloseTo(Math.cos(Math.PI / 8), 5);
    const first = new Float32Array(4);
    const last = new Float32Array(4);
    buffer.sample(-1, first, [0]);
    buffer.sample(99, last, [0]);
    expect(first[1]).toBeCloseTo(q1[1], 5);
    expect(first[3]).toBeCloseTo(q1[3], 5);
    expect([...last]).toEqual(q0);
    const repeat = new Float32Array(4);
    buffer.sample(0.75, repeat, [0]);
    expect([...repeat]).toEqual([...midpoint]);
  });
});

describe('highlight selection and semantic audio', () => {
  it('selects exceptional plays but never routine catches', () => {
    const selector = new ReplayHighlightSelector();
    expect(selector.observe({ kind: 'catch', power: 0.5 }, 3)).toBeNull();
    expect(selector.observe({ kind: 'catch', power: 0.95 }, 4, 2)?.kind).toBe('great-catch');
    expect(selector.ready(4.7, false)).toBeNull();
    expect(selector.ready(4.7, true)?.primaryActor).toBe(2);
  });

  it('keeps only semantic cues inside the selected replay window', () => {
    const cues = new SemanticCueBuffer();
    cues.observe({ kind: 'ball', power: 0.2 }, 1);
    cues.observe({ kind: 'contact', power: 0.8 }, 2);
    cues.observe({ kind: 'homerun', power: 1 }, 5);
    expect(cues.between(1.5, 4)).toEqual([{ time: 2, kind: 'contact', power: 0.8 }]);
  });

  it('cannot change a deterministic game while it observes the same seed', () => {
    const league = buildLeague();
    const setup = {
      awayTeamId: 'coralkey',
      homeTeamId: 'ironport',
      stadiumId: 'anchor-yard',
      innings: 3,
      difficulty: 'pro' as const,
      awayControl: 'cpu' as const,
      homeControl: 'cpu' as const,
      night: false,
      seed: 77591,
    };
    const away = teamById(league, setup.awayTeamId);
    const home = teamById(league, setup.homeTeamId);
    const control = createGameState(setup, away, home);
    const observed = createGameState(setup, away, home);
    const inputA = emptyInputPair();
    const inputB = emptyInputPair();
    const selector = new ReplayHighlightSelector();
    let eventId = 0;
    for (let tick = 0; tick < 8_000; tick++) {
      stepGame(control, inputA);
      stepGame(observed, inputB);
      for (const event of observed.events) {
        if ((event.id ?? 0) <= eventId) continue;
        eventId = event.id ?? 0;
        selector.observe(event, tick / 60);
      }
    }
    expect(JSON.stringify(snapshotGame(observed, 'quick'))).toBe(JSON.stringify(snapshotGame(control, 'quick')));
  });
});

describe('replay lifecycle', () => {
  it('allows free camera only while replay has frozen authoritative play', () => {
    expect(canUseReplayFreeCamera(true, true)).toBe(true);
    expect(canUseReplayFreeCamera(true, false)).toBe(false);
    expect(canUseReplayFreeCamera(false, true)).toBe(false);
  });

  it('restores the exact live camera state when a replay is skipped', () => {
    const director = new CameraDirector(16 / 9);
    let restored = 0;
    let started = 0;
    let ended = 0;
    const fakeWorld = {
      director,
      writePresentationFrame: (target: Float32Array) => target.fill(0),
      applyPresentationFrame: () => undefined,
      nearestReplayActor: () => -1,
      captureDirectorState: () => director.captureState(),
      restoreDirectorState: (state: ReturnType<CameraDirector['captureState']>) => {
        restored++;
        director.restoreState(state);
      },
      beginReplayEffects: () => undefined,
      replayAnchor: (_anchor: unknown, _primary: number, target: { set: (x: number, y: number, z: number) => void }) => {
        target.set(0, 0, 0);
        return true;
      },
      setReplayCamera: () => undefined,
      fireReplayCue: () => undefined,
      updateReplayEffects: () => undefined,
    } as unknown as GameWorld;
    const runtime = new ReplayRuntime(fakeWorld, {
      onStart: () => started++,
      onFrame: () => undefined,
      onEnd: () => ended++,
      onCue: () => undefined,
    });
    const state = {
      inning: 1,
      half: 'top',
      outs: 0,
      balls: 0,
      strikes: 0,
      stats: { away: { runs: 0 }, home: { runs: 0 } },
      ball: { x: 0, z: 0 },
    } as GameState;
    for (let i = 0; i < 12; i++) runtime.capture(0.04, state, 'full');
    expect(runtime.preview('home-run')).toBe(true);
    expect(runtime.active).toBe(true);
    expect(runtime.pauseForFreeCamera()).toBe(true);
    runtime.update(4);
    expect(runtime.active).toBe(true);
    expect(runtime.freeCameraActive).toBe(true);
    runtime.resumeFromFreeCamera();
    expect(runtime.freeCameraActive).toBe(false);
    runtime.skip();
    expect(runtime.active).toBe(false);
    expect({ restored, started, ended }).toEqual({ restored: 1, started: 1, ended: 1 });
  });
});
