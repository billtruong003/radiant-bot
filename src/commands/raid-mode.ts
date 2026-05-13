import {
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { DIVIDER_SHORT, ICONS } from '../config/ui.js';
import { getRaidStatus, isRaidActive, setRaidMode } from '../modules/verification/raid.js';
import { themedEmbed } from '../utils/embed.js';
import { logger } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('raid-mode')
  .setDescription('Bật / tắt / xem trạng thái chế độ phòng raid')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((sub) => sub.setName('on').setDescription('Bật raid mode thủ công'))
  .addSubcommand((sub) => sub.setName('off').setDescription('Tắt raid mode thủ công'))
  .addSubcommand((sub) => sub.setName('status').setDescription('Xem trạng thái raid mode'));

function statusEmbed() {
  const s = getRaidStatus();
  const activeBadge = s.is_active ? '🔴 **ĐANG BẬT**' : '🟢 **Tắt**';
  const activatedAt = s.activated_at ? `<t:${Math.floor(s.activated_at / 1000)}:R>` : '—';
  const lastJoin = s.last_join_at ? `<t:${Math.floor(s.last_join_at / 1000)}:R>` : '—';

  const description = [
    `**Trạng thái:** ${activeBadge}`,
    DIVIDER_SHORT,
    `🕒 **Lần kích hoạt gần nhất:** ${activatedAt}`,
    `👥 **Join gần nhất:** ${lastJoin}`,
    `📊 **Joins trong cửa sổ:** \`${s.recent_joins_count}\``,
  ].join('\n');

  return themedEmbed(s.is_active ? 'danger' : 'info', {
    title: '🛡️ Raid Mode Status',
    description,
    footer: 'Auto-disable sau 30 phút quiet · /raid-mode on|off để toggle',
  });
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(true);
  logger.info(
    { sub, invoked_by: interaction.user.id, tag: interaction.user.tag },
    'command: /raid-mode',
  );

  switch (sub) {
    case 'on': {
      const r = await setRaidMode(true);
      const note = r.wasActive ? 'đã đang bật từ trước' : 'vừa được bật';
      await interaction.reply({
        content: `🔴 Raid mode ${note}. Mọi member mới sẽ nhận **hard captcha**.`,
        ephemeral: false,
      });
      return;
    }
    case 'off': {
      const r = await setRaidMode(false);
      const note = r.wasActive ? 'vừa được tắt' : 'đã ở trạng thái tắt';
      await interaction.reply({
        content: `🟢 Raid mode ${note}.`,
        ephemeral: false,
      });
      return;
    }
    case 'status': {
      await interaction.reply({ embeds: [statusEmbed()], ephemeral: true });
      return;
    }
    default:
      await interaction.reply({
        content: `${ICONS.warn} Không biết subcommand "${sub}".`,
        ephemeral: true,
      });
  }
}

export const command = { data, execute };
export default command;
export { isRaidActive };
