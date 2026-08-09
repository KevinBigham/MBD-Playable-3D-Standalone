# MBD 3D Standalone baseline

Captured 2026-08-09 before feature implementation. This checkout was supplied without a `.git` directory, so commit identity and a clean `git diff` are unavailable; verification is command- and artifact-based.

## Environment and dependency install

| Check | Result |
| --- | --- |
| Root `npm ci` | PASS — 61 packages installed |
| Pascal Studio `npm ci` | PASS — 283 packages installed |
| Playwright browsers | Chromium and WebKit installed for browser gates |
| Root audit notice | 6 reported issues: 3 moderate, 2 high, 1 critical; not changed during baseline |
| Pascal Studio audit notice | 5 reported issues; not changed during baseline |

## Required command baseline

| Command | Exit | Evidence |
| --- | ---: | --- |
| `npm run typecheck` | 0 | TypeScript clean |
| `npm test` | 0 | 28 files, 304 tests passed |
| `npm run build` | 0 | Production build completed |
| `npm run test:phone` | 0 | Portrait and landscape WebKit checks passed; zero console errors |
| `npm run test:world` | 0 | World import/first-run checks passed |
| `npm run shots` | 0 | Five model close-ups written |
| `npm run swing` | 0* | Harness reported `45 frames, 5 during the swing, no contact` |
| `npm run ballpark:validate` | 0 | 8 catalog ballparks plus staged Anchor Yard validated |
| `npm run ballpark:roundtrip` | 0 | 8/8 round trips passed |
| `npm run ballpark:studio:typecheck` | 0 | Clean |
| `npm run ballpark:studio:test` | 0 | 5 tests passed |
| `npm run ballpark:studio:build` | 0 | Studio production build completed |

`*` The swing harness returned success without exercising contact. This is a semantic baseline failure, not a green result. The harness is being tightened to fail when no ball is put in play.

## Production build size

| Artifact | Raw | Gzip |
| --- | ---: | ---: |
| HTML | 2.65 kB | 1.17 kB |
| CSS | 32.73 kB | 7.42 kB |
| Game JavaScript | 355.59 kB | 118.40 kB |
| Three.js chunk | 502.99 kB | 127.87 kB |

## Runtime baseline

- Page interactive: 955 ms at 1920×1080.
- 60 seconds of live play: min/p5/mean/max all 60.0 FPS.
- Heap across eight games: 13.6 MB to 13.6 MB.
- Scene children: 29 to 29.
- GPU geometries: 220 initially, 215 after game eight; no upward trend.
- HUD nodes: 157 to 157.
- Console errors: 0.

## Visual and recording artifacts

- Full UI/gameplay screenshot pass: `docs/screenshots/01-title.png` through `20-postgame.png`, plus phone/world/model/swing evidence.
- Gameplay recording: `docs/recordings/gameplay.webm`.
- Screenshot pass console errors: 0.
- Recording console errors: 0.

## External-tool boundary audit

| Tool | Pinned/current version | Boundary decision |
| --- | --- | --- |
| img2threejs | commit `d6673386f89673a58736f8d398dd16ece67874f5` | Development workflow only; generated prototypes must be translated into native cached factories |
| `@theatre/core` / `@theatre/studio` | 0.7.2 / 0.7.2 | Isolated development studio only; no production import |
| `postprocessing` | 6.39.4 candidate | Compatible with Three 0.169; ship only if measured gates pass |
| `three.quarks` | 0.17.1 candidate | Rejected as a current runtime candidate because it requires Three >=0.182 |
| `camera-controls` | 3.1.2 candidate | Replay/photo-mode only if later gates pass |
| `three-mesh-bvh` | 0.9.14 candidate | Simplified static camera collision/selection only if later gates pass |
