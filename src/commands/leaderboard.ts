import { type ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { rankById } from '../config/cultivation.js';
import { getStore } from '../db/index.js';
import { topByXp, weeklyLeaderboard } from '../db/queries/leaderboard.js';

/**
 * /leaderboard [period?=all|weekly] — top 10 by XP.
 *  - all (default): total XP across lifetime
 *  - weekly: XP earned in the last 7 days (rolling window from xpLogs)
 *
 * Embed shows rank + display name + level + score + cultivation rank.
 * Medals on top 3 rows for flair.
 */

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Bảng xếp hạng top 10 theo XP')
  .setDMPermission(false)
  .addStringOption((opt) =>
    opt
      .setName('period')
      .setDescription('Khoảng thời gian (mặc định: all)')
      .setRequired(false)
      .addChoices(
        { name: 'Tất cả thời gian', value: 'all' },
        { name: 'Tuần này (7 ngày)', value: 'weekly' },
      ),
  );

const MEDAL = ['🥇', '🥈', '🥉'];

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const period = interaction.options.getString('period') ?? 'all';
  const store = getStore();
  const entries = period === 'weekly' ? weeklyLeaderboard(store, 10) : topByXp(store, 10);

  const periodLabel = period === 'weekly' ? '📅 Tuần này' : '🏆 Tất cả thời gian';

  if (entries.length === 0) {
    await interaction.reply({
      content: `${periodLabel} — chưa có ai có XP.`,
      ephemeral: true,
    });
    return;
  }

  const lines = entries.map((e) => {
    const prefix = MEDAL[e.rank - 1] ?? `**${e.rank}.**`;
    const name = e.user.display_name ?? e.user.username;
    const rank = rankById(e.user.cultivation_rank);
    const score =
      period === 'weekly'
        ? `+${e.score.toLocaleString('vi-VN')} XP tuần`
        : `${e.score.toLocaleString('vi-VN')} XP`;
    return `${prefix} **${name}** — Level ${e.user.level} · ${rank.name} · ${score}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle(`${periodLabel} — Bảng Xếp Hạng`)
    .setDescription(lines.join('\n'))
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

export const command = { data, execute };
export default command;
