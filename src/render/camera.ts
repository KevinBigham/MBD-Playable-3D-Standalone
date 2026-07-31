import * as THREE from 'three';
import { MOUND_Z, clamp, clamp01 } from '../core/constants';
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
        // Classic behind-the-plate framing. High enough that the catcher and
        // umpire sit low in frame instead of covering the strike zone, and
        // shifted a touch with the hitter's cursor so the bat stays clear.
        const side = state.batter.cx * 0.35;
        return {
          eye: new THREE.Vector3(side + 0.35, 5.15, -13.4),
          look: new THREE.Vector3(0, 1.15, 9.2),
          fov: 40,
          rate: 0.14,
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
        // Trail the ball at a fixed distance rather than sitting near home, so
        // the ball and the fielders converging on it fill the frame instead of
        // a field of empty grass.
        const d = Math.max(1, horizontalDist(ball.x, ball.z));
        const ux = ball.x / d;
        const uz = ball.z / d;
        const back = Math.min(42, d * 0.62);
        return {
          eye: new THREE.Vector3(
            ball.x - ux * back,
            Math.max(13, ball.y * 0.5 + 15),
            ball.z - uz * back - 6,
          ),
          look: new THREE.Vector3(ball.x, Math.max(1.2, ball.y * 0.75), ball.z),
          fov: 52,
          rate: 0.1,
        };
      }

      case 'homerun': {
        // Stay inside the park, behind and above the flight, so the shot reads
        // as the ball leaving the yard rather than a close-up of the seats.
        return {
          eye: new THREE.Vector3(ball.x * 0.22 - 6, Math.max(16, ball.y * 0.45 + 14), ball.z * 0.2 - 30),
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
