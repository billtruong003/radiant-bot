import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { ROLE_SECT_MASTER } from '../config/roles.js';
import { judgeAndPunish } from '../modules/admin/divine-judgment.js';
import { postBotLog } from '../modules/bot-log.js';
import { logger } from '../utils/logger.js';
import { sanitizeForDisplay } from '../utils/sanitize.js';

/**
 * /thien-dao — Áp Chế Thiên Đạo. Chưởng Môn invokes the cosmic judge:
 *   - Target = the disciple being punished
 *   - Crime  = free text (e.g., "spammer phá đám trong #general")
 *
 * Aki/Thiên Đạo (LLM) reads the crime + target's snapshot + recent
 * automod history, picks 1-3 punishments from a JSON menu, applies
 * them atomically, and posts a dramatic verdict to #bot-log.
 *
 * GATING: requires Administrator perm AT THE DISCORD LEVEL (set via
 * setDefaultMemberPermissions) PLUS an in-code check for the
 * Chưởng Môn role — defense in depth so Trưởng Lão / Chấp Pháp can't
 * invoke even if a server admin grants them Administrator.
 */

export const data = new SlashCommandBuilder()
  .setName('thien-dao')
  .setDescription('Triệu hồi Thiên Đạo xử phạt đệ tử (CHỈ Chưởng Môn)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addUserOption((opt) =>
    opt.setName('target').setDescription('Đệ tử bị xử phạt').setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName('crime')
      .setDescription('Mô tả tội (Thiên Đạo sẽ tự quyết hình phạt)')
      .setRequired(true)
      .setMaxLength(1500),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // Hard gate: only Chưởng Môn. Discord-level Administrator is not enough.
  if (!interaction.inCachedGuild() || !interaction.member) {
    await interaction.reply({ content: '⚠️ Lệnh chỉ dùng trong server.', ephemeral: true });
    return;
  }
  const isSectMaster = interaction.member.roles.cache.some((r) => r.name === ROLE_SECT_MASTER);
  if (!isSectMaster) {
    await interaction.reply({
      content: `🚫 Chỉ **${ROLE_SECT_MASTER}** mới triệu hồi được Thiên Đạo.`,
      ephemeral: true,
    });
    return;
  }

  const target = interaction.options.getUser('target', true);
  const crime = interaction.options.getString('crime', true);

  if (target.bot) {
    await interaction.reply({ content: '⚔️ Thiên Đạo không xử phạt bot.', ephemeral: true });
    return;
  }
  if (target.id === interaction.user.id) {
    await interaction.reply({
      content: '☯️ Tự phán xử bản thân? Đạo tâm tự khắc soi.',
      ephemeral: true,
    });
    return;
  }

  // Defer — LLM judgment can take 3-10s.
  await interaction.deferReply({ ephemeral: true });

  const member = await interaction.guild.members.fetch(target.id).catch(() => null);
  if (!member) {
    await interaction.editReply({
      content: '🌫️ Không tìm thấy đệ tử trong tông môn.',
    });
    return;
  }

  let result;
  try {
    result = await judgeAndPunish({
      target: member,
      crimeDescription: crime,
      accuserId: interaction.user.id,
    });
  } catch (err) {
    logger.error({ err, target: target.id }, 'thien-dao: judge crashed');
    await interaction.editReply({
      content: `⚠️ Thiên Đạo gặp lỗi: \`${(err as Error).message ?? 'unknown'}\``,
    });
    return;
  }

  if (!result.ok) {
    const reasonMsg = (() => {
      switch (result.reason) {
        case 'llm-unavailable':
          return '⚠️ Thiên Đạo không hồi đáp lúc này (LLM router down). Thử lại sau hoặc xử phạt thủ công.';
        case 'llm-malformed':
          return '⚠️ Thiên Đạo phản hồi sai schema. Đã log. Thử lại với mô tả tội khác.';
        case 'no-valid-punishment':
          return '⚠️ Thiên Đạo không chọn được hình phạt hợp lệ. Mô tả tội rõ hơn rồi thử lại.';
        case 'no-user':
          return '🌫️ Đệ tử chưa có user record trong tông môn.';
        default:
          return `⚠️ Thất bại: ${result.reason ?? 'unknown'}`;
      }
    })();
    await interaction.editReply({ content: reasonMsg });
    return;
  }

  // Ephemeral confirm to caller — Chưởng Môn sees the breakdown.
  const safeName = sanitizeForDisplay(member.displayName);
  const appliedLines = result.applied.map(
    (a) =>
      `${a.result === 'applied' ? '✅' : '⏭️'} **${a.punishmentName}** ` +
      `(severity ${a.severity})${a.reason ? ` _— ${a.reason}_` : ''}`,
  );
  const confirmEmbed = new EmbedBuilder()
    .setColor(0x9c3848)
    .setTitle('⚖️ Thiên Đạo đã phán quyết')
    .setDescription(
      [
        `**Đệ tử**: ${safeName} (Lv ${result.targetSnapshot.level} · ${result.targetSnapshot.rank})`,
        '',
        `**Verdict**: ${result.verdict}`,
        '',
        '**Hình phạt áp dụng**:',
        ...appliedLines,
      ].join('\n'),
    )
    .setFooter({ text: `Triệu hồi bởi Chưởng Môn · ${new Date().toLocaleString('vi-VN')}` });

  await interaction.editReply({ embeds: [confirmEmbed] });

  // Public verdict to #bot-log.
  const publicLines = result.applied
    .filter((a) => a.result === 'applied')
    .map((a) => `• ${a.punishmentName} (${a.severity})`);
  await postBotLog(
    [
      `⚖️ **Thiên Đạo phán xử** — đệ tử **${safeName}** vì tội đã được tường trình.`,
      '',
      `_${result.verdict}_`,
      '',
      ...(publicLines.length > 0
        ? ['**Hình phạt**:', ...publicLines]
        : ['_Chỉ công khai cảnh báo — không hình phạt vật chất._']),
    ].join('\n'),
  );
}

export const command = { data, execute };
export default command;
