import { type Client, Events, type GuildMember, type Message } from 'discord.js';
import { NO_XP_CHANNEL_NAMES } from '../config/channels.js';
import { env } from '../config/env.js';
import { MESSAGE_XP_MAX, MESSAGE_XP_MIN } from '../config/leveling.js';
import { STAFF_ROLE_NAMES } from '../config/roles.js';
import { loadVerificationConfig } from '../config/verification.js';
import { applyDecision, automodEngine } from '../modules/automod/index.js';
import { messageXpCooldown } from '../modules/leveling/cooldown.js';
import { isXpEligibleMessage } from '../modules/leveling/eligibility.js';
import { maybePromoteRank, postLevelUpEmbed } from '../modules/leveling/rank-promoter.js';
import { awardXp, randomXpAmount } from '../modules/leveling/tracker.js';
import { handleDmReply } from '../modules/verification/flow.js';
import { logger } from '../utils/logger.js';

function isStaff(member: GuildMember): boolean {
  for (const role of member.roles.cache.values()) {
    if (STAFF_ROLE_NAMES.has(role.name)) return true;
  }
  return false;
}

/**
 * `messageCreate` routes:
 *   - DM channels  → verification flow.handleDmReply (Phase 3)
 *   - Guild text   → XP earn + maybe rank promotion (Phase 4)
 *
 * The DM and guild paths are mutually exclusive (`message.guildId` is
 * the discriminator). Both are best-effort: errors log + continue, never
 * crash the client.
 */

async function handleDirectMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.content || !message.content.trim()) return;

  const config = await loadVerificationConfig();

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
      return;
    case 'pass':
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

async function handleGuildMessage(message: Message): Promise<void> {
  if (!message.inGuild()) return; // narrows channel to GuildBasedChannel
  if (message.author.bot) return;
  if (!message.member) return;

  // Automod first — runs in ALL channels (including no-XP ones like
  // #bot-commands) but skips staff (Chưởng Môn / Trưởng Lão / Chấp Pháp).
  if (!isStaff(message.member)) {
    const decision = await automodEngine.evaluate(message);
    if (decision) {
      await applyDecision(message, decision);
      return; // violating message earns no XP
    }
  }

  if (NO_XP_CHANNEL_NAMES.has(message.channel.name)) return;
  if (!isXpEligibleMessage(message.content)) return;

  // 60s/user cooldown (SPEC §3 sacred constant).
  if (!messageXpCooldown.tryConsume(message.author.id)) return;

  const amount = randomXpAmount(MESSAGE_XP_MIN, MESSAGE_XP_MAX);
  const result = await awardXp({
    discordId: message.author.id,
    username: message.author.username,
    displayName: message.member.displayName,
    amount,
    source: 'message',
    metadata: {
      channel_id: message.channelId,
      message_length: message.content.length,
    },
    touchLastMessage: true,
  });

  if (!result.leveledUp) return;

  const promotion = await maybePromoteRank(message.member, result.newLevel);
  await postLevelUpEmbed(message.member, result.newLevel, promotion);
}

export function register(client: Client): void {
  client.on(Events.MessageCreate, (message) => {
    if (message.guildId) {
      handleGuildMessage(message).catch((err) => {
        logger.error(
          { err, author: message.author?.id, channel: message.channelId },
          'messageCreate: guild XP handler error',
        );
      });
      return;
    }
    handleDirectMessage(message).catch((err) => {
      logger.error({ err, author: message.author?.id }, 'messageCreate: DM handler error');
    });
  });
}
