import { type ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { rankById } from '../config/cultivation.js';
import { getTitle } from '../config/titles.js';
import { RANK_ICONS } from '../config/ui.js';
import { getStore } from '../db/index.js';
import { resolveEquippedSlots } from '../modules/combat/equipment-resolver.js';
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

  // Phase 14 round 3 — resolve ALL equipment slots through shared helper.
  const slots = resolveEquippedSlots(target.id);
  const cp = computeCombatPowerBreakdown(user, slots.congPhap, slots.phapKhi, slots.nhan, slots.weapon);
  const pills = user.pills ?? 0;
  const contribution = user.contribution_points ?? 0;

  const equippedWeaponName = (() => {
    if (!user.equipped_weapon_slug) return null;
    const cat = store.weaponCatalog.get(user.equipped_weapon_slug);
    if (cat) return cat.display_name;
    if (user.equipped_weapon_slug.startsWith('phap-khi-ban-menh-')) return 'Bản Mệnh Khí';
    return user.equipped_weapon_slug;
  })();

  const cpSlotsLine = slots.congPhap.length
    ? slots.congPhap
        .map((s) => `${s.item.icon ?? '📜'} ${s.item.name}${s.level > 0 ? ` +${s.level}` : ''}`)
        .join(', ')
    : '_chưa có_';
  const phapKhiLine = slots.phapKhi
    ? `${slots.phapKhi.item.icon} ${slots.phapKhi.item.name}${slots.phapKhi.level > 0 ? ` +${slots.phapKhi.level}` : ''}`
    : null;
  const nhanLine = slots.nhan.length
    ? slots.nhan.map((n) => `${n.icon} ${n.name}`).join(', ')
    : null;

  const cpBreakdownLines = [
    `• Nền: ${cp.base}`,
    `• Cấp độ: +${cp.levelBonus} _(${user.level} × 5)_`,
    `• Cảnh giới: +${cp.rankBonus}`,
    user.sub_title ? `• Sub-title: +${cp.subTitleBonus} _(${user.sub_title})_` : null,
    cp.statBonus > 0 ? `• Chỉ số phân: +${cp.statBonus}` : null,
    cp.congPhapBonus > 0 ? `• Công pháp: +${cp.congPhapBonus} _(${cpSlotsLine})_` : null,
    cp.phapKhiBonus > 0 ? `• Pháp khí: +${cp.phapKhiBonus} _(${phapKhiLine})_` : null,
    cp.nhanBonus > 0 ? `• Nhẫn: +${cp.nhanBonus} _(${nhanLine})_` : null,
    cp.weaponBonus > 0
      ? `• Vũ khí: +${cp.weaponBonus} _(${equippedWeaponName}${slots.weapon && slots.weapon.level > 0 ? ` +${slots.weapon.level}` : ''})_`
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
        name: '📜 Công pháp đang trang bị',
        value: slots.congPhap.length
          ? slots.congPhap
              .map(
                (s, i) =>
                  `**Slot ${i + 1}**: ${s.item.icon ?? '📜'} ${s.item.name}${s.level > 0 ? ` **+${s.level}**` : ''} _(${s.item.rarity})_`,
              )
              .join('\n')
          : '_Chưa trang bị — `/inventory` để chọn._',
        inline: false,
      },
    );

  await interaction.reply({ embeds: [embed] });
}

export const command = { data, execute };
export default command;
