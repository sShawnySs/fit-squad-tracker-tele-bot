import type { Activity, Intensity } from "./types.js";

/**
 * points = round(base_points x multiplier)
 *
 * The resolved value is written onto the score_event row. Editing base_points or
 * a multiplier later changes future logs only — history is never recomputed.
 */
export function computePoints(basePoints: number, multiplier: number): number {
  return Math.round(basePoints * multiplier);
}

export function scoreFor(activity: Activity, intensity: Intensity): number {
  return computePoints(activity.base_points, intensity.multiplier);
}

/** Renders "1.5x" / "2x" without trailing-zero noise. */
export function formatMultiplier(multiplier: number): string {
  return `${Number(multiplier.toFixed(2))}x`;
}
