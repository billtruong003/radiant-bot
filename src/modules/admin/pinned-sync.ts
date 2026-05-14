import type { Guild, Message, TextChannel } from 'discord.js';
import { matchesChannelName } from '../../config/channels.js';
import {
  BOT_PIN_MARKER,
  PINNED_MESSAGES,
  type PinnedMessageDef,
} from '../../config/pinned-messages.js';
import { themedEmbed } from '../../utils/embed.js';
import { logger } from '../../utils/logger.js';

/**
 * Phase 12.6 — pinned message sync.
 *
 * For each channel in `PINNED_MESSAGES`:
 *   1. Find the channel in the guild (canonical name match — handles
 *      Phase 11 icon-decorated names like `📜-rules-📜`).
 *   2. Read existing pins. Unpin + (optionally delete) any old pin
 *      authored by the bot AND containing the BOT_PIN_MARKER. User-
 *      posted pins are NEVER touched.
 *   3. Post the new content as a themed embed.
 *   4. Pin the new message.
 *   5. React with the channel's emoji palette (4-6 themed unicode emojis)
 *      for visual flair. Failures are swallowed.
 *
 * Idempotency: running this multiple times replaces the bot's pin in
 * each channel exactly once per channel. Order of pins inside the pinned
 * list is FIFO from Discord's side.
 *
 * Best-effort: any single-channel failure logs but doesn't abort the
 * others. Returns a per-channel report.
 */

export interface SyncOutcome {
  canonicalChannel: string;
  status: 'synced' | 'channel-missing' | 'no-permission' | 'error';
  detail?: string;
  /** Discord message id of the newly posted pin (if synced). */
  newPinId?: string;
  /** Number of old bot pins unpinned during this sync. */
  unpinnedOld?: number;
  /** Number of emojis successfully reacted. */
  reactedCount?: number;
}

export interface SyncReport {
  outcomes: SyncOutcome[];
  totalSynced: number;
  totalFailed: number;
  totalMissing: number;
}

function findChannel(guild: Guild, canonical: string): TextChannel | null {
  const ch = guild.channels.cache.find((c) => c.isTextBased() && matchesChannelName(c, canonical));
  return (ch as TextChannel | undefined) ?? null;
}

function isBotPin(message: Message, botId: string): boolean {
  if (message.author.id !== botId) return false;
  // Check footer text + first embed for the marker. Marker may live in
  // either the embed footer (where we plant it) OR the message content
  // (legacy fallback if the pin was a plain-text message).
  if (message.embeds.length > 0) {
    const footer = message.embeds[0]?.footer?.text ?? '';
    if (footer.includes(BOT_PIN_MARKER)) return true;
    // Also recognise older bot pins that just had a title prefix.
    const title = message.embeds[0]?.title ?? '';
    if (title.startsWith('📜 Luật Tông Môn') || title.startsWith('📖 Cẩm Nang Tu Vi')) return true;
  }
  if (message.content.includes(BOT_PIN_MARKER)) return true;
  return false;
}

async function syncOne(guild: Guild, def: PinnedMessageDef): Promise<SyncOutcome> {
  const channel = findChannel(guild, def.canonicalChannel);
  if (!channel) {
    return {
      canonicalChannel: def.canonicalChannel,
      status: 'channel-missing',
      detail: `no channel matched canonical '${def.canonicalChannel}'`,
    };
  }

  const me = guild.members.me;
  if (!me || !channel.permissionsFor(me)?.has(['ManageMessages', 'SendMessages', 'AddReactions'])) {
    return {
      canonicalChannel: def.canonicalChannel,
      status: 'no-permission',
      detail: 'bot lacks ManageMessages / SendMessages / AddReactions',
    };
  }

  try {
    // 1. Unpin old bot pins in this channel (NEVER user pins).
    const existing = await channel.messages.fetchPinned();
    let unpinnedOld = 0;
    for (const msg of existing.values()) {
      if (isBotPin(msg, me.id)) {
        try {
          await msg.unpin('pinned-sync replace');
          unpinnedOld++;
        } catch (err) {
          logger.warn(
            { err, channel: def.canonicalChannel, msg_id: msg.id },
            'pinned-sync: unpin failed',
          );
        }
      }
    }

    // 2. Post new themed embed.
    const embed = themedEmbed('plain', {
      color: def.color,
      title: def.title,
      description: def.description.slice(0, 4090), // Discord embed desc limit 4096
      footer: `${def.footer} · ${BOT_PIN_MARKER}`,
      timestamp: true,
    });
    const sent = await channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });

    // 3. Pin it.
    await sent.pin('pinned-sync new');

    // 4. React with themed palette.
    let reactedCount = 0;
    for (const emoji of def.reactions) {
      try {
        await sent.react(emoji);
        reactedCount++;
      } catch (err) {
        logger.warn(
          { err, channel: def.canonicalChannel, emoji },
          'pinned-sync: react failed (continuing)',
        );
      }
    }

    logger.info(
      {
        channel: def.canonicalChannel,
        new_pin_id: sent.id,
        unpinned_old: unpinnedOld,
        reacted: reactedCount,
      },
      'pinned-sync: channel synced',
    );

    return {
      canonicalChannel: def.canonicalChannel,
      status: 'synced',
      newPinId: sent.id,
      unpinnedOld,
      reactedCount,
    };
  } catch (err) {
    logger.error({ err, channel: def.canonicalChannel }, 'pinned-sync: sync failed');
    return {
      canonicalChannel: def.canonicalChannel,
      status: 'error',
      detail: (err as Error).message ?? 'unknown',
    };
  }
}

/**
 * Sync every channel in PINNED_MESSAGES. Returns aggregated report.
 */
export async function syncAllPinnedMessages(guild: Guild): Promise<SyncReport> {
  const outcomes: SyncOutcome[] = [];
  for (const def of PINNED_MESSAGES) {
    const outcome = await syncOne(guild, def);
    outcomes.push(outcome);
  }
  return {
    outcomes,
    totalSynced: outcomes.filter((o) => o.status === 'synced').length,
    totalFailed: outcomes.filter((o) => o.status === 'error' || o.status === 'no-permission')
      .length,
    totalMissing: outcomes.filter((o) => o.status === 'channel-missing').length,
  };
}

export const __for_testing = { isBotPin, findChannel };
