import { describe, expect, it } from "vitest";

import {
  encodeConfirm,
  encodeDurationPick,
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
import type { Duration, Intensity } from "../src/types.js";

const BUCKETS: IntensityBucket[] = ["light", "moderate", "hard"];

const vars = (bucket: IntensityBucket) => ({
  name: "Alex",
  activity: "cardio",
  intensity: bucket,
  duration: "30–60 min",
  points: 20,
});

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
        const text = renderTemplate(bucket, i, vars(bucket));
        expect(text).not.toMatch(/\{(name|activity|intensity|duration|points)\}/);
        expect(text).toContain("Alex");
        expect(text).toContain("20");
      }
    }
  });

  it("uses only balanced <b> tags in the copy, no other markup or bare < > &", () => {
    for (const bucket of BUCKETS) {
      for (const line of templatesFor(bucket)) {
        const open = line.match(/<b>/g)?.length ?? 0;
        const close = line.match(/<\/b>/g)?.length ?? 0;
        expect(close, line).toBe(open);
        const withoutBold = line.replaceAll("<b>", "").replaceAll("</b>", "");
        expect(withoutBold, line).not.toMatch(/[<>&]/);
      }
    }
  });

  it("bolds the variable placeholders so they render bold in the group", () => {
    for (const bucket of BUCKETS) {
      for (const line of templatesFor(bucket)) {
        for (const token of ["{name}", "{activity}", "{intensity}", "{duration}", "{points}"]) {
          if (line.includes(token)) {
            expect(line, line).toContain(`<b>${token}</b>`);
          }
        }
      }
    }
  });

  it("every line names the workout and how long it lasted", () => {
    for (const bucket of BUCKETS) {
      for (const line of templatesFor(bucket)) {
        expect(line, line).toContain("{activity}");
        expect(line, line).toContain("{duration}");
      }
    }
  });

  it("maps an intensity to its bucket by key, then by multiplier", () => {
    expect(bucketFor({ key: "light", multiplier: 1 })).toBe("light");
    expect(bucketFor({ key: "moderate", multiplier: 1.4 })).toBe("moderate");
    expect(bucketFor({ key: "hard", multiplier: 1.8 })).toBe("hard");
    // "max" has no bucket of its own — 2.3x lands it in the hard copy.
    expect(bucketFor({ key: "max", multiplier: 2.3 })).toBe("hard");
    // An intensity added to the database later still gets sensible copy.
    expect(bucketFor({ key: "brisk", multiplier: 1.6 })).toBe("moderate");
    expect(bucketFor({ key: "stroll", multiplier: 0.5 })).toBe("light");
  });

  it("always picks a line from the bucket matching the effort", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);
    const activity = (await repo.getActivity(db, "cardio"))!;
    const duration = (await repo.getDuration(db, "standard"))!;

    const rendered = (bucket: IntensityBucket) =>
      new Set(
        templatesFor(bucket).map((_, i) =>
          renderTemplate(bucket, i, {
            name: "Alex",
            activity: activity.label.toLowerCase(),
            intensity: bucket,
            duration: duration.label,
            points: 20,
          }),
        ),
      );

    for (const bucket of BUCKETS) {
      const intensity = (await repo.getIntensity(db, bucket))!;
      const others = BUCKETS.filter((b) => b !== bucket);

      // 20 draws: every one has to come from this bucket, never another.
      for (let i = 0; i < 20; i++) {
        const text = await service.buildConfirmation(db, {
          chatId: -100, name: "Alex", activity, intensity, duration, points: 20,
        });
        expect(rendered(bucket).has(text), text).toBe(true);
        for (const other of others) expect(rendered(other).has(text)).toBe(false);
      }
      expect(await repo.getLastTemplateIndex(db, -100, bucket)).not.toBeNull();
    }
  });

  it("gives max-intensity logs the hard copy", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);
    const activity = (await repo.getActivity(db, "sport"))!;
    const intensity = (await repo.getIntensity(db, "max"))!;
    const duration = (await repo.getDuration(db, "long"))!;

    await service.buildConfirmation(db, {
      chatId: -100, name: "Alex", activity, intensity, duration, points: 32,
    });
    expect(await repo.getLastTemplateIndex(db, -100, "hard")).not.toBeNull();
    expect(await repo.getLastTemplateIndex(db, -100, "moderate")).toBeNull();
  });

  it("never sends the same line twice in a row in a chat", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);
    const activity = (await repo.getActivity(db, "cardio"))!;
    const intensity = (await repo.getIntensity(db, "hard"))!;
    const duration = (await repo.getDuration(db, "standard"))!;

    let previous = "";
    for (let i = 0; i < 50; i++) {
      const text = await service.buildConfirmation(db, {
        chatId: -100, name: "Alex", activity, intensity, duration, points: 20,
      });
      expect(text).not.toBe(previous);
      previous = text;
    }
  });

  it("tracks the last line separately per bucket", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);
    const activity = (await repo.getActivity(db, "cardio"))!;
    const duration = (await repo.getDuration(db, "standard"))!;
    const light = (await repo.getIntensity(db, "light"))!;
    const hard = (await repo.getIntensity(db, "hard"))!;

    await service.buildConfirmation(db, {
      chatId: -100, name: "Alex", activity, intensity: light, duration,
      points: 10, random: () => 0,
    });
    await service.buildConfirmation(db, {
      chatId: -100, name: "Alex", activity, intensity: hard, duration,
      points: 20, random: () => 0.5,
    });

    expect(await repo.getLastTemplateIndex(db, -100, "light")).toBe(0);
    expect(await repo.getLastTemplateIndex(db, -100, "hard")).toBe(5);
    // A light log after a light log cannot repeat index 0.
    await service.buildConfirmation(db, {
      chatId: -100, name: "Alex", activity, intensity: light, duration,
      points: 10, random: () => 0,
    });
    expect(await repo.getLastTemplateIndex(db, -100, "light")).toBe(1);
  });

  it("escapes the name and any label that would break HTML", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "a<b" }]);
    const activity = (await repo.getActivity(db, "cardio"))!;
    const intensity = (await repo.getIntensity(db, "hard"))!;
    // "<15 min" is a real seeded label and would break the parse mode raw.
    const duration = (await repo.getDuration(db, "quick"))!;
    expect(duration.label).toBe("<15 min");

    const text = await service.buildConfirmation(db, {
      chatId: -100, name: "a<b", activity, intensity, duration, points: 5,
      random: () => 0,
    });
    expect(text).toContain("a&lt;b");
    expect(text).not.toMatch(/<(?!\/?(b|i|code)>)/);
  });

  it("keeps every chat's rotation independent", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);
    await seedChat(db, -200, [{ id: 2, name: "Jo" }]);
    const activity = (await repo.getActivity(db, "cardio"))!;
    const intensity = (await repo.getIntensity(db, "hard"))!;
    const duration = (await repo.getDuration(db, "standard"))!;

    await service.buildConfirmation(db, {
      chatId: -100, name: "Alex", activity, intensity, duration,
      points: 20, random: () => 0,
    });
    expect(await repo.getLastTemplateIndex(db, -200, "hard")).toBeNull();
  });

  it("exposes exactly the three buckets", () => {
    expect(Object.keys(HYPE_TEMPLATES).sort()).toEqual(["hard", "light", "moderate"]);
  });
});

describe("/log argument parsing", () => {
  const activities = ["cardio", "strength", "sport"];
  const intensities = ["light", "moderate", "hard", "max"];
  const durations = ["quick", "short", "standard", "long"];

  it("accepts activity then intensity, leaving duration unset", () => {
    expect(matchLogArgs(["cardio", "hard"], activities, intensities, durations)).toEqual({
      activityKey: "cardio", intensityKey: "hard", durationKey: null, unknown: [],
    });
  });

  it("accepts them in any order", () => {
    expect(matchLogArgs(["hard", "cardio"], activities, intensities, durations)).toEqual({
      activityKey: "cardio", intensityKey: "hard", durationKey: null, unknown: [],
    });
    expect(
      matchLogArgs(["long", "max", "sport"], activities, intensities, durations),
    ).toEqual({
      activityKey: "sport", intensityKey: "max", durationKey: "long", unknown: [],
    });
  });

  it("takes an explicit duration as a third token", () => {
    expect(
      matchLogArgs(["sport", "max", "long"], activities, intensities, durations),
    ).toEqual({
      activityKey: "sport", intensityKey: "max", durationKey: "long", unknown: [],
    });
  });

  it("collects anything it doesn't recognise", () => {
    expect(matchLogArgs(["yoga"], activities, intensities, durations)).toEqual({
      activityKey: null, intensityKey: null, durationKey: null, unknown: ["yoga"],
    });
    expect(
      matchLogArgs(["cardio"], activities, intensities, durations).intensityKey,
    ).toBeNull();
  });

  it("no longer recognises the v1 keys", () => {
    expect(
      matchLogArgs(["run", "hard"], activities, intensities, durations).activityKey,
    ).toBeNull();
  });
});

describe("callback data", () => {
  it("round-trips and stays inside Telegram's 64-byte limit", () => {
    const data = encodeConfirm(1234567890, "strength", "moderate", "standard");
    expect(new TextEncoder().encode(data).length).toBeLessThanOrEqual(64);
    expect(parseCallback(data)).toEqual({
      step: "confirm",
      userId: 1234567890,
      activityKey: "strength",
      intensityKey: "moderate",
      durationKey: "standard",
    });
  });

  it("distinguishes the duration step from the confirm step", () => {
    const data = encodeDurationPick(42, "sport", "max", "long");
    expect(parseCallback(data)).toEqual({
      step: "duration",
      userId: 42,
      activityKey: "sport",
      intensityKey: "max",
      durationKey: "long",
    });
  });

  it("ignores data that isn't ours", () => {
    expect(parseCallback("something:else")).toBeNull();
    expect(parseCallback("log:c:notanumber:cardio:hard:long")).toBeNull();
    expect(parseCallback("log:c:1:cardio:hard")).toBeNull(); // v1 shape, no duration
  });
});

describe("/me", () => {
  it("shows the total, entry ids, all three axes and only live entries", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "Alex" }]);
    const now = new Date("2026-09-02T01:00:00Z");

    const first = await service.logActivity(db, {
      chatId: -100, userId: 1, activityKey: "cardio", intensityKey: "hard",
      durationKey: "long", sourceMessageId: 1, now,
    });
    await service.logActivity(db, {
      chatId: -100, userId: 1, activityKey: "strength", intensityKey: "light",
      durationKey: "quick", sourceMessageId: 2, now,
    });
    if (first.status !== "logged") throw new Error("unreachable");
    expect(first.event.points).toBe(22); // 6 × 1.8 × 2.0 = 21.6

    let text = await service.buildMe(db, {
      chatId: -100, userId: 1, name: "Alex", timezone: "Asia/Singapore",
    });
    expect(text).toContain("<b>Alex</b> — 25 pts"); // 22 + 3
    expect(text).toContain(`#${first.event.id}`);
    expect(text).toContain("cardio, hard, long");
    // 01:00 UTC rendered in the group's timezone (UTC+8). The month
    // abbreviation ("Sep" / "Sept") varies with the ICU version.
    expect(text).toMatch(/2 Sept?, 09:00/);

    await service.voidEvent(db, {
      chatId: -100, requesterId: 1, requesterIsAdmin: true, eventId: first.event.id,
    });
    text = await service.buildMe(db, {
      chatId: -100, userId: 1, name: "Alex", timezone: "Asia/Singapore",
    });
    expect(text).toContain("3 pts");
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
  it("prints all three tables with their values", async () => {
    const db = createTestDb();
    const text = await service.buildActivityList(db);

    for (const key of [
      "cardio", "strength", "sport",
      "light", "moderate", "hard", "max",
      "quick", "short", "standard", "long",
    ]) {
      expect(text, key).toContain(`<code>${key}</code>`);
    }

    expect(text).toContain("points = base × intensity × duration");
    expect(text).toContain("6 base");
    expect(text).toContain("7 base");
    expect(text).toContain("×1.4");
    expect(text).toContain("×0.5");
    // The "<15 min" label must be escaped, or the whole message fails to send.
    expect(text).toContain("&lt;15 min");
  });

  it("escapes every label it prints", async () => {
    const db = createTestDb();
    const durations: Duration[] = await repo.listDurations(db);
    const intensities: Intensity[] = await repo.listIntensities(db);
    expect(durations.length + intensities.length).toBeGreaterThan(0);

    const text = await service.buildActivityList(db);
    expect(text).not.toMatch(/<(?!\/?(b|code)>)/);
  });
});
