# Telegram Group Activity Scoreboard Bot

A bot that lives in one Telegram group. Members log a workout, it scores it,
stores it, confirms in the group, and keeps a scoreboard — posted automatically
every Monday and available on demand.

Runs on Cloudflare Workers + D1, both inside the free tier.

## Commands

| Command | Who | What it does |
|---|---|---|
| `/log` | anyone | Buttons: activity → intensity → confirm. `/log run hard` also works (either order). |
| `/me` | anyone | Your total and your last 5 entries, with their ids |
| `/board` | anyone | All-time scoreboard, top 10 if more than 10 people have scored |
| `/activities` | anyone | Valid activity/intensity keys and their point values |
| `/void <id>` | admins | Voids an entry and says what was voided, by whom |
| `/help`, `/start` | anyone | Usage; `/start` in a group registers it |

## Scoring

`points = round(base_points × multiplier)`

| Activity | Base | | Intensity | Multiplier |
|---|---|---|---|---|
| run | 10 | | light | 1.0 |
| gym | 10 | | moderate | 1.5 |
| swim | 12 | | hard | 2.0 |
| walk | 5 | | | |

Both tables live in the database, not in code — see
[Changing point values](#changing-point-values).

## Setup

Needs Node 22.5+ and a Cloudflare account.

**1. Create the bot**

Talk to [@BotFather](https://t.me/BotFather): `/newbot`, keep the token.
Leave privacy mode ON (the default) — the bot only reads commands and button
presses, never freeform chat.

**2. Install and create the database**

```bash
npm install
npx wrangler login
npx wrangler d1 create scoreboard
```

Copy the printed `database_id` into `wrangler.toml`, replacing
`REPLACE_WITH_YOUR_D1_DATABASE_ID`.

**3. Apply migrations**

```bash
npm run db:migrate:remote     # production
npm run db:migrate:local      # local dev copy
```

**4. Set secrets**

```bash
npx wrangler secret put BOT_TOKEN        # from BotFather
npx wrangler secret put WEBHOOK_SECRET   # any long random string, e.g. openssl rand -hex 32
```

Keep `WEBHOOK_SECRET` — step 6 needs the same value.

**5. Deploy**

```bash
npm run deploy
```

Note the deployed URL, e.g. `https://telegram-scoreboard-bot.<subdomain>.workers.dev`.

**6. Register the webhook**

The `secret_token` here is what the Worker checks on every incoming request;
anything without it gets a 401.

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://<your-worker-url>/telegram/webhook" \
  -d "secret_token=<WEBHOOK_SECRET>" \
  -d "allowed_updates=[\"message\",\"callback_query\"]"
```

Check it took: `curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"`

**7. Add the bot to the group and run `/start`**

`/start` registers the chat, which is what the Monday cron fans out over.
Then `/log` to check the round trip.

## Verifying the weekly post

The cron is `0 1 * * 1` in `wrangler.toml` — 01:00 UTC Monday, which is 09:00
Monday in Singapore. Cron is always UTC; change the expression if the group
moves timezone.

To fire it on demand instead of waiting for Monday:

```bash
curl -X POST "https://<your-worker-url>/admin/weekly?secret=<WEBHOOK_SECRET>"
```

Locally, `wrangler dev` exposes the scheduled handler directly:

```bash
npm run dev
curl "http://localhost:8787/__scheduled?cron=0+1+*+*+1"
```

## Changing point values

Values live in `activities` and `intensities`, so a change is one SQL statement,
no deploy:

```bash
npx wrangler d1 execute scoreboard --remote \
  --command "UPDATE activities SET base_points = 12 WHERE key = 'run'"

npx wrangler d1 execute scoreboard --remote \
  --command "INSERT INTO activities (key, label, base_points, active, sort_order)
             VALUES ('cycle', 'Cycle', 8, 1, 5)"

# retire one without losing its history
npx wrangler d1 execute scoreboard --remote \
  --command "UPDATE activities SET active = 0 WHERE key = 'walk'"
```

Existing entries keep the points they were written with — each `score_events`
row stores the resolved `points`, so editing a multiplier never rewrites
anyone's past score.

## How the data works

- `score_events` is an append-only ledger. Corrections **void** (`voided_at`,
  `voided_by_user_id`); nothing is ever deleted, and every read filters
  `voided_at IS NULL`.
- Totals are always `SUM(points)` on demand. There is no stored running total to
  drift.
- Every row is scoped by `telegram_chat_id` even though there is one group
  today, so cross-posting later is a new table and a fan-out loop, not a
  migration on live data.
- A unique index on `(telegram_chat_id, source_message_id)` absorbs Telegram's
  update retries. The Worker also acks in under a millisecond and does its work
  in `waitUntil()`, so retries should be rare — the index is the backstop.
- Admin status comes from `getChatAdministrators`, cached in D1 for 10 minutes
  (`ADMIN_CACHE_TTL_SECONDS`). No hand-maintained admin list.

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill in BOT_TOKEN and WEBHOOK_SECRET
npm run db:migrate:local
npm run dev
```

To point a real bot at a local instance you need a public tunnel
(`cloudflared tunnel --url http://localhost:8787`) and `setWebhook` against that
URL. For most changes the test suite is faster.

## Tests

```bash
npm test         # vitest
npm run typecheck
```

43 tests run against real SQLite in memory (`node:sqlite`), with every migration
applied — so indexes, `ON CONFLICT` and the void filters are exercised for real,
not mocked. Covered: the full activity × intensity matrix, points frozen on the
row when values change, void flow and its effect on totals/board/`/me`,
non-admins rejected from `/void`, cross-chat isolation, duplicate
`source_message_id`, admin cache TTL and failure fallback, ranking with ties,
top-10 truncation, HTML escaping, and the weekly window.

## Layout

```
src/
  index.ts       Worker entry: webhook auth, fast ack, cron handler
  bot.ts         grammY handlers (thin glue)
  service.ts     the rules — logging, voiding, message building
  repo.ts        D1 queries
  scoring.ts     points = round(base × multiplier)
  scoreboard.ts  ranking with ties, top-10 truncation, formatting
  templates.ts   ~30 confirmation lines, no immediate repeats
  log-flow.ts    callback-data encoding, /log argument parsing
  admin.ts       cached getChatAdministrators
  time.ts        UTC storage, group-timezone rendering
  html.ts        escaping (HTML parse mode throughout)
migrations/      numbered SQL, including seed data
test/            vitest, with a D1 shim over node:sqlite
```

## Deliberately not built yet

Cross-posting to multiple groups, per-user opt-in, LLM-generated encouragement,
a web dashboard, streaks and badges. The schema already supports adding them.
