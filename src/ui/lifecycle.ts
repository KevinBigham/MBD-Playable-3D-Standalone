/**
 * THE THINGS A PHONE DOES TO A GAME WHILE YOU ARE PLAYING IT.
 *
 * A desktop browser leaves a running page alone. A phone does not:
 *
 *  - the screen dims and locks after ~30 seconds of no touches, and a pitch you
 *    are watching involves no touches at all. Held wake lock, below.
 *  - a call, a notification tap, or a swipe to another app hides the page. The
 *    render loop stops there — rAF does not fire on a hidden page — but the
 *    game did not *pause*, so coming back drops the player mid-pitch with a
 *    count they did not choose. Hence `onHide`.
 *  - the tab may simply be discarded. That is `onPersist`, and it is the last
 *    call the page ever gets. It has to be cheap and synchronous.
 *
 * Everything here is optional at the platform level. `navigator.wakeLock` does
 * not exist on older iOS; `pagehide` fires where `beforeunload` does not. The
 * class is written so that a browser supporting none of it still plays.
 */

type Handlers = {
  /** Page went away: the phone locked, or the player switched apps. */
  onHide: () => void;
  /** Page came back. */
  onShow: () => void;
  /**
   * Write anything that must survive. Called on hide *and* on pagehide, so it
   * runs at least once before a discard. Must be synchronous — after pagehide
   * the page may never get another task.
   */
  onPersist: () => void;
};

export class Lifecycle {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;

  constructor(private readonly h: Handlers) {
    document.addEventListener('visibilitychange', this.onVisibility);
    // pagehide is the one teardown event mobile Safari reliably fires; it
    // covers a discard, a navigation and a tab close. `unload` does not fire on
    // iOS at all, and `beforeunload` is unreliable there.
    window.addEventListener('pagehide', this.onPageHide);
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
    void this.releaseWakeLock();
  }

  /**
   * Ask the screen to stay on. Requested per game rather than for the whole
   * session — holding it in the menus would burn battery for nothing, and a
   * player who walks away from a menu should get their screen back.
   */
  keepAwake(on: boolean): void {
    this.wanted = on;
    if (on) void this.acquireWakeLock();
    else void this.releaseWakeLock();
  }

  /** True when the platform granted a lock, so the settings screen can be honest. */
  isAwake(): boolean {
    return !!this.sentinel;
  }

  static wakeLockSupported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  private async acquireWakeLock(): Promise<void> {
    if (this.sentinel || !Lifecycle.wakeLockSupported()) return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      // The system drops the lock whenever the page is hidden, and does not
      // give it back. Forgetting this is why "keep the screen on" features stop
      // working after the first notification.
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
      });
    } catch {
      // Denied, or the document was not visible at the moment of asking. Either
      // way the game plays; the screen just behaves normally.
      this.sentinel = null;
    }
  }

  private async releaseWakeLock(): Promise<void> {
    const s = this.sentinel;
    this.sentinel = null;
    try {
      await s?.release();
    } catch {
      /* already gone */
    }
  }

  private onVisibility = (): void => {
    if (document.hidden) {
      this.h.onPersist();
      this.h.onHide();
      this.sentinel = null;
    } else {
      this.h.onShow();
      if (this.wanted) void this.acquireWakeLock();
    }
  };

  private onPageHide = (): void => {
    this.h.onPersist();
  };
}
