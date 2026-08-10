# Realistic batting animation verification

Verified on 2026-08-09 against the production build and the canonical `main` branch candidate.

## Motion source and runtime boundary

- Source: CMU Motion Capture Database subject 124, motion 07, frames 264–425.
- Mirror commit: `09a07f54f3bbb58797325f009282d0b2048a2871`.
- Source SHA-256: `fe848034a77cac57ff49a77e9a57d2af3d714f549ced078b128e458910666ba4`.
- Bake command: `npm run mocap:bake:batting -- --input /absolute/path/to/124_07.bvh`.
- Runtime payload: 33 numeric pose samples, including phase `0.425` exactly. The raw BVH is not committed, copied to `public`, or emitted to `dist`.
- Batting contact remains at `0.425`; the post-contact follow-through remains `0.42s`.
- Player replay remains 14 objects / 154 floats, with the bat at semantic object index 12.

## Automated acceptance

| Gate | Result |
| --- | --- |
| TypeScript | `npm run typecheck` passed |
| Focused motion, actor, replay, and Derby tests | 35 passed |
| Full suite | 339 passed across 33 files |
| Replay suite | 9 passed |
| Production build | passed; 16 offline assets |
| WebKit phone audit | passed; both touch swings graded `barreled`; 0 console errors |
| Graphics comparison | passed; 0 console/page errors |
| 60-second graphics soak | 60.0 mean/p5 FPS; 0.0 MB heap growth; no scene/HUD growth |

The all-body grip sweep covers five body types, both handednesses, bunting, all eight semantic phases, and 101 evenly spaced swing samples. Maximum sampled hand-anchor/socket error was below floating-point display precision; maximum adjacent barrel-tip step was approximately 0.18 m. The authoritative barrel path remains longer than 7 m and the contact radius remains greater than 1.15 m for both handednesses.

## Performance comparison

Performance-profile comparison at 1600x900, after warm-up:

| Metric | Before | After | Delta | Gate |
| --- | ---: | ---: | ---: | ---: |
| Draw calls | 243 | 244 | +0.4% | no material increase |
| Triangles | 40,874 | 41,378 | +1.23% | <=15% |
| Geometries | 199 | 200 | +1 | stable after warm-up |
| Submit median | 0.7 ms | 0.7 ms | 0% | <=10% regression |
| Submit p95 | 1.2 ms | 1.2 ms | 0% | <=10% regression |

The extra scene submission is the actor-level diagnostic accounting observed by the browser harness; the hand implementation itself swaps cached relaxed/grip meshes beneath each existing wrist and does not add a per-player active hand draw call. The soak remained at 60 FPS with zero post-warm-up heap growth.

## Visual receipts reviewed

- [Right-handed stance](../../docs/screenshots/batting/right-stance-open.png)
- [Right-handed contact](../../docs/screenshots/batting/right-contact-open.png)
- [Right-handed finish](../../docs/screenshots/batting/right-finish-open.png)
- [Right-handed stance hand close-up](../../docs/screenshots/batting/right-stance-hands.png)
- [Right-handed contact hand close-up](../../docs/screenshots/batting/right-contact-hands.png)
- [Left-handed stance](../../docs/screenshots/batting/left-stance-open.png)
- [Left-handed contact](../../docs/screenshots/batting/left-contact-open.png)
- [Left-handed finish](../../docs/screenshots/batting/left-finish-open.png)
- [Left-handed contact hand close-up](../../docs/screenshots/batting/left-contact-hands.png)
- [Phone landscape](../../docs/screenshots/gfx-shipping-high-phone-landscape.png)

The complete temporary gallery also covered rear/open views at every semantic phase before the selected review receipts above were committed. Live and replayed strips were checked for socket separation, bat snapping, and finish continuity. Both hands remain attached through phase 1.0, the finish clears the head and wraps over the lead shoulder, and mirrored handedness preserves anatomical lead/trail roles.
