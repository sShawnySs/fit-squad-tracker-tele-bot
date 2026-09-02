/**
 * Confirmation lines posted in the group. Static table, no LLM call.
 * Placeholders: {name} {activity} {intensity} {points}
 */
export const CONFIRMATION_TEMPLATES: readonly string[] = [
  "{name} just crushed a {intensity} {activity} — {points} pts. Who's next?",
  "{name}: {activity}, {intensity}. That's {points}. The board is moving.",
  "Logged: {name} — {intensity} {activity}, {points} pts.",
  "{points} pts to {name} for a {intensity} {activity}. Nice work.",
  "{name} put in a {intensity} {activity}. +{points}.",
  "That's a {intensity} {activity} for {name} — {points} on the board.",
  "{name} banked {points} pts. {activity}, {intensity}, done.",
  "Another {activity} for {name} — {intensity}, {points} pts.",
  "{name} showed up: {intensity} {activity}, {points} pts.",
  "+{points} for {name}. {intensity} {activity}. Keep it rolling.",
  "{name} clocked a {intensity} {activity}. {points} pts richer.",
  "Respect — {name} went {intensity} on the {activity}. {points} pts.",
  "{name} is on the board with {points} pts ({intensity} {activity}).",
  "{intensity} {activity} logged by {name}. {points} pts.",
  "{name} didn't skip it. {activity}, {intensity}, {points} pts.",
  "{points} pts. {name} earned every one of them — {intensity} {activity}.",
  "Good session, {name}. {intensity} {activity} = {points} pts.",
  "{name} adds {points} pts. The rest of you seen this?",
  "{activity} done, {intensity} effort, {points} pts to {name}.",
  "{name} just moved. {intensity} {activity}, {points} pts.",
  "Counted: {name}, {intensity} {activity}, {points} pts.",
  "{name} chose the hard way — {intensity} {activity}. {points} pts.",
  "{points} pts for {name}. That {activity} won't log itself.",
  "Stacking up: {name} takes {points} pts from a {intensity} {activity}.",
  "{name} was out there. {intensity} {activity}, {points} pts.",
  "One more for {name} — {intensity} {activity}, worth {points}.",
  "{name} put {points} pts on the board. {activity}, {intensity}.",
  "Nice one {name}. {intensity} {activity}, {points} pts logged.",
  "{name}: {points} pts. Earned with a {intensity} {activity}.",
  "The {activity} is in. {name} takes {points} pts.",
];

export interface TemplateVars {
  name: string;
  activity: string;
  intensity: string;
  points: number;
}

/**
 * Picks a template index, never repeating the previous one in the same chat.
 * `random` is injectable so tests are deterministic.
 */
export function pickTemplateIndex(
  lastIndex: number | null,
  random: () => number = Math.random,
  total: number = CONFIRMATION_TEMPLATES.length,
): number {
  if (total <= 1) return 0;
  if (lastIndex === null || lastIndex < 0 || lastIndex >= total) {
    return Math.floor(random() * total) % total;
  }
  // Draw from the other (total - 1) slots, then shift past the last one.
  const draw = Math.floor(random() * (total - 1)) % (total - 1);
  return draw >= lastIndex ? draw + 1 : draw;
}

export function renderTemplate(index: number, vars: TemplateVars): string {
  const template = CONFIRMATION_TEMPLATES[index] ?? CONFIRMATION_TEMPLATES[0]!;
  return template
    .replaceAll("{name}", vars.name)
    .replaceAll("{activity}", vars.activity)
    .replaceAll("{intensity}", vars.intensity)
    .replaceAll("{points}", String(vars.points));
}
