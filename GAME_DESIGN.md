# GAME DESIGN

## The target feeling

A late-1990s console baseball game: you can be at the plate within ninety
seconds of loading, almost every pitch could turn into a moment, and nothing
between pitches asks you to wait. Skill has to be visible — a good swing must
look and sound different from a lucky one — and the game must be honest about
why something happened.

Three commitments follow from that, and everything else is downstream of them:

1. **Outcomes come from inputs, not from dice.** Randomness exists, it is
   bounded, and it is always smaller than the difference a good input makes.
2. **Every result is explainable in one short sentence.** "You were under it."
   "You were late." "He sat on your slider." The HUD says it out loud.
3. **A player who never presses a base button still gets competent baseball.**
   Commands are an override, not a requirement.

---

## The world

**The Meridian Circuit** — ten clubs in two divisions, playing in eight
ballparks. Every name, colour, park, player and piece of flavour text is
invented for this game.

### Tidewater Division

| Club | Identity | Plays like |
|---|---|---|
| Ironport Anchors | Navy and gold, riveted steel | Best defence in the circuit, sinker-and-cutter pitching, patient hitters |
| Nova Bay Comets | Purple and silver, domed and loud | The complete club; balanced and star-driven |
| Coral Key Stingrays | Teal and coral | Contact and speed, almost no power |
| Bayou City Gators | Swamp green and gold | Enormous power, terrible plate discipline, hard throwers |
| Harbor Point Beacons | Rust red and cream | Junkballers. Movement over velocity, led by a knuckleballer |

### Highland Division

| Club | Identity | Plays like |
|---|---|---|
| Cactus Flats Scorpions | Desert orange and black | Fastest team in the league, small ball |
| Alpine Summit Yeti | Ice blue and white | Gloves and breaking balls; slow but never gives you an extra base |
| Rustforge Riveters | Copper and charcoal | Three true outcomes. Enormous power, enormous strikeouts |
| Prairie Rock Thunderbirds | Crimson and gold | Arm strength everywhere, including a 103 mph starter |
| Redwood Grove Loggers | Forest green and brown | Power hitters in the league's biggest outfield |

### Signature players

One hand-authored star per club anchors its identity — Rooster Van Doorn of
Nova Bay as the face of the circuit, Yuki Nakagawa of Coral Key as the fastest
player alive, Big Thibodeaux of Bayou City with 99 power and 28 speed, Wendell
Pomeroy of Harbor Point throwing a 76 mph knuckleball with 99 movement, Cyrus
Stallworth of Prairie Rock at 99 velocity and 52 control. The rest of the pool
is generated deterministically from the league seed, so the same league is the
same league on every machine.

### Ballparks

| Park | Home | Character |
|---|---|---|
| Anchor Yard | Ironport | Asymmetric. 11.5 m wall in left, short porch in right |
| The Sandpit | Cactus Flats | 130 m to centre, huge gaps, deep everywhere |
| The Comet Dome | Nova Bay | Symmetric, turf, always lit, neutral |
| Bayou Bowl | Bayou City | Small, thick air, +7% carry. A home-run park |
| Summit Field | Alpine Summit | +11% carry, 134 m to centre to compensate |
| The Foundry | Rustforge | Short everywhere, 8.5–9.5 m walls everywhere |
| Grove Park | Redwood Grove | 1.6 m walls and a 133 m centre-field cavern. Triples happen here |
| Thunder Ridge | Prairie Rock | Open, and the only park where wind decides games |

Carry is applied as `drag / carry^2.6`, which makes the difference between a
sea-level bandbox and a mountain park visible on the scoreboard: an identical
45 m/s / 28° drive carries 117 m at Grove Park and 133 m at Summit Field.

---

## Batting

The hitter aims a contact cursor in the plate plane and starts a swing. The bat
arrives `latency` seconds later — 0.125 s on a contact swing, 0.165 s on a power
swing — so the swing is a prediction, not a reaction.

Two errors decide the result:

- **position error** — cursor centre versus where the ball crossed
- **timing error** — when the bat arrived versus when the ball did

They combine into one normalised miss distance:

```
norm = sqrt( (dx/rx)² + 0.85·(dy/ry)² + 1.15·(dt/window)² )
```

| `norm` | Result |
|---|---|
| > 1.27 | Swing and a miss |
| 0.86 – 1.27 | Foul ball (13% of these are caught foul tips, which can be strike three) |
| ≤ 0.86 | Ball in play, quality = `1 − norm` |

A vertical miss of more than 0.66 sweet-spot radii also produces a foul straight
back, which is where most count-extending fouls come from. That threshold is a
**line, not a lottery** — it used to be a probability ramp, which meant the same
swing could be a line drive or a foul with nothing to tell them apart. The only
random part left is a narrow jitter band on the edge, and it narrows as the
hitter's Contact rating rises.

Sweet-spot size and timing window scale with the hitter's Contact rating:

| | radius X | radius Y | timing window |
|---|---|---|---|
| Contact 20 | 0.108 m | 0.132 m | ±0.056 s |
| Contact 99 | 0.183 m | 0.230 m | ±0.100 s |
| Power swing | ×0.85 | ×0.85 | ×0.86 |

Quality then produces the batted ball:

- **Exit velocity** = `(38 + power·15) · (0.44 + 0.56·quality^0.66) · swingMult`,
  plus a transfer term from the pitch's own speed that only pays out on good
  contact. Ceiling 53 m/s (119 mph) for a 99-power hitter on a power swing.
- **Launch angle** = `14° + 24°·verticalMiss − 11°·timing + 3°·|timing| + loft`.
  A centred contact swing is a line drive; a centred power swing (+9° loft) lands
  in the 20–25° window that actually leaves the yard. Being under the ball lifts
  it further; being over it tops it. Timing changes the *plane* as well as the
  direction: out in front you meet the ball on the upswing and lift it, beaten by
  the pitch you fight it off on the ground.
- **Spray angle** = `pull · (−58°·timing + 46°·inside + 6°·horizontalMiss)`.
  Early pulls, late goes the other way, and an inside pitch is pulled harder than
  one on the outer half. This is what spreads batted balls across the whole field
  instead of bunching them up the middle, and it is what creates gaps, corners,
  doubles and foul balls.
- **Horizontal miss costs energy** as well as quality: contact more than 0.3
  radii off centre — off the end of the bat, or in on the hands — loses up to
  30% of exit velocity.
- **Spin** from the vertical miss drives Magnus lift; sidespin hooks pulled
  balls toward the line.

### Noise scales with the mishit

Every one of those terms carries a random component, and the size of it is
`0.3 + 0.7·(1 − quality)`. A barrelled ball is close to deterministic; a ball off
the end of the bat genuinely can go anywhere.

This is the single most important balance rule in the game. Before it, good
contact and bad contact were equally unpredictable, so aiming carefully and
timing well felt like it bought nothing and the whole plate appearance read as a
dice roll. Measured across 200 seeds with identical inputs, a squared-up ball now
varies by 0.6° of spray and 0.5 m/s of exit velocity; a mishit varies by five
times as much. `src/tests/plate.test.ts` holds that ratio.

The cost of the change was that squaring balls up started paying too well —
BABIP went from .316 to .356 in a 60-game batch. It was paid back with *more
deterministic spread*, not more dice: the timing-to-launch-angle term and the
off-the-end penalty above. Final numbers are in `TEST_REPORT.md`.

Right-handed hitters pull toward −X (left field) and stand in the third-base
box; left-handers mirror it. Switch hitters take the opposite side to the arm.

Difficulty gives the **human** hitter a wider timing window — ×1.3 on Rookie,
×1.1 on Pro, ×1.0 on Ace. The CPU never receives it and no ball physics change.

### The mound is 68 feet, and the pitch clock is stretched

Regulation is 60 ft 6 in. This league plays deeper, and that is a design decision
rather than an error.

A real hitter gets about 0.42 s from release and has spent two decades training
for it. A player at a keyboard has to read the pitch, move a cursor onto it *and*
commit a swing in the same window, and at regulation depth that is not a decision
— it is a reflex test you keep failing. At 68 feet a fastball takes 0.48 s.

**It was not enough, and the fix reverses a decision this document used to
defend.** The earlier version of this section said that stretching the flight
clock, or slowing the ball while the scoreboard printed 95, would each make the
radar readout a lie — and moving the rubber back was the honest answer. Moving
the rubber back *is* honest. It is also finished: the mound cannot go to 90 feet
without the ballpark becoming a different shape. And 0.48 s is still not a
window a person makes a decision inside, which is the thing the whole batting
model is about. On a phone, where the cursor is a thumb, it is hopeless.

So the pitch's flight from release to the contact plane is now stretched by a
**pitch tempo** factor, and the setting is on the options screen:

| Tempo | Factor | Fastball | Curveball |
|---|---|---|---|
| Brisk | 1.00 | 0.45 s | 0.54 s |
| Standard *(default)* | 1.30 | 0.59 s | 0.70 s |
| Relaxed *(default on touch)* | 1.60 | 0.72 s | 0.86 s |

What is and is not slowed matters:

- **The path through space is identical.** Same release point, same break, same
  arc, same spot at the plate — only the clock along it is slower. The gravity
  term is shaped by the *physical* flight time rather than the stretched one; if
  it were not, a relaxed tempo would loft every pitch into an eephus. A test
  walks both trajectories point-for-point and holds them to 1e-9 m.
- **Nothing else is dilated.** The bat, the batted ball, the fielders and the
  runners all live in real seconds.
- **The pitcher gains nothing from the extra time either.** Steering integrates
  on the pitch's own clock, so a slow tempo does not quietly hand back to the
  mound the advantage it just gave the plate.

**What it costs, stated plainly:** the ball on screen is not moving at the speed
the radar prints. That is a stylisation, and doing it quietly is what the older
text called a lie. It is not quiet. The tempo is a labelled setting, and the
last-pitch readout prints the **real flight time in seconds** next to the speed
— `97 HEATER · 0.55s` — so the number a hitter actually needs is the one that is
never fudged.

**The CPU hitter gains nothing from it.** Its read is budgeted in seconds before
arrival, not as a fraction of the flight, so a longer trip moves its decision
point later by precisely the same amount.

Measuring that is harder than it looks, and the measurement is worth stating
because it is easy to get wrong. The CPU rolls for pitch steering once per
simulation tick during the flight, so a longer flight consumes a different
number of random draws and the stream diverges from the first pitch. **Two
tempos on the same seed are two different games, not the same game slower.**
Every tempo comparison is therefore two samples, never a controlled A/B.

Two batches, and they disagree about the direction:

| | AVG | K% | R/g |
|---|---|---|---|
| 60 games, one park — Brisk | .262 | 21.3 | 7.95 |
| 60 games, one park — Standard | .267 | 22.9 | 8.43 |
| 60 games, one park — Relaxed | .262 | 21.3 | 8.00 |
| 120 games, all parks — Brisk | .282 | 21.3 | 10.06 |
| 120 games, all parks — Standard | .273 | 21.5 | 10.13 |

Standard is above Brisk in one sample and below it in the other, and in the
first Brisk and Relaxed — the two extremes — land on the identical average and
strikeout rate. A real effect does not change sign between samples. The honest
conclusion is that the tempo does not systematically move the CPU game, and that
this harness's noise on batting average is about ±10 points at 120 games. Every
batch finished with zero anomalies and zero forced resolutions.

---

## The plate view

A model this precise is worthless if the player cannot see it. The plate view is
the layer that makes the duel legible, and it is drawn in screen space from
projected world points so it is welded to the ballpark rather than floating over
it. It reads state and never writes it: delete it and the game plays identically,
just blind.

**The zone.** A large, static, gridded rectangle at the contact plane, marked in
thirds — "up and in" should be a place, not a vibe, and the grid is what makes it
one. Every stroke is drawn twice, a bright line inside a dark casing, because it
has to read identically over grass, dirt, a crowd and a night sky. Corner
brackets mark the four corners by shape, so nothing depends on colour alone.

**The camera.** The zone is only big because the shot was rebuilt around it: a
25° lens from 2.6 m up and 5.4 m behind the plate, aimed so the zone sits at
about two thirds height with the release point comfortably inside the top of
frame. Both ends of the pitch have to be visible or there is nothing to time.
That framing puts the zone at ~21% of screen height where the old wide-angle shot
gave ~6%. The camera is dead centre and completely static; it used to drift with
the hitter's cursor, which made the zone swim around the screen and defeated the
point of drawing one. The catcher and umpire are not drawn for this shot — they
stand inside the lens's near field, where a 1.4 m figure covers most of the
screen — and return the moment the shot cuts to the field.

**The tracker.** Every pitch of the plate appearance leaves a numbered dot where
it crossed, coloured by what it did: ball, called strike, whiff, foul, in play,
hit batsman. Older dots recede. After three pitches you can see the pattern the
pitcher is working, which is most of what hitting actually is. A legend in the
HUD names every colour.

**The verdict.** After every swing, a timing needle and two words directly under
the zone: EARLY / ON TIME / LATE, and UNDER IT / ON PLANE / OVER IT. The needle
sits on a bar whose green band is the window that puts the ball in play and whose
amber shoulders are the window that fouls it off, both drawn to the scale of that
hitter's own tolerances. The words lead with whichever error actually cost the
swing, so the feedback names the thing worth fixing instead of reciting both.

**The pitcher's side.** The target is a bracket at the plate-crossing point, and
every pitch in the repertoire draws its own preview arc into that target in its
own colour — matching the pitch chips that carry the key bindings. You choose a
spot first and a shape second, and you can see before committing that the slider
gets there from the arm side while the curve falls into it from above. The arcs
are traced through the same break and the same shaping curve the engine will use,
so the preview cannot drift from the pitch.

### The read assist

Three things are gated on difficulty for the human hitter, and they arrive
together so information never leaks at three different moments:

| | Rookie | Pro | Ace |
|---|---|---|---|
| Fraction of flight before the read is given | 34% | 62% | never |
| Ball trail tinted with the pitch's colour | ✓ | ✓ | — |
| Full flight arc drawn from the hand | ✓ | ✓ | — |
| Marker at the plate-crossing point | ✓ | ✓ | — |

Before the read is earned the ball still carries a short comet tail — enough to
track it, not enough to hand over the shape of the break. The CPU hitter receives
none of this; it works from its own noisy estimate in `ai.ts`. Nothing about the
ball changes on any setting.

The whole overlay can be switched off in Settings → Plate view, for players who
want a clean camera. The game plays identically either way.

---

## Pitching

Each pitcher throws three or four pitches from a repertoire of ten. Selecting a
pitch throws it, so there is no extra confirmation step between deciding and
delivering.

| Pitch | Speed (base) | Break X (arm side) | Break Y | Late |
|---|---|---|---|---|
| Four-Seam | 38.4 m/s | +0.06 | +0.13 | low |
| Heater | 40.9 | +0.04 | +0.17 | low |
| Change | 33.9 | +0.15 | −0.17 | medium |
| Curveball | 32.4 | −0.20 | −0.48 | medium |
| Slider | 36.1 | −0.36 | −0.17 | high |
| Screwball | 33.4 | +0.40 | −0.15 | medium |
| Sinker | 37.4 | +0.27 | −0.31 | medium |
| Cutter | 37.8 | −0.19 | −0.05 | high |
| Knuckler | 29.2 | random | random | medium |
| Splitter | 36.2 | +0.05 | −0.44 | very high |

Break is expressed toward the pitcher's throwing hand, so a slider always sweeps
away from a same-handed hitter regardless of who is on the mound.

The pitch's path is a **closed form**, not an integration: position at time *t*
is exact, which means the batter's timing window is bit-identical at any frame
rate. The aim reticle marks where the ball will *cross the plate*, with the break
already subtracted from the launch line — a curveball starts high and lands on
the spot rather than starting on the spot and diving out of the zone.

Execution error widens with poor Control, with fatigue, with the pitch's own
wildness, and with how far outside the pitcher aims. Steering during flight is
an acceleration on a saturating offset (maximum 0.34 m, scaled by Movement), so
it bends a pitch and can never teleport it.

**Fatigue** drains at `1 / (46 + stamina·74)` per pitch, faster on a Heater and
with runners aboard. A tired pitcher loses up to 7.5% velocity and command
degrades sharply. The CPU manager goes to the bullpen on stamina, on runs
allowed, and on the inning.

**Repetition is punished.** The CPU hitter's familiarity with a pitch rises with
both its overall share and how often it appeared in the last four pitches, and
familiarity shrinks its perception noise by up to 42%. Throwing your best pitch
60% of the time makes it materially easier to hit.

---

## Ball flight

Fixed-step integration with quadratic drag, backspin lift, sidespin curve,
bounce and roll:

```
a = −g·ŷ − k|v|v + lift·(perpendicular to v, in the vertical plane)
k = 0.0052 / carry^2.6      lift = 0.00125·|v|²·spin·carry
```

Calibrated with `scripts/tune-physics.ts` and locked by `physics.test.ts`:

| Exit velocity | Launch angle | Carry (neutral park) | Hang |
|---|---|---|---|
| 89 mph | 28° | 101 m / 333 ft | 3.9 s |
| 101 mph | 22° | 110 m / 361 ft | 3.6 s |
| 101 mph | 28° | 120 m / 392 ft | 4.3 s |
| 107 mph | 35° | 135 m / 443 ft | 5.3 s |

Fair/foul is decided at the ball's own position, not the fielder's. A foul ball
more than 30 m from the plate is dead where it lands — that is the seats. A ball
inside the infield stays undecided until it passes a base or is touched, which
is the real rule.

---

## Fielding

### The defence has a manager

Five alignments — normal, double-play depth, infield in, no doubles, corners in
— are available to the CPU manager and, on the modifier, to the human pitching.

They are implemented as **position offsets and nothing else**. There is no
"infield-in modifier" anywhere in the outcome model; the four infielders simply
start five to seven metres closer to the plate, and every consequence falls out
of the physics that was already there. The throw home gets shorter, so the run
gets cut off. The grass behind them gets longer, so ground balls that were outs
go through. Nobody had to decide what those numbers should be, because the
simulation already knew.

That is also why the alignment is worth showing the hitter. The infield visibly
walks in before the pitch, and a player who can see it can hit against it — a
probability modifier hidden in a table could never do that.

The manager's priority order is written the way a bench coach would say it:
cut the tying or go-ahead run off at the plate first; set up the double play
second; protect a late lead third. Across 60 games the mix lands at roughly 75%
normal, 16% double-play depth, 5% no doubles, 2% infield in and 1% corners.

### Nothing on the field waits for you

The human on defence is always attached to whichever fielder the coverage solver
picked as the chaser. That is the right choice — you want the ball — but it has a
sharp edge: everyone else is covering a base, so if you do not steer, *nobody is
pursuing the ball at all*. A player hit exactly that. A fly ball, a camera that
did not show them where it went, and half a minute of a ball sitting in the grass
before the play guard force-resolved it.

So the fielder you are holding keeps working on its own:

| Idle for | What happens |
|---|---|
| 0.55 s with no direction held | The fielder resumes chasing under CPU control |
| 1.2 s while holding the ball | The throw gets made for you |

Any direction, any button, and control comes straight back with no cooldown. The
prompt bar reads **AUTO — MOVE TO TAKE OVER** the whole time it is active, because
a fielder running by itself while you hold the controls is not something a player
should have to work out. Measured against the same games played entirely by CPU,
a completely passive human now costs the defence roughly those two delays and
nothing more; `autofield.test.ts` holds that comparison.

### Fielders solve an interception, not a chase

Fielders solve an **interception**, not a chase. The ball's whole future path —
including bounces and the roll — is projected once per 50 ms into a shared
trajectory buffer, and each fielder finds the earliest point on it they could
physically reach given their speed, reach and reaction time. The best solution
becomes the chaser; everyone else is assigned to cover a base, cut off a throw
or back up.

This one change moved batting average on balls in play from .480 to .300.
Chasing the *first bounce* instead lets every ground ball skip past the entire
infield.

Throws are solved by binary-searching the launch angle against the same
integrator the ball uses, so drag is accounted for and long throws genuinely
fall short — which is what makes the cutoff man necessary. A designated receiver
is assigned to every throw and runs to the catch point; without that the ball
gets thrown to an empty patch of grass and the play stalls.

Errors are rare and rated: base success is `0.982 + fielding·0.016`, reduced by
ball speed, by being at full sprint, and heavily by diving. That works out to
roughly one error per team per nine innings.

Play resolution is guarded three ways: no live runners ends the play
immediately, a held ball with everyone settled ends it after 0.75 s, and a
26-second clock force-resolves anything else while logging a diagnostic. Across
the whole validation suite the force-resolve path has never fired.

---

## Baserunning

Runners decide with a time comparison, not a lookup table: their time to the
base against the defence's time to get the ball there, using the *same*
interception estimate the fielders are running to. A ball rolling into the gap
therefore looks like a ball rolling into the gap, not like a ball already in
somebody's glove.

The margin they demand depends on what they are attempting:

| Attempt | Required margin (Pro CPU) |
|---|---|
| Batter taking second | −0.50 s (he runs on instinct) |
| Any other extra base | +0.27 s |
| Trying to score | +0.38 s |

Two outs makes everyone 0.14 s braver. Throws longer than 65 m carry a 1.0 s
relay penalty, which is the other half of why balls in the gap become doubles.

**The batter's margin is the single most load-bearing number in the offence.**
At the original −0.24 s the hitter pulled up at first on balls that were plainly
doubles, and extra-base hits ran a third below the real rate — 1.9 doubles a
game against a real 3.3. Moving it to −0.50 s produced 2.9 without touching the
hit rate at all, because the hits it converts were already hits. What it costs
is outs on the bases when he is wrong, which is the honest price and a good
moment in its own right.

The obvious-looking alternative was tested and rejected: moving the outfielders
from 273 ft back to a realistic 295 ft did generate the doubles, and also an
extra hit a game of bloops falling in front of them, taking batting average on
balls in play from .331 to .393. The shortfall was never where the defence
stood.

### Tag-ups

A runner forced back to re-touch after a catch is released the moment he gets
there, and is then free to run again on the ordinary margin above. Without that
release the flag stayed set for the rest of the play: the runner on third
dutifully returned to the bag and then stood on it while the ball came in, and
sacrifice flies ran at **0.03 per game** — which is to say they did not exist.
They now run at 0.38.

### Stolen bases are contested

A runner who breaks on the pitch used to walk to the next base while nobody
threw — eight and a half free bases a game. A steal is now an ordinary live
play: the catcher gathers the pitch (pop time 0.52–0.72 s, by his fielding),
the middle infielder covers, and the tag either beats the runner or it does not.
Every part of that is machinery the engine already had for balls in play.

Attempts are decided once per pitch rather than once per simulation tick — the
old per-tick roll at 120 Hz is why a fast runner went on essentially every
pitch. The result is 1.05 attempts a game at 79% safe, against a real-baseball
1.4 and 79%.

Invariants are enforced every step: runners cannot pass each other, and two
runners can never end up on the same bag.

---

## The CPU

Difficulty changes **decisions, execution and reaction** — never the laws of
physics, and never by reading your inputs.

| | Rookie | Pro | Ace |
|---|---|---|---|
| Pitch-location perception | 0.42 | 0.66 | 0.86 |
| Timing perception | 0.40 | 0.66 | 0.85 |
| Command (hits its spot) | 0.45 | 0.70 | 0.90 |
| Sequencing quality | 0.30 | 0.65 | 0.92 |
| Fielder reaction delay | +0.24 s | +0.12 s | +0.04 s |
| Throws to the right base | 0.55 | 0.80 | 0.96 |
| Baserunning aggression | 0.30 | 0.55 | 0.78 |
| Steal drive | 0.12 | 0.30 | 0.50 |

The CPU hitter reads each pitch **once**, part way through the flight, with
noise on both location and timing, and then must live with that read. Its
reaction budget is real: it cannot wait until the ball is at the plate. Swing
rates come from a per-count table — 7% at 3–0, 94% at 3–2 — so it works the
count like a hitter rather than hacking at everything.

---

## Balance

Measured over 100 CPU-versus-CPU nine-inning games on Pro:

| Statistic | MOONSHOT NINE | Real baseball | Note |
|---|---|---|---|
| Runs per game (both clubs) | 9.4 | 8.6 | Deliberately above real baseball |
| Hits per game | 18.9 | 17.0 | |
| Home runs per game | 2.2 | 2.3 | Rare enough to matter, common enough to chase |
| Doubles / triples per game | 2.9 / 0.2 | 3.3 / 0.3 | |
| Batting average | .272 | .248 | |
| Batting average on balls in play | .327 | .291 | |
| Strikeout rate | 22.2% | 22.6% | |
| Walk rate | 4.1% | 8.2% | Below real baseball, on purpose — walks are dead time |
| Errors per game | 0.97 | 1.2 | |
| Pitches per plate appearance | 4.0 | 3.9 | |
| Pitches in the strike zone | 49.3% | 48.5% | |
| Whiffs per swing | 19.2% | 24.6% | |
| Extra-inning games | 7% | 9% | |
| Shutouts | 12% | 13% | |

### Baseball texture

Batting average alone cannot tell you whether a game *feels* like baseball. Two
engines can both hit .272 while one turns double plays and steals bases and the
other never does — so the balance harness measures the situational game too, and
these numbers are what the round was actually for:

| Per game (both clubs) | Before | After | Real baseball |
|---|---|---|---|
| Double plays | 2.3 | 2.3 | 1.7 |
| Sacrifice flies | **0.03** | **0.38** | 0.5 |
| Stolen-base attempts | **8.54** | **1.05** | 1.4 |
| Stolen-base success | **100%** | **79%** | 79% |
| Wild pitches / passed balls | 0 / 0 | 0.45 / 0.27 | 0.7 / 0.2 |
| Runners thrown out on the bases | 4.0 | 3.4 | — |
| Doubles | 1.9 | 2.9 | 3.3 |
| Intentional walks | 0 | 0.08 | 0.15 |

The three bolded rows were not tuning. They were defects: tag-ups could never
release, steals were never contested, and a ball in the dirt could not get past
the catcher.

A three-inning game takes about four and a half minutes; a nine-inning game
about fifteen.

---

## Playing it on a phone

The control scheme was built around a mnemonic — *the four action buttons are
the bases* — and that turns out to be the thing that makes it survive a
touchscreen, because a base diamond is a shape you can draw under a thumb.

Four decisions carry the whole port:

**The stick floats.** There is no circle to hit, because you cannot see what is
under your own thumb. Put a finger down anywhere in the left half and that is
where the stick is; drag past its edge and the base follows so a long swipe
never runs out of travel. Nothing to aim at means nothing to miss.

**Every button says what it does right now.** Not `A` and `B` — `SWING`,
`POWER`, `BUNT`, `TAKE`, and then `2ND`, `3RD`, `HOME`, `1ST` the moment the
ball is in play. The pitching diamond names the pitch rather than the slot: you
press `SL`, not "pitch 3". A caption that has no meaning in the current
situation is not drawn *and* cannot be pressed, so there are never dead buttons
to learn to ignore. The keyboard prompt bar and the touch captions are generated
from one function, so the two can never disagree about what a button does.

**The modifier latches.** Holding a shoulder button with one thumb while
pressing a face button with the other is a two-handed gamepad idiom and it does
not survive a phone. Tap it, it lights up, the next press spends it. Tapping it
again puts it away, and it disarms itself if the situation stops having a use
for it.

**Arming it re-labels the diamond.** This is the part that earns the latch. Tap
`DEFENCE` on the mound and the four buttons become `DP` / `IN` / `CORNERS` /
`NO XBH`; tap `STEAL` at the plate and they become the four bases. A player
discovers the modifier by pressing it and watching four words change, rather
than by being told. The keyboard build does the same thing now — holding Shift
re-labels the prompt bar — which is a straight improvement it got for free.

The layout follows from the grip. Thumbs own the two bottom corners, the ball
owns the middle, so every information panel moves into one stacked column down
the left: scoreboard, pitch chips, alignment, last pitch. On a touch device the
prompt bar disappears entirely — the buttons are already carrying the legends,
and a second copy along the bottom is nothing but lost field.

Landscape is the real layout. Portrait puts up a card asking for a turn *with a
way past it*, because plenty of people play with rotation locked; the portrait
layout stacks the two header panels, shrinks the pad and moves the stick zone to
the middle band, and it genuinely works — the field is just narrower.

Opening defaults on a touch device are Relaxed tempo, Balanced graphics and no
line score. All three are ordinary settings, and a value the player has chosen
themselves is never overwritten — including choosing them back.

### One bug the port found

Wiring `STEAL` onto a button meant checking that it worked, and it did not. The
modifier is what tells the engine "this diamond press is a baserunning command,
not a swing selection" — and the command handler then read the same flag a
second time as "go back", so a called steal routed into the retreat branch and
sent the runner to the base he was already standing on. A human could not call a
steal at any point in the game.

It survived every simulated game because the CPU calls its own steals through a
different path, and it survived the HUD because the prompt bar was advertising
the intent rather than the behaviour. Before the pitch, the modifier no longer
selects "go back"; going back is a live-ball decision and stays one.

---

## Presentation

Chunky, flat-shaded and low-poly — but **jointed**. Each player is built as

```
root → hips → knees → feet
root → torso → chest, head, arms → elbows → hands → bat / glove
```

with a shoulder yoke that widens the silhouette where a ballplayer is actually
wide. The first version had one box per limb and no shoulder, elbow or knee, and
every pose read as a mannequin being rotated rather than an athlete moving. The
joints are what buy a swing its extension, a throw its whip, a dive its reach
and a catcher his crouch.

Arms and head hang off the **torso**, not off the root, so a hip turn carries the
whole upper body the way a real swing does. Previously they were siblings, which
is why the old batter's shoulders stayed square while his chest rotated out from
under them.

The uniform is four bands that read at any distance: jersey chest, trim
undersleeves, near-white trousers, trim stirrup socks — plus a cap for the field
and a deeper, ear-flapped **helmet** for anyone holding a bat or running the
bases, which is the fastest way to tell at a glance who is hitting. Five body
types visibly change with a player's ratings.

Every ballpark is one continuous radial seating bowl around whatever fence shape
it has, so seats can never end up in fair territory. Each tier is a shaded riser
plus a lit horizontal deck, which is what turns the bowl into a flight of steps
instead of the single dark slab it used to be; above the top deck sits a pale
facade band, and beyond centre field a scoreboard the size of a house. The
playing surface carries a warning track, on-deck circles, a mound with a rubber
and mown rings.

Lighting is bright and flat by intent — an under-lit night game makes the ball
impossible to track, which is a gameplay failure rather than a mood — but players
and the ball cast **real shadows** onto the field from a tightly framed 1024²
shadow map covering the infield and near outfield. Painted blob shadows are the
fallback when shadows are off, never a second layer on top of them; the ball
keeps its blob either way, because judging the height of a fly ball is a gameplay
job and the shadow volume does not reach the deep outfield. Behind everything is
a vertical gradient sky dome rather than a flat clear colour.

The camera cuts like a broadcast rather than drifting: a long lens behind the
plate for the at-bat, high and wide for infield action, trailing the ball for
anything deep, and inside the park looking outward for a home run. Shot changes
are hard cuts; only the residual settle is blended. Both ball-chasing shots clamp
their own position back inside the outfield wall, because a ball in the corner
could otherwise put the camera in row 20 behind a screen of spectators.

Audio is synthesised at runtime — oscillators, generated noise buffers, filters
and a convolution reverb built from noise. Every trigger perturbs detune, filter
cutoff, envelope timing and the read offset into the noise buffer, on top of a
round-robin that never repeats the same variant twice in a row, because the same
twenty sounds fire hundreds of times in one game.

---

## Deliberate simplifications

Each of these is consistent, symmetric between the two clubs, and stated in the
README:

**Extra innings** are bounded by a tiebreaker: from two innings past regulation,
each half-inning begins with the previous hitter in the order standing on second
base. Without it a passive player can produce a game that never ends; with it,
300 one-inning games all finished, 235 of them in extras, and the longest ran
nine innings.

| Simplification | Why |
|---|---|
| No pickoff throws | The mound-runner mini-game competes with the pitcher-batter one for attention, and the pitcher-batter one is the game |
| No dropped third strike | The uncaught third strike is a genuinely good moment, but the strikeout-plus-throw-down needs its own play flow rather than a special case bolted to the count. A ball in the dirt only starts a play when the plate appearance continues |
| Straight-line basepaths in the simulation | Distances and times are exact; only the drawn path is simplified |
| Only pitching substitutions | Deep bench management is a different genre |
| No infield fly, balk, interference or obstruction | Rare, hard to communicate at speed, and never advantageous to one side by their absence |
| Foul balls beyond 30 m are dead | Stops fielders chasing uncatchable balls into another county |
| Exact strike zone, no umpire variance | "Unexplained randomness" is exactly what the design forbids |
| Runner on second from the second extra inning | A tie has to terminate; this is a real modern rule and it does the job in a couple of frames |
