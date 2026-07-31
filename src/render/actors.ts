import * as THREE from 'three';
import type { BodyType, Player } from '../core/types';
import { flatMat, shade, skinColor } from './palette';

/**
 * Chunky low-poly athletes. Every model is boxes and one cone, animated purely
 * procedurally — no skinning, no clips — which keeps the whole roster cheap and
 * lets pose blending react instantly to the simulation.
 */

export type Pose =
  | 'idle'
  | 'run'
  | 'batStance'
  | 'batSwing'
  | 'bunt'
  | 'pitchSet'
  | 'pitchThrow'
  | 'fieldReady'
  | 'dive'
  | 'jump'
  | 'slide'
  | 'throw'
  | 'celebrate';

interface BodyScale {
  width: number;
  height: number;
  depth: number;
  headScale: number;
}

const BODY: Record<BodyType, BodyScale> = {
  slim: { width: 0.84, height: 1.02, depth: 0.86, headScale: 1.0 },
  average: { width: 1, height: 1, depth: 1, headScale: 1 },
  stocky: { width: 1.24, height: 0.95, depth: 1.16, headScale: 1.04 },
  tall: { width: 0.94, height: 1.13, depth: 0.94, headScale: 0.94 },
  huge: { width: 1.46, height: 1.05, depth: 1.32, headScale: 1.1 },
};

export interface ActorColors {
  jersey: number;
  trim: number;
  accent: number;
  skin: number;
}

/**
 * Actors are created and destroyed constantly — a new batter every plate
 * appearance, nine new fielders every half-inning — so nothing they are built
 * from may be allocated per instance. Geometry is cached by body type and part,
 * and materials by colour; both live for the lifetime of the page. The result
 * is that `renderer.info.memory.geometries` plateaus instead of climbing, which
 * is the only way a long session stays healthy.
 */
const GEO_CACHE = new Map<string, THREE.BufferGeometry>();
const MAT_CACHE = new Map<number, THREE.MeshLambertMaterial>();
const BASIC_CACHE = new Map<string, THREE.MeshBasicMaterial>();

function box(key: string, w: number, h: number, d: number): THREE.BoxGeometry {
  let g = GEO_CACHE.get(key) as THREE.BoxGeometry | undefined;
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    GEO_CACHE.set(key, g);
  }
  return g;
}

function cyl(key: string, rt: number, rb: number, h: number, seg: number): THREE.CylinderGeometry {
  let g = GEO_CACHE.get(key) as THREE.CylinderGeometry | undefined;
  if (!g) {
    g = new THREE.CylinderGeometry(rt, rb, h, seg);
    GEO_CACHE.set(key, g);
  }
  return g;
}

function circle(key: string, r: number, seg: number): THREE.CircleGeometry {
  let g = GEO_CACHE.get(key) as THREE.CircleGeometry | undefined;
  if (!g) {
    g = new THREE.CircleGeometry(r, seg);
    GEO_CACHE.set(key, g);
  }
  return g;
}

function mat(color: number): THREE.MeshLambertMaterial {
  let m = MAT_CACHE.get(color);
  if (!m) {
    m = flatMat(color);
    MAT_CACHE.set(color, m);
  }
  return m;
}

function shadowMat(): THREE.MeshBasicMaterial {
  let m = BASIC_CACHE.get('shadow');
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    BASIC_CACHE.set('shadow', m);
  }
  return m;
}

/** Diagnostics: how many distinct cached resources exist. */
export function actorResourceCounts(): { geometries: number; materials: number } {
  return { geometries: GEO_CACHE.size, materials: MAT_CACHE.size + BASIC_CACHE.size };
}

export class PlayerActor {
  readonly group = new THREE.Group();
  private readonly root = new THREE.Group();
  private torso!: THREE.Mesh;
  private head!: THREE.Group;
  private armL!: THREE.Group;
  private armR!: THREE.Group;
  private legL!: THREE.Group;
  private legR!: THREE.Group;
  private bat!: THREE.Group;
  private glove!: THREE.Mesh;
  private shadow!: THREE.Mesh;

  private phase = 0;
  private bob = 0;
  /** Smoothed facing so models never snap around. */
  private facing = 0;
  private lean = 0;

  constructor(colors: ActorColors, body: BodyType) {
    this.build(colors, body);
    this.group.add(this.root);
  }

  private build(colors: ActorColors, body: BodyType): void {
    const b = BODY[body] ?? BODY.average;
    const k = body;

    const jersey = mat(colors.jersey);
    const pants = mat(shade(colors.trim, 0.32));
    const trim = mat(colors.trim);
    const skin = mat(colors.skin);
    const shoe = mat(shade(colors.accent, -0.45));

    const legH = 0.74 * b.height;
    const torsoH = 0.6 * b.height;
    const torsoW = 0.52 * b.width;
    const torsoD = 0.3 * b.depth;

    // Legs pivot from the hip so a run cycle is a single rotation each.
    const mkLeg = (side: number) => {
      const g = new THREE.Group();
      const thigh = new THREE.Mesh(box(`${k}:thigh`, 0.2 * b.width, legH, 0.22 * b.depth), pants);
      thigh.position.y = -legH / 2;
      g.add(thigh);
      const foot = new THREE.Mesh(box(`${k}:foot`, 0.22 * b.width, 0.11, 0.34 * b.depth), shoe);
      foot.position.set(0, -legH - 0.05, 0.05);
      g.add(foot);
      g.position.set(side * 0.15 * b.width, legH, 0);
      return g;
    };
    this.legL = mkLeg(-1);
    this.legR = mkLeg(1);
    this.root.add(this.legL, this.legR);

    this.torso = new THREE.Mesh(box(`${k}:torso`, torsoW, torsoH, torsoD), jersey);
    this.torso.position.y = legH + torsoH / 2;
    this.root.add(this.torso);

    const belt = new THREE.Mesh(box(`${k}:belt`, torsoW * 1.04, 0.09, torsoD * 1.06), trim);
    belt.position.y = legH + 0.03;
    this.root.add(belt);

    // Head group: skull, cap crown and brim, so the silhouette reads as a ballplayer.
    this.head = new THREE.Group();
    const skull = new THREE.Mesh(
      box(`${k}:skull`, 0.34 * b.headScale, 0.34 * b.headScale, 0.32 * b.headScale),
      skin,
    );
    this.head.add(skull);
    const crown = new THREE.Mesh(
      box(`${k}:crown`, 0.36 * b.headScale, 0.14 * b.headScale, 0.34 * b.headScale),
      jersey,
    );
    crown.position.y = 0.2 * b.headScale;
    this.head.add(crown);
    const brim = new THREE.Mesh(box(`${k}:brim`, 0.34 * b.headScale, 0.045, 0.2 * b.headScale), trim);
    brim.position.set(0, 0.15 * b.headScale, -0.24 * b.headScale);
    this.head.add(brim);
    this.head.position.y = legH + torsoH + 0.19 * b.headScale;
    this.root.add(this.head);

    const armLen = 0.6 * b.height;
    const mkArm = (side: number) => {
      const g = new THREE.Group();
      const upper = new THREE.Mesh(box(`${k}:arm`, 0.16 * b.width, armLen, 0.17 * b.depth), jersey);
      upper.position.y = -armLen / 2;
      g.add(upper);
      const hand = new THREE.Mesh(box(`${k}:hand`, 0.15 * b.width, 0.15, 0.15 * b.depth), skin);
      hand.position.y = -armLen - 0.03;
      g.add(hand);
      g.position.set(side * (torsoW / 2 + 0.08 * b.width), legH + torsoH - 0.06, 0);
      return g;
    };
    this.armL = mkArm(-1);
    this.armR = mkArm(1);
    this.root.add(this.armL, this.armR);

    // Bat hangs off the right hand; hidden unless the batting poses are active.
    this.bat = new THREE.Group();
    const barrel = new THREE.Mesh(cyl('bat:barrel', 0.045, 0.028, 0.86, 6), mat(0xc98f4e));
    barrel.position.y = 0.43;
    this.bat.add(barrel);
    const knob = new THREE.Mesh(cyl('bat:knob', 0.038, 0.038, 0.06, 6), mat(0x2c2c2c));
    this.bat.add(knob);
    this.bat.visible = false;
    this.armR.add(this.bat);
    this.bat.position.y = -armLen - 0.05;

    this.glove = new THREE.Mesh(box('glove', 0.24, 0.26, 0.12), mat(shade(0x8b5a2b, -0.1)));
    this.glove.position.y = -armLen - 0.1;
    this.glove.visible = false;
    this.armL.add(this.glove);

    this.shadow = new THREE.Mesh(circle(`${k}:shadow`, 0.45 * b.width, 12), shadowMat());
    this.shadow.rotateX(-Math.PI / 2);
    this.shadow.position.y = 0.035;
    this.group.add(this.shadow);
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  /**
   * Actors own no GPU resources of their own — geometry and materials are
   * shared from the caches above — so removal is just detaching from the scene.
   * This method exists so every call site says what it means.
   */
  dispose(): void {
    this.group.removeFromParent();
  }

  /**
   * Drives the whole model for one frame.
   * `poseT` is 0..1 through the current one-shot animation where relevant.
   */
  update(
    dt: number,
    opts: {
      x: number;
      z: number;
      y?: number;
      speed: number;
      facing: number;
      pose: Pose;
      poseT: number;
      /** Batting side: -1 right-handed (third-base box), +1 left-handed. */
      handed?: number;
    },
  ): void {
    const y = opts.y ?? 0;
    this.group.position.set(opts.x, y, opts.z);

    // Smooth turning so a fielder changing direction does not pop.
    let diff = opts.facing - this.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.facing += diff * Math.min(1, dt * 14);
    this.root.rotation.y = this.facing;

    this.shadow.position.y = 0.035 - y;
    // The shadow material is shared, so height is expressed as scale only.
    const shadowScale = 1 / (1 + Math.max(0, y) * 0.7);
    this.shadow.scale.setScalar(shadowScale);

    const running = opts.speed > 0.6;
    this.phase += dt * (running ? 3.2 + opts.speed * 1.5 : 2.2);
    this.bob = running ? Math.sin(this.phase * 2) * 0.045 : Math.sin(this.phase) * 0.012;

    this.bat.visible = false;
    this.glove.visible = false;
    this.root.rotation.x = 0;
    this.root.rotation.z = 0;
    this.root.position.set(0, 0, 0);

    switch (opts.pose) {
      case 'run':
        this.poseRun(opts.speed);
        break;
      case 'batStance':
        this.poseBatStance(opts.handed ?? -1);
        break;
      case 'batSwing':
        this.poseBatSwing(opts.poseT, opts.handed ?? -1);
        break;
      case 'bunt':
        this.poseBunt(opts.handed ?? -1);
        break;
      case 'pitchSet':
        this.posePitchSet(opts.poseT);
        break;
      case 'pitchThrow':
        this.posePitchThrow(opts.poseT);
        break;
      case 'fieldReady':
        this.poseFieldReady();
        break;
      case 'throw':
        this.poseThrow(opts.poseT);
        break;
      case 'dive':
        this.poseDive(opts.poseT);
        break;
      case 'jump':
        this.poseJump(opts.poseT);
        break;
      case 'slide':
        this.poseSlide(opts.poseT);
        break;
      case 'celebrate':
        this.poseCelebrate();
        break;
      default:
        this.poseIdle();
        break;
    }
  }

  private reset(): void {
    this.legL.rotation.set(0, 0, 0);
    this.legR.rotation.set(0, 0, 0);
    this.armL.rotation.set(0, 0, 0);
    this.armR.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    this.torso.rotation.set(0, 0, 0);
    this.root.position.y = this.bob;
  }

  private poseIdle(): void {
    this.reset();
    this.armL.rotation.x = Math.sin(this.phase) * 0.06;
    this.armR.rotation.x = -Math.sin(this.phase) * 0.06;
    this.glove.visible = true;
  }

  private poseRun(speed: number): void {
    this.reset();
    const amp = Math.min(1.05, 0.4 + speed * 0.09);
    const s = Math.sin(this.phase * 2);
    this.legL.rotation.x = s * amp;
    this.legR.rotation.x = -s * amp;
    this.armL.rotation.x = -s * amp * 0.85;
    this.armR.rotation.x = s * amp * 0.85;
    this.lean = Math.min(0.32, speed * 0.035);
    this.root.rotation.x = this.lean;
    this.glove.visible = true;
  }

  private poseFieldReady(): void {
    this.reset();
    this.legL.rotation.x = 0.34;
    this.legR.rotation.x = -0.34;
    this.root.rotation.x = 0.22;
    this.root.position.y = this.bob - 0.1;
    this.armL.rotation.x = -0.9;
    this.armL.rotation.z = 0.35;
    this.armR.rotation.x = -0.55;
    this.armR.rotation.z = -0.3;
    this.glove.visible = true;
  }

  private poseBatStance(handed: number): void {
    this.reset();
    this.bat.visible = true;
    this.root.rotation.y = this.facing;
    this.legL.rotation.x = 0.18;
    this.legR.rotation.x = -0.18;
    this.root.position.y = this.bob - 0.05;
    this.armR.rotation.x = -2.15;
    this.armR.rotation.z = handed * -0.5;
    this.armL.rotation.x = -1.95;
    this.armL.rotation.z = handed * -0.35;
    this.bat.rotation.set(0.5, 0, handed * 0.4);
    this.torso.rotation.y = handed * 0.25;
  }

  private poseBatSwing(t: number, handed: number): void {
    this.reset();
    this.bat.visible = true;
    const k = Math.min(1, Math.max(0, t));
    // Load, then whip through, then follow through.
    const load = Math.min(1, k / 0.25);
    const swing = k < 0.25 ? 0 : Math.min(1, (k - 0.25) / 0.35);
    const follow = k < 0.6 ? 0 : Math.min(1, (k - 0.6) / 0.4);
    const ease = swing * swing * (3 - 2 * swing);

    const rot = -0.7 * load + ease * 3.5 + follow * 0.8;
    this.torso.rotation.y = handed * (0.45 - rot * 0.55);
    this.root.rotation.y = this.facing + handed * (0.2 - rot * 0.35);
    this.armR.rotation.x = -2.15 + ease * 1.4;
    this.armR.rotation.z = handed * (-0.5 + ease * 1.5);
    this.armL.rotation.x = -1.95 + ease * 1.2;
    this.armL.rotation.z = handed * (-0.35 + ease * 1.3);
    this.bat.rotation.set(0.5 - ease * 1.1, 0, handed * (0.4 - ease * 2.6));
    this.legR.rotation.x = -0.18 - ease * 0.3;
    this.legL.rotation.x = 0.18 + ease * 0.35;
    this.root.position.y = this.bob - 0.05 - ease * 0.04;
  }

  private poseBunt(handed: number): void {
    this.reset();
    this.bat.visible = true;
    this.root.position.y = this.bob - 0.12;
    this.root.rotation.y = this.facing + handed * 0.9;
    this.armR.rotation.x = -1.5;
    this.armL.rotation.x = -1.5;
    this.armL.rotation.z = handed * 0.8;
    this.bat.rotation.set(0, 0, handed * 1.5);
    this.legL.rotation.x = 0.3;
    this.legR.rotation.x = -0.3;
  }

  private posePitchSet(t: number): void {
    this.reset();
    this.glove.visible = true;
    const k = Math.min(1, Math.max(0, t));
    this.legL.rotation.x = -k * 1.5;
    this.armR.rotation.x = -k * 2.4;
    this.armL.rotation.x = -0.6 - k * 0.5;
    this.root.rotation.x = -k * 0.16;
    this.torso.rotation.y = k * 0.5;
  }

  private posePitchThrow(t: number): void {
    this.reset();
    this.glove.visible = true;
    const k = Math.min(1, Math.max(0, t));
    const ease = k * k * (3 - 2 * k);
    this.armR.rotation.x = -2.4 + ease * 4.4;
    this.armL.rotation.x = -1.1 + ease * 1.5;
    this.legL.rotation.x = -1.5 + ease * 2.0;
    this.legR.rotation.x = ease * -0.7;
    this.root.rotation.x = 0.28 * ease;
    this.torso.rotation.y = 0.5 - ease * 0.9;
  }

  private poseThrow(t: number): void {
    this.reset();
    this.glove.visible = true;
    const k = Math.min(1, Math.max(0, t));
    const ease = k * k * (3 - 2 * k);
    this.armR.rotation.x = -2.2 + ease * 3.9;
    this.armL.rotation.x = -0.9 + ease * 1.0;
    this.root.rotation.x = 0.16 * ease;
    this.legL.rotation.x = 0.4 - ease * 0.6;
    this.legR.rotation.x = -0.3 + ease * 0.5;
  }

  private poseDive(t: number): void {
    this.reset();
    this.glove.visible = true;
    const k = Math.min(1, Math.max(0, t));
    this.root.rotation.x = Math.min(1.42, k * 3.2);
    this.root.position.y = this.bob + Math.sin(Math.min(1, k * 1.6) * Math.PI) * 0.35 - 0.35 * k;
    this.armL.rotation.x = -2.6;
    this.armR.rotation.x = -2.2;
    this.legL.rotation.x = -0.25;
    this.legR.rotation.x = -0.25;
  }

  private poseJump(t: number): void {
    this.reset();
    this.glove.visible = true;
    const k = Math.min(1, Math.max(0, t));
    const h = Math.sin(k * Math.PI) * 0.72;
    this.root.position.y = this.bob + h;
    this.armL.rotation.x = -2.9;
    this.armR.rotation.x = -2.2;
    this.legL.rotation.x = -0.4;
    this.legR.rotation.x = -0.5;
  }

  private poseSlide(t: number): void {
    this.reset();
    const k = Math.min(1, Math.max(0, t));
    this.root.rotation.x = -1.0 - k * 0.15;
    this.root.position.y = this.bob - 0.42;
    this.legL.rotation.x = 0.5;
    this.legR.rotation.x = 0.15;
    this.armL.rotation.x = -1.4;
    this.armR.rotation.x = -1.9;
  }

  private poseCelebrate(): void {
    this.reset();
    const s = Math.abs(Math.sin(this.phase * 1.8));
    this.armL.rotation.x = -2.6 - s * 0.4;
    this.armR.rotation.x = -2.6 - s * 0.4;
    this.armL.rotation.z = 0.5;
    this.armR.rotation.z = -0.5;
    this.root.position.y = this.bob + s * 0.18;
  }
}

export function actorColorsFor(
  player: Player,
  team: { primary: number; secondary: number; accent: number },
): ActorColors {
  return {
    jersey: team.primary,
    trim: team.secondary,
    accent: team.accent,
    skin: skinColor(player.skinTone),
  };
}

// ---------------------------------------------------------------------------
// Ball
// ---------------------------------------------------------------------------

export class BallActor {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  private shadow: THREE.Mesh;
  private trail: THREE.Line;
  private trailPositions: Float32Array;
  private trailCount = 0;
  private readonly maxTrail = 44;
  private spin = 0;

  constructor() {
    this.mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.075, 1),
      new THREE.MeshLambertMaterial({ color: 0xfdfdf6, flatShading: true, emissive: 0x2a2a24 }),
    );
    this.group.add(this.mesh);

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.16, 10),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.shadow.rotateX(-Math.PI / 2);

    this.trailPositions = new Float32Array(this.maxTrail * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    geo.setDrawRange(0, 0);
    this.trail = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }),
    );
    this.trail.frustumCulled = false;
  }

  addTo(scene: THREE.Scene): void {
    scene.add(this.group);
    scene.add(this.shadow);
    scene.add(this.trail);
  }

  setTrailColor(color: number, opacity: number): void {
    const m = this.trail.material as THREE.LineBasicMaterial;
    m.color.setHex(color);
    m.opacity = opacity;
  }

  clearTrail(): void {
    this.trailCount = 0;
    this.trail.geometry.setDrawRange(0, 0);
  }

  update(dt: number, x: number, y: number, z: number, speed: number, visible: boolean): void {
    this.group.visible = visible;
    this.shadow.visible = visible && y < 40;
    this.trail.visible = visible;
    if (!visible) return;

    this.group.position.set(x, y, z);
    this.spin += dt * Math.min(40, speed * 1.4);
    this.mesh.rotation.set(this.spin, this.spin * 0.7, 0);

    this.shadow.position.set(x, 0.02, z);
    const s = 1 / (1 + Math.max(0, y) * 0.28);
    this.shadow.scale.setScalar(Math.max(0.35, s));
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.34 * Math.max(0.25, s);

    // Ring buffer flattened into a polyline each frame; 44 points is plenty.
    if (this.trailCount < this.maxTrail) this.trailCount++;
    for (let i = this.trailCount - 1; i > 0; i--) {
      this.trailPositions[i * 3] = this.trailPositions[(i - 1) * 3];
      this.trailPositions[i * 3 + 1] = this.trailPositions[(i - 1) * 3 + 1];
      this.trailPositions[i * 3 + 2] = this.trailPositions[(i - 1) * 3 + 2];
    }
    this.trailPositions[0] = x;
    this.trailPositions[1] = y;
    this.trailPositions[2] = z;
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.setDrawRange(0, this.trailCount);
  }
}
