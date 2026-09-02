-- 0002_seed_scoring.sql — scoring values live in the database, not in code.
--
-- points = round(base_points × intensity multiplier × duration multiplier)
-- Range: 3 (cardio/strength, light, quick) to 32 (sport, max, long).
--
-- To change a value later:
--   npx wrangler d1 execute scoreboard --remote \
--     --command "UPDATE activities SET base_points = 8 WHERE key = 'sport'"
-- Past score_events keep the points they were written with.
--
-- These INSERTs are ON CONFLICT DO NOTHING on purpose: re-running migrations
-- must not clobber values edited live in production. To change a seed value in
-- a database that already has it, run an UPDATE.

INSERT INTO activities (key, label, base_points, active, sort_order) VALUES
  ('cardio',   'Cardio',   6, 1, 1),
  ('strength', 'Strength', 6, 1, 2),
  ('sport',    'Sport',    7, 1, 3)
ON CONFLICT(key) DO NOTHING;

INSERT INTO intensities (key, label, multiplier, active, sort_order) VALUES
  ('light',    'Light',    1.0, 1, 1),
  ('moderate', 'Moderate', 1.4, 1, 2),
  ('hard',     'Hard',     1.8, 1, 3),
  ('max',      'Max',      2.3, 1, 4)
ON CONFLICT(key) DO NOTHING;

INSERT INTO durations (key, label, multiplier, active, sort_order) VALUES
  ('quick',    '<15 min',   0.5, 1, 1),
  ('short',    '15–30 min', 1.0, 1, 2),
  ('standard', '30–60 min', 1.5, 1, 3),
  ('long',     '60+ min',   2.0, 1, 4)
ON CONFLICT(key) DO NOTHING;
