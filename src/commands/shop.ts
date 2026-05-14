import { type ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { rankById } from '../config/cultivation.js';
import { getStore } from '../db/index.js';
import { RARITY_EMOJI, listShopAvailable } from '../modules/combat/cong-phap.js';

/**
 * /shop — browse công pháp catalog filtered by user's cảnh giới.
 * Items at or below their rank are available; above-rank items shown
 * dimmed for aspiration.
 */

export const data = new SlashCommandBuilder()
  .setName('shop')
  .setDescription('Cửa hàng công pháp — xem catalog có thể mua + đang khoá')
  .setDMPermission(false);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
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
  const pills = user.pills ?? 0;
  const contrib = user.contribution_points ?? 0;
  const userRank = user.cultivation_rank;

  const available = listShopAvailable(userRank);
  const all = store.congPhapCatalog
    .query(() => true)
    .sort((a, b) => a.cost_contribution - b.cost_contribution);
  const locked = all.filter((it) => !available.some((a) => a.slug === it.slug));

  // Mark owned items in catalog
  const ownedSlugs = new Set(
    store.userCongPhap.query((uc) => uc.discord_id === userId).map((uc) => uc.cong_phap_slug),
  );

  const fmtLine = (item: (typeof available)[number], locked: boolean): string => {
    const rarity = RARITY_EMOJI[item.rarity] ?? '⚪';
    const owned = ownedSlugs.has(item.slug);
    const affordable = pills >= item.cost_pills && contrib >= item.cost_contribution;
    const lockReq = item.min_rank_required
      ? ` _(yêu cầu ${rankById(item.min_rank_required).name})_`
      : '';
    const prefix = owned ? '✅' : locked ? '🔒' : affordable ? '🟢' : '⏳';
    return `${prefix} ${rarity} **${item.name}** \`${item.slug}\` — +${item.stat_bonuses.combat_power} LC · ${item.cost_pills}💊 + ${item.cost_contribution}🪙${lockReq}`;
  };

  const availLines = available.map((it) => fmtLine(it, false));
  const lockedLines = locked.map((it) => fmtLine(it, true));

  const description = [
    `**Bạn có**: 💊 ${pills} đan dược · 🪙 ${contrib} cống hiến · Cảnh giới: ${rankById(userRank).name}`,
    '',
    '**Có thể mua / xem chi tiết:**',
    availLines.length ? availLines.join('\n') : '_Catalog rỗng._',
    lockedLines.length ? '\n**Bị khoá (chưa đủ cảnh giới):**' : '',
    lockedLines.join('\n'),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);

  const embed = new EmbedBuilder()
    .setColor(0xf4d03f)
    .setTitle('🏪 Shop — Công pháp catalog')
    .setDescription(description)
    .setFooter({
      text: '✅ đã sở hữu · 🟢 mua được · ⏳ chưa đủ currency · 🔒 chưa đủ cảnh giới · Dùng /cong-phap info <slug>',
    });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

export const command = { data, execute };
export default command;
