export const MBD_VFX_SCHEMA = 'mbd.vfx-preset' as const;

export type MbdVfxPresetId =
  | 'dirt-spray'
  | 'grass-fragments'
  | 'chalk-puff'
  | 'wall-flecks'
  | 'home-run-firework'
  | 'championship-confetti';

/** Semantic, renderer-independent particle authoring contract. */
export interface MbdVfxPresetV1 {
  schema: typeof MBD_VFX_SCHEMA;
  version: 1;
  id: MbdVfxPresetId;
  count: number;
  colors: readonly number[];
  speed: number;
  spread: number;
  up: number;
  size: number;
  life: number;
  gravity: number;
  drag: number;
  /** Box proportions make one instanced draw read as dust, turf, or paper. */
  aspect: readonly [number, number, number];
}

export const VFX_PRESETS: Readonly<Record<MbdVfxPresetId, MbdVfxPresetV1>> = {
  'dirt-spray': {
    schema: MBD_VFX_SCHEMA, version: 1, id: 'dirt-spray', count: 22,
    colors: [0xc7955b, 0xa86f3d, 0xe0b777], speed: 4.1, spread: 0.95, up: 0.7,
    size: 0.12, life: 0.72, gravity: 10.5, drag: 1.5, aspect: [1.45, 0.55, 1.1],
  },
  'grass-fragments': {
    schema: MBD_VFX_SCHEMA, version: 1, id: 'grass-fragments', count: 18,
    colors: [0x246d34, 0x4d8b3b, 0x8aa64b], speed: 4.8, spread: 0.9, up: 1.05,
    size: 0.105, life: 0.82, gravity: 8.8, drag: 1.05, aspect: [0.35, 2.15, 0.42],
  },
  'chalk-puff': {
    schema: MBD_VFX_SCHEMA, version: 1, id: 'chalk-puff', count: 14,
    colors: [0xffffff, 0xe8e3d7, 0xcfc8b9], speed: 2.7, spread: 1.15, up: 0.5,
    size: 0.085, life: 0.5, gravity: 5.5, drag: 2.4, aspect: [1.1, 0.8, 1.1],
  },
  'wall-flecks': {
    schema: MBD_VFX_SCHEMA, version: 1, id: 'wall-flecks', count: 18,
    colors: [0xe7e7e7, 0x9fa7a8, 0x586266], speed: 5.5, spread: 0.72, up: 0.85,
    size: 0.095, life: 0.62, gravity: 9.5, drag: 1.15, aspect: [1.6, 0.42, 0.8],
  },
  'home-run-firework': {
    schema: MBD_VFX_SCHEMA, version: 1, id: 'home-run-firework', count: 70,
    colors: [0xffe14d, 0x5ce1ff, 0xff6b3d], speed: 15, spread: 1, up: 1.45,
    size: 0.13, life: 1.25, gravity: 14.5, drag: 0.52, aspect: [0.62, 1.9, 0.62],
  },
  'championship-confetti': {
    schema: MBD_VFX_SCHEMA, version: 1, id: 'championship-confetti', count: 140,
    colors: [0xffe14d, 0x5ce1ff, 0xff6b3d, 0x7ee081, 0xc08bff], speed: 8.5,
    spread: 1.25, up: 1.5, size: 0.14, life: 2.6, gravity: 4.2, drag: 0.42,
    aspect: [0.38, 1.8, 0.18],
  },
};

export function validateVfxPreset(value: unknown): value is MbdVfxPresetV1 {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<MbdVfxPresetV1>;
  return v.schema === MBD_VFX_SCHEMA && v.version === 1 && typeof v.id === 'string' &&
    Number.isInteger(v.count) && (v.count ?? 0) > 0 && (v.count ?? 0) <= 420 &&
    Array.isArray(v.colors) && v.colors.length > 0 && v.colors.every((c) => Number.isInteger(c) && c >= 0 && c <= 0xffffff) &&
    [v.speed, v.spread, v.up, v.size, v.life, v.gravity, v.drag].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0) &&
    Array.isArray(v.aspect) && v.aspect.length === 3 && v.aspect.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0);
}
