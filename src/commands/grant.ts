import {
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { getStore } from '../db/index.js';
import { cumulativeXpForLevel } from '../modules/leveling/engine.js';
import { maybePromoteRank, postLevelUpEmbed } from '../modules/leveling/rank-promoter.js';
import { awardXp } from '../modules/leveling/tracker.js';
import { logger } from '../utils/logger.js';

/**
 * `/grant pills|contribution|xp @user <amount>` — admin-only currency / XP
 * grant. Lets staff seed test accounts, refund users, or hand out event
 * prizes without poking the WAL by hand.
 *
 * Phase 12 Lát 1 shipped pills + contribution. 2026-05-20 Bill ask:
 * add `xp` so admins can hand out XP directly. Positive XP routes through
 * `awardXp()` so level-up + rank promotion + level-up embed all fire as if
 * the user earned it naturally. Negative XP applies a penalty floored at
 * the user's current cumulativeXpForLevel — never demotes a level.
 *
 * Hard rules:
 *   - admin permission only
 *   - target must already exist in `store.users` (no auto-create)
 *   - logged via pino + #bot-log post for audit trail
 */

const MAX_GRANT = 100_000;

type Currency = 'pills' | 'contribution_points' | 'xp';

export const data = new SlashCommandBuilder()
  .setName('grant')
  .setDescription('Cấp currency / XP cho đệ tử (admin only)')
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
        { name: 'xp (Kinh nghiệm)', value: 'xp' },
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
  const currency = interaction.options.getString('currency', true) as Currency;
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

  if (amount === 0) {
    await interaction.reply({ content: 'ℹ️ Amount = 0 — nothing to grant.', ephemeral: true });
    return;
  }

  // XP path — routes through awardXp / penalty pipeline so rank logic fires.
  if (currency === 'xp') {
    if (amount > 0) {
      const member = interaction.inCachedGuild()
        ? await interaction.guild.members.fetch(target.id).catch(() => null)
        : null;
      const displayName = member?.displayName ?? target.username;
      const result = await awardXp({
        discordId: target.id,
        username: target.username,
        displayName,
        amount,
        source: 'event',
        metadata: { grant_by: interaction.user.id, reason: 'admin-grant' },
      });
      logger.info(
        { admin_id: interaction.user.id, target_id: target.id, amount, new_xp: result.newXp },
        'grant: xp awarded',
      );
      await interaction.reply({
        content: `✅ Đã cấp **${amount} XP** cho ${target}. Tổng XP: **${result.newXp.toLocaleString('vi-VN')}** (Lv ${result.newLevel}).`,
        ephemeral: true,
      });
      if (result.leveledUp && member) {
        const promotion = await maybePromoteRank(member, result.newLevel);
        await postLevelUpEmbed(member, result.newLevel, promotion);
      }
      return;
    }

    // Negative — penalty path. Floor at cumulativeXpForLevel(level) so the
    // user keeps their current level (matches divine-judgment xp_deduct).
    const floor = cumulativeXpForLevel(user.level);
    const requested = Math.abs(amount);
    const newXp = Math.max(floor, user.xp - requested);
    const applied = user.xp - newXp;
    await store.users.set({ ...user, xp: newXp });
    logger.info(
      {
        admin_id: interaction.user.id,
        target_id: target.id,
        amount,
        applied,
        new_xp: newXp,
        floor,
      },
      'grant: xp penalty',
    );
    const note =
      applied < requested
        ? ` _(sàn floor là **${floor}** XP cho Lv ${user.level} — không trừ qua mức)_`
        : '';
    await interaction.reply({
      content: `✅ Đã trừ **${applied} XP** từ ${target}. Tổng XP: **${newXp.toLocaleString('vi-VN')}**${note}.`,
      ephemeral: true,
    });
    return;
  }

  // pills / contribution_points — direct field adjustment, floor at 0.
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
