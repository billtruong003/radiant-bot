import {
  type Client,
  Events,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from 'discord.js';
import { isNoXpChannel } from '../config/channels.js';
import { REACTION_MAX_PER_MESSAGE, REACTION_XP_AMOUNT } from '../config/leveling.js';
import { reactionXpCooldown } from '../modules/leveling/cooldown.js';
import { maybePromoteRank, postLevelUpEmbed } from '../modules/leveling/rank-promoter.js';
import { awardXp } from '../modules/leveling/tracker.js';
import { handleReactionAdd as handleReactionRole } from '../modules/reactionRoles/index.js';
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
  if (!message.guildId || !message.guild) return; // skip DMs

  // Reaction-roles routing first: if this is the configured RR message,
  // assign the role and SKIP XP path (don't double-reward).
  const emojiKey = r.emoji.id ?? r.emoji.name ?? '';
  const isReactionRole = await handleReactionRole(message.guild, reactor.id, message.id, emojiKey);
  if (isReactionRole) return;

  if (message.author?.id === reactor.id) return; // no self-quest/XP

  // Phase 14.5 fix (Bill 2026-05-20: "thả reaction k count trong quest") —
  // quest progress fires for EVERY non-self reaction by a non-bot user,
  // BEFORE the 10s XP cooldown and the 10-reactions-per-message XP cap.
  // Previously the hook lived at the end of the function, so a user
  // reacting fast (XP cooldown active) or reacting to a popular message
  // (>10 reactions total) lost quest credit entirely. Reactor bot already
  // bailed earlier; we still skip reactions to bot-authored messages here
  // by NOT firing the quest because those carry no social signal — but
  // we do not return so XP path stays unchanged.
  if (!message.author?.bot) {
    const { incrementProgress } = await import('../modules/quests/daily-quest.js');
    void incrementProgress(reactor.id, 'reaction_count', 1);
  }

  if (message.author?.bot) return;

  const channel = message.channel;
  if ('name' in channel && channel.name && isNoXpChannel(channel.name)) return;

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
