import { type ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { rankById } from '../config/cultivation.js';
import { getTitle } from '../config/titles.js';
import { RANK_ICONS } from '../config/ui.js';
import { getStore } from '../db/index.js';
import { computeCombatPowerBreakdown, resolveWeaponContribution } from '../modules/combat/power.js';
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
  const congPhapLevel = equippedSlug
    ? (store.userCongPhap.query(
        (uc) => uc.discord_id === target.id && uc.cong_phap_slug === equippedSlug,
      )[0]?.level ?? 0)
    : 0;

  // Phase 14 — weapon contribution. Handles both catalog refs and bản mệnh.
  const weapon = resolveWeaponContribution(
    user.equipped_weapon_slug,
    (slug) => store.weaponCatalog.get(slug) ?? null,
    (slug) =>
      store.userWeapons.query(
        (w) => w.discord_id === target.id && w.weapon_slug === slug,
      )[0] ?? null,
  );

  const cp = computeCombatPowerBreakdown(user, equippedCongPhap, congPhapLevel, weapon);
  const pills = user.pills ?? 0;
  const contribution = user.contribution_points ?? 0;

  const equippedWeaponName = (() => {
    if (!user.equipped_weapon_slug) return null;
    const cat = store.weaponCatalog.get(user.equipped_weapon_slug);
    if (cat) return cat.display_name;
    if (user.equipped_weapon_slug.startsWith('phap-khi-ban-menh-')) return 'Bản Mệnh Khí';
    return user.equipped_weapon_slug;
  })();

  const cpBreakdownLines = [
    `• Nền: ${cp.base}`,
    `• Cấp độ: +${cp.levelBonus} _(${user.level} × 5)_`,
    `• Cảnh giới: +${cp.rankBonus}`,
    user.sub_title ? `• Sub-title: +${cp.subTitleBonus} _(${user.sub_title})_` : null,
    cp.statBonus > 0 ? `• Chỉ số phân: +${cp.statBonus}` : null,
    cp.congPhapBonus > 0
      ? `• Công pháp: +${cp.congPhapBonus} _(${equippedCongPhap?.name}${congPhapLevel > 0 ? ` +${congPhapLevel}` : ''})_`
      : null,
    cp.weaponBonus > 0
      ? `• Vũ khí: +${cp.weaponBonus} _(${equippedWeaponName}${weapon && weapon.level > 0 ? ` +${weapon.level}` : ''})_`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  const equippedTitle = user.equipped_title_id ? getTitle(user.equipped_title_id) : null;
  const titleLine = equippedTitle
    ? `${equippedTitle.emoji} **${equippedTitle.name}**`
    : '_(chưa trang bị danh hiệu)_';

  const embed = themedEmbed('cultivation', {
    color: hexToInt(rank.colorHex),
    title: `${rankIcon} Combat profile — ${target.displayName ?? target.username}`,
    description: `_${rank.description}_\n🎖️ ${titleLine}`,
    footer: 'Phase 14 · Radiant Tech Sect',
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
