import type { Store } from '../store.js';
import type { User } from '../types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface LeaderboardEntry {
  rank: number;
  user: User;
  score: number;
}

/**
 * Top N users by total XP. Stable order: tie → earlier `joined_at` wins.
 */
export function topByXp(store: Store, limit: number): LeaderboardEntry[] {
  const users = store.users.all().slice();
  users.sort((a, b) => {
    if (b.xp !== a.xp) return b.xp - a.xp;
    return a.joined_at - b.joined_at;
  });
  return users.slice(0, limit).map((user, i) => ({
    rank: i + 1,
    user,
    score: user.xp,
  }));
}

/**
 * Top N users by XP earned in the last `days` days. Score is the sum of
 * xpLogs.amount within the window. Users with zero XP in the window are
 * excluded. Ties broken by total XP desc.
 */
export function topByXpInRange(store: Store, days: number, limit: number): LeaderboardEntry[] {
  const cutoff = Date.now() - days * MS_PER_DAY;
  const byUser = new Map<string, number>();
  for (const log of store.xpLogs.query((l) => l.created_at >= cutoff)) {
    byUser.set(log.discord_id, (byUser.get(log.discord_id) ?? 0) + log.amount);
  }
  const entries: { user: User; score: number }[] = [];
  for (const [discordId, score] of byUser) {
    const user = store.users.get(discordId);
    if (!user) continue;
    if (score <= 0) continue;
    entries.push({ user, score });
  }
  entries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.user.xp - a.user.xp;
  });
  return entries.slice(0, limit).map((e, i) => ({
    rank: i + 1,
    user: e.user,
    score: e.score,
  }));
}

export function weeklyLeaderboard(store: Store, limit = 10): LeaderboardEntry[] {
  return topByXpInRange(store, 7, limit);
}
