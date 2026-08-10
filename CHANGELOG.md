# Changelog

## 2026-08-09 — Two-handed batting motion release

### Added

- Hash-pinned offline CMU baseball-swing bake producing 33 native body-motion
  samples with an exact `0.425` contact phase; raw BVH data does not ship.
- Bat-authoritative bottom/top/bunt sockets with allocation-free two-bone arm IK.
- Articulated wrists plus cached relaxed and batting-grip hand meshes with palms,
  curled finger masses, opposing thumbs, and cuffs.
- Deterministic right/left stance, gather, stride, heel-plant, contact,
  extension, wrap, and finish screenshot gallery.

### Fixed

- Both hands now remain attached through stance transitions, contact, full
  follow-through, bunts, and replay interpolation for all five body types.
- Home Run Derby now carries a presentation clock through ball flight and uses
  the same contact/follow-through mapping as normal batting.
- Replay retains its original 154-float player payload while reconstructing the
  derived wrist constraint after interpolation.

## 2026-08-09 — Broadcast replay and athlete presentation release

### Added

- Bounded 12-second/30 Hz instant-replay recorder using actual rendered
  presentation transforms, with interpolation, safe highlight selection,
  skippable UI, semantic audio/VFX, and exact camera restore.
- Native home-run, great-catch, and final-out broadcast sequence packages.
- Isolated Theatre.js Broadcast Studio with strict export, validation, promotion,
  and round-trip tests.
- Replay-only lazy Free Cam with orbit/pan/zoom, ball/athlete focus, four camera
  presets, optional replay-HUD hiding, five static BVHs, and complete cleanup.
- Catcher mask/padding/harness, chest protector, shin guards and catcher mitt;
  first-base/fielding glove silhouettes; continuous bat/grip; studded cleats.
- Fixed-buffer native pose transitions while preserving exact swing contact.
- Semantic native VFX presets for dirt, turf, chalk, wall impact, fireworks,
  and championship confetti on the original bounded one-mesh pool.
- Replay, actor, equipment, VFX, free-camera, image-profile, and lifecycle tests/
  browser receipts. Root suite is now 320 tests across 31 files.

### Development tooling

- Added original generated equipment references and an img2threejs equipment
  forge workflow; shipping geometry remains native and cached.
- Added isolated three.quarks/Three r182 VFX lab. Runtime was rejected in favor
  of native `MbdVfxPresetV1`.
- Benchmarked pmndrs/postprocessing 6.39.4, then removed it after it degraded
  edge/ball clarity and missed Balanced/High median budgets.

### Verification

- Clean install, typecheck, 320 tests, production build, WebKit phone audit,
  world check, screenshot/contact harnesses, ballpark validation/round-trip,
  Pascal Studio, Broadcast Studio, Free Cam, VFX, and eight-game soak all pass.
- Final live play is 59.9 FPS mean (59.5 minimum) with flat 17.4 MB heap and
  GPU geometries `220 → 215` across eight stadium reloads.
