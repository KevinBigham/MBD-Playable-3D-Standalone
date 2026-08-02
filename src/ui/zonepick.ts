import { CONTACT_Z } from '../core/constants';

/**
 * FROM A PIXEL BACK TO A PLACE ON THE PLATE.
 *
 * Everything the plate view draws goes one way: a point in the ballpark is
 * projected through the camera onto the screen. Touching the zone needs the
 * other direction, and there is no inverse-project to call — a screen point is
 * a ray through the world, not a point.
 *
 * But it is a point once you fix a depth, and the depth is already fixed:
 * everything on the zone lives on the contact plane. So the map from (x, y) at
 * `CONTACT_Z` to the screen is smooth, one-to-one over the region that matters,
 * and its inverse can simply be *solved for* — start with a guess, project it,
 * see how far off the screen position is, and step toward the answer using the
 * local slope. Newton's method, three iterations, sub-pixel.
 *
 * This is nicer than the alternatives. Fitting a homography to the four zone
 * corners would also work, but it would be a *second* description of the camera
 * that could disagree with the real one; solving against `project` itself
 * cannot, because it is the same function the zone was drawn with. If the
 * camera moves, the field of view changes, or the projection is replaced
 * outright, this follows for free.
 */

/** Metres to step when measuring the local slope. Small; the map is smooth. */
const EPS = 0.06;
const ITERATIONS = 3;

export interface ZonePoint {
  /** Metres from the centre of the plate; positive toward first base. */
  x: number;
  /** Metres above the ground. */
  y: number;
}

/**
 * Which point on the contact plane a normalised screen position is looking at.
 *
 * `project` is `GameWorld.project`, returning 0..1 screen coordinates; `sx`/`sy`
 * are in the same 0..1 space. `start` seeds the search — pass the current cursor
 * so a tap near where the last one was converges immediately.
 *
 * Returns null when the solve does not converge, which happens if the camera is
 * not looking at the plate at all. A caller that gets null should do nothing:
 * there is no sensible place to put a swing.
 */
export function screenToZone(
  project: (x: number, y: number, z: number) => { x: number; y: number },
  sx: number,
  sy: number,
  start: ZonePoint = { x: 0, y: 0.95 },
): ZonePoint | null {
  let x = start.x;
  let y = start.y;

  for (let i = 0; i < ITERATIONS; i++) {
    const at = project(x, y, CONTACT_Z);
    const dx = project(x + EPS, y, CONTACT_Z);
    const dy = project(x, y + EPS, CONTACT_Z);

    // The Jacobian: how far the screen point moves per metre, on each axis.
    const a = (dx.x - at.x) / EPS;
    const b = (dy.x - at.x) / EPS;
    const c = (dx.y - at.y) / EPS;
    const d = (dy.y - at.y) / EPS;
    const det = a * d - b * c;
    // A degenerate Jacobian means the camera is edge-on to the plate or looking
    // somewhere else entirely. There is no answer, so do not invent one.
    if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;

    const ex = sx - at.x;
    const ey = sy - at.y;
    x += (d * ex - b * ey) / det;
    y += (-c * ex + a * ey) / det;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  }

  // A tap that solves to somewhere absurd — behind the camera, in the upper
  // deck — is not a swing decision. The caller clamps to the legal range; this
  // only rejects answers that are evidence the solve went wrong.
  if (Math.abs(x) > 12 || y < -8 || y > 20) return null;
  return { x, y };
}
