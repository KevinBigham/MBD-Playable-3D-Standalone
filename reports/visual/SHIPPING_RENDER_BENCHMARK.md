# Shipping native render benchmark

Same production game, Chromium/ANGLE SwiftShader, 1600×900, 8s/profile. Submission time is CPU-side and is paired with frame pacing, resource counts, screenshots, phone checks, and the longer soak.

| Profile | median submit ms | p95 submit ms | median vs direct | p95 vs direct | median frame ms | max calls | max triangles | heap MB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| performance | 1.400 | 2.400 | 0.0% | 0.0% | 16.70 | 243 | 40874 | 17.4 |
| balanced | 1.500 | 2.800 | 7.1% | 16.7% | 16.70 | 238 | 40814 | 17.4 |
| high | 2.500 | 4.000 | 78.6% | 66.7% | 16.70 | 459 | 72424 | 17.4 |

The rejected composer evidence remains in `POSTPROCESSING_BENCHMARK.md`. All shipping settings use the direct antialiased renderer. Visual gates: `gfx-shipping-performance-day.png`, `gfx-shipping-balanced-day.png`, `gfx-shipping-high-day.png`, `gfx-shipping-high-night.png`, and `gfx-shipping-high-phone-landscape.png`.

Console/page errors: 0.
