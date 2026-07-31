/**
 * MOONSHOT NINE — procedural music.
 *
 * Every note here is synthesised from oscillators and JS-authored noise; the
 * project ships no audio assets of any kind.
 *
 * DESIGN NOTE — why arrangements are baked once:
 * Each track builds its full multi-bar arrangement up front from a seeded PRNG
 * and then replays that fixed pattern bar after bar. The alternative (drawing
 * random numbers while the track plays) would make a loop slowly mutate into
 * something else over a nine-inning game and would sound different every
 * session. Baking gives us humanised timing/velocity *and* a track that is
 * identical every time it starts.
 *
 * SCHEDULING:
 * A setInterval "lookahead" pump schedules whole bars a fraction of a second in
 * advance onto the Web Audio clock. Timer jitter therefore never reaches the
 * ear — the timer only has to be punctual enough to stay ahead of the audio
 * clock, and everything it queues is sample-accurate.
 */

export type MusicTrack = 'title' | 'menu' | 'gameplay' | 'tense' | 'victory' | 'homerun';

export interface TrackHandle {
  /** Begin playing at AudioContext time `t` (clamped to now if already past). */
  start(t: number): void;
  /** Stop scheduling at time `t` and tear the graph down once the tail decays. */
  stop(t: number): void;
}

/* ------------------------------------------------------------------------- *
 * Tiny deterministic PRNG (mulberry32). Deliberately local to this module so
 * the music never depends on the simulation's RNG stream.
 * ------------------------------------------------------------------------- */

export interface MusicRng {
  next(): number;
  range(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
}

export function createMusicRng(seed: number): MusicRng {
  let s = (seed >>> 0) || 0x6d2b79f5;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min: number, max: number): number => min + next() * (max - min),
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length) % items.length];
    },
  };
}

/** Stable per-track seed so 'title' always sounds like 'title'. */
export function trackSeed(track: MusicTrack): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < track.length; i++) {
    h ^= track.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ------------------------------------------------------------------------- *
 * Low-level helpers
 * ------------------------------------------------------------------------- */

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** MIDI note number to Hz (A4 = 69 = 440 Hz). */
const hz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * Web Audio nodes are only collected once they are disconnected AND finished,
 * so every voice disconnects its whole chain when its source ends. Without this
 * a nine-inning game leaks a few thousand nodes.
 */
function cleanupOnEnd(src: AudioScheduledSourceNode, nodes: readonly AudioNode[]): void {
  src.onended = (): void => {
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch {
        /* already torn down (context closed) */
      }
    }
  };
}

/**
 * Exponential AD(S)R on a gain param. Exponential segments are used rather than
 * linear ones because a linear attack from zero on a saw stack produces an
 * audible click at these short attack times.
 * Returns the time at which the envelope has finished.
 */
function adsr(
  param: AudioParam,
  t: number,
  attack: number,
  hold: number,
  decay: number,
  peak: number,
): number {
  const p = Math.max(0.0004, peak);
  param.setValueAtTime(0.0002, t);
  param.exponentialRampToValueAtTime(p, t + attack);
  param.setValueAtTime(p, t + attack + hold);
  param.exponentialRampToValueAtTime(0.0002, t + attack + hold + decay);
  return t + attack + hold + decay;
}

/** StereoPanner is missing on very old Safari; fall back to a plain gain node. */
function makePan(ctx: AudioContext, amount: number): AudioNode {
  if (typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(amount, -1, 1);
    return p;
  }
  return ctx.createGain();
}

/**
 * One shared 2-second white-noise buffer per context, generated with a fixed
 * xorshift seed so percussion timbre is reproducible. Individual hits vary by
 * reading from a random offset instead of by allocating new buffers.
 */
const noiseCache = new WeakMap<AudioContext, AudioBuffer>();
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const cached = noiseCache.get(ctx);
  if (cached) return cached;
  const len = Math.max(1, Math.floor(ctx.sampleRate * 2));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let s = 0x1f123bb5 >>> 0;
  for (let i = 0; i < len; i++) {
    s ^= (s << 13) >>> 0;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= (s << 5) >>> 0;
    s >>>= 0;
    data[i] = (s / 4294967296) * 2 - 1;
  }
  noiseCache.set(ctx, buf);
  return buf;
}

/**
 * WaveShaperNode.curve is typed against a plain ArrayBuffer in current TS libs,
 * so the exact type is derived from the DOM definition instead of the wider
 * bare `Float32Array`, which no longer assigns.
 */
type ShaperCurve = NonNullable<WaveShaperNode['curve']>;

/** Soft-clip curve shared by every distorted voice; cached, not ctx-bound. */
let softClipCurve: ShaperCurve | null = null;
function getSoftClip(): ShaperCurve {
  if (softClipCurve) return softClipCurve;
  const n = 1024;
  const curve = new Float32Array(n);
  const drive = 2.2;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  softClipCurve = curve;
  return curve;
}

function startNoise(ctx: AudioContext, rate: number): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.playbackRate.value = rate;
  return src;
}

/** Random-ish but cheap read offset; keeps repeated hits from phase-locking. */
let noiseCursor = 0.137;
function nextNoiseOffset(): number {
  noiseCursor = (noiseCursor + 0.3819660112) % 1; // golden-ratio walk = well spread
  return noiseCursor * 1.5;
}

/* ------------------------------------------------------------------------- *
 * Instruments
 * ------------------------------------------------------------------------- */

/** Punchy synth bass: saw + square + sine sub through an enveloped lowpass. */
function playBass(ctx: AudioContext, dest: AudioNode, t: number, midi: number, dur: number, vel: number): void {
  const f = hz(midi);
  const amp = ctx.createGain();
  amp.connect(dest);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 5;
  lp.connect(amp);
  lp.frequency.setValueAtTime(clamp(f * 9 + 500 * vel, 120, 9000), t);
  lp.frequency.exponentialRampToValueAtTime(clamp(f * 2.4, 90, 9000), t + Math.min(0.28, dur));

  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.value = f;
  saw.detune.value = -7;
  saw.connect(lp);

  const sq = ctx.createOscillator();
  sq.type = 'square';
  sq.frequency.value = f;
  sq.detune.value = 6;
  const sqG = ctx.createGain();
  sqG.gain.value = 0.45;
  sq.connect(sqG).connect(lp);

  // Sub an octave below carries the weight on laptop speakers via harmonics.
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = f * 0.5;
  const subG = ctx.createGain();
  subG.gain.value = 0.6;
  sub.connect(subG).connect(lp);

  const end = adsr(amp.gain, t, 0.006, Math.max(0.01, dur * 0.5), Math.max(0.06, dur * 0.55), 0.42 * vel);
  saw.start(t);
  sq.start(t);
  sub.start(t);
  saw.stop(end + 0.02);
  sq.stop(end + 0.02);
  sub.stop(end + 0.02);
  cleanupOnEnd(saw, [saw, sq, sqG, sub, subG, lp, amp]);
}

/**
 * Bright detuned-saw lead standing in for a brass section: three saws a few
 * cents apart, a filter that opens on the attack, gentle vibrato that arrives
 * late (an immediate vibrato reads as "wobbly synth", a delayed one as "player").
 */
function playLead(
  ctx: AudioContext,
  dest: AudioNode,
  send: AudioNode | null,
  t: number,
  midi: number,
  dur: number,
  vel: number,
): void {
  const f = hz(midi);
  const amp = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  shaper.curve = getSoftClip();
  shaper.connect(amp);
  amp.connect(dest);
  if (send) amp.connect(send);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 7;
  lp.connect(shaper);
  lp.frequency.setValueAtTime(clamp(f * 2, 300, 12000), t);
  lp.frequency.exponentialRampToValueAtTime(clamp(f * 7 + 1800 * vel, 500, 14000), t + 0.05);
  lp.frequency.exponentialRampToValueAtTime(clamp(f * 3.2 + 500, 400, 12000), t + Math.max(0.12, dur * 0.8));

  const vib = ctx.createOscillator();
  vib.type = 'sine';
  vib.frequency.value = 5.4;
  const vibAmt = ctx.createGain();
  vibAmt.gain.setValueAtTime(0, t);
  vibAmt.gain.setValueAtTime(0, t + Math.min(0.18, dur * 0.4));
  vibAmt.gain.linearRampToValueAtTime(7, t + Math.min(0.45, dur * 0.9));
  vib.connect(vibAmt);

  const detunes = [-9, 4, 12];
  const oscs: OscillatorNode[] = [];
  const gains: GainNode[] = [];
  for (let i = 0; i < detunes.length; i++) {
    const o = ctx.createOscillator();
    o.type = i === 2 ? 'square' : 'sawtooth';
    o.frequency.value = f;
    o.detune.value = detunes[i];
    const g = ctx.createGain();
    g.gain.value = i === 2 ? 0.22 : 0.5;
    o.connect(g).connect(lp);
    vibAmt.connect(o.detune);
    oscs.push(o);
    gains.push(g);
  }

  const end = adsr(amp.gain, t, 0.02, Math.max(0.02, dur * 0.55), Math.max(0.1, dur * 0.5), 0.3 * vel);
  vib.start(t);
  vib.stop(end + 0.02);
  for (const o of oscs) {
    o.start(t);
    o.stop(end + 0.02);
  }
  cleanupOnEnd(oscs[0], [...oscs, ...gains, vib, vibAmt, lp, shaper, amp]);
}

/** Short chord stab: the off-beat push that gives the groove its bounce. */
function playStab(ctx: AudioContext, dest: AudioNode, t: number, notes: readonly number[], dur: number, vel: number): void {
  const amp = ctx.createGain();
  amp.connect(dest);
  const bp = ctx.createBiquadFilter();
  bp.type = 'lowpass';
  bp.Q.value = 3;
  bp.frequency.setValueAtTime(4200 + 2500 * vel, t);
  bp.frequency.exponentialRampToValueAtTime(900, t + Math.max(0.08, dur));
  bp.connect(amp);

  const oscs: OscillatorNode[] = [];
  const gains: GainNode[] = [];
  for (let i = 0; i < notes.length; i++) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = hz(notes[i]);
    o.detune.value = i % 2 === 0 ? -6 : 6;
    const g = ctx.createGain();
    g.gain.value = 1 / Math.max(1, notes.length);
    o.connect(g).connect(bp);
    oscs.push(o);
    gains.push(g);
  }
  if (oscs.length === 0) return;

  const end = adsr(amp.gain, t, 0.008, 0.01, Math.max(0.08, dur), 0.3 * vel);
  for (const o of oscs) {
    o.start(t);
    o.stop(end + 0.02);
  }
  cleanupOnEnd(oscs[0], [...oscs, ...gains, bp, amp]);
}

/** Slow soft pad — sits under everything and glues the harmony together. */
function playPad(ctx: AudioContext, dest: AudioNode, t: number, notes: readonly number[], dur: number, vel: number): void {
  const amp = ctx.createGain();
  amp.connect(dest);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1400;
  lp.Q.value = 0.7;
  lp.connect(amp);

  const oscs: OscillatorNode[] = [];
  const gains: GainNode[] = [];
  for (let i = 0; i < notes.length; i++) {
    for (const d of [-8, 9]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = hz(notes[i]);
      o.detune.value = d;
      const g = ctx.createGain();
      g.gain.value = 0.5 / Math.max(1, notes.length);
      o.connect(g).connect(lp);
      oscs.push(o);
      gains.push(g);
    }
  }
  if (oscs.length === 0) return;

  const attack = Math.min(0.35, dur * 0.4);
  const end = adsr(amp.gain, t, attack, Math.max(0.05, dur - attack), 0.35, 0.16 * vel);
  for (const o of oscs) {
    o.start(t);
    o.stop(end + 0.05);
  }
  cleanupOnEnd(oscs[0], [...oscs, ...gains, lp, amp]);
}

/** Inharmonic FM bell for accents. */
function playBell(ctx: AudioContext, dest: AudioNode, t: number, midi: number, dur: number, vel: number): void {
  const f = hz(midi);
  const amp = ctx.createGain();
  amp.connect(dest);
  const carrier = ctx.createOscillator();
  carrier.type = 'sine';
  carrier.frequency.value = f;
  const mod = ctx.createOscillator();
  mod.type = 'sine';
  mod.frequency.value = f * 2.76; // classic inharmonic ratio -> metallic, not organ-like
  const modG = ctx.createGain();
  modG.gain.setValueAtTime(f * 2.4 * vel, t);
  modG.gain.exponentialRampToValueAtTime(1, t + Math.max(0.12, dur));
  mod.connect(modG).connect(carrier.frequency);
  carrier.connect(amp);

  const end = adsr(amp.gain, t, 0.004, 0.01, Math.max(0.2, dur), 0.22 * vel);
  carrier.start(t);
  mod.start(t);
  carrier.stop(end + 0.02);
  mod.stop(end + 0.02);
  cleanupOnEnd(carrier, [carrier, mod, modG, amp]);
}

function playKick(ctx: AudioContext, dest: AudioNode, t: number, vel: number): void {
  const amp = ctx.createGain();
  amp.connect(dest);
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(140, t);
  osc.frequency.exponentialRampToValueAtTime(44, t + 0.075);
  osc.connect(amp);
  const end = adsr(amp.gain, t, 0.003, 0.01, 0.26, 0.85 * vel);
  osc.start(t);
  osc.stop(end + 0.02);
  cleanupOnEnd(osc, [osc, amp]);

  // Click transient: without it the kick disappears on small speakers.
  const cAmp = ctx.createGain();
  cAmp.connect(dest);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1200;
  hp.connect(cAmp);
  const n = startNoise(ctx, 1);
  n.connect(hp);
  adsr(cAmp.gain, t, 0.001, 0.001, 0.02, 0.25 * vel);
  n.start(t, nextNoiseOffset());
  n.stop(t + 0.05);
  cleanupOnEnd(n, [n, hp, cAmp]);
}

function playSnare(ctx: AudioContext, dest: AudioNode, t: number, vel: number): void {
  const amp = ctx.createGain();
  amp.connect(dest);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1900;
  bp.Q.value = 0.9;
  bp.connect(amp);
  const n = startNoise(ctx, 1.05);
  n.connect(bp);
  const end = adsr(amp.gain, t, 0.002, 0.005, 0.16, 0.5 * vel);
  n.start(t, nextNoiseOffset());
  n.stop(end + 0.02);
  cleanupOnEnd(n, [n, bp, amp]);

  // Two detuned bodies give the shell some pitch without sounding like a tom.
  const bAmp = ctx.createGain();
  bAmp.connect(dest);
  const o1 = ctx.createOscillator();
  o1.type = 'triangle';
  o1.frequency.value = 190;
  const o2 = ctx.createOscillator();
  o2.type = 'triangle';
  o2.frequency.value = 268;
  o1.connect(bAmp);
  o2.connect(bAmp);
  const bEnd = adsr(bAmp.gain, t, 0.002, 0.004, 0.08, 0.22 * vel);
  o1.start(t);
  o2.start(t);
  o1.stop(bEnd + 0.02);
  o2.stop(bEnd + 0.02);
  cleanupOnEnd(o1, [o1, o2, bAmp]);
}

function playHat(ctx: AudioContext, dest: AudioNode, t: number, vel: number, open: boolean): void {
  const amp = ctx.createGain();
  amp.connect(dest);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = open ? 6500 : 8200;
  hp.connect(amp);
  const n = startNoise(ctx, open ? 1.2 : 1.7);
  n.connect(hp);
  const decay = open ? 0.19 : 0.035;
  const end = adsr(amp.gain, t, 0.001, 0.002, decay, (open ? 0.2 : 0.16) * vel);
  n.start(t, nextNoiseOffset());
  n.stop(end + 0.02);
  cleanupOnEnd(n, [n, hp, amp]);
}

function playShaker(ctx: AudioContext, dest: AudioNode, t: number, vel: number): void {
  const amp = ctx.createGain();
  amp.connect(dest);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 6800;
  bp.Q.value = 1.6;
  bp.connect(amp);
  const n = startNoise(ctx, 1.4);
  n.connect(bp);
  const end = adsr(amp.gain, t, 0.004, 0.001, 0.045, 0.14 * vel);
  n.start(t, nextNoiseOffset());
  n.stop(end + 0.02);
  cleanupOnEnd(n, [n, bp, amp]);
}

function playRim(ctx: AudioContext, dest: AudioNode, t: number, vel: number): void {
  const amp = ctx.createGain();
  amp.connect(dest);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2400;
  bp.Q.value = 6;
  bp.connect(amp);
  const n = startNoise(ctx, 1);
  n.connect(bp);
  const o = ctx.createOscillator();
  o.type = 'square';
  o.frequency.value = 820;
  const oG = ctx.createGain();
  oG.gain.value = 0.3;
  o.connect(oG).connect(bp);
  const end = adsr(amp.gain, t, 0.001, 0.001, 0.05, 0.35 * vel);
  n.start(t, nextNoiseOffset());
  n.stop(end + 0.02);
  o.start(t);
  o.stop(end + 0.02);
  cleanupOnEnd(n, [n, o, oG, bp, amp]);
}

function playTom(ctx: AudioContext, dest: AudioNode, t: number, midi: number, vel: number): void {
  const f = hz(midi);
  const amp = ctx.createGain();
  amp.connect(dest);
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f * 1.6, t);
  osc.frequency.exponentialRampToValueAtTime(f * 0.85, t + 0.14);
  osc.connect(amp);
  const noiseAmp = ctx.createGain();
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = f * 3;
  bp.Q.value = 1.2;
  bp.connect(noiseAmp);
  noiseAmp.connect(dest);
  const n = startNoise(ctx, 1);
  n.connect(bp);
  adsr(noiseAmp.gain, t, 0.001, 0.001, 0.05, 0.12 * vel);
  const end = adsr(amp.gain, t, 0.003, 0.01, 0.3, 0.5 * vel);
  osc.start(t);
  osc.stop(end + 0.02);
  n.start(t, nextNoiseOffset());
  n.stop(t + 0.1);
  cleanupOnEnd(osc, [osc, amp]);
  cleanupOnEnd(n, [n, bp, noiseAmp]);
}

function playClap(ctx: AudioContext, dest: AudioNode, t: number, vel: number): void {
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1500;
  bp.Q.value = 1.1;
  const amp = ctx.createGain();
  bp.connect(amp);
  amp.connect(dest);
  // Three fast slaps plus a tail is what separates a clap from a noise burst.
  const offsets = [0, 0.011, 0.023];
  amp.gain.setValueAtTime(0.0002, t);
  for (const o of offsets) {
    amp.gain.setValueAtTime(0.45 * vel, t + o);
    amp.gain.exponentialRampToValueAtTime(0.02, t + o + 0.01);
  }
  amp.gain.setValueAtTime(0.3 * vel, t + 0.034);
  amp.gain.exponentialRampToValueAtTime(0.0002, t + 0.2);
  const n = startNoise(ctx, 1);
  n.connect(bp);
  n.start(t, nextNoiseOffset());
  n.stop(t + 0.24);
  cleanupOnEnd(n, [n, bp, amp]);
}

function playCrash(ctx: AudioContext, dest: AudioNode, t: number, vel: number): void {
  const amp = ctx.createGain();
  amp.connect(dest);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 4200;
  hp.connect(amp);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(14000, t);
  lp.frequency.exponentialRampToValueAtTime(3000, t + 1.4);
  lp.connect(hp);
  const n = startNoise(ctx, 0.85);
  n.connect(lp);
  const end = adsr(amp.gain, t, 0.004, 0.02, 1.3, 0.3 * vel);
  n.start(t, nextNoiseOffset());
  n.stop(end + 0.05);
  cleanupOnEnd(n, [n, lp, hp, amp]);
}

/* ------------------------------------------------------------------------- *
 * Arrangement model
 * ------------------------------------------------------------------------- */

type VoiceKind =
  | 'bass'
  | 'lead'
  | 'stab'
  | 'pad'
  | 'bell'
  | 'kick'
  | 'snare'
  | 'hat'
  | 'openhat'
  | 'tom'
  | 'clap'
  | 'crash'
  | 'shaker'
  | 'rim';

interface MusicEvent {
  /** Beat position within the bar; swing and humanisation already baked in. */
  readonly beat: number;
  /** Length in beats. */
  readonly dur: number;
  readonly vel: number;
  readonly voice: VoiceKind;
  /** MIDI notes; empty for unpitched percussion. */
  readonly notes: readonly number[];
}

interface Arrangement {
  readonly bpm: number;
  readonly beatsPerBar: number;
  readonly bars: readonly (readonly MusicEvent[])[];
  /** Track output level relative to the music bus. */
  readonly gain: number;
  readonly delayWet: number;
  readonly delayFeedback: number;
}

class Arranger {
  readonly bars: MusicEvent[][] = [];
  private readonly rng: MusicRng;
  private readonly swing: number;

  constructor(barCount: number, rng: MusicRng, swing: number) {
    for (let i = 0; i < barCount; i++) this.bars.push([]);
    this.rng = rng;
    this.swing = swing;
  }

  add(bar: number, beat: number, voice: VoiceKind, notes: readonly number[], dur: number, vel: number): void {
    const target = this.bars[((bar % this.bars.length) + this.bars.length) % this.bars.length];
    // Swing delays every second eighth. Applying it here (rather than per voice)
    // keeps drums, bass and lead locked to the same feel.
    const frac = beat - Math.floor(beat);
    const swung = Math.abs(frac - 0.5) < 1e-6 ? beat + this.swing : beat;
    const jitter = this.rng.range(-0.011, 0.011);
    target.push({
      beat: Math.max(0, swung + jitter),
      dur,
      vel: clamp(vel * this.rng.range(0.9, 1.08), 0.02, 1.2),
      voice,
      notes,
    });
  }
}

interface Chord {
  readonly root: number;
  readonly notes: readonly number[];
}

/**
 * The whole soundtrack lives in A major / F# minor so tracks can cross-fade into
 * each other mid-inning without a key clash. Voicings sit around A3–E4 to leave
 * the 200 Hz–2 kHz window (where the crowd bed and bat cracks live) uncluttered.
 */
const CH = {
  A: { root: 45, notes: [57, 61, 64] },
  Aadd9: { root: 45, notes: [57, 62, 64] },
  Ahigh: { root: 45, notes: [61, 64, 69] },
  Fsm: { root: 42, notes: [54, 57, 61] },
  D: { root: 38, notes: [54, 57, 62] },
  E: { root: 40, notes: [56, 59, 64] },
  Bm7: { root: 47, notes: [54, 59, 62] },
  Csm: { root: 37, notes: [56, 61, 64] },
  F: { root: 41, notes: [53, 57, 60] },
  G: { root: 43, notes: [55, 59, 62] },
  Fsm9: { root: 42, notes: [54, 57, 64] },
} satisfies Record<string, Chord>;

/** [beat, duration, semitones above the chord root] */
type BassStep = readonly [number, number, number];
/** [beat, duration, midi] */
type NoteStep = readonly [number, number, number];

/* ------------------------------------------------------------------------- *
 * Tracks
 * ------------------------------------------------------------------------- */

const TITLE_BASS: readonly BassStep[] = [
  [0, 0.45, 0],
  [0.75, 0.2, 0],
  [1.5, 0.45, 12],
  [2, 0.45, 0],
  [2.75, 0.2, 0],
  [3.5, 0.45, 7],
];

/** Original 8-bar hook. Deliberately arch-shaped: it climbs to bar 5 and settles. */
const TITLE_LEAD: readonly (readonly NoteStep[])[] = [
  [[0, 0.5, 69], [0.5, 0.5, 73], [1, 0.9, 76], [2, 0.5, 73], [2.5, 0.5, 76], [3, 0.9, 78]],
  [[0, 0.7, 76], [1, 0.5, 73], [1.5, 0.5, 71], [2, 0.9, 73], [3, 0.9, 69]],
  [[0, 0.5, 71], [0.5, 0.5, 73], [1, 0.9, 74], [2, 0.7, 78], [3, 0.9, 76]],
  [[0, 0.5, 76], [0.5, 0.5, 74], [1, 1.4, 73], [2.5, 0.5, 71], [3, 0.9, 68]],
  [[0, 0.5, 69], [0.5, 0.5, 71], [1, 0.9, 74], [2, 0.5, 76], [2.5, 0.5, 78], [3, 0.9, 81]],
  [[0, 0.7, 80], [1, 0.5, 78], [1.5, 0.5, 76], [2, 0.9, 73], [3, 0.9, 76]],
  [[0, 0.5, 78], [0.5, 0.5, 76], [1, 0.9, 74], [2, 0.5, 71], [2.5, 0.5, 74], [3, 0.9, 76]],
  [[0, 0.9, 78], [1, 0.5, 80], [1.5, 0.5, 78], [2, 1.8, 76]],
];

function buildTitle(rng: MusicRng): Arrangement {
  const a = new Arranger(8, rng, 0.055);
  const prog: readonly Chord[] = [CH.A, CH.Fsm, CH.D, CH.E, CH.Bm7, CH.Csm, CH.D, CH.E];

  for (let b = 0; b < 8; b++) {
    const c = prog[b];
    for (const [beat, dur, off] of TITLE_BASS) a.add(b, beat, 'bass', [c.root + off], dur, 0.95);

    // Off-beat stabs are the "push" that makes a sports theme feel eager.
    a.add(b, 1.5, 'stab', c.notes, 0.3, 0.6);
    a.add(b, 3.5, 'stab', c.notes.map((n) => n + 12), 0.25, 0.5);
    a.add(b, 0, 'pad', c.notes, 3.9, 0.7);

    for (const [beat, dur, midi] of TITLE_LEAD[b]) a.add(b, beat, 'lead', [midi], dur, 0.95);

    a.add(b, 0, 'kick', [], 0.2, 1);
    a.add(b, 1.5, 'kick', [], 0.2, 0.8);
    if (b % 2 === 1) a.add(b, 2.75, 'kick', [], 0.2, 0.7);
    a.add(b, 1, 'snare', [], 0.2, 1);
    a.add(b, 3, 'snare', [], 0.2, 1);
    if (b % 4 === 3) a.add(b, 3, 'clap', [], 0.2, 0.8);
    for (let i = 0; i < 8; i++) {
      const beat = i * 0.5;
      const accent = i % 2 === 0 ? 1 : 0.6;
      a.add(b, beat, i === 6 ? 'openhat' : 'hat', [], 0.2, accent);
    }
    if (b === 0 || b === 4) a.add(b, 0, 'crash', [], 1, 0.9);
    if (b === 7) {
      // Fill that hands the loop back to bar 1.
      a.add(b, 3, 'tom', [57], 0.25, 0.9);
      a.add(b, 3.25, 'tom', [53], 0.25, 0.9);
      a.add(b, 3.5, 'tom', [50], 0.25, 1);
      a.add(b, 3.75, 'tom', [45], 0.25, 1);
    }
  }
  return { bpm: 132, beatsPerBar: 4, bars: a.bars, gain: 0.9, delayWet: 0.22, delayFeedback: 0.26 };
}

function buildMenu(rng: MusicRng): Arrangement {
  const a = new Arranger(4, rng, 0.08);
  const prog: readonly Chord[] = [CH.Aadd9, CH.D, CH.Bm7, CH.E];
  // Same harmony as the title, half the density and a shuffled feel.
  const lead: readonly (readonly NoteStep[])[] = [
    [[1, 0.5, 76], [1.5, 0.5, 73], [2.5, 1.2, 69]],
    [[0.5, 0.5, 74], [1, 0.5, 78], [2, 1.4, 76]],
    [[1, 0.5, 71], [1.5, 0.5, 74], [2.5, 1.2, 78]],
    [[0.5, 0.5, 76], [1.5, 0.5, 73], [2.5, 1.2, 71]],
  ];

  for (let b = 0; b < 4; b++) {
    const c = prog[b];
    a.add(b, 0, 'bass', [c.root], 0.9, 0.8);
    a.add(b, 1.5, 'bass', [c.root], 0.4, 0.6);
    a.add(b, 2.5, 'bass', [c.root + 7], 0.5, 0.7);
    a.add(b, 3.5, 'bass', [c.root + 12], 0.4, 0.55);
    a.add(b, 0, 'pad', c.notes, 3.8, 0.85);
    a.add(b, 2, 'stab', c.notes, 0.3, 0.35);
    for (const [beat, dur, midi] of lead[b]) a.add(b, beat, 'bell', [midi], dur, 0.7);

    a.add(b, 0, 'kick', [], 0.2, 0.8);
    a.add(b, 2, 'kick', [], 0.2, 0.7);
    a.add(b, 1, 'rim', [], 0.2, 0.8);
    a.add(b, 3, 'rim', [], 0.2, 0.8);
    for (let i = 0; i < 8; i++) a.add(b, i * 0.5, 'shaker', [], 0.2, i % 2 === 0 ? 0.9 : 0.55);
  }
  return { bpm: 110, beatsPerBar: 4, bars: a.bars, gain: 0.75, delayWet: 0.18, delayFeedback: 0.2 };
}

function buildGameplay(rng: MusicRng): Arrangement {
  const a = new Arranger(8, rng, 0.05);
  const prog: readonly Chord[] = [CH.A, CH.A, CH.Fsm, CH.Fsm, CH.D, CH.D, CH.E, CH.E];

  for (let b = 0; b < 8; b++) {
    const c = prog[b];
    // Deliberately sparse: bass, ticking hats, and a stab every fourth bar. The
    // 300 Hz-3 kHz band is left mostly empty so bat contact and the umpire cut
    // through without ducking the music.
    a.add(b, 0, 'bass', [c.root], 1.1, 0.75);
    a.add(b, 1.75, 'bass', [c.root], 0.3, 0.45);
    a.add(b, 2.5, 'bass', [c.root + (b % 2 === 0 ? 7 : 12)], 0.8, 0.6);
    if (b % 4 === 3) a.add(b, 3.5, 'stab', c.notes, 0.25, 0.4);
    if (b % 4 === 0) a.add(b, 0, 'pad', c.notes, 3.8, 0.4);

    a.add(b, 0, 'kick', [], 0.2, 0.75);
    a.add(b, 2.5, 'kick', [], 0.2, 0.6);
    if (b % 2 === 1) a.add(b, 3, 'rim', [], 0.2, 0.6);
    for (let i = 0; i < 8; i++) {
      if (i % 2 === 1 && b % 2 === 0) continue; // thin it out further on even bars
      a.add(b, i * 0.5, 'hat', [], 0.2, i % 2 === 0 ? 0.55 : 0.3);
    }
  }
  return { bpm: 100, beatsPerBar: 4, bars: a.bars, gain: 0.55, delayWet: 0.1, delayFeedback: 0.15 };
}

function buildTense(rng: MusicRng): Arrangement {
  const a = new Arranger(8, rng, 0);
  // Minor-leaning with a bVII (G) that never resolves cleanly — unease without
  // being so busy that it competes with a full stadium of crowd noise.
  const prog: readonly Chord[] = [CH.Fsm, CH.Fsm9, CH.D, CH.D, CH.E, CH.E, CH.G, CH.E];

  for (let b = 0; b < 8; b++) {
    const c = prog[b];
    // Driving straight eighths on the root: the pulse is the tension.
    for (let i = 0; i < 8; i++) {
      const accent = i === 0 ? 0.85 : i % 2 === 0 ? 0.55 : 0.4;
      a.add(b, i * 0.5, 'bass', [c.root + (i === 7 ? 12 : 0)], 0.4, accent);
    }
    a.add(b, 0, 'pad', c.notes, 3.9, 0.55);
    a.add(b, 0, 'tom', [45], 0.3, 0.5);
    a.add(b, 2, 'tom', [43], 0.3, 0.45);
    a.add(b, 3, 'snare', [], 0.2, 0.55);
    for (let i = 0; i < 16; i++) a.add(b, i * 0.25, 'shaker', [], 0.15, i % 4 === 0 ? 0.55 : 0.25);
    if (b === 3 || b === 7) {
      // Semitone cluster high up: the "something is about to happen" needle.
      a.add(b, 3.5, 'stab', [c.notes[0] + 12, c.notes[0] + 13], 0.3, 0.35);
    }
    if (b === 6) a.add(b, 0, 'crash', [], 1, 0.4);
  }
  return { bpm: 108, beatsPerBar: 4, bars: a.bars, gain: 0.6, delayWet: 0.12, delayFeedback: 0.3 };
}

function buildVictory(rng: MusicRng): Arrangement {
  const a = new Arranger(4, rng, 0);
  const prog: readonly Chord[] = [CH.A, CH.D, CH.E, CH.Ahigh];
  const fanfare: readonly (readonly NoteStep[])[] = [
    [[0, 0.4, 69], [0.5, 0.4, 73], [1, 0.4, 76], [1.5, 2.4, 81]],
    [[0, 0.9, 78], [1, 0.9, 74], [2, 1.9, 78]],
    [[0, 0.4, 76], [0.5, 0.4, 78], [1, 0.9, 80], [2, 1.9, 76]],
    [[0, 0.4, 81], [0.5, 0.4, 83], [1, 2.9, 85]],
  ];

  for (let b = 0; b < 4; b++) {
    const c = prog[b];
    a.add(b, 0, 'bass', [c.root], 0.9, 1);
    a.add(b, 1, 'bass', [c.root], 0.4, 0.7);
    a.add(b, 2, 'bass', [c.root + 7], 0.9, 0.9);
    a.add(b, 3.5, 'bass', [c.root + 12], 0.4, 0.7);
    a.add(b, 0, 'stab', c.notes, 0.35, 0.9);
    a.add(b, 1, 'stab', c.notes, 0.2, 0.6);
    a.add(b, 2, 'stab', c.notes.map((n) => n + 12), 0.35, 0.8);
    a.add(b, 0, 'pad', c.notes, 3.9, 0.8);
    for (const [beat, dur, midi] of fanfare[b]) a.add(b, beat, 'lead', [midi], dur, 1);
    a.add(b, 0, 'bell', [c.notes[c.notes.length - 1] + 12], 1.5, 0.6);

    a.add(b, 0, 'kick', [], 0.2, 1);
    a.add(b, 2, 'kick', [], 0.2, 0.9);
    a.add(b, 1, 'snare', [], 0.2, 0.9);
    a.add(b, 3, 'snare', [], 0.2, 0.9);
    a.add(b, 3.5, 'snare', [], 0.2, 0.7);
    a.add(b, 0, 'crash', [], 1, b === 0 ? 1 : 0.5);
    for (let i = 0; i < 8; i++) a.add(b, i * 0.5, 'hat', [], 0.2, i % 2 === 0 ? 0.8 : 0.5);
    if (b === 3) {
      a.add(b, 3, 'tom', [50], 0.25, 1);
      a.add(b, 3.5, 'tom', [45], 0.25, 1);
    }
  }
  return { bpm: 126, beatsPerBar: 4, bars: a.bars, gain: 1, delayWet: 0.25, delayFeedback: 0.28 };
}

function buildHomerun(rng: MusicRng): Arrangement {
  const a = new Arranger(4, rng, 0);
  // bVI-bVII-I lift: the cheapest, most reliable "that ball is gone" gesture.
  const prog: readonly Chord[] = [CH.A, CH.F, CH.G, CH.Ahigh];
  const line: readonly (readonly NoteStep[])[] = [
    [[0, 0.9, 69], [1, 0.4, 73], [1.5, 0.4, 76], [2, 1.9, 81]],
    [[0, 0.4, 77], [0.5, 0.4, 72], [1, 0.4, 69], [1.5, 2.4, 77]],
    [[0, 0.4, 74], [0.5, 0.4, 79], [1, 0.4, 83], [1.5, 2.4, 86]],
    [[0, 3.9, 88]],
  ];

  for (let b = 0; b < 4; b++) {
    const c = prog[b];
    for (let i = 0; i < 4; i++) a.add(b, i, 'bass', [c.root + (i === 3 ? 12 : 0)], 0.9, 1);
    a.add(b, 0, 'stab', c.notes, 0.4, 1);
    a.add(b, 1.5, 'stab', c.notes, 0.25, 0.7);
    a.add(b, 2.5, 'stab', c.notes.map((n) => n + 12), 0.3, 0.8);
    a.add(b, 0, 'pad', c.notes, 3.9, 0.9);
    for (const [beat, dur, midi] of line[b]) a.add(b, beat, 'lead', [midi], dur, 1.1);
    a.add(b, 0, 'crash', [], 1, b === 0 || b === 3 ? 1 : 0.6);
    a.add(b, 0, 'kick', [], 0.2, 1);
    a.add(b, 1.5, 'kick', [], 0.2, 0.85);
    a.add(b, 2.5, 'kick', [], 0.2, 0.85);
    a.add(b, 1, 'snare', [], 0.2, 1);
    a.add(b, 3, 'snare', [], 0.2, 1);
    a.add(b, 1, 'clap', [], 0.2, 0.9);
    a.add(b, 3, 'clap', [], 0.2, 0.9);
    for (let i = 0; i < 8; i++) a.add(b, i * 0.5, 'hat', [], 0.2, i % 2 === 0 ? 0.8 : 0.45);
    if (b === 3) {
      a.add(b, 2, 'tom', [55], 0.25, 1);
      a.add(b, 2.5, 'tom', [50], 0.25, 1);
      a.add(b, 3, 'tom', [45], 0.25, 1);
      a.add(b, 3.5, 'tom', [43], 0.25, 1);
    }
  }
  return { bpm: 140, beatsPerBar: 4, bars: a.bars, gain: 1, delayWet: 0.2, delayFeedback: 0.25 };
}

function buildArrangement(track: MusicTrack, rng: MusicRng): Arrangement {
  switch (track) {
    case 'title':
      return buildTitle(rng);
    case 'menu':
      return buildMenu(rng);
    case 'gameplay':
      return buildGameplay(rng);
    case 'tense':
      return buildTense(rng);
    case 'victory':
      return buildVictory(rng);
    case 'homerun':
      return buildHomerun(rng);
    default:
      return buildGameplay(rng);
  }
}

/* ------------------------------------------------------------------------- *
 * Playback
 * ------------------------------------------------------------------------- */

/** How far ahead of the audio clock bars are queued. */
const LOOKAHEAD = 0.55;
/** Pump period. Must be comfortably under LOOKAHEAD even when throttled a bit. */
const TICK_MS = 90;

export function createTrack(
  ctx: AudioContext,
  destination: AudioNode,
  track: MusicTrack,
  rng: MusicRng,
): TrackHandle {
  const spec = buildArrangement(track, rng);
  const spb = 60 / spec.bpm;
  const barSeconds = spb * spec.beatsPerBar;

  const out = ctx.createGain();
  out.gain.value = spec.gain;
  out.connect(destination);

  // Dotted-ish eighth delay on the lead only. A touch under an exact eighth so
  // echoes lean forward instead of smearing the beat.
  const delay = ctx.createDelay(1.5);
  delay.delayTime.value = Math.min(1.4, spb * 0.5 * 0.98);
  const feedback = ctx.createGain();
  feedback.gain.value = spec.delayFeedback;
  const wet = ctx.createGain();
  wet.gain.value = spec.delayWet;
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 3200; // damped repeats stay out of the lead's way
  delay.connect(damp);
  damp.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  wet.connect(out);

  // Percussion gets its own bus so drums can be trimmed without touching pitch.
  const drums = ctx.createGain();
  drums.gain.value = 0.9;
  drums.connect(out);

  const hatPan = makePan(ctx, 0.22);
  hatPan.connect(drums);
  const percPan = makePan(ctx, -0.28);
  percPan.connect(drums);

  let barIndex = 0;
  let nextBarTime = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
  let stopAt = Number.POSITIVE_INFINITY;
  let started = false;
  let torn = false;

  function scheduleEvent(ev: MusicEvent, barTime: number): void {
    const t = barTime + ev.beat * spb;
    const dur = ev.dur * spb;
    switch (ev.voice) {
      case 'bass':
        playBass(ctx, out, t, ev.notes[0], dur, ev.vel);
        break;
      case 'lead':
        playLead(ctx, out, wet.gain.value > 0 ? delay : null, t, ev.notes[0], dur, ev.vel);
        break;
      case 'stab':
        playStab(ctx, out, t, ev.notes, dur, ev.vel);
        break;
      case 'pad':
        playPad(ctx, out, t, ev.notes, dur, ev.vel);
        break;
      case 'bell':
        playBell(ctx, out, t, ev.notes[0], dur, ev.vel);
        break;
      case 'kick':
        playKick(ctx, drums, t, ev.vel);
        break;
      case 'snare':
        playSnare(ctx, drums, t, ev.vel);
        break;
      case 'hat':
        playHat(ctx, hatPan, t, ev.vel, false);
        break;
      case 'openhat':
        playHat(ctx, hatPan, t, ev.vel, true);
        break;
      case 'tom':
        playTom(ctx, percPan, t, ev.notes.length > 0 ? ev.notes[0] : 45, ev.vel);
        break;
      case 'clap':
        playClap(ctx, percPan, t, ev.vel);
        break;
      case 'crash':
        playCrash(ctx, drums, t, ev.vel);
        break;
      case 'shaker':
        playShaker(ctx, hatPan, t, ev.vel);
        break;
      case 'rim':
        playRim(ctx, percPan, t, ev.vel);
        break;
      default:
        break;
    }
  }

  function pump(): void {
    if (torn) return;
    const now = ctx.currentTime;
    // A backgrounded tab can throttle the pump until nextBarTime is far in the
    // past; without this snap the catch-up would fire several bars at once.
    if (nextBarTime < now - 0.05) {
      nextBarTime = now;
      barIndex = 0;
    }
    const horizon = Math.min(now + LOOKAHEAD, stopAt);
    let guard = 0;
    while (nextBarTime < horizon && guard++ < 8) {
      const bar = spec.bars[barIndex % spec.bars.length];
      for (const ev of bar) scheduleEvent(ev, nextBarTime);
      barIndex++;
      nextBarTime += barSeconds;
    }
    if (now >= stopAt && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function teardown(): void {
    if (torn) return;
    torn = true;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    if (cleanupTimer !== null) {
      clearTimeout(cleanupTimer);
      cleanupTimer = null;
    }
    for (const n of [out, delay, feedback, wet, damp, drums, hatPan, percPan]) {
      try {
        n.disconnect();
      } catch {
        /* context already closed */
      }
    }
  }

  return {
    start(t: number): void {
      if (started || torn) return;
      started = true;
      nextBarTime = Math.max(t, ctx.currentTime);
      pump(); // schedule the downbeat synchronously so `start` is never late
      timer = setInterval(pump, TICK_MS);
    },
    stop(t: number): void {
      if (torn) return;
      stopAt = Math.max(t, ctx.currentTime);
      // Keep queueing until the stop point so there is music under the fade-out,
      // then release the graph once the longest tail (crash ~1.4 s) has decayed.
      const waitMs = Math.max(0, stopAt - ctx.currentTime) * 1000 + 2000;
      if (timer !== null && stopAt <= ctx.currentTime) {
        clearInterval(timer);
        timer = null;
      }
      cleanupTimer = setTimeout(teardown, waitMs);
    },
  };
}
