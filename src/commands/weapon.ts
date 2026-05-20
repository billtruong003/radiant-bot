import { type ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { rankById } from '../config/cultivation.js';
import { BAN_MENH_SLUG_PREFIX } from '../modules/arena/forge.js';
import { autocompleteWeapon } from '../modules/combat/autocomplete.js';
import {
  MAX_LEVEL,
  costToUpgrade,
  rollUpgrade,
  weaponSuccessRate,
} from '../modules/combat/upgrade.js';
import { buyWeapon } from '../modules/combat/weapon-shop.js';
import { getStore } from '../db/index.js';
import type { WeaponStats } from '../db/types.js';
import { logger } from '../utils/logger.js';

/**
 * /weapon list|info|equip|unequip|upgrade — Phase 14.
 *
 * Equipped weapon contributes to LC via combat/power.ts. Bản mệnh weapons
 * (forged per-user, slug `phap-khi-ban-menh-<id>`) live in `userWeapons`
 * with `custom_stats`; catalog weapons (slug in `weapon_catalog`) only
 * appear in `userWeapons` once purchased. Both equip the same way:
 * `user.equipped_weapon_slug = slug`.
 *
 * Upgrade: RNG via `rollUpgrade('weapon', ...)`. Pays cost regardless of
 * outcome. Level ≥7 with fail downgrades −1 (Bill's "xianxia hardcore"
 * choice 2026-05-20).
 */

const TIER_ORDER: Record<string, number> = {
  ban_menh: 0,
  pham: 1,
  dia: 2,
  thien: 3,
  tien: 4,
  thanh: 5,
  than: 6,
  huyen: 7,
};

const TIER_ICON: Record<string, string> = {
  ban_menh: '🔮',
  pham: '⚔️',
  dia: '🗡️',
  thien: '🪄',
  tien: '✨',
  thanh: '🌟',
  than: '⚜️',
  huyen: '👑',
};

interface ResolvedWeapon {
  slug: string;
  display_name: string;
  category: string;
  tier: string;
  stats: WeaponStats;
  level: number;
  isBanMenh: boolean;
}

function resolveOwnedWeapon(userId: string, slug: string): ResolvedWeapon | null {
  const store = getStore();
  const owned = store.userWeapons.query((w) => w.discord_id === userId && w.weapon_slug === slug)[0];
  if (!owned) {
    // Catalog ref without ownership — block (user must buy first).
    return null;
  }
  const catalog = store.weaponCatalog.get(slug);
  if (catalog) {
    return {
      slug,
      display_name: catalog.display_name,
      category: catalog.category,
      tier: catalog.tier,
      stats: catalog.stats,
      level: owned.level ?? 0,
      isBanMenh: false,
    };
  }
  // Bản mệnh — custom_stats must be set.
  if (slug.startsWith(BAN_MENH_SLUG_PREFIX) && owned.custom_stats) {
    return {
      slug,
      display_name: 'Bản Mệnh Khí',
      category: 'spirit',
      tier: 'ban_menh',
      stats: owned.custom_stats,
      level: owned.level ?? 0,
      isBanMenh: true,
    };
  }
  return null;
}

export const data = new SlashCommandBuilder()
  .setName('weapon')
  .setDescription('Quản lý vũ khí (list / info / equip / unequip / upgrade)')
  .setDMPermission(false)
  .addSubcommand((sc) =>
    sc.setName('list').setDescription('Liệt kê vũ khí bạn sở hữu (⭐ = đang trang bị)'),
  )
  .addSubcommand((sc) =>
    sc
      .setName('info')
      .setDescription('Xem chi tiết 1 vũ khí')
      .addStringOption((o) =>
        o.setName('slug').setDescription('Tên vũ khí (autocomplete)').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('equip')
      .setDescription('Trang bị 1 vũ khí đã sở hữu')
      .addStringOption((o) =>
        o.setName('slug').setDescription('Tên vũ khí (autocomplete)').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sc) => sc.setName('unequip').setDescription('Bỏ trang bị vũ khí hiện tại'))
  .addSubcommand((sc) =>
    sc
      .setName('buy')
      .setDescription('Mua 1 vũ khí từ catalog (pills + cống hiến)')
      .addStringOption((o) =>
        o.setName('slug').setDescription('Tên vũ khí (autocomplete)').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('upgrade')
      .setDescription('Cường hóa vũ khí (RNG — level ≥7 fail = tụt 1 cấp)')
      .addStringOption((o) =>
        o.setName('slug').setDescription('Tên vũ khí (autocomplete)').setRequired(true).setAutocomplete(true),
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
    const owned = store.userWeapons.query((w) => w.discord_id === userId);
    if (owned.length === 0) {
      await interaction.reply({
        content: '🗡️ Bạn chưa có vũ khí. Forge bản mệnh qua `/arena` hoặc mua từ shop.',
        ephemeral: true,
      });
      return;
    }
    const equippedSlug = user.equipped_weapon_slug ?? null;
    const sorted = [...owned].sort((a, b) => {
      const ra = resolveOwnedWeapon(userId, a.weapon_slug);
      const rb = resolveOwnedWeapon(userId, b.weapon_slug);
      return (TIER_ORDER[rb?.tier ?? 'pham'] ?? 1) - (TIER_ORDER[ra?.tier ?? 'pham'] ?? 1);
    });
    const lines = sorted.map((w) => {
      const r = resolveOwnedWeapon(userId, w.weapon_slug);
      if (!r) return `• \`${w.weapon_slug}\` _(catalog miss)_`;
      const star = r.slug === equippedSlug ? '⭐' : '  ';
      const lv = r.level > 0 ? ` **+${r.level}**` : '';
      return `${star} ${TIER_ICON[r.tier] ?? '⚔️'} **${r.display_name}**${lv} \`${r.slug.slice(0, 30)}${r.slug.length > 30 ? '…' : ''}\``;
    });
    const embed = new EmbedBuilder()
      .setColor(0xd4af37)
      .setTitle('⚔️ Vũ khí inventory')
      .setDescription(lines.join('\n'))
      .setFooter({ text: `${owned.length} vũ khí · ⭐ = đang trang bị · +N = cường hóa Lv N` });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  const slug = interaction.options.getString('slug', false);

  if (sub === 'info') {
    if (!slug) {
      await interaction.reply({ content: '⚠️ Thiếu slug.', ephemeral: true });
      return;
    }
    const r = resolveOwnedWeapon(userId, slug);
    if (!r) {
      await interaction.reply({
        content: `⚠️ Không tìm thấy vũ khí \`${slug}\` trong inventory của bạn.`,
        ephemeral: true,
      });
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(0xd4af37)
      .setTitle(`${TIER_ICON[r.tier] ?? '⚔️'} ${r.display_name} ${r.level > 0 ? `**+${r.level}**` : ''}`)
      .addFields(
        { name: 'Tier', value: r.tier, inline: true },
        { name: 'Loại', value: r.category, inline: true },
        { name: 'Cường hóa', value: `Lv ${r.level} / ${MAX_LEVEL}`, inline: true },
        { name: '⚔️ Damage base', value: `${r.stats.damage_base}`, inline: true },
        { name: '💥 Crit', value: `${(r.stats.crit_chance * 100).toFixed(1)}% × ${r.stats.crit_multi}`, inline: true },
        { name: '🔁 Pierce', value: `${r.stats.pierce_count}`, inline: true },
      )
      .setFooter({ text: `slug: ${r.slug}` });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === 'equip') {
    if (!slug) {
      await interaction.reply({ content: '⚠️ Thiếu slug.', ephemeral: true });
      return;
    }
    const r = resolveOwnedWeapon(userId, slug);
    if (!r) {
      await interaction.reply({
        content: `⚠️ Không sở hữu \`${slug}\`.`,
        ephemeral: true,
      });
      return;
    }
    await store.users.set({ ...user, equipped_weapon_slug: slug });
    {
      const { checkEquipBothQuest } = await import('../modules/quests/daily-quest.js');
      void checkEquipBothQuest(userId);
    }
    // Phase 14.4 — surface lore on equip. Bản mệnh weapons don't have lore
    // (forged custom) so skip the snippet for those.
    const catalog = store.weaponCatalog.get(slug);
    const loreSnippet = catalog?.lore ? `\n_${catalog.lore.slice(0, 220)}${catalog.lore.length > 220 ? '…' : ''}_` : '';
    await interaction.reply({
      content: `⭐ Đã trang bị **${r.display_name}** ${r.level > 0 ? `**+${r.level}**` : ''}.${loreSnippet}`,
      ephemeral: true,
    });
    return;
  }

  if (sub === 'unequip') {
    if (!user.equipped_weapon_slug) {
      await interaction.reply({
        content: 'ℹ️ Bạn không có vũ khí nào đang trang bị.',
        ephemeral: true,
      });
      return;
    }
    await store.users.set({ ...user, equipped_weapon_slug: null });
    await interaction.reply({ content: '🗑️ Đã bỏ trang bị vũ khí.', ephemeral: true });
    return;
  }

  if (sub === 'buy') {
    if (!slug) {
      await interaction.reply({ content: '⚠️ Thiếu slug.', ephemeral: true });
      return;
    }
    const r = await buyWeapon(userId, slug);
    if (!r.ok) {
      const msg = (() => {
        switch (r.reason) {
          case 'not-found':
            return `⚠️ Không có vũ khí \`${slug}\` trong catalog.`;
          case 'not-buyable':
            return `⚠️ Vũ khí này không bán (vd bản mệnh — forge qua \`/arena\`).`;
          case 'already-owned':
            return `ℹ️ Bạn đã sở hữu \`${slug}\` rồi.`;
          case 'rank-too-low': {
            const w = store.weaponCatalog.get(slug);
            const req = w?.shop?.unlock_realm ? rankById(w.shop.unlock_realm).name : '';
            return `🚫 Cảnh giới chưa đủ. Yêu cầu: **${req}**.`;
          }
          case 'not-enough-pills':
            return '💊 Không đủ đan dược.';
          case 'not-enough-contribution':
            return '🪙 Không đủ điểm cống hiến.';
          default:
            return `⚠️ Không mua được: ${r.reason ?? 'unknown'}`;
        }
      })();
      await interaction.reply({ content: msg, ephemeral: true });
      return;
    }
    const w = store.weaponCatalog.get(slug);
    await interaction.reply({
      content: `✅ Đã mua **${w?.display_name ?? slug}**! Còn lại: ${r.newPills}💊 + ${r.newContribution}🪙. Dùng \`/weapon equip ${slug}\` để trang bị.`,
      ephemeral: true,
    });
    return;
  }

  if (sub === 'upgrade') {
    if (!slug) {
      await interaction.reply({ content: '⚠️ Thiếu slug.', ephemeral: true });
      return;
    }
    const r = resolveOwnedWeapon(userId, slug);
    if (!r) {
      await interaction.reply({
        content: `⚠️ Không sở hữu \`${slug}\`.`,
        ephemeral: true,
      });
      return;
    }
    if (r.level >= MAX_LEVEL) {
      await interaction.reply({
        content: `🌟 Vũ khí đã đạt cường hóa tối đa (Lv ${MAX_LEVEL}).`,
        ephemeral: true,
      });
      return;
    }
    const cost = costToUpgrade(r.level);
    const pills = user.pills ?? 0;
    const contrib = user.contribution_points ?? 0;
    if (pills < cost.pills || contrib < cost.contribution) {
      await interaction.reply({
        content: `💊 Cần **${cost.pills} đan dược** + **${cost.contribution} cống hiến** để cường hóa Lv ${r.level}→${r.level + 1}. Bạn có: ${pills}💊 + ${contrib}🪙.`,
        ephemeral: true,
      });
      return;
    }

    const rate = weaponSuccessRate(r.level);
    const outcome = rollUpgrade('weapon', r.level);

    await store.users.set({
      ...user,
      pills: pills - cost.pills,
      contribution_points: contrib - cost.contribution,
    });

    // Update UserWeapon record on success OR downgrade.
    if (outcome.result === 'success' || outcome.result === 'fail-downgrade') {
      const owned = store.userWeapons.query(
        (w) => w.discord_id === userId && w.weapon_slug === slug,
      )[0];
      if (owned) {
        await store.userWeapons.set({ ...owned, level: outcome.newLevel });
      }
    }

    logger.info(
      {
        discord_id: userId,
        slug,
        from_level: r.level,
        outcome: outcome.result,
        new_level: outcome.newLevel,
      },
      'weapon: upgrade attempt',
    );

    // Phase 14 quest — upgrade_attempt regardless of outcome.
    {
      const { incrementProgress } = await import('../modules/quests/daily-quest.js');
      void incrementProgress(userId, 'upgrade_attempt', 1);
    }
    // Phase 14 title — re-check eligibility on success.
    if (outcome.result === 'success') {
      const { awardEligibleTitles } = await import('../modules/titles/index.js');
      void awardEligibleTitles(userId);
    }

    const ratePct = (rate * 100).toFixed(0);
    let flavor: string;
    if (outcome.result === 'success') {
      flavor = `✨ **THÀNH CÔNG** (xác suất ${ratePct}%) — **${r.display_name}** Lv ${r.level} → **+${outcome.newLevel}**.`;
    } else if (outcome.result === 'fail-downgrade') {
      flavor = `💥 **THẤT BẠI NẶNG** (xác suất thành công ${ratePct}%) — linh khí vũ khí sụp đổ, tụt xuống **Lv ${outcome.newLevel}**. Hậu quả của tham vọng quá cao.`;
    } else {
      flavor = `💥 **THẤT BẠI** (xác suất thành công ${ratePct}%) — luyện khí bất ổn, giữ nguyên Lv ${r.level}. Đan dược + cống hiến đã tiêu tan.`;
    }
    await interaction.reply({
      content: `${flavor}\n💸 Trừ: ${cost.pills}💊 + ${cost.contribution}🪙`,
      ephemeral: true,
    });
  }
}

export const autocomplete = autocompleteWeapon;
export const command = { data, execute, autocomplete };
export default command;
