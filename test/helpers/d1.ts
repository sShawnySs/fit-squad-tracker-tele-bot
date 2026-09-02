/**
 * A minimal D1Database over node:sqlite, so the query layer is tested against
 * real SQLite (real indexes, real ON CONFLICT) without booting a Worker.
 * Requires Node 22.5+ for `node:sqlite`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Loaded through createRequire: node:sqlite is still flagged experimental and
// Vite's bundler does not know it as a builtin.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string) => DatabaseSyncLike;
};

interface StatementLike {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}

interface DatabaseSyncLike {
  exec(sql: string): void;
  prepare(sql: string): StatementLike;
}

// .href keeps this a plain string: the Workers and Node URL types both exist
// in this file's scope and are not assignable to each other.
const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url).href);

type Param = string | number | null;

class FakeStatement {
  constructor(
    private readonly db: DatabaseSyncLike,
    private readonly sql: string,
    private readonly params: Param[] = [],
  ) {}

  bind(...params: Param[]): FakeStatement {
    return new FakeStatement(this.db, this.sql, params);
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    const plain = { ...row } as Record<string, unknown>;
    return (column ? (plain[column] as T) : (plain as T)) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true }> {
    const rows = this.db.prepare(this.sql).all(...this.params) as Record<
      string,
      unknown
    >[];
    return { results: rows.map((r) => ({ ...r }) as T), success: true };
  }

  async run(): Promise<{ success: true; meta: { changes: number; last_row_id: number } }> {
    const info = this.db.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(info.changes),
        last_row_id: Number(info.lastInsertRowid),
      },
    };
  }
}

class FakeD1 {
  constructor(private readonly db: DatabaseSyncLike) {}

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this.db, sql);
  }

  async batch<T = unknown>(statements: FakeStatement[]): Promise<T[]> {
    const out: unknown[] = [];
    this.db.exec("BEGIN");
    try {
      for (const statement of statements) out.push(await statement.run());
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return out as T[];
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    this.db.exec(sql);
    return { count: 0, duration: 0 };
  }
}

/** Fresh in-memory database with every migration (including seeds) applied. */
export function createTestDb(): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  return new FakeD1(sqlite) as unknown as D1Database;
}

/** Convenience: register a group and a member the way /start and touch() do. */
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
