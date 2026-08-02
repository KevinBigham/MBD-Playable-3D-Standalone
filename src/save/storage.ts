/**
 * Local persistence. Everything lives in localStorage under a namespaced,
 * versioned key so a schema change can be detected and discarded rather than
 * crashing on load. There is no account, no server and no network call.
 */

const NS = 'moonshot9';
export const SAVE_VERSION = 3;

export interface Envelope<T> {
  v: number;
  t: number;
  data: T;
}

function key(name: string): string {
  return `${NS}:${name}`;
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    // Safari private mode throws on write rather than on access.
    const probe = `${NS}:__probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

export function saveSlot<T>(name: string, data: T): boolean {
  const s = storage();
  if (!s) return false;
  try {
    const env: Envelope<T> = { v: SAVE_VERSION, t: Date.now(), data };
    s.setItem(key(name), JSON.stringify(env));
    return true;
  } catch {
    return false;
  }
}

export function loadSlot<T>(name: string): T | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(key(name));
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope<T>;
    if (!env || typeof env !== 'object' || env.v !== SAVE_VERSION) return null;
    return env.data ?? null;
  } catch {
    return null;
  }
}

export function slotTimestamp(name: string): number | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(key(name));
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope<unknown>;
    return typeof env?.t === 'number' ? env.t : null;
  } catch {
    return null;
  }
}

export function clearSlot(name: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(key(name));
  } catch {
    /* storage unavailable: nothing to clear */
  }
}

export function hasSlot(name: string): boolean {
  return loadSlot(name) !== null;
}

export function storageAvailable(): boolean {
  return storage() !== null;
}

export const SLOT = {
  settings: 'settings',
  season: 'season',
  championship: 'championship',
  customPlayers: 'customPlayers',
  records: 'records',
  resume: 'resume',
  coach: 'coach',
} as const;
