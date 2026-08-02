import type { Difficulty, GameSetup, PitchTempo, PracticeDrill, Team } from '../core/types';
import { DEFAULT_PITCH_TEMPO } from '../core/constants';
import { STADIUMS, getStadium } from '../data/stadiums';
import { TEAM_IDENTITIES, displayName, teamRating } from '../data/teams';
import { DIFFICULTY } from '../sim/ai';
import { cssColor } from '../render/palette';
import { escapeHtml } from './hud';
import { ACTION_LABELS, type ActionId, type MenuAction, prettyKey } from './input';
import { Haptics } from './haptics';
import {
  SEASON_LENGTHS,
  type SeasonLength,
  type SeasonState,
  sortedStandings,
} from '../modes/season';
import { CUP_ROUND_NAMES, type ChampionshipState } from '../modes/championship';
import type { DerbyState } from '../modes/homerun';
import {
  ATTR_MAX,
  ATTR_MIN,
  BODY_TYPES,
  type CustomPlayer,
  HITTER_POINTS,
  PITCHER_POINTS,
  POSITIONS,
  adjust,
  isValid,
  pointsRemaining,
} from '../modes/creator';
import { ALL_PITCH_TYPES, PITCHES } from '../data/pitches';
import type { Handedness, PitchType } from '../core/types';

/**
 * Screen framework.
 *
 * Every menu is a list of rows that can be selected, and optionally nudged left
 * and right to change a value. That single interaction model means the whole
 * front end can be driven by keyboard, gamepad or mouse without special cases.
 */

export interface MenuRow {
  id: string;
  label: string;
  value?: () => string;
  hint?: string;
  onSelect?: () => void;
  onLeft?: () => void;
  onRight?: () => void;
  disabled?: () => boolean;
}

export interface AppApi {
  teams: Team[];
  goto(screen: Screen): void;
  back(): void;
  startGame(setup: GameSetup): void;
  playSfx(name: string): void;
  toast(msg: string): void;
  settings: GameSettings;
  saveSettings(): void;
  bindingLabel(player: 'p1' | 'p2', action: ActionId): string;
  rebind(player: 'p1' | 'p2', action: ActionId, done: () => void): void;
  resetBindings(): void;
  hasGamepad(): boolean;
  /** False on the main menu and on the pause card, which have nowhere to go. */
  canGoBack(): boolean;
  toggleFullscreen(): void;
  /** True once the on-screen pad has taken over — the settings list adapts. */
  isTouch(): boolean;
  /** Which rung the automatic graphics servo is currently sitting on. */
  qualityNow(): string;
}

export interface GameSettings {
  musicVolume: number;
  sfxVolume: number;
  cameraShake: boolean;
  reducedFlashing: boolean;
  showLineScore: boolean;
  /** The strike-zone overlay, contact cursor and pitch tracker at the plate. */
  plateView: boolean;
  highContrast: boolean;
  muted: boolean;
  /**
   * `auto` is not a preset — it is a servo that moves between them while you
   * play, which is the only setting that stays right on a phone that heats up.
   */
  quality: 'auto' | 'high' | 'balanced' | 'performance';
  /** Stretch on the pitch clock. Copied into every GameSetup the app starts. */
  pitchTempo: PitchTempo;
  /**
   * Touch the strike zone to swing there, and to place a pitch. The phone
   * control scheme; see the tap-mode notes in touch.ts and controls.ts.
   */
  tapToHit: boolean;
  /** Vibration feedback on the on-screen pad. Android only; see haptics.ts. */
  haptics: boolean;
  /** Mirrors the on-screen pad: stick right, buttons left. */
  lefty: boolean;
  lastDifficulty: Difficulty;
  lastInnings: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  musicVolume: 0.55,
  sfxVolume: 0.85,
  cameraShake: true,
  reducedFlashing: false,
  showLineScore: true,
  plateView: true,
  highContrast: false,
  muted: false,
  quality: 'high',
  pitchTempo: DEFAULT_PITCH_TEMPO,
  tapToHit: true,
  haptics: true,
  lefty: false,
  lastDifficulty: 'pro',
  lastInnings: 9,
};

export abstract class Screen {
  readonly root: HTMLDivElement;
  protected sel = 0;
  protected rows: MenuRow[] = [];
  /** When true the 3D scene stays visible behind the panel. */
  transparent = false;

  constructor(protected app: AppApi) {
    this.root = document.createElement('div');
    this.root.className = 'screen';
  }

  onEnter(): void {}
  onExit(): void {}
  update(_dt: number): void {}

  abstract render(): void;

  handle(action: MenuAction): void {
    const enabled = this.rows.filter((r) => !r.disabled?.());
    if (!enabled.length) {
      if (action === 'back') this.app.back();
      return;
    }
    switch (action) {
      case 'up':
        this.move(-1);
        break;
      case 'down':
        this.move(1);
        break;
      case 'left':
        this.rows[this.sel]?.onLeft?.();
        this.app.playSfx('menuMove');
        this.refreshSelection();
        break;
      case 'right':
        this.rows[this.sel]?.onRight?.();
        this.app.playSfx('menuMove');
        this.refreshSelection();
        break;
      case 'confirm': {
        const row = this.rows[this.sel];
        if (!row || row.disabled?.()) {
          this.app.playSfx('menuDenied');
          return;
        }
        this.app.playSfx('menuSelect');
        row.onSelect?.();
        break;
      }
      case 'back':
        this.app.playSfx('menuBack');
        this.app.back();
        break;
      default:
        break;
    }
  }

  protected move(dir: number): void {
    if (!this.rows.length) return;
    let i = this.sel;
    for (let n = 0; n < this.rows.length; n++) {
      i = (i + dir + this.rows.length) % this.rows.length;
      if (!this.rows[i].disabled?.()) break;
    }
    if (i !== this.sel) {
      this.sel = i;
      this.app.playSfx('menuMove');
      this.refreshSelection();
    }
  }

  /** Standard head/body/foot chrome. */
  protected frame(title: string, sub: string, body: string, foot: string): string {
    return `
      ${this.backButtonHtml()}
      <div class="screen-head">
        <h1 class="screen-title">${escapeHtml(title)}</h1>
        <div class="screen-sub">${escapeHtml(sub)}</div>
      </div>
      <div class="screen-body">${body}</div>
      <div class="screen-foot">${foot}</div>
    `;
  }

  protected menuHtml(): string {
    return `<ul class="menu">${this.rows
      .map((r, i) => {
        const dis = r.disabled?.() ? ' disabled' : '';
        const sel = i === this.sel ? ' sel' : '';
        const val = r.value ? `<span class="value">${escapeHtml(r.value())}</span>` : '';
        const steps = r.onLeft || r.onRight;
        const arrows = steps ? '<span class="arrows">◀ ▶</span>' : '';
        // On a touch device the arrows have to be pressable, not printed:
        // there is no left-arrow key on a phone, so a value row would be
        // unreachable. They are inert markup until `body.touch-mode` shows them.
        const buttons = steps
          ? `<button class="menu-step" data-step="-1" type="button" aria-label="${escapeHtml(r.label)} previous">◀</button>` +
            `<button class="menu-step" data-step="1" type="button" aria-label="${escapeHtml(r.label)} next">▶</button>`
          : '';
        return `<li class="menu-item${sel}${dis}${steps ? ' stepper' : ''}" data-i="${i}"><span class="label">${escapeHtml(
          r.label,
        )}</span>${arrows}${val}${buttons}</li>`;
      })
      .join('')}</ul>`;
  }

  protected hintHtml(): string {
    const row = this.rows[this.sel];
    return `<div class="menu-hint js-hint"><h4>${escapeHtml(row?.label ?? '')}</h4><span class="js-hint-body">${escapeHtml(
      row?.hint ?? '',
    )}</span></div>`;
  }

  /**
   * Moves the highlight without rebuilding the DOM. Re-rendering on hover would
   * destroy the element the user is about to click, which silently eats clicks.
   */
  protected refreshSelection(): void {
    this.root.querySelectorAll<HTMLElement>('.menu-item').forEach((el, i) => {
      el.classList.toggle('sel', i === this.sel);
      const row = this.rows[i];
      const val = el.querySelector('.value');
      // A name row hosts a real <input>; never stomp on it.
      if (val && row?.value && !val.querySelector('input')) val.textContent = row.value();
      if (i === this.sel) el.scrollIntoView({ block: 'nearest' });
    });
    const hint = this.root.querySelector('.js-hint');
    if (hint) {
      const row = this.rows[this.sel];
      const h4 = hint.querySelector('h4');
      const body = hint.querySelector('.js-hint-body');
      if (h4) h4.textContent = row?.label ?? '';
      if (body) body.textContent = row?.hint ?? '';
    }
  }

  protected footHtml(extra = ''): string {
    const pad = this.app.hasGamepad() ? ' · <b>PAD</b> A CONFIRM / B BACK' : '';
    return `<span><b>↑↓</b> MOVE</span><span><b>←→</b> CHANGE</span><span><b>ENTER</b> CONFIRM</span><span><b>ESC</b> BACK</span>${extra}${pad}`;
  }

  /**
   * Wires pointer selection for the rendered menu rows.
   *
   * `mouseenter` deliberately stays a mouse-only hook: a finger has no hover,
   * and letting a touch synthesise one makes the first tap merely highlight a
   * row. A tap has to *do* the thing.
   */
  protected wireMouse(): void {
    this.wireBack();
    this.root.querySelectorAll<HTMLElement>('.menu-item').forEach((el) => {
      el.addEventListener('pointerenter', (e) => {
        // Only a mouse truly hovers. A touch synthesises an enter on the way to
        // a tap, and acting on it makes the first tap merely highlight a row.
        if (e.pointerType !== 'mouse') return;
        const i = Number(el.dataset.i);
        if (this.rows[i]?.disabled?.()) return;
        this.sel = i;
        this.refreshSelection();
      });
      el.addEventListener('click', (e) => {
        const i = Number(el.dataset.i);
        const row = this.rows[i];
        // A tap on one of the value steppers nudges the value; it must not also
        // count as selecting the row and firing its action.
        const step = (e.target as HTMLElement)?.closest?.('.menu-step') as HTMLElement | null;
        if (step) {
          e.stopPropagation();
          if (row?.disabled?.()) {
            this.app.playSfx('menuDenied');
            return;
          }
          this.sel = i;
          if (step.dataset.step === '-1') row?.onLeft?.();
          else row?.onRight?.();
          this.app.playSfx('menuMove');
          this.refreshSelection();
          return;
        }
        if (row?.disabled?.()) {
          this.app.playSfx('menuDenied');
          return;
        }
        this.sel = i;
        this.refreshSelection();
        // A row with no action but a value is a setting: tapping its label
        // steps it forward, which is the only thing tapping it could mean.
        if (!row?.onSelect && (row?.onRight || row?.onLeft)) {
          (row.onRight ?? row.onLeft)?.();
          this.app.playSfx('menuMove');
          this.refreshSelection();
          return;
        }
        this.app.playSfx('menuSelect');
        row?.onSelect?.();
      });
    });
  }

  /**
   * An on-screen way out. Escape is a keyboard idea and a phone does not have
   * one; the CSS only shows this in touch mode.
   */
  protected backButtonHtml(label = 'BACK'): string {
    return `<button class="screen-back js-back" type="button">◀ ${escapeHtml(label)}</button>`;
  }

  protected wireBack(): void {
    const el = this.root.querySelector<HTMLButtonElement>('.js-back');
    if (!el) return;
    // Nothing to go back to: the main menu, and the pause card, which offers
    // Resume as a row and would otherwise pop the menu underneath the game.
    if (!this.app.canGoBack()) {
      el.remove();
      return;
    }
    el.addEventListener('click', () => {
      this.app.playSfx('menuBack');
      this.app.back();
    });
  }
}

// ---------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------

export class TitleScreen extends Screen {
  private t = 0;

  constructor(app: AppApi, private onStart: () => void) {
    super(app);
    this.transparent = true;
    this.root.className = 'screen transparent title-screen';
  }

  override render(): void {
    this.root.innerHTML = `
      <div class="title-mark">MOONSHOT<em>NINE</em></div>
      <div class="title-tag">Meridian Circuit Baseball</div>
      <div class="title-press">Press Enter or Space<span class="only-touch">Tap to start</span></div>
      <div class="title-foot">An original game. Ten clubs, eight parks, one cup.</div>
    `;
    // The whole title is the button. This is also the first user gesture of the
    // session, which is the only moment a browser will let the audio start —
    // so on a phone there is no other way in.
    this.root.addEventListener('click', () => {
      this.app.playSfx('menuSelect');
      this.onStart();
    });
  }

  override update(dt: number): void {
    this.t += dt;
  }

  override handle(action: MenuAction): void {
    if (action === 'confirm' || action === 'pause') {
      this.app.playSfx('menuSelect');
      this.onStart();
    }
  }
}

// ---------------------------------------------------------------------------
// Generic list screen
// ---------------------------------------------------------------------------

export class ListScreen extends Screen {
  constructor(
    app: AppApi,
    private title: string,
    private sub: string,
    rowsFactory: (screen: ListScreen) => MenuRow[],
    private extraPane?: () => string,
  ) {
    super(app);
    this.rows = rowsFactory(this);
  }

  setRows(rows: MenuRow[]): void {
    this.rows = rows;
    if (this.sel >= rows.length) this.sel = 0;
  }

  override render(): void {
    const pane = this.extraPane ? this.extraPane() : this.hintHtml();
    this.root.innerHTML = this.frame(this.title, this.sub, this.menuHtml() + pane, this.footHtml());
    this.wireMouse();
  }

  /**
   * A custom pane can depend on the values the rows change, so it is rebuilt
   * whenever the selection or a value moves. The row list itself is left alone
   * so a click in flight is never destroyed.
   */
  protected override refreshSelection(): void {
    super.refreshSelection();
    if (!this.extraPane) return;
    const pane = this.root.querySelector('.menu-hint');
    if (pane) pane.outerHTML = this.extraPane();
  }
}

// ---------------------------------------------------------------------------
// Team select
// ---------------------------------------------------------------------------

export class TeamSelectScreen extends Screen {
  private idx = 0;

  constructor(
    app: AppApi,
    private title: string,
    private sub: string,
    private onPick: (teamId: string) => void,
    private highlightId?: string,
  ) {
    super(app);
    if (highlightId) {
      const i = TEAM_IDENTITIES.findIndex((t) => t.id === highlightId);
      if (i >= 0) this.idx = i;
    }
  }

  override render(): void {
    const cards = TEAM_IDENTITIES.map((t, i) => {
      const team = this.app.teams.find((x) => x.id === t.id)!;
      const r = teamRating(team);
      return `<div class="team-card${i === this.idx ? ' sel' : ''}" data-i="${i}" style="background:linear-gradient(150deg, ${cssColor(
        t.primary,
      )} 0%, ${cssColor(t.accent)}22 130%)">
        ${t.id === this.highlightId ? '<span class="tag">YOURS</span>' : ''}
        <div class="city">${escapeHtml(t.city)}</div>
        <div class="name">${escapeHtml(t.name)}</div>
        <div class="ratings"><span>OFF ${r.off}</span><span>DEF ${r.def}</span><span>PIT ${r.pit}</span></div>
      </div>`;
    }).join('');

    this.root.innerHTML = this.frame(
      this.title,
      this.sub,
      `<div class="team-grid">${cards}</div>${this.detailHtml()}`,
      this.footHtml(),
    );

    this.root.querySelectorAll<HTMLElement>('.team-card').forEach((el) => {
      el.addEventListener('mouseenter', () => {
        this.idx = Number(el.dataset.i);
        this.refreshGrid();
      });
      el.addEventListener('click', () => {
        this.app.playSfx('menuSelect');
        this.onPick(TEAM_IDENTITIES[Number(el.dataset.i)].id);
      });
    });
  }

  /** Updates only the detail pane so hovering never rebuilds the clickable grid. */
  private renderDetail(): void {
    const pane = this.root.querySelector('.menu-hint');
    if (pane) pane.outerHTML = this.detailHtml();
  }

  /**
   * How many cards the grid actually laid out per row. Measuring the DOM is the
   * only reliable answer: the column count comes from a CSS auto-fill track, so
   * any guess based on viewport width is wrong at some resolution.
   */
  private columns(): number {
    const grid = this.root.querySelector<HTMLElement>('.team-grid');
    if (!grid) return 1;
    // The computed track list is authoritative; anything derived from viewport
    // width disagrees with the grid at some resolution.
    const tracks = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).filter(Boolean);
    return Math.max(1, tracks.length);
  }

  /** Moves the highlight without rebuilding the grid, and keeps it in view. */
  private refreshGrid(): void {
    const cards = this.root.querySelectorAll<HTMLElement>('.team-card');
    cards.forEach((c, i) => c.classList.toggle('sel', i === this.idx));
    const sel = cards[this.idx];
    const grid = this.root.querySelector<HTMLElement>('.team-grid');
    // Scroll the grid itself rather than calling scrollIntoView, which can move
    // an ancestor and leave the card outside the grid's own clip rectangle.
    if (sel && grid) {
      const top = sel.offsetTop;
      const bottom = top + sel.offsetHeight;
      if (top < grid.scrollTop) grid.scrollTop = top - 8;
      else if (bottom > grid.scrollTop + grid.clientHeight) {
        grid.scrollTop = bottom - grid.clientHeight + 8;
      }
    }
    this.renderDetail();
  }

  private detailHtml(): string {
    const t = TEAM_IDENTITIES[this.idx];
    const team = this.app.teams.find((x) => x.id === t.id)!;
    const star = team.players.find((p) => p.star);
    const stadium = getStadium(t.homeStadium);
    const r = teamRating(team);
    return `<div class="menu-hint">
      <h4>${escapeHtml(t.city)} ${escapeHtml(t.name)}</h4>
      <p style="color:var(--gold);letter-spacing:.1em;text-transform:uppercase">${escapeHtml(t.motto)}</p>
      <p>${escapeHtml(divisionName(t.division))} · Offence ${r.off} · Defence ${r.def} · Pitching ${r.pit}</p>
      <p>Home park: <b>${escapeHtml(stadium.name)}</b> — ${escapeHtml(stadium.blurb)}</p>
      ${
        star
          ? `<p><b>${escapeHtml(displayName(star))}</b> (${star.primary}) — ${escapeHtml(star.trait ?? '')}</p>`
          : ''
      }
    </div>`;
  }

  override handle(action: MenuAction): void {
    const cols = this.columns();
    switch (action) {
      case 'left':
        this.idx = (this.idx - 1 + TEAM_IDENTITIES.length) % TEAM_IDENTITIES.length;
        break;
      case 'right':
        this.idx = (this.idx + 1) % TEAM_IDENTITIES.length;
        break;
      case 'up':
        // Step by one column-row; if that lands on a club already covered by a
        // pure vertical walk the player can still reach every club with left
        // and right, and the wrap keeps the whole grid reachable.
        this.idx =
          this.idx - cols >= 0 ? this.idx - cols : (this.idx - cols + TEAM_IDENTITIES.length * 2) % TEAM_IDENTITIES.length;
        break;
      case 'down':
        this.idx =
          this.idx + cols < TEAM_IDENTITIES.length
            ? this.idx + cols
            : (this.idx + 1) % Math.max(1, cols);
        break;
      case 'confirm':
        this.app.playSfx('menuSelect');
        this.onPick(TEAM_IDENTITIES[this.idx].id);
        return;
      case 'back':
        this.app.playSfx('menuBack');
        this.app.back();
        return;
      default:
        return;
    }
    this.app.playSfx('menuMove');
    this.refreshGrid();
  }
}

function divisionName(d: 'tide' | 'ridge'): string {
  return d === 'tide' ? 'Tidewater Division' : 'Highland Division';
}

// ---------------------------------------------------------------------------
// Season hub
// ---------------------------------------------------------------------------

export class SeasonHubScreen extends Screen {
  constructor(
    app: AppApi,
    private season: () => SeasonState,
    rows: (s: SeasonHubScreen) => MenuRow[],
  ) {
    super(app);
    this.rows = rows(this);
  }

  refresh(rows: MenuRow[]): void {
    this.rows = rows;
    if (this.sel >= rows.length) this.sel = Math.max(0, rows.length - 1);
  }

  override render(): void {
    const s = this.season();
    const myTeam = this.app.teams.find((t) => t.id === s.userTeamId)!;
    const played = s.schedule.filter((g) => g.played).length;
    const rec = s.standings[s.userTeamId];

    const stand = (div: 'tide' | 'ridge') => {
      const rows = sortedStandings(s, div);
      return `<div class="col"><h4>${divisionName(div)}</h4><div class="scroll"><table class="data-table">
        <tr><th>Club</th><th>W</th><th>L</th><th>RF</th><th>RA</th><th>L10</th></tr>
        ${rows
          .map((r) => {
            const t = TEAM_IDENTITIES.find((x) => x.id === r.teamId)!;
            const l10 = r.last10.slice(-5).join('') || '—';
            return `<tr class="${r.teamId === s.userTeamId ? 'me' : ''}"><td>${escapeHtml(
              t.abbr,
            )} ${escapeHtml(t.name)}</td><td>${r.w}</td><td>${r.l}</td><td>${r.rf}</td><td>${r.ra}</td><td>${l10}</td></tr>`;
          })
          .join('')}
      </table></div></div>`;
    };

    const upcoming = s.schedule
      .filter((g) => !g.played && (g.awayId === s.userTeamId || g.homeId === s.userTeamId))
      .slice(0, 6)
      .map((g) => {
        const opp = g.awayId === s.userTeamId ? g.homeId : g.awayId;
        const at = g.awayId === s.userTeamId ? '@' : 'vs';
        const t = TEAM_IDENTITIES.find((x) => x.id === opp)!;
        return `<tr><td>Day ${g.day + 1}</td><td>${at} ${escapeHtml(t.abbr)}</td><td>${escapeHtml(
          getStadium(g.stadiumId).name,
        )}</td></tr>`;
      })
      .join('');

    const body = `
      ${this.menuHtml()}
      <div class="menu-hint" style="flex:2 1 0">
        <h4>${escapeHtml(myTeam.city)} ${escapeHtml(myTeam.name)} · ${rec.w}-${rec.l}</h4>
        <div style="margin-bottom:10px">${rec.w + rec.l} of ${s.gamesPerTeam} games played · ${SEASON_LENGTHS[s.length].label} season · ${DIFFICULTY[s.difficulty].label} · league ${played}/${s.schedule.length}</div>
        <div class="cols">${stand('tide')}${stand('ridge')}</div>
        <h4 style="margin-top:14px">Next up</h4>
        <table class="data-table">${upcoming || '<tr><td>Regular season complete</td></tr>'}</table>
      </div>`;

    this.root.innerHTML = this.frame('SEASON', `${myTeam.city} ${myTeam.name}`, body, this.footHtml());
    this.wireMouse();
  }
}

// ---------------------------------------------------------------------------
// Standings / stats / bracket views
// ---------------------------------------------------------------------------

export class StatsScreen extends Screen {
  constructor(
    app: AppApi,
    private title: string,
    private sub: string,
    private bodyHtml: () => string,
  ) {
    super(app);
  }

  override render(): void {
    this.root.innerHTML = this.frame(
      this.title,
      this.sub,
      `<div class="scroll" style="width:100%">${this.bodyHtml()}</div>`,
      '<span><b>ESC</b> BACK</span>',
    );
  }

  override handle(action: MenuAction): void {
    if (action === 'back' || action === 'confirm') {
      this.app.playSfx('menuBack');
      this.app.back();
      return;
    }
    const el = this.root.querySelector('.scroll');
    if (!el) return;
    if (action === 'up') el.scrollBy(0, -80);
    if (action === 'down') el.scrollBy(0, 80);
  }
}

export class BracketScreen extends Screen {
  constructor(
    app: AppApi,
    private state: () => ChampionshipState,
    rows: (s: BracketScreen) => MenuRow[],
  ) {
    super(app);
    this.rows = rows(this);
  }

  refresh(rows: MenuRow[]): void {
    this.rows = rows;
  }

  override render(): void {
    const st = this.state();
    const name = (id: string | null) =>
      id ? TEAM_IDENTITIES.find((t) => t.id === id)?.abbr ?? '???' : 'TBD';

    const round = (r: number) => `
      <div class="bracket-round">
        <h5>${CUP_ROUND_NAMES[r]}</h5>
        ${st.bracket
          .filter((m) => m.round === r)
          .map((m) => {
            const live = !m.played && m.awayId && m.homeId;
            const isUser = m.awayId === st.userTeamId || m.homeId === st.userTeamId;
            const cls = `match${live && isUser ? ' live' : ''}`;
            const rowFor = (id: string | null, runs: number, other: number) =>
              `<div class="row ${!id ? 'tbd' : m.played && runs > other ? 'win' : ''}">
                <span>${escapeHtml(name(id))}</span><span>${m.played ? runs : ''}</span>
              </div>`;
            return `<div class="${cls}">${rowFor(m.awayId, m.awayRuns, m.homeRuns)}${rowFor(
              m.homeId,
              m.homeRuns,
              m.awayRuns,
            )}</div>`;
          })
          .join('')}
      </div>`;

    const champ = st.championId
      ? `<div style="text-align:center;margin-top:16px"><div class="screen-sub">Meridian Cup Champion</div>
         <div style="font-size:clamp(24px,4vw,52px);font-weight:800;color:var(--gold);letter-spacing:.08em">${escapeHtml(
           TEAM_IDENTITIES.find((t) => t.id === st.championId)?.name.toUpperCase() ?? '',
         )}</div></div>`
      : '';

    const body = `<div style="display:flex;flex-direction:column;width:100%;min-height:0">
        <div class="bracket">${round(0)}${round(1)}${round(2)}</div>
        ${champ}
        <div style="margin-top:auto">${this.menuHtml()}</div>
      </div>`;

    this.root.innerHTML = this.frame('MERIDIAN CUP', 'Single elimination', body, this.footHtml());
    this.wireMouse();
  }
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

const REBINDABLE: ActionId[] = [
  'up',
  'down',
  'left',
  'right',
  'diamondUp',
  'diamondDown',
  'diamondLeft',
  'diamondRight',
  'special',
  'modifier',
  'switchFielder',
];

export class ControlsScreen extends Screen {
  private player: 'p1' | 'p2' = 'p1';
  private waiting: ActionId | null = null;

  constructor(app: AppApi) {
    super(app);
    this.buildRows();
  }

  private buildRows(): void {
    this.rows = [
      {
        id: 'player',
        label: 'Editing',
        value: () => (this.player === 'p1' ? 'PLAYER 1' : 'PLAYER 2'),
        hint: 'Player 1 defaults to WASD plus the IJKL diamond. Player 2 defaults to the arrow keys plus the ; . \' [ diamond, with numpad aliases.',
        onLeft: () => {
          this.player = this.player === 'p1' ? 'p2' : 'p1';
        },
        onRight: () => {
          this.player = this.player === 'p1' ? 'p2' : 'p1';
        },
        onSelect: () => {
          this.player = this.player === 'p1' ? 'p2' : 'p1';
          this.render();
        },
      },
      ...REBINDABLE.map((a) => ({
        id: a,
        label: ACTION_LABELS[a],
        value: () => (this.waiting === a ? 'PRESS A KEY…' : this.app.bindingLabel(this.player, a)),
        hint: HINTS[a],
        onSelect: () => {
          this.waiting = a;
          this.render();
          this.app.rebind(this.player, a, () => {
            this.waiting = null;
            this.render();
          });
        },
      })),
      {
        id: 'reset',
        label: 'Restore defaults',
        hint: 'Puts every binding back to the shipped layout.',
        onSelect: () => {
          this.app.resetBindings();
          this.app.toast('Bindings restored');
          this.render();
        },
      },
      {
        id: 'back',
        label: 'Back',
        onSelect: () => this.app.back(),
      },
    ];
  }

  override render(): void {
    const pane = `<div class="menu-hint">
      <h4>The diamond</h4>
      <p>The four action buttons are laid out like the bases, and always mean the base they point at.</p>
      <pre style="font-family:var(--mono);line-height:1.5;color:var(--gold)">        ${escapeHtml(
        this.app.bindingLabel(this.player, 'diamondUp'),
      )}  = 2ND
 ${escapeHtml(this.app.bindingLabel(this.player, 'diamondLeft'))} = 3RD      ${escapeHtml(
   this.app.bindingLabel(this.player, 'diamondRight'),
 )} = 1ST
        ${escapeHtml(this.app.bindingLabel(this.player, 'diamondDown'))}  = HOME</pre>
      <h4>What they do</h4>
      <p><b>Batting</b> — Down: contact swing · Right: power swing · Left: bunt · Up: take / check swing.</p>
      <p><b>Pitching</b> — Left / Down / Right / Up throw pitches 1 to 4. Move to aim before, steer during flight.</p>
      <p><b>Fielding</b> — Throw to the base the button points at. Special dives, Switch changes fielder.</p>
      <p><b>Baserunning</b> — Send the lead runner to that base. Hold Modifier to send them back. Special advances everyone.</p>
      <p><b>Gamepad</b> — Left stick moves, face buttons are the same diamond (A down, B right, X left, Y up), RB is Special, LB switches fielder, LT is Modifier, Start pauses.</p>
    </div>`;
    this.root.innerHTML = this.frame(
      'CONTROLS',
      this.player === 'p1' ? 'Player 1' : 'Player 2',
      this.menuHtml() + pane,
      this.footHtml('<span><b>ENTER</b> REBIND</span>'),
    );
    this.wireMouse();
  }
}

const HINTS: Record<ActionId, string> = {
  up: 'Moves the batting cursor up, aims higher when pitching, and runs toward centre field when fielding.',
  down: 'Moves the batting cursor down, aims lower when pitching, and runs toward home when fielding.',
  left: 'Moves the batting cursor and fielders toward left field.',
  right: 'Moves the batting cursor and fielders toward right field.',
  diamondUp: 'Second base. Take/check swing when batting, pitch slot 4 on the mound.',
  diamondDown: 'Home plate. Contact swing when batting, pitch slot 2 on the mound.',
  diamondLeft: 'Third base. Bunt when batting, pitch slot 1 on the mound.',
  diamondRight: 'First base. Power swing when batting, pitch slot 3 on the mound.',
  special: 'Dive or leap on defence, advance every runner on offence.',
  modifier: 'Hold and press a base to send a runner back, or to call for a steal before the pitch.',
  switchFielder: 'Cycles control to the next-closest fielder.',
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const PITCH_TEMPO_ORDER: PitchTempo[] = ['brisk', 'standard', 'relaxed'];

const PITCH_TEMPO_LABEL: Record<PitchTempo, string> = {
  brisk: 'BRISK — REAL TIME',
  standard: 'STANDARD',
  relaxed: 'RELAXED — MOST TIME',
};

function cycleTempo(cur: PitchTempo, dir: number): PitchTempo {
  const i = PITCH_TEMPO_ORDER.indexOf(cur);
  const n = PITCH_TEMPO_ORDER.length;
  return PITCH_TEMPO_ORDER[(((i < 0 ? 1 : i) + dir) % n + n) % n];
}

export function buildSettingsRows(app: AppApi): MenuRow[] {
  const s = app.settings;
  const bar = (v: number) => `${'█'.repeat(Math.round(v * 10))}${'·'.repeat(10 - Math.round(v * 10))} ${Math.round(v * 100)}%`;
  const step = (key: 'musicVolume' | 'sfxVolume', d: number) => () => {
    s[key] = Math.max(0, Math.min(1, Math.round((s[key] + d) * 20) / 20));
    app.saveSettings();
  };
  const toggle = (
    key:
      | 'cameraShake'
      | 'reducedFlashing'
      | 'showLineScore'
      | 'plateView'
      | 'highContrast'
      | 'muted',
  ) => () => {
    s[key] = !s[key];
    app.saveSettings();
  };
  const onOff = (v: boolean) => (v ? 'ON' : 'OFF');

  return [
    {
      id: 'music',
      label: 'Music volume',
      value: () => bar(s.musicVolume),
      hint: 'Volume of the procedural soundtrack only. Sound effects are separate.',
      onLeft: step('musicVolume', -0.05),
      onRight: step('musicVolume', 0.05),
    },
    {
      id: 'sfx',
      label: 'Sound volume',
      value: () => bar(s.sfxVolume),
      hint: 'Bat contact, gloves, umpire calls and crowd.',
      onLeft: step('sfxVolume', -0.05),
      onRight: step('sfxVolume', 0.05),
    },
    {
      id: 'mute',
      label: 'Mute everything',
      value: () => onOff(s.muted),
      hint: 'Silences music, sound and crowd in one press, without losing your volume settings.',
      onLeft: toggle('muted'),
      onRight: toggle('muted'),
      onSelect: toggle('muted'),
    },
    {
      id: 'shake',
      label: 'Camera shake',
      value: () => onOff(s.cameraShake),
      hint: 'Turn off to remove all camera movement on contact, catches and home runs.',
      onLeft: toggle('cameraShake'),
      onRight: toggle('cameraShake'),
      onSelect: toggle('cameraShake'),
    },
    {
      id: 'contrast',
      label: 'High contrast HUD',
      value: () => onOff(s.highContrast),
      hint: 'Solid panel backgrounds, heavier outlines and brighter text on every scoreboard and prompt.',
      onLeft: toggle('highContrast'),
      onRight: toggle('highContrast'),
      onSelect: toggle('highContrast'),
    },
    {
      id: 'flash',
      label: 'Reduced flashing',
      value: () => onOff(s.reducedFlashing),
      hint: 'Removes particle bursts, fireworks, impact rings and the crowd wave.',
      onLeft: toggle('reducedFlashing'),
      onRight: toggle('reducedFlashing'),
      onSelect: toggle('reducedFlashing'),
    },
    {
      id: 'plate',
      label: 'Plate view',
      value: () => onOff(s.plateView),
      hint: 'The strike zone, contact cursor, pitch tracker and swing feedback at the plate. Turn off for a clean camera; the game plays identically either way.',
      // Touch-to-swing aims at the drawn zone, so it cannot be the control
      // scheme and invisible at the same time.
      disabled: () => app.isTouch() && s.tapToHit,
      onLeft: toggle('plateView'),
      onRight: toggle('plateView'),
      onSelect: toggle('plateView'),
    },
    {
      id: 'line',
      label: 'Line score on HUD',
      value: () => onOff(s.showLineScore),
      hint: 'Shows the inning-by-inning line score under the scoreboard.',
      onLeft: toggle('showLineScore'),
      onRight: toggle('showLineScore'),
      onSelect: toggle('showLineScore'),
    },
    {
      id: 'tempo',
      label: 'Pitch tempo',
      value: () => PITCH_TEMPO_LABEL[s.pitchTempo],
      hint: 'How long the ball hangs between release and the mitt. Relaxed gives you about half a second longer to read a pitch and pick a swing; Brisk is real time. The radar always shows the pitcher’s true velocity, and the last-pitch readout prints the actual flight time.',
      onLeft: () => {
        s.pitchTempo = cycleTempo(s.pitchTempo, -1);
        app.saveSettings();
      },
      onRight: () => {
        s.pitchTempo = cycleTempo(s.pitchTempo, 1);
        app.saveSettings();
      },
    },
    {
      id: 'quality',
      label: 'Graphics',
      value: () => (s.quality === 'auto' ? `AUTO — ${app.qualityNow()}` : s.quality.toUpperCase()),
      hint: 'Auto watches the frame clock and moves the settings itself, which is what a phone needs — they throttle as they warm up, so any fixed choice is wrong for part of a game. Balanced renders at 80% resolution, Performance at 60% and stops the crowd animating.',
      onLeft: () => {
        s.quality = cycleQuality(s.quality, -1);
        app.saveSettings();
      },
      onRight: () => {
        s.quality = cycleQuality(s.quality, 1);
        app.saveSettings();
      },
    },
    ...(app.isTouch()
      ? [
          {
            id: 'taptohit',
            label: 'Touch to swing',
            value: () => (s.tapToHit ? 'ON' : 'OFF'),
            hint: 'Touch the strike zone where you think the ball will cross, and the swing happens there — one touch carries both the spot and the timing. The four buttons choose which swing it will be. On the mound, pick a pitch and touch the spot to throw it. Turn this off to steer a cursor with the stick and swing with a button instead.',
            onSelect: () => {
              s.tapToHit = !s.tapToHit;
              // The zone is the target, so it has to be on screen to aim at.
              if (s.tapToHit) s.plateView = true;
              app.saveSettings();
            },
            onLeft: () => {
              s.tapToHit = !s.tapToHit;
              if (s.tapToHit) s.plateView = true;
              app.saveSettings();
            },
            onRight: () => {
              s.tapToHit = !s.tapToHit;
              if (s.tapToHit) s.plateView = true;
              app.saveSettings();
            },
          } as MenuRow,
          {
            id: 'lefty',
            label: 'Left-handed pad',
            value: () => (s.lefty ? 'ON' : 'OFF'),
            hint: 'Mirrors the on-screen controls — stick under the right thumb, buttons under the left. The information panels move with them.',
            onSelect: () => {
              s.lefty = !s.lefty;
              app.saveSettings();
            },
            onLeft: () => {
              s.lefty = !s.lefty;
              app.saveSettings();
            },
            onRight: () => {
              s.lefty = !s.lefty;
              app.saveSettings();
            },
          } as MenuRow,
          {
            id: 'haptics',
            label: 'Vibration',
            value: () => (!hapticsSupported() ? 'UNSUPPORTED' : s.haptics ? 'ON' : 'OFF'),
            disabled: () => !hapticsSupported(),
            hint: hapticsSupported()
              ? 'The pad ticks when a button lands and thumps on contact, harder the better the ball was hit. Glass gives no feedback of its own, so this is the only way to know a press registered without looking down.'
              : 'This browser has no vibration API. Safari on iPhone does not implement one, and the workarounds for it rely on undocumented behaviour, so the game does not pretend otherwise.',
            onSelect: () => {
              s.haptics = !s.haptics;
              app.saveSettings();
            },
            onLeft: () => {
              s.haptics = !s.haptics;
              app.saveSettings();
            },
            onRight: () => {
              s.haptics = !s.haptics;
              app.saveSettings();
            },
          } as MenuRow,
          {
            id: 'fullscreen',
            label: 'Fullscreen',
            value: () => (document.fullscreenElement ? 'ON' : 'OFF'),
            hint: 'Hides the browser toolbars so the whole screen is the ballpark. Not offered by every mobile browser — iPhone Safari has no fullscreen at all, and the layout already keeps the controls clear of its toolbars either way.',
            onSelect: () => app.toggleFullscreen(),
            onLeft: () => app.toggleFullscreen(),
            onRight: () => app.toggleFullscreen(),
          } as MenuRow,
        ]
      : []),
    { id: 'back', label: 'Back', onSelect: () => app.back() },
  ];
}

function hapticsSupported(): boolean {
  return Haptics.supported();
}

const QUALITY_ORDER: GameSettings['quality'][] = ['auto', 'high', 'balanced', 'performance'];

function cycleQuality(q: GameSettings['quality'], dir: number): GameSettings['quality'] {
  const i = QUALITY_ORDER.indexOf(q);
  return QUALITY_ORDER[(i + dir + QUALITY_ORDER.length) % QUALITY_ORDER.length];
}

/** Live summary of the whole configuration, shown beside the settings list. */
export function settingsSummaryHtml(app: AppApi): string {
  const s = app.settings;
  const yn = (v: boolean) => (v ? 'ON' : 'OFF');
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return `<div class="menu-hint js-hint">
    <h4>Current setup</h4>
    <span class="js-hint-body"></span>
    <table class="data-table" style="margin-top:14px">
      <tr><td style="text-align:left">Music</td><td>${s.muted ? 'MUTED' : pct(s.musicVolume)}</td></tr>
      <tr><td style="text-align:left">Sound</td><td>${s.muted ? 'MUTED' : pct(s.sfxVolume)}</td></tr>
      <tr><td style="text-align:left">Camera shake</td><td>${yn(s.cameraShake)}</td></tr>
      <tr><td style="text-align:left">High contrast HUD</td><td>${yn(s.highContrast)}</td></tr>
      <tr><td style="text-align:left">Reduced flashing</td><td>${yn(s.reducedFlashing)}</td></tr>
      <tr><td style="text-align:left">Plate view</td><td>${yn(s.plateView)}</td></tr>
      <tr><td style="text-align:left">Line score on HUD</td><td>${yn(s.showLineScore)}</td></tr>
      <tr><td style="text-align:left">Pitch tempo</td><td>${PITCH_TEMPO_LABEL[s.pitchTempo]}</td></tr>
      <tr><td style="text-align:left">Graphics</td><td>${s.quality.toUpperCase()}</td></tr>
      <tr><td style="text-align:left">Last difficulty</td><td>${DIFFICULTY[s.lastDifficulty].label}</td></tr>
      <tr><td style="text-align:left">Last game length</td><td>${s.lastInnings} INNINGS</td></tr>
    </table>
    <p style="margin-top:14px">Settings are stored in this browser only. Nothing is sent anywhere.</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// Postgame
// ---------------------------------------------------------------------------

export class PostgameScreen extends Screen {
  constructor(
    app: AppApi,
    private title: string,
    private sub: string,
    private bodyHtml: () => string,
    rows: MenuRow[],
  ) {
    super(app);
    this.rows = rows;
  }

  override render(): void {
    this.root.innerHTML = this.frame(
      this.title,
      this.sub,
      `<div style="display:flex;flex-direction:column;width:100%;min-height:0">
        ${this.bodyHtml()}
        <div style="margin-top:auto">${this.menuHtml()}</div>
      </div>`,
      this.footHtml(),
    );
    this.wireMouse();
  }
}

// ---------------------------------------------------------------------------
// Small builders shared by several screens
// ---------------------------------------------------------------------------

export function stadiumRow(
  label: string,
  get: () => string,
  set: (id: string) => void,
  hint = 'Every park plays differently: wall distances, wall heights, turf and how far the ball carries.',
): MenuRow {
  const cycle = (d: number) => () => {
    const i = STADIUMS.findIndex((s) => s.id === get());
    const n = (i + d + STADIUMS.length) % STADIUMS.length;
    set(STADIUMS[n].id);
  };
  return {
    id: 'stadium',
    label,
    value: () => `${getStadium(get()).name} — ${getStadium(get()).city}`,
    hint,
    onLeft: cycle(-1),
    onRight: cycle(1),
  };
}

export function difficultyRow(get: () => Difficulty, set: (d: Difficulty) => void): MenuRow {
  const order: Difficulty[] = ['rookie', 'pro', 'allstar'];
  const cycle = (d: number) => () => {
    const i = order.indexOf(get());
    set(order[(i + d + order.length) % order.length]);
  };
  return {
    id: 'difficulty',
    label: 'Difficulty',
    value: () => DIFFICULTY[get()].label,
    hint: DIFFICULTY[get()].blurb,
    onLeft: cycle(-1),
    onRight: cycle(1),
  };
}

export function inningsRow(get: () => number, set: (n: number) => void): MenuRow {
  const order = [3, 6, 9];
  const cycle = (d: number) => () => {
    const i = order.indexOf(get());
    set(order[(i + d + order.length) % order.length]);
  };
  return {
    id: 'innings',
    label: 'Game length',
    value: () => `${get()} INNINGS`,
    hint: 'Three innings is about six minutes. Nine is the full experience. Ties always go to extras.',
    onLeft: cycle(-1),
    onRight: cycle(1),
  };
}

export function seasonLengthRow(get: () => SeasonLength, set: (l: SeasonLength) => void): MenuRow {
  const order: SeasonLength[] = ['short', 'standard', 'long'];
  const cycle = (d: number) => () => {
    const i = order.indexOf(get());
    set(order[(i + d + order.length) % order.length]);
  };
  return {
    id: 'length',
    label: 'Season length',
    value: () => `${SEASON_LENGTHS[get()].label} · ${SEASON_LENGTHS[get()].games} GAMES`,
    hint: SEASON_LENGTHS[get()].blurb + ' Games you are not in are simulated instantly.',
    onLeft: cycle(-1),
    onRight: cycle(1),
  };
}

export function practiceRow(get: () => PracticeDrill, set: (d: PracticeDrill) => void): MenuRow {
  const real: PracticeDrill[] = ['batting', 'pitching', 'fielding', 'baserunning'];
  const cycle = (d: number) => () => {
    const i = real.indexOf(get());
    set(real[(i + d + real.length) % real.length]);
  };
  const hints: Record<PracticeDrill, string> = {
    batting: 'You hit, the CPU pitches. Three outs simply resets the inning so you keep swinging.',
    pitching: 'You pitch, the CPU hits. Work on locations, sequencing and steering the ball.',
    fielding: 'You field, the CPU hits. Learn the fielder switch, dives and throwing to the right base.',
    baserunning: 'Runners start on base every time so you can practise sending and holding them.',
  };
  return {
    id: 'drill',
    label: 'Drill',
    value: () => get().toUpperCase(),
    hint: hints[get()],
    onLeft: cycle(-1),
    onRight: cycle(1),
  };
}

export function derbyStandingsHtml(state: DerbyState, nameOf: (playerId: string) => string): string {
  // `homers` is the current round only and a swing-off resets it, so the result
  // table has to report the contest totals or it contradicts what was watched.
  const rows = [...state.entrants]
    .sort((a, b) => b.contestHomers - a.contestHomers || b.longest - a.longest)
    .map(
      (e) =>
        `<tr class="${e.playerId === state.winnerId ? 'me' : ''}">
          <td>${escapeHtml(nameOf(e.playerId))}</td>
          <td>${e.contestHomers}</td>
          <td>${e.longest ? Math.round(e.longest * 3.28084) + ' ft' : '—'}</td>
        </tr>`,
    )
    .join('');
  const note = state.tiebreak
    ? `<p class="screen-sub" style="margin-top:10px">Decided by a swing-off.</p>`
    : '';
  return `<table class="data-table"><tr><th>Hitter</th><th>Home runs</th><th>Longest</th></tr>${rows}</table>${note}`;
}

export { prettyKey };

// ---------------------------------------------------------------------------
// Player creator
// ---------------------------------------------------------------------------


/**
 * Creates or edits one original player. Ratings are bought from a fixed pool so
 * a creation is always a trade-off rather than a cheat, and the club, position
 * and body type all change how the player actually plays and looks.
 */
export class PlayerCreatorScreen extends Screen {
  constructor(
    app: AppApi,
    private draft: CustomPlayer,
    private editing: boolean,
    private onSave: (p: CustomPlayer) => void,
    private onDelete: () => void,
  ) {
    super(app);
    this.buildRows();
  }

  private isPitcher(): boolean {
    return this.draft.primary === 'P';
  }

  private buildRows(): void {
    const d = this.draft;
    const cycle = <T,>(list: readonly T[], get: () => T, set: (v: T) => void, dir: number) => () => {
      const i = list.indexOf(get());
      set(list[(i + dir + list.length) % list.length]);
      this.buildRows();
    };

    const rows: MenuRow[] = [
      {
        id: 'first',
        label: 'First name',
        value: () => d.firstName,
        hint: 'Press Enter to type, Enter again to finish.',
        onSelect: () => this.focusField('first'),
      },
      {
        id: 'last',
        label: 'Last name',
        value: () => d.lastName,
        hint: 'Press Enter to type, Enter again to finish.',
        onSelect: () => this.focusField('last'),
      },
      {
        id: 'number',
        label: 'Number',
        value: () => String(d.number),
        hint: 'Shirt number, 0 to 99.',
        onLeft: () => { d.number = (d.number + 99) % 100; },
        onRight: () => { d.number = (d.number + 1) % 100; },
      },
      {
        id: 'team',
        label: 'Club',
        value: () => {
          const t = TEAM_IDENTITIES.find((x) => x.id === d.teamId)!;
          return `${t.city} ${t.name}`.toUpperCase();
        },
        hint: 'Your player replaces the weakest player at this position on that club. Delete the creation to put the original back.',
        onLeft: cycle(TEAM_IDENTITIES.map((t) => t.id), () => d.teamId, (v) => { d.teamId = v; }, -1),
        onRight: cycle(TEAM_IDENTITIES.map((t) => t.id), () => d.teamId, (v) => { d.teamId = v; }, 1),
      },
      {
        id: 'pos',
        label: 'Position',
        value: () => d.primary,
        hint: 'Pitchers buy a different set of ratings and choose a repertoire.',
        onLeft: cycle(POSITIONS, () => d.primary, (v) => { d.primary = v; }, -1),
        onRight: cycle(POSITIONS, () => d.primary, (v) => { d.primary = v; }, 1),
      },
      {
        id: 'bats',
        label: 'Bats',
        value: () => (d.bats === 'S' ? 'SWITCH' : d.bats === 'L' ? 'LEFT' : 'RIGHT'),
        hint: 'Right-handers stand in the third-base box and pull to left field.',
        onLeft: cycle(['R', 'L', 'S'] as Handedness[], () => d.bats, (v) => { d.bats = v; }, -1),
        onRight: cycle(['R', 'L', 'S'] as Handedness[], () => d.bats, (v) => { d.bats = v; }, 1),
      },
      {
        id: 'throws',
        label: 'Throws',
        value: () => (d.throws === 'L' ? 'LEFT' : 'RIGHT'),
        hint: 'A pitcher’s arm side decides which way his pitches break.',
        onLeft: cycle(['R', 'L'] as Handedness[], () => d.throws, (v) => { d.throws = v; }, -1),
        onRight: cycle(['R', 'L'] as Handedness[], () => d.throws, (v) => { d.throws = v; }, 1),
      },
      {
        id: 'body',
        label: 'Build',
        value: () => d.body.toUpperCase(),
        hint: 'Build changes the model on the field and, for tall and huge builds, the size of the strike zone the umpire calls.',
        onLeft: cycle(BODY_TYPES, () => d.body, (v) => { d.body = v; }, -1),
        onRight: cycle(BODY_TYPES, () => d.body, (v) => { d.body = v; }, 1),
      },
      {
        id: 'skin',
        label: 'Appearance',
        value: () => `SWATCH ${Math.round(d.skinTone * 7) + 1} OF 8`,
        hint: 'Skin swatch for the low-poly model.',
        onLeft: () => { d.skinTone = (d.skinTone - 1 / 8 + 1) % 1; },
        onRight: () => { d.skinTone = (d.skinTone + 1 / 8) % 1; },
      },
      {
        id: 'points',
        label: 'Rating points left',
        value: () => `${pointsRemaining(d)} OF ${this.isPitcher() ? PITCHER_POINTS : HITTER_POINTS}`,
        hint: 'Every rating costs its own value. Spend them where this player should be good and accept being ordinary elsewhere.',
        disabled: () => true,
      },
    ];

    const ratingRow = (group: 'bat' | 'pitch', key: string, label: string, hint: string): MenuRow => ({
      id: `${group}.${key}`,
      label,
      value: () => {
        const src = group === 'bat' ? (d.bat as unknown as Record<string, number>) : (d.pitch as unknown as Record<string, number>);
        const v = src?.[key] ?? ATTR_MIN;
        const filled = Math.round(((v - ATTR_MIN) / (ATTR_MAX - ATTR_MIN)) * 12);
        return `${'█'.repeat(filled)}${'·'.repeat(12 - filled)} ${v}`;
      },
      hint,
      onLeft: () => { adjust(d, group, key, -1); },
      onRight: () => {
        if (!adjust(d, group, key, 1)) this.app.playSfx('menuDenied');
      },
    });

    if (this.isPitcher()) {
      rows.push(
        ratingRow('pitch', 'velocity', 'Velocity', 'Raw speed. Shortens the hitter’s reaction time.'),
        ratingRow('pitch', 'control', 'Control', 'How close the pitch lands to where you aimed.'),
        ratingRow('pitch', 'movement', 'Movement', 'Break size, and how much you can steer the ball in flight.'),
        ratingRow('pitch', 'stamina', 'Stamina', 'How many pitches before velocity and command fall away.'),
        ratingRow('pitch', 'composure', 'Composure', 'Holding up with runners on.'),
      );
      for (let i = 0; i < 4; i++) {
        rows.push({
          id: `pitch${i}`,
          label: `Pitch ${i + 1}`,
          value: () => PITCHES[(d.repertoire ?? [])[i] ?? 'fastball'].label,
          hint: 'The four pitches this arm can throw, in slot order.',
          onLeft: () => this.cyclePitch(i, -1),
          onRight: () => this.cyclePitch(i, 1),
        });
      }
    } else {
      rows.push(
        ratingRow('bat', 'contact', 'Contact', 'Sweet-spot size and timing window. The single biggest rating for a hitter.'),
        ratingRow('bat', 'power', 'Power', 'Exit velocity ceiling. Turns good contact into home runs.'),
        ratingRow('bat', 'speed', 'Speed', 'Running and fielding range.'),
        ratingRow('bat', 'arm', 'Arm', 'Throw velocity from the field.'),
        ratingRow('bat', 'fielding', 'Fielding', 'Glove reach and how rarely he misplays a ball.'),
        ratingRow('bat', 'reaction', 'Reaction', 'How quickly he breaks on a batted ball, and how well he reads a pitch.'),
        ratingRow('bat', 'discipline', 'Discipline', 'Judging the strike zone. Matters when the CPU controls him.'),
      );
    }

    rows.push({
      id: 'save',
      label: this.editing ? 'Save changes' : 'Create player',
      value: () => (isValid(d).ok ? '' : isValid(d).reason.toUpperCase()),
      hint: 'Saved locally. Your player appears on the chosen club everywhere in the game.',
      disabled: () => !isValid(d).ok,
      onSelect: () => this.onSave(d),
    });
    if (this.editing) {
      rows.push({
        id: 'delete',
        label: 'Delete this player',
        hint: 'Removes the creation and restores the club’s original player.',
        onSelect: () => this.onDelete(),
      });
    }
    rows.push({ id: 'back', label: 'Back', onSelect: () => this.app.back() });

    this.rows = rows;
    if (this.sel >= rows.length) this.sel = rows.length - 1;
  }

  private cyclePitch(slot: number, dir: number): void {
    const rep = [...(this.draft.repertoire ?? ['fastball'])];
    while (rep.length < 4) rep.push('fastball');
    const cur = ALL_PITCH_TYPES.indexOf(rep[slot]);
    let next = (cur + dir + ALL_PITCH_TYPES.length) % ALL_PITCH_TYPES.length;
    // Never let the same pitch occupy two slots.
    let guard = 0;
    while (rep.some((p, i) => i !== slot && p === ALL_PITCH_TYPES[next]) && guard++ < 12) {
      next = (next + dir + ALL_PITCH_TYPES.length) % ALL_PITCH_TYPES.length;
    }
    rep[slot] = ALL_PITCH_TYPES[next] as PitchType;
    this.draft.repertoire = rep;
  }

  private focusField(which: 'first' | 'last'): void {
    const el = this.root.querySelector<HTMLInputElement>(`input[data-f="${which}"]`);
    if (!el) return;
    el.focus();
    el.select();
  }

  override render(): void {
    const d = this.draft;
    const pane = `<div class="menu-hint js-hint">
      <h4>${escapeHtml(`${d.firstName} ${d.lastName}`)} <span style="color:var(--gold)">#${d.number}</span></h4>
      <p>${escapeHtml(d.primary)} · bats ${d.bats} · throws ${d.throws} · ${escapeHtml(d.body)} build</p>
      <p><span class="js-hint-body"></span></p>
      <p style="margin-top:14px;color:var(--gold)">Points left: ${pointsRemaining(d)}</p>
    </div>`;

    this.root.innerHTML = this.frame(
      this.editing ? 'EDIT PLAYER' : 'CREATE A PLAYER',
      'Your creation joins the club you choose',
      this.menuHtml() + pane,
      this.footHtml(),
    );

    // Swap the two name rows for real text inputs so typing works normally.
    for (const which of ['first', 'last'] as const) {
      const row = this.root.querySelector(`.menu-item[data-i="${which === 'first' ? 0 : 1}"] .value`);
      if (!row) continue;
      row.innerHTML = `<input data-f="${which}" maxlength="${which === 'first' ? 14 : 18}" value="${escapeHtml(
        which === 'first' ? d.firstName : d.lastName,
      )}" style="background:rgba(0,0,0,.45);border:2px solid var(--line);color:var(--gold);font-family:var(--font);font-weight:700;letter-spacing:.06em;font-size:1em;padding:2px 8px;width:11ch;text-transform:uppercase" />`;
      const el = row.querySelector('input') as HTMLInputElement;
      el.addEventListener('input', () => {
        if (which === 'first') d.firstName = el.value;
        else d.lastName = el.value;
      });
      el.addEventListener('blur', () => {
        this.buildRows();
        this.refreshSelection();
      });
    }
    this.wireMouse();
    this.refreshSelection();
  }

  override handle(action: MenuAction): void {
    super.handle(action);
    // Rating rows change the points pool, so the pool row has to refresh too.
    this.refreshSelection();
  }
}

