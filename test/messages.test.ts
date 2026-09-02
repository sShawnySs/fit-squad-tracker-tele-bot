import { describe, expect, it } from "vitest";

import {
  encodeConfirm,
  matchLogArgs,
  parseCallback,
} from "../src/log-flow.js";
import {
  HYPE_TEMPLATES,
  bucketFor,
  pickTemplateIndex,
  renderTemplate,
  templatesFor,
  type IntensityBucket,
} from "../src/templates.js";
import * as service from "../src/service.js";
import * as repo from "../src/repo.js";
import { createTestDb, seedChat } from "./helpers/d1.js";

const BUCKETS: IntensityBucket[] = ["light", "moderate", "hard"];

describe("confirmation templates", () => {
  it("has ten lines in every bucket", () => {
    for (const bucket of BUCKETS) expect(templatesFor(bucket)).toHaveLength(10);
  });

  it("never repeats the previous line", () => {
    for (let last = 0; last < 10; last++) {
      for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
        const next = pickTemplateIndex(last, () => r, 10);
        expect(next).not.toBe(last);
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(10);
      }
    }
  });

  it("can reach every line in a bucket", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(pickTemplateIndex(null, Math.random, 10));
    expect(seen.size).toBe(10);
  });

  it("fills every placeholder in every line", () => {
    for (const bucket of BUCKETS) {
      for (let i = 0; i < templatesFor(bucket).length; i++) {
        const text = renderTemplate(bucket, i, {
          name: "Alex", activity: "run", intensity: bucket, points: 20,
        });
        expect(text).not.toMatch(/\{(name|activity|intensity|points)\}/);
        expect(text).toContain("Alex");
        expect(text).toContain("20");
      }
    }
  });

  it("has no HTML-breaking characters in the copy", () => {
    for (const bucket of BUCKETS) {
      for (const line of templatesFor(bucket)) {
        expect(line, line).not.toMatch(/[<>&]/);
      }
    }
  });

  it("maps an intensity to its bucket by key, then by multiplier", () => {
    expect(bucketFor({ key: "light", multiplier: 1 })).toBe("light");
    expect(bucketFor({ key: "moderate", multiplier: 1.5 })).toBe("moderate");
    expect(bucketFor({ key: "hard", multiplier: 2 })).toBe("hard");
    // An intensity added to the database later still gets sensible copy.
    expect(bucketFor({ key: "brutal", multiplier: 2.5 })).toBe("hard");
    expect(bucketFor({ key: "brisk", multiplier: 1.6 })).toBe("moderate");
    expect(bucketFor({ key: "stroll", multiplier: 0.5 })).toBe("light");
  });

  it("always picks a line from the bucket matching the effort", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);
    const activity = (await repo.getActivity(db, "run"))!;

    const rendered = (bucket: IntensityBucket) =>
      new Set(
        templatesFor(bucket).map((_, i) =>
          renderTemplate(bucket, i, {
            name: "Alex", activity: "run", intensity: bucket, points: 20,
          }),
        ),
      );

    for (const bucket of BUCKETS) {
      const intensity = (await repo.getIntensity(db, bucket))!;
      const others = BUCKETS.filter((b) => b !== bucket);

      // 20 draws: every one has to come from this bucket, never another.
      for (let i = 0; i < 20; i++) {
        const text = await service.buildConfirmation(db, {
          chatId: -100, name: "Alex", activity, intensity, points: 20,
        });
        expect(rendered(bucket).has(text), text).toBe(true);
        for (const other of others) expect(rendered(other).has(text)).toBe(false);
      }
      expect(await repo.getLastTemplateIndex(db, -100, bucket)).not.toBeNull();
    }
  });

  it("never sends the same line twice in a row in a chat", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);
    const activity = (await repo.getActivity(db, "run"))!;
    const intensity = (await repo.getIntensity(db, "hard"))!;

    let previous = "";
    for (let i = 0; i < 50; i++) {
      const text = await service.buildConfirmation(db, {
        chatId: -100, name: "Alex", activity, intensity, points: 20,
      });
      expect(text).not.toBe(previous);
      previous = text;
    }
  });

  it("tracks the last line separately per bucket", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);
    const activity = (await repo.getActivity(db, "run"))!;
    const light = (await repo.getIntensity(db, "light"))!;
    const hard = (await repo.getIntensity(db, "hard"))!;

    await service.buildConfirmation(db, {
      chatId: -100, name: "Alex", activity, intensity: light, points: 10, random: () => 0,
    });
    await service.buildConfirmation(db, {
      chatId: -100, name: "Alex", activity, intensity: hard, points: 20, random: () => 0.5,
    });

    expect(await repo.getLastTemplateIndex(db, -100, "light")).toBe(0);
    expect(await repo.getLastTemplateIndex(db, -100, "hard")).toBe(5);
    // A light log after a light log cannot repeat index 0.
    const next = await service.buildConfirmation(db, {
      chatId: -100, name: "Alex", activity, intensity: light, points: 10, random: () => 0,
    });
    expect(await repo.getLastTemplateIndex(db, -100, "light")).toBe(1);
    expect(next).not.toBe("");
  });

  it("escapes the name", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "a<b" }]);
    const activity = (await repo.getActivity(db, "run"))!;
    const intensity = (await repo.getIntensity(db, "hard"))!;

    const text = await service.buildConfirmation(db, {
      chatId: -100, name: "a<b", activity, intensity, points: 20, random: () => 0,
    });
    expect(text).toContain("a&lt;b");
    expect(text).not.toMatch(/(?<!&lt;)a<b/);
  });

  it("keeps every chat's rotation independent", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);
    await seedChat(db, -200, [{ id: 2, name: "Jo" }]);
    const activity = (await repo.getActivity(db, "run"))!;
    const intensity = (await repo.getIntensity(db, "hard"))!;

    await service.buildConfirmation(db, {
      chatId: -100, name: "Alex", activity, intensity, points: 20, random: () => 0,
    });
    expect(await repo.getLastTemplateIndex(db, -200, "hard")).toBeNull();
  });
});

describe("HYPE_TEMPLATES", () => {
  it("exposes exactly the three buckets", () => {
    expect(Object.keys(HYPE_TEMPLATES).sort()).toEqual(["hard", "light", "moderate"]);
  });
});

describe("/log argument parsing", () => {
  const activities = ["run", "gym", "swim", "walk"];
  const intensities = ["light", "moderate", "hard"];

  it("accepts activity then intensity", () => {
    expect(matchLogArgs(["run", "hard"], activities, intensities)).toEqual({
      activityKey: "run", intensityKey: "hard",
    });
  });

  it("accepts them in either order", () => {
    expect(matchLogArgs(["hard", "run"], activities, intensities)).toEqual({
      activityKey: "run", intensityKey: "hard",
    });
  });

  it("returns nulls for anything it doesn't recognise", () => {
    expect(matchLogArgs(["yoga"], activities, intensities)).toEqual({
      activityKey: null, intensityKey: null,
    });
    expect(matchLogArgs(["run"], activities, intensities).intensityKey).toBeNull();
  });
});

describe("callback data", () => {
  it("round-trips and stays inside Telegram's 64-byte limit", () => {
    const data = encodeConfirm(1234567890, "moderate".length ? "swim" : "", "moderate");
    expect(new TextEncoder().encode(data).length).toBeLessThanOrEqual(64);
    expect(parseCallback(data)).toEqual({
      step: "confirm", userId: 1234567890, activityKey: "swim", intensityKey: "moderate",
    });
  });

  it("ignores data that isn't ours", () => {
    expect(parseCallback("something:else")).toBeNull();
    expect(parseCallback("log:c:notanumber:run:hard")).toBeNull();
  });
});

describe("/me", () => {
  it("shows the total, the entry ids and only live entries", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);
    const now = new Date("2026-09-02T01:00:00Z");

    const first = await service.logActivity(db, {
      chatId: -100, userId: 1, activityKey: "run", intensityKey: "hard",
      sourceMessageId: 1, now,
    });
    await service.logActivity(db, {
      chatId: -100, userId: 1, activityKey: "swim", intensityKey: "light",
      sourceMessageId: 2, now,
    });
    if (first.status !== "logged") throw new Error("unreachable");

    let text = await service.buildMe(db, {
      chatId: -100, userId: 1, name: "Alex", timezone: "Asia/Singapore",
    });
    expect(text).toContain("<b>Alex</b> — 32 pts");
    expect(text).toContain(`#${first.event.id}`);
    // 01:00 UTC rendered in the group's timezone (UTC+8). The month
    // abbreviation ("Sep" / "Sept") varies with the ICU version.
    expect(text).toMatch(/2 Sept?, 09:00/);

    await service.voidEvent(db, {
      chatId: -100, requesterId: 1, requesterIsAdmin: true, eventId: first.event.id,
    });
    text = await service.buildMe(db, {
      chatId: -100, userId: 1, name: "Alex", timezone: "Asia/Singapore",
    });
    expect(text).toContain("12 pts");
    expect(text).not.toContain(`#${first.event.id} `);
  });

  it("prompts a member who hasn't logged anything", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);
    const text = await service.buildMe(db, {
      chatId: -100, userId: 1, name: "Alex", timezone: "Asia/Singapore",
    });
    expect(text).toContain("Nothing logged yet");
  });
});

describe("/activities", () => {
  it("lists every key with its value", async () => {
    const db = createTestDb();
    const text = await service.buildActivityList(db);
    for (const key of ["run", "gym", "swim", "walk", "light", "moderate", "hard"]) {
      expect(text).toContain(`<code>${key}</code>`);
    }
    expect(text).toContain("10 base");
    expect(text).toContain("x1.5");
  });
});
