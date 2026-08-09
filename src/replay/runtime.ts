import * as THREE from 'three';
import homeRunRaw from '../assets/broadcast/home-run-primary.json';
import greatCatchRaw from '../assets/broadcast/great-catch-primary.json';
import finalOutRaw from '../assets/broadcast/final-out-primary.json';
import type { GameEvent, GameState, Phase } from '../sim/state';
import { GameWorld, WORLD_PRESENTATION_FLOATS, WORLD_QUATERNION_OFFSETS } from '../render/world';
import type { CameraDirectorState } from '../render/camera';
import { PresentationRingBuffer } from './buffer';
import {
  type BroadcastSequenceV1,
  type BroadcastShotV1,
  parseBroadcastSequenceV1,
  type ReplayAnchor,
  type ReplayHighlightKind,
} from './contract';
import {
  type HighlightCandidate,
  ReplayHighlightSelector,
  type ReplaySemanticCue,
  SemanticCueBuffer,
} from './highlights';

export type AutomaticReplayMode = 'off' | 'short' | 'full';

export interface ReplayFrameInfo {
  kind: ReplayHighlightKind;
  label: string;
  progress: number;
  inning: number;
  half: 'top' | 'bottom';
  outs: number;
  awayRuns: number;
  homeRuns: number;
}

export interface ReplayRuntimeHooks {
  onStart(info: ReplayFrameInfo): void;
  onFrame(info: ReplayFrameInfo): void;
  onEnd(): void;
  onCue(cue: ReplaySemanticCue): void;
}

const UI_FLOATS = 7;
const FRAME_FLOATS = WORLD_PRESENTATION_FLOATS + UI_FLOATS;
const END_HOLD = 0.22;
const SEQUENCES = [homeRunRaw, greatCatchRaw, finalOutRaw]
  .map(parseBroadcastSequenceV1)
  .reduce<Record<string, BroadcastSequenceV1>>((map, sequence) => {
    map[sequence.id] = sequence;
    return map;
  }, {});

function ease(kind: BroadcastShotV1['ease'], t: number): number {
  const k = Math.max(0, Math.min(1, t));
  if (kind === 'smoothstep') return k * k * (3 - 2 * k);
  if (kind === 'ease-in-out-cubic') return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  return k;
}

function addLerp(target: THREE.Vector3, base: THREE.Vector3, from: readonly number[], to: readonly number[], t: number): void {
  target.set(
    base.x + from[0] + (to[0] - from[0]) * t,
    base.y + from[1] + (to[1] - from[1]) * t,
    base.z + from[2] + (to[2] - from[2]) * t,
  );
}

export class ReplayRuntime {
  readonly buffer = new PresentationRingBuffer({ seconds: 12, hz: 30, floatCount: FRAME_FLOATS });
  private readonly selector = new ReplayHighlightSelector();
  private readonly cueBuffer = new SemanticCueBuffer();
  private readonly sample = new Float32Array(FRAME_FLOATS);
  private readonly anchor = new THREE.Vector3();
  private readonly lookAnchor = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private liveTime = 0;
  private lastCapture = -Infinity;
  private playhead = 0;
  private sourceStart = 0;
  private sourceEnd = 0;
  private candidate: HighlightCandidate | null = null;
  private sequence: BroadcastSequenceV1 | null = null;
  private cues: ReplaySemanticCue[] = [];
  private cueIndex = 0;
  private savedDirector: CameraDirectorState | null = null;
  private mode: AutomaticReplayMode = 'full';
  private freeCameraPaused = false;

  constructor(
    private readonly world: GameWorld,
    private readonly hooks: ReplayRuntimeHooks,
  ) {}

  get active(): boolean {
    return this.candidate !== null;
  }

  reset(): void {
    if (this.active) this.finish();
    this.buffer.clear();
    this.selector.clear();
    this.cueBuffer.clear();
    this.liveTime = 0;
    this.lastCapture = -Infinity;
    this.cues = [];
    this.cueIndex = 0;
  }

  capture(dt: number, state: GameState, mode: AutomaticReplayMode): void {
    if (this.active) return;
    this.mode = mode;
    this.liveTime += Math.max(0, dt);
    const interval = 1 / this.buffer.hz;
    if (this.buffer.size && this.liveTime - this.lastCapture < interval) return;
    this.lastCapture = this.liveTime;
    this.buffer.push(this.liveTime, (target) => {
      this.world.writePresentationFrame(target);
      let offset = WORLD_PRESENTATION_FLOATS;
      target[offset++] = state.inning;
      target[offset++] = state.half === 'top' ? 0 : 1;
      target[offset++] = state.outs;
      target[offset++] = state.balls;
      target[offset++] = state.strikes;
      target[offset++] = state.stats.away.runs;
      target[offset] = state.stats.home.runs;
    });
  }

  observe(event: GameEvent, state: GameState): void {
    if (this.active) return;
    this.cueBuffer.observe(event, this.liveTime);
    const x = event.x ?? state.ball.x;
    const z = event.z ?? state.ball.z;
    const primary = this.world.nearestReplayActor(x, z);
    this.selector.observe(event, this.liveTime, primary);
  }

  maybeStart(phase: Phase): boolean {
    if (this.active || this.mode === 'off' || this.buffer.size < 2) return false;
    const safe = phase === 'deadball' || phase === 'final' || phase === 'inningbreak';
    const candidate = this.selector.ready(this.buffer.newestTime(), safe);
    if (!candidate) return false;
    return this.startCandidate(candidate);
  }

  /** Visual-regression hook: plays the current recorded presentation through a
   * real production sequence without manufacturing or mutating a game event. */
  preview(kind: ReplayHighlightKind): boolean {
    if (this.active || this.buffer.size < 2) return false;
    const id = kind === 'home-run' ? 'home-run-primary' : kind === 'great-catch' ? 'great-catch-primary' : 'final-out-primary';
    const end = this.buffer.newestTime();
    return this.startCandidate({
      kind,
      eventTime: end,
      startTime: Math.max(this.buffer.oldestTime(), end - 3.2),
      endTime: end,
      importance: 1,
      primaryActor: this.world.nearestReplayActor(0, 0),
      sequenceId: id,
    });
  }

  private startCandidate(candidate: HighlightCandidate): boolean {
    const sequence = SEQUENCES[candidate.sequenceId];
    if (!sequence) return false;
    this.candidate = candidate;
    this.sequence = sequence;
    const shortStart = candidate.eventTime - 2.35;
    this.sourceStart = Math.max(this.buffer.oldestTime(), this.mode === 'short' ? shortStart : candidate.startTime);
    this.sourceEnd = Math.min(this.buffer.newestTime(), candidate.endTime);
    if (this.sourceEnd - this.sourceStart < 0.3) {
      this.candidate = null;
      this.sequence = null;
      return false;
    }
    this.playhead = 0;
    this.cues = this.cueBuffer.between(this.sourceStart, this.sourceEnd);
    this.cueIndex = 0;
    this.savedDirector = this.world.captureDirectorState();
    this.world.beginReplayEffects();
    const info = this.frameInfo(0);
    this.hooks.onStart(info);
    this.applyAt(this.sourceStart, 0);
    return true;
  }

  update(dt: number): void {
    if (!this.candidate || !this.sequence) return;
    if (this.freeCameraPaused) return;
    this.playhead += Math.max(0, dt);
    const duration = this.sourceEnd - this.sourceStart;
    const sourceTime = Math.min(this.sourceEnd, this.sourceStart + this.playhead);
    const progress = Math.min(1, this.playhead / Math.max(0.001, duration));
    this.applyAt(sourceTime, progress);
    while (this.cueIndex < this.cues.length && this.cues[this.cueIndex].time <= sourceTime) {
      const cue = this.cues[this.cueIndex++];
      this.hooks.onCue(cue);
      this.world.fireReplayCue(cue.kind, cue.power, this.candidate.primaryActor);
    }
    this.world.updateReplayEffects(dt);
    this.hooks.onFrame(this.frameInfo(progress));
    if (this.playhead >= duration + END_HOLD) this.finish();
  }

  skip(): void {
    if (this.active) this.finish();
  }

  pauseForFreeCamera(): boolean {
    if (!this.active || this.freeCameraPaused) return false;
    this.freeCameraPaused = true;
    return true;
  }

  resumeFromFreeCamera(): void {
    if (!this.freeCameraPaused) return;
    this.freeCameraPaused = false;
    if (!this.candidate) return;
    const duration = Math.max(0.001, this.sourceEnd - this.sourceStart);
    this.applyAt(Math.min(this.sourceEnd, this.sourceStart + this.playhead), Math.min(1, this.playhead / duration));
  }

  primaryAnchor(kind: 'ball' | 'athlete' | 'plate', target: THREE.Vector3): boolean {
    if (!this.candidate) return false;
    const anchor: ReplayAnchor = kind === 'ball' ? 'ball' : kind === 'athlete' ? 'primary-actor' : 'home-plate';
    return this.world.replayAnchor(anchor, this.candidate.primaryActor, target);
  }

  actorAnchor(slot: number, target: THREE.Vector3): boolean {
    return !!this.candidate && this.world.replayActorAnchor(slot, target);
  }

  selectableActors(): number[] {
    return this.world.replayActorSlots();
  }

  get freeCameraActive(): boolean {
    return this.freeCameraPaused;
  }

  diagnostics(): { frames: number; seconds: number; bytes: number; hz: number } {
    return {
      frames: this.buffer.size,
      seconds: this.buffer.size / this.buffer.hz,
      bytes: this.buffer.capacity * FRAME_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      hz: this.buffer.hz,
    };
  }

  private applyAt(sourceTime: number, progress: number): void {
    if (!this.candidate || !this.sequence || !this.buffer.sample(sourceTime, this.sample, WORLD_QUATERNION_OFFSETS)) return;
    this.world.applyPresentationFrame(this.sample);
    this.applyCamera(this.sequence, progress, this.candidate.primaryActor);
  }

  private applyCamera(sequence: BroadcastSequenceV1, progress: number, primaryActor: number): void {
    const shot = sequence.shots.find((item) => progress >= item.start && progress <= item.end) ?? sequence.shots.at(-1)!;
    const local = ease(shot.ease, (progress - shot.start) / Math.max(0.001, shot.end - shot.start));
    let anchor: ReplayAnchor = shot.anchor;
    if (!this.world.replayAnchor(anchor, primaryActor, this.anchor)) {
      anchor = shot.fallbackAnchor;
      this.world.replayAnchor(anchor, primaryActor, this.anchor);
    }
    this.lookAnchor.copy(this.anchor);
    if (anchor === 'recorded-camera') {
      this.world.director.camera.getWorldDirection(this.forward);
      this.lookAnchor.addScaledVector(this.forward, 18);
    }
    addLerp(this.eye, this.anchor, shot.eyeFrom, shot.eyeTo, local);
    addLerp(this.look, this.lookAnchor, shot.lookFrom, shot.lookTo, local);
    const fov = shot.fovFrom + (shot.fovTo - shot.fovFrom) * local;
    this.world.setReplayCamera(this.eye, this.look, fov);
  }

  private frameInfo(progress: number): ReplayFrameInfo {
    const offset = WORLD_PRESENTATION_FLOATS;
    return {
      kind: this.candidate?.kind ?? 'home-run',
      label: this.sequence?.label ?? 'Instant Replay',
      progress,
      inning: Math.max(1, Math.round(this.sample[offset] || 1)),
      half: this.sample[offset + 1] >= 0.5 ? 'bottom' : 'top',
      outs: Math.round(this.sample[offset + 2] || 0),
      awayRuns: Math.round(this.sample[offset + 5] || 0),
      homeRuns: Math.round(this.sample[offset + 6] || 0),
    };
  }

  private finish(): void {
    if (!this.candidate) return;
    this.world.beginReplayEffects();
    if (this.savedDirector) this.world.restoreDirectorState(this.savedDirector);
    this.candidate = null;
    this.sequence = null;
    this.savedDirector = null;
    this.cues = [];
    this.cueIndex = 0;
    this.freeCameraPaused = false;
    this.hooks.onEnd();
  }
}
