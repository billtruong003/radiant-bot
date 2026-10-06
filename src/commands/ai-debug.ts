import { type ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { analyzeRequest, taskForAnalysis } from '../modules/aki/request-analysis.js';
import { snapshot } from '../modules/llm/health.js';
import { auditModelRegistry, getModelConfig } from '../modules/llm/registry.js';
import { TASK_ROUTES } from '../modules/llm/router.js';
import { themedEmbed } from '../utils/embed.js';
import { requireSectMaster } from '../utils/command-guard.js';

/**
 * /ai debug <question> — show exactly how a question would be routed,
 * without answering it.
 *
 * Built because the routing decisions were previously invisible: when a
 * member said an answer was bad there was no way to tell whether the
 * problem was the classifier, the chain order, or a model that was quietly
 * cooling down. This prints all three.
 *
 * Sect-master only: it exposes the internal model topology.
 */

export const data = new SlashCommandBuilder()
  .setName('ai-debug')
  .setDescription('Xem câu hỏi sẽ được định tuyến thế nào (Chưởng Môn)')
  .setDMPermission(false)
  .addStringOption((opt) =>
    opt.setName('question').setDescription('Câu hỏi cần soi').setRequired(true).setMaxLength(500),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await requireSectMaster(interaction))) return;

  const question = interaction.options.getString('question', true);
  await interaction.deferReply({ ephemeral: true });

  const analysis = await analyzeRequest({
    question,
    hasImage: false,
    hasReply: false,
    recentCount: 0,
  });
  const task = taskForAnalysis(analysis);
  const chain = TASK_ROUTES[task];
  const health = new Map(snapshot().map((h) => [h.modelId, h]));

  const chainLines = chain.map((modelId, i) => {
    const cfg = getModelConfig(modelId);
    const h = health.get(modelId);
    const state = !h ? 'chưa gọi' : h.healthy ? `ok ~${h.latencyEmaMs}ms` : `⛔ nghỉ ${Math.ceil(h.cooldownRemainingMs / 1000)}s`;
    return `${i === 0 ? '▶' : ' '} ${modelId} · ${cfg?.provider} · ${state}`;
  });

  const audit = auditModelRegistry();

  const embed = themedEmbed('admin', {
    title: '🔍 AI routing debug',
    description: [
      `**Câu hỏi:** ${question.slice(0, 200)}`,
      '',
      '```',
      `intent            ${analysis.intent}`,
      `complexity        ${analysis.complexity}`,
      `contextDependency ${analysis.contextDependency}`,
      `isFollowUp        ${analysis.isFollowUp}`,
      `needsWeb          ${analysis.needsWeb}`,
      `needsArchive      ${analysis.needsArchive}`,
      `ambiguity         ${analysis.ambiguity}`,
      `confidence        ${analysis.confidence}`,
      `source            ${analysis.source}${analysis.source === 'preflight' ? '  (0 model call)' : ''}`,
      '```',
      `**Chain →** \`${task}\``,
      '```',
      ...chainLines,
      '```',
      `Paid models: **BLOCKED** (${audit.paidBlocked.length} paid, ${audit.unknownBlocked.length} unknown-cost)`,
    ].join('\n'),
  });

  await interaction.editReply({ embeds: [embed] });
}

export const command = { data, execute };
export default command;
