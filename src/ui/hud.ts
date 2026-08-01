import { PITCHES } from '../data/pitches';
import { controllerFor, humanIsBatting, humanIsPitching } from '../sim/game';
import type { GameState } from '../sim/state';
import { battingSide, currentBatter, fieldingSide, lookupPlayer, teamOf } from '../sim/state';
import { cssColor } from '../render/palette';
import type { GameWorld } from '../render/world';
import type { InputManager } from './input';
import { PlateView } from './plateview';

/**
 * In-game HUD.
 *
 * Two rules drive everything here:
 *   1. Never signal something with colour alone — every state also has a word,
 *      a shape or a count.
 *   2. The four action buttons always have a visible legend, so a player never
 *      has to remember what the diamond means in the situation they are in.
 */

const MPH = 1 / 0.44704;

export class Hud {
  readonly root: HTMLDivElement;
  private scoreBox!: HTMLDivElement;
  private matchupBox!: HTMLDivElement;
  private bannerBox!: HTMLDivElement;
  private promptBox!: HTMLDivElement;
  private pitchBox!: HTMLDivElement;
  private readoutBox!: HTMLDivElement;
  private feedbackBox!: HTMLDivElement;
  private lineBox!: HTMLDivElement;
  private legendBox!: HTMLDivElement;
  private plate = new PlateView();
  private feedbackT = 0;
  private feedbackText = '';
  private lastPitchLabel = '';
  private lastPitchSpeed = 0;
  private lastContact = '';
  private showLineScore = true;

  constructor(private input: InputManager) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.build();
  }

  setLineScoreVisible(v: boolean): void {
    this.showLineScore = v;
    this.lineBox.style.display = v ? '' : 'none';
  }

  /** Turns the whole strike-zone overlay off for players who want a clean view. */
  setPlateViewEnabled(v: boolean): void {
    this.plate.setEnabled(v);
    this.legendBox.dataset.off = v ? '' : '1';
  }

  private build(): void {
    this.root.innerHTML = `
      <div class="hud-score">
        <div class="hud-teams">
          <div class="hud-team" data-t="away"><span class="swatch"></span><span class="abbr">AWY</span><span class="runs">0</span></div>
          <div class="hud-team" data-t="home"><span class="swatch"></span><span class="abbr">HOM</span><span class="runs">0</span></div>
        </div>
        <div class="hud-state">
          <div class="hud-inning">TOP 1ST</div>
          <div class="hud-count">COUNT <b>0-0</b></div>
          <div class="hud-outs">OUTS <i></i><i></i><i></i></div>
        </div>
        <div class="hud-diamond">
          <svg viewBox="0 0 52 52" aria-label="Runners on base">
            <polygon class="b2" points="26,6 36,16 26,26 16,16"></polygon>
            <polygon class="b3" points="10,22 20,32 10,42 0,32"></polygon>
            <polygon class="b1" points="42,22 52,32 42,42 32,32"></polygon>
          </svg>
        </div>
      </div>
      <div class="hud-linescore"></div>
      <div class="hud-matchup">
        <div class="who">PITCHING</div>
        <div class="name">—</div>
        <div class="line">—</div>
        <div class="line arm">—</div>
        <div class="stamina"><i style="width:100%"></i></div>
      </div>
      <div class="hud-banner"><div class="big"></div><div class="sub"></div></div>
      <div class="hud-pitches"></div>
      <div class="hud-readout"><div class="k">LAST PITCH</div><div class="v">—</div><div class="note"></div></div>
      <div class="hud-legend">
        <b>PITCH TRACKER</b>
        <span class="lg" data-r="ball">BALL</span>
        <span class="lg" data-r="called">STRIKE</span>
        <span class="lg" data-r="swinging">WHIFF</span>
        <span class="lg" data-r="foul">FOUL</span>
        <span class="lg" data-r="inplay">IN PLAY</span>
      </div>
      <div class="hud-feedback"></div>
      <div class="hud-prompts"></div>
    `;
    this.scoreBox = this.root.querySelector('.hud-score') as HTMLDivElement;
    this.matchupBox = this.root.querySelector('.hud-matchup') as HTMLDivElement;
    this.bannerBox = this.root.querySelector('.hud-banner') as HTMLDivElement;
    this.promptBox = this.root.querySelector('.hud-prompts') as HTMLDivElement;
    this.pitchBox = this.root.querySelector('.hud-pitches') as HTMLDivElement;
    this.readoutBox = this.root.querySelector('.hud-readout') as HTMLDivElement;
    this.feedbackBox = this.root.querySelector('.hud-feedback') as HTMLDivElement;
    this.lineBox = this.root.querySelector('.hud-linescore') as HTMLDivElement;
    this.legendBox = this.root.querySelector('.hud-legend') as HTMLDivElement;

    // The plate view sits underneath the panels so a tracker dot can never
    // cover the count or the prompts.
    this.root.insertBefore(this.plate.root, this.root.firstChild);
  }

  flashFeedback(text: string, color = '#ffd15c'): void {
    this.feedbackText = text;
    this.feedbackT = 1.1;
    this.feedbackBox.style.color = color;
  }

  noteContact(text: string): void {
    this.lastContact = text;
  }

  /** Clears the carried-over last-pitch readout at the start of a new game. */
  resetReadout(): void {
    this.lastContact = '';
    this.lastPitchLabel = '';
    this.lastPitchSpeed = 0;
    this.feedbackT = 0;
    this.feedbackText = '';
  }

  // -------------------------------------------------------------------------

  update(dt: number, state: GameState, world: GameWorld): void {
    // Practice is explicitly not scored, so the scoreboard must not claim to be
    // keeping score. The count, the outs and the bases still matter, so they stay.
    const practice = !!state.setup.practice;
    this.root.classList.toggle('practice', practice);
    this.lineBox.style.display = practice || !this.showLineScore ? 'none' : '';
    this.updateScore(state);
    this.updateMatchup(state);
    this.updateBanner(state);
    this.updatePrompts(state);
    this.updatePitchChips(state);
    this.updateReadout(state);
    this.plate.update(state, world, this.promptBox.offsetTop);
    this.legendBox.classList.toggle(
      'on',
      !this.legendBox.dataset.off &&
        (humanIsBatting(state) || humanIsPitching(state)) &&
        state.phase !== 'inplay' &&
        state.pitchLog.length > 0,
    );

    if (this.feedbackT > 0) {
      this.feedbackT -= dt;
      this.feedbackBox.textContent = this.feedbackText;
      this.feedbackBox.style.opacity = String(Math.min(1, this.feedbackT * 2.2));
      this.feedbackBox.style.transform = `translate(-50%, ${-50 - (1.1 - this.feedbackT) * 26}%)`;
    } else {
      this.feedbackBox.textContent = '';
    }
  }

  private updateScore(state: GameState): void {
    const away = state.away;
    const home = state.home;
    const bs = battingSide(state);
    const rows = this.scoreBox.querySelectorAll<HTMLDivElement>('.hud-team');
    const data = [
      { t: away, runs: state.stats.away.runs, side: 'away' as const },
      { t: home, runs: state.stats.home.runs, side: 'home' as const },
    ];
    const practice = state.setup.practice;
    rows.forEach((row, i) => {
      const d = data[i];
      (row.querySelector('.swatch') as HTMLElement).style.background = cssColor(d.t.primary);
      (row.querySelector('.abbr') as HTMLElement).textContent = d.t.abbr;
      (row.querySelector('.runs') as HTMLElement).textContent = practice ? '–' : String(d.runs);
      row.classList.toggle('batting', bs === d.side);
    });

    (this.scoreBox.querySelector('.hud-inning') as HTMLElement).textContent = practice
      ? `${practice.toUpperCase()} DRILL`
      : `${state.half === 'top' ? 'TOP' : 'BOT'} ${ordinal(state.inning)}`;
    (this.scoreBox.querySelector('.hud-count b') as HTMLElement).textContent =
      `${state.balls}-${state.strikes}`;
    const outs = this.scoreBox.querySelectorAll<HTMLElement>('.hud-outs i');
    outs.forEach((o, i) => o.classList.toggle('on', i < state.outs));

    const occ = [false, false, false];
    for (const r of state.runners) {
      if (r.out || r.scored || r.isBatter) continue;
      const b = Math.floor(r.base + Math.min(0.999, r.progress));
      if (b >= 1 && b <= 3) occ[b - 1] = true;
    }
    const svg = this.scoreBox.querySelector('.hud-diamond svg') as SVGSVGElement;
    const set = (cls: string, on: boolean) => {
      const el = svg.querySelector(`.${cls}`) as SVGPolygonElement;
      el.setAttribute('fill', on ? '#ffd15c' : 'rgba(255,255,255,0.10)');
      el.setAttribute('stroke', on ? '#ffffff' : 'rgba(255,255,255,0.45)');
      el.setAttribute('stroke-width', '2');
    };
    set('b1', occ[0]);
    set('b2', occ[1]);
    set('b3', occ[2]);

    if (this.showLineScore && !state.setup.practice) this.updateLineScore(state);
  }

  private updateLineScore(state: GameState): void {
    const n = Math.max(state.setup.innings, state.lineScore.away.length, state.lineScore.home.length);
    const head: string[] = ['<th></th>'];
    for (let i = 0; i < n; i++) head.push(`<th>${i + 1}</th>`);
    head.push('<th class="tot">R</th><th class="tot">H</th><th class="tot">E</th>');
    const row = (side: 'away' | 'home', abbr: string) => {
      const cells: string[] = [`<td style="text-align:left">${abbr}</td>`];
      for (let i = 0; i < n; i++) {
        const played =
          side === 'away'
            ? i < state.lineScore.away.length
            : i < state.lineScore.home.length;
        const v = state.lineScore[side][i];
        cells.push(`<td>${played && v !== undefined ? v : '-'}</td>`);
      }
      const s = state.stats[side];
      cells.push(`<td class="tot">${s.runs}</td><td class="tot">${s.hits}</td><td class="tot">${s.errors}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    };
    this.lineBox.innerHTML = `<table><tr>${head.join('')}</tr>${row('away', state.away.abbr)}${row('home', state.home.abbr)}</table>`;
  }

  private updateMatchup(state: GameState): void {
    const pitcher = lookupPlayer(state, state.pitcher.playerId);
    const batter = currentBatter(state);
    const showPitcher = state.phase !== 'inplay';
    const who = this.matchupBox.querySelector('.who') as HTMLElement;
    const name = this.matchupBox.querySelector('.name') as HTMLElement;
    const line = this.matchupBox.querySelector('.line') as HTMLElement;
    const bar = this.matchupBox.querySelector('.stamina i') as HTMLElement;
    const arm = this.matchupBox.querySelector('.arm') as HTMLElement;

    // Whoever is holding a controller needs to know, at a glance and without
    // counting keys, which half of the duel is theirs. In a two-player game
    // that swaps every half-inning, so it cannot be left implicit.
    const you = humanIsBatting(state)
      ? 'YOU BAT · '
      : humanIsPitching(state)
        ? 'YOU PITCH · '
        : '';

    if (state.setup.practice) {
      who.textContent = 'PRACTICE — NOT SCORED';
      name.textContent = `${batter.firstName} ${batter.lastName}`;
      line.textContent = PRACTICE_HINTS[state.setup.practice];
    } else if (showPitcher) {
      who.textContent = `${you}AT BAT — #${batter.number} ${batter.primary}`;
      name.textContent = `${batter.firstName} ${batter.lastName}`;
      const l = state.stats[battingSide(state)].batting[batter.id];
      const today = l ? `${l.h}-${l.ab} TODAY` : '0-0 TODAY';
      line.textContent = `${today} · CON ${batter.bat.contact} · POW ${batter.bat.power} · SPD ${batter.bat.speed}`;
    } else {
      who.textContent = 'FIELDING';
      name.textContent = teamOf(state, fieldingSide(state)).name.toUpperCase();
      line.textContent = state.play.description || 'BALL IN PLAY';
    }
    const st = state.pitcher.stamina;
    const label = st > 0.55 ? 'STRONG' : st > 0.28 ? 'TIRING' : 'GASSED';
    arm.textContent = `P: ${pitcher.lastName.toUpperCase()} · ${state.pitcher.pitchCount} PITCHES · ${label}`;
    bar.style.width = `${Math.round(st * 100)}%`;
    bar.style.background = st > 0.55 ? '#7ee081' : st > 0.28 ? '#ffd15c' : '#ff5f6d';
    this.matchupBox.title = `${pitcher.firstName} ${pitcher.lastName}`;
  }

  private updateBanner(state: GameState): void {
    const b = state.banner;
    const big = this.bannerBox.querySelector('.big') as HTMLElement;
    const sub = this.bannerBox.querySelector('.sub') as HTMLElement;
    if (b.t <= 0) {
      this.bannerBox.style.opacity = '0';
      return;
    }
    this.bannerBox.style.opacity = String(Math.min(1, b.t * 2.5));
    this.bannerBox.className = `hud-banner ${b.kind}`;
    big.textContent = b.text;
    sub.textContent = b.sub;
  }

  private updatePrompts(state: GameState): void {
    const prompts: [string, string][] = [];
    const k = (a: Parameters<InputManager['describe']>[1]) => this.input.describe('p1', a);

    const batting = humanIsBatting(state);
    const pitching = humanIsPitching(state);
    const batterRunning = state.runners.some((r) => r.isBatter && !r.out && !r.scored);

    if (state.phase === 'inplay' && batting) {
      prompts.push(
        [k('diamondUp'), 'SEND TO 2ND'],
        [k('diamondLeft'), 'SEND TO 3RD'],
        [k('diamondDown'), 'SEND HOME'],
        [k('diamondRight'), 'SEND TO 1ST'],
        [k('special'), 'ADVANCE ALL'],
        [`${k('modifier')}+`, 'GO BACK'],
      );
    } else if (state.phase === 'inplay' && pitching) {
      prompts.push(
        [
          `${k('up')}${k('left')}${k('down')}${k('right')}`,
          // Auto-fielding is silent otherwise, and a fielder running on its own
          // while you hold the controls is exactly the kind of thing a player
          // should never have to guess about.
          state.autoFielding ? 'AUTO — MOVE TO TAKE OVER' : 'MOVE FIELDER',
        ],
        [k('diamondRight'), 'THROW 1ST'],
        [k('diamondUp'), 'THROW 2ND'],
        [k('diamondLeft'), 'THROW 3RD'],
        [k('diamondDown'), 'THROW HOME'],
        [k('special'), 'DIVE'],
        [k('switchFielder'), 'SWITCH'],
      );
    } else if (batting) {
      prompts.push(
        [`${k('up')}${k('left')}${k('down')}${k('right')}`, 'MOVE AIM'],
        [k('diamondDown'), 'CONTACT SWING'],
        [k('diamondRight'), 'POWER SWING'],
        [k('diamondLeft'), 'BUNT'],
        [k('diamondUp'), 'TAKE / CHECK'],
      );
      if (state.runners.length) prompts.push([`${k('modifier')}+DIR`, 'STEAL']);
    } else if (pitching) {
      prompts.push(
        [`${k('up')}${k('left')}${k('down')}${k('right')}`, 'AIM / STEER'],
        [k('diamondLeft'), 'PITCH 1'],
        [k('diamondDown'), 'PITCH 2'],
        [k('diamondRight'), 'PITCH 3'],
        [k('diamondUp'), 'PITCH 4'],
      );
    }
    void batterRunning;
    prompts.push(['ESC', 'PAUSE']);

    this.promptBox.innerHTML = prompts
      .map(([key, label]) => `<span class="prompt"><kbd>${escapeHtml(key)}</kbd>${label}</span>`)
      .join('');
  }

  private updatePitchChips(state: GameState): void {
    if (!humanIsPitching(state) || state.phase === 'inplay') {
      this.pitchBox.style.display = 'none';
      return;
    }
    this.pitchBox.style.display = '';
    const pitcher = lookupPlayer(state, state.pitcher.playerId);
    const rep = pitcher.repertoire ?? ['fastball'];
    const keys = [
      this.input.describe('p1', 'diamondLeft'),
      this.input.describe('p1', 'diamondDown'),
      this.input.describe('p1', 'diamondRight'),
      this.input.describe('p1', 'diamondUp'),
    ];
    const velo = (pitcher.pitch?.velocity ?? 55 - 20) / 79;
    this.pitchBox.innerHTML = rep
      .map((t, i) => {
        const p = PITCHES[t];
        const speed = (p.speed + Math.max(0, velo) * p.speedSpan) * (1 - (1 - state.pitcher.stamina) * 0.075);
        const used = state.pitcher.usage[t] ?? 0;
        const share = state.pitcher.pitchCount ? Math.round((used / state.pitcher.pitchCount) * 100) : 0;
        const overused = share > 45;
        return `<div class="pitch-chip">
          <span class="key">${escapeHtml(keys[i] ?? '?')}</span>
          <span class="dot" style="background:${cssColor(p.color)}"></span>
          <span class="nm">${p.label}</span>
          <span class="mph">${Math.round(speed * MPH)}${overused ? ' · OVERUSED' : ''}</span>
        </div>`;
      })
      .join('');
  }

  private updateReadout(state: GameState): void {
    const cp = state.currentPitch;
    if (cp && (state.phase === 'pitch' || state.phase === 'windup')) {
      this.lastPitchLabel = PITCHES[cp.type].label;
      this.lastPitchSpeed = cp.speedMs;
    }
    const k = this.readoutBox.querySelector('.k') as HTMLElement;
    const v = this.readoutBox.querySelector('.v') as HTMLElement;
    const note = this.readoutBox.querySelector('.note') as HTMLElement;

    if (state.phase === 'inplay' && state.play.exitVelo > 0) {
      k.textContent = 'OFF THE BAT';
      v.textContent = `${Math.round(state.play.exitVelo * MPH)} MPH`;
      note.textContent = `${Math.round(state.play.launchAngle)}° · ${state.play.description}`;
    } else {
      k.textContent = 'LAST PITCH';
      // Speed and pitch name together: the two facts a hitter needs to build a
      // read, and the pair the tracker dot cannot show on its own.
      v.textContent = this.lastPitchSpeed
        ? `${Math.round(this.lastPitchSpeed * MPH)} ${this.lastPitchLabel.toUpperCase()}`
        : '—';
      const s = state.lastSwing;
      note.textContent =
        s && s.t > 0 ? `${s.timingLabel} · ${s.planeLabel}` : this.lastContact || '';
    }
  }

  /** Shows which controller is driving which club during local multiplayer. */
  describeControl(state: GameState): string {
    const a = controllerFor(state, 'away');
    const h = controllerFor(state, 'home');
    const tag = (c: 'p1' | 'p2' | null) => (c === 'p1' ? 'P1' : c === 'p2' ? 'P2' : 'CPU');
    return `${state.away.abbr} ${tag(a)} · ${state.home.abbr} ${tag(h)}`;
  }
}

const PRACTICE_HINTS: Record<string, string> = {
  batting: 'Move the cursor, time the swing. Three outs resets the inning.',
  pitching: 'Aim, choose a pitch, steer it. Nothing is scored.',
  fielding: 'Switch fielders, dive, throw to the right base.',
  baserunning: 'Runners start on. Send them, hold them, bring them home.',
};

function ordinal(n: number): string {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
