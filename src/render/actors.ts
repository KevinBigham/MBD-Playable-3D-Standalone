import * as THREE from 'three';
import type { BodyType, Player } from '../core/types';
import { flatMat, shade, skinColor } from './palette';

/**
 * Low-poly athletes: turned, tapered forms on a jointed skeleton, animated
 * purely procedurally — no skinning, no clips, no imported assets — which keeps
 * the whole roster cheap and lets poses react instantly to the simulation.
 *
 * They used to be boxes, and a box has one fatal problem as anatomy: it is the
 * same width all the way along. The joints were always right and the shapes
 * never were, so the models moved like athletes and were built like furniture.
 * Everything is lathe-turned now — see "BODIES ARE TURNED, NOT STACKED" below —
 * which buys taper, rounded joints and smooth normals per mesh rather than per
 * draw call.
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
  | 'crouch'
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

/**
 * BODIES ARE TURNED, NOT STACKED.
 * ===============================
 *
 * Everything below this line exists because the models were made of boxes, and
 * a box has one enormous problem as a piece of anatomy: it has the same width
 * all the way along. A real arm is thick at the shoulder, thin at the wrist and
 * round at the elbow, and no amount of joint work makes a rectangular prism read
 * as one — the old models moved like athletes and were shaped like furniture.
 *
 * A lathe fixes it for almost nothing. `LatheGeometry` spins a 2-D profile
 * around the Y axis, so one profile buys a taper *and* rounded ends *and* smooth
 * normals in a single mesh — no joint spheres to fill the gaps, no extra draw
 * calls. A limb goes from 12 triangles to about 160, which sounds like a lot
 * until you notice that eighteen players on the field is still under 25 000
 * triangles: less than the outfield wall. **Draw calls are the budget on a
 * phone, and the draw calls did not move.**
 *
 * Human cross-sections are not circles, and that is handled by scaling the mesh
 * rather than by modelling it: a torso is a turned form squashed front-to-back,
 * which is both what a chest actually looks like from above and free.
 */

/** One profile point: distance from the axis, and height. */
type Profile = Array<[number, number]>;

function lathe(key: string, points: Profile, seg: number): THREE.LatheGeometry {
  let g = GEO_CACHE.get(key) as THREE.LatheGeometry | undefined;
  if (!g) {
    g = new THREE.LatheGeometry(
      points.map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r), y)),
      seg,
    );
    GEO_CACHE.set(key, g);
  }
  return g;
}

/**
 * A tapered capsule, centred on the origin: thick at the top, thinner at the
 * bottom, domed at both ends. This is an upper arm, a forearm, a thigh, a shin
 * and a neck — every one of them is the same shape at different numbers, which
 * is a fact about limbs rather than a shortcut.
 */
function limbGeo(key: string, len: number, rTop: number, rBot: number, seg = 10): THREE.LatheGeometry {
  const half = len / 2;
  // Domes eat into the length rather than extending past it, so a limb still
  // measures exactly `len` from joint to joint and every pose anchor holds.
  const capT = Math.min(rTop * 0.85, len * 0.22);
  const capB = Math.min(rBot * 0.85, len * 0.22);
  return lathe(
    key,
    [
      [0, half],
      [rTop * 0.55, half - capT * 0.25],
      [rTop * 0.92, half - capT * 0.72],
      [rTop, half - capT],
      [rTop * 0.98, half - capT - (len - capT - capB) * 0.35],
      [rBot * 1.04, -half + capB + (len - capT - capB) * 0.18],
      [rBot, -half + capB],
      [rBot * 0.9, -half + capB * 0.7],
      [rBot * 0.52, -half + capB * 0.24],
      [0, -half],
    ],
    seg,
  );
}

/**
 * A torso, from the belt to the top of the shoulders.
 *
 * One mesh where there used to be four — waist, chest, yoke and belly. They were
 * separate because a box cannot narrow, so the shape had to be built out of
 * differently-sized boxes and the seams showed as steps. A profile just narrows.
 */
function torsoGeo(key: string, h: number, waistR: number, chestR: number, shoulderR: number): THREE.LatheGeometry {
  return lathe(
    key,
    [
      [0, 0],
      [waistR * 0.96, 0],
      [waistR, h * 0.1],
      [waistR * 1.06, h * 0.28],
      [chestR * 0.93, h * 0.46],
      [chestR, h * 0.62],
      [shoulderR * 0.98, h * 0.8],
      [shoulderR, h * 0.9],
      [shoulderR * 0.86, h * 0.98],
      [shoulderR * 0.42, h],
      [0, h],
    ],
    14,
  );
}

/**
 * A head: cranium, brow, and a jaw that tapers to a chin.
 *
 * The old one was a cube with a dark stripe painted across the front to say
 * which way it faced. At the distance these are seen the stripe worked, and
 * every frame closer than that it was a cube with a stripe on it.
 */
function headGeo(key: string, r: number): THREE.LatheGeometry {
  return lathe(
    key,
    [
      [0, -r * 1.05],
      [r * 0.42, -r * 0.98],
      [r * 0.68, -r * 0.78],
      [r * 0.85, -r * 0.42],
      [r * 0.96, -r * 0.05],
      [r, r * 0.3],
      [r * 0.92, r * 0.62],
      [r * 0.66, r * 0.9],
      [r * 0.3, r * 1.04],
      [0, r * 1.08],
    ],
    12,
  );
}

/**
 * SEVERAL BOXES AS ONE MESH.
 *
 * A face needs a brow and two eyes; a jersey needs a number, and a number is
 * up to two digits of seven segments each. Modelled as separate meshes that is
 * seventeen more draw calls per player and three hundred across a fielding
 * side, which on a phone is the entire budget spent on detail nobody asked for.
 *
 * Merged, it is one. The parts are baked into a single buffer at build time,
 * cached globally by key like everything else here, and drawn once. The cost of
 * a face is now the cost of a face *shape* — which is nothing, because it is
 * eight triangles.
 *
 * Written out rather than imported from three's example utils: pulling
 * `BufferGeometryUtils` in for one function adds it to the bundle a phone
 * downloads, and this is twenty lines.
 */
type BoxPart = { w: number; h: number; d: number; x: number; y: number; z: number };

function mergedBoxes(key: string, parts: BoxPart[]): THREE.BufferGeometry {
  let g = GEO_CACHE.get(key);
  if (g) return g;
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (const p of parts) {
    const b = new THREE.BoxGeometry(p.w, p.h, p.d);
    b.translate(p.x, p.y, p.z);
    const bp = b.getAttribute('position');
    const bn = b.getAttribute('normal');
    const bi = b.getIndex()!;
    const base = pos.length / 3;
    for (let i = 0; i < bp.count; i++) {
      pos.push(bp.getX(i), bp.getY(i), bp.getZ(i));
      nor.push(bn.getX(i), bn.getY(i), bn.getZ(i));
    }
    for (let i = 0; i < bi.count; i++) idx.push(base + bi.getX(i));
    b.dispose();
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  GEO_CACHE.set(key, g);
  return g;
}

/**
 * Seven-segment digits, as blocks.
 *
 * A jersey number is the single most human thing that can be put on a back, and
 * at the plate camera the back is most of the frame. Text geometry would mean a
 * font, a loader and a binary asset — none of which exist in this project by
 * design — so the digits are drawn the way a scoreboard draws them.
 */
const SEGMENTS: Record<string, number[]> = {
  //        top, tl, tr, mid, bl, br, bottom
  '0': [1, 1, 1, 0, 1, 1, 1],
  '1': [0, 0, 1, 0, 0, 1, 0],
  '2': [1, 0, 1, 1, 1, 0, 1],
  '3': [1, 0, 1, 1, 0, 1, 1],
  '4': [0, 1, 1, 1, 0, 1, 0],
  '5': [1, 1, 0, 1, 0, 1, 1],
  '6': [1, 1, 0, 1, 1, 1, 1],
  '7': [1, 0, 1, 0, 0, 1, 0],
  '8': [1, 1, 1, 1, 1, 1, 1],
  '9': [1, 1, 1, 1, 0, 1, 1],
};

function digitParts(ch: string, h: number, x0: number, t: number): BoxPart[] {
  const seg = SEGMENTS[ch];
  if (!seg) return [];
  const w = h * 0.58;
  const q = h / 2;
  const out: BoxPart[] = [];
  const bar = (on: number, bw: number, bh: number, bx: number, by: number) => {
    if (on) out.push({ w: bw, h: bh, d: t, x: x0 + bx, y: by, z: 0 });
  };
  bar(seg[0], w, t, 0, q);
  bar(seg[1], t, q, -w / 2, q / 2);
  bar(seg[2], t, q, w / 2, q / 2);
  bar(seg[3], w, t, 0, 0);
  bar(seg[4], t, q, -w / 2, -q / 2);
  bar(seg[5], t, q, w / 2, -q / 2);
  bar(seg[6], w, t, 0, -q);
  return out;
}

function numberGeo(n: number, h: number): THREE.BufferGeometry {
  const text = String(Math.max(0, Math.min(99, Math.round(n))));
  const t = h * 0.15;
  const w = h * 0.58;
  const gap = w * 1.35;
  const parts: BoxPart[] = [];
  const startX = text.length === 2 ? -gap / 2 : 0;
  for (let i = 0; i < text.length; i++) {
    parts.push(...digitParts(text[i], h, startX + i * gap, t));
  }
  return mergedBoxes(`num:${text}:${h.toFixed(3)}`, parts);
}

/** A dome, for a cap crown or a helmet shell. */
function domeGeo(key: string, r: number, squash = 1): THREE.LatheGeometry {
  const pts: Profile = [];
  const steps = 7;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    pts.push([Math.cos(a) * r, Math.sin(a) * r * squash]);
  }
  pts.push([0, r * squash]);
  return lathe(key, pts, 14);
}

function mat(color: number): THREE.MeshLambertMaterial {
  let m = MAT_CACHE.get(color);
  if (!m) {
    m = flatMat(color);
    MAT_CACHE.set(color, m);
  }
  return m;
}

/**
 * Smooth-shaded, for the turned forms.
 *
 * Flat shading is what gives the parks and the trim their faceted, deliberate
 * look and it stays there. On a body it is the enemy: it turns a perfectly good
 * tapered limb back into a stack of visible facets, which is the exact read the
 * lathe was introduced to remove. Cached separately so a colour can be both.
 */
const SMOOTH_CACHE = new Map<number, THREE.MeshLambertMaterial>();
function smoothMat(color: number): THREE.MeshLambertMaterial {
  let m = SMOOTH_CACHE.get(color);
  if (!m) {
    m = flatMat(color, { flat: false });
    SMOOTH_CACHE.set(color, m);
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

/** Batters and runners wear a helmet; everybody else wears a cap. */
export type Headgear = 'cap' | 'helmet';

export class PlayerActor {
  readonly group = new THREE.Group();
  private readonly root = new THREE.Group();
  /** Rotates at the hips and carries the chest, head and both arms with it. */
  private torso!: THREE.Group;
  private head!: THREE.Group;
  private armL!: THREE.Group;
  private armR!: THREE.Group;
  /** Elbow joints, children of the arms. */
  private foreL!: THREE.Group;
  private foreR!: THREE.Group;
  private legL!: THREE.Group;
  private legR!: THREE.Group;
  /** Knee joints, children of the legs. */
  private shinL!: THREE.Group;
  private shinR!: THREE.Group;
  private bat!: THREE.Group;
  private glove!: THREE.Mesh;
  private shadow!: THREE.Mesh;
  /** Bare hands, swapped to batting gloves whenever the bat is out. */
  private handL!: THREE.Mesh;
  private handR!: THREE.Mesh;
  private skinMat!: THREE.MeshLambertMaterial;
  private battingGloveMat!: THREE.MeshLambertMaterial;
  /** Helmet ear flap, mirrored to whichever side is facing the pitcher. */
  private earFlap: THREE.Mesh | null = null;
  /**
   * The parts that actually cast a shadow. A player is ~34 meshes and most of
   * them are trim: a button, a placket stripe, a shoe sole, a brow band. Running
   * the shadow pass over all of them triples its draw calls and changes the
   * shadow by no visible pixel, so only the big masses are casters.
   */
  private casters: THREE.Mesh[] = [];
  private headScale = 1;

  private phase = 0;
  private bob = 0;
  /** Smoothed facing so models never snap around. */
  private facing = 0;
  private lean = 0;

  constructor(colors: ActorColors, body: BodyType, gear: Headgear = 'cap', jerseyNumber = 0) {
    this.build(colors, body, gear, jerseyNumber);
    this.group.add(this.root);
  }

  /**
   * MODEL
   * -----
   * Chunky and low-poly, but jointed. The first version was a scarecrow — one
   * box per limb, no elbow, no knee, no shoulder — and every pose read as a
   * mannequin being rotated rather than an athlete moving. The joints are what
   * buy a swing, a throw and a dive their shape.
   *
   * The hierarchy is what does the work:
   *
   *   root → legs → shins → feet
   *   root → torso → chest, head, arms → forearms → hands → bat / glove
   *
   * Arms and head hang off the torso rather than off the root, so a hip turn
   * carries the whole upper body the way a real swing does. They used to be
   * siblings, which is why the old batter's shoulders stayed square while his
   * chest rotated out from under them.
   */
  private build(colors: ActorColors, body: BodyType, gear: Headgear, jerseyNumber: number): void {
    const b = BODY[body] ?? BODY.average;
    const k = body;

    // Real uniform trousers are near-white or grey, faintly tinted toward the
    // club's accent. Deriving them straight from the trim colour, as the first
    // version did, produced pink and lilac legs on half the league.
    const pants = mat(shade(colors.accent, 0.72));
    const trim = mat(colors.trim);
    const skin = mat(colors.skin);
    const shoe = mat(shade(colors.accent, -0.55));
    const helmetShell = mat(shade(colors.jersey, -0.08));

    // Overall stature is unchanged — the plate camera's clearances were derived
    // from these numbers — but the mass is redistributed toward the shoulders
    // and the head, which is what makes the silhouette read as a ballplayer at
    // a distance rather than as a post.
    const legH = 0.74 * b.height;
    const thighH = legH * 0.5;
    const shinH = legH * 0.5;
    const torsoH = 0.6 * b.height;
    const chestH = torsoH * 0.6;
    const torsoW = 0.52 * b.width;
    const torsoD = 0.3 * b.depth;
    const shoulderW = torsoW * 1.24;

    // --- Legs: hip → knee → foot -------------------------------------------
    // Turned forms on exactly the joint anchors the box version used, so every
    // pose in `update()` still lands where it was tuned to land.
    const mkLeg = (side: number) => {
      const hip = new THREE.Group();
      const thigh = new THREE.Mesh(
        limbGeo(`${k}:thigh`, thighH, 0.104 * b.width, 0.079 * b.width),
        smoothMat(shade(colors.accent, 0.72)),
      );
      // Trousers are baggy: rounder than the leg inside them, and not tapered
      // all the way to the knee.
      thigh.scale.z = 1.08;
      thigh.position.y = -thighH / 2;
      hip.add(thigh);

      const knee = new THREE.Group();
      knee.position.y = -thighH;
      const shin = new THREE.Mesh(
        limbGeo(`${k}:shin`, shinH, 0.09 * b.width, 0.056 * b.width),
        smoothMat(shade(colors.accent, 0.72)),
      );
      shin.scale.z = 1.06;
      shin.position.y = -shinH / 2;
      knee.add(shin);
      // Stirrup sock over the calf: the one place the club's trim colour shows
      // below the belt, and a strong horizontal band that reads at speed. Turned
      // slightly fatter than the shin so it sits *over* it rather than through.
      const sock = new THREE.Mesh(
        limbGeo(`${k}:sock`, shinH * 0.56, 0.096 * b.width, 0.066 * b.width),
        smoothMat(colors.trim),
      );
      sock.scale.z = 1.06;
      sock.position.y = -shinH * 0.7;
      knee.add(sock);
      // A cleat: low, long, and wider at the toe than the heel.
      const foot = new THREE.Mesh(box(`${k}:foot`, 0.115 * b.width, 0.075, 0.3 * b.depth), shoe);
      foot.position.set(0, -shinH - 0.03, 0.055);
      knee.add(foot);
      const toe = new THREE.Mesh(
        limbGeo(`${k}:toe`, 0.16 * b.depth, 0.058, 0.035, 8),
        smoothMat(shade(colors.accent, -0.55)),
      );
      toe.rotation.x = Math.PI / 2;
      toe.scale.set(1, 1, 0.62);
      toe.position.set(0, -shinH - 0.03, 0.16 * b.depth);
      knee.add(toe);
      const sole = new THREE.Mesh(box(`${k}:sole`, 0.125 * b.width, 0.028, 0.32 * b.depth), pants);
      sole.position.set(0, -shinH - 0.072, 0.06);
      knee.add(sole);
      hip.add(knee);

      hip.position.set(side * 0.15 * b.width, legH, 0);
      return { hip, knee, thigh, shin, foot };
    };
    const legL = mkLeg(-1);
    const legR = mkLeg(1);
    this.legL = legL.hip;
    this.legR = legR.hip;
    this.shinL = legL.knee;
    this.shinR = legR.knee;
    this.root.add(this.legL, this.legR);

    // The pelvis lives on the root rather than the torso: the legs hang off it
    // and it must not twist away from them when the shoulders turn. Without it
    // the thighs visibly float below the jersey.
    const pelvis = new THREE.Mesh(
      limbGeo(`${k}:pelvis`, 0.19, torsoW * 0.44, torsoW * 0.4, 12),
      smoothMat(shade(colors.accent, 0.72)),
    );
    pelvis.scale.z = (torsoD * 0.5) / (torsoW * 0.44);
    pelvis.position.y = legH - 0.03;
    this.root.add(pelvis);

    // --- Torso: one turned form from belt to shoulders ----------------------
    this.torso = new THREE.Group();
    this.torso.position.y = legH;
    this.root.add(this.torso);

    // What used to be four boxes — waist, chest, yoke, belly — is one profile.
    // They were separate only because a box cannot narrow, so the taper had to
    // be built out of differently-sized boxes and every seam read as a step.
    const heavy = body === 'huge' || body === 'stocky';
    const chest = new THREE.Mesh(
      torsoGeo(
        `${k}:torso`,
        torsoH,
        torsoW * (heavy ? 0.52 : 0.395),
        torsoW * 0.47,
        shoulderW * 0.5,
      ),
      smoothMat(colors.jersey),
    );
    // A chest is an oval from above, never a circle — and much shallower than
    // it is wide. `torsoD` is a full box depth from the old model, so the half
    // depth is what compares against a lathe radius; using the whole thing made
    // the torso deeper than it was broad, which is a barrel, not an athlete.
    chest.scale.z = (torsoD * 0.5) / (torsoW * 0.5);
    this.torso.add(chest);

    const belt = new THREE.Mesh(
      limbGeo(`${k}:belt`, 0.07, torsoW * 0.43, torsoW * 0.42, 12),
      smoothMat(colors.trim),
    );
    belt.scale.z = (torsoD * 0.52) / (torsoW * 0.43);
    belt.position.y = 0.035;
    this.torso.add(belt);

    // Button placket down the front. One thin vertical stripe is still the
    // cheapest thing that turns a coloured shape into a jersey.
    const placket = new THREE.Mesh(
      box(`${k}:placket`, torsoW * 0.09, torsoH * 0.72, 0.02),
      trim,
    );
    placket.position.set(0, torsoH * 0.45, -torsoD * 0.5 - 0.012);
    this.torso.add(placket);

    // The number, on the back. The plate camera spends most of a game looking at
    // exactly this rectangle of jersey, and nothing else available at this
    // budget says "a person is wearing a uniform" half as loudly.
    if (jerseyNumber > 0) {
      const digits = new THREE.Mesh(
        numberGeo(jerseyNumber, torsoH * 0.3),
        mat(colors.trim),
      );
      digits.position.set(0, torsoH * 0.62, torsoD * 0.5 + 0.008);
      digits.rotation.y = Math.PI;
      this.torso.add(digits);
    }

    const neck = new THREE.Mesh(
      limbGeo(`${k}:neck`, 0.13, 0.062 * b.width, 0.075 * b.width, 8),
      smoothMat(colors.skin),
    );
    neck.position.y = torsoH + 0.01;
    this.torso.add(neck);

    // --- Head ---------------------------------------------------------------
    this.head = new THREE.Group();
    const hs = b.headScale;
    const headR = 0.135 * hs;
    // A skull with a brow and a jaw that tapers to a chin, rather than a cube
    // with a dark stripe painted across the front to say which way it faced. At
    // the distance these are usually seen the stripe worked; every frame closer
    // than that, it was a cube with a stripe on it.
    const skull = new THREE.Mesh(headGeo(`${k}:skull`, headR), smoothMat(colors.skin));
    skull.scale.z = 1.08;
    this.head.add(skull);
    // A brow and two eyes, in one mesh and one colour. Separate meshes would be
    // three draw calls per player and fifty-four across a fielding side, for
    // eight triangles of detail; merged it is free. One dark tone for all three
    // reads as a shadowed eye region, which at any distance this camera reaches
    // is exactly what a face looks like.
    const face = new THREE.Mesh(
      mergedBoxes(`${k}:face`, [
        { w: headR * 1.45, h: headR * 0.16, d: 0.02, x: 0, y: headR * 0.34, z: 0 },
        { w: headR * 0.3, h: headR * 0.22, d: 0.02, x: -headR * 0.4, y: headR * 0.1, z: 0 },
        { w: headR * 0.3, h: headR * 0.22, d: 0.02, x: headR * 0.4, y: headR * 0.1, z: 0 },
      ]),
      mat(shade(colors.skin, -0.5)),
    );
    face.position.set(0, 0, headR * 1.01);
    this.head.add(face);

    let headgearShell: THREE.Mesh | null = null;
    if (gear === 'helmet') {
      // A batting helmet is a deeper shell with one ear flap, and that
      // difference is the fastest way to tell at a glance who is hitting.
      const shell = new THREE.Mesh(domeGeo(`${k}:helmet`, headR * 1.2, 1.12), helmetShell);
      shell.scale.z = 1.08;
      shell.position.set(0, -headR * 0.18, 0);
      this.head.add(shell);
      headgearShell = shell;
      const flap = new THREE.Mesh(
        limbGeo(`${k}:earflap`, headR * 1.05, headR * 0.42, headR * 0.34, 8),
        helmetShell,
      );
      flap.scale.set(0.34, 1, 1.15);
      flap.position.set(-headR * 1.25, -headR * 0.18, headR * 0.16);
      this.earFlap = flap;
      this.head.add(flap);
      const stripe = new THREE.Mesh(
        box(`${k}:helmstripe`, headR * 0.3, headR * 1.5, headR * 0.9),
        trim,
      );
      stripe.position.set(0, headR * 0.55, -headR * 0.2);
      this.head.add(stripe);
      const peak = new THREE.Mesh(
        cyl(`${k}:helmpeak`, headR * 1.02, headR * 1.02, 0.028, 14),
        helmetShell,
      );
      peak.scale.set(1, 1, 1.35);
      peak.position.set(0, -headR * 0.12, headR * 0.82);
      this.head.add(peak);
    } else {
      const crown = new THREE.Mesh(domeGeo(`${k}:crown`, headR * 1.04, 0.92), smoothMat(colors.jersey));
      crown.scale.z = 1.06;
      crown.position.y = -headR * 0.1;
      this.head.add(crown);
      headgearShell = crown;
      const button = new THREE.Mesh(
        limbGeo(`${k}:capbutton`, headR * 0.2, headR * 0.13, headR * 0.11, 6),
        smoothMat(colors.trim),
      );
      button.position.y = headR * 0.88;
      this.head.add(button);
      // A curved brim, not a plank: a flattened disc pushed out over the eyes.
      const brim = new THREE.Mesh(cyl(`${k}:brim`, headR * 0.96, headR * 0.96, 0.026, 14), trim);
      brim.scale.set(1, 1, 1.5);
      brim.position.set(0, -headR * 0.06, headR * 0.78);
      this.head.add(brim);
    }
    this.headScale = hs;
    // Just clear of the neck's top dome: the old figure left a gap the cap hid
    // from most angles and nothing hid from the plate camera.
    this.head.position.y = torsoH + 0.07 + 0.115 * hs;
    this.torso.add(this.head);

    // --- Arms: shoulder → elbow → hand --------------------------------------
    const upperLen = 0.32 * b.height;
    const foreLen = 0.3 * b.height;
    const mkArm = (side: number) => {
      const shoulder = new THREE.Group();
      // The sleeve is the upper arm: a deltoid at the top tapering to the
      // elbow, which is one form rather than an arm box with a shoulder box
      // stuck on it. The old pair left a visible corner at the armpit.
      const upper = new THREE.Mesh(
        limbGeo(`${k}:upperarm`, upperLen, 0.084 * b.width, 0.056 * b.width),
        smoothMat(colors.jersey),
      );
      upper.scale.z = 1.04;
      upper.position.y = -upperLen / 2;
      shoulder.add(upper);

      const elbow = new THREE.Group();
      elbow.position.y = -upperLen;
      // Undershirt to mid-forearm, then skin: two forms that meet rather than a
      // sleeve box and a wrist box separated by a gap.
      const fore = new THREE.Mesh(
        limbGeo(`${k}:forearm`, foreLen * 0.62, 0.058 * b.width, 0.045 * b.width),
        smoothMat(colors.trim),
      );
      fore.scale.z = 1.03;
      fore.position.y = -foreLen * 0.3;
      elbow.add(fore);
      const wrist = new THREE.Mesh(
        limbGeo(`${k}:wrist`, foreLen * 0.46, 0.047 * b.width, 0.038 * b.width),
        smoothMat(colors.skin),
      );
      wrist.scale.z = 1.03;
      wrist.position.y = -foreLen * 0.76;
      elbow.add(wrist);
      const hand = new THREE.Mesh(
        limbGeo(`${k}:hand`, 0.115, 0.045 * b.width, 0.032 * b.width, 8),
        smoothMat(colors.skin),
      );
      hand.scale.z = 0.78;
      hand.position.y = -foreLen - 0.025;
      elbow.add(hand);
      shoulder.add(elbow);
      shoulder.position.set(side * (shoulderW / 2 - 0.03), torsoH - chestH * 0.24, 0);
      return { shoulder, elbow, hand, upper, fore };
    };
    const armL = mkArm(-1);
    const armR = mkArm(1);
    this.armL = armL.shoulder;
    this.armR = armR.shoulder;
    this.foreL = armL.elbow;
    this.foreR = armR.elbow;
    this.handL = armL.hand;
    this.handR = armR.hand;
    this.skinMat = skin;
    this.battingGloveMat = mat(shade(colors.accent, -0.3));
    this.torso.add(this.armL, this.armR);

    // Bat hangs off the right hand; hidden unless a batting pose is active.
    this.bat = new THREE.Group();
    const barrel = new THREE.Mesh(cyl('bat:barrel', 0.048, 0.026, 0.84, 8), mat(0xc98f4e));
    barrel.position.y = 0.42;
    this.bat.add(barrel);
    const taper = new THREE.Mesh(cyl('bat:taper', 0.026, 0.021, 0.16, 8), mat(0xb87f42));
    taper.position.y = -0.02;
    this.bat.add(taper);
    const knob = new THREE.Mesh(cyl('bat:knob', 0.037, 0.037, 0.05, 8), mat(0x2c2c2c));
    knob.position.y = -0.1;
    this.bat.add(knob);
    const gripTape = new THREE.Mesh(cyl('bat:grip', 0.028, 0.024, 0.19, 8), mat(0x1f1f22));
    gripTape.position.y = 0.02;
    this.bat.add(gripTape);
    this.bat.visible = false;
    this.foreR.add(this.bat);
    this.bat.position.y = -foreLen - 0.03;

    // A mitt: round, deep, and thicker than a hand. A slab read as a clipboard.
    this.glove = new THREE.Mesh(
      limbGeo('glove', 0.26, 0.115, 0.085, 10),
      smoothMat(shade(0x8b5a2b, -0.1)),
    );
    this.glove.scale.z = 0.72;
    this.glove.position.y = -foreLen - 0.11;
    this.glove.visible = false;
    this.foreL.add(this.glove);

    this.shadow = new THREE.Mesh(circle(`${k}:shadow`, 0.45 * b.width, 12), shadowMat());
    this.shadow.rotateX(-Math.PI / 2);
    this.shadow.position.y = 0.035;
    this.group.add(this.shadow);

    this.casters = [
      legL.thigh,
      legL.shin,
      legL.foot,
      legR.thigh,
      legR.shin,
      legR.foot,
      chest,
      skull,
      armL.upper,
      armL.fore,
      armR.upper,
      armR.fore,
    ];
    if (headgearShell) this.casters.push(headgearShell);
    this.setShadows(true);
  }

  /**
   * Real shadows and the painted blob under the feet are alternatives, not
   * layers: running both double-darkens the contact point into a black hole.
   */
  setShadows(on: boolean): void {
    this.shadow.visible = !on;
    for (const m of this.casters) m.castShadow = on;
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

    // The ear flap sits on whichever side of the helmet faces the pitcher, so
    // it has to mirror with the batter's handedness.
    if (this.earFlap) this.earFlap.position.x = 0.19 * this.headScale * (opts.handed ?? -1);

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
      case 'crouch':
        this.poseCrouch();
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

    // Batting gloves whenever there is a bat in those hands. Bare skin on the
    // handle was the single palest thing on the model and it sat right where
    // the eye goes.
    const gloved = this.bat.visible ? this.battingGloveMat : this.skinMat;
    this.handL.material = gloved;
    this.handR.material = gloved;
  }

  private reset(): void {
    this.legL.rotation.set(0, 0, 0);
    this.legR.rotation.set(0, 0, 0);
    this.shinL.rotation.set(0, 0, 0);
    this.shinR.rotation.set(0, 0, 0);
    this.armL.rotation.set(0, 0, 0);
    this.armR.rotation.set(0, 0, 0);
    // Arms never hang perfectly straight on a person; a standing bend at the
    // elbow is the cheapest thing that stops the model looking like a doll.
    this.foreL.rotation.set(-0.18, 0, 0);
    this.foreR.rotation.set(-0.18, 0, 0);
    this.head.rotation.set(0, 0, 0);
    this.torso.rotation.set(0, 0, 0);
    this.root.position.y = this.bob;
  }

  private poseIdle(): void {
    this.reset();
    const s = Math.sin(this.phase);
    this.armL.rotation.x = s * 0.06;
    this.armR.rotation.x = -s * 0.06;
    this.armL.rotation.z = 0.12;
    this.armR.rotation.z = -0.12;
    this.foreL.rotation.x = -0.42;
    this.foreR.rotation.x = -0.34;
    this.glove.visible = true;
  }

  private poseRun(speed: number): void {
    this.reset();
    const amp = Math.min(1.05, 0.4 + speed * 0.09);
    const s = Math.sin(this.phase * 2);
    this.legL.rotation.x = s * amp;
    this.legR.rotation.x = -s * amp;
    // Knees fold on the recovery half of the stride and straighten on the
    // drive, which is the difference between running and marching.
    this.shinL.rotation.x = Math.max(0, -s) * amp * 1.5;
    this.shinR.rotation.x = Math.max(0, s) * amp * 1.5;
    this.armL.rotation.x = -s * amp * 0.85;
    this.armR.rotation.x = s * amp * 0.85;
    this.foreL.rotation.x = -1.15;
    this.foreR.rotation.x = -1.15;
    this.lean = Math.min(0.32, speed * 0.035);
    this.root.rotation.x = this.lean;
    this.glove.visible = true;
  }

  /**
   * The catcher's set position. It exists as much for the camera as for the
   * fiction: at the plate the camera looks straight over this player's head at
   * the strike zone, and a fielder standing bolt upright two metres from the
   * lens covers the one thing the hitter needs to see.
   */
  private poseCrouch(): void {
    this.reset();
    // A real catcher's crouch: knees folded hard under the hips, back angled
    // forward, glove up. The joints let this be a squat rather than a model
    // sunk halfway into the dirt, which is what it was without them.
    this.legL.rotation.x = 1.05;
    this.legR.rotation.x = 0.9;
    this.shinL.rotation.x = -1.75;
    this.shinR.rotation.x = -1.6;
    this.torso.rotation.x = 0.34;
    this.head.rotation.x = -0.2;
    this.root.position.y = this.bob - 0.34;
    this.armL.rotation.x = -1.35;
    this.armL.rotation.z = 0.34;
    this.foreL.rotation.x = -0.7;
    this.armR.rotation.x = -0.5;
    this.armR.rotation.z = -0.45;
    this.foreR.rotation.x = -0.9;
    this.glove.visible = true;
  }

  private poseFieldReady(): void {
    this.reset();
    this.legL.rotation.x = 0.42;
    this.legR.rotation.x = -0.42;
    this.shinL.rotation.x = -0.5;
    this.shinR.rotation.x = -0.3;
    this.root.rotation.x = 0.24;
    this.root.position.y = this.bob - 0.12;
    this.armL.rotation.x = -0.85;
    this.armL.rotation.z = 0.4;
    this.foreL.rotation.x = -0.75;
    this.armR.rotation.x = -0.55;
    this.armR.rotation.z = -0.38;
    this.foreR.rotation.x = -0.7;
    this.glove.visible = true;
  }

  private poseBatStance(handed: number): void {
    this.reset();
    this.bat.visible = true;
    this.root.rotation.y = this.facing;
    // Weight on the back foot, front knee soft, hands up by the back shoulder.
    this.legL.rotation.x = 0.2;
    this.legR.rotation.x = -0.2;
    this.shinL.rotation.x = -0.3;
    this.shinR.rotation.x = -0.16;
    this.root.position.y = this.bob - 0.07;
    this.torso.rotation.y = handed * 0.25;
    // Hands up and BACK, by the rear shoulder, with the bat cocked over it.
    // This is also a framing constraint and not only a fidelity one: the plate
    // camera looks past this hitter at the strike zone, so anything the stance
    // puts out in front of his chest ends up sitting on top of the zone.
    this.armR.rotation.x = -2.15;
    this.armR.rotation.z = handed * -0.35;
    this.foreR.rotation.x = -0.3;
    this.armL.rotation.x = -1.95;
    this.armL.rotation.z = handed * -0.25;
    this.foreL.rotation.x = -0.35;
    this.bat.rotation.set(0.5, 0, handed * 0.4);
    this.head.rotation.y = handed * -0.34;
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

    // Hips fire first and the shoulders follow: the torso turn is what carries
    // the arms and the bat, so the swing rotates as one piece.
    // The torso now carries the arms, so its turn is roughly half what the old
    // shoulders-independent version used — the arms get the rest for free.
    this.torso.rotation.y = handed * (0.25 + load * 0.2 - ease * 1.5);
    this.torso.rotation.x = -ease * 0.1;
    this.root.rotation.y = this.facing + handed * (0.15 - ease * 0.35);

    // Elbows straighten as the barrel comes round, which is the whole visual of
    // "getting extended".
    this.armR.rotation.x = -2.15 - load * 0.15 + ease * 1.5;
    this.armR.rotation.z = handed * (-0.35 + ease * 0.9);
    this.foreR.rotation.x = -0.3 + ease * 0.3;
    this.armL.rotation.x = -1.95 - load * 0.12 + ease * 1.3;
    this.armL.rotation.z = handed * (-0.25 + ease * 0.8);
    this.foreL.rotation.x = -0.35 + ease * 0.35;
    this.bat.rotation.set(0.5 - ease * 1.0, 0, handed * (0.4 - ease * 2.4));

    // Back foot pivots up on the toe, front leg braces straight.
    this.legR.rotation.x = -0.2 - ease * 0.34;
    this.shinR.rotation.x = -0.16 - ease * 0.7;
    this.legL.rotation.x = 0.2 + ease * 0.28;
    this.shinL.rotation.x = -0.3 + ease * 0.26;
    this.head.rotation.y = handed * (-0.34 + ease * 0.4);
    this.root.position.y = this.bob - 0.07 - ease * 0.05 + follow * 0.02;
  }

  private poseBunt(handed: number): void {
    this.reset();
    this.bat.visible = true;
    this.root.position.y = this.bob - 0.15;
    this.root.rotation.y = this.facing;
    // Squared up: hips open to the pitcher, knees bent, bat flat across.
    this.torso.rotation.y = handed * 0.95;
    this.legL.rotation.x = 0.34;
    this.legR.rotation.x = -0.34;
    this.shinL.rotation.x = -0.5;
    this.shinR.rotation.x = -0.42;
    this.armR.rotation.x = -1.15;
    this.armR.rotation.z = handed * -0.35;
    this.foreR.rotation.x = -0.6;
    this.armL.rotation.x = -1.2;
    this.armL.rotation.z = handed * 0.55;
    this.foreL.rotation.x = -0.5;
    this.bat.rotation.set(0.1, 0, handed * 1.45);
  }

  private posePitchSet(t: number): void {
    this.reset();
    this.glove.visible = true;
    const k = Math.min(1, Math.max(0, t));
    // Leg kick: the lift comes from the hip and the knee folds under it.
    this.legL.rotation.x = -k * 1.35;
    this.shinL.rotation.x = -k * 1.5;
    this.legR.rotation.x = k * 0.1;
    this.armR.rotation.x = -k * 1.5;
    this.foreR.rotation.x = -0.4 - k * 1.5;
    this.armL.rotation.x = -0.7 - k * 0.4;
    this.foreL.rotation.x = -1.3 - k * 0.5;
    this.root.rotation.x = -k * 0.14;
    this.torso.rotation.y = k * 0.55;
  }

  private posePitchThrow(t: number): void {
    this.reset();
    this.glove.visible = true;
    const k = Math.min(1, Math.max(0, t));
    const ease = k * k * (3 - 2 * k);
    // Arm whips over the top: the elbow leads, then the forearm snaps through.
    this.armR.rotation.x = -1.5 + ease * 3.6;
    this.foreR.rotation.x = -1.9 + ease * 1.85;
    this.armL.rotation.x = -1.1 + ease * 1.4;
    this.foreL.rotation.x = -1.8 + ease * 1.3;
    this.legL.rotation.x = -1.35 + ease * 2.0;
    this.shinL.rotation.x = -1.5 + ease * 1.45;
    this.legR.rotation.x = 0.1 - ease * 0.75;
    this.shinR.rotation.x = -ease * 0.5;
    this.root.rotation.x = 0.3 * ease;
    this.torso.rotation.y = 0.55 - ease * 0.95;
  }

  private poseThrow(t: number): void {
    this.reset();
    this.glove.visible = true;
    const k = Math.min(1, Math.max(0, t));
    const ease = k * k * (3 - 2 * k);
    this.armR.rotation.x = -1.4 + ease * 3.2;
    this.foreR.rotation.x = -1.8 + ease * 1.7;
    this.armL.rotation.x = -0.9 + ease * 0.9;
    this.foreL.rotation.x = -1.2 + ease * 0.9;
    this.root.rotation.x = 0.16 * ease;
    this.torso.rotation.y = 0.4 - ease * 0.7;
    this.legL.rotation.x = 0.45 - ease * 0.65;
    this.shinL.rotation.x = -0.35 + ease * 0.3;
    this.legR.rotation.x = -0.3 + ease * 0.5;
  }

  private poseDive(t: number): void {
    this.reset();
    this.glove.visible = true;
    const k = Math.min(1, Math.max(0, t));
    this.root.rotation.x = Math.min(1.42, k * 3.2);
    this.root.position.y = this.bob + Math.sin(Math.min(1, k * 1.6) * Math.PI) * 0.35 - 0.35 * k;
    // Fully extended, glove hand reaching past the head — the shape that sells
    // a diving stop even at a distance.
    this.armL.rotation.x = -2.75;
    this.foreL.rotation.x = -0.05;
    this.armR.rotation.x = -2.0;
    this.foreR.rotation.x = -0.4;
    this.legL.rotation.x = -0.28;
    this.legR.rotation.x = -0.2;
    this.shinL.rotation.x = -0.3;
    this.shinR.rotation.x = -0.45;
  }

  private poseJump(t: number): void {
    this.reset();
    this.glove.visible = true;
    const k = Math.min(1, Math.max(0, t));
    const h = Math.sin(k * Math.PI) * 0.72;
    this.root.position.y = this.bob + h;
    this.armL.rotation.x = -3.0;
    this.foreL.rotation.x = -0.05;
    this.armR.rotation.x = -2.2;
    this.foreR.rotation.x = -0.5;
    // Legs tuck at the top of the leap.
    this.legL.rotation.x = -0.45;
    this.legR.rotation.x = -0.55;
    this.shinL.rotation.x = -0.9 * Math.sin(k * Math.PI);
    this.shinR.rotation.x = -1.1 * Math.sin(k * Math.PI);
  }

  private poseSlide(t: number): void {
    this.reset();
    const k = Math.min(1, Math.max(0, t));
    this.root.rotation.x = -1.0 - k * 0.15;
    this.root.position.y = this.bob - 0.42;
    // Classic bent-leg slide: lead leg straight, trail leg folded under it.
    this.legL.rotation.x = 0.55;
    this.shinL.rotation.x = -0.1;
    this.legR.rotation.x = 0.2;
    this.shinR.rotation.x = -1.35;
    this.armL.rotation.x = -1.5;
    this.foreL.rotation.x = -0.6;
    this.armR.rotation.x = -2.1;
    this.foreR.rotation.x = -0.4;
    this.torso.rotation.x = -0.2;
  }

  private poseCelebrate(): void {
    this.reset();
    const s = Math.abs(Math.sin(this.phase * 1.8));
    this.armL.rotation.x = -2.6 - s * 0.4;
    this.armR.rotation.x = -2.6 - s * 0.4;
    this.armL.rotation.z = 0.5;
    this.armR.rotation.z = -0.5;
    this.foreL.rotation.x = -0.35;
    this.foreR.rotation.x = -0.35;
    this.legL.rotation.x = -s * 0.2;
    this.shinL.rotation.x = -s * 0.5;
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

  /**
   * The pitched ball is drawn oversized on purpose. A regulation ball 20 m away
   * through a long lens is a couple of pixels across, which is not something a
   * player can time a swing against — so the arcade convention is to inflate it.
   * Nothing about the physics changes; only the sphere the renderer draws.
   */
  setScale(s: number): void {
    this.mesh.scale.setScalar(s);
  }

  /**
   * The ball casts a real shadow *and* keeps its painted blob. Unlike a
   * player's, the blob is a gameplay aid rather than decoration — it is how you
   * judge the height of a fly ball — and the shadow volume only covers the
   * infield and near outfield, so a deep drive would otherwise lose it exactly
   * when it matters most.
   */
  setShadows(on: boolean): void {
    this.mesh.castShadow = on;
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
