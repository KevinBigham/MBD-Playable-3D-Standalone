# Replay Memory and Capacity

The replay recorder stores rendered presentation transforms, not `GameState` or
simulation inputs.

| Field | Value |
|---|---:|
| Capture frequency | 30 Hz |
| History window | 12 seconds |
| Maximum frames | 360 (capacity is `ceil(12 * 30)`) |
| Presentation floats per frame | 2,587 |
| Bytes per frame | 10,348 bytes |
| Steady-state frame storage | 3,725,280 bytes (~3.55 MiB) |
| Time storage | 2,880 bytes (`Float64Array`) |
| Actor slots | 15 fixed slots; stable presentation slots |
| Camera/event storage | Camera and marker transforms are packed in each frame; semantic cues are capped at 128 |
| Allocation strategy | Fixed `Float32Array` slots, fixed sample scratch, circular overwrite |

`PresentationRingBuffer` overwrites the oldest slot after capacity and exposes
first/last clamping plus deterministic midpoint interpolation. Quaternion fields
use slerp; scalar, position, and scale fields use linear interpolation. Stored
frames are never mutated by sampling.

The replay runtime clears the ring, selector, cues, and camera state on new game,
reset, context loss, replay completion, and replay skip. The closeout soak held
the replay buffer flat across eight games and repeated replay/free-camera cycles:
heap 17.4 MiB → 17.4 MiB, with 29 geometries and 157 HUD nodes stable.

Focused proof:

- `npm run replay:test` — bounded wraparound, exact boundary clamping, slerp,
  deterministic repeat, and skip/restore tests pass.
- `npm run test:offline:free-camera` — replay entry, camera pause, and cleanup
  pass in a fresh browser context while offline.
