import type { GameResult, GameSetup, PracticeDrill, Team } from '../core/types';
import { MAX_FRAME_DT, TICK_DT } from '../core/constants';
import { freshSeed } from '../core/rng';
import { STADIUMS, getStadium } from '../data/stadiums';
import { TEAM_IDENTITIES, buildLeague, displayName, playerById, teamById } from '../data/teams';
import { createGameState, type GameState } from '../sim/state';
import { changePitcher, humanIsBatting, humanIsPitching, stepGame } from '../sim/game';
import { emptyInputPair } from '../sim/input';
import { simulateGame } from '../sim/autoplay';
import { GameWorld } from '../render/world';
import { FrameGovernor, type QualityStep } from '../render/governor';
import { CONTACT_Z } from '../core/constants';
import { swingProfile, zoneBounds } from '../sim/contact';
import { getAudio, type SfxName } from '../audio/audio';
import { Hud } from './hud';
import { InputManager, type ActionId } from './input';
import { TouchControls } from './touch';
import type { ControlLabels } from './controls';
import {
  detectDevice,
  isAppRotated,
  isPortrait,
  setAppRotated,
  toggleFullscreen,
  viewportSize,
} from './device';
import { Lifecycle } from './lifecycle';
import { type Buzz, getHaptics } from './haptics';
import {
  type ResumeContext,
  type ResumeSnapshot,
  describeSituation,
  restoreGame,
  snapshotGame,
} from '../save/resume';
import {
  type AppApi,
  BracketScreen,
  ControlsScreen,
  DEFAULT_SETTINGS,
  type GameSettings,
  ListScreen,
  type MenuRow,
  PlayerCreatorScreen,
  PostgameScreen,
  Screen,
  SeasonHubScreen,
  StatsScreen,
  TeamSelectScreen,
  TitleScreen,
  buildSettingsRows,
  derbyStandingsHtml,
  settingsSummaryHtml,
  difficultyRow,
  inningsRow,
  practiceRow,
  seasonLengthRow,
  stadiumRow,
} from './screens';
import { SLOT, clearSlot, loadSlot, saveSlot, storageAvailable } from '../save/storage';
import {
  type SeasonLength,
  type SeasonState,
  activeSeries,
  advanceToUserGame,
  applyPlayoffGame,
  applyResult,
  createSeason,
  loadSeason,
  nextSeriesMatchup,
  nextUserGame,
  regularSeasonComplete,
  saveSeason,
  seriesLabel,
  setupForScheduledGame,
  simulateScheduledGame,
  sortedStandings,
  startPlayoffs,
} from '../modes/season';
import {
  type ChampionshipState,
  applyMatchResult,
  championshipComplete,
  createChampionship,
  loadChampionship,
  saveChampionship,
  setupForMatch,
  simulateRound,
  userMatch,
} from '../modes/championship';
import { type DerbyState, createDerby, stepDerby } from '../modes/homerun';
import {
  type CustomPlayer,
  applyCustomPlayers,
  loadCustomPlayers,
  newCustomPlayer,
  saveCustomPlayers,
} from '../modes/creator';
import { escapeHtml } from './hud';

type Mode = 'menu' | 'game' | 'derby';

/**
 * Which game events are worth a buzz. Deliberately short: a motor that fires on
 * everything stops meaning anything, and these are the moments a player would
 * otherwise have to look at the screen to learn about.
 */
const BUZZ_FOR: Record<string, Buzz | undefined> = {
  contact: 'contact',
  homerun: 'homerun',
  swingmiss: 'strike',
  strike: 'strike',
  strikeout: 'strike',
  out: 'out',
  bigplay: 'bigplay',
  wall: 'bigplay',
};

/**
 * Tolerance on the render-rate cap. A 120 Hz display offers frames 8.3 ms
 * apart; without slop, floating-point drift turns "every second frame" into
 * "every second frame, except sometimes the third", which reads as a stutter.
 */
const RENDER_SLOP = 0.004;

/** The derby is one situation from first pitch to last, so its pad is fixed. */
const DERBY_LABELS: ControlLabels = {
  situation: 'batting',
  verb: 'DERBY',
  stick: 'MOVE AIM',
  diamondUp: '',
  diamondLeft: '',
  diamondDown: 'SWING',
  diamondRight: 'POWER',
  special: '',
  modifier: '',
  switchFielder: '',
};

/**
 * Application shell: owns the render loop, the screen stack, and the bridge
 * between menus and the simulation. The simulation itself is stepped at a
 * fixed rate with an accumulator, so gameplay is identical at 30, 60 or 144 Hz.
 */
export class App implements AppApi {
  teams: Team[];
  private customs: CustomPlayer[] = [];
  readonly world: GameWorld;
  readonly input = new InputManager();
  readonly audio = getAudio();
  readonly haptics = getHaptics();
  readonly hud: Hud;
  settings: GameSettings;

  private uiRoot: HTMLDivElement;
  private stack: Screen[] = [];
  private mode: Mode = 'menu';

  private game: GameState | null = null;
  private attract: GameState | null = null;
  private derby: DerbyState | null = null;
  private paused = false;
  private pauseScreen: Screen | null = null;

  private season: SeasonState | null = null;
  private championship: ChampionshipState | null = null;
  /** Where a finished game should send its result. */
  private gameContext: 'quick' | 'season' | 'playoff' | 'cup' | 'practice' = 'quick';

  readonly touch: TouchControls;
  readonly device = detectDevice();
  private rotateEl: HTMLDivElement | null = null;
  private lifecycle: Lifecycle;
  /** Inning+half of the last resume snapshot, so one is taken per half-inning. */
  private lastSavedHalf = '';

  private governor = new FrameGovernor((step) => this.applyQualityStep(step));
  private accumulator = 0;
  private lastTime = 0;
  /** When the last frame was actually drawn, for the render-rate cap. */
  private lastDrawTime = 0;
  /** Seconds between drawn frames; 0 means draw whenever the display asks. */
  private renderInterval = 0;
  private renderCapDecided = false;
  private running = false;
  private toastEl: HTMLDivElement | null = null;
  private toastT = 0;
  private frameTimes: number[] = [];
  private resultShown = false;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLDivElement) {
    this.uiRoot = uiRoot;
    this.customs = loadCustomPlayers();
    this.teams = buildLeague();
    applyCustomPlayers(this.teams, this.customs);
    const saved = loadSlot<GameSettings>(SLOT.settings);
    this.settings = { ...DEFAULT_SETTINGS, ...this.deviceDefaults(), ...(saved ?? {}) };
    this.world = new GameWorld(canvas);
    this.hud = new Hud(this.input);
    this.touch = new TouchControls(() => this.requestPause());
    this.input.attachTouch(this.touch);
    this.uiRoot.appendChild(this.touch.root);
    this.applySettings();

    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    // Mobile Safari resizes the *visual* viewport when its toolbars slide away
    // without ever firing a window resize, so the canvas has to listen to both.
    window.visualViewport?.addEventListener('resize', this.onResize);
    window.visualViewport?.addEventListener('scroll', this.onResize);
    this.lifecycle = new Lifecycle({
      onHide: () => {
        // A phone that hides the page has *already* taken the player out of the
        // game — a call, a notification, the lock button. Coming back into a
        // live pitch with a count you did not choose is the game punishing
        // someone for their phone ringing, so it pauses instead. Pause first:
        // it wants to make a sound, and the line below takes sound away.
        if (this.mode !== 'menu' && !this.paused) this.openPause();
        this.audio.suspend();
        this.haptics.silence();
      },
      onShow: () => this.audio.resume(),
      onPersist: () => this.persistGame(),
    });
    // The pad appears the moment the device proves it has a finger, whatever
    // the media queries guessed. A laptop with a touchscreen therefore keeps
    // its keyboard until somebody actually touches the glass.
    const firstTouch = () => {
      this.setTouchMode(true);
      window.removeEventListener('touchstart', firstTouch);
    };
    window.addEventListener('touchstart', firstTouch, { passive: true });
    if (this.device.touchPrimary) this.setTouchMode(true);

    this.onResize();
  }

  /**
   * Opening defaults that depend on the hardware. Only ever applied under a
   * saved settings object, so a choice the player has actually made always
   * wins — including a choice to put a phone back on High.
   */
  private deviceDefaults(): Partial<GameSettings> {
    if (!this.device.touchPrimary) return {};
    return {
      // A thumb is slower than a key, and there is no second chance to read a
      // pitch on a 5-inch screen.
      pitchTempo: 'relaxed',
      // Phone GPUs are not laptop GPUs, they are not all the same GPU, and the
      // one in any given phone gets slower as the case warms up. A fixed guess
      // is wrong for somebody; a servo is wrong for nobody for long.
      quality: 'auto',
      // The line score is the first thing to go when the screen is 400px wide.
      showLineScore: false,
    };
  }

  private setTouchMode(on: boolean): void {
    if (this.touch.isEnabled() === on) return;
    this.touch.setEnabled(on);
    this.hud.setTouchMode(on);
    document.body.classList.toggle('touch-mode', on);
    // Vibration and the mirrored layout only exist for the pad, so they are
    // decided here rather than at load: a laptop that has just been touched for
    // the first time gets both, and never before.
    this.applySettings();
    this.onResize();
  }

  /** The on-screen pause button, and anything else that wants the pause menu. */
  private requestPause(): void {
    if (this.mode === 'menu') return;
    if (this.paused) this.closePause();
    else this.openPause();
  }

  // -------------------------------------------------------------------- boot

  start(): void {
    this.startAttract();
    this.goto(
      new TitleScreen(this, () => {
        this.audio.unlock();
        this.audio.playMusic('menu');
        this.gotoMainMenu();
      }),
    );
    this.running = true;
    this.lastTime = performance.now();
    this.lastDrawTime = this.lastTime;
    requestAnimationFrame(this.frame);
  }

  private startAttract(): void {
    // A CPU-vs-CPU game runs behind the front end so the title screen is a
    // living ballpark rather than a still image.
    const seed = freshSeed();
    const a = this.teams[seed % this.teams.length];
    const b = this.teams[(seed * 7 + 3) % this.teams.length];
    const away = a.id === b.id ? this.teams[(seed + 1) % this.teams.length] : a;
    const stadium = STADIUMS[seed % STADIUMS.length];
    this.attract = createGameState(
      {
        awayTeamId: away.id,
        homeTeamId: b.id,
        stadiumId: stadium.id,
        innings: 9,
        difficulty: 'pro',
        awayControl: 'cpu',
        homeControl: 'cpu',
        night: (seed & 1) === 0,
        seed,
      },
      away,
      b,
    );
    this.world.loadMatch(stadium, this.attract.setup.night, away, b);
  }

  private applySettings(): void {
    this.audio.setMusicVolume(this.settings.musicVolume);
    this.audio.setSfxVolume(this.settings.sfxVolume);
    this.audio.setMuted(this.settings.muted);
    this.world.setShakeEnabled(this.settings.cameraShake);
    const auto = this.settings.quality === 'auto';
    this.governor.setEnabled(auto);
    if (auto) {
      // The servo owns resolution, shadows and the crowd from here; only the
      // accessibility switch still has a say.
      this.applyQualityStep(this.governor.current());
    } else {
      this.world.setQuality({
        particles: !this.settings.reducedFlashing,
        // Reduced flashing also stops the crowd wave; performance mode stops it
        // for a different reason, so either switch turns it off.
        crowdAnimation: this.settings.quality !== 'performance' && !this.settings.reducedFlashing,
        pixelRatioCap:
          this.settings.quality === 'high' ? 2 : this.settings.quality === 'balanced' ? 1.5 : 1,
        // Renders fewer pixels even on a 1x display, where a pixel-ratio cap does
        // nothing at all. This is what makes Performance mode actually help.
        renderScale:
          this.settings.quality === 'high' ? 1 : this.settings.quality === 'balanced' ? 0.8 : 0.6,
        // Cast shadows are the single most expensive thing on the field — an
        // extra depth pass over every player — so Performance drops them.
        shadows: this.settings.quality !== 'performance',
      });
    }
    this.hud.setLineScoreVisible(this.settings.showLineScore);
    this.hud.setPlateViewEnabled(this.settings.plateView);
    this.uiRoot.classList.toggle('high-contrast', this.settings.highContrast);
    document.body.classList.toggle('reduced-motion', this.settings.reducedFlashing);
    this.haptics.setEnabled(this.settings.haptics && this.touch.isEnabled());
    this.touch.setLefty(this.settings.lefty);
  }

  saveSettings(): void {
    saveSlot(SLOT.settings, this.settings);
    this.applySettings();
  }

  /**
   * One rung of the automatic ladder. Reduced flashing still wins over it: an
   * accessibility switch is a statement about the player, not about the phone.
   */
  private applyQualityStep(step: QualityStep): void {
    this.world.setQuality({
      particles: !this.settings.reducedFlashing,
      crowdAnimation: step.crowdAnimation && !this.settings.reducedFlashing,
      pixelRatioCap: step.pixelRatioCap,
      renderScale: step.renderScale,
      shadows: step.shadows,
    });
  }

  qualityNow(): string {
    return this.governor.describe() || 'FULL';
  }

  private onResize = (): void => {
    const { w, h } = viewportSize();
    // If the phone ends up genuinely landscape after all — the lock came off,
    // or it was a tablet all along — the game's own quarter turn is no longer a
    // fix, it is the problem. Undone before anything is measured.
    if (isAppRotated() && h <= w) setAppRotated(false);
    // Everything positioned in CSS reads these instead of vh, because vh on
    // mobile means "the page if the toolbars were gone" and the toolbars are
    // usually there.
    const root = document.documentElement;
    root.style.setProperty('--vw', `${w}px`);
    root.style.setProperty('--vh', `${h}px`);
    // When the game has turned itself, the box it lives in is the other way
    // round, and every layout decision below has to be made about *that* box
    // rather than about the phone.
    const rotated = isAppRotated();
    const bw = rotated ? h : w;
    const bh = rotated ? w : h;
    // The box the *game* lives in, which is the viewport turned on its side
    // when the game has rotated itself. Anything sized as a fraction of the
    // screen has to read these rather than vw/vh, because vw and vh describe
    // the phone and the game is lying across it.
    root.style.setProperty('--gw', `${bw}px`);
    root.style.setProperty('--gh', `${bh}px`);
    root.classList.toggle('portrait', bh > bw);
    root.classList.toggle('tiny', Math.min(bw, bh) < 420);
    this.world.resize(bw, bh);
    this.updateRotateGate();
  };

  /**
   * Turns the whole game a quarter turn, or puts it back. Offered from the
   * portrait card and never applied on its own — a phone that *can* rotate
   * should, and this exists for the ones that have been told not to.
   */
  private setRotated(on: boolean): void {
    if (isAppRotated() === on) return;
    setAppRotated(on);
    this.onResize();
  }

  /**
   * Portrait on a phone is not a layout problem, it is a framing problem: a
   * baseball field is wide, and the strike zone ends up the size of a stamp. So
   * portrait gets a card asking for a turn — and a way past it, because plenty
   * of people have rotation locked and are not going to unlock it for this.
   */
  private updateRotateGate(): void {
    const wanted = this.device.phone && isPortrait() && !isAppRotated() && this.mode !== 'menu';
    if (!wanted) {
      this.rotateEl?.remove();
      this.rotateEl = null;
      return;
    }
    if (this.rotateEl) return;
    const el = document.createElement('div');
    el.className = 'rotate-gate';
    // The middle button is the one that matters. Plenty of people keep rotation
    // locked on purpose, and telling them to go and change a system setting for
    // a game of baseball is not an answer — so the game turns instead.
    el.innerHTML = `
      <div class="rot-icon">⟳</div>
      <h2>TURN YOUR PHONE</h2>
      <p>MOONSHOT NINE plays sideways. The field is wide and the strike zone is small.</p>
      <button class="rot-rotate" type="button">ROTATION LOCKED? TURN THE GAME INSTEAD</button>
      <button class="rot-dismiss" type="button">PLAY IN PORTRAIT ANYWAY</button>
    `;
    el.querySelector('.rot-rotate')?.addEventListener('click', () => {
      this.setRotated(true);
      this.playSfx('menuSelect');
    });
    el.querySelector('.rot-dismiss')?.addEventListener('click', () => {
      el.remove();
      this.rotateEl = null;
      // Not remembered on purpose: it is a nudge, not a setting, and it should
      // come back next game rather than quietly never appearing again.
    });
    this.uiRoot.appendChild(el);
    this.rotateEl = el;
  }

  toggleFullscreen(): void {
    void toggleFullscreen();
  }

  isTouch(): boolean {
    return this.touch.isEnabled();
  }

  // ------------------------------------------------------------- main loop

  private frame = (now: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);

    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, MAX_FRAME_DT);

    this.frameTimes.push(dt);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    this.governor.sample(dt);
    if (!this.renderCapDecided && this.frameTimes.length >= 90) this.decideRenderCap();

    // A 120 Hz phone display asks for twice the GPU work, twice the heat and
    // twice the battery to show a game whose simulation runs on a fixed clock
    // and whose ball is a few pixels across. Sixty drawn frames is the target;
    // the loop still *runs* at the display rate, so input is still sampled at
    // 120 Hz and nothing about the timing of a swing gets slower.
    let drawDt = (now - this.lastDrawTime) / 1000;
    const drawNow = this.renderInterval <= 0 || drawDt >= this.renderInterval - RENDER_SLOP;
    if (!Number.isFinite(drawDt) || drawDt < 0) drawDt = dt;
    drawDt = Math.min(drawDt, MAX_FRAME_DT);

    try {
      this.input.poll(now);
      this.dispatchInput();
      this.tick(dt);
      if (drawNow) {
        this.lastDrawTime = now;
        this.draw(drawDt);
      }
    } catch (err) {
      // A render or logic fault must not lock the page in a black screen.
      console.error('[MOONSHOT NINE] frame error', err);
      this.recoverFromError();
    } finally {
      this.input.endFrame();
    }

    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0 && this.toastEl) {
        this.toastEl.remove();
        this.toastEl = null;
      }
    }
  };

  /**
   * Decides once, from measured frame intervals, whether to cap the draw rate.
   *
   * Only a display running at roughly double the target is capped. A 90 Hz
   * Android panel must be left alone: there is no way to draw 60 frames on it —
   * frames only exist when the display offers one — so "cap to 60" there would
   * silently mean 45, which is worse than the 90 it replaced. This is why the
   * decision is measured rather than assumed from a device string.
   */
  private decideRenderCap(): void {
    this.renderCapDecided = true;
    if (!this.device.touchPrimary) return;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    if (median > 0 && median < 0.0095) this.renderInterval = 1 / 60;
  }

  private recoverFromError(): void {
    if (this.mode !== 'menu') {
      this.mode = 'menu';
      this.game = null;
      this.derby = null;
      this.paused = false;
      this.toast('Something went wrong — returned to the menu');
      this.gotoMainMenu();
    }
  }

  private dispatchInput(): void {
    const actions = this.input.takeMenuActions();

    if (this.mode !== 'menu' && !this.paused) {
      if (actions.includes('pause') || actions.includes('back')) {
        this.openPause();
        return;
      }
      return;
    }

    const top = this.paused ? this.pauseScreen : this.stack[this.stack.length - 1];
    if (!top) return;
    for (const a of actions) {
      // The pause card advertises both ESC and the pause key; both must close it.
      if (this.paused && (a === 'pause' || a === 'back')) {
        this.closePause();
        return;
      }
      top.handle(a);
      if (this.paused ? this.pauseScreen !== top : this.stack[this.stack.length - 1] !== top) break;
    }
  }

  private tick(dt: number): void {
    const top = this.paused ? this.pauseScreen : this.stack[this.stack.length - 1];
    top?.update(dt);

    if (this.paused) return;

    if (this.mode === 'game' && this.game) {
      this.stepFixed(dt, () => stepGame(this.game!, { p1: this.input.p1, p2: this.input.p2 }));
      // A snapshot per half-inning. Between them, hiding the page takes one
      // too, so this only has to cover a hard crash — and it bounds that loss
      // to the half-inning you are in rather than the whole game.
      const half = `${this.game.inning}${this.game.half}`;
      if (half !== this.lastSavedHalf) {
        this.lastSavedHalf = half;
        this.persistGame();
      }
      if (this.game.phase === 'final' && !this.resultShown && this.game.banner.t <= 0.2) {
        this.resultShown = true;
        this.showPostgame();
      }
    } else if (this.mode === 'derby' && this.derby) {
      this.stepFixed(dt, () => stepDerby(this.derby!, { p1: this.input.p1, p2: this.input.p2 }, this.teams));
      if (this.derby.phase === 'final' && !this.resultShown && this.derby.bannerT <= 0.2) {
        this.resultShown = true;
        this.showDerbyResult();
      }
    } else if (this.attract) {
      this.stepFixed(dt, () => {
        stepGame(this.attract!, emptyInputPair());
        if (this.attract!.phase === 'final') this.startAttract();
      });
    }
  }

  /** Fixed-timestep accumulator; guarantees frame-rate independent simulation. */
  private stepFixed(dt: number, step: () => void): void {
    this.accumulator += dt;
    let steps = 0;
    const maxSteps = 12;
    while (this.accumulator >= TICK_DT && steps < maxSteps) {
      step();
      if (steps === 0) this.input.consumeEdges();
      this.accumulator -= TICK_DT;
      steps++;
    }
    if (steps >= maxSteps) this.accumulator = 0;
    if (steps === 0) this.input.consumeEdges();
  }

  private draw(dt: number): void {
    const state = this.mode === 'game' && this.game ? this.game : this.attract;
    if (this.mode === 'derby' && this.derby) {
      this.drawDerby(dt);
    } else if (state) {
      this.world.update(dt, state, (ev) => this.onGameEvent(ev.kind, ev.power ?? 0.5, ev.text));
      this.audio.setCrowd(0.2 + this.world.crowdLevel() * 0.8, this.world.crowdLevel());
    }
    this.world.render();

    if (this.mode === 'game' && this.game) {
      const labels = this.hud.update(dt, this.game, this.world);
      this.touch.setLabels(labels);
      // The pad goes away entirely while the CPU has the half-inning; leaving
      // dead buttons on screen is worse than having none.
      this.touch.setVisible(!this.paused && labels.situation !== 'idle');
    } else if (this.mode === 'derby' && this.derby) {
      this.touch.setLabels(DERBY_LABELS);
      this.touch.setVisible(!this.paused && this.derby.phase !== 'final');
    } else {
      this.touch.setVisible(false);
    }
  }

  private drawDerby(dt: number): void {
    const d = this.derby!;
    this.world.updateDerbyScene(dt, d, this.teams);
    this.updateDerbyHud();
    this.updateDerbyCursor();
    this.audio.setCrowd(0.3, 0.4);
  }

  private onGameEvent(kind: string, power: number, text?: string): void {
    // The motor only speaks for things that happened to *you*. A CPU half-inning
    // buzzing in your pocket while you watch is noise, not feedback.
    if (this.mode === 'game' && this.game && humanInvolved(this.game)) {
      const buzz = BUZZ_FOR[kind];
      if (buzz) this.haptics.fire(buzz, power);
    }
    const map: Record<string, SfxName | undefined> = {
      pitchrelease: 'pitchRelease',
      swingmiss: 'swingMiss',
      foul: 'foulTip',
      catch: 'glove',
      groundfield: 'glove',
      throw: 'throwRelease',
      wall: 'wallHit',
      out: 'umpOut',
      safe: 'umpSafe',
      run: 'runScored',
      homerun: 'homerun',
      strikeout: 'strikeout',
      walk: 'walk',
      hitbypitch: 'error',
      ball: 'umpBall',
      strike: 'umpStrike',
      inning: 'inningChange',
      error: 'error',
      bigplay: 'bigPlay',
      gameover: 'gameOver',
      steal: 'slide',
      wildpitch: 'error',
      defense: 'menuMove',
    };
    if (kind === 'contact') {
      const name: SfxName =
        power > 0.72 ? 'contactBarrel' : power > 0.42 ? 'contactSolid' : 'contactWeak';
      this.audio.playSfx(name, { power });
      if (text) this.hud.flashFeedback(text, power > 0.72 ? '#ffd15c' : '#f4efe3');
      this.hud.noteContact(text ?? '');
      return;
    }
    // With the plate view on, the verdict panel already names the miss, in
    // better words and right under the zone. Flashing "Way out in front" across
    // the middle of the screen at the same time is the same sentence twice.
    if (kind === 'swingmiss' && text && !this.settings.plateView) {
      this.hud.flashFeedback(text, '#ff5f6d');
    }
    if (kind === 'denied') {
      this.audio.playSfx('menuDenied');
      if (text) this.hud.flashFeedback(text, '#a9a294');
      return;
    }
    // Setting the defence is a confirmation, not an event in the game — say
    // what changed and get out of the way.
    if (kind === 'defense') {
      this.audio.playSfx('menuMove');
      if (text) this.hud.flashFeedback(text, '#5ce1ff');
      return;
    }
    if (kind === 'homerun') this.audio.announce('homerun');
    if (kind === 'strikeout') this.audio.announce('out');
    if (kind === 'bigplay') this.audio.announce('bigplay');

    const sfx = map[kind];
    if (sfx) this.audio.playSfx(sfx, { power });
  }

  // ----------------------------------------------------------- screen stack

  goto(screen: Screen): void {
    const top = this.stack[this.stack.length - 1];
    if (top) {
      top.onExit();
      top.root.remove();
    }
    this.stack.push(screen);
    screen.onEnter();
    screen.render();
    this.uiRoot.appendChild(screen.root);
  }

  replace(screen: Screen): void {
    const top = this.stack.pop();
    if (top) {
      top.onExit();
      top.root.remove();
    }
    this.goto(screen);
  }

  canGoBack(): boolean {
    // The pause card is not on the stack; popping the stack under a live game
    // would strand the player in a menu they never opened.
    return !this.paused && this.stack.length > 1;
  }

  back(): void {
    if (this.stack.length <= 1) return;
    const top = this.stack.pop()!;
    top.onExit();
    top.root.remove();
    const next = this.stack[this.stack.length - 1];
    next.onEnter();
    next.render();
    this.uiRoot.appendChild(next.root);
  }

  private clearStack(): void {
    for (const s of this.stack) {
      s.onExit();
      s.root.remove();
    }
    this.stack = [];
  }

  playSfx(name: string): void {
    this.audio.playSfx(name as SfxName);
  }

  toast(msg: string): void {
    if (this.toastEl) this.toastEl.remove();
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast';
    this.toastEl.textContent = msg;
    this.uiRoot.appendChild(this.toastEl);
    this.toastT = 2.4;
  }

  bindingLabel(player: 'p1' | 'p2', action: ActionId): string {
    return this.input.describe(player, action);
  }

  rebind(player: 'p1' | 'p2', action: ActionId, done: () => void): void {
    this.input.captureNextKey((code) => {
      this.input.setBinding(player, action, code);
      done();
    });
  }

  resetBindings(): void {
    this.input.resetBindings();
  }

  hasGamepad(): boolean {
    return this.input.gamepadSeen;
  }

  // ------------------------------------------------------------------ menus

  /** Rebuilds the league from scratch so a deleted creation restores the original. */
  private rebuildLeague(): void {
    this.teams = buildLeague();
    applyCustomPlayers(this.teams, this.customs);
  }

  private gotoCreatorList(): void {
    const screen = new ListScreen(this, 'PLAYER CREATOR', 'Your original players', () => []);
    const rebuild = () => {
      const rows: MenuRow[] = this.customs.map((c) => ({
        id: c.id,
        label: `${c.firstName} ${c.lastName}`,
        value: () => `${c.primary} · ${teamLabel(this.teams, c.teamId)}`,
        hint: 'Edit or delete this creation.',
        onSelect: () => this.openCreator(c, true),
      }));
      rows.push({
        id: 'new',
        label: 'Create a new player',
        hint: 'Build an original ballplayer and place him on any club in the circuit.',
        disabled: () => this.customs.length >= 24,
        onSelect: () => this.openCreator(newCustomPlayer(this.teams[0].id), false),
      });
      if (!storageAvailable()) {
        rows.push({
          id: 'warn',
          label: 'This browser is blocking local storage',
          hint: 'Creations will not survive a refresh here.',
          disabled: () => true,
        });
      }
      rows.push({ id: 'back', label: 'Back', onSelect: () => this.gotoMainMenu() });
      screen.setRows(rows);
    };
    rebuild();
    this.goto(screen);
  }

  private openCreator(draft: CustomPlayer, editing: boolean): void {
    // Edit a copy so backing out never half-applies a change.
    const working: CustomPlayer = JSON.parse(JSON.stringify(draft));
    this.goto(
      new PlayerCreatorScreen(
        this,
        working,
        editing,
        (p) => {
          const i = this.customs.findIndex((c) => c.id === p.id);
          if (i >= 0) this.customs[i] = p;
          else this.customs.push(p);
          saveCustomPlayers(this.customs);
          this.rebuildLeague();
          this.toast(`${p.firstName} ${p.lastName} signed with ${teamLabel(this.teams, p.teamId)}`);
          this.gotoCreatorList();
        },
        () => {
          this.customs = this.customs.filter((c) => c.id !== working.id);
          saveCustomPlayers(this.customs);
          this.rebuildLeague();
          this.toast('Player deleted');
          this.gotoCreatorList();
        },
      ),
    );
  }

  gotoMainMenu(): void {
    this.clearStack();
    this.mode = 'menu';
    this.updateRotateGate();
    this.game = null;
    this.derby = null;
    // Nobody is watching a menu closely enough to justify holding the screen
    // awake through it, and a phone left on the title screen should be allowed
    // to go to sleep like any other phone.
    this.lifecycle.keepAwake(false);
    // Any route back to the menu must take the in-game HUD with it.
    this.hud.root.remove();
    this.detachDerbyHud();
    this.paused = false;
    this.pauseScreen?.root.remove();
    this.pauseScreen = null;
    if (!this.attract) this.startAttract();
    this.audio.playMusic('menu');

    const hasSeason = () => loadSeason() !== null;
    const hasCup = () => loadChampionship() !== null;
    const saved = this.loadResume();

    this.goto(
      new ListScreen(this, 'MOONSHOT NINE', 'Main menu', () => [
        // Only offered when there is one, and it goes first, because a player
        // who lost a game to a locked phone is looking for exactly this row.
        ...(saved
          ? [
              {
                id: 'resume',
                label: 'Resume Game',
                hint: describeSituation(saved.state),
                onSelect: () => this.resumeGame(),
              } satisfies MenuRow,
            ]
          : []),
        {
          id: 'quick',
          label: 'Quick Play',
          hint: 'One exhibition game. Choose both clubs, the park, the length and who holds the controllers.',
          onSelect: () => this.gotoQuickPlay(),
        },
        {
          id: 'season',
          label: hasSeason() ? 'Season — Continue' : 'Season',
          hint: hasSeason()
            ? 'Pick up your saved season where you left it.'
            : 'A full schedule, standings, statistics, a postseason and the Meridian Cup. Saves automatically.',
          onSelect: () => this.gotoSeasonMenu(),
        },
        {
          id: 'cup',
          label: hasCup() ? 'Championship — Continue' : 'Championship',
          hint: 'An eight-club knockout. Three wins and the cup is yours.',
          onSelect: () => this.gotoChampionshipMenu(),
        },
        {
          id: 'derby',
          label: 'Moonshot Derby',
          hint: 'Home run contest. Ten outs each, anything that is not a homer is an out. Up to four hitters, two of them human.',
          onSelect: () => this.gotoDerbySetup(),
        },
        {
          id: 'practice',
          label: 'Practice',
          hint: 'Endless drills for batting, pitching, fielding and baserunning. Nothing is scored.',
          onSelect: () => this.gotoPracticeSetup(),
        },
        {
          id: 'creator',
          label: 'Player Creator',
          hint: 'Build an original ballplayer, spend a fixed pool of rating points, and place him on any club. Saved locally and used in every mode.',
          onSelect: () => this.gotoCreatorList(),
        },
        {
          id: 'roster',
          label: 'Clubs & Rosters',
          hint: 'Browse all ten clubs, their line-ups, their rotations and their ratings.',
          onSelect: () => this.gotoRosterBrowser(),
        },
        {
          id: 'controls',
          label: 'Controls',
          hint: 'See and rebind every control for both players.',
          onSelect: () => this.goto(new ControlsScreen(this)),
        },
        {
          id: 'settings',
          label: 'Settings',
          hint: 'Volume, camera shake, flashing, graphics quality and HUD options.',
          onSelect: () => {
            const s = new ListScreen(this, 'SETTINGS', 'Audio, visuals, accessibility', () => [], () =>
              settingsSummaryHtml(this),
            );
            s.setRows(buildSettingsRows(this));
            this.goto(s);
          },
        },
      ]),
    );
  }

  // --------------------------------------------------------------- quick play

  private gotoQuickPlay(): void {
    const cfg = {
      awayTeamId: this.teams[0].id,
      homeTeamId: this.teams[1].id,
      stadiumId: this.teams[1].homeStadium,
      innings: this.settings.lastInnings,
      difficulty: this.settings.lastDifficulty,
      awayControl: 'human1' as GameSetup['awayControl'],
      homeControl: 'cpu' as GameSetup['homeControl'],
      night: false,
      autoStadium: true,
    };

    const controlLabel = (c: GameSetup['awayControl']) =>
      c === 'human1' ? 'PLAYER 1' : c === 'human2' ? 'PLAYER 2' : 'CPU';
    const cycleControl = (which: 'awayControl' | 'homeControl', d: number) => () => {
      const order: GameSetup['awayControl'][] = ['human1', 'human2', 'cpu'];
      const i = order.indexOf(cfg[which]);
      cfg[which] = order[(i + d + order.length) % order.length];
      // Two clubs cannot share one controller.
      const other = which === 'awayControl' ? 'homeControl' : 'awayControl';
      if (cfg[which] !== 'cpu' && cfg[other] === cfg[which]) {
        cfg[other] = cfg[which] === 'human1' ? 'human2' : 'human1';
      }
    };

    const screen = new ListScreen(this, 'QUICK PLAY', 'Exhibition game', () => []);
    const rebuild = () => {
      screen.setRows([
        {
          id: 'away',
          label: 'Away club',
          value: () => teamLabel(this.teams, cfg.awayTeamId),
          hint: 'The visiting club bats first.',
          onSelect: () =>
            this.goto(
              new TeamSelectScreen(this, 'AWAY CLUB', 'Bats first', (id) => {
                cfg.awayTeamId = id;
                if (id === cfg.homeTeamId) cfg.homeTeamId = nextTeamId(id);
                this.back();
                rebuild();
                screen.render();
              }),
            ),
          onLeft: () => {
            cfg.awayTeamId = shiftTeam(cfg.awayTeamId, -1, cfg.homeTeamId);
          },
          onRight: () => {
            cfg.awayTeamId = shiftTeam(cfg.awayTeamId, 1, cfg.homeTeamId);
          },
        },
        {
          id: 'home',
          label: 'Home club',
          value: () => teamLabel(this.teams, cfg.homeTeamId),
          hint: 'The home club bats last and does not bat in the final inning when already ahead.',
          onSelect: () =>
            this.goto(
              new TeamSelectScreen(this, 'HOME CLUB', 'Bats last', (id) => {
                cfg.homeTeamId = id;
                if (id === cfg.awayTeamId) cfg.awayTeamId = nextTeamId(id);
                if (cfg.autoStadium) cfg.stadiumId = homeStadiumOf(id);
                this.back();
                rebuild();
                screen.render();
              }),
            ),
          onLeft: () => {
            cfg.homeTeamId = shiftTeam(cfg.homeTeamId, -1, cfg.awayTeamId);
            if (cfg.autoStadium) cfg.stadiumId = homeStadiumOf(cfg.homeTeamId);
          },
          onRight: () => {
            cfg.homeTeamId = shiftTeam(cfg.homeTeamId, 1, cfg.awayTeamId);
            if (cfg.autoStadium) cfg.stadiumId = homeStadiumOf(cfg.homeTeamId);
          },
        },
        stadiumRow(
          'Ballpark',
          () => cfg.stadiumId,
          (id) => {
            cfg.stadiumId = id;
            cfg.autoStadium = false;
          },
        ),
        inningsRow(
          () => cfg.innings,
          (n) => {
            cfg.innings = n;
            this.settings.lastInnings = n;
            this.saveSettings();
          },
        ),
        difficultyRow(
          () => cfg.difficulty,
          (d) => {
            cfg.difficulty = d;
            this.settings.lastDifficulty = d;
            this.saveSettings();
          },
        ),
        {
          id: 'awayctl',
          label: `Away controller`,
          value: () => controlLabel(cfg.awayControl),
          hint: 'Set both clubs to a human for local two-player. Set both to CPU to watch.',
          onLeft: cycleControl('awayControl', -1),
          onRight: cycleControl('awayControl', 1),
        },
        {
          id: 'homectl',
          label: `Home controller`,
          value: () => controlLabel(cfg.homeControl),
          hint: 'Player 2 uses the arrow keys and the ; . \' [ diamond, or a second gamepad.',
          onLeft: cycleControl('homeControl', -1),
          onRight: cycleControl('homeControl', 1),
        },
        {
          id: 'night',
          label: 'Time of day',
          value: () => (getStadium(cfg.stadiumId).domed ? 'INDOORS' : cfg.night ? 'NIGHT' : 'DAY'),
          hint: 'Night games are lit by the towers. Domed parks are always lit.',
          onLeft: () => {
            cfg.night = !cfg.night;
          },
          onRight: () => {
            cfg.night = !cfg.night;
          },
        },
        {
          id: 'play',
          label: 'Play ball',
          hint: 'Start the game.',
          onSelect: () => {
            this.gameContext = 'quick';
            this.startGame({
              awayTeamId: cfg.awayTeamId,
              homeTeamId: cfg.homeTeamId,
              stadiumId: cfg.stadiumId,
              innings: cfg.innings,
              difficulty: cfg.difficulty,
              awayControl: cfg.awayControl,
              homeControl: cfg.homeControl,
              night: cfg.night,
              seed: freshSeed(),
            });
          },
        },
        { id: 'back', label: 'Back', onSelect: () => this.back() },
      ]);
    };
    rebuild();
    this.goto(screen);
  }

  // ------------------------------------------------------------------ season

  private gotoSeasonMenu(): void {
    const existing = loadSeason();
    if (existing) {
      this.season = existing;
      this.gotoSeasonHub();
      return;
    }
    this.gotoNewSeason();
  }

  private gotoNewSeason(): void {
    const cfg = {
      teamId: this.teams[0].id,
      length: 'short' as SeasonLength,
      difficulty: this.settings.lastDifficulty,
      innings: this.settings.lastInnings,
    };
    const screen = new ListScreen(this, 'NEW SEASON', 'Choose your club', () => []);
    const rebuild = () => {
      screen.setRows([
        {
          id: 'team',
          label: 'Your club',
          value: () => teamLabel(this.teams, cfg.teamId),
          hint: 'You play every game this club appears in. Everything else is simulated instantly.',
          onSelect: () =>
            this.goto(
              new TeamSelectScreen(
                this,
                'YOUR CLUB',
                'Season',
                (id) => {
                  cfg.teamId = id;
                  this.back();
                  rebuild();
                  screen.render();
                },
                cfg.teamId,
              ),
            ),
          onLeft: () => {
            cfg.teamId = shiftTeam(cfg.teamId, -1, '');
          },
          onRight: () => {
            cfg.teamId = shiftTeam(cfg.teamId, 1, '');
          },
        },
        seasonLengthRow(
          () => cfg.length,
          (l) => {
            cfg.length = l;
          },
        ),
        inningsRow(
          () => cfg.innings,
          (n) => {
            cfg.innings = n;
          },
        ),
        difficultyRow(
          () => cfg.difficulty,
          (d) => {
            cfg.difficulty = d;
          },
        ),
        {
          id: 'start',
          label: 'Start season',
          hint: storageAvailable()
            ? 'Your season saves automatically after every game.'
            : 'Warning: this browser is blocking local storage, so the season cannot be saved.',
          onSelect: () => {
            this.season = createSeason({
              userTeamId: cfg.teamId,
              difficulty: cfg.difficulty,
              innings: cfg.innings,
              length: cfg.length,
              seed: freshSeed(),
            });
            advanceToUserGame(this.season, this.teams);
            saveSeason(this.season);
            this.gotoSeasonHub();
          },
        },
        { id: 'back', label: 'Back', onSelect: () => this.back() },
      ]);
    };
    rebuild();
    this.goto(screen);
  }

  private gotoSeasonHub(): void {
    const season = this.season!;
    this.clearStack();
    const hub = new SeasonHubScreen(this, () => this.season!, () => []);
    const rebuild = () => {
      const s = this.season!;
      const rows: MenuRow[] = [];
      if (s.championId) {
        rows.push({
          id: 'champ',
          label: `${teamLabel(this.teams, s.championId)} WIN THE MERIDIAN CUP`,
          hint: 'The season is complete. Start a new one whenever you like.',
          onSelect: () => this.toast('Season complete'),
        });
      } else if (regularSeasonComplete(s)) {
        const series = activeSeries(s) ?? startPlayoffs(s)[0];
        const inIt = series.highSeedId === s.userTeamId || series.lowSeedId === s.userTeamId;
        rows.push({
          id: 'playoff',
          label: inIt ? `Play ${seriesLabel(series)}` : `Simulate ${seriesLabel(series)}`,
          hint: `${teamLabel(this.teams, series.highSeedId)} vs ${teamLabel(this.teams, series.lowSeedId)} — ${
            series.wins === 1 ? 'one game' : 'best of three'
          }.`,
          onSelect: () => this.playPlayoffGame(),
        });
      } else {
        const next = nextUserGame(s);
        rows.push({
          id: 'play',
          label: next ? 'Play next game' : 'No games left',
          value: () =>
            next
              ? `${next.awayId === s.userTeamId ? '@ ' : 'vs '}${teamLabel(this.teams, next.awayId === s.userTeamId ? next.homeId : next.awayId)}`
              : '',
          hint: next ? `At ${getStadium(next.stadiumId).name}.` : '',
          disabled: () => !next,
          onSelect: () => this.playSeasonGame(),
        });
        rows.push({
          id: 'sim',
          label: 'Simulate next game',
          hint: 'Let the CPU play your club this time. The result still counts.',
          disabled: () => !next,
          onSelect: () => this.simSeasonGame(),
        });
        rows.push({
          id: 'simweek',
          label: 'Simulate five games',
          hint: 'Fast-forward through five of your own games.',
          disabled: () => !next,
          onSelect: () => {
            for (let i = 0; i < 5; i++) this.simSeasonGame(true);
            saveSeason(this.season!);
            rebuild();
            hub.refresh(rows);
            hub.render();
            this.toast('Five games simulated');
          },
        });
      }

      rows.push({
        id: 'leaders',
        label: 'League leaders',
        hint: 'Batting and pitching leaders across the whole circuit.',
        onSelect: () => this.goto(new StatsScreen(this, 'LEAGUE LEADERS', 'Season to date', () => this.leadersHtml())),
      });
      rows.push({
        id: 'schedule',
        label: 'Full schedule',
        hint: 'Every game, played and upcoming.',
        onSelect: () => this.goto(new StatsScreen(this, 'SCHEDULE', 'Season', () => this.scheduleHtml())),
      });
      rows.push({
        id: 'quit',
        label: 'Save and return to menu',
        hint: 'Your progress is already saved; this just goes back.',
        onSelect: () => {
          saveSeason(this.season!);
          this.gotoMainMenu();
        },
      });
      rows.push({
        id: 'abandon',
        label: 'Abandon season',
        hint: 'Deletes the saved season permanently.',
        onSelect: () => {
          clearSlot(SLOT.season);
          this.season = null;
          this.toast('Season deleted');
          this.gotoMainMenu();
        },
      });
      hub.refresh(rows);
    };
    rebuild();
    void season;
    this.goto(hub);
    (hub as unknown as { rebuildRows?: () => void }).rebuildRows = rebuild;
  }

  private playSeasonGame(): void {
    const s = this.season!;
    const g = nextUserGame(s);
    if (!g) return;
    this.gameContext = 'season';
    this.startGame(setupForScheduledGame(s, g, freshSeed() & 0xffff));
  }

  private simSeasonGame(quiet = false): void {
    const s = this.season!;
    const g = nextUserGame(s);
    if (!g) return;
    simulateScheduledGame(s, g, this.teams);
    advanceToUserGame(s, this.teams);
    saveSeason(s);
    if (!quiet) {
      this.toast(`${teamLabel(this.teams, g.awayId)} ${g.awayRuns} — ${g.homeRuns} ${teamLabel(this.teams, g.homeId)}`);
      this.gotoSeasonHub();
    }
  }

  private playPlayoffGame(): void {
    const s = this.season!;
    const series = activeSeries(s) ?? startPlayoffs(s)[0];
    const { awayId, homeId } = nextSeriesMatchup(series);
    const inIt = awayId === s.userTeamId || homeId === s.userTeamId;
    if (!inIt) {
      // Simulate a series the user is not in, one game at a time.
      const setup: GameSetup = {
        awayTeamId: awayId,
        homeTeamId: homeId,
        stadiumId: homeStadiumOf(homeId),
        innings: s.innings,
        difficulty: s.difficulty,
        awayControl: 'cpu',
        homeControl: 'cpu',
        night: true,
        seed: freshSeed(),
      };
      const rep = simulateGame(setup, teamById(this.teams, awayId), teamById(this.teams, homeId), {
        validate: false,
      });
      if (rep.result) applyPlayoffGame(s, series, awayId, homeId, rep.result);
      saveSeason(s);
      this.gotoSeasonHub();
      return;
    }
    this.gameContext = 'playoff';
    this.startGame({
      awayTeamId: awayId,
      homeTeamId: homeId,
      stadiumId: homeStadiumOf(homeId),
      innings: s.innings,
      difficulty: s.difficulty,
      awayControl: awayId === s.userTeamId ? 'human1' : 'cpu',
      homeControl: homeId === s.userTeamId ? 'human1' : 'cpu',
      night: true,
      seed: freshSeed(),
      contextId: `playoff:${series.id}`,
    });
  }

  // ------------------------------------------------------------ championship

  private gotoChampionshipMenu(): void {
    const existing = loadChampionship();
    if (existing && !championshipComplete(existing)) {
      this.championship = existing;
      this.gotoBracket();
      return;
    }
    const cfg = { teamId: this.teams[0].id, difficulty: this.settings.lastDifficulty, innings: this.settings.lastInnings };
    const screen = new ListScreen(this, 'CHAMPIONSHIP', 'Eight clubs, one cup', () => []);
    const rebuild = () => {
      screen.setRows([
        {
          id: 'team',
          label: 'Your club',
          value: () => teamLabel(this.teams, cfg.teamId),
          hint: 'The other seven places go to the strongest clubs in the circuit.',
          onSelect: () =>
            this.goto(
              new TeamSelectScreen(this, 'YOUR CLUB', 'Championship', (id) => {
                cfg.teamId = id;
                this.back();
                rebuild();
                screen.render();
              }, cfg.teamId),
            ),
          onLeft: () => {
            cfg.teamId = shiftTeam(cfg.teamId, -1, '');
          },
          onRight: () => {
            cfg.teamId = shiftTeam(cfg.teamId, 1, '');
          },
        },
        inningsRow(() => cfg.innings, (n) => { cfg.innings = n; }),
        difficultyRow(() => cfg.difficulty, (d) => { cfg.difficulty = d; }),
        {
          id: 'start',
          label: 'Enter the cup',
          hint: 'Lose once and you are out.',
          onSelect: () => {
            this.championship = createChampionship({
              userTeamId: cfg.teamId,
              difficulty: cfg.difficulty,
              innings: cfg.innings,
              seed: freshSeed(),
              teams: this.teams,
            });
            saveChampionship(this.championship);
            this.gotoBracket();
          },
        },
        { id: 'back', label: 'Back', onSelect: () => this.back() },
      ]);
    };
    rebuild();
    this.goto(screen);
  }

  private gotoBracket(): void {
    this.clearStack();
    const screen = new BracketScreen(this, () => this.championship!, () => []);
    const rebuild = () => {
      const st = this.championship!;
      const m = userMatch(st);
      const rows: MenuRow[] = [];
      if (st.championId) {
        rows.push({
          id: 'done',
          label:
            st.championId === st.userTeamId
              ? 'YOU WON THE MERIDIAN CUP'
              : `${teamLabel(this.teams, st.championId)} take the cup`,
          onSelect: () => {
            clearSlot(SLOT.championship);
            this.championship = null;
            this.gotoMainMenu();
          },
        });
      } else if (st.eliminated) {
        rows.push({
          id: 'out',
          label: 'You are eliminated — see it out',
          hint: 'Simulate the rest of the tournament.',
          onSelect: () => {
            let guard = 0;
            while (!this.championship!.championId && guard++ < 8) simulateRound(this.championship!, this.teams);
            saveChampionship(this.championship!);
            rebuild();
            screen.render();
          },
        });
      } else if (m && m.awayId && m.homeId) {
        rows.push({
          id: 'play',
          label: `Play ${CUP_ROUND_NAME(m.round)}`,
          value: () => `${teamLabel(this.teams, m.awayId!)} @ ${teamLabel(this.teams, m.homeId!)}`,
          hint: `At ${getStadium(m.stadiumId).name}.`,
          onSelect: () => {
            this.gameContext = 'cup';
            this.startGame(setupForMatch(this.championship!, m));
          },
        });
        rows.push({
          id: 'simmatch',
          label: `Simulate ${CUP_ROUND_NAME(m.round)}`,
          hint: 'Let the CPU play your club this time. The result still counts, and losing still eliminates you.',
          onSelect: () => {
            const st = this.championship!;
            const setup = setupForMatch(st, m);
            const rep = simulateGame(
              { ...setup, awayControl: 'cpu', homeControl: 'cpu', seed: freshSeed() },
              teamById(this.teams, m.awayId!),
              teamById(this.teams, m.homeId!),
              { validate: false },
            );
            if (rep.result) applyMatchResult(st, m, rep.result);
            simulateRound(st, this.teams);
            saveChampionship(st);
            this.toast(
              `${teamLabel(this.teams, m.awayId!)} ${m.awayRuns} — ${m.homeRuns} ${teamLabel(this.teams, m.homeId!)}`,
            );
            rebuild();
            screen.render();
          },
        });
      } else {
        rows.push({
          id: 'advance',
          label: 'Play out the round',
          hint: 'Simulate the other matches so your next opponent is decided.',
          onSelect: () => {
            simulateRound(this.championship!, this.teams);
            saveChampionship(this.championship!);
            rebuild();
            screen.render();
          },
        });
      }
      rows.push({
        id: 'menu',
        label: 'Return to menu',
        hint: 'The bracket is saved.',
        onSelect: () => {
          saveChampionship(this.championship!);
          this.gotoMainMenu();
        },
      });
      screen.refresh(rows);
    };
    rebuild();
    this.goto(screen);
    (screen as unknown as { rebuildRows?: () => void }).rebuildRows = rebuild;
  }

  // ------------------------------------------------------------------- derby

  private gotoDerbySetup(): void {
    const pool = this.teams.flatMap((t) =>
      t.players
        .filter((p) => p.primary !== 'P')
        .map((p) => ({ playerId: p.id, teamId: t.id, power: p.bat.power })),
    );
    pool.sort((a, b) => b.power - a.power);
    const top = pool.slice(0, 40);

    const cfg = {
      stadiumId: 'the-foundry',
      count: 2,
      picks: [0, 1, 2, 3],
      humans: 1,
    };

    const nameOf = (i: number) => {
      const e = top[cfg.picks[i] % top.length];
      const team = teamById(this.teams, e.teamId);
      const p = playerById(team, e.playerId);
      return `${displayName(p)} (${team.abbr}) PWR ${p.bat.power}`;
    };

    const screen = new ListScreen(this, 'MOONSHOT DERBY', 'Home run challenge', () => []);
    const rebuild = () => {
      const rows: MenuRow[] = [
        stadiumRow('Ballpark', () => cfg.stadiumId, (id) => { cfg.stadiumId = id; }, 'The Foundry is short everywhere; Grove Park will punish you.'),
        {
          id: 'count',
          label: 'Hitters',
          value: () => String(cfg.count),
          hint: 'Two to four hitters take ten outs each.',
          onLeft: () => { cfg.count = Math.max(2, cfg.count - 1); cfg.humans = Math.min(cfg.humans, cfg.count); },
          onRight: () => { cfg.count = Math.min(4, cfg.count + 1); },
        },
        {
          id: 'humans',
          label: 'Human hitters',
          value: () => (cfg.humans === 0 ? 'NONE — WATCH' : cfg.humans === 1 ? 'PLAYER 1' : 'PLAYER 1 + 2'),
          hint: 'Human hitters take the first slots. The rest swing on their own.',
          onLeft: () => { cfg.humans = Math.max(0, cfg.humans - 1); },
          onRight: () => { cfg.humans = Math.min(Math.min(2, cfg.count), cfg.humans + 1); },
        },
      ];
      for (let i = 0; i < cfg.count; i++) {
        rows.push({
          id: `h${i}`,
          label: `Hitter ${i + 1}${i < cfg.humans ? ` (P${i + 1})` : ' (CPU)'}`,
          value: () => nameOf(i),
          hint: 'Sorted by power. Big bodies hit it further; contact hitters miss less.',
          onLeft: () => { cfg.picks[i] = (cfg.picks[i] - 1 + top.length) % top.length; },
          onRight: () => { cfg.picks[i] = (cfg.picks[i] + 1) % top.length; },
        });
      }
      rows.push({
        id: 'go',
        label: 'Start the derby',
        onSelect: () => {
          const entrants = [];
          for (let i = 0; i < cfg.count; i++) {
            const e = top[cfg.picks[i] % top.length];
            entrants.push({
              playerId: e.playerId,
              teamId: e.teamId,
              controller: i === 0 && cfg.humans >= 1 ? ('p1' as const) : i === 1 && cfg.humans >= 2 ? ('p2' as const) : null,
            });
          }
          this.startDerby(cfg.stadiumId, entrants);
        },
      });
      rows.push({ id: 'back', label: 'Back', onSelect: () => this.back() });
      screen.setRows(rows);
    };
    rebuild();
    this.goto(screen);
  }

  private startDerby(
    stadiumId: string,
    entrants: { playerId: string; teamId: string; controller: 'p1' | 'p2' | null }[],
  ): void {
    this.derby = createDerby({
      stadiumId,
      entrants,
      seed: freshSeed(),
      pitchTempo: this.settings.pitchTempo,
    });
    const st = getStadium(stadiumId);
    this.world.loadMatch(st, true, this.teams[0], this.teams[1]);
    this.clearStack();
    this.mode = 'derby';
    this.resultShown = false;
    this.accumulator = 0;
    this.audio.unlock();
    this.audio.playMusic('gameplay');
    this.attachDerbyHud();
  }

  private derbyHud: HTMLDivElement | null = null;

  private derbySvg: SVGSVGElement | null = null;

  private attachDerbyHud(): void {
    if (this.derbyHud) this.derbyHud.remove();
    this.derbyHud = document.createElement('div');
    this.derbyHud.id = 'hud';
    this.uiRoot.appendChild(this.derbyHud);

    // The derby is nothing but hitting, so the zone and the contact cursor are
    // the whole interface. They live in their own overlay above the text HUD.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.position = 'absolute';
    svg.style.inset = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';
    const zone = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    zone.setAttribute('fill', 'rgba(255,255,255,0.06)');
    zone.setAttribute('stroke', 'rgba(255,255,255,0.7)');
    zone.setAttribute('stroke-width', '2');
    zone.setAttribute('data-r', 'zone');
    const cur = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    cur.setAttribute('fill', 'rgba(255,209,92,0.2)');
    cur.setAttribute('stroke', '#ffd15c');
    cur.setAttribute('stroke-width', '3');
    cur.setAttribute('data-r', 'cursor');
    svg.appendChild(zone);
    svg.appendChild(cur);
    this.uiRoot.appendChild(svg);
    this.derbySvg = svg;
  }

  private detachDerbyHud(): void {
    this.derbyHud?.remove();
    this.derbyHud = null;
    this.derbySvg?.remove();
    this.derbySvg = null;
  }

  private updateDerbyCursor(): void {
    const d = this.derby;
    const svg = this.derbySvg;
    if (!d || !svg) return;
    const e = d.entrants[d.current];
    if (!e.controller) {
      svg.style.display = 'none';
      return;
    }
    svg.style.display = '';
    const team = teamById(this.teams, e.teamId);
    const batter = playerById(team, e.playerId);
    const z = zoneBounds(batter);
    const w = this.uiRoot.clientWidth;
    const h = this.uiRoot.clientHeight;
    const zone = svg.querySelector('[data-r="zone"]') as SVGPolygonElement;
    const cur = svg.querySelector('[data-r="cursor"]') as SVGEllipseElement;

    const pts = [
      this.world.project(-z.halfWidth, z.top, CONTACT_Z),
      this.world.project(z.halfWidth, z.top, CONTACT_Z),
      this.world.project(z.halfWidth, z.bottom, CONTACT_Z),
      this.world.project(-z.halfWidth, z.bottom, CONTACT_Z),
    ];
    zone.setAttribute(
      'points',
      pts.map((p) => `${(p.x * w).toFixed(1)},${(p.y * h).toFixed(1)}`).join(' '),
    );

    const kind = d.swingKind === 'power' ? 'power' : 'contact';
    const prof = swingProfile(batter, kind, 'pro', true);
    const c = this.world.project(d.cursorX, d.cursorY, CONTACT_Z);
    const ex = this.world.project(d.cursorX + prof.rx, d.cursorY, CONTACT_Z);
    const ey = this.world.project(d.cursorX, d.cursorY + prof.ry, CONTACT_Z);
    cur.setAttribute('cx', String(c.x * w));
    cur.setAttribute('cy', String(c.y * h));
    cur.setAttribute('rx', String(Math.abs(ex.x - c.x) * w));
    cur.setAttribute('ry', String(Math.abs(ey.y - c.y) * h));
    cur.setAttribute('stroke', kind === 'power' ? '#ff6b3d' : '#ffd15c');
    // The cursor is only meaningful while the ball is on its way.
    const live = d.phase === 'pitch' || d.phase === 'ready';
    zone.setAttribute('opacity', live ? '1' : '0.25');
    cur.setAttribute('opacity', live ? '1' : '0.25');
  }

  private updateDerbyHud(): void {
    const d = this.derby;
    if (!d || !this.derbyHud) return;
    const e = d.entrants[d.current];
    const team = teamById(this.teams, e.teamId);
    const p = playerById(team, e.playerId);
    this.derbyHud.innerHTML = `
      <div class="hud-score"><div class="hud-teams">
        <div class="hud-team batting"><span class="swatch" style="background:${cssColorSafe(team.primary)}"></span><span class="abbr">${escapeHtml(
          p.lastName.toUpperCase(),
        )}</span><span class="runs">${e.homers}</span></div>
        <div class="hud-team"><span class="swatch" style="background:#333"></span><span class="abbr">OUTS</span><span class="runs">${e.outs}/${
          d.tiebreak ? 3 : 10
        }</span></div>
      </div></div>
      <div class="hud-matchup"><div class="who">${d.tiebreak ? 'SWING-OFF' : 'ROUND ' + d.round}</div>
        <div class="name">${escapeHtml(displayName(p))}</div>
        <div class="line">LONGEST ${e.longest ? Math.round(e.longest * 3.28084) + ' FT' : '—'}</div></div>
      <div class="hud-banner"${d.bannerT > 0 ? '' : ' style="opacity:0"'}><div class="big">${escapeHtml(
        d.banner,
      )}</div><div class="sub">${escapeHtml(d.bannerSub)}</div></div>
      <div class="hud-prompts">
        <span class="prompt"><kbd>${escapeHtml(this.input.describe('p1', 'up'))}${escapeHtml(
          this.input.describe('p1', 'left'),
        )}${escapeHtml(this.input.describe('p1', 'down'))}${escapeHtml(this.input.describe('p1', 'right'))}</kbd>AIM</span>
        <span class="prompt"><kbd>${escapeHtml(this.input.describe('p1', 'diamondDown'))}</kbd>SWING</span>
        <span class="prompt"><kbd>${escapeHtml(this.input.describe('p1', 'diamondRight'))}</kbd>POWER SWING</span>
        <span class="prompt"><kbd>ESC</kbd>PAUSE</span>
      </div>`;
  }

  private showDerbyResult(): void {
    const d = this.derby!;
    const nameOf = (id: string) => {
      for (const t of this.teams) {
        const p = t.players.find((x) => x.id === id);
        if (p) return `${displayName(p)} (${t.abbr})`;
      }
      return id;
    };
    const winner = d.winnerId ? nameOf(d.winnerId) : '—';
    this.audio.playMusic('victory');
    this.mode = 'menu';
    this.detachDerbyHud();
    this.goto(
      new PostgameScreen(
        this,
        'DERBY RESULT',
        winner,
        () => derbyStandingsHtml(d, nameOf),
        [
          { id: 'again', label: 'Run it back', onSelect: () => this.gotoDerbySetup() },
          { id: 'menu', label: 'Main menu', onSelect: () => this.gotoMainMenu() },
        ],
      ),
    );
  }

  // ---------------------------------------------------------------- practice

  private gotoPracticeSetup(): void {
    const cfg = {
      drill: 'batting' as PracticeDrill,
      teamId: this.teams[0].id,
      oppId: this.teams[1].id,
      stadiumId: this.teams[0].homeStadium,
      difficulty: this.settings.lastDifficulty,
    };
    const screen = new ListScreen(this, 'PRACTICE', 'Learn the controls', () => []);
    const rebuild = () => {
      screen.setRows([
        practiceRow(() => cfg.drill, (d) => { cfg.drill = d; }),
        {
          id: 'team',
          label: 'Your club',
          value: () => teamLabel(this.teams, cfg.teamId),
          onLeft: () => { cfg.teamId = shiftTeam(cfg.teamId, -1, cfg.oppId); },
          onRight: () => { cfg.teamId = shiftTeam(cfg.teamId, 1, cfg.oppId); },
          hint: 'Different clubs give you very different hitters and arms to practise with.',
        },
        {
          id: 'opp',
          label: 'Opponent',
          value: () => teamLabel(this.teams, cfg.oppId),
          onLeft: () => { cfg.oppId = shiftTeam(cfg.oppId, -1, cfg.teamId); },
          onRight: () => { cfg.oppId = shiftTeam(cfg.oppId, 1, cfg.teamId); },
          hint: 'Who you are working against.',
        },
        stadiumRow('Ballpark', () => cfg.stadiumId, (id) => { cfg.stadiumId = id; }),
        difficultyRow(() => cfg.difficulty, (d) => { cfg.difficulty = d; }),
        {
          id: 'go',
          label: 'Start drill',
          hint: 'Nothing is scored. Press Escape to leave whenever you like.',
          onSelect: () => {
            const userBats = cfg.drill === 'batting' || cfg.drill === 'baserunning';
            this.gameContext = 'practice';
            this.startGame({
              awayTeamId: userBats ? cfg.teamId : cfg.oppId,
              homeTeamId: userBats ? cfg.oppId : cfg.teamId,
              stadiumId: cfg.stadiumId,
              innings: 9,
              difficulty: cfg.difficulty,
              awayControl: userBats ? 'human1' : 'cpu',
              homeControl: userBats ? 'cpu' : 'human1',
              night: false,
              seed: freshSeed(),
              practice: cfg.drill,
            });
          },
        },
        { id: 'back', label: 'Back', onSelect: () => this.back() },
      ]);
    };
    rebuild();
    this.goto(screen);
  }

  // ------------------------------------------------------------------ roster

  private gotoRosterBrowser(): void {
    this.goto(
      new TeamSelectScreen(this, 'CLUBS & ROSTERS', 'Choose a club', (id) => {
        this.goto(
          new StatsScreen(this, teamLabel(this.teams, id), 'Roster', () => this.rosterHtml(id)),
        );
      }),
    );
  }

  private rosterHtml(teamId: string): string {
    const team = teamById(this.teams, teamId);
    const hitters = team.lineup.map((id) => playerById(team, id));
    const bench = team.players.filter(
      (p) => p.primary !== 'P' && !team.lineup.includes(p.id),
    );
    const arms = [...team.rotation, ...team.bullpen].map((id) => playerById(team, id));

    const hitterRows = (list: typeof hitters, startAt: number) =>
      list
        .map(
          (p, i) => `<tr><td>${startAt + i > 0 ? startAt + i : '—'}</td><td style="text-align:left">${escapeHtml(
            displayName(p),
          )}${p.star ? ' ★' : ''}${p.custom ? ' <span class="pill on">YOURS</span>' : ''}</td><td>${p.primary}</td><td>${p.bats}</td><td>${p.bat.contact}</td><td>${p.bat.power}</td><td>${p.bat.speed}</td><td>${p.bat.arm}</td><td>${p.bat.fielding}</td><td>${p.bat.discipline}</td></tr>`,
        )
        .join('');

    return `
      <h4 style="color:var(--gold);letter-spacing:.18em">LINE-UP</h4>
      <table class="data-table">
        <tr><th>#</th><th>Player</th><th>Pos</th><th>B</th><th>CON</th><th>POW</th><th>SPD</th><th>ARM</th><th>FLD</th><th>DIS</th></tr>
        ${hitterRows(hitters, 1)}
      </table>
      <h4 style="color:var(--gold);letter-spacing:.18em;margin-top:18px">BENCH</h4>
      <table class="data-table">
        <tr><th></th><th>Player</th><th>Pos</th><th>B</th><th>CON</th><th>POW</th><th>SPD</th><th>ARM</th><th>FLD</th><th>DIS</th></tr>
        ${hitterRows(bench, 0)}
      </table>
      <h4 style="color:var(--gold);letter-spacing:.18em;margin-top:18px">PITCHING STAFF</h4>
      <table class="data-table">
        <tr><th>Role</th><th>Player</th><th>T</th><th>VEL</th><th>CTL</th><th>MOV</th><th>STA</th><th>Repertoire</th></tr>
        ${arms
          .map(
            (p, i) => `<tr><td>${i < team.rotation.length ? 'SP' + (i + 1) : 'RP'}</td><td style="text-align:left">${escapeHtml(
              displayName(p),
            )}${p.star ? ' ★' : ''}${p.custom ? ' <span class="pill on">YOURS</span>' : ''}</td><td>${p.throws}</td><td>${p.pitch?.velocity ?? '—'}</td><td>${p.pitch?.control ?? '—'}</td><td>${p.pitch?.movement ?? '—'}</td><td>${p.pitch?.stamina ?? '—'}</td><td style="text-align:left">${(p.repertoire ?? [])
              .join(', ')
              .toUpperCase()}</td></tr>`,
          )
          .join('')}
      </table>`;
  }

  private leadersHtml(): string {
    const s = this.season;
    if (!s) return '<p>No season in progress.</p>';
    const nameOf = (id: string) => {
      for (const t of this.teams) {
        const p = t.players.find((x) => x.id === id);
        if (p) return `${displayName(p)} (${t.abbr})`;
      }
      return id;
    };
    const bat = Object.entries(s.stats.batting)
      .filter(([, l]) => l.ab >= 10)
      .map(([id, l]) => ({ id, l, avg: l.h / Math.max(1, l.ab) }));
    const byAvg = [...bat].sort((a, b) => b.avg - a.avg).slice(0, 10);
    const byHr = [...bat].sort((a, b) => b.l.hr - a.l.hr).slice(0, 10);
    const byRbi = [...bat].sort((a, b) => b.l.rbi - a.l.rbi).slice(0, 10);
    const pitch = Object.entries(s.stats.pitching)
      .filter(([, l]) => l.outs >= 18)
      .map(([id, l]) => ({ id, l, era: (l.er * 27) / Math.max(1, l.outs) }));
    const byEra = [...pitch].sort((a, b) => a.era - b.era).slice(0, 10);
    const byK = [...pitch].sort((a, b) => b.l.so - a.l.so).slice(0, 10);

    const tbl = (title: string, rows: string) =>
      `<div class="col"><h4>${title}</h4><table class="data-table">${rows}</table></div>`;

    return `<div class="cols">
      ${tbl('Batting average', byAvg.map((x) => `<tr><td style="text-align:left">${escapeHtml(nameOf(x.id))}</td><td>${x.avg.toFixed(3).replace(/^0/, '')}</td></tr>`).join(''))}
      ${tbl('Home runs', byHr.map((x) => `<tr><td style="text-align:left">${escapeHtml(nameOf(x.id))}</td><td>${x.l.hr}</td></tr>`).join(''))}
      ${tbl('Runs batted in', byRbi.map((x) => `<tr><td style="text-align:left">${escapeHtml(nameOf(x.id))}</td><td>${x.l.rbi}</td></tr>`).join(''))}
    </div>
    <div class="cols" style="margin-top:18px">
      ${tbl('Earned run average', byEra.map((x) => `<tr><td style="text-align:left">${escapeHtml(nameOf(x.id))}</td><td>${x.era.toFixed(2)}</td></tr>`).join(''))}
      ${tbl('Strikeouts', byK.map((x) => `<tr><td style="text-align:left">${escapeHtml(nameOf(x.id))}</td><td>${x.l.so}</td></tr>`).join(''))}
      ${tbl('Standings', sortedStandings(s).map((r) => `<tr class="${r.teamId === s.userTeamId ? 'me' : ''}"><td style="text-align:left">${escapeHtml(teamLabel(this.teams, r.teamId))}</td><td>${r.w}-${r.l}</td></tr>`).join(''))}
    </div>`;
  }

  private scheduleHtml(): string {
    const s = this.season;
    if (!s) return '<p>No season in progress.</p>';
    return `<table class="data-table">
      <tr><th>Day</th><th>Away</th><th></th><th>Home</th><th></th><th>Park</th></tr>
      ${s.schedule
        .map((g) => {
          const mine = g.awayId === s.userTeamId || g.homeId === s.userTeamId;
          return `<tr class="${mine ? 'me' : ''}"><td>${g.day + 1}</td>
            <td style="text-align:left">${escapeHtml(teamLabel(this.teams, g.awayId))}</td>
            <td>${g.played ? g.awayRuns : ''}</td>
            <td style="text-align:left">${escapeHtml(teamLabel(this.teams, g.homeId))}</td>
            <td>${g.played ? g.homeRuns : ''}</td>
            <td style="text-align:left">${escapeHtml(getStadium(g.stadiumId).name)}</td></tr>`;
        })
        .join('')}
    </table>`;
  }

  // ------------------------------------------------------------------- game

  startGame(setup: GameSetup): void {
    const away = teamById(this.teams, setup.awayTeamId);
    const home = teamById(this.teams, setup.homeTeamId);
    // Every path into a game — quick play, season, cup, practice — funnels
    // through here, so this is the one place the pitch tempo has to be stamped
    // on. Callers build setups without knowing the option exists.
    setup = { ...setup, pitchTempo: this.settings.pitchTempo };
    // A new game replaces whatever was resumable; two live games is not a state
    // this app has, and offering the old one after starting a new one is a trap.
    clearSlot(SLOT.resume);
    this.enterGame(createGameState(setup, away, home), away, home);
  }

  /**
   * The half of `startGame` that is about *presenting* a game rather than
   * creating one, so a restored game takes exactly the same path in.
   */
  private enterGame(state: GameState, away: Team, home: Team): void {
    this.game = state;
    this.world.loadMatch(getStadium(state.setup.stadiumId), state.setup.night, away, home);
    this.clearStack();
    this.mode = 'game';
    this.paused = false;
    this.resultShown = false;
    this.accumulator = 0;
    this.lastSavedHalf = `${state.inning}${state.half}`;
    this.audio.unlock();
    this.audio.playMusic('gameplay');
    this.uiRoot.appendChild(this.hud.root);
    this.hud.setLineScoreVisible(this.settings.showLineScore);
    // The HUD outlives any one game, so its last-pitch readout has to be told
    // the previous one is over or it opens the next game quoting a pitch that
    // was thrown to somebody else.
    this.hud.resetReadout();
    this.lifecycle.keepAwake(true);
    this.updateRotateGate();
  }

  // ------------------------------------------------------------ resume a game

  /**
   * Writes the game in progress where a discarded tab cannot take it. Called on
   * every route out of the page, on pause, and once per half-inning, so the
   * worst case a hard crash can cost is the current half-inning.
   *
   * Deliberately silent about failure: a full or unavailable localStorage means
   * the offer will not appear later, which is exactly what happens today, and
   * a toast about storage quota in the middle of an at-bat helps nobody.
   */
  private persistGame(): void {
    if (this.mode !== 'game' || !this.game || this.game.gameOver) return;
    saveSlot(SLOT.resume, snapshotGame(this.game, this.gameContext));
  }

  /**
   * Puts back whatever the resumed game is supposed to report its result to. If
   * that save is gone — deleted, or a new season started over it — the game
   * becomes an exhibition rather than one whose result vanishes on the last out.
   */
  private reattachContext(context: ResumeContext): ResumeContext {
    if (context === 'season' || context === 'playoff') {
      this.season = this.season ?? loadSeason();
      return this.season ? context : 'quick';
    }
    if (context === 'cup') {
      this.championship = this.championship ?? loadChampionship();
      return this.championship ? context : 'quick';
    }
    return context;
  }

  /** The saved game, if there is one and it still loads. */
  private loadResume(): { state: GameState; context: ResumeContext } | null {
    const raw = loadSlot<ResumeSnapshot>(SLOT.resume);
    return raw ? restoreGame(raw) : null;
  }

  private resumeGame(): void {
    const restored = this.loadResume();
    if (!restored) {
      clearSlot(SLOT.resume);
      this.toast('That game could not be restored');
      this.gotoMainMenu();
      return;
    }
    // Cleared *before* entering, not after: if anything about this state is
    // poisonous enough to throw on the first frame, the player gets the menu
    // back rather than a save that crashes the game every time they touch it.
    clearSlot(SLOT.resume);
    const { state, context } = restored;
    // A season or cup game resumed straight from the title has no season or cup
    // loaded behind it — the app only reads those when you walk into their
    // menus — and the postgame would then quietly fail to record the result.
    this.gameContext = this.reattachContext(context);
    this.enterGame(state, state.away, state.home);
    // Resuming into a live pitch would hand the player a swing decision they
    // have had no chance to read. Whatever was happening, they get the pause
    // card and press Resume when they are ready.
    this.openPause();
  }

  private showPostgame(): void {
    const g = this.game!;
    const result = g.result!;
    this.hud.root.remove();
    this.mode = 'menu';
    // A finished game is not resumable, and the snapshot from its last
    // half-inning would otherwise sit on the menu offering the eighth.
    clearSlot(SLOT.resume);
    this.lifecycle.keepAwake(false);
    this.audio.playMusic(
      resultIsUserWin(this, result) ? 'victory' : 'menu',
    );

    const rows: MenuRow[] = [];
    if (this.gameContext === 'season' && this.season) {
      const s = this.season;
      const gameId = Number((result.contextId ?? '').split(':')[1]);
      const sched = s.schedule.find((x) => x.id === gameId);
      if (sched) applyResult(s, sched, result);
      advanceToUserGame(s, this.teams);
      saveSeason(s);
      rows.push({ id: 'next', label: 'Back to the season', onSelect: () => this.gotoSeasonHub() });
    } else if (this.gameContext === 'playoff' && this.season) {
      const s = this.season;
      const series = activeSeries(s);
      if (series) applyPlayoffGame(s, series, result.awayTeamId, result.homeTeamId, result);
      saveSeason(s);
      rows.push({ id: 'next', label: 'Back to the season', onSelect: () => this.gotoSeasonHub() });
    } else if (this.gameContext === 'cup' && this.championship) {
      const st = this.championship;
      const m = st.bracket.find((x) => `cup:${x.id}` === result.contextId);
      if (m) applyMatchResult(st, m, result);
      simulateRound(st, this.teams);
      saveChampionship(st);
      rows.push({ id: 'next', label: 'Back to the bracket', onSelect: () => this.gotoBracket() });
    } else {
      rows.push({
        id: 'rematch',
        label: 'Rematch',
        hint: 'Same clubs, same park, fresh seed.',
        onSelect: () => this.startGame({ ...g.setup, seed: freshSeed() }),
      });
    }
    rows.push({ id: 'menu', label: 'Main menu', onSelect: () => this.gotoMainMenu() });

    const winnerHome = result.homeRuns > result.awayRuns;
    const body = () => `
      <div class="result-hero">
        <div class="result-team ${winnerHome ? '' : 'win'}">
          <div class="abbr">${escapeHtml(g.away.abbr)}</div><div class="runs">${result.awayRuns}</div>
        </div>
        <div style="font-size:28px;color:var(--ink-dim)">—</div>
        <div class="result-team ${winnerHome ? 'win' : ''}">
          <div class="abbr">${escapeHtml(g.home.abbr)}</div><div class="runs">${result.homeRuns}</div>
        </div>
      </div>
      <div class="scroll boxscore">${this.boxScoreHtml(g, result)}</div>`;

    this.goto(
      new PostgameScreen(
        this,
        result.walkOff ? 'WALK-OFF' : 'FINAL',
        `${g.away.city} at ${g.home.city} · ${getStadium(g.setup.stadiumId).name}`,
        body,
        rows,
      ),
    );
  }

  private boxScoreHtml(g: GameState, result: GameResult): string {
    const n = result.lineScore.away.length;
    const head = ['<th></th>', ...Array.from({ length: n }, (_, i) => `<th>${i + 1}</th>`), '<th>R</th><th>H</th><th>E</th>'].join('');
    const row = (abbr: string, line: number[], r: number, h: number, e: number, batted: boolean) =>
      `<tr><td style="text-align:left">${escapeHtml(abbr)}</td>${line
        .map((v, i) => `<td>${!batted && i === n - 1 && v === 0 ? 'X' : v}</td>`)
        .join('')}<td class="tot">${r}</td><td class="tot">${h}</td><td class="tot">${e}</td></tr>`;

    const homeBattedLast = result.homeRuns <= result.awayRuns || result.walkOff;

    const batters = (side: 'away' | 'home') => {
      const team = side === 'away' ? g.away : g.home;
      const lines = Object.entries(g.stats[side].batting)
        .filter(([, l]) => l.pa > 0)
        .map(([id, l]) => {
          const p = team.players.find((x) => x.id === id);
          return { name: p ? displayName(p) : id, l };
        });
      return `<div class="box-block"><h4>${escapeHtml(team.abbr)} BATTING</h4><table class="data-table">
        <tr><th>Player</th><th>AB</th><th>R</th><th>H</th><th>HR</th><th>RBI</th><th>BB</th><th>HBP</th><th>K</th></tr>
        ${lines
          .map(
            (x) =>
              `<tr><td style="text-align:left">${escapeHtml(x.name)}</td><td>${x.l.ab}</td><td>${x.l.r}</td><td>${x.l.h}</td><td>${x.l.hr}</td><td>${x.l.rbi}</td><td>${x.l.bb}</td><td>${x.l.hbp}</td><td>${x.l.so}</td></tr>`,
          )
          .join('')}
      </table></div>`;
    };

    const pitchers = (side: 'away' | 'home') => {
      const team = side === 'away' ? g.away : g.home;
      const lines = Object.entries(g.stats[side].pitching).map(([id, l]) => {
        const p = team.players.find((x) => x.id === id);
        return { name: p ? displayName(p) : id, l };
      });
      return `<div class="box-block"><h4>${escapeHtml(team.abbr)} PITCHING</h4><table class="data-table">
        <tr><th>Player</th><th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>HBP</th><th>K</th><th>P</th></tr>
        ${lines
          .map(
            (x) =>
              `<tr><td style="text-align:left">${escapeHtml(x.name)}</td><td>${Math.floor(x.l.outs / 3)}.${x.l.outs % 3}</td><td>${x.l.h}</td><td>${x.l.r}</td><td>${x.l.er}</td><td>${x.l.bb}</td><td>${x.l.hbp}</td><td>${x.l.so}</td><td>${x.l.pitches}</td></tr>`,
          )
          .join('')}
      </table></div>`;
    };

    const decision = (() => {
      const bits: string[] = [];
      const nameOf = (id?: string) => {
        if (!id) return null;
        for (const t of [g.away, g.home]) {
          const p = t.players.find((x) => x.id === id);
          if (p) return displayName(p);
        }
        return null;
      };
      const w = nameOf(result.winningPitcherId);
      const l = nameOf(result.losingPitcherId);
      const s = nameOf(result.savePitcherId);
      if (w) bits.push(`W: ${w}`);
      if (l) bits.push(`L: ${l}`);
      if (s) bits.push(`SV: ${s}`);
      return bits.join(' · ');
    })();

    return `<table class="data-table" style="margin-bottom:10px"><tr>${head}</tr>
        ${row(g.away.abbr, result.lineScore.away, result.awayRuns, result.awayHits, result.awayErrors, true)}
        ${row(g.home.abbr, result.lineScore.home, result.homeRuns, result.homeHits, result.homeErrors, homeBattedLast)}
      </table>
      ${decision ? `<div class="screen-sub" style="margin-bottom:8px">${escapeHtml(decision)}</div>` : ''}
      <div class="cols">
        <div class="col">${batters('away')}${pitchers('away')}</div>
        <div class="col">${batters('home')}${pitchers('home')}</div>
      </div>`;
  }

  // ------------------------------------------------------------------ pause

  private openPause(): void {
    if (this.paused) return;
    this.paused = true;
    // The pause card is the last certain moment before a player puts the phone
    // in a pocket, so it is the right place to write the game down.
    this.persistGame();
    this.audio.playSfx('menuBack');
    const rows: MenuRow[] = [
      { id: 'resume', label: 'Resume', onSelect: () => this.closePause() },
      {
        id: 'controls',
        label: 'Controls',
        onSelect: () => {
          this.closePause();
          this.goto(new ControlsScreen(this));
          this.mode = 'menu';
        },
      },
    ];

    if (this.mode === 'game' && this.game) {
      const g = this.game;
      const side = g.half === 'top' ? 'home' : 'away';
      const iAmFielding =
        (side === 'away' && g.setup.awayControl !== 'cpu') ||
        (side === 'home' && g.setup.homeControl !== 'cpu');
      if (iAmFielding) {
        rows.splice(1, 0, {
          id: 'bullpen',
          label: 'Pitching change',
          hint: 'Bring in the next arm from the bullpen.',
          disabled: () => g.pitcherIdx[side] >= (side === 'away' ? g.away : g.home).bullpen.length,
          onSelect: () => {
            const team = side === 'away' ? g.away : g.home;
            const idx = g.pitcherIdx[side];
            if (idx < team.bullpen.length) {
              changePitcher(g, side, team.bullpen[idx]);
              g.pitcherIdx[side] = idx + 1;
              this.toast('Pitching change');
              this.closePause();
            }
          },
        });
      }
    }

    rows.push({
      id: 'settings',
      label: 'Settings',
      onSelect: () => {
        const s = new ListScreen(this, 'SETTINGS', 'Paused', () => [], () => settingsSummaryHtml(this));
        s.setRows(buildSettingsRows(this));
        this.closePause();
        this.mode = 'menu';
        this.goto(s);
      },
    });
    rows.push({
      id: 'quit',
      label: this.mode === 'derby' ? 'Quit the derby' : 'Quit to main menu',
      hint: 'The current game is abandoned. Season progress up to this point is kept.',
      onSelect: () => {
        this.paused = false;
        this.pauseScreen?.root.remove();
        this.pauseScreen = null;
        this.hud.root.remove();
        this.detachDerbyHud();
        // "Abandoned" has to mean abandoned. Leaving it resumable would put a
        // game the player just quit back on the menu they quit to.
        clearSlot(SLOT.resume);
        this.gotoMainMenu();
      },
    });

    const screen = new ListScreen(this, 'PAUSED', this.mode === 'derby' ? 'Moonshot Derby' : 'Game in progress', () => []);
    screen.setRows(rows);
    screen.root.className = 'screen overlay';
    this.pauseScreen = screen;
    screen.render();
    this.uiRoot.appendChild(screen.root);
  }

  private closePause(): void {
    this.paused = false;
    this.pauseScreen?.root.remove();
    this.pauseScreen = null;
  }

  /** Average frames per second over the last two seconds. */
  fps(): number {
    if (!this.frameTimes.length) return 0;
    const sum = this.frameTimes.reduce((a, b) => a + b, 0);
    return this.frameTimes.length / sum;
  }

  /** Called from the render loop for the derby HUD. */
  refreshDerbyHud(): void {
    this.updateDerbyHud();
  }
}

// ---------------------------------------------------------------------------

/** True when a human is at the plate or on the mound this half-inning. */
function humanInvolved(state: GameState): boolean {
  return humanIsBatting(state) || humanIsPitching(state);
}

function teamLabel(teams: Team[], id: string): string {
  const t = teams.find((x) => x.id === id) ?? teams[0];
  return `${t.city} ${t.name}`.toUpperCase();
}

function nextTeamId(id: string): string {
  const i = TEAM_IDENTITIES.findIndex((t) => t.id === id);
  return TEAM_IDENTITIES[(i + 1) % TEAM_IDENTITIES.length].id;
}

function shiftTeam(id: string, d: number, forbid: string): string {
  let i = TEAM_IDENTITIES.findIndex((t) => t.id === id);
  for (let n = 0; n < TEAM_IDENTITIES.length; n++) {
    i = (i + d + TEAM_IDENTITIES.length) % TEAM_IDENTITIES.length;
    if (TEAM_IDENTITIES[i].id !== forbid) return TEAM_IDENTITIES[i].id;
  }
  return id;
}

function homeStadiumOf(teamId: string): string {
  return TEAM_IDENTITIES.find((t) => t.id === teamId)?.homeStadium ?? 'anchor-yard';
}

function CUP_ROUND_NAME(round: number): string {
  return ['the quarter-final', 'the semi-final', 'the final'][round] ?? 'the match';
}

function resultIsUserWin(app: App, result: GameResult): boolean {
  const s = (app as unknown as { season: SeasonState | null }).season;
  const c = (app as unknown as { championship: ChampionshipState | null }).championship;
  const mine = s?.userTeamId ?? c?.userTeamId;
  if (!mine) return false;
  const homeWon = result.homeRuns > result.awayRuns;
  return homeWon ? result.homeTeamId === mine : result.awayTeamId === mine;
}

function cssColorSafe(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}
