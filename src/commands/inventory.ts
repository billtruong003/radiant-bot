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
import { BAN_MENH_SLUG_PREFIX } from '../modules/arena/forge.js';
import { RARITY_EMOJI, listOwnedCongPhap } from '../modules/combat/cong-phap.js';
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

type Tab = 'overview' | 'cong_phap' | 'weapon';

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

  // Equipped công pháp
  const cpSlug = user.equipped_cong_phap_slug ?? null;
  const cp = cpSlug ? store.congPhapCatalog.get(cpSlug) : null;
  const cpLevel = cpSlug
    ? (store.userCongPhap.query(
        (uc) => uc.discord_id === userId && uc.cong_phap_slug === cpSlug,
      )[0]?.level ?? 0)
    : 0;

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
      wName = 'Bản Mệnh Khí';
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
        name: '📜 Công pháp trang bị',
        value: cp ? `**${cp.name}**${cpLevel > 0 ? ` **+${cpLevel}**` : ''}` : '_(chưa trang bị)_',
        inline: true,
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
  const equippedSlug = user?.equipped_cong_phap_slug ?? null;

  if (owned.length === 0) {
    return {
      embed: new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle('📜 Công pháp')
        .setDescription('_Chưa sở hữu công pháp — `/shop` để xem cửa hàng._'),
      options: [],
    };
  }

  const lines = owned.map(({ item, ownership }) => {
    const star = item.slug === equippedSlug ? '⭐' : '  ';
    const lv = (ownership.level ?? 0) > 0 ? ` **+${ownership.level}**` : '';
    return `${star} ${RARITY_EMOJI[item.rarity] ?? '⚪'} **${item.name}**${lv} \`${item.slug}\` (+${item.stat_bonuses.combat_power} LC)`;
  });

  const options = owned.slice(0, 25).map(({ item, ownership }) => {
    const lvSuffix = (ownership.level ?? 0) > 0 ? ` (+${ownership.level})` : '';
    return new StringSelectMenuOptionBuilder()
      .setLabel(`${item.name}${lvSuffix}`.slice(0, 100))
      .setValue(item.slug)
      .setDescription(`+${item.stat_bonuses.combat_power} LC · ${item.rarity}`.slice(0, 100))
      .setEmoji(RARITY_EMOJI[item.rarity] ?? '⚪')
      .setDefault(item.slug === equippedSlug);
  });

  return {
    embed: new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle('📜 Công pháp')
      .setDescription(lines.join('\n'))
      .setFooter({ text: `${owned.length} công pháp · ⭐ = đang trang bị · select-menu để equip` }),
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
        name: 'Bản Mệnh Khí',
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

function buildTabRow(active: Tab, userId: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`inv:tab:overview:${userId}`)
      .setEmoji('💰')
      .setLabel('Tổng')
      .setStyle(active === 'overview' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(active === 'overview'),
    new ButtonBuilder()
      .setCustomId(`inv:tab:cong_phap:${userId}`)
      .setEmoji('📜')
      .setLabel('Công pháp')
      .setStyle(active === 'cong_phap' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(active === 'cong_phap'),
    new ButtonBuilder()
      .setCustomId(`inv:tab:weapon:${userId}`)
      .setEmoji('⚔️')
      .setLabel('Vũ khí')
      .setStyle(active === 'weapon' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(active === 'weapon'),
  );
}

function buildSelectRow(
  kind: 'cong_phap' | 'weapon',
  userId: string,
  options: StringSelectMenuOptionBuilder[],
): ActionRowBuilder<MessageActionRowComponentBuilder> | null {
  if (options.length === 0) return null;
  const select = new StringSelectMenuBuilder()
    .setCustomId(`inv:equip:${kind}:${userId}`)
    .setPlaceholder(kind === 'cong_phap' ? 'Chọn công pháp để trang bị' : 'Chọn vũ khí để trang bị')
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
        if (next !== 'overview' && next !== 'cong_phap' && next !== 'weapon') {
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
        const { embed, options } = next === 'cong_phap'
          ? buildCongPhapEmbed(userId)
          : buildWeaponEmbed(userId);
        const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [
          buildTabRow(activeTab, userId),
        ];
        const selectRow = buildSelectRow(next, userId, options);
        if (selectRow) rows.push(selectRow);
        await cmp.update({ embeds: [embed], components: rows });
        return;
      }

      // Equip select-menu
      if (parts[1] === 'equip' && cmp.componentType === ComponentType.StringSelect) {
        const kind = parts[2] as 'cong_phap' | 'weapon';
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
        if (kind === 'cong_phap') {
          await store.users.set({ ...fresh, equipped_cong_phap_slug: slug });
        } else {
          await store.users.set({ ...fresh, equipped_weapon_slug: slug });
        }
        // Phase 14 quest — equip_both fires when both slots filled.
        {
          const { checkEquipBothQuest } = await import('../modules/quests/daily-quest.js');
          void checkEquipBothQuest(userId);
        }
        const { embed, options } = kind === 'cong_phap'
          ? buildCongPhapEmbed(userId)
          : buildWeaponEmbed(userId);
        const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [
          buildTabRow(activeTab, userId),
        ];
        const selectRow = buildSelectRow(kind, userId, options);
        if (selectRow) rows.push(selectRow);
        await cmp.update({ embeds: [embed], components: rows });
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
