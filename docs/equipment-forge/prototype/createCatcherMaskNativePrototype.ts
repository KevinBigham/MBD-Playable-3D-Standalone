import * as THREE from 'three';

const Y_AXIS = new THREE.Vector3(0, 1, 0);

function baked(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  geometry.applyMatrix4(matrix);
  return geometry;
}

function transform(
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
}

function mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const sources = geometries.map((geometry) => {
    const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    source.computeVertexNormals();
    geometry.dispose();
    return source;
  });
  const vertexCount = sources.reduce((total, source) => total + source.attributes.position.count, 0);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  let offset = 0;
  for (const source of sources) {
    positions.set(source.attributes.position.array as Float32Array, offset * 3);
    normals.set(source.attributes.normal.array as Float32Array, offset * 3);
    offset += source.attributes.position.count;
    source.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function cylinderBetween(
  start: [number, number, number],
  end: [number, number, number],
  radius: number,
  radialSegments = 6,
): THREE.BufferGeometry {
  const a = new THREE.Vector3(...start);
  const b = new THREE.Vector3(...end);
  const delta = b.clone().sub(a);
  const midpoint = a.clone().add(b).multiplyScalar(0.5);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, delta.clone().normalize());
  return baked(
    new THREE.CylinderGeometry(radius, radius, delta.length(), radialSegments, 1, false),
    new THREE.Matrix4().compose(midpoint, quaternion, new THREE.Vector3(1, 1, 1)),
  );
}

function tube(
  points: [number, number, number][],
  radius: number,
  closed = false,
  tubularSegments = Math.max(10, points.length * 4),
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(
    points.map((point) => new THREE.Vector3(...point)),
    closed,
    'centripetal',
  );
  return new THREE.TubeGeometry(curve, tubularSegments, radius, 5, closed);
}

function cageGeometry(): THREE.BufferGeometry {
  const rail = 0.018;
  const pieces: THREE.BufferGeometry[] = [];

  pieces.push(tube([
    [0, 0.34, 0], [.17, .30, .015], [.27, .19, .025], [.285, .02, .035],
    [.245, -.18, .045], [.15, -.31, .05], [0, -.35, .052], [-.15, -.31, .05],
    [-.245, -.18, .045], [-.285, .02, .035], [-.27, .19, .025], [-.17, .30, .015],
  ], rail, true, 32));

  for (const [y, z, bow] of [[.15, .09, .018], [.055, .12, .025], [-.055, .125, .02]] as const) {
    pieces.push(tube([
      [-.27, y, z - .04], [-.15, y + bow, z], [0, y + bow * 1.25, z + .02],
      [.15, y + bow, z], [.27, y, z - .04],
    ], rail, false, 12));
  }

  pieces.push(tube([[-.205, .29, .012], [-.19, .22, .065], [-.18, .13, .105], [-.17, .04, .125]], rail, false, 10));
  pieces.push(tube([[.205, .29, .012], [.19, .22, .065], [.18, .13, .105], [.17, .04, .125]], rail, false, 10));
  pieces.push(tube([[-.24, .17, .065], [-.22, .04, .12], [-.21, -.105, .10], [-.17, -.22, .072]], rail, false, 12));
  pieces.push(tube([[.24, .17, .065], [.22, .04, .12], [.21, -.105, .10], [.17, -.22, .072]], rail, false, 12));

  pieces.push(tube([[-.17, .29, -.005], [-.13, .38, -.055], [-.07, .43, -.115]], rail, false, 9));
  pieces.push(tube([[.17, .29, -.005], [.13, .38, -.055], [.07, .43, -.115]], rail, false, 9));
  pieces.push(cylinderBetween([-.07, .43, -.115], [.07, .43, -.115], rail));

  pieces.push(tube([[-.18, -.205, .055], [-.20, -.29, .09], [-.13, -.38, .10], [0, -.42, .105], [.13, -.38, .10], [.20, -.29, .09], [.18, -.205, .055]], rail, false, 18));
  pieces.push(tube([[-.13, -.235, .08], [-.14, -.30, .12], [-.09, -.35, .135], [0, -.37, .14], [.09, -.35, .135], [.14, -.30, .12], [.13, -.235, .08]], rail * .88, false, 16));

  return mergeGeometries(pieces);
}

function paddingGeometry(): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  pieces.push(baked(new THREE.CapsuleGeometry(.047, .30, 3, 8), transform([0, .245, -.012], [0, 0, Math.PI / 2], [1, 1, .72])));
  pieces.push(baked(new THREE.CapsuleGeometry(.052, .19, 3, 8), transform([-.185, -.02, -.005], [0, 0, -.17], [1, 1, .70])));
  pieces.push(baked(new THREE.CapsuleGeometry(.052, .19, 3, 8), transform([.185, -.02, -.005], [0, 0, .17], [1, 1, .70])));
  pieces.push(baked(new THREE.CapsuleGeometry(.048, .18, 3, 8), transform([0, -.245, .015], [0, 0, Math.PI / 2], [1, 1, .72])));
  return mergeGeometries(pieces);
}

function pipingGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    tube([[-.20, .285, .028], [0, .31, .035], [.20, .285, .028]], .009, false, 12),
    tube([[-.23, .08, .03], [-.20, -.02, .045], [-.17, -.13, .04]], .008, false, 9),
    tube([[.23, .08, .03], [.20, -.02, .045], [.17, -.13, .04]], .008, false, 9),
  ]);
}

function harnessGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    tube([[-.23, .19, -.07], [-.30, .12, -.14], [-.28, -.02, -.18], [-.22, -.12, -.16]], .021, false, 12),
    tube([[.23, .19, -.07], [.30, .12, -.14], [.28, -.02, -.18], [.22, -.12, -.16]], .021, false, 12),
    tube([[-.15, .31, -.08], [0, .41, -.19], [.15, .31, -.08]], .018, false, 12),
  ]);
}

function makeMesh(geometry: THREE.BufferGeometry, material: THREE.Material, name: string): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createCatcherMaskNativePrototype(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'MBD catcher mask native prototype';
  group.scale.set(1.10, .90, 1);

  const cageMaterial = new THREE.MeshStandardMaterial({ color: 0x343c43, roughness: .30, metalness: .55 });
  const padMaterial = new THREE.MeshStandardMaterial({ color: 0x29384b, roughness: .70, metalness: 0 });
  const pipeMaterial = new THREE.MeshStandardMaterial({ color: 0x0b0e11, roughness: .62, metalness: .12 });
  const harnessMaterial = new THREE.MeshStandardMaterial({ color: 0x12171c, roughness: .86, metalness: 0 });

  const cage = makeMesh(cageGeometry(), cageMaterial, 'cage-and-rails');
  const padding = makeMesh(paddingGeometry(), padMaterial, 'contact-padding');
  const piping = makeMesh(pipingGeometry(), pipeMaterial, 'pad-piping');
  const harness = makeMesh(harnessGeometry(), harnessMaterial, 'rear-harness');
  const maskCageNode = new THREE.Group();
  maskCageNode.name = 'mask-cage';
  const paddingNode = new THREE.Group();
  paddingNode.name = 'padding-assembly';
  const eyeRailsNode = new THREE.Group();
  eyeRailsNode.name = 'eye-rails';
  const crownRailsNode = new THREE.Group();
  crownRailsNode.name = 'crown-rails';
  const chinLoopsNode = new THREE.Group();
  chinLoopsNode.name = 'chin-loops';
  const harnessNode = new THREE.Group();
  harnessNode.name = 'harness';
  maskCageNode.add(cage, eyeRailsNode, crownRailsNode, chinLoopsNode);
  paddingNode.add(padding, piping);
  harnessNode.add(harness);
  group.add(maskCageNode, paddingNode, harnessNode);

  const meshes: Record<string, THREE.Mesh> = { cage, padding, piping, harness };
  group.userData.sculptRuntime = {
    nodes: {
      root: group,
      'mask-cage': maskCageNode,
      'padding-assembly': paddingNode,
      'eye-rails': eyeRailsNode,
      'crown-rails': crownRailsNode,
      'chin-loops': chinLoopsNode,
      harness: harnessNode,
    },
    meshes,
    sockets: { 'head-attachment': group },
    colliders: {},
    destructionGroups: {},
  };
  group.userData.prototypeContract = {
    source: 'docs/equipment-forge/catcher-mask-sculpt-spec.json',
    productionTranslation: 'Merge these four material groups into cached PlayerActor equipment geometry.',
    allocationsPerFrame: 0,
  };
  return group;
}
