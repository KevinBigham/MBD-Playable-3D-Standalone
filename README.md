# MOONSHOT NINE

**An original arcade baseball game for the desktop browser.**

Ten fictional clubs, eight fictional ballparks and about two hundred fictional
ballplayers make up the Meridian Circuit. Games are fast, contact is loud, and
you hold the controls for every pitch, every swing, every throw and every
runner. There is no simulation to sit and watch: if something happens on the
field, somebody pressed a button to make it happen.

MOONSHOT NINE is a spiritual successor to the fast, personality-filled console
baseball games of the late 1990s. Everything in it — the league, the players,
the parks, the art, the sound, the music and the code — is original and
generated at runtime. No third-party game assets are used anywhere: there is not
one binary art or audio file in `src/`. Players are jointed low-poly models built
from primitives, ballparks are generated from their own fence curves, every sound
is synthesised by the Web Audio API, and type is set in system fonts.

---

## Install

Requires **Node.js 20 or newer**.

```bash
npm install
```

## Run

```bash
npm run dev
```

Then open the URL Vite prints (by default `http://localhost:5173`).

## Controls

The four action buttons are laid out like the bases, and always mean the base
they point at:

```
            I  =  2ND
      J = 3RD        L = 1ST
            K  =  HOME
```

| Situation | W A S D | J | K | L | I | Space | Left-Shift | Q |
|---|---|---|---|---|---|---|---|---|
| **Batting** | move the contact cursor | bunt | contact swing | power swing | take / check swing | — | hold + base = steal | — |
| **Pitching** | aim before the pitch, steer during it | pitch 1 | pitch 2 | pitch 3 | pitch 4 | — | hold + base = set the defence | pitch around / put him on |
| **Fielding** | move the selected fielder | throw to 3rd | throw home | throw to 1st | throw to 2nd | dive / leap | — | switch fielder |
| **Baserunning** | — | send to 3rd | send home | send to 1st | send to 2nd | advance everyone | hold + base = go back | — |

`Escape` pauses. `Enter` confirms in menus. Mouse works in every menu.

**Player 2** uses the arrow keys with `; . ' [` as the diamond (`;`=3rd, `.`=home,
`'`=1st, `[`=2nd), `/` for Special and Right-Shift as the modifier. Numpad
aliases (`4 5 6 8`, `0`, `7`) work too.

**Gamepad:** left stick or D-pad moves; the face buttons are the same diamond
(A = down/home, B = right/1st, X = left/3rd, Y = up/2nd); RB is Special, LB
switches fielder, LT is the modifier, Start pauses. Two pads = two players.

Every control can be rebound from **Controls** in the main menu or the pause
menu. Full detail lives in [CONTROLS.md](CONTROLS.md).

## The plate view

The at-bat is framed by a long lens from behind the plate, and everything you
need to win the duel is drawn on the strike zone itself:

- **A real strike zone**, big and static, marked in thirds, sized to the hitter
  standing in the box.
- **Your contact cursor** at the true size of that hitter's sweet spot — it
  shrinks when you commit to a power swing.
- **A pitch tracker**: a numbered, colour-coded dot for every pitch of the at-bat
  where it crossed. Three pitches in, you can see the pattern being worked on you.
- **The ball's flight path**, filled in from the pitcher's hand in that pitch's
  own colour once you have earned the read.
- **A swing verdict** under the zone after every cut: a timing needle plus EARLY
  or LATE, UNDER IT or OVER IT.
- **For the pitcher**: an aim bracket at the crossing point, with a preview arc
  for every pitch in the repertoire so you can pick a spot first and a shape
  second.

How much of the read you are given is the difficulty setting — Rookie shows it
early, Pro shows it late, Ace never shows it. The CPU hitter receives none of it,
and no ball physics change on any setting. The entire overlay can be switched off
under **Settings → Plate view**.

## Managing the defence

Baseball is not only the duel at the plate, and the four buttons carry a fourth
meaning while you are pitching. Hold the modifier and the diamond becomes the
manager's card — holding it is also what puts the card on screen, so there is
nothing to memorise:

```
       Shift + I  =  DOUBLE-PLAY DEPTH
Shift + J = INFIELD IN      Shift + L = CORNERS IN
       Shift + K  =  NO DOUBLES        Shift + Space = NORMAL
```

None of these are modifiers on a dice roll. Each one is where nine people are
actually standing, and every consequence falls out of the physics that was
already there:

| Call | What it buys | What it costs |
|---|---|---|
| **Infield in** | The throw home is short enough to cut the run off | Ground balls that were outs now shoot through |
| **Double-play depth** | A short pivot at second, so you can turn two | A wider hole on both sides of the bag |
| **No doubles** | Nothing gets past the outfielders | Ordinary singles fall in front of them all day |
| **Corners in** | First and third smother a bunt | The corners are wide open |

`Q` cycles **pitch to him → pitch around → put him on**. Pitching around never
gives him the middle of the plate; putting him on is the free pass.

The CPU manager makes the same calls off the same situation, in the order a
bench coach would: cut off the tying run first, set up the double play second,
protect a late lead third. You can see the infield walk in before the pitch, so
you can hit against it.

## Modes

| Mode | What it is |
|---|---|
| **Quick Play** | One exhibition game. Pick both clubs, the park, 3 / 6 / 9 innings, the difficulty, day or night, and whether each club is Player 1, Player 2 or the CPU. Set both to CPU to watch. |
| **Season** | A saved season of 18, 36 or 54 games per club with standings, league leaders, a full schedule, a four-team postseason and the Meridian Cup. Games you are not in are simulated instantly. Saves automatically after every game. |
| **Championship** | A standalone eight-club single-elimination bracket. Three wins takes the cup. Saved separately from Season. |
| **Moonshot Derby** | The home-run challenge. Ten outs each, anything that is not a home run is an out, ties go to a three-out swing-off and then to the longest blast. Two to four hitters, up to two of them human. |
| **Practice** | Endless drills for batting, pitching, fielding and baserunning. Nothing is scored; three outs simply resets the situation. |
| **Player Creator** | Build an original ballplayer — name, number, position, handedness, build, appearance — and spend a fixed pool of rating points. He joins the club you choose and plays in every mode. Saved locally; deleting him restores the club's original player. |
| **Clubs & Rosters** | Browse every club's line-up, bench, rotation and ratings. Your creations are tagged. |

## Tests

```bash
npm test
```

Runs the full Vitest suite: RNG determinism, ball-flight calibration, the swing
model, baseball rules driven through the real engine, runner invariants,
situational baseball (alignments, tag-ups, contested steals), season and cup
mode integrity, the derby, box-score bookkeeping, and a batch of 100
CPU-versus-CPU games checked for deadlocks, invalid states and believable
statistics.

Extra harnesses:

```bash
npx tsx scripts/simulate.ts 100 9 pro    # games, innings, difficulty
npx tsx scripts/tune-physics.ts          # ball-flight calibration table
npx tsx scripts/verify-fixes.ts          # box-score bookkeeping
npx tsx scripts/verify-season.ts         # full season and postseason integrity
npx tsx scripts/verify-foulout.ts        # no team ever bats with three outs
npx tsx scripts/verify-extras.ts         # extra innings stay bounded
```

## Production build

```bash
npm run build      # type-checks, then builds to dist/
npm run preview    # serves dist/ on http://localhost:4173
```

`dist/` is a static folder. It can be opened from any static host; no backend,
no account and no paid service is involved at any point.

To regenerate the screenshots and the gameplay recording in `docs/`, or to
measure frame rate and memory, first download the browser Playwright drives
(once per machine):

```bash
npx playwright install chromium
```

then:

```bash
npm run build
npm run preview &
npx tsx scripts/capture.ts     # screenshots + gameplay recording
npx tsx scripts/perf.ts        # frame rate, heap and GPU resource growth
```

Neither is needed to play the game.

## Known limitations

These are documented deliberately; none of them blocks a complete game.

- **No pickoff throws.** A runner's steal is decided against the catcher's arm
  rather than the pitcher's. Holding runners is done by pitching quickly.
- **Baserunners follow straight lines between bases** rather than a rounded
  arc. Distances and timings are exact; the visual path is simplified.
- **One-batter substitutions are limited to pitching changes.** There is no
  pinch hitter or defensive replacement.
- **Infield fly, balk, interference and obstruction are not implemented.**
  Their absence is consistent, never advantageous to one side, and does not
  affect any other rule.
- **A foul ball that lands more than 30 m from the plate is immediately dead**
  rather than being chased into the seats. Foul pop-ups inside that radius are
  fully playable.
- **The umpire's strike zone is exact.** There is no called-strike variance;
  what the zone shows is what is called.
- **Season statistics do not persist across seasons.** Each season keeps its
  own record book.
- **Extra innings use a tiebreaker.** From two innings past regulation, each
  half-inning starts with a runner on second base, so a tied game always ends.
- **A created player replaces the weakest player at his position** on the club
  you assign him to, rather than expanding the roster. Roster sizes stay fixed
  so the league stays balanced.
- **The catcher and umpire are not drawn during the at-bat.** The plate camera is
  a long lens standing roughly where the umpire's head would be, and a figure
  that close to it covers the strike zone rather than framing it. Both are drawn
  in every other shot.

## Documentation

- [CONTROLS.md](CONTROLS.md) — every input, both players, keyboard and gamepad
- [GAME_DESIGN.md](GAME_DESIGN.md) — the design and every tuned number
- [ARCHITECTURE.md](ARCHITECTURE.md) — how the code is organised and why
- [TEST_REPORT.md](TEST_REPORT.md) — what was tested and what was found
- [BUILD_LOG.md](BUILD_LOG.md) — decisions, defects, fixes, remaining risks
- [LICENSES.md](LICENSES.md) — dependencies and originality statement
