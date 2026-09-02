import type {
  Activity,
  BoardRow,
  Group,
  Intensity,
  ScoreEvent,
} from "./types.js";

/**
 * Every read filters `voided_at IS NULL`. Totals are always SUM()ed on demand —
 * there is no stored running total anywhere in this schema.
 */

const DISPLAY_NAME_SQL = `COALESCE(NULLIF(u.display_name, ''), NULLIF(u.username, ''), 'User ' || e.telegram_user_id)`;

export async function upsertUser(
  db: D1Database,
  userId: number,
  username: string | null,
  displayName: string | null,
  nowIso: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (telegram_user_id, username, display_name, updated_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(telegram_user_id) DO UPDATE SET
         username = excluded.username,
         display_name = excluded.display_name,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, username, displayName, nowIso)
    .run();
}

export async function ensureGroup(
  db: D1Database,
  chatId: number,
  title: string | null,
  defaultTimezone: string,
  nowIso: string,
): Promise<Group> {
  await db
    .prepare(
      `INSERT INTO groups (telegram_chat_id, title, timezone, created_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(telegram_chat_id) DO UPDATE SET title = excluded.title`,
    )
    .bind(chatId, title, defaultTimezone, nowIso)
    .run();

  const group = await getGroup(db, chatId);
  if (!group) throw new Error(`group ${chatId} missing after upsert`);
  return group;
}

export function getGroup(db: D1Database, chatId: number): Promise<Group | null> {
  return db
    .prepare(`SELECT * FROM groups WHERE telegram_chat_id = ?1`)
    .bind(chatId)
    .first<Group>();
}

export async function listActivities(db: D1Database): Promise<Activity[]> {
  const { results } = await db
    .prepare(
      `SELECT key, label, base_points, active, sort_order FROM activities
       WHERE active = 1 ORDER BY sort_order, key`,
    )
    .all<Activity>();
  return results ?? [];
}

export async function listIntensities(db: D1Database): Promise<Intensity[]> {
  const { results } = await db
    .prepare(
      `SELECT key, label, multiplier, active, sort_order FROM intensities
       WHERE active = 1 ORDER BY sort_order, key`,
    )
    .all<Intensity>();
  return results ?? [];
}

export function getActivity(db: D1Database, key: string): Promise<Activity | null> {
  return db
    .prepare(
      `SELECT key, label, base_points, active, sort_order FROM activities
       WHERE key = ?1 AND active = 1`,
    )
    .bind(key)
    .first<Activity>();
}

export function getIntensity(db: D1Database, key: string): Promise<Intensity | null> {
  return db
    .prepare(
      `SELECT key, label, multiplier, active, sort_order FROM intensities
       WHERE key = ?1 AND active = 1`,
    )
    .bind(key)
    .first<Intensity>();
}

export interface LogResult {
  /** false when this source_message_id was already logged (a Telegram retry). */
  inserted: boolean;
  event: ScoreEvent;
}

/**
 * Writes one ledger row. The unique index on (chat_id, source_message_id) makes
 * this idempotent, so a retried update can never double-count.
 */
export async function insertScoreEvent(
  db: D1Database,
  input: {
    chatId: number;
    userId: number;
    activityKey: string;
    intensityKey: string;
    points: number;
    sourceMessageId: number | null;
    nowIso: string;
  },
): Promise<LogResult> {
  const inserted = await db
    .prepare(
      `INSERT INTO score_events
         (telegram_chat_id, telegram_user_id, activity_key, intensity_key,
          points, source_message_id, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (telegram_chat_id, source_message_id) DO NOTHING
       RETURNING *`,
    )
    .bind(
      input.chatId,
      input.userId,
      input.activityKey,
      input.intensityKey,
      input.points,
      input.sourceMessageId,
      input.nowIso,
    )
    .first<ScoreEvent>();

  if (inserted) return { inserted: true, event: inserted };

  const existing = await db
    .prepare(
      `SELECT * FROM score_events
       WHERE telegram_chat_id = ?1 AND source_message_id = ?2`,
    )
    .bind(input.chatId, input.sourceMessageId)
    .first<ScoreEvent>();

  if (!existing) throw new Error("insert reported a conflict but no row was found");
  return { inserted: false, event: existing };
}

export async function getUserTotal(
  db: D1Database,
  chatId: number,
  userId: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(points), 0) AS total FROM score_events
       WHERE telegram_chat_id = ?1 AND telegram_user_id = ?2 AND voided_at IS NULL`,
    )
    .bind(chatId, userId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export async function getUserRecentEvents(
  db: D1Database,
  chatId: number,
  userId: number,
  limit = 5,
): Promise<ScoreEvent[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM score_events
       WHERE telegram_chat_id = ?1 AND telegram_user_id = ?2 AND voided_at IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT ?3`,
    )
    .bind(chatId, userId, limit)
    .all<ScoreEvent>();
  return results ?? [];
}

/** Ranked standings. `sinceIso` null = all time. */
export async function getBoard(
  db: D1Database,
  chatId: number,
  sinceIso: string | null = null,
): Promise<BoardRow[]> {
  const sql = `
    SELECT e.telegram_user_id AS user_id,
           ${DISPLAY_NAME_SQL} AS name,
           SUM(e.points) AS total
    FROM score_events e
    LEFT JOIN users u ON u.telegram_user_id = e.telegram_user_id
    WHERE e.telegram_chat_id = ?1
      AND e.voided_at IS NULL
      ${sinceIso ? "AND e.created_at >= ?2" : ""}
    GROUP BY e.telegram_user_id
    ORDER BY total DESC, name ASC`;

  const statement = sinceIso
    ? db.prepare(sql).bind(chatId, sinceIso)
    : db.prepare(sql).bind(chatId);
  const { results } = await statement.all<BoardRow>();
  return results ?? [];
}

export function getScoreEvent(
  db: D1Database,
  chatId: number,
  eventId: number,
): Promise<ScoreEvent | null> {
  return db
    .prepare(`SELECT * FROM score_events WHERE id = ?1 AND telegram_chat_id = ?2`)
    .bind(eventId, chatId)
    .first<ScoreEvent>();
}

export type VoidOutcome =
  | { status: "voided"; event: ScoreEvent }
  | { status: "not_found" }
  | { status: "already_voided"; event: ScoreEvent };

/** Corrections void, never delete. */
export async function voidScoreEvent(
  db: D1Database,
  chatId: number,
  eventId: number,
  voidedByUserId: number,
  nowIso: string,
): Promise<VoidOutcome> {
  const existing = await getScoreEvent(db, chatId, eventId);
  if (!existing) return { status: "not_found" };
  if (existing.voided_at) return { status: "already_voided", event: existing };

  const updated = await db
    .prepare(
      `UPDATE score_events
       SET voided_at = ?1, voided_by_user_id = ?2
       WHERE id = ?3 AND telegram_chat_id = ?4 AND voided_at IS NULL
       RETURNING *`,
    )
    .bind(nowIso, voidedByUserId, eventId, chatId)
    .first<ScoreEvent>();

  if (!updated) {
    const current = await getScoreEvent(db, chatId, eventId);
    return current ? { status: "already_voided", event: current } : { status: "not_found" };
  }
  return { status: "voided", event: updated };
}

export async function getDisplayName(
  db: D1Database,
  userId: number,
): Promise<string> {
  const row = await db
    .prepare(
      `SELECT COALESCE(NULLIF(display_name, ''), NULLIF(username, ''), 'User ' || telegram_user_id) AS name
       FROM users WHERE telegram_user_id = ?1`,
    )
    .bind(userId)
    .first<{ name: string }>();
  return row?.name ?? `User ${userId}`;
}

/* ---------------------------------------------------------------- admins --- */

export interface AdminCache {
  fetchedAt: string | null;
  adminIds: number[];
}

export async function readAdminCache(
  db: D1Database,
  chatId: number,
): Promise<AdminCache> {
  const meta = await db
    .prepare(`SELECT fetched_at FROM chat_admin_cache WHERE telegram_chat_id = ?1`)
    .bind(chatId)
    .first<{ fetched_at: string }>();
  if (!meta) return { fetchedAt: null, adminIds: [] };

  const { results } = await db
    .prepare(`SELECT telegram_user_id FROM chat_admins WHERE telegram_chat_id = ?1`)
    .bind(chatId)
    .all<{ telegram_user_id: number }>();

  return {
    fetchedAt: meta.fetched_at,
    adminIds: (results ?? []).map((r) => r.telegram_user_id),
  };
}

export async function writeAdminCache(
  db: D1Database,
  chatId: number,
  adminIds: number[],
  nowIso: string,
): Promise<void> {
  const statements = [
    db.prepare(`DELETE FROM chat_admins WHERE telegram_chat_id = ?1`).bind(chatId),
    ...adminIds.map((id) =>
      db
        .prepare(
          `INSERT INTO chat_admins (telegram_chat_id, telegram_user_id) VALUES (?1, ?2)
           ON CONFLICT DO NOTHING`,
        )
        .bind(chatId, id),
    ),
    db
      .prepare(
        `INSERT INTO chat_admin_cache (telegram_chat_id, fetched_at) VALUES (?1, ?2)
         ON CONFLICT(telegram_chat_id) DO UPDATE SET fetched_at = excluded.fetched_at`,
      )
      .bind(chatId, nowIso),
  ];
  await db.batch(statements);
}

/* ------------------------------------------------------------ chat state --- */

export async function getLastTemplateIndex(
  db: D1Database,
  chatId: number,
): Promise<number | null> {
  const row = await db
    .prepare(`SELECT last_template_index FROM chat_state WHERE telegram_chat_id = ?1`)
    .bind(chatId)
    .first<{ last_template_index: number | null }>();
  return row?.last_template_index ?? null;
}

export async function setLastTemplateIndex(
  db: D1Database,
  chatId: number,
  index: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO chat_state (telegram_chat_id, last_template_index) VALUES (?1, ?2)
       ON CONFLICT(telegram_chat_id) DO UPDATE SET last_template_index = excluded.last_template_index`,
    )
    .bind(chatId, index)
    .run();
}

/** Every chat the bot has been started in — the cron fans out over these. */
export async function listGroups(db: D1Database): Promise<Group[]> {
  const { results } = await db.prepare(`SELECT * FROM groups`).all<Group>();
  return results ?? [];
}
