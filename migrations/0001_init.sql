-- 0001_init.sql — core schema.
-- Single group for now, but every row is scoped by telegram_chat_id from day one
-- so adding cross-posting later is a new table, not a migration on live data.

CREATE TABLE IF NOT EXISTS users (
  telegram_user_id INTEGER PRIMARY KEY,
  username         TEXT,
  display_name     TEXT,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  telegram_chat_id INTEGER PRIMARY KEY,
  title            TEXT,
  timezone         TEXT NOT NULL DEFAULT 'Asia/Singapore',
  created_at       TEXT NOT NULL
);

-- The three scoring axes. All three are data, not code: point values can be
-- changed with a SQL statement and no deploy.
CREATE TABLE IF NOT EXISTS activities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  base_points INTEGER NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS intensities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  multiplier REAL NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS durations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  multiplier REAL NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- The ledger. Append-only: corrections void, they never delete.
-- The three keys are kept alongside the resolved points so that editing a
-- base value or a multiplier later never rewrites history.
CREATE TABLE IF NOT EXISTS score_events (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_chat_id   INTEGER NOT NULL,
  telegram_user_id   INTEGER NOT NULL,
  activity_key       TEXT    NOT NULL,
  intensity_key      TEXT    NOT NULL,
  duration_key       TEXT    NOT NULL DEFAULT 'standard',
  points             INTEGER NOT NULL,
  source_message_id  INTEGER,
  created_at         TEXT    NOT NULL,
  voided_at          TEXT,
  voided_by_user_id  INTEGER
);

-- Telegram retries updates when a webhook is slow. One log per source message.
CREATE UNIQUE INDEX IF NOT EXISTS idx_score_events_dedupe
  ON score_events (telegram_chat_id, source_message_id);

-- Serves /me and every scoreboard query.
CREATE INDEX IF NOT EXISTS idx_score_events_lookup
  ON score_events (telegram_chat_id, telegram_user_id, created_at);

-- Cached getChatAdministrators result; refreshed on a TTL, never hand-maintained.
CREATE TABLE IF NOT EXISTS chat_admins (
  telegram_chat_id INTEGER NOT NULL,
  telegram_user_id INTEGER NOT NULL,
  PRIMARY KEY (telegram_chat_id, telegram_user_id)
);

CREATE TABLE IF NOT EXISTS chat_admin_cache (
  telegram_chat_id INTEGER PRIMARY KEY,
  fetched_at       TEXT NOT NULL
);
