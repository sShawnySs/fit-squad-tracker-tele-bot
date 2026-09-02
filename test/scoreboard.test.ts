import { describe, expect, it } from "vitest";

import { BOARD_LIMIT, formatSection, rankRows } from "../src/scoreboard.js";
import * as repo from "../src/repo.js";
import * as service from "../src/service.js";
import { createTestDb, seedChat } from "./helpers/d1.js";
import type { BoardRow } from "../src/types.js";

const rows = (...pairs: [string, number][]): BoardRow[] =>
  pairs.map(([name, total], i) => ({ user_id: i + 1, name, total }));

describe("rankRows", () => {
  it("orders by total, descending", () => {
    const ranked = rankRows(rows(["Jo", 120], ["Alex", 145], ["Sam", 130]));
    expect(ranked.map((r) => r.name)).toEqual(["Alex", "Sam", "Jo"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("gives tied totals the same rank and skips the next one", () => {
    const ranked = rankRows(rows(["Alex", 145], ["Sam", 130], ["Jo", 130], ["Kim", 120]));
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it("breaks ties by name so the order is stable between posts", () => {
    const ranked = rankRows(rows(["Zoe", 100], ["Ali", 100]));
    expect(ranked.map((r) => r.name)).toEqual(["Ali", "Zoe"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1]);
  });

  it("handles an empty board", () => {
    expect(rankRows([])).toEqual([]);
  });
});

describe("formatSection", () => {
  it("shows everyone when there are 10 or fewer", () => {
    const board = rows(...Array.from({ length: 10 }, (_, i): [string, number] => [
      `P${i}`,
      100 - i,
    ]));
    const text = formatSection("Scoreboard", board);
    expect(text).not.toContain("Showing top");
    expect(text.split("\n")).toHaveLength(11); // title + 10
  });

  it("truncates to the top 10 and says how many are hidden", () => {
    const board = rows(...Array.from({ length: 14 }, (_, i): [string, number] => [
      `P${i}`,
      100 - i,
    ]));
    const text = formatSection("Scoreboard", board);
    expect(text).toContain("Showing top 10 of 14. Your score: /me");
    expect(text).toContain("10. P9 — 91");
    expect(text).not.toContain("11. ");
  });

  it("escapes names that would break the HTML parse mode", () => {
    const text = formatSection("Scoreboard", rows(["a_b <script>", 10]));
    expect(text).toContain("a_b &lt;script&gt;");
  });

  it("prompts when nothing has been logged", () => {
    expect(formatSection("Scoreboard", [])).toContain("Nothing logged yet");
  });

  it("defaults to a limit of 10", () => {
    expect(BOARD_LIMIT).toBe(10);
  });
});

describe("board queries", () => {
  it("sums live entries per user and ignores other chats", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [
      { id: 1, name: "Alex" },
      { id: 2, name: "Sam" },
    ]);
    await seedChat(db, -200, [{ id: 3, name: "Jo" }]);

    await service.logActivity(db, {
      chatId: -100, userId: 1, activityKey: "cardio", intensityKey: "hard", sourceMessageId: 1,
    });
    await service.logActivity(db, {
      chatId: -100, userId: 1, activityKey: "cardio", intensityKey: "light", sourceMessageId: 2,
    });
    await service.logActivity(db, {
      chatId: -100, userId: 2, activityKey: "sport", intensityKey: "moderate", sourceMessageId: 3,
    });
    await service.logActivity(db, {
      chatId: -200, userId: 3, activityKey: "cardio", intensityKey: "hard", sourceMessageId: 4,
    });

    const board = await repo.getBoard(db, -100);
    expect(board).toEqual([
      { user_id: 1, name: "Alex", total: 25 },
      { user_id: 2, name: "Sam", total: 15 },
    ]);
  });

  it("filters to the trailing window for the weekly post", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);
    const now = new Date("2026-09-02T01:00:00Z");
    const tenDaysAgo = new Date(now.getTime() - 10 * 864e5);
    const twoDaysAgo = new Date(now.getTime() - 2 * 864e5);

    await service.logActivity(db, {
      chatId: -100, userId: 1, activityKey: "cardio", intensityKey: "hard",
      sourceMessageId: 1, now: tenDaysAgo,
    });
    await service.logActivity(db, {
      chatId: -100, userId: 1, activityKey: "strength", intensityKey: "light",
      sourceMessageId: 2, now: twoDaysAgo,
    });

    const allTime = await repo.getBoard(db, -100, null);
    expect(allTime[0]!.total).toBe(25); // 16 + 9

    const weekly = await service.buildWeekly(db, -100, "Asia/Singapore", now);
    expect(weekly).toContain("1. Alex — 9"); // only the 2-days-ago strength entry
    expect(weekly).toContain("All time");
    expect(weekly).toContain("26 Aug to 2 Sep");
  });
});
