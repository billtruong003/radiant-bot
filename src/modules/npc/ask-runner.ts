import type { Attachment, ChatInputCommandInteraction } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';
import { STAFF_ROLE_NAMES } from '../../config/roles.js';
import { describeAsker, readStandingFromMember } from '../insights/standing.js';
import {
  canSearchChat,
  detectSearchIntent,
  formatHitsForPrompt,
  runSearch,
} from '../archive/search-tool.js';
import type { LlmFilterStage } from '../llm/types.js';
import { getBudgetStatus, isBudgetExhausted } from '../aki/budget.js';
import {
  detectWebIntent,
  formatWebForPrompt,
  isWebSearchEnabled,
  searchWeb,
} from '../web/web-search.js';
import { askAki, isAkiEnabled, logRefusal } from '../aki/client.js';
import {
  SAFE_FALLBACK_REPLY,
  checkOutput,
  guardAbsurdTask,
  inspectEncodedPayload,
  isInColdMode,
} from '../aki/guards.js';
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
const RECENT_CONTEXT_MAX = 15;
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
  const fetched = await channel.messages.fetch({ limit: 30 });
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

  // Đợt 1 guards — same rules as the @-mention path, so a troll can't just
  // switch to /ask to get around them. Both run before the quota check.
  const absurd = guardAbsurdTask(question, userId);
  if (absurd.blocked) {
    logger.info({ discord_id: userId, reason: absurd.reason }, 'guard: absurd task blocked');
    await interaction.reply({ content: absurd.reply });
    return;
  }
  const encoded = await inspectEncodedPayload(question);
  if (encoded.blocked) {
    logger.warn({ discord_id: userId, reason: encoded.reason }, 'guard: encoded payload blocked');
    await interaction.reply({ content: encoded.reply });
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
    stage: LlmFilterStage;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  };
  // Staff skip the junk filter — see mention-handler.ts for the rationale
  // (it rejected the Chưởng Môn's own moderation report as nonsense).
  const askerIsStaff =
    interaction.inCachedGuild() && interaction.member
      ? [...interaction.member.roles.cache.values()].some((r) => STAFF_ROLE_NAMES.has(r.name))
      : false;

  if (imgCheck.url || askerIsStaff) {
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

  // Phase 16 — archive lookup. Gated twice: the feature flag, and the
  // asker's role. Only Chưởng Môn / Tiên Nhân may pull another member's
  // history, so an unprivileged asker never even triggers the intent call.
  let searchContext = '';
  if (
    env.ARCHIVE_ENABLED &&
    interaction.inCachedGuild() &&
    canSearchChat(interaction.member) &&
    interaction.guild
  ) {
    try {
      const intent = await detectSearchIntent(question);
      if (intent.needsSearch) {
        const found = runSearch(interaction.guild, intent);
        searchContext = formatHitsForPrompt(found.hits);
        logger.info(
          { discord_id: userId, hits: found.hits.length, note: found.note },
          'ask-runner: archive lookup performed',
        );
      }
    } catch (err) {
      // Lookup is an enhancement — never let it break the answer.
      logger.warn({ err, discord_id: userId }, 'ask-runner: archive lookup failed');
    }
  }

  // Phase 18 — web lookup. Runs for ANY member (unlike the archive
  // search, which is privileged): looking something up on the internet
  // reveals nothing private about anyone here.
  let webContext = '';
  if (isWebSearchEnabled()) {
    try {
      const webIntent = await detectWebIntent(question);
      if (webIntent.needsWeb && webIntent.query) {
        const found = await searchWeb(webIntent.query);
        webContext = formatWebForPrompt(found, webIntent.query);
        logger.info(
          { query: webIntent.query, hits: found?.hits.length ?? 0 },
          'web-search: lookup performed',
        );
      }
    } catch (err) {
      logger.warn({ err }, 'web-search: lookup failed');
    }
  }

  try {
    const result = await askAki({
      discordId: userId,
      question,
      imageUrl: imgCheck.url,
      askerUsername,
      askerDisplayName,
      recentMessages,
      filterMeta,
      webContext,
      askerStanding:
        interaction.inCachedGuild() && interaction.member
          ? describeAsker(interaction.member.displayName, readStandingFromMember(interaction.member))
          : undefined,
      searchContext,
      coldMode: isInColdMode(userId),
      systemPromptOverride,
    });

    // B3 — screen Aki's own output before it reaches the channel.
    const outVerdict = await checkOutput(result.reply);
    if (!outVerdict.ok) {
      logger.warn(
        { discord_id: userId, reason: outVerdict.reason },
        'guard: output blocked, sending safe fallback',
      );
      await interaction.editReply({ content: SAFE_FALLBACK_REPLY });
      return;
    }

    const chunks = chunkForDiscord(outVerdict.cleaned);
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
    logger.error({ err, discord_id: userId, npc: npcName }, 'ask-runner: LLM call failed');
    await interaction
      .editReply({ content: `😵 ${npcName} gặp lỗi... thử lại sau (；⌣́_⌣́)` })
      .catch(() => undefined);
  }
}
