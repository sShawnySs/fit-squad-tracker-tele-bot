/**
 * Post the weekly scoreboard from the local database, on demand.
 *
 *   BOT_TOKEN=123:abc npm run dev:weekly
 *
 * Same message the Monday cron sends in production — this is how you check the
 * wording and the ranking without waiting for Monday. In production, use
 * `POST /admin/weekly?secret=<WEBHOOK_SECRET>` instead.
 */
import { Bot } from "grammy";

import * as repo from "../src/repo.js";
import * as service from "../src/service.js";
import { safeTimeZone } from "../src/time.js";
import { openLocalD1 } from "./local-d1.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("BOT_TOKEN is not set.");
  process.exit(1);
}

const db = openLocalD1(process.env.DEV_DB ?? "dev.sqlite");
const bot = new Bot(token);
await bot.init();

const groups = await repo.listGroups(db);
if (groups.length === 0) {
  console.log("No groups registered yet — send /start in the group first.");
  process.exit(0);
}

for (const group of groups) {
  const text = await service.buildWeekly(
    db,
    group.telegram_chat_id,
    safeTimeZone(group.timezone),
    new Date(),
  );
  await bot.api.sendMessage(group.telegram_chat_id, text, { parse_mode: "HTML" });
  console.log(`posted to ${group.title ?? group.telegram_chat_id}`);
}
