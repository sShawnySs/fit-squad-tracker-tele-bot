-- 0003_template_state_by_bucket.sql
-- Confirmation copy is now bucketed by intensity, so "don't repeat the last
-- line" has to be tracked per (chat, bucket) rather than per chat.

CREATE TABLE IF NOT EXISTS chat_template_state (
  telegram_chat_id    INTEGER NOT NULL,
  bucket              TEXT    NOT NULL,
  last_template_index INTEGER,
  PRIMARY KEY (telegram_chat_id, bucket)
);

-- The old single-pointer table held nothing but a cosmetic "last line used"
-- value, so there is nothing worth migrating out of it.
DROP TABLE IF EXISTS chat_state;
