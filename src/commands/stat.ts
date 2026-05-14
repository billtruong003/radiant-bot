import { type ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { rankById } from '../config/cultivation.js';
import { RANK_ICONS } from '../config/ui.js';
import { getStore } from '../db/index.js';
import { computeCombatPowerBreakdown } from '../modules/combat/power.js';
import { themedEmbed } from '../utils/embed.js';

/**
 * `/stat [user?]` — Phase 12 Lát 1 profile embed.
 *
 * Read-only combat profile: lực chiến breakdown + currencies + cảnh giới
 * + sub-title + equipped công pháp. Default target = caller; admin can
 * inspect another user.
 *
 * Separate from `/rank` (which is XP-progress focused) — this is the
 * combat/economy view. Both can stay alongside; `/stat` becomes the
 * canonical "show me my numbers" command once Tier C ships.
 */

export const data = new SlashCommandBuilder()
  .setName('stat')
  .setDescription('Xem profile combat + currencies (lực chiến, đan dược, công pháp)')
  .setDMPermission(false)
  .addUserOption((opt) =>
    opt.setName('user').setDescription('Thành viên cần xem (mặc định là bạn)').setRequired(false),
  );

function hexToInt(hex: string): number {
  return Number.parseInt(hex.replace(/^#/, ''), 16);
}

function fmt(n: number): string {
  return n.toLocaleString('vi-VN');
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const store = getStore();
  const user = store.users.get(target.id);

  if (!user) {
    await interaction.reply({
      content:
        target.id === interaction.user.id
          ? '🌫️ Bạn chưa có dữ liệu — gõ vài câu trong server hoặc dùng `/daily` để bắt đầu tu hành.'
          : '🌫️ Đệ tử này chưa có dữ liệu trong tông môn.',
      ephemeral: true,
    });
    return;
  }

  const rank = rankById(user.cultivation_rank);
  const rankIcon = RANK_ICONS[user.cultivation_rank] ?? '⭐';

  // Look up equipped công pháp (if any). null when nothing equipped OR
  // when the catalog entry was deleted while it was still equipped.
  const equippedSlug = user.equipped_cong_phap_slug ?? null;
  const equippedCongPhap = equippedSlug ? (store.congPhapCatalog.get(equippedSlug) ?? null) : null;

  const cp = computeCombatPowerBreakdown(user, equippedCongPhap);
  const pills = user.pills ?? 0;
  const contribution = user.contribution_points ?? 0;

  const cpBreakdownLines = [
    `• Nền: ${cp.base}`,
    `• Cấp độ: +${cp.levelBonus} _(${user.level} × 10)_`,
    `• Cảnh giới: +${cp.rankBonus}`,
    user.sub_title ? `• Sub-title: +${cp.subTitleBonus} _(${user.sub_title})_` : null,
    cp.congPhapBonus > 0 ? `• Công pháp: +${cp.congPhapBonus} _(${equippedCongPhap?.name})_` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const embed = themedEmbed('cultivation', {
    color: hexToInt(rank.colorHex),
    title: `${rankIcon} Combat profile — ${target.displayName ?? target.username}`,
    description: `_${rank.description}_`,
    footer: 'Phase 12 · Radiant Tech Sect',
  })
    .setThumbnail(target.displayAvatarURL({ size: 256 }))
    .addFields(
      {
        name: '⚔️ Lực chiến',
        value: `**${fmt(cp.total)}**\n${cpBreakdownLines}`,
        inline: false,
      },
      {
        name: '📈 Cảnh giới',
        value: `${rank.name}\nLv ${user.level} · ${fmt(user.xp)} XP`,
        inline: true,
      },
      {
        name: '💊 Đan dược',
        value: `**${fmt(pills)}** viên`,
        inline: true,
      },
      {
        name: '🪙 Cống hiến',
        value: `**${fmt(contribution)}**`,
        inline: true,
      },
      {
        name: '📜 Công pháp',
        value: equippedCongPhap
          ? `**${equippedCongPhap.name}** _(${equippedCongPhap.rarity})_\n${equippedCongPhap.description}`
          : '_Chưa trang bị công pháp nào. Sẽ mở khi `/shop` ship._',
        inline: false,
      },
    );

  await interaction.reply({ embeds: [embed] });
}

export const command = { data, execute };
export default command;
