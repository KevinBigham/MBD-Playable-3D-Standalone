/**
 * WHAT KIND OF THING ARE WE RUNNING ON.
 *
 * Everything here is a guess, so nothing here is allowed to be a trap. A
 * desktop with a touchscreen must not lose its keyboard; a phone must not be
 * asked to hover. Both of those are avoided the same way — the touch pad turns
 * on when a *touch actually happens*, and the answers below only decide the
 * opening defaults.
 */

export interface DeviceProfile {
  /** The primary pointer is coarse: a finger, not a mouse. */
  touchPrimary: boolean;
  /** Small screen. Drives the compact HUD, not the controls. */
  phone: boolean;
  /** Fullscreen is worth offering — mobile browser chrome eats real estate. */
  canFullscreen: boolean;
}

export function detectDevice(): DeviceProfile {
  const coarse =
    typeof matchMedia === 'function' &&
    matchMedia('(pointer: coarse)').matches &&
    !matchMedia('(pointer: fine)').matches;
  const touchable = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const short = Math.min(window.innerWidth, window.innerHeight);
  const long = Math.max(window.innerWidth, window.innerHeight);

  return {
    touchPrimary: coarse && touchable,
    // A phone in landscape is short, not narrow, so the test has to be on the
    // small edge or every handset fails it the moment it is turned sideways.
    phone: touchable && short <= 560 && long <= 1180,
    canFullscreen:
      typeof document !== 'undefined' &&
      (!!document.documentElement.requestFullscreen || !!document.exitFullscreen),
  };
}

/**
 * The usable viewport.
 *
 * `window.innerHeight` is wrong on mobile Safari for most of a session: it
 * reports the height as though the browser toolbars were not there, so the
 * bottom of the game — which is exactly where the controls live — sits under
 * the address bar. `visualViewport` reports what the person can actually see.
 */
export function viewportSize(): { w: number; h: number } {
  const vv = window.visualViewport;
  if (vv) return { w: Math.round(vv.width), h: Math.round(vv.height) };
  return { w: window.innerWidth, h: window.innerHeight };
}

export function isPortrait(): boolean {
  const { w, h } = viewportSize();
  return h > w;
}

export async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    // iPhone Safari has no Fullscreen API at all. Failing here is expected and
    // costs nothing — the layout already handles browser chrome via the safe
    // area insets, so this is a bonus rather than a requirement.
  }
}
