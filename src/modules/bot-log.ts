import type { Client, MessagePayload, TextChannel } from 'discord.js';
import { ANNOUNCEMENT_CHANNELS } from '../config/channels.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Cross-cutting helper that posts to the `#bot-log` channel for moderator
 * visibility. Singleton-style client reference is set during bot startup
 * (`setBotLogClient(client)`) so any module can call `postBotLog(...)`
 * without threading the Discord client through every function signature.
 *
 * All posts are best-effort and silently no-op when:
 *   - the client hasn't been wired yet (e.g., during a test)
 *   - the configured guild is not in cache
 *   - the #bot-log channel doesn't exist (sync-server hasn't run)
 *
 * Errors during send are logged at warn level but never re-thrown — the
 * caller shouldn't have to worry about logging side-effects.
 */

let _client: Client | null = null;

export function setBotLogClient(client: Client): void {
  _client = client;
}

export function clearBotLogClient(): void {
  _client = null;
}

function getChannel(): TextChannel | null {
  if (!_client) return null;
  const guild = _client.guilds.cache.get(env.DISCORD_GUILD_ID);
  if (!guild) return null;
  const ch = guild.channels.cache.find(
    (c) => c.name === ANNOUNCEMENT_CHANNELS.sectLog && c.isTextBased(),
  );
  return (ch as TextChannel | undefined) ?? null;
}

export async function postBotLog(content: string | MessagePayload): Promise<void> {
  const ch = getChannel();
  if (!ch) return;
  try {
    await ch.send(content);
  } catch (err) {
    logger.warn({ err }, 'bot-log: post failed');
  }
}
