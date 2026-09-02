/**
 * Pure helpers for the /log flow: callback-data encoding and argument parsing.
 * Kept out of bot.ts so both are testable without a Telegram client.
 *
 * Callback data is capped at 64 bytes by Telegram, so the encoding stays terse:
 *   log:a:<uid>                        activity picker was shown
 *   log:i:<uid>:<activity>             intensity picker
 *   log:c:<uid>:<activity>:<intensity> confirm
 *   log:x:<uid>                        cancel
 * The initiating user id rides along so nobody can press someone else's buttons.
 */

export type LogCallback =
  | { step: "activity"; userId: number; activityKey: string }
  | { step: "intensity"; userId: number; activityKey: string; intensityKey: string }
  | { step: "confirm"; userId: number; activityKey: string; intensityKey: string }
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

export function encodeConfirm(
  userId: number,
  activityKey: string,
  intensityKey: string,
): string {
  return `${CB_PREFIX}:c:${userId}:${activityKey}:${intensityKey}`;
}

export function encodeCancel(userId: number): string {
  return `${CB_PREFIX}:x:${userId}`;
}

export function parseCallback(data: string): LogCallback | null {
  const parts = data.split(":");
  if (parts[0] !== CB_PREFIX) return null;
  const step = parts[1];
  const userId = Number(parts[2]);
  if (!Number.isFinite(userId)) return null;

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
  if (step === "c" && parts[3] && parts[4]) {
    return {
      step: "confirm",
      userId,
      activityKey: parts[3],
      intensityKey: parts[4],
    };
  }
  if (step === "x") return { step: "cancel", userId };
  return null;
}

export interface ParsedLogArgs {
  activityKey: string | null;
  intensityKey: string | null;
  extra: string[];
}

/**
 * `/log run hard` -> { run, hard }. Order-insensitive matching happens in the
 * handler against the live key lists; here we only tokenise.
 */
export function parseLogArgs(raw: string): ParsedLogArgs {
  const tokens = raw
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  return {
    activityKey: tokens[0] ?? null,
    intensityKey: tokens[1] ?? null,
    extra: tokens.slice(2),
  };
}

/**
 * Resolves two tokens against the valid key lists in either order, so both
 * `/log run hard` and `/log hard run` work.
 */
export function matchLogArgs(
  tokens: string[],
  activityKeys: string[],
  intensityKeys: string[],
): { activityKey: string | null; intensityKey: string | null } {
  let activityKey: string | null = null;
  let intensityKey: string | null = null;
  for (const token of tokens) {
    if (!activityKey && activityKeys.includes(token)) activityKey = token;
    else if (!intensityKey && intensityKeys.includes(token)) intensityKey = token;
  }
  return { activityKey, intensityKey };
}
