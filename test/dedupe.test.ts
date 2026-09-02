import { describe, expect, it } from "vitest";

import * as repo from "../src/repo.js";
import * as service from "../src/service.js";
import { createTestDb, seedChat } from "./helpers/d1.js";

/**
 * Telegram retries an update when the webhook is slow. The unique index on
 * (telegram_chat_id, source_message_id) has to absorb that without a 500 and
 * without a second row.
 */
describe("duplicate source_message_id", () => {
  it("is reported as a duplicate and counted once", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);

    const first = await service.logActivity(db, {
      chatId: -100, userId: 1, activityKey: "cardio", intensityKey: "hard", sourceMessageId: 77,
    });
    const retry = await service.logActivity(db, {
      chatId: -100, userId: 1, activityKey: "cardio", intensityKey: "hard", sourceMessageId: 77,
    });

    expect(first.status).toBe("logged");
    expect(retry.status).toBe("duplicate");
    if (first.status !== "logged") throw new Error("unreachable");
    if (retry.status !== "duplicate") throw new Error("unreachable");

    expect(retry.event.id).toBe(first.event.id);
    expect(await repo.getUserTotal(db, -100, 1)).toBe(16);
  });

  it("does not resurrect a voided entry when the update is retried", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);

    const first = await service.logActivity(db, {
      chatId: -100, userId: 1, activityKey: "strength", intensityKey: "light", sourceMessageId: 5,
    });
    if (first.status !== "logged") throw new Error("unreachable");

    await service.voidEvent(db, {
      chatId: -100, requesterId: 1, requesterIsAdmin: true, eventId: first.event.id,
    });

    const retry = await service.logActivity(db, {
      chatId: -100, userId: 1, activityKey: "strength", intensityKey: "light", sourceMessageId: 5,
    });
    expect(retry.status).toBe("duplicate");
    expect(await repo.getUserTotal(db, -100, 1)).toBe(0);
  });

  it("keeps the same message id separate across chats", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);
    await seedChat(db, -200, [{ id: 1, name: "Alex" }]);

    const a = await service.logActivity(db, {
      chatId: -100, userId: 1, activityKey: "cardio", intensityKey: "light", sourceMessageId: 9,
    });
    const b = await service.logActivity(db, {
      chatId: -200, userId: 1, activityKey: "cardio", intensityKey: "light", sourceMessageId: 9,
    });

    expect(a.status).toBe("logged");
    expect(b.status).toBe("logged");
  });

  it("still allows entries with no source message id", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);

    const a = await service.logActivity(db, {
      chatId: -100, userId: 1, activityKey: "cardio", intensityKey: "light", sourceMessageId: null,
    });
    const b = await service.logActivity(db, {
      chatId: -100, userId: 1, activityKey: "cardio", intensityKey: "light", sourceMessageId: null,
    });

    expect(a.status).toBe("logged");
    expect(b.status).toBe("logged");
    expect(await repo.getUserTotal(db, -100, 1)).toBe(18); // 9 + 9
  });
});
