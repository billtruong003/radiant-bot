import { type ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { DIVIDER_SHORT, ICONS } from '../config/ui.js';
import { getStore } from '../db/index.js';
import { computeDailyAward, nextMilestoneHint } from '../modules/leveling/daily.js';
import { maybePromoteRank, postLevelUpEmbed } from '../modules/leveling/rank-promoter.js';
import { awardXp } from '../modules/leveling/tracker.js';
import { themedEmbed } from '../utils/embed.js';

/**
 * /daily — claim daily XP + maintain streak. Embed includes:
 *   - Hero line: +N XP earned, breakdown of base + bonus
 *   - Streak visual: number + flame/spark per streak day milestone
 *   - Next milestone hint
 *
 * Calendar-day-based in VN timezone (see modules/leveling/daily.ts).
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

/** Visual streak meter: highlight days past + show milestones at 7/14/30. */
function renderStreakLadder(currentStreak: number): string {
  const milestones = [7, 14, 30];
  const parts: string[] = [];
  for (const m of milestones) {
    const reached = currentStreak >= m;
    parts.push(`${reached ? '🔥' : '·'} ${m}d`);
  }
  return parts.join('  ');
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.member) {
    await interaction.reply({
      content: `${ICONS.warn} Lệnh này chỉ dùng trong server.`,
      ephemeral: true,
    });
    return;
  }

  const store = getStore();
  const user = store.users.get(interaction.user.id);
  const award = computeDailyAward(user ?? null);

  if (!award.ok) {
    await interaction.reply({
      content: `🕛 Hôm nay bạn đã điểm danh rồi (streak hiện tại: **${award.newStreak} ngày** 🔥). Quay lại vào **ngày mai** nhé!`,
      ephemeral: true,
    });
    return;
  }

  // Award XP first.
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

  // Persist streak + last_daily_at. Phase 12: also auto-grant +5
  // contribution_points + (2 pills if streak milestone 7/14/30).
  const fresh = store.users.get(interaction.user.id);
  const isStreakMilestone =
    award.newStreak === 7 || award.newStreak === 14 || award.newStreak === 30;
  const contribGrant = 5;
  const pillsGrant = isStreakMilestone ? (award.newStreak === 30 ? 10 : 2) : 0;
  if (fresh) {
    await store.users.set({
      ...fresh,
      daily_streak: award.newStreak,
      last_daily_at: Date.now(),
      contribution_points: (fresh.contribution_points ?? 0) + contribGrant,
      pills: (fresh.pills ?? 0) + pillsGrant,
    });
  }

  const hint = nextMilestoneHint(award.newStreak);
  const ladder = renderStreakLadder(award.newStreak);

  const baseLine = `**+${award.base} XP** điểm danh`;
  const bonusLine =
    award.bonus > 0 ? `\n🎁 **+${award.bonus} XP** bonus streak ${award.newStreak} ngày!` : '';
  const heroLine = `${ICONS.sparkle} ${interaction.user} nhận **+${award.amount} XP**`;

  const streakBlock = [
    `🔥 **Streak hiện tại:** ${award.newStreak} ngày`,
    ladder,
    hint ? `*${hint}*` : '*Đã đạt tất cả mốc streak — giữ vững!* 👑',
  ].join('\n');

  const description = [heroLine, `${baseLine}${bonusLine}`, DIVIDER_SHORT, streakBlock].join(
    '\n\n',
  );

  const embed = themedEmbed(award.bonus > 0 ? 'success' : 'info', {
    title: `🌅 Điểm danh ${award.bonus > 0 ? '— Mốc streak!' : 'thành công'}`,
    description,
    footer: 'Cron reset theo lịch VN (Asia/Ho_Chi_Minh)',
  }).setThumbnail(interaction.user.displayAvatarURL({ size: 128 }));

  await interaction.reply({ embeds: [embed] });

  // Phase 12 Lát 4 — daily_streak_check quest progress.
  const { incrementProgress } = await import('../modules/quests/daily-quest.js');
  void incrementProgress(interaction.user.id, 'daily_streak_check', 1);

  // Promote if leveled up.
  if (result.leveledUp && member) {
    const promotion = await maybePromoteRank(member, result.newLevel);
    await postLevelUpEmbed(member, result.newLevel, promotion);
  }
}

export const command = { data, execute };
export default command;
