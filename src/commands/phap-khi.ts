import { ulid } from 'ulid';
import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import { rankById } from '../config/cultivation.js';
import { getStore } from '../db/index.js';
import { autocompletePhapKhi } from '../modules/combat/autocomplete.js';
import { canEquipPhapKhi, PHAP_KHI_MIN_RANK } from '../modules/combat/equipment-resolver.js';
import {
  MAX_LEVEL,
  congPhapSuccessRate,
  costToUpgrade,
  rollUpgrade,
} from '../modules/combat/upgrade.js';
import { logger } from '../utils/logger.js';

/**
 * /phap-khi list|info|buy|equip|unequip|upgrade — Phase 14 round 3.
 *
 * Single-slot equipment gated by rank Kim Đan (idx 3). Catalog seeded
 * from phap-khi-catalog.json at startup. Upgrade reuses the công pháp
 * success curve (100% L<4 → 20% L9), stay-put on fail.
 */

const RARITY_EMOJI: Record<string, string> = {
  rare: '🔵',
  epic: '🟣',
  legendary: '🟡',
  tien_khi: '✨',
};

export const data = new SlashCommandBuilder()
  .setName('phap-khi')
  .setDescription('Quản lý pháp khí (magic treasure) — single slot, từ Kim Đan')
  .setDMPermission(false)
  .addSubcommand((sc) =>
    sc.setName('list').setDescription('Liệt kê pháp khí đã sở hữu'),
  )
  .addSubcommand((sc) =>
    sc
      .setName('info')
      .setDescription('Xem chi tiết 1 pháp khí trong catalog')
      .addStringOption((o) =>
        o.setName('slug').setDescription('Tên pháp khí (autocomplete)').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('buy')
      .setDescription('Mua 1 pháp khí')
      .addStringOption((o) =>
        o.setName('slug').setDescription('Tên pháp khí (autocomplete)').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('equip')
      .setDescription('Trang bị 1 pháp khí đã sở hữu')
      .addStringOption((o) =>
        o.setName('slug').setDescription('Tên pháp khí (autocomplete)').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sc) => sc.setName('unequip').setDescription('Bỏ trang bị pháp khí hiện tại'))
  .addSubcommand((sc) =>
    sc
      .setName('upgrade')
      .setDescription('Cường hóa pháp khí')
      .addStringOption((o) =>
        o.setName('slug').setDescription('Tên pháp khí (autocomplete)').setRequired(true).setAutocomplete(true),
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
    const owned = store.userPhapKhi.query((u) => u.discord_id === userId);
    if (owned.length === 0) {
      await interaction.reply({
        content: '✨ Bạn chưa có pháp khí. `/shop` (tab pháp khí) để mua — yêu cầu Kim Đan trở lên.',
        ephemeral: true,
      });
      return;
    }
    const equippedSlug = user.equipped_phap_khi_slug ?? null;
    const lines = owned.map((up) => {
      const item = store.phapKhiCatalog.get(up.phap_khi_slug);
      if (!item) return `• \`${up.phap_khi_slug}\` _(catalog miss)_`;
      const star = up.phap_khi_slug === equippedSlug ? '⭐' : '  ';
      const lv = (up.level ?? 0) > 0 ? ` **+${up.level}**` : '';
      return `${star} ${item.icon} **${item.name}**${lv} ${RARITY_EMOJI[item.rarity] ?? ''} _(+${item.stat_bonuses.combat_power} LC)_`;
    });
    const embed = new EmbedBuilder()
      .setColor(0xb09bd3)
      .setTitle('✨ Pháp khí inventory')
      .setDescription(lines.join('\n'))
      .setFooter({ text: `${owned.length} pháp khí · ⭐ = đang trang bị` });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  const slug = interaction.options.getString('slug', false);

  if (sub === 'info') {
    if (!slug) {
      await interaction.reply({ content: '⚠️ Thiếu slug.', ephemeral: true });
      return;
    }
    const item = store.phapKhiCatalog.get(slug);
    if (!item) {
      await interaction.reply({
        content: `⚠️ Không tìm thấy pháp khí \`${slug}\`.`,
        ephemeral: true,
      });
      return;
    }
    const rankReq = item.min_rank_required
      ? rankById(item.min_rank_required).name
      : 'Không yêu cầu';
    const embed = new EmbedBuilder()
      .setColor(0xb09bd3)
      .setTitle(`${item.icon} ${item.name} ${RARITY_EMOJI[item.rarity] ?? ''}`)
      .setDescription(`${item.description}\n\n_${item.lore}_`)
      .addFields(
        { name: 'Loại', value: item.type, inline: true },
        { name: 'Rarity', value: item.rarity, inline: true },
        { name: '⚔️ Combat Power', value: `+${item.stat_bonuses.combat_power}`, inline: true },
        { name: '🎯 Yêu cầu', value: rankReq, inline: true },
        { name: '💊 Đan dược', value: `${item.cost_pills}`, inline: true },
        { name: '🪙 Cống hiến', value: `${item.cost_contribution}`, inline: true },
        ...(item.passive_text ? [{ name: '✨ Passive', value: item.passive_text }] : []),
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
    const item = store.phapKhiCatalog.get(slug);
    if (!item) {
      await interaction.reply({
        content: `⚠️ Không có pháp khí \`${slug}\` trong catalog.`,
        ephemeral: true,
      });
      return;
    }
    // Rank gate
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
    const owned = store.userPhapKhi.query((u) => u.discord_id === userId && u.phap_khi_slug === slug);
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
    await store.userPhapKhi.set({
      id: ulid(),
      discord_id: userId,
      phap_khi_slug: slug,
      acquired_at: Date.now(),
      level: 0,
    });
    // spend_contribution quest hook
    if (item.cost_contribution > 0) {
      const { incrementProgress } = await import('../modules/quests/daily-quest.js');
      void incrementProgress(userId, 'spend_contribution', item.cost_contribution);
    }
    await interaction.reply({
      content: `✅ Đã mua **${item.name}** (+${item.stat_bonuses.combat_power} LC). Còn ${newPills}💊 + ${newContribution}🪙. Dùng \`/phap-khi equip ${slug}\` để trang bị.`,
      ephemeral: true,
    });
    return;
  }

  if (sub === 'equip') {
    if (!slug) {
      await interaction.reply({ content: '⚠️ Thiếu slug.', ephemeral: true });
      return;
    }
    if (!canEquipPhapKhi(user.cultivation_rank)) {
      await interaction.reply({
        content: `🔒 Pháp khí slot chỉ mở từ **${rankById(PHAP_KHI_MIN_RANK).name}** trở lên.`,
        ephemeral: true,
      });
      return;
    }
    const owned = store.userPhapKhi.query((u) => u.discord_id === userId && u.phap_khi_slug === slug);
    if (owned.length === 0) {
      await interaction.reply({
        content: `⚠️ Bạn chưa sở hữu \`${slug}\`. Mua qua \`/phap-khi buy\`.`,
        ephemeral: true,
      });
      return;
    }
    await store.users.set({ ...user, equipped_phap_khi_slug: slug });
    const item = store.phapKhiCatalog.get(slug);
    const loreSnippet = item?.lore ? `\n_${item.lore.slice(0, 220)}${item.lore.length > 220 ? '…' : ''}_` : '';
    await interaction.reply({
      content: `⭐ Đã trang bị **${item?.name}**.${loreSnippet}`,
      ephemeral: true,
    });
    return;
  }

  if (sub === 'unequip') {
    if (!user.equipped_phap_khi_slug) {
      await interaction.reply({
        content: 'ℹ️ Bạn không có pháp khí nào đang trang bị.',
        ephemeral: true,
      });
      return;
    }
    await store.users.set({ ...user, equipped_phap_khi_slug: null });
    await interaction.reply({ content: '🗑️ Đã bỏ trang bị pháp khí.', ephemeral: true });
    return;
  }

  if (sub === 'upgrade') {
    if (!slug) {
      await interaction.reply({ content: '⚠️ Thiếu slug.', ephemeral: true });
      return;
    }
    const ownership = store.userPhapKhi.query(
      (u) => u.discord_id === userId && u.phap_khi_slug === slug,
    )[0];
    if (!ownership) {
      await interaction.reply({
        content: `⚠️ Bạn chưa sở hữu \`${slug}\`.`,
        ephemeral: true,
      });
      return;
    }
    const currentLevel = ownership.level ?? 0;
    if (currentLevel >= MAX_LEVEL) {
      await interaction.reply({
        content: `🌟 \`${slug}\` đã đạt cường hóa tối đa.`,
        ephemeral: true,
      });
      return;
    }
    const cost = costToUpgrade(currentLevel);
    const pills = user.pills ?? 0;
    const contrib = user.contribution_points ?? 0;
    if (pills < cost.pills || contrib < cost.contribution) {
      await interaction.reply({
        content: `💊 Cần **${cost.pills}💊 + ${cost.contribution}🪙** để cường hóa Lv ${currentLevel}→${currentLevel + 1}. Bạn có: ${pills}💊 + ${contrib}🪙.`,
        ephemeral: true,
      });
      return;
    }
    const item = store.phapKhiCatalog.get(slug);
    const rate = congPhapSuccessRate(currentLevel); // reuse forgiving curve
    const outcome = rollUpgrade('cong_phap', currentLevel);
    await store.users.set({
      ...user,
      pills: pills - cost.pills,
      contribution_points: contrib - cost.contribution,
    });
    if (outcome.result === 'success') {
      await store.userPhapKhi.set({ ...ownership, level: outcome.newLevel });
    }
    logger.info(
      { discord_id: userId, slug, from_level: currentLevel, outcome: outcome.result },
      'phap-khi: upgrade attempt',
    );
    // Quest hook
    {
      const { incrementProgress } = await import('../modules/quests/daily-quest.js');
      void incrementProgress(userId, 'upgrade_attempt', 1);
    }
    const ratePct = (rate * 100).toFixed(0);
    const flavor =
      outcome.result === 'success'
        ? `✨ **THÀNH CÔNG** (${ratePct}%) — \`${item?.name ?? slug}\` → **Lv ${outcome.newLevel}**.`
        : `💥 **THẤT BẠI** (${ratePct}%) — linh khí bất ổn, giữ Lv ${currentLevel}.`;
    await interaction.reply({
      content: `${flavor}\n💸 Trừ: ${cost.pills}💊 + ${cost.contribution}🪙`,
      ephemeral: true,
    });
  }
}

export const autocomplete = autocompletePhapKhi;
export const command = { data, execute, autocomplete };
export default command;
