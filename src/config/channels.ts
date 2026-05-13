import type { Guild } from 'discord.js';
import { logger } from '../utils/logger.js';

/**
 * Channel name → Discord channel ID cache. Lazy-populated on first lookup
 * by walking the guild's channel cache. Refreshable via `refreshChannelCache`
 * when sync-server creates new channels.
 */

let cache: Map<string, string> | null = null;

export function getChannelId(guild: Guild, name: string): string | null {
  if (!cache) cache = buildCache(guild);
  return cache.get(name) ?? null;
}

export function refreshChannelCache(guild: Guild): void {
  cache = buildCache(guild);
  logger.debug({ size: cache.size }, 'channels: cache refreshed');
}

function buildCache(guild: Guild): Map<string, string> {
  const m = new Map<string, string>();
  for (const ch of guild.channels.cache.values()) {
    m.set(ch.name, ch.id);
  }
  return m;
}

/**
 * Channels where XP is NOT awarded for messages. Keyed by channel name so we
 * can match without resolving IDs first (channel can also be matched by ID
 * via the resolved cache).
 */
export const NO_XP_CHANNEL_NAMES: ReadonlySet<string> = new Set([
  'lệnh-bot',
  'bot-dev',
  'nhật-ký-tông-môn',
  'xác-minh',
]);

export const ANNOUNCEMENT_CHANNELS = {
  sectLog: 'nhật-ký-tông-môn',
  levelUp: 'đột-phá',
  leaderboard: 'bảng-xếp-hạng',
  tribulation: 'độ-kiếp',
  verification: 'xác-minh',
} as const;
