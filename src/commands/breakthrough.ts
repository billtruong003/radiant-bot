import {
  type ChatInputCommandInteraction,
  type GuildMember,
  SlashCommandBuilder,
} from 'discord.js';
import { getStore } from '../db/index.js';
import {
  TRIBULATION_CONSTANTS,
  isTribulationOnCooldown,
  judgeLinkFor,
  judgeLinkRow,
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

  const store = getStore();
  const user = store.users.get(member.id);
  if (!user || user.level < TRIBULATION_CONSTANTS.TRIBULATION_LEVEL_MIN) {
    await interaction.reply({
      content: `⚠️ Yêu cầu **Level ≥ ${TRIBULATION_CONSTANTS.TRIBULATION_LEVEL_MIN}** mới được phép thử Thiên Kiếp. Hiện tại bạn level **${user?.level ?? 0}**.`,
      ephemeral: true,
    });
    return;
  }

  // A Thiên Kiếp Đài trial still open: hand its link out again instead of starting another.
  const open = judgeLinkFor(member.id);
  if (open) {
    await interaction.reply({
      content: `⚡ Bạn đang độ **${open.tierName}** trên Thiên Kiếp Đài. Link riêng của bạn:`,
      components: [judgeLinkRow(open.url, 'Vào Thiên Kiếp Đài')],
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

  // Phase 12 polish — tribulation now consumes 1 đan dược (pill). This
  // closes the economic loop: tribulation pass grants +5 pills (net +4
  // per success), fail / timeout still consumes the pill (sunk cost).
  // Pills earned from /daily streak milestones + boost + quests fund
  // repeated attempts.
  const TRIBULATION_PILL_COST = 1;
  const currentPills = user.pills ?? 0;
  if (currentPills < TRIBULATION_PILL_COST) {
    await interaction.reply({
      content: `💊 Cần **${TRIBULATION_PILL_COST} đan dược** để khởi Thiên Kiếp. Bạn có **${currentPills}**. Kiếm đan dược từ \`/daily\` streak (mốc 7/14/30 ngày), hoàn thành \`/quest\`, hoặc boost server.`,
      ephemeral: true,
    });
    return;
  }
  await store.users.set({ ...user, pills: currentPills - TRIBULATION_PILL_COST });

  // Acknowledge before the (potentially 30s) collector starts. Ephemeral
  // confirmation so we don't double-mention in #tribulation.
  await interaction.reply({
    content: `⚡ Đã tiêu **${TRIBULATION_PILL_COST} đan dược**. Thiên Kiếp bắt đầu... hãy nhìn vào kênh **#tribulation**.`,
    ephemeral: true,
  });

  try {
    const result = await runTribulation(member, {
      deliverLink: async (url) => {
        await interaction.followUp({
          content:
            '⚡ Link Thiên Kiếp Đài của bạn (chỉ mình bạn dùng, mở trong 24 giờ; giờ chỉ bắt đầu chạy khi mở trang):',
          components: [judgeLinkRow(url, 'Vào Thiên Kiếp Đài')],
          ephemeral: true,
        });
        return true;
      },
    });
    logger.info({ discord_id: member.id, ...result }, 'breakthrough: tribulation complete');
  } catch (err) {
    logger.error({ err, discord_id: member.id }, 'breakthrough: tribulation threw');
  }
}

export const command = { data, execute };
export default command;
