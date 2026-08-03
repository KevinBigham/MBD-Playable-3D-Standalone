/**
 * Mr. Baseball Dynasty — audio engine.
 *
 * Everything is synthesised at runtime with the Web Audio API: oscillators,
 * noise buffers filled in JavaScript, biquad filters, envelopes, a waveshaper
 * and a convolution reverb whose impulse response is generated from noise.
 * There are no audio files, no base64 blobs, no network requests.
 *
 * FAILURE POLICY:
 * The engine must never throw into the game loop. If the browser has no
 * AudioContext, or the user never gestures, or resume() rejects, `available` /
 * `unlocked` stay false and every public method is a silent no-op. Nothing here
 * logs on the failure path — a 120 Hz loop calling playSfx would otherwise
 * flood the console.
 *
 * ANTI-FATIGUE:
 * A baseball game triggers the same twenty sounds hundreds of times. Every
 * trigger perturbs detune, filter cutoff, envelope lengths and the read offset
 * into the noise buffer, and each name also walks a small round-robin of
 * hand-tuned variants so the identical variant never plays back-to-back.
 */

import { createMusicRng, createTrack, trackSeed, type MusicTrack, type TrackHandle } from './music';

export type SfxName =
  | 'pitchRelease' | 'catcherMitt' | 'swingMiss' | 'swingWhoosh'
  | 'contactWeak' | 'contactSolid' | 'contactBarrel' | 'bunt' | 'foulTip'
  | 'glove' | 'groundHit' | 'wallHit' | 'throwRelease' | 'slide'
  | 'umpStrike' | 'umpBall' | 'umpOut' | 'umpSafe'
  | 'homerun' | 'strikeout' | 'walk' | 'runScored' | 'bigPlay' | 'error'
  | 'inningChange' | 'gameOver'
  | 'menuMove' | 'menuSelect' | 'menuBack' | 'menuDenied' | 'countdown';

export type { MusicTrack } from './music';

export interface AudioOptions {
  /** 0..1 — scales loudness and brightness. A barrelled ball is not a grounder. */
  power?: number;
  /** -1..1 stereo position. */
  pan?: number;
  /** Multiplier on the sound's base frequency. */
  pitch?: number;
}

/** Hard ceiling on simultaneous synth voices. */
const MAX_VOICES = 24;
/** Convolution tail length; a ballpark is big but not a cathedral. */
const REVERB_SECONDS = 1.9;
/** Default crossfade when switching tracks. */
const DEFAULT_FADE = 0.7;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number): number => clamp(v, 0, 1);
const finite = (v: number, fallback: number): number => (typeof v === 'number' && isFinite(v) ? v : fallback);

/* ------------------------------------------------------------------------- *
 * Node-graph value objects
 * ------------------------------------------------------------------------- */

interface Graph {
  ctx: AudioContext;
  /** Post-fader master; muting rides this. */
  master: GainNode;
  music: GainNode;
  sfx: GainNode;
  crowdBus: GainNode;
  reverbIn: GainNode;
}

interface FilterSpec {
  type?: BiquadFilterType;
  freq: number;
  /** Optional sweep target reached at the end of the envelope. */
  freqEnd?: number;
  q?: number;
}

interface ToneSpec {
  type?: OscillatorType;
  freq: number;
  freqEnd?: number;
  /** Seconds to reach freqEnd; defaults to the full envelope length. */
  glide?: number;
  detune?: number;
  /** Start offset from the trigger time, for multi-note stingers. */
  delay?: number;
  attack?: number;
  hold?: number;
  decay: number;
  gain: number;
  filter?: FilterSpec;
  pan?: number;
  /** 0..1 reverb send. */
  send?: number;
  /** Route through the soft-clip shaper for brass-like bite. */
  shape?: boolean;
}

interface NoiseSpec {
  delay?: number;
  attack?: number;
  hold?: number;
  decay: number;
  gain: number;
  filter?: FilterSpec;
  filter2?: FilterSpec;
  /** Playback rate; also shifts the perceived noise colour. */
  rate?: number;
  pan?: number;
  send?: number;
}

type Vowel = 'a' | 'e' | 'i' | 'o' | 'u' | 'ae';

/** F1/F2/F3 centres, roughly the textbook values for a male speaker. */
const FORMANTS: Record<Vowel, readonly [number, number, number]> = {
  a: [730, 1090, 2440],
  e: [530, 1840, 2480],
  i: [300, 2290, 3010],
  o: [570, 840, 2410],
  u: [325, 700, 2530],
  ae: [660, 1720, 2410],
};

interface Syllable {
  dur: number;
  vowel: Vowel;
  /** Glide target — a diphthong is what stops it sounding like a synth pad. */
  to?: Vowel;
  /** Pitch multipliers over the syllable, relative to the base pitch. */
  p0: number;
  p1: number;
  onset?: 'plosive' | 'sibilant' | 'none';
  gain?: number;
  /** Silence after this syllable, in seconds. */
  gap?: number;
}

/**
 * Minimum seconds between two triggers of the same sound. The simulation runs
 * far faster than sound events can be perceived; without this a 120 Hz loop
 * that fires `glove` on every overlap frame turns into white noise.
 */
const MIN_GAP: Partial<Record<SfxName, number>> = {
  pitchRelease: 0.12,
  catcherMitt: 0.1,
  swingMiss: 0.12,
  swingWhoosh: 0.12,
  contactWeak: 0.1,
  contactSolid: 0.1,
  contactBarrel: 0.1,
  bunt: 0.1,
  foulTip: 0.06,
  glove: 0.06,
  groundHit: 0.05,
  wallHit: 0.12,
  throwRelease: 0.06,
  slide: 0.25,
  umpStrike: 0.3,
  umpBall: 0.3,
  umpOut: 0.3,
  umpSafe: 0.3,
  homerun: 0.8,
  strikeout: 0.5,
  walk: 0.4,
  runScored: 0.25,
  bigPlay: 0.5,
  error: 0.4,
  inningChange: 0.8,
  gameOver: 1.5,
  menuMove: 0.035,
  menuSelect: 0.06,
  menuBack: 0.06,
  menuDenied: 0.12,
  countdown: 0.12,
};

/** How many hand-tuned variants each family rotates through. */
const VARIANTS = 3;

/* ------------------------------------------------------------------------- *
 * Engine
 * ------------------------------------------------------------------------- */

export class AudioEngine {
  /** False when the browser gave us no AudioContext; every method no-ops. */
  readonly available: boolean;

  private graph: Graph | null = null;
  private disposed = false;
  private isUnlocked = false;
  private resumePending = false;

  private musicVolume = 0.55;
  private sfxVolume = 0.85;
  private muted = false;

  private voices = new Map<number, { end: number; nodes: readonly AudioNode[] }>();
  private nextVoiceId = 1;

  private lastPlay = new Map<SfxName, number>();
  private roundRobin = new Map<SfxName, number>();
  private seed = (Date.now() ^ 0x5f3759df) >>> 0;

  private musicTrack: MusicTrack | null = null;
  private musicHandle: TrackHandle | null = null;
  private musicGain: GainNode | null = null;
  private pendingTrack: MusicTrack | null = null;

  private crowd: {
    sources: AudioBufferSourceNode[];
    murmur: GainNode;
    roar: GainNode;
    sizzle: GainNode;
    tone: BiquadFilterNode;
    lfo: OscillatorNode;
    lfoGain: GainNode;
  } | null = null;
  private crowdLevel = 0;
  private crowdUrgency = 0;
  private crowdApplied = -1;

  /** Blocks overlapping vocal lines — two announcers at once is unlistenable. */
  private voiceBusyUntil = 0;

  private noiseBuf: AudioBuffer | null = null;
  private crowdBuf: AudioBuffer | null = null;
  private shaperCurves = new Map<number, ShaperCurve>();

  constructor() {
    let ok = false;
    try {
      const Ctor = getAudioContextCtor();
      if (Ctor) {
        const ctx = new Ctor();
        this.graph = this.buildGraph(ctx);
        ok = this.graph !== null;
      }
    } catch {
      // No Web Audio (old browser, blocked by policy, too many contexts).
      this.graph = null;
      ok = false;
    }
    this.available = ok;
  }

  /* --------------------------------------------------------------------- *
   * Lifecycle
   * --------------------------------------------------------------------- */

  /**
   * Call from the first user gesture. Idempotent and safe to spam: browsers
   * only honour resume() inside a gesture, so the UI typically wires this to
   * pointerdown/keydown and calls it on every one until it takes.
   */
  unlock(): void {
    if (this.disposed || !this.graph || this.isUnlocked || this.resumePending) return;
    const ctx = this.graph.ctx;
    try {
      if (ctx.state === 'running') {
        this.onUnlocked();
        return;
      }
      const p = ctx.resume();
      if (p && typeof p.then === 'function') {
        this.resumePending = true;
        p.then(
          () => {
            this.resumePending = false;
            this.onUnlocked();
          },
          () => {
            // Gesture requirement not satisfied yet; stay locked, stay quiet.
            this.resumePending = false;
          },
        );
      } else {
        this.onUnlocked();
      }
    } catch {
      this.resumePending = false;
    }
  }

  get unlocked(): boolean {
    return this.isUnlocked;
  }

  suspend(): void {
    if (this.disposed || !this.graph) return;
    try {
      const p = this.graph.ctx.suspend();
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } catch {
      /* ignore */
    }
  }

  resume(): void {
    if (this.disposed || !this.graph) return;
    try {
      const p = this.graph.ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } catch {
      /* ignore */
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const g = this.graph;
    this.graph = null;
    this.isUnlocked = false;
    try {
      if (this.musicHandle && g) this.musicHandle.stop(g.ctx.currentTime);
    } catch {
      /* ignore */
    }
    this.musicHandle = null;
    this.musicGain = null;
    this.musicTrack = null;
    this.pendingTrack = null;
    if (this.crowd) {
      for (const s of this.crowd.sources) safeStop(s);
      safeStop(this.crowd.lfo);
      this.crowd = null;
    }
    for (const id of Array.from(this.voices.keys())) this.release(id);
    this.voices.clear();
    if (g) {
      for (const n of [g.master, g.music, g.sfx, g.crowdBus, g.reverbIn]) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
      try {
        const p = g.ctx.close();
        if (p && typeof p.catch === 'function') p.catch(() => undefined);
      } catch {
        /* ignore */
      }
    }
    this.noiseBuf = null;
    this.crowdBuf = null;
  }

  /* --------------------------------------------------------------------- *
   * Mixer
   * --------------------------------------------------------------------- */

  setMusicVolume(v: number): void {
    this.musicVolume = clamp01(finite(v, this.musicVolume));
    const g = this.graph;
    if (!g) return;
    rampTo(g.music.gain, this.musicVolume, g.ctx.currentTime, 0.05);
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = clamp01(finite(v, this.sfxVolume));
    const g = this.graph;
    if (!g) return;
    rampTo(g.sfx.gain, this.sfxVolume, g.ctx.currentTime, 0.05);
  }

  getMusicVolume(): number {
    return this.musicVolume;
  }

  getSfxVolume(): number {
    return this.sfxVolume;
  }

  setMuted(muted: boolean): void {
    this.muted = !!muted;
    const g = this.graph;
    if (!g) return;
    // Ramp rather than jump: an instant gain change on a sustained crowd bed
    // produces a click loud enough to be its own sound effect.
    rampTo(g.master.gain, this.muted ? 0 : 0.9, g.ctx.currentTime, 0.04);
  }

  /* --------------------------------------------------------------------- *
   * Sound effects
   * --------------------------------------------------------------------- */

  playSfx(name: SfxName, opts?: AudioOptions): void {
    const g = this.ready();
    if (!g) return;
    try {
      const now = g.ctx.currentTime;
      const gap = MIN_GAP[name] ?? 0.03;
      const last = this.lastPlay.get(name);
      if (last !== undefined && now - last < gap) return;
      this.lastPlay.set(name, now);

      const power = clamp01(finite(opts?.power ?? 0.7, 0.7));
      const pan = clamp(finite(opts?.pan ?? 0, 0), -1, 1);
      const pitch = clamp(finite(opts?.pitch ?? 1, 1), 0.25, 4);
      const variant = this.variant(name);
      this.renderSfx(g, now, name, power, pan, pitch, variant);
    } catch {
      /* a malformed request must never reach the game loop */
    }
  }

  /* --------------------------------------------------------------------- *
   * Music
   * --------------------------------------------------------------------- */

  playMusic(track: MusicTrack, opts?: { fadeSeconds?: number }): void {
    if (this.disposed) return;
    const fade = clamp(finite(opts?.fadeSeconds ?? DEFAULT_FADE, DEFAULT_FADE), 0, 8);
    const g = this.ready();
    if (!g) {
      // Remember the intent; unlock() will start it once a gesture arrives.
      this.pendingTrack = track;
      return;
    }
    if (this.musicTrack === track && this.musicHandle) return;
    try {
      const now = g.ctx.currentTime;
      this.fadeOutCurrentMusic(now, fade);

      const gain = g.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(1, now + Math.max(0.02, fade * 0.9));
      gain.connect(g.music);

      const handle = createTrack(g.ctx, gain, track, createMusicRng(trackSeed(track)));
      handle.start(now + 0.03);
      this.musicGain = gain;
      this.musicHandle = handle;
      this.musicTrack = track;
      this.pendingTrack = null;
    } catch {
      this.musicHandle = null;
      this.musicGain = null;
      this.musicTrack = null;
    }
  }

  stopMusic(fadeSeconds?: number): void {
    this.pendingTrack = null;
    const g = this.graph;
    if (!g) return;
    const fade = clamp(finite(fadeSeconds ?? DEFAULT_FADE, DEFAULT_FADE), 0, 8);
    try {
      this.fadeOutCurrentMusic(g.ctx.currentTime, fade);
    } catch {
      /* ignore */
    }
    this.musicTrack = null;
  }

  private fadeOutCurrentMusic(now: number, fade: number): void {
    const oldGain = this.musicGain;
    const oldHandle = this.musicHandle;
    this.musicGain = null;
    this.musicHandle = null;
    if (oldGain) {
      oldGain.gain.cancelScheduledValues(now);
      oldGain.gain.setValueAtTime(Math.max(0.0001, oldGain.gain.value), now);
      oldGain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.03, fade));
    }
    if (oldHandle) oldHandle.stop(now + Math.max(0.03, fade));
  }

  /* --------------------------------------------------------------------- *
   * Crowd bed
   * --------------------------------------------------------------------- */

  /**
   * Safe to call every frame at any rate: the targets are held on AudioParams
   * with setTargetAtTime, so the smoothing happens on the audio thread at a
   * fixed time constant and is completely independent of frame rate.
   */
  setCrowd(level: number, urgency = 0): void {
    this.crowdLevel = clamp01(finite(level, 0));
    this.crowdUrgency = clamp01(finite(urgency, 0));
    const g = this.ready();
    if (!g || !this.crowd) return;
    const now = g.ctx.currentTime;
    // Coalesce: 20 param updates a second is more than enough for a bed that
    // smooths over hundreds of milliseconds anyway.
    if (this.crowdApplied >= 0 && now - this.crowdApplied < 0.05) return;
    this.crowdApplied = now;
    try {
      const l = this.crowdLevel;
      const u = this.crowdUrgency;
      const c = this.crowd;
      setTarget(g.crowdBus.gain, l * 0.85, now, 0.35);
      setTarget(c.murmur.gain, 0.55 * (1 - 0.35 * u), now, 0.5);
      setTarget(c.roar.gain, 0.25 + 0.75 * u, now, 0.25);
      // Whistles and shrieks only appear when the park is genuinely up.
      setTarget(c.sizzle.gain, 0.05 + 0.5 * u * u, now, 0.3);
      setTarget(c.tone.frequency, 620 + 900 * u, now, 0.4);
    } catch {
      /* ignore */
    }
  }

  /* --------------------------------------------------------------------- *
   * Announcer
   * --------------------------------------------------------------------- */

  /**
   * Wordless formant synthesis: a buzzing glottal source through three
   * bandpass "formants" that glide between vowel targets. It reads as an
   * excited human shape without ever forming a real word, which keeps the
   * game language-neutral and needs no recordings.
   */
  announce(kind: 'strike' | 'ball' | 'out' | 'safe' | 'homerun' | 'bigplay' | 'welcome'): void {
    const g = this.ready();
    if (!g) return;
    try {
      const now = g.ctx.currentTime;
      if (now < this.voiceBusyUntil) return;
      const r = this.rand();
      const base = 108 + r * 14;
      let syl: Syllable[];
      switch (kind) {
        case 'strike':
          syl = [
            { dur: 0.16, vowel: 'i', to: 'ae', p0: 1.0, p1: 1.25, onset: 'sibilant', gain: 0.9 },
            { dur: 0.3, vowel: 'ae', to: 'i', p0: 1.3, p1: 0.95, onset: 'plosive', gain: 1 },
          ];
          break;
        case 'ball':
          syl = [{ dur: 0.42, vowel: 'o', to: 'a', p0: 1.05, p1: 0.8, onset: 'plosive', gain: 0.95 }];
          break;
        case 'out':
          syl = [{ dur: 0.4, vowel: 'a', to: 'u', p0: 1.35, p1: 0.85, onset: 'plosive', gain: 1.1 }];
          break;
        case 'safe':
          syl = [{ dur: 0.52, vowel: 'e', to: 'i', p0: 1.15, p1: 1.0, onset: 'sibilant', gain: 1 }];
          break;
        case 'homerun':
          syl = [
            { dur: 0.24, vowel: 'o', p0: 0.95, p1: 1.05, onset: 'plosive', gain: 0.95, gap: 0.03 },
            { dur: 0.22, vowel: 'u', to: 'a', p0: 1.1, p1: 1.2, gain: 1 },
            { dur: 0.6, vowel: 'a', to: 'ae', p0: 1.35, p1: 1.15, onset: 'plosive', gain: 1.2 },
          ];
          break;
        case 'bigplay':
          syl = [
            { dur: 0.2, vowel: 'ae', p0: 1.2, p1: 1.35, onset: 'plosive', gain: 1, gap: 0.04 },
            { dur: 0.44, vowel: 'a', to: 'e', p0: 1.4, p1: 1.05, gain: 1.15 },
          ];
          break;
        case 'welcome':
        default:
          syl = [
            { dur: 0.22, vowel: 'u', to: 'e', p0: 0.9, p1: 1.0, gain: 0.8, gap: 0.03 },
            { dur: 0.2, vowel: 'a', p0: 1.05, p1: 1.0, onset: 'plosive', gain: 0.85, gap: 0.03 },
            { dur: 0.2, vowel: 'i', p0: 1.1, p1: 1.05, gain: 0.8, gap: 0.03 },
            { dur: 0.42, vowel: 'o', to: 'a', p0: 1.15, p1: 0.85, gain: 0.9 },
          ];
          break;
      }
      const total = this.speak(g, now + 0.02, syl, base, 0.55, 0.35);
      this.voiceBusyUntil = now + total + 0.08;
    } catch {
      /* ignore */
    }
  }

  /* --------------------------------------------------------------------- *
   * Internals — graph construction
   * --------------------------------------------------------------------- */

  private buildGraph(ctx: AudioContext): Graph | null {
    try {
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.9;

      // A limiter-ish compressor is the only thing standing between a barrelled
      // homer plus full crowd plus fanfare and hard digital clipping.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 22;
      comp.ratio.value = 6;
      comp.attack.value = 0.004;
      comp.release.value = 0.18;
      master.connect(comp);
      comp.connect(ctx.destination);

      const music = ctx.createGain();
      music.gain.value = this.musicVolume;
      music.connect(master);

      const sfx = ctx.createGain();
      sfx.gain.value = this.sfxVolume;
      // Gentle saturation glues stacked one-shots together and adds the mild
      // grit that period sports games got for free from 8-bit sample playback.
      const shaper = ctx.createWaveShaper();
      shaper.curve = this.getShaperCurve(1.15);
      sfx.connect(shaper);
      shaper.connect(master);

      const reverbIn = ctx.createGain();
      reverbIn.gain.value = 1;
      const convolver = ctx.createConvolver();
      convolver.normalize = true;
      convolver.buffer = this.makeImpulse(ctx);
      const reverbOut = ctx.createGain();
      reverbOut.gain.value = 0.9;
      reverbIn.connect(convolver);
      convolver.connect(reverbOut);
      // The reverb return must land on the SFX fader, not on master. Everything
      // feeding it — one-shot sends and the crowd bed — is a sound effect, and
      // routing the wet signal past the fader meant the sound slider at zero
      // still left roughly a third of the level audible.
      reverbOut.connect(sfx);

      const crowdBus = ctx.createGain();
      crowdBus.gain.value = 0;
      crowdBus.connect(sfx);
      const crowdSend = ctx.createGain();
      crowdSend.gain.value = 0.45;
      crowdBus.connect(crowdSend);
      crowdSend.connect(reverbIn);

      return { ctx, master, music, sfx, crowdBus, reverbIn };
    } catch {
      return null;
    }
  }

  private onUnlocked(): void {
    if (this.disposed || !this.graph || this.isUnlocked) return;
    this.isUnlocked = true;
    try {
      this.ensureCrowd(this.graph);
    } catch {
      /* crowd bed is optional */
    }
    if (this.pendingTrack) {
      const t = this.pendingTrack;
      this.pendingTrack = null;
      this.playMusic(t, { fadeSeconds: 0.4 });
    }
  }

  private ready(): Graph | null {
    if (this.disposed || !this.isUnlocked) return null;
    return this.graph;
  }

  /* --------------------------------------------------------------------- *
   * Internals — buffers and curves
   * --------------------------------------------------------------------- */

  /** xorshift32; audio jitter does not need to be reproducible, only cheap. */
  private rand(): number {
    let s = this.seed;
    s ^= (s << 13) >>> 0;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= (s << 5) >>> 0;
    this.seed = s >>> 0;
    return this.seed / 4294967296;
  }

  private rr(lo: number, hi: number): number {
    return lo + this.rand() * (hi - lo);
  }

  /** Round-robin index for a name; consecutive calls never repeat a variant. */
  private variant(name: SfxName): number {
    const prev = this.roundRobin.get(name) ?? 0;
    const next = (prev + 1) % VARIANTS;
    this.roundRobin.set(name, next);
    return next;
  }

  /** Soft-clip curves are pure functions of drive, so they are cached per drive. */
  private getShaperCurve(drive: number): ShaperCurve {
    const cached = this.shaperCurves.get(drive);
    if (cached) return cached;
    const n = 1024;
    const curve = new Float32Array(n);
    const d = Math.max(0.01, drive);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * d) / Math.tanh(d);
    }
    this.shaperCurves.set(drive, curve);
    return curve;
  }

  /** 2 s of white noise, generated once and read from random offsets. */
  private getNoise(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuf) return this.noiseBuf;
    const len = Math.max(1, Math.floor(ctx.sampleRate * 2));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let s = 0x2545f491 >>> 0;
    for (let i = 0; i < len; i++) {
      s ^= (s << 13) >>> 0;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= (s << 5) >>> 0;
      s >>>= 0;
      d[i] = (s / 4294967296) * 2 - 1;
    }
    this.noiseBuf = buf;
    return buf;
  }

  /**
   * Longer stereo noise bed for the crowd. Slightly decorrelated channels plus
   * a 1-pole lowpass baked into the samples give a warmer, wider hiss than two
   * copies of the same white noise, which images as a point source in the head.
   */
  private getCrowdNoise(ctx: AudioContext): AudioBuffer {
    if (this.crowdBuf) return this.crowdBuf;
    const len = Math.max(1, Math.floor(ctx.sampleRate * 4));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    let s = 0x9e3779b9 >>> 0;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        s ^= (s << 13) >>> 0;
        s >>>= 0;
        s ^= s >>> 17;
        s ^= (s << 5) >>> 0;
        s >>>= 0;
        const white = (s / 4294967296) * 2 - 1;
        lp += 0.32 * (white - lp);
        d[i] = lp * 1.9 + white * 0.25;
      }
    }
    this.crowdBuf = buf;
    return buf;
  }

  /**
   * Stadium impulse response: a handful of discrete early reflections (which
   * give the sense of a bowl rather than a cave) followed by an exponentially
   * decaying noise tail, with the tail low-passed by a 1-pole so high
   * frequencies die first the way they do in real air.
   */
  private makeImpulse(ctx: AudioContext): AudioBuffer {
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * REVERB_SECONDS));
    const buf = ctx.createBuffer(2, len, rate);
    let s = 0x13579bdf >>> 0;
    const taps = [0.011, 0.019, 0.031, 0.047, 0.062, 0.083];
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        s ^= (s << 13) >>> 0;
        s >>>= 0;
        s ^= s >>> 17;
        s ^= (s << 5) >>> 0;
        s >>>= 0;
        const white = (s / 4294967296) * 2 - 1;
        lp += 0.45 * (white - lp);
        const t = i / len;
        d[i] = lp * Math.pow(1 - t, 2.6);
      }
      for (let k = 0; k < taps.length; k++) {
        // Offset one channel slightly so the reflections are not phase-locked.
        const idx = Math.floor((taps[k] + (ch === 1 ? 0.004 : 0)) * rate);
        if (idx < len) d[idx] += (k % 2 === 0 ? 0.5 : -0.42) / (1 + k);
      }
      // Fade the first millisecond so the IR does not start with a click.
      const fade = Math.floor(rate * 0.001);
      for (let i = 0; i < fade && i < len; i++) d[i] *= i / fade;
    }
    return buf;
  }

  /* --------------------------------------------------------------------- *
   * Internals — voice budget
   * --------------------------------------------------------------------- */

  /**
   * Frees any voice whose scheduled end has passed. `onended` normally does
   * this, but reaping by time means the budget still recovers in environments
   * where the callback is unreliable (suspended contexts, closed contexts).
   */
  private reap(now: number): void {
    for (const [id, v] of this.voices) {
      if (v.end <= now) this.release(id);
    }
  }

  private release(id: number): void {
    const v = this.voices.get(id);
    if (!v) return;
    this.voices.delete(id);
    for (const n of v.nodes) {
      try {
        n.disconnect();
      } catch {
        /* already gone */
      }
    }
  }

  /**
   * `needed` lets a composite sound reserve room for the voices it will spawn
   * internally; without it a voice that allocates helpers after its own check
   * can push the total one past the cap.
   */
  private hasCapacity(now: number, needed = 1): boolean {
    this.reap(now);
    return this.voices.size + needed <= MAX_VOICES;
  }

  private retain(src: AudioScheduledSourceNode, nodes: readonly AudioNode[], end: number): void {
    const id = this.nextVoiceId++;
    this.voices.set(id, { end, nodes });
    src.onended = (): void => this.release(id);
  }

  /* --------------------------------------------------------------------- *
   * Internals — synthesis primitives
   * --------------------------------------------------------------------- */

  /** Builds amp -> [pan] -> sfx bus, plus an optional reverb send. */
  private makeOutput(g: Graph, pan: number, send: number): { amp: GainNode; nodes: AudioNode[] } {
    const nodes: AudioNode[] = [];
    const amp = g.ctx.createGain();
    nodes.push(amp);
    let tail: AudioNode = amp;
    if (pan !== 0 && typeof g.ctx.createStereoPanner === 'function') {
      const p = g.ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      amp.connect(p);
      nodes.push(p);
      tail = p;
    }
    tail.connect(g.sfx);
    if (send > 0) {
      const s = g.ctx.createGain();
      s.gain.value = clamp01(send);
      tail.connect(s);
      s.connect(g.reverbIn);
      nodes.push(s);
    }
    return { amp, nodes };
  }

  private applyFilter(g: Graph, spec: FilterSpec, t: number, total: number): BiquadFilterNode {
    const f = g.ctx.createBiquadFilter();
    f.type = spec.type ?? 'lowpass';
    f.Q.value = spec.q ?? 1;
    const start = clamp(spec.freq, 20, 20000);
    f.frequency.setValueAtTime(start, t);
    if (spec.freqEnd !== undefined) {
      f.frequency.exponentialRampToValueAtTime(clamp(spec.freqEnd, 20, 20000), t + Math.max(0.01, total));
    }
    return f;
  }

  private tone(g: Graph, t0: number, s: ToneSpec): void {
    const t = t0 + (s.delay ?? 0);
    if (!this.hasCapacity(g.ctx.currentTime)) return;
    const attack = Math.max(0.001, s.attack ?? 0.004);
    const hold = Math.max(0, s.hold ?? 0);
    const decay = Math.max(0.01, s.decay);
    const total = attack + hold + decay;

    const { amp, nodes } = this.makeOutput(g, s.pan ?? 0, s.send ?? 0);
    let head: AudioNode = amp;
    if (s.shape) {
      const ws = g.ctx.createWaveShaper();
      ws.curve = this.getShaperCurve(2.6);
      ws.connect(amp);
      nodes.push(ws);
      head = ws;
    }
    if (s.filter) {
      const f = this.applyFilter(g, s.filter, t, total);
      f.connect(head);
      nodes.push(f);
      head = f;
    }

    const osc = g.ctx.createOscillator();
    osc.type = s.type ?? 'sine';
    osc.detune.value = s.detune ?? 0;
    const f0 = clamp(s.freq, 8, 20000);
    osc.frequency.setValueAtTime(f0, t);
    if (s.freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(clamp(s.freqEnd, 8, 20000), t + Math.max(0.005, s.glide ?? total));
    }
    osc.connect(head);
    nodes.push(osc);

    envelope(amp.gain, t, attack, hold, decay, s.gain);
    osc.start(t);
    osc.stop(t + total + 0.03);
    this.retain(osc, nodes, t + total + 0.06);
  }

  private noise(g: Graph, t0: number, s: NoiseSpec): void {
    const t = t0 + (s.delay ?? 0);
    if (!this.hasCapacity(g.ctx.currentTime)) return;
    const attack = Math.max(0.001, s.attack ?? 0.002);
    const hold = Math.max(0, s.hold ?? 0);
    const decay = Math.max(0.01, s.decay);
    const total = attack + hold + decay;

    const { amp, nodes } = this.makeOutput(g, s.pan ?? 0, s.send ?? 0);
    let head: AudioNode = amp;
    if (s.filter2) {
      const f = this.applyFilter(g, s.filter2, t, total);
      f.connect(head);
      nodes.push(f);
      head = f;
    }
    if (s.filter) {
      const f = this.applyFilter(g, s.filter, t, total);
      f.connect(head);
      nodes.push(f);
      head = f;
    }

    const src = g.ctx.createBufferSource();
    src.buffer = this.getNoise(g.ctx);
    src.playbackRate.value = clamp(s.rate ?? 1, 0.1, 4);
    src.connect(head);
    nodes.push(src);

    envelope(amp.gain, t, attack, hold, decay, s.gain);
    // A fresh read offset per trigger is the cheapest possible "new noise
    // seed": the same buffer never repeats the same waveform twice in a row.
    const offset = this.rand() * 1.5;
    src.start(t, offset);
    src.stop(t + total + 0.03);
    this.retain(src, nodes, t + total + 0.06);
  }

  /**
   * Formant voice. One buzzing source feeds three parallel bandpasses whose
   * centres glide between vowel targets; consonants are separate noise bursts.
   * Returns the total utterance length in seconds.
   */
  private speak(
    g: Graph,
    t0: number,
    syllables: readonly Syllable[],
    baseHz: number,
    gain: number,
    send: number,
    pan = 0,
  ): number {
    if (syllables.length === 0) return 0;
    let total = 0;
    for (const s of syllables) total += s.dur + (s.gap ?? 0);
    // One voice for the glottal source plus headroom for consonant bursts.
    if (!this.hasCapacity(g.ctx.currentTime, 3)) return total;

    const { amp, nodes } = this.makeOutput(g, pan, send);
    amp.gain.setValueAtTime(0.0002, t0);

    const mix = g.ctx.createGain();
    mix.gain.value = 1;
    mix.connect(amp);
    nodes.push(mix);

    const bands: BiquadFilterNode[] = [];
    const bandGains = [1, 0.62, 0.28];
    const qs = [11, 9, 7];
    for (let i = 0; i < 3; i++) {
      const bp = g.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = qs[i];
      const bg = g.ctx.createGain();
      bg.gain.value = bandGains[i];
      bp.connect(bg);
      bg.connect(mix);
      bands.push(bp);
      nodes.push(bp, bg);
    }

    // Sawtooth is a serviceable glottal pulse: dense harmonics for the
    // formants to carve, and it stays audible through a loud stadium bed.
    const osc = g.ctx.createOscillator();
    osc.type = 'sawtooth';
    const breath = g.ctx.createBufferSource();
    breath.buffer = this.getNoise(g.ctx);
    breath.loop = true;
    const breathGain = g.ctx.createGain();
    breathGain.gain.value = 0.05;
    breath.connect(breathGain);
    for (const bp of bands) {
      osc.connect(bp);
      breathGain.connect(bp);
    }
    nodes.push(osc, breath, breathGain);

    const vib = g.ctx.createOscillator();
    vib.type = 'sine';
    vib.frequency.value = 5.1 + this.rand() * 1.4;
    const vibGain = g.ctx.createGain();
    vibGain.gain.value = 9;
    vib.connect(vibGain);
    vibGain.connect(osc.detune);
    nodes.push(vib, vibGain);

    let t = t0;
    osc.frequency.setValueAtTime(Math.max(40, baseHz * syllables[0].p0), t);
    for (const s of syllables) {
      const from = FORMANTS[s.vowel];
      const to = FORMANTS[s.to ?? s.vowel];
      for (let i = 0; i < 3; i++) {
        bands[i].frequency.setValueAtTime(from[i], t);
        bands[i].frequency.linearRampToValueAtTime(to[i], t + s.dur * 0.85);
      }
      osc.frequency.setValueAtTime(Math.max(40, baseHz * s.p0), t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, baseHz * s.p1), t + s.dur);

      const peak = Math.max(0.02, gain * (s.gain ?? 1));
      amp.gain.setValueAtTime(0.0002, t);
      amp.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.05, s.dur * 0.25));
      amp.gain.setValueAtTime(peak, t + s.dur * 0.6);
      amp.gain.exponentialRampToValueAtTime(0.0002, t + s.dur);

      if (s.onset === 'plosive') {
        this.noise(g, t, { decay: 0.035, gain: gain * 0.5, filter: { type: 'bandpass', freq: 1500, q: 1.2 }, send });
      } else if (s.onset === 'sibilant') {
        this.noise(g, t, { decay: 0.09, attack: 0.02, gain: gain * 0.35, filter: { type: 'highpass', freq: 4200, q: 0.9 }, send });
      }
      t += s.dur + (s.gap ?? 0);
    }

    const end = t + 0.05;
    osc.start(t0);
    osc.stop(end);
    breath.start(t0, this.rand() * 1.5);
    breath.stop(end);
    vib.start(t0);
    vib.stop(end);
    this.retain(osc, nodes, end + 0.05);
    return total;
  }

  private ensureCrowd(g: Graph): void {
    if (this.crowd) return;
    const ctx = g.ctx;
    const buf = this.getCrowdNoise(ctx);

    const mk = (rate: number): AudioBufferSourceNode => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.playbackRate.value = rate;
      return s;
    };

    // Three layers: a low murmur that is always there, a mid roar that tracks
    // urgency, and a thin high band of whistles that only shows up at the top.
    const murmurSrc = mk(1);
    const murmur = ctx.createGain();
    murmur.gain.value = 0.55;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 620;
    tone.Q.value = 0.6;
    murmurSrc.connect(tone);
    tone.connect(murmur);
    murmur.connect(g.crowdBus);

    const roarSrc = mk(0.87);
    const roar = ctx.createGain();
    roar.gain.value = 0.25;
    const roarBp = ctx.createBiquadFilter();
    roarBp.type = 'bandpass';
    roarBp.frequency.value = 1250;
    roarBp.Q.value = 0.75;
    roarSrc.connect(roarBp);
    roarBp.connect(roar);
    roar.connect(g.crowdBus);

    const sizzleSrc = mk(1.19);
    const sizzle = ctx.createGain();
    sizzle.gain.value = 0.05;
    const sizzleBp = ctx.createBiquadFilter();
    sizzleBp.type = 'bandpass';
    sizzleBp.frequency.value = 3400;
    sizzleBp.Q.value = 1.4;
    sizzleSrc.connect(sizzleBp);
    sizzleBp.connect(sizzle);
    sizzle.connect(g.crowdBus);

    // Very slow LFO on the murmur so the bed breathes instead of sitting flat.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.12;
    lfo.connect(lfoGain);
    lfoGain.connect(murmur.gain);

    const now = ctx.currentTime;
    murmurSrc.start(now);
    roarSrc.start(now, 1.3);
    sizzleSrc.start(now, 2.6);
    lfo.start(now);

    this.crowd = {
      sources: [murmurSrc, roarSrc, sizzleSrc],
      murmur,
      roar,
      sizzle,
      tone,
      lfo,
      lfoGain,
    };
  }

  /* --------------------------------------------------------------------- *
   * Internals — the sound design itself
   * --------------------------------------------------------------------- */

  private renderSfx(
    g: Graph,
    t: number,
    name: SfxName,
    power: number,
    pan: number,
    pitch: number,
    variant: number,
  ): void {
    // `v` shifts timbre per round-robin slot, `j` adds fine per-trigger jitter.
    const v = (variant - 1) * 0.5; // -0.5, 0, +0.5
    const j = this.rr(-1, 1);
    const p = power;
    const send = 0.18 + 0.32 * p;

    switch (name) {
      case 'pitchRelease':
        this.noise(g, t, {
          decay: 0.075 + 0.02 * j,
          gain: 0.1 + 0.08 * p,
          rate: 1 + 0.1 * v,
          filter: { type: 'bandpass', freq: 900 * pitch, freqEnd: 2700 * pitch, q: 1.1 + 0.3 * v },
          pan,
          send: 0.1,
        });
        this.tone(g, t, {
          type: 'triangle',
          freq: 320 * pitch,
          freqEnd: 180 * pitch,
          decay: 0.05,
          gain: 0.04 + 0.04 * p,
          pan,
        });
        break;

      case 'catcherMitt':
        this.noise(g, t, {
          decay: 0.1 + 0.03 * j,
          gain: 0.32 + 0.28 * p,
          rate: 0.95 + 0.12 * v,
          filter: { type: 'bandpass', freq: (1400 + 260 * v) * pitch, freqEnd: 620 * pitch, q: 1.2 },
          pan,
          send,
        });
        this.tone(g, t, {
          freq: 165 * pitch,
          freqEnd: 92 * pitch,
          decay: 0.09,
          gain: 0.22 + 0.2 * p,
          pan,
        });
        break;

      case 'swingMiss':
        this.noise(g, t, {
          attack: 0.012,
          decay: 0.13 + 0.03 * j,
          gain: 0.16 + 0.16 * p,
          rate: 1 + 0.15 * v,
          filter: { type: 'bandpass', freq: 2400 * pitch, freqEnd: 520 * pitch, q: 1.5 },
          pan,
          send: 0.12,
        });
        break;

      case 'swingWhoosh':
        this.noise(g, t, {
          attack: 0.03 + 0.01 * j,
          decay: 0.2,
          gain: 0.2 + 0.2 * p,
          rate: 0.9 + 0.12 * v,
          filter: { type: 'bandpass', freq: 1700 * pitch, freqEnd: 260 * pitch, q: 1.1 },
          filter2: { type: 'highpass', freq: 180 },
          pan,
          send: 0.14,
        });
        break;

      case 'contactWeak':
        // Dull, wood-heavy, almost no ring: the sound of a ball dying at 20 m.
        this.noise(g, t, {
          decay: 0.055 + 0.015 * j,
          gain: 0.25 + 0.2 * p,
          rate: 0.9 + 0.15 * v,
          filter: { type: 'lowpass', freq: 1100 * pitch, freqEnd: 400 * pitch, q: 1.4 },
          pan,
          send,
        });
        this.tone(g, t, {
          type: 'triangle',
          freq: (205 + 20 * v) * pitch,
          freqEnd: 120 * pitch,
          decay: 0.1,
          gain: 0.2 + 0.2 * p,
          pan,
          send,
        });
        break;

      case 'contactSolid':
        this.noise(g, t, {
          decay: 0.07 + 0.02 * j,
          gain: 0.4 + 0.35 * p,
          rate: 1 + 0.12 * v,
          filter: { type: 'bandpass', freq: (2100 + 300 * v) * pitch, freqEnd: 900 * pitch, q: 2.4 },
          pan,
          send,
        });
        this.tone(g, t, {
          type: 'triangle',
          freq: (330 + 30 * v) * pitch,
          freqEnd: 155 * pitch,
          decay: 0.12,
          gain: 0.26 + 0.26 * p,
          pan,
          send,
        });
        this.tone(g, t, { freq: 112 * pitch, decay: 0.14, gain: 0.16 + 0.2 * p, pan });
        break;

      case 'contactBarrel':
        // Same anatomy as contactSolid but with a longer metallic ring and a
        // sub thump, so "barrelled" is obvious without just being louder.
        this.noise(g, t, {
          decay: 0.085 + 0.02 * j,
          gain: 0.55 + 0.4 * p,
          rate: 1.05 + 0.12 * v,
          filter: { type: 'bandpass', freq: (2700 + 400 * v) * pitch, freqEnd: 1100 * pitch, q: 3.2 },
          pan,
          send: send + 0.15,
        });
        this.tone(g, t, {
          type: 'triangle',
          freq: (400 + 40 * v) * pitch,
          freqEnd: 170 * pitch,
          decay: 0.16,
          gain: 0.3 + 0.3 * p,
          shape: true,
          pan,
          send,
        });
        this.tone(g, t, {
          freq: (2750 + 200 * j) * pitch,
          freqEnd: 2400 * pitch,
          decay: 0.28,
          gain: 0.1 + 0.16 * p,
          pan,
          send: send + 0.2,
        });
        this.tone(g, t, { freq: 74 * pitch, freqEnd: 58 * pitch, decay: 0.3, gain: 0.24 + 0.3 * p, pan });
        break;

      case 'bunt':
        this.noise(g, t, {
          decay: 0.05,
          gain: 0.16 + 0.14 * p,
          rate: 0.85 + 0.12 * v,
          filter: { type: 'lowpass', freq: 760 * pitch, q: 1 },
          pan,
          send: 0.12,
        });
        this.tone(g, t, { type: 'triangle', freq: 160 * pitch, freqEnd: 110 * pitch, decay: 0.06, gain: 0.16, pan });
        break;

      case 'foulTip':
        this.noise(g, t, {
          decay: 0.04 + 0.012 * j,
          gain: 0.2 + 0.22 * p,
          rate: 1.2 + 0.2 * v,
          filter: { type: 'bandpass', freq: (5000 + 700 * v) * pitch, q: 4 },
          pan,
          send: 0.2,
        });
        break;

      case 'glove':
        this.noise(g, t, {
          decay: 0.085 + 0.02 * j,
          gain: 0.22 + 0.2 * p,
          rate: 0.9 + 0.14 * v,
          filter: { type: 'lowpass', freq: (1250 + 200 * v) * pitch, freqEnd: 500, q: 0.9 },
          pan,
          send: 0.16,
        });
        this.tone(g, t, { freq: 128 * pitch, freqEnd: 88 * pitch, decay: 0.07, gain: 0.12 + 0.12 * p, pan });
        break;

      case 'groundHit':
        this.noise(g, t, {
          decay: 0.11 + 0.03 * j,
          gain: 0.2 + 0.2 * p,
          rate: 0.8 + 0.16 * v,
          filter: { type: 'bandpass', freq: (540 + 90 * v) * pitch, freqEnd: 260, q: 0.85 },
          pan,
          send: 0.2,
        });
        this.tone(g, t, { freq: 95 * pitch, freqEnd: 62 * pitch, decay: 0.09, gain: 0.1 + 0.14 * p, pan });
        break;

      case 'wallHit':
        // Heavy send: a wall bang is the one contact sound that should ring
        // around the bowl of the park.
        this.tone(g, t, {
          freq: (104 + 10 * v) * pitch,
          freqEnd: 58 * pitch,
          decay: 0.34,
          gain: 0.35 + 0.35 * p,
          pan,
          send: 0.5,
        });
        this.noise(g, t, {
          decay: 0.22,
          gain: 0.2 + 0.2 * p,
          rate: 0.75 + 0.15 * v,
          filter: { type: 'lowpass', freq: 900 * pitch, freqEnd: 300, q: 1.2 },
          pan,
          send: 0.5,
        });
        break;

      case 'throwRelease':
        this.noise(g, t, {
          attack: 0.008,
          decay: 0.085,
          gain: 0.1 + 0.12 * p,
          rate: 1.1 + 0.15 * v,
          filter: { type: 'bandpass', freq: 1300 * pitch, freqEnd: 3200 * pitch, q: 1.3 },
          pan,
          send: 0.1,
        });
        break;

      case 'slide':
        this.noise(g, t, {
          attack: 0.07,
          hold: 0.06,
          decay: 0.34,
          gain: 0.18 + 0.2 * p,
          rate: 0.7 + 0.2 * v,
          filter: { type: 'bandpass', freq: (900 + 150 * v) * pitch, freqEnd: 320, q: 0.7 },
          pan,
          send: 0.24,
        });
        break;

      case 'umpStrike':
        this.bark(g, t, [{ dur: 0.2, vowel: 'ae', to: 'i', p0: 1.25, p1: 0.95, onset: 'plosive' }], 118 + 8 * v, 0.42 + 0.2 * p, pan);
        break;

      case 'umpBall':
        this.bark(g, t, [{ dur: 0.24, vowel: 'o', to: 'a', p0: 1, p1: 0.78, onset: 'plosive' }], 112 + 8 * v, 0.34 + 0.16 * p, pan);
        break;

      case 'umpOut':
        this.bark(g, t, [{ dur: 0.26, vowel: 'a', to: 'u', p0: 1.4, p1: 0.85, onset: 'plosive' }], 120 + 8 * v, 0.46 + 0.2 * p, pan);
        break;

      case 'umpSafe':
        this.bark(g, t, [{ dur: 0.3, vowel: 'e', to: 'i', p0: 1.2, p1: 1, onset: 'sibilant' }], 116 + 8 * v, 0.42 + 0.2 * p, pan);
        break;

      case 'homerun': {
        // Rising sweep -> impact -> ascending triad. Reads as "gone" in ~1.3 s.
        this.noise(g, t, {
          attack: 0.28,
          decay: 0.12,
          gain: 0.16 + 0.14 * p,
          rate: 1,
          filter: { type: 'bandpass', freq: 400, freqEnd: 5200, q: 1.1 },
          send: 0.35,
        });
        this.tone(g, t, {
          type: 'sawtooth',
          freq: 180,
          freqEnd: 1500,
          glide: 0.34,
          attack: 0.2,
          decay: 0.16,
          gain: 0.16,
          filter: { type: 'lowpass', freq: 800, freqEnd: 6000, q: 3 },
          shape: true,
          send: 0.3,
        });
        this.noise(g, t, { delay: 0.36, decay: 0.9, gain: 0.24, filter: { type: 'highpass', freq: 3800 }, send: 0.5 });
        const chord = [440, 554.37, 659.25, 880];
        for (let i = 0; i < chord.length; i++) {
          this.tone(g, t, {
            type: 'sawtooth',
            delay: 0.36 + i * 0.085,
            freq: chord[i],
            detune: i % 2 === 0 ? -8 : 7,
            attack: 0.01,
            decay: 0.55 - i * 0.05,
            gain: 0.14,
            filter: { type: 'lowpass', freq: 5200, freqEnd: 1600, q: 2 },
            shape: true,
            send: 0.4,
          });
        }
        this.tone(g, t, { delay: 0.36, freq: 82.4, freqEnd: 55, decay: 0.7, gain: 0.3 });
        break;
      }

      case 'strikeout': {
        const notes = [659.25, 554.37, 440];
        for (let i = 0; i < notes.length; i++) {
          this.tone(g, t, {
            type: 'square',
            delay: i * 0.1,
            freq: notes[i],
            detune: i === 1 ? -6 : 5,
            decay: i === 2 ? 0.4 : 0.12,
            gain: 0.15,
            filter: { type: 'lowpass', freq: 3200, freqEnd: 1200, q: 2 },
            send: 0.25,
          });
        }
        this.noise(g, t, { delay: 0.2, decay: 0.3, gain: 0.16, filter: { type: 'bandpass', freq: 2200, q: 1 }, send: 0.3 });
        break;
      }

      case 'walk':
        this.tone(g, t, { type: 'triangle', freq: 392, decay: 0.16, gain: 0.14, send: 0.2 });
        this.tone(g, t, { type: 'triangle', delay: 0.13, freq: 329.63, decay: 0.3, gain: 0.14, send: 0.2 });
        break;

      case 'runScored': {
        // Bright ascending arpeggio; bell-ish triangles so it cuts through the
        // crowd swell that always follows a run.
        const notes = [523.25, 659.25, 783.99, 1046.5];
        for (let i = 0; i < notes.length; i++) {
          this.tone(g, t, {
            type: 'triangle',
            delay: i * 0.075,
            freq: notes[i],
            decay: i === notes.length - 1 ? 0.5 : 0.18,
            gain: 0.13 + 0.05 * p,
            send: 0.35,
          });
        }
        break;
      }

      case 'bigPlay':
        this.tone(g, t, {
          type: 'sawtooth',
          freq: 293.66,
          decay: 0.18,
          gain: 0.15,
          filter: { type: 'lowpass', freq: 4000, freqEnd: 1400, q: 3 },
          shape: true,
          send: 0.3,
        });
        this.tone(g, t, {
          type: 'sawtooth',
          delay: 0.12,
          freq: 440,
          detune: 6,
          decay: 0.45,
          gain: 0.16,
          filter: { type: 'lowpass', freq: 5000, freqEnd: 1600, q: 3 },
          shape: true,
          send: 0.35,
        });
        this.noise(g, t, { decay: 0.7, gain: 0.16, filter: { type: 'highpass', freq: 4200 }, send: 0.4 });
        break;

      case 'error':
        // Two saws a semitone apart, sagging in pitch: unambiguous "that was bad".
        this.tone(g, t, {
          type: 'sawtooth',
          freq: 233.08,
          freqEnd: 174.61,
          glide: 0.4,
          decay: 0.42,
          gain: 0.13,
          filter: { type: 'lowpass', freq: 1600, freqEnd: 600, q: 4 },
        });
        this.tone(g, t, {
          type: 'sawtooth',
          freq: 246.94,
          freqEnd: 185,
          glide: 0.4,
          detune: 12,
          decay: 0.42,
          gain: 0.11,
          filter: { type: 'lowpass', freq: 1400, freqEnd: 520, q: 4 },
        });
        break;

      case 'inningChange': {
        const notes = [440, 554.37, 659.25];
        for (let i = 0; i < notes.length; i++) {
          this.tone(g, t, {
            type: 'triangle',
            delay: i * 0.11,
            freq: notes[i],
            decay: i === 2 ? 0.5 : 0.2,
            gain: 0.14,
            send: 0.35,
          });
        }
        break;
      }

      case 'gameOver': {
        // Plagal-flavoured close: IV - V - I with a long tail.
        const notes = [587.33, 659.25, 493.88, 440];
        for (let i = 0; i < notes.length; i++) {
          this.tone(g, t, {
            type: 'sawtooth',
            delay: i * 0.19,
            freq: notes[i],
            detune: i % 2 === 0 ? -7 : 6,
            attack: 0.012,
            decay: i === notes.length - 1 ? 1.1 : 0.28,
            gain: 0.14,
            filter: { type: 'lowpass', freq: 4200, freqEnd: 1100, q: 2.5 },
            shape: true,
            send: 0.45,
          });
        }
        this.tone(g, t, { delay: 0.57, freq: 110, freqEnd: 82.4, decay: 1.2, gain: 0.22 });
        break;
      }

      case 'menuMove':
        this.tone(g, t, {
          type: 'square',
          freq: (620 + 40 * v) * pitch,
          freqEnd: (760 + 40 * v) * pitch,
          glide: 0.03,
          decay: 0.05,
          gain: 0.1,
          filter: { type: 'lowpass', freq: 3600, q: 1 },
          pan,
        });
        break;

      case 'menuSelect':
        this.tone(g, t, { type: 'square', freq: 660 * pitch, decay: 0.06, gain: 0.11, filter: { type: 'lowpass', freq: 4200, q: 1 }, pan });
        this.tone(g, t, {
          type: 'square',
          delay: 0.055,
          freq: 990 * pitch,
          decay: 0.16,
          gain: 0.11,
          filter: { type: 'lowpass', freq: 5200, q: 1 },
          pan,
          send: 0.2,
        });
        break;

      case 'menuBack':
        this.tone(g, t, { type: 'square', freq: 520 * pitch, decay: 0.06, gain: 0.1, filter: { type: 'lowpass', freq: 3400, q: 1 }, pan });
        this.tone(g, t, { type: 'square', delay: 0.055, freq: 392 * pitch, decay: 0.14, gain: 0.1, filter: { type: 'lowpass', freq: 3000, q: 1 }, pan });
        break;

      case 'menuDenied':
        this.tone(g, t, {
          type: 'square',
          freq: 168 * pitch,
          decay: 0.17,
          gain: 0.12,
          filter: { type: 'lowpass', freq: 900, q: 3 },
          pan,
        });
        this.tone(g, t, {
          type: 'square',
          freq: 178 * pitch,
          detune: 18,
          decay: 0.17,
          gain: 0.1,
          filter: { type: 'lowpass', freq: 850, q: 3 },
          pan,
        });
        break;

      case 'countdown':
        this.tone(g, t, {
          type: 'triangle',
          freq: 880 * pitch,
          decay: 0.19,
          gain: 0.14,
          send: 0.3,
        });
        this.noise(g, t, { decay: 0.02, gain: 0.05, filter: { type: 'highpass', freq: 5000 } });
        break;

      default:
        break;
    }
  }

  /** Short umpire call: the announcer voice, clipped and drier. */
  private bark(g: Graph, t: number, syl: readonly Syllable[], baseHz: number, gain: number, pan: number): void {
    if (t < this.voiceBusyUntil) return;
    // Halved pan: the umpire is near the plate, so calls stay close to centre
    // even when the caller passes a full-width position.
    const total = this.speak(g, t, syl, baseHz, gain, 0.22, pan * 0.5);
    this.voiceBusyUntil = t + total + 0.05;
  }
}

/* ------------------------------------------------------------------------- *
 * Module helpers
 * ------------------------------------------------------------------------- */

type AudioContextCtor = new () => AudioContext;

/**
 * WaveShaperNode.curve is typed against a plain ArrayBuffer in current TS libs,
 * so derive the exact type from the DOM definition rather than writing
 * `Float32Array` (which widens to ArrayBufferLike and no longer assigns).
 */
type ShaperCurve = NonNullable<WaveShaperNode['curve']>;

function getAudioContextCtor(): AudioContextCtor | null {
  const g = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/**
 * Exponential AD envelope. Exponential rather than linear because a linear
 * ramp from silence clicks audibly at the 2-4 ms attacks used here, and the
 * floor is 0.0002 rather than 0 because exponentialRampToValueAtTime rejects
 * zero targets.
 */
function envelope(param: AudioParam, t: number, attack: number, hold: number, decay: number, peak: number): void {
  const p = Math.max(0.0004, peak);
  param.setValueAtTime(0.0002, t);
  param.exponentialRampToValueAtTime(p, t + attack);
  param.setValueAtTime(p, t + attack + hold);
  param.exponentialRampToValueAtTime(0.0002, t + attack + hold + decay);
  param.setValueAtTime(0, t + attack + hold + decay + 0.001);
}

function rampTo(param: AudioParam, value: number, now: number, seconds: number): void {
  try {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + Math.max(0.005, seconds));
  } catch {
    try {
      param.value = value;
    } catch {
      /* ignore */
    }
  }
}

function setTarget(param: AudioParam, value: number, now: number, timeConstant: number): void {
  try {
    param.setTargetAtTime(value, now, Math.max(0.01, timeConstant));
  } catch {
    /* ignore */
  }
}

function safeStop(src: AudioScheduledSourceNode): void {
  try {
    src.onended = null;
    src.stop();
  } catch {
    /* already stopped */
  }
  try {
    src.disconnect();
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------------- *
 * Singleton
 * ------------------------------------------------------------------------- */

let singleton: AudioEngine | null = null;

/** Shared engine for the whole app. Created on first use, never re-created. */
export function getAudio(): AudioEngine {
  if (!singleton) singleton = new AudioEngine();
  return singleton;
}
