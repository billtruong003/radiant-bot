import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  type Message,
  type MessageActionRowComponentBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { rankIndex } from '../config/cultivation.js';
import { BAN_MENH_SLUG_PREFIX } from '../modules/arena/forge.js';
import { getBanMenhDisplay } from '../modules/combat/ban-menh-templates.js';
import { RARITY_EMOJI, listOwnedCongPhap } from '../modules/combat/cong-phap.js';
import { readEquippedRingSlugs } from '../modules/combat/equipment-resolver.js';
import { NHAN_RARITY_EMOJI } from '../modules/combat/nhan-shop.js';
import { PHAP_KHI_RARITY_EMOJI } from '../modules/combat/phap-khi-shop.js';
import { TIER_ICON } from '../modules/combat/weapon-shop.js';
import { getStore } from '../db/index.js';
import { logger } from '../utils/logger.js';

/**
 * /inventory — Phase 14 redesign: three tabs via button row + equip
 * select-menu inside each item tab.
 *
 *   💰 Tổng       — currency, stat points, equipped summary
 *   📜 Công pháp  — owned + select-menu to equip
 *   ⚔️ Vũ khí     — owned + select-menu to equip
 *
 * Bill 2026-05-20: "khi search inventory sẽ list ra có button các kiểu
 * dễ dùng". StringSelectMenu chosen over per-item button rows because
 * Discord caps 5 components/row, and users can own >5 items in either
 * tier. The select-menu accepts up to 25 options/page (Discord max).
 */

const COLLECTOR_TIMEOUT_MS = 5 * 60 * 1000;

type Tab = 'overview' | 'cong_phap' | 'weapon' | 'phap_khi' | 'nhan';
type EquipKind = 'cong_phap' | 'weapon' | 'phap_khi' | 'nhan';

function buildOverviewEmbed(userId: string, displayName: string): EmbedBuilder {
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) {
    return new EmbedBuilder().setTitle('🎒 Túi đồ').setDescription('🌫️ Chưa có user record.');
  }
  const pills = user.pills ?? 0;
  const contrib = user.contribution_points ?? 0;
  const unspentPts = user.stat_points_unspent ?? 0;
  const alloc = user.stat_alloc ?? { dmg: 0, hp: 0, def: 0, spd: 0 };

  // Phase 14.6 — equipped công pháp slots (up to 5, multi-equip).
  const cpSlugs =
    user.equipped_cong_phap_slugs && user.equipped_cong_phap_slugs.length > 0
      ? user.equipped_cong_phap_slugs
      : user.equipped_cong_phap_slug
        ? [user.equipped_cong_phap_slug]
        : [];
  const cpLines = cpSlugs
    .map((slug) => {
      const item = store.congPhapCatalog.get(slug);
      if (!item) return null;
      const lv = store.userCongPhap.query(
        (uc) => uc.discord_id === userId && uc.cong_phap_slug === slug,
      )[0]?.level ?? 0;
      return `${item.icon ?? '📜'} **${item.name}**${lv > 0 ? ` **+${lv}**` : ''}`;
    })
    .filter((s): s is string => s !== null);

  // Equipped weapon
  const wSlug = user.equipped_weapon_slug ?? null;
  let wName: string | null = null;
  let wLevel = 0;
  if (wSlug) {
    const catalog = store.weaponCatalog.get(wSlug);
    if (catalog) {
      wName = catalog.display_name;
      wLevel =
        store.userWeapons.query((w) => w.discord_id === userId && w.weapon_slug === wSlug)[0]
          ?.level ?? 0;
    } else if (wSlug.startsWith(BAN_MENH_SLUG_PREFIX)) {
      // Phase 14.7 — themed template name from hash(discord_id) mod 6.
      wName = getBanMenhDisplay(userId).name;
      wLevel =
        store.userWeapons.query((w) => w.discord_id === userId && w.weapon_slug === wSlug)[0]
          ?.level ?? 0;
    }
  }

  return new EmbedBuilder()
    .setColor(0xf4d03f)
    .setTitle(`🎒 Túi đồ — ${displayName}`)
    .addFields(
      { name: '💊 Đan dược', value: `**${pills}**`, inline: true },
      { name: '🪙 Cống hiến', value: `**${contrib}**`, inline: true },
      { name: '🪙 Điểm chỉ số chưa phân', value: `**${unspentPts}**`, inline: true },
      {
        name: '📊 Chỉ số phân bố',
        value: `⚔️ ${alloc.dmg} · ❤️ ${alloc.hp} · 🛡️ ${alloc.def} · ⚡ ${alloc.spd}`,
        inline: false,
      },
      {
        name: `📜 Công pháp (${cpLines.length}/5)`,
        value: cpLines.length > 0 ? cpLines.join('\n') : '_(chưa trang bị)_',
        inline: false,
      },
      {
        name: '⚔️ Vũ khí trang bị',
        value: wName ? `**${wName}**${wLevel > 0 ? ` **+${wLevel}**` : ''}` : '_(chưa trang bị)_',
        inline: true,
      },
    )
    .setFooter({ text: 'Chuyển tab bằng button bên dưới · /stat-alloc để phân điểm' });
}

function buildCongPhapEmbed(userId: string): {
  embed: EmbedBuilder;
  options: StringSelectMenuOptionBuilder[];
} {
  const owned = listOwnedCongPhap(userId);
  const store = getStore();
  const user = store.users.get(userId);
  // Phase 14.6 — multi-equip, uncapped. Read from array; fall back to
  // legacy single-slot field for users predating Phase 14.3.
  const equippedSet = new Set(
    user?.equipped_cong_phap_slugs && user.equipped_cong_phap_slugs.length > 0
      ? user.equipped_cong_phap_slugs
      : user?.equipped_cong_phap_slug
        ? [user.equipped_cong_phap_slug]
        : [],
  );

  if (owned.length === 0) {
    return {
      embed: new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle('📜 Công pháp')
        .setDescription('_Chưa sở hữu công pháp — `/shop` để xem cửa hàng._'),
      options: [],
    };
  }

  // Phase 14.6 — Bill fix: tab CP không render được vì setDefault(true) trên
  // nhiều option với maxValues=1 → Discord reject. Drop setDefault entirely;
  // ⭐ trong embed text + "(đang đeo)" trong option description đã đủ rõ.
  const lines = owned.map(({ item, ownership }) => {
    const star = equippedSet.has(item.slug) ? '⭐' : '  ';
    const lv = (ownership.level ?? 0) > 0 ? ` **+${ownership.level}**` : '';
    return `${star} ${RARITY_EMOJI[item.rarity] ?? '⚪'} **${item.name}**${lv} (+${item.stat_bonuses.combat_power} LC)`;
  });

  const options = owned.slice(0, 25).map(({ item, ownership }) => {
    const lvSuffix = (ownership.level ?? 0) > 0 ? ` (+${ownership.level})` : '';
    const equipped = equippedSet.has(item.slug);
    return new StringSelectMenuOptionBuilder()
      .setLabel(`${equipped ? '⭐ ' : ''}${item.name}${lvSuffix}`.slice(0, 100))
      .setValue(item.slug)
      .setDescription(
        equipped
          ? `Đang đeo — chọn để GỠ · +${item.stat_bonuses.combat_power} LC`.slice(0, 100)
          : `Chưa đeo — chọn để ĐEO · +${item.stat_bonuses.combat_power} LC`.slice(0, 100),
      )
      .setEmoji(RARITY_EMOJI[item.rarity] ?? '⚪');
  });

  const slotsLeft = 5 - equippedSet.size;
  const guideLine =
    slotsLeft > 0
      ? `🎯 **Còn ${slotsLeft} slot trống**. Chọn 1 công pháp từ menu để đeo. Có thể chọn lại để gỡ.`
      : `⛔ **5/5 slot đầy**. Chọn 1 công pháp đang ⭐ để gỡ, hoặc gỡ rồi mới đeo món khác.`;

  return {
    embed: new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle(`📜 Công pháp — ${equippedSet.size}/5 slot đang đeo`)
      .setDescription([guideLine, '', ...lines].join('\n'))
      .setFooter({
        text: 'Multi-slot · Max 5 · Chọn từ menu = toggle equip/unequip · Sở hữu ' + owned.length,
      }),
    options,
  };
}

function buildWeaponEmbed(userId: string): {
  embed: EmbedBuilder;
  options: StringSelectMenuOptionBuilder[];
} {
  const store = getStore();
  const user = store.users.get(userId);
  const equippedSlug = user?.equipped_weapon_slug ?? null;
  const owned = store.userWeapons.query((w) => w.discord_id === userId);

  if (owned.length === 0) {
    return {
      embed: new EmbedBuilder()
        .setColor(0xd4af37)
        .setTitle('⚔️ Vũ khí')
        .setDescription('_Chưa có vũ khí — forge bản mệnh qua `/arena` hoặc mua từ `/shop`._'),
      options: [],
    };
  }

  const resolved = owned.map((w) => {
    const catalog = store.weaponCatalog.get(w.weapon_slug);
    if (catalog) {
      return {
        slug: w.weapon_slug,
        name: catalog.display_name,
        tier: catalog.tier,
        dmg: catalog.stats.damage_base,
        level: w.level ?? 0,
      };
    }
    if (w.weapon_slug.startsWith(BAN_MENH_SLUG_PREFIX) && w.custom_stats) {
      return {
        slug: w.weapon_slug,
        name: getBanMenhDisplay(userId).name,
        tier: 'ban_menh',
        dmg: w.custom_stats.damage_base,
        level: w.level ?? 0,
      };
    }
    return null;
  });
  const valid = resolved.filter((r): r is NonNullable<typeof r> => r !== null);

  const lines = valid.map((r) => {
    const star = r.slug === equippedSlug ? '⭐' : '  ';
    const lv = r.level > 0 ? ` **+${r.level}**` : '';
    return `${star} ${TIER_ICON[r.tier] ?? '⚔️'} **${r.name}**${lv} _(dmg ${r.dmg})_`;
  });

  const options = valid.slice(0, 25).map((r) => {
    const lvSuffix = r.level > 0 ? ` (+${r.level})` : '';
    return new StringSelectMenuOptionBuilder()
      .setLabel(`${r.name}${lvSuffix}`.slice(0, 100))
      .setValue(r.slug)
      .setDescription(`tier ${r.tier} · dmg ${r.dmg}`.slice(0, 100))
      .setEmoji(TIER_ICON[r.tier] ?? '⚔️')
      .setDefault(r.slug === equippedSlug);
  });

  return {
    embed: new EmbedBuilder()
      .setColor(0xd4af37)
      .setTitle('⚔️ Vũ khí')
      .setDescription(lines.join('\n'))
      .setFooter({ text: `${valid.length} vũ khí · ⭐ = đang trang bị · select-menu để equip` }),
    options,
  };
}

function buildPhapKhiEmbed(userId: string): {
  embed: EmbedBuilder;
  options: StringSelectMenuOptionBuilder[];
} {
  const store = getStore();
  const user = store.users.get(userId);
  const equippedSlug = user?.equipped_phap_khi_slug ?? null;
  const owned = store.userPhapKhi.query((u) => u.discord_id === userId);

  if (owned.length === 0) {
    return {
      embed: new EmbedBuilder()
        .setColor(0xb09bd3)
        .setTitle('✨ Pháp khí')
        .setDescription('_Chưa có pháp khí — `/shop` tab Pháp khí (yêu cầu Kim Đan)._'),
      options: [],
    };
  }

  const resolved = owned.map((up) => {
    const item = store.phapKhiCatalog.get(up.phap_khi_slug);
    return item ? { slug: up.phap_khi_slug, item, level: up.level ?? 0 } : null;
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  const lines = resolved.map((r) => {
    const star = r.slug === equippedSlug ? '⭐' : '  ';
    const lv = r.level > 0 ? ` **+${r.level}**` : '';
    return `${star} ${PHAP_KHI_RARITY_EMOJI[r.item.rarity] ?? '✨'} ${r.item.icon} **${r.item.name}**${lv} _(+${r.item.stat_bonuses.combat_power} LC)_`;
  });

  const options = resolved.slice(0, 25).map((r) => {
    const lvSuffix = r.level > 0 ? ` (+${r.level})` : '';
    return new StringSelectMenuOptionBuilder()
      .setLabel(`${r.item.name}${lvSuffix}`.slice(0, 100))
      .setValue(r.slug)
      .setDescription(`+${r.item.stat_bonuses.combat_power} LC · ${r.item.rarity}`.slice(0, 100))
      .setEmoji(r.item.icon || (PHAP_KHI_RARITY_EMOJI[r.item.rarity] ?? '✨'))
      .setDefault(r.slug === equippedSlug);
  });

  return {
    embed: new EmbedBuilder()
      .setColor(0xb09bd3)
      .setTitle('✨ Pháp khí')
      .setDescription(lines.join('\n'))
      .setFooter({ text: `${resolved.length} pháp khí · ⭐ đeo · slot mở từ Kim Đan` }),
    options,
  };
}

function buildNhanEmbed(userId: string): {
  embed: EmbedBuilder;
  options: StringSelectMenuOptionBuilder[];
} {
  const store = getStore();
  const user = store.users.get(userId);
  const equippedSlugs = user ? readEquippedRingSlugs(user) : [];
  const equippedSet = new Set(equippedSlugs);
  const owned = store.userNhan.query((u) => u.discord_id === userId);

  if (owned.length === 0) {
    return {
      embed: new EmbedBuilder()
        .setColor(0xd4a574)
        .setTitle('💍 Nhẫn')
        .setDescription('_Chưa có nhẫn — `/shop` tab Nhẫn._'),
      options: [],
    };
  }

  const resolved = owned.map((un) => {
    const item = store.nhanCatalog.get(un.nhan_slug);
    return item ? { slug: un.nhan_slug, item } : null;
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  const lines = resolved.map((r) => {
    const slotIdx = equippedSlugs.indexOf(r.slug);
    const star = slotIdx >= 0 ? `⭐${slotIdx + 1}` : '  ';
    return `${star} ${NHAN_RARITY_EMOJI[r.item.rarity] ?? '💍'} ${r.item.icon} **${r.item.name}** _(+${r.item.stat_bonuses.combat_power} LC)_`;
  });

  // Phase 14.6 — same Discord constraint as CP: maxValues=1 conflicts with
  // multiple defaults. Drop setDefault; rely on ⭐N marker in embed + the
  // option description to communicate state.
  const options = resolved.slice(0, 25).map((r) => {
    const equipped = equippedSet.has(r.slug);
    return new StringSelectMenuOptionBuilder()
      .setLabel(`${equipped ? '⭐ ' : ''}${r.item.name}`.slice(0, 100))
      .setValue(r.slug)
      .setDescription(
        equipped
          ? `Đang đeo — chọn để GỠ · +${r.item.stat_bonuses.combat_power} LC`.slice(0, 100)
          : `Chưa đeo — chọn để ĐEO · +${r.item.stat_bonuses.combat_power} LC`.slice(0, 100),
      )
      .setEmoji(r.item.icon || (NHAN_RARITY_EMOJI[r.item.rarity] ?? '💍'));
  });

  const user2 = getStore().users.get(userId);
  const maxNhan = user2
    ? (rankIndex(user2.cultivation_rank) >= rankIndex('nguyen_anh') ? 2 : 1)
    : 1;
  const slotsLeft = maxNhan - equippedSlugs.length;
  const guideLine =
    slotsLeft > 0
      ? `🎯 **Còn ${slotsLeft} slot nhẫn trống** (max ${maxNhan}). Chọn nhẫn để đeo.`
      : `⛔ **${maxNhan}/${maxNhan} slot đầy**. Chọn ⭐ để gỡ trước khi đeo nhẫn khác.`;

  return {
    embed: new EmbedBuilder()
      .setColor(0xd4a574)
      .setTitle(`💍 Nhẫn — ${equippedSlugs.length}/${maxNhan} đang đeo`)
      .setDescription([guideLine, '', ...lines].join('\n'))
      .setFooter({ text: `Sở hữu ${resolved.length} · ⭐N = slot N · slot 2 mở từ Nguyên Anh` }),
    options,
  };
}

const TAB_META: Record<Tab, { emoji: string; label: string }> = {
  overview: { emoji: '💰', label: 'Tổng' },
  cong_phap: { emoji: '📜', label: 'Công pháp' },
  weapon: { emoji: '⚔️', label: 'Vũ khí' },
  phap_khi: { emoji: '✨', label: 'Pháp khí' },
  nhan: { emoji: '💍', label: 'Nhẫn' },
};

function buildTabRow(active: Tab, userId: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
  // 5 tabs exactly fits Discord's 5-buttons-per-row limit.
  const tabs: Tab[] = ['overview', 'cong_phap', 'weapon', 'phap_khi', 'nhan'];
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    ...tabs.map((t) =>
      new ButtonBuilder()
        .setCustomId(`inv:tab:${t}:${userId}`)
        .setEmoji(TAB_META[t].emoji)
        .setLabel(TAB_META[t].label)
        .setStyle(active === t ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(active === t),
    ),
  );
}

const SELECT_PLACEHOLDER: Record<EquipKind, string> = {
  cong_phap: 'Chọn công pháp — toggle equip/unequip (không giới hạn slot)',
  weapon: 'Chọn vũ khí để trang bị',
  phap_khi: 'Chọn pháp khí để trang bị',
  nhan: 'Chọn nhẫn — toggle equip/unequip',
};

function buildSelectRow(
  kind: EquipKind,
  userId: string,
  options: StringSelectMenuOptionBuilder[],
): ActionRowBuilder<MessageActionRowComponentBuilder> | null {
  if (options.length === 0) return null;
  const select = new StringSelectMenuBuilder()
    .setCustomId(`inv:equip:${kind}:${userId}`)
    .setPlaceholder(SELECT_PLACEHOLDER[kind])
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select);
}

export const data = new SlashCommandBuilder()
  .setName('inventory')
  .setDescription('Túi đồ — currency, công pháp, vũ khí (tab + select-menu equip)')
  .setDMPermission(false);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) {
    await interaction.reply({
      content: '🌫️ Chưa có dữ liệu — message vài câu để có user record.',
      ephemeral: true,
    });
    return;
  }

  const member = await interaction.guild?.members.fetch(userId).catch(() => null);
  const displayName = member?.displayName ?? interaction.user.username;

  let activeTab: Tab = 'overview';
  const initialComponents: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [
    buildTabRow(activeTab, userId),
  ];

  const msg = (await interaction.reply({
    embeds: [buildOverviewEmbed(userId, displayName)],
    components: initialComponents,
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
      if (parts[1] === 'tab' && cmp.componentType === ComponentType.Button) {
        const next = parts[2] as Tab;
        if (!(next in TAB_META)) {
          await cmp.deferUpdate();
          return;
        }
        activeTab = next;
        if (next === 'overview') {
          await cmp.update({
            embeds: [buildOverviewEmbed(userId, displayName)],
            components: [buildTabRow(activeTab, userId)],
          });
          return;
        }
        const built =
          next === 'cong_phap'
            ? buildCongPhapEmbed(userId)
            : next === 'weapon'
              ? buildWeaponEmbed(userId)
              : next === 'phap_khi'
                ? buildPhapKhiEmbed(userId)
                : buildNhanEmbed(userId);
        const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [
          buildTabRow(activeTab, userId),
        ];
        const selectRow = buildSelectRow(next, userId, built.options);
        if (selectRow) rows.push(selectRow);
        await cmp.update({ embeds: [built.embed], components: rows });
        return;
      }

      // Equip select-menu
      if (parts[1] === 'equip' && cmp.componentType === ComponentType.StringSelect) {
        const kind = parts[2] as EquipKind;
        const slug = cmp.values[0];
        if (!slug) {
          await cmp.deferUpdate();
          return;
        }
        const fresh = store.users.get(userId);
        if (!fresh) {
          await cmp.deferUpdate();
          return;
        }
        // Phase 14.5 — dispatch by kind:
        //   cong_phap: TOGGLE (Phase 14.6 — uncapped). Click equipped slug
        //     unequips; otherwise appends to the equipped list.
        //   weapon/phap_khi: single slot, direct user.set
        //   nhan: TOGGLE — clicking equipped slug unequips; else add to first free slot
        if (kind === 'cong_phap') {
          const current =
            fresh.equipped_cong_phap_slugs && fresh.equipped_cong_phap_slugs.length > 0
              ? [...fresh.equipped_cong_phap_slugs]
              : fresh.equipped_cong_phap_slug
                ? [fresh.equipped_cong_phap_slug]
                : [];
          let nextSlugs: string[];
          if (current.includes(slug)) {
            nextSlugs = current.filter((s) => s !== slug);
          } else {
            nextSlugs = [...current, slug];
          }
          await store.users.set({
            ...fresh,
            equipped_cong_phap_slugs: nextSlugs,
            equipped_cong_phap_slug: nextSlugs[0] ?? null,
          });
        } else if (kind === 'weapon') {
          await store.users.set({ ...fresh, equipped_weapon_slug: slug });
        } else if (kind === 'phap_khi') {
          await store.users.set({ ...fresh, equipped_phap_khi_slug: slug });
        } else if (kind === 'nhan') {
          const { maxNhanSlots } = await import('../modules/combat/equipment-resolver.js');
          const maxSlots = maxNhanSlots(fresh.cultivation_rank);
          const current = readEquippedRingSlugs(fresh);
          let next: string[];
          if (current.includes(slug)) {
            // Toggle off
            next = current.filter((s) => s !== slug);
          } else if (current.length < maxSlots) {
            // Append
            next = [...current, slug];
          } else {
            // Full — replace slot 0 (oldest)
            next = [slug, ...current.slice(1)];
          }
          await store.users.set({ ...fresh, equipped_ring_slugs: next });
        }
        // Phase 14 quest — equip_both fires when both slots filled.
        {
          const { checkEquipBothQuest } = await import('../modules/quests/daily-quest.js');
          void checkEquipBothQuest(userId);
        }
        const built =
          kind === 'cong_phap'
            ? buildCongPhapEmbed(userId)
            : kind === 'weapon'
              ? buildWeaponEmbed(userId)
              : kind === 'phap_khi'
                ? buildPhapKhiEmbed(userId)
                : buildNhanEmbed(userId);
        const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [
          buildTabRow(activeTab, userId),
        ];
        const selectRow = buildSelectRow(kind, userId, built.options);
        if (selectRow) rows.push(selectRow);
        await cmp.update({ embeds: [built.embed], components: rows });
      }
    } catch (err) {
      logger.error({ err, userId, customId: cmp.customId }, 'inventory: handler failed');
      try {
        if (!cmp.replied) await cmp.deferUpdate();
      } catch {
        // ignore
      }
    }
  });

  collector.on('end', async () => {
    try {
      const disabledTab = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('inv:expired')
          .setLabel('Phiên hết hạn')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
      );
      await msg.edit({
        embeds: [
          buildOverviewEmbed(userId, displayName).setFooter({
            text: '⏱️ Hết phiên — chạy /inventory lại để tiếp.',
          }),
        ],
        components: [disabledTab],
      });
    } catch {
      // ephemeral dismissed — ignore
    }
  });
}

export const command = { data, execute };
export default command;
