import { type ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { rankById } from '../config/cultivation.js';
import { getStore } from '../db/index.js';
import { levelProgress } from '../modules/leveling/engine.js';

/**
 * /rank [user?] — show level / XP / cultivation rank for the caller
 * (default) or a target user. Progress bar uses the same xpToNext curve
 * as the engine so the visual matches what the next level needs.
 */

export const data = new SlashCommandBuilder()
  .setName('rank')
  .setDescription('Xem cảnh giới + XP của bạn hoặc thành viên khác')
  .setDMPermission(false)
  .addUserOption((opt) =>
    opt.setName('user').setDescription('Thành viên cần xem (mặc định là bạn)').setRequired(false),
  );

const BAR_WIDTH = 20;

function renderProgressBar(current: number, total: number): string {
  if (total <= 0) return '█'.repeat(BAR_WIDTH);
  const ratio = Math.min(Math.max(current / total, 0), 1);
  const filled = Math.round(ratio * BAR_WIDTH);
  return `${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)}`;
}

function hexToInt(hex: string): number {
  return Number.parseInt(hex.replace(/^#/, ''), 16);
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
  const bar = renderProgressBar(progress.currentInLevel, progress.neededForNext);
  const subTitle = user.sub_title ? ` · ${user.sub_title}` : '';

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
        name: `Tiến độ → Level ${user.level + 1}`,
        value: `\`${bar}\`\n${progress.currentInLevel.toLocaleString('vi-VN')} / ${progress.neededForNext.toLocaleString('vi-VN')} XP`,
      },
    )
    .setFooter({ text: rank.description });

  await interaction.reply({ embeds: [embed] });
}

export const command = { data, execute };
export default command;
