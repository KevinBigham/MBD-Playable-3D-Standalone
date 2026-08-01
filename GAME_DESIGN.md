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

### The mound is 68 feet

Regulation is 60 ft 6 in. This league plays deeper, and that is a design decision
rather than an error.

A real hitter gets about 0.42 s from release and has spent two decades training
for it. A player at a keyboard has to read the pitch, move a cursor onto it *and*
commit a swing in the same window, and at regulation depth that is not a decision
— it is a reflex test you keep failing. At 68 feet a fastball takes 0.48 s and
the slowest breaking stuff floats near 0.7 s.

The alternative fixes were both dishonest. Stretching the flight clock while the
ball still "travels" at 95 mph, or slowing the ball while the scoreboard still
prints 95, would each mean the radar readout is lying. Moving the rubber back
keeps the physics exactly true: the ball goes the speed it says, over a longer
path.

**The CPU hitter gains nothing from it.** Its read is budgeted in seconds before
arrival, not as a fraction of the flight, so a longer trip moves its decision
point later by precisely the same amount. Measured across 120 nine-inning games
the change is invisible: .275 average against .273, 21.5% strikeouts against
21.8%.

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
| Batter taking second | −0.24 s (he runs on instinct) |
| Any other extra base | +0.27 s |
| Trying to score | +0.38 s |

Two outs makes everyone 0.14 s braver. Throws longer than 65 m carry a 1.0 s
relay penalty, which is the other half of why balls in the gap become doubles.

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

| Statistic | MOONSHOT NINE | Note |
|---|---|---|
| Runs per game (both clubs) | 9.6 | Deliberately above real baseball |
| Hits per game | 20.1 | |
| Home runs per game | 2.29 | Rare enough to matter, common enough to chase |
| Doubles / triples per game | 1.9 / 0.2 | |
| Batting average | .271 | |
| Batting average on balls in play | .323 | |
| Strikeout rate | 22.0% | |
| Walk rate | 3.6% | Below real baseball, on purpose — walks are dead time |
| Errors per game | 1.1 | |
| Pitches per plate appearance | 4.0 | |
| Pitches in the strike zone | 48.8% | |
| Whiffs per swing | 20.8% | |
| Extra-inning games | 7% | |
| Shutouts | 25% | |

A three-inning game takes about four and a half minutes; a nine-inning game
about fifteen.

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
| Straight-line basepaths in the simulation | Distances and times are exact; only the drawn path is simplified |
| Only pitching substitutions | Deep bench management is a different genre |
| No infield fly, balk, interference or obstruction | Rare, hard to communicate at speed, and never advantageous to one side by their absence |
| Foul balls beyond 30 m are dead | Stops fielders chasing uncatchable balls into another county |
| Exact strike zone, no umpire variance | "Unexplained randomness" is exactly what the design forbids |
| Runner on second from the second extra inning | A tie has to terminate; this is a real modern rule and it does the job in a couple of frames |
