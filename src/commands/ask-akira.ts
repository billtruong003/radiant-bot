import { type ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { AKIRA_SYSTEM_PROMPT } from '../modules/npc/akira-persona.js';
import { runAskFlow } from '../modules/npc/ask-runner.js';

/**
 * /ask-akira — alt NPC with scholarly/formal persona. Shares the same
 * pipeline (filter + quota + budget + Grok) as /ask, only the system
 * prompt differs.
 */

export const data = new SlashCommandBuilder()
  .setName('ask-akira')
  .setDescription('Hỏi Akira (học sĩ trầm tĩnh của tông môn) — Grok 4.1 Fast Reasoning')
  .setDMPermission(false)
  .addStringOption((opt) =>
    opt
      .setName('question')
      .setDescription('Câu hỏi (Akira giảng giải kiên nhẫn)')
      .setRequired(true)
      .setMaxLength(500),
  )
  .addAttachmentOption((opt) =>
    opt.setName('image').setDescription('(Tùy chọn) Hình ảnh — JPG/PNG/WebP ≤ 10MB'),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await runAskFlow({
    interaction,
    npcName: 'Akira',
    systemPromptOverride: AKIRA_SYSTEM_PROMPT,
    sleepingMessage: '🕯️ Akira đang nhập định... (chủ nhân Bill chưa setup API key)',
  });
}

export const command = { data, execute };
export default command;
