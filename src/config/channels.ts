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
  'bot-commands',
  'bot-dev',
  'bot-log',
  'verify',
]);

export const ANNOUNCEMENT_CHANNELS = {
  sectLog: 'bot-log',
  levelUp: 'level-up',
  leaderboard: 'leaderboard',
  tribulation: 'tribulation',
  verification: 'verify',
} as const;

/**
 * Voice channels that earn the "Working" XP bonus (pomodoro / deep-focus
 * intent). Members in these channels get 15 XP/min instead of 10.
 */
export const WORKING_VOICE_CHANNEL_NAMES: ReadonlySet<string> = new Set([
  'Focus Room',
  'Quiet Study',
]);
