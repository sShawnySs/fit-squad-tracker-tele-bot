import { describe, expect, it } from "vitest";

import {
  encodeConfirm,
  matchLogArgs,
  parseCallback,
} from "../src/log-flow.js";
import {
  CONFIRMATION_TEMPLATES,
  pickTemplateIndex,
  renderTemplate,
} from "../src/templates.js";
import * as service from "../src/service.js";
import * as repo from "../src/repo.js";
import { createTestDb, seedChat } from "./helpers/d1.js";

describe("confirmation templates", () => {
  it("never repeats the previous template in the same chat", () => {
    for (let last = 0; last < CONFIRMATION_TEMPLATES.length; last++) {
      for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
        const next = pickTemplateIndex(last, () => r);
        expect(next).not.toBe(last);
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(CONFIRMATION_TEMPLATES.length);
      }
    }
  });

  it("can reach every template", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(pickTemplateIndex(null));
    expect(seen.size).toBe(CONFIRMATION_TEMPLATES.length);
  });

  it("fills every placeholder", () => {
    for (let i = 0; i < CONFIRMATION_TEMPLATES.length; i++) {
      const text = renderTemplate(i, {
        name: "Alex", activity: "run", intensity: "hard", points: 20,
      });
      expect(text).not.toMatch(/\{(name|activity|intensity|points)\}/);
    }
  });

  it("escapes the name and remembers the last template per chat", async () => {
    const db = createTestDb();
    await seedChat(db, -100, [{ id: 1, name: "a<b" }]);
    const activity = (await repo.getActivity(db, "run"))!;
    const intensity = (await repo.getIntensity(db, "hard"))!;

    const text = await service.buildConfirmation(db, {
      chatId: -100, name: "a<b", activity, intensity, points: 20, random: () => 0,
    });
    expect(text).toContain("a&lt;b");
    expect(await repo.getLastTemplateIndex(db, -100)).not.toBeNull();
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
