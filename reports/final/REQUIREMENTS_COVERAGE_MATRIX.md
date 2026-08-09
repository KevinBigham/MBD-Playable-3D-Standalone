# MBD 3D Standalone Requirements Coverage Matrix

This matrix was rebuilt from the original maximum-improvement guide and the Luna
Light gap-audit prompt, then checked against source, commands, browser receipts,
and rendered evidence. `UNPROVEN` means the implementation may exist but the
required proof was missing at the start of this closeout.

| Requirement | Status | Source files | Test / command | Visual/report evidence | Gap or next action |
|---|---|---|---|---|---|
| Phase 0 repository truth and protected simulation architecture | PASS | `src/sim/*`, `src/render/*`, `package.json` | `npm run typecheck`; `npm test` | `reports/baseline/BASELINE_REPORT.md` | Preserve archive-without-Git limitation |
| A1 recorded presentation replay, never re-simulation | PASS | `src/replay/runtime.ts`, `src/replay/buffer.ts` | `npm run replay:test`, offline event-path gate | `reports/final/CLOSEOUT_REPORT.md` | None |
| A2 versioned native replay contract | PASS | `src/replay/contract.ts` | `npm run replay:test` | Broadcast assets | None |
| A3 bounded recorder capacity and allocation discipline | PASS | `src/replay/buffer.ts`, `src/replay/runtime.ts` | `npm run replay:test` | `reports/replay/REPLAY_MEMORY_AND_CAPACITY.md` | None |
| A4 explicit safe replay mode and restoration | PASS | `src/replay/runtime.ts`, `src/ui/app.ts` | Replay and offline lifecycle gates | Closeout report | None |
| A5 reliable automatic highlight selection | PASS | `src/replay/highlights.ts`, `src/ui/app.ts` | Offline fixture event path | Closeout report | None |
| A6 shipping broadcast sequences and fallback behavior | PASS | `src/assets/broadcast/*`, `src/replay/runtime.ts` | `npm run replay:validate` | Replay screenshots | None |
| A7 Theatre development studio/export/promotion | PASS | `tools/broadcast-studio/*` | Studio + clean nested tool gates | `reports/replay/broadcast-studio.png` | None |
| A8 semantic replay audio and no duplicate side effects | PASS | `src/replay/highlights.ts`, `src/audio/*`, `src/render/world.ts` | Cue index once-only traversal and reset | Closeout report | None |
| A9 replay validation, interpolation, malformed/fallback assets | PASS | `src/replay/*` | `npm run replay:test`, studio validation | Replay reports | None |
| B1 athlete visual defect inventory | PASS | `src/render/actors.ts` | Model/swing review | `reports/athlete-visual-defect-inventory.md` | None |
| B2 img2threejs focused equipment workflow | PASS | `docs/equipment-forge/*`, native actors | Forge artifacts and explicit rejection record | Closeout report | None |
| B3 position-appropriate equipment and caches | PASS | `src/render/actors.ts`, `src/render/world.ts` | `npm test`, `npm run shots` | `docs/equipment-forge/EQUIPMENT_COVERAGE.md` | None |
| B4 native pose transitions/contact invariants | PASS | `src/render/actors.ts` | Actor tests, `npm run swing` | Swing captures / defect inventory | None |
| B5 athlete quality gates | PASS | actors/tests | `npm run shots`, `npm run swing`, full soak | Model/swing screenshots | None |
| C postprocessing benchmark and rejection | PASS | `src/render/post.ts`, reports | `npm run gfx:compare` | Shipping/rejected captures | Keep rejected runtime out |
| D native VFX semantic presets and benchmark | PASS | `src/render/vfx.ts`, `src/render/fx.ts`, `src/render/world.ts` | `npm run vfx:benchmark`, VFX tests, live trigger audit | Native VFX capture | None |
| E replay-only Free Camera boundary and static BVH | PASS | `src/replay/free-camera.ts`, `src/ui/app.ts` | Desktop + offline camera gates | Free-camera screenshots | None |
| Cold-offline first-use Free Camera | PASS | `public/sw.js`, Vite output | `npm run test:offline:free-camera` | `reports/closeout/screenshots/free-camera-cold-offline.png` | None |
| Replay interpolation | PASS | `src/replay/buffer.ts` | `npm run replay:test` | Memory report | None |
| Replay memory/capacity report | PASS | `src/replay/buffer.ts` | `npm run replay:test` | `reports/replay/REPLAY_MEMORY_AND_CAPACITY.md` | None |
| Automatic normal-event replay proof | PASS | `src/ui/app.ts`, `src/replay/runtime.ts` | Fixture event → selector → safe phase → replay | Closeout report | None |
| Additional replay types | DELIBERATELY REJECTED | `src/sim/state.ts`, `src/replay/highlights.ts` | Event model audit | Coverage matrix | Add only where reliable; otherwise document absent data |
| Replay lifecycle: resize/orientation/visibility/menu/abandon/repeat | PASS | `src/ui/app.ts`, `src/replay/runtime.ts` | Lifecycle hooks + replay/free-camera gates | Closeout report | None |
| Replay audio marker behavior and cleanup | PASS | `src/replay/highlights.ts`, `src/audio/*` | Cue index once-only traversal and reset | Closeout report | None |
| Free Camera orbit/dolly/truck/touch/focus/presets/HUD/reset/exit | PASS | `src/replay/free-camera.ts`, `src/replay/overlay.ts` | Offline gate exercises controls | Closeout screenshot | None |
| Local offline Photo Mode PNG capture | PASS | `src/replay/overlay.ts`, `src/ui/app.ts`, `src/render/world.ts` | PNG data URL + local download in offline gate | Closeout screenshot/report | None |
| Nested tool clean install and reproducible vendor build | PASS | `tools/*`, `package.json` | `npm run tools:ci`, tools type/test/build | Closeout report | None |
| Canonical closeout documentation | PASS | `docs/*`, `reports/*` | File presence and links | Closeout report | None |
| FILE_MANIFEST.sha256 and changed/new manifest | PASS | reports | `npm run manifest:files` | Handoff files | None |
| Full final command matrix and audit | PASS | `package.json` | Existing matrix + closeout gates | Closeout report | None |
| No editor/runtime packages in production bundle | PASS | `package.json`, `src/*`, `dist/*` | `rg` production imports; build | Tooling report | Recheck after hardening |
| Offline/PWA behavior preserved | PASS | `public/sw.js`, `public/manifest.webmanifest` | `npm run test:offline:free-camera` | Offline receipt | None |
| No Git initialization | PASS | archive root | `git status` reports no repository | Final report | Preserve limitation |
