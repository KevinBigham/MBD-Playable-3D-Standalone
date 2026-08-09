# Broadcast image-finishing benchmark — rejected

Same production game, Chromium/ANGLE SwiftShader, 1600×900, 6s/profile. Submission time is CPU-side and is paired with frame pacing, resource counts, screenshots, phone checks, and the longer soak.

| Profile | median submit ms | p95 submit ms | median vs direct | p95 vs direct | median frame ms | max calls | max triangles | heap MB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| performance | 1.500 | 2.800 | 0.0% | 0.0% | 16.70 | 243 | 40874 | 17.4 |
| balanced | 1.700 | 2.900 | 13.3% | 3.6% | 16.60 | 1 | 1 | 17.4 |
| high | 2.000 | 3.000 | 33.3% | 7.1% | 16.70 | 1 | 1 | 17.4 |

Visual gates: `gfx-performance-day.png`, `gfx-balanced-day.png`, `gfx-high-day.png`, `gfx-high-night.png`, and `gfx-high-phone-landscape.png`.

Console/page errors: 0.

## Decision

Do not ship the pmndrs/postprocessing runtime in this release.

- Balanced missed the median submission-time target: +13.3% against +10%.
- High missed its median target: +33.3% against +20%.
- Both composer profiles lost the direct renderer's edge antialiasing. The
  identical captures show visibly rougher foul lines, uniforms, strike-zone
  lines, and player/ball silhouettes.
- The candidate added 15.42 kB gzip to the app chunk (127.35 → 142.77 kB) and
  extra render-target resources for no defensible gameplay value.
- The longer High-profile soak remained stable at 60 fps with a flat 18.4 MB
  heap and zero errors, which proves cleanup was sound but does not override the
  failed readability and median gates.

The production dependency and composer implementation were removed. A native
`RenderPipeline` seam remains, and all shipping profiles retain the direct
antialiased renderer.
