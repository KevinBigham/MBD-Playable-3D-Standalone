# Catcher-mask reference intake

Reference: `docs/references/equipment/catcher-mask.png` — original, unbranded neutral product study generated for this project.

## Identification and suitability

- Work type: articulated catcher’s protective face mask; compound protective equipment; `primaryDomain: object`; confidence 0.98.
- Suitability: **pass for a stylized real-time procedural reconstruction**. One target fills roughly 75% of a square frame, the open silhouette is strong, metal and padding are separated, and the partially hidden rear straps can be conservatively inferred.
- Fidelity boundary: the source is one three-quarter view. Exact rear harness routing, wire weld topology, padding thickness on the hidden side, and manufacturing dimensions are undetermined. Those regions may be symmetrical/generic and must not be described as exact.

## Form and scene-graph decomposition

- Overall bounding form: vertically elongated rounded cage, approximately 1.16 height-to-width, shallow front-to-back ellipsoid, bilateral symmetry around the face centerline.
- Macro components:
  - `mask-cage`: open metal tube network defining brow, cheek, mouth, and chin silhouette.
  - `padding-assembly`: dark fabric/foam contact pads behind the cage.
  - `rear-harness`: lateral and crown straps; partly occluded.
- Meso components:
  - cage: upper crown rails, horizontal brow rail, cheek rails, central nose/eye dividers, mouth rail, twin chin loops.
  - padding: crown cap, brow pad, two cheek pads, jaw/chin cup.
  - harness: crown bridge and lateral strap tabs.
- Micro feature groups: satin edge highlights on tubes, visible pad seams/piping, fabric grain, leather-like contact wear, strap weave, tube junctions.
- Attachment triplets:
  - `<cage rails, overlap/weld, cage perimeter>` with zero visible gaps.
  - `<padding pads, strap/overlap, rear cage>` with shallow embed behind the tube plane.
  - `<rear harness, socket/overlap, lateral cage tabs>` with the hidden rear routing explicitly low confidence.

## Materials and color

- Cage: charcoal gunmetal, metalness approximately 0.75, satin roughness approximately 0.32; no mirror finish. Real tube curvature must carry highlights.
- Padding shell: very dark navy, dielectric, matte/satin roughness approximately 0.72 with subtle independent fabric normal response.
- Pad piping/straps: near-black dielectric, roughness approximately 0.62; woven micro-frequency only where it survives game-camera distance.
- Local overrides: slightly lower roughness on exposed cage crowns and pad piping; darker cavity response where padding meets rails; restrained tan/gray edge wear only at high-contact pad edges.

## Identity-defining details

1. Two nested chin loops extending below the padded jaw cup.
2. Broad open eye window divided by vertical/angled rails without blocking sightlines.
3. Three readable horizontal cage bands from brow through mouth.
4. Padded crown/brow mass visibly behind, not fused into, the cage.
5. Distinct cheek pads and deep jaw cup with contrasting piping.
6. Lateral strap tabs physically connected to the cage.

## Uncertainty and implementation route

- Occluded: rear harness, hidden welds, rear pad faces.
- Inferred: bilateral counterpart geometry and the tube depth needed to clear the face.
- Projection route: **native procedural geometry**, not image projection and not opaque model import. Use cached tube/torus-like segments, pad shells, stable component pivots, and sockets compatible with the existing `PlayerActor` head hierarchy.
- Definition of done: reads unmistakably as catcher gear at the field camera and close-up, preserves the eye opening and head silhouette, has no floating rails or pads, adds no per-frame geometry allocation, and remains removable by the existing catcher equipment-selection path.
