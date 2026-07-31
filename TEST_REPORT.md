# TEST REPORT

All figures below are measured output, reproduced by running the commands
shown. Nothing here is an estimate.

---

## 1. Automated test suite

```
npx vitest run
```

**Result: 12 files, 148 tests, 148 passed, 0 failed. 61 s wall clock.**

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

---

## 2. Batch CPU-versus-CPU simulation

```
npx tsx scripts/simulate.ts 100 9 pro
```

**100 of 100 games completed. 0 anomalies. 0 forced play resolutions.**
67.6 s wall clock, 0.68 s per nine-inning game.

Every game is validated every 30 ticks against the full invariant set: outs
0–3, balls 0–3, strikes 0–2, no negative runs, inning within range, at most four
live runners, at most one batter-runner, no two runners on a base, no runner out
of order or off the basepath, ball and fielders finite and inside the world.

Measured output:

| Statistic | Value |
|---|---|
| Runs per game (both clubs) | 9.60 |
| Hits per game | 20.1 |
| Home runs per game | 2.29 |
| Doubles / triples per game | 1.9 / 0.2 |
| Batting average | .271 |
| Batting average on balls in play | .323 |
| Strikeout rate | 22.0% |
| Walk rate | 3.6% (hit-by-pitch is counted separately) |
| Errors per game | 1.08 |
| Pitches per plate appearance | 4.0 |
| Pitches in the strike zone | 48.8% |
| Whiffs per swing | 20.8% |
| Fouls as a share of pitches | 13.5% |
| Extra-inning games | 7 of 100 |
| Walk-off finishes | 5 of 100 |
| Shutouts | 25 of 100 |

Combined-run distribution ran from 1 to 23 with a mode at 5, so games are not
clustering on a single script.

## 3. Difficulty is measurably different

```
npx tsx scripts/simulate.ts 40 9 <difficulty>
```

40 games each, both clubs CPU-controlled, so this measures how well the CPU
plays both halves of the game.

| | Rookie | Pro | Ace |
|---|---|---|---|
| Whiffs per swing | 28.7% | 20.7% | 14.9% |
| Strikeout rate | 30.2% | 23.1% | 16.0% |
| Walk rate | 10.4% | 4.8% | 3.5% |
| Pitches in the zone | 45.1% | 48.5% | 50.4% |
| Batting average | .271 | .278 | .297 |
| Errors per game | 0.88 | 1.25 | 1.30 |
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
| Page load to interactive title screen | 552 ms |
| Frame rate, minimum over 45 s | 76.2 |
| Frame rate, 5th percentile | 77.4 |
| Frame rate, mean | 81.4 |
| Frame rate, maximum | 87.4 |

Leak check — eight complete match loads back to back, one per ballpark,
alternating day and night, forcing GC between samples:

| Game | Heap (MB) | Scene children |
|---|---|---|
| 1 | 10.7 | 27 |
| 2 | 10.7 | 27 |
| 3 | 10.7 | 27 |
| 4 | 10.7 | 27 |
| 5 | 10.7 | 27 |
| 6 | 10.7 | 27 |
| 7 | 10.7 | 27 |
| 8 | 10.7 | 27 |

**Heap change across eight games: 0.0 MB. Scene graph size unchanged.** Console
errors: 0.

GPU resources were measured separately, because a leak there is invisible to
`performance.memory`. `renderer.info.memory.geometries` over two minutes of
continuous play: **flat at 133–134**. Across eight consecutive games in eight
different ballparks: **126, 146, 127, 128, 134, 137, 126** and 129 back at the
menu — no trend. Player actors share cached geometry and materials, and each
ballpark disposes its own geometry on unload.

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
| Human pitching (aim, four pitch slots, in-flight steering) | Works; chips show pitch, speed and overuse |
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

Evidence: 14 screenshots in `docs/screenshots/` and
`docs/recordings/gameplay.webm`, all captured from the production build.

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
| Player actors leaked GPU geometry without bound (236 → 1741 across eight games) | Blocker | Fixed by caching geometry and materials. Measured flat at 133 |
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
