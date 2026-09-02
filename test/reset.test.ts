import { describe, expect, it } from "vitest";

import * as repo from "../src/repo.js";
import * as service from "../src/service.js";
import { createTestDb, seedChat } from "./helpers/d1.js";

async function log(db: D1Database, messageId: number, userId = 1, chatId = -100) {
  const outcome = await service.logActivity(db, {
    chatId,
    userId,
    activityKey: "cardio",
    intensityKey: "hard",
    sourceMessageId: messageId,
  });
  if (outcome.status !== "logged") throw new Error(`expected logged, got ${outcome.status}`);
  return outcome.event;
}

describe("/reset", () => {
  it("rejects a non-admin and leaves every entry alone", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }, { id: 2, name: "Sam" }]);
    await log(db, 1);
    await log(db, 2, 2);

    const outcome = await service.resetChat(db, {
      chatId: -100,
      requesterId: 2,
      requesterIsAdmin: false,
    });

    expect(outcome.status).toBe("forbidden");
    expect(await repo.countActiveEvents(db, -100)).toBe(2);
    expect(await repo.getUserTotal(db, -100, 1)).toBe(16);
  });

  it("voids every live entry, zeroes totals and empties the board", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }, { id: 2, name: "Sam" }]);
    await log(db, 1, 1);
    await log(db, 2, 1);
    await log(db, 3, 2);

    const outcome = await service.resetChat(db, {
      chatId: -100,
      requesterId: 9,
      requesterIsAdmin: true,
    });

    expect(outcome).toEqual({ status: "reset", voided: 3 });
    expect(await repo.countActiveEvents(db, -100)).toBe(0);
    expect(await repo.getUserTotal(db, -100, 1)).toBe(0);
    expect(await repo.getUserTotal(db, -100, 2)).toBe(0);
    expect(await repo.getBoard(db, -100)).toEqual([]);
    expect(await repo.getUserRecentEvents(db, -100, 1)).toEqual([]);
  });

  it("voids rather than deletes — rows keep their points and record who did it", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);
    const event = await log(db, 1);

    await service.resetChat(db, {
      chatId: -100,
      requesterId: 9,
      requesterIsAdmin: true,
    });

    const stored = await repo.getScoreEvent(db, -100, event.id);
    expect(stored).not.toBeNull();
    expect(stored!.points).toBe(16);
    expect(stored!.voided_at).toBeTruthy();
    expect(stored!.voided_by_user_id).toBe(9);
  });

  it("reports empty when there is nothing live to clear", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);

    const first = await service.resetChat(db, {
      chatId: -100,
      requesterId: 9,
      requesterIsAdmin: true,
    });
    expect(first.status).toBe("empty");

    // Already-voided rows are not re-counted on a second reset.
    await log(db, 1);
    await service.resetChat(db, { chatId: -100, requesterId: 9, requesterIsAdmin: true });
    const again = await service.resetChat(db, {
      chatId: -100,
      requesterId: 9,
      requesterIsAdmin: true,
    });
    expect(again.status).toBe("empty");
  });

  it("only touches the chat it was called for", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);
    await seedChat(db, -200, [{ id: 2, name: "Jo" }]);
    await log(db, 1, 1, -100);
    await log(db, 2, 2, -200);

    const outcome = await service.resetChat(db, {
      chatId: -100,
      requesterId: 9,
      requesterIsAdmin: true,
    });

    expect(outcome).toEqual({ status: "reset", voided: 1 });
    expect(await repo.countActiveEvents(db, -200)).toBe(1);
    expect(await repo.getUserTotal(db, -200, 2)).toBe(16);
  });
});
