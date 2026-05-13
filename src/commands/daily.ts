import { type ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { getStore } from '../db/index.js';
import { computeDailyAward, nextMilestoneHint } from '../modules/leveling/daily.js';
import { maybePromoteRank, postLevelUpEmbed } from '../modules/leveling/rank-promoter.js';
import { awardXp } from '../modules/leveling/tracker.js';

/**
 * /daily — claim daily XP + maintain streak. Calendar-day-based in
 * VN timezone (see modules/leveling/daily.ts).
 *
 * Successful claim:
 *   1. computeDailyAward → { ok, amount, newStreak, bonus }
 *   2. awardXp(amount, source='daily' | 'streak_7' | etc.)
 *   3. Update user.daily_streak + last_daily_at
 *   4. Reply with embed showing streak + bonus + next milestone
 *
 * Failed (already claimed): ephemeral nudge to try again tomorrow.
 */

export const data = new SlashCommandBuilder()
  .setName('daily')
  .setDescription('Điểm danh hằng ngày — kiếm 100 XP + streak bonus')
  .setDMPermission(false);

function streakSourceFor(newStreak: number): 'streak_7' | 'streak_14' | 'streak_30' | 'daily' {
  if (newStreak === 30) return 'streak_30';
  if (newStreak === 14) return 'streak_14';
  if (newStreak === 7) return 'streak_7';
  return 'daily';
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.member) {
    await interaction.reply({ content: '⚠️ Lệnh này chỉ dùng trong server.', ephemeral: true });
    return;
  }

  const store = getStore();
  const user = store.users.get(interaction.user.id);
  const award = computeDailyAward(user ?? null);

  if (!award.ok) {
    await interaction.reply({
      content: `🕛 Hôm nay bạn đã điểm danh rồi (streak hiện tại: **${award.newStreak} ngày**). Quay lại vào ngày mai.`,
      ephemeral: true,
    });
    return;
  }

  // Award XP first — this handles user creation if missing.
  const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
  const displayName = member?.displayName ?? interaction.user.username;
  const result = await awardXp({
    discordId: interaction.user.id,
    username: interaction.user.username,
    displayName,
    amount: award.amount,
    source: streakSourceFor(award.newStreak),
    metadata: { streak: award.newStreak, base: award.base, bonus: award.bonus },
  });

  // Persist streak + last_daily_at on the User record. Re-fetch post-awardXp
  // so we don't clobber concurrent XP changes.
  const fresh = store.users.get(interaction.user.id);
  if (fresh) {
    await store.users.set({
      ...fresh,
      daily_streak: award.newStreak,
      last_daily_at: Date.now(),
    });
  }

  const hint = nextMilestoneHint(award.newStreak);
  const bonusLine =
    award.bonus > 0 ? `\n🎁 **Streak ${award.newStreak} ngày** bonus: +${award.bonus} XP` : '';

  const embed = new EmbedBuilder()
    .setColor(0x5dade2)
    .setTitle('🌅 Điểm danh thành công')
    .setDescription(
      `${interaction.user} nhận **+${award.amount} XP**.${bonusLine}\n\nStreak hiện tại: **${award.newStreak} ngày**.${hint ? `\n*${hint}*` : ''}`,
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });

  // Promote if leveled up.
  if (result.leveledUp && member) {
    const promotion = await maybePromoteRank(member, result.newLevel);
    await postLevelUpEmbed(member, result.newLevel, promotion);
  }
}

export const command = { data, execute };
export default command;
