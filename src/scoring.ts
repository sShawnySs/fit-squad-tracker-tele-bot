import type { Activity, Duration, Intensity } from "./types.js";

/**
 * points = round(base_points × intensity multiplier × duration multiplier)
 *
 * Three axes because collapsing the activity list down to cardio / strength /
 * sport loses the difference between a 10-minute effort and an hour of the same
 * thing. Duration puts that back.
 *
 * The resolved value is written onto the score_event row. Editing a base value
 * or a multiplier later changes future logs only — history is never recomputed.
 */
export function computePoints(
  basePoints: number,
  intensityMultiplier: number,
  durationMultiplier: number,
): number {
  return Math.round(basePoints * intensityMultiplier * durationMultiplier);
}

export function scoreFor(
  activity: Activity,
  intensity: Intensity,
  duration: Duration,
): number {
  return computePoints(activity.base_points, intensity.multiplier, duration.multiplier);
}

/** Renders "1.4x" / "2x" without trailing-zero noise. */
export function formatMultiplier(multiplier: number): string {
  return `${Number(multiplier.toFixed(2))}x`;
}

/** The duration used when someone skips the step or uses the shorthand. */
export const DEFAULT_DURATION_KEY = "standard";
