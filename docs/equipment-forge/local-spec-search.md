# Local spec search

The img2threejs `core_3d` BM25 search returned only generic PBR records; no catcher-mask or baseball-equipment spec exists locally. The winning implementation seam is the game’s existing cached `PlayerActor` factory in `src/render/actors.ts`, whose head pivot, geometry cache, material cache, and `SWING_CONTACT_FRAME` contract must be preserved.
