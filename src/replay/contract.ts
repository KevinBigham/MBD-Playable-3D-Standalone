/** Native, production-safe broadcast sequence contract. Theatre Studio exports
 * this shape; the game runtime knows nothing about Theatre projects. */

export type ReplayHighlightKind = 'home-run' | 'great-catch' | 'final-out';
export type ReplayAnchor = 'recorded-camera' | 'ball' | 'primary-actor' | 'home-plate';
export type ReplayEase = 'linear' | 'smoothstep' | 'ease-in-out-cubic';

export interface BroadcastShotV1 {
  id: string;
  /** Normalised positions within the selected replay clip. */
  start: number;
  end: number;
  anchor: ReplayAnchor;
  fallbackAnchor: Exclude<ReplayAnchor, 'primary-actor'>;
  eyeFrom: [number, number, number];
  eyeTo: [number, number, number];
  lookFrom: [number, number, number];
  lookTo: [number, number, number];
  fovFrom: number;
  fovTo: number;
  ease: ReplayEase;
  cut: boolean;
}

export interface BroadcastSequenceV1 {
  version: 1;
  id: string;
  label: string;
  kind: ReplayHighlightKind;
  shots: BroadcastShotV1[];
}

const TOP_KEYS = ['id', 'kind', 'label', 'shots', 'version'] as const;
const SHOT_KEYS = [
  'anchor',
  'cut',
  'ease',
  'end',
  'eyeFrom',
  'eyeTo',
  'fallbackAnchor',
  'fovFrom',
  'fovTo',
  'id',
  'lookFrom',
  'lookTo',
  'start',
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], at: string): void {
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, i) => key !== expected[i])) {
    throw new Error(`${at} has unknown or missing keys: ${actual.join(', ')}`);
  }
}

function finite(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${at} must be finite`);
  return value;
}

function vec3(value: unknown, at: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${at} must be a 3-vector`);
  return [finite(value[0], `${at}[0]`), finite(value[1], `${at}[1]`), finite(value[2], `${at}[2]`)];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], at: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${at} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

export function parseBroadcastSequenceV1(value: unknown): BroadcastSequenceV1 {
  if (!isObject(value)) throw new Error('broadcast sequence must be an object');
  exactKeys(value, TOP_KEYS, 'broadcast sequence');
  if (value.version !== 1) throw new Error('broadcast sequence version must be 1');
  if (typeof value.id !== 'string' || !/^[a-z0-9-]+$/.test(value.id)) throw new Error('invalid sequence id');
  if (typeof value.label !== 'string' || value.label.length < 1) throw new Error('invalid sequence label');
  const kind = oneOf(value.kind, ['home-run', 'great-catch', 'final-out'] as const, 'sequence.kind');
  if (!Array.isArray(value.shots) || value.shots.length < 1 || value.shots.length > 12) {
    throw new Error('sequence.shots must contain 1..12 shots');
  }

  let previousEnd = 0;
  const shots = value.shots.map((raw, i): BroadcastShotV1 => {
    const at = `sequence.shots[${i}]`;
    if (!isObject(raw)) throw new Error(`${at} must be an object`);
    exactKeys(raw, SHOT_KEYS, at);
    if (typeof raw.id !== 'string' || !/^[a-z0-9-]+$/.test(raw.id)) throw new Error(`${at}.id is invalid`);
    const start = finite(raw.start, `${at}.start`);
    const end = finite(raw.end, `${at}.end`);
    if (start < 0 || end > 1 || end <= start || start < previousEnd - 1e-6) {
      throw new Error(`${at} has an invalid or overlapping timeline`);
    }
    if (i === 0 && start !== 0) throw new Error('the first shot must start at 0');
    previousEnd = end;
    const fovFrom = finite(raw.fovFrom, `${at}.fovFrom`);
    const fovTo = finite(raw.fovTo, `${at}.fovTo`);
    if (fovFrom < 18 || fovFrom > 90 || fovTo < 18 || fovTo > 90) throw new Error(`${at} fov is outside 18..90`);
    if (typeof raw.cut !== 'boolean') throw new Error(`${at}.cut must be boolean`);
    return {
      id: raw.id,
      start,
      end,
      anchor: oneOf(raw.anchor, ['recorded-camera', 'ball', 'primary-actor', 'home-plate'] as const, `${at}.anchor`),
      fallbackAnchor: oneOf(raw.fallbackAnchor, ['recorded-camera', 'ball', 'home-plate'] as const, `${at}.fallbackAnchor`),
      eyeFrom: vec3(raw.eyeFrom, `${at}.eyeFrom`),
      eyeTo: vec3(raw.eyeTo, `${at}.eyeTo`),
      lookFrom: vec3(raw.lookFrom, `${at}.lookFrom`),
      lookTo: vec3(raw.lookTo, `${at}.lookTo`),
      fovFrom,
      fovTo,
      ease: oneOf(raw.ease, ['linear', 'smoothstep', 'ease-in-out-cubic'] as const, `${at}.ease`),
      cut: raw.cut,
    };
  });
  if (Math.abs(previousEnd - 1) > 1e-6) throw new Error('the final shot must end at 1');
  return { version: 1, id: value.id, label: value.label, kind, shots };
}
