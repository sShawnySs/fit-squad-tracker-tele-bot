/**
 * Confirmation lines posted in the group. Static table, no LLM call.
 *
 * Placeholders: {name} {activity} {intensity} {duration} {points}. Every line
 * names the workout AND how long it lasted — {activity} and {duration} both
 * appear in all of them, not just the intensity. Each placeholder is wrapped in
 * <b>…</b> so it lands bold in the group; the values themselves are HTML-escaped
 * before they reach the template. The only markup a line may carry is <b>…</b> —
 * no bare < > & (everything goes out in HTML parse mode, and a test enforces it).
 *
 * Bucketed by intensity, because the joke scales with the effort — an
 * alarms-blaring line under a light walk lands wrong. Most lines name their
 * intensity inline, which is why they can't be shared across buckets.
 *
 * Tone: loud, hyperbolic, affectionately unhinged — "chose violence", "absolute
 * psycho (affectionate)". That's the voice; keep it. Just no profanity and no
 * shorthand ("MF", "w" for "with").
 *
 * Structured as a tone set so a calmer second set can drop in later (see
 * `groups.tone` in the deferred list) without touching the picker.
 */

export type IntensityBucket = "light" | "moderate" | "hard";

export const HYPE_TEMPLATES: Record<IntensityBucket, readonly string[]> = {
  light: [
    "<b>{name}</b> logged <b>{intensity}</b> <b>{activity}</b> for <b>{duration}</b> — <b>{points}</b> pts. LOOK AT THIS ABSOLUTE UNIT SHOWING UP 😤💪",
    "<b>{points}</b> pts for <b>{name}</b>?? <b>{duration}</b> of <b>{intensity}</b> <b>{activity}</b>?? the discipline is UNMATCHED 🫡",
    '<b>{name}</b> really said "I will do the smallest amount of exercise", did <b>{intensity}</b> <b>{activity}</b> for <b>{duration}</b>, and meant it. <b>{points}</b> pts. LEGENDARY. 🏆',
    "BREAKING: <b>{name}</b> does <b>{intensity}</b> <b>{activity}</b> for <b>{duration}</b>, banks <b>{points}</b> pts, ascends to a higher plane of existence 🧘✨",
    "<b>{name}</b> clocked in — <b>{intensity}</b> <b>{activity}</b>, <b>{duration}</b>, <b>{points}</b> pts. the streak GODS are pleased 🙏",
    "not <b>{name}</b> casually building generational habits with <b>{duration}</b> of <b>{intensity}</b> <b>{activity}</b>. <b>{points}</b> pts. ICONIC. 💅",
    "<b>{points}</b> pts just dropped from <b>{name}</b>. <b>{duration}</b> of <b>{intensity}</b> <b>{activity}</b>?? in THIS economy?? respect. 🤝",
    "<b>{name}</b> did the bare minimum — <b>{intensity}</b> <b>{activity}</b>, <b>{duration}</b> — and the bare minimum was STILL <b>{points}</b> pts of pure excellence 😤",
    "sir/ma'am <b>{name}</b> has logged <b>{intensity}</b> <b>{activity}</b> for <b>{duration}</b>, worth <b>{points}</b> pts, and I am WEEPING with pride 😭",
    "<b>{name}</b>: <b>{intensity}</b> <b>{activity}</b>, <b>{duration}</b>, <b>{points}</b> pts. showing up when it's easy is how legends are FORGED 🔥",
  ],
  moderate: [
    "<b>{name}</b> went <b>{intensity}</b> mode — <b>{activity}</b>, <b>{duration}</b> — and the board just felt it. <b>{points}</b> pts. WHO GAVE THEM THIS POWER ⚡",
    "<b>{points}</b> PTS?! <b>{duration}</b> of <b>{intensity}</b> <b>{activity}</b>?! <b>{name}</b> is NOT here to make friends 😤",
    "<b>{name}</b> just did <b>{intensity}</b> <b>{activity}</b> for <b>{duration}</b> and the scoreboard audibly gasped. <b>{points}</b> pts 😳",
    "everyone stay CALM but <b>{name}</b> just banked <b>{points}</b> pts off <b>{duration}</b> of <b>{intensity}</b> <b>{activity}</b> and is now a problem 🚨",
    '<b>{name}</b> said "watch this" and did <b>{intensity}</b> <b>{activity}</b> for <b>{duration}</b>, <b>{points}</b> pts. we are NOT okay 👀',
    '<b>{points}</b> pts from <b>{name}</b>. "<b>{intensity}</b>" <b>{activity}</b> for <b>{duration}</b>?? that\'s what THEY want you to think. unhinged behavior 🎭',
    "<b>{name}</b> really woke up and chose violence — <b>{intensity}</b> <b>{activity}</b>, <b>{duration}</b>, <b>{points}</b> pts 😈",
    "ALERT: <b>{name}</b> has entered the chat with <b>{points}</b> pts, <b>{duration}</b> of <b>{intensity}</b> <b>{activity}</b> and main character energy 🎬",
    "<b>{name}</b> did a normal amount of exercise (<b>{intensity}</b> <b>{activity}</b>, <b>{duration}</b>) and turned it into a WAR CRIME against the leaderboard. <b>{points}</b> pts 💀",
    "<b>{points}</b> pts logged — <b>{duration}</b> of <b>{intensity}</b> <b>{activity}</b>. <b>{name}</b> is COOKING and I don't think they know it yet 🔥",
  ],
  hard: [
    "<b>{name}</b> did <b>{intensity}</b> <b>{activity}</b> for <b>{duration}</b> and I felt it in MY OWN legs. <b>{points}</b> pts. UNHINGED. ICONIC. UNWELL. 🥵",
    "SOUND THE ALARMS 🚨 <b>{name}</b> just logged <b>{duration}</b> of <b>{intensity}</b> <b>{activity}</b> for <b>{points}</b> pts and the rest of the group should be SCARED",
    '<b>{name}</b> said "no days off" and did <b>{intensity}</b> <b>{activity}</b> for <b>{duration}</b> in a way that concerns me. <b>{points}</b> pts. absolute PSYCHO (affectionate) 😤',
    "<b>{points}</b> PTS?!?! <b>{duration}</b> of <b>{intensity}</b> <b>{activity}</b>?!?! <b>{name}</b> is playing a DIFFERENT GAME 🎮",
    "<b>{name}</b> just did <b>{intensity}</b> <b>{activity}</b> for <b>{duration}</b> — a personal best and possibly a war crime. <b>{points}</b> pts logged 💀",
    "everyone else can go home, <b>{name}</b> just did <b>{duration}</b> of <b>{intensity}</b> <b>{activity}</b> for <b>{points}</b> pts and RUINED the curve for everyone 📈",
    "<b>{name}</b>: <b>{intensity}</b> <b>{activity}</b>, <b>{duration}</b>, <b>{points}</b> pts. I have QUESTIONS and also mild fear 😰",
    "THE BOARD IS SHAKING 🫨 <b>{name}</b> logged <b>{duration}</b> of <b>{intensity}</b> <b>{activity}</b> for <b>{points}</b> pts and I think they're not human anymore",
    "<b>{name}</b> went absolutely FERAL — <b>{intensity}</b> <b>{activity}</b> for <b>{duration}</b>, <b>{points}</b> pts. someone check on them (compliment) 🐺",
    "<b>{points}</b> pts from <b>{name}</b>. <b>{intensity}</b> <b>{activity}</b>, <b>{duration}</b>. this is either inspiring or a cry for help and honestly? both work 🔥",
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
  /** The duration label, e.g. "30–60 min". Every line references it as {duration}. */
  duration: string;
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
    .replaceAll("{duration}", vars.duration)
    .replaceAll("{points}", String(vars.points));
}
