/**
 * The engine consumes only this structure, which keeps keyboard, gamepad and
 * the headless CPU driver interchangeable — and makes input transitions
 * testable without a browser.
 *
 * Edge fields are true for exactly one simulation step.
 */
export interface InputFrame {
  /** -1..1 horizontal: cursor, aim, or fielder movement. */
  moveX: number;
  /** -1..1 vertical: cursor / aim. Positive is up. */
  moveY: number;
  /** -1..1 depth for fielders and runners. Positive is toward centre field. */
  moveZ: number;

  /**
   * PUT THE CURSOR HERE, rather than nudge it from where it was.
   *
   * `moveX`/`moveY` describe a stick or an arrow key: a direction, integrated
   * over time. That is the only thing a stick can say. A finger on a screen can
   * say something a stick cannot — *there* — and on a phone that is the whole
   * game: you touch the spot the ball is going to cross and the swing happens
   * at that spot. Steering a cursor across a zone with a thumb while a ball is
   * in the air is a worse version of a job the finger already did by pointing.
   *
   * `aimX`/`aimY` are in the same units as everything else at the plate: metres
   * from the centre of the plate, and metres above the ground. The engine clamps
   * them to the same limits the relative path uses, so a front end cannot reach
   * anywhere a stick could not.
   *
   * Read by the hitter (contact cursor) and by the pitcher (target). False for
   * the CPU, for tests, and for any front end that only has a stick.
   */
  aimAbsolute: boolean;
  aimX: number;
  aimY: number;

  swing: boolean;
  power: boolean;
  bunt: boolean;
  take: boolean;

  /** 0..3 selecting a pitch slot, or -1. */
  pitchSlot: number;
  /** 0 = home, 1 = first, 2 = second, 3 = third, or -1. */
  base: number;
  /** Held modifier: turns a base press into "go back". */
  modifier: boolean;

  dive: boolean;
  switchFielder: boolean;
  advanceAll: boolean;
  returnAll: boolean;
  /** Held: runner turbo / pitcher extra effort. */
  turbo: boolean;

  /**
   * How long ago, in seconds, the button that raised this frame's edges was
   * actually pressed.
   *
   * Input is read once per rendered frame, so a press is discovered somewhere
   * between zero and one frame after it happened — 0 to 17 ms on a 60 Hz phone,
   * randomly. For everything except swinging that is irrelevant. For swinging
   * it is a third of the difference between a home run and a fly out, and it is
   * *noise*: the same press, made at the same instant, is scored differently
   * depending on where the frame boundary fell.
   *
   * The presentation layer knows the real press time, because the browser
   * stamps it on the event. It reports the age here, the engine backdates the
   * swing by it, and the timing you get is the timing you had. The engine stays
   * a pure function of these frames — nothing reads a clock — so a replay of the
   * same frames is still the same game.
   *
   * Zero for the CPU, for tests, and for any front end that does not measure it.
   */
  pressAge: number;
}

export function emptyInput(): InputFrame {
  return {
    moveX: 0,
    moveY: 0,
    moveZ: 0,
    aimAbsolute: false,
    aimX: 0,
    aimY: 0,
    swing: false,
    power: false,
    bunt: false,
    take: false,
    pitchSlot: -1,
    base: -1,
    modifier: false,
    dive: false,
    switchFielder: false,
    advanceAll: false,
    returnAll: false,
    turbo: false,
    pressAge: 0,
  };
}

export function clearEdges(f: InputFrame): void {
  // An absolute aim is a single act of pointing, not a held position: it must
  // land on exactly one simulation step, like every other edge here. The
  // coordinates are left alone because nothing reads them without the flag.
  f.aimAbsolute = false;
  f.swing = false;
  f.power = false;
  f.bunt = false;
  f.take = false;
  f.pitchSlot = -1;
  f.base = -1;
  f.dive = false;
  f.switchFielder = false;
  f.advanceAll = false;
  f.returnAll = false;
  f.pressAge = 0;
}

export interface InputPair {
  p1: InputFrame;
  p2: InputFrame;
}

export function emptyInputPair(): InputPair {
  return { p1: emptyInput(), p2: emptyInput() };
}
