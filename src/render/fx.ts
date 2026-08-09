import * as THREE from 'three';
import { VFX_PRESETS, type MbdVfxPresetId, type MbdVfxPresetV1 } from './vfx';

/**
 * One pooled particle system for the whole game: dust, sparks, grass, confetti
 * and firework trails all come out of the same InstancedMesh, so effects cost
 * one draw call no matter how busy the moment gets.
 */

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  drag: number;
  gravity: number;
  spin: number;
  r: number;
  g: number;
  b: number;
  sx: number;
  sy: number;
  sz: number;
}

const MAX = 420;

export class ParticleField {
  readonly mesh: THREE.InstancedMesh;
  private pool: Particle[] = [];
  private active = 0;
  private matrix = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private euler = new THREE.Euler();
  private scaleV = new THREE.Vector3();
  private posV = new THREE.Vector3();
  private colorAttr: THREE.InstancedBufferAttribute;
  private seed = 1;

  constructor() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    geo.setAttribute('color', this.colorAttr);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    for (let i = 0; i < MAX; i++) {
      this.pool.push({
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1, size: 0.1, drag: 0.2, gravity: 9.8, spin: 0,
        r: 1, g: 1, b: 1, sx: 1, sy: 1, sz: 1,
      });
    }
  }

  private rand(): number {
    // Tiny deterministic LCG; particles must never touch the simulation RNG.
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private spawn(): Particle | null {
    if (this.active >= MAX) return null;
    return this.pool[this.active++];
  }

  burst(
    x: number,
    y: number,
    z: number,
    count: number,
    opts: {
      color: number;
      speed?: number;
      spread?: number;
      up?: number;
      size?: number;
      life?: number;
      gravity?: number;
      drag?: number;
      colors?: readonly number[];
      aspect?: readonly [number, number, number];
    },
  ): void {
    const palette = opts.colors?.length ? opts.colors : [opts.color];
    const c = new THREE.Color();
    const speed = opts.speed ?? 4;
    const spread = opts.spread ?? 1;
    const up = opts.up ?? 1;
    for (let i = 0; i < count; i++) {
      const p = this.spawn();
      if (!p) return;
      c.setHex(palette[Math.floor(this.rand() * palette.length)] ?? opts.color);
      const a = this.rand() * Math.PI * 2;
      const s = speed * (0.4 + this.rand() * 0.6);
      p.x = x + (this.rand() - 0.5) * 0.2;
      p.y = y + this.rand() * 0.12;
      p.z = z + (this.rand() - 0.5) * 0.2;
      p.vx = Math.cos(a) * s * spread;
      p.vz = Math.sin(a) * s * spread;
      p.vy = s * up * (0.35 + this.rand() * 0.9);
      p.maxLife = (opts.life ?? 0.7) * (0.6 + this.rand() * 0.7);
      p.life = p.maxLife;
      p.size = (opts.size ?? 0.11) * (0.6 + this.rand() * 0.8);
      p.gravity = opts.gravity ?? 11;
      p.drag = opts.drag ?? 1.2;
      p.spin = (this.rand() - 0.5) * 12;
      p.sx = opts.aspect?.[0] ?? 1;
      p.sy = opts.aspect?.[1] ?? 1;
      p.sz = opts.aspect?.[2] ?? 1;
      const tint = 0.82 + this.rand() * 0.35;
      p.r = Math.min(1, c.r * tint);
      p.g = Math.min(1, c.g * tint);
      p.b = Math.min(1, c.b * tint);
    }
  }

  emitPreset(
    id: MbdVfxPresetId,
    x: number,
    y: number,
    z: number,
    scale = 1,
    primaryColor?: number,
  ): void {
    const preset: MbdVfxPresetV1 = VFX_PRESETS[id];
    const colors = primaryColor === undefined ? preset.colors : [primaryColor, ...preset.colors];
    this.burst(x, y, z, Math.max(1, Math.round(preset.count * Math.max(0.25, scale))), {
      color: colors[0],
      colors,
      speed: preset.speed * Math.sqrt(Math.max(0.25, scale)),
      spread: preset.spread,
      up: preset.up,
      size: preset.size,
      life: preset.life,
      gravity: preset.gravity,
      drag: preset.drag,
      aspect: preset.aspect,
    });
  }

  /** Ring of confetti used for home runs and big defensive plays. */
  fireworks(x: number, y: number, z: number, color: number): void {
    this.emitPreset('home-run-firework', x, y, z, 1, color);
  }

  championship(x: number, y: number, z: number): void {
    this.emitPreset('championship-confetti', x, y, z);
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.active) {
      const p = this.pool[i];
      p.life -= dt;
      if (p.life <= 0) {
        // Swap-remove keeps the live range contiguous for the instanced draw.
        this.pool[i] = this.pool[this.active - 1];
        this.pool[this.active - 1] = p;
        this.active--;
        continue;
      }
      const damp = Math.max(0, 1 - p.drag * dt);
      p.vx *= damp;
      p.vz *= damp;
      p.vy = (p.vy - p.gravity * dt) * damp;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.03) {
        p.y = 0.03;
        p.vy *= -0.24;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      i++;
    }

    this.mesh.count = this.active;
    for (let j = 0; j < this.active; j++) {
      const p = this.pool[j];
      const t = p.life / p.maxLife;
      const s = p.size * (0.35 + t * 0.8);
      this.posV.set(p.x, p.y, p.z);
      this.euler.set(p.spin * (1 - t) * 2, p.spin * (1 - t), 0);
      this.quat.setFromEuler(this.euler);
      this.scaleV.set(s * p.sx, s * p.sy, s * p.sz);
      this.matrix.compose(this.posV, this.quat, this.scaleV);
      this.mesh.setMatrixAt(j, this.matrix);
      this.colorAttr.setXYZ(j, p.r * t, p.g * t, p.b * t);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }

  clear(): void {
    this.active = 0;
    this.mesh.count = 0;
  }

  get activeCount(): number {
    return this.active;
  }

  get capacity(): number {
    return MAX;
  }
}

/** Expanding ring used for contact impact and the catch marker. */
export class ImpactRings {
  readonly group = new THREE.Group();
  private rings: { mesh: THREE.Mesh; life: number; maxLife: number; grow: number }[] = [];

  spawn(x: number, y: number, z: number, color: number, size = 1.2, life = 0.45): void {
    const geo = new THREE.RingGeometry(0.3, 0.42, 20);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotateX(-Math.PI / 2);
    this.group.add(mesh);
    this.rings.push({ mesh, life, maxLife: life, grow: size });
  }

  update(dt: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const t = 1 - r.life / r.maxLife;
      if (r.life <= 0) {
        this.group.remove(r.mesh);
        r.mesh.geometry.dispose();
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const s = 1 + t * r.grow * 6;
      r.mesh.scale.set(s, s, s);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
    }
  }

  clear(): void {
    for (const r of this.rings) {
      this.group.remove(r.mesh);
      r.mesh.geometry.dispose();
      (r.mesh.material as THREE.Material).dispose();
    }
    this.rings.length = 0;
  }
}
