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
    input.ts, hud.ts, plateview.ts, screens.ts, app.ts
    controls.ts   what every button means right now — one source, two consumers
    touch.ts      the on-screen pad
    device.ts     touch/phone detection and the real viewport size

  tests/        vitest
scripts/        simulate, tune-physics, verify-fixes, capture
```

## The plate view is a reader, not a writer

`ui/plateview.ts` draws the strike zone, the contact cursor, the pitch tracker,
the live flight path and the swing verdict. It is a pure function of `GameState`
plus one call into `GameWorld.project()`, and it never writes to either. Deleting
it would not change a single pitch.

Two pieces of state exist solely to feed it — `GameState.pitchLog` and
`GameState.lastSwing` — and both are marked display-only where they are declared.
No rule, no AI and no statistic reads them. They are inside `GameState` rather
than beside it so that a headless run produces them too, which is what lets
`plate.test.ts` assert that the dots the player sees match the game that was
actually played.

Two constants are deliberately shared rather than duplicated, because a copy that
drifts is worse than no copy at all:

- `PITCH_TELL_REVEAL` in `core/constants.ts` gates the colour tell, the flight
  arc and the crossing marker, and is read by both `plateview.ts` and
  `render/world.ts`
- `pitchBreak()` in `data/pitches.ts` is the single source of a pitch's movement,
  called by `sim/game.ts` to launch the ball and by `plateview.ts` to preview it

## Defensive alignments are geometry, not modifiers

`DefensiveAlignment` in `sim/state.ts` names five ways the defence can stand.
`ALIGN_DELTA` in `sim/fielders.ts` maps each one to nine position offsets in
metres, and that is the entire implementation.

Nothing else in the engine knows what "infield in" means. There is no branch in
the contact model, no term in the hit-probability calculation, no lookup table
keyed on alignment. The four infielders simply start five to seven metres closer
to the plate and every consequence falls out of the physics that was already
there: the throw home is shorter, so the run gets cut off; the grass behind them
is longer, so ground balls that were outs go through.

This is worth being strict about for two reasons.

**It cannot drift out of sync with what the player sees.** The fielders are
drawn at `FielderState.x/z`, which is where the simulation is actually running
them. An alignment implemented as a probability modifier would be invisible, and
a player who cannot see the defence cannot play against it.

**It costs nothing to add another one.** A new alignment is nine pairs of
numbers and a name. It needs no new code path, and it cannot introduce a rules
bug, because it does not touch the rules.

The manager AI (`chooseAlignment` in `sim/ai.ts`) takes a plain
`DefenseSituation` struct rather than `GameState`, so it holds no reference to
the engine and is unit-testable on its own — which is what
`situational.test.ts` does for every branch.

## One button, one meaning, one source

`ui/controls.ts` exports `controlLabels(state, modifierArmed)`, which answers a
single question: what do the eleven controls mean at this instant. Two things
consume it — the keyboard prompt bar along the bottom of the HUD, and the
captions printed on the on-screen touch pad.

They are not allowed to be separate. On a phone there is no prompt bar to glance
at and no key cap to read, so the caption *is* the button; if the two answers
ever diverged, the touch build would be lying about its own controls. Deriving
both from one function makes that impossible rather than merely unlikely, and it
is why `commands.test.ts` can assert what a button says and what the engine does
in the same test.

`modifierArmed` is a parameter rather than internal state because the modifier
genuinely changes what the diamond does, so it has to change what the diamond
says. That is what makes a latched modifier discoverable on a touchscreen: press
it, watch four captions change.

## The touch pad feeds the same InputFrame as everything else

`ui/touch.ts` owns no game state. It maintains held/edge sets keyed by the same
`ActionId` the keyboard uses, and `InputManager.held`/`pressed` simply OR it in
for player one. The engine cannot tell a thumb from a key, which is the property
that let the whole port happen without touching `sim/`.

The pad is enabled by an actual touch (`touchstart`), not by a media query, so a
laptop with a touchscreen keeps its keyboard until somebody uses the glass —
and `detectDevice()` in `ui/device.ts` only chooses opening defaults, never
capabilities.

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
