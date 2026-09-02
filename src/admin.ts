import { readAdminCache, writeAdminCache } from "./repo.js";

/**
 * Admin status comes from Telegram (`getChatAdministrators`), cached in D1 on a
 * TTL. We never maintain our own admin list — promote/demote in the group and
 * the bot follows within the TTL.
 */

export interface AdminLookupDeps {
  db: D1Database;
  chatId: number;
  fetchAdmins: () => Promise<number[]>;
  ttlSeconds: number;
  now?: Date;
}

export async function getAdminIds(deps: AdminLookupDeps): Promise<number[]> {
  const now = deps.now ?? new Date();
  const cached = await readAdminCache(deps.db, deps.chatId);

  if (cached.fetchedAt) {
    const ageSeconds = (now.getTime() - Date.parse(cached.fetchedAt)) / 1000;
    if (ageSeconds >= 0 && ageSeconds < deps.ttlSeconds) return cached.adminIds;
  }

  try {
    const fresh = await deps.fetchAdmins();
    await writeAdminCache(deps.db, deps.chatId, fresh, now.toISOString());
    return fresh;
  } catch (error) {
    // Telegram hiccup: fall back to whatever we last knew rather than locking
    // admins out of /void. If we never knew anything, nobody is an admin.
    console.error("getChatAdministrators failed", error);
    return cached.adminIds;
  }
}

export async function isAdmin(
  userId: number,
  deps: AdminLookupDeps,
): Promise<boolean> {
  const ids = await getAdminIds(deps);
  return ids.includes(userId);
}
