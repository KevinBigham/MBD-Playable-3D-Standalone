# TEST REPORT

All figures below are measured output, reproduced by running the commands
shown. Nothing here is an estimate.

---

## 1. Automated test suite

```
npx vitest run
```

**Result: 22 files, 235 tests, 235 passed, 0 failed. 77 s wall clock.**

| File | Tests | What it protects |
|---|---|---|
| `rng.test.ts` | 18 | Seed reproducibility for every helper, `fork` determinism, `normal` hard-bounded to ±3σ over 200 000 draws, `shuffle` is a permutation, exact `hashString` values, state round-trip |
| `physics.test.ts` | 12 | Ball-flight calibration, monotonic carry versus exit velocity, park carry ordering, frame-rate independence, grounders come to rest, fair/foul on the lines, no NaN over 2000 steps, landing prediction accuracy |
| `contact.test.ts` | 16 | Barrel and miss extremes, cursor-under produces more loft, pull and opposite-field spray for both handednesses, power-versus-contact trade measured behaviourally, contact rating widens the window, the difficulty assist is human-only, strike-zone agreement across all five body types |
| `rules.test.ts` | 16 | 24 full CPU-versus-CPU games stepped tick by tick: count and out ceilings, final phase and result, line-score sums, no ties, extra innings, walk-offs, the home team not batting when ahead, batting order never skipping, `validateState` null at every sampled tick |
| `runners.test.ts` | 19 | `computeForces` across all base-occupancy combinations, order repair, no doubled bags across six collision scenarios, position/time helper consistency cross-checked against real motion |
| `simulation.test.ts` | 17 | 100 CPU-versus-CPU games: all complete, zero anomalies, zero forced resolutions, no ties or negatives, statistics inside believable bands, byte-identical replay for the same seed |
| `modes.test.ts` | 20 | A 90-game season fully simulated, playoff seeding, one champion, the 7-match cup with no bracket hole, save/load round-trip, six corruption cases returning null rather than throwing |
| `season-flow.test.ts` | 2 | A season walked through the exact path the user interface uses — the only way cursor bugs are visible |
| `derby.test.ts` | 10 | 12 all-CPU derbies reach a final with a winner, exact out counts, winner is the leader, seed reproducibility |
| `bookkeeping.test.ts` | 6 | 120 games: result never snapshotted before the winning play is credited, every run charged to exactly one pitcher, RBI never exceed runs, home runs consistent between batting and pitching lines, derby swing-off crowns a participant |
| `creator.test.ts` | 8 | Rating pool enforced in both directions, separate pitcher pool, validation, storage round-trip and corruption handling, roster size preserved, created pitchers land on a valid staff, a league with creations completes a game |
| `foulout.test.ts` | 3 | The ten seeds an evaluator used to reproduce the caught-foul-fly blocker: zero seconds of live play with three outs recorded, batting order stays strictly cyclical, and extra innings stay bounded |
| `autofield.test.ts` | 7 | The hands-off defence deadlock a player reported: whole games driven with a defence input frame that is present but never moves, asserting the play guard never fires, that plays resolve within 4 s of what the same games take with a full CPU defence, that one frame of steering takes control back with no cooldown, and that a pitch takes longer to reach the plate than a regulation mound would allow |
| `plate.test.ts` | 11 | The plate upgrade: outcome noise measured across 200 seeds is at least twice as tight on a barrel as on a mishit, timing changes launch angle deterministically, off-the-end contact costs exit velocity, every label and normalised error matches the swing it was given, the pitch tracker agrees with the count and with the zone on 30 games, and the break preview reports exactly what the engine applies |
| `tempo.test.ts` | 7 | The pitch clock: flight time grows strictly with the tempo, the ball's path through space is bit-identical at every setting to 1e-9 m, it crosses the plate on the same spot, the pitcher gains no extra steering authority from the extra seconds, the default lands in a window a person can think inside, and full games complete cleanly at all three settings |
| `commands.test.ts` | 6 | What the player pressed versus what the game did: the advertised steal actually sends the runner instead of retreating him, going back still works on a live ball, and the captions on the buttons match the situation — including the modifier re-labelling the diamond, the pitching diamond naming real pitches, and the alignment reset staying reachable |
| `situational.test.ts` | 22 | Situational baseball: every alignment moves the right people in the right direction and never moves the pitcher or catcher; the manager's priority order across seven situations; the intentional walk fires only when it buys something; and over 24 full games — double plays turn, runners score from third on fly balls, stolen bases come back neither 0% nor 100% safe, balls get past the catcher at a plausible rate, and more than one alignment is used without the honest one stopping being the common one |
| `resume.test.ts` | 5 | A game restored from storage is the *same* game, not an approximation: the full state round-trips through `JSON.parse(JSON.stringify(...))` and both copies then run six more minutes of simulated baseball and must still serialise identically, including a snapshot taken with the ball in the air and a swing pending on four separate seeds. Also: every malformed, stale-version and already-finished payload returns null rather than a half-restored game, and the snapshot stays comfortably inside a storage quota |
| `timing.test.ts` | 4 | Input lag correction: pressing four ticks late while declaring four ticks of lag produces a timing figure identical to pressing on time to nine decimals; the same press without the declaration is measurably late (the control); and an implausible declared lag is capped rather than credited |
| `governor.test.ts` | 8 | The automatic graphics servo, tested mostly for what it refuses to do: silent until enabled, deaf to a catastrophic single frame inside an otherwise healthy window, motionless in the band between its thresholds, slow to climb and quick to fall, and — fed the frame times of a thermally limited phone that is comfortable at one rung and drowning at the next — it settles instead of oscillating forever |
| `haptics.test.ts` | 8 | Vibration restraint: silent until enabled, refuses to enable where the platform has no API, never fires twice inside 40 ms, every pattern under 200 ms total, and contact genuinely varies with how well the ball was struck |
| `tap.test.ts` | 9 | The phone control scheme: an absolute aim lands the cursor exactly where it was told and clamps to the same limits a stick could reach; steering still steers when nothing was touched; the pitcher's target is taken from the touch in the same step that releases the ball. Then the promise itself, as the whole precision curve over eight seeds — on the crossing point is hard contact every time, a hand's width off is in play but never hard, a forearm off is a foul, forty centimetres off is a swing through it. Plus the screen-to-plate solve inverting its own projection to sub-millimetre accuracy, converging from a bad starting guess, and returning null rather than a plausible lie when the camera is edge-on |

---

## 2. Batch CPU-versus-CPU simulation

```
npx tsx scripts/simulate.ts 120 9 pro brisk
```

**120 of 120 games completed. 0 anomalies. 0 forced play resolutions.**
75.7 s wall clock, 0.63 s per nine-inning game.

Run at **Brisk** tempo deliberately, because that is the pitch clock the
"before" column was measured at — comparing a balance change against a batch
that also changed the clock would confound the two. The default-tempo run is in
[Pitch tempo](#pitch-tempo) below and completes just as cleanly.

Every game is validated every 30 ticks against the full invariant set: outs
0–3, balls 0–3, strikes 0–2, no negative runs, inning within range, at most four
live runners, at most one batter-runner, no two runners on a base, no runner out
of order or off the basepath, ball and fielders finite and inside the world.

Measured output:

| Statistic | Value | Before this round | Real baseball |
|---|---|---|---|
| Runs per game (both clubs) | 10.06 | 9.28 | 8.6 |
| Hits per game | 19.76 | 19.02 | 17.0 |
| Home runs per game | 2.09 | 2.07 | 2.3 |
| Doubles / triples per game | 3.0 / 0.2 | 1.9 / 0.2 | 3.3 / 0.3 |
| Batting average | .282 | .275 | .248 |
| Batting average on balls in play | .339 | .330 | .291 |
| Strikeout rate | 21.3% | 21.5% | 22.6% |
| Walk rate | 4.3% (hit-by-pitch is counted separately) | 4.3% | 8.2% |
| Errors per game | 0.92 | 1.06 | 1.2 |
| Pitches per plate appearance | 4.02 | 4.06 | 3.9 |
| Pitches in the strike zone | 49.1% | 49.0% | 48.5% |
| Whiffs per swing | 19.2% | 19.1% | 24.6% |
| Fouls as a share of pitches | 13.6% | 13.6% | — |
| Extra-inning games | 8 of 120 | 6 of 120 | 9% |
| Walk-off finishes | 7 of 120 | 6 of 120 | — |
| Shutouts | 19 of 120 | 18 of 120 | 13% |

### Baseball texture

The harness now measures the situational game as well, because batting average
alone cannot tell you whether a game feels like baseball. This is what the round
was actually for:

| Per game (both clubs) | Before | After | Real baseball |
|---|---|---|---|
| Double plays | 2.3 | 2.28 | 1.7 |
| Sacrifice flies | **0.03** | **0.40** | 0.5 |
| Stolen-base attempts | **8.54** | **1.30** | 1.4 |
| Stolen-base success | **100%** | **76%** | 79% |
| Wild pitches / passed balls | 0 / 0 | 0.61 / 0.18 | 0.7 / 0.2 |
| Runners thrown out on the bases | 4.03 | 3.37 | — |
| Intentional walks | 0 | 0.07 | 0.15 |
| Left on base | 12.85 | 13.24 | 13.6 |
| Alignment share (normal / DP / in / no-doubles / corners) | 100 / 0 / 0 / 0 / 0 | 74 / 16 / 3 / 6 / 1 | — |

The four bolded rows were not tuning; they were defects. Tag-ups could never
release, so a runner on third dutifully returned to the bag after a catch and
then stood on it. Steals were never contested — the runner simply walked to the
next base while nobody threw. And no pitch could get past the catcher at all.

**Runs are up 0.8 per game and that is the honest cost of the round.** Doubles,
sacrifice flies and wild pitches all add offence; contested steals take some
back. Two 60-game batches of the identical final build returned 9.37 and 10.30
runs per game, so the run-to-run noise here is around ±0.5 and the 120-game
figure of 10.06 should be read with that in mind rather than as a precise
number.

### Pitch tempo

```
npx tsx scripts/simulate.ts 120 9 pro brisk
npx tsx scripts/simulate.ts 120 9 pro standard
```

The harness takes a tempo argument so the pitch-clock stretch can be run against
the same seeds. 120 nine-inning games each, same parks, same seeds:

| | Brisk (1.0×) | Standard (1.3×, new default) |
|---|---|---|
| Runs per game | 10.06 | 10.13 |
| Batting average | .282 | .273 |
| BABIP | .339 | .326 |
| Home runs per game | 2.09 | 2.31 |
| Strikeout rate | 21.3% | 21.5% |
| Errors per game | 0.92 | 1.30 |
| Anomalies / forced resolutions | 0 / 0 | 0 / 0 |

**Read the "same seeds" carefully — it does not mean the same games.** The CPU
rolls for pitch steering once per simulation tick during the flight, so a longer
flight consumes a different number of draws and the random stream diverges from
the first pitch onward. Two tempos on one seed are two independent games, not a
controlled A/B, and the table above is therefore two samples rather than a
before-and-after.

That is exactly what it looks like. A separate 60-game batch on a single park
put Standard *above* Brisk (.267 to .262) while this 120-game batch puts it
below (.273 to .282), and Brisk and Relaxed landed on the identical .262/21.3%
in that same run. A real effect does not change sign between samples. The
conclusion is that tempo does not systematically move the CPU game — which is
what the design predicts, because the CPU commits a fixed number of seconds
before arrival — and that this harness's sampling noise on batting average is
roughly ±10 points at 120 games, which is worth knowing on its own.

Determinism is unaffected: `pitchTempo` lives on `GameSetup`, so the same setup
and seed still replay byte-identically, which `simulation.test.ts` checks.

This batch is also the check on the deeper mound: moving the rubber from 60 ft
6 in to 68 ft changed the CPU-versus-CPU line by less than the run-to-run noise,
which is the expected result — the CPU hitter's read is budgeted in seconds
before arrival rather than as a fraction of the flight.

Combined-run distribution ran from 1 to 27 with a mode at 7, so games are not
clustering on a single script.

### A change that was measured and rejected

Doubles ran a third below the real rate (1.9 against 3.3). The obvious cause
looked like outfield depth: the corner outfielders stood 273 ft from the plate
where real ones play nearer 295 ft, so every ball into the gap was cut off
before the hitter could turn first.

Moving them back did produce the doubles — 2.2 to 3.0. It also produced an extra
2.9 singles a game of bloops falling in front of them, taking batting average to
.315 and BABIP to .393. Extra-base hits as a share of hits actually *fell*,
because singles rose faster than doubles.

The real cause was the hitter, not the defence. The margin a batter-runner
demands before committing to second was −0.24 s, and at that setting he pulled
up at first on balls that were plainly doubles. Moving it to −0.50 s produced
2.9 doubles with the outfielders left exactly where they were, and cost nothing
in hit rate because the hits it converts were already hits — what it costs is
outs on the bases when he is wrong.

The outfield change was reverted in full. It is recorded here because the
experiment is the reason the final build has one change instead of two.

The second column is the same measurement before the swing model was made less
random, and it is shown because the change was not free. Cutting outcome noise on
well-struck balls moved batting average to .298 and BABIP to .356 in a 60-game
batch, because squaring a ball up started paying every time instead of most of
the time. That was paid back with *more deterministic spread* — a timing term on
launch angle and an exit-velocity penalty for contact off the end of the bat —
rather than by putting the dice back. The tuning was done against this harness,
not by feel: the foul threshold was swept at 0.60, 0.66 and 0.72 sweet-spot radii
and 0.66 was the value that returned strikeout rate and foul rate to where they
started.

## 3. Difficulty is measurably different

```
npx tsx scripts/simulate.ts 40 9 <difficulty>
```

40 games each, both clubs CPU-controlled, so this measures how well the CPU
plays both halves of the game.

| | Rookie | Pro | Ace |
|---|---|---|---|
| Whiffs per swing | 26.2% | 20.1% | 14.1% |
| Strikeout rate | 29.1% | 22.2% | 15.2% |
| Walk rate | 6.6% | 4.2% | 2.7% |
| Pitches in the zone | 46.0% | 49.0% | 51.3% |
| Batting average | .287 | .273 | .283 |
| Home runs per game | 1.73 | 1.85 | 1.98 |
| Games completed | 40/40 | 40/40 | 40/40 |
| Anomalies | 0 | 0 | 0 |

The progression is monotonic in every CPU-skill measure: better contact, better
plate discipline, better command. Run scoring rises at All-Star because both
sides hit better — from a human's seat the opponent is harder in every phase.

## 4. Bookkeeping regressions

```
npx tsx scripts/verify-fixes.ts
```

200 games checked. **0 mismatches** on all three counts:

- final result versus live score (walk-off snapshot timing)
- total runs charged to pitchers versus runs actually scored
- runs batted in never exceeding runs scored

## 5. Season integrity

```
npx tsx scripts/verify-season.ts
```

**20 of 20 checks passed** across short (90-game) and standard (180-game)
seasons:

- schedule size correct; every club plays exactly its game count
- the regular season completes when driven the way the interface drives it
- league-wide wins equal losses, and runs for equal runs against
- postseason produces exactly one champion from a three-series bracket
- save round-trips; a corrupted payload returns null instead of throwing

## 6. Production build

```
npm run build
```

Type-check clean, build succeeds from a clean state.

| Artefact | Raw | Gzipped |
|---|---|---|
| `dist/index.html` | 1.05 kB | 0.50 kB |
| `dist/assets/index-*.css` | 20.3 kB | 4.9 kB |
| `dist/assets/index-*.js` (game) | 277 kB | 92 kB |
| `dist/assets/three-*.js` | 502 kB | 127 kB |
| **Total** | **800 kB** | **224 kB** |

Three.js is the only runtime dependency and accounts for 65% of the bundle. It
is split into its own chunk so game updates do not force it to be re-downloaded.

## 7. Performance and memory

```
npm run build && npx vite preview --port 4177 &
npx tsx scripts/perf.ts
```

Chromium at **1920x1080**, nine-inning All-Star game running live:

| Measure | Value |
|---|---|
| Page load to interactive title screen | 545 ms |
| Frame rate, minimum over 60 s | 73.1 |
| Frame rate, 5th percentile | 74.8 |
| Frame rate, mean | 79.3 |
| Frame rate, maximum | 89.8 |

Those numbers are **after** two graphics passes — jointed player models with
uniform detail, real cast shadows, a four-times-denser crowd, tiered stands with
decks, a scoreboard and a gradient sky. Before either pass the same harness
reported min 76.0 / mean 81.9.

The second model pass took a player to ~34 meshes and briefly cost a third of the
frame rate — **min 54.6** — because the shadow pass was running over every
decorative part: a cap button, a placket stripe, a shoe sole. Restricting shadow
casters to the fourteen big masses recovered it and then some. The lesson is
recorded because the drop was invisible by eye and only the harness caught it.

The plate view runs every frame and costs nothing measurable: it is a fixed pool
of SVG elements whose attributes are rewritten in place, and `world.project()`
reuses a single scratch vector rather than allocating per call. The defensive
card follows the same rule for the same reason: its markup is rebuilt only when
the alignment, the pitch-around state or the open/closed state actually changes,
which is twice a plate appearance rather than eighty times a second.

Leak check — eight complete match loads back to back, one per ballpark,
alternating day and night, forcing GC between samples. GPU geometries and HUD
DOM nodes are counted alongside the heap because neither shows up in
`performance.memory`, and an earlier build leaked 1500 geometries with a
completely flat heap:

| Game | Heap (MB) | Scene children | GPU geometries | HUD nodes |
|---|---|---|---|---|
| 1 | 12.1 | 29 | 243 | 151 |
| 2 | 12.1 | 29 | 240 | 151 |
| 3 | 12.1 | 29 | 242 | 151 |
| 4 | 12.1 | 29 | 259 | 151 |
| 5 | 12.1 | 29 | 240 | 151 |
| 6 | 12.1 | 29 | 248 | 151 |
| 7 | 12.1 | 29 | 252 | 151 |
| 8 | 12.1 | 29 | 243 | 151 |

**Heap change across eight games: 0.0 MB. Scene graph unchanged. Geometry count
varies with the ballpark and shows no trend. HUD node count is identical in
every game**, which is the specific claim that the plate view's element pool is
fixed rather than growing a node per pitch. Console errors: 0.

The geometry baseline moved from ~130 to ~245 with the jointed models, the
uniform detail, the tier decks and the scoreboard. That is a one-off step, not a leak: the point of the
table is that it is the same number in game 8 as in game 1. Player geometry is
still cached by body type and part, so a hundred more actors would add none.

Graphics quality was checked end to end in one session, switching between all
three settings mid-game:

| Setting | Shadow map | Result |
|---|---|---|
| Performance | off | No errors, blob shadows restored |
| Balanced | on | No errors |
| High | on | No errors |

Player actors share cached geometry and materials, and each ballpark disposes
its own geometry on unload.

### The plate view at four resolutions

The overlay is positioned by projecting real world points, so its size is a
property of the camera rather than of the window. Measured with a human at bat
and a swing verdict on screen:

| Viewport | Zone height | Zone top | Zone clipped | Verdict clipped | Legend overlaps prompts | Console errors |
|---|---|---|---|---|---|---|
| 1280×720 | 22.1% | 54.7% | no | no | no | 0 |
| 1440×900 | 22.1% | 54.7% | no | no | no | 0 |
| 1920×1080 | 22.1% | 54.7% | no | no | no | 0 |
| 2560×1440 | 22.1% | 54.7% | no | no | no | 0 |

Identical at every size, which is the point. Two collisions were found and fixed
during this sweep, both only visible at 1280×720 where the prompt bar wraps to
two lines: the tracker legend sat behind it, and the swing verdict's timing
needle was clipped by it. The legend moved up, and the verdict panel now takes
the prompt bar's real position as a floor rather than hanging blindly off the
bottom of the zone.

Note: this run used software rasterisation, which is a floor rather than a
ceiling — hardware-accelerated browsers will do better. The relevant result is
that the frame budget is comfortable even without a GPU, and that nothing
accumulates.

## 8. Manual and scripted browser verification

Driven against the **production build** served by `vite preview`, in Chromium at
1600×900, by `scripts/capture.ts`:

**Console errors across the entire capture run: 0.**

Verified in the running product:

| Path | Result |
|---|---|
| Fresh load → title screen | Interactive, with a live CPU game playing behind it |
| Main menu → Quick Play → team select → play ball | Works, keyboard and mouse |
| Human batting (cursor, contact swing, power swing, bunt, take) | Works; the cursor is sized to the hitter's own sweet spot |
| Plate view: zone, grid, corner brackets over grass, dirt and a night sky | Legible in all three; casing strokes hold up |
| Pitch tracker accumulates through an at-bat and clears on the next hitter | Correct, verified against the count |
| Flight path and crossing marker appear only after the difficulty's reveal point | Confirmed on Rookie, Pro and Ace |
| Swing verdict panel: needle position, both words, fade | Correct on hits, fouls and misses |
| Settings → Plate view off | Overlay gone, gameplay unchanged, no errors |
| Human pitching (aim, four pitch slots, in-flight steering) | Works; chips show pitch, speed and overuse |
| Pitcher's target bracket and a preview arc per pitch in the repertoire | Colours match the chips; arcs converge on the target |
| Human fielding (move, dive, throw to all four bases, switch fielder) | Works |
| Human baserunning (send, return, advance all) | Works |
| CPU offence and defence unassisted | Complete games with no intervention |
| Three-inning game to a final result | Yes |
| Nine-inning game to a final result | Yes |
| Extra innings | Observed (10 of 100 batch games) |
| Walk-off finish | Observed (10 of 100 batch games), banner and result correct |
| Home run presentation | Camera cut, distance callout, fireworks, crowd |
| Postgame box score | Line score, both batting and pitching lines, decisions |
| Pause → resume / pitching change / controls / settings / quit | All work mid-game |
| Rematch and return to menu | Both work |
| Season create → play → auto-save → reload page → resume | Works |
| Standings, league leaders, full schedule | Populated and correct |
| Postseason and champion | Reached, exactly one champion |
| Championship bracket | 7 matches, no holes, one champion |
| Moonshot Derby | Runs to a winner including the swing-off path |
| Practice drills (all four) | Endless, three outs resets the situation |
| Player creator: create, save, reload, appears on the club, delete restores | Works |
| Audio unlock after a gesture, volume setters, 40 sounds in one frame | Works, nothing thrown |
| Browser refresh on a menu | Clean restart, save intact |

Evidence: 23 screenshots in `docs/screenshots/` and
`docs/recordings/gameplay.webm`, all captured from the production build with
**zero console errors in both the screenshot pass and the recording pass**.

Three of the shots verify themselves rather than trusting the frame:
`21-plate-view-pitch.png` fires the shutter early, then checks afterwards where
the ball actually was and retries on the next pitch if it missed;
`22-defensive-card.png` holds the real modifier key and asserts the card is on
screen with INFIELD IN selected first; and `23-phone-at-bat.png` asserts the
touch pad is present, playing and captioned `SWING` before it shoots. A picture
of an empty corner, or of the desktop layout at a small size, would otherwise
pass silently.

`23-phone-at-bat.png` is taken in a real handset browser context — `isMobile`,
`hasTouch`, an iOS user agent and a 844×390 viewport at 2× — so the pad in it
turned itself on the same way it does on a phone. The `0.73s` in its last-pitch
readout is the Relaxed tempo that a touch device opens with.

## 9. Independent review

Two fresh evaluators were given the running production build, the controls and a
completion rubric, and were instructed to prove the game was **not** ready.
Neither was given the design intent, the build log, or any explanation of the
implementation. One attacked gameplay and rules; the other attacked
presentation, performance and legal cleanliness.

Both returned a verdict of **not shippable**, with reproductions. Every blocker
and major finding is now fixed and covered by a test:

| Finding | Class | Status |
|---|---|---|
| Caught foul fly recorded the out but did not end the plate appearance; team kept batting with three outs | Blocker | Fixed. `foulout.test.ts` replays the ten reported seeds |
| Player actors leaked GPU geometry without bound (236 → 1741 across eight games) | Blocker | Fixed by caching geometry and materials. `scripts/perf.ts` now reports the geometry count on every run: 126–141 with no trend |
| Team select could highlight an off-screen club; arrow keys could not reach every club | Blocker | Fixed. Verified at four resolutions |
| Volume zero left roughly a third of the level audible | Major | Fixed. Analyser peak 0.000 |
| Escape opened the pause menu but could not close it | Major | Fixed and verified |
| Hit-by-pitch booked as a walk and never charged to the pitcher | Major | Fixed. `bookkeeping.test.ts` reconciles both ledgers |
| Graphics quality was a no-op on a 1× display | Minor | Fixed. 1,440,000 / 921,600 / 518,400 pixels |
| `highContrast` was a dead setting | Minor | Implemented as a real HUD mode |
| Reduced flashing did not cover impact rings or the crowd wave | Minor | Fixed; the hint now states exactly what it does |
| Practice showed a score, line score and W/L pitchers | Minor | Fixed; drill label, no score |
| A tied game had no bound (33 innings observed) | Minor | Runner on second from the second extra inning |
| Derby result reported the swing-off round, not the contest | Minor | Fixed |
| Championship always seeded the user first against the weakest club | Minor | Seeded on merit for every entrant |
| Smallest HUD text was 10 px at 1280×720 | Minor | Raised to a 12 px floor |
| Club rating spread was 48 points (31%) | Polish | Narrowed to 23 (12%) |
| Vite chunk-size warning on every build | Polish | Limit raised past the three.js chunk |

Both evaluators also reported, independently, what they could **not** break:
zero console errors across every mode and every session, correct save-corruption
handling across eleven malformed payloads, correct local-multiplayer input
isolation in both directions, correct season and cup integrity across full
simulated seasons, and **no exploit** — 40 scripted input patterns produced at
best 0.50 runs per game, and mashing the power swing every tick produced zero.

Earlier defects found by the test-development pass — the walk-off snapshot,
double-counted home-run runs and RBI, the derby swing-off winner and the
four-out half-inning — are covered by `bookkeeping.test.ts` and `derby.test.ts`.

---

## 10. What is not covered

Stated plainly rather than implied:

- **Safari and Firefox were not available in this environment.** No
  Chromium-only API is used, but they are formally unverified.
- **Physical gamepad hardware was not available.** The implementation follows
  the standard Gamepad API mapping with radial dead zones; it was exercised
  through the API surface, not through a device.
- **No multi-hour soak test.** Memory was measured across consecutive games and
  is stable; a session of several hours was not run.
- **Audio was verified functionally** — that it unlocks, that volumes apply,
  that it never throws — but the subjective quality of the synthesis has not
  been judged by a listener in this environment.
- **No real phone was available, again.** Everything in the touch and phone
  work below was verified at handset viewports in a desktop Chromium, with the
  pad driven by synthesised `PointerEvent`s and a real handset browser context
  (`isMobile`, `hasTouch`, iOS user agent, 2× scale) for the screenshots. That
  proves layout, hit-testing, label wiring, coordinate mapping under rotation,
  and that a press reaches the engine. It is not a thumb on glass. Specifically
  unverified on hardware: multi-touch under real load, actual touch latency,
  vibration (no vibration API exists in the test browser at all — the motor code
  has never physically run), the wake lock, tab discard and recovery, and how
  the graphics servo behaves against a genuine thermal throttle rather than a
  synthetic frame-time sequence.
- **The plate view has not been through an independent review.** The two
  evaluators quoted in section 9 attacked the build that preceded it. Its
  measurements here — zone size, resolution sweep, node counts, the noise ratio
  in `plate.test.ts` — are objective, but "is it actually easier to read now?"
  is a judgement, and the person who built it is not the right authority on
  that.
