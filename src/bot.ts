import { Bot, InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import type { User } from "grammy/types";

import { isAdmin } from "./admin.js";
import { escapeHtml } from "./html.js";
import {
  encodeActivityPick,
  encodeCancel,
  encodeConfirm,
  encodeIntensityPick,
  matchLogArgs,
  parseCallback,
} from "./log-flow.js";
import * as repo from "./repo.js";
import { scoreFor } from "./scoring.js";
import * as service from "./service.js";
import type { Env } from "./types.js";

const HELP = [
  "<b>Activity scoreboard</b>",
  "",
  "/log — log a workout (buttons), or <code>/log run hard</code>",
  "/me — your total and last 5 entries",
  "/score — the scoreboard",
  "/activities — valid activities, intensities and point values",
  "/void &lt;id&gt; — admins: void an entry (entry ids show in /me)",
  "/help — this message",
].join("\n");

export function displayNameOf(user: User | undefined): string {
  if (!user) return "Someone";
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return name || user.username || `User ${user.id}`;
}

export function createBot(env: Env): Bot {
  const bot = new Bot(env.BOT_TOKEN);
  const db = env.DB;
  const defaultTimezone = env.DEFAULT_TIMEZONE || "Asia/Singapore";
  const adminTtl = Number(env.ADMIN_CACHE_TTL_SECONDS ?? "600") || 600;

  /** Records the sender and (for groups) the chat, returning the chat timezone. */
  async function touch(ctx: Context): Promise<string> {
    const now = new Date().toISOString();
    if (ctx.from) {
      await repo.upsertUser(
        db,
        ctx.from.id,
        ctx.from.username ?? null,
        displayNameOf(ctx.from),
        now,
      );
    }
    if (ctx.chat && (ctx.chat.type === "group" || ctx.chat.type === "supergroup")) {
      const group = await repo.ensureGroup(
        db,
        ctx.chat.id,
        ctx.chat.title ?? null,
        defaultTimezone,
        now,
      );
      return group.timezone;
    }
    return defaultTimezone;
  }

  /** Scoring commands only make sense in the group. */
  function groupChatId(ctx: Context): number | null {
    const chat = ctx.chat;
    if (!chat) return null;
    if (chat.type !== "group" && chat.type !== "supergroup") return null;
    return chat.id;
  }

  async function requireGroup(ctx: Context): Promise<number | null> {
    const chatId = groupChatId(ctx);
    if (chatId === null) {
      await ctx.reply(
        "This bot keeps a scoreboard for a group. Add me to your group chat and run /start there.",
      );
      return null;
    }
    return chatId;
  }

  async function activityKeyboard(userId: number): Promise<InlineKeyboard> {
    const activities = await repo.listActivities(db);
    const keyboard = new InlineKeyboard();
    activities.forEach((activity, index) => {
      keyboard.text(activity.label, encodeActivityPick(userId, activity.key));
      if (index % 2 === 1) keyboard.row();
    });
    keyboard.row().text("Cancel", encodeCancel(userId));
    return keyboard;
  }

  async function intensityKeyboard(
    userId: number,
    activityKey: string,
  ): Promise<InlineKeyboard> {
    const intensities = await repo.listIntensities(db);
    const keyboard = new InlineKeyboard();
    intensities.forEach((intensity, index) => {
      keyboard.text(
        intensity.label,
        encodeIntensityPick(userId, activityKey, intensity.key),
      );
      if (index % 2 === 1) keyboard.row();
    });
    keyboard.row().text("Cancel", encodeCancel(userId));
    return keyboard;
  }

  /* ------------------------------------------------------------- commands --- */

  bot.command("start", async (ctx) => {
    await touch(ctx);
    const chatId = groupChatId(ctx);
    if (chatId === null) {
      await ctx.reply(
        `${HELP}\n\nAdd me to your group and run /start there to register it.`,
        { parse_mode: "HTML" },
      );
      return;
    }
    await ctx.reply(`Registered this group.\n\n${HELP}`, { parse_mode: "HTML" });
  });

  bot.command("help", async (ctx) => {
    await touch(ctx);
    await ctx.reply(HELP, { parse_mode: "HTML" });
  });

  bot.command("activities", async (ctx) => {
    await touch(ctx);
    await ctx.reply(await service.buildActivityList(db), { parse_mode: "HTML" });
  });

  // /board stays as an unadvertised alias — it is the word people reach for,
  // and answering it costs nothing.
  bot.command(["score", "board"], async (ctx) => {
    await touch(ctx);
    const chatId = await requireGroup(ctx);
    if (chatId === null) return;
    await ctx.reply(await service.buildBoard(db, chatId), { parse_mode: "HTML" });
  });

  bot.command("me", async (ctx) => {
    const timezone = await touch(ctx);
    const chatId = await requireGroup(ctx);
    if (chatId === null || !ctx.from) return;
    await ctx.reply(
      await service.buildMe(db, {
        chatId,
        userId: ctx.from.id,
        name: displayNameOf(ctx.from),
        timezone,
      }),
      { parse_mode: "HTML" },
    );
  });

  bot.command("log", async (ctx) => {
    await touch(ctx);
    const chatId = await requireGroup(ctx);
    if (chatId === null || !ctx.from) return;

    const tokens = (ctx.match ?? "")
      .toString()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    if (tokens.length > 0) {
      const [activities, intensities] = await Promise.all([
        repo.listActivities(db),
        repo.listIntensities(db),
      ]);
      const { activityKey, intensityKey } = matchLogArgs(
        tokens,
        activities.map((a) => a.key),
        intensities.map((i) => i.key),
      );

      if (!activityKey || !intensityKey) {
        await ctx.reply(
          `I didn't catch that. Try <code>/log run hard</code>, or just /log for buttons.\n\n${await service.buildActivityList(
            db,
          )}`,
          { parse_mode: "HTML" },
        );
        return;
      }

      const outcome = await service.logActivity(db, {
        chatId,
        userId: ctx.from.id,
        activityKey,
        intensityKey,
        sourceMessageId: ctx.msg.message_id,
      });
      await replyToLogOutcome(ctx, chatId, outcome);
      return;
    }

    await ctx.reply(
      `<b>${escapeHtml(displayNameOf(ctx.from))}</b>, what did you do?`,
      { parse_mode: "HTML", reply_markup: await activityKeyboard(ctx.from.id) },
    );
  });

  bot.command("void", async (ctx) => {
    await touch(ctx);
    const chatId = await requireGroup(ctx);
    if (chatId === null || !ctx.from) return;

    const raw = (ctx.match ?? "").toString().trim().replace(/^#/, "");
    const eventId = Number.parseInt(raw, 10);
    if (!Number.isInteger(eventId)) {
      await ctx.reply("Usage: <code>/void 123</code> — entry ids are shown in /me", {
        parse_mode: "HTML",
      });
      return;
    }

    const requesterIsAdmin = await isAdmin(ctx.from.id, {
      db,
      chatId,
      ttlSeconds: adminTtl,
      fetchAdmins: async () => {
        const admins = await ctx.api.getChatAdministrators(chatId);
        return admins.map((a) => a.user.id);
      },
    });

    const outcome = await service.voidEvent(db, {
      chatId,
      requesterId: ctx.from.id,
      requesterIsAdmin,
      eventId,
    });

    if (outcome.status === "forbidden") {
      await ctx.reply("Only group admins can void entries.");
      return;
    }
    if (outcome.status === "not_found") {
      await ctx.reply(`No entry #${eventId} in this group.`);
      return;
    }
    if (outcome.status === "already_voided") {
      await ctx.reply(`Entry #${eventId} was already voided.`);
      return;
    }

    const owner = await repo.getDisplayName(db, outcome.event.telegram_user_id);
    await ctx.reply(
      `Voided #${outcome.event.id} — ${escapeHtml(outcome.event.intensity_key)} ${escapeHtml(
        outcome.event.activity_key,
      )} (${outcome.event.points} pts) logged by ${escapeHtml(owner)}.\nVoided by ${escapeHtml(
        displayNameOf(ctx.from),
      )}.`,
      { parse_mode: "HTML" },
    );
  });

  /* ------------------------------------------------------------ callbacks --- */

  bot.on("callback_query:data", async (ctx) => {
    const parsed = parseCallback(ctx.callbackQuery.data);
    if (!parsed) {
      await ctx.answerCallbackQuery();
      return;
    }

    const presser = ctx.from;
    if (presser.id !== parsed.userId) {
      // Always answer, or the client spins forever.
      await ctx.answerCallbackQuery({
        text: "Those buttons aren't yours — send /log to start your own.",
        show_alert: true,
      });
      return;
    }

    await touch(ctx);
    const chatId = groupChatId(ctx);
    if (chatId === null) {
      await ctx.answerCallbackQuery({ text: "Use this in the group." });
      return;
    }

    if (parsed.step === "cancel") {
      await ctx.answerCallbackQuery({ text: "Cancelled" });
      await ctx.editMessageText("Cancelled.").catch(() => {});
      return;
    }

    if (parsed.step === "activity") {
      const activity = await repo.getActivity(db, parsed.activityKey);
      if (!activity) {
        await ctx.answerCallbackQuery({ text: "That activity is no longer available." });
        return;
      }
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(
        `<b>${escapeHtml(activity.label)}</b> — how hard?`,
        {
          parse_mode: "HTML",
          reply_markup: await intensityKeyboard(presser.id, activity.key),
        },
      );
      return;
    }

    if (parsed.step === "intensity") {
      const [activity, intensity] = await Promise.all([
        repo.getActivity(db, parsed.activityKey),
        repo.getIntensity(db, parsed.intensityKey),
      ]);
      if (!activity || !intensity) {
        await ctx.answerCallbackQuery({ text: "That option is no longer available." });
        return;
      }
      const points = scoreFor(activity, intensity);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(
        `<b>${escapeHtml(intensity.label)} ${escapeHtml(
          activity.label.toLowerCase(),
        )}</b> — ${points} pts. Log it?`,
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text(
              `Log ${points} pts`,
              encodeConfirm(presser.id, activity.key, intensity.key),
            )
            .text("Cancel", encodeCancel(presser.id)),
        },
      );
      return;
    }

    // confirm
    const sourceMessageId = ctx.callbackQuery.message?.message_id ?? null;
    const outcome = await service.logActivity(db, {
      chatId,
      userId: presser.id,
      activityKey: parsed.activityKey,
      intensityKey: parsed.intensityKey,
      sourceMessageId,
    });

    if (outcome.status === "unknown_activity" || outcome.status === "unknown_intensity") {
      await ctx.answerCallbackQuery({ text: "That option is no longer available." });
      return;
    }

    await ctx.answerCallbackQuery({
      text: outcome.status === "duplicate" ? "Already logged" : "Logged",
    });

    if (outcome.status === "duplicate") return;

    const text = await service.buildConfirmation(db, {
      chatId,
      name: displayNameOf(presser),
      activity: outcome.activity,
      intensity: outcome.intensity,
      points: outcome.event.points,
    });
    await ctx.editMessageText(`${text}\n<i>#${outcome.event.id}</i>`, {
      parse_mode: "HTML",
    });
  });

  /* -------------------------------------------------------------- shared --- */

  async function replyToLogOutcome(
    ctx: Context,
    chatId: number,
    outcome: service.LogOutcome,
  ): Promise<void> {
    if (outcome.status === "unknown_activity") {
      await ctx.reply(
        `I don't know the activity "<code>${escapeHtml(
          outcome.activityKey,
        )}</code>".\n\n${await service.buildActivityList(db)}`,
        { parse_mode: "HTML" },
      );
      return;
    }
    if (outcome.status === "unknown_intensity") {
      await ctx.reply(
        `I don't know the intensity "<code>${escapeHtml(
          outcome.intensityKey,
        )}</code>".\n\n${await service.buildActivityList(db)}`,
        { parse_mode: "HTML" },
      );
      return;
    }
    if (outcome.status === "duplicate") return; // a retried update; already counted

    const text = await service.buildConfirmation(db, {
      chatId,
      name: displayNameOf(ctx.from),
      activity: outcome.activity,
      intensity: outcome.intensity,
      points: outcome.event.points,
    });
    await ctx.reply(`${text}\n<i>#${outcome.event.id}</i>`, { parse_mode: "HTML" });
  }

  bot.catch((err) => {
    console.error("bot error", err.error);
  });

  return bot;
}
