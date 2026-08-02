import type { ActionId } from './input';
import type { ControlLabels } from './controls';
import { type Buzz, getHaptics } from './haptics';
import { isAppRotated } from './device';
import type { ZonePoint } from './zonepick';

export type TapMode = 'off' | 'aim' | 'swing' | 'pitch';

/** A finger landing on the strike zone: where, when, and what it meant. */
export interface ZoneTap {
  /** Metres from the middle of the plate; positive toward first base. */
  x: number;
  /** Metres above the ground. */
  y: number;
  /** Event timestamp, on the clock rAF uses. See InputFrame.pressAge. */
  at: number;
  /** What the tap is asking for, from the mode it was made in. */
  kind: 'aim' | 'contact' | 'power' | 'pitch';
}

/**
 * ON-SCREEN CONTROLS.
 *
 * The whole design follows from one fact about a phone: you cannot see your
 * thumbs' targets, because your thumbs are on top of them. So:
 *
 *   - the stick is *floating*. There is no fixed circle to hit. Put a thumb
 *     down anywhere in the left half and that is where the stick is; drag from
 *     there. Nothing to aim at means nothing to miss.
 *   - the four action buttons are laid out as the literal base diamond the
 *     control scheme is built on, and each one is captioned with what it does
 *     in the situation you are actually in — SWING, or 2ND, or PITCH 2.
 *   - the diamond is hit-tested as ONE control, by direction from its centre,
 *     rather than as four separate circles. See `diamondAt`.
 *   - the modifier LATCHES rather than being held. Holding a shoulder button
 *     with one thumb while pressing a face button with the other is a
 *     two-handed gamepad idiom that does not survive contact with a phone. Tap
 *     it, it stays lit, the next diamond press consumes it.
 *
 * Buttons never move between situations. Only their captions change, so muscle
 * memory survives the switch from batting to running the bases.
 */

const STICK_RADIUS = 52;
/** Below this the stick reads as centred, so a resting thumb does not drift. */
const STICK_DEADZONE = 0.16;

/**
 * The diamond read as pitch slots, matching `InputFrame.pitchSlot` in the
 * engine and the repertoire order on the HUD chips. One table, both directions.
 */
const DIAMOND_SLOT: Partial<Record<ActionId, number>> = {
  diamondLeft: 0,
  diamondDown: 1,
  diamondRight: 2,
  diamondUp: 3,
};
const SLOT_DIAMOND: ActionId[] = ['diamondLeft', 'diamondDown', 'diamondRight', 'diamondUp'];

interface StickTouch {
  id: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
}

export class TouchControls {
  readonly root: HTMLDivElement;
  /** True once this device has actually produced a touch. */
  available = false;

  private held = new Set<ActionId>();
  private edges = new Set<ActionId>();
  /** Action -> the event timestamp of the press. See InputFrame.pressAge. */
  private edgeAt = new Map<ActionId, number>();
  private buttons = new Map<ActionId, HTMLButtonElement>();
  /** pointerId -> which button it is holding, for multi-touch release. */
  private pointerButton = new Map<number, ActionId>();

  private stick: StickTouch | null = null;
  private stickEl: HTMLDivElement;
  private stickNub: HTMLDivElement;
  private stickHint: HTMLDivElement;
  private padEl: HTMLDivElement;
  private verbEl: HTMLDivElement;
  private diamondEl: HTMLDivElement;
  private zoneEl: HTMLDivElement;
  private rippleEl: HTMLElement;

  /**
   * What a touch on the field means right now.
   *
   *   off       nothing; the field is scenery and the stick owns the left half
   *   aim       point at the plate, but there is nothing to swing at yet
   *   swing     point at the plate and swing there
   *   pitch     point at the plate and throw the armed pitch there
   */
  private tapMode: TapMode = 'off';
  /** Converts a screen pixel into a spot on the plate; supplied by the app. */
  private zoneMapper: ((clientX: number, clientY: number) => ZonePoint | null) | null = null;
  private zoneTap: ZoneTap | null = null;
  /** Which swing a tap performs. Sticky, because a hitter has an approach. */
  private swingMode: 'contact' | 'power' = 'contact';
  /** Which pitch a tap throws, as an index into the repertoire. */
  private armedSlot = 0;

  /** Latched modifier: armed by a tap, spent by the next action press. */
  private modifierLatched = false;
  private spendLatch = false;

  private enabled = false;
  private labelKey = '';

  constructor(private onPause: () => void) {
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.innerHTML = `
      <div class="t-zone"><i class="t-ripple"></i></div>
      <div class="t-stickzone">
        <div class="t-stick"><i class="t-nub"></i></div>
        <div class="t-stickhint"></div>
      </div>
      <div class="t-pad">
        <div class="t-verb"></div>
        <div class="t-diamond">
          <button class="t-btn t-up" data-a="diamondUp" type="button"><b></b></button>
          <button class="t-btn t-left" data-a="diamondLeft" type="button"><b></b></button>
          <button class="t-btn t-right" data-a="diamondRight" type="button"><b></b></button>
          <button class="t-btn t-down" data-a="diamondDown" type="button"><b></b></button>
        </div>
        <div class="t-aux">
          <button class="t-btn t-wide" data-a="modifier" type="button"><b></b></button>
          <button class="t-btn t-wide" data-a="special" type="button"><b></b></button>
          <button class="t-btn t-wide" data-a="switchFielder" type="button"><b></b></button>
        </div>
      </div>
      <button class="t-pause" type="button" aria-label="Pause">II</button>
    `;

    this.stickEl = this.root.querySelector('.t-stick') as HTMLDivElement;
    this.stickNub = this.root.querySelector('.t-nub') as HTMLDivElement;
    this.stickHint = this.root.querySelector('.t-stickhint') as HTMLDivElement;
    this.padEl = this.root.querySelector('.t-pad') as HTMLDivElement;
    this.verbEl = this.root.querySelector('.t-verb') as HTMLDivElement;
    this.diamondEl = this.root.querySelector('.t-diamond') as HTMLDivElement;
    this.zoneEl = this.root.querySelector('.t-zone') as HTMLDivElement;
    this.rippleEl = this.root.querySelector('.t-ripple') as HTMLElement;
    this.zoneEl.addEventListener('pointerdown', this.onZoneDown);
    this.zoneEl.addEventListener('contextmenu', (e) => e.preventDefault());

    for (const el of this.root.querySelectorAll<HTMLButtonElement>('.t-btn')) {
      const action = el.dataset.a as ActionId;
      this.buttons.set(action, el);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      // The four diamond buttons do not listen for themselves — their container
      // owns the whole square and decides which of them a press meant.
      if (this.diamondEl.contains(el)) continue;
      el.addEventListener('pointerdown', (e) => this.onButtonDown(e, action, el));
      el.addEventListener('pointerup', (e) => this.onButtonUp(e));
      el.addEventListener('pointercancel', (e) => this.onButtonUp(e));
      // A thumb that slides off a button must release it, or the pad latches on.
      el.addEventListener('lostpointercapture', (e) => this.onButtonUp(e));
    }

    this.diamondEl.addEventListener('pointerdown', this.onDiamondDown);
    this.diamondEl.addEventListener('pointerup', (e) => this.onButtonUp(e));
    this.diamondEl.addEventListener('pointercancel', (e) => this.onButtonUp(e));
    this.diamondEl.addEventListener('lostpointercapture', (e) => this.onButtonUp(e));

    const pause = this.root.querySelector('.t-pause') as HTMLButtonElement;
    pause.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.markAvailable();
      this.onPause();
    });

    const zone = this.root.querySelector('.t-stickzone') as HTMLDivElement;
    zone.addEventListener('pointerdown', this.onStickDown);
    zone.addEventListener('pointermove', this.onStickMove);
    zone.addEventListener('pointerup', this.onStickUp);
    zone.addEventListener('pointercancel', this.onStickUp);
    zone.addEventListener('lostpointercapture', this.onStickUp);
  }

  /**
   * Turns the pad on. Kept separate from construction so a desktop session
   * never pays for it and never has a transparent overlay eating mouse clicks.
   */
  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    this.root.classList.toggle('on', on);
    if (!on) this.reset();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Hides the action pad while the CPU has the half-inning. */
  setVisible(on: boolean): void {
    this.root.classList.toggle('playing', on);
  }

  private markAvailable(): void {
    this.available = true;
  }

  /** Glass cannot click, so the motor says the press landed. */
  private feedback(kind: Buzz): void {
    getHaptics().fire(kind);
  }

  /** Mirrors the whole pad for a player whose strong thumb is the left one. */
  setLefty(on: boolean): void {
    this.root.classList.toggle('lefty', on);
    document.body.classList.toggle('lefty', on);
  }

  // ------------------------------------------------------------ tap the zone

  /** Supplies the screen-pixel-to-plate conversion. See zonepick.ts. */
  setZoneMapper(fn: (clientX: number, clientY: number) => ZonePoint | null): void {
    this.zoneMapper = fn;
  }

  /**
   * Turns the field itself into the control, and takes the stick away while it
   * is. Both halves of that matter: a floating stick that owns the left half of
   * the screen would swallow every tap on the left half of the zone, and the
   * stick has nothing to steer at the plate anyway.
   */
  setTapMode(mode: TapMode): void {
    if (this.tapMode === mode) return;
    this.tapMode = mode;
    this.root.classList.toggle('tapping', mode !== 'off');
    this.root.dataset.tap = mode;
    if (mode === 'off') this.zoneTap = null;
    this.paintArmed();
  }

  tapModeNow(): TapMode {
    return this.tapMode;
  }

  /** Which swing a tap will be. Shown on the pad, so it is never a guess. */
  swingModeNow(): 'contact' | 'power' {
    return this.swingMode;
  }

  /** Which pitch a tap will throw, as a repertoire index. */
  armedSlotNow(): number {
    return this.armedSlot;
  }

  /** Lights whichever diamond button a tap is currently going to act as. */
  private paintArmed(): void {
    const armed =
      this.tapMode === 'aim' || this.tapMode === 'swing'
        ? this.swingMode === 'power'
          ? 'diamondRight'
          : 'diamondDown'
        : this.tapMode === 'pitch'
          ? SLOT_DIAMOND[this.armedSlot]
          : null;
    for (const [action, el] of this.buttons) {
      if (action === 'modifier') continue;
      el.classList.toggle('armed', action === armed);
    }
  }

  /** The tap made this frame, if any. Cleared at the end of the frame. */
  takeZoneTap(): ZoneTap | null {
    return this.zoneTap;
  }

  private onZoneDown = (e: PointerEvent): void => {
    if (this.tapMode === 'off') return;
    e.preventDefault();
    this.markAvailable();
    const spot = this.zoneMapper?.(e.clientX, e.clientY);
    // No mapper, or a camera that is not looking at the plate. Doing nothing is
    // the only honest response — there is no sensible place to put a swing.
    if (!spot) return;
    this.zoneTap = {
      x: spot.x,
      y: spot.y,
      at: e.timeStamp,
      kind:
        this.tapMode === 'pitch'
          ? 'pitch'
          : this.tapMode === 'swing'
            ? this.swingMode
            : 'aim',
    };
    this.showRipple(e.clientX, e.clientY, this.zoneTap.kind);
    this.feedback(this.tapMode === 'aim' ? 'modifier' : 'press');
  };

  /**
   * A mark where the finger landed. On a phone the thumb covers the spot it
   * just chose, so the confirmation has to be bigger than the thumb and outlive
   * it — otherwise the only feedback for the most important input in the game
   * is a cursor you cannot see under your own hand.
   */
  private showRipple(clientX: number, clientY: number, kind: ZoneTap['kind']): void {
    const p = this.toGamePoint(clientX, clientY);
    const r = this.rippleEl;
    r.dataset.kind = kind;
    r.style.left = `${p.x}px`;
    r.style.top = `${p.y}px`;
    // Restart the animation: without the reflow, a second tap inside the first
    // ripple's lifetime does not replay it and reads as a press that was lost.
    r.classList.remove('go');
    void r.offsetWidth;
    r.classList.add('go');
  }

  private reset(): void {
    this.held.clear();
    this.edges.clear();
    this.edgeAt.clear();
    this.zoneTap = null;
    this.pointerButton.clear();
    this.stick = null;
    this.modifierLatched = false;
    this.spendLatch = false;
    this.stickEl.classList.remove('on');
    for (const el of this.buttons.values()) el.classList.remove('down', 'latched');
  }

  // ------------------------------------------------------------------ input

  private onButtonDown(e: PointerEvent, action: ActionId, el: HTMLButtonElement): void {
    e.preventDefault();
    e.stopPropagation();
    this.markAvailable();
    if (el.classList.contains('empty')) return;
    capture(el, e.pointerId);
    this.press(action, el, e.pointerId, e.timeStamp);
  }

  /**
   * A press on the diamond, resolved by direction rather than by which circle
   * happened to be under the thumb.
   *
   * Drawn as four circles at the points of a square, the buttons cover slightly
   * less than half of it: there is a hole in the middle where the bases meet
   * and a hole in each corner. A thumb landing in one of those holes did
   * nothing at all — no swing, no throw — and the player has no way to know
   * why, because their thumb is over the evidence. Reading the *direction* from
   * the centre instead means every point of the square, plus a margin outside
   * it, belongs to exactly one button. The visible circles stop being targets
   * and become labels, which is all a target you cannot see was ever worth.
   */
  private onDiamondDown = (e: PointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    this.markAvailable();
    const action = this.diamondAt(e.clientX, e.clientY);
    if (!action) return;
    const el = this.buttons.get(action);
    // An unlabelled direction means nothing here, and picking its neighbour
    // instead would be worse than doing nothing: it would be a call the player
    // did not make.
    if (!el || el.classList.contains('empty')) return;
    capture(this.diamondEl, e.pointerId);
    this.press(action, el, e.pointerId, e.timeStamp);
  };

  private diamondAt(clientX: number, clientY: number): ActionId | null {
    const r = this.diamondEl.getBoundingClientRect();
    const [dx, dy] = toGameDelta(
      clientX - (r.left + r.width / 2),
      clientY - (r.top + r.height / 2),
    );
    if (dx === 0 && dy === 0) return null;
    // The 45-degree split of a d-pad: whichever axis the thumb is further along.
    if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? 'diamondUp' : 'diamondDown';
    return dx < 0 ? 'diamondLeft' : 'diamondRight';
  }

  private press(
    action: ActionId,
    el: HTMLButtonElement,
    pointerId: number,
    at: number,
  ): void {
    this.pointerButton.set(pointerId, action);

    // With the field itself carrying the swing and the pitch, the diamond stops
    // performing them and starts *choosing* which one a tap will be. The press
    // is consumed here and never reaches the engine, which matters: the button
    // that used to mean SWING also means "send the runner home", and a caption
    // change alone would leave that second meaning armed.
    if (this.tapMode === 'aim' || this.tapMode === 'swing') {
      if (action === 'diamondDown' || action === 'diamondRight') {
        this.swingMode = action === 'diamondRight' ? 'power' : 'contact';
        this.paintArmed();
        this.feedback('modifier');
        return;
      }
    } else if (this.tapMode === 'pitch') {
      const slot = DIAMOND_SLOT[action];
      if (slot !== undefined) {
        this.armedSlot = slot;
        this.paintArmed();
        this.feedback('modifier');
        return;
      }
    }

    if (action === 'modifier') {
      // A latch, not a hold. Tapping it again puts it away.
      this.modifierLatched = !this.modifierLatched;
      this.spendLatch = false;
      el.classList.toggle('latched', this.modifierLatched);
      this.feedback('modifier');
      return;
    }

    el.classList.add('down');
    this.edges.add(action);
    this.edgeAt.set(action, at);
    this.held.add(action);
    this.feedback('press');
    // Anything that is not the modifier itself spends an armed modifier — that
    // is what makes "tap MOD, tap 2ND" mean steal second.
    if (this.modifierLatched) this.spendLatch = true;
  }

  private onButtonUp(e: PointerEvent): void {
    const action = this.pointerButton.get(e.pointerId);
    if (!action) return;
    this.pointerButton.delete(e.pointerId);
    if (action !== 'modifier') {
      this.held.delete(action);
      this.buttons.get(action)?.classList.remove('down');
    }
  }

  private onStickDown = (e: PointerEvent): void => {
    if (this.stick) return;
    e.preventDefault();
    this.markAvailable();
    capture(e.currentTarget as HTMLElement, e.pointerId);
    const p = this.toGamePoint(e.clientX, e.clientY);
    this.stick = { id: e.pointerId, originX: p.x, originY: p.y, x: 0, y: 0 };
    this.stickEl.classList.add('on');
    this.stickEl.style.left = `${this.stick.originX}px`;
    this.stickEl.style.top = `${this.stick.originY}px`;
    this.stickNub.style.transform = 'translate(-50%, -50%)';
  };

  private onStickMove = (e: PointerEvent): void => {
    const s = this.stick;
    if (!s || s.id !== e.pointerId) return;
    e.preventDefault();
    const p = this.toGamePoint(e.clientX, e.clientY);
    let dx = p.x - s.originX;
    let dy = p.y - s.originY;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      // Drag past the edge and the stick base follows the thumb, so a long
      // swipe never runs out of travel.
      s.originX += (dx / len) * (len - STICK_RADIUS);
      s.originY += (dy / len) * (len - STICK_RADIUS);
      this.stickEl.style.left = `${s.originX}px`;
      this.stickEl.style.top = `${s.originY}px`;
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    s.x = dx / STICK_RADIUS;
    s.y = dy / STICK_RADIUS;
    this.stickNub.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  };

  private onStickUp = (e: PointerEvent): void => {
    if (!this.stick || this.stick.id !== e.pointerId) return;
    this.stick = null;
    this.stickEl.classList.remove('on');
    this.stickNub.style.transform = 'translate(-50%, -50%)';
  };

  // ----------------------------------------------------------------- output

  /** A screen point in the coordinates the pad's own elements are laid out in. */
  private toGamePoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.root.getBoundingClientRect();
    const vx = clientX - rect.left;
    const vy = clientY - rect.top;
    return isAppRotated() ? { x: vy, y: rect.width - vx } : { x: vx, y: vy };
  }

  /** -1..1, positive right. */
  stickX(): number {
    return applyDeadzone(this.stick?.x ?? 0);
  }

  /** -1..1, positive UP, matching the input frame's convention. */
  stickY(): number {
    return -applyDeadzone(this.stick?.y ?? 0);
  }

  isHeld(action: ActionId): boolean {
    if (action === 'modifier') return this.modifierLatched;
    return this.held.has(action);
  }

  isPressed(action: ActionId): boolean {
    return this.edges.has(action);
  }

  /** When the press happened, on the clock rAF uses, or undefined. */
  pressedAt(action: ActionId): number | undefined {
    return this.edgeAt.get(action);
  }

  /** Called once per render frame, after the simulation has consumed the frame. */
  endFrame(): void {
    this.edges.clear();
    this.edgeAt.clear();
    this.zoneTap = null;
    if (this.spendLatch) {
      this.spendLatch = false;
      this.modifierLatched = false;
      this.buttons.get('modifier')?.classList.remove('latched');
    }
  }

  // ------------------------------------------------------------------ paint

  /**
   * Repaints the captions. Called every frame, so it early-outs on an unchanged
   * signature rather than rewriting eleven strings sixty times a second.
   */
  setLabels(labels: ControlLabels): void {
    if (!this.enabled) return;
    const key = [
      labels.situation,
      labels.verb,
      labels.stick,
      labels.diamondUp,
      labels.diamondLeft,
      labels.diamondDown,
      labels.diamondRight,
      labels.special,
      labels.modifier,
      labels.switchFielder,
    ].join('|');
    if (key === this.labelKey) return;
    this.labelKey = key;

    this.verbEl.textContent = labels.verb;
    this.stickHint.textContent = labels.stick;
    this.stickHint.classList.toggle('off', !labels.stick);
    this.padEl.dataset.situation = labels.situation;

    const set = (action: ActionId, text: string) => {
      const el = this.buttons.get(action);
      if (!el) return;
      const b = el.querySelector('b') as HTMLElement;
      b.textContent = text;
      // An unlabelled button does nothing here, so it stops looking pressable
      // and stops accepting the press.
      el.classList.toggle('empty', !text);
      el.disabled = !text;
    };
    set('diamondUp', labels.diamondUp);
    set('diamondLeft', labels.diamondLeft);
    set('diamondDown', labels.diamondDown);
    set('diamondRight', labels.diamondRight);
    set('special', labels.special);
    set('modifier', labels.modifier);
    set('switchFielder', labels.switchFielder);

    // A latch that survives into a situation with no use for it is a trap.
    if (!labels.modifier && this.modifierLatched) {
      this.modifierLatched = false;
      this.buttons.get('modifier')?.classList.remove('latched');
    }

    // A pitcher with three pitches must not open with the fourth one armed
    // because the last pitcher had four.
    if (this.buttons.get(SLOT_DIAMOND[this.armedSlot])?.classList.contains('empty')) {
      this.armedSlot = 0;
    }
    this.paintArmed();
  }
}

/**
 * A pointer event arrives in the screen's coordinates. When the game has
 * rotated itself to fill a portrait phone (see setAppRotated), everything on
 * screen is a quarter turn away from that, and a thumb sliding "up the screen"
 * is sliding left across the game. These two convert.
 *
 * The forward transform is `rotate(90deg) translateY(-100%)` about the top-left
 * corner, which sends a game point (x, y) to the screen point (H - y, x), where
 * H is the game box's own height — and that, after rotation, is the width of
 * the bounding rectangle. Inverting gives what is below.
 */
function toGameDelta(dx: number, dy: number): [number, number] {
  return isAppRotated() ? [dy, -dx] : [dx, dy];
}

/**
 * Pointer capture is what keeps a thumb attached to the button it started on
 * when it slides. It is also allowed to throw — the pointer may already have
 * been released, or be one the element does not own — and a throw here would
 * abandon the rest of the press handler and eat the input entirely. It is an
 * enhancement, so it fails quietly.
 */
function capture(el: HTMLElement, pointerId: number): void {
  try {
    el.setPointerCapture?.(pointerId);
  } catch {
    /* the press still counts */
  }
}

function applyDeadzone(v: number): number {
  const a = Math.abs(v);
  if (a < STICK_DEADZONE) return 0;
  return Math.sign(v) * Math.min(1, (a - STICK_DEADZONE) / (1 - STICK_DEADZONE));
}
