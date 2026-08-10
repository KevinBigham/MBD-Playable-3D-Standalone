import * as THREE from 'three';

export interface TwoBoneChain {
  shoulder: THREE.Object3D;
  elbow: THREE.Object3D;
  wrist: THREE.Object3D;
  upperLength: number;
  lowerLength: number;
}

export interface TwoBoneIKScratch {
  direction: THREE.Vector3;
  poleDirection: THREE.Vector3;
  upperDirection: THREE.Vector3;
  lowerDirection: THREE.Vector3;
  elbowPosition: THREE.Vector3;
  parentQuaternion: THREE.Quaternion;
}

export function createTwoBoneIKScratch(): TwoBoneIKScratch {
  return {
    direction: new THREE.Vector3(),
    poleDirection: new THREE.Vector3(),
    upperDirection: new THREE.Vector3(),
    lowerDirection: new THREE.Vector3(),
    elbowPosition: new THREE.Vector3(),
    parentQuaternion: new THREE.Quaternion(),
  };
}

const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Solves a shoulder/elbow/wrist chain in the shoulder parent's local space.
 * The actor's limb meshes point down local -Y, matching `DOWN` above.
 */
export function solveTwoBoneIK(
  chain: TwoBoneChain,
  targetPosition: THREE.Vector3,
  targetQuaternion: THREE.Quaternion,
  polePoint: THREE.Vector3,
  fallbackSide: number,
  scratch: TwoBoneIKScratch,
): boolean {
  const { shoulder, elbow, wrist, upperLength, lowerLength } = chain;
  const origin = shoulder.position;
  const direction = scratch.direction.copy(targetPosition).sub(origin);
  const rawDistance = direction.length();
  const minReach = Math.abs(upperLength - lowerLength) + 1e-4;
  const maxReach = (upperLength + lowerLength) * 0.985;
  const distance = THREE.MathUtils.clamp(rawDistance, minReach, maxReach);
  if (rawDistance < 1e-6) direction.set(fallbackSide || 1, -0.1, 0.1);
  direction.normalize();

  const poleDirection = scratch.poleDirection.copy(polePoint).sub(origin);
  poleDirection.addScaledVector(direction, -poleDirection.dot(direction));
  if (poleDirection.lengthSq() < 1e-8) {
    poleDirection.set(fallbackSide || 1, 0.25, -0.2);
    poleDirection.addScaledVector(direction, -poleDirection.dot(direction));
  }
  poleDirection.normalize();

  const along =
    (upperLength * upperLength - lowerLength * lowerLength + distance * distance) /
    (2 * distance);
  const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  const elbowPosition = scratch.elbowPosition
    .copy(origin)
    .addScaledVector(direction, along)
    .addScaledVector(poleDirection, height);

  const upperDirection = scratch.upperDirection.copy(elbowPosition).sub(origin).normalize();
  shoulder.quaternion.setFromUnitVectors(DOWN, upperDirection).normalize();

  const lowerDirection = scratch.lowerDirection.copy(targetPosition).sub(elbowPosition).normalize();
  lowerDirection.applyQuaternion(scratch.parentQuaternion.copy(shoulder.quaternion).invert());
  elbow.quaternion.setFromUnitVectors(DOWN, lowerDirection).normalize();

  scratch.parentQuaternion.copy(shoulder.quaternion).multiply(elbow.quaternion).normalize();
  wrist.quaternion
    .copy(scratch.parentQuaternion)
    .invert()
    .multiply(targetQuaternion)
    .normalize();

  return rawDistance >= minReach && rawDistance <= maxReach;
}
