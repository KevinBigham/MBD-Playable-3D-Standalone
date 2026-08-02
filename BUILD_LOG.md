# BUILD LOG

Factual record of what was built, what broke, and what was done about it.

---

## Current playable state

Complete and playable end to end.

- Title → menu → setup → game → result → rematch or return, with no dead ends
- Quick Play, Season, Championship, Moonshot Derby, Practice and the Player
  Creator all functional
- Human control of batting, pitching, fielding, baserunning and the defensive
  alignment
- Local two-player on one keyboard, or with two gamepads
- Playable on a phone: on-screen pad with situation-aware captions, landscape
  layout with a portrait fallback, installable to the home screen
- CPU plays complete games unassisted at three genuinely different difficulties
- Seasons save automatically, survive a page reload and resume correctly
- 201 automated tests pass; 120 CPU-versus-CPU games complete with zero
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

## The plate upgrade

The first release was reported as unreadable at the plate: too random, and
impossible to tell what was happening where. Both halves of that were true, and
they had different causes.

### It was too random

Every batted-ball term carried a fixed random component regardless of how well
the ball was struck, so a perfectly squared-up swing and a mishit off the end of
the bat were equally unpredictable. Aiming carefully and timing well bought
nothing you could feel.

| Symptom | Cause | Fix |
|---|---|---|
| Identical swings gave visibly different results | Exit velocity, launch angle and spray each carried a fixed-σ draw | Noise now scales `0.3 + 0.7·(1 − quality)`: a barrel is near-deterministic, a mishit is not |
| A given vertical miss was a coin flip between a line drive and a foul | The foul-back rule was a probability ramp from 0.5 to 1.0 sweet-spot radii | A threshold at 0.66 radii with a narrow jitter band that shrinks with Contact rating |
| Removing the noise made squaring up pay too well — AVG .261 → .298, BABIP .316 → .356 | Every good swing now produced the same optimal line drive | Paid back with deterministic spread, not dice: launch angle now moves with timing (`−11°·timing`), and contact off the end of the bat loses up to 30% of exit velocity |

The foul threshold was swept at 0.60 / 0.66 / 0.72 against `scripts/simulate.ts`;
0.66 was the value that returned strikeout rate and foul rate to baseline. Final
numbers, with a before-and-after column, are in [TEST_REPORT.md](TEST_REPORT.md).

### It was impossible to read

The strike zone existed, but as a thin outline occupying **6% of screen height**,
drawn from a camera 13 m behind the plate through a 40° lens. There was no
feedback after a swing beyond a one-line pip, no record of what had already been
thrown, and a 40 m/s ball approaching head-on was a few pixels wide.

| Problem | Fix |
|---|---|
| Zone at 6% of screen height | Rebuilt the shot around it: 25° lens, 2.6 m up, 5.4 m back, aimed so the zone sits at two thirds height with the release point inside the top of frame. Zone is now **21%** — 3.5× bigger |
| The zone swam around the screen | The batting camera used to drift with the hitter's cursor. It is now dead centre and completely static |
| The catcher and umpire covered the zone | At that focal length a 1.4 m figure three metres from the lens is a wall, not a character. Both are hidden for this shot only and drawn in every other one. The catcher also gained a proper crouch pose |
| No sense of what the pitcher was doing | A numbered, colour-coded tracker dot for every pitch of the plate appearance, at its real crossing point, with a legend |
| The ball was untrackable | Oversized pitched ball that grows as it closes, plus the flight path traced in the overlay from the same closed form the engine flies |
| No idea why a swing failed | A timing needle and two words under the zone — EARLY/LATE, UNDER IT/OVER IT — with the bands drawn to that hitter's own tolerances |
| Pitching was aim-and-hope | Every pitch in the repertoire draws its own preview arc into the target, in the colour of its HUD chip |
| Unclear who controls what in two-player | The matchup panel now leads with YOU BAT / YOU PITCH |

Three assists — the colour tell, the full flight arc and the crossing marker —
are gated together on difficulty (34% of flight on Rookie, 62% on Pro, never on
Ace) so information cannot leak at three different moments. The CPU receives none
of them and the ball physics are identical on every setting. The whole overlay is
switchable under Settings → Plate view.

The zone position, the framing and the occlusion clearances were derived from the
projection rather than eyeballed, then verified by screenshot at each step; the
first two camera attempts put the zone at the bottom edge and the release point
off the top of frame respectively, which is what the arithmetic in
`camera.ts` now documents.

---

## The graphics pass

Reported as still looking rough after the plate upgrade. The models were the
problem, and the stands were the second problem.

| Problem | Fix |
|---|---|
| Players were scarecrows — one box per limb, no shoulder, elbow or knee, so every pose read as a mannequin being rotated | Jointed skeleton: hips → knees → feet, torso → arms → elbows → hands, plus a shoulder yoke. All fourteen poses rewritten to drive the new joints |
| A hip turn left the shoulders behind | Arms and head reparented from the root onto the torso, so the upper body rotates as one piece |
| Trousers were derived from the club's trim colour, giving pink and lilac legs on half the league | Near-white trousers faintly tinted with the club accent; trim moved to stirrup socks and undersleeves |
| Two bare forearms were the loudest blocks on the model | Undershirt sleeves, with skin only at the wrist and hand |
| Everyone wore the same cap | Ear-flapped batting helmet for batters and runners, cap for everybody else |
| Flat blob shadows under everyone | Real cast shadows from a 1024² map framed tightly on the infield. Blobs are now the fallback, never a second layer — except on the ball, where the blob is a gameplay aid for judging fly-ball height and the shadow volume does not reach the deep outfield |
| The seating bowl was one flat dark slab with confetti scattered on it | Every tier gained a lit horizontal deck above its shaded riser, the crowd is four times denser with aisles, and a pale facade band caps the bowl |
| Nothing beyond the outfield wall said "ballpark" | A centre-field scoreboard sized and coloured per park, emissive under the lights |
| The outfield was one undifferentiated sheet of green | Warning track, on-deck circles |
| The sky was a flat wall of paint | Vertical gradient dome, recoloured per park by rewriting vertex colours in place |
| A ball in the corner could put the chase camera in row 20, watching the play through a screen of spectators | Both ball-chasing shots clamp their position back inside the fence, against the same fence curve the ball is tested against |

Everything above is procedural. The repository still contains **no binary art
asset of any kind** — the only binaries are the screenshots and the recording in
`docs/`.

The cost was measured, not assumed: frame rate is unchanged (min 73.0, mean 82.9
against 76.0 / 81.9 before), the heap is flat across eight consecutive games, and
the GPU geometry count moved from ~130 to ~220 and then stayed there. Cast
shadows are the one genuinely expensive addition, so the Performance graphics
setting drops them.

---

## Reported by a player, and what it turned out to be

A batted ball simply stopped. The play hung for most of half a minute on a
camera showing nothing but seats, and then the half-inning jumped. Three
separate defects, and they compounded into one another.

| Defect | Class | Cause | Fix |
|---|---|---|---|
| The play deadlocked after a hit | **Blocker** | The human on defence *is* the chaser, and everybody else is covering a base. A human who does not steer means nothing at all is pursuing the ball, so the play burned the full 26-second guard | Auto-fielding: 0.55 s idle and the fielder resumes chasing itself, 1.2 s holding the ball and the throw is made. Any input takes control straight back. `autofield.test.ts` plays whole games with a defence input frame that never moves |
| The chase camera framed only crowd | **Major** | The eye sat *below* a high fly and looked up at it, putting the entire outfield behind the lens. A fielder cannot be steered to a ball they cannot see | The eye is now always above the ball, and the look point is pulled toward where the ball is coming down |
| The batter's cap and helmet peak pointed backwards | Minor | The model's forward axis is +Z; the brim was authored at −Z | Flipped, and the helmet ear flap now mirrors with the batter's handedness so it is always on the side facing the pitcher |

The first two are the interesting pair: a camera bug that on its own is cosmetic
became a deadlock, because the thing it hid was the thing the player had to act
on. The guard did its job — the game never actually broke — but a 26-second
backstop firing is a failure, not a save.

---

## Pitch timing

Also reported: too little time between release and the plate to do anything with.

The mound moved from 60 ft 6 in to **68 ft**. A fastball now takes 0.48 s instead
of 0.42 s. The two alternatives were both dishonest — stretching the flight clock
while claiming 95 mph, or slowing the ball while the scoreboard still printed 95
— and moving the rubber keeps the radar readout exactly true.

The CPU is unaffected by construction: its read is budgeted in seconds *before
arrival*, so a longer trip moves its decision point later by the same amount.
Measured over 120 nine-inning games the whole change is inside the noise — .275
average against .273, 21.5% strikeouts against 21.8%, zero anomalies.

---

## Models, second pass

Pelvis so the legs attach to something, deltoid caps so the arms are not floating
off the yoke, batting gloves (bare hands on the handle were the palest thing on
the model and sat exactly where the eye goes), a jersey placket, a shadowed brow,
shoe soles, bat grip tape, and a belly on the two heaviest builds so `stocky` and
`huge` read as different men rather than the same man at two scales.

That took a player to ~34 meshes and cost real frames: minimum fps fell from 73.0
to **54.6**. The cause was the shadow pass running over every one of them — a
button, a placket stripe, a shoe sole — for no visible pixel. Restricting casters
to the fourteen big masses brought it back to **75.9 min / 86.0 mean**, better
than before the pass started.

---

## Situational baseball

The engine could hit, pitch, field and run. What it could not do was play
baseball *situations* — and measuring for them is what found three defects that
a batting average could never have shown.

### The harness had to learn to look

Batting average alone cannot tell you whether a game feels like baseball. Two
engines can both hit .275 while one turns double plays and steals bases and the
other never does. So `state.diag.texture` now counts double plays, sacrifice
flies, sacrifice bunts, steal attempts and successes, wild pitches, passed
balls, intentional walks, runners thrown out on the bases, men left on, and the
share of pitches thrown under each defensive alignment.

The first run of that harness against the existing build is the whole story of
this round:

| Per game | Measured | Should be |
|---|---|---|
| Sacrifice flies | 0.03 | ~0.5 |
| Stolen-base attempts | 8.54 | ~1.4 |
| Stolen-base success | 100% | ~79% |
| Wild pitches / passed balls | 0 / 0 | 0.7 / 0.2 |
| Doubles | 1.9 | 3.3 |

### Sacrifice flies did not exist

`decideRunnerTargets` set `mustTag` on any runner off the bag when a fly ball
was caught, and then read it like this:

```ts
if (ctx.caught) {
  if (r.mustTag) { r.target = r.tagBase; continue; }
  ...
}
```

Nothing ever cleared the flag. A runner on third went back, re-touched, and then
stood on the bag for the rest of the play while the ball came in. Releasing him
the moment he arrives took sacrifice flies from **0.03 to 0.40 per game**.

### A stolen base was a free base

`play.steal` existed in the play context and was never set to `true` anywhere in
the engine. A runner who broke on the pitch simply walked to the next bag while
the ball was in flight, `endPitch` tidied up, and the catcher never threw. The
CPU was taking **8.54 free bases a game** and none of them appeared in a box
score, because nothing incremented `sb` either.

A steal is now an ordinary live play. The catcher gathers the pitch — pop time
0.52–0.72 s by his fielding rating — the middle infielder covers, and the tag
either beats the runner or it does not. All of that is machinery the engine
already had for balls in play; `startThrowDown` only has to hand the catcher the
ball and set the phase.

The attempt rate was the other half of it. `cpuPreplayOffense` rolled the dice
on **every simulation tick**, which at 120 Hz meant a fast runner went on
essentially every pitch. It is now one decision per pitch, weighted by the
situation the way a third-base coach would weight it. Result: 1.30 attempts a
game at 76% safe, against a real 1.4 at 79%.

### Nothing could get past the catcher

There was no wild pitch and no passed ball. A breaking ball in the dirt with a
man on third was a free strike. Now a pitch that crosses well below the knees
gets a block check against the catcher's fielding and the pitch's movement;
below 0.235 m under the zone it goes in the book as a wild pitch, above it as a
passed ball, and every runner takes a base. 0.61 and 0.18 per game.

### The defence has a manager

Five alignments — normal, double-play depth, infield in, no doubles, corners in
— for the CPU manager and, on the modifier, for the human pitching.

They are **position offsets and nothing else**. There is no branch anywhere in
the outcome model. The four infielders start five to seven metres closer to the
plate and every consequence falls out of the physics that was already there: the
throw home is shorter so the run is cut off, the grass behind them is longer so
ground balls that were outs go through.

That is also why it is worth drawing. The infield visibly walks in before the
pitch, and a player who can see it can hit against it — a hidden probability
modifier never could.

Holding the modifier while pitching opens the card *and* is what puts it on
screen, so there is nothing to memorise. Across 120 games the CPU mix lands at
74% normal, 16% double-play depth, 6% no doubles, 3% infield in, 1% corners.

### Doubles: a change that was measured and rejected

Doubles ran a third below the real rate. The obvious cause looked like outfield
depth — corner outfielders stood 273 ft from the plate where real ones play
nearer 295 ft, so every ball into the gap was cut off before the hitter could
turn first.

Moving them back did produce the doubles, 2.2 to 3.0. It also produced 2.9 extra
singles a game of bloops falling in front of them, taking batting average to
**.315** and BABIP to **.393**. Extra-base hits as a share of hits actually fell,
because singles rose faster than doubles did.

The cause was the hitter, not the defence. The margin a batter-runner demands
before committing to second was −0.24 s, and at that number he pulled up at
first on balls that were plainly doubles. Moving it to −0.50 s produced 2.9
doubles with the outfielders left exactly where they were, and cost nothing in
hit rate — the hits it converts were already hits. What it costs is outs on the
bases when he is wrong, which is the honest price and a good moment in itself.

The outfield change was reverted in full. Two changes became one because the
experiment was run instead of assumed.

### What it cost

Runs are up 0.8 per game. Doubles, sacrifice flies and wild pitches all add
offence; contested steals take some back. Two 60-game batches of the identical
final build returned 9.37 and 10.30 runs, so run-to-run noise is around ±0.5 and
the 120-game figure of 10.06 should be read with that in mind.

---

## Pitch tempo, and a decision reversed

Reported again: still not enough time between release and the plate to decide
anything.

The deep mound had already spent its budget. 68 feet buys 0.48 s; 90 feet would
buy more and would also stop being a ballpark. So the pitch's flight is now
stretched by a **pitch tempo** factor — Brisk 1.0, Standard 1.3, Relaxed 1.6 —
which puts a fastball at 0.45 / 0.59 / 0.72 s.

**This reverses a position the docs used to argue for.** The old text said
stretching the flight clock while the radar printed 95 would be a lie, and it
was right about the mechanism. What it got wrong was treating "quietly" as
optional. The tempo is a labelled setting on the options screen, and the
last-pitch readout now prints the real flight time next to the speed —
`97 HEATER · 0.55s`. The stylisation is visible in the one place a hitter looks.

Three things kept it from becoming a general time dilation:

- The gravity term is shaped by the **physical** flight time, not the stretched
  one. Shaping it with the stretched clock turns every pitch into an eephus; a
  test walks both trajectories point-for-point and holds them to 1e-9 m.
- Steering integrates on the pitch's own clock, so a slow tempo does not hand
  the pitcher back the advantage it just gave the hitter.
- Nothing outside the pitch is touched: bat, batted ball, fielders, runners.

Measuring the effect on the CPU turned out to be the interesting part. The CPU
rolls for pitch steering once per tick during the flight, so a longer flight
consumes a different number of draws and the random stream diverges from the
first pitch — **two tempos on the same seed are two different games, not the
same game slower.** Every comparison is two samples, never a controlled A/B, and
`scripts/simulate.ts` grew a tempo argument so at least the parks and seeds
could be held fixed.

Two batches, disagreeing about the direction:

| | AVG | K% | R/g |
|---|---|---|---|
| 60 games, one park — Brisk | .262 | 21.3 | 7.95 |
| 60 games, one park — Standard | .267 | 22.9 | 8.43 |
| 60 games, one park — Relaxed | .262 | 21.3 | 8.00 |
| 120 games, all parks — Brisk | .282 | 21.3 | 10.06 |
| 120 games, all parks — Standard | .273 | 21.5 | 10.13 |

Standard sits above Brisk in one and below it in the other, and in the first
batch the two *extremes* returned an identical .262 and 21.3%. A real effect
does not change sign between samples. The conclusion is that tempo does not
systematically move the CPU game — and, incidentally, that this harness's noise
on batting average is about ±10 points at 120 games, which is worth knowing the
next time a nine-point "improvement" shows up. Zero anomalies and zero forced
resolutions in every batch.

---

## Playable on a phone

The whole port sits above `sim/`. `ui/touch.ts` maintains held/edge sets keyed
by the same `ActionId` the keyboard uses, and `InputManager` ORs them in for
player one, so the engine cannot tell a thumb from a key. Not one line under
`src/sim/` changed for the controls.

What the port actually needed:

- **A floating stick**, because you cannot see what is under your own thumb.
  Put a finger down anywhere in the left half and that is the stick; drag past
  its radius and the base follows so a swipe never runs out of travel.
- **Captions instead of button names.** `SWING`, `2ND`, `SL` — never `A`/`B`.
  `ui/controls.ts` is the single source, consumed by both the touch pad and the
  keyboard prompt bar, so the two cannot drift apart. An unlabelled button is
  hidden *and* disabled, so there are no dead buttons to learn to ignore.
- **A latching modifier**, because holding a shoulder button while pressing a
  face button is a two-handed gamepad idiom. Tap, it lights, the next press
  spends it.
- **Arming it re-labels the diamond** — `DEFENCE` turns the four buttons into
  `DP`/`IN`/`CORNERS`/`NO XBH`. That is what makes a latch discoverable rather
  than a thing you have to be told about, and the keyboard build got the same
  behaviour for free.
- **`visualViewport`, not `vh`.** On mobile Safari `100vh` measures the page as
  though the toolbars were not there, which puts the controls under the address
  bar. The app writes `--vw`/`--vh` from `visualViewport` and the layout reads
  those.

### Two defects the port surfaced

**A human could never call a steal.** The modifier is what tells the engine "this
diamond press is a baserunning command, not a swing selection" — and
`handleRunnerCommands` then read the same flag a second time as "go back". So a
called steal routed into the retreat branch and told the runner to go to the base
he was standing on. Every prompt bar in the game had been advertising
`SHIFT+DIR → STEAL` since the control scheme was written.

It survived every simulated game because the CPU calls its own steals through a
different path, and no test had ever pressed the button. Before the pitch the
modifier no longer selects "go back"; going back is a live-ball decision and
stays one. `commands.test.ts` now presses the button and checks the runner.

**Pointer capture could eat a press.** `setPointerCapture` throws if the pointer
is not currently active, and the throw abandoned the rest of the press handler —
losing the button entirely. Found by driving the pad with synthetic pointer
events and noticing the latch never lit. It is an enhancement, so it now fails
quietly.

### Layout verification

Checked at 932×430, 844×390, 667×375, 640×360 and 390×750 portrait, in the menu,
at the plate, on the mound and with the defensive card armed: zero overlapping
panels, zero elements off-screen, and no live touch target under 40×36 px. Six
real collisions were found and fixed this way — the pause button on the matchup
panel, the stick caption over the menu, the pitch chips across the scoreboard,
the alignment card into the readout, the header panels colliding in portrait,
and the aux buttons landing at 34 px tall on a short screen.

The desktop layout was re-checked at 1280×720 afterwards and is unchanged: the
prompt bar, the hint pane, the line score and the keyboard-key chips all behave
exactly as before, and the touch DOM is present but `display: none`.

---

## Tests performed

- **Automated:** 201 Vitest tests across 17 files — RNG determinism, ball-flight
  calibration and frame-rate independence, the swing model, the plate upgrade's
  noise ratio and overlay honesty, baseball rules driven through the real engine,
  runner invariants, season and cup integrity, the derby, box-score bookkeeping,
  the player creator, and a 100-game batch.
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

Evidence: `docs/screenshots/` and `docs/recordings/gameplay.webm`, all produced by
`scripts/capture.ts` from the production build.

---

## Remaining risks

- **Gamepad support is implemented but was verified only through the standard
  Gamepad API surface**, not against physical hardware in this environment. The
  mapping follows the standard layout and dead zones are applied radially.
- **Safari was not available for testing here.** The code uses no Chromium-only
  API; `AudioContext` is created with the standard constructor and the renderer
  uses WebGL 1-compatible features via Three.js. Safari remains formally
  unverified.
- **No real phone or tablet was available.** The touch build was verified at
  handset viewport sizes in a desktop Chromium, with the pad driven by synthesised
  `PointerEvent`s — which is enough to prove the layout, the label wiring and
  that a press reaches the engine, and is *not* the same as a thumb on glass.
  Three things in particular are unverified on hardware: multi-touch (stick and
  a button at once, which the code supports by tracking pointer ids but which was
  only ever exercised one pointer at a time), real touch latency, and frame rate
  on a phone GPU. The mobile default is Balanced rather than High for that last
  reason, but the number behind it is a guess, not a measurement.
- **iOS Safari has no Fullscreen API**, so the fullscreen setting will do nothing
  there. The layout does not depend on it — safe-area insets and `visualViewport`
  keep the controls clear of the browser chrome either way — but the row will
  read OFF no matter how many times it is pressed.
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
