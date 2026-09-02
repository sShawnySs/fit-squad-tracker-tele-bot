import { describe, expect, it } from "vitest";

import * as repo from "../src/repo.js";
import * as service from "../src/service.js";
import { createTestDb, seedChat } from "./helpers/d1.js";

async function log(db: D1Database, messageId: number, userId = 1) {
  const outcome = await service.logActivity(db, {
    chatId: -100,
    userId,
    activityKey: "run",
    intensityKey: "hard",
    sourceMessageId: messageId,
  });
  if (outcome.status !== "logged") throw new Error(`expected logged, got ${outcome.status}`);
  return outcome.event;
}

describe("/void", () => {
  it("rejects a non-admin and leaves the entry alone", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }, { id: 2, name: "Sam" }]);
    const event = await log(db, 1);

    const outcome = await service.voidEvent(db, {
      chatId: -100,
      requesterId: 2,
      requesterIsAdmin: false,
      eventId: event.id,
    });

    expect(outcome.status).toBe("forbidden");
    const stored = await repo.getScoreEvent(db, -100, event.id);
    expect(stored?.voided_at).toBeNull();
    expect(await repo.getUserTotal(db, -100, 1)).toBe(20);
  });

  it("voids rather than deletes, and records who did it", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }, { id: 9, name: "Admin" }]);
    const event = await log(db, 1);

    const outcome = await service.voidEvent(db, {
      chatId: -100,
      requesterId: 9,
      requesterIsAdmin: true,
      eventId: event.id,
    });

    expect(outcome.status).toBe("voided");
    const stored = await repo.getScoreEvent(db, -100, event.id);
    expect(stored).not.toBeNull();
    expect(stored!.voided_at).toBeTruthy();
    expect(stored!.voided_by_user_id).toBe(9);
    expect(stored!.points).toBe(20); // the row keeps its points, it just stops counting
  });

  it("removes the entry from totals, /me and the board", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);
    const first = await log(db, 1);
    await log(db, 2);
    expect(await repo.getUserTotal(db, -100, 1)).toBe(40);

    await service.voidEvent(db, {
      chatId: -100, requesterId: 1, requesterIsAdmin: true, eventId: first.id,
    });

    expect(await repo.getUserTotal(db, -100, 1)).toBe(20);
    expect(await repo.getBoard(db, -100)).toEqual([
      { user_id: 1, name: "Alex", total: 20 },
    ]);
    const recent = await repo.getUserRecentEvents(db, -100, 1);
    expect(recent.map((e) => e.id)).not.toContain(first.id);
  });

  it("drops the user from the board when every entry is voided", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);
    const only = await log(db, 1);
    await service.voidEvent(db, {
      chatId: -100, requesterId: 1, requesterIsAdmin: true, eventId: only.id,
    });
    expect(await repo.getBoard(db, -100)).toEqual([]);
  });

  it("is idempotent — voiding twice reports already_voided", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);
    const event = await log(db, 1);
    const args = {
      chatId: -100, requesterId: 1, requesterIsAdmin: true, eventId: event.id,
    };

    expect((await service.voidEvent(db, args)).status).toBe("voided");
    expect((await service.voidEvent(db, args)).status).toBe("already_voided");
  });

  it("will not void an entry belonging to another chat", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);
    await seedChat(db, -200, [{ id: 2, name: "Jo" }]);
    const event = await log(db, 1);

    const outcome = await service.voidEvent(db, {
      chatId: -200, requesterId: 2, requesterIsAdmin: true, eventId: event.id,
    });
    expect(outcome.status).toBe("not_found");
    expect((await repo.getScoreEvent(db, -100, event.id))!.voided_at).toBeNull();
  });

  it("reports not_found for an id that never existed", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);
    const outcome = await service.voidEvent(db, {
      chatId: -100, requesterId: 1, requesterIsAdmin: true, eventId: 4242,
    });
    expect(outcome.status).toBe("not_found");
  });
});
