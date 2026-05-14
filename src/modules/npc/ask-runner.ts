import type { Attachment, ChatInputCommandInteraction } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { getBudgetStatus, isBudgetExhausted } from '../aki/budget.js';
import { askAki, isAkiEnabled, logRefusal } from '../aki/client.js';
import { runFilter } from '../aki/filter.js';
import { tryAcquireAskQuota } from '../aki/rate-limit.js';

/**
 * Phase 12 Lát 5 — shared runner for /ask, /ask-akira, /ask-meifeng.
 *
 * All NPCs share the same pipeline (filter → quota → budget → Grok) so
 * cost analytics + rate limits are unified. Only the system prompt
 * (persona) differs.
 */

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
const DISCORD_MSG_LIMIT = 2000;
const RECENT_CONTEXT_MAX = 5;
const RECENT_CONTEXT_CONTENT_LIMIT = 300;

export interface RunAskInput {
  interaction: ChatInputCommandInteraction;
  npcName: string; // "Aki" | "Akira" | "Meifeng"
  systemPromptOverride?: string;
  sleepingMessage: string;
}

function validateImage(
  att: Attachment | null,
): { ok: true; url?: string } | { ok: false; reason: string } {
  if (!att) return { ok: true };
  const type = (att.contentType ?? '').toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.includes(type)) {
    return { ok: false, reason: `Chỉ chấp nhận JPG/PNG/WebP, không phải \`${type || 'unknown'}\`` };
  }
  if (att.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      reason: `Ảnh ${(att.size / 1024 / 1024).toFixed(1)}MB > 10MB limit`,
    };
  }
  return { ok: true, url: att.url };
}

async function collectRecentContext(
  interaction: ChatInputCommandInteraction,
): Promise<Array<{ authorDisplayName: string; content: string }>> {
  const channel = interaction.channel;
  if (!channel || !('messages' in channel)) return [];
  const fetched = await channel.messages.fetch({ limit: 10 });
  const collected: Array<{ authorDisplayName: string; content: string; created: number }> = [];
  for (const msg of fetched.values()) {
    if (msg.author.bot) continue;
    if (msg.content.trim().length === 0) continue;
    if (msg.id === interaction.id) continue;
    collected.push({
      authorDisplayName: msg.member?.displayName ?? msg.author.username,
      content: msg.content.slice(0, RECENT_CONTEXT_CONTENT_LIMIT),
      created: msg.createdTimestamp,
    });
    if (collected.length >= RECENT_CONTEXT_MAX) break;
  }
  return collected
    .sort((a, b) => a.created - b.created)
    .map(({ authorDisplayName, content }) => ({ authorDisplayName, content }));
}

function chunkForDiscord(text: string): string[] {
  if (text.length <= DISCORD_MSG_LIMIT) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > DISCORD_MSG_LIMIT) {
    let cut = remaining.lastIndexOf('\n\n', DISCORD_MSG_LIMIT);
    if (cut < DISCORD_MSG_LIMIT * 0.5) cut = remaining.lastIndexOf('. ', DISCORD_MSG_LIMIT);
    if (cut < DISCORD_MSG_LIMIT * 0.5) cut = DISCORD_MSG_LIMIT;
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export async function runAskFlow(input: RunAskInput): Promise<void> {
  const { interaction, npcName, systemPromptOverride, sleepingMessage } = input;
  const question = interaction.options.getString('question', true);
  const image = interaction.options.getAttachment('image');
  const userId = interaction.user.id;

  if (!isAkiEnabled()) {
    await interaction.reply({ content: sleepingMessage, ephemeral: true });
    return;
  }

  const imgCheck = validateImage(image);
  if (!imgCheck.ok) {
    await logRefusal(userId, question.length, `image: ${imgCheck.reason}`);
    await interaction.reply({ content: `⚠️ ${imgCheck.reason}`, ephemeral: true });
    return;
  }

  const quota = tryAcquireAskQuota(userId);
  if (!quota.ok) {
    const msg =
      quota.reason === 'minute'
        ? `⏱️ Hỏi nhanh quá (${quota.callsThisMinute} câu/1 phút), đợi chút.`
        : `😴 Đủ rồi hôm nay (${quota.callsThisDay}/100 lượt/24h). Mai lại.`;
    await logRefusal(userId, question.length, `rate-limit: ${quota.reason}`);
    await interaction.reply({ content: msg, ephemeral: true });
    return;
  }

  if (isBudgetExhausted()) {
    const status = getBudgetStatus();
    await logRefusal(userId, question.length, 'budget-exhausted');
    await interaction.reply({
      content: `💸 Hết ngân sách hôm nay ($${status.todaySpent.toFixed(3)} / $${status.budget}). Mai lại.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  let filterMeta: {
    stage: 'groq' | 'gemini' | 'pre-filter' | 'fail-open' | 'disabled';
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  };
  if (imgCheck.url) {
    filterMeta = { stage: 'disabled', tokensIn: 0, tokensOut: 0, costUsd: 0 };
  } else {
    const filter = await runFilter(question);
    filterMeta = {
      stage: filter.source,
      tokensIn: filter.tokensIn,
      tokensOut: filter.tokensOut,
      costUsd: filter.costUsd,
    };
    if (!filter.legit && filter.response) {
      await logRefusal(userId, question.length, `filter: ${filter.source}`, filterMeta);
      const chunks = chunkForDiscord(filter.response);
      await interaction.editReply({ content: chunks[0] });
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({ content: chunks[i], ephemeral: false });
      }
      return;
    }
  }

  const askerUsername = interaction.user.username;
  const askerDisplayName =
    interaction.inCachedGuild() && interaction.member
      ? interaction.member.displayName
      : askerUsername;
  const recentMessages = await collectRecentContext(interaction).catch(() => []);

  try {
    const result = await askAki({
      discordId: userId,
      question,
      imageUrl: imgCheck.url,
      askerUsername,
      askerDisplayName,
      recentMessages,
      filterMeta,
      systemPromptOverride,
    });
    const chunks = chunkForDiscord(result.reply);
    // allowedMentions.parse=[] hard-blocks any @everyone / role / user
    // ping the LLM might emit. Belt-and-suspenders alongside the
    // persona system prompt that already says "no pings".
    await interaction.editReply({ content: chunks[0], allowedMentions: { parse: [] } });
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp({
        content: chunks[i],
        allowedMentions: { parse: [] },
      });
    }
  } catch (err) {
    logger.error({ err, discord_id: userId, npc: npcName }, 'ask-runner: Grok call failed');
    await interaction
      .editReply({ content: `😵 ${npcName} gặp lỗi gọi Grok... thử lại sau (；⌣́_⌣́)` })
      .catch(() => undefined);
  }
}
