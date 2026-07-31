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
beats it into the ground. Swinging early pulls; swinging late goes the other
way. The feedback pip after every swing tells you which one got you.

### Pitching

| Input | Effect |
|---|---|
| Move (before the pitch) | Moves the aim reticle. It marks **where the ball will cross the plate**, break included. |
| Diamond left / down / right / up | Throws pitch 1 / 2 / 3 / 4 from this pitcher's repertoire. The four chips at bottom-left show the pitch, its speed, and a warning when you have leaned on it too heavily. |
| Move (during the flight) | Steers the ball. The effect saturates, so mashing a direction bends the pitch — it cannot teleport it. A pitcher with high Movement steers more. |

Execution error comes from the pitcher's Control rating, his fatigue, the
pitch's own wildness and how far outside you aimed. A tired pitcher loses both
velocity and command, and the stamina bar under his name tells you when.

The CPU hitter tracks how often you use each pitch. Lean on one and it starts
sitting on it: your best pitch gets worse the more you love it.

### Fielding

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
what is there, hold when the throw beats them and tag up on fly balls. Commands
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
