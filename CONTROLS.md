# CONTROLS

Everything in MOONSHOT NINE hangs off one idea: **the four action buttons are
the bases.**

```
              UP  =  SECOND
    LEFT = THIRD          RIGHT = FIRST
              DOWN  =  HOME
```

On defence and on the bases that mapping is literal — press the button that
points at the base you want. At the plate and on the mound the same four
buttons take a second meaning, and the HUD always shows which one is active, so
you never have to remember.

---

## Player 1 — keyboard (default)

| Action | Key |
|---|---|
| Move / aim / cursor | `W` `A` `S` `D` |
| Diamond — up (2nd) | `I` |
| Diamond — left (3rd) | `J` |
| Diamond — right (1st) | `L` |
| Diamond — down (home) | `K` |
| Special | `Space` |
| Modifier (hold) | `Left Shift` |
| Switch fielder | `Q` |
| Pause | `Escape` or `P` |

## Player 2 — keyboard (default)

| Action | Key |
|---|---|
| Move / aim / cursor | `↑` `←` `↓` `→` |
| Diamond — up (2nd) | `[` or `Numpad 8` |
| Diamond — left (3rd) | `;` or `Numpad 4` |
| Diamond — right (1st) | `'` or `Numpad 6` |
| Diamond — down (home) | `.` or `Numpad 5` |
| Special | `/` or `Numpad 0` |
| Modifier (hold) | `Right Shift` |
| Switch fielder | `\` or `Numpad 7` |

Player 2's layout is chosen so both players fit on one laptop keyboard without
reaching across each other. If a numpad is available its diamond is more
comfortable, and both sets are live at once.

## Phone and tablet

The on-screen pad appears the moment the device produces a touch — you do not
turn it on, and a laptop with a touchscreen keeps its keyboard until you
actually touch the glass. It drives Player 1 only; two thumbs on one phone is
not a two-player control scheme.

### Touch to swing

**This is how you bat on a phone.** Touch the strike zone where you think the
ball is going to cross, and the swing happens there. One touch carries both
halves of a swing — the spot and the moment — because that is what a touch is:
a place and an instant. There is no cursor to steer and no button to press.

Touch anywhere on the field, not just inside the drawn rectangle: chasing a
pitch low and away is a decision a hitter is allowed to make, and it is
punished by the same contact model as everything else. The zone is drawn as the
reference, not as a fence.

The four buttons stop swinging and start deciding *which* swing:

| Button | What it does |
|---|---|
| `CONTACT` | The next touch is a contact swing. Lit when armed. |
| `POWER` | The next touch is a power swing — bigger reward, smaller sweet spot. |
| `BUNT` | Squares round. Reads `BUNTING` while it is on. |
| `TAKE` | Checks the swing, if you get it up in time. |

They are sticky, because a hitter has an approach and does not re-choose it
every pitch. Between pitches a touch still counts — it sets where you are
standing, and leaves the cursor there.

**On the mound it is the same idea in the same order a pitcher thinks in:**
pick the pitch on the diamond (it arms and lights up), then touch the spot you
want it to cross. The diamond no longer throws; the touch does. Once the ball is
gone the stick comes back to steer it.

Turn it off under **Settings → Touch to swing** and the stick-and-button scheme
below returns.

### Every control

| Control | Where it is | What it is |
|---|---|---|
| Stick | Anywhere in the left half | **Floating.** There is no circle to hit — put a thumb down and that is where the stick is. Drag past the edge and it follows, so a long swipe never runs out of travel. Hidden at the plate while touch-to-swing is on, because there is nothing left for it to steer. |
| The four buttons | Bottom right, laid out as the base diamond | Captioned with what they do *right now* — `CONTACT`, or `2ND`, or `SL`. A caption you cannot use is not drawn and cannot be pressed. **The whole diamond is one control**, not four: a press anywhere in the square — the gap in the middle, a corner, or a little outside the edge — takes the button in that direction from the centre. The circles are labels; the target is the square. |
| `DEFENCE` / `STEAL` / `BACK` | Below the diamond | The modifier. It **latches** rather than being held: tap it, it lights up, the next press spends it. Tap it again to put it away. |
| `NORMAL` / `ALL` / `DIVE` | Below the diamond | Special, whatever it means in the situation. |
| `AROUND` / `SWITCH` | Below the diamond | Switch-fielder. |
| `II` | Top right | Pause. |

Two things follow from the latch that are worth knowing, because they are what
make a seven-button scheme fit under two thumbs:

- **Arming the modifier re-labels the diamond.** Tap `DEFENCE` while pitching
  and the four buttons become `DP` / `IN` / `CORNERS` / `NO XBH`. Tap `STEAL`
  at the plate and they become the four bases. You find the modifier out by
  pressing it and watching, rather than by reading this table.
- **The pitching diamond names the pitch, not the slot.** You press `SL`, not
  "pitch 3".

### Portrait, and phones that will not turn

The game is built for landscape. In portrait it puts up a card with two ways
out:

- **Turn the game instead.** For a phone with rotation locked — which is a
  deliberate setting a lot of people have, and not one worth changing for a
  game of baseball. The whole game rotates a quarter turn and fills the screen
  in landscape; hold the phone with its right edge up and you have the full
  landscape game, controls and all. Nothing is scaled down or left out.
- **Play in portrait anyway.** The portrait layout does work; the field is just
  narrower.

Neither choice is remembered. It is a nudge, not a setting, and it should come
back next game rather than quietly never appearing again.

### Left-handed

**Settings → Left-handed pad** mirrors everything: stick under the right thumb,
buttons under the left, and the information panels move to the opposite side so
they stay out from under the pad.

### Vibration

**Settings → Vibration.** The pad ticks when a button lands and thumps on
contact — harder the better the ball was hit — with distinct patterns for a
strike, an out and a home run. Glass gives no feedback of its own, so this is
the only way to know a press registered without looking down at the moment you
can least afford to.

It only exists where the browser has a vibration API, which in practice means
Android. **Safari on iPhone does not implement one**, and the workarounds rely
on undocumented behaviour of a form control, so on an iPhone the row reads
`UNSUPPORTED` rather than offering a switch that does nothing.

### Opening defaults on a touch device

All changeable in **Settings**: touch to swing **on**, pitch tempo **Relaxed**,
graphics **Auto**, line score **off**. A setting you have changed yourself is
never overwritten, including changing it back.

Touch-to-swing aims at the drawn strike zone, so it keeps **Plate view** on —
the zone cannot be the control and invisible at the same time. Turn touch-to-
swing off and the plate view goes back to being optional.

## Gamepad (either player)

| Action | Button |
|---|---|
| Move / aim / cursor | Left stick or D-pad |
| Diamond — up (2nd) | `Y` / triangle (button 3) |
| Diamond — left (3rd) | `X` / square (button 2) |
| Diamond — right (1st) | `B` / circle (button 1) |
| Diamond — down (home) | `A` / cross (button 0) |
| Special | `RB` or `RT` |
| Modifier (hold) | `LT` |
| Switch fielder | `LB` |
| Pause | `Start` |
| Menus | `A` confirms, `B` backs out |

The first connected pad drives Player 1, the second drives Player 2. Sticks use
a 0.28 radial dead zone with the remainder rescaled, so a worn stick does not
drift and small inputs still register.

---

## What the buttons do, by situation

### Batting

**On a phone this table describes what the four buttons *choose*, not what they
do** — the swing itself is a touch on the strike zone. See "Touch to swing"
above. The effects below are identical either way; only the gesture differs.

| Input | Effect |
|---|---|
| Move | Slides the contact cursor around the plate. The cursor is the size of *your hitter's* sweet spot: a high-contact hitter's is visibly larger. |
| Diamond down | **Contact swing.** Faster to the ball, bigger sweet spot, less power. |
| Diamond right | **Power swing.** Much more exit velocity and more loft, but a smaller sweet spot and a longer wind-up, so you must commit earlier. |
| Diamond left | **Bunt.** Toggles the square-up stance; the cursor's horizontal position aims it. |
| Diamond up | **Take / check swing.** Pressed before a swing it simply takes the pitch. Pressed within 0.1 s *after* starting a swing it holds the bat up: the umpire rules no swing, and it is a ball unless the pitch was in the zone. |
| Modifier + diamond | **Steal.** Sends that runner on the pitch. Runner commands are deliberately behind the modifier while you are hitting, so choosing a swing can never send a runner by accident. |

**How contact works.** The bat arrives at the plate a fixed time after you press
— 0.125 s for a contact swing, 0.165 s for a power swing. You are predicting
where and when the ball will be, not reacting to where it is. Two errors decide
everything: how far the cursor is from where the ball crossed, and how far your
timing was from the ball's arrival. Being under the ball lifts it; being over it
beats it into the ground. Swinging early pulls; swinging late goes the other way.

**How long you get.** Two things buy you time, and the game is straight with you
about both. The Meridian Circuit pitches from 68 feet rather than 60 feet
6 inches — a longer path at the speed the radar claims. On top of that,
**Settings → Pitch tempo** stretches the pitch clock itself:

| Tempo | A fastball from release to the mitt |
|---|---|
| Brisk | ~0.45 s — real time, real baseball |
| Standard *(default)* | ~0.59 s |
| Relaxed *(default on a phone)* | ~0.72 s |

The ball takes the same path through the air at every setting — same release,
same break, same spot at the plate — it just travels it more slowly. Nothing
else in the game is slowed: the bat, the batted ball, the fielders and the
runners all live in real seconds. The radar shows the pitcher's true release
velocity, and the last-pitch readout prints **the actual flight time in seconds
next to it**, so the number you actually need is never the fudged one. The CPU
hitter gains nothing from a slower tempo: it commits a fixed number of seconds
before the ball arrives, not a fraction of the way through the flight.

Square one up and the result is close to predictable. Catch it off the end of the
bat and it genuinely can go anywhere — the randomness in the model scales with
how badly you missed, so aiming and timing are the whole game.

### Reading the plate

Everything you need is drawn on and around the strike zone.

| What you see | What it means |
|---|---|
| **The white box** | The strike zone for *this* hitter — taller hitters get a taller one. Marked in thirds so you can work a spot rather than a vibe. |
| **The yellow oval** | Your contact cursor, drawn at the true size of your hitter's sweet spot. It turns orange on a power swing (smaller) and green dashed on a bunt. |
| **Numbered dots** | Every pitch of this at-bat, where it crossed. Colour says what it did — the legend at the bottom of the screen names all five. Three pitches in, you can see the pattern being worked on you. |
| **The bright arc** | The ball's flight path. On Rookie and Pro it fills in from the pitcher's hand part-way through the pitch, in that pitch's own colour; on Ace you get a short tail and nothing else. |
| **The ring on the zone** | Where the pitch is going to cross. Same assist, same timing — Rookie sees it early, Pro sees it late, Ace never sees it. |
| **The needle under the zone** | Where your bat actually arrived. Green band = contact, amber = you foul it off, past that you missed. Two words say it plainly: EARLY or LATE, UNDER IT or OVER IT. |

All of it can be switched off in **Settings → Plate view**. The game plays
identically either way; you just do it blind.

### Pitching

| Input | Effect |
|---|---|
| Move (before the pitch) | Moves the aim bracket. It marks **where the ball will cross the plate**, break included. |
| Diamond left / down / right / up | Throws pitch 1 / 2 / 3 / 4 from this pitcher's repertoire. The four chips at bottom-left show the pitch, its speed, and a warning when you have leaned on it too heavily. |
| Move (during the flight) | Steers the ball. The effect saturates, so mashing a direction bends the pitch — it cannot teleport it. A pitcher with high Movement steers more. |
| Modifier + diamond | **Sets the defence.** See below. |
| Switch fielder | Cycles **pitch to him → pitch around → put him on**. |

While you are setting up, a coloured dashed arc runs into the target for **every
pitch in your repertoire** — the colours match the chips at bottom-left, which
carry the keys. Because you aim at the crossing point rather than the release
point, you pick the spot first and the shape second: you can see that the slider
arrives from your arm side while the curve falls into the same spot from above.

Execution error comes from the pitcher's Control rating, his fatigue, the
pitch's own wildness and how far outside you aimed. A tired pitcher loses both
velocity and command, and the stamina bar under his name tells you when.

The CPU hitter tracks how often you use each pitch. Lean on one and it starts
sitting on it: your best pitch gets worse the more you love it.

### Managing the defence

Hold the modifier while you are pitching and the diamond becomes the manager's
card. **Holding it is also what puts the card on screen**, listing all five calls
next to their buttons with the current one lit, so there is nothing to remember.

| Input | Call |
|---|---|
| Modifier + diamond up (2nd) | **Double-play depth.** The middle infielders cheat toward the bag. |
| Modifier + diamond left (3rd) | **Infield in.** All four infielders on the grass. |
| Modifier + diamond right (1st) | **Corners in.** First and third crash for the bunt. |
| Modifier + diamond down (home) | **No doubles.** Outfield deep, corners on the lines. |
| Modifier + Special | **Normal.** |

None of these is a modifier on a dice roll. Each one is where nine people are
standing, and the trade is real in both directions:

- **Infield in** shortens the throw home enough to cut a run off at the plate,
  and lengthens the grass behind the infielders. Balls that were outs go through.
- **Double-play depth** shortens the pivot at second so you can turn two, and
  widens the hole on both sides of the bag.
- **No doubles** keeps everything in front of the outfielders and lets ordinary
  singles fall in all day.
- **Corners in** smothers a bunt and leaves both corners wide open.

You keep whatever you set until the next hitter, when the manager takes the card
back. The CPU makes the same calls from the same situation and in the same
priority order — cut off the tying run, then set up the double play, then
protect a late lead — and you can watch the infield walk in before the pitch,
which means you can hit against it.

**Pitching around.** Switch-fielder cycles three states. *Pitch around* stops
giving him anything over the plate; he may still swing at something off it, and
he may well walk. *Put him on* is the intentional walk. The CPU will put a
dangerous hitter on with two outs and first base open when the man on deck is a
step down — and never when the game is out of hand.

### Fielding

**You are always attached to the fielder chasing the ball.** Let go of the
controls for half a second and that fielder carries on doing its job by itself;
the prompt bar changes to **AUTO — MOVE TO TAKE OVER** so you can see it happen.
Push any direction and you have it back instantly. Hold the ball without
throwing for a little over a second and the throw gets made for you too. Nothing
on the field ever waits for you.


| Input | Effect |
|---|---|
| Move | Steers the currently selected fielder. Everyone else covers, backs up and relays on their own. |
| Diamond | Throws to that base. Out of range, the throw automatically goes through a cutoff man. |
| Special | Dive or leap, depending on how high the ball is. Extends reach by about two metres at the cost of a real chance of missing it. |
| Switch fielder | Cycles to the next-closest fielder to the ball. |

A cyan ring marks the fielder you control. A pulsing gold ring on the grass
marks where a fly ball is going to come down.

### Baserunning

| Input | Effect |
|---|---|
| Diamond | Sends the most relevant runner to that base. |
| Modifier + diamond | Sends that runner back. |
| Special | Advances every runner one base. |
| Modifier + Special | Sends every runner back. |

If you never touch a base button, your runners still run sensibly: they take
what is there, hold when the throw beats them, tag up on fly balls and score
from third on a sacrifice fly. A runner who breaks for the next bag on the pitch
gets a real throw from the catcher — a stolen base is contested, not awarded. Commands
are an override for when you want to be braver — or more careful — than the
default.

A small steady gold ring marks a runner holding; a larger pulsing green ring
marks a runner going. The size and the pulse carry the same information as the
colour, so the state is never colour-only.

---

## Menus

| Input | Effect |
|---|---|
| `↑` `↓` / `W` `S` / stick | Move the highlight |
| `←` `→` / `A` `D` / stick | Change the highlighted value |
| `Enter` / `Space` / `A` | Confirm |
| `Escape` / `B` | Back |
| Mouse | Hover to highlight, click to choose |
| Touch | Tap a row to choose it. Rows with a value grow **◀ ▶** buttons — a phone has no arrow keys, so the arrows have to be real. A `◀ BACK` button sits in the top-right corner of every screen that has somewhere to go back to. |

## When an action is not available

Pressing a base button with nobody who can go there, throwing before the fielder
has gathered the ball, or pitching before the pitcher is set all produce a short
denial sound and a one-line explanation in the middle of the screen — never
silence.

## Rebinding

**Controls** in the main menu or the pause menu rebinds every action for either
player. Choose the player at the top of the list, select an action, press the
key you want. Bindings are saved locally and survive a refresh. **Restore
defaults** puts everything back.
