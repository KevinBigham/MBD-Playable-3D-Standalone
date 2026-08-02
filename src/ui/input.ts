import { type InputFrame, clearEdges, emptyInput } from '../sim/input';
import { loadSlot, saveSlot } from '../save/storage';
import type { TouchControls } from './touch';

/**
 * Input layer.
 *
 * The whole control scheme is built around one mnemonic: the four action
 * buttons form the base diamond.
 *
 *        UP  = SECOND
 *   LEFT = THIRD   RIGHT = FIRST
 *        DOWN = HOME
 *
 * Fielding and baserunning use that diamond literally. Batting maps it to
 * take / bunt / contact / power, and pitching maps it to the four pitch slots.
 * Nothing is context-sensitive within a single situation, so a prompt bar can
 * always show the four current meanings.
 */

export type ActionId =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'diamondUp'
  | 'diamondDown'
  | 'diamondLeft'
  | 'diamondRight'
  | 'special'
  | 'modifier'
  | 'switchFielder';

export interface Bindings {
  p1: Record<ActionId, string[]>;
  p2: Record<ActionId, string[]>;
}

export const DEFAULT_BINDINGS: Bindings = {
  p1: {
    up: ['KeyW'],
    down: ['KeyS'],
    left: ['KeyA'],
    right: ['KeyD'],
    diamondUp: ['KeyI'],
    diamondDown: ['KeyK'],
    diamondLeft: ['KeyJ'],
    diamondRight: ['KeyL'],
    special: ['Space'],
    modifier: ['ShiftLeft'],
    switchFielder: ['KeyQ'],
  },
  p2: {
    up: ['ArrowUp'],
    down: ['ArrowDown'],
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    diamondUp: ['BracketLeft', 'Numpad8'],
    diamondDown: ['Period', 'Numpad5'],
    diamondLeft: ['Semicolon', 'Numpad4'],
    diamondRight: ['Quote', 'Numpad6'],
    special: ['Slash', 'Numpad0'],
    modifier: ['ShiftRight'],
    switchFielder: ['Backslash', 'Numpad7'],
  },
};

export const ACTION_LABELS: Record<ActionId, string> = {
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  diamondUp: 'Diamond Up (2nd)',
  diamondDown: 'Diamond Down (Home)',
  diamondLeft: 'Diamond Left (3rd)',
  diamondRight: 'Diamond Right (1st)',
  special: 'Special (dive / advance all)',
  modifier: 'Modifier (hold to go back / steal)',
  switchFielder: 'Switch fielder',
};

export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'pause' | 'tab';

const DEADZONE = 0.28;

interface PadSnapshot {
  axes: number[];
  buttons: boolean[];
}

/** Which simulation context the player is in; decides how the diamond reads. */
export type ControlContext = 'batting' | 'pitching' | 'fielding' | 'baserunning' | 'menu';

export class InputManager {
  private keys = new Set<string>();
  private keyEdges = new Set<string>();
  private bindings: Bindings;
  private padPrev: PadSnapshot[] = [];
  private padEdges: boolean[][] = [];
  private menuQueue: MenuAction[] = [];
  private capture: ((code: string) => void) | null = null;
  /**
   * The on-screen pad, when one is mounted. It only ever drives player one —
   * two thumbs on one phone is not a two-player control scheme.
   */
  private touch: TouchControls | null = null;
  /** True whenever any gamepad reported input this session. */
  gamepadSeen = false;
  lastDeviceWasPad = false;

  readonly p1: InputFrame = emptyInput();
  readonly p2: InputFrame = emptyInput();

  constructor() {
    this.bindings = loadSlot<Bindings>('bindings') ?? cloneBindings(DEFAULT_BINDINGS);
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('gamepadconnected', () => {
      this.gamepadSeen = true;
    });
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  attachTouch(touch: TouchControls): void {
    this.touch = touch;
  }

  getBindings(): Bindings {
    return this.bindings;
  }

  setBinding(player: 'p1' | 'p2', action: ActionId, code: string): void {
    this.bindings[player][action] = [code];
    saveSlot('bindings', this.bindings);
  }

  resetBindings(): void {
    this.bindings = cloneBindings(DEFAULT_BINDINGS);
    saveSlot('bindings', this.bindings);
  }

  /** Grabs the next key press for rebinding instead of routing it to the game. */
  captureNextKey(cb: (code: string) => void): void {
    this.capture = cb;
  }

  cancelCapture(): void {
    this.capture = null;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    // While a text field has focus every keystroke belongs to it, not the game.
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') &&
      !this.capture
    ) {
      if (e.code === 'Escape' || e.code === 'Enter') {
        (active as HTMLElement).blur();
        this.menuQueue.push(e.code === 'Escape' ? 'back' : 'confirm');
      }
      return;
    }
    if (this.capture) {
      e.preventDefault();
      const cb = this.capture;
      this.capture = null;
      cb(e.code);
      return;
    }
    // Stop the page scrolling out from under the game.
    if (SCROLL_KEYS.has(e.code)) e.preventDefault();
    this.keys.add(e.code);
    this.keyEdges.add(e.code);
    this.lastDeviceWasPad = false;

    switch (e.code) {
      case 'Escape':
      case 'Backspace':
        this.menuQueue.push('back');
        break;
      case 'Enter':
      case 'NumpadEnter':
        this.menuQueue.push('confirm');
        break;
      case 'Tab':
        e.preventDefault();
        this.menuQueue.push('tab');
        break;
      default:
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.keyEdges.clear();
  };

  /** True while the action is held. Public so the HUD can show modal cards. */
  isHeld(player: 'p1' | 'p2', action: ActionId): boolean {
    return this.held(player, action);
  }

  private held(player: 'p1' | 'p2', action: ActionId): boolean {
    if (player === 'p1' && this.touch?.isHeld(action)) return true;
    return this.bindings[player][action].some((c) => this.keys.has(c));
  }

  private pressed(player: 'p1' | 'p2', action: ActionId): boolean {
    if (player === 'p1' && this.touch?.isPressed(action)) return true;
    return this.bindings[player][action].some((c) => this.keyEdges.has(c));
  }

  /** Reads pads and keyboard into the two InputFrames. Call once per render frame. */
  poll(): void {
    const pads = readGamepads();
    if (pads.length) this.gamepadSeen = true;

    // Rising-edge table for pad buttons, computed against last frame.
    this.padEdges = pads.map((p, i) => {
      const prev = this.padPrev[i];
      return p.buttons.map((b, j) => b && !prev?.buttons[j]);
    });
    if (pads.some((p, i) => p.buttons.some((b, j) => b && !this.padPrev[i]?.buttons[j]))) {
      this.lastDeviceWasPad = true;
    }

    this.fill(this.p1, 'p1', pads[0]);
    this.fill(this.p2, 'p2', pads[1]);

    // Menu edges from pads.
    for (let i = 0; i < pads.length; i++) {
      const edges = this.padEdges[i] ?? [];
      if (edges[0]) this.menuQueue.push('confirm');
      if (edges[1]) this.menuQueue.push('back');
      if (edges[9] || edges[8]) this.menuQueue.push('pause');
      const prev = this.padPrev[i];
      if (prev) {
        const ax = pads[i].axes[1] ?? 0;
        const px = prev.axes[1] ?? 0;
        if (ax < -0.5 && px >= -0.5) this.menuQueue.push('up');
        if (ax > 0.5 && px <= 0.5) this.menuQueue.push('down');
        const axx = pads[i].axes[0] ?? 0;
        const pxx = prev.axes[0] ?? 0;
        if (axx < -0.5 && pxx >= -0.5) this.menuQueue.push('left');
        if (axx > 0.5 && pxx <= 0.5) this.menuQueue.push('right');
      }
      if (edges[12]) this.menuQueue.push('up');
      if (edges[13]) this.menuQueue.push('down');
      if (edges[14]) this.menuQueue.push('left');
      if (edges[15]) this.menuQueue.push('right');
    }

    // Menu edges from the keyboard movement keys.
    if (this.pressed('p1', 'up') || this.keyEdges.has('ArrowUp')) this.menuQueue.push('up');
    if (this.pressed('p1', 'down') || this.keyEdges.has('ArrowDown')) this.menuQueue.push('down');
    if (this.pressed('p1', 'left') || this.keyEdges.has('ArrowLeft')) this.menuQueue.push('left');
    if (this.pressed('p1', 'right') || this.keyEdges.has('ArrowRight')) this.menuQueue.push('right');
    if (this.keyEdges.has('Space')) this.menuQueue.push('confirm');
    if (this.keyEdges.has('KeyP')) this.menuQueue.push('pause');

    this.padPrev = pads;
  }

  private fill(frame: InputFrame, player: 'p1' | 'p2', pad?: PadSnapshot): void {
    let mx = 0;
    let my = 0;
    if (this.held(player, 'left')) mx -= 1;
    if (this.held(player, 'right')) mx += 1;
    if (this.held(player, 'down')) my -= 1;
    if (this.held(player, 'up')) my += 1;

    if (player === 'p1' && this.touch) {
      mx += this.touch.stickX();
      my += this.touch.stickY();
    }

    if (pad) {
      const ax = applyDeadzone(pad.axes[0] ?? 0);
      const ay = applyDeadzone(pad.axes[1] ?? 0);
      if (ax !== 0 || ay !== 0) this.lastDeviceWasPad = true;
      mx += ax;
      my -= ay;
      if (pad.buttons[14]) mx -= 1;
      if (pad.buttons[15]) mx += 1;
      if (pad.buttons[12]) my += 1;
      if (pad.buttons[13]) my -= 1;
    }

    const mag = Math.hypot(mx, my);
    if (mag > 1) {
      mx /= mag;
      my /= mag;
    }
    frame.moveX = mx;
    frame.moveY = my;
    frame.moveZ = my;

    const padEdge = (i: number) => {
      const idx = player === 'p1' ? 0 : 1;
      return !!this.padEdges[idx]?.[i];
    };
    const padHeld = (i: number) => !!pad?.buttons[i];

    const dUp = this.pressed(player, 'diamondUp') || padEdge(3);
    const dDown = this.pressed(player, 'diamondDown') || padEdge(0);
    const dLeft = this.pressed(player, 'diamondLeft') || padEdge(2);
    const dRight = this.pressed(player, 'diamondRight') || padEdge(1);
    const special = this.pressed(player, 'special') || padEdge(5) || padEdge(7);
    const modifier = this.held(player, 'modifier') || padHeld(6);
    const switchF = this.pressed(player, 'switchFielder') || padEdge(4);

    // Batting meanings.
    frame.swing = dDown;
    frame.power = dRight;
    frame.bunt = dLeft;
    frame.take = dUp;

    // Pitching meanings: the diamond selects a pitch slot.
    frame.pitchSlot = dLeft ? 0 : dDown ? 1 : dRight ? 2 : dUp ? 3 : -1;

    // Fielding and baserunning: the diamond IS the diamond.
    frame.base = dDown ? 0 : dRight ? 1 : dUp ? 2 : dLeft ? 3 : -1;

    frame.modifier = modifier;
    frame.dive = special;
    frame.advanceAll = special && !modifier;
    frame.returnAll = special && modifier;
    frame.switchFielder = switchF;
    frame.turbo = modifier;
  }

  /** Called by the app after the first simulation step consumes the frame. */
  consumeEdges(): void {
    clearEdges(this.p1);
    clearEdges(this.p2);
  }

  /** Called at the very end of a render frame. */
  endFrame(): void {
    this.keyEdges.clear();
    this.touch?.endFrame();
  }

  takeMenuActions(): MenuAction[] {
    const out = this.menuQueue;
    this.menuQueue = [];
    return out;
  }

  isPausePressed(): boolean {
    return this.keyEdges.has('Escape') || this.keyEdges.has('KeyP');
  }

  /** Human-readable description of a bound key for the controls screen. */
  describe(player: 'p1' | 'p2', action: ActionId): string {
    return this.bindings[player][action].map(prettyKey).join(' / ');
  }
}

const SCROLL_KEYS = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Slash',
  'Quote',
]);

function applyDeadzone(v: number): number {
  if (Math.abs(v) < DEADZONE) return 0;
  const sign = v < 0 ? -1 : 1;
  return sign * ((Math.abs(v) - DEADZONE) / (1 - DEADZONE));
}

function readGamepads(): PadSnapshot[] {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
  const out: PadSnapshot[] = [];
  const pads = navigator.getGamepads();
  for (let i = 0; i < pads.length && out.length < 2; i++) {
    const p = pads[i];
    if (!p) continue;
    out.push({
      axes: Array.from(p.axes),
      buttons: p.buttons.map((b) => b.pressed || b.value > 0.5),
    });
  }
  return out;
}

export function prettyKey(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  const map: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Space: 'Space',
    ShiftLeft: 'L-Shift',
    ShiftRight: 'R-Shift',
    Semicolon: ';',
    Quote: "'",
    Period: '.',
    Comma: ',',
    Slash: '/',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Enter: 'Enter',
    Escape: 'Esc',
  };
  return map[code] ?? code;
}

function cloneBindings(b: Bindings): Bindings {
  return JSON.parse(JSON.stringify(b)) as Bindings;
}
