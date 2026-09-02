export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  DEFAULT_TIMEZONE?: string;
  ADMIN_CACHE_TTL_SECONDS?: string;
}

export interface Activity {
  key: string;
  label: string;
  base_points: number;
  active: number;
  sort_order: number;
}

export interface Intensity {
  key: string;
  label: string;
  multiplier: number;
  active: number;
  sort_order: number;
}

export interface Duration {
  key: string;
  label: string;
  multiplier: number;
  active: number;
  sort_order: number;
}

export interface Group {
  telegram_chat_id: number;
  title: string | null;
  timezone: string;
  created_at: string;
}

export interface ScoreEvent {
  id: number;
  telegram_chat_id: number;
  telegram_user_id: number;
  activity_key: string;
  intensity_key: string;
  duration_key: string;
  points: number;
  source_message_id: number | null;
  created_at: string;
  voided_at: string | null;
  voided_by_user_id: number | null;
}

/** One person's standing on a scoreboard, before ranking. */
export interface BoardRow {
  user_id: number;
  name: string;
  total: number;
}

/** A BoardRow with its competition rank (ties share a rank). */
export interface RankedRow extends BoardRow {
  rank: number;
}
