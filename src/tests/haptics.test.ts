import { describe, expect, it } from 'vitest';
import { Haptics } from '../ui/haptics';

/**
 * VIBRATION
 * ---------
 * A motor is an output device with no undo. Everything worth testing here is
 * about restraint: that it stays quiet when it was not asked for, that it
 * cannot be made to buzz continuously by a burst of events, and that contact
 * actually varies with how well the ball was hit — because a motor that gives
 * the same answer to a jam-shot and a barrelled ball is telling the player
 * nothing while pretending to tell them something.
 */

function rig(): { h: Haptics; sent: (number | number[])[]; tick: (ms: number) => void } {
  const sent: (number | number[])[] = [];
  let now = 0;
  const h = new Haptics({ send: (p) => sent.push(p), clock: () => now });
  // Stand in for the first tap. Without one the motor stays sealed, which is
  // its own test below.
  h.noteGesture();
  return { h, sent, tick: (ms) => (now += ms) };
}

describe('haptics', () => {
  it('says nothing until it is enabled', () => {
    const { h, sent } = rig();
    h.fire('contact', 1);
    h.fire('homerun');
    expect(sent).toEqual([]);
  });

  it('only enables where the platform actually supports it', () => {
    const { h } = rig();
    h.setEnabled(true);
    // Node has no navigator.vibrate, which is the same position an iPhone is
    // in — so the switch has to refuse, not pretend.
    expect(h.isEnabled()).toBe(Haptics.supported());
    expect(Haptics.supported()).toBe(false);
  });

  it('will not run two patterns into one rattle', () => {
    const { h, sent, tick } = rig();
    forceOn(h);
    h.fire('press');
    h.fire('press');
    h.fire('press');
    expect(sent.length).toBe(1);
    tick(41);
    h.fire('press');
    expect(sent.length).toBe(2);
  });

  it('makes weak contact and a barrelled ball feel different', () => {
    const { h, sent, tick } = rig();
    forceOn(h);
    h.fire('contact', 0.1);
    tick(100);
    h.fire('contact', 0.6);
    tick(100);
    h.fire('contact', 0.95);

    const [weak, solid, crushed] = sent;
    expect(typeof weak).toBe('number');
    expect(typeof solid).toBe('number');
    expect(solid as number).toBeGreaterThan(weak as number);
    // The best-struck ball is the only one that is a pattern rather than a tap.
    expect(Array.isArray(crushed)).toBe(true);
  });

  it('keeps every pattern short enough not to be called buzzing', () => {
    const { h, sent, tick } = rig();
    forceOn(h);
    for (const kind of ['press', 'modifier', 'contact', 'homerun', 'strike', 'out', 'bigplay'] as const) {
      h.fire(kind, 1);
      tick(100);
    }
    for (const pattern of sent) {
      const total = Array.isArray(pattern) ? pattern.reduce((a, b) => a + b, 0) : pattern;
      expect(total).toBeLessThanOrEqual(200);
    }
  });

  it('stays sealed until the page has been touched', () => {
    // A page nobody has interacted with must not be able to buzz in a pocket.
    // Browsers enforce this; asking anyway is how a page ends up logging a
    // console error about a vibration it was never going to get.
    const sent: (number | number[])[] = [];
    const h = new Haptics({ send: (p) => sent.push(p), clock: () => 0 });
    forceOn(h);
    h.fire('homerun');
    expect(sent).toEqual([]);
    h.noteGesture();
    h.fire('homerun');
    expect(sent.length).toBe(1);
  });

  it('does not try to stop a vibration it never started', () => {
    const { h, sent } = rig();
    h.setEnabled(false);
    h.silence();
    expect(sent).toEqual([]);
  });

  it('goes quiet again when switched off', () => {
    const { h, sent, tick } = rig();
    forceOn(h);
    h.fire('press');
    tick(100);
    h.setEnabled(false);
    h.fire('homerun');
    expect(sent.length).toBe(1);
  });
});

/**
 * setEnabled refuses on a platform with no vibration API, which is every
 * platform Vitest runs on. The behaviour under test is what happens on a phone
 * that *does* have one, so the flag is set directly.
 */
function forceOn(h: Haptics): void {
  (h as unknown as { enabled: boolean }).enabled = true;
}
