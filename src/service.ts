/**
 * Everything the bot does to the database, expressed without any Telegram
 * plumbing. bot.ts is glue; this is where the rules live, and it is what the
 * tests exercise.
 */

import { escapeHtml } from "./html.js";
import * as repo from "./repo.js";
import { scoreFor } from "./scoring.js";
import {
  formatBoardMessage,
  formatWeeklyMessage,
  BOARD_LIMIT,
} from "./scoreboard.js";
import {
  bucketFor,
  pickTemplateIndex,
  renderTemplate,
  templatesFor,
} from "./templates.js";
import { formatDateTimeInZone, formatDayInZone, lastSevenDays, safeTimeZone } from "./time.js";
import type { Activity, Intensity, ScoreEvent } from "./types.js";

export type LogOutcome =
  | { status: "unknown_activity"; activityKey: string }
  | { status: "unknown_intensity"; intensityKey: string }
  | {
      status: "logged" | "duplicate";
      event: ScoreEvent;
      activity: Activity;
      intensity: Intensity;
    };

export async function logActivity(
  db: D1Database,
  input: {
    chatId: number;
    userId: number;
    activityKey: string;
    intensityKey: string;
    sourceMessageId: number | null;
    now?: Date;
  },
): Promise<LogOutcome> {
  const activity = await repo.getActivity(db, input.activityKey);
  if (!activity) return { status: "unknown_activity", activityKey: input.activityKey };

  const intensity = await repo.getIntensity(db, input.intensityKey);
  if (!intensity)
    return { status: "unknown_intensity", intensityKey: input.intensityKey };

  const points = scoreFor(activity, intensity);
  const nowIso = (input.now ?? new Date()).toISOString();

  const result = await repo.insertScoreEvent(db, {
    chatId: input.chatId,
    userId: input.userId,
    activityKey: activity.key,
    intensityKey: intensity.key,
    points,
    sourceMessageId: input.sourceMessageId,
    nowIso,
  });

  return {
    status: result.inserted ? "logged" : "duplicate",
    event: result.event,
    activity,
    intensity,
  };
}

export type VoidOutcome =
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "already_voided"; event: ScoreEvent }
  | { status: "voided"; event: ScoreEvent };

/**
 * /void is admin-only. The caller passes the already-resolved admin verdict so
 * this stays free of network calls.
 */
export async function voidEvent(
  db: D1Database,
  input: {
    chatId: number;
    requesterId: number;
    requesterIsAdmin: boolean;
    eventId: number;
    now?: Date;
  },
): Promise<VoidOutcome> {
  if (!input.requesterIsAdmin) return { status: "forbidden" };

  const nowIso = (input.now ?? new Date()).toISOString();
  const result = await repo.voidScoreEvent(
    db,
    input.chatId,
    input.eventId,
    input.requesterId,
    nowIso,
  );

  if (result.status === "not_found") return { status: "not_found" };
  if (result.status === "already_voided")
    return { status: "already_voided", event: result.event };
  return { status: "voided", event: result.event };
}

/**
 * Picks a line from the bucket matching the effort, never repeating the last
 * one used in this chat for that bucket, and renders it.
 */
export async function buildConfirmation(
  db: D1Database,
  input: {
    chatId: number;
    name: string;
    activity: Activity;
    intensity: Intensity;
    points: number;
    random?: () => number;
  },
): Promise<string> {
  const bucket = bucketFor(input.intensity);
  const lastIndex = await repo.getLastTemplateIndex(db, input.chatId, bucket);
  const index = pickTemplateIndex(
    lastIndex,
    input.random ?? Math.random,
    templatesFor(bucket).length,
  );
  await repo.setLastTemplateIndex(db, input.chatId, bucket, index);

  return renderTemplate(bucket, index, {
    name: escapeHtml(input.name),
    activity: input.activity.label.toLowerCase(),
    intensity: input.intensity.label.toLowerCase(),
    points: input.points,
  });
}

export async function buildBoard(
  db: D1Database,
  chatId: number,
  limit = BOARD_LIMIT,
): Promise<string> {
  const rows = await repo.getBoard(db, chatId, null);
  return formatBoardMessage(rows, limit);
}

export async function buildWeekly(
  db: D1Database,
  chatId: number,
  timezone: string,
  now: Date = new Date(),
  limit = BOARD_LIMIT,
): Promise<string> {
  const zone = safeTimeZone(timezone);
  const window = lastSevenDays(now);
  const [weekRows, allTimeRows] = await Promise.all([
    repo.getBoard(db, chatId, window.startIso),
    repo.getBoard(db, chatId, null),
  ]);
  const label = `${formatDayInZone(window.startIso, zone)} to ${formatDayInZone(
    window.endIso,
    zone,
  )}`;
  return formatWeeklyMessage(weekRows, allTimeRows, label, limit);
}

export async function buildMe(
  db: D1Database,
  input: { chatId: number; userId: number; name: string; timezone: string },
): Promise<string> {
  const zone = safeTimeZone(input.timezone);
  const [total, recent] = await Promise.all([
    repo.getUserTotal(db, input.chatId, input.userId),
    repo.getUserRecentEvents(db, input.chatId, input.userId, 5),
  ]);

  const header = `<b>${escapeHtml(input.name)}</b> — ${total} pts`;
  if (recent.length === 0) {
    return `${header}\nNothing logged yet. Start with /log`;
  }

  const lines = recent.map(
    (e) =>
      `#${e.id} · ${formatDateTimeInZone(e.created_at, zone)} — ${escapeHtml(
        e.intensity_key,
      )} ${escapeHtml(e.activity_key)} · ${e.points} pts`,
  );
  return `${header}\n<b>Last ${recent.length}:</b>\n${lines.join("\n")}`;
}

export async function buildActivityList(db: D1Database): Promise<string> {
  const [activities, intensities] = await Promise.all([
    repo.listActivities(db),
    repo.listIntensities(db),
  ]);

  const activityLines = activities.map(
    (a) => `<code>${escapeHtml(a.key)}</code> — ${escapeHtml(a.label)}, ${a.base_points} base`,
  );
  const intensityLines = intensities.map(
    (i) =>
      `<code>${escapeHtml(i.key)}</code> — ${escapeHtml(i.label)}, x${Number(
        i.multiplier.toFixed(2),
      )}`,
  );

  return [
    "<b>Activities</b>",
    activityLines.join("\n") || "none",
    "",
    "<b>Intensities</b>",
    intensityLines.join("\n") || "none",
    "",
    "points = base × multiplier. Log with /log, or straight up: <code>/log run hard</code>",
  ].join("\n");
}
