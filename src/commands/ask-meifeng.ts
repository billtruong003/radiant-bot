import { type ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { runAskFlow } from '../modules/npc/ask-runner.js';
import { MEIFENG_SYSTEM_PROMPT } from '../modules/npc/meifeng-persona.js';

/**
 * /ask-meifeng — alt NPC, combat-focused / sharp sass. Best for /stat
 * /duel /shop questions; same pipeline as /ask.
 */

export const data = new SlashCommandBuilder()
  .setName('ask-meifeng')
  .setDescription('Hỏi Meifeng (kiếm sĩ sắc bén của tông môn) — Grok 4.1 Fast Reasoning')
  .setDMPermission(false)
  .addStringOption((opt) =>
    opt
      .setName('question')
      .setDescription('Câu hỏi (Meifeng giỏi nhất combat / lực chiến / PvP)')
      .setRequired(true)
      .setMaxLength(500),
  )
  .addAttachmentOption((opt) =>
    opt.setName('image').setDescription('(Tùy chọn) Hình ảnh — JPG/PNG/WebP ≤ 10MB'),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await runAskFlow({
    interaction,
    npcName: 'Meifeng',
    systemPromptOverride: MEIFENG_SYSTEM_PROMPT,
    sleepingMessage: '⚔️ Meifeng đang luyện kiếm... (chủ nhân Bill chưa setup API key)',
  });
}

export const command = { data, execute };
export default command;
