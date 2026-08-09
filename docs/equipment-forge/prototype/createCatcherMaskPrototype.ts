import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

// Build an N-gon oval loop (for hole authoring from a compact {cx,cy,rx,ry} descriptor).
function ovalLoop(cx: number, cy: number, rx: number, ry: number, seg = 24): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1,
  });
}

function buildTubeGeometry(
  path: { points: [number, number, number][]; radius?: number; radialSegments?: number; closed?: boolean },
): THREE.TubeGeometry {
  const vectors = path.points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(vectors, path.closed ?? false);
  const tubularSegments = Math.max(8, path.points.length * 6);
  return new THREE.TubeGeometry(curve, tubularSegments, path.radius ?? 0.05, path.radialSegments ?? 8, path.closed ?? false);
}

// Plan 1.3 F.6 — sweep a thin 2D cross-section along a 3D spine so a curved
// form (hooked blade, handle) reads correctly from EVERY camera angle, not just
// the reference angle a flat extrude happens to match. Uses ExtrudeGeometry's
// native extrudePath; bevelEnabled: false keeps sharp tips (same rule as F.5).
function buildCurveSweepGeometry(
  sweep: { spine: [number, number, number][]; crossSection: { points: [number, number][] }; closed?: boolean },
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const cs = sweep.crossSection.points;
  if (cs.length > 0) {
    shape.moveTo(cs[0][0], cs[0][1]);
    for (let i = 1; i < cs.length; i += 1) shape.lineTo(cs[i][0], cs[i][1]);
    shape.closePath();
  }
  const spine = sweep.spine.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const path = new THREE.CatmullRomCurve3(spine, sweep.closed ?? false);
  return new THREE.ExtrudeGeometry(shape, {
    extrudePath: path,
    steps: Math.max(24, spine.length * 8),
    bevelEnabled: false,
  });
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const [red, green, blue] = hexToRgb(source);
  return new THREE.Color(red / 255, green / 255, blue / 255);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  const textures = makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: MBD Catcher Mask
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createMBDCatcherMaskModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "MBD Catcher Mask";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 35, "aspect": 1, "orientation": {"yaw": -22, "pitch": 4, "roll": 0}, "positionHint": [0.8, 0.15, 3], "note": "Single three-quarter generated reference; proportions are normalized to the existing PlayerActor head and verified in browser renders."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["cage-metal"] = createSculptMaterial(
    "cage-metal",
    {"id": "cage-metal", "name": "Near-black satin cage metal", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#17191B", "color": "#17191B", "albedo": {"dominant": "#17191B", "secondary": ["#292B2D", "#080809", "#424346"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": {"path": "docs/equipment-forge/pbr/mask-reference/base_albedo.png", "url": "/docs/equipment-forge/pbr/mask-reference/base_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}}, "colorVariation": {"palette": ["#17191B", "#292B2D", "#080809", "#424346", "#919091", "#666769"], "pattern": "reference-derived pixel palette", "amplitude": 0.239, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2, "amplitude": 0.479, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.34, "variation": 0.11, "map": {"path": "docs/equipment-forge/pbr/mask-reference/base_roughness.png", "url": "/docs/equipment-forge/pbr/mask-reference/base_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0.72, "variation": 0.08}, "normal": {"pattern": "reference-derived height-gradient normal map", "strength": 0.235, "map": {"path": "docs/equipment-forge/pbr/mask-reference/base_normal.png", "url": "/docs/equipment-forge/pbr/mask-reference/base_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "heightSource": {"path": "docs/equipment-forge/pbr/mask-reference/base_height.png", "url": "/docs/equipment-forge/pbr/mask-reference/base_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.03, "map": {"path": "docs/equipment-forge/pbr/mask-reference/base_height.png", "url": "/docs/equipment-forge/pbr/mask-reference/base_height.png", "channel": "height", "source": "reference-pixel-extraction"}}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "map": {"path": "docs/equipment-forge/pbr/mask-reference/base_ao.png", "url": "/docs/equipment-forge/pbr/mask-reference/base_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#2F2A22"}, "localOverrides": [{"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}, {"id": "weld-highlight", "type": "roughness-and-AO-mask", "evidenceRefs": ["full-object"], "roughness": 0.27, "notes": "Junction highlights stay narrow; seams use overlap geometry."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "Reference PBR evidence passed at 0.86 confidence; production uses a cached near-black MeshStandardMaterial and geometric rails for phone performance.", "referencePbr": {"version": "1.0", "sourceImage": "docs/references/equipment/catcher-mask.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "docs/equipment-forge/pbr/mask-reference/base_albedo.png", "url": "/docs/equipment-forge/pbr/mask-reference/base_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "docs/equipment-forge/pbr/mask-reference/base_roughness.png", "url": "/docs/equipment-forge/pbr/mask-reference/base_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "docs/equipment-forge/pbr/mask-reference/base_height.png", "url": "/docs/equipment-forge/pbr/mask-reference/base_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "docs/equipment-forge/pbr/mask-reference/base_normal.png", "url": "/docs/equipment-forge/pbr/mask-reference/base_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "docs/equipment-forge/pbr/mask-reference/base_ao.png", "url": "/docs/equipment-forge/pbr/mask-reference/base_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 512, "sourceHeight": 512, "mapSize": 1024, "cropBBoxPixels": {"x": 42, "y": 30, "width": 381, "height": 429}, "mask": {"backgroundColor": "#D2D2D3", "backgroundNoise": 32.909, "transparentPixelFraction": 0, "foregroundCoverage": 0.332}, "mapStats": {"valueRange": 0.5694, "heightP90Gradient": 0.06721, "roughnessBase": 0.702, "roughnessVariation": 0.135, "normalStrength": 0.235, "blurRadius": 21}, "palette": ["#17191B", "#292B2D", "#080809", "#424346", "#919091", "#666769"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}},
    options
  );
  materialMap["padding"] = createSculptMaterial(
    "padding",
    {"id": "padding", "name": "Catcher contact padding", "type": "standard", "qualityTier": "utility", "shaderModel": "MeshStandardMaterial / cached phone-safe approximation", "baseColor": "#292B2D", "color": "#292B2D", "albedo": {"dominant": "#292B2D", "secondary": ["#292B2D", "#666769"], "samplingNotes": "Sampled from the admitted catcher-mask reference."}, "colorVariation": {"palette": ["#292B2D", "#292B2D", "#666769"], "pattern": "component-zone contrast", "amplitude": 0.12, "heightCorrelation": 0.2}, "textureResolution": 1024, "textureProjection": {"mode": "procedural object coordinates", "repeat": [1, 1], "anisotropy": 1, "texelDensityIntent": "No runtime texture allocation; geometry and roughness contrast carry the material."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2, "amplitude": 0.25, "role": "pad or strap color zoning"}, {"id": "meso", "frequency": 12, "amplitude": 0.12, "role": "seams and weave direction"}, {"id": "micro", "frequency": 56, "amplitude": 0.04, "role": "restrained highlight breakup"}], "roughness": {"base": 0.72, "variation": 0.1, "map": "independent procedural material parameter", "localResponse": "cavities trend rougher"}, "metalness": {"base": 0, "variation": 0}, "normal": {"pattern": "geometry-backed seams plus conservative procedural weave", "strength": 0.16, "space": "tangent"}, "bump": {"pattern": "none at production phone distance", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.3, "contactShadowBias": 0.4, "notes": "Native shadowing and geometric overlaps."}, "wear": {"edgeWear": 0.03, "scratches": [], "chips": []}, "dirt": {"amount": 0.02, "cavityBias": 0.15, "color": "#080809"}, "localOverrides": [{"id": "pad-piping", "type": "geometry-seam-and-roughness-zone", "evidenceRefs": ["full-object"], "roughness": 0.62, "notes": "Raised border is geometry, not painted relief."}], "shaderNotes": ["Runtime material is cached once and shares geometry-scale detail; no per-athlete texture maps."], "notes": "Reference-derived stylized utility material."},
    options
  );
  materialMap["harness-fabric"] = createSculptMaterial(
    "harness-fabric",
    {"id": "harness-fabric", "name": "Woven harness fabric", "type": "standard", "qualityTier": "utility", "shaderModel": "MeshStandardMaterial / cached phone-safe approximation", "baseColor": "#080809", "color": "#080809", "albedo": {"dominant": "#080809", "secondary": ["#292B2D", "#666769"], "samplingNotes": "Sampled from the admitted catcher-mask reference."}, "colorVariation": {"palette": ["#080809", "#292B2D", "#666769"], "pattern": "component-zone contrast", "amplitude": 0.12, "heightCorrelation": 0.2}, "textureResolution": 1024, "textureProjection": {"mode": "procedural object coordinates", "repeat": [1, 1], "anisotropy": 1, "texelDensityIntent": "No runtime texture allocation; geometry and roughness contrast carry the material."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2, "amplitude": 0.25, "role": "pad or strap color zoning"}, {"id": "meso", "frequency": 12, "amplitude": 0.12, "role": "seams and weave direction"}, {"id": "micro", "frequency": 56, "amplitude": 0.04, "role": "restrained highlight breakup"}], "roughness": {"base": 0.82, "variation": 0.1, "map": "independent procedural material parameter", "localResponse": "cavities trend rougher"}, "metalness": {"base": 0, "variation": 0}, "normal": {"pattern": "geometry-backed seams plus conservative procedural weave", "strength": 0.16, "space": "tangent"}, "bump": {"pattern": "none at production phone distance", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.3, "contactShadowBias": 0.4, "notes": "Native shadowing and geometric overlaps."}, "wear": {"edgeWear": 0.03, "scratches": [], "chips": []}, "dirt": {"amount": 0.02, "cavityBias": 0.15, "color": "#080809"}, "localOverrides": [{"id": "woven-grain", "type": "directional-roughness-zone", "evidenceRefs": ["full-object"], "roughness": 0.86, "notes": "Fine weave is represented by a restrained material response at phone distance."}], "shaderNotes": ["Runtime material is cached once and shares geometry-scale detail; no per-athlete texture maps."], "notes": "Reference-derived stylized utility material."},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_root_0 = null;
  const endpoint_root_0 = makeAttachmentEndpoint(attachment_root_0);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Head attachment root__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Head attachment root", "level": "macro", "role": "wearable-root", "importance": 1, "confidence": 0.97, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "A head-relative oval supplies a stable attachment envelope while all visible identity lives in child systems.", "geometryDescriptor": {"topologyIntent": "non-rendered semantic envelope; generated prototype shows a translucent fit guide", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates; runtime uses native flat colors", "normalStrategy": "computed vertex normals"}, "parent": null, "attachment": null, "dimensions": {"units": "PlayerActor head-relative", "confidence": 0.86, "width": 0.58, "height": 0.68, "depth": 0.34}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "head-attachment", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.58, 0.68, 0.34], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wearable-equipment", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "cage-metal"}}, "material": "cage-metal", "materialLayers": ["cage-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "head-clearance", "kind": "contour", "description": "Clearance envelope avoids the procedural face and ears.", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.12, "bumpAmplitude": 0.01, "normalPattern": "reference-derived evidence; runtime simplified for phone scale", "displacementPattern": "none", "occlusionPattern": "native contact shadow at overlaps", "edgeWearPattern": "restrained edge highlight", "notes": "Identity is carried by geometry and roughness contrast, not opaque model textures."}, "evidenceRefs": ["full-object"], "details": ["head-clearance"], "fidelityTier": "production-stylized", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 25, 27, 1)", "secondaryAlbedo": "rgba(66, 67, 70, 1)", "materialClass": "metal", "materialClassConfidence": 0.88, "evidenceRefs": ["full-object"]}};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "head-attachment", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.58, 0.68, 0.34], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wearable-equipment", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "cage-metal"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["cage-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Head attachment root";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Head attachment root", "level": "macro", "role": "wearable-root", "importance": 1, "confidence": 0.97, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "A head-relative oval supplies a stable attachment envelope while all visible identity lives in child systems.", "geometryDescriptor": {"topologyIntent": "non-rendered semantic envelope; generated prototype shows a translucent fit guide", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates; runtime uses native flat colors", "normalStrategy": "computed vertex normals"}, "parent": null, "attachment": null, "dimensions": {"units": "PlayerActor head-relative", "confidence": 0.86, "width": 0.58, "height": 0.68, "depth": 0.34}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "head-attachment", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.58, 0.68, 0.34], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wearable-equipment", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "cage-metal"}}, "material": "cage-metal", "materialLayers": ["cage-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "head-clearance", "kind": "contour", "description": "Clearance envelope avoids the procedural face and ears.", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.12, "bumpAmplitude": 0.01, "normalPattern": "reference-derived evidence; runtime simplified for phone scale", "displacementPattern": "none", "occlusionPattern": "native contact shadow at overlaps", "edgeWearPattern": "restrained edge highlight", "notes": "Identity is carried by geometry and roughness contrast, not opaque model textures."}, "evidenceRefs": ["full-object"], "details": ["head-clearance"], "fidelityTier": "production-stylized", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 25, 27, 1)", "secondaryAlbedo": "rgba(66, 67, 70, 1)", "materialClass": "metal", "materialClassConfidence": 0.88, "evidenceRefs": ["full-object"]}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.58, 0.68, 0.34], "isTrigger": false};
  destructionGroups["wearable-equipment"] ??= [];
  destructionGroups["wearable-equipment"].push(node_root_0);
  const socket_root_head_attachment_0 = new THREE.Object3D();
  socket_root_head_attachment_0.name = "head-attachment";
  socket_root_head_attachment_0.position.set(0.0, 0.0, 0.0);
  socket_root_head_attachment_0.rotation.set(0.0, 0.0, 0.0);
  socket_root_head_attachment_0.userData.socket = {"id": "head-attachment", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]};
  node_root_0.add(socket_root_head_attachment_0);
  sockets["root:head-attachment"] = socket_root_head_attachment_0;

  const attachment_mask_cage_1 = {"parentId": "root", "parentSocket": "head-attachment", "localStart": [0, 0.31, -0.08], "localEnd": [0, -0.31, -0.13], "contactType": "overlapping-socket", "overlap": 0.025, "gapTolerance": 0.006, "evidenceRefs": ["full-object"]};
  const endpoint_mask_cage_1 = makeAttachmentEndpoint(attachment_mask_cage_1);
  const node_mask_cage_1 = new THREE.Group();
  node_mask_cage_1.name = "Protective cage perimeter__pivot";
  node_mask_cage_1.scale.set(1, 1, 1);
  if (endpoint_mask_cage_1) {
    node_mask_cage_1.position.copy(endpoint_mask_cage_1.start);
    node_mask_cage_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_mask_cage_1.position.set(0.0, 0.0, -0.13);
    node_mask_cage_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_mask_cage_1.userData.sculptComponent = {"id": "mask-cage", "name": "Protective cage perimeter", "level": "macro", "role": "cage-assembly", "importance": 1, "confidence": 0.96, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "The visible outer perimeter is an assembled tubular hard-surface network rather than a solid face shell.", "geometryDescriptor": {"topologyIntent": "low-poly cached procedural geometry with silhouette-first radial segmentation", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates; runtime uses native flat colors", "normalStrategy": "computed vertex normals"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "head-attachment", "localStart": [0, 0.31, -0.08], "localEnd": [0, -0.31, -0.13], "contactType": "overlapping-socket", "overlap": 0.025, "gapTolerance": 0.006, "evidenceRefs": ["full-object"]}, "dimensions": {"units": "PlayerActor head-relative", "confidence": 0.86, "width": 0.56, "height": 0.65, "depth": 0.31}, "transform": {"position": [0, 0, -0.13], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "wearable-component", "pivot": {"mode": "parent-socket", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.56, 0.65, 0.31], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wearable-equipment", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "cage-metal"}}, "material": "cage-metal", "materialLayers": ["cage-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "eye-window-rails", "kind": "ridge", "description": "Three horizontal bands and lateral dividers preserve the open eye window.", "evidenceRefs": ["full-object"]}, {"id": "weld-overlaps", "kind": "fastener", "description": "Rail junctions overlap by at least 0.025 units to avoid floating seams.", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.12, "bumpAmplitude": 0.01, "normalPattern": "reference-derived evidence; runtime simplified for phone scale", "displacementPattern": "none", "occlusionPattern": "native contact shadow at overlaps", "edgeWearPattern": "restrained edge highlight", "notes": "Identity is carried by geometry and roughness contrast, not opaque model textures."}, "evidenceRefs": ["full-object"], "details": ["eye-window-rails", "weld-overlaps"], "fidelityTier": "production-stylized", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 25, 27, 1)", "secondaryAlbedo": "rgba(66, 67, 70, 1)", "materialClass": "metal", "materialClassConfidence": 0.88, "evidenceRefs": ["full-object"]}};
  node_mask_cage_1.userData.actionProfile = {"animationRole": "wearable-component", "pivot": {"mode": "parent-socket", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.56, 0.65, 0.31], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wearable-equipment", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "cage-metal"}};
  (nodes["root"] ?? root).add(node_mask_cage_1);
  nodes["mask-cage"] = node_mask_cage_1;
  const mesh_mask_cage_1Geometry = endpoint_mask_cage_1
    ? new THREE.CylinderGeometry(endpoint_mask_cage_1.endRadius, endpoint_mask_cage_1.baseRadius, endpoint_mask_cage_1.length, 8, 4)
    : new THREE.TorusGeometry(0.45, 0.08, 8, 16);
  if (!endpoint_mask_cage_1) {
    mesh_mask_cage_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_mask_cage_1 = new THREE.Mesh(
    mesh_mask_cage_1Geometry,
    materialMap["cage-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mask_cage_1.name = "Protective cage perimeter";
  if (endpoint_mask_cage_1) {
    mesh_mask_cage_1.position.copy(endpoint_mask_cage_1.midpoint);
    mesh_mask_cage_1.quaternion.copy(endpoint_mask_cage_1.quaternion);
  }
  mesh_mask_cage_1.castShadow = options.castShadow ?? true;
  mesh_mask_cage_1.receiveShadow = options.receiveShadow ?? true;
  mesh_mask_cage_1.userData.sculptComponent = {"id": "mask-cage", "name": "Protective cage perimeter", "level": "macro", "role": "cage-assembly", "importance": 1, "confidence": 0.96, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "The visible outer perimeter is an assembled tubular hard-surface network rather than a solid face shell.", "geometryDescriptor": {"topologyIntent": "low-poly cached procedural geometry with silhouette-first radial segmentation", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates; runtime uses native flat colors", "normalStrategy": "computed vertex normals"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "head-attachment", "localStart": [0, 0.31, -0.08], "localEnd": [0, -0.31, -0.13], "contactType": "overlapping-socket", "overlap": 0.025, "gapTolerance": 0.006, "evidenceRefs": ["full-object"]}, "dimensions": {"units": "PlayerActor head-relative", "confidence": 0.86, "width": 0.56, "height": 0.65, "depth": 0.31}, "transform": {"position": [0, 0, -0.13], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "wearable-component", "pivot": {"mode": "parent-socket", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.56, 0.65, 0.31], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wearable-equipment", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "cage-metal"}}, "material": "cage-metal", "materialLayers": ["cage-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "eye-window-rails", "kind": "ridge", "description": "Three horizontal bands and lateral dividers preserve the open eye window.", "evidenceRefs": ["full-object"]}, {"id": "weld-overlaps", "kind": "fastener", "description": "Rail junctions overlap by at least 0.025 units to avoid floating seams.", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.12, "bumpAmplitude": 0.01, "normalPattern": "reference-derived evidence; runtime simplified for phone scale", "displacementPattern": "none", "occlusionPattern": "native contact shadow at overlaps", "edgeWearPattern": "restrained edge highlight", "notes": "Identity is carried by geometry and roughness contrast, not opaque model textures."}, "evidenceRefs": ["full-object"], "details": ["eye-window-rails", "weld-overlaps"], "fidelityTier": "production-stylized", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 25, 27, 1)", "secondaryAlbedo": "rgba(66, 67, 70, 1)", "materialClass": "metal", "materialClassConfidence": 0.88, "evidenceRefs": ["full-object"]}};
  node_mask_cage_1.add(mesh_mask_cage_1);
  meshes["mask-cage"] = mesh_mask_cage_1;
  colliders["mask-cage"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.56, 0.65, 0.31], "isTrigger": false};
  destructionGroups["wearable-equipment"] ??= [];
  destructionGroups["wearable-equipment"].push(node_mask_cage_1);

  const attachment_padding_assembly_2 = {"parentId": "root", "parentSocket": "head-attachment", "localStart": [0, 0.25, -0.02], "localEnd": [0, -0.23, -0.08], "contactType": "overlapping-socket", "overlap": 0.025, "gapTolerance": 0.006, "evidenceRefs": ["full-object"]};
  const endpoint_padding_assembly_2 = makeAttachmentEndpoint(attachment_padding_assembly_2);
  const node_padding_assembly_2 = new THREE.Group();
  node_padding_assembly_2.name = "Brow cheek and jaw padding__pivot";
  node_padding_assembly_2.scale.set(1, 1, 1);
  if (endpoint_padding_assembly_2) {
    node_padding_assembly_2.position.copy(endpoint_padding_assembly_2.start);
    node_padding_assembly_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_padding_assembly_2.position.set(0.0, 0.0, -0.07);
    node_padding_assembly_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_padding_assembly_2.userData.sculptComponent = {"id": "padding-assembly", "name": "Brow cheek and jaw padding", "level": "macro", "role": "contact-padding", "importance": 0.95, "confidence": 0.91, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Separate shallow padded shells conform behind the cage and remain readable through the negative spaces.", "geometryDescriptor": {"topologyIntent": "low-poly cached procedural geometry with silhouette-first radial segmentation", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates; runtime uses native flat colors", "normalStrategy": "computed vertex normals", "profile2D": {"points": [[-0.24, 0.18], [0.24, 0.18], [0.2, -0.22], [-0.2, -0.22]], "depth": 0.13}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "head-attachment", "localStart": [0, 0.25, -0.02], "localEnd": [0, -0.23, -0.08], "contactType": "overlapping-socket", "overlap": 0.025, "gapTolerance": 0.006, "evidenceRefs": ["full-object"]}, "dimensions": {"units": "PlayerActor head-relative", "confidence": 0.86, "width": 0.48, "height": 0.48, "depth": 0.13}, "transform": {"position": [0, 0, -0.07], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "wearable-component", "pivot": {"mode": "parent-socket", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.48, 0.48, 0.13], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wearable-equipment", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "cage-metal"}}, "material": "padding", "materialLayers": ["padding"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "brow-piping", "kind": "seam", "description": "Raised piping outlines the brow pad.", "evidenceRefs": ["full-object"]}, {"id": "cheek-seams", "kind": "seam", "description": "Bilateral cheek pads retain a visible gap and stitched border.", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.12, "bumpAmplitude": 0.01, "normalPattern": "reference-derived evidence; runtime simplified for phone scale", "displacementPattern": "none", "occlusionPattern": "native contact shadow at overlaps", "edgeWearPattern": "restrained edge highlight", "notes": "Identity is carried by geometry and roughness contrast, not opaque model textures."}, "evidenceRefs": ["full-object"], "details": ["brow-piping", "cheek-seams"], "fidelityTier": "production-stylized", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 43, 45, 1)", "secondaryAlbedo": "rgba(102, 103, 105, 1)", "materialClass": "fabric", "materialClassConfidence": 0.88, "evidenceRefs": ["full-object"]}};
  node_padding_assembly_2.userData.actionProfile = {"animationRole": "wearable-component", "pivot": {"mode": "parent-socket", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.48, 0.48, 0.13], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wearable-equipment", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "cage-metal"}};
  (nodes["root"] ?? root).add(node_padding_assembly_2);
  nodes["padding-assembly"] = node_padding_assembly_2;
  const mesh_padding_assembly_2Geometry = endpoint_padding_assembly_2
    ? new THREE.CylinderGeometry(endpoint_padding_assembly_2.endRadius, endpoint_padding_assembly_2.baseRadius, endpoint_padding_assembly_2.length, 8, 4)
    : buildExtrudeGeometry({"points": [[-0.24, 0.18], [0.24, 0.18], [0.2, -0.22], [-0.2, -0.22]], "depth": 0.13});
  if (!endpoint_padding_assembly_2) {
    mesh_padding_assembly_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_padding_assembly_2 = new THREE.Mesh(
    mesh_padding_assembly_2Geometry,
    materialMap["padding"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_padding_assembly_2.name = "Brow cheek and jaw padding";
  if (endpoint_padding_assembly_2) {
    mesh_padding_assembly_2.position.copy(endpoint_padding_assembly_2.midpoint);
    mesh_padding_assembly_2.quaternion.copy(endpoint_padding_assembly_2.quaternion);
  }
  mesh_padding_assembly_2.castShadow = options.castShadow ?? true;
  mesh_padding_assembly_2.receiveShadow = options.receiveShadow ?? true;
  mesh_padding_assembly_2.userData.sculptComponent = {"id": "padding-assembly", "name": "Brow cheek and jaw padding", "level": "macro", "role": "contact-padding", "importance": 0.95, "confidence": 0.91, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Separate shallow padded shells conform behind the cage and remain readable through the negative spaces.", "geometryDescriptor": {"topologyIntent": "low-poly cached procedural geometry with silhouette-first radial segmentation", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates; runtime uses native flat colors", "normalStrategy": "computed vertex normals", "profile2D": {"points": [[-0.24, 0.18], [0.24, 0.18], [0.2, -0.22], [-0.2, -0.22]], "depth": 0.13}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "head-attachment", "localStart": [0, 0.25, -0.02], "localEnd": [0, -0.23, -0.08], "contactType": "overlapping-socket", "overlap": 0.025, "gapTolerance": 0.006, "evidenceRefs": ["full-object"]}, "dimensions": {"units": "PlayerActor head-relative", "confidence": 0.86, "width": 0.48, "height": 0.48, "depth": 0.13}, "transform": {"position": [0, 0, -0.07], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "wearable-component", "pivot": {"mode": "parent-socket", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.48, 0.48, 0.13], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wearable-equipment", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "cage-metal"}}, "material": "padding", "materialLayers": ["padding"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "brow-piping", "kind": "seam", "description": "Raised piping outlines the brow pad.", "evidenceRefs": ["full-object"]}, {"id": "cheek-seams", "kind": "seam", "description": "Bilateral cheek pads retain a visible gap and stitched border.", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.12, "bumpAmplitude": 0.01, "normalPattern": "reference-derived evidence; runtime simplified for phone scale", "displacementPattern": "none", "occlusionPattern": "native contact shadow at overlaps", "edgeWearPattern": "restrained edge highlight", "notes": "Identity is carried by geometry and roughness contrast, not opaque model textures."}, "evidenceRefs": ["full-object"], "details": ["brow-piping", "cheek-seams"], "fidelityTier": "production-stylized", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 43, 45, 1)", "secondaryAlbedo": "rgba(102, 103, 105, 1)", "materialClass": "fabric", "materialClassConfidence": 0.88, "evidenceRefs": ["full-object"]}};
  node_padding_assembly_2.add(mesh_padding_assembly_2);
  meshes["padding-assembly"] = mesh_padding_assembly_2;
  colliders["padding-assembly"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.48, 0.48, 0.13], "isTrigger": false};
  destructionGroups["wearable-equipment"] ??= [];
  destructionGroups["wearable-equipment"].push(node_padding_assembly_2);

  const attachment_eye_rails_3 = {"parentId": "mask-cage", "parentSocket": "perimeter-contact", "localStart": [-0.25, 0.12, 0], "localEnd": [0.25, -0.08, 0], "contactType": "overlapping-socket", "overlap": 0.025, "gapTolerance": 0.006, "evidenceRefs": ["full-object"]};
  const endpoint_eye_rails_3 = makeAttachmentEndpoint(attachment_eye_rails_3);
  const node_eye_rails_3 = new THREE.Group();
  node_eye_rails_3.name = "Eye-window rail group__pivot";
  node_eye_rails_3.scale.set(1, 1, 1);
  if (endpoint_eye_rails_3) {
    node_eye_rails_3.position.copy(endpoint_eye_rails_3.start);
    node_eye_rails_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eye_rails_3.position.set(0.0, 0.06, -0.17);
    node_eye_rails_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_eye_rails_3.userData.sculptComponent = {"id": "eye-rails", "name": "Eye-window rail group", "level": "meso", "role": "tube-network", "importance": 0.85, "confidence": 0.86, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Three swept rails and vertical dividers are true tubes because they define the front negative space in every view.", "geometryDescriptor": {"topologyIntent": "low-poly cached procedural geometry with silhouette-first radial segmentation", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates; runtime uses native flat colors", "normalStrategy": "computed vertex normals", "curveType": "multi-segment quadratic sweep", "radialSegments": 6, "tubeRadius": 0.018}, "parent": "mask-cage", "attachment": {"parentId": "mask-cage", "parentSocket": "perimeter-contact", "localStart": [-0.25, 0.12, 0], "localEnd": [0.25, -0.08, 0], "contactType": "overlapping-socket", "overlap": 0.025, "gapTolerance": 0.006, "evidenceRefs": ["full-object"]}, "dimensions": {"units": "PlayerActor head-relative", "confidence": 0.86, "width": 0.52, "height": 0.23, "depth": 0.08}, "transform": {"position": [0, 0.06, -0.17], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "wearable-component", "pivot": {"mode": "parent-socket", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.52, 0.23, 0.08], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wearable-equipment", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "cage-metal"}}, "material": "cage-metal", "materialLayers": ["cage-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rail-spacing", "kind": "contour", "description": "Rail spacing leaves an unobstructed central eye band.", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.12, "bumpAmplitude": 0.01, "normalPattern": "reference-derived evidence; runtime simplified for phone scale", "displacementPattern": "none", "occlusionPattern": "native contact shadow at overlaps", "edgeWearPattern": "restrained edge highlight", "notes": "Identity is carried by geometry and roughness contrast, not opaque model textures."}, "evidenceRefs": ["full-object"], "details": ["rail-spacing"], "fidelityTier": "production-stylized", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 25, 27, 1)", "secondaryAlbedo": "rgba(66, 67, 70, 1)", "materialClass": "metal", "materialClassConfidence": 0.88, "evidenceRefs": ["full-object"]}};
  node_eye_rails_3.userData.actionProfile = {"animationRole": "wearable-component", "pivot": {"mode": "parent-socket", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.52, 0.23, 0.08], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wearable-equipment", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "cage-metal"}};
  (nodes["mask-cage"] ?? root).add(node_eye_rails_3);
  nodes["eye-rails"] = node_eye_rails_3;
  const mesh_eye_rails_3Geometry = endpoint_eye_rails_3
    ? new THREE.CylinderGeometry(endpoint_eye_rails_3.endRadius, endpoint_eye_rails_3.baseRadius, endpoint_eye_rails_3.length, 8, 4)
    : buildTubeGeometry({"points": [[0.0, -0.5, 0.0], [0.0, 0.5, 0.0]], "radius": 0.05, "closed": false});
  if (!endpoint_eye_rails_3) {
    mesh_eye_rails_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_eye_rails_3 = new THREE.Mesh(
    mesh_eye_rails_3Geometry,
    materialMap["cage-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eye_rails_3.name = "Eye-window rail group";
  if (endpoint_eye_rails_3) {
    mesh_eye_rails_3.position.copy(endpoint_eye_rails_3.midpoint);
    mesh_eye_rails_3.quaternion.copy(endpoint_eye_rails_3.quaternion);
  }
  mesh_eye_rails_3.castShadow = options.castShadow ?? true;
  mesh_eye_rails_3.receiveShadow = options.receiveShadow ?? true;
  mesh_eye_rails_3.userData.sculptComponent = {"id": "eye-rails", "name": "Eye-window rail group", "level": "meso", "role": "tube-network", "importance": 0.85, "confidence": 0.86, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Three swept rails and vertical dividers are true tubes because they define the front negative space in every view.", "geometryDescriptor": {"topologyIntent": "low-poly cached procedural geometry with silhouette-first radial segmentation", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates; runtime uses native flat colors", "normalStrategy": "computed vertex normals", "curveType": "multi-segment quadratic sweep", "radialSegments": 6, "tubeRadius": 0.018}, "parent": "mask-cage", "attachment": {"parentId": "mask-cage", "parentSocket": "perimeter-contact", "localStart": [-0.25, 0.12, 0], "localEnd": [0.25, -0.08, 0], "contactType": "overlapping-socket", "overlap": 0.025, "gapTolerance": 0.006, "evidenceRefs": ["full-object"]}, "dimensions": {"units": "PlayerActor head-relative", "confidence": 0.86, "width": 0.52, "height": 0.23, "depth": 0.08}, "transform": {"position": [0, 0.06, -0.17], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "wearable-component", "pivot": {"mode": "parent-socket", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.52, 0.23, 0.08], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wearable-equipment", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "cage-metal"}}, "material": "cage-metal", "materialLayers": ["cage-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rail-spacing", "kind": "contour", "description": "Rail spacing leaves an unobstructed central eye band.", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.12, "bumpAmplitude": 0.01, "normalPattern": "reference-derived evidence; runtime simplified for phone scale", "displacementPattern": "none", "occlusionPattern": "native contact shadow at overlaps", "edgeWearPattern": "restrained edge highlight", "notes": "Identity is carried by geometry and roughness contrast, not opaque model textures."}, "evidenceRefs": ["full-object"], "details": ["rail-spacing"], "fidelityTier": "production-stylized", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 25, 27, 1)", "secondaryAlbedo": "rgba(66, 67, 70, 1)", "materialClass": "metal", "materialClassConfidence": 0.88, "evidenceRefs": ["full-object"]}};
  node_eye_rails_3.add(mesh_eye_rails_3);
  meshes["eye-rails"] = mesh_eye_rails_3;
  colliders["eye-rails"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.52, 0.23, 0.08], "isTrigger": false};
  destructionGroups["wearable-equipment"] ??= [];
  destructionGroups["wearable-equipment"].push(node_eye_rails_3);

  const attachment_crown_rails_4 = {"parentId": "mask-cage", "parentSocket": "perimeter-contact", "localStart": [-0.18, 0.28, 0], "localEnd": [-0.22, 0.05, 0.12], "contactType": "overlapping-socket", "overlap": 0.025, "gapTolerance": 0.006, "evidenceRefs": ["full-object"]};
  const endpoint_crown_rails_4 = makeAttachmentEndpoint(attachment_crown_rails_4);
  const node_crown_rails_4 = new THREE.Group();
  node_crown_rails_4.name = "Paired crown rails__pivot";
  node_crown_rails_4.scale.set(1, 1, 1);
  if (endpoint_crown_rails_4) {
    node_crown_rails_4.position.copy(endpoint_crown_rails_4.start);
    node_crown_rails_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_crown_rails_4.position.set(0.0, 0.17, -0.08);
    node_crown_rails_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_crown_rails_4.userData.sculptComponent = {"id": "crown-rails", "name": "Paired crown rails", "level": "meso", "role": "tube-network", "importance": 0.85, "confidence": 0.86, "primitive": "curve-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Each crown rail visibly bends through depth from the brow toward the rear head envelope.", "geometryDescriptor": {"topologyIntent": "low-poly cached procedural geometry with silhouette-first radial segmentation", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates; runtime uses native flat colors", "normalStrategy": "computed vertex normals", "curveType": "cubic-bezier-3d", "radialSegments": 6, "tubeRadius": 0.017}, "parent": "mask-cage", "attachment": {"parentId": "mask-cage", "parentSocket": "perimeter-contact", "localStart": [-0.18, 0.28, 0], "localEnd": [-0.22, 0.05, 0.12], "contactType": "overlapping-socket", "overlap": 0.025, "gapTolerance": 0.006, "evidenceRefs": ["full-object"]}, "dimensions": {"units": "PlayerActor head-relative", "confidence": 0.86, "width": 0.39, "height": 0.31, "depth": 0.19}, "transform": {"position": [0, 0.17, -0.08], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "wearable-component", "pivot": {"mode": "parent-socket", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.39, 0.31, 0.19], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wearable-equipment", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "cage-metal"}}, "material": "cage-metal", "materialLayers": ["cage-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "crown-rails", "kind": "ridge", "description": "Mirrored crown tubes preserve the high arched silhouette.", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.12, "bumpAmplitude": 0.01, "normalPattern": "reference-derived evidence; runtime simplified for phone scale", "displacementPattern": "none", "occlusionPattern": "native contact shadow at overlaps", "edgeWearPattern": "restrained edge highlight", "notes": "Identity is carried by geometry and roughness contrast, not opaque model textures."}, "evidenceRefs": ["full-object"], "details": ["crown-rails"], "fidelityTier": "production-stylized", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 25, 27, 1)", "secondaryAlbedo": "rgba(66, 67, 70, 1)", "materialClass": "metal", "materialClassConfidence": 0.88, "evidenceRefs": ["full-object"]}};
  node_crown_rails_4.userData.actionProfile = {"animationRole": "wearable-component", "pivot": {"mode": "parent-socket", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.39, 0.31, 0.19], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wearable-equipment", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "cage-metal"}};
  (nodes["mask-cage"] ?? root).add(node_crown_rails_4);
  nodes["crown-rails"] = node_crown_rails_4;
  const mesh_crown_rails_4Geometry = endpoint_crown_rails_4
    ? new THREE.CylinderGeometry(endpoint_crown_rails_4.endRadius, endpoint_crown_rails_4.baseRadius, endpoint_crown_rails_4.length, 8, 4)
    : buildCurveSweepGeometry({"spine": [[-0.5, -0.4, 0.0], [-0.1, 0.1, 0.0], [0.3, 0.2, 0.0], [0.6, -0.1, 0.0]], "crossSection": {"points": [[-0.04, -0.02], [0.04, -0.02], [0.04, 0.02], [-0.04, 0.02]]}, "closed": false});
  if (!endpoint_crown_rails_4) {
    mesh_crown_rails_4Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_crown_rails_4 = new THREE.Mesh(
    mesh_crown_rails_4Geometry,
    materialMap["cage-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_crown_rails_4.name = "Paired crown rails";
  if (endpoint_crown_rails_4) {
    mesh_crown_rails_4.position.copy(endpoint_crown_rails_4.midpoint);
    mesh_crown_rails_4.quaternion.copy(endpoint_crown_rails_4.quaternion);
  }
  mesh_crown_rails_4.castShadow = options.castShadow ?? true;
  mesh_crown_rails_4.receiveShadow = options.receiveShadow ?? true;
  mesh_crown_rails_4.userData.sculptComponent = {"id": "crown-rails", "name": "Paired crown rails", "level": "meso", "role": "tube-network", "importance": 0.85, "confidence": 0.86, "primitive": "curve-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Each crown rail visibly bends through depth from the brow toward the rear head envelope.", "geometryDescriptor": {"topologyIntent": "low-poly cached procedural geometry with silhouette-first radial segmentation", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates; runtime uses native flat colors", "normalStrategy": "computed vertex normals", "curveType": "cubic-bezier-3d", "radialSegments": 6, "tubeRadius": 0.017}, "parent": "mask-cage", "attachment": {"parentId": "mask-cage", "parentSocket": "perimeter-contact", "localStart": [-0.18, 0.28, 0], "localEnd": [-0.22, 0.05, 0.12], "contactType": "overlapping-socket", "overlap": 0.025, "gapTolerance": 0.006, "evidenceRefs": ["full-object"]}, "dimensions": {"units": "PlayerActor head-relative", "confidence": 0.86, "width": 0.39, "height": 0.31, "depth": 0.19}, "transform": {"position": [0, 0.17, -0.08], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "wearable-component", "pivot": {"mode": "parent-socket", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.39, 0.31, 0.19], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wearable-equipment", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "cage-metal"}}, "material": "cage-metal", "materialLayers": ["cage-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "crown-rails", "kind": "ridge", "description": "Mirrored crown tubes preserve the high arched silhouette.", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.12, "bumpAmplitude": 0.01, "normalPattern": "reference-derived evidence; runtime simplified for phone scale", "displacementPattern": "none", "occlusionPattern": "native contact shadow at overlaps", "edgeWearPattern": "restrained edge highlight", "notes": "Identity is carried by geometry and roughness contrast, not opaque model textures."}, "evidenceRefs": ["full-object"], "details": ["crown-rails"], "fidelityTier": "production-stylized", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 25, 27, 1)", "secondaryAlbedo": "rgba(66, 67, 70, 1)", "materialClass": "metal", "materialClassConfidence": 0.88, "evidenceRefs": ["full-object"]}};
  node_crown_rails_4.add(mesh_crown_rails_4);
  meshes["crown-rails"] = mesh_crown_rails_4;
  colliders["crown-rails"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.39, 0.31, 0.19], "isTrigger": false};
  destructionGroups["wearable-equipment"] ??= [];
  destructionGroups["wearable-equipment"].push(node_crown_rails_4);

  const attachment_chin_loops_5 = {"parentId": "mask-cage", "parentSocket": "lower-perimeter", "localStart": [-0.16, -0.2, 0], "localEnd": [0.16, -0.33, 0], "contactType": "overlapping-socket", "overlap": 0.025, "gapTolerance": 0.006, "evidenceRefs": ["full-object"]};
  const endpoint_chin_loops_5 = makeAttachmentEndpoint(attachment_chin_loops_5);
  const node_chin_loops_5 = new THREE.Group();
  node_chin_loops_5.name = "Nested chin loops__pivot";
  node_chin_loops_5.scale.set(1, 1, 1);
  if (endpoint_chin_loops_5) {
    node_chin_loops_5.position.copy(endpoint_chin_loops_5.start);
    node_chin_loops_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_chin_loops_5.position.set(0.0, -0.24, -0.16);
    node_chin_loops_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_chin_loops_5.userData.sculptComponent = {"id": "chin-loops", "name": "Nested chin loops", "level": "meso", "role": "tube-network", "importance": 0.98, "confidence": 0.97, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Two nested elliptical tubes extend below the jaw cup and carry the unmistakable lower silhouette.", "geometryDescriptor": {"topologyIntent": "low-poly cached procedural geometry with silhouette-first radial segmentation", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates; runtime uses native flat colors", "normalStrategy": "computed vertex normals"}, "parent": "mask-cage", "attachment": {"parentId": "mask-cage", "parentSocket": "lower-perimeter", "localStart": [-0.16, -0.2, 0], "localEnd": [0.16, -0.33, 0], "contactType": "overlapping-socket", "overlap": 0.025, "gapTolerance": 0.006, "evidenceRefs": ["full-object"]}, "dimensions": {"units": "PlayerActor head-relative", "confidence": 0.86, "width": 0.34, "height": 0.22, "depth": 0.08}, "transform": {"position": [0, -0.24, -0.16], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "wearable-component", "pivot": {"mode": "parent-socket", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.34, 0.22, 0.08], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wearable-equipment", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "cage-metal"}}, "material": "cage-metal", "materialLayers": ["cage-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "twin-chin-loops", "kind": "ridge", "description": "Outer and inner loops remain separately visible.", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.12, "bumpAmplitude": 0.01, "normalPattern": "reference-derived evidence; runtime simplified for phone scale", "displacementPattern": "none", "occlusionPattern": "native contact shadow at overlaps", "edgeWearPattern": "restrained edge highlight", "notes": "Identity is carried by geometry and roughness contrast, not opaque model textures."}, "evidenceRefs": ["full-object"], "details": ["twin-chin-loops"], "fidelityTier": "production-stylized", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 25, 27, 1)", "secondaryAlbedo": "rgba(66, 67, 70, 1)", "materialClass": "metal", "materialClassConfidence": 0.88, "evidenceRefs": ["full-object"]}};
  node_chin_loops_5.userData.actionProfile = {"animationRole": "wearable-component", "pivot": {"mode": "parent-socket", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.34, 0.22, 0.08], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wearable-equipment", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "cage-metal"}};
  (nodes["mask-cage"] ?? root).add(node_chin_loops_5);
  nodes["chin-loops"] = node_chin_loops_5;
  const mesh_chin_loops_5Geometry = endpoint_chin_loops_5
    ? new THREE.CylinderGeometry(endpoint_chin_loops_5.endRadius, endpoint_chin_loops_5.baseRadius, endpoint_chin_loops_5.length, 8, 4)
    : new THREE.TorusGeometry(0.45, 0.08, 8, 16);
  if (!endpoint_chin_loops_5) {
    mesh_chin_loops_5Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_chin_loops_5 = new THREE.Mesh(
    mesh_chin_loops_5Geometry,
    materialMap["cage-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chin_loops_5.name = "Nested chin loops";
  if (endpoint_chin_loops_5) {
    mesh_chin_loops_5.position.copy(endpoint_chin_loops_5.midpoint);
    mesh_chin_loops_5.quaternion.copy(endpoint_chin_loops_5.quaternion);
  }
  mesh_chin_loops_5.castShadow = options.castShadow ?? true;
  mesh_chin_loops_5.receiveShadow = options.receiveShadow ?? true;
  mesh_chin_loops_5.userData.sculptComponent = {"id": "chin-loops", "name": "Nested chin loops", "level": "meso", "role": "tube-network", "importance": 0.98, "confidence": 0.97, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Two nested elliptical tubes extend below the jaw cup and carry the unmistakable lower silhouette.", "geometryDescriptor": {"topologyIntent": "low-poly cached procedural geometry with silhouette-first radial segmentation", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates; runtime uses native flat colors", "normalStrategy": "computed vertex normals"}, "parent": "mask-cage", "attachment": {"parentId": "mask-cage", "parentSocket": "lower-perimeter", "localStart": [-0.16, -0.2, 0], "localEnd": [0.16, -0.33, 0], "contactType": "overlapping-socket", "overlap": 0.025, "gapTolerance": 0.006, "evidenceRefs": ["full-object"]}, "dimensions": {"units": "PlayerActor head-relative", "confidence": 0.86, "width": 0.34, "height": 0.22, "depth": 0.08}, "transform": {"position": [0, -0.24, -0.16], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "wearable-component", "pivot": {"mode": "parent-socket", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.34, 0.22, 0.08], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wearable-equipment", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "cage-metal"}}, "material": "cage-metal", "materialLayers": ["cage-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "twin-chin-loops", "kind": "ridge", "description": "Outer and inner loops remain separately visible.", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.12, "bumpAmplitude": 0.01, "normalPattern": "reference-derived evidence; runtime simplified for phone scale", "displacementPattern": "none", "occlusionPattern": "native contact shadow at overlaps", "edgeWearPattern": "restrained edge highlight", "notes": "Identity is carried by geometry and roughness contrast, not opaque model textures."}, "evidenceRefs": ["full-object"], "details": ["twin-chin-loops"], "fidelityTier": "production-stylized", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 25, 27, 1)", "secondaryAlbedo": "rgba(66, 67, 70, 1)", "materialClass": "metal", "materialClassConfidence": 0.88, "evidenceRefs": ["full-object"]}};
  node_chin_loops_5.add(mesh_chin_loops_5);
  meshes["chin-loops"] = mesh_chin_loops_5;
  colliders["chin-loops"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.34, 0.22, 0.08], "isTrigger": false};
  destructionGroups["wearable-equipment"] ??= [];
  destructionGroups["wearable-equipment"].push(node_chin_loops_5);

  const attachment_harness_6 = {"parentId": "root", "parentSocket": "head-attachment", "localStart": [-0.24, 0.17, 0.04], "localEnd": [0.24, -0.04, 0.13], "contactType": "overlapping-socket", "overlap": 0.025, "gapTolerance": 0.006, "evidenceRefs": ["full-object"]};
  const endpoint_harness_6 = makeAttachmentEndpoint(attachment_harness_6);
  const node_harness_6 = new THREE.Group();
  node_harness_6.name = "Rear woven harness__pivot";
  node_harness_6.scale.set(1, 1, 1);
  if (endpoint_harness_6) {
    node_harness_6.position.copy(endpoint_harness_6.start);
    node_harness_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_harness_6.position.set(0.0, 0.03, 0.11);
    node_harness_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_harness_6.userData.sculptComponent = {"id": "harness", "name": "Rear woven harness", "level": "meso", "role": "strap-assembly", "importance": 0.72, "confidence": 0.7, "primitive": "curve-sweep", "topologyClass": "conforming-shell", "topologyRationale": "Thin strap ribbons follow the sides and crown of the head attachment envelope.", "geometryDescriptor": {"topologyIntent": "low-poly cached procedural geometry with silhouette-first radial segmentation", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates; runtime uses native flat colors", "normalStrategy": "computed vertex normals", "curveType": "ribbon sweep", "radialSegments": 4, "tubeRadius": 0.012}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "head-attachment", "localStart": [-0.24, 0.17, 0.04], "localEnd": [0.24, -0.04, 0.13], "contactType": "overlapping-socket", "overlap": 0.025, "gapTolerance": 0.006, "evidenceRefs": ["full-object"]}, "dimensions": {"units": "PlayerActor head-relative", "confidence": 0.86, "width": 0.48, "height": 0.38, "depth": 0.09}, "transform": {"position": [0, 0.03, 0.11], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "wearable-component", "pivot": {"mode": "parent-socket", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.48, 0.38, 0.09], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wearable-equipment", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "cage-metal"}}, "material": "harness-fabric", "materialLayers": ["harness-fabric"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "strap-routing", "kind": "linework", "description": "Conservative bilateral crown and side routing exposes its inferred status.", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.12, "bumpAmplitude": 0.01, "normalPattern": "reference-derived evidence; runtime simplified for phone scale", "displacementPattern": "none", "occlusionPattern": "native contact shadow at overlaps", "edgeWearPattern": "restrained edge highlight", "notes": "Identity is carried by geometry and roughness contrast, not opaque model textures."}, "evidenceRefs": ["full-object"], "details": ["strap-routing"], "fidelityTier": "production-stylized", "colorMaterialRecipe": {"dominantAlbedo": "rgba(8, 8, 9, 1)", "secondaryAlbedo": "rgba(41, 43, 45, 1)", "materialClass": "fabric", "materialClassConfidence": 0.88, "evidenceRefs": ["full-object"]}};
  node_harness_6.userData.actionProfile = {"animationRole": "wearable-component", "pivot": {"mode": "parent-socket", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.48, 0.38, 0.09], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wearable-equipment", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "cage-metal"}};
  (nodes["root"] ?? root).add(node_harness_6);
  nodes["harness"] = node_harness_6;
  const mesh_harness_6Geometry = endpoint_harness_6
    ? new THREE.CylinderGeometry(endpoint_harness_6.endRadius, endpoint_harness_6.baseRadius, endpoint_harness_6.length, 8, 4)
    : buildCurveSweepGeometry({"spine": [[-0.5, -0.4, 0.0], [-0.1, 0.1, 0.0], [0.3, 0.2, 0.0], [0.6, -0.1, 0.0]], "crossSection": {"points": [[-0.04, -0.02], [0.04, -0.02], [0.04, 0.02], [-0.04, 0.02]]}, "closed": false});
  if (!endpoint_harness_6) {
    mesh_harness_6Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_harness_6 = new THREE.Mesh(
    mesh_harness_6Geometry,
    materialMap["harness-fabric"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_harness_6.name = "Rear woven harness";
  if (endpoint_harness_6) {
    mesh_harness_6.position.copy(endpoint_harness_6.midpoint);
    mesh_harness_6.quaternion.copy(endpoint_harness_6.quaternion);
  }
  mesh_harness_6.castShadow = options.castShadow ?? true;
  mesh_harness_6.receiveShadow = options.receiveShadow ?? true;
  mesh_harness_6.userData.sculptComponent = {"id": "harness", "name": "Rear woven harness", "level": "meso", "role": "strap-assembly", "importance": 0.72, "confidence": 0.7, "primitive": "curve-sweep", "topologyClass": "conforming-shell", "topologyRationale": "Thin strap ribbons follow the sides and crown of the head attachment envelope.", "geometryDescriptor": {"topologyIntent": "low-poly cached procedural geometry with silhouette-first radial segmentation", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates; runtime uses native flat colors", "normalStrategy": "computed vertex normals", "curveType": "ribbon sweep", "radialSegments": 4, "tubeRadius": 0.012}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "head-attachment", "localStart": [-0.24, 0.17, 0.04], "localEnd": [0.24, -0.04, 0.13], "contactType": "overlapping-socket", "overlap": 0.025, "gapTolerance": 0.006, "evidenceRefs": ["full-object"]}, "dimensions": {"units": "PlayerActor head-relative", "confidence": 0.86, "width": 0.48, "height": 0.38, "depth": 0.09}, "transform": {"position": [0, 0.03, 0.11], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "wearable-component", "pivot": {"mode": "parent-socket", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.48, 0.38, 0.09], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wearable-equipment", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "cage-metal"}}, "material": "harness-fabric", "materialLayers": ["harness-fabric"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "strap-routing", "kind": "linework", "description": "Conservative bilateral crown and side routing exposes its inferred status.", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.12, "bumpAmplitude": 0.01, "normalPattern": "reference-derived evidence; runtime simplified for phone scale", "displacementPattern": "none", "occlusionPattern": "native contact shadow at overlaps", "edgeWearPattern": "restrained edge highlight", "notes": "Identity is carried by geometry and roughness contrast, not opaque model textures."}, "evidenceRefs": ["full-object"], "details": ["strap-routing"], "fidelityTier": "production-stylized", "colorMaterialRecipe": {"dominantAlbedo": "rgba(8, 8, 9, 1)", "secondaryAlbedo": "rgba(41, 43, 45, 1)", "materialClass": "fabric", "materialClassConfidence": 0.88, "evidenceRefs": ["full-object"]}};
  node_harness_6.add(mesh_harness_6);
  meshes["harness"] = mesh_harness_6;
  colliders["harness"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.48, 0.38, 0.09], "isTrigger": false};
  destructionGroups["wearable-equipment"] ??= [];
  destructionGroups["wearable-equipment"].push(node_harness_6);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createMBDCatcherMaskLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "MBD Catcher Mask look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = ["Key light: large soft neutral source from camera upper-left, intensity reference 1.0.", "Fill light: cool frontal fill at roughly 0.35 of key intensity; retain readable near-black rails.", "Rim/environment light: broad pale studio environment from rear-right at 0.45, with soft contact shadow under the mask.", "Exposure and tone mapping: neutral exposure 1.0 with ACES-filmic preview only; production inherits the game renderer.", "Background: light gray reference sweep; also review against bright sky, dark crowd, grass, dirt, and stadium lights."];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createMBDCatcherMaskEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameMBDCatcherMaskCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createMBDCatcherMaskPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureMBDCatcherMaskRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createMBDCatcherMaskInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
