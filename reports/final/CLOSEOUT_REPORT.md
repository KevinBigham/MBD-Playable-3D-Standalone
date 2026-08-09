# MBD 3D Standalone Gap-Audit Closeout

## A. Final status

**GREEN** for the focused closeout. The material gaps identified by the audit are
closed with source changes and fresh evidence. The archive still has no Git
metadata; that limitation is preserved rather than papered over.

## B. Gaps found and closed

| Gap | Change | Proof |
|---|---|---|
| First-use offline Free Camera | Build emits `dist/offline-assets.json`; service worker precaches every hashed asset and the stable BVH adapter. | `npm run test:offline:free-camera`: fresh context, worker-controlled reload, offline first entry, 18 cached assets, zero failed requests. |
| Replay interpolation proof | Ring-buffer sampling now slerps packed quaternions and linearly interpolates scalar/position/scale values. | `npm run replay:test`: wraparound, slerp, boundaries, determinism pass. |
| Replay memory proof | Added fixed-capacity report with byte math, reset behavior, and soak evidence. | `reports/replay/REPLAY_MEMORY_AND_CAPACITY.md`. |
| Automatic event-path proof | Added fixture seam that feeds the normal selector/safe-phase path, not `previewReplay`. | Offline browser gate selects an automatic home-run replay after post-roll. Existing runtime path remains `world.update → observe → maybeStart`. |
| Photo Mode and athlete selection | Added Next Player, PNG capture, local download, and data-URL capture API. | Offline gate exercises focus, presets, HUD toggle, SAVE PNG, reset, and exit. |
| Nested tool reproducibility | Added `tools:ci`, `tools:typecheck`, `tools:test`, `tools:build`, and `verify:all`. | `npm run tools:ci` installed root, Broadcast Studio, and VFX lab from lockfiles; tool gates passed. |
| Canonical handoff evidence | Added exact docs, coverage matrix, memory report, defect inventory, file hash manifest, and changed/new manifest. | Files listed below. |

## C. Deliberately rejected/deferred items

- `postprocessing` remains rejected: the prior measured candidate exceeded the
  Balanced/High budgets and made edges/ball readability worse.
- `three.quarks` remains lab-only: it lost the native pooled renderer on bundle,
  determinism, and production integration criteria.
- Additional replay types (walk-off, double play, wall catch, robbed home run,
  close play) remain rejected where the current event model cannot identify them
  without guessing. The supported automatic set is home run, exceptional catch /
  big play, and final game-over result.
- The img2threejs catcher-mask prototype remains research evidence, not shipping
  authority; its strict silhouette IoU was 0.545 versus 0.85. Native cached
  geometry is the honest shipping result.

## D. Player-visible improvements

Players see automatic dead-ball replays with smooth transform interpolation,
semantic replay cues, improved baseball equipment and pose transitions, bounded
native VFX, replay-only Free Camera controls, selected-athlete focus, HUD hiding,
and local PNG capture. Free Camera now works on its first use after an online PWA
install even when the browser is switched offline before entering it.

## E. Verification receipts

- `npm ci` — PASS; 63 root packages.
- `npm run tools:ci` — PASS; root + Broadcast Studio + VFX lab lockfiles.
- `npm run typecheck` — PASS.
- `npm run replay:test` — PASS; 9 replay tests.
- `npm run tools:typecheck` — PASS.
- `npm run tools:test` — PASS; 2 Broadcast Studio tests.
- `npm run tools:build` — PASS; both nested builds.
- `npm run build` — PASS; offline manifest emitted with 16 build assets.
- `npm run test:offline:free-camera` — PASS; fresh context, 18 cached assets,
  zero failed requests, 5 colliders/5 BVHs active then 0/0 after exit.
- `npm run replay:camera:check` — PASS; desktop cleanup receipt.
- `npm run replay:export`, `replay:validate`, `replay:promote` — PASS.
- Prior full matrix remains green: 321 tests/31 files, phone, world, shots,
  swing, ballpark, Pascal Studio, VFX benchmark, graphics compare, and soak.
- `npm audit --omit=dev` — PASS; zero production vulnerabilities.

## F. Visual receipts

- `reports/closeout/screenshots/free-camera-cold-offline.png` — first-use
  offline Free Camera with controls exercised.
- `docs/screenshots/replay-home-run-desktop.png` — home-run replay.
- `docs/screenshots/replay-great-catch-desktop.png` — exceptional catch replay.
- `docs/screenshots/replay-final-out-desktop.png` — final-out replay.
- `docs/screenshots/replay-free-camera-overhead.png` and `replay-free-camera-ball.png`
  — overhead and ball focus.
- `docs/screenshots/model-catcher-full-kit.png`, `model-first-base-mitt.png`,
  `model-batter-back.png` — equipment silhouettes and cached actor presentation.
- `reports/visual/native-vfx-production.png` — native pooled VFX production path.

## G. Performance and bundle

The existing post-upgrade baseline remains the comparison point. The hardened
build adds only the offline manifest/service-worker work and small control APIs.

| Metric | Previous release | Closeout |
|---|---:|---:|
| Eager gzip | 271.04 kB | ~271 kB |
| 15 s mean FPS | 59.9 | 59.9 |
| 15 s p5 FPS | 59.5 | 59.5 |
| Heap across 8 games | 17.4 → 17.4 MiB | 17.4 → 17.4 MiB |
| Production audit | 0 prod findings | 0 prod findings |

## H. Offline/PWA proof

The gate installs the worker online in a new browser context, reloads once so
the worker controls the page, verifies the cache contains the Free Camera and
BVH assets, switches that same context offline without opening Free Camera,
starts a fixture game, enters an automatic replay, then opens Free Camera for
the first time. It records no failed request and verifies cleanup after exit.

## I. Remaining risks

1. The supplied archive has no `.git` directory, so Git diff/history evidence is
   impossible and no repository was initialized.
2. Root development-tool audit findings remain baseline Vite/Vitest/esbuild/
   nanoid issues; production-only audit is clean.
3. Native low-poly athletes remain stylized; the catcher-mask prototype was not
   photometrically accepted. This is documented rather than overstated.
4. Free Camera uses simplified static perimeter boxes and can clip decorative
   interior structures; this cannot affect live play or baseball outcomes.

## J. Changed/new files

See [CHANGED_AND_NEW_FILES.md](CHANGED_AND_NEW_FILES.md) and the reproducible
[FILE_MANIFEST.sha256](FILE_MANIFEST.sha256).

## K. Repository state limitation

The supplied archive contains no `.git` metadata. No Git repository was
initialized, and no branch, commit, diff, or clean-diff claim is being made.
