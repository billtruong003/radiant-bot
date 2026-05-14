import { type ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { getStore } from '../db/index.js';
import { RARITY_EMOJI, listOwnedCongPhap } from '../modules/combat/cong-phap.js';

/**
 * /inventory — quick view of owned công pháp + currencies. Equivalent
 * to `/cong-phap list` but framed as personal-inventory and includes
 * currency totals.
 */

export const data = new SlashCommandBuilder()
  .setName('inventory')
  .setDescription('Túi đồ — đan dược, cống hiến, công pháp đang sở hữu')
  .setDMPermission(false);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const user = getStore().users.get(userId);
  if (!user) {
    await interaction.reply({
      content: '🌫️ Chưa có dữ liệu — message vài câu để có user record.',
      ephemeral: true,
    });
    return;
  }
  const pills = user.pills ?? 0;
  const contrib = user.contribution_points ?? 0;
  const owned = listOwnedCongPhap(userId);
  const equippedSlug = user.equipped_cong_phap_slug ?? null;

  const congLines = owned.length
    ? owned.map(({ item }) => {
        const star = item.slug === equippedSlug ? '⭐' : '  ';
        return `${star} ${RARITY_EMOJI[item.rarity] ?? '⚪'} **${item.name}** \`${item.slug}\` (+${item.stat_bonuses.combat_power} LC)`;
      })
    : ['_Chưa sở hữu công pháp nào — `/shop` để xem cửa hàng._'];

  const embed = new EmbedBuilder()
    .setColor(0xf4d03f)
    .setTitle('🎒 Túi đồ')
    .addFields(
      { name: '💊 Đan dược độ kiếp', value: `**${pills}** viên`, inline: true },
      { name: '🪙 Điểm cống hiến', value: `**${contrib}**`, inline: true },
      { name: '📜 Công pháp', value: congLines.join('\n'), inline: false },
    )
    .setFooter({ text: '⭐ = đang trang bị · `/cong-phap equip <slug>` để đổi' });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

export const command = { data, execute };
export default command;
