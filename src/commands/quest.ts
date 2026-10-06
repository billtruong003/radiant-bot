import { type ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { withCard } from '../modules/cards/attach.js';
import { renderQuestCard } from '../modules/cards/daily-cards.js';
import {
  assignDailyQuest,
  getCurrentQuest,
  questLabel,
  vnDayStart,
} from '../modules/quests/daily-quest.js';

/**
 * /quest — show today's daily quest + progress. Auto-assigns one if
 * the user has no quest for today yet (covers the case where the cron
 * hasn't fired or the user is brand new).
 */

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

  const label = questLabel(quest);
  const bar = progressBar(quest.progress, quest.target);
  const pct = Math.round((quest.progress / quest.target) * 100);
  const status = quest.completed_at
    ? '✅ Hoàn thành'
    : `⏳ ${quest.progress}/${quest.target} (${pct}%)`;

  const description = [
    `**${label}**`,
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

  const left = vnDayStart(Date.now()) + 24 * 3600_000 - Date.now();
  const card = await renderQuestCard({
    name: interaction.user.displayName,
    resetIn: `${Math.floor(left / 3600_000)} giờ ${Math.floor((left % 3600_000) / 60_000)} phút`,
    quests: [
      {
        group: 'Hằng ngày',
        label,
        progress: quest.progress,
        target: quest.target,
        done: quest.completed_at !== null,
        xp: quest.reward_xp,
        pills: quest.reward_pills,
        coins: quest.reward_contribution,
      },
    ],
  });
  await interaction.reply({ ...withCard(embed, card), ephemeral: true });
}

export const command = { data, execute };
export default command;
