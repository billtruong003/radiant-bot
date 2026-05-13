import {
  type Client,
  Events,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from 'discord.js';
import { handleReactionRemove as handleReactionRole } from '../modules/reactionRoles/index.js';
import { logger } from '../utils/logger.js';

/**
 * `messageReactionRemove` — only used for reaction-role removal in
 * Phase 6. Reaction XP is NOT refunded on un-react (per SPEC §3 — XP
 * once granted stays granted).
 *
 * Partials get fetched so we can read message.id + reactor.id.
 */

async function handle(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  const r = reaction.partial ? await reaction.fetch() : reaction;
  const reactor = user.partial ? await user.fetch() : user;

  if (reactor.bot) return;
  const message = r.message;
  if (!message.guildId || !message.guild) return;

  const emojiKey = r.emoji.id ?? r.emoji.name ?? '';
  await handleReactionRole(message.guild, reactor.id, message.id, emojiKey);
}

export function register(client: Client): void {
  client.on(Events.MessageReactionRemove, (reaction, user) => {
    handle(reaction, user).catch((err) => {
      logger.error(
        { err, message: reaction.message?.id, reactor: user.id },
        'messageReactionRemove: handler error',
      );
    });
  });
}
