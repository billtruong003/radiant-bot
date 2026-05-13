import type { Store } from '../store.js';
import type { XpLog, XpSource } from '../types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function xpLogsForUser(store: Store, discordId: string): XpLog[] {
  return store.xpLogs.query((log) => log.discord_id === discordId);
}

export function xpLogsLastNDays(store: Store, days: number, discordId?: string): XpLog[] {
  const cutoff = Date.now() - days * MS_PER_DAY;
  return store.xpLogs.query((log) => {
    if (log.created_at < cutoff) return false;
    if (discordId && log.discord_id !== discordId) return false;
    return true;
  });
}

export function xpLogsBySource(store: Store, source: XpSource, discordId?: string): XpLog[] {
  return store.xpLogs.query((log) => {
    if (log.source !== source) return false;
    if (discordId && log.discord_id !== discordId) return false;
    return true;
  });
}

export function totalXpEarnedInRange(
  store: Store,
  discordId: string,
  fromMs: number,
  toMs: number,
): number {
  let sum = 0;
  for (const log of store.xpLogs.query(
    (l) => l.discord_id === discordId && l.created_at >= fromMs && l.created_at <= toMs,
  )) {
    sum += log.amount;
  }
  return sum;
}
