import { escapeHtml } from "./html.js";
import type { BoardRow, RankedRow } from "./types.js";

export const BOARD_LIMIT = 10;

/**
 * Competition ranking: equal totals share a rank and the next rank skips
 * (145, 130, 130, 120 -> 1, 2, 2, 4). Input is expected already sorted by
 * total DESC; this re-sorts defensively so callers can't get it subtly wrong.
 */
export function rankRows(rows: BoardRow[]): RankedRow[] {
  const sorted = [...rows].sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name),
  );
  const ranked: RankedRow[] = [];
  let lastTotal: number | null = null;
  let lastRank = 0;

  sorted.forEach((row, index) => {
    const rank = lastTotal !== null && row.total === lastTotal ? lastRank : index + 1;
    ranked.push({ ...row, rank });
    lastTotal = row.total;
    lastRank = rank;
  });

  return ranked;
}

/**
 * One section of a scoreboard message. Returns the lines only — the caller
 * decides the header and what follows.
 */
export function formatSection(
  title: string,
  rows: BoardRow[],
  limit: number = BOARD_LIMIT,
): string {
  if (rows.length === 0) {
    return `<b>${escapeHtml(title)}</b>\nNothing logged yet. Be the first: /log`;
  }

  const ranked = rankRows(rows);
  const shown = ranked.slice(0, limit);
  const lines = shown.map(
    (row) => `${row.rank}. ${escapeHtml(row.name)} — ${row.total}`,
  );

  let body = `<b>${escapeHtml(title)}</b>\n${lines.join("\n")}`;
  if (ranked.length > limit) {
    body += `\nShowing top ${limit} of ${ranked.length}. Your score: /me`;
  }
  return body;
}

/** The `/board` reply: all-time only. */
export function formatBoardMessage(rows: BoardRow[], limit = BOARD_LIMIT): string {
  return formatSection("🏆 Scoreboard — all time", rows, limit);
}

/** The Monday cron post: trailing 7 days plus all time, in one message. */
export function formatWeeklyMessage(
  weekRows: BoardRow[],
  allTimeRows: BoardRow[],
  windowLabel: string,
  limit = BOARD_LIMIT,
): string {
  const week = formatSection(`🏆 Weekly scoreboard — ${windowLabel}`, weekRows, limit);
  const allTime = formatSection("All time", allTimeRows, limit);
  return `${week}\n\n${allTime}`;
}
