# Realistic pitching animation verification

## Motion source and runtime boundary

- Source: CMU Motion Capture Database subject 124, trial 01
  (`data/124/124_01.bvh`).
- Mirror pin: `una-dinosauria/cmu-mocap` commit
  `09a07f54f3bbb58797325f009282d0b2048a2871`.
- Accepted input: 491,121 bytes, SHA-256
  `eee88ea11954d3448e13c847a403ab9a88f264d575c21427f61e722bb0d3cd58`, 644
  frames at `0.0083333` seconds/frame.
- Bake interval: frames 160–540. Source release frame 448 is represented at
presentation phase `0.76`; 33 samples × 49 floats are retained in
  `src/render/pitching-motion.generated.ts`.
- The raw BVH is offline development input only. It is not committed, copied to
  `public`, loaded by the browser, or emitted to `dist`.

The runtime samples compact numeric poses, mirrors canonical right-arm motion
for a left-arm thrower, and runs a native two-bone solve at release. The named
release socket is made coincident with the existing authoritative physics-ball
position. This does not alter pitch physics, gameplay outcomes, RNG, saves or
save versions, replay capacity/payload (14 objects / 154 floats), or Home Run
Derby behavior.

## Acceptance coverage

`src/tests/pitching.test.ts` checks the pinned source metadata and generated
sample count, all finite data, normalized sampled quaternions, exact bilateral
reflection, every one of the five body types on both throwing sides, release
socket alignment and post-release continuity, glove ownership, rejection of
non-finite and excessive targets, replay-payload preservation, and stable cached
geometry and materials through a delivery sweep.

Run the focused gate with:

```bash
npx vitest run src/tests/pitching.test.ts
```

Verification completed for this change:

| Gate | Result |
| --- | --- |
| TypeScript | `npm run typecheck` passed |
| Focused pitching suite | 11 passed |
| Full suite | `npm test` passed |
| Production build | passed; offline precache manifest contains 16 assets |
| Deterministic receipt harness | passed; 0 browser console/page errors |

## Visual receipts

`scripts/pitching-shot.ts` follows the existing Playwright renderer-harness
pattern: it opens a deterministic CPU fixture, waits only for the public game
world and its nine fielders, poses the actual pitcher, renders in the same page
evaluation, and records the world-space release socket with each image. It does
not select controls, menus, or text in the UI.

```bash
npx vite preview --port 4178 &
npx tsx scripts/pitching-shot.ts
```

The default gallery writes these review receipts under
`docs/screenshots/pitching/`:

- `right-set.png`, `right-release.png`, `right-finish.png`
- `left-set.png`, `left-release.png`, `left-finish.png`
- `receipt.json`, containing the pose phase, authoritative physics target,
  world-space hand socket, and alignment error for every rendered frame. Both
  release frames measure `5.551e-17 m` error; set and finish frames deliberately
  show the hand away from the release point.

Selected review frames: [right-arm release](../../docs/screenshots/pitching/right-release.png)
and [left-arm release](../../docs/screenshots/pitching/left-release.png).

The CMU acknowledgement and usage boundary are recorded in `LICENSES.md`.
