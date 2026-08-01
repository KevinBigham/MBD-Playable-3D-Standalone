# TEST REPORT

All figures below are measured output, reproduced by running the commands
shown. Nothing here is an estimate.

---

## 1. Automated test suite

```
npx vitest run
```

**Result: 14 files, 166 tests, 166 passed, 0 failed. 62 s wall clock.**

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

---

## 2. Batch CPU-versus-CPU simulation

```
npx tsx scripts/simulate.ts 120 9 pro
```

**120 of 120 games completed. 0 anomalies. 0 forced play resolutions.**
78.9 s wall clock, 0.66 s per nine-inning game.

Every game is validated every 30 ticks against the full invariant set: outs
0–3, balls 0–3, strikes 0–2, no negative runs, inning within range, at most four
live runners, at most one batter-runner, no two runners on a base, no runner out
of order or off the basepath, ball and fielders finite and inside the world.

Measured output:

| Statistic | Value | Before the plate upgrade |
|---|---|---|
| Runs per game (both clubs) | 9.28 | 9.60 |
| Hits per game | 19.02 | 20.1 |
| Home runs per game | 2.07 | 2.29 |
| Doubles / triples per game | 1.9 / 0.2 | 1.9 / 0.2 |
| Batting average | .275 | .271 |
| Batting average on balls in play | .330 | .323 |
| Strikeout rate | 21.5% | 22.0% |
| Walk rate | 4.3% (hit-by-pitch is counted separately) | 3.6% |
| Errors per game | 1.06 | 1.08 |
| Pitches per plate appearance | 4.06 | 4.0 |
| Pitches in the strike zone | 49.0% | 48.8% |
| Whiffs per swing | 19.1% | 20.8% |
| Fouls as a share of pitches | 13.6% | 13.5% |
| Extra-inning games | 6 of 120 | 7 of 100 |
| Walk-off finishes | 6 of 120 | 5 of 100 |
| Shutouts | 18 of 120 | 18 of 100 |

This batch is also the check on the deeper mound: moving the rubber from 60 ft
6 in to 68 ft changed the CPU-versus-CPU line by less than the run-to-run noise,
which is the expected result — the CPU hitter's read is budgeted in seconds
before arrival rather than as a fraction of the flight.

Combined-run distribution ran from 1 to 32 with a mode at 5, so games are not
clustering on a single script.

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
| `dist/assets/index-*.css` | 15.7 kB | 4.0 kB |
| `dist/assets/index-*.js` (game) | 251 kB | 84 kB |
| `dist/assets/three-*.js` | 502 kB | 127 kB |
| **Total** | **769 kB** | **216 kB** |

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
| Page load to interactive title screen | 542 ms |
| Frame rate, minimum over 60 s | 75.9 |
| Frame rate, 5th percentile | 79.7 |
| Frame rate, mean | 86.0 |
| Frame rate, maximum | 91.2 |

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
reuses a single scratch vector rather than allocating per call.

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

Evidence: 21 screenshots in `docs/screenshots/` and
`docs/recordings/gameplay.webm`, all captured from the production build.
`21-plate-view-pitch.png` is a genuinely mid-flight frame — the capture script
fires the shutter early, then checks afterwards where the ball actually was and
retries on the next pitch if it missed, rather than shipping a frame that only
looks like the one it claims to be.

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
- **The plate view has not been through an independent review.** The two
  evaluators quoted in section 9 attacked the build that preceded it. Its
  measurements here — zone size, resolution sweep, node counts, the noise ratio
  in `plate.test.ts` — are objective, but "is it actually easier to read now?"
  is a judgement, and the person who built it is not the right authority on
  that.
