# MOONSHOT NINE

**An original arcade baseball game for the browser — on a laptop or a phone.**

Games are fast, contact is loud, and you hold the controls for every pitch,
every swing, every throw and every runner. There is no simulation to sit and
watch: if something happens on the field, somebody pressed a button to make it
happen.

It opens on the **thirty-two franchises of Mr. Baseball Dynasty** — it is the
arcade half of the MBD arcade-world bridge, and can be handed a real dynasty's
rosters and ratings. Its own league, the ten-club **Meridian Circuit**, is one
row away under *World* and is what seasons and the cup are played on. Eight
ballparks serve both.

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

## Playing it on a phone

MOONSHOT NINE is a phone game that happens to run on a desktop, and the fastest
way to get it onto a handset is over your own wifi:

```bash
npm run phone
```

That builds the production bundle and serves it on every network interface.
Vite prints two addresses; the **Network** one — something like
`http://192.168.1.194:4173` — is the one to type into the phone's browser, with
the phone on the same wifi as the computer. Nothing is installed and nothing
leaves the house.

Two things do not work over that address, both because they require HTTPS and
not because of anything the game does: the **service worker**, so there is no
offline play, and the **wake lock**, so the screen will dim on its own. Both
come back on a real https origin.

### A permanent URL

**https://kevinbigham.github.io/MBD-Playable-3D-Standalone/**

`.github/workflows/deploy.yml` publishes `dist/` there on every push to `main`,
gated behind the test suite — a branch that fails the suite does not become the
live site. It is https, which is what makes offline play and the wake lock work;
neither exists over the LAN address above.

On a fork, the workflow does nothing until Pages is switched on for the
repository, which is deliberate — it makes the repository a public website, and
that is a decision with an owner:

```bash
gh api -X POST repos/:owner/:repo/pages -f build_type=workflow
```

or **Settings → Pages → Source → GitHub Actions** on github.com.

### On the home screen

Installed, the game gets the whole screen with no address bar taking an inch off
the field, its own icon and place in the app switcher, and — because of the
service worker — it runs with the wifi off. The main menu offers **Add to Home
Screen** when the device can do it: a one-tap system dialog on Android, and the
Share-sheet instructions on iOS, which gives a web page no way to ask for
itself. It is offered once and never nags.

## Playing a Mr. Baseball Dynasty world

MOONSHOT NINE is the **arcade consumer** in the MBD arcade-world bridge: it can
be handed a dynasty's franchises, rosters and ratings, play one game inside
them, and hand back a factual receipt. **Main menu -> World.**

| Row | What it loads |
|---|---|
| The Meridian Circuit | This game's own ten clubs. Seasons and the cup live here. |
| MBD Sample World | All thirty-two MBD franchises, built in — **this is what a fresh install opens in.** The clubs are real; the players are generated, because MBD has no exporter yet. |
| Import an MBD World… | A `.json` bundle exported from a save. |

The chosen world governs **Quick Play, Practice, the Derby and Clubs & Rosters**
— everything the contract calls exhibition play. It survives a reload; the boot
default deliberately does not write itself into storage, so it stays a default
rather than becoming a decision nobody made.

The rule the whole bridge is built around: **MBD is the world authority.** This
game never owns contracts, promotions, trades, ratings development, schedule
progression, standings or save history — it owns the game in progress. Player
and team IDs are the joins and are never matched by name.

What crosses, and how:

- **Ratings** convert from MBD's canonical internal 0–550 to this game's 20–99,
  from `internal` only and never from a derived field, and monotonically: a
  higher source rating can never produce a worse arcade skill. Swept across all
  551 values in `bridge.test.ts`.
- **Park factor picks the ballpark.** MBD's 0.95–1.12 lands on the nearest of
  this game's eight parks by carry, so the factor is applied *once*, as geometry
  a hitter can see, rather than as an invisible multiplier stacked on top of a
  park that is already simulated in full.
- **`stuff` becomes the arsenal.** This game has no `stuff` attribute and adding
  one would be a balance change smuggled in as an import feature — but a pitcher
  with a splitter is exactly what "swing-and-miss quality" means here.
- **Invented facts are listed, not hidden.** MBD has no handedness, jersey
  number, body type, ballpark or repertoire. This game derives all of them from
  the player's own MBD id — identical on every device — and the World screen
  prints exactly what it made up and what it ignored.

A bundle that does not check out is **rejected, not repaired**: a wrong lineup
size, a roster claiming another club's player, an ineligible hitter batting, a
starter who cannot pitch. Repairing any of those would produce a game that looks
like the dynasty and is not.

**Season and the cup stay on the Meridian Circuit.** That is the contract's own
division rather than a limitation invented here — an exhibition package is
defined for "team selection, local exhibition games, practice, home-run derby
and other non-dynasty modes" and "produces no importable dynasty receipt".

### What is not built

`src/bridge/receipt.ts` builds and reconciles the result receipt, and it is
tested against real games played through the real engine — but **nothing in the
interface emits one.** MBD cannot yet reserve a scheduled game for external
play or accept a receipt back, so a download button would be inventing the
appearance of a closed loop. See `ARCHITECTURE.md`, "The MBD bridge".

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

### On a phone

**You bat by touching the strike zone where you think the ball is going to
cross.** The swing happens there. One touch carries both halves of a swing — the
spot and the moment — because that is exactly what a touch is: a place and an
instant. No cursor to steer, no button to press, nothing to do with your other
thumb. Touch the corner you think he is painting; if you are right you barrel
it, and if you are a hand's width off you foul it back.

The four buttons stop swinging and start choosing *which* swing — `CONTACT`,
`POWER`, `BUNT`, `TAKE` — and they stay where you put them, because a hitter has
an approach. On the mound it is the same idea in the order a pitcher thinks in:
pick the pitch on the diamond, touch the spot, and that is where it goes.

Everything else is still there under it. A floating stick in the left half — put
a thumb down anywhere and that is where the stick is — runs fielders and
runners. The modifier latches instead of being held, and arming it re-labels the
diamond, so `DEFENCE` turns it into `DP` / `IN` / `CORNERS` / `NO XBH` in front
of you. The diamond is hit-tested as **one control**: a press anywhere in its
square, including the gap in the middle and the corners, takes whichever button
lies in that direction.

Everything else the phone does to a game is handled rather than ignored:

- **A locked phone does not cost you the game.** The game writes itself down
  when the page is hidden, on every route out of the tab and once per
  half-inning; **Resume Game** is the first row on the main menu when there is
  one. What comes back is the same game — same generator position, same count,
  same runners — not an approximation of it.
- **Backgrounding pauses.** A call or a notification used to leave a pitch in
  the air.
- **The screen stays awake** during a game, and is allowed to sleep in the menus.
- **Graphics move themselves.** Phones throttle as they warm up, so a fixed
  quality setting is wrong for part of every game. `AUTO` watches the frame
  clock and walks the settings up and down; it gives up climbing once the device
  has punished two attempts, because a visible pulse in image quality every few
  seconds is worse than simply being one step lower.
- **It plays with no signal** once installed to the home screen.
- **Left-handed layout** and **vibration** are in Settings.

Play in landscape. Portrait puts up a card offering to **turn the game instead**
— for a phone with rotation locked, the whole game rotates a quarter turn and
fills the screen, controls and all — or to play in portrait anyway.

See [CONTROLS.md](CONTROLS.md) for the full table.

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
under **Settings → Plate view** — except on a phone with touch-to-swing on,
where the zone is the thing you are aiming at and so cannot be hidden.

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
npx playwright install chromium webkit
```

then:

```bash
npm run build
npm run preview &
npx tsx scripts/capture.ts     # screenshots + gameplay recording
npx tsx scripts/perf.ts        # frame rate, heap and GPU resource growth
npm run test:phone             # the phone audit, in WebKit, with real touches
npm run test:world             # a first visit lands in the right league, everywhere
npm run icons                  # re-rasterise the PNG icons from the SVGs
```

`npm run test:world` runs in a fresh browser context — no stored settings, no
stored world — because the bug it exists for does not throw. When a menu walks a
different league than the one on the field, nothing crashes: the labels just
name clubs that are not in the game and every ballpark collapses to the same
default. Point it at the live site with `CAPTURE_URL=<url>` to check the real
deploy rather than a local build.

None of them is needed to play the game.

`npm run test:phone` is the one worth running after any change to the touch
layer, the layout or the page shell. It drives the production build in
**WebKit** — Safari's engine, not Chromium — at an iPhone's size and pixel
density, with a touchscreen instead of a mouse, and fails the run if the page
can be zoomed or scrolled, if a control is off-screen or under 44×44, if any
part of the strike zone is behind a button, or if touching the crossing point
does not produce a hit. It exists because Chromium is a good stand-in for
Android and a poor one for the iPhone: it will happily report that
`user-scalable=no` stopped a pinch zoom, which on iOS Safari it has not done
since iOS 10.

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
- **Vibration is Android-only.** Safari on iPhone has no vibration API and the
  workarounds for it depend on undocumented behaviour, so the setting reports
  itself unsupported there instead of pretending.
- **iPhone Safari has no Fullscreen API either**, so that setting reads OFF
  there. The layout already keeps clear of the browser toolbars.
- **A rotated game reads the safe-area insets from the phone, not from itself.**
  When the game turns itself a quarter turn for a rotation-locked phone, the
  notch and home indicator are on edges the layout now calls something else.
  There is no way to map them individually without knowing which way the phone
  was turned, so the rotated layout keeps clear of the largest inset on every
  side — slightly wasteful, never wrong.
- **An offline copy needs one online visit first**, and picks up an update on
  the visit after it is deployed. The page itself is fetched from the network
  first so a bad deploy cannot pin itself.

## Documentation

- [CONTROLS.md](CONTROLS.md) — every input, both players, keyboard and gamepad
- [GAME_DESIGN.md](GAME_DESIGN.md) — the design and every tuned number
- [ARCHITECTURE.md](ARCHITECTURE.md) — how the code is organised and why
- [TEST_REPORT.md](TEST_REPORT.md) — what was tested and what was found
- [BUILD_LOG.md](BUILD_LOG.md) — decisions, defects, fixes, remaining risks
- [LICENSES.md](LICENSES.md) — dependencies and originality statement
