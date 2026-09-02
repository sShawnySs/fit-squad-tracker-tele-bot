import { describe, expect, it } from "vitest";

import { DEFAULT_DURATION_KEY, computePoints } from "../src/scoring.js";
import * as repo from "../src/repo.js";
import * as service from "../src/service.js";
import { createTestDb, seedChat } from "./helpers/d1.js";

/** Scoring model v2: points = round(base × intensity × duration). */
const BASE = { cardio: 6, strength: 6, sport: 7 } as const;
const INTENSITY = { light: 1.0, moderate: 1.4, hard: 1.8, max: 2.3 } as const;
const DURATION = { quick: 0.5, short: 1.0, standard: 1.5, long: 2.0 } as const;

describe("computePoints", () => {
  it("matches the worked examples in the spec", () => {
    expect(computePoints(6, 1.0, 0.5)).toBe(3); // cardio, light, quick
    expect(computePoints(6, 1.8, 1.5)).toBe(16); // strength, hard, standard: 16.2
    expect(computePoints(7, 2.3, 2.0)).toBe(32); // sport, max, long: 32.2
  });

  it("rounds half up", () => {
    expect(computePoints(6, 1.4, 0.5)).toBe(4); // 4.2
    expect(computePoints(7, 1.0, 0.5)).toBe(4); // 3.5 -> 4
  });
});

describe("seeded scoring matrix", () => {
  it("seeds exactly the v2 rows", async () => {
    const db = createTestDb();
    expect((await repo.listActivities(db)).map((a) => a.key)).toEqual([
      "cardio", "strength", "sport",
    ]);
    expect((await repo.listIntensities(db)).map((i) => i.key)).toEqual([
      "light", "moderate", "hard", "max",
    ]);
    expect((await repo.listDurations(db)).map((d) => d.key)).toEqual([
      "quick", "short", "standard", "long",
    ]);
  });

  it("writes the right points for all 48 combinations", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);

    let messageId = 0;
    let combinations = 0;

    for (const [activityKey, base] of Object.entries(BASE)) {
      for (const [intensityKey, intensityMultiplier] of Object.entries(INTENSITY)) {
        for (const [durationKey, durationMultiplier] of Object.entries(DURATION)) {
          const expected = Math.round(base * intensityMultiplier * durationMultiplier);
          const outcome = await service.logActivity(db, {
            chatId: -100,
            userId: 1,
            activityKey,
            intensityKey,
            durationKey,
            sourceMessageId: ++messageId,
          });

          expect(outcome.status, `${activityKey}/${intensityKey}/${durationKey}`).toBe(
            "logged",
          );
          if (outcome.status !== "logged") throw new Error("unreachable");
          expect(
            outcome.event.points,
            `${activityKey} × ${intensityKey} × ${durationKey}`,
          ).toBe(expected);
          expect(outcome.event.activity_key).toBe(activityKey);
          expect(outcome.event.intensity_key).toBe(intensityKey);
          expect(outcome.event.duration_key).toBe(durationKey);
          combinations += 1;
        }
      }
    }

    expect(combinations).toBe(48);
  });

  it("stays inside the 3–32 range the spec expects", async () => {
    const db = createTestDb();
    const [activities, intensities, durations] = await Promise.all([
      repo.listActivities(db),
      repo.listIntensities(db),
      repo.listDurations(db),
    ]);

    const points = activities.flatMap((a) =>
      intensities.flatMap((i) =>
        durations.map((d) => computePoints(a.base_points, i.multiplier, d.multiplier)),
      ),
    );

    expect(Math.min(...points)).toBe(3); // never zero, so no floor logic needed
    expect(Math.max(...points)).toBe(32);
  });

  it("defaults duration to standard when it isn't given", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);

    const outcome = await service.logActivity(db, {
      chatId: -100,
      userId: 1,
      activityKey: "cardio",
      intensityKey: "hard",
      sourceMessageId: 1,
    });

    expect(outcome.status).toBe("logged");
    if (outcome.status !== "logged") throw new Error("unreachable");
    expect(outcome.event.duration_key).toBe(DEFAULT_DURATION_KEY);
    expect(outcome.event.points).toBe(16); // 6 × 1.8 × 1.5
  });

  it("keeps historical points when values change", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);

    const before = await service.logActivity(db, {
      chatId: -100, userId: 1, activityKey: "sport", intensityKey: "max",
      durationKey: "long", sourceMessageId: 1,
    });
    expect(before.status === "logged" && before.event.points).toBe(32);

    await db.prepare(`UPDATE activities SET base_points = 20 WHERE key = 'sport'`).run();
    await db.prepare(`UPDATE durations SET multiplier = 3 WHERE key = 'long'`).run();

    const after = await service.logActivity(db, {
      chatId: -100, userId: 1, activityKey: "sport", intensityKey: "max",
      durationKey: "long", sourceMessageId: 2,
    });
    expect(after.status === "logged" && after.event.points).toBe(138); // 20 × 2.3 × 3

    // The earlier row is untouched: 32 + 138.
    expect(await repo.getUserTotal(db, -100, 1)).toBe(170);
  });

  it("rejects unknown keys on every axis", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);

    expect(
      (
        await service.logActivity(db, {
          chatId: -100, userId: 1, activityKey: "yoga", intensityKey: "hard",
          sourceMessageId: 1,
        })
      ).status,
    ).toBe("unknown_activity");

    expect(
      (
        await service.logActivity(db, {
          chatId: -100, userId: 1, activityKey: "cardio", intensityKey: "brutal",
          sourceMessageId: 2,
        })
      ).status,
    ).toBe("unknown_intensity");

    expect(
      (
        await service.logActivity(db, {
          chatId: -100, userId: 1, activityKey: "cardio", intensityKey: "hard",
          durationKey: "forever", sourceMessageId: 3,
        })
      ).status,
    ).toBe("unknown_duration");
  });

  it("rejects the old v1 keys outright", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);

    for (const oldKey of ["run", "walk", "gym", "swim", "cycle", "calisthenics"]) {
      const outcome = await service.logActivity(db, {
        chatId: -100, userId: 1, activityKey: oldKey, intensityKey: "hard",
        sourceMessageId: null,
      });
      expect(outcome.status, oldKey).toBe("unknown_activity");
    }
  });
});
