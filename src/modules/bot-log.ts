import type { Client, MessagePayload, TextChannel } from 'discord.js';
import { ANNOUNCEMENT_CHANNELS, matchesChannelName } from '../config/channels.js';
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

function getChannelByKey(canonical: string): TextChannel | null {
  if (!_client) return null;
  const guild = _client.guilds.cache.get(env.DISCORD_GUILD_ID);
  if (!guild) return null;
  const ch = guild.channels.cache.find((c) => matchesChannelName(c, canonical) && c.isTextBased());
  return (ch as TextChannel | undefined) ?? null;
}

async function postToChannel(
  canonical: string,
  content: string | MessagePayload,
  logKey: string,
): Promise<void> {
  const ch = getChannelByKey(canonical);
  if (!ch) {
    logger.debug({ canonical }, `${logKey}: channel not found`);
    return;
  }
  try {
    if (typeof content === 'string') {
      await ch.send({ content, allowedMentions: { parse: [] } });
    } else {
      await ch.send(content);
    }
  } catch (err) {
    logger.warn({ err, canonical }, `${logKey}: post failed`);
  }
}

export async function postBotLog(content: string | MessagePayload): Promise<void> {
  // Defense-in-depth — narration text often contains `**<user>**` quoting
  // an offender's name. allowedMentions.parse=[] hard-stops any ping
  // rendering from injected display names.
  return postToChannel(ANNOUNCEMENT_CHANNELS.sectLog, content, 'bot-log');
}

/**
 * Post a public-facing punishment announcement to #tribulation. Used by
 * /thien-dao so cultivators see verdicts (the previous bot-log-only path
 * was staff-only via the `bot_log` perm preset — Bill 2026-05-20: "vong
 * ngôn... cũng ko thông báo ra kênh public").
 */
export async function postTribulation(content: string | MessagePayload): Promise<void> {
  return postToChannel(ANNOUNCEMENT_CHANNELS.tribulation, content, 'tribulation');
}
