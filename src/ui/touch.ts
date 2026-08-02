import type { ActionId } from './input';
import type { ControlLabels } from './controls';

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
  private buttons = new Map<ActionId, HTMLButtonElement>();
  /** pointerId -> which button it is holding, for multi-touch release. */
  private pointerButton = new Map<number, ActionId>();

  private stick: StickTouch | null = null;
  private stickEl: HTMLDivElement;
  private stickNub: HTMLDivElement;
  private stickHint: HTMLDivElement;
  private padEl: HTMLDivElement;
  private verbEl: HTMLDivElement;

  /** Latched modifier: armed by a tap, spent by the next action press. */
  private modifierLatched = false;
  private spendLatch = false;

  private enabled = false;
  private labelKey = '';

  constructor(private onPause: () => void) {
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.innerHTML = `
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

    for (const el of this.root.querySelectorAll<HTMLButtonElement>('.t-btn')) {
      const action = el.dataset.a as ActionId;
      this.buttons.set(action, el);
      el.addEventListener('pointerdown', (e) => this.onButtonDown(e, action, el));
      el.addEventListener('pointerup', (e) => this.onButtonUp(e));
      el.addEventListener('pointercancel', (e) => this.onButtonUp(e));
      // A thumb that slides off a button must release it, or the pad latches on.
      el.addEventListener('lostpointercapture', (e) => this.onButtonUp(e));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }

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

  private reset(): void {
    this.held.clear();
    this.edges.clear();
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
    this.pointerButton.set(e.pointerId, action);

    if (action === 'modifier') {
      // A latch, not a hold. Tapping it again puts it away.
      this.modifierLatched = !this.modifierLatched;
      this.spendLatch = false;
      el.classList.toggle('latched', this.modifierLatched);
      return;
    }

    el.classList.add('down');
    this.edges.add(action);
    this.held.add(action);
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
    const rect = this.root.getBoundingClientRect();
    this.stick = {
      id: e.pointerId,
      originX: e.clientX - rect.left,
      originY: e.clientY - rect.top,
      x: 0,
      y: 0,
    };
    this.stickEl.classList.add('on');
    this.stickEl.style.left = `${this.stick.originX}px`;
    this.stickEl.style.top = `${this.stick.originY}px`;
    this.stickNub.style.transform = 'translate(-50%, -50%)';
  };

  private onStickMove = (e: PointerEvent): void => {
    const s = this.stick;
    if (!s || s.id !== e.pointerId) return;
    e.preventDefault();
    const rect = this.root.getBoundingClientRect();
    let dx = e.clientX - rect.left - s.originX;
    let dy = e.clientY - rect.top - s.originY;
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

  /** Called once per render frame, after the simulation has consumed the frame. */
  endFrame(): void {
    this.edges.clear();
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
  }
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
