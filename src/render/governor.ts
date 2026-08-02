/**
 * THE PHONE GETS SLOWER WHILE YOU PLAY.
 *
 * A graphics setting is a promise about a machine that does not change. Phones
 * change. An iPhone renders the first over of a game at full speed and then, as
 * the back of the case warms, the SoC is clocked down — sometimes by half —
 * and stays there until it cools. A desktop-style "High / Balanced / Low" menu
 * cannot express that: whichever one the player picks is wrong for part of the
 * game. Picking High means the seventh inning stutters. Picking Low means the
 * first six innings look worse than the hardware could manage.
 *
 * So the honest answer on a phone is not a setting, it is a servo. This watches
 * the frame clock and moves down the ladder when the device stops keeping up,
 * then back up when it recovers.
 *
 * Two rules keep it from being worse than the thing it replaces:
 *
 *  - It is deaf to single bad frames. A garbage collection, a texture upload or
 *    an incoming notification will spike one frame, and a governor that reacts
 *    to spikes spends the game thrashing. It reads the *median* of a window,
 *    which a spike cannot move.
 *  - It gives up climbing. After two attempts to go back up that were
 *    immediately punished, it stops trying. A thermally throttled phone is not
 *    going to recover while you keep playing on it, and a governor that keeps
 *    testing that produces a visible pulse in image quality every few seconds —
 *    which is far more annoying than simply being one step lower.
 *
 * None of this touches the simulation. The game is stepped on a fixed clock, so
 * a phone at 38 fps plays exactly the same baseball as a laptop at 144.
 */

export interface QualityStep {
  /** Shown in the settings screen, so "Auto" can say what it is actually doing. */
  label: string;
  pixelRatioCap: number;
  renderScale: number;
  shadows: boolean;
  crowdAnimation: boolean;
}

/**
 * Best first. The early steps spend resolution, which on a 5-inch screen at 3x
 * device pixels is very hard to see; shadows and the animated crowd go later
 * because losing them is obvious.
 */
export const QUALITY_LADDER: QualityStep[] = [
  { label: 'Full', pixelRatioCap: 2, renderScale: 1, shadows: true, crowdAnimation: true },
  { label: 'High', pixelRatioCap: 1.75, renderScale: 0.85, shadows: true, crowdAnimation: true },
  { label: 'Balanced', pixelRatioCap: 1.5, renderScale: 0.75, shadows: true, crowdAnimation: true },
  { label: 'Lean', pixelRatioCap: 1.25, renderScale: 0.66, shadows: false, crowdAnimation: true },
  { label: 'Minimum', pixelRatioCap: 1, renderScale: 0.55, shadows: false, crowdAnimation: false },
];

/** Frames per sampling window. ~1.5 s at 60 Hz: long enough to mean something. */
const WINDOW = 90;
/** Sustained frame time that counts as failing, in seconds. ~47 fps. */
const TOO_SLOW = 1 / 47;
/** Sustained frame time comfortable enough to try for more, in seconds. ~68 fps. */
const COMFORTABLE = 1 / 68;
/** Consecutive comfortable windows before climbing. Slow up, quick down. */
const CLIMB_AFTER = 5;
/** Failed climbs before the governor accepts where it is. */
const MAX_FAILED_CLIMBS = 2;

export class FrameGovernor {
  private samples: number[] = [];
  private level = 0;
  private comfortable = 0;
  private failedClimbs = 0;
  /** Set when a climb is on probation; a slow window blames it. */
  private climbing = false;
  private enabled = false;
  /** Windows to ignore after a change, while the new buffer settles. */
  private settle = 0;

  constructor(private readonly onChange: (step: QualityStep) => void) {}

  setEnabled(on: boolean, startLevel = 1): void {
    if (this.enabled === on) return;
    this.enabled = on;
    this.samples.length = 0;
    this.comfortable = 0;
    this.failedClimbs = 0;
    this.climbing = false;
    this.settle = 2;
    if (on) {
      // Opening one step down from the top. Starting at Full and falling is a
      // worse first impression than starting at High and rising.
      this.level = clampLevel(startLevel);
      this.onChange(QUALITY_LADDER[this.level]);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  current(): QualityStep {
    return QUALITY_LADDER[this.level];
  }

  /** A one-line description for the settings screen. */
  describe(): string {
    if (!this.enabled) return '';
    const step = this.current();
    if (this.failedClimbs >= MAX_FAILED_CLIMBS) return `${step.label} — settled`;
    return step.label;
  }

  /** Feed the frame's duration in seconds. Cheap: a push and, once a window, a sort. */
  sample(dt: number): void {
    if (!this.enabled) return;
    // A frame that took a third of a second is the tab coming back from being
    // hidden, not the GPU struggling. It would drag a whole window down.
    if (dt > 0.25) return;
    this.samples.push(dt);
    if (this.samples.length < WINDOW) return;

    const median = medianOf(this.samples);
    this.samples.length = 0;

    if (this.settle > 0) {
      this.settle--;
      return;
    }

    if (median > TOO_SLOW) {
      this.comfortable = 0;
      if (this.climbing) {
        // We just moved up and immediately paid for it. That is a failed climb,
        // and two of those buy the device the right to be left alone.
        this.climbing = false;
        this.failedClimbs++;
      }
      this.step(1);
    } else if (median < COMFORTABLE) {
      this.climbing = false;
      this.comfortable++;
      if (this.comfortable >= CLIMB_AFTER && this.failedClimbs < MAX_FAILED_CLIMBS) {
        this.comfortable = 0;
        if (this.step(-1)) this.climbing = true;
      }
    } else {
      // In the band between the two thresholds, which is where a governor is
      // supposed to spend its life. Do nothing at all.
      this.comfortable = 0;
      this.climbing = false;
    }
  }

  /** Moves one rung; returns false at either end of the ladder. */
  private step(delta: number): boolean {
    const next = clampLevel(this.level + delta);
    if (next === this.level) return false;
    this.level = next;
    this.settle = 1;
    this.onChange(QUALITY_LADDER[this.level]);
    return true;
  }
}

function clampLevel(n: number): number {
  return Math.max(0, Math.min(QUALITY_LADDER.length - 1, Math.round(n)));
}

function medianOf(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
