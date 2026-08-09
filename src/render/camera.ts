import * as THREE from 'three';
import { MOUND_Z, SWING_FOLLOW_THROUGH, clamp, clamp01, lerp } from '../core/constants';
import { fenceAt } from '../data/stadiums';
import type { GameState } from '../sim/state';
import { horizontalDist } from '../sim/physics';

/**
 * Camera director.
 *
 * The camera is a character in an arcade sports game: it cuts hard between a
 * small number of readable framings rather than smoothly drifting everywhere.
 * Each shot returns a desired eye/target pair; the director blends toward it,
 * and cuts instantly when the shot type changes so the transitions feel like
 * a broadcast switch instead of a drone flight.
 */

export type ShotName =
  | 'establish'
  | 'batting'
  | 'infield'
  | 'outfield'
  | 'homerun'
  | 'result'
  | 'derby';

interface Shot {
  eye: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  /** 0..1 per second blend rate; higher snaps faster. */
  rate: number;
}

export interface CameraDirectorState {
  eye: [number, number, number];
  look: [number, number, number];
  fov: number;
  current: ShotName;
  shake: number;
  shakeSeed: number;
  orbit: number;
}

/**
 * Pulls a camera position back inside the outfield wall.
 *
 * The chase shots are derived from the ball, and a ball in the corner or up
 * against the fence can put the eye behind the wall — which used to mean the
 * play was watched from somewhere in row 20, through a screen of spectators.
 * Clamping the radius against the same fence curve the ball is tested against
 * means it can never happen, in any of the eight parks.
 */
function keepInsideYard(eye: THREE.Vector3, state: GameState): void {
  const r = horizontalDist(eye.x, eye.z);
  if (r < 1) return;
  const deg = (Math.atan2(eye.x, Math.max(0.0001, eye.z)) * 180) / Math.PI;
  // Behind the plate the limit is the backstop rather than the outfield wall.
  const limit = eye.z > 0 && Math.abs(deg) <= 45 ? fenceAt(state.stadium, deg).dist - 7 : 40;
  if (r <= limit) return;
  const k = limit / r;
  eye.x *= k;
  eye.z *= k;
}

/**
 * Seconds since the ball was struck while the swing is still finishing, or -1
 * once it is done.
 *
 * The engine launches the ball, creates the batter-runner and leaves the pitch
 * phase all on the same tick — so without this, the entire back half of a swing
 * happens in the one frame the camera is already cutting away from. The player
 * reported never seeing the bat meet the ball, and this was one of the three
 * reasons why.
 *
 * `play.clock` counts from contact and lives in the simulation, so the renderer
 * stays a pure function of state and a replay of the same seed shows the same
 * follow-through. It lives here rather than in world.ts because both the camera
 * and the actors need it, and world.ts already imports this module.
 */
export const FOLLOW_THROUGH = SWING_FOLLOW_THROUGH;

export function followThrough(state: GameState): number {
  if (state.phase !== 'inplay' && state.phase !== 'deadball') return -1;
  if (!state.play.live || state.play.homeRunCelebration) return -1;
  return state.play.clock < FOLLOW_THROUGH ? state.play.clock : -1;
}

export class CameraDirector {
  readonly camera: THREE.PerspectiveCamera;
  private eye = new THREE.Vector3(0, 4, -14);
  private look = new THREE.Vector3(0, 1.4, 8);
  private current: ShotName = 'establish';
  private shake = 0;
  private shakeSeed = 0;
  private orbit = 0;
  private shakeEnabled = true;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(46, aspect, 0.25, 900);
    this.camera.position.copy(this.eye);
  }

  setShakeEnabled(v: boolean): void {
    this.shakeEnabled = v;
    if (!v) this.shake = 0;
  }

  addShake(amount: number): void {
    if (!this.shakeEnabled) return;
    this.shake = Math.min(1.1, this.shake + amount);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  captureState(): CameraDirectorState {
    return {
      eye: [this.eye.x, this.eye.y, this.eye.z],
      look: [this.look.x, this.look.y, this.look.z],
      fov: this.camera.fov,
      current: this.current,
      shake: this.shake,
      shakeSeed: this.shakeSeed,
      orbit: this.orbit,
    };
  }

  restoreState(state: CameraDirectorState): void {
    this.eye.fromArray(state.eye);
    this.look.fromArray(state.look);
    this.current = state.current;
    this.shake = state.shake;
    this.shakeSeed = state.shakeSeed;
    this.orbit = state.orbit;
    this.camera.position.copy(this.eye);
    this.camera.fov = state.fov;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.look);
  }

  /** Exact authored replay camera. No smoothing is applied here: the sequence
   * evaluator already owns cuts and easing. */
  setReplayFrame(eye: THREE.Vector3, look: THREE.Vector3, fov: number): void {
    this.eye.copy(eye);
    this.look.copy(look);
    this.camera.position.copy(eye);
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(look);
  }

  /** Chooses and applies the right shot for the current game state. */
  update(dt: number, state: GameState): void {
    const shot = this.chooseShot(dt, state);
    this.apply(dt, shot);
  }

  updateCustom(dt: number, shot: Shot, name: ShotName): void {
    if (name !== this.current) {
      this.current = name;
      this.eye.copy(shot.eye);
      this.look.copy(shot.look);
    }
    this.apply(dt, shot);
  }

  private apply(dt: number, shot: Shot): void {
    const k = 1 - Math.pow(1 - clamp01(shot.rate), dt * 60);
    this.eye.lerp(shot.eye, k);
    this.look.lerp(shot.look, k);
    this.camera.fov += (shot.fov - this.camera.fov) * k;
    this.camera.updateProjectionMatrix();

    this.camera.position.copy(this.eye);
    if (this.shake > 0.001) {
      this.shakeSeed += dt * 47;
      const s = this.shake * this.shake * 0.9;
      this.camera.position.x += Math.sin(this.shakeSeed * 3.1) * s;
      this.camera.position.y += Math.cos(this.shakeSeed * 2.3) * s * 0.7;
      this.shake = Math.max(0, this.shake - dt * 2.4);
    }
    this.camera.lookAt(this.look);
  }

  private chooseShot(dt: number, state: GameState): Shot {
    const name = this.pickShotName(state);
    if (name !== this.current) {
      // Hard cut: place the camera at the new shot immediately, then let the
      // small residual blend do the settling.
      this.current = name;
      const s = this.buildShot(name, dt, state);
      this.eye.copy(s.eye);
      this.look.copy(s.look);
      this.camera.fov = s.fov;
      return s;
    }
    return this.buildShot(name, dt, state);
  }

  private pickShotName(state: GameState): ShotName {
    switch (state.phase) {
      case 'lineup':
      case 'inningbreak':
        return 'establish';
      case 'final':
        return 'result';
      case 'inplay': {
        if (state.play.homeRunCelebration) return 'homerun';
        // Stay at the plate for the beat it takes to finish the swing. The cut
        // to the field used to land on the exact frame of contact, which is the
        // one frame worth watching.
        // `>= 0`, not `> 0`: the clock is exactly zero on the frame of contact,
        // which is the one frame this whole thing exists for. An earlier version
        // used `> 0` and cut wide for a single frame at the moment of impact,
        // then cut back — a flicker on the only frame that mattered.
        if (followThrough(state) >= 0) return 'batting';
        const d = horizontalDist(state.ball.x, state.ball.z);
        const airborne = state.ball.mode === 'batted' && !state.ball.rolling && state.ball.y > 2;
        if (d > 46 || (airborne && state.ball.apex > 12)) return 'outfield';
        return 'infield';
      }
      case 'deadball':
        return state.play.homeRunCelebration ? 'homerun' : 'infield';
      default:
        return 'batting';
    }
  }

  private buildShot(name: ShotName, dt: number, state: GameState): Shot {
    const ball = state.ball;
    switch (name) {
      case 'establish': {
        // Slow arc from outside the bowl, looking across the diamond.
        this.orbit += dt * 0.13;
        const swing = Math.sin(this.orbit) * 0.9;
        const r = 132;
        return {
          eye: new THREE.Vector3(Math.sin(swing) * r, 42 + Math.cos(this.orbit * 0.7) * 6, -58 + Math.cos(swing) * 26),
          look: new THREE.Vector3(0, 2, 30),
          fov: 50,
          rate: 0.05,
        };
      }

      case 'batting': {
        // THE DUEL SHOT. Everything about this framing exists to make the
        // strike zone big and stationary:
        //
        //   * a long lens (25deg) from just behind and above the catcher, which
        //     is the real broadcast framing for exactly this reason — it puts
        //     the zone at ~21% of screen height where a wide angle gave ~6%;
        //   * aimed so the zone sits at about two thirds height, leaving the
        //     release point comfortably inside the top of frame. Both ends of
        //     the pitch have to be visible or the hitter cannot time anything;
        //   * dead centre and completely static. The camera used to drift with
        //     the hitter's cursor, which made the zone swim around the screen
        //     and defeated the point of drawing one.
        //
        // The catcher crouches and the umpire is not drawn for this shot; see
        // world.ts. Both of them stand inside the lens's near field.
        return {
          eye: new THREE.Vector3(0, 2.6, -5.4),
          look: new THREE.Vector3(0, 1.32, 0.62),
          fov: 25,
          rate: 0.22,
        };
      }

      case 'infield': {
        const cx = clamp(ball.x * 0.42, -14, 14);
        const cz = clamp(ball.z * 0.4 + 8, 4, 30);
        return {
          eye: new THREE.Vector3(cx * 0.6, 19, -24),
          look: new THREE.Vector3(cx, 1.2, cz),
          fov: 50,
          rate: 0.1,
        };
      }

      case 'outfield': {
        // Trail the ball rather than sitting near home, so the ball and the
        // fielders converging on it fill the frame instead of empty grass.
        //
        // Two rules keep the grass in shot, and they exist because without them
        // a high fly to the gap framed nothing but seats — the camera sat below
        // the ball, looked up at it, and put the entire outfield behind the
        // lens. A fielder cannot be steered to a ball they cannot see.
        //
        //   1. the eye is always ABOVE the ball, so the view angle is downward
        //   2. the look point is pulled toward where the ball is coming DOWN,
        //      which is the thing a fielder actually has to run to
        const d = Math.max(1, horizontalDist(ball.x, ball.z));
        const ux = ball.x / d;
        const uz = ball.z / d;
        const back = Math.min(42, d * 0.62);
        const eye = new THREE.Vector3(
          ball.x - ux * back,
          Math.max(15, ball.y + 11),
          ball.z - uz * back - 6,
        );
        keepInsideYard(eye, state);
        const landing = state.predictT > 0.2;
        const lx = landing ? lerp(ball.x, state.predictX, 0.4) : ball.x;
        const lz = landing ? lerp(ball.z, state.predictZ, 0.4) : ball.z;
        return {
          eye,
          look: new THREE.Vector3(lx, Math.max(1.2, ball.y * 0.35), lz),
          fov: 52,
          rate: 0.1,
        };
      }

      case 'homerun': {
        // Stay inside the park, behind and above the flight, so the shot reads
        // as the ball leaving the yard rather than a close-up of the seats.
        const eye = new THREE.Vector3(
          ball.x * 0.22 - 6,
          Math.max(16, ball.y * 0.45 + 14),
          ball.z * 0.2 - 30,
        );
        keepInsideYard(eye, state);
        return {
          eye,
          look: new THREE.Vector3(ball.x * 0.92, Math.max(3, ball.y * 0.85), ball.z * 0.94),
          fov: 50,
          rate: 0.08,
        };
      }

      case 'result':
      default:
        return {
          eye: new THREE.Vector3(0, 14, -26),
          look: new THREE.Vector3(0, 2, MOUND_Z),
          fov: 46,
          rate: 0.07,
        };
    }
  }
}
