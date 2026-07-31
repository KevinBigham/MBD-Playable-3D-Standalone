import * as THREE from 'three';
import type { Stadium } from '../core/types';
import { BASES, BASE_PATH, DEG, MOUND_Z } from '../core/constants';
import { fenceAt, fenceOutline } from '../data/stadiums';
import { Rng, hashString } from '../core/rng';
import { flatMat, basicMat, shade } from './palette';

/**
 * Builds one ballpark as a single Object3D. Everything is chunky, flat-shaded
 * and low-poly on purpose: strong silhouettes read instantly at speed, and the
 * whole park is a few thousand triangles so it never competes with gameplay.
 */

export interface StadiumBuild {
  root: THREE.Group;
  crowd: THREE.InstancedMesh;
  crowdCount: number;
  /** Immutable rest positions for each crowd instance. */
  crowdBase: Float32Array;
  lights: THREE.Group;
  wallHeightAt(angleDeg: number): number;
  dispose(): void;
}

const FOUL_EXTENT = 34; // how far foul ground runs before the stands

export function buildStadium(stadium: Stadium, night: boolean): StadiumBuild {
  const root = new THREE.Group();
  const rng = new Rng(hashString(stadium.id));

  root.add(buildGrass(stadium));
  root.add(buildDirt(stadium));
  root.add(buildLines());
  root.add(buildBases());
  root.add(buildMound(stadium));

  const wall = buildWall(stadium);
  root.add(wall);

  const stands = buildStands(stadium, rng);
  root.add(stands.group);
  root.add(buildBackstop(stadium));

  const skyline = buildSkyline(stadium, rng);
  root.add(skyline);

  const lights = buildLightTowers(stadium, night);
  root.add(lights);

  if (stadium.domed) root.add(buildRoof(stadium));

  return {
    root,
    crowd: stands.crowd,
    crowdCount: stands.count,
    crowdBase: stands.base,
    lights,
    wallHeightAt: (a: number) => fenceAt(stadium, a).height,
    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) mat.dispose();
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Playing surface
// ---------------------------------------------------------------------------

function buildGrass(stadium: Stadium): THREE.Group {
  const g = new THREE.Group();
  const pal = stadium.palette;
  const outline = fenceOutline(stadium, 72);
  const maxR = Math.max(...outline.map((p) => Math.hypot(p.x, p.z))) + 2;

  // Alternating mow rings inside the fence. Cheap, and instantly readable as
  // a groundskeeper's pattern rather than a flat green plane.
  const rings = 9;
  for (let i = rings - 1; i >= 0; i--) {
    const r = ((i + 1) / rings) * maxR;
    const shape = new THREE.Shape();
    const segs = 48;
    shape.moveTo(0, 0);
    for (let s = 0; s <= segs; s++) {
      const a = (-52 + (104 * s) / segs) * DEG;
      shape.lineTo(Math.sin(a) * r, Math.cos(a) * r);
    }
    shape.lineTo(0, 0);
    const geo = new THREE.ShapeGeometry(shape, 1);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, flatMat(i % 2 === 0 ? pal.grass : pal.grassAlt, { flat: false }));
    mesh.position.y = 0.004 + i * 0.0006;
    mesh.receiveShadow = false;
    g.add(mesh);
  }

  // Foul territory behind the plate and down the lines.
  const foul = new THREE.Mesh(
    new THREE.CircleGeometry(maxR + FOUL_EXTENT, 40),
    flatMat(shade(pal.grass, -0.18), { flat: false }),
  );
  foul.rotateX(-Math.PI / 2);
  foul.position.y = 0.001;
  g.add(foul);

  return g;
}

function buildDirt(stadium: Stadium): THREE.Group {
  const g = new THREE.Group();
  const pal = stadium.palette;
  const mat = flatMat(pal.dirt, { flat: false });

  // Infield dirt: an arc from foul line to foul line at the edge of the grass.
  const shape = new THREE.Shape();
  const R = 29.5;
  shape.moveTo(0, 0);
  const segs = 40;
  for (let s = 0; s <= segs; s++) {
    const a = (-47 + (94 * s) / segs) * DEG;
    shape.lineTo(Math.sin(a) * R, Math.cos(a) * R);
  }
  shape.lineTo(0, 0);
  const geo = new THREE.ShapeGeometry(shape, 1);
  geo.rotateX(-Math.PI / 2);
  const dirt = new THREE.Mesh(geo, mat);
  dirt.position.y = 0.012;
  g.add(dirt);

  // Grass "island" in the middle of the infield, the classic diamond cut-out.
  const iso = new THREE.Shape();
  const pts = [
    { x: 0, z: 5.6 },
    { x: 14.2, z: 20.6 },
    { x: 0, z: 34.5 },
    { x: -14.2, z: 20.6 },
  ];
  iso.moveTo(pts[0].x, pts[0].z);
  for (let i = 1; i < pts.length; i++) iso.lineTo(pts[i].x, pts[i].z);
  iso.closePath();
  const isoGeo = new THREE.ShapeGeometry(iso);
  isoGeo.rotateX(-Math.PI / 2);
  const island = new THREE.Mesh(isoGeo, flatMat(pal.grass, { flat: false }));
  island.position.y = 0.018;
  g.add(island);

  // Base paths cut back through the island.
  const corners = [BASES.HOME, BASES.FIRST, BASES.SECOND, BASES.THIRD, BASES.HOME];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const path = new THREE.Mesh(new THREE.PlaneGeometry(len, 2.6), mat);
    path.rotateX(-Math.PI / 2);
    path.position.set((a.x + b.x) / 2, 0.024, (a.z + b.z) / 2);
    path.rotation.z = -Math.atan2(b.z - a.z, b.x - a.x);
    g.add(path);
  }

  // Home plate circle and on-deck areas.
  const plateCircle = new THREE.Mesh(new THREE.CircleGeometry(4.2, 24), mat);
  plateCircle.rotateX(-Math.PI / 2);
  plateCircle.position.set(0, 0.026, 0.4);
  g.add(plateCircle);

  return g;
}

function buildLines(): THREE.Group {
  const g = new THREE.Group();
  const mat = basicMat(0xf4f4ef);
  for (const sign of [-1, 1]) {
    const len = 118;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.22), mat);
    line.rotateX(-Math.PI / 2);
    line.position.set((sign * len) / 2 / Math.SQRT2, 0.03, len / 2 / Math.SQRT2);
    line.rotation.z = sign > 0 ? -Math.PI / 4 : Math.PI / 4;
    g.add(line);
  }
  // Batter's boxes.
  for (const sign of [-1, 1]) {
    const outline = boxOutline(1.22, 1.83, 0.09, mat);
    outline.position.set(sign * 0.86, 0.032, 0.2);
    g.add(outline);
  }
  return g;
}

function boxOutline(w: number, h: number, t: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const make = (sx: number, sz: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), mat);
    m.rotateX(-Math.PI / 2);
    m.position.set(x, 0, z);
    g.add(m);
  };
  make(w, t, 0, h / 2);
  make(w, t, 0, -h / 2);
  make(t, h, w / 2, 0);
  make(t, h, -w / 2, 0);
  return g;
}

function buildBases(): THREE.Group {
  const g = new THREE.Group();
  const mat = flatMat(0xf7f7f2);
  for (const b of [BASES.FIRST, BASES.SECOND, BASES.THIRD]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.46), mat);
    m.position.set(b.x, 0.04, b.z);
    m.rotation.y = Math.PI / 4;
    g.add(m);
  }
  // Home plate: a pentagon approximated with a rotated box plus a wedge.
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.06, 0.28), mat);
  plate.position.set(0, 0.03, 0.13);
  g.add(plate);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.06, 4), mat);
  tip.rotation.y = Math.PI / 4;
  tip.rotation.x = Math.PI;
  tip.position.set(0, 0.03, -0.06);
  g.add(tip);
  return g;
}

function buildMound(stadium: Stadium): THREE.Group {
  const g = new THREE.Group();
  const mound = new THREE.Mesh(
    new THREE.CylinderGeometry(2.75, 3.05, 0.26, 20),
    flatMat(stadium.palette.dirt, { flat: false }),
  );
  mound.position.set(0, 0.1, MOUND_Z);
  g.add(mound);
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.61, 0.06, 0.15), flatMat(0xf7f7f2));
  rubber.position.set(0, 0.25, MOUND_Z + 0.1);
  g.add(rubber);
  return g;
}

// ---------------------------------------------------------------------------
// Wall, stands, structure
// ---------------------------------------------------------------------------

function buildWall(stadium: Stadium): THREE.Group {
  const g = new THREE.Group();
  const pal = stadium.palette;
  const outline = fenceOutline(stadium, 60);

  const positions: number[] = [];
  const indices: number[] = [];
  const trimPos: number[] = [];
  const trimIdx: number[] = [];

  for (let i = 0; i < outline.length; i++) {
    const p = outline[i];
    positions.push(p.x, 0, p.z, p.x, p.h, p.z);
    const th = 0.22;
    trimPos.push(p.x, p.h, p.z, p.x, p.h + th, p.z);
  }
  for (let i = 0; i < outline.length - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    trimIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const wall = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: pal.wall, side: THREE.DoubleSide }));
  g.add(wall);

  const tgeo = new THREE.BufferGeometry();
  tgeo.setAttribute('position', new THREE.Float32BufferAttribute(trimPos, 3));
  tgeo.setIndex(trimIdx);
  tgeo.computeVertexNormals();
  g.add(new THREE.Mesh(tgeo, new THREE.MeshBasicMaterial({ color: pal.wallTrim, side: THREE.DoubleSide })));

  // Distance markers at the corners and in dead centre.
  for (const angle of [-40, -20, 0, 20, 40]) {
    const f = fenceAt(stadium, angle);
    const a = angle * DEG;
    const marker = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 1.5),
      new THREE.MeshBasicMaterial({ color: pal.wallTrim, side: THREE.DoubleSide }),
    );
    marker.position.set(Math.sin(a) * (f.dist - 0.06), f.height * 0.55, Math.cos(a) * (f.dist - 0.06));
    marker.lookAt(0, f.height * 0.55, 0);
    g.add(marker);
  }

  // Foul poles.
  for (const sign of [-1, 1]) {
    const f = fenceAt(stadium, sign * 45);
    const a = sign * 45 * DEG;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 13, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe14d }),
    );
    pole.position.set(Math.sin(a) * f.dist, 6.5, Math.cos(a) * f.dist);
    g.add(pole);
  }

  return g;
}

interface StandsBuild {
  group: THREE.Group;
  crowd: THREE.InstancedMesh;
  count: number;
  /** x, y, z triples of every seat, so the wave animates from a fixed origin. */
  base: Float32Array;
}

/**
 * Seating bowl. It is generated as one continuous ring of radial "spokes" that
 * wraps the whole park: outside the outfield wall it hugs the fence, then it
 * sweeps around foul ground and closes behind the plate. Building it radially
 * (rather than as separate straight runs) is what keeps seats out of fair
 * territory whatever shape the fence happens to be.
 */
function buildStands(stadium: Stadium, rng: Rng): StandsBuild {
  const g = new THREE.Group();
  const pal = stadium.palette;

  const TIERS = 6;
  const TIER_DEPTH = 3.1;
  const TIER_RISE = 1.9;
  const crowdGeo = new THREE.BoxGeometry(0.66, 0.86, 0.55);
  const crowdMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const seats: { x: number; y: number; z: number; color: THREE.Color }[] = [];

  /** Inner radius of the bowl at a given bearing from home plate. */
  const bowlRadius = (deg: number): { r: number; base: number } => {
    const a = Math.abs(deg);
    if (a <= 45) {
      const f = fenceAt(stadium, deg);
      return { r: f.dist + 4.5, base: Math.max(1.4, f.height - 0.6) };
    }
    const corner = fenceAt(stadium, deg < 0 ? -45 : 45);
    if (a <= 100) {
      // Sweep in from the foul pole toward the seats alongside the infield.
      const t = (a - 45) / 55;
      return { r: (corner.dist + 4.5) * (1 - t) + 44 * t, base: 1.6 };
    }
    // Behind the plate the bowl tightens right up to the backstop.
    const t = Math.min(1, (a - 100) / 80);
    return { r: 44 * (1 - t) + 24 * t, base: 1.6 };
  };

  const STEPS = 96;
  const prevPts: { x: number; z: number; y: number }[][] = [];
  for (let i = 0; i <= STEPS; i++) {
    const deg = -180 + (360 * i) / STEPS;
    const rad = deg * DEG;
    const { r, base } = bowlRadius(deg);
    const ring: { x: number; z: number; y: number }[] = [];
    for (let t = 0; t < TIERS; t++) {
      const rr = r + t * TIER_DEPTH;
      ring.push({
        x: Math.sin(rad) * rr,
        z: Math.cos(rad) * rr,
        y: base + t * TIER_RISE,
      });
    }
    prevPts.push(ring);
  }

  // Extrude each tier as a ribbon of quads: one mesh per tier, six draw calls.
  for (let t = 0; t < TIERS; t++) {
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= STEPS; i++) {
      const p = prevPts[i][t];
      pos.push(p.x, 0, p.z, p.x, p.y + TIER_RISE, p.z);
    }
    for (let i = 0; i < STEPS; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    g.add(
      new THREE.Mesh(
        geo,
        new THREE.MeshLambertMaterial({
          color: t % 2 === 0 ? pal.stands : shade(pal.stands, -0.14),
          side: THREE.DoubleSide,
          flatShading: true,
        }),
      ),
    );

    // Seat the crowd on top of the riser.
    for (let i = 0; i < STEPS; i += 1) {
      if ((i + t) % 2 !== 0) continue;
      const p = prevPts[i][t];
      seats.push({
        x: p.x,
        y: p.y + TIER_RISE + 0.45,
        z: p.z,
        color: new THREE.Color().setHSL(rng.next(), 0.4 + rng.next() * 0.4, 0.32 + rng.next() * 0.4),
      });
    }
  }
  const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, Math.max(1, seats.length));
  const colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, seats.length) * 3), 3);
  const base = new Float32Array(Math.max(1, seats.length) * 3);
  const m = new THREE.Matrix4();
  seats.forEach((s, i) => {
    m.makeTranslation(s.x, s.y, s.z);
    crowd.setMatrixAt(i, m);
    colorAttr.setXYZ(i, s.color.r, s.color.g, s.color.b);
    base[i * 3] = s.x;
    base[i * 3 + 1] = s.y;
    base[i * 3 + 2] = s.z;
  });
  crowdGeo.setAttribute('color', colorAttr);
  crowd.instanceMatrix.needsUpdate = true;
  crowd.frustumCulled = false;
  g.add(crowd);

  return { group: g, crowd, count: seats.length, base };
}

function buildBackstop(stadium: Stadium): THREE.Group {
  const g = new THREE.Group();
  const pal = stadium.palette;
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(19, 19, 3.4, 24, 1, true, Math.PI - 0.75, 1.5),
    new THREE.MeshLambertMaterial({ color: pal.wall, side: THREE.DoubleSide, flatShading: true }),
  );
  wall.position.set(0, 1.7, 0);
  g.add(wall);
  const netMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.09,
    side: THREE.DoubleSide,
  });
  const net = new THREE.Mesh(
    new THREE.CylinderGeometry(18.6, 18.6, 9, 24, 1, true, Math.PI - 0.55, 1.1),
    netMat,
  );
  net.position.set(0, 6, 0);
  g.add(net);
  return g;
}

function buildRoof(stadium: Stadium): THREE.Mesh {
  const geo = new THREE.SphereGeometry(148, 22, 10, 0, Math.PI * 2, 0, Math.PI * 0.32);
  const mat = new THREE.MeshLambertMaterial({
    color: stadium.palette.structure,
    side: THREE.BackSide,
    flatShading: true,
  });
  const roof = new THREE.Mesh(geo, mat);
  roof.position.set(0, 4, 55);
  return roof;
}

function buildLightTowers(stadium: Stadium, night: boolean): THREE.Group {
  const g = new THREE.Group();
  // Steel, not the park's structure colour: at a park whose structure colour is
  // green the poles vanish into the trees and the lamp banks appear to float.
  const poleMat = flatMat(night ? 0x59606b : 0x767d88);
  const lampMat = new THREE.MeshBasicMaterial({ color: night ? 0xfff6d0 : 0xbfc6cc });
  for (const angle of [-44, -20, 20, 44]) {
    const f = fenceAt(stadium, angle);
    const a = angle * DEG;
    const d = f.dist + 26;
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    const h = 34;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.9, h, 5), poleMat);
    pole.position.set(x, h / 2, z);
    g.add(pole);
    const bank = new THREE.Mesh(new THREE.BoxGeometry(9, 4.6, 1.1), lampMat);
    bank.position.set(x, h + 1.5, z);
    bank.rotation.y = -a;
    g.add(bank);
  }
  return g;
}

function buildSkyline(stadium: Stadium, rng: Rng): THREE.Group {
  const g = new THREE.Group();
  const color = stadium.palette.structure;
  const mat = flatMat(color);
  const dark = flatMat(shade(color, -0.35));
  const outline = fenceOutline(stadium, 24);
  const baseDist = Math.max(...outline.map((p) => Math.hypot(p.x, p.z))) + 62;

  /**
   * Places a skyline prop beyond the outfield. Only yaw is applied — using
   * lookAt() tips cones and cylinders onto their sides — and the bearing is
   * kept inside the outfield arc so nothing can poke into the playing view
   * from beside the third-base stands.
   */
  const place = (mesh: THREE.Mesh, angleDeg: number, dist: number, y: number) => {
    const a = Math.max(-52, Math.min(52, angleDeg)) * DEG;
    const d = Math.max(dist, baseDist * 0.86);
    mesh.position.set(Math.sin(a) * d, y, Math.cos(a) * d);
    mesh.rotation.y = -a;
    g.add(mesh);
  };

  switch (stadium.skyline) {
    case 'towers':
      for (let i = 0; i < 14; i++) {
        const h = 22 + rng.range(0, 58);
        const w = 9 + rng.range(0, 12);
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), i % 3 === 0 ? dark : mat);
        place(m, rng.range(-50, 50), baseDist + rng.range(-24, 34), h / 2);
      }
      break;
    case 'mesa':
      for (let i = 0; i < 8; i++) {
        const h = 26 + rng.range(0, 34);
        const m = new THREE.Mesh(new THREE.CylinderGeometry(20 + rng.range(0, 14), 26 + rng.range(0, 16), h, 6), mat);
        place(m, rng.range(-50, 50), baseDist + rng.range(0, 70), h / 2);
      }
      break;
    case 'peaks':
      for (let i = 0; i < 10; i++) {
        const h = 60 + rng.range(0, 90);
        const m = new THREE.Mesh(new THREE.ConeGeometry(34 + rng.range(0, 22), h, 5), i % 2 ? dark : mat);
        place(m, rng.range(-50, 50), baseDist + rng.range(30, 150), h / 2);
      }
      break;
    case 'stacks':
      for (let i = 0; i < 9; i++) {
        const h = 30 + rng.range(0, 46);
        const m = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4.6, h, 7), i % 2 ? dark : mat);
        place(m, rng.range(-50, 50), baseDist + rng.range(-14, 40), h / 2);
        const shed = new THREE.Mesh(new THREE.BoxGeometry(24, 14, 16), dark);
        place(shed, rng.range(-50, 50), baseDist + rng.range(-10, 30), 7);
      }
      break;
    case 'forest':
      for (let i = 0; i < 26; i++) {
        const h = 24 + rng.range(0, 30);
        const m = new THREE.Mesh(new THREE.ConeGeometry(6 + rng.range(0, 4), h, 6), i % 2 ? dark : mat);
        place(m, rng.range(-50, 50), baseDist + rng.range(-26, 60), h / 2);
      }
      break;
    case 'bayou':
      for (let i = 0; i < 16; i++) {
        const h = 14 + rng.range(0, 20);
        const m = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, h, 5), mat);
        place(m, rng.range(-50, 50), baseDist + rng.range(-20, 50), h / 2);
        const canopy = new THREE.Mesh(new THREE.SphereGeometry(7 + rng.range(0, 4), 6, 4), dark);
        place(canopy, rng.range(-50, 50), baseDist + rng.range(-20, 50), h);
      }
      break;
    case 'dome':
      for (let i = 0; i < 10; i++) {
        const h = 18 + rng.range(0, 26);
        const m = new THREE.Mesh(new THREE.BoxGeometry(14, h, 14), i % 2 ? dark : mat);
        place(m, rng.range(-50, 50), baseDist + rng.range(0, 40), h / 2);
      }
      break;
    default:
      for (let i = 0; i < 12; i++) {
        const h = 8 + rng.range(0, 14);
        const m = new THREE.Mesh(new THREE.BoxGeometry(20 + rng.range(0, 18), h, 12), i % 2 ? dark : mat);
        place(m, rng.range(-50, 50), baseDist + rng.range(-10, 80), h / 2);
      }
      break;
  }
  return g;
}

export { BASE_PATH };
