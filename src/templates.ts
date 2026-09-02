/**
 * Confirmation lines posted in the group. Static table, no LLM call.
 * Placeholders: {name} {activity} {intensity} {points}
 *
 * Bucketed by intensity, because the joke scales with the effort — a "SOUND THE
 * ALARMS" line under a light walk lands wrong. Most lines name their intensity
 * inline, which is why they can't be shared across buckets.
 *
 * Structured as a tone set so a calmer second set can drop in later (see
 * `groups.tone` in the deferred list) without touching the picker.
 */

export type IntensityBucket = "light" | "moderate" | "hard";

export const HYPE_TEMPLATES: Record<IntensityBucket, readonly string[]> = {
  light: [
    "{name} logged a light {activity} — {points} pts. LOOK AT THIS MF SHOWING UP 😤💪",
    "{points} pts for {name}?? on a LIGHT {activity}?? the discipline is UNMATCHED",
    '{name} really said "I will do the smallest amount of exercise" and meant it. {points} pts. LEGENDARY.',
    "BREAKING: {name} does {activity}, gets {points} pts, ascends to a higher plane of existence",
    "{name} clocked in. {points} pts. the streak GODS are pleased 🙏",
    "not {name} casually building generational habits w a light {activity}. {points} pts. ICONIC.",
    "{points} pts just dropped from {name}. light work?? in THIS economy?? respect.",
    "{name} did the bare minimum and the bare minimum was STILL {points} pts of pure excellence",
    "sir/ma'am {name} has logged a light {activity} for {points} pts and I am WEEPING with pride",
    "{name}: {activity}, {points} pts. showing up when it's easy is how legends are FORGED 🔥",
  ],
  moderate: [
    "{name} went MODERATE mode and the board just felt it. {points} pts. WHO GAVE THEM THIS POWER",
    "{points} PTS?! on a MODERATE {activity}?! {name} is NOT here to make friends",
    "{name} just did {activity} and the scoreboard audibly gasped. {points} pts.",
    "everyone stay CALM but {name} just banked {points} pts and is now a problem",
    '{name} said "watch this" and did a moderate {activity} for {points} pts. we are NOT okay',
    "{points} pts from {name}. moderate?? that's what THEY want you to think. unhinged behavior.",
    "{name} really woke up and chose violence (a moderate {activity}, {points} pts)",
    "ALERT: {name} has entered the chat with {points} pts and main character energy",
    "{name} did a normal amount of exercise and turned it into a WAR CRIME against the leaderboard. {points} pts.",
    "{points} pts logged. {name} is COOKING and I don't think they know it yet 🔥",
  ],
  hard: [
    "{name} did a HARD {activity} and I felt it in MY OWN legs. {points} pts. UNHINGED. ICONIC. UNWELL.",
    "SOUND THE ALARMS. {name} just logged {points} pts and the rest of the group should be SCARED",
    '{name} said "no days off" and meant it in a way that concerns me. {points} pts. absolute PSYCHO (affectionate)',
    "{points} PTS?!?! on a HARD {activity}?!?! {name} is playing a DIFFERENT GAME",
    "{name} just achieved a personal best and possibly a war crime. {points} pts logged.",
    "everyone else can go home, {name} just did {points} pts of hard {activity} and RUINED the curve for everyone",
    "{name}: hard {activity}. {points} pts. I have QUESTIONS and also mild fear",
    "THE BOARD IS SHAKING. {name} logged {points} pts and I think they're not human anymore",
    "{name} went absolutely FERAL on that {activity}. {points} pts. someone check on them (compliment)",
    "{points} pts from {name}. hard {activity}. this is either inspiring or a cry for help and honestly? both work",
  ],
};

/**
 * Which bucket a given intensity falls into. Keyed off the multiplier rather
 * than the key, so an intensity added to the database later ("brutal", 2.5x)
 * still gets sensible copy instead of falling over.
 */
export function bucketFor(intensity: { key: string; multiplier: number }): IntensityBucket {
  if (intensity.key in HYPE_TEMPLATES) return intensity.key as IntensityBucket;
  if (intensity.multiplier >= 2) return "hard";
  if (intensity.multiplier >= 1.5) return "moderate";
  return "light";
}

export function templatesFor(bucket: IntensityBucket): readonly string[] {
  return HYPE_TEMPLATES[bucket];
}

export interface TemplateVars {
  name: string;
  activity: string;
  intensity: string;
  points: number;
}

/**
 * Picks a template index, never repeating the previous one used in this chat
 * for this bucket. `random` is injectable so tests are deterministic.
 */
export function pickTemplateIndex(
  lastIndex: number | null,
  random: () => number = Math.random,
  total = 10,
): number {
  if (total <= 1) return 0;
  if (lastIndex === null || lastIndex < 0 || lastIndex >= total) {
    return Math.floor(random() * total) % total;
  }
  // Draw from the other (total - 1) slots, then shift past the last one.
  const draw = Math.floor(random() * (total - 1)) % (total - 1);
  return draw >= lastIndex ? draw + 1 : draw;
}

export function renderTemplate(
  bucket: IntensityBucket,
  index: number,
  vars: TemplateVars,
): string {
  const set = templatesFor(bucket);
  const template = set[index] ?? set[0]!;
  return template
    .replaceAll("{name}", vars.name)
    .replaceAll("{activity}", vars.activity)
    .replaceAll("{intensity}", vars.intensity)
    .replaceAll("{points}", String(vars.points));
}
