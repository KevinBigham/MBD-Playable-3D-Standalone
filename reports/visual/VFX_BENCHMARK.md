# Baseball VFX benchmark — native runtime accepted

## Decision

Ship the upgraded native `ParticleField` and `MbdVfxPresetV1`. Keep
three.quarks in the isolated development lab only.

| Measure | Native production | three.quarks lab |
| --- | ---: | ---: |
| Three version | r169 | r182 (required peer) |
| Tested particles | 300 | 330 |
| Particle draw meshes | 1 | 1 batch (2 scene calls including ground) |
| CPU update | 0.10 ms median / 0.20 ms p95 | 0.056 ms mean |
| Bounded pool | hard 420 | prototype emission peak 330; no production bound proof |
| Production bundle addition | 0.72 kB gzip for semantic presets/native shapes | 160.35 kB gzip isolated lab bundle |
| Deterministic presentation RNG | yes, private LCG | no, emitter uses internal `Math.random()` |
| Root runtime dependency | none | peer-incompatible; rejected |

The update measurements are not claimed as GPU equivalents: native was measured
inside the production game and quarks inside the isolated same-scale lab. Both
are far below the frame budget. The runtime decision is driven by total system
fitness: appearance, bundle, peer compatibility, deterministic captures, pool
bounds, cleanup, phone risk, and authoring boundary—not by one CPU number.

## Visual result

- `reports/visual/native-vfx-production.png` shows differently shaped dirt,
  turf, and chalk families in the real game.
- `reports/visual/three-quarks-vfx-lab.png` shows the 330-particle one-batch lab.

Native aspects let the existing instanced boxes read as flat dirt chips, long
turf blades, chalk fragments, wall flecks, firework streaks, and confetti. The
effect remains one pooled mesh and is automatically disabled with the existing
particle/reduced-flashing setting.

## Shipping effects

1. Dirt spray on slide transitions and hard ground pickups
2. Turf fragments at the start of a dive
3. Chalk near line/base slides
4. Wall-impact flecks
5. Multi-colour home-run fireworks
6. Bounded championship confetti

Weather was not added because the game has no authoritative weather system.

## Lifecycle receipt

The native benchmark peaked at 300/420 particles, returned to zero, used one
particle mesh, reported no page/console errors, and the full eight-game soak
held heap at 17.4 MB with GPU geometries `220 → 215`.
