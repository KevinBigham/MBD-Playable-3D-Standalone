import type { GameEvent } from '../sim/state';
import type { ReplayHighlightKind } from './contract';

export type ReplayCueKind = 'contact' | 'catch' | 'wall' | 'homerun' | 'bigplay' | 'gameover';

export interface ReplaySemanticCue {
  time: number;
  kind: ReplayCueKind;
  power: number;
}

export interface HighlightCandidate {
  kind: ReplayHighlightKind;
  eventTime: number;
  startTime: number;
  endTime: number;
  importance: number;
  primaryActor: number;
  sequenceId: string;
}

const CUE_KINDS = new Set<ReplayCueKind>(['contact', 'catch', 'wall', 'homerun', 'bigplay', 'gameover']);

export class SemanticCueBuffer {
  private readonly cues: ReplaySemanticCue[] = [];
  constructor(private readonly capacity = 128) {}

  clear(): void {
    this.cues.length = 0;
  }

  observe(event: GameEvent, time: number): void {
    if (!CUE_KINDS.has(event.kind as ReplayCueKind)) return;
    this.cues.push({ time, kind: event.kind as ReplayCueKind, power: event.power ?? 0.5 });
    if (this.cues.length > this.capacity) this.cues.splice(0, this.cues.length - this.capacity);
  }

  between(start: number, end: number): ReplaySemanticCue[] {
    return this.cues.filter((cue) => cue.time >= start && cue.time <= end).map((cue) => ({ ...cue }));
  }
}

/** Chooses only exceptional, reliably detectable plays. It never reads or
 * writes simulation state, so highlight policy cannot affect game outcomes. */
export class ReplayHighlightSelector {
  private pending: HighlightCandidate | null = null;

  clear(): void {
    this.pending = null;
  }

  observe(event: GameEvent, time: number, primaryActor = -1): HighlightCandidate | null {
    let next: HighlightCandidate | null = null;
    const power = event.power ?? 0.5;
    if (event.kind === 'homerun') {
      next = {
        kind: 'home-run', eventTime: time, startTime: time - 4.2, endTime: time + 0.9,
        importance: 0.92, primaryActor, sequenceId: 'home-run-primary',
      };
    } else if (event.kind === 'catch' && power >= 0.8) {
      next = {
        kind: 'great-catch', eventTime: time, startTime: time - 3.4, endTime: time + 0.65,
        importance: 0.86 + power * 0.05, primaryActor, sequenceId: 'great-catch-primary',
      };
    } else if (event.kind === 'bigplay' && power >= 0.8) {
      next = {
        kind: 'great-catch', eventTime: time, startTime: time - 3.4, endTime: time + 0.65,
        importance: 0.84 + power * 0.05, primaryActor, sequenceId: 'great-catch-primary',
      };
    } else if (event.kind === 'gameover') {
      next = {
        kind: 'final-out', eventTime: time, startTime: time - 4.5, endTime: time + 0.45,
        importance: 1, primaryActor, sequenceId: 'final-out-primary',
      };
    }
    if (next && (!this.pending || next.importance >= this.pending.importance)) this.pending = next;
    return next;
  }

  ready(newestFrameTime: number, safePhase: boolean): HighlightCandidate | null {
    if (!this.pending || !safePhase || newestFrameTime < this.pending.endTime) return null;
    const result = this.pending;
    this.pending = null;
    return result;
  }

  peek(): HighlightCandidate | null {
    return this.pending;
  }
}
