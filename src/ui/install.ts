/**
 * PUTTING THE GAME ON THE HOME SCREEN.
 *
 * Installed and in a browser tab are not the same game on a phone. Installed,
 * it gets the whole screen with no address bar eating an inch of the field, it
 * keeps its own place in the app switcher instead of being one tab among
 * thirty, it survives being closed, and — because it has a service worker — it
 * runs with the wifi off. None of that costs anything. It is simply switched
 * off by default because nobody knows to ask for it.
 *
 * The asking is the whole problem, and it works differently on the two
 * platforms that matter:
 *
 *   ANDROID / CHROMIUM  fires `beforeinstallprompt`, which can be caught and
 *                       replayed later from a real button. That is the good
 *                       case: one tap, a system dialog, done.
 *   iOS SAFARI          never fires it and has no API at all. The only route is
 *                       the Share sheet, and the only thing a game can do is
 *                       say so — accurately, and once.
 *
 * The offer needs no memory and no dismiss button, which is worth saying out
 * loud because both are the obvious things to build. It appears as the last row
 * of the main menu — under Settings, after everything a person came here to do —
 * so it is furniture rather than a nag, and it retires itself: once the game is
 * launched from the home screen `isInstalled()` is true and the row is gone.
 * Somebody who is never going to install it is looking at one menu row, which
 * is what a menu row is for.
 *
 * The offer is read fresh every time the main menu is built, which is the only
 * place it appears, so there is nothing to notify either.
 */

/** The Chromium-only event. Not in lib.dom, because it is not standard. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallOffer =
  /** Nothing to offer: already installed, unsupported, or turned down. */
  | 'none'
  /** A real system install dialog is one tap away. */
  | 'prompt'
  /** No API. The Share sheet, described in words. */
  | 'ios';

/** Running from the home screen rather than in a browser tab. */
export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  const standalone =
    typeof matchMedia === 'function' &&
    (matchMedia('(display-mode: standalone)').matches ||
      matchMedia('(display-mode: fullscreen)').matches ||
      matchMedia('(display-mode: minimal-ui)').matches);
  // Safari's own, from before the media query existed, and still the only one
  // that answers on an iPhone.
  const legacy = (navigator as unknown as { standalone?: boolean }).standalone === true;
  return standalone || legacy;
}

/**
 * An iPhone or iPad. The iPad half of the test is a user-agent lie:
 * iPadOS reports itself as a Mac, and the only tell left is that Macs do not
 * have touchscreens.
 */
export function isApplePhone(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Mac/.test(ua) && navigator.maxTouchPoints > 1;
}

export class Install {
  private pending: InstallPromptEvent | null = null;

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('beforeinstallprompt', (e) => {
      // Held, not shown. Chromium's own banner is suppressed by this and
      // replaced with a button somewhere the player is not in the middle of a
      // pitch — which is the point of catching it.
      e.preventDefault();
      this.pending = e as InstallPromptEvent;
    });
    window.addEventListener('appinstalled', () => {
      this.pending = null;
    });
  }

  offer(): InstallOffer {
    if (isInstalled()) return 'none';
    if (this.pending) return 'prompt';
    // Only phones get told about the Share sheet. On a desktop the game is
    // fine in a tab and the instruction would be wrong anyway.
    if (isApplePhone()) return 'ios';
    return 'none';
  }

  /**
   * Shows the system dialog. Resolves true only if it was actually installed —
   * a dismissed dialog is not a decline, because people close dialogs by
   * accident and the offer should still be there next time.
   */
  async accept(): Promise<boolean> {
    const e = this.pending;
    if (!e) return false;
    this.pending = null;
    try {
      await e.prompt();
      const { outcome } = await e.userChoice;
      return outcome === 'accepted';
    } catch {
      return false;
    }
  }
}
