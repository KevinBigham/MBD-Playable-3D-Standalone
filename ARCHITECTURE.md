# ARCHITECTURE

## The one rule

**The simulation never touches the DOM, WebGL, `window`, `Date` or
`Math.random`.** Everything under `src/sim`, `src/modes`, `src/core` and
`src/data` runs unchanged in Node. That is what makes it possible to play a
hundred full games in sixty seconds inside the test suite, and it is why the
tests exercise *the same engine the player drives* rather than a separate
"quick sim" model that could drift away from it.

The renderer reads `GameState` every frame and never writes to it.

## Stack

| Choice | Why |
|---|---|
| **TypeScript, strict** | `noUnusedLocals` and `noUnusedParameters` are on; the build type-checks before it bundles |
| **Vite** | Fast dev server, one-command static production build, no config to speak of |
| **Three.js** (only runtime dependency) | The look wanted actual low-poly 3D. Nothing else is needed, so nothing else is present |
| **Vitest** | Same transform pipeline as the build; no separate test toolchain |
| **DOM for all UI** | Crisp text at any resolution, real layout, trivially accessible. WebGL draws the field and nothing else |
| **Web Audio, fully synthesised** | No asset pipeline, no licensing surface, and infinite variation for free |

## Layout

```
src/
  core/         pure primitives, no game logic
    rng.ts        seedable mulberry32; the only randomness in the simulation
    constants.ts  world geometry, physics coefficients, tick rate, math helpers
    types.ts      the shared data model

  data/         static content, deterministic generation
    teams.ts      ten club identities, biases, hand-authored stars, roster generation
    names.ts      invented name banks
    stadiums.ts   eight parks, fence interpolation
    pitches.ts    ten pitch profiles

  sim/          the game. no rendering, no browser
    physics.ts    ball flight: pitch kinematics, projectile integration, bounce, walls
    contact.ts    the swing model
    trajectory.ts future ball path + interception solving
    fielders.ts   alignment, movement, catching, throw solving, coverage
    runners.ts    positions, forces, advancement decisions, invariant guards
    ai.ts         CPU pitch selection, CPU plate discipline, pitching changes
    state.ts      GameState and its factory
    game.ts       the engine: phases, rules, scoring, play resolution
    result.ts     end-of-game snapshot
    input.ts      the InputFrame the engine consumes
    autoplay.ts   headless driver + state validator

  modes/        wrappers around the engine
    season.ts, championship.ts, homerun.ts

  save/         localStorage, versioned and defensive

  render/       Three.js. reads state, never writes it
    palette.ts, stadium.ts, actors.ts, camera.ts, fx.ts, world.ts

  audio/        Web Audio. synthesis only
    audio.ts, music.ts

  ui/           DOM. menus, HUD, input, app shell
    input.ts, hud.ts, screens.ts, app.ts

  tests/        vitest
scripts/        simulate, tune-physics, verify-fixes, capture
```

## Determinism

`GameSetup.seed` seeds one `Rng`. Every stochastic decision in a game draws from
it. Given the same seed and the same input sequence, a game replays exactly —
asserted by `simulation.test.ts`, which plays the same seed twice and compares
the `GameResult` field by field.

Three things are deliberately excluded from the simulation RNG:

- particle effects use their own tiny LCG, so turning effects off cannot change
  a game
- the procedural music has its own PRNG seeded per track
- `freshSeed()` uses the clock, and is only ever called from the UI to *choose* a
  seed, never from inside a game

## Frame-rate independence

The simulation only ever advances by `TICK_DT` (1/120 s). The app accumulates
real elapsed time, clamps a single frame to 0.25 s so a backgrounded tab cannot
produce a thousand-step catch-up, and steps at most 12 times per frame.

Two design choices back this up:

- **the pitch is a closed form.** Position at time *t* is computed directly, not
  integrated, so the batter's timing window is bit-identical at 30 Hz and 144 Hz
- **input edges are consumed once.** A button press is true for exactly one
  simulation step no matter how many steps a frame contains

`physics.test.ts` integrates the same launch at 1/120 s and 1/240 s and asserts
the landing points agree within 1.5 m (measured worst case: 0.17 m).

## The game loop

```
requestAnimationFrame
  ├─ input.poll()                      keyboard + gamepad -> two InputFrames
  ├─ dispatchInput()                   menu actions to the top screen, or pause
  ├─ tick(dt)
  │    └─ while (accumulator >= TICK_DT)  stepGame(state, inputs)
  └─ draw(dt)
       ├─ world.update(dt, state)      actors, ball, markers, camera, effects
       ├─ world.render()
       └─ hud.update(dt, state, world)
```

## Phases

```
lineup ─▶ preplay ─▶ windup ─▶ pitch ─┬─▶ inplay ─▶ deadball ─┬─▶ preplay
                       ▲              │                       └─▶ inningbreak ─▶ preplay
                       └──────────────┘  (ball / strike / foul)                     │
                                                                                 final
```

Play resolution is guarded so `inplay` cannot become a trap:

1. no live runners remain → the play ends after 0.5 s, because nothing further
   can happen
2. a fielder holds the ball and every runner is settled on a base → 0.75 s
3. 26 seconds elapsed → force-resolve, snap runners to their nearest base, and
   record a diagnostic in `state.diag.warnings`

The third path is a backstop, not a mechanism. It has not fired in any
validation run since the interception solver and throw-receiver assignment
landed.

## Invariants

`validateState()` in `autoplay.ts` is the contract, checked every 30 ticks
across every simulated game:

- outs 0–3, balls 0–3, strikes 0–2, runs never negative, inning 1–40
- at most four live runners and at most one batter-runner
- no two runners on the same base, no runner out of order, none off the basepath
- ball and every fielder finite and inside the world

`enforceRunnerOrder()` runs after every movement step, and
`settleRunnersToBases()` collapses runners onto bases when a play ends. Both are
hard guards: even a wrong AI decision cannot produce an illegal base state.

## Saves

`localStorage`, namespaced `moonshot9:`, versioned. A save whose version does not
match is discarded rather than migrated. Every read is wrapped: unparseable
JSON, a truncated value, a missing field or storage being blocked entirely all
return `null`, and the UI treats that as "no save". Safari private mode is
detected by probing a write, not by feature detection.

## Rendering notes

- one draw call for the whole crowd (`InstancedMesh`), one for all particles
- the seating bowl is generated radially from the fence shape, so seats can
  never be in fair territory whatever the park looks like
- players are procedurally posed — no skinning, no animation clips — so pose
  changes react instantly to simulation state
- crowd wave positions are read from an immutable seat table; deriving them from
  the live matrix makes the whole crowd drift upward a fraction every frame
  (this was a real defect, found and fixed)
- `manualChunks` splits Three.js into its own chunk so the game code can be
  re-downloaded without it

## Error handling

The render loop wraps input, tick and draw in a `try`. A fault logs once and
returns the player to the main menu rather than freezing the page. `main.ts`
installs `error` and `unhandledrejection` handlers, and a WebGL context that
fails to create shows a readable message instead of a black rectangle.

## What is deliberately absent

- **No state-management library.** `GameState` is a plain object mutated by one
  module. It is the simplest thing that can be validated, serialised and stepped
  a million times per second
- **No ECS.** Nine fielders and four runners do not need one
- **No physics engine.** The ball is the only body that matters and its
  behaviour is entirely bespoke
- **No asset pipeline.** There are no assets
