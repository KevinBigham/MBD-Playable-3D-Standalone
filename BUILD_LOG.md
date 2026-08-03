# BUILD LOG

Factual record of what was built, what broke, and what was done about it.

---

## Current playable state

Complete and playable end to end.

- Title → menu → setup → game → result → rematch or return, with no dead ends
- Quick Play, Season, Championship, Home Run Derby, Practice and the Player
  Creator all functional
- Human control of batting, pitching, fielding, baserunning and the defensive
  alignment
- Local two-player on one keyboard, or with two gamepads
- Playable on a phone: you bat by touching the strike zone where you think the
  ball will cross, and place a pitch the same way. Plus an on-screen pad with
  situation-aware captions and direction-based hit-testing, a landscape layout,
  a portrait fallback that can
  rotate the game instead of the phone, left-handed mirroring, vibration,
  automatic graphics, and installation to the home screen with offline play
- A game in progress survives a locked phone, a backgrounded tab or a discarded
  one, and comes back bit-identical
- CPU plays complete games unassisted at three genuinely different difficulties
- Seasons save automatically, survive a page reload and resume correctly
- 226 automated tests pass; 120 CPU-versus-CPU games complete with zero
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

## The phone, round two

The first phone round made the game *playable* on a handset: a pad, captions, a
layout, a tempo. This round is about everything a phone does to a game while you
are playing it — the parts that have nothing to do with controls and everything
to do with the fact that a phone is not a computer that happens to be small.

### The diamond is one control, not four

Four circles at the points of a square cover 35% of that square. The other 65%
— the hole in the middle where the bases meet, and the four corners — did
nothing at all when a thumb landed there. No swing, no throw, no feedback, and
no way for the player to find out why, because their thumb is on top of the
evidence.

The diamond is now hit-tested by direction from its centre. Every point of the
square, plus a 12px transparent margin around it, belongs to exactly one button:
**2.83× more live area**, measured in the running game at 844×390. The visible
circles are labels now. That is all a target you cannot see was ever worth.

The margin is on three sides. Below the diamond is the aux row, and the first
version of this reached 8px over the top of `DIVE` and `SWITCH` and *won* there —
pressing the top edge of either fired `HOME` instead. The layout sweep did not
catch it because nothing was overlapping that should not have been; a hit-test
probe at each button's own top edge did. A press that fires the wrong call is
strictly worse than a press that fires none, and slop that reaches over another
button is not slop, it is theft.

### When you pressed, not when we noticed

Input is read once per rendered frame, so a press reaches the engine somewhere
between zero and one frame after the thumb moved: 0–17 ms on a 60 Hz phone, and
which one is pure luck about where the frame boundary fell. Against a swing
tolerance measured in tens of milliseconds that is not a rounding error. It is a
random handicap on every swing, biased entirely toward late.

The browser stamps every input event with the moment it happened, on the same
clock `requestAnimationFrame` uses. The presentation layer now reports that age
on the input frame and the engine backdates the swing by it, capped at two
frames at 30 Hz. `timing.test.ts` proves the correction is exact rather than
approximate: pressing four ticks late while declaring four ticks of lag produces
a timing figure *identical* to pressing on time, to nine decimal places — and the
same press without the declaration is measurably late, which is the control.

The engine did not gain a clock. `pressAge` is a number on `InputFrame` like
every other input, zero for the CPU and zero for every test, so the simulation
is still a pure function of its inputs and a replay of the same frames is still
the same game.

### A locked phone does not cost you the game

iOS Safari discards backgrounded tabs under memory pressure. A text message
arrives in the sixth inning and the game is simply gone — not the player's
fault, and nothing on screen warned them.

`GameState` is plain data plus exactly one class instance, so a snapshot is JSON
plus one integer for the generator position. It is written when the page hides,
on `pagehide`, on pause, and once per half-inning; **Resume Game** is the first
row on the main menu when there is one, captioned with the situation. Measured
at 26–50 KB.

The claim is strong — not "roughly where you were" but the same game — so the
test is strong: both copies run six more minutes of simulated baseball after the
round trip and must serialise byte-identically, including a save taken with the
ball in the air and a swing pending, on four seeds. `Rng.setState` was fixed
along the way: it coerced zero to a fallback, which is correct for a seed and
wrong for a restored snapshot, where all 2³² values are legal positions.

Backgrounding also pauses now, and the game holds a screen wake lock while a
game is live and releases it in the menus.

### Graphics that move themselves

A quality setting is a promise about a machine that does not change. Phones
change: the first over renders at full speed and then the case warms, the SoC
clocks down, and it stays down. Whichever fixed setting the player picks is
wrong for part of the game.

`AUTO` is a servo, and it is defined by what it refuses to do. It reads the
*median* of a 90-frame window, so a garbage collection or a texture upload
cannot move it. It climbs slowly and falls quickly. And it **gives up climbing**
after two attempts that were immediately punished — a thermally limited phone is
not going to recover while you keep playing on it, and a governor that keeps
testing produces a visible pulse in image quality every few seconds, which is
far more annoying than being one rung lower. Eight tests, all of them about
restraint. Verified end to end in the running game: Full → Lean under a
simulated 30 fps, back to Full at 100.

A 120 Hz phone panel is also asked for 60 drawn frames rather than 120 — twice
the GPU work and heat for a game whose simulation runs on a fixed clock and
whose ball is a few pixels across. The decision is *measured*, not assumed from
a device string: only a display running at roughly double the target is capped,
because on a 90 Hz Android panel "cap to 60" silently means 45.

### Turning the game instead of the phone

Plenty of people keep rotation locked on purpose. Answering them with "turn your
phone" is telling them to change a system setting for a game of baseball.

The portrait card now leads with an offer to rotate the *game*: the application
box is laid out landscape and spun a quarter turn about its top-left corner. The
renderer is simply told it has a landscape canvas and is otherwise unaware.

The cost is that pointer events arrive in the screen's frame while every element
lives in the game's frame, ninety degrees apart, and that is confined to two
functions in the touch layer. Verified with synthesised drags: screen-right of
the diamond centre selects the game's UP button, a drag down the glass reads as
the stick going right, and all four axes and all four quadrants map correctly.

Two things the trick does not fix, both documented rather than hidden: media
queries and `vh`/`vw` describe the phone, not the game. The portrait media block
is now gated on `html:not(.rotated)` — it was firing and giving a landscape game
a portrait stick zone — and the pad's sizing reads `--gw`/`--gh`, which the app
writes from the game box. Safe-area insets cannot be mapped individually without
knowing which way the phone was turned, so the rotated layout clears the largest
of them on every side.

### Vibration, and left thumbs

Glass cannot click. A press ticks; contact thumps in proportion to how well the
ball was struck, so you know you got it before the camera says so. Never twice
inside 40 ms, never longer than 200 ms in total, and only for events involving
the human's own half-inning.

`navigator.vibrate` is an Android/Chromium feature. Safari on iOS does not
implement it and the workarounds depend on undocumented behaviour of a form
control, so the setting reads `UNSUPPORTED` there rather than offering a switch
that does nothing.

**Left-handed pad** mirrors the whole layout — stick right, buttons left — and
moves the information column to the opposite side so it does not end up under
the pad. Swept for collisions in both handednesses at every viewport.

### Offline

The game has no server: no account, no matchmaking, no telemetry. Once the files
are on the device there is nothing left for the network to do, and without a
service worker the browser does not know that. A ~90-line worker fixes it. The
page itself is fetched network-first — cache-first on the HTML is how a broken
deploy becomes permanent — and the content-hashed assets are cache-first,
because a hashed URL can never mean two different things.

---

## The bat is your finger

The phone rounds up to here made the existing control scheme survive a
touchscreen. This one replaces it at the plate, because the existing scheme was
never the right one for glass — it was the keyboard's scheme with buttons drawn
on.

Swinging with a stick and a button asks two thumbs to co-operate on one
decision: steer a cursor onto a spot, press a button at an instant. But *swing
there, now* is a single thought, and a touch expresses it in a single act — a
place and a moment, delivered together. That is exactly the pair a swing is made
of. So on a phone you touch the strike zone where you think the ball is going to
cross, and the swing happens there.

### What it cost the engine

One field. `InputFrame` gained an absolute aim next to its relative one, because
"further left, and keep going" and "here" are different statements and no stick
speed converts the first into the second. It clamps to the same limits the
relative path uses, so pointing cannot reach anywhere steering could not, and it
is cleared by `clearEdges` like every other edge — pointing is an act, not a
held position. The contact model is untouched: it always took a position and a
timing error, and a touch just supplies both more directly.

### Screen back to plate

There is no inverse-project to call — a pixel is a ray, not a point. But it is a
point once the depth is fixed, and everything on the zone sits at the contact
plane, so the map is smooth and invertible. `ui/zonepick.ts` inverts it by
solving against `GameWorld.project` itself: three Newton steps, seeded from the
cursor's current spot.

Fitting a homography to the four drawn zone corners would also have worked, and
would have been a second description of the camera that could quietly disagree
with the real one. Solving against the projection cannot disagree with it,
because it *is* it — and it follows a camera move or a field-of-view change for
free. Measured against the live camera at 844×390, the round trip is exact:
**0.0 mm across the whole cursor range**, including the corners.

### The precision curve

The claim is only worth making if missing costs you, so the test is the whole
curve rather than a pass mark, measured over eight seeds:

| Off the crossing point | Result |
|---|---|
| 0 | solid or barrelled, 8/8 |
| 12 cm | in play every time, hard never |
| 24 cm | fouled off, 8/8 |
| 40 cm | swung through it, 8/8 |
| 30 cm sideways | mostly missed — the zone is narrower than it is tall |

If the scheme ever stops rewarding accuracy it has become a button with extra
steps, and that fails as loudly as it not working at all.

### The buttons keep their positions and lose their verbs

They stop *being* the swing and start choosing which swing: `CONTACT`, `POWER`,
`BUNT`, `TAKE`, sticky, with the armed one lit. Sticky because a hitter has an
approach and does not re-pick it every pitch.

That also closed a trap rather than opening one. The button that said SWING is
the same button that means "send the runner home" — re-captioning it without
disarming it would have left the second meaning live under the new label, which
is precisely the shape of the steal bug found two rounds ago. In tap mode the
press is consumed by the pad and never reaches the engine at all.

### The mound, in the order a pitcher thinks

Pick the pitch on the diamond — it arms and lights — then touch the spot you
want it to cross. The diamond no longer throws; the touch does, and it sets the
target in the same simulation step that releases the ball, so a pitcher can
never throw to the spot he was looking at a moment ago. Verified in the browser:
arming the changeup left the phase in `preplay`, and touching a spot threw a
changeup to it with 0 mm of error.

Once the ball is gone the stick comes back. Steering a pitch in flight genuinely
*is* a direction held over time, and that is the one job a stick does better
than a finger.

### The stick gets out of the way

A floating stick that owns the left half of the screen would swallow every touch
on the left half of the zone. While the field is the control the stick zone
stops listening and the stick is hidden — it has nothing to steer at the plate
anyway. Verified by hit-testing: with tap mode live, the open field returns the
tap surface everywhere including the far left, while the diamond, the aux
buttons and the pause key still win where they sit.

---

## Get it on the phone

The previous three rounds made a game that plays well on a handset. None of them
made one a person could actually *reach* from a handset — it lived on
`localhost`, on a laptop. That is the difference between "phone-ready" and
"ready to play on my phone", and closing it turned out to be less about the game
than about the four things around it.

### A URL

`npm run phone` builds and serves on every interface, so a phone on the same
wifi can play the production bundle immediately. That is enough to play today
and it is deliberately not the whole answer, because plain http costs two
things: a service worker will not register, so there is no offline play, and
neither will the wake lock, so the screen dims mid-inning. Both are HTTPS-only
by specification, and neither is a bug that can be fixed in the game.

So `.github/workflows/deploy.yml` publishes `dist/` to GitHub Pages on push to
`main`, gated behind the suite — a red branch should not also be live. The game
has no server, no account and no telemetry; it is a folder of static files, so a
static host is not a compromise, it is the correct shape. Pages was switched on
deliberately rather than by the build system — turning a repository into a
public website is a decision with an owner — and the game now lives at
https://kevinbigham.github.io/MBD-Playable-3D-Standalone/. On a fork the
workflow is inert until somebody makes the same decision.

### An icon that is not a screenshot of the loading card

The icons were SVG only, which was quietly broken on the platform it mattered
most on. **iOS ignores an SVG `apple-touch-icon` entirely** — and it does not
fail loudly or fall back to the favicon. It screenshots the page. Add to Home
Screen would have put a grey rectangle of the game's own boot card on the home
screen, so the game looked broken before it had run once.

`scripts/icons.ts` rasterises the PNGs from the same SVGs with the Playwright
already in devDependencies. Three shapes because three launchers want different
things: square corners and opaque for iOS, which rounds them itself and would
otherwise round an already-rounded icon and show the page colour through the
gap; as-drawn for anything that places it verbatim; and art inside the middle
80% for the launchers that crop.

### Being asked, once

Installed and in a tab are different games on a phone: full screen, its own
place in the app switcher, and it survives the wifi. All free, all off by
default because nobody knows to ask. Android fires `beforeinstallprompt`, which
is caught, suppressed and replayed later from a menu row — a game that opens by
asking to be installed is a pop-up; one that mentions it under Settings, after
everything a person came here to do, is an offer. iOS fires nothing and has no
API at all, so the honest thing there is to name the control in the Share sheet
and stop pretending a button could do it.

### The engine that will actually run it

Every phone claim this project had made was measured in Chromium with
synthesised pointer events. That is a good stand-in for Android and a poor one
for the iPhone, which is most of the phones this will ever run on — and the
places the two engines differ are exactly the places a phone game breaks.

`scripts/phone-check.ts` runs the production build in **WebKit**, Safari's
engine, with a touchscreen instead of a mouse, at an iPhone's size and pixel
density, in both orientations. It is an auditor rather than a screenshotter: 55
checks and a non-zero exit. It found two real bugs on its first run.

**Double-tap-to-zoom was live over the whole game.** The viewport tag says
`user-scalable=no`; Chromium obeys that and iOS Safari has ignored it since
iOS 10 for accessibility reasons. Two quick taps at a pitch — the most natural
thing in the world in a game whose entire control scheme is tapping — would have
zoomed the page. `touch-action: manipulation` is the attribute Safari does
honour, and it is exactly the right one: it removes double-tap zoom and leaves
alone the scrolling the longer menus genuinely need.

**Pinch-to-zoom was live too**, and `touch-action` does not reach it. iOS routes
pinch through proprietary `gesture*` events above the touch stream, so the only
way to say no is to refuse them. Refused for touch devices only — a desktop
Safari user pinching a trackpad is asking their browser to zoom, and that is
theirs to ask for.

The harness also caught one thing it turned out to be wrong about: a 237 mm
error on a rotated phone, which was the *test's* forward projection, not the
game's inverse. Worth keeping rather than deleting, because a forward map worked
out independently from the transform is what makes the round trip evidence
instead of a tautology. Corrected, it reads **0.51–0.92 px** — measured in pixels
rather than millimetres, because a phone held sideways gives the strike zone
about ninety pixels and a millimetre figure would flatter a large screen and
libel a small one.

And it answered a question nobody had asked: **is the whole strike zone actually
touchable?** The swing is a touch on the field and the buttons are also on the
field, so anywhere they overlap is a part of the zone a hitter simply does not
have — no amount of accuracy in the solve fixes it. An 81-point grid over the
full cursor range, each point asked who would receive that touch: 81 of 81
belong to the zone.

Finally, the production build was served over the LAN and opened in **actual
Mobile Safari** on an iOS 26.4 iPhone 17 simulator. Real WebKit, real iOS, real
Safari chrome. It boots and lays out correctly under the Dynamic Island and
above the floating address bar — and so does the deployed https site.

Running the audit over the internet rather than over localhost then failed three
times in a row, each failure looking exactly like a product bug and each one
being a hole in the harness. Worth writing down because the pattern is the same
every time: **a probe that does not state the conditions under which its
measurement is meaningful will eventually take a reading under some other
conditions and blame the product.**

The first waited for a phase but not a half-inning — and the CPU hitter drives
the same `batter.cx/cy` the touch controls do, so a probe landing in the bottom
half measured the CPU's cursor: 130 px "wrong". The second measured across a
camera still easing into place after the quarter-turn, so the round trip left
through one projection and returned through another; the game has no such
problem, because it inverts the live camera at the instant of the touch. The
third took a reading from a touch the game had correctly refused — between a
strikeout and the next hitter the phase is `lineup` and the field is not an
input, so the cursor stays put and the distance to it gets reported as a mapping
error.

The last one is the one worth keeping in mind: "the touch did nothing" and "the
map is wrong" produce the same number and are completely different findings. The
probe now checks that the cursor actually moved and retries if it did not. The
map itself was never in question — tapping one plate point six times in the
rotated layout gives 0.50 px, every time.

### Making the scheme visible, and then shutting up

Touching the zone is a better control scheme than steering a cursor and it is
completely invisible. Nothing on a phone screen says the field is the input, so
somebody who has held a controller before looks for the button, finds one
labelled CONTACT, presses it, and watches strike three.

So for the first three swings the game says it, under the zone: **TOUCH WHERE IT
WILL CROSS**. Two rules keep it from becoming furniture. It is dismissed by
doing it rather than by reading it — three touches and it is gone. And the count
is kept forever rather than per game, because a hint that returns every time you
press Play is not a hint, it is a label, and a label you have read a hundred
times is noise you have learned to look past. Batting and pitching are counted
apart; a hundred swings says nothing about whether somebody has ever stood on a
mound.

It sits *under* the zone rather than over it, which took a bug to work out. Over
the zone is the middle of the screen, which is where the game shouts TOP 1ST and
the club's name at the start of every half-inning, and a hint that has to fight
a banner for the same pixels loses and looks broken while losing. Under the zone
is where the verdict panel already goes — which is not a collision but the
point: two answers to the same question, never both worth having, and one place
on screen that always means "about your swing".

### Where you swung, and where it was

The verdict panel already said *how* a swing was wrong — early, under, over. That
is the right answer for a scheme where you steer a cursor and press a button,
because the two errors are made separately and fixed separately. Touching the
zone collapses them into one act: the player made a single decision, that spot,
now. So the useful feedback is a single picture. A hollow ring where the finger
went, a filled dot where the ball actually crossed, a dashed line across the
gap, coloured by outcome and told apart by shape as well as colour.

Six inches high reads instantly as six inches high. "UNDER" has to be translated
first.

The two points are recorded on the swing rather than recomputed, because by the
time anything draws them the pitch is over and the cursor has moved on — four
display-only numbers on a struct whose own comment already says nothing in the
rules or the physics reads it. A ball put in play takes the camera to the field
and the marks go with it, so what this mostly ends up explaining is the strikes.
That is the right bias: nobody needs telling why the double was a double.

---

## Wiring in Mr. Baseball Dynasty

MBD is the user's dynasty simulator: thirty-two franchises, real rosters, ratings
that develop, a schedule that advances, a save that has to stay true. This is
the arcade game those people should be able to play *in*. The arcade
world bridge handoff defines the seam, and this round built the half that lives
here — the **arcade consumer**, which is item 2 on the handoff's own
implementation order.

### The rule everything else follows from

**MBD is the world authority.** This game never owns contracts, promotions,
trades, ratings development, schedule progression, standings, or save history. It
owns the game in progress, and it hands back a receipt of what happened.

That sounds like a governance note and is actually a design constraint with
teeth, because the failure it prevents is invisible. Two games that disagree
about the same dynasty do not crash. They just quietly become two dynasties, and
nobody finds out until a player notices their ace has the wrong ERA in one of
them. Every rule in the contract — ids are the joins, never match by name; reject
rather than repair; apply a modifier once and record it; one scheduled game
settles once — exists to make a disagreement *loud*.

So the bridge is five pure modules under `src/bridge/` with no DOM anywhere in
them, and `ui/world.ts` as the only part that touches files, storage or menus.

### Three decisions, made once and written down

**Ratings convert from `internal`, never from `arcade99`.** MBD publishes each
rating in four scales: canonical 0–550, a 20–80 scouting grade, a 0–1 normalized
value, and a 0–99 arcade convenience. This game's own attributes sit on 20–99,
so `arcade99` is *almost exactly* the right number and is right there — which is
precisely what makes it the wrong one to use. It has already been rounded into a
hundred buckets, and 550 source values into 80 arcade values is lossy enough
without doing it twice. There is a test that corrupts `arcade99`, `display` and
`normalized` on a rating and asserts play is unchanged, and a separate one that
notices the drift and warns.

The contract also demands monotonicity in one sentence: "a higher source rating
cannot secretly make the corresponding skill worse". That is a property, not an
opinion, so it is swept — all 551 internal values of every rating, and both
inputs of the single blended one, independently. A monotonicity bug from a
rounding or weighting mistake shows up at two adjacent values and nowhere else,
which is exactly the kind of thing spot checks miss and sweeps do not.

**A park factor picks a ballpark.** This is the decision the handoff explicitly
asks to be made once, explicitly, and it is the most interesting thing in the
round.

MBD carries a park factor per club, 0.95 to 1.12, and — the handoff is careful to
say so — does *not* pass it into its own plate-appearance resolution. So there is
no simulation behaviour to copy and no parity to inherit. The obvious move is to
multiply something: carry, exit velocity, home-run distance. That would be a
second modifier laid on top of a ballpark this game already simulates in full,
with real fences at real distances and real heights and real air. Denver would
get thin air *and* a 12% bonus, and nobody would ever see the double-count
because both halves are invisible.

This game's eight parks carry from 0.98 to 1.11, which covers MBD's range almost
exactly. So the factor **chooses the park**. It is applied once, as geometry a
hitter can see and hit over, and the choice is recorded per club in the bridge
report. Denver's 1.12 lands at Summit Field, the thin-air park; San Francisco's
0.95 lands at Grove Park, the one that swallows fly balls. There is a test that
would fail if those two ever came out the other way round — numerically
defensible and obviously wrong is a failure mode worth naming.

**`stuff` becomes the arsenal.** MBD grades a pitcher on stuff, control, stamina,
velocity and movement. This game has four of those and no `stuff`. Adding one
would mean retuning the entire pitching model — a balance change smuggled into
the codebase as an import feature, in the one place nobody would look for it.

But "stuff" means deception and swing-and-miss quality, and this game already
expresses exactly that through what a pitcher can throw: a power arm with two
pitches is hittable, and the same arm with a splitter is not. So stuff sets
arsenal depth, and a small share of movement, blended rather than summed so that
raising either source rating can only help. The report says where it went, because
a reader deserves to know what happened to a source rating rather than finding it
absent.

### Rejecting is a feature

The validator is fail-closed and the temptation it resists is *helpfulness*. Fill
in the missing ninth hitter. Pick another starter. Skip the player whose team id
does not match. Every one of those produces a game that looks like the dynasty
and is not — and the receipt it generates is then a lie MBD has no way to detect.

Eight negative tests, each of which is a real export failure: duplicate ids, a
roster claiming another club's player, an eight-man lineup, somebody batting
twice, an ineligible hitter in the order, a starting pitcher with no pitcher
ratings, an unavailable player in a game, and a modifier id that appears twice —
that last one because a duplicate means the receiver cannot honestly claim to
have applied each modifier once.

### What this game had to make up

MBD has no handedness, jersey number, height, weight, secondary positions, pitch
repertoire, stadium or weather. This game cannot draw a single frame without most
of those. So it invents them — deterministically, from each player's own MBD id,
so two devices importing the same save produce byte-identical people — and then
prints exactly what it invented on the World screen, next to exactly what it
ignored. The contract's phrase is "never writes those defaults back as MBD
truth"; the mechanism is that the receipt has nowhere to put them.

### Playable today

MBD has no exporter — that is gap #1 on the handoff's own list, and it is not
this repository's to close. Waiting for it would have meant building an entire
consuming half with nothing to point it at. So `fixture.ts` generates a
conforming bundle from the real franchise catalog, and **MBD Sample World** is a
menu row: thirty-two clubs in their own colours, with generated rosters, playable
now. Boston at Denver in Summit Field, Vero Lachance batting with CON 57 · POW 80,
zero console errors.

### What was deliberately not built

Nothing emits a receipt. `buildReceipt` and `reconcileReceipt` exist, are pure,
and are tested against real games played through the real engine — but MBD cannot
yet reserve a scheduled game for external play (gap #2) or accept one back
(gap #3). A download button would be the appearance of a closed loop rather than
a loop, and the appearance is worse than the absence.

Season and the cup also stay on the Meridian Circuit. That is the contract's own
division, not a limitation invented here: an exhibition package is defined for
non-dynasty modes and "produces no importable dynasty receipt", so a 162-game
season played with MBD clubs would be this game inventing dynasty history MBD has
no way to accept.

One real bug fell out of the work: the team-select screen walked the hardcoded
ten-club identity table and looked each id up in the loaded league. With
thirty-two MBD clubs loaded it found none of them and handed `undefined` to the
rating helper. It now walks the loaded league, which is both the fix and the
thing it should always have done.

---

## Opening in the MBD world

Shipping the bridge was not the same as wiring it in. A fresh visit still landed
on the Meridian Circuit and the MBD clubs were three menus away, which is a
strange thing to say about the world the game is *for*. Making it the default
turned out to be one line and three bugs.

### Three helpers that only worked because there had only ever been one league

`nextTeamId`, `shiftTeam` and `homeStadiumOf` all walked `TEAM_IDENTITIES` —
this game's own ten clubs. That was correct for as long as there was exactly one
possible league, and it is the shape of assumption that survives review forever
because nothing is wrong with it until something is.

With thirty-two MBD clubs loaded, none of them crashed. That is the problem.
Quick Play's left and right cycled through ten clubs that were not in the game,
and every lookup fell through to a default — so the label changed to a club you
could not play and **every ballpark quietly became Anchor Yard**, throwing away
the park-factor decision the bridge had gone to some trouble to make. Denver at
Anchor Yard, silently, forever.

They now take the loaded league. `homeStadiumOf` keeps the built-in table as a
*fallback* rather than a source, because a saved season holds Meridian club ids
and has to keep finding its parks while an MBD world is on the field for
exhibitions. And all three moved out of `ui/app.ts` into `data/teams.ts`, which
is where pure functions about a league belong and — not coincidentally — where
they can be tested.

Four tests now cover it: cycling stays inside the loaded league and comes back
where it started, the avoid-this-club rule holds in both directions, all
thirty-two imported clubs get their own park rather than a shared default, and a
Meridian club id still resolves while an MBD world is loaded.

### A default that is not a decision

The other bug was subtler and appeared while verifying the first one. The boot
default called `loadSampleWorld()`, which persisted the choice — so the first
launch wrote `{world: 'mbd'}` into storage before the player had chosen
anything.

That is fine until the day the default changes, at which point every existing
install is pinned to the old one by a decision nobody made. Worse, it makes a
deliberate choice of the Meridian Circuit indistinguishable from never having
opened the game.

So `restoreWorld()` now returns three things rather than two — a world, the
string `'meridian'`, or `null` for a genuine first run — and the default does
not write. Only the World screen does. The verification probe that caught it was
checking `localStorage` was empty on a first visit, which it now is.

### What the choice governs

Quick Play, Practice, the Derby and Clubs & Rosters — everything the contract
calls exhibition play. Seasons and the cup stay on the Meridian Circuit, and the
rows now say so in their own hint rather than only in a toast after you press
them, which is the difference between a rule and a dead end.

Verified on a brand-new browser profile against the deployed build: nothing
stored, thirty-two clubs loaded, seven distinct ballparks, the main menu reading
`WORLD  MBD · 32`, Quick Play opening on New York at Philadelphia, cycling
staying inside the league, and a real game starting Cleveland at Philadelphia in
The Foundry. Zero console errors.

---

## MBD's actual players

The sample world's clubs were real and its players were mine — generated by a
fixture because MBD had no exporter. That is a reasonable thing to ship as a
stand-in and a bad thing to leave in place, because it is the sort of gap that
stops being mentioned.

MBD is a pnpm monorepo with a 36 kB deterministic player generator. There were
two ways to get its rosters, and only one of them is honest.

**Porting it would have been the wrong answer.** A faithful re-implementation is
a second copy of somebody else's canon, and the copy starts drifting the moment
either side is touched — silently, because nothing fails. The players would just
gradually stop being MBD's players while continuing to look like them.

So `scripts/export-mbd-world.ts` **runs MBD's own code**. It imports
`generateLeaguePlayers`, `buildRosterState`, the franchise table and the
authored-content loader straight out of a checkout, and mirrors the opening
sequence from MBD's `buildNewGameState` — including the `rng.fork()` order,
which matters: reproducing those calls out of sequence produces a different
league from the same seed, which is a subtle way of not actually exporting MBD's
opening day.

It generated 5,408 players across 32 organisations, which is exactly the
"169 players per organization" the handoff describes. 896 of them are on MLB
rosters and can take the field; those are what ships. 1.3 MB of JSON, 78 kB
gzipped — smaller than the stylesheet.

One detail worth the trouble: MBD pins `pure-rand@7` and a plain `npm i` gave
version 8. Different PRNG, different players. Pinning to the version in MBD's
lockfile is the difference between exporting MBD's league and exporting a
plausible one.

Three things the exporter deliberately drops. **Hidden scouting truth** —
ceiling, floor, potential, development program and trajectory — because the
contract forbids exporting it into a match package; MBD attaches those in a
later step the exporter simply does not run, rather than generating and then
deleting them. **Money**, which nothing in a played game reads and no receipt may
change. **The minors**, because an exhibition package needs the people who can
take the field. There is a test that asserts none of those fields exist on any
shipped player.

The club colours came from source too. They live in a React component rather
than shared data — gap #7 in the handoff — so the exporter scrapes them out of
`TeamLogo.tsx` and throws if it cannot find all thirty-two. Scraping a `.tsx` is
a hack; transcribing thirty-two palettes by hand is a copy that stops matching
the day somebody adjusts a shade.

### Real data found a real bug

The fixture built its lineups from a position template, so every one of them had
exactly one of each position. MBD's do not. Without a saved plan its policy is
the nine best hitters by overall rating, full stop — and Kansas City's opening
day is a shortstop, a centre fielder, **two catchers, two left fielders, two
first basemen** and no second baseman anywhere in it.

The adapter assigned the field the obvious way: for each defensive slot, find
the lineup player who plays there, otherwise pull somebody off the bench. Against
a templated lineup that is correct. Against a real one it produces a team where
two men field and never bat, which is not baseball — and it passed every test,
because no fixture lineup ever had a gap.

The assignment now runs the other way round. The nine who bat are the nine who
play, and this game works out where they stand: primary positions honoured
first, then whoever is left fills whatever is left, and the last man out is the
designated hitter. MBD decides who plays; that is its roster. Where they stand is
this game's business, and a first baseman at second is a manager's problem rather
than a phantom.

### Fetched, not bundled

896 players parsed inside the main script is a megabyte a phone waits on before
the first frame, for a league nothing on the title card is made of. So the game
boots in the Meridian Circuit, fetches MBD in the background, and swaps — while
somebody is still looking at the title card. The attract game restarts rather
than finishing an inning with clubs the game is no longer in.

The world is in the service worker's shell, because an installed copy that
cannot fetch it would quietly open in a different league, which is exactly the
silent substitution the bridge exists to prevent. If the fetch fails anyway, the
fixture stands in — thirty-two MBD clubs with invented players is a far smaller
surprise than a different league and no explanation.

Verified on the deployed site: Kansas City's roster reads Alejandro Fuentes at
short (89 contact, 91 power, 86 speed), Wade Rocha in centre, Marcus Fontaine on
the mound. Those are MBD's people.

---

## Models, third pass: turned instead of stacked

The joints were right and the shapes never were. Two earlier passes had built a
proper skeleton — hips, knees, shoulders, elbows, a torso that carries the arms
so a hip turn moves the whole upper body — and every one of them hung boxes on
it. A box has one fatal problem as anatomy: **it is the same width all the way
along.** An arm is thick at the shoulder, thin at the wrist and round at the
elbow, and no amount of joint work makes a rectangular prism read as one. The
players moved like athletes and were built like furniture.

A lathe fixes it for almost nothing. `LatheGeometry` spins a 2-D profile around
its own axis, so one profile buys a taper *and* rounded ends *and* smooth normals
in a single mesh — no joint spheres to fill the gaps, no extra draw calls. Every
limb is now the same function at different numbers, which is a fact about limbs
rather than a shortcut.

The torso is the clearest win. It used to be four boxes — waist, chest, shoulder
yoke, and a belly for the heavy builds — stacked into a visible staircase,
because a box cannot narrow. It is one profile now, and the heavy builds differ
by a wider waist radius rather than by an extra mesh. A chest is squashed
front-to-back by scaling the mesh, because a torso is an oval from above and
modelling that would have cost something.

Cost: a limb went from 12 triangles to about 160, and **the draw calls did not
move** — 230 before, 235 after, and the five are the jersey numbers. Eighteen
players on the field is under 40 000 triangles, which is less geometry than the
outfield wall. The perf harness reported no change: min 73.7, mean 81.1, heap
flat across eight consecutive games. Draw calls are the budget on a phone and
triangles are not, which is exactly why this was affordable.

### The bug that made everything a barrel

The first render came out looking like bowling pins, and the cause is worth
writing down because it is the sort of mistake that type-checks perfectly.

The old model's numbers were **box dimensions** — full widths and depths. A lathe
profile takes a **radius**, which is a half-dimension. Every z-scale derived from
one of the old depths was therefore exactly twice what it should have been, and
the torso came out *deeper than it was broad*. Reusing the old constants felt
like the careful thing to do — the plate camera's clearances were derived from
them — and it was, right up until the units changed underneath.

### Two details, zero draw calls

At the plate camera the batter's back is most of the frame, and the head is a
blank shape. Both wanted detail; neither was worth a draw call, because
seventeen more per player is three hundred across a fielding side.

So both are merged. A **face** is a brow and two eye sockets baked into one
buffer in one dark tone — which at any distance this camera reaches is what a
face looks like, and which replaced a dark stripe painted across a cube to say
which way it was pointing. A **jersey number** is seven-segment digits, drawn the
way a scoreboard draws them, merged into one mesh on the back. Text geometry
would have meant a font, a loader and a binary asset, none of which exist in this
project by design.

The merge helper is twenty lines of local code rather than three's
`BufferGeometryUtils`, because pulling that in for one function adds it to the
bundle a phone downloads.

---

## Hats, and a harness that would have caught them

The report was "you can't tell the pitcher and fielders are wearing hats." They
were not. The cap crown was a squashed dome whose top sat at `0.857 × headR`
while the skull it was meant to cover reached `1.08 × headR` — so every fielder
on the field wore a hat with a hole in it and a bare scalp coming through, and
from the fielding camera, which looks *down*, there was no hat visible at all.

This is the same failure as the barrel bug one round earlier, and from the same
cause: the `0.92` squash was tuned against the old cube head, whose half-height
was `headR`. The lathe skull that replaced it is taller than a cube half. A
constant carried across a change of primitive, type-checking perfectly the whole
way.

Two more things fell out of the same close look:

- **The brim was a whole disc pushed forward**, which put as much of itself
  around the back of the skull as out over the eyes. From above it read as a
  collar. `CylinderGeometry` takes a theta range, so the bill is now the forward
  half only and the half that was never a bill is not built.
- **The number was on the chest and mirrored, and the button placket was down
  the spine.** The model's front is `+z` — that is where the face is, and every
  caller aims a player with `atan2` so `+z` points at what he is looking at —
  and both were built on the opposite assumption. The jersey numbers added last
  round were therefore invisible in the plate camera they were added for, which
  is the one shot that looks at a hitter's back all game.

The bill is in the club's second colour. A cap the same colour as the jersey
under it is a silhouette with nothing in it at the distance this is nearly
always seen from, which was the whole complaint.

The face went from three flat boxes — a brow and two eyes — to one band curved
to the skull. A flat panel on a curved head has to poke through at its corners
in order to be visible at its centre; that is geometry, not tuning, and it is
what put a dark rectangle out through the side of every cap.

### scripts/model-shot.ts

None of this was found by looking at the game, because at 1600×900 a head is
nine pixels tall. `npm run shots` parks the real camera two metres from a
player, renders one frame from the real scene with the real lights, and writes a
PNG. Five framings: the pitcher head-on and close, the shortstop from high and
behind the way the fielding camera sees him, the shortstop from *beyond* him
looking back — the only reliable look at the back of a uniform — and the hitter
from behind the plate as a control, since the batting helmet already worked and
a cap change could quietly damage it.

The canvas is read inside the same `evaluate()` that renders it: WebGL clears
its drawing buffer on the next composite unless `preserveDrawingBuffer` is on,
and it is deliberately off. Doing both in one synchronous block is what makes
the read legal, and it also stops the app's own animation frame putting the
camera back.

Every framing is computed from where the players actually are. The first version
had the mound typed in from a constant and produced two immaculate photographs
of an empty outfield.

---

## The name on the door

The game is Mr. Baseball Dynasty. It had been shipping under a working title.

Renamed everywhere a player can see it: the boot card, the title screen, the
browser tab, the home-screen label, the manifest, the main menu, the rotate
gate, the WebGL failure notice and the `noscript` line. Both marks stack two
lines now — twenty characters where there were thirteen, and one line on a
320px-tall landscape phone either overflows or shrinks to something nobody would
call a logo. The second word is tracked out to measure about the same as the
first, which is what makes them read as one mark instead of a heading with a
word under it.

The icon is a crowned baseball. A ball on its own is every baseball game there
has ever been; *Dynasty* is the word that says which one this is, and the crown
sits on the ball rather than beside it so the mark stays a single silhouette —
all a 60px home-screen tile can hold. The service worker cache generation is
bumped, because the icons and the shell changed identity rather than content and
a generation flip is the only thing that evicts an installed copy still wearing
the old tile.

Three deliberate exceptions:

- **`localStorage` keeps the `moonshot9:` namespace.** Every season, created
  player and part-finished game a person already has is under it, and
  localStorage has no rename. Changing it would not migrate those saves, it
  would orphan them. A migration could be written; it has not been.
- **`hashString('MOONSHOT NINE')` stays in the RNG tests.** It is a fixture
  whose only job is that the number beside it never moves. Rewording it to match
  the rename would throw away the one thing it is for.
- **"ABSOLUTE MOONSHOT" stays** as the banner for a home run past 450 feet. It
  is what announcers call one.

`bridge/` needed a vocabulary decision rather than a search and replace, because
the arcade game now carries the same name as the sim on the other side of the
seam, which makes "MBD" ambiguous exactly where it can least afford to be.
Throughout the bridge, **MBD** means the dynasty sim and **the arcade game**
means this one; the wire format keeps its agreed `mbd-arcade-*` names, which are
not ours to rename. The receipt's build id moved from `moonshot-nine/1.0` to
`mbd-arcade/1.0` — a receipt records which build settled a game, and this is
genuinely a different one.

The title card also learned to correct itself. Its tagline names the league
actually on the field, and the league arrives from a fetch *after* the card is
already up — so on a first launch it said "The Meridian Circuit" over a game
about to be played with MBD's thirty-two clubs. It now re-renders when the world
lands. Its click handler moved to the constructor as part of that: a listener
added inside `render()` would be added again on the redraw, and one tap would
start the game twice.

---

## One hit a game

The report was "I'm lucky if I get 1 hit per game because it's so damn hard."
That is about a tenth of what a real lineup gets, so the first job was to find
out whether the game was hard or the player was unlucky, and the existing
harness could not tell me. The CPU-vs-CPU batch reads the pitch's true crossing
point and true arrival time straight out of the state and swings at them; it
measures the physics and the rules and says nothing whatsoever about aiming at a
moving target with a thumb.

### scripts/hitting.ts

So: full games through the real engine with a hitter that is **wrong on
purpose**. It reads the truth and then corrupts both numbers with a fixed error
model before doing anything with them. That corruption is the human; everything
downstream is the engine a person plays.

The error is sampled **once per pitch** and then committed to. A person forms a
read and acts on it; they do not re-roll their opinion sixty times a second on
the way to the plate, and re-rolling would average the error away and report a
hitter far better than the model describes.

It is a sweep rather than a number, because the honest answer depends on how
accurate the player is and nobody here knows that figure for a real thumb on real
glass. The sweep says "at this accuracy, this many hits", and the player's own
report locates them on it — at about 0.20 m and 0.13 s, which returned **1.5 hits
a game, a .052 average and an 84% strikeout rate**. The game was hard.

The first run of it reported zero hits for every row, which was not a difficulty
finding: a human-controlled side also has to pitch, and a side that never throws
deadlocks the game. Nine innings that never happened.

### Which error, measured before turning any knob

Two isolating rows — nobody has 2 cm hands and 130 ms timing, but they answer
"which of these is killing me" instead of "which knob is nearest":

| Isolated error | Hits/9 |
|---|---|
| Timing only, 0.130 s | 8.0 |
| Placement only, 0.20 m | 5.3 |
| Both together | 1.5 |

Roughly equal damage. And the assist that existed widened **only the timing
window** — so half of the mistake a player actually makes was being forgiven and
the other half was not. On a phone that is close to backwards: the swing *is* a
touch at a place, one act sets the cursor and starts the bat, so being wrong
about the crossing point is being wrong about position and timing at once.

### What changed

`ASSIST` now carries `reach` alongside `window`: ×2.0 / ×1.7 / ×1.0 on the sweet
spot and ×2.1 / ×1.75 / ×1.0 on the timing, for Rookie, Pro and Ace. Both axes
scale by the same figure, so which pitches are hard to reach never changes with
the setting — only how wrong you may be about them. Everything downstream is
expressed in units of these two, so the fair-ball band and the barrel widen in
proportion for free.

Ace is deliberately 1.0 on both. It is the setting that promises no assist and it
has to keep meaning that; `contact.test.ts` now asserts a human on Ace receives
the *identical* profile the CPU receives, on every swing kind.

The second half is information rather than forgiveness. `PITCH_TELL_REVEAL` — the
fraction of the flight before the hitter is shown where the pitch will cross —
went from 0.62 to 0.38 on Pro and 0.34 to 0.16 on Rookie. Pro at 0.62 was the
meanest number in the game: seeing the crossing point is not the end of a
hitter's job, it is the *start* of it, because a thumb still has to travel there
and touch, and a third of the flight is not enough time to do that in.

Because the plate view draws the cursor from the same `rx`/`ry`, the assist is
visible — the cursor is a different size on each setting rather than a hidden
thumb on the scale.

| Player's error | Rookie | Pro | Ace | Before |
|---|---|---|---|---|
| 0.15 m / 0.090 s | 18.3 | 12.0 | 2.0 | 4.0 |
| 0.20 m / 0.130 s | 8.8 | 5.6 | 0.8 | 1.5 |

The CPU batch is identical to the digit afterwards — 10.06 runs, 19.76 hits,
.282, .339 BABIP — which is the proof that the assist is gated where it claims
to be.

### A test that was measuring the wrong thing

`tap.test.ts` asserted the precision curve in **centimetres**: a hand's width off
is in play but never hard, a forearm off is a foul. Those distances are exactly
what the assist changes, so it was a test of one difficulty setting wearing the
costume of a test of the control scheme, and it failed the moment the setting
moved.

It is written in units of the hitter's own sweet spot now, so it keeps testing
the *shape* of the promise while the scale of it is tuned. Two of its assertions
also had to start judging the **achieved** offset rather than the requested one:
the cursor is clamped to where a bat can actually go, so a tap aimed 60 cm above
a high pitch lands lower than it asked to, and demanding a miss from it is
demanding a miss from a swing the game never allowed. On an outside pitch there
is no outward offset large enough to miss with at all, which is why the sideways
case now crosses *through* the ball to the far side.

### What is not measured

The harness models a person as unbiased Gaussian error around the truth. That is
generous in one direction — a real player is sometimes fooled badly, and is
systematically late rather than symmetrically wrong — and harsh in another, since
a real player learns a pitcher. It is a comparator, not a prediction of anyone's
average.

It also cannot see the reveal change at all: it models the player's accuracy as a
constant, when the whole point of showing the crossing point earlier is that the
player becomes more accurate. More time to look should make the real numbers
better than the table above. That improvement is unmeasured, and it is the reason
the assist was tuned as if the reveal had not moved.

---

## Two seconds, and a bat that arrives on time

Three follow-ups to the round above, all from the same report: still too hard,
and *"I do NOT get to see the batter make a full swing."*

### The swing was real and nobody could see it

The second complaint turned out to be three separate bugs stacked on the same
tick, any one of which alone would have hidden contact.

**The animation was on the wrong clock.** `poseBatSwing` ran on a fixed 0.42 s
while the engine struck the ball at the swing's `latency` — 0.125 s. Working
through the pose: at t = 0.30 the barrel is 6% into its arc. So at the instant
the ball left the bat, the bat was still cocked behind the hitter's head. The
ball departed, and *then* the player swung at where it had been.

The pose clock is scaled now, so `SWING_CONTACT_FRAME` — the point in the
animation where the barrel is over the plate — lands exactly on the engine's
contact instant. The two numbers are related by construction rather than by
coincidence, so retuning `latency` cannot silently break it again.

**The batter was deleted on the frame of contact.** The engine creates the
batter-runner in the same statement that launches the ball, and the renderer
swapped actors the moment one existed — so the follow-through was never drawn at
all. For one beat the batter now stays and the batter-runner is held back; they
are both standing on home plate during that beat, so nothing else moves.

**And the camera cut away on that frame too.** `pickShotName` returns an infield
or outfield shot the instant the phase becomes `inplay`, and `chooseShot` does a
hard cut. The one frame worth watching was the one frame the camera left.

All three are driven off `play.clock`, which counts from contact and lives in the
simulation — so the renderer stays a pure function of state and a replay of the
same seed shows the same follow-through.

The first version of the hold used `> 0` and produced a single-frame flicker to
the wide shot *at the exact moment of impact*, then cut back. `play.clock` is
zero on that frame. It is `>= 0` now, and the comment says why.

### scripts/swing-shot.ts

None of the above is visible in a still, so: a harness that drives a real touch
swing and writes a strip of frames straddling contact, labelled from the
simulation's own clock rather than from a guess about when the interesting part
was. Four things had to be got right before it reported anything true:

- **Synthesised `MouseEvent`s do not reach the touch path.** The first version
  dispatched them and captured six identical frames of a pitch nobody swung at.
  It uses a touch-capable context and `page.touchscreen.tap` now.
- **Reading `toDataURL` between frames returns a blank canvas.** WebGL clears its
  drawing buffer on composite unless `preserveDrawingBuffer` is on, and it is
  deliberately off. The frames are collected inside the page, immediately after a
  render, and shipped out in one transfer — which also raises the sample rate
  from about 10 Hz to the frame rate.
- **A named recursive callback inside `evaluate()` dies** with `__name is not
  defined`, because esbuild's keepNames shim does not exist in the page. It is a
  plain loop awaiting one animation frame at a time.
- **`waitForTimeout` assumes wall time and game time run together**, and under a
  software renderer they do not: a slow frame is clamped by `MAX_FRAME_DT`, game
  time falls behind, and every tap lands early. It polls the ball's own flight
  time instead. That one change took the harness from missing eight pitches in a
  row to connecting on the first.

### Two seconds

The pitch still arrived in 0.65 s at the default tempo, and the report was that
there was not enough time to swing. Half a second longer than Brisk had been the
wrong order of magnitude: reading the pitch is only the first of three things
this game asks for inside the flight, and the middle one is a thumb travelling
across glass.

`sandlot` is a fourth tempo tier at ×4, about **2.0 s** from hand to plate, and
it is the default everywhere. The three existing tiers keep their values, so
nobody's saved setting changed meaning. Two tests had to move with it — both were
pinning the old default window, and both still assert the property they were
written for: every pitch lands inside a window a person can act in.

### One more level of assist

`reach` went to ×2.4 / ×2.0 / ×1.0 and `window` to ×2.5 / ×2.1 / ×1.0. At the
error that produced the original report, Pro went 5.6 → 8.5 hits a game and
Rookie 8.8 → 15.3. Ace is untouched, again, and still has the test asserting a
human there gets the identical profile the CPU gets.

The harness holds the player's accuracy constant across the tempo change, which
means the tempo is pure unmeasured upside on top of those numbers. That is the
conservative direction, and it is the reason the assist was tuned as if the pitch
were still arriving in two thirds of a second.

---

## Tests performed

- **Automated:** 289 Vitest tests across 24 files — RNG determinism, ball-flight
  calibration and frame-rate independence, the swing model, the plate upgrade's
  noise ratio and overlay honesty, baseball rules driven through the real engine,
  runner invariants, season and cup integrity, the derby, box-score bookkeeping,
  the player creator, a 100-game batch, and the phone work: a restored game
  proven identical over six further minutes of play, input-lag correction proven
  exact to nine decimals, the graphics servo proven not to oscillate against a
  thermally limited phone, and the vibration patterns proven short and quiet.
- **Batch simulation:** repeated runs of `scripts/simulate.ts` at 3 and 9
  innings across all three difficulties, checking for deadlocks, invalid states
  and statistical drift.
- **Manual browser:** every screen and every mode driven by hand in Chromium via
  the in-app browser and via Playwright, including team select, quick play, an
  at-bat, a ball in play, a home run, a postgame box score, the pause menu, the
  controls screen and the player creator.
- **Production build:** built clean and captured through `vite preview` with
  Playwright at 1600×900. Zero console errors across the whole capture run.
- **WebKit phone audit:** `npm run test:phone` — the production build driven in
  Safari's own engine with real touches, at an iPhone's size and pixel density,
  in both orientations. 55 checks, all passing, zero console errors, locally and
  five consecutive times against the live site. It covers
  the things only Safari gets wrong (double-tap and pinch zoom), the things only
  a real touch proves (that `touchstart` turns the pad on and that touching the
  crossing point grades a hit), and one thing nobody had checked in any engine:
  that all 81 sampled points of the reachable strike zone belong to the zone and
  not to a button sitting on top of it.
- **Real Mobile Safari:** the production build served over the LAN and loaded in
  Safari on an iOS 26.4 iPhone 17 simulator. Renders and lays out correctly; the
  simulator could not be driven by touch from this environment, so it is visual
  evidence and the WebKit harness is the interaction evidence.
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
- **No real phone or tablet was available, in either phone round.** The touch
  build was verified at handset viewport sizes in a desktop Chromium, with the
  pad driven by synthesised `PointerEvent`s and the screenshots taken in a real
  handset browser context — which proves layout, hit-testing, label wiring,
  coordinate mapping under rotation and that a press reaches the engine, and is
  *not* the same as a thumb on glass. Unverified on hardware: multi-touch under
  real load (the code tracks pointer ids and was only ever exercised one pointer
  at a time), true touch latency, frame rate on a phone GPU, the wake lock, tab
  discard and recovery, and the graphics servo against a genuine thermal
  throttle rather than a synthetic frame-time sequence. The servo replaced a
  fixed mobile default precisely because that default was a guess; the servo
  measures instead, but it has still only measured a laptop.
- **The vibration code has never physically run.** No browser available here
  implements `navigator.vibrate`, so every haptics test drives an injected sink.
  The patterns are proven short, rate-limited and correctly varied by contact
  quality; whether they *feel* right on an Android motor is unknown.
- **A rotated game reads safe-area insets from the phone, not from itself.**
  When the game turns itself for a rotation-locked phone, the notch and home
  indicator sit on edges the layout now calls something else, and they cannot be
  mapped individually without knowing which way the phone was turned. The
  rotated layout clears the largest inset on all four sides instead: wasteful,
  never wrong, and untested against a real notch.
- **The service worker still has not been tested offline.** It is registered
  only in production builds *and only over HTTPS*, which `vite preview` on a LAN
  address is not — so the only place it can be exercised is the Pages deploy,
  which now exists but has not been used for that. "Install it, turn off the
  wifi, open it" remains unperformed, and so does the wake lock, for the same
  reason. The strategy is deliberately the conservative one — the page
  itself is network-first so a bad deploy cannot pin itself — but "install it,
  turn off the wifi, open it" has not been performed.
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
