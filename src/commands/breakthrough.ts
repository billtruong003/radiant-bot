import {
  type ChatInputCommandInteraction,
  type GuildMember,
  SlashCommandBuilder,
} from 'discord.js';
import { getStore } from '../db/index.js';
import {
  TRIBULATION_CONSTANTS,
  isTribulationOnCooldown,
  runTribulation,
} from '../modules/events/tribulation.js';
import { logger } from '../utils/logger.js';

/**
 * /breakthrough — self-trigger a tribulation. Member must:
 *   - be level ≥ TRIBULATION_LEVEL_MIN (10)
 *   - server-wide cooldown not active (24h since last)
 *
 * The actual orchestration (intro embed → buttons → outcome) lives
 * in `runTribulation`. This file is the gating + reply layer.
 *
 * Reply is deferred because runTribulation can take up to 30s (math
 * timeout) — Discord requires an initial response within 3s.
 */

export const data = new SlashCommandBuilder()
  .setName('breakthrough')
  .setDescription('Tự khởi động Thiên Kiếp (cần level ≥ 10, cooldown 24h server-wide)')
  .setDMPermission(false);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: '⚠️ Lệnh chỉ dùng trong server.', ephemeral: true });
    return;
  }

  const member = (await interaction.guild.members
    .fetch(interaction.user.id)
    .catch(() => null)) as GuildMember | null;
  if (!member) {
    await interaction.reply({ content: '⚠️ Không tìm thấy member info.', ephemeral: true });
    return;
  }

  const user = getStore().users.get(member.id);
  if (!user || user.level < TRIBULATION_CONSTANTS.TRIBULATION_LEVEL_MIN) {
    await interaction.reply({
      content: `⚠️ Yêu cầu **Level ≥ ${TRIBULATION_CONSTANTS.TRIBULATION_LEVEL_MIN}** mới được phép thử Thiên Kiếp. Hiện tại bạn level **${user?.level ?? 0}**.`,
      ephemeral: true,
    });
    return;
  }

  if (isTribulationOnCooldown()) {
    await interaction.reply({
      content:
        '⏳ Thiên Kiếp toàn tông đang trong cooldown 24h — chưa thể triệu hoán. Hãy chờ một thiên kiếp khác đi qua.',
      ephemeral: true,
    });
    return;
  }

  // Acknowledge before the (potentially 30s) collector starts. Ephemeral
  // confirmation so we don't double-mention in #tribulation.
  await interaction.reply({
    content: '⚡ Thiên Kiếp bắt đầu... hãy nhìn vào kênh **#tribulation**.',
    ephemeral: true,
  });

  try {
    const result = await runTribulation(member);
    logger.info({ discord_id: member.id, ...result }, 'breakthrough: tribulation complete');
  } catch (err) {
    logger.error({ err, discord_id: member.id }, 'breakthrough: tribulation threw');
  }
}

export const command = { data, execute };
export default command;
