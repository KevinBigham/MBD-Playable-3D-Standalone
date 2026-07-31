# BUILD LOG

Factual record of what was built, what broke, and what was done about it.

---

## Current playable state

Complete and playable end to end.

- Title → menu → setup → game → result → rematch or return, with no dead ends
- Quick Play, Season, Championship, Moonshot Derby, Practice and the Player
  Creator all functional
- Human control of batting, pitching, fielding and baserunning
- Local two-player on one keyboard, or with two gamepads
- CPU plays complete games unassisted at three genuinely different difficulties
- Seasons save automatically, survive a page reload and resume correctly
- 148 automated tests pass; 100 CPU-versus-CPU games complete with zero
  anomalies and zero forced play resolutions
- Two independent evaluators attacked the running build; every blocker and major
  finding is fixed and covered by a regression test
- Production build succeeds from clean; capture run through the production build
  reports zero console errors

---

## Decisions that shaped the product

**Vite + TypeScript + Three.js, and nothing else at runtime.** The look wanted
real low-poly 3D, so a renderer was needed; nothing else was, so nothing else is
present. One runtime dependency.

**The simulation is a pure module.** No DOM, no WebGL, no `window`, no `Date`,
no `Math.random` anywhere under `src/sim`, `src/modes`, `src/core`, `src/data`.
This is the single highest-leverage decision in the project: it let a hundred
full games run inside a test in under a minute, and it means the tests exercise
the same engine the player drives rather than a parallel model that could drift.

**Fixed 120 Hz simulation with an accumulator.** The pitch is a closed form
rather than an integration, so the batter's timing window is bit-identical at
any frame rate.

**One control mnemonic: the four action buttons are the bases.** Fielding and
baserunning use it literally; batting and pitching map it to swing types and
pitch slots. The HUD always shows the four current meanings, so nothing has to
be memorised.

**Runner commands during an at-bat sit behind a modifier.** Choosing a swing and
sending a runner would otherwise share the same four buttons, and an accidental
send is more damaging than the opposing defence.

**Difficulty never changes physics.** It changes CPU perception, execution and
reaction only. The single exception is a documented, user-facing widening of the
*human* timing window on Rookie and Pro, stated on the difficulty screen; the
CPU never receives it.

**All audio is synthesised at runtime.** No asset pipeline, no licensing
surface, and per-trigger variation for free — which matters when the same twenty
sounds fire several hundred times in one game.

---

## Defects found and fixed

Ordered roughly by severity. Everything here was found by running the product or
the simulation, not by reading code.

### Blocking

**Pitch break was applied on top of the aim point.** The aim reticle set the
launch line, and the break was then added, so nothing ever finished in the
strike zone. First playable build was 100% walks. Fixed by subtracting the break
from the launch line so the reticle means "where it crosses the plate".

**The CPU hitter decided but never swung.** The read latched to prevent
re-reading, and the latch also blocked the press that was scheduled for later in
the flight. Every plate appearance ended in a walk or a called strikeout.

**Fielders chased the first bounce, not the ball.** For a ground ball the
predicted landing point is roughly ten metres from the plate, so the whole
defence converged there while the ball skipped past them into the outfield.
Batting average on balls in play was .480. Replaced with a real interception
solve: the ball's entire future path — bounces and roll included — is projected
once per 50 ms into a shared buffer, and each fielder finds the earliest point
they can physically reach. BABIP moved to .300.

**Throws had no receiver.** A relay was thrown to where a fielder happened to be
standing; that fielder then ran off to cover a base, the ball landed on empty
grass, someone retrieved it and threw it again. Plays looped until the 26-second
guard fired — 41 times in 20 games. Fixed by assigning a designated receiver who
runs to the catch point, and by making a fielder simply hold the ball when no
runner is advancing.

**Foul balls were chased into the next county.** A ball hit 127 m into foul
ground had the entire defence sprinting after it. Foul balls beyond 30 m are now
dead where they land, which is also what the seats do in a real park.

**Season games after the user's last appearance were never played, and the
schedule cursor advanced twice per game.** Between them, roughly half the
schedule stayed unplayed and the postseason could never start. Both fixed; a
test now walks a season through the exact code path the user interface uses,
because driving the schedule array directly hides cursor bugs.

### Major

**Walk-off results were snapshotted mid-play.** `finishGame` ran the instant the
winning run touched home, before the batter's own run, hit and RBI were
credited. A walk-off grand slam was recorded as a one-run win. 14 of 120 sampled
games were affected, and the wrong run differential fed season standings.
Finalisation is now deferred to the end of the plate appearance.

**Home runs charged the pitcher twice and credited RBI twice.** `scoreRun`
already booked each runner; the home-run handler added them again. Across 100
games pitchers were charged 657 runs against 469 actually scored.

**The derby swing-off crowned the wrong hitter.** Tie-break participants had
their totals reset while eliminated hitters kept their first-round numbers, and
the winner was chosen by comparing the two. In one reproduction a hitter who
finished last and never took a swing-off cut was declared champion. Roughly 10
of 31 tie-break derbies were wrong.

**Four outs could be recorded in a half-inning.** A double play plus a tag on a
trailing runner in the same tick could push the count past three.

**Two runners could occupy the same base.** A runner hovering off second during
a fly ball only "owned" the fractional position, so the runner behind was
allowed to target second as well. Fixed at the decision layer, and backed by a
hard invariant guard that runs after every movement step: runners cannot pass
each other, and two runners can never end on one bag.

**Hovering a menu row destroyed the row being clicked.** Mouse-over triggered a
full re-render, so the element under the cursor was replaced before the click
landed and every mouse click was silently swallowed. Selection now updates
classes in place.

### Found by independent review

Two fresh evaluators were given the running production build, the controls and
a rubric, and were told to prove the game was not ready. Neither was shown the
design intent or this log. Everything below came out of that pass and is now
fixed and covered by a regression test.

**A caught foul fly recorded the out but did not end the plate appearance.**
`endPlay`'s foul branch returned through `endPitch`, which preserves the count
and never advances the batting order — so a retired batter stayed at the plate
taking pitches with three outs on the scoreboard, and his plate appearance was
counted twice, drifting the batting order. Reproduced in 4% of games. Fixed by
treating a caught foul as what it is: an out that ends the appearance. Locked by
`foulout.test.ts`, which replays the ten seeds the evaluator reported and
asserts zero seconds of live play with three outs recorded.

**Player actors leaked GPU geometry without bound.** `renderer.info.memory.geometries`
climbed monotonically at about 3.6 per second of play — 236 at the start of a
session to 1741 after eight games — because a fresh `PlayerActor` was built for
every new batter and every half-inning fielder swap and nothing was ever
disposed. The JavaScript heap stayed flat, so it was invisible to
`performance.memory`. Fixed by caching geometry by body type and materials by
colour, so an actor allocates nothing at all. Measured after the fix: flat at
133 geometries across two minutes of play, and 126–146 with no trend across
eight consecutive games in eight different parks.

**Hit-by-pitch was booked as a walk and never charged to the pitcher.** The
batting and pitching ledgers disagreed in roughly half of all games, and season
leaderboards inherited it. HBP is now its own column on both lines and appears
in the box score.

**Escape opened the pause menu but could not close it**, while the HUD told the
player it would. `Escape` produced a `back` action and only `pause` closed the
overlay.

**Team select could highlight a club that was off-screen, and arrow keys could
not reach every club.** The grid's column count was derived from viewport width
and disagreed with the rendered layout at every resolution tested, and pressing
a key reset the scroll position. The column count is now read from the computed
grid tracks and the grid scrolls itself; verified at 1280x720, 1600x900,
1920x1080 and 2560x1440 that all ten clubs are reachable and none is ever
selected off-screen.

**Volume zero did not silence the game.** The convolution reverb's return was
connected past both faders, so about a third of the level survived with both
sliders at zero. The return now lands on the sound-effects fader, and a mute
control was added. Measured after the fix: analyser peak 0.000 at volume zero.

**Graphics quality did nothing on a standard display.** All three settings
rendered exactly 1,440,000 pixels at device pixel ratio 1, because the only
lever was a pixel-ratio cap. Quality now also scales the drawing buffer:
measured 1,440,000 / 921,600 / 518,400.

**Practice displayed a scoreboard, a line score and W/L pitchers** while the
menu promised nothing was scored. Practice now shows a drill label, hides the
score and hides the line score.

**A tied game had no bound.** A passive player produced a 33-inning game. From
two innings past regulation each half-inning now starts with a runner on second.
Measured over 300 one-inning games: 235 went to extras, the longest ran nine
innings, none failed to finish.

**The derby result screen reported the swing-off round rather than the contest.**
A hitter who had just hit five home runs was told he hit one.

**High contrast was a dead setting** — declared, saved, and wired to nothing. It
is now a real mode: opaque HUD panels, heavier rules and brighter type.

**The championship always seeded the user first** and always drew them against
the weakest club in the field. Seeding is now on merit for every entrant.

**Postgame batting and pitching tables overlapped**, because nesting a flex
column inside a flex column gave both a zero basis and let the first overflow
across the second.

### Moderate

**The crowd drifted into the sky.** The wave animation re-derived each
spectator's rest height from the matrix it had just modified, so the base crept
upward every frame. Rest positions now come from an immutable seat table.

**Seats were built across fair territory.** The foul-ground stands interpolated
in a straight line from the end of the outfield wall back toward the backstop,
which cuts through the infield. The bowl is now generated radially from the
fence shape, so seats cannot be in fair territory whatever the park looks like.

**Skyline props tipped over and intruded on the field.** `lookAt` was used to
orient them, which lays cones and cylinders on their sides, and the angular
spread let a "tree" appear between the camera and the outfield wall. Props now
yaw only, and stay inside the outfield arc.

**Night games were unplayably dark** — the ball could not be tracked. Lighting
was raised substantially; an under-lit park is a gameplay failure, not a mood.

**The home-run camera sat inside the seating bowl**, so the payoff shot was a
close-up of dark stands. It now stays inside the park and looks outward.

**The plate camera was blocked by the umpire.** Raised and shifted; the catcher
and umpire were also moved off the centre line.

**Errors were roughly ten times too frequent** (4.15 per three-inning game). The
fielding success model was recalibrated to about one error per team per nine
innings.

### Balance work

Recorded because the first playable build was not close, and the route matters:

| Symptom | Cause | Fix |
|---|---|---|
| 22 strikeouts per 3-inning game, zero home runs | CPU perception noise was larger than the sweet spot; neutral launch angle was 10° | Reduced perception noise; centred power swing now produces 23° |
| 43 hits per game, .480 BABIP | Fielders chased the first bounce | Interception solver |
| 0.5 doubles per game, 7 triples | Runners judged the defence from the ball's current position; extra-base decisions were all-or-nothing | Judge from the real acquisition point; per-base advance margins; cutoff penalty on long throws |
| 3.4% strikeout rate, 0.2% walk rate | Everything was contacted on 2.4 pitches per plate appearance; almost no fouls | Count-extending fouls, a per-count CPU swing table, and pitchers working off the plate |
| All batted balls within ±17° of centre | Spray was driven only by timing error, which must be small for contact to happen at all | Spray now also driven by pitch location, with a much larger timing coefficient |

Final measured balance is in [GAME_DESIGN.md](GAME_DESIGN.md).

---

## Tests performed

- **Automated:** 136 Vitest tests across 11 files — RNG determinism, ball-flight
  calibration and frame-rate independence, the swing model, baseball rules
  driven through the real engine, runner invariants, season and cup integrity,
  the derby, box-score bookkeeping, the player creator, and a 100-game batch.
- **Batch simulation:** repeated runs of `scripts/simulate.ts` at 3 and 9
  innings across all three difficulties, checking for deadlocks, invalid states
  and statistical drift.
- **Manual browser:** every screen and every mode driven by hand in Chromium via
  the in-app browser and via Playwright, including team select, quick play, an
  at-bat, a ball in play, a home run, a postgame box score, the pause menu, the
  controls screen and the player creator.
- **Production build:** built clean and captured through `vite preview` with
  Playwright at 1600×900. Zero console errors across the whole capture run.
- **Save/restore:** season created, saved, page reloaded, resumed; corrupted and
  truncated save payloads confirmed to degrade to "no save" rather than throw.
- **Audio:** confirmed the engine reaches `unlocked` after a gesture, that
  volume setters take effect, and that firing forty sounds in one frame throws
  nothing.

Evidence: `docs/screenshots/` (14 stills) and `docs/recordings/gameplay.webm`,
all produced by `scripts/capture.ts` from the production build.

---

## Remaining risks

- **Gamepad support is implemented but was verified only through the standard
  Gamepad API surface**, not against physical hardware in this environment. The
  mapping follows the standard layout and dead zones are applied radially.
- **Safari was not available for testing here.** The code uses no Chromium-only
  API; `AudioContext` is created with the standard constructor and the renderer
  uses WebGL 1-compatible features via Three.js. Safari remains formally
  unverified.
- **Long-session memory** was measured across consecutive games and is stable,
  but a multi-hour session was not run.
- **The 26-second play guard has never fired** in any validation run since the
  interception and receiver fixes. It remains in place as a backstop and logs a
  diagnostic if it ever does.
- **The enclosing directory is named after the reference game.** The repository
  itself contains no such reference, but a `zip` or `tar` taken from the parent
  would carry that folder name as its root. Rename the directory before
  packaging.
- **The player creator accepts free text for names.** Length is capped and the
  data never leaves the browser, so nothing is currently at risk; if creations
  ever become shareable or exportable, that field needs filtering first.
