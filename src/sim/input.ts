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
}

export function emptyInput(): InputFrame {
  return {
    moveX: 0,
    moveY: 0,
    moveZ: 0,
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
  };
}

export function clearEdges(f: InputFrame): void {
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
}

export interface InputPair {
  p1: InputFrame;
  p2: InputFrame;
}

export function emptyInputPair(): InputPair {
  return { p1: emptyInput(), p2: emptyInput() };
}
