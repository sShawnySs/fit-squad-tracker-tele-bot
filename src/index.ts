import type { Bot } from "grammy";
import type { Update } from "grammy/types";

import { createBot } from "./bot.js";
import * as repo from "./repo.js";
import * as service from "./service.js";
import { safeTimeZone } from "./time.js";
import type { Env } from "./types.js";

/** One bot instance per isolate; init() calls getMe once, then it is reused. */
let botPromise: Promise<Bot> | null = null;

function getBot(env: Env): Promise<Bot> {
  if (!botPromise) {
    botPromise = (async () => {
      const bot = createBot(env);
      await bot.init();
      return bot;
    })().catch((error) => {
      botPromise = null; // don't cache a failed init
      throw error;
    });
  }
  return botPromise;
}

const SECRET_HEADER = "x-telegram-bot-api-secret-token";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("ok", { status: 200 });
    }

    // Manual trigger for verifying the weekly post without waiting for Monday.
    // Guarded by the same secret as the webhook.
    if (request.method === "POST" && url.pathname === "/admin/weekly") {
      if (url.searchParams.get("secret") !== env.WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      const posted = await postWeeklyScoreboards(env);
      return Response.json({ posted });
    }

    if (request.method !== "POST" || url.pathname !== "/telegram/webhook") {
      return new Response("not found", { status: 404 });
    }

    // Telegram sends this header on every update when the webhook was
    // registered with a secret_token. Anything else is not Telegram.
    if (request.headers.get(SECRET_HEADER) !== env.WEBHOOK_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }

    let update: Update;
    try {
      update = (await request.json()) as Update;
    } catch {
      return new Response("bad request", { status: 400 });
    }

    // Ack immediately. A slow response makes Telegram retry the update, which
    // is how duplicate logs happen; the unique index is the backstop, not the plan.
    ctx.waitUntil(
      (async () => {
        try {
          const bot = await getBot(env);
          await bot.handleUpdate(update);
        } catch (error) {
          console.error("update handling failed", error);
        }
      })(),
    );

    return new Response("ok", { status: 200 });
  },

  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(postWeeklyScoreboards(env));
  },
} satisfies ExportedHandler<Env>;

/** Posts the weekly + all-time scoreboard to every registered group. */
async function postWeeklyScoreboards(env: Env): Promise<number> {
  const bot = await getBot(env);
  const groups = await repo.listGroups(env.DB);
  const now = new Date();
  let posted = 0;

  for (const group of groups) {
    try {
      const text = await service.buildWeekly(
        env.DB,
        group.telegram_chat_id,
        safeTimeZone(group.timezone || env.DEFAULT_TIMEZONE),
        now,
      );
      await bot.api.sendMessage(group.telegram_chat_id, text, {
        parse_mode: "HTML",
      });
      posted += 1;
    } catch (error) {
      console.error(`weekly post failed for ${group.telegram_chat_id}`, error);
    }
  }

  return posted;
}
