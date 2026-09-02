-- 0002_seed_scoring.sql — scoring values live in the database, not in code.
-- To change a value later:
--   npx wrangler d1 execute scoreboard --remote \
--     --command "UPDATE activities SET base_points = 12 WHERE key = 'run'"
-- Past score_events keep the points they were written with.

INSERT INTO activities (key, label, base_points, active, sort_order) VALUES
  ('run',  'Run',  10, 1, 1),
  ('gym',  'Gym',  10, 1, 2),
  ('swim', 'Swim', 12, 1, 3),
  ('walk', 'Walk',  5, 1, 4)
ON CONFLICT(key) DO NOTHING;

INSERT INTO intensities (key, label, multiplier, active, sort_order) VALUES
  ('light',    'Light',    1.0, 1, 1),
  ('moderate', 'Moderate', 1.5, 1, 2),
  ('hard',     'Hard',     2.0, 1, 3)
ON CONFLICT(key) DO NOTHING;
