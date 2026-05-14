import { type ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { getStore } from '../db/index.js';
import { unequipCongPhap } from '../modules/combat/cong-phap.js';
import { logger } from '../utils/logger.js';

/**
 * /trade sell <slug> — sell a công pháp back for partial refund.
 *
 * Refund formula (intentionally less than purchase to avoid churn loop):
 *   - Pills: 50% rounded down
 *   - Contribution: 60% rounded down
 *
 * Aki occasional "premium buy" (10% chance per sale): pays FULL price
 * back as a small "lucky day" bonus. Logged for analytics.
 *
 * Constraints:
 *   - Must own the công pháp
 *   - If equipped, auto-unequip first
 *   - Removes UserCongPhap record (not refundable after sale — buy again to use)
 */

const PILL_REFUND_RATIO = 0.5;
const CONTRIB_REFUND_RATIO = 0.6;
const AKI_PREMIUM_CHANCE = 0.1;

export const data = new SlashCommandBuilder()
  .setName('trade')
  .setDescription('Bán lại công pháp cho Aki (refund 50-100%)')
  .setDMPermission(false)
  .addSubcommand((sc) =>
    sc
      .setName('sell')
      .setDescription('Bán công pháp')
      .addStringOption((o) =>
        o.setName('slug').setDescription('Slug công pháp cần bán').setRequired(true),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(true);
  if (sub !== 'sell') return;

  const userId = interaction.user.id;
  const slug = interaction.options.getString('slug', true);
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) {
    await interaction.reply({
      content: '🌫️ Bạn chưa có user record — chat vài câu trước.',
      ephemeral: true,
    });
    return;
  }

  const item = store.congPhapCatalog.get(slug);
  if (!item) {
    await interaction.reply({
      content: `⚠️ Không tìm thấy công pháp \`${slug}\` trong catalog.`,
      ephemeral: true,
    });
    return;
  }

  const owned = store.userCongPhap.query(
    (uc) => uc.discord_id === userId && uc.cong_phap_slug === slug,
  );
  if (owned.length === 0) {
    await interaction.reply({
      content: `⚠️ Bạn không sở hữu \`${slug}\` để bán.`,
      ephemeral: true,
    });
    return;
  }

  // Auto-unequip if needed.
  if (user.equipped_cong_phap_slug === slug) {
    await unequipCongPhap(userId);
  }

  // Determine refund — Aki premium roll.
  const isPremium = Math.random() < AKI_PREMIUM_CHANCE;
  const refundPills = isPremium ? item.cost_pills : Math.floor(item.cost_pills * PILL_REFUND_RATIO);
  const refundContrib = isPremium
    ? item.cost_contribution
    : Math.floor(item.cost_contribution * CONTRIB_REFUND_RATIO);

  // Remove ownership + grant refund (atomic enough — single-writer).
  for (const oc of owned) {
    await store.userCongPhap.delete(oc.id);
  }
  const fresh = store.users.get(userId);
  if (fresh) {
    await store.users.set({
      ...fresh,
      pills: (fresh.pills ?? 0) + refundPills,
      contribution_points: (fresh.contribution_points ?? 0) + refundContrib,
    });
  }

  logger.info(
    {
      discord_id: userId,
      slug,
      premium: isPremium,
      refund_pills: refundPills,
      refund_contrib: refundContrib,
    },
    'trade: sold',
  );

  const flavor = isPremium
    ? `🎉 **AKI HÔM NAY HÀO PHÓNG!** Mua full giá — ${refundPills} 💊 + ${refundContrib} 🪙. Hên thật ٩(◕‿◕)۶`
    : `💰 Aki nhận **${item.name}** — refund ${refundPills} 💊 + ${refundContrib} 🪙 (50-60% giá gốc).`;

  await interaction.reply({ content: flavor, ephemeral: true });
}

export const __for_testing = {
  PILL_REFUND_RATIO,
  CONTRIB_REFUND_RATIO,
  AKI_PREMIUM_CHANCE,
};

export const command = { data, execute };
export default command;
