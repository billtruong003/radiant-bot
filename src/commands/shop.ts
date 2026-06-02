import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type Message,
  type MessageActionRowComponentBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { rankById } from '../config/cultivation.js';
import { getStore } from '../db/index.js';
import { RARITY_EMOJI, buyCongPhap, listShopAvailable } from '../modules/combat/cong-phap.js';
import {
  NHAN_RARITY_EMOJI,
  buyNhan,
  listLockedShopNhan,
  listShopNhan,
} from '../modules/combat/nhan-shop.js';
import {
  PHAP_KHI_RARITY_EMOJI,
  buyPhapKhi,
  listLockedShopPhapKhi,
  listShopPhapKhi,
} from '../modules/combat/phap-khi-shop.js';
import {
  TIER_ICON,
  buyWeapon,
  listLockedShopWeapons,
  listShopWeapons,
} from '../modules/combat/weapon-shop.js';
import { logger } from '../utils/logger.js';
import { buildPageNavRow, pageOf } from '../utils/pagination.js';

/**
 * /shop — Phase 14.5 four-tab shop.
 *
 * 📜 Công pháp · ⚔️ Vũ khí · ✨ Pháp khí · 💍 Nhẫn
 *
 * Each tab renders a list embed + a 25-option StringSelectMenu of buyable
 * items (ranked by affordable + owned-not-yet, sliced top-25 per Discord
 * cap). Select an option → triggers the appropriate buy helper, re-renders.
 * Item descriptions in the select-menu surface lore teasers (95-char).
 *
 * 3-state ownership icons distinguish ⭐ equipped / ✅ owned-not-equipped /
 * 🟢 affordable / ⏳ unaffordable / 🔒 rank-locked.
 */

const COLLECTOR_TIMEOUT_MS = 5 * 60 * 1000;

type Tab = 'cong_phap' | 'weapon' | 'phap_khi' | 'nhan';

const TAB_META: Record<Tab, { emoji: string; label: string }> = {
  cong_phap: { emoji: '📜', label: 'Công pháp' },
  weapon: { emoji: '⚔️', label: 'Vũ khí' },
  phap_khi: { emoji: '✨', label: 'Pháp khí' },
  nhan: { emoji: '💍', label: 'Nhẫn' },
};

// ============== Công pháp tab ==============================================

function buildCongPhapEmbed(userId: string): EmbedBuilder {
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) return new EmbedBuilder().setTitle('🏪 Shop').setDescription('🌫️ Chưa có user record.');

  const pills = user.pills ?? 0;
  const contrib = user.contribution_points ?? 0;
  const available = listShopAvailable(user.cultivation_rank);
  const all = store.congPhapCatalog
    .query(() => true)
    .sort((a, b) => a.cost_contribution - b.cost_contribution);
  const locked = all.filter((it) => !available.some((a) => a.slug === it.slug));
  const ownedSlugs = new Set(
    store.userCongPhap.query((uc) => uc.discord_id === userId).map((uc) => uc.cong_phap_slug),
  );
  const equippedSlugs = new Set(
    user.equipped_cong_phap_slugs && user.equipped_cong_phap_slugs.length > 0
      ? user.equipped_cong_phap_slugs
      : user.equipped_cong_phap_slug
        ? [user.equipped_cong_phap_slug]
        : [],
  );

  const fmt = (item: (typeof available)[number], isLocked: boolean): string => {
    const rarity = RARITY_EMOJI[item.rarity] ?? '⚪';
    const owned = ownedSlugs.has(item.slug);
    const equipped = equippedSlugs.has(item.slug);
    const affordable = pills >= item.cost_pills && contrib >= item.cost_contribution;
    const lockReq = item.min_rank_required ? ` _(${rankById(item.min_rank_required).name})_` : '';
    const prefix = equipped ? '⭐' : owned ? '✅' : isLocked ? '🔒' : affordable ? '🟢' : '⏳';
    return `${prefix} ${rarity} **${item.name}** — +${item.stat_bonuses.combat_power} LC · ${item.cost_pills}💊 + ${item.cost_contribution}🪙${lockReq}`;
  };

  const lines = [
    `**Bạn có**: 💊 ${pills} · 🪙 ${contrib} · ${rankById(user.cultivation_rank).name}`,
    '',
    '**Có thể mua:**',
    available.length ? available.map((it) => fmt(it, false)).join('\n') : '_Catalog rỗng._',
    locked.length ? '\n**Bị khoá:**' : '',
    locked.map((it) => fmt(it, true)).join('\n'),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);

  return new EmbedBuilder()
    .setColor(0xf4d03f)
    .setTitle('🏪 Shop — 📜 Công pháp')
    .setDescription(lines)
    .setFooter({
      text: '⭐ đang đeo · ✅ sở hữu · 🟢 mua được · ⏳ chưa đủ tiền · 🔒 chưa đủ cảnh giới',
    });
}

function buildCongPhapBuyOptions(userId: string): StringSelectMenuOptionBuilder[] {
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) return [];
  const pills = user.pills ?? 0;
  const contrib = user.contribution_points ?? 0;
  const owned = new Set(
    store.userCongPhap.query((uc) => uc.discord_id === userId).map((uc) => uc.cong_phap_slug),
  );
  const buyable = listShopAvailable(user.cultivation_rank).filter(
    (it) => !owned.has(it.slug) && pills >= it.cost_pills && contrib >= it.cost_contribution,
  );
  return buyable.map((it) => {
    const lore = (it as { lore?: string }).lore;
    const desc = lore
      ? `${lore.slice(0, 95)}${lore.length > 95 ? '…' : ''}`
      : `+${it.stat_bonuses.combat_power} LC · ${it.cost_pills}💊+${it.cost_contribution}🪙`;
    return new StringSelectMenuOptionBuilder()
      .setLabel(
        `${it.name} (+${it.stat_bonuses.combat_power} · ${it.cost_pills}💊+${it.cost_contribution}🪙)`.slice(
          0,
          100,
        ),
      )
      .setValue(it.slug)
      .setDescription(desc.slice(0, 100))
      .setEmoji(RARITY_EMOJI[it.rarity] ?? '⚪');
  });
}

// ============== Weapon tab ==================================================

function buildWeaponEmbed(userId: string): EmbedBuilder {
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) return new EmbedBuilder().setTitle('🏪 Shop').setDescription('🌫️ Chưa có user record.');

  const pills = user.pills ?? 0;
  const contrib = user.contribution_points ?? 0;
  const available = listShopWeapons(user.cultivation_rank);
  const locked = listLockedShopWeapons(user.cultivation_rank);
  const ownedSlugs = new Set(
    store.userWeapons.query((w) => w.discord_id === userId).map((w) => w.weapon_slug),
  );
  const equippedSlug = user.equipped_weapon_slug ?? null;

  const fmt = (w: (typeof available)[number], isLocked: boolean): string => {
    const tierIcon = TIER_ICON[w.tier] ?? '⚔️';
    const owned = ownedSlugs.has(w.slug);
    const equipped = equippedSlug === w.slug;
    const cp = w.shop?.cost_pills ?? 0;
    const cc = w.shop?.cost_contribution ?? 0;
    const affordable = pills >= cp && contrib >= cc;
    const lockReq = w.shop?.unlock_realm ? ` _(${rankById(w.shop.unlock_realm).name})_` : '';
    const prefix = equipped ? '⭐' : owned ? '✅' : isLocked ? '🔒' : affordable ? '🟢' : '⏳';
    return `${prefix} ${tierIcon} **${w.display_name}** — dmg ${w.stats.damage_base} · ${cp}💊 + ${cc}🪙${lockReq}`;
  };

  const lines = [
    `**Bạn có**: 💊 ${pills} · 🪙 ${contrib} · ${rankById(user.cultivation_rank).name}`,
    '',
    '**Có thể mua:**',
    available.length ? available.map((w) => fmt(w, false)).join('\n') : '_Catalog rỗng._',
    locked.length ? '\n**Bị khoá:**' : '',
    locked.map((w) => fmt(w, true)).join('\n'),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);

  return new EmbedBuilder()
    .setColor(0xd4af37)
    .setTitle('🏪 Shop — ⚔️ Vũ khí')
    .setDescription(lines)
    .setFooter({
      text: '⭐ đang đeo · ✅ sở hữu · 🟢 mua được · ⏳ chưa đủ tiền · 🔒 chưa đủ cảnh giới',
    });
}

function buildWeaponBuyOptions(userId: string): StringSelectMenuOptionBuilder[] {
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) return [];
  const pills = user.pills ?? 0;
  const contrib = user.contribution_points ?? 0;
  const owned = new Set(
    store.userWeapons.query((w) => w.discord_id === userId).map((w) => w.weapon_slug),
  );
  const buyable = listShopWeapons(user.cultivation_rank)
    .filter((w) => !owned.has(w.slug))
    .filter(
      (w) => pills >= (w.shop?.cost_pills ?? 0) && contrib >= (w.shop?.cost_contribution ?? 0),
    );
  return buyable.map((w) => {
    const desc = w.lore
      ? `${w.lore.slice(0, 95)}${w.lore.length > 95 ? '…' : ''}`
      : `dmg ${w.stats.damage_base} · ${w.shop?.cost_pills ?? 0}💊+${w.shop?.cost_contribution ?? 0}🪙`;
    return new StringSelectMenuOptionBuilder()
      .setLabel(`${w.display_name} (dmg ${w.stats.damage_base})`.slice(0, 100))
      .setValue(w.slug)
      .setDescription(desc.slice(0, 100))
      .setEmoji(TIER_ICON[w.tier] ?? '⚔️');
  });
}

// ============== Pháp khí tab ================================================

function buildPhapKhiEmbed(userId: string): EmbedBuilder {
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) return new EmbedBuilder().setTitle('🏪 Shop').setDescription('🌫️ Chưa có user record.');

  const pills = user.pills ?? 0;
  const contrib = user.contribution_points ?? 0;
  const available = listShopPhapKhi(user.cultivation_rank);
  const locked = listLockedShopPhapKhi(user.cultivation_rank);
  const ownedSlugs = new Set(
    store.userPhapKhi.query((u) => u.discord_id === userId).map((u) => u.phap_khi_slug),
  );
  const equippedSlug = user.equipped_phap_khi_slug ?? null;

  const fmt = (it: (typeof available)[number], isLocked: boolean): string => {
    const rarity = PHAP_KHI_RARITY_EMOJI[it.rarity] ?? '✨';
    const owned = ownedSlugs.has(it.slug);
    const equipped = equippedSlug === it.slug;
    const affordable = pills >= it.cost_pills && contrib >= it.cost_contribution;
    const lockReq = it.min_rank_required ? ` _(${rankById(it.min_rank_required).name})_` : '';
    const prefix = equipped ? '⭐' : owned ? '✅' : isLocked ? '🔒' : affordable ? '🟢' : '⏳';
    return `${prefix} ${rarity} ${it.icon} **${it.name}** — +${it.stat_bonuses.combat_power} LC · ${it.cost_pills}💊 + ${it.cost_contribution}🪙${lockReq}`;
  };

  const lines = [
    `**Bạn có**: 💊 ${pills} · 🪙 ${contrib} · ${rankById(user.cultivation_rank).name}`,
    '',
    '**Có thể mua:**',
    available.length ? available.map((it) => fmt(it, false)).join('\n') : '_Catalog rỗng._',
    locked.length ? '\n**Bị khoá:**' : '',
    locked.map((it) => fmt(it, true)).join('\n'),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);

  return new EmbedBuilder()
    .setColor(0xb09bd3)
    .setTitle('🏪 Shop — ✨ Pháp khí')
    .setDescription(lines)
    .setFooter({
      text: '⭐ đang đeo · ✅ sở hữu · 🟢 mua được · ⏳ chưa đủ tiền · 🔒 chưa đủ cảnh giới (slot mở từ Kim Đan)',
    });
}

function buildPhapKhiBuyOptions(userId: string): StringSelectMenuOptionBuilder[] {
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) return [];
  const pills = user.pills ?? 0;
  const contrib = user.contribution_points ?? 0;
  const owned = new Set(
    store.userPhapKhi.query((u) => u.discord_id === userId).map((u) => u.phap_khi_slug),
  );
  const buyable = listShopPhapKhi(user.cultivation_rank).filter(
    (it) => !owned.has(it.slug) && pills >= it.cost_pills && contrib >= it.cost_contribution,
  );
  return buyable.map((it) => {
    const desc = it.lore
      ? `${it.lore.slice(0, 95)}${it.lore.length > 95 ? '…' : ''}`
      : `+${it.stat_bonuses.combat_power} LC · ${it.cost_pills}💊+${it.cost_contribution}🪙`;
    return new StringSelectMenuOptionBuilder()
      .setLabel(`${it.name} (+${it.stat_bonuses.combat_power})`.slice(0, 100))
      .setValue(it.slug)
      .setDescription(desc.slice(0, 100))
      .setEmoji(it.icon || (PHAP_KHI_RARITY_EMOJI[it.rarity] ?? '✨'));
  });
}

// ============== Nhẫn tab ====================================================

function buildNhanEmbed(userId: string): EmbedBuilder {
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) return new EmbedBuilder().setTitle('🏪 Shop').setDescription('🌫️ Chưa có user record.');

  const pills = user.pills ?? 0;
  const contrib = user.contribution_points ?? 0;
  const available = listShopNhan(user.cultivation_rank);
  const locked = listLockedShopNhan(user.cultivation_rank);
  const ownedSlugs = new Set(
    store.userNhan.query((u) => u.discord_id === userId).map((u) => u.nhan_slug),
  );
  const equippedSlugs = new Set(user.equipped_ring_slugs ?? []);

  const fmt = (it: (typeof available)[number], isLocked: boolean): string => {
    const rarity = NHAN_RARITY_EMOJI[it.rarity] ?? '⚪';
    const owned = ownedSlugs.has(it.slug);
    const equipped = equippedSlugs.has(it.slug);
    const affordable = pills >= it.cost_pills && contrib >= it.cost_contribution;
    const lockReq = it.min_rank_required ? ` _(${rankById(it.min_rank_required).name})_` : '';
    const prefix = equipped ? '⭐' : owned ? '✅' : isLocked ? '🔒' : affordable ? '🟢' : '⏳';
    return `${prefix} ${rarity} ${it.icon} **${it.name}** — +${it.stat_bonuses.combat_power} LC · ${it.cost_pills}💊 + ${it.cost_contribution}🪙${lockReq}`;
  };

  const lines = [
    `**Bạn có**: 💊 ${pills} · 🪙 ${contrib} · ${rankById(user.cultivation_rank).name}`,
    '',
    '**Có thể mua:**',
    available.length ? available.map((it) => fmt(it, false)).join('\n') : '_Catalog rỗng._',
    locked.length ? '\n**Bị khoá:**' : '',
    locked.map((it) => fmt(it, true)).join('\n'),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);

  return new EmbedBuilder()
    .setColor(0xd4a574)
    .setTitle('🏪 Shop — 💍 Nhẫn')
    .setDescription(lines)
    .setFooter({
      text: '⭐ đang đeo · ✅ sở hữu · 🟢 mua được · ⏳ chưa đủ tiền · 🔒 chưa đủ cảnh giới (slot 2 mở từ Nguyên Anh)',
    });
}

function buildNhanBuyOptions(userId: string): StringSelectMenuOptionBuilder[] {
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) return [];
  const pills = user.pills ?? 0;
  const contrib = user.contribution_points ?? 0;
  const owned = new Set(
    store.userNhan.query((u) => u.discord_id === userId).map((u) => u.nhan_slug),
  );
  const buyable = listShopNhan(user.cultivation_rank).filter(
    (it) => !owned.has(it.slug) && pills >= it.cost_pills && contrib >= it.cost_contribution,
  );
  return buyable.map((it) => {
    const desc = it.lore
      ? `${it.lore.slice(0, 95)}${it.lore.length > 95 ? '…' : ''}`
      : `+${it.stat_bonuses.combat_power} LC · ${it.cost_pills}💊+${it.cost_contribution}🪙`;
    return new StringSelectMenuOptionBuilder()
      .setLabel(`${it.name} (+${it.stat_bonuses.combat_power})`.slice(0, 100))
      .setValue(it.slug)
      .setDescription(desc.slice(0, 100))
      .setEmoji(it.icon || (NHAN_RARITY_EMOJI[it.rarity] ?? '💍'));
  });
}

// ============== Tab + components ===========================================

function buildTabRow(
  active: Tab,
  userId: string,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const tabs: Tab[] = ['cong_phap', 'weapon', 'phap_khi', 'nhan'];
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    ...tabs.map((t) =>
      new ButtonBuilder()
        .setCustomId(`shop:tab:${t}:${userId}`)
        .setEmoji(TAB_META[t].emoji)
        .setLabel(TAB_META[t].label)
        .setStyle(active === t ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(active === t),
    ),
  );
}

function buildEmbed(tab: Tab, userId: string): EmbedBuilder {
  switch (tab) {
    case 'cong_phap':
      return buildCongPhapEmbed(userId);
    case 'weapon':
      return buildWeaponEmbed(userId);
    case 'phap_khi':
      return buildPhapKhiEmbed(userId);
    case 'nhan':
      return buildNhanEmbed(userId);
  }
}

function buildBuyOptions(tab: Tab, userId: string): StringSelectMenuOptionBuilder[] {
  switch (tab) {
    case 'cong_phap':
      return buildCongPhapBuyOptions(userId);
    case 'weapon':
      return buildWeaponBuyOptions(userId);
    case 'phap_khi':
      return buildPhapKhiBuyOptions(userId);
    case 'nhan':
      return buildNhanBuyOptions(userId);
  }
}

/**
 * Build the full component stack for a tab: tab row + (if items) paginated
 * buy select + (if >25 items) nav row. pageState is mutated to clamp
 * out-of-bounds indices after a purchase shrinks the list.
 */
function buildComponents(
  tab: Tab,
  userId: string,
  pageState: Record<Tab, number>,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [buildTabRow(tab, userId)];
  const opts = buildBuyOptions(tab, userId);
  if (opts.length === 0) return rows;
  const { slice, pageIdx, totalPages } = pageOf(opts, pageState[tab]);
  pageState[tab] = pageIdx;
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`shop:buy:${tab}:${userId}`)
        .setPlaceholder(`Mua ${TAB_META[tab].label.toLowerCase()}`)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(slice),
    ),
  );
  const navRow = buildPageNavRow(`shop:page:${tab}:${userId}`, pageIdx, totalPages);
  if (navRow) rows.push(navRow);
  return rows;
}

async function buyForTab(
  tab: Tab,
  userId: string,
  slug: string,
): Promise<{ ok: boolean; newPills?: number; newContribution?: number; reason?: string }> {
  switch (tab) {
    case 'cong_phap':
      return await buyCongPhap(userId, slug);
    case 'weapon':
      return await buyWeapon(userId, slug);
    case 'phap_khi':
      return await buyPhapKhi(userId, slug);
    case 'nhan':
      return await buyNhan(userId, slug);
  }
}

export const data = new SlashCommandBuilder()
  .setName('shop')
  .setDescription('Cửa hàng — Công pháp · Vũ khí · Pháp khí · Nhẫn (4 tab + buy select-menu)')
  .setDMPermission(false);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  if (!getStore().users.get(userId)) {
    await interaction.reply({
      content: '🌫️ Bạn chưa có dữ liệu — message vài câu để có user record.',
      ephemeral: true,
    });
    return;
  }

  let activeTab: Tab = 'cong_phap';
  const pageState: Record<Tab, number> = {
    cong_phap: 0,
    weapon: 0,
    phap_khi: 0,
    nhan: 0,
  };

  const msg = (await interaction.reply({
    embeds: [buildEmbed(activeTab, userId)],
    components: buildComponents(activeTab, userId, pageState),
    ephemeral: true,
    fetchReply: true,
  })) as Message;

  const collector = msg.createMessageComponentCollector({
    filter: (i) => i.user.id === userId,
    idle: COLLECTOR_TIMEOUT_MS,
  });

  collector.on('collect', async (cmp) => {
    try {
      const parts = cmp.customId.split(':');

      // Tab switch — reset page index for the new tab.
      if (parts[1] === 'tab') {
        const next = parts[2] as Tab;
        if (!(next in TAB_META)) {
          await cmp.deferUpdate();
          return;
        }
        activeTab = next;
        pageState[next] = 0;
        await cmp.update({
          embeds: [buildEmbed(activeTab, userId)],
          components: buildComponents(activeTab, userId, pageState),
        });
        return;
      }

      // Page nav. customId = `shop:page:<tab>:<userId>:<dir>` → dir at parts[4],
      // not parts[3] (that's the userId). buildComponents clamps out-of-bounds.
      if (parts[1] === 'page') {
        const tab = parts[2] as Tab;
        const dir = parts[4];
        if (!(tab in TAB_META)) {
          await cmp.deferUpdate();
          return;
        }
        if (dir === 'next') pageState[tab] += 1;
        else if (dir === 'prev') pageState[tab] -= 1;
        await cmp.update({
          embeds: [buildEmbed(activeTab, userId)],
          components: buildComponents(activeTab, userId, pageState),
        });
        return;
      }

      if (parts[1] === 'buy' && cmp.isStringSelectMenu()) {
        const tab = parts[2] as Tab;
        const slug = cmp.values[0];
        if (!slug) {
          await cmp.deferUpdate();
          return;
        }
        const result = await buyForTab(tab, userId, slug);
        if (!result.ok) {
          await cmp.reply({
            content: `⚠️ Mua thất bại: \`${result.reason ?? 'unknown'}\``,
            ephemeral: true,
          });
          return;
        }
        const embed = buildEmbed(activeTab, userId);
        embed.setFooter({
          text: `✅ Mua \`${slug}\` thành công · Còn ${result.newPills}💊 + ${result.newContribution}🪙`,
        });
        await cmp.update({
          embeds: [embed],
          components: buildComponents(activeTab, userId, pageState),
        });
      }
    } catch (err) {
      logger.error({ err, userId, customId: cmp.customId }, 'shop: handler failed');
      try {
        if (!cmp.replied) await cmp.deferUpdate();
      } catch {
        /* ignore */
      }
    }
  });

  collector.on('end', async () => {
    try {
      const expiredRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('shop:expired')
          .setLabel('Phiên hết hạn — chạy /shop lại')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
      );
      await msg.edit({
        embeds: [
          buildEmbed(activeTab, userId).setFooter({
            text: '⏱️ Hết phiên — chạy /shop lại để tiếp.',
          }),
        ],
        components: [expiredRow],
      });
    } catch {
      /* ephemeral dismissed */
    }
  });
}

export const command = { data, execute };
export default command;
