/**
 * Pure helpers for the /log flow: callback-data encoding and argument parsing.
 * Kept out of bot.ts so both are testable without a Telegram client.
 *
 * Callback data is capped at 64 bytes by Telegram, so the encoding stays terse:
 *   log:a:<uid>                              activity picked -> ask intensity
 *   log:i:<uid>:<activity>:<intensity>       intensity picked -> ask duration
 *   log:d:<uid>:<activity>:<intensity>:<dur> duration picked -> confirm screen
 *   log:c:<uid>:<activity>:<intensity>:<dur> confirmed -> write the row
 *   log:x:<uid>                              cancel
 * The initiating user id rides along so nobody can press someone else's buttons.
 * Worst case today: log:c:<10 digits>:strength:moderate:standard = 43 bytes.
 */

export type LogCallback =
  | { step: "activity"; userId: number; activityKey: string }
  | { step: "intensity"; userId: number; activityKey: string; intensityKey: string }
  | {
      step: "duration";
      userId: number;
      activityKey: string;
      intensityKey: string;
      durationKey: string;
    }
  | {
      step: "confirm";
      userId: number;
      activityKey: string;
      intensityKey: string;
      durationKey: string;
    }
  | { step: "cancel"; userId: number };

export const CB_PREFIX = "log";

export function encodeActivityPick(userId: number, activityKey: string): string {
  return `${CB_PREFIX}:a:${userId}:${activityKey}`;
}

export function encodeIntensityPick(
  userId: number,
  activityKey: string,
  intensityKey: string,
): string {
  return `${CB_PREFIX}:i:${userId}:${activityKey}:${intensityKey}`;
}

export function encodeDurationPick(
  userId: number,
  activityKey: string,
  intensityKey: string,
  durationKey: string,
): string {
  return `${CB_PREFIX}:d:${userId}:${activityKey}:${intensityKey}:${durationKey}`;
}

export function encodeConfirm(
  userId: number,
  activityKey: string,
  intensityKey: string,
  durationKey: string,
): string {
  return `${CB_PREFIX}:c:${userId}:${activityKey}:${intensityKey}:${durationKey}`;
}

export function encodeCancel(userId: number): string {
  return `${CB_PREFIX}:x:${userId}`;
}

export function parseCallback(data: string): LogCallback | null {
  const parts = data.split(":");
  if (parts[0] !== CB_PREFIX) return null;
  const step = parts[1];
  const userId = Number(parts[2]);
  if (!Number.isInteger(userId)) return null;

  if (step === "a" && parts[3]) {
    return { step: "activity", userId, activityKey: parts[3] };
  }
  if (step === "i" && parts[3] && parts[4]) {
    return {
      step: "intensity",
      userId,
      activityKey: parts[3],
      intensityKey: parts[4],
    };
  }
  if ((step === "d" || step === "c") && parts[3] && parts[4] && parts[5]) {
    return {
      step: step === "d" ? "duration" : "confirm",
      userId,
      activityKey: parts[3],
      intensityKey: parts[4],
      durationKey: parts[5],
    };
  }
  if (step === "x") return { step: "cancel", userId };
  return null;
}

export interface MatchedLogArgs {
  activityKey: string | null;
  intensityKey: string | null;
  /** null means "not specified" — the caller applies the default. */
  durationKey: string | null;
  unknown: string[];
}

/**
 * Resolves the shorthand's tokens against the live key lists, in any order, so
 * `/log cardio hard`, `/log hard cardio` and `/log sport max long` all work.
 * Duration is optional; the caller defaults it.
 */
export function matchLogArgs(
  tokens: string[],
  activityKeys: string[],
  intensityKeys: string[],
  durationKeys: string[] = [],
): MatchedLogArgs {
  let activityKey: string | null = null;
  let intensityKey: string | null = null;
  let durationKey: string | null = null;
  const unknown: string[] = [];

  for (const token of tokens) {
    if (!activityKey && activityKeys.includes(token)) activityKey = token;
    else if (!intensityKey && intensityKeys.includes(token)) intensityKey = token;
    else if (!durationKey && durationKeys.includes(token)) durationKey = token;
    else unknown.push(token);
  }

  return { activityKey, intensityKey, durationKey, unknown };
}
