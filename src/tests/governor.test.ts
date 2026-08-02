import { describe, expect, it } from 'vitest';
import { FrameGovernor, QUALITY_LADDER } from '../render/governor';

/**
 * THE GRAPHICS SERVO
 * ------------------
 * A governor that reacts to noise is worse than no governor: the player sees
 * the image quality pulse every couple of seconds and has no idea why. So the
 * tests below are mostly about what it must *not* do — not react to a spike,
 * not oscillate, not climb forever on a phone that has thermally throttled and
 * is never going to get its performance back.
 *
 * Frame times are fed in directly, which is the whole reason the governor takes
 * a number instead of reading a clock: a thermal throttle takes four minutes to
 * happen on real hardware and four milliseconds to describe here.
 */

function harness(): { g: FrameGovernor; changes: string[] } {
  const changes: string[] = [];
  const g = new FrameGovernor((step) => changes.push(step.label));
  return { g, changes };
}

/** Feeds n frames of a given duration. */
function feed(g: FrameGovernor, fps: number, frames: number): void {
  for (let i = 0; i < frames; i++) g.sample(1 / fps);
}

describe('the frame governor', () => {
  it('does nothing at all until it is switched on', () => {
    const { g, changes } = harness();
    feed(g, 12, 1000);
    expect(changes).toEqual([]);
    expect(g.isEnabled()).toBe(false);
  });

  it('opens one step down from the top, not at the top', () => {
    const { g, changes } = harness();
    g.setEnabled(true);
    // Starting at Full and visibly falling is a worse first impression than
    // starting one below it and rising.
    expect(changes).toEqual(['High']);
    expect(g.current().label).toBe('High');
  });

  it('walks down while the device cannot keep up', () => {
    const { g } = harness();
    g.setEnabled(true);
    feed(g, 30, 90 * 20);
    expect(g.current().label).toBe('Minimum');
    // And stops there rather than running off the end of the ladder.
    feed(g, 30, 90 * 10);
    expect(g.current().label).toBe(QUALITY_LADDER[QUALITY_LADDER.length - 1].label);
  });

  it('ignores a spike inside an otherwise healthy window', () => {
    const { g, changes } = harness();
    g.setEnabled(true);
    changes.length = 0;
    for (let w = 0; w < 8; w++) {
      // One catastrophic frame — a garbage collection, a texture upload — in
      // every window of ninety. The median cannot see it.
      g.sample(0.2);
      feed(g, 90, 89);
    }
    // It may climb, because the device is genuinely fast. It must never drop.
    expect(changes.every((label) => label === 'Full')).toBe(true);
  });

  it('climbs back when the device recovers, and slowly', () => {
    const { g } = harness();
    g.setEnabled(true);
    feed(g, 30, 90 * 4); // fall
    const low = g.current().label;
    expect(low).not.toBe('High');

    feed(g, 90, 90 * 2); // two comfortable windows: not enough
    expect(g.current().label).toBe(low);

    feed(g, 90, 90 * 8); // sustained comfort: now it may climb
    expect(QUALITY_LADDER.findIndex((s) => s.label === g.current().label)).toBeLessThan(
      QUALITY_LADDER.findIndex((s) => s.label === low),
    );
  });

  it('stops trying once a throttled phone has punished two climbs', () => {
    const { g, changes } = harness();
    g.setEnabled(true);
    // A device that sustains one rung comfortably and drowns anywhere above it.
    // That is the shape of a thermally limited phone, and it is the shape that
    // makes a naive governor oscillate for the rest of the game.
    const ceiling = QUALITY_LADDER.findIndex((s) => s.label === 'Balanced');
    const oneFrame = () =>
      g.sample(1 / (QUALITY_LADDER.indexOf(g.current()) >= ceiling ? 90 : 30));

    for (let i = 0; i < 90 * 200; i++) oneFrame();
    expect(g.current().label).toBe('Balanced');
    expect(g.describe()).toContain('settled');

    const settledAt = changes.length;
    for (let i = 0; i < 90 * 100; i++) oneFrame();
    expect(changes.length).toBe(settledAt);
  });

  it('holds still in the band between the thresholds', () => {
    const { g, changes } = harness();
    g.setEnabled(true);
    changes.length = 0;
    // 60 fps exactly: fast enough not to worry, not fast enough to gamble on.
    feed(g, 60, 90 * 30);
    expect(changes).toEqual([]);
  });

  it('forgets everything when it is switched off and on', () => {
    const { g } = harness();
    g.setEnabled(true);
    feed(g, 25, 90 * 20);
    expect(g.current().label).toBe('Minimum');
    g.setEnabled(false);
    g.setEnabled(true);
    expect(g.current().label).toBe('High');
    expect(g.describe()).toBe('High');
  });
});
