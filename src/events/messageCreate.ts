import { type Client, Events, type GuildMember, type Message } from 'discord.js';
import { canonicalChannelName, isNoXpChannel } from '../config/channels.js';
import { env } from '../config/env.js';
import { MESSAGE_XP_MAX, MESSAGE_XP_MIN } from '../config/leveling.js';
import { STAFF_ROLE_NAMES } from '../config/roles.js';
import { ICONS } from '../config/ui.js';
import { loadVerificationConfig } from '../config/verification.js';
import { getStore } from '../db/index.js';
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

/**
 * Phase 11 B3: one-shot "tân đệ tử nhập môn" greeting on a verified
 * member's first message in #general. Adds a 🌟 react + a short
 * reply. Tracked via `user.first_message_greeted_at` so it fires
 * exactly once per user lifetime.
 *
 * Triggers:
 *   - User must be verified (verified_at !== null)
 *   - Message must be in the #general channel
 *   - first_message_greeted_at must be null
 *
 * Best-effort: failures are swallowed so XP earning isn't blocked.
 */
async function maybeGreetFirstMessage(message: Message): Promise<void> {
  if (!message.inGuild()) return;
  if (canonicalChannelName(message.channel.name) !== 'general') return;
  const user = getStore().users.get(message.author.id);
  if (!user || user.verified_at === null) return;
  if (user.first_message_greeted_at != null) return;

  // Mark first so concurrent messages can't double-greet.
  await getStore().users.set({ ...user, first_message_greeted_at: Date.now() });

  try {
    await message.react('🌟');
  } catch {
    // Reaction can fail if message was deleted between read + react.
  }
  try {
    await message.reply({
      content: `${ICONS.sparkle} Tân đệ tử nhập môn ٩(◕‿◕)۶ Aki chào ${message.member?.displayName ?? message.author.username} ở **#general** — chúc tu hành thuận lợi.`,
      allowedMentions: { repliedUser: false },
    });
  } catch (err) {
    logger.warn(
      { err, discord_id: message.author.id },
      'first-message-greet: reply failed (continuing)',
    );
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

  // Phase 11 B3 (independent of XP path — fires even on no-XP channels
  // but the inner check restricts to #general).
  void maybeGreetFirstMessage(message);

  if (isNoXpChannel(message.channel.name)) return;
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
