# Graphics Pipeline

The shipping renderer remains the direct Three.js path. Performance, Balanced,
and High profiles vary resolution/shadows through the native pipeline. The
postprocessing experiment failed the visual edge/readability and relative
performance gates, so `postprocessing` is deliberately rejected and removed from
production. Native pooled VFX remain the authority; three.quarks is an isolated
lab benchmark only. Replay Free Camera is optional and lazy, with static BVH
proxies disposed on exit. The production service worker precaches every hashed
asset so Free Camera's first use works offline after install.
