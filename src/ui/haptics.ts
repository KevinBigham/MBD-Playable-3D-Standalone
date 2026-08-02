/**
 * TOUCH THAT TOUCHES BACK.
 *
 * A physical button tells your thumb it worked. A pane of glass does not, so
 * every on-screen control has a moment of doubt in it — did that register? —
 * and in a game whose whole difficulty is a timing window, doubt is expensive.
 * The player looks down to check, and looks down is exactly what they cannot
 * afford to do while a pitch is in the air.
 *
 * The vibration motor closes that loop. A press ticks. Contact thumps in
 * proportion to how well the ball was struck, so you know you got it before the
 * camera has told you. A called third strike has its own short, flat buzz that
 * is unmistakably not the sound of a hit.
 *
 * Three rules keep it from becoming a nuisance:
 *
 *  - it never fires twice inside 40 ms, because a stack of overlapping patterns
 *    reads as one long meaningless rattle;
 *  - the patterns are short. Anything a player would describe as "buzzing" is
 *    too long;
 *  - it is off by default anywhere the platform did not clearly ask for it.
 *
 * PLATFORM REALITY: `navigator.vibrate` is an Android/Chromium feature. Safari
 * on iOS does not implement it at all, and the tricks that fake it there rely
 * on undocumented behaviour of a form control. So on an iPhone this class
 * reports unsupported and the setting says so, rather than offering a switch
 * that does nothing.
 */

export type Buzz =
  /** A button went down. The smallest tick that can be felt. */
  | 'press'
  /** The modifier latched or unlatched — a state change, not an action. */
  | 'modifier'
  /** Bat on ball. Scales with how well it was hit. */
  | 'contact'
  /** Over the wall. */
  | 'homerun'
  /** A swing that found nothing, or a called strike. */
  | 'strike'
  /** An out was recorded, either way. */
  | 'out'
  /** Something worth looking up for: a diving catch, a play at the plate. */
  | 'bigplay';

/** Patterns are [buzz, pause, buzz, ...] in milliseconds. */
const PATTERNS: Record<Buzz, number | number[]> = {
  press: 8,
  modifier: [6, 26, 14],
  contact: 18,
  homerun: [24, 40, 24, 40, 60],
  strike: [10, 50, 10],
  out: 26,
  bigplay: [16, 34, 40],
};

/** Two patterns closer together than this become one indistinct rattle. */
const MIN_GAP_MS = 40;

export class Haptics {
  private enabled = false;
  private last = -Infinity;
  /**
   * Browsers refuse to vibrate before the page has been touched, and Chromium
   * logs a console error when asked to. That is the correct policy — a page you
   * have not interacted with should not be able to buzz in your pocket — so the
   * motor stays sealed until the first real gesture rather than being asked and
   * refused.
   */
  private gestured = false;
  /** True while a pattern may still be running; nothing else may be stopped. */
  private buzzing = false;
  /** Injected so the tests can drive it without a phone. */
  private send: (pattern: number | number[]) => void;
  private clock: () => number;

  constructor(opts: {
    send?: (pattern: number | number[]) => void;
    clock?: () => number;
  } = {}) {
    this.send =
      opts.send ??
      ((pattern) => {
        try {
          navigator.vibrate(pattern);
        } catch {
          /* a browser that lied about supporting it */
        }
      });
    this.clock = opts.clock ?? (() => performance.now());
    if (typeof window !== 'undefined') {
      const seen = () => this.noteGesture();
      for (const ev of ['pointerdown', 'touchstart', 'keydown'] as const) {
        window.addEventListener(ev, seen, { once: true, passive: true, capture: true });
      }
    }
  }

  /** Records that the page has been interacted with. Idempotent. */
  noteGesture(): void {
    this.gestured = true;
  }

  static supported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  setEnabled(on: boolean): void {
    this.enabled = on && Haptics.supported();
    if (!this.enabled) this.silence();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * `power` is 0..1 and only means anything for contact, where it is the whole
   * point: a jam-shot and a barrelled ball must not feel the same.
   */
  fire(kind: Buzz, power = 0.5): void {
    if (!this.enabled || !this.gestured) return;
    const now = this.clock();
    if (now - this.last < MIN_GAP_MS) return;
    this.last = now;
    this.buzzing = true;
    this.send(kind === 'contact' ? contactPattern(power) : PATTERNS[kind]);
  }

  /** Stops anything still running — used when the page hides or the game ends. */
  silence(): void {
    // Nothing was ever started, so there is nothing to stop — and asking anyway
    // is how a page that has never vibrated ends up logging an error about
    // vibrating.
    if (!this.buzzing || !Haptics.supported()) return;
    this.buzzing = false;
    try {
      navigator.vibrate(0);
    } catch {
      /* nothing to stop */
    }
  }
}

/**
 * Weak contact is a short tap; a ball on the barrel is a double thump with the
 * second hit longer than the first, which is what "it carried" feels like.
 */
function contactPattern(power: number): number | number[] {
  const p = Math.max(0, Math.min(1, power));
  if (p < 0.45) return 10;
  if (p < 0.72) return Math.round(14 + p * 16);
  return [14, 26, Math.round(26 + p * 24)];
}

let singleton: Haptics | null = null;

export function getHaptics(): Haptics {
  if (!singleton) singleton = new Haptics();
  return singleton;
}
