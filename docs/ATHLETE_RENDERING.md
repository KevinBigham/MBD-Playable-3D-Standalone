# Athlete Rendering

Players remain native cached procedural Three.js actors. Catchers receive cage,
chest protector, shin guards, and catcher mitt geometry; first basemen receive a
distinct mitt; other fielders retain a standard glove. Bat grip, cleats, hand
variants, and shared materials are cached.

Batting uses a hybrid motion pipeline. `scripts/mocap/bake-batting-motion.ts`
reads a locally supplied, hash-verified CMU 124_07 BVH and emits 33 compact pose
samples. Runtime imports only the generated numbers. CMU supplies hips, torso,
head, leg, and elbow intent; the bat path remains contact-authoritative because
the source contains no bat and its hand tracks are noisy.

The bat is a torso child with bottom, top, bunt-support, and tip sockets. Both
arms are solved to its final blended transform with allocation-free analytical
two-bone IK. Relaxed and batting-grip hands are separate cached single meshes,
with exactly one visible per wrist. The grip constraint runs after semantic pose
blending and after replay interpolation, so hands cannot drift away from the bat.

`SWING_CONTACT_FRAME = 0.425`, physics timing, and the 14-object replay payload
remain unchanged. Contact/power swings time-warp the same curve through their
existing latencies; Home Run Derby uses the same presentation mapping.

## Pitching motion and release ownership

Pitching follows the same offline-only numeric pipeline. The explicit developer
bake reads the locally supplied, hash-verified CMU Motion Capture Database
subject 124 trial 01 (`data/124/124_01.bvh`) from the
`una-dinosauria/cmu-mocap` mirror at commit
`09a07f54f3bbb58797325f009282d0b2048a2871`; the accepted source bytes have
SHA-256 `eee88ea11954d3448e13c847a403ab9a88f264d575c21427f61e722bb0d3cd58`.
Frames 160–540 are reduced to 33 pose samples, with source frame 448 represented
at pose phase `0.76` as the release frame. The raw BVH is development input only:
it is not committed, copied to `public`, loaded at runtime, or emitted to `dist`.

`src/render/pitching-motion.generated.ts` contains only the compact generated
numbers. `PlayerActor` samples those values, mirrors the canonical right-arm
delivery for left-handed throwers, and exposes a caller-owned ball-centre release
socket. The actor eases that socket toward the already-immutable physics release
point during late arm-cock, makes it coincident at release, and decays the
correction through follow-through. The existing ball trajectory remains the
source of truth. Non-finite or excessive corrections fail closed before they can
mutate the pose. The native geometry/material caches, two-bone arm solve, and five
body-scale variants remain shared and allocation-free during delivery.

This is presentation work only. It does not change pitch physics, gameplay or
RNG, saves or save versions, replay object count/capacity (still 14 objects / 154
floats), or Derby behavior.
