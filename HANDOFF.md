# Handoff

Written 2 Sep 2026, at the end of a Cowork session. Everything below is current
as of the last commit. Start here, then read `README.md` for setup and
operations detail.

## What this is

A Telegram bot for one group chat. Members log a workout, it scores it, stores
it, posts a confirmation in the group, and keeps a scoreboard — auto-posted
Monday morning and available on demand via `/score`.

Cloudflare Workers + D1 + grammY, webhook mode. TypeScript, strict. Nothing is
deployed to Cloudflare yet: everything so far has been tested by running the bot
on long polling against a local SQLite file.

Bot: **@fitsquadtracker_bot** (id 6893712070).

## What just changed — scoring model v2

The previous model was activity × intensity, with `run` / `gym` / `swim` /
`walk` and three intensities. It has been replaced end to end.

| | v1 | v2 |
|---|---|---|
| Activities | run, gym, swim, walk | **cardio (6), strength (6), sport (7)** |
| Intensities | light 1.0, moderate 1.5, hard 2.0 | **light 1.0, moderate 1.4, hard 1.8, max 2.3** |
| Duration | — | **quick 0.5, short 1.0, standard 1.5, long 2.0** |
| Formula | base × intensity | **round(base × intensity × duration)** |
| Range | 5–24 | **3–32** |

Why duration exists: collapsing the activity list to three broad categories lost
the difference between a ten-minute effort and an hour of the same thing.
Duration puts that back.

### Files touched in this change

- `migrations/0001_init.sql` — added the `durations` table and
  `score_events.duration_key` (`NOT NULL DEFAULT 'standard'`)
- `migrations/0002_seed_scoring.sql` — reseeded all three tables
- `src/scoring.ts` — `computePoints(base, intensity, duration)`, plus
  `DEFAULT_DURATION_KEY`
- `src/repo.ts` — `listDurations` / `getDuration`, `duration_key` on insert
- `src/service.ts` — `logActivity` takes an optional `durationKey`, new
  `unknown_duration` outcome; `/me` and `/activities` output rebuilt
- `src/log-flow.ts` — new `log:d:` callback step, `matchLogArgs` gained a
  duration axis and an `unknown` bucket
- `src/bot.ts` — duration keyboard with a **Skip** button, duration step in the
  callback handler, confirm screen shows the resolved points
- `src/templates.ts` — `{duration}` is now available to templates
- `test/*` — expected values updated throughout; new 48-combination matrix test

Migrations 0001 and 0002 were **edited in place** rather than layered with an
ALTER, because nothing is deployed and the only data was smoke-test rows. If you
have a stale `dev.sqlite` with v1 rows, delete it — it rebuilds on next start.

## The shape of the code

```
src/
  index.ts       Worker entry: webhook auth, fast ack via waitUntil, cron handler
  bot.ts         grammY handlers — thin glue, no rules
  service.ts     the rules: logging, voiding, building every message
  repo.ts        D1 queries, nothing else
  scoring.ts     points = round(base × intensity × duration)
  scoreboard.ts  ranking with ties, top-10 truncation, formatting
  templates.ts   30 confirmation lines in 3 intensity buckets
  log-flow.ts    callback-data encoding, /log shorthand parsing
  admin.ts       cached getChatAdministrators
  time.ts        UTC storage, group-timezone rendering
  html.ts        escaping — every message uses HTML parse mode
dev/
  local-d1.ts    D1 shim over node:sqlite; used by tests AND the local runner
  polling.ts     npm run dev:polling — the real bot, no Cloudflare needed
  weekly.ts      npm run dev:weekly — fire the Monday post on demand
```

**The rule that keeps this clean:** rules go in `service.ts`, Telegram plumbing
goes in `bot.ts`. The tests exercise `service.ts` directly, which is why they
run in milliseconds with no mocking.

## Things that will bite you if you don't know them

- **HTML parse mode everywhere.** No `<`, `>` or `&` in confirmation copy — a
  test enforces it. The `<15 min` duration label is real and must stay escaped
  wherever it is printed; `escapeHtml` is not optional on any user or DB string.
- **Points are frozen on the row.** `score_events` stores all three keys *and*
  the resolved `points`. Changing a multiplier later must never rewrite history;
  there is a test for this.
- **Corrections void, never delete.** Every read filters `voided_at IS NULL`.
  Totals are always `SUM()` on demand — there is no stored running total.
- **Seed INSERTs are `ON CONFLICT DO NOTHING`** so re-running migrations can't
  clobber a value edited live in production. To change a seeded value in a
  database that already has it, run an `UPDATE`.
- **Callback data is capped at 64 bytes.** Current worst case is 43. The
  initiating user id is embedded so nobody can press someone else's buttons.
- **Answer every callback query**, or the client spins forever.
- **`source_message_id` is the dedupe key**, unique per `(chat, message)`. In the
  button flow it is the bot's own prompt message id — one `/log`, one row.
- **`chat_template_state`** holds one "last line used" pointer per chat *per
  intensity bucket*, so a hard log doesn't burn a light line.

## Commands

`/log`, `/me`, `/score` (`/board` is a silent alias), `/activities`,
`/void <id>` (admins only), `/help`, `/start`.

`/log` flow: activity → intensity → duration (with **Skip** → standard) →
confirm. Shorthand: `/log cardio hard`, tokens in any order, optional third
token for duration (`/log sport max long`).

## Running it

```bash
npm install
npm test                                  # 60 tests, real SQLite in memory
npm run typecheck                         # src, tests and dev
BOT_TOKEN=<token> npm run dev:polling     # the real bot, local SQLite
BOT_TOKEN=<token> npm run dev:weekly      # fire the Monday post now
```

Only one process may poll a bot at a time. Polling stops working once a webhook
is registered — `deleteWebhook` to go back.

## Next steps, roughly in order

1. **Rotate the bot token.** It was pasted into a chat transcript. `/revoke` in
   BotFather, then use the new one — `wrangler secret put BOT_TOKEN` only, never
   in a file.
2. **Deploy to Cloudflare.** README has the exact seven steps: `d1 create`, paste
   the id into `wrangler.toml`, two secrets, migrate, deploy, `setWebhook` with
   `secret_token`, `/start` in the group. Then
   `POST /admin/weekly?secret=<WEBHOOK_SECRET>` once to verify the cron output
   before Monday.
3. **Watch the numbers for a week.** The v2 spread is 3–32. Whether that feels
   right — whether a long easy walk should really beat a short brutal session —
   is a judgement only real logs will settle. Every value is a SQL `UPDATE`, no
   deploy.
4. **Tone toggle.** The confirmation copy is loud on purpose and suits a group
   that wants it. `src/templates.ts` exports `HYPE_TEMPLATES` as one *named* tone
   set; a second set plus a `groups.tone` column read in `buildConfirmation` is
   one migration and about ten lines. Worth asking the quieter members directly
   rather than waiting for a complaint.
5. **Deferred by the original spec, schema already supports them:** cross-posting
   to multiple groups, per-user opt-in, LLM-generated encouragement, a web
   dashboard, streaks and badges.

## Known rough edges

- `/void` takes an entry id, which people have to read out of `/me`. Fine for a
  small group; a "void my last one" shortcut would be friendlier.
- The weekly post fans out over every registered group serially. Correct for one
  group, worth revisiting if cross-posting lands.
- No pagination anywhere. `/score` truncates at 10 with a count of the rest.
- `dev/local-d1.ts` needs Node 22.5+ for `node:sqlite`, and is loaded through
  `createRequire` because Vite doesn't treat it as a builtin. It is test/dev
  only — the deployed Worker talks to D1 directly.
