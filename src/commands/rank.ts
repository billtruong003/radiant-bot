import { type ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { rankById } from '../config/cultivation.js';
import { getStore } from '../db/index.js';
import type { CultivationRankId } from '../db/types.js';
import { levelProgress } from '../modules/leveling/engine.js';

/**
 * /rank [user?] — show level / XP / cultivation rank for the caller
 * (default) or a target user. Progress bar uses emoji blocks tinted
 * by the member's current cảnh giới color so /rank reads visually
 * (per Phase 9 UX feedback — ASCII bars look flat).
 */

export const data = new SlashCommandBuilder()
  .setName('rank')
  .setDescription('Xem cảnh giới + XP của bạn hoặc thành viên khác')
  .setDMPermission(false)
  .addUserOption((opt) =>
    opt.setName('user').setDescription('Thành viên cần xem (mặc định là bạn)').setRequired(false),
  );

const BAR_WIDTH = 12;

/**
 * Map each cultivation rank to a "fill" emoji that approximates its
 * hex color. Discord doesn't render arbitrary color text in chat, so
 * we lean on the colored square emojis 🟦🟨 etc + ⬛/⬜ for the empty
 * portion. Mapping picked to roughly match the rank's `colorHex`.
 */
const FILL_EMOJI: Record<CultivationRankId, string> = {
  pham_nhan: '⬛', // grey
  luyen_khi: '⬜', // light grey/white
  truc_co: '🟦', // blue
  kim_dan: '🟨', // gold
  nguyen_anh: '🟪', // purple
  hoa_than: '🟥', // red
  luyen_hu: '🟩', // green
  hop_the: '🟧', // orange
  dai_thua: '⬜', // white
  do_kiep: '🟨', // gold
  tien_nhan: '🟨', // gold (admin grant)
};
const EMPTY_EMOJI = '▫️';

function hexToInt(hex: string): number {
  return Number.parseInt(hex.replace(/^#/, ''), 16);
}

function renderEmojiBar(current: number, total: number, fill: string): string {
  if (total <= 0) return fill.repeat(BAR_WIDTH);
  const ratio = Math.min(Math.max(current / total, 0), 1);
  const filled = Math.round(ratio * BAR_WIDTH);
  return `${fill.repeat(filled)}${EMPTY_EMOJI.repeat(BAR_WIDTH - filled)}`;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const user = getStore().users.get(target.id);

  if (!user) {
    await interaction.reply({
      content: `⚠️ **${target.username}** chưa có XP nào — chưa từng nhắn tin trên server.`,
      ephemeral: true,
    });
    return;
  }

  const rank = rankById(user.cultivation_rank);
  const progress = levelProgress(user.xp);
  const fill = FILL_EMOJI[user.cultivation_rank] ?? '⬜';
  const bar = renderEmojiBar(progress.currentInLevel, progress.neededForNext, fill);
  const subTitle = user.sub_title ? ` · ${user.sub_title}` : '';
  const pct =
    progress.neededForNext > 0
      ? Math.round((progress.currentInLevel / progress.neededForNext) * 100)
      : 100;

  const embed = new EmbedBuilder()
    .setColor(hexToInt(rank.colorHex))
    .setAuthor({
      name: `${user.display_name ?? user.username}${subTitle}`,
      iconURL: target.displayAvatarURL(),
    })
    .addFields(
      { name: 'Cảnh giới', value: rank.name, inline: true },
      { name: 'Cấp độ', value: `**${user.level}**`, inline: true },
      { name: 'Tổng XP', value: user.xp.toLocaleString('vi-VN'), inline: true },
      {
        name: `Tiến độ → Level ${user.level + 1}  (${pct}%)`,
        value: `${bar}\n\`${progress.currentInLevel.toLocaleString('vi-VN')}\` / \`${progress.neededForNext.toLocaleString('vi-VN')}\` XP`,
      },
    )
    .setFooter({ text: rank.description });

  await interaction.reply({ embeds: [embed] });
}

export const command = { data, execute };
export default command;
