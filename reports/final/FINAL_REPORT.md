# MBD 3D Standalone maximum-improvement report

## A. Final status

**GREEN**

Releases A and B are fully landed: recorded-presentation instant replay,
Theatre-authored native broadcast sequences, equipment polish, and pose
transitions. Release D's native VFX upgrade and Release E's replay-only Free Cam
also landed. Release C was deliberately rejected after the real
pmndrs/postprocessing candidate failed readability and median-performance gates;
the dependency and experiment were removed. three.quarks remains a successful
development benchmark, not a production dependency.

The game is immediately playable, deterministic simulation is unchanged, all
applicable build/test/browser/studio gates pass, phone controls pass in WebKit,
and the final eight-game soak shows no resource growth.

## B. User-visible improvements

- Home runs, great catches/big plays, and final outs can trigger a true instant
  replay reconstructed from the transforms the player actually saw.
- Replays use distinct authored broadcast shots, semantic sound/effects, a clear
  progress ribbon, short/full/off settings, and instant skip/restore.
- Free Cam exists only inside frozen replay: orbit, pan, zoom, ball/player focus,
  plate/foul-line/outfield/overhead presets, HUD minimization, reset, and exact
  return to broadcast.
- Catchers now read as catchers: cage/padding/harness, chest protection, shin
  guards, and catcher mitt. First base and standard fielders have distinct
  webbed gloves.
- Bat, wrapped grip/knob, and studded cleats have stronger silhouettes.
- Native pose transitions smooth the run/ready/throw, stance/swing, pitch,
  dive/landing, and slide/recovery chains without moving the contact frame.
- Slides/pickups kick dirt/chalk, dives kick turf, wall caroms throw flecks, and
  home-run/final celebrations have shaped fireworks/confetti.

## C. External repositories used

| Repository | Pin | Status/boundary | Result |
| --- | --- | --- | --- |
| Theatre.js | Core/Studio `0.7.2` | Separate development studio | Native JSON export/promotion passes; no production import |
| img2threejs | `d6673386f89673a58736f8d398dd16ece67874f5` | External development skill | Original equipment reference/prototype workflow translated into cached native factories |
| pmndrs/postprocessing | benchmarked `6.39.4` | Rejected/uninstalled | +13.3% Balanced and +33.3% High median submit; visibly worse edge/ball AA; +15.42 kB app gzip |
| three.quarks | `0.17.1`, lab Three `0.182.0` | Separate development lab | One particle batch proved; 160.35 kB gzip lab and r182 peer boundary; native won overall |
| camera-controls | `3.1.2` | Lazy replay-only runtime | Accepted; 10.51 kB gzip lazy vendor with smooth mouse/touch controls |
| three-mesh-bvh | `0.9.14` | Lazy local adapter, static replay camera proxies only | Accepted; five trees build on entry and dispose to zero |

Licenses, update/removal instructions, and native isolation contracts are in
`docs/THIRD_PARTY_TOOLING.md`.

## D. Architecture

### Replay

`GameWorld.writePresentationFrame()` records 15 articulated actor slots, ball,
markers, and camera into a fixed Float32 frame. `PresentationRingBuffer` holds
12 seconds at 30 Hz (3,725,280 bytes allocated, bounded). Highlight scoring sees
events but never mutates them. Replay starts only in safe dead-ball/final phases,
stops `stepGame`, interpolates recorded frames, and restores a captured
`CameraDirectorState`; it never re-simulates.

### Broadcast authoring

Theatre Studio/Core live under `tools/broadcast-studio` with deterministic
fixture state. Export produces strict `mbd.broadcast-sequence` JSON; validation
and explicit promotion deliver three native packages. Production playback knows
nothing about Theatre.

### Athletes

Original actor IDs, hierarchy, sockets, poses, timing, and replay transform
contract remain. Equipment is cached native procedural geometry. A fixed native
pose buffer blends rendered joint transforms, while `SWING_CONTACT_FRAME`
bypasses blending and has a byte-equal direct-vs-transition test.

### Render profiles

`NativeRenderPipeline` is the reversible adapter. Performance, Balanced, High,
and Auto all retain direct renderer output. Quality differences remain the
existing resolution/shadow/crowd controls. The composer candidate was removed.

### VFX

`MbdVfxPresetV1` describes semantic effect behavior. The existing 420-instance,
one-mesh, private-LCG `ParticleField` renders every approved family with shaped
instances. No quarks runtime or simulation RNG is present.

### Free camera

The app dynamically imports camera controls only after replay freezes the game.
A local Vite-ignored BVH adapter loads next; five static boxes are presentation
collision proxies. No live camera, ball, athlete, fence, or scoring module uses
BVH. Exit disposes listeners, geometry, trees, material, and restores the
current broadcast replay shot.

## E. Verification receipts

| Command | Exit/result |
| --- | --- |
| `npm ci` | 0; 63 packages installed |
| `npm run typecheck` | 0 |
| `npm test` | 0; 31 files, 320 tests passed |
| `npm run build` | 0; production chunks listed below |
| `npm run test:phone` | 0; all portrait/rotated/landscape WebKit checks, real touch swings, 0 errors |
| `npm run test:world` | 0; MBD 32-club first-run/import wiring, 0 errors |
| `npm run shots` | 0; eight actor/equipment closeups |
| `npm run swing` | 0; 33 swing frames, ball put in play, seven captures |
| `npm run ballpark:validate` | 0; 8 catalog assets + staged Anchor Yard |
| `npm run ballpark:roundtrip` | 0; 8/8 semantically equal |
| `npm run ballpark:studio:typecheck/test/build` | 0; 5 Pascal tests |
| `npm run replay:test` | 0; 8 replay/free-camera contract tests |
| `npm run replay:shots` | 0; desktop/phone, freeze and skip checks |
| `npm run replay:studio:typecheck/test/build` | 0; 2 studio tests, build green |
| `npm run replay:export/validate/promote` | 0; home-run project → 2-shot valid native asset |
| `npm run vfx:lab:typecheck/build` | 0; 160.35 kB gzip lab receipt |
| `npm run vfx:benchmark` | 0; bounded native 300-particle receipt, 0 errors |
| `npm run replay:camera:check` | 0; `5 → 0` colliders/BVHs, 0 errors |
| `npm run gfx:compare` | 0; identical-frame direct-profile captures, 0 errors |
| `npm run gfx:soak` | 0; 15 seconds live + 8 games, 0 errors/growth |
| `npm audit --omit=dev --json` | 0; zero production vulnerabilities |

## F. Visual receipts

| Artifact | Proves |
| --- | --- |
| `docs/screenshots/replay-home-run-desktop.png` | Shipping home-run replay |
| `docs/screenshots/replay-great-catch-desktop.png` | Shipping great-catch replay |
| `docs/screenshots/replay-final-out-desktop.png` | Shipping final-out replay |
| `docs/screenshots/replay-home-run-phone.png` | Phone landscape replay layout |
| `docs/screenshots/replay-free-camera-overhead.png` | Free Cam presets/toolbar and full-park orbit |
| `docs/screenshots/replay-free-camera-ball.png` | Ball-focus action |
| `reports/replay/broadcast-studio.png` | Theatre.js authored Anchor Yard project |
| `docs/screenshots/model-catcher-full-kit.png` | Mask, chest, shin and mitt silhouette |
| `docs/screenshots/model-first-base-mitt.png` | Distinct first-base mitt/web |
| `docs/screenshots/model-batter-back.png` | Continuous bat and wrapped grip |
| `docs/screenshots/swing-0-swing105.png` … `swing-6-after75.png` | Stance, contact, follow-through sequence |
| `reports/visual/native-vfx-production.png` | Native shaped dirt/turf/chalk in real game |
| `reports/visual/three-quarks-vfx-lab.png` | 330-particle quarks comparison lab |
| `docs/screenshots/gfx-performance-day.png` / `gfx-balanced-day.png` / `gfx-high-day.png` | Rejected composer edge-AA comparison |
| `docs/screenshots/gfx-shipping-*.png` | Direct-render shipping day/night/phone profiles |

All equipment references under `docs/references/equipment` are original neutral
images generated for this work; no player likeness or downloaded model was used.

## G. Performance receipts

### Production bundle

| Eager artifact | Baseline raw/gzip | Final raw/gzip | Change gzip |
| --- | ---: | ---: | ---: |
| HTML | 2.65 / 1.17 kB | 2.65 / 1.17 kB | 0 |
| CSS | 32.73 / 7.42 kB | 35.14 / 7.94 kB | +0.52 kB |
| Game JS | 355.59 / 118.40 kB | 392.70 / 129.99 kB | +11.59 kB |
| Three vendor | 502.99 / 127.87 kB | 515.25 / 131.94 kB | +4.07 kB |
| **Eager total gzip** | **254.86 kB** | **271.04 kB** | **+16.18 kB / +6.35%** |

Free Cam optional entry: 1.27 kB camera module + 10.51 kB camera-controls
vendor + 83.40 kB local BVH adapter gzip. None is requested before Free Cam.

### Runtime

| Measure | Baseline | Final |
| --- | ---: | ---: |
| Page interactive, 1920×1080 | 955 ms | 1,018 ms |
| Live FPS | 60.0 min/mean | 59.5 min, 59.9 mean, 60.0 max |
| Frame pacing | not instrumented | 16.7 ms median, 17.7 ms p95 High |
| Draw calls / triangles | not captured at baseline | 238 / 40,814 High; 243 / 40,874 Performance |
| Heap across 8 games | 13.6 → 13.6 MB | 17.4 → 17.4 MB |
| Scene children | 29 → 29 | 29 → 29 |
| GPU geometries | 220 → 215 | 220 → 215 |
| Textures | not captured | 1 |
| Warm actor factory cache | not captured | 145 geometries / 19 materials, stable on second build set |
| Native VFX update | not captured | 0.10 ms median / 0.20 ms p95 at 300 particles |
| Phone | all checks passed | all checks passed; no errors |

The 3.8 MB heap increase is the expected preallocated 3.55 MiB replay buffer
plus runtime bookkeeping; it is flat across games and replay/free-camera cycles.
Baseline draw/material/texture totals were not captured, so the table says so
rather than inventing a comparison.

## H. Remaining risks

1. This supplied checkout has no `.git` directory. Git status, diff/stat/check,
   commit identity, and clean-diff proof are impossible in this workspace.
2. Root `npm audit` still reports the same six development-tool findings present
   at baseline (Vite/Vitest/esbuild/nanoid paths); `npm audit --omit=dev` is clean.
   Fixes require major tool upgrades and were not mixed into this feature release.
3. The img2threejs mask blockout's automated silhouette IoU was 0.545 versus its
   strict 0.85 reference gate. It was retained as documented prototype evidence;
   the native production cage was visually reviewed and tested, not claimed as a
   photometric likeness.
4. Free Cam collision uses deliberately simplified park-perimeter boxes. It can
   pass through decorative interior structures; no such presentation clipping
   can affect play.
5. Free Cam is an optional lazy-loaded feature. On a first-ever launch with no
   network, its camera chunks may not yet be in the service-worker cache; entry
   fails safely back to broadcast replay. The installed game and all live play
   remain offline-capable, and later Free Cam use is cached after one online load.

## I. Changed files

### Replay and broadcast

- `src/replay/{contract,buffer,highlights,runtime,overlay,free-camera}.ts`
- `src/assets/broadcast/{home-run-primary,great-catch-primary,final-out-primary}.json`
- `tools/broadcast-studio/**`, `broadcast-staging/home-run-primary.json`

### Athletes and rendering

- `src/render/{actors,world,post,fx,vfx}.ts`
- `src/ui/app.ts`, `src/ui/screens.ts`, `src/style.css`
- `vite.config.ts`, `tools/replay-camera-vendor/bvh-entry.ts`,
  `public/vendor/three-mesh-bvh-adapter.js`

### Equipment development evidence

- `docs/references/equipment/**`, `docs/equipment-forge/**`, `.img2threejs/**`

### VFX lab

- `tools/vfx-lab/**`

### Tests and scripts

- `src/tests/{replay,actors,vfx}.test.ts`
- `scripts/{replay-shot,model-shot,swing-shot,gfx-compare,vfx-benchmark,free-camera-check}.ts`
- `package.json`, `package-lock.json`

### Docs and reports

- `README.md`, `ARCHITECTURE.md`, `GAME_DESIGN.md`, `CHANGELOG.md`
- `docs/THIRD_PARTY_TOOLING.md`, `reports/baseline/**`, `reports/replay/**`,
  `reports/visual/**`, `reports/final/**`, and the listed screenshots

## J. Git status

All four required Git commands were attempted:

```text
git status --short                 fatal: not a git repository
git diff --stat                    unavailable: no repository metadata
git diff --check                   unavailable: no repository metadata
git log -5 --oneline --decorate    fatal: not a git repository
```

No reset, clean, checkout, history rewrite, commit, or push was attempted.
