import { type ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { rankById } from '../config/cultivation.js';
import { DIVIDER_SHORT, ICONS, RANK_ICONS } from '../config/ui.js';
import { getStore } from '../db/index.js';
import type { CultivationRankId } from '../db/types.js';
import { levelProgress } from '../modules/leveling/engine.js';
import { inlineField, themedEmbed } from '../utils/embed.js';

/**
 * /rank [user?] — show level / XP / cultivation rank for the caller
 * (default) or a target user. Embed:
 *   - Author block: target avatar + display name + sub-title
 *   - Hero line: rank icon + rank name + level + cultivation phase
 *   - Progress bar: 16-emoji bar tinted by cảnh giới + percentage
 *   - Fields: Cảnh giới · Cấp độ · XP · XP đến level tới
 *   - Footer: rank description
 */

export const data = new SlashCommandBuilder()
  .setName('rank')
  .setDescription('Xem cảnh giới + XP của bạn hoặc thành viên khác')
  .setDMPermission(false)
  .addUserOption((opt) =>
    opt.setName('user').setDescription('Thành viên cần xem (mặc định là bạn)').setRequired(false),
  );

const BAR_WIDTH = 16;

const FILL_EMOJI: Record<CultivationRankId, string> = {
  pham_nhan: '⬛',
  luyen_khi: '⬜',
  truc_co: '🟦',
  kim_dan: '🟨',
  nguyen_anh: '🟪',
  hoa_than: '🟥',
  luyen_hu: '🟩',
  hop_the: '🟧',
  dai_thua: '⬜',
  do_kiep: '🟨',
  tien_nhan: '🟨',
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
      content: `${ICONS.warn} **${target.username}** chưa có XP nào — chưa từng nhắn tin trên server.`,
      ephemeral: true,
    });
    return;
  }

  const rank = rankById(user.cultivation_rank);
  const progress = levelProgress(user.xp);
  const fill = FILL_EMOJI[user.cultivation_rank] ?? '⬜';
  const bar = renderEmojiBar(progress.currentInLevel, progress.neededForNext, fill);
  const rankIcon = RANK_ICONS[user.cultivation_rank] ?? '⭐';
  const subTitle = user.sub_title ? ` · ${user.sub_title}` : '';
  const pct =
    progress.neededForNext > 0
      ? Math.round((progress.currentInLevel / progress.neededForNext) * 100)
      : 100;

  // Hero description: rank icon + name + level — emotional anchor.
  const heroLine = `${rankIcon} **${rank.name}** ${DIVIDER_SHORT} Level **${user.level}**`;

  const barBlock = [
    `**Tiến độ đến Level ${user.level + 1}** \`${pct}%\``,
    bar,
    `\`${progress.currentInLevel.toLocaleString('vi-VN')}\` / \`${progress.neededForNext.toLocaleString('vi-VN')}\` XP`,
  ].join('\n');

  const embed = themedEmbed('plain', {
    color: hexToInt(rank.colorHex),
    description: `${heroLine}\n\n${barBlock}`,
    footer: `${rank.description} · Radiant Tech Sect`,
  })
    .setAuthor({
      name: `${user.display_name ?? user.username}${subTitle}`,
      iconURL: target.displayAvatarURL({ size: 128 }),
    })
    .setThumbnail(target.displayAvatarURL({ size: 256 }))
    .addFields(
      inlineField(`${ICONS.xp} Tổng XP`, user.xp.toLocaleString('vi-VN')),
      inlineField(`${ICONS.star} Cấp độ`, `${user.level}`),
      inlineField(`${ICONS.dao} Cảnh giới`, rank.name),
    );

  await interaction.reply({ embeds: [embed] });
}

export const command = { data, execute };
export default command;
