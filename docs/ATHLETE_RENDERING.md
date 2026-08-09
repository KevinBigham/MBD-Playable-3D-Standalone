# Athlete Rendering

Players remain native cached procedural Three.js actors. Catchers receive cage,
chest protector, shin guards, and catcher mitt geometry; first basemen receive a
distinct mitt; other fielders retain a standard glove. Bat grip, cleats, and
shared materials are cached. The pose transition layer blends presentation
transforms with state-specific bounded durations while root location and
`SWING_CONTACT_FRAME` remain authoritative. See the visual defect inventory and
`docs/equipment-forge/` evidence.
