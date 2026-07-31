import * as THREE from 'three';
import type { Stadium, Team } from '../core/types';
import { CONTACT_Z, MOUND_Z, clamp01 } from '../core/constants';
import { batterBoxX } from '../sim/contact';
import { horizontalDist } from '../sim/physics';
import { runnerPos } from '../sim/runners';
import type { GameEvent, GameState } from '../sim/state';
import { fieldingSide, lookupPlayer } from '../sim/state';
import { BallActor, PlayerActor, type Pose, actorColorsFor } from './actors';
import type { Ball } from '../sim/physics';
import { CameraDirector } from './camera';
import { ImpactRings, ParticleField } from './fx';
import { buildStadium, type StadiumBuild } from './stadium';
import { flatMat, shade } from './palette';

/**
 * Binds simulation state to the 3D scene. The renderer owns no game logic: it
 * reads GameState every frame and never writes to it, which is what lets the
 * whole simulation run headless in tests.
 */

interface ActorSlot {
  actor: PlayerActor;
  playerId: string;
  pose: Pose;
  poseT: number;
  lastX: number;
  lastZ: number;
}

export interface WorldQuality {
  crowdAnimation: boolean;
  particles: boolean;
  pixelRatioCap: number;
  /** Fraction of the CSS resolution actually rendered, then upscaled. */
  renderScale: number;
}

/** The subset of derby state the renderer needs. */
export interface DerbyDrawState {
  entrants: { playerId: string; teamId: string }[];
  current: number;
  phase: string;
  swingT: number;
  ball: Ball;
}

export class GameWorld {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly director: CameraDirector;

  private stadiumBuild: StadiumBuild | null = null;
  private ball = new BallActor();
  private particles = new ParticleField();
  private rings = new ImpactRings();

  private fielders: ActorSlot[] = [];
  private runners: ActorSlot[] = [];
  private batter: ActorSlot | null = null;
  private umpire: PlayerActor | null = null;

  private catchMarker: THREE.Mesh;
  private selectRing: THREE.Mesh;
  private selectArrow!: THREE.Mesh;
  private runnerRings: THREE.Mesh[] = [];

  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private fill: THREE.DirectionalLight;

  private lastEventId = 0;
  private crowdEnergy = 0;
  private crowdPhase = 0;
  private quality: WorldQuality = {
    crowdAnimation: true,
    particles: true,
    pixelRatioCap: 2,
    renderScale: 1,
  };
  private night = false;
  private teams: { away: Team; home: Team } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x87ceeb, 1);
    this.director = new CameraDirector(canvas.clientWidth / Math.max(1, canvas.clientHeight));

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x445544, 1.15);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff3d6, 1.0);
    this.sun.position.set(-60, 90, -40);
    this.scene.add(this.sun);
    // Fill from behind the plate so players never silhouette into mush.
    this.fill = new THREE.DirectionalLight(0xcfe4ff, 0.5);
    this.fill.position.set(30, 40, -90);
    this.scene.add(this.fill);

    this.ball.addTo(this.scene);
    this.scene.add(this.particles.mesh);
    this.scene.add(this.rings.group);

    this.catchMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1.15, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffe14d,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.catchMarker.rotateX(-Math.PI / 2);
    this.catchMarker.visible = false;
    this.scene.add(this.catchMarker);

    this.selectRing = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.86, 20),
      new THREE.MeshBasicMaterial({
        color: 0x5ce1ff,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.selectRing.rotateX(-Math.PI / 2);
    this.selectRing.visible = false;
    this.scene.add(this.selectRing);

    // A floating chevron above the fielder you control. The runner markers are
    // flat rings on the grass, so the two are told apart by shape and position
    // rather than by colour.
    this.selectArrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.34, 0.66, 4),
      new THREE.MeshBasicMaterial({ color: 0x5ce1ff, depthWrite: false }),
    );
    this.selectArrow.rotation.x = Math.PI;
    this.selectArrow.visible = false;
    this.scene.add(this.selectArrow);

    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.5, 0.7, 16),
        new THREE.MeshBasicMaterial({
          color: 0xffb02e,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.rotateX(-Math.PI / 2);
      ring.visible = false;
      this.runnerRings.push(ring);
      this.scene.add(ring);
    }
  }

  setQuality(q: Partial<WorldQuality>): void {
    Object.assign(this.quality, q);
    this.resize(this.renderer.domElement.clientWidth, this.renderer.domElement.clientHeight);
  }

  setShakeEnabled(v: boolean): void {
    this.director.setShakeEnabled(v);
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    // The pixel-ratio cap alone does nothing on a 1x display, so the render
    // scale is applied to the drawing buffer and the canvas is stretched back
    // to full size by CSS. Aspect ratio is unaffected.
    const ratio = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap);
    this.renderer.setPixelRatio(ratio * this.quality.renderScale);
    this.renderer.setSize(w, h, false);
    this.director.resize(w / h);
  }

  /** Builds the park and the actor pool for a specific matchup. */
  loadMatch(stadium: Stadium, night: boolean, away: Team, home: Team): void {
    this.unloadStadium();
    this.night = night || stadium.domed;
    this.teams = { away, home };

    this.stadiumBuild = buildStadium(stadium, this.night);
    this.scene.add(this.stadiumBuild.root);

    const sky = this.night ? stadium.palette.skyNight : stadium.palette.sky;
    this.renderer.setClearColor(sky, 1);
    this.scene.fog = new THREE.Fog(sky, 190, 460);

    // Bright and flat by design: the reference era lit its ballparks like a
    // toy, and a murky field makes the ball impossible to track.
    if (this.night) {
      // Floodlit, not moonlit. Under-lighting a night game makes the ball
      // impossible to track, which is a gameplay failure, not a mood.
      this.hemi.intensity = 1.75;
      this.hemi.color.setHex(0xe4ecff);
      this.hemi.groundColor.setHex(0x54607e);
      this.sun.intensity = 1.5;
      this.sun.color.setHex(0xf2f6ff);
      this.sun.position.set(40, 120, 30);
      this.fill.intensity = 0.95;
      this.fill.color.setHex(0xc4d4ff);
    } else {
      this.hemi.intensity = 1.5;
      this.hemi.color.setHex(0xffffff);
      this.hemi.groundColor.setHex(0x8ba173);
      this.sun.intensity = 1.3;
      this.sun.color.setHex(0xfff6e0);
      this.sun.position.set(-60, 90, -40);
      this.fill.intensity = 0.5;
      this.fill.color.setHex(0xcfe4ff);
    }

    this.clearActors();
    this.particles.clear();
    this.rings.clear();
    this.ball.clearTrail();
  }

  private unloadStadium(): void {
    if (!this.stadiumBuild) return;
    this.scene.remove(this.stadiumBuild.root);
    this.stadiumBuild.dispose();
    this.stadiumBuild = null;
  }

  private clearActors(): void {
    for (const s of [...this.fielders, ...this.runners]) s.actor.dispose();
    this.batter?.actor.dispose();
    this.fielders = [];
    this.runners = [];
    this.batter = null;
  }

  private makeActor(playerId: string, side: 'away' | 'home'): ActorSlot {
    const team = side === 'away' ? this.teams!.away : this.teams!.home;
    const player =
      team.players.find((p) => p.id === playerId) ??
      this.teams!.away.players.find((p) => p.id === playerId) ??
      this.teams!.home.players.find((p) => p.id === playerId) ??
      team.players[0];
    const actor = new PlayerActor(actorColorsFor(player, team), player.body);
    this.scene.add(actor.group);
    return { actor, playerId, pose: 'idle', poseT: 0, lastX: 0, lastZ: 0 };
  }

  private ensureUmpire(): void {
    if (this.umpire) return;
    this.umpire = new PlayerActor(
      { jersey: 0x232838, trim: 0x11151f, accent: 0x8f98aa, skin: 0xc68642 },
      'stocky',
    );
    this.scene.add(this.umpire.group);
  }

  // -------------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------------

  update(dt: number, state: GameState, onEvent?: (ev: GameEvent) => void): void {
    if (!this.teams) return;
    this.consumeEvents(state, onEvent);

    this.syncFielders(dt, state);
    this.syncBatter(dt, state);
    this.syncRunners(dt, state);
    this.syncBall(dt, state);
    this.syncMarkers(state);
    this.animateCrowd(dt, state);

    if (this.quality.particles) this.particles.update(dt);
    else this.particles.clear();
    this.rings.update(dt);
    this.director.update(dt, state);
  }

  render(): void {
    this.renderer.render(this.scene, this.director.camera);
  }

  // -------------------------------------------------------------------------

  private consumeEvents(state: GameState, onEvent?: (ev: GameEvent) => void): void {
    for (const ev of state.events) {
      if ((ev.id ?? 0) <= this.lastEventId) continue;
      this.lastEventId = ev.id ?? 0;
      this.reactTo(ev, state);
      onEvent?.(ev);
    }
  }

  private reactTo(ev: GameEvent, state: GameState): void {
    const p = ev.power ?? 0.5;
    switch (ev.kind) {
      case 'contact': {
        const x = ev.x ?? 0;
        const y = ev.y ?? 1;
        this.director.addShake(0.12 + p * 0.5);
        if (this.quality.particles) this.rings.spawn(x, y, CONTACT_Z, p > 0.7 ? 0xffe14d : 0xffffff, 0.7 + p, 0.35);
        if (this.quality.particles && p > 0.55) {
          this.particles.burst(x, y, CONTACT_Z, 14, {
            color: 0xfff0b0,
            speed: 6 + p * 6,
            size: 0.09,
            life: 0.4,
          });
        }
        this.crowdEnergy = Math.min(1, this.crowdEnergy + p * 0.6);
        break;
      }
      case 'groundfield':
        if (this.quality.particles) {
          this.particles.burst(ev.x ?? 0, 0.1, ev.z ?? 0, 8, {
            color: 0xcaa06a,
            speed: 2.6,
            up: 0.7,
            size: 0.08,
            life: 0.42,
          });
        }
        break;
      case 'wall':
        this.director.addShake(0.3);
        if (this.quality.particles) {
          this.particles.burst(ev.x ?? 0, 2.2, ev.z ?? 0, 14, {
            color: 0xdddddd,
            speed: 5,
            size: 0.1,
            life: 0.5,
          });
        }
        break;
      case 'catch':
        if (p > 0.8) {
          this.director.addShake(0.35);
          if (this.quality.particles) this.rings.spawn(ev.x ?? 0, 1.4, ev.z ?? 0, 0x5ce1ff, 1.5, 0.6);
          this.crowdEnergy = 1;
        }
        break;
      case 'homerun': {
        this.director.addShake(0.85);
        this.crowdEnergy = 1;
        if (this.quality.particles) {
          const c = this.teamColorFor(state, 'batting');
          this.particles.fireworks(state.ball.x, Math.max(6, state.ball.y), state.ball.z, c);
        }
        break;
      }
      case 'bigplay':
        this.director.addShake(0.45);
        this.crowdEnergy = 1;
        break;
      case 'strikeout':
        this.director.addShake(0.16);
        this.crowdEnergy = Math.min(1, this.crowdEnergy + 0.4);
        break;
      case 'run':
        this.crowdEnergy = Math.min(1, this.crowdEnergy + 0.5);
        break;
      case 'out':
        this.crowdEnergy = Math.min(1, this.crowdEnergy + 0.22);
        break;
      case 'gameover':
        this.crowdEnergy = 1;
        if (this.quality.particles) {
          for (let i = 0; i < 5; i++) {
            this.particles.fireworks(
              (i - 2) * 22,
              22 + i * 3,
              70 + i * 6,
              [0xffe14d, 0x5ce1ff, 0xff6b3d, 0x7ee081, 0xc08bff][i],
            );
          }
        }
        break;
      default:
        break;
    }
  }

  private teamColorFor(state: GameState, which: 'batting' | 'fielding'): number {
    const battingIsAway = state.half === 'top';
    const away = this.teams!.away;
    const home = this.teams!.home;
    if (which === 'batting') return battingIsAway ? away.primary : home.primary;
    return battingIsAway ? home.primary : away.primary;
  }

  private syncFielders(dt: number, state: GameState): void {
    const side = fieldingSide(state);
    while (this.fielders.length < state.fielders.length) {
      this.fielders.push(this.makeActor(state.fielders[this.fielders.length].playerId, side));
    }
    for (let i = 0; i < state.fielders.length; i++) {
      const f = state.fielders[i];
      const slot = this.fielders[i];
      if (slot.playerId !== f.playerId) {
        slot.actor.dispose();
        this.fielders[i] = this.makeActor(f.playerId, side);
      }
      const s = this.fielders[i];
      const speed = Math.hypot(f.vx, f.vz);

      let pose: Pose = 'fieldReady';
      let poseT = 0;
      if (f.diveT > 0) {
        pose = 'dive';
        poseT = 1 - f.diveT / 0.55;
      } else if (f.jumpT > 0) {
        pose = 'jump';
        poseT = 1 - f.jumpT / 0.5;
      } else if (f.hasBall && f.transfer > 0.02) {
        pose = 'throw';
        poseT = clamp01(1 - f.transfer / 0.32);
      } else if (speed > 0.7) {
        pose = 'run';
      } else if (i === 0 && (state.phase === 'windup' || state.phase === 'pitch')) {
        pose = state.phase === 'windup' ? 'pitchSet' : 'pitchThrow';
        poseT =
          state.phase === 'windup'
            ? clamp01(state.phaseT / 0.42)
            : clamp01(state.phaseT / 0.28);
      } else if (i === 1) {
        pose = 'fieldReady';
      }

      // Fielders face the ball when it is live, otherwise the plate.
      const live = state.phase === 'inplay';
      const targetX = live ? state.ball.x : 0;
      const targetZ = live ? state.ball.z : 0;
      const facing =
        speed > 0.7 ? Math.atan2(f.vx, f.vz) : Math.atan2(targetX - f.x, targetZ - f.z);

      s.actor.update(dt, { x: f.x, z: f.z, speed, facing, pose, poseT });
      s.lastX = f.x;
      s.lastZ = f.z;
    }
  }

  private syncBatter(dt: number, state: GameState): void {
    const battingIsAway = state.half === 'top';
    const side = battingIsAway ? 'away' : 'home';
    const batterId = state.batter.playerId;
    if (!batterId) {
      if (this.batter) this.batter.actor.setVisible(false);
      return;
    }
    if (!this.batter || this.batter.playerId !== batterId) {
      this.batter?.actor.dispose();
      this.batter = this.makeActor(batterId, side);
    }
    const batter = lookupPlayer(state, batterId);
    const pitcher = lookupPlayer(state, state.pitcher.playerId);
    const boxX = batterBoxX(batter.bats, pitcher.throws);
    const handed = boxX < 0 ? -1 : 1;

    // Once the batter becomes a runner the runner actor takes over.
    const isRunning = state.runners.some((r) => r.isBatter && !r.out && !r.scored);
    this.batter.actor.setVisible(!isRunning);

    let pose: Pose = 'batStance';
    let poseT = 0;
    if (state.batter.swingKind === 'bunt' && state.batter.swingT >= 0) {
      pose = 'bunt';
    } else if (state.batter.bunting && state.batter.swingT < 0) {
      pose = 'bunt';
    } else if (state.batter.swingT >= 0) {
      pose = 'batSwing';
      poseT = clamp01(state.batter.swingT / 0.42);
    }

    this.batter.actor.update(dt, {
      x: boxX,
      z: 0.35,
      speed: 0,
      facing: handed > 0 ? -Math.PI / 2 : Math.PI / 2,
      pose,
      poseT,
      handed,
    });

    this.ensureUmpire();
    this.umpire!.setVisible(true);
    this.umpire!.update(dt, {
      x: -0.66,
      z: -3.45,
      speed: 0,
      facing: 0.12,
      pose: 'fieldReady',
      poseT: 0,
    });
  }

  private syncRunners(dt: number, state: GameState): void {
    const battingIsAway = state.half === 'top';
    const side = battingIsAway ? 'away' : 'home';
    const live = state.runners.filter((r) => !r.out && !r.scored);

    while (this.runners.length < live.length) {
      this.runners.push(this.makeActor(live[this.runners.length].playerId, side));
    }
    for (let i = 0; i < this.runners.length; i++) {
      const slot = this.runners[i];
      if (i >= live.length) {
        slot.actor.setVisible(false);
        continue;
      }
      const r = live[i];
      if (slot.playerId !== r.playerId) {
        slot.actor.dispose();
        this.runners[i] = this.makeActor(r.playerId, side);
      }
      const s = this.runners[i];
      s.actor.setVisible(true);
      const pos = runnerPos(r);
      const dx = pos.x - s.lastX;
      const dz = pos.z - s.lastZ;
      const moved = Math.hypot(dx, dz) / Math.max(1e-5, dt);
      const facing = moved > 0.5 ? Math.atan2(dx, dz) : Math.atan2(-pos.x, -pos.z);
      const pose: Pose = r.slide > 0 ? 'slide' : moved > 0.6 ? 'run' : 'idle';
      s.actor.update(dt, {
        x: pos.x,
        z: pos.z,
        speed: moved,
        facing,
        pose,
        poseT: r.slide > 0 ? 1 - r.slide / 0.5 : 0,
      });
      s.lastX = pos.x;
      s.lastZ = pos.z;
    }
  }

  private syncBall(dt: number, state: GameState): void {
    const b = state.ball;
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    let x = b.x;
    let y = b.y;
    let z = b.z;
    let visible = true;

    if (b.mode === 'held') {
      const holder = state.fielders.find((f) => f.hasBall);
      if (holder) {
        x = holder.x;
        y = 1.35;
        z = holder.z;
      } else {
        x = 0;
        y = 1.7;
        z = MOUND_Z;
      }
      visible = state.phase !== 'preplay' || true;
    }

    if (b.mode === 'pitch' && state.currentPitch) {
      this.ball.setTrailColor(0xffffff, 0.35);
    } else if (b.mode === 'batted') {
      this.ball.setTrailColor(0xffe14d, 0.6);
    } else {
      this.ball.setTrailColor(0xffffff, 0.28);
    }

    if (state.phase === 'preplay' || state.phase === 'windup' || state.phase === 'deadball') {
      this.ball.clearTrail();
    }

    this.ball.update(dt, x, y, z, speed, visible);
  }

  private syncMarkers(state: GameState): void {
    // Landing marker for fly balls: the single most important readability aid
    // on defence.
    const showCatch =
      state.phase === 'inplay' &&
      state.ball.mode === 'batted' &&
      !state.ball.rolling &&
      state.ball.y > 2.5 &&
      state.predictT > 0.35;
    this.catchMarker.visible = showCatch;
    if (showCatch) {
      this.catchMarker.position.set(state.predictX, 0.06, state.predictZ);
      const pulse = 1 + Math.sin(state.clock * 12) * 0.09;
      this.catchMarker.scale.setScalar(pulse);
    }

    const controlled = state.fielders.find((f) => f.humanControlled);
    this.selectRing.visible = !!controlled;
    this.selectArrow.visible = !!controlled;
    if (controlled) {
      this.selectRing.position.set(controlled.x, 0.05, controlled.z);
      this.selectArrow.position.set(
        controlled.x,
        2.55 + Math.sin(state.clock * 6) * 0.12,
        controlled.z,
      );
    }

    const live = state.runners.filter((r) => !r.out && !r.scored);
    for (let i = 0; i < this.runnerRings.length; i++) {
      const ring = this.runnerRings[i];
      if (i >= live.length || state.phase === 'final') {
        ring.visible = false;
        continue;
      }
      const p = runnerPos(live[i]);
      ring.visible = true;
      ring.position.set(p.x, 0.045, p.z);
      // Advancing runners get a bigger, pulsing ring as well as a different
      // colour, so the state never depends on colour alone.
      const advancing = live[i].target > live[i].base + 0.01;
      (ring.material as THREE.MeshBasicMaterial).color.setHex(advancing ? 0x7ee081 : 0xffb02e);
      ring.scale.setScalar(advancing ? 1.35 + Math.sin(state.clock * 11) * 0.16 : 1);
    }
  }

  private animateCrowd(dt: number, state: GameState): void {
    this.crowdEnergy = Math.max(0, this.crowdEnergy - dt * 0.35);
    if (!this.stadiumBuild || !this.quality.crowdAnimation) return;
    const crowd = this.stadiumBuild.crowd;
    const count = this.stadiumBuild.crowdCount;
    if (count === 0) return;

    this.crowdPhase += dt * (2.2 + this.crowdEnergy * 5);
    const amp = 0.06 + this.crowdEnergy * 0.55;
    const rest = this.stadiumBuild.crowdBase;
    const m = new THREE.Matrix4();
    // Only a slice of the crowd is re-written each frame; the wave still reads
    // and the cost stays flat regardless of stadium size. The rest position is
    // read from the immutable seat table — deriving it from the live matrix
    // makes the whole crowd drift upward a little more every frame.
    const stride = 3;
    const offset = Math.floor(state.clock * 60) % stride;
    for (let i = offset; i < count; i += stride) {
      const bx = rest[i * 3];
      const by = rest[i * 3 + 1];
      const bz = rest[i * 3 + 2];
      const wave = Math.sin(this.crowdPhase + (bx + bz) * 0.08 + i * 0.37);
      m.makeTranslation(bx, by + Math.max(0, wave) * amp, bz);
      crowd.setMatrixAt(i, m);
    }
    crowd.instanceMatrix.needsUpdate = true;
  }

  crowdLevel(): number {
    return this.crowdEnergy;
  }

  /** Projects a world point to normalised screen coordinates for HUD markers. */
  project(x: number, y: number, z: number): { x: number; y: number; behind: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.director.camera);
    return { x: (v.x * 0.5 + 0.5), y: (-v.y * 0.5 + 0.5), behind: v.z > 1 };
  }

  /**
   * Renders the home-run derby. It reuses the ballpark and the actor models but
   * drives them from the derby's own tiny state machine rather than GameState.
   */
  updateDerbyScene(dt: number, derby: DerbyDrawState, teams: Team[]): void {
    if (!this.teams) this.teams = { away: teams[0], home: teams[1] };
    const e = derby.entrants[derby.current];
    const team = teams.find((t) => t.id === e.teamId) ?? teams[0];
    const player = team.players.find((p) => p.id === e.playerId) ?? team.players[0];

    if (!this.batter || this.batter.playerId !== player.id) {
      this.batter?.actor.dispose();
      const actor = new PlayerActor(actorColorsFor(player, team), player.body);
      this.scene.add(actor.group);
      this.batter = { actor, playerId: player.id, pose: 'batStance', poseT: 0, lastX: 0, lastZ: 0 };
    }
    const handed = player.bats === 'L' ? 1 : -1;
    const boxX = handed > 0 ? 0.78 : -0.78;
    const pose: Pose = derby.swingT >= 0 ? 'batSwing' : 'batStance';
    this.batter.actor.setVisible(true);
    this.batter.actor.update(dt, {
      x: boxX,
      z: 0.35,
      speed: 0,
      facing: handed > 0 ? -Math.PI / 2 : Math.PI / 2,
      pose,
      poseT: clamp01(derby.swingT / 0.42),
      handed,
    });

    // No umpire in the derby — there are no balls and strikes, and standing him
    // in front of the plate would hide the batter and the strike-zone box.
    this.umpire?.setVisible(false);

    if (!this.derbyPitcher) {
      this.derbyPitcher = new PlayerActor(
        { jersey: 0x3a4152, trim: 0x20242f, accent: 0xc9c6dd, skin: 0xe0ac69 },
        'average',
      );
      this.scene.add(this.derbyPitcher.group);
    }
    this.derbyPitcher.update(dt, {
      x: 0,
      z: MOUND_Z * 0.75,
      speed: 0,
      facing: Math.PI,
      pose: derby.phase === 'pitch' ? 'pitchThrow' : 'pitchSet',
      poseT: derby.phase === 'pitch' ? 0.6 : 0.2,
    });

    const b = derby.ball;
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    this.ball.setTrailColor(b.mode === 'batted' ? 0xffe14d : 0xffffff, 0.55);
    if (derby.phase === 'ready') this.ball.clearTrail();
    this.ball.update(dt, b.x, b.y, b.z, speed, b.mode !== 'held' && b.mode !== 'idle');

    for (const f of this.fielders) f.actor.setVisible(false);
    for (const r of this.runners) r.actor.setVisible(false);
    this.catchMarker.visible = false;
    this.selectRing.visible = false;
    this.selectArrow.visible = false;
    for (const ring of this.runnerRings) ring.visible = false;

    if (derby.phase === 'flight' && b.y > 6 && this.quality.particles && this.crowdEnergy < 0.4) {
      this.crowdEnergy = 0.5;
    }
    this.crowdEnergy = Math.max(0, this.crowdEnergy - dt * 0.3);
    if (this.quality.particles) this.particles.update(dt);
    this.rings.update(dt);
    this.animateCrowdSimple(dt);

    // Follow the ball once it is in the air; otherwise sit behind the plate.
    const flight = derby.phase === 'flight' && b.y > 3;
    this.director.updateCustom(
      dt,
      flight
        ? {
            eye: new THREE.Vector3(b.x * 0.35 - 4, Math.max(9, b.y * 0.6 + 7), b.z * 0.35 - 22),
            look: new THREE.Vector3(b.x, b.y * 0.8, b.z),
            fov: 52,
            rate: 0.1,
          }
        : {
            eye: new THREE.Vector3(-0.2, 3.55, -11.6),
            look: new THREE.Vector3(0, 1.5, 7.5),
            fov: 40,
            rate: 0.16,
          },
      flight ? 'outfield' : 'derby',
    );
  }

  private derbyPitcher: PlayerActor | null = null;

  private animateCrowdSimple(dt: number): void {
    if (!this.stadiumBuild || !this.quality.crowdAnimation) return;
    this.crowdPhase += dt * (2.2 + this.crowdEnergy * 5);
  }

  dispose(): void {
    this.unloadStadium();
    this.clearActors();
    this.particles.clear();
    this.rings.clear();
    this.renderer.dispose();
  }
}

export { horizontalDist, flatMat, shade };
