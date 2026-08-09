// Built as a self-contained optional browser module. Bundling its Three.js
// helpers here prevents BVH-only exports from inflating the eager game vendor.
export { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
