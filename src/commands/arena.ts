import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { env } from '../config/env.js';
import { getStore } from '../db/index.js';
import type { Weapon, WeaponStats, WeaponVisual } from '../db/types.js';
import {
  BAN_MENH_SLUG_PREFIX,
  forgeBanMenh,
  previewBanMenh,
  probeColyseus,
} from '../modules/arena/index.js';
import { describeSkill } from '../modules/arena/skill-descriptions.js';
import { logger } from '../utils/logger.js';

/**
 * Phase 13 Lát A — `/arena` admin slash.
 *
 * Subcommands (all admin-only or staff-only):
 *   forge   — forge bản mệnh weapon for the caller (or a target user).
 *             Idempotent: returns existing if already forged.
 *   inspect — show the currently equipped weapon for a target user.
 *             Resolves bản mệnh from userWeapons and catalog weapons via
 *             weaponCatalog.
 *   debug   — probe Colyseus health endpoint (or report ARENA_ENABLED=false).
 *
 * This slash is the entry point for the Arena flow. It deliberately does
 * NOT replace `/duel` — `/duel` stays as the in-bot local sim. Once
 * Colyseus (Lát D) lands, `/arena duel @opponent` will create a real
 * room; for Lát A it just exposes admin / debug capability.
 */

export const data = new SlashCommandBuilder()
  .setName('arena')
  .setDescription('Radiant Arena — weapon forge + Colyseus bridge (admin/debug)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((sc) =>
    sc
      .setName('forge')
      .setDescription('Rèn pháp khí bản mệnh (deterministic theo Discord ID)')
      .addUserOption((o) =>
        o
          .setName('target')
          .setDescription('Đệ tử nhận pháp khí (mặc định: bạn)')
          .setRequired(false),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('inspect')
      .setDescription('Xem pháp khí đang trang bị của 1 đệ tử')
      .addUserOption((o) =>
        o.setName('target').setDescription('Đệ tử cần xem (mặc định: bạn)').setRequired(false),
      ),
  )
  .addSubcommand((sc) =>
    sc.setName('debug').setDescription('Probe Colyseus health + report feature flag state'),
  )
  .addSubcommand((sc) =>
    sc.setName('catalog').setDescription('Duyệt catalog 12 pháp khí — stats + kỹ năng + truyền thuyết'),
  );

function statsBlock(stats: WeaponStats): string {
  return [
    `⚡ Power: **${stats.power.toFixed(2)}**`,
    `🎯 Hitbox: **${stats.hitbox.toFixed(2)}**`,
    `〰️ Bounce: **${stats.bounce.toFixed(2)}**`,
    `💥 Damage base: **${stats.damage_base}**`,
    `🗡️ Pierce: **${stats.pierce_count}**`,
    `🌟 Crit: **${(stats.crit_chance * 100).toFixed(1)}%** × ${stats.crit_multi.toFixed(2)}`,
  ].join('\n');
}

function visualBlock(v: WeaponVisual): string {
  return [
    `🎨 Hue: \`${v.hue}\``,
    `📦 Model: \`${v.model_prefab_key}\``,
    v.particle_fx_key ? `✨ Particle: \`${v.particle_fx_key}\`` : null,
    v.trail_fx_key ? `🌌 Trail: \`${v.trail_fx_key}\`` : null,
  ]
    .filter((x): x is string => x !== null)
    .join('\n');
}

async function handleForge(interaction: ChatInputCommandInteraction): Promise<void> {
  const target = interaction.options.getUser('target') ?? interaction.user;
  if (target.bot) {
    await interaction.reply({
      content: '🤖 Không thể rèn pháp khí cho bot.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const preview = previewBanMenh(target.id);
  const row = await forgeBanMenh(target.id);
  const isNew = row.acquired_at >= Date.now() - 5000;

  const embed = new EmbedBuilder()
    .setColor(Number.parseInt(preview.visual.hue.slice(1), 16))
    .setTitle(`🗡️ Pháp Khí Bản Mệnh — ${target.username}`)
    .setDescription(
      [
        isNew ? '✨ **Pháp khí mới rèn xong.**' : '⏳ Pháp khí đã tồn tại — trả về bản gốc.',
        '',
        `Slug: \`${row.weapon_slug}\``,
        `Acquired: <t:${Math.floor(row.acquired_at / 1000)}:R>`,
      ].join('\n'),
    )
    .addFields(
      { name: '📊 Stats', value: statsBlock(preview.stats), inline: true },
      { name: '🎨 Visual', value: visualBlock(preview.visual), inline: true },
    )
    .setFooter({ text: 'Bản mệnh là deterministic theo Discord ID · idempotent forge' });

  await interaction.editReply({ embeds: [embed] });
}

async function handleInspect(interaction: ChatInputCommandInteraction): Promise<void> {
  const target = interaction.options.getUser('target') ?? interaction.user;
  const store = getStore();
  const user = store.users.get(target.id);
  if (!user) {
    await interaction.reply({
      content: `🌫️ ${target.username} chưa có user record.`,
      ephemeral: true,
    });
    return;
  }

  const equippedSlug = user.equipped_weapon_slug ?? null;
  if (!equippedSlug) {
    await interaction.reply({
      content: `📜 ${target.username} chưa trang bị pháp khí Arena nào. Dùng \`/arena forge\` để rèn bản mệnh.`,
      ephemeral: true,
    });
    return;
  }

  const isBanMenh = equippedSlug.startsWith(BAN_MENH_SLUG_PREFIX);
  let stats: WeaponStats;
  let visual: WeaponVisual;
  let displayName: string;
  let tier: string;
  let category: string;
  let banMenhSkillLine: string | null = null;

  if (isBanMenh) {
    const owned = store.userWeapons
      .query((uw) => uw.discord_id === target.id && uw.weapon_slug === equippedSlug)
      .at(0);
    if (!owned || !owned.custom_stats || !owned.custom_visual) {
      await interaction.reply({
        content: `⚠️ Pháp khí bản mệnh mất dấu — slug \`${equippedSlug}\` không tìm thấy ở user_weapons.`,
        ephemeral: true,
      });
      return;
    }
    stats = owned.custom_stats;
    visual = owned.custom_visual;
    displayName = 'Pháp Khí Bản Mệnh';
    tier = 'ban_menh';
    category = 'blunt';
    // Phase 13 Lát B: show the rolled "mạch" skill if present. Old rows
    // missing custom_skills hint user to re-forge for backfill.
    // Phase 13 Lát C: skill copy now via shared describeSkill() lookup.
    const skill = owned.custom_skills?.[0];
    if (skill) {
      const desc = describeSkill(skill.skill_id);
      banMenhSkillLine = desc
        ? `${desc.icon} **${desc.name}** — ${desc.short}`
        : `_(Mạch chưa định danh: \`${skill.skill_id}\`)_`;
    } else {
      banMenhSkillLine = '_(Pháp khí cũ — chạy `/arena forge` lại để cập nhật mạch.)_';
    }
  } else {
    const w = store.weaponCatalog.get(equippedSlug);
    if (!w) {
      await interaction.reply({
        content: `⚠️ Pháp khí \`${equippedSlug}\` không có trong catalog (có thể đã bị xoá).`,
        ephemeral: true,
      });
      return;
    }
    stats = w.stats;
    visual = w.visual;
    displayName = w.display_name;
    tier = w.tier;
    category = w.category;
  }

  const embed = new EmbedBuilder()
    .setColor(Number.parseInt(visual.hue.slice(1), 16))
    .setTitle(`🗡️ ${displayName}`)
    .setDescription(
      [
        `Đang trang bị bởi **${target.username}**`,
        `Slug: \`${equippedSlug}\``,
        `Tier: **${tier}** · Category: **${category}**`,
      ].join('\n'),
    )
    .addFields(
      { name: '📊 Stats', value: statsBlock(stats), inline: true },
      { name: '🎨 Visual', value: visualBlock(visual), inline: true },
    );

  if (banMenhSkillLine !== null) {
    embed.addFields({ name: '🩸 Mạch bản mệnh', value: banMenhSkillLine, inline: false });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * Phase 13 Lát C — /arena catalog handler.
 * Paginated browse over `weaponCatalog` collection: 1 weapon per embed,
 * navigated via ⬅/➡ Buttons. Sorted by tier (phẩm → tiên) then category
 * (blunt → pierce → spirit). Author-only button collector with 5-min timeout.
 */
async function handleCatalog(interaction: ChatInputCommandInteraction): Promise<void> {
  const store = getStore();
  const tierOrder: Record<string, number> = { pham: 0, dia: 1, thien: 2, tien: 3, ban_menh: 4 };
  const catOrder: Record<string, number> = { blunt: 0, pierce: 1, spirit: 2 };
  const weapons = store.weaponCatalog
    .all()
    .slice()
    .sort((a, b) => {
      const ta = tierOrder[a.tier] ?? 99;
      const tb = tierOrder[b.tier] ?? 99;
      if (ta !== tb) return ta - tb;
      return (catOrder[a.category] ?? 9) - (catOrder[b.category] ?? 9);
    });

  if (weapons.length === 0) {
    await interaction.reply({ content: '📜 Catalog rỗng — chưa load weapon-catalog.json.', ephemeral: true });
    return;
  }

  let idx = 0;
  const buildRow = (): ActionRowBuilder<ButtonBuilder> =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('arena-cat-prev')
        .setLabel('⬅ Trước')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('arena-cat-next')
        .setLabel('Sau ➡')
        .setStyle(ButtonStyle.Secondary),
    );

  const reply = await interaction.reply({
    embeds: [buildCatalogEmbed(weapons[idx]!, idx + 1, weapons.length)],
    components: [buildRow()],
    ephemeral: true,
    fetchReply: true,
  });

  const collector = reply.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 5 * 60 * 1000,
  });
  collector.on('collect', async (btn) => {
    if (btn.user.id !== interaction.user.id) {
      await btn.reply({ content: 'Pages này chỉ dành cho người gọi lệnh.', ephemeral: true });
      return;
    }
    if (btn.customId === 'arena-cat-next') idx = (idx + 1) % weapons.length;
    else if (btn.customId === 'arena-cat-prev') idx = (idx - 1 + weapons.length) % weapons.length;
    await btn.update({
      embeds: [buildCatalogEmbed(weapons[idx]!, idx + 1, weapons.length)],
      components: [buildRow()],
    });
  });
  collector.on('end', async () => {
    try {
      await interaction.editReply({ components: [] });
    } catch {
      // Reply may have been dismissed by user; ignore.
    }
  });
}

const TIER_COLOR: Record<string, number> = {
  pham: 0x8a8d92,
  dia: 0xb88c5a,
  thien: 0xd4af37,
  tien: 0x9b6dc7,
  ban_menh: 0xa89bce,
};
const TIER_NAME_VN: Record<string, string> = {
  pham: 'Phàm Phẩm',
  dia: 'Địa Phẩm',
  thien: 'Thiên Phẩm',
  tien: 'Tiên Phẩm',
  ban_menh: 'Bản Mệnh',
};
const CATEGORY_NAME_VN: Record<string, string> = {
  blunt: 'Cường Công',
  pierce: 'Xuyên Thủng',
  spirit: 'Linh Khí',
};

function buildCatalogEmbed(w: Weapon, page: number, total: number): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(TIER_COLOR[w.tier] ?? 0x8a8d92)
    .setTitle(`🗡️ ${w.display_name}`)
    .setDescription(
      [
        `**Tier:** ${TIER_NAME_VN[w.tier] ?? w.tier} · **Loại:** ${CATEGORY_NAME_VN[w.category] ?? w.category}`,
        `Slug: \`${w.slug}\``,
      ].join('\n'),
    )
    .addFields(
      { name: '📊 Chỉ số', value: statsBlock(w.stats), inline: true },
      { name: '🎨 Visual', value: visualBlock(w.visual), inline: true },
    );

  if (w.skills.length > 0) {
    const skillLines = w.skills
      .map((s) => {
        const desc = describeSkill(s.skill_id);
        return desc
          ? `${desc.icon} **${desc.name}** — ${desc.short}`
          : `❓ \`${s.skill_id}\``;
      })
      .join('\n');
    e.addFields({ name: '✨ Kỹ năng', value: skillLines, inline: false });
  } else {
    e.addFields({ name: '✨ Kỹ năng', value: '_(Không có — pure stat stick.)_', inline: false });
  }

  if (w.lore) {
    e.addFields({ name: '📜 Truyền thuyết', value: w.lore, inline: false });
  }

  if (w.shop) {
    const unlockText = w.shop.unlock_realm ? ` · 🔒 ${w.shop.unlock_realm}` : '';
    e.addFields({
      name: '🏪 Mua tại đan tiệm',
      value: `💊 ${w.shop.cost_pills} đan + 🪙 ${w.shop.cost_contribution} cống hiến${unlockText}`,
      inline: false,
    });
  } else {
    e.addFields({ name: '🏪 Mua', value: '_(Không bán — drop / sự kiện.)_', inline: false });
  }

  e.setFooter({ text: `Trang ${page}/${total} · ⬅ Trước · Sau ➡` });
  return e;
}

async function handleDebug(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const probe = await probeColyseus();
  const store = getStore();

  const embed = new EmbedBuilder()
    .setColor(probe.ok ? 0x8fbf9f : 0xd97b8a)
    .setTitle('🔧 Arena Debug')
    .addFields(
      {
        name: 'Feature flag',
        value: env.ARENA_ENABLED ? '✅ ARENA_ENABLED=true' : '⏸️ ARENA_ENABLED=false',
        inline: true,
      },
      {
        name: 'Colyseus URL',
        value: `\`${env.ARENA_COLYSEUS_URL}\``,
        inline: true,
      },
      {
        name: 'Token secret',
        value: env.ARENA_TOKEN_SECRET ? '✅ set' : '❌ empty',
        inline: true,
      },
      {
        name: 'Result secret',
        value: env.ARENA_RESULT_SECRET ? '✅ set' : '❌ empty',
        inline: true,
      },
      {
        name: 'Probe',
        value: probe.ok ? `✅ Reachable · ${probe.latency_ms}ms` : `❌ ${probe.reason}`,
        inline: false,
      },
      {
        name: 'Catalog / forged',
        value: [
          `Weapons in catalog: **${store.weaponCatalog.count()}**`,
          `Total user weapons: **${store.userWeapons.count()}**`,
          `Arena sessions logged: **${store.arenaSessions.count()}**`,
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({
      text: env.ARENA_ENABLED
        ? 'Production mode'
        : 'Pre-Colyseus — flip ARENA_ENABLED=true sau khi Lát D ship',
    });

  await interaction.editReply({ embeds: [embed] });
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(true);
  try {
    if (sub === 'forge') {
      await handleForge(interaction);
      return;
    }
    if (sub === 'inspect') {
      await handleInspect(interaction);
      return;
    }
    if (sub === 'debug') {
      await handleDebug(interaction);
      return;
    }
    if (sub === 'catalog') {
      await handleCatalog(interaction);
      return;
    }
    await interaction.reply({
      content: `⚠️ Subcommand không xác định: \`${sub}\``,
      ephemeral: true,
    });
  } catch (err) {
    logger.error({ err, sub }, 'arena slash: handler failed');
    const errPayload = {
      content: `⚠️ Arena slash gặp lỗi: \`${(err as Error).message ?? 'unknown'}\``,
      ephemeral: true as const,
    };
    if (interaction.deferred) {
      await interaction.editReply(errPayload);
    } else if (!interaction.replied) {
      await interaction.reply(errPayload);
    }
  }
}

export const command = { data, execute };
export default command;
