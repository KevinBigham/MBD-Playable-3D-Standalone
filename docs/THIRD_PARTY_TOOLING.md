# Third-party presentation tooling

This file records exact pins, licenses, runtime boundaries, native contracts,
benchmark decisions, update paths, and removal paths for the 3D presentation
work. None of these tools may enter authoritative baseball simulation.

| Repository/tool | Exact pin | License | Status | Boundary |
| --- | --- | --- | --- | --- |
| [Theatre.js](https://github.com/theatre-js/theatre) | `@theatre/core@0.7.2`, `@theatre/studio@0.7.2` | Apache-2.0 / AGPL-3.0-only | Accepted, development-only | `tools/broadcast-studio`; exports `mbd.broadcast-sequence` JSON |
| [img2threejs](https://github.com/img2threejs/img2threejs) | commit `d6673386f89673a58736f8d398dd16ece67874f5` | Apache-2.0 | Accepted, development-only | Local Codex skill; prototypes translated into `src/render/actors.ts` |
| [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing) | benchmarked `6.39.4` | Zlib | Rejected and uninstalled | Evidence only; `NativeRenderPipeline` stays direct |
| [three.quarks](https://github.com/Alchemist0823/three.quarks) | `0.17.1` with `three@0.182.0` | MIT | Accepted as isolated lab; runtime rejected | `tools/vfx-lab`; informs `MbdVfxPresetV1` |
| [camera-controls](https://github.com/yomotsu/camera-controls) | `3.1.2` | MIT | Accepted, replay-only runtime | Lazy Free Cam module after replay freezes play |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | `0.9.14` | MIT | Accepted, replay-only runtime | Self-contained local lazy adapter; five static camera proxies |
| [CMU Motion Capture Database / una-dinosauria mirror](https://github.com/una-dinosauria/cmu-mocap) | commit `09a07f54f3bbb58797325f009282d0b2048a2871`; `124_07.bvh` SHA-256 `fe848034a77cac57ff49a77e9a57d2af3d714f549ced078b128e458910666ba4`; `124_01.bvh` SHA-256 `eee88ea11954d3448e13c847a403ab9a88f264d575c21427f61e722bb0d3cd58` | CMU database usage terms | Accepted, offline source only | Batting frames 264–425 and pitching frames 160–540 bake to native numeric modules; raw BVHs never ship |

## CMU batting-motion bake

The pin above is parsed only by an explicitly invoked development command:

```bash
npm run mocap:bake:batting -- --input /absolute/path/to/124_07.bvh
```

The command fails closed on byte length, SHA-256, frame count, or frame-time
drift. It creates 17 samples from stance to contact and 17 from contact to
finish, sharing the exact `0.425` contact sample for 33 total. Runtime has no BVH
request, loader, mixer, skinned mesh, or new dependency. Source fingers/thumbs
are deliberately ignored; original low-poly hands and bat-socket IK own the grip.

## CMU pitching-motion bake

Pitching uses the same explicit development-only boundary, but its source is
subject 124 trial 01 at `data/124/124_01.bvh`. The pinned mirror commit is
`09a07f54f3bbb58797325f009282d0b2048a2871`; the accepted input is exactly
491,121 bytes with SHA-256
`eee88ea11954d3448e13c847a403ab9a88f264d575c21427f61e722bb0d3cd58`, 644
frames, and frame time `0.0083333`. Frames 160–540 are sampled into 33 compact
poses; source frame 448 is retained at presentation release phase `0.76`.

```bash
npx tsx scripts/mocap/bake-pitching-motion.ts --input /absolute/path/to/124_01.bvh
```

The command fails closed on all of those source facts and writes only
`src/render/pitching-motion.generated.ts`. No raw BVH is committed, placed in
`public`, requested by the browser, or emitted to `dist`; runtime has no BVH
loader, mixer, skinned mesh, imported character, or additional dependency. The
generated body curve is mirrored natively for left-arm deliveries, while native
two-bone IK aligns the named hand socket to the pre-existing authoritative ball
release. It changes neither gameplay/physics/RNG nor save or replay contracts.

## Theatre.js Broadcast Studio

The Studio and Core packages live under `tools/broadcast-studio` with their own
package and lockfile. The tool stages Anchor Yard, a deterministic actor/ball
fixture, anchors, camera, and native shot data. Export writes only the small
strict `mbd.broadcast-sequence` schema to `broadcast-staging`; validation is
fail-closed and promotion is explicit.

Production imports no Theatre module. This is especially important for Studio's
AGPL-3.0-only license: Studio is a local authoring program, not a distributed
piece of the game bundle. Core is also kept out because runtime playback needs
only native interpolation.

```bash
npm install --prefix tools/broadcast-studio
npm run replay:studio:typecheck
npm run replay:studio:test
npm run replay:studio:build
npm run replay:export
npm run replay:validate
npm run replay:promote
```

To update, change both exact Theatre versions together, reinstall in that
directory, and repeat export/validation/round-trip plus the production bundle
audit. To remove, delete `tools/broadcast-studio` and the staging commands; the
promoted JSON and native player continue to work.

## img2threejs equipment forge

The Codex skill is installed outside the repository at commit
`d6673386f89673a58736f8d398dd16ece67874f5`. Original neutral equipment
references were generated for this project under `docs/references/equipment`;
there is no professional-player likeness or scraped model. The workflow produced
staged mask PBR estimates, a strict sculpt specification, prototype factory,
multi-angle captures, part manifest, and quality-gate evidence under
`docs/equipment-forge` and `.img2threejs`.

Generated factories were references, not runtime artifacts. Winning cage,
padding, harness, protector, guard, glove, bat, grip, and cleat shapes were
reimplemented as cached native geometry in `src/render/actors.ts` so actor IDs,
sockets, materials, pose names, contact timing, and offline behavior stay native.

To update, reinstall or check out a reviewed commit and rerun the staged skill
workflow on original/public-domain/user-provided reference material. To disable,
remove the external skill checkout and the development evidence; the shipping
game is unaffected.

## pmndrs/postprocessing decision

Version `6.39.4` was installed behind `src/render/post.ts` and run in the real
game with Performance/Balance/High profiles. The candidate was removed because:

- Balanced median submission time was +13.3% versus the +10% target.
- High median submission time was +33.3% versus the +20% target.
- The intermediate composer target lost the direct renderer's edge
  antialiasing; identical captures show rougher foul lines, uniforms, strike
  zone, and ball/player silhouettes.
- It added 15.42 kB gzip to the game chunk for no defensible gameplay gain.

The longer candidate soak was stable, so lifecycle was not the rejection. Ball
readability and median budgets were. The dependency is absent from root
`package.json`/lockfile. `src/render/post.ts` retains a no-cost native interface
for a future candidate. Evidence is in
`reports/visual/POSTPROCESSING_BENCHMARK.md`.

## three.quarks lab and native VFX contract

`three.quarks@0.17.1` requires Three `>=0.182.0`, while production uses r169.
It therefore lives in `tools/vfx-lab` with a separate exact Three pin. The lab
proved that 330 prototype particles can batch into one particle draw, with a
0.056 ms measured mean update in the isolated Chromium/ANGLE run. Its lab bundle
is 160.35 kB gzip and its basic dirt/turf/chalk output did not beat the native
shaped result.

Shipping uses `MbdVfxPresetV1` instead: semantic count, palette, speed, life,
gravity, drag, and shape aspect compile into the existing deterministic,
420-instance `ParticleField`. At 300 particles the production benchmark measured
0.10 ms median / 0.20 ms p95 update, one mesh, bounded capacity, zero errors,
and no new runtime dependency.

```bash
npm install --prefix tools/vfx-lab
npm run vfx:lab:typecheck
npm run vfx:lab:build
npm run vfx:benchmark
```

To update the lab, change both exact pins together. A future runtime proposal
must first solve the production Three peer boundary and decisively beat native
appearance, bundle, draw, CPU/GPU, phone, memory, cleanup, and deterministic
capture behavior. To remove, delete `tools/vfx-lab`; semantic presets and native
rendering remain.

## Replay Free Cam packages

`camera-controls@3.1.2` and `three-mesh-bvh@0.9.14` are exact root pins. They are
not part of live camera authority. `src/replay/free-camera.ts` is dynamically
imported only after `ReplayRuntime.pauseForFreeCamera()` confirms a recorded
replay is active and simulation is frozen.

Passing a tree-shakeable Three subset to camera-controls keeps the eager vendor
small. The BVH package is compiled by `npm run replay:camera:vendor` into a
self-contained offline module at `public/vendor/three-mesh-bvh-adapter.js`; a
Vite-ignored local dynamic import fetches it on Free Cam entry. This prevents
BVH-only Three exports from inflating the eager game bundle. Optional entry cost
is approximately 95 kB gzip across camera chunks and the local adapter; normal
gameplay does not request them. The eager final bundle remains 6.35% above the
pre-feature baseline for the full replay/equipment/VFX release.

Five simplified static boxes receive BVHs. Camera-controls uses them for replay
collision only. No moving athlete or baseball is indexed, and no authoritative
module imports this code. Exit disposes controls/listeners, bounds trees,
geometries, and material; the browser receipt shows `5 → 0` colliders and trees.

```bash
npm run replay:camera:vendor
npm run replay:camera:check
```

To update, change exact root pins, rebuild the local adapter, then rerun
typecheck/build, the camera check, replay shots, phone test, soak, and bundle
comparison. To disable without removing code, hide the Free Cam button; the
module will never load. To remove fully, delete `src/replay/free-camera.ts`, the
vendor entry/generated adapter, App/overlay controls, root packages, and camera
scripts. Native automatic replay remains independent.
