import { type Client, Events, type Message } from 'discord.js';
import { env } from '../config/env.js';
import { loadVerificationConfig } from '../config/verification.js';
import { handleDmReply } from '../modules/verification/flow.js';
import { logger } from '../utils/logger.js';

/**
 * `messageCreate` event: today this only routes DMs to the verification
 * flow. XP / automod handlers will live in this file or sibling files
 * in Phase 4 / 5; for Phase 3 we hard-scope to DM channels so guild
 * traffic is untouched.
 */

async function handleDirectMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.content || !message.content.trim()) return;

  const config = await loadVerificationConfig();

  // Bot operates on a single guild — resolve via env, then route to flow.
  const guild = message.client.guilds.cache.get(env.DISCORD_GUILD_ID);
  if (!guild) {
    logger.error(
      { guild_id: env.DISCORD_GUILD_ID },
      'messageCreate: configured guild not in cache',
    );
    return;
  }

  const result = await handleDmReply(guild, message.author.id, message.content, config);

  switch (result.outcome) {
    case 'no-pending':
      // Likely a non-verification DM; ignore silently.
      return;
    case 'pass':
      // Confirmation DM already sent inside flow.ts; no-op here.
      return;
    case 'fail-retry':
      await message
        .reply(`❌ Sai. Còn **${result.attemptsLeft ?? 0}** lần thử — gửi lại đáp án.`)
        .catch(() => undefined);
      return;
    case 'fail-kick':
      await message
        .reply('❌ Sai quá số lần cho phép. Bạn vừa bị kick — có thể vào lại server và thử tiếp.')
        .catch(() => undefined);
      return;
  }
}

export function register(client: Client): void {
  client.on(Events.MessageCreate, (message) => {
    if (message.guildId) return; // only DMs are handled in Phase 3
    handleDirectMessage(message).catch((err) => {
      logger.error({ err, author: message.author?.id }, 'messageCreate: unhandled error');
    });
  });
}
