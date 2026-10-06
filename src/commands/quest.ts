import { type ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { withCard } from '../modules/cards/attach.js';
import { renderQuestCard } from '../modules/cards/daily-cards.js';
import {
  GROUP_LABEL,
  assignDailyQuest,
  getTodayQuests,
  groupOf,
  questLabel,
  vnDayStart,
} from '../modules/quests/daily-quest.js';
import { questButtons } from '../modules/quests/discord.js';

/**
 * /quest — today's board: the classic activity quest plus the study and
 * slay rows. Assigns the board if the cron has not (new member, missed
 * tick). Study quests carry buttons to the web practice and the docs quiz.
 */

export const data = new SlashCommandBuilder()
  .setName('quest')
  .setDescription('Xem nhiệm vụ hằng ngày + tiến độ')
  .setDMPermission(false);

function progressBar(current: number, total: number, width = 12): string {
  const ratio = Math.min(Math.max(current / total, 0), 1);
  const filled = Math.round(ratio * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const assigned = await assignDailyQuest(userId);
  if (!assigned) {
    await interaction.reply({
      content: '🌫️ Bạn chưa có user record — chat vài câu trước.',
      ephemeral: true,
    });
    return;
  }
  const quests = getTodayQuests(userId);

  const lines = quests.map((q) => {
    const done = q.completed_at !== null;
    return [
      `**${GROUP_LABEL[groupOf(q)]} · ${questLabel(q)}**`,
      `\`${progressBar(q.progress, q.target)}\` ${done ? '✅ Hoàn thành' : `${q.progress}/${q.target}`}`,
      `Thưởng: ✨ ${q.reward_xp} XP · 💊 ${q.reward_pills} · 🪙 ${q.reward_contribution}`,
    ].join('\n');
  });
  const allDone = quests.every((q) => q.completed_at !== null);
  const embed = new EmbedBuilder()
    .setColor(allDone ? 0x2ecc71 : 0x5dade2)
    .setTitle('📋 Nhiệm vụ hằng ngày')
    .setDescription(lines.join('\n\n'))
    .setFooter({
      text: allDone
        ? 'Đã xong cả bảng — quay lại sau 00:00 VN cho nhiệm vụ mới.'
        : 'Tiến độ tự tăng khi bạn hoạt động, học và săn yêu thú.',
    });

  const left = vnDayStart(Date.now()) + 24 * 3600_000 - Date.now();
  const card = await renderQuestCard({
    name: interaction.user.displayName,
    resetIn: `${Math.floor(left / 3600_000)} giờ ${Math.floor((left % 3600_000) / 60_000)} phút`,
    quests: quests.map((q) => ({
      group: GROUP_LABEL[groupOf(q)],
      label: questLabel(q),
      progress: q.progress,
      target: q.target,
      done: q.completed_at !== null,
      xp: q.reward_xp,
      pills: q.reward_pills,
      coins: q.reward_contribution,
    })),
  });
  await interaction.reply({
    ...withCard(embed, card),
    components: questButtons(quests),
    ephemeral: true,
  });
}

export const command = { data, execute };
export default command;
