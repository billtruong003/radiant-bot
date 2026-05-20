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
import { TIER_ICON, buyWeapon, listLockedShopWeapons, listShopWeapons } from '../modules/combat/weapon-shop.js';
import { logger } from '../utils/logger.js';

/**
 * /shop — Phase 14 unified shop with tab + buy select-menu.
 *
 * 📜 Công pháp — existing catalog filtered by rank
 * ⚔️ Vũ khí   — Phase 13 weapon catalog, shop != null (excludes bản mệnh)
 *
 * Each tab also surfaces a StringSelectMenu listing the top-25 affordable
 * items the user does NOT yet own — selecting an option triggers buyCongPhap
 * or buyWeapon directly. After purchase, embed re-renders and select-menu
 * re-filters. F5.4 simplification: select holds 25 items max (Discord cap);
 * users with rank exceeding 25 affordable items must use slash slug fallback
 * for less-popular items.
 */

const COLLECTOR_TIMEOUT_MS = 5 * 60 * 1000;

type Tab = 'cong_phap' | 'weapon';

function buildCongPhapEmbed(userId: string): EmbedBuilder {
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) {
    return new EmbedBuilder().setTitle('🏪 Shop').setDescription('🌫️ Chưa có user record.');
  }
  const pills = user.pills ?? 0;
  const contrib = user.contribution_points ?? 0;
  const userRank = user.cultivation_rank;

  const available = listShopAvailable(userRank);
  const all = store.congPhapCatalog
    .query(() => true)
    .sort((a, b) => a.cost_contribution - b.cost_contribution);
  const locked = all.filter((it) => !available.some((a) => a.slug === it.slug));
  const ownedSlugs = new Set(
    store.userCongPhap.query((uc) => uc.discord_id === userId).map((uc) => uc.cong_phap_slug),
  );

  // Phase 14.4 — 3-state ownership: locked / owned-not-equipped / equipped.
  const equippedCpSlugs = new Set(
    user.equipped_cong_phap_slugs && user.equipped_cong_phap_slugs.length > 0
      ? user.equipped_cong_phap_slugs
      : user.equipped_cong_phap_slug
        ? [user.equipped_cong_phap_slug]
        : [],
  );
  const fmtLine = (item: (typeof available)[number], isLocked: boolean): string => {
    const rarity = RARITY_EMOJI[item.rarity] ?? '⚪';
    const owned = ownedSlugs.has(item.slug);
    const equipped = equippedCpSlugs.has(item.slug);
    const affordable = pills >= item.cost_pills && contrib >= item.cost_contribution;
    const lockReq = item.min_rank_required
      ? ` _(yêu cầu ${rankById(item.min_rank_required).name})_`
      : '';
    const prefix = equipped ? '⭐' : owned ? '✅' : isLocked ? '🔒' : affordable ? '🟢' : '⏳';
    return `${prefix} ${rarity} **${item.name}** — +${item.stat_bonuses.combat_power} LC · ${item.cost_pills}💊 + ${item.cost_contribution}🪙${lockReq}`;
  };

  const availLines = available.map((it) => fmtLine(it, false));
  const lockedLines = locked.map((it) => fmtLine(it, true));
  const description = [
    `**Bạn có**: 💊 ${pills} đan dược · 🪙 ${contrib} cống hiến · Cảnh giới: ${rankById(userRank).name}`,
    '',
    '**Có thể mua:**',
    availLines.length ? availLines.join('\n') : '_Catalog rỗng._',
    lockedLines.length ? '\n**Bị khoá (chưa đủ cảnh giới):**' : '',
    lockedLines.join('\n'),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);

  return new EmbedBuilder()
    .setColor(0xf4d03f)
    .setTitle('🏪 Shop — 📜 Công pháp')
    .setDescription(description)
    .setFooter({
      text: '⭐ đang trang bị · ✅ sở hữu · 🟢 mua được · ⏳ chưa đủ tiền · 🔒 chưa đủ cảnh giới',
    });
}

function buildCongPhapBuyOptions(userId: string): StringSelectMenuOptionBuilder[] {
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) return [];
  const pills = user.pills ?? 0;
  const contrib = user.contribution_points ?? 0;
  const available = listShopAvailable(user.cultivation_rank);
  const ownedSlugs = new Set(
    store.userCongPhap.query((uc) => uc.discord_id === userId).map((uc) => uc.cong_phap_slug),
  );
  const buyable = available
    .filter((it) => !ownedSlugs.has(it.slug))
    .filter((it) => pills >= it.cost_pills && contrib >= it.cost_contribution)
    .slice(0, 25);

  return buyable.map((it) => {
    // Phase 14.4 — surface lore preview in select-menu description (Discord
    // caps 100 chars). Falls back to stat line if no lore.
    const loreOrStats = it.lore
      ? `${it.lore.slice(0, 95)}${it.lore.length > 95 ? '…' : ''}`
      : `+${it.stat_bonuses.combat_power} LC · ${it.cost_pills}💊 + ${it.cost_contribution}🪙`;
    return new StringSelectMenuOptionBuilder()
      .setLabel(
        `${it.name} (+${it.stat_bonuses.combat_power} · ${it.cost_pills}💊+${it.cost_contribution}🪙)`.slice(0, 100),
      )
      .setValue(it.slug)
      .setDescription(loreOrStats.slice(0, 100))
      .setEmoji(RARITY_EMOJI[it.rarity] ?? '⚪');
  });
}

function buildWeaponEmbed(userId: string): EmbedBuilder {
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) {
    return new EmbedBuilder().setTitle('🏪 Shop').setDescription('🌫️ Chưa có user record.');
  }
  const pills = user.pills ?? 0;
  const contrib = user.contribution_points ?? 0;
  const userRank = user.cultivation_rank;

  const available = listShopWeapons(userRank);
  const locked = listLockedShopWeapons(userRank);
  const ownedSlugs = new Set(
    store.userWeapons.query((w) => w.discord_id === userId).map((w) => w.weapon_slug),
  );

  const equippedWeaponSlug = user.equipped_weapon_slug ?? null;
  const fmtLine = (w: (typeof available)[number], isLocked: boolean): string => {
    const tierIcon = TIER_ICON[w.tier] ?? '⚔️';
    const owned = ownedSlugs.has(w.slug);
    const equipped = equippedWeaponSlug === w.slug;
    const costPills = w.shop?.cost_pills ?? 0;
    const costContrib = w.shop?.cost_contribution ?? 0;
    const affordable = pills >= costPills && contrib >= costContrib;
    const lockReq = w.shop?.unlock_realm
      ? ` _(yêu cầu ${rankById(w.shop.unlock_realm).name})_`
      : '';
    const prefix = equipped ? '⭐' : owned ? '✅' : isLocked ? '🔒' : affordable ? '🟢' : '⏳';
    return `${prefix} ${tierIcon} **${w.display_name}** — dmg ${w.stats.damage_base} · ${costPills}💊 + ${costContrib}🪙${lockReq}`;
  };

  const availLines = available.map((w) => fmtLine(w, false));
  const lockedLines = locked.map((w) => fmtLine(w, true));
  const description = [
    `**Bạn có**: 💊 ${pills} đan dược · 🪙 ${contrib} cống hiến · Cảnh giới: ${rankById(userRank).name}`,
    '',
    '**Có thể mua:**',
    availLines.length ? availLines.join('\n') : '_Catalog rỗng._',
    lockedLines.length ? '\n**Bị khoá (chưa đủ cảnh giới):**' : '',
    lockedLines.join('\n'),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);

  return new EmbedBuilder()
    .setColor(0xd4af37)
    .setTitle('🏪 Shop — ⚔️ Vũ khí')
    .setDescription(description)
    .setFooter({
      text: '⭐ đang trang bị · ✅ sở hữu · 🟢 mua được · ⏳ chưa đủ tiền · 🔒 chưa đủ cảnh giới',
    });
}

function buildWeaponBuyOptions(userId: string): StringSelectMenuOptionBuilder[] {
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) return [];
  const pills = user.pills ?? 0;
  const contrib = user.contribution_points ?? 0;
  const available = listShopWeapons(user.cultivation_rank);
  const ownedSlugs = new Set(
    store.userWeapons.query((w) => w.discord_id === userId).map((w) => w.weapon_slug),
  );
  const buyable = available
    .filter((w) => !ownedSlugs.has(w.slug))
    .filter(
      (w) => pills >= (w.shop?.cost_pills ?? 0) && contrib >= (w.shop?.cost_contribution ?? 0),
    )
    .slice(0, 25);

  return buyable.map((w) => {
    const loreOrStats = w.lore
      ? `${w.lore.slice(0, 95)}${w.lore.length > 95 ? '…' : ''}`
      : `dmg ${w.stats.damage_base} · ${w.shop?.cost_pills ?? 0}💊 + ${w.shop?.cost_contribution ?? 0}🪙`;
    return new StringSelectMenuOptionBuilder()
      .setLabel(
        `${w.display_name} (dmg ${w.stats.damage_base} · ${w.shop?.cost_pills ?? 0}💊)`.slice(0, 100),
      )
      .setValue(w.slug)
      .setDescription(loreOrStats.slice(0, 100))
      .setEmoji(TIER_ICON[w.tier] ?? '⚔️');
  });
}

function buildTabRow(active: Tab, userId: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`shop:tab:cong_phap:${userId}`)
      .setEmoji('📜')
      .setLabel('Công pháp')
      .setStyle(active === 'cong_phap' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(active === 'cong_phap'),
    new ButtonBuilder()
      .setCustomId(`shop:tab:weapon:${userId}`)
      .setEmoji('⚔️')
      .setLabel('Vũ khí')
      .setStyle(active === 'weapon' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(active === 'weapon'),
  );
}

function buildBuyRow(
  tab: Tab,
  userId: string,
  options: StringSelectMenuOptionBuilder[],
): ActionRowBuilder<MessageActionRowComponentBuilder> | null {
  if (options.length === 0) return null;
  const select = new StringSelectMenuBuilder()
    .setCustomId(`shop:buy:${tab}:${userId}`)
    .setPlaceholder(tab === 'cong_phap' ? 'Mua công pháp' : 'Mua vũ khí')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select);
}

function buildComponents(
  tab: Tab,
  userId: string,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [buildTabRow(tab, userId)];
  const opts = tab === 'cong_phap' ? buildCongPhapBuyOptions(userId) : buildWeaponBuyOptions(userId);
  const buyRow = buildBuyRow(tab, userId, opts);
  if (buyRow) rows.push(buyRow);
  return rows;
}

export const data = new SlashCommandBuilder()
  .setName('shop')
  .setDescription('Cửa hàng — công pháp + vũ khí với button mua trực tiếp')
  .setDMPermission(false);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const store = getStore();
  if (!store.users.get(userId)) {
    await interaction.reply({
      content: '🌫️ Bạn chưa có dữ liệu — message vài câu để có user record.',
      ephemeral: true,
    });
    return;
  }

  let activeTab: Tab = 'cong_phap';
  const msg = (await interaction.reply({
    embeds: [buildCongPhapEmbed(userId)],
    components: buildComponents(activeTab, userId),
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

      // Tab switch
      if (parts[1] === 'tab' && (parts[2] === 'cong_phap' || parts[2] === 'weapon')) {
        activeTab = parts[2];
        const embed = activeTab === 'cong_phap' ? buildCongPhapEmbed(userId) : buildWeaponEmbed(userId);
        await cmp.update({ embeds: [embed], components: buildComponents(activeTab, userId) });
        return;
      }

      // Buy via select-menu
      if (parts[1] === 'buy' && cmp.isStringSelectMenu()) {
        const kind = parts[2] as Tab;
        const slug = cmp.values[0];
        if (!slug) {
          await cmp.deferUpdate();
          return;
        }
        const result = kind === 'cong_phap' ? await buyCongPhap(userId, slug) : await buyWeapon(userId, slug);
        if (!result.ok) {
          await cmp.reply({
            content: `⚠️ Mua thất bại: \`${result.reason ?? 'unknown'}\``,
            ephemeral: true,
          });
          return;
        }
        // Re-render the active tab + send confirm via the update.
        const embed = activeTab === 'cong_phap' ? buildCongPhapEmbed(userId) : buildWeaponEmbed(userId);
        await cmp.update({
          embeds: [
            embed.setFooter({
              text: `✅ Mua thành công \`${slug}\` · Còn lại ${result.newPills}💊 + ${result.newContribution}🪙`,
            }),
          ],
          components: buildComponents(activeTab, userId),
        });
      }
    } catch (err) {
      logger.error({ err, userId, customId: cmp.customId }, 'shop: handler failed');
      try {
        if (!cmp.replied) await cmp.deferUpdate();
      } catch {
        // ignore
      }
    }
  });

  collector.on('end', async () => {
    try {
      const expiredRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('shop:expired')
          .setLabel('Phiên hết hạn')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
      );
      const embed = activeTab === 'cong_phap' ? buildCongPhapEmbed(userId) : buildWeaponEmbed(userId);
      await msg.edit({
        embeds: [embed.setFooter({ text: '⏱️ Hết phiên — chạy /shop lại để tiếp.' })],
        components: [expiredRow],
      });
    } catch {
      // ephemeral dismissed — ignore
    }
  });
}

export const command = { data, execute };
export default command;
