import {
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { getStore } from '../db/index.js';
import { logger } from '../utils/logger.js';

/**
 * `/grant pills|contribution @user <amount>` — admin-only currency
 * grant for Phase 12 Lát 1. Lets staff seed test accounts, refund users,
 * or hand out event prizes without poking the WAL by hand.
 *
 * Idempotency: each call atomically `incr`s the target field. Negative
 * `amount` deducts (rejected if it would drop below 0).
 *
 * Hard rules:
 *   - admin permission only
 *   - target must already exist in `store.users` (no auto-create)
 *   - logged via pino + #bot-log post for audit trail
 */

const MAX_GRANT = 100_000;

export const data = new SlashCommandBuilder()
  .setName('grant')
  .setDescription('Cấp currency cho đệ tử (admin only)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addStringOption((o) =>
    o
      .setName('currency')
      .setDescription('Loại currency')
      .setRequired(true)
      .addChoices(
        { name: 'pills (Đan dược)', value: 'pills' },
        { name: 'contribution (Cống hiến)', value: 'contribution_points' },
      ),
  )
  .addUserOption((o) => o.setName('user').setDescription('Đệ tử nhận').setRequired(true))
  .addIntegerOption((o) =>
    o
      .setName('amount')
      .setDescription('Số lượng (âm = trừ)')
      .setRequired(true)
      .setMinValue(-MAX_GRANT)
      .setMaxValue(MAX_GRANT),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const currency = interaction.options.getString('currency', true) as
    | 'pills'
    | 'contribution_points';
  const target = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);

  const store = getStore();
  const user = store.users.get(target.id);
  if (!user) {
    await interaction.reply({
      content: `⚠️ ${target.username} chưa có user record. Họ cần message ít nhất 1 lần.`,
      ephemeral: true,
    });
    return;
  }

  const current = (user[currency] as number | undefined) ?? 0;
  const next = current + amount;
  if (next < 0) {
    await interaction.reply({
      content: `⚠️ ${target.username} chỉ có ${current} ${currency}. Không trừ được ${Math.abs(amount)}.`,
      ephemeral: true,
    });
    return;
  }

  await store.users.set({ ...user, [currency]: next });

  const label = currency === 'pills' ? 'Đan dược' : 'Cống hiến';
  const verb = amount >= 0 ? 'cấp' : 'trừ';
  logger.info(
    {
      admin_id: interaction.user.id,
      target_id: target.id,
      currency,
      amount,
      new_total: next,
    },
    'grant: currency adjusted',
  );

  await interaction.reply({
    content: `✅ Đã ${verb} **${Math.abs(amount)} ${label}** cho ${target}. Tổng hiện tại: **${next}**.`,
    ephemeral: true,
  });
}

export const command = { data, execute };
export default command;
