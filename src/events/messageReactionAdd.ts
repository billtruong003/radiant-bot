import {
  type Client,
  Events,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from 'discord.js';
import { NO_XP_CHANNEL_NAMES } from '../config/channels.js';
import { reactionXpCooldown } from '../modules/leveling/cooldown.js';
import { maybePromoteRank, postLevelUpEmbed } from '../modules/leveling/rank-promoter.js';
import { awardXp } from '../modules/leveling/tracker.js';
import { logger } from '../utils/logger.js';

/**
 * Reaction XP per SPEC §3:
 *   - 2 XP per reaction received (goes to message AUTHOR, not reactor)
 *   - max 10 reactions/message count toward XP
 *   - 10s cooldown per reactor (per any target message, anti-spam)
 *   - bots ignored both as reactor and as message author
 *   - self-react doesn't earn XP
 *
 * Partial reactions / users get fetched on the spot — Discord sends a
 * partial when the message wasn't in cache (older messages).
 */

const REACTION_XP_AMOUNT = 2;
const REACTION_MAX_PER_MESSAGE = 10;

function totalReactionCount(reaction: MessageReaction | PartialMessageReaction): number {
  let total = 0;
  for (const r of reaction.message.reactions.cache.values()) {
    total += r.count ?? 0;
  }
  return total;
}

async function handle(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  // Fetch partials so we have author + channel data.
  const r = reaction.partial ? await reaction.fetch() : reaction;
  const reactor = user.partial ? await user.fetch() : user;

  if (reactor.bot) return;
  const message = r.message;
  if (!message.guildId) return; // skip DMs
  if (message.author?.bot) return;
  if (message.author?.id === reactor.id) return; // no self-XP

  const channel = message.channel;
  if ('name' in channel && channel.name && NO_XP_CHANNEL_NAMES.has(channel.name)) return;

  // Cap: only the first 10 reactions on a message count for XP.
  if (totalReactionCount(r) > REACTION_MAX_PER_MESSAGE) return;

  // Per-reactor cooldown across all messages.
  if (!reactionXpCooldown.tryConsume(reactor.id)) return;

  const author = message.author;
  if (!author) return;
  const member = await message.guild?.members.fetch(author.id).catch(() => null);
  if (!member) return;

  const result = await awardXp({
    discordId: author.id,
    username: author.username,
    displayName: member.displayName,
    amount: REACTION_XP_AMOUNT,
    source: 'reaction',
    metadata: {
      message_id: message.id,
      channel_id: message.channelId,
      reactor_id: reactor.id,
    },
  });

  if (!result.leveledUp) return;
  const promotion = await maybePromoteRank(member, result.newLevel);
  await postLevelUpEmbed(member, result.newLevel, promotion);
}

export function register(client: Client): void {
  client.on(Events.MessageReactionAdd, (reaction, user) => {
    handle(reaction, user).catch((err) => {
      logger.error(
        { err, message: reaction.message?.id, reactor: user.id },
        'messageReactionAdd: handler error',
      );
    });
  });
}
