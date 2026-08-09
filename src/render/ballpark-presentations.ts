import { BALLPARK_ASSETS } from '../ballpark/assets';
import type { BallparkPresentationV1 } from '../ballpark/contract';

/** Renderer-only lookup. Simulation receives the compiled native Stadium only. */
export const BALLPARK_PRESENTATION_BY_ID: Readonly<Record<string, BallparkPresentationV1>> =
  Object.freeze(
    Object.fromEntries(
      BALLPARK_ASSETS.flatMap((asset) =>
        asset.presentation ? [[asset.stadium.id, asset.presentation] as const] : [],
      ),
    ),
  );

export function getBallparkPresentation(stadiumId: string): BallparkPresentationV1 | undefined {
  return BALLPARK_PRESENTATION_BY_ID[stadiumId];
}
