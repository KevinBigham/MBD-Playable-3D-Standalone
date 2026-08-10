# Shipping native render benchmark

Same production game, Chromium/ANGLE SwiftShader, 1600×900, 8s/profile. Submission time is CPU-side and is paired with frame pacing, resource counts, screenshots, phone checks, and the longer soak.

| Profile | median submit ms | p95 submit ms | median vs direct | p95 vs direct | median frame ms | max calls | max triangles | heap MB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| performance | 0.700 | 1.200 | 0.0% | 0.0% | 16.70 | 244 | 41378 | 17.4 |
| balanced | 1.000 | 2.000 | 42.9% | 66.7% | 16.70 | 239 | 41318 | 17.4 |
| high | 1.100 | 1.500 | 57.1% | 25.0% | 16.70 | 459 | 73216 | 17.4 |

The rejected composer evidence remains in `POSTPROCESSING_BENCHMARK.md`. All shipping settings use the direct antialiased renderer. Visual gates: `gfx-shipping-performance-day.png`, `gfx-shipping-balanced-day.png`, `gfx-shipping-high-day.png`, `gfx-shipping-high-night.png`, and `gfx-shipping-high-phone-landscape.png`.

Console/page errors: 0.
