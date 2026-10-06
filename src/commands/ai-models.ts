import { type ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { snapshot } from '../modules/llm/health.js';
import { MODEL_REGISTRY, auditModelRegistry } from '../modules/llm/registry.js';
import { TASK_ROUTES } from '../modules/llm/router.js';
import { requireSectMaster } from '../utils/command-guard.js';
import { themedEmbed } from '../utils/embed.js';

/**
 * /ai models — live view of the zero-cost pool: what is enabled, what is
 * blocked and why, which model currently leads each workload, and which
 * ones are cooling down after failures.
 *
 * The "Paid models: BLOCKED" line is stated explicitly rather than implied,
 * because that is the one property of this system worth being able to
 * verify at a glance.
 */

export const data = new SlashCommandBuilder()
  .setName('ai-models')
  .setDescription('Tình trạng pool model free + champion mỗi loại việc (Chưởng Môn)')
  .setDMPermission(false);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await requireSectMaster(interaction))) return;
  await interaction.deferReply({ ephemeral: true });

  const audit = auditModelRegistry();
  const health = new Map(snapshot().map((h) => [h.modelId, h]));

  const enabledLines = audit.freeEnabled.map((id) => {
    const cfg = MODEL_REGISTRY.find((m) => m.id === id);
    const h = health.get(id);
    const state = !h
      ? 'idle'
      : h.healthy
        ? `ok ${h.latencyEmaMs}ms ${(h.failureRate * 100).toFixed(0)}%err`
        : `⛔ ${Math.ceil(h.cooldownRemainingMs / 1000)}s`;
    return `${id.padEnd(30)} ${(cfg?.provider ?? '?').padEnd(13)} ${state}`;
  });

  // Champion = index 0 of each answer chain.
  const championLines = Object.entries(TASK_ROUTES)
    .filter(([task]) => task.startsWith('aki-answer') || task === 'aki-triage')
    .map(([task, chain]) => `${task.padEnd(24)} ${chain[0] ?? '—'}`);

  const blockedLines = [
    ...audit.paidBlocked.map((id) => `${id} — paid`),
    ...audit.unknownBlocked.map((id) => `${id} — unknown cost`),
    ...audit.disabledBlocked.map((id) => `${id} — disabled`),
  ];

  const embed = themedEmbed('admin', {
    title: '🤖 AI models — FREE_ONLY',
    description: [
      `**Model free đang bật (${audit.freeEnabled.length})**`,
      '```',
      ...enabledLines,
      '```',
      '**Champion mỗi loại việc**',
      '```',
      ...championLines,
      '```',
      `**Bị chặn (${blockedLines.length})**`,
      '```',
      ...blockedLines.slice(0, 15),
      '```',
      '**Paid models: BLOCKED** — mọi lời gọi đều qua `assertModelAllowedForProduction()`;',
      'model không nằm trong registry mặc định bị coi là unknown-cost và chặn.',
    ].join('\n'),
  });

  await interaction.editReply({ embeds: [embed] });
}

export const command = { data, execute };
export default command;
