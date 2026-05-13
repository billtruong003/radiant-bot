import {
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { getRaidStatus, isRaidActive, setRaidMode } from '../modules/verification/raid.js';
import { logger } from '../utils/logger.js';

/**
 * /raid-mode on|off|status — admin-only manual override for raid mode.
 *
 * The command is gated by `Administrator` permission so only Chưởng Môn
 * (and bot's admin role) can invoke. Runtime double-check by role name
 * is intentionally NOT done here — Discord's permission system is the
 * source of truth, and `Administrator` matches the synced preset.
 */

export const data = new SlashCommandBuilder()
  .setName('raid-mode')
  .setDescription('Bật / tắt / xem trạng thái chế độ phòng raid')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((sub) => sub.setName('on').setDescription('Bật raid mode thủ công'))
  .addSubcommand((sub) => sub.setName('off').setDescription('Tắt raid mode thủ công'))
  .addSubcommand((sub) => sub.setName('status').setDescription('Xem trạng thái raid mode'));

function formatStatus(): string {
  const s = getRaidStatus();
  const active = s.is_active ? '🔴 **ĐANG BẬT**' : '🟢 Tắt';
  const activatedAt = s.activated_at ? `<t:${Math.floor(s.activated_at / 1000)}:R>` : '—';
  const lastJoin = s.last_join_at ? `<t:${Math.floor(s.last_join_at / 1000)}:R>` : '—';
  return [
    `**Raid mode:** ${active}`,
    `**Lần kích hoạt gần nhất:** ${activatedAt}`,
    `**Join gần nhất:** ${lastJoin}`,
    `**Số join trong cửa sổ phát hiện:** ${s.recent_joins_count}`,
  ].join('\n');
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(true);
  logger.info(
    {
      sub,
      invoked_by: interaction.user.id,
      tag: interaction.user.tag,
    },
    'command: /raid-mode',
  );

  switch (sub) {
    case 'on': {
      const r = await setRaidMode(true);
      const note = r.wasActive ? 'đã đang bật' : 'vừa bật';
      await interaction.reply({
        content: `🔴 Raid mode ${note}. Mọi member mới sẽ nhận hard captcha.`,
        ephemeral: false,
      });
      return;
    }
    case 'off': {
      const r = await setRaidMode(false);
      const note = r.wasActive ? 'vừa tắt' : 'đã đang tắt';
      await interaction.reply({
        content: `🟢 Raid mode ${note}.`,
        ephemeral: false,
      });
      return;
    }
    case 'status': {
      await interaction.reply({ content: formatStatus(), ephemeral: true });
      return;
    }
    default:
      await interaction.reply({
        content: `Không biết subcommand "${sub}".`,
        ephemeral: true,
      });
  }
}

export const command = { data, execute };
export default command;

// Quick read for non-command code (e.g., #bot-log alert formatting).
export { isRaidActive };
