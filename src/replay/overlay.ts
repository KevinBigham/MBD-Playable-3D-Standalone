import type { ReplayFrameInfo } from './runtime';

export type ReplayFreeCameraAction =
  | 'focus-ball'
  | 'focus-athlete'
  | 'next-athlete'
  | 'plate'
  | 'foul-line'
  | 'outfield'
  | 'overhead'
  | 'toggle-hud'
  | 'capture-photo'
  | 'reset'
  | 'exit';

/** Small, input-safe replay ribbon. It deliberately leaves the field visible
 * and uses words as well as colour so replay state is unmistakable. */
export class ReplayOverlay {
  readonly root = document.createElement('div');
  private readonly label = document.createElement('span');
  private readonly score = document.createElement('span');
  private readonly fill = document.createElement('i');
  private readonly freeButton: HTMLButtonElement;

  constructor(skip: () => void, toggleFreeCamera: () => void, freeCameraAction: (action: ReplayFreeCameraAction) => void) {
    this.root.className = 'replay-overlay hidden';
    this.root.setAttribute('role', 'status');
    this.root.innerHTML = `
      <div class="replay-flag">INSTANT REPLAY</div>
      <div class="replay-copy"></div>
      <div class="replay-score"></div>
      <button type="button" class="replay-free" aria-label="Open replay free camera">FREE CAM</button>
      <button type="button" class="replay-skip" aria-label="Skip instant replay">SKIP <kbd>ESC</kbd></button>
      <div class="replay-camera-tools" aria-label="Replay free camera controls">
        <button type="button" data-action="focus-ball">BALL</button>
        <button type="button" data-action="focus-athlete">PLAYER</button>
        <button type="button" data-action="next-athlete">NEXT PLAYER</button>
        <button type="button" data-action="plate">PLATE</button>
        <button type="button" data-action="foul-line">FOUL LINE</button>
        <button type="button" data-action="outfield">OUTFIELD</button>
        <button type="button" data-action="overhead">OVERHEAD</button>
        <button type="button" data-action="toggle-hud">HUD</button>
        <button type="button" data-action="capture-photo">SAVE PNG</button>
        <button type="button" data-action="reset">RESET</button>
        <button type="button" data-action="exit">EXIT</button>
        <span>DRAG ORBIT · RIGHT-DRAG PAN · WHEEL/PINCH ZOOM</span>
      </div>
      <div class="replay-track"><i></i></div>`;
    this.label = this.root.querySelector('.replay-copy') as HTMLSpanElement;
    this.score = this.root.querySelector('.replay-score') as HTMLSpanElement;
    this.fill = this.root.querySelector('.replay-track i') as HTMLElement;
    this.freeButton = this.root.querySelector('.replay-free') as HTMLButtonElement;
    this.root.querySelector('.replay-skip')?.addEventListener('click', skip);
    this.freeButton.addEventListener('click', toggleFreeCamera);
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.replay-camera-tools button')) {
      button.addEventListener('click', () => freeCameraAction(button.dataset.action as ReplayFreeCameraAction));
    }
  }

  show(info: ReplayFrameInfo): void {
    this.root.classList.remove('hidden');
    this.update(info);
  }

  update(info: ReplayFrameInfo): void {
    const half = info.half === 'top' ? 'TOP' : 'BOT';
    this.label.textContent = info.label.toUpperCase();
    this.score.textContent = `${half} ${info.inning} · ${info.outs} OUT · ${info.awayRuns}–${info.homeRuns}`;
    this.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, info.progress))})`;
  }

  hide(): void {
    this.setFreeCamera(false);
    this.root.classList.add('hidden');
  }

  setFreeCamera(active: boolean): void {
    this.root.classList.toggle('free-camera', active);
    this.root.classList.remove('photo-hud-hidden');
    this.freeButton.textContent = active ? 'BROADCAST' : 'FREE CAM';
    this.freeButton.setAttribute('aria-label', active ? 'Return to broadcast replay' : 'Open replay free camera');
  }

  togglePhotoHud(): void {
    this.root.classList.toggle('photo-hud-hidden');
  }
}
