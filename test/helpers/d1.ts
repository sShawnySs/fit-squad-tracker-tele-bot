/**
 * Test database: real SQLite in memory with every migration applied, behind the
 * D1 interface. The shim itself lives in dev/local-d1.ts because the local
 * polling runner uses the same one.
 */
import { openLocalD1 } from "../../dev/local-d1.js";

export function createTestDb(): D1Database {
  return openLocalD1(":memory:");
}

/** Convenience: register a group and members the way /start and touch() do. */
export async function seedChat(
  db: D1Database,
  chatId: number,
  users: { id: number; name: string }[],
  timezone = "Asia/Singapore",
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO groups (telegram_chat_id, title, timezone, created_at)
       VALUES (?1, ?2, ?3, ?4) ON CONFLICT(telegram_chat_id) DO NOTHING`,
    )
    .bind(chatId, "Test group", timezone, now)
    .run();

  for (const user of users) {
    await db
      .prepare(
        `INSERT INTO users (telegram_user_id, username, display_name, updated_at)
         VALUES (?1, ?2, ?3, ?4) ON CONFLICT(telegram_user_id) DO UPDATE SET
           display_name = excluded.display_name`,
      )
      .bind(user.id, user.name.toLowerCase(), user.name, now)
      .run();
  }
}
