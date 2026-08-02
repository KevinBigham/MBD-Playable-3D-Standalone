import { CONTACT_Z, PITCH_TELL_REVEAL } from '../core/constants';
import { PITCHES, pitchBreak } from '../data/pitches';
import { pitchPositionAt } from '../sim/physics';
import { swingProfile, zoneBounds } from '../sim/contact';
import { humanIsBatting, humanIsPitching } from '../sim/game';
import type { GameState, PitchLogEntry } from '../sim/state';
import { currentBatter, lookupPlayer } from '../sim/state';
import { attr01 } from '../core/constants';
import { cssColor } from '../render/palette';
import type { GameWorld } from '../render/world';

/**
 * PLATE VIEW
 * ----------
 * Everything the hitter and the pitcher need to read the duel, drawn in screen
 * space on top of the 3D scene but positioned by projecting real world points,
 * so it is welded to the ball park rather than floating over it.
 *
 * The design rule is that a player should never have to guess *why* something
 * happened. Concretely that means four layers:
 *
 *   1. THE ZONE      a big, static, gridded rectangle at the contact plane.
 *                    Thirds are marked because "up and in" is a place, not a
 *                    vibe, and the grid is what makes it one.
 *   2. THE TRACKER   a dot for every pitch of the at-bat, numbered, coloured by
 *                    what it did. After three pitches you can see the pattern
 *                    the pitcher is working, which is the whole game.
 *   3. THE INTENT    the hitter's contact cursor and the pitcher's target, both
 *                    drawn at their true size, plus a preview of the shape the
 *                    selected pitch will take.
 *   4. THE VERDICT   after every swing, where the bat actually was: a timing
 *                    needle and two words. EARLY / LATE, UNDER / OVER.
 *
 * Nothing here is authoritative. The plate view only ever reads state; if it
 * were deleted the game would play identically, just blind.
 */

const RESULT_STYLE: Record<
  PitchLogEntry['result'],
  { fill: string; stroke: string; text: string }
> = {
  ball: { fill: 'rgba(18,26,40,0.55)', stroke: '#8fd8ff', text: '#cdeeff' },
  called: { fill: '#ff4d5e', stroke: '#ffd7dc', text: '#2a0006' },
  swinging: { fill: '#ff8a3d', stroke: '#ffe3c8', text: '#2a1200' },
  foul: { fill: '#ffd15c', stroke: '#fff4d2', text: '#2a2000' },
  inplay: { fill: '#7ee081', stroke: '#e2ffe3', text: '#012a06' },
  hitbypitch: { fill: '#ff7ad4', stroke: '#ffe0f5', text: '#2a0020' },
};

const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
}

interface Pt {
  x: number;
  y: number;
}

/** How many tracker dots are drawn before the oldest start being dropped. */
const MAX_DOTS = 14;

export class PlateView {
  readonly root: HTMLDivElement;
  private svg: SVGSVGElement;

  private zoneShadow: SVGPolygonElement;
  private zoneFill: SVGPolygonElement;
  private zoneEdge: SVGPolygonElement;
  private grid: SVGPathElement;
  private brackets: SVGPathElement;
  /** One preview arc per pitch in the current pitcher's repertoire. */
  private breakArcs: SVGPathElement[] = [];
  private flightCase: SVGPathElement;
  private flight: SVGPathElement;
  private dots: { g: SVGGElement; c: SVGCircleElement; t: SVGTextElement }[] = [];
  private tracker: SVGGElement;
  private trackerRing: SVGCircleElement;
  private trackerDot: SVGCircleElement;
  private aim: SVGGElement;
  private aimBox: SVGPathElement;
  private aimDot: SVGCircleElement;
  private cursor: SVGEllipseElement;
  private cursorCross: SVGPathElement;
  /** The gap between where the bat was and where the ball was, after a swing. */
  private miss: SVGGElement;
  private missLine: SVGLineElement;
  private missBat: SVGCircleElement;
  private missBall: SVGCircleElement;

  private verdict: HTMLDivElement;
  private coachEl: HTMLDivElement;
  private coachText: string | null = null;
  private enabled = true;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'plate-view';

    this.svg = el('svg', { class: 'plate-svg', preserveAspectRatio: 'none' });
    this.root.appendChild(this.svg);

    this.zoneShadow = el('polygon', { class: 'pv-zone-shadow' });
    this.zoneFill = el('polygon', { class: 'pv-zone-fill' });
    this.zoneEdge = el('polygon', { class: 'pv-zone-edge' });
    this.grid = el('path', { class: 'pv-grid' });
    this.brackets = el('path', { class: 'pv-brackets' });
    for (let i = 0; i < 4; i++) this.breakArcs.push(el('path', { class: 'pv-break' }));
    this.flightCase = el('path', { class: 'pv-flight-case' });
    this.flight = el('path', { class: 'pv-flight' });

    this.tracker = el('g', { class: 'pv-tracker' });
    this.trackerRing = el('circle', { class: 'pv-tracker-ring' });
    this.trackerDot = el('circle', { class: 'pv-tracker-dot' });
    this.tracker.appendChild(this.trackerRing);
    this.tracker.appendChild(this.trackerDot);

    this.aim = el('g', { class: 'pv-aim' });
    this.aimBox = el('path', { class: 'pv-aim-box' });
    this.aimDot = el('circle', { class: 'pv-aim-dot' });
    this.aim.appendChild(this.aimBox);
    this.aim.appendChild(this.aimDot);

    this.cursor = el('ellipse', { class: 'pv-cursor' });
    this.cursorCross = el('path', { class: 'pv-cursor-cross' });

    this.miss = el('g', { class: 'pv-miss' });
    this.missLine = el('line', { class: 'pv-miss-line' });
    this.missBat = el('circle', { class: 'pv-miss-bat' });
    this.missBall = el('circle', { class: 'pv-miss-ball' });
    this.miss.appendChild(this.missLine);
    this.miss.appendChild(this.missBat);
    this.miss.appendChild(this.missBall);

    for (const node of [
      this.zoneShadow,
      this.zoneFill,
      this.grid,
      this.zoneEdge,
      this.brackets,
      ...this.breakArcs,
      this.flightCase,
      this.flight,
    ]) {
      this.svg.appendChild(node);
    }

    for (let i = 0; i < MAX_DOTS; i++) {
      const g = el('g', { class: 'pv-dot' });
      const c = el('circle', { r: '9' });
      const t = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      g.appendChild(c);
      g.appendChild(t);
      this.svg.appendChild(g);
      this.dots.push({ g, c, t });
    }

    this.svg.appendChild(this.tracker);
    this.svg.appendChild(this.aim);
    this.svg.appendChild(this.cursor);
    this.svg.appendChild(this.cursorCross);
    // Last, so the answer to the swing that just happened sits over everything
    // that led up to it.
    this.svg.appendChild(this.miss);

    this.verdict = document.createElement('div');
    this.verdict.className = 'pv-verdict';
    this.verdict.innerHTML = `
      <div class="pv-word"></div>
      <div class="pv-sub"></div>
      <div class="pv-timing">
        <div class="pv-track">
          <span class="pv-band pv-band-late"></span>
          <span class="pv-band pv-band-good"></span>
          <i class="pv-needle"></i>
        </div>
        <div class="pv-ends"><span>EARLY</span><span>ON TIME</span><span>LATE</span></div>
      </div>`;
    this.root.appendChild(this.verdict);

    this.coachEl = document.createElement('div');
    this.coachEl.className = 'pv-coach';
    this.root.appendChild(this.coachEl);
  }

  /**
   * What to say on the zone, or null for nothing. Set by the app, which owns
   * the question of whether this player still needs telling; the plate view
   * only owns the question of where the zone is. See Coach.
   */
  setCoach(text: string | null): void {
    this.coachText = text;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) this.root.style.display = 'none';
  }

  /**
   * `safeBottom` is the y (in root-local pixels) below which the HUD's own
   * furniture starts. The verdict panel hangs off the bottom of the zone, and
   * on a small laptop screen the prompt bar wraps to two lines and comes up to
   * meet it, so the panel needs to know where to stop.
   */
  update(state: GameState, world: GameWorld, safeBottom: number): void {
    const batting = humanIsBatting(state);
    const pitching = humanIsPitching(state);
    const live =
      state.phase === 'preplay' || state.phase === 'windup' || state.phase === 'pitch';
    // Spectating (CPU vs CPU, attract mode) still gets the zone and the pitch
    // tracker — it is what makes the duel camera readable — but at half weight
    // so it never competes with a game somebody is actually playing.
    const show = this.enabled && live;
    this.root.style.display = show ? '' : 'none';
    if (!show) return;
    this.root.classList.toggle('spectating', !batting && !pitching);

    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    if (w < 2 || h < 2) return;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    const batter = currentBatter(state);
    const z = zoneBounds(batter);
    // Two projectors: one pinned to the contact plane, for everything that
    // lives on the zone, and one free in space, for the ball's flight.
    const p3 = (x: number, y: number, z: number): Pt => {
      const v = world.project(x, y, z);
      return { x: v.x * w, y: v.y * h };
    };
    const p = (x: number, y: number): Pt => p3(x, y, CONTACT_Z);

    // Everything sized in pixels is expressed as a fraction of the drawn zone,
    // so the overlay stays proportionate at any resolution or field of view.
    const zoneH = Math.abs(p(0, z.top).y - p(0, z.bottom).y);

    this.drawZone(p, z);
    this.drawTracker(state, p, zoneH);
    this.drawLiveMarkers(state, p, p3, batting, pitching, zoneH);
    this.drawIntent(state, p, batting, pitching, batter, zoneH);
    this.drawMiss(state, p, batting, zoneH);
    this.drawVerdict(state, p, z, batting, safeBottom);
    this.drawCoach(state, p, z, safeBottom);
  }

  // -------------------------------------------------------------- the zone

  private drawZone(p: (x: number, y: number) => Pt, z: ReturnType<typeof zoneBounds>): void {
    const tl = p(-z.halfWidth, z.top);
    const tr = p(z.halfWidth, z.top);
    const br = p(z.halfWidth, z.bottom);
    const bl = p(-z.halfWidth, z.bottom);
    const pts = [tl, tr, br, bl].map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    this.zoneShadow.setAttribute('points', pts);
    this.zoneFill.setAttribute('points', pts);
    this.zoneEdge.setAttribute('points', pts);

    // Thirds, projected rather than interpolated so the grid stays welded to
    // the plate no matter what the camera is doing.
    const seg: string[] = [];
    for (const f of [1 / 3, 2 / 3]) {
      const x = -z.halfWidth + z.halfWidth * 2 * f;
      const a = p(x, z.top);
      const b = p(x, z.bottom);
      seg.push(`M${a.x.toFixed(1)},${a.y.toFixed(1)}L${b.x.toFixed(1)},${b.y.toFixed(1)}`);
      const y = z.bottom + (z.top - z.bottom) * f;
      const c = p(-z.halfWidth, y);
      const d = p(z.halfWidth, y);
      seg.push(`M${c.x.toFixed(1)},${c.y.toFixed(1)}L${d.x.toFixed(1)},${d.y.toFixed(1)}`);
    }
    this.grid.setAttribute('d', seg.join(''));

    // Corner brackets: the zone has to survive being drawn over grass, dirt,
    // a crowd or a night sky, so the corners are marked by shape and not by
    // relying on the stroke colour reading against whatever is behind it.
    const armX = Math.abs(tr.x - tl.x) * 0.28;
    const armY = Math.abs(bl.y - tl.y) * 0.24;
    const bracket = (c: Pt, sx: number, sy: number) =>
      `M${(c.x + sx * armX).toFixed(1)},${c.y.toFixed(1)}` +
      `L${c.x.toFixed(1)},${c.y.toFixed(1)}` +
      `L${c.x.toFixed(1)},${(c.y + sy * armY).toFixed(1)}`;
    this.brackets.setAttribute(
      'd',
      bracket(tl, 1, 1) + bracket(tr, -1, 1) + bracket(br, -1, -1) + bracket(bl, 1, -1),
    );
  }

  // ----------------------------------------------------------- the tracker

  private drawTracker(state: GameState, p: (x: number, y: number) => Pt, zoneH: number): void {
    const log = state.pitchLog;
    const start = Math.max(0, log.length - MAX_DOTS);
    const r = Math.max(6, Math.min(15, zoneH * 0.085));
    for (let i = 0; i < this.dots.length; i++) {
      const entry = log[start + i];
      const d = this.dots[i];
      if (!entry) {
        d.g.style.display = 'none';
        continue;
      }
      d.g.style.display = '';
      const pt = p(entry.x, entry.y);
      const style = RESULT_STYLE[entry.result];
      d.c.setAttribute('r', r.toFixed(1));
      d.t.setAttribute('font-size', (r * 1.22).toFixed(1));
      d.c.setAttribute('cx', pt.x.toFixed(1));
      d.c.setAttribute('cy', pt.y.toFixed(1));
      d.c.setAttribute('fill', style.fill);
      d.c.setAttribute('stroke', style.stroke);
      d.t.setAttribute('x', pt.x.toFixed(1));
      d.t.setAttribute('y', pt.y.toFixed(1));
      d.t.setAttribute('fill', style.text);
      d.t.textContent = String(start + i + 1);
      // Older pitches recede so the most recent one is obvious at a glance.
      const age = log.length - 1 - (start + i);
      d.g.setAttribute('opacity', String(Math.max(0.34, 1 - age * 0.16)));
    }
  }

  /** The live pitch marker and the pitcher's spot feedback. */
  private drawLiveMarkers(
    state: GameState,
    p: (x: number, y: number) => Pt,
    p3: (x: number, y: number, z: number) => Pt,
    batting: boolean,
    pitching: boolean,
    zoneH: number,
  ): void {
    const info = state.currentPitch;
    const inFlight = state.phase === 'pitch' && !!info;
    let visible = false;

    // --- The pitch's own path, drawn as it happens --------------------------
    // A regulation ball closing at 40 m/s through a long lens crosses most of
    // the screen in under half a second. The 3-D trail behind it is a one-pixel
    // line, which is nothing. Tracing the flight here — sampled straight out of
    // the same closed-form the engine flies the ball along — is what makes a
    // breaking ball legible as a shape instead of a blur.
    const flight = state.ball.pitch;
    if (inFlight && info && flight) {
      const tell =
        state.ball.t / Math.max(0.001, info.T) >=
        (pitching && !batting ? 0 : PITCH_TELL_REVEAL[state.difficulty]);
      const colour = tell ? cssColor(PITCHES[info.type].color) : '#ffffff';
      // Before the read is earned it is a short comet tail — enough to track the
      // ball, not enough to hand over the shape of the break. Once earned, the
      // whole arc from the hand is drawn and the movement is plain to see. Same
      // gate as the colour tell and the crossing marker, so the three assists
      // arrive together rather than leaking information at three times.
      // The engine keeps flying the ball for a beat past the plate so a late
      // swing can still catch it; the drawn path stops at the crossing, where
      // the marker is, so the two never disagree.
      const to = Math.min(state.ball.t, info.T);
      const from = tell ? 0 : Math.max(0, to - 0.13);
      const steps = 14;
      const d: string[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = from + ((to - from) * i) / steps;
        const b = pitchPositionAt(flight, t);
        const q = p3(b.x, b.y, b.z);
        d.push(`${i === 0 ? 'M' : 'L'}${q.x.toFixed(1)},${q.y.toFixed(1)}`);
      }
      const path = d.join('');
      this.flightCase.style.display = '';
      this.flight.style.display = '';
      this.flightCase.setAttribute('d', path);
      this.flight.setAttribute('d', path);
      this.flight.setAttribute('stroke', colour);
    } else {
      this.flightCase.style.display = 'none';
      this.flight.style.display = 'none';
    }

    if (inFlight && info) {
      const u = Math.min(1, state.ball.t / Math.max(0.001, info.T));
      // The pitcher always sees where their own pitch is going — they threw it.
      // The hitter's marker is the difficulty-gated assist.
      const reveal = pitching && !batting ? 0.0 : PITCH_TELL_REVEAL[state.difficulty];
      const fade = (u - reveal) / 0.18;
      if (fade > 0) {
        visible = true;
        const pt = p(info.plateX, info.plateY);
        const alpha = Math.min(1, fade);
        this.tracker.setAttribute('opacity', alpha.toFixed(2));
        const r = Math.max(5, zoneH * 0.075);
        this.trackerRing.setAttribute('cx', pt.x.toFixed(1));
        this.trackerRing.setAttribute('cy', pt.y.toFixed(1));
        this.trackerRing.setAttribute('r', (r + (1 - alpha) * r * 3).toFixed(1));
        this.trackerDot.setAttribute('cx', pt.x.toFixed(1));
        this.trackerDot.setAttribute('cy', pt.y.toFixed(1));
        this.trackerDot.setAttribute('r', (r * 0.55).toFixed(1));
        const c = cssColor(PITCHES[info.type].color);
        this.trackerRing.setAttribute('stroke', c);
        this.trackerDot.setAttribute('fill', c);
      }
    }
    this.tracker.style.display = visible ? '' : 'none';
  }

  // ------------------------------------------------------------ the intent

  private drawIntent(
    state: GameState,
    p: (x: number, y: number) => Pt,
    batting: boolean,
    pitching: boolean,
    batter: ReturnType<typeof currentBatter>,
    zoneH: number,
  ): void {
    // --- Hitter's contact cursor, drawn at its true sweet-spot size ---------
    if (batting) {
      const kind =
        state.batter.swingKind === 'power'
          ? 'power'
          : state.batter.bunting
            ? 'bunt'
            : 'contact';
      const prof = swingProfile(batter, kind, state.difficulty, true);
      const c = p(state.batter.cx, state.batter.cy);
      const ex = p(state.batter.cx + prof.rx, state.batter.cy);
      const ey = p(state.batter.cx, state.batter.cy + prof.ry);
      const rx = Math.abs(ex.x - c.x);
      const ry = Math.abs(ey.y - c.y);
      this.cursor.style.display = '';
      this.cursorCross.style.display = '';
      this.cursor.setAttribute('cx', c.x.toFixed(1));
      this.cursor.setAttribute('cy', c.y.toFixed(1));
      this.cursor.setAttribute('rx', rx.toFixed(1));
      this.cursor.setAttribute('ry', ry.toFixed(1));
      this.cursor.setAttribute('data-kind', kind);
      const arm = Math.max(5, zoneH * 0.06);
      this.cursorCross.setAttribute(
        'd',
        `M${(c.x - arm).toFixed(1)},${c.y.toFixed(1)}h${arm * 2}` +
          `M${c.x.toFixed(1)},${(c.y - arm).toFixed(1)}v${arm * 2}`,
      );
      this.cursorCross.setAttribute('data-kind', kind);
    } else {
      this.cursor.style.display = 'none';
      this.cursorCross.style.display = 'none';
    }

    // --- Pitcher's target, and what every pitch would do from it -----------
    const setting = pitching && state.phase === 'preplay';
    this.aim.style.display = setting ? '' : 'none';
    for (const arc of this.breakArcs) arc.style.display = 'none';
    if (!setting) return;

    const pr = state.pitcher;
    const pitcher = lookupPlayer(state, pr.playerId);
    const rep = pitcher.repertoire?.length ? pitcher.repertoire : (['fastball'] as const);

    const a = p(pr.aimX, pr.aimY);
    const r = Math.max(9, zoneH * 0.115);
    const corner = (sx: number, sy: number) =>
      `M${(a.x + sx * r).toFixed(1)},${(a.y + sy * r * 0.6).toFixed(1)}` +
      `L${(a.x + sx * r).toFixed(1)},${(a.y + sy * r).toFixed(1)}` +
      `L${(a.x + sx * r * 0.6).toFixed(1)},${(a.y + sy * r).toFixed(1)}`;
    this.aimBox.setAttribute('d', corner(-1, -1) + corner(1, -1) + corner(1, 1) + corner(-1, 1));
    this.aimDot.setAttribute('cx', a.x.toFixed(1));
    this.aimDot.setAttribute('cy', a.y.toFixed(1));
    this.aimDot.setAttribute('r', Math.max(2.5, r * 0.22).toFixed(1));

    /*
     * One arc per pitch in the repertoire, each in that pitch's own colour and
     * all converging on the target. This is the whole point of aiming *at the
     * plate crossing*: the pitcher is choosing a spot first and a shape second,
     * and can see before committing that the slider gets there from the arm
     * side while the curve falls into it from above. Colours match the pitch
     * chips in the HUD, which carry the key bindings.
     *
     * The arcs are traced through the same break and the same shaping curve
     * the engine will use, so the preview cannot drift from the pitch.
     */
    const mv = attr01(pitcher.pitch?.movement ?? 50);
    const steps = 8;
    for (let i = 0; i < this.breakArcs.length && i < rep.length; i++) {
      const type = rep[i];
      const brk = pitchBreak(type, pitcher.throws, mv);
      const lateness = PITCHES[type].lateness;
      const path: string[] = [];
      for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        const shape = Math.pow(u, 1 + 2.6 * lateness);
        const q = p(pr.aimX - brk.breakX * (1 - shape), pr.aimY - brk.breakY * (1 - shape));
        path.push(`${s === 0 ? 'M' : 'L'}${q.x.toFixed(1)},${q.y.toFixed(1)}`);
      }
      const arc = this.breakArcs[i];
      arc.style.display = '';
      arc.setAttribute('d', path.join(''));
      arc.setAttribute('stroke', cssColor(PITCHES[type].color));
    }
  }

  // ------------------------------------------------------------- the coach

  /**
   * The instruction, sitting on the zone itself.
   *
   * Under the zone, not over it, for two reasons. It must not cover the ball it
   * is telling you to watch, and above the zone is the middle of the screen,
   * which is where the game shouts TOP 1ST and the club's name at the start of
   * every half-inning — a hint that has to fight a banner for the same pixels
   * loses, and looks broken while it is losing.
   *
   * Under the zone is also exactly where the verdict panel goes, which is
   * deliberate rather than a collision: they are two answers to the same
   * question and they are never both worth having. One place on the screen
   * always means "about your swing".
   */
  private drawCoach(
    state: GameState,
    p: (x: number, y: number) => Pt,
    z: ReturnType<typeof zoneBounds>,
    safeBottom: number,
  ): void {
    const busy = !!state.lastSwing && state.lastSwing.t > 0;
    if (!this.coachText || busy) {
      this.coachEl.style.opacity = '0';
      return;
    }
    const anchor = p(0, z.bottom);
    const h = this.coachEl.offsetHeight || 26;
    // The same clamp the verdict uses, including its floor. Without the floor a
    // short viewport — a phone held sideways is 320 points tall — pulls the box
    // up past the zone entirely and lands it on the pitcher, which is both wrong
    // and the exact thing moving it below the zone was meant to avoid.
    const top = Math.min(anchor.y + 20, Math.max(anchor.y + 4, safeBottom - h - 8));
    this.coachEl.textContent = this.coachText;
    this.coachEl.style.left = `${anchor.x.toFixed(0)}px`;
    this.coachEl.style.top = `${top.toFixed(0)}px`;
    this.coachEl.style.opacity = '1';
  }

  // ------------------------------------------------------------- the gap

  /**
   * WHERE YOU SWUNG, AND WHERE IT WAS.
   *
   * The verdict panel already says *how* a swing was wrong — early, under, over.
   * That is the right answer for a control scheme where you steer a cursor and
   * press a button, because the two errors are made separately and you fix them
   * separately.
   *
   * Touching the zone collapses them into one act. The player made a single
   * decision — that spot, now — so the useful feedback is a single picture:
   * here is the spot you picked, here is the spot the ball went through, and
   * that is the distance between them. Six inches high reads instantly as six
   * inches high; "UNDER" has to be translated first.
   *
   * Drawn for whatever the swing did, not only for misses — on a barrel the
   * ring lands on the ball and the line vanishes, which is a better picture of
   * "yes, exactly there" than any word for it. In practice a ball put in play
   * takes the camera to the field and this goes with it, so what it mostly ends
   * up explaining is the strikes, which is the right bias: nobody needs telling
   * why the double was a double.
   */
  private drawMiss(
    state: GameState,
    p: (x: number, y: number) => Pt,
    batting: boolean,
    zoneH: number,
  ): void {
    const s = state.lastSwing;
    // The finite check is not paranoia about the engine, which always writes all
    // four. It is about a game resumed from a snapshot taken by an older build,
    // where `lastSwing` exists and these four fields do not — the alternative to
    // skipping the drawing is an SVG full of the string "NaN" for a second and a
    // half, and throwing away somebody's saved game over a decoration would be
    // the worse trade.
    const known =
      !!s &&
      Number.isFinite(s.atX) &&
      Number.isFinite(s.atY) &&
      Number.isFinite(s.ballX) &&
      Number.isFinite(s.ballY);
    if (!batting || !s || !known || s.t <= 0 || s.kind === 'none') {
      this.miss.style.display = 'none';
      return;
    }
    this.miss.style.display = '';
    // The first third of its life at full strength, then out — long enough to
    // read at a glance, gone before the next pitch is on the way.
    this.miss.style.opacity = String(Math.min(1, s.t * 2.4));

    const bat = p(s.atX, s.atY);
    const ball = p(s.ballX, s.ballY);
    // Sized off the drawn zone like everything else here, so it stays
    // proportionate on a phone and on a television.
    const r = Math.max(3, zoneH * 0.055);
    this.missBat.setAttribute('cx', bat.x.toFixed(1));
    this.missBat.setAttribute('cy', bat.y.toFixed(1));
    this.missBat.setAttribute('r', (r * 1.35).toFixed(1));
    this.missBall.setAttribute('cx', ball.x.toFixed(1));
    this.missBall.setAttribute('cy', ball.y.toFixed(1));
    this.missBall.setAttribute('r', r.toFixed(1));

    // The line is the whole point when there is a gap, and noise when there is
    // not — two marks on top of each other joined by a stub reads as a smudge.
    const gap = Math.hypot(ball.x - bat.x, ball.y - bat.y);
    if (gap > r * 1.6) {
      this.missLine.style.display = '';
      this.missLine.setAttribute('x1', bat.x.toFixed(1));
      this.missLine.setAttribute('y1', bat.y.toFixed(1));
      this.missLine.setAttribute('x2', ball.x.toFixed(1));
      this.missLine.setAttribute('y2', ball.y.toFixed(1));
    } else {
      this.missLine.style.display = 'none';
    }

    const contact = s.grade !== 'miss' && s.grade !== 'foul' && s.grade !== 'foultip';
    this.miss.dataset.tone = contact ? 'good' : s.grade === 'miss' ? 'bad' : 'warn';
  }

  // ----------------------------------------------------------- the verdict

  private drawVerdict(
    state: GameState,
    p: (x: number, y: number) => Pt,
    z: ReturnType<typeof zoneBounds>,
    batting: boolean,
    safeBottom: number,
  ): void {
    const s = state.lastSwing;
    if (!batting || !s || s.t <= 0) {
      this.verdict.style.opacity = '0';
      return;
    }

    // Sit the panel just under the zone so the eye never has to leave it, but
    // never so low that the prompt bar clips the timing needle.
    const anchor = p(0, z.bottom);
    const h = this.verdict.offsetHeight || 66;
    const top = Math.min(anchor.y + 20, Math.max(anchor.y + 4, safeBottom - h - 8));
    this.verdict.style.left = `${anchor.x.toFixed(0)}px`;
    this.verdict.style.top = `${top.toFixed(0)}px`;
    this.verdict.style.opacity = String(Math.min(1, s.t * 3));

    const contact = s.grade !== 'miss' && s.grade !== 'foul' && s.grade !== 'foultip';
    const tone = contact ? 'good' : s.grade === 'miss' ? 'bad' : 'warn';
    this.verdict.dataset.tone = tone;

    // Lead with whichever error actually cost the swing, so the feedback names
    // the thing worth fixing rather than reciting both every time.
    const timingWorse = Math.abs(s.timingNorm) >= Math.abs(s.vertNorm);
    const word = contact
      ? s.grade.toUpperCase()
      : timingWorse
        ? s.timingLabel
        : s.planeLabel;
    (this.verdict.querySelector('.pv-word') as HTMLElement).textContent = word;
    (this.verdict.querySelector('.pv-sub') as HTMLElement).textContent =
      `${s.timingLabel} · ${s.planeLabel}`;

    // Needle position: 0 % = a full window early, 100 % = a full window late.
    const t = Math.max(-1.5, Math.min(1.5, s.timingNorm));
    const needle = this.verdict.querySelector('.pv-needle') as HTMLElement;
    needle.style.left = `${(50 + (t / 1.5) * 50).toFixed(1)}%`;
  }
}
