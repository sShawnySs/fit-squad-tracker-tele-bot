import { describe, expect, it } from "vitest";

import { computePoints } from "../src/scoring.js";
import * as repo from "../src/repo.js";
import * as service from "../src/service.js";
import { createTestDb, seedChat } from "./helpers/d1.js";

/** Every activity x intensity pair, straight from the spec table. */
const EXPECTED: Record<string, Record<string, number>> = {
  run: { light: 10, moderate: 15, hard: 20 },
  gym: { light: 10, moderate: 15, hard: 20 },
  swim: { light: 12, moderate: 18, hard: 24 },
  walk: { light: 5, moderate: 8, hard: 10 }, // 5 x 1.5 = 7.5 -> 8
};

describe("computePoints", () => {
  it("rounds base x multiplier", () => {
    expect(computePoints(10, 1.0)).toBe(10);
    expect(computePoints(10, 1.5)).toBe(15);
    expect(computePoints(5, 1.5)).toBe(8);
    expect(computePoints(12, 2.0)).toBe(24);
  });
});

describe("seeded scoring matrix", () => {
  it("matches the spec for every activity x intensity pair", async () => {
    const db = createTestDb();
    const activities = await repo.listActivities(db);
    const intensities = await repo.listIntensities(db);

    expect(activities.map((a) => a.key)).toEqual(["run", "gym", "swim", "walk"]);
    expect(intensities.map((i) => i.key)).toEqual(["light", "moderate", "hard"]);

    for (const activity of activities) {
      for (const intensity of intensities) {
        const points = computePoints(activity.base_points, intensity.multiplier);
        expect(
          points,
          `${activity.key} x ${intensity.key}`,
        ).toBe(EXPECTED[activity.key]![intensity.key]!);
      }
    }
  });

  it("writes the resolved points onto the ledger row", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);

    let messageId = 1;
    for (const [activityKey, byIntensity] of Object.entries(EXPECTED)) {
      for (const [intensityKey, expected] of Object.entries(byIntensity)) {
        const outcome = await service.logActivity(db, {
          chatId: -100,
          userId: 1,
          activityKey,
          intensityKey,
          sourceMessageId: messageId++,
        });
        expect(outcome.status).toBe("logged");
        if (outcome.status !== "logged") throw new Error("unreachable");
        expect(outcome.event.points).toBe(expected);
        expect(outcome.event.activity_key).toBe(activityKey);
        expect(outcome.event.intensity_key).toBe(intensityKey);
      }
    }
  });

  it("keeps historical points when base values change", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);

    const before = await service.logActivity(db, {
      chatId: -100,
      userId: 1,
      activityKey: "run",
      intensityKey: "hard",
      sourceMessageId: 1,
    });
    expect(before.status === "logged" && before.event.points).toBe(20);

    await db.prepare(`UPDATE activities SET base_points = 50 WHERE key = 'run'`).run();

    const after = await service.logActivity(db, {
      chatId: -100,
      userId: 1,
      activityKey: "run",
      intensityKey: "hard",
      sourceMessageId: 2,
    });
    expect(after.status === "logged" && after.event.points).toBe(100);

    // The earlier row is untouched: 20 + 100.
    expect(await repo.getUserTotal(db, -100, 1)).toBe(120);
  });

  it("rejects unknown keys", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);

    expect(
      (
        await service.logActivity(db, {
          chatId: -100,
          userId: 1,
          activityKey: "yoga",
          intensityKey: "hard",
          sourceMessageId: 1,
        })
      ).status,
    ).toBe("unknown_activity");

    expect(
      (
        await service.logActivity(db, {
          chatId: -100,
          userId: 1,
          activityKey: "run",
          intensityKey: "brutal",
          sourceMessageId: 2,
        })
      ).status,
    ).toBe("unknown_intensity");
  });
});
