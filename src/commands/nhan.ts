import { ulid } from 'ulid';
import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import { rankById } from '../config/cultivation.js';
import { getStore } from '../db/index.js';
import { autocompleteNhan } from '../modules/combat/autocomplete.js';
import { maxNhanSlots, readEquippedRingSlugs } from '../modules/combat/equipment-resolver.js';

/**
 * /nhan list|info|buy|equip|unequip — Phase 14 round 3.
 *
 * Up to 2 nhẫn equipped (slot 1 free, slot 2 unlocks at Nguyên Anh).
 * No upgrade on nhẫn (yet) — flat CP bonus + xp_multiplier/pill_discount
 * passive effects.
 */

const RARITY_EMOJI: Record<string, string> = {
  uncommon: '⚪',
  rare: '🔵',
  epic: '🟣',
  legendary: '🟡',
};

export const data = new SlashCommandBuilder()
  .setName('nhan')
  .setDescription('Quản lý nhẫn (up to 2 slot — slot 2 từ Nguyên Anh)')
  .setDMPermission(false)
  .addSubcommand((sc) => sc.setName('list').setDescription('Liệt kê nhẫn đã sở hữu'))
  .addSubcommand((sc) =>
    sc
      .setName('info')
      .setDescription('Xem chi tiết 1 nhẫn trong catalog')
      .addStringOption((o) =>
        o.setName('slug').setDescription('Tên nhẫn (autocomplete)').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('buy')
      .setDescription('Mua 1 nhẫn')
      .addStringOption((o) =>
        o.setName('slug').setDescription('Tên nhẫn (autocomplete)').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('equip')
      .setDescription('Trang bị nhẫn vào slot 1 hoặc 2')
      .addStringOption((o) =>
        o.setName('slug').setDescription('Tên nhẫn (autocomplete)').setRequired(true).setAutocomplete(true),
      )
      .addIntegerOption((o) =>
        o
          .setName('slot')
          .setDescription('Slot 1/2 (mặc định: slot trống đầu tiên)')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(2),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('unequip')
      .setDescription('Bỏ trang bị 1 slot (mặc định: tất cả)')
      .addIntegerOption((o) =>
        o
          .setName('slot')
          .setDescription('Slot 1/2 (mặc định: tất cả)')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(2),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(true);
  const userId = interaction.user.id;
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) {
    await interaction.reply({
      content: '🌫️ Bạn chưa có user record — chat vài câu trước.',
      ephemeral: true,
    });
    return;
  }

  if (sub === 'list') {
    const owned = store.userNhan.query((u) => u.discord_id === userId);
    if (owned.length === 0) {
      await interaction.reply({
        content: '💍 Bạn chưa có nhẫn. `/shop` (tab nhẫn) để mua.',
        ephemeral: true,
      });
      return;
    }
    const equippedSlugs = readEquippedRingSlugs(user);
    const lines = owned.map((un) => {
      const item = store.nhanCatalog.get(un.nhan_slug);
      if (!item) return `• \`${un.nhan_slug}\` _(catalog miss)_`;
      const slotIdx = equippedSlugs.indexOf(un.nhan_slug);
      const star = slotIdx >= 0 ? `⭐${slotIdx + 1}` : '  ';
      return `${star} ${item.icon} **${item.name}** ${RARITY_EMOJI[item.rarity] ?? ''} _(+${item.stat_bonuses.combat_power} LC)_`;
    });
    const embed = new EmbedBuilder()
      .setColor(0xd4a574)
      .setTitle('💍 Nhẫn inventory')
      .setDescription(lines.join('\n'))
      .setFooter({ text: `${owned.length} nhẫn · ⭐N = trang bị slot N` });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  const slug = interaction.options.getString('slug', false);

  if (sub === 'info') {
    if (!slug) {
      await interaction.reply({ content: '⚠️ Thiếu slug.', ephemeral: true });
      return;
    }
    const item = store.nhanCatalog.get(slug);
    if (!item) {
      await interaction.reply({
        content: `⚠️ Không tìm thấy nhẫn \`${slug}\`.`,
        ephemeral: true,
      });
      return;
    }
    const rankReq = item.min_rank_required
      ? rankById(item.min_rank_required).name
      : 'Không yêu cầu';
    const passives: string[] = [];
    if (item.stat_bonuses.xp_multiplier) passives.push(`+${(item.stat_bonuses.xp_multiplier * 100).toFixed(0)}% XP`);
    if (item.stat_bonuses.pill_discount) passives.push(`-${(item.stat_bonuses.pill_discount * 100).toFixed(0)}% pill cost`);
    const embed = new EmbedBuilder()
      .setColor(0xd4a574)
      .setTitle(`${item.icon} ${item.name} ${RARITY_EMOJI[item.rarity] ?? ''}`)
      .setDescription(`${item.description}\n\n_${item.lore}_`)
      .addFields(
        { name: 'Rarity', value: item.rarity, inline: true },
        { name: '⚔️ Combat Power', value: `+${item.stat_bonuses.combat_power}`, inline: true },
        { name: '🎯 Yêu cầu', value: rankReq, inline: true },
        { name: '💊 Đan dược', value: `${item.cost_pills}`, inline: true },
        { name: '🪙 Cống hiến', value: `${item.cost_contribution}`, inline: true },
        ...(passives.length ? [{ name: '✨ Passive', value: passives.join(' · ') }] : []),
      )
      .setFooter({ text: `slug: ${item.slug}` });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === 'buy') {
    if (!slug) {
      await interaction.reply({ content: '⚠️ Thiếu slug.', ephemeral: true });
      return;
    }
    const item = store.nhanCatalog.get(slug);
    if (!item) {
      await interaction.reply({
        content: `⚠️ Không có nhẫn \`${slug}\` trong catalog.`,
        ephemeral: true,
      });
      return;
    }
    if (item.min_rank_required) {
      const { rankIndex } = await import('../config/cultivation.js');
      if (rankIndex(user.cultivation_rank) < rankIndex(item.min_rank_required)) {
        await interaction.reply({
          content: `🚫 Cảnh giới chưa đủ. Yêu cầu: **${rankById(item.min_rank_required).name}**.`,
          ephemeral: true,
        });
        return;
      }
    }
    const owned = store.userNhan.query((u) => u.discord_id === userId && u.nhan_slug === slug);
    if (owned.length > 0) {
      await interaction.reply({ content: `ℹ️ Bạn đã sở hữu \`${slug}\` rồi.`, ephemeral: true });
      return;
    }
    const pills = user.pills ?? 0;
    const contrib = user.contribution_points ?? 0;
    if (pills < item.cost_pills) {
      await interaction.reply({ content: '💊 Không đủ đan dược.', ephemeral: true });
      return;
    }
    if (contrib < item.cost_contribution) {
      await interaction.reply({ content: '🪙 Không đủ điểm cống hiến.', ephemeral: true });
      return;
    }
    const newPills = pills - item.cost_pills;
    const newContribution = contrib - item.cost_contribution;
    await store.users.set({ ...user, pills: newPills, contribution_points: newContribution });
    await store.userNhan.set({
      id: ulid(),
      discord_id: userId,
      nhan_slug: slug,
      acquired_at: Date.now(),
    });
    if (item.cost_contribution > 0) {
      const { incrementProgress } = await import('../modules/quests/daily-quest.js');
      void incrementProgress(userId, 'spend_contribution', item.cost_contribution);
    }
    await interaction.reply({
      content: `✅ Đã mua **${item.name}** (+${item.stat_bonuses.combat_power} LC). Còn ${newPills}💊 + ${newContribution}🪙.`,
      ephemeral: true,
    });
    return;
  }

  if (sub === 'equip') {
    if (!slug) {
      await interaction.reply({ content: '⚠️ Thiếu slug.', ephemeral: true });
      return;
    }
    const owned = store.userNhan.query((u) => u.discord_id === userId && u.nhan_slug === slug);
    if (owned.length === 0) {
      await interaction.reply({
        content: `⚠️ Bạn chưa sở hữu \`${slug}\`.`,
        ephemeral: true,
      });
      return;
    }
    const maxSlots = maxNhanSlots(user.cultivation_rank);
    const current = readEquippedRingSlugs(user);
    const slotOpt = interaction.options.getInteger('slot') ?? null;
    let target: number;
    if (slotOpt !== null) {
      target = slotOpt - 1;
      if (target >= maxSlots) {
        await interaction.reply({
          content: `🔒 Slot này chưa mở. Slot 2 mở từ Nguyên Anh.`,
          ephemeral: true,
        });
        return;
      }
    } else {
      // Find empty slot first
      const emptyIdx = current.findIndex((_, i) => i >= current.length);
      target = emptyIdx >= 0 ? emptyIdx : Math.min(current.length, maxSlots - 1);
    }
    if (current.includes(slug) && current[target] !== slug) {
      await interaction.reply({
        content: `ℹ️ \`${slug}\` đã trang bị slot ${current.indexOf(slug) + 1}.`,
        ephemeral: true,
      });
      return;
    }
    const next = [...current];
    while (next.length <= target) next.push('');
    next[target] = slug;
    const finalSlugs = next.filter((s) => s.length > 0).slice(0, maxSlots);
    await store.users.set({ ...user, equipped_ring_slugs: finalSlugs });
    const item = store.nhanCatalog.get(slug);
    const loreSnippet = item?.lore ? `\n_${item.lore.slice(0, 220)}${item.lore.length > 220 ? '…' : ''}_` : '';
    await interaction.reply({
      content: `⭐ Đã trang bị **${item?.name}** vào slot ${target + 1}.${loreSnippet}`,
      ephemeral: true,
    });
    return;
  }

  if (sub === 'unequip') {
    const current = readEquippedRingSlugs(user);
    if (current.length === 0) {
      await interaction.reply({ content: 'ℹ️ Bạn không có nhẫn đang trang bị.', ephemeral: true });
      return;
    }
    const slotOpt = interaction.options.getInteger('slot') ?? null;
    const next = slotOpt !== null ? current.filter((_, i) => i !== slotOpt - 1) : [];
    await store.users.set({ ...user, equipped_ring_slugs: next });
    await interaction.reply({
      content: slotOpt !== null ? `🗑️ Đã bỏ trang bị slot ${slotOpt}.` : '🗑️ Đã bỏ trang bị tất cả nhẫn.',
      ephemeral: true,
    });
  }
}

export const autocomplete = autocompleteNhan;
export const command = { data, execute, autocomplete };
export default command;
