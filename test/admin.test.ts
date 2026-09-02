import { describe, expect, it, vi } from "vitest";

import { getAdminIds, isAdmin } from "../src/admin.js";
import { createTestDb, seedChat } from "./helpers/d1.js";

describe("admin lookup", () => {
  it("asks Telegram once, then serves the cache until the TTL expires", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 9, name: "Admin" }]);
    const fetchAdmins = vi.fn(async () => [9, 10]);
    const base = new Date("2026-09-02T00:00:00Z");

    const deps = { db, chatId: -100, fetchAdmins, ttlSeconds: 600, now: base };
    expect(await getAdminIds(deps)).toEqual([9, 10]);
    expect(
      await getAdminIds({ ...deps, now: new Date(base.getTime() + 5 * 60_000) }),
    ).toEqual([9, 10]);
    expect(fetchAdmins).toHaveBeenCalledTimes(1);

    // 11 minutes later the cache is stale.
    await getAdminIds({ ...deps, now: new Date(base.getTime() + 11 * 60_000) });
    expect(fetchAdmins).toHaveBeenCalledTimes(2);
  });

  it("picks up promotions and demotions on refresh", async () => {
    const db = createTestDb();
    await seedChat(db, -100, []);
    let current = [9];
    const fetchAdmins = vi.fn(async () => current);
    const base = new Date("2026-09-02T00:00:00Z");

    expect(await isAdmin(9, { db, chatId: -100, fetchAdmins, ttlSeconds: 600, now: base }))
      .toBe(true);

    current = [10];
    const later = new Date(base.getTime() + 20 * 60_000);
    expect(await isAdmin(9, { db, chatId: -100, fetchAdmins, ttlSeconds: 600, now: later }))
      .toBe(false);
    expect(await isAdmin(10, { db, chatId: -100, fetchAdmins, ttlSeconds: 600, now: later }))
      .toBe(true);
  });

  it("falls back to the last known list if Telegram fails", async () => {
    const db = createTestDb();
    await seedChat(db, -100, []);
    const base = new Date("2026-09-02T00:00:00Z");

    await getAdminIds({
      db, chatId: -100, ttlSeconds: 600, now: base,
      fetchAdmins: async () => [9],
    });

    const ids = await getAdminIds({
      db, chatId: -100, ttlSeconds: 600,
      now: new Date(base.getTime() + 30 * 60_000),
      fetchAdmins: async () => {
        throw new Error("telegram is down");
      },
    });
    expect(ids).toEqual([9]);
  });

  it("treats nobody as admin when there is no cache and no answer", async () => {
    const db = createTestDb();
    await seedChat(db, -100, []);
    const allowed = await isAdmin(9, {
      db, chatId: -100, ttlSeconds: 600,
      fetchAdmins: async () => {
        throw new Error("telegram is down");
      },
    });
    expect(allowed).toBe(false);
  });
});
