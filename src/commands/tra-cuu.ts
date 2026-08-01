import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
  type User,
} from 'discord.js';
import { env } from '../config/env.js';
import { COLOR_BLUE, COLOR_ORANGE } from '../config/ui.js';
import { searchMessages } from '../modules/archive/message-archive.js';
import { canSearchChat } from '../modules/archive/search-tool.js';
import { logger } from '../utils/logger.js';

/**
 * Phase 16 — `/tra-cuu`: direct archive search for the sect's top two.
 *
 * The deterministic counterpart to asking Aki: no model in the loop, so
 * what comes back is exactly what was said. Use this when you want facts;
 * ask Aki when you want an interpretation.
 *
 * Permission is checked at RUNTIME against CHAT_SEARCH_ROLE_NAMES rather
 * than via `setDefaultMemberPermissions`, because Discord's built-in gate
 * works on permission bits (Administrator/ManageMessages), and the rule
 * here is role-based and narrower than any bit: Chưởng Môn + Tiên Nhân
 * only, NOT every moderator.
 *
 * Replies are always ephemeral — pulling up someone's old messages in
 * public would be its own kind of harm.
 */

const MAX_RESULTS = 15;
const DEFAULT_DAYS = 30;

export const command = {
  data: new SlashCommandBuilder()
    .setName('tra-cuu')
    .setDescription('Tra lịch sử chat (chỉ Chưởng Môn / Tiên Nhân)')
    .addStringOption((o) =>
      o.setName('tu-khoa').setDescription('Từ khoá cần tìm (bỏ trống = xem toàn bộ của 1 người)'),
    )
    .addUserOption((o) => o.setName('nguoi').setDescription('Lọc theo người nói'))
    .addIntegerOption((o) =>
      o
        .setName('so-ngay')
        .setDescription(`Tra trong bao nhiêu ngày (mặc định ${DEFAULT_DAYS})`)
        .setMinValue(1)
        .setMaxValue(90),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!env.ARCHIVE_ENABLED) {
      await interaction.reply({
        content: '🌫️ Kho tin nhắn đang tắt (ARCHIVE_ENABLED=false).',
        ephemeral: true,
      });
      return;
    }

    if (!interaction.inCachedGuild() || !canSearchChat(interaction.member)) {
      logger.warn(
        { discord_id: interaction.user.id },
        'tra-cuu: denied — caller lacks Chưởng Môn/Tiên Nhân',
      );
      await interaction.reply({
        content: '🚫 Chỉ Chưởng Môn và Tiên Nhân được tra lịch sử chat.',
        ephemeral: true,
      });
      return;
    }

    const keyword = interaction.options.getString('tu-khoa') ?? undefined;
    const target: User | null = interaction.options.getUser('nguoi');
    const days = interaction.options.getInteger('so-ngay') ?? DEFAULT_DAYS;

    if (!keyword && !target) {
      await interaction.reply({
        content: '⚠️ Cần ít nhất `tu-khoa` hoặc `nguoi` — không thể tra tất cả.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const hits = searchMessages({
      query: keyword,
      authorId: target?.id,
      days,
      limit: MAX_RESULTS,
    });

    const criteria = [
      target ? `người: **${target.username}**` : null,
      keyword ? `từ khoá: **${keyword}**` : null,
      `trong **${days}** ngày`,
    ]
      .filter(Boolean)
      .join(' · ');

    if (hits.length === 0) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR_ORANGE)
            .setTitle('🔍 Không tìm thấy')
            .setDescription(`${criteria}\n\nKhông có tin nhắn nào khớp.`),
        ],
      });
      return;
    }

    // Embed descriptions cap at 4096; build up and stop before the edge
    // rather than letting Discord reject the whole reply.
    const lines: string[] = [];
    let used = 0;
    for (const h of hits) {
      const when = new Date(h.createdAt).toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      const body = h.content.length > 180 ? `${h.content.slice(0, 180)}…` : h.content;
      const line = `\`${when}\` **${h.authorName}** _#${h.channelName}_\n${body}`;
      if (used + line.length > 3800) break;
      lines.push(line);
      used += line.length;
    }

    logger.info(
      { discord_id: interaction.user.id, hits: hits.length, days, has_keyword: !!keyword },
      'tra-cuu: search performed',
    );

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR_BLUE)
          .setTitle(`🔍 Tìm thấy ${hits.length} tin nhắn`)
          .setDescription(`${criteria}\n\n${lines.join('\n\n')}`)
          .setFooter({
            text:
              lines.length < hits.length
                ? `Hiện ${lines.length}/${hits.length} kết quả (giới hạn độ dài)`
                : 'Chỉ mình bạn thấy kết quả này',
          }),
      ],
    });
  },
};
