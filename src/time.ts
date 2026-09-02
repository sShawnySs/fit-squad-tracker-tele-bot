/**
 * Timestamps are stored as UTC ISO strings and rendered in the group's timezone.
 * Everything here is pure so it can be tested without a Worker.
 */

export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

export interface Window {
  /** Inclusive lower bound, UTC ISO. */
  startIso: string;
  /** Exclusive upper bound, UTC ISO. */
  endIso: string;
}

/** The trailing 7-day window ending at `now`. */
export function lastSevenDays(now: Date = new Date()): Window {
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: now.toISOString() };
}

/** "25 Aug" in the group's timezone. */
export function formatDayInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}

/** "25 Aug, 09:14" in the group's timezone — used by /me. */
export function formatDateTimeInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** Falls back to UTC rather than throwing if a group has a bad timezone stored. */
export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "UTC";
  }
}
