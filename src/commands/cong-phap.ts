import { type ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { rankById } from '../config/cultivation.js';
import { getStore } from '../db/index.js';
import {
  RARITY_EMOJI,
  buyCongPhap,
  equipCongPhap,
  listOwnedCongPhap,
  unequipCongPhap,
} from '../modules/combat/cong-phap.js';

/**
 * /cong-phap list|info|buy|equip|unequip <slug>
 */

export const data = new SlashCommandBuilder()
  .setName('cong-phap')
  .setDescription('Quản lý công pháp (catalog + sở hữu)')
  .setDMPermission(false)
  .addSubcommand((sc) =>
    sc.setName('list').setDescription('Liệt kê công pháp bạn đang sở hữu (đã trang bị có dấu ⭐)'),
  )
  .addSubcommand((sc) =>
    sc
      .setName('info')
      .setDescription('Xem chi tiết 1 công pháp trong catalog')
      .addStringOption((o) =>
        o.setName('slug').setDescription('Slug công pháp (vd: kim-cang-quyen)').setRequired(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('buy')
      .setDescription('Mua 1 công pháp bằng đan dược + cống hiến')
      .addStringOption((o) => o.setName('slug').setDescription('Slug công pháp').setRequired(true)),
  )
  .addSubcommand((sc) =>
    sc
      .setName('equip')
      .setDescription('Trang bị 1 công pháp đã sở hữu')
      .addStringOption((o) => o.setName('slug').setDescription('Slug công pháp').setRequired(true)),
  )
  .addSubcommand((sc) => sc.setName('unequip').setDescription('Bỏ trang bị công pháp hiện tại'));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(true);
  const userId = interaction.user.id;
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) {
    await interaction.reply({
      content: '🌫️ Bạn chưa có dữ liệu — message vài câu để có user record.',
      ephemeral: true,
    });
    return;
  }

  if (sub === 'list') {
    const owned = listOwnedCongPhap(userId);
    const equippedSlug = user.equipped_cong_phap_slug ?? null;
    if (owned.length === 0) {
      await interaction.reply({
        content: '📜 Bạn chưa sở hữu công pháp nào. Dùng `/shop` để xem cửa hàng.',
        ephemeral: true,
      });
      return;
    }
    const lines = owned.map(({ item }) => {
      const marker = item.slug === equippedSlug ? '⭐' : '  ';
      return `${marker} ${RARITY_EMOJI[item.rarity] ?? '⚪'} **${item.name}** \`${item.slug}\` — +${item.stat_bonuses.combat_power} LC`;
    });
    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle('📜 Công pháp inventory')
      .setDescription(lines.join('\n'))
      .setFooter({ text: `${owned.length} công pháp · ⭐ = đang trang bị` });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  const slug = interaction.options.getString('slug', true);

  if (sub === 'info') {
    const item = store.congPhapCatalog.get(slug);
    if (!item) {
      await interaction.reply({
        content: `⚠️ Không tìm thấy công pháp \`${slug}\`. Dùng \`/shop\` xem catalog.`,
        ephemeral: true,
      });
      return;
    }
    const rankReq = item.min_rank_required
      ? rankById(item.min_rank_required).name
      : 'Không yêu cầu';
    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle(`${RARITY_EMOJI[item.rarity]} ${item.name}`)
      .setDescription(item.description)
      .addFields(
        { name: 'Độ hiếm', value: item.rarity, inline: true },
        { name: '⚔️ Lực chiến', value: `+${item.stat_bonuses.combat_power}`, inline: true },
        { name: '🎯 Yêu cầu', value: rankReq, inline: true },
        { name: '💊 Đan dược', value: `${item.cost_pills}`, inline: true },
        { name: '🪙 Cống hiến', value: `${item.cost_contribution}`, inline: true },
      )
      .setFooter({ text: `slug: ${item.slug}` });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === 'buy') {
    const r = await buyCongPhap(userId, slug);
    if (!r.ok) {
      const msg = (() => {
        switch (r.reason) {
          case 'not-found':
            return `⚠️ Không có công pháp \`${slug}\` trong catalog.`;
          case 'already-owned':
            return `ℹ️ Bạn đã sở hữu \`${slug}\` rồi.`;
          case 'rank-too-low': {
            const item = store.congPhapCatalog.get(slug);
            const req = item?.min_rank_required ? rankById(item.min_rank_required).name : '';
            return `🚫 Cảnh giới của bạn (${rankById(user.cultivation_rank).name}) chưa đủ để mua. Yêu cầu: **${req}**.`;
          }
          case 'not-enough-pills':
            return '💊 Không đủ đan dược. Dùng `/breakthrough` pass tribulation để kiếm thêm.';
          case 'not-enough-contribution':
            return '🪙 Không đủ điểm cống hiến. Chat trong server + `/daily` để tích.';
          default:
            return `⚠️ Không mua được: \`${r.reason}\``;
        }
      })();
      await interaction.reply({ content: msg, ephemeral: true });
      return;
    }
    // Auto-equip if user has nothing equipped.
    if (!user.equipped_cong_phap_slug) {
      await equipCongPhap(userId, slug);
    }
    const item = store.congPhapCatalog.get(slug);
    await interaction.reply({
      content: `✅ Đã mua **${item?.name ?? slug}**! Còn lại: ${r.newPills} đan dược, ${r.newContribution} cống hiến.${
        !user.equipped_cong_phap_slug
          ? ' Đã tự động trang bị.'
          : ' Dùng `/cong-phap equip` để trang bị.'
      }`,
      ephemeral: true,
    });
    return;
  }

  if (sub === 'equip') {
    const r = await equipCongPhap(userId, slug);
    if (!r.ok) {
      const msg =
        r.reason === 'not-owned'
          ? `⚠️ Bạn chưa sở hữu \`${slug}\`. Mua bằng \`/cong-phap buy\`.`
          : `⚠️ ${r.reason}`;
      await interaction.reply({ content: msg, ephemeral: true });
      return;
    }
    const item = store.congPhapCatalog.get(slug);
    await interaction.reply({
      content: `⭐ Đã trang bị **${item?.name}** — +${item?.stat_bonuses.combat_power} lực chiến.`,
      ephemeral: true,
    });
    return;
  }

  if (sub === 'unequip') {
    if (!user.equipped_cong_phap_slug) {
      await interaction.reply({
        content: 'ℹ️ Bạn không có công pháp nào đang trang bị.',
        ephemeral: true,
      });
      return;
    }
    await unequipCongPhap(userId);
    await interaction.reply({ content: '🗑️ Đã bỏ trang bị công pháp.', ephemeral: true });
    return;
  }
}

export const command = { data, execute };
export default command;
