# LICENSES AND ORIGINALITY

## Originality statement

MOONSHOT NINE is an original work. It was written from scratch for this
project.

- No commercial game ROM was inspected, distributed, emulated, decompiled or
  extracted from at any point.
- No third-party game assets of any kind are present: no textures, sprites,
  models, animations, interface artwork, fonts, audio files or music.
- No real trademark, real club, real ballpark, real athlete, real league or real
  broadcaster appears anywhere in the code, the data or any user-visible string.
- All ten clubs, eight ballparks, roughly two hundred players, all names,
  colours, logos, mottoes, flavour text and the league itself are invented for
  this game.

**Everything the player sees and hears is generated at runtime by code in this
repository.** There is not a single binary asset in `src/`:

- Geometry is built procedurally from `three` primitives in `src/render/`.
- Colours and palettes are numeric literals in `src/data/` and `src/render/`.
- All sound effects and all music are synthesised with the Web Audio API in
  `src/audio/` — oscillators, noise buffers filled in JavaScript, biquad
  filters, envelopes, a waveshaper and a convolution reverb whose impulse
  response is itself generated from noise.
- Type is set in whatever condensed sans-serif the operating system already
  provides (`Arial Narrow`, `Helvetica Neue Condensed`, `Roboto Condensed`,
  then the system UI font). Nothing is downloaded or bundled.

The only binary files anywhere in the repository are the PNG screenshots and the
WebM recording under `docs/`, both produced by `scripts/capture.ts` from this
game running in a browser.

## Runtime dependencies

| Package | Version | License | Used for |
|---|---|---|---|
| [three](https://github.com/mrdoob/three.js) | ^0.169.0 | MIT | WebGL rendering |

That is the complete runtime dependency list. It ships in the production bundle.

## Development dependencies

| Package | License | Used for |
|---|---|---|
| vite | MIT | Dev server and production build |
| typescript | Apache-2.0 | Type checking |
| vitest | MIT | Test runner |
| tsx | MIT | Running the TypeScript harness scripts |
| playwright | Apache-2.0 | Screenshot and video capture (`scripts/capture.ts`) |
| @types/three | MIT | Type definitions |
| @types/node | MIT | Type definitions |

None of these ship in the production bundle. Full license texts for every
package are installed under `node_modules/<package>/LICENSE`.

## Reference material

Publicly available gameplay footage, reviews and manuals of late-1990s console
baseball games were used only to understand broad genre behaviour and player
expectations — how fast an at-bat should feel, what a control scheme of that era
looked like, what made those games enjoyable. No expressive content was copied,
traced, sampled or reproduced.

Baseball's rules are facts, not expression, and are not subject to copyright.
The specific implementation of those rules in this repository is original.

## License for this work

Copyright (c) 2026 the authors of MOONSHOT NINE.

No license is granted by this document. The repository owner may apply whichever
license they choose; the code is clean of third-party expressive content and
carries only the MIT/Apache-2.0 obligations listed above, so any common
open-source or commercial license can be applied.

If distributing a build, include the Three.js MIT notice, which is reproduced in
`node_modules/three/LICENSE`.
