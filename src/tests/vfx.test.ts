import { describe, expect, it } from 'vitest';
import { ParticleField } from '../render/fx';
import { VFX_PRESETS, validateVfxPreset } from '../render/vfx';

describe('native baseball VFX', () => {
  it('validates every semantic preset', () => {
    for (const preset of Object.values(VFX_PRESETS)) expect(validateVfxPreset(preset)).toBe(true);
  });

  it('keeps the instanced pool strictly bounded', () => {
    const field = new ParticleField();
    for (let i = 0; i < 12; i++) field.emitPreset('championship-confetti', 0, 1, 0);
    expect(field.activeCount).toBe(field.capacity);
    field.update(1 / 60);
    expect(field.mesh.count).toBe(field.capacity);
    field.clear();
    expect(field.activeCount).toBe(0);
  });

  it('uses one draw-call mesh for every effect family', () => {
    const field = new ParticleField();
    field.emitPreset('dirt-spray', 0, 0, 0);
    field.emitPreset('grass-fragments', 0, 0, 0);
    field.emitPreset('wall-flecks', 0, 0, 0);
    field.update(1 / 60);
    expect(field.mesh.isInstancedMesh).toBe(true);
    expect(field.mesh.count).toBeGreaterThan(0);
    expect(field.mesh.children).toHaveLength(0);
  });

  it('expires and reuses all particles without allocating a second mesh', () => {
    const field = new ParticleField();
    const mesh = field.mesh;
    field.emitPreset('chalk-puff', 0, 0, 0);
    for (let i = 0; i < 180; i++) field.update(1 / 60);
    expect(field.activeCount).toBe(0);
    field.emitPreset('dirt-spray', 0, 0, 0);
    expect(field.mesh).toBe(mesh);
  });
});
