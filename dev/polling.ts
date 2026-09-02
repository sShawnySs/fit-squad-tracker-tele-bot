/**
 * Run the bot locally, without Cloudflare.
 *
 *   BOT_TOKEN=123:abc npm run dev:polling
 *
 * Same bot.ts, same service.ts, same migrations — only the transport (long
 * polling instead of a webhook) and the database (a local SQLite file instead
 * of D1) differ. Useful for trying the bot in a real group before deploying,
 * and for iterating without a public tunnel.
 *
 * Not for production: one process, one machine, no cron. The deployed Worker
 * is the real thing.
 */
import { createBot } from "../src/bot.js";
import { openLocalD1 } from "./local-d1.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("BOT_TOKEN is not set. Try: BOT_TOKEN=123:abc npm run dev:polling");
  process.exit(1);
}

const dbPath = process.env.DEV_DB ?? "dev.sqlite";
const db = openLocalD1(dbPath);

const bot = createBot({
  DB: db,
  BOT_TOKEN: token,
  WEBHOOK_SECRET: "not-used-in-polling",
  DEFAULT_TIMEZONE: process.env.DEFAULT_TIMEZONE ?? "Asia/Singapore",
  ADMIN_CACHE_TTL_SECONDS: process.env.ADMIN_CACHE_TTL_SECONDS ?? "600",
});

const stop = async () => {
  console.log("\nstopping…");
  await bot.stop();
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

await bot.start({
  allowed_updates: ["message", "callback_query"],
  onStart: (info) => {
    console.log(`@${info.username} is polling. Database: ${dbPath}`);
    console.log("Add the bot to a group and send /start there.");
  },
});
