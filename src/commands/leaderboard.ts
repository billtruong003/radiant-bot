import { type ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { rankById } from '../config/cultivation.js';
import { DIVIDER, ICONS, RANK_ICONS } from '../config/ui.js';
import { getStore } from '../db/index.js';
import { topByXp, weeklyLeaderboard } from '../db/queries/leaderboard.js';
import { withCard } from '../modules/cards/attach.js';
import { boardEntry } from '../modules/cards/item-views.js';
import { renderLeaderboardCard } from '../modules/cards/leaderboard-card.js';
import { computeCombatPower } from '../modules/combat/power.js';
import { themedEmbed } from '../utils/embed.js';

/**
 * /leaderboard [period?=all|weekly] — top 10 by XP, themed embed:
 *   - Title with calendar / trophy icon
 *   - Description: medal-decorated rows with rank icon per cảnh giới
 *   - Footer: "All-time" or "Tuần này" tag
 *
 * Empty state: ephemeral message rather than empty embed.
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
  )
  .addStringOption((opt) =>
    opt
      .setName('mode')
      .setDescription('Chỉ tiêu xếp hạng (mặc định: xp)')
      .setRequired(false)
      .addChoices(
        { name: 'XP (mặc định)', value: 'xp' },
        { name: 'Lực chiến (Phase 12)', value: 'luc-chien' },
      ),
  );

const MEDALS = [ICONS.medal_gold, ICONS.medal_silver, ICONS.medal_bronze];

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const period = interaction.options.getString('period') ?? 'all';
  const mode = interaction.options.getString('mode') ?? 'xp';
  const store = getStore();

  // Phase 12 — luc-chien mode: rank by combat power, not XP. Period
  // doesn't apply here (combat power is a current state, not earnable).
  if (mode === 'luc-chien') {
    const allUsers = store.users.query(() => true);
    // Phase 14 round 3 — leaderboard scoring uses the full equipment resolver
    // so multi-slot công pháp + pháp khí + nhẫn + weapon all count.
    const { resolveEquippedSlots } = await import('../modules/combat/equipment-resolver.js');
    const ranked = allUsers
      .map((u) => {
        const slots = resolveEquippedSlots(u.discord_id);
        return {
          user: u,
          score: computeCombatPower(u, slots.congPhap, slots.phapKhi, slots.nhan, slots.weapon),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    if (ranked.length === 0) {
      await interaction.reply({
        content: `${ICONS.trophy} Chưa có ai để xếp hạng. ${ICONS.aki_sad}`,
        ephemeral: true,
      });
      return;
    }

    const rows = ranked.map((e, i) => {
      const medal = MEDALS[i];
      const prefix = medal ?? `**\`#${i + 1}\`**`;
      const name = e.user.display_name ?? e.user.username;
      const rank = rankById(e.user.cultivation_rank);
      const rankIcon = RANK_ICONS[e.user.cultivation_rank] ?? '⭐';
      return `${prefix} ${rankIcon} **${name}** · ${rank.name}\n　 ⚔️ **${e.score.toLocaleString('vi-VN')}** lực chiến`;
    });

    const embed = themedEmbed('success', {
      title: '⚔️ Bảng Xếp Hạng — Lực chiến',
      description: ['*Top 10 đệ tử mạnh nhất theo lực chiến*', DIVIDER, rows.join('\n\n')].join(
        '\n',
      ),
      footer: 'Lực chiến = 100 + level×5 + cảnh giới×30 + phong hiệu 30 + chỉ số đã phân + trang bị · Realtime',
    });

    await interaction.deferReply();
    const card = await renderLeaderboardCard({
      title: 'Bảng xếp hạng lực chiến',
      subtitle: 'Top 10 đệ tử mạnh nhất',
      entries: ranked.map((e) => boardEntry(e.user, `${e.score.toLocaleString('en-US')} LC`)),
    });
    await interaction.editReply(withCard(embed, card));
    return;
  }

  // XP mode (legacy default)
  const entries = period === 'weekly' ? weeklyLeaderboard(store, 10) : topByXp(store, 10);

  const periodLabel = period === 'weekly' ? 'Tuần này (7 ngày)' : 'Toàn thời gian';
  const titleIcon = period === 'weekly' ? '📅' : ICONS.trophy;

  if (entries.length === 0) {
    await interaction.reply({
      content: `${titleIcon} **${periodLabel}** — chưa có ai có XP. ${ICONS.aki_sad}`,
      ephemeral: true,
    });
    return;
  }

  const rows = entries.map((e) => {
    const medal = MEDALS[e.rank - 1];
    const prefix = medal ?? `**\`#${e.rank}\`**`;
    const name = e.user.display_name ?? e.user.username;
    const rank = rankById(e.user.cultivation_rank);
    const rankIcon = RANK_ICONS[e.user.cultivation_rank] ?? '⭐';
    const score =
      period === 'weekly'
        ? `**+${e.score.toLocaleString('vi-VN')}** XP tuần`
        : `**${e.score.toLocaleString('vi-VN')}** XP`;
    return `${prefix} ${rankIcon} **${name}** · Level ${e.user.level} · ${rank.name}\n　 ${score}`;
  });

  const description = [
    `*Top 10 đệ tử tu vi nhanh nhất — ${periodLabel.toLowerCase()}*`,
    DIVIDER,
    rows.join('\n\n'),
  ].join('\n');

  const embed = themedEmbed('success', {
    title: `${titleIcon} Bảng Xếp Hạng — ${periodLabel}`,
    description,
    footer:
      period === 'weekly'
        ? 'Reset tự nhiên theo cửa sổ 7 ngày trượt · Bot post Chủ Nhật 20:00 VN'
        : 'XP all-time, không reset',
  });

  await interaction.deferReply();
  const card = await renderLeaderboardCard({
    title: period === 'weekly' ? 'Bảng xếp hạng tuần' : 'Bảng xếp hạng tu vi',
    subtitle: `Top 10 đệ tử tu vi nhanh nhất · ${periodLabel.toLowerCase()}`,
    entries: entries.map((e) =>
      boardEntry(
        e.user,
        period === 'weekly' ? `+${e.score.toLocaleString('en-US')} XP` : `${e.score.toLocaleString('en-US')} XP`,
      ),
    ),
  });
  await interaction.editReply(withCard(embed, card));
}

export const command = { data, execute };
export default command;
