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
