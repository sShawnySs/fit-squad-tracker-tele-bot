/**
 * A minimal D1Database implemented over node:sqlite.
 *
 * Two jobs:
 *  - the test suite runs the real query layer against real SQLite in memory
 *  - `npm run dev:polling` runs the real bot against a local SQLite file,
 *    so you can use the bot before any Cloudflare setup exists
 *
 * Requires Node 22.5+ (node:sqlite). It is not used by the deployed Worker,
 * which talks to D1 directly.
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
const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url).href);

type Param = string | number | null;

class LocalStatement {
  constructor(
    private readonly db: DatabaseSyncLike,
    private readonly sql: string,
    private readonly params: Param[] = [],
  ) {}

  bind(...params: Param[]): LocalStatement {
    return new LocalStatement(this.db, this.sql, params);
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

class LocalD1 {
  constructor(private readonly db: DatabaseSyncLike) {}

  prepare(sql: string): LocalStatement {
    return new LocalStatement(this.db, sql);
  }

  async batch<T = unknown>(statements: LocalStatement[]): Promise<T[]> {
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

/**
 * Opens a database and applies every migration in order. `:memory:` for tests,
 * a file path for the local runner. Migrations are written to be re-runnable.
 */
export function openLocalD1(path = ":memory:"): D1Database {
  const sqlite = new DatabaseSync(path);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  return new LocalD1(sqlite) as unknown as D1Database;
}
