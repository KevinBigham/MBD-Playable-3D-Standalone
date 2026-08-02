import { SLOT, loadSlot, saveSlot } from '../save/storage';

/**
 * THE FIRST THREE SWINGS.
 *
 * Touching the zone is a better control scheme than steering a cursor, and it
 * is completely invisible. There is nothing on a phone screen that says the
 * field is the input; a player who has held a controller before will look for
 * the button, find one that says CONTACT, press it, and watch a called strike
 * go by. The scheme is only obvious once, and only after somebody has told you.
 *
 * So the game tells you — on the zone, where the eye already is, not in a card
 * that has to be dismissed before play can start. Two rules keep it from
 * becoming furniture:
 *
 *   1. It is dismissed by DOING IT, not by reading it. Three touch swings and
 *      it never appears again, because three is enough to have understood.
 *   2. The count is kept forever, not per game. A hint that comes back every
 *      time you press Play is not a hint, it is a label, and a label you have
 *      read a hundred times is noise you have learned to look past.
 *
 * Batting and pitching are counted apart: they are different acts, learned at
 * different times, and somebody who has taken a hundred swings may still have
 * never stood on the mound.
 */

/** Touches of each kind after which the game stops explaining itself. */
export const LEARNED_AFTER = 3;

interface CoachMemory {
  swings: number;
  pitches: number;
}

const EMPTY: CoachMemory = { swings: 0, pitches: 0 };

export class Coach {
  private memory: CoachMemory;

  constructor(memory?: CoachMemory) {
    const saved = memory ?? loadSlot<CoachMemory>(SLOT.coach);
    // Trusted only as far as it is checkable. A corrupt or hand-edited count
    // should cost somebody a hint they did not need, never a crash.
    this.memory = {
      swings: Number.isFinite(saved?.swings) ? Math.max(0, Math.trunc(saved!.swings)) : 0,
      pitches: Number.isFinite(saved?.pitches) ? Math.max(0, Math.trunc(saved!.pitches)) : 0,
    };
  }

  /**
   * What the zone should say right now, or null for nothing. `mode` is the tap
   * mode the touch layer is in, so this answers only for a player who is
   * actually being asked to touch the field.
   */
  hint(mode: 'off' | 'aim' | 'swing' | 'pitch'): string | null {
    if (mode === 'pitch') {
      return this.memory.pitches < LEARNED_AFTER ? 'TOUCH WHERE TO PUT IT' : null;
    }
    if (mode === 'swing' || mode === 'aim') {
      return this.memory.swings < LEARNED_AFTER ? 'TOUCH WHERE IT WILL CROSS' : null;
    }
    return null;
  }

  /** Called once per zone touch that the engine accepted. */
  note(kind: 'aim' | 'contact' | 'power' | 'pitch'): void {
    // An aim between pitches is not a swing. Somebody dragging their finger
    // around the zone waiting for the windup has not yet done the thing the
    // hint is asking for, and counting it would retire the hint before it
    // taught anybody anything.
    if (kind === 'aim') return;
    if (kind === 'pitch') {
      if (this.memory.pitches >= LEARNED_AFTER) return;
      this.memory.pitches++;
    } else {
      if (this.memory.swings >= LEARNED_AFTER) return;
      this.memory.swings++;
    }
    saveSlot(SLOT.coach, this.memory);
  }

  /** For the settings screen: hand somebody back the explanation. */
  reset(): void {
    this.memory = { ...EMPTY };
    saveSlot(SLOT.coach, this.memory);
  }

  get learned(): boolean {
    return this.memory.swings >= LEARNED_AFTER && this.memory.pitches >= LEARNED_AFTER;
  }

  get counts(): CoachMemory {
    return { ...this.memory };
  }
}
