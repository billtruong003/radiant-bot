import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { type SyncReport, syncAllPinnedMessages } from '../modules/admin/pinned-sync.js';
import { logger } from '../utils/logger.js';

/**
 * `/sync-pinned` — admin slash to push canonical pinned messages to
 * #rules, #announcements, #introductions, #leveling-guide, #tribulation,
 * #bot-commands.
 *
 * Workflow:
 *   1. For each target channel, unpin the bot's previous pin (if any)
 *      identified by the BOT_PIN_MARKER footer.
 *   2. Post the new themed embed.
 *   3. Pin it.
 *   4. React with the channel's themed emoji palette.
 *
 * User-posted pins are NEVER touched. Idempotent — re-running replaces
 * the bot's pin exactly once per channel.
 */

export const data = new SlashCommandBuilder()
  .setName('sync-pinned')
  .setDescription('Đồng bộ pinned message cho các kênh quan trọng (admin only)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inCachedGuild() || !interaction.guild) {
    await interaction.reply({ content: '⚠️ Lệnh chỉ dùng trong server.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  let report: SyncReport;
  try {
    report = await syncAllPinnedMessages(interaction.guild);
  } catch (err) {
    logger.error({ err }, 'sync-pinned: top-level failure');
    await interaction.editReply({
      content: `⚠️ Sync gặp lỗi: \`${(err as Error).message ?? 'unknown'}\``,
    });
    return;
  }

  const statusLine = (status: string): string => {
    switch (status) {
      case 'synced':
        return '✅';
      case 'channel-missing':
        return '🌫️';
      case 'no-permission':
        return '🚫';
      case 'error':
        return '⚠️';
      default:
        return '?';
    }
  };

  const rows = report.outcomes.map((o) => {
    const detail =
      o.status === 'synced'
        ? `${o.unpinnedOld ?? 0} old unpinned · ${o.reactedCount ?? 0} reactions`
        : (o.detail ?? '');
    return `${statusLine(o.status)} **${o.canonicalChannel}** — ${o.status}${detail ? ` _(${detail})_` : ''}`;
  });

  const embed = new EmbedBuilder()
    .setColor(report.totalFailed > 0 ? 0xd97b8a : report.totalMissing > 0 ? 0xe6c87e : 0x8fbf9f)
    .setTitle('📌 Pinned-Message Sync Report')
    .setDescription(rows.join('\n'))
    .addFields(
      { name: '✅ Synced', value: `${report.totalSynced}`, inline: true },
      { name: '🌫️ Missing', value: `${report.totalMissing}`, inline: true },
      { name: '⚠️ Failed', value: `${report.totalFailed}`, inline: true },
    )
    .setFooter({
      text: 'Re-run anytime — idempotent, only replaces bot pins · User pins untouched',
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

export const command = { data, execute };
export default command;
