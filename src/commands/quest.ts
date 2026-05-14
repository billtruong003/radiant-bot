import { type ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { assignDailyQuest, getCurrentQuest } from '../modules/quests/daily-quest.js';

/**
 * /quest — show today's daily quest + progress. Auto-assigns one if
 * the user has no quest for today yet (covers the case where the cron
 * hasn't fired or the user is brand new).
 */

const QUEST_LABEL: Record<string, string> = {
  message_count: '📝 Chat tin nhắn',
  voice_minutes: '🎤 Voice chat',
  reaction_count: '👍 Thả reaction',
  daily_streak_check: '🌅 Điểm danh /daily',
};

export const data = new SlashCommandBuilder()
  .setName('quest')
  .setDescription('Xem nhiệm vụ hằng ngày + tiến độ')
  .setDMPermission(false);

function progressBar(current: number, total: number, width = 16): string {
  const ratio = Math.min(Math.max(current / total, 0), 1);
  const filled = Math.round(ratio * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  let quest = getCurrentQuest(userId);
  if (!quest) {
    quest = await assignDailyQuest(userId);
  }
  if (!quest) {
    await interaction.reply({
      content: '🌫️ Bạn chưa có user record — chat vài câu trước.',
      ephemeral: true,
    });
    return;
  }

  const label = QUEST_LABEL[quest.quest_type] ?? quest.quest_type;
  const bar = progressBar(quest.progress, quest.target);
  const pct = Math.round((quest.progress / quest.target) * 100);
  const status = quest.completed_at
    ? '✅ Hoàn thành'
    : `⏳ ${quest.progress}/${quest.target} (${pct}%)`;

  const description = [
    `**${label}** — đạt ${quest.target}`,
    `\`${bar}\` ${status}`,
    '',
    '**Thưởng khi hoàn thành:**',
    `• ✨ ${quest.reward_xp} XP _(tự cấp + có thể trigger lên cấp)_`,
    `• 💊 ${quest.reward_pills} đan dược`,
    `• 🪙 ${quest.reward_contribution} cống hiến`,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(quest.completed_at ? 0x2ecc71 : 0x5dade2)
    .setTitle('📋 Nhiệm vụ hằng ngày')
    .setDescription(description)
    .setFooter({
      text: quest.completed_at
        ? 'Đã hoàn thành — quay lại sau 00:00 VN cho nhiệm vụ mới.'
        : 'Tiến độ tự tăng khi bạn hoạt động trong server.',
    });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

export const command = { data, execute };
export default command;
