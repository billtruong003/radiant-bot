import type { Guild, Message } from 'discord.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import {
  canSearchChat,
  detectSearchIntent,
  formatHitsForPrompt,
  runSearch,
} from '../archive/search-tool.js';
import { STAFF_ROLE_NAMES } from '../../config/roles.js';
import { describeAsker, readStandingFromMember } from '../insights/standing.js';
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
 * Phase 17 — talk to Aki by @-mentioning her, instead of `/ask`.
 *
 * Reuses the exact `/ask` pipeline (filter → quota → archive lookup →
 * answer), so there is ONE set of rules: same rate limits, same content
 * filter, same search privileges. Only the trigger and the reply surface
 * differ.
 *
 * TRIGGER IS DELIBERATELY NARROW — an @-mention of the bot, or a reply to
 * one of its messages. NOT "any message containing the word aki": in a
 * sect themed around Aki her name comes up constantly, and answering all
 * of it would burn the shared daily quota and drown the channel.
 *
 * ORDERING MATTERS: `messageCreate` runs automod and `maybeDivineWrath`
 * (the "someone insulted Aki" punisher) BEFORE this. That order is load
 * bearing — an insult mentioning Aki must be judged, not conversed with.
 * This handler only sees mentions that already passed both.
 */

const DISCORD_MSG_LIMIT = 2000;
// 5 was too thin to follow a conversation: when Bill tagged Aki about
// Khoa refusing to answer, she had no idea what had been asked and
// scolded him instead. 15 covers a normal back-and-forth.
const RECENT_CONTEXT_MAX = 15;
const RECENT_CONTEXT_CONTENT_LIMIT = 300;
/** Below this there's no question to answer — just a bare ping. */
const MIN_QUESTION_LEN = 2;

/** Strip the bot mention so the model doesn't see a raw `<@123…>` blob. */
function extractQuestion(message: Message, botId: string): string {
  return message.content
    .replace(new RegExp(`<@!?${botId}>`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lát 3 — turn raw Discord entity markup into names the model can read.
 * Without this, `@Aki anh <@4625…> láo kìa` reaches the model as a number
 * blob: it can't tell WHO is being talked about, and channel references
 * like <#123> (which members use constantly for "check #rules") are
 * equally opaque. Unresolvable IDs (member left, channel deleted) fall
 * back to a generic placeholder rather than leaking the raw snowflake.
 */
export function resolveDiscordEntities(text: string, guild: Guild): string {
  return text
    .replace(/<@!?(\d+)>/g, (_, id: string) => {
      const m = guild.members.cache.get(id);
      return m ? `@${m.displayName}` : '@thành-viên';
    })
    .replace(/<@&(\d+)>/g, (_, id: string) => {
      const r = guild.roles.cache.get(id);
      return r ? `@${r.name}` : '@vai-trò';
    })
    .replace(/<#(\d+)>/g, (_, id: string) => {
      const c = guild.channels.cache.get(id);
      return c && 'name' in c && c.name ? `#${c.name}` : '#kênh';
    })
    .replace(/<a?:(\w+):\d+>/g, ':$1:');
}

/**
 * Lát 2 — the message being replied to is the single highest-signal piece
 * of context there is: the user literally pointed at it. Before this, only
 * the 15 most recent messages were collected, so replying to anything
 * older produced an answer about the wrong thing entirely.
 */
async function fetchRepliedTo(
  message: Message,
  botId: string,
  guild: Guild,
): Promise<{ authorDisplayName: string; content: string } | null> {
  const refId = message.reference?.messageId;
  if (!refId) return null;
  try {
    const ref = await message.channel.messages.fetch(refId);
    if (!ref.content.trim()) return null;
    return {
      authorDisplayName:
        ref.author.id === botId ? 'Aki (bạn)' : (ref.member?.displayName ?? ref.author.username),
      content: resolveDiscordEntities(ref.content, guild).slice(0, 600),
    };
  } catch {
    return null;
  }
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

/**
 * True when this message is addressed AT the bot: a direct mention, or a
 * reply to something the bot said. Role mentions and @everyone are
 * excluded — those are broadcasts, not conversation.
 */
export function isAddressedToBot(message: Message, botId: string): boolean {
  if (message.mentions.everyone) return false;
  if (message.mentions.users.has(botId)) return true;
  const repliedTo = message.reference?.messageId;
  if (repliedTo && message.mentions.repliedUser?.id === botId) return true;
  return false;
}

async function collectRecentContext(
  message: Message,
  botId: string,
  guild: Guild,
): Promise<Array<{ authorDisplayName: string; content: string }>> {
  try {
    const fetched = await message.channel.messages.fetch({ limit: 30 });
    const collected: Array<{ authorDisplayName: string; content: string; created: number }> = [];
    for (const m of fetched.values()) {
      // Lát 1 — keep Aki's OWN messages (skip only OTHER bots). Filtering
      // all bots meant Aki never saw her previous answer, so a follow-up
      // like "còn cái đó thì sao?" had nothing to resolve "cái đó" against
      // — multi-turn was structurally impossible.
      if (m.author.bot && m.author.id !== botId) continue;
      if (m.id === message.id) continue;
      if (!m.content.trim()) continue;
      collected.push({
        authorDisplayName:
          m.author.id === botId ? 'Aki (bạn)' : (m.member?.displayName ?? m.author.username),
        content: resolveDiscordEntities(m.content, guild).slice(0, RECENT_CONTEXT_CONTENT_LIMIT),
        created: m.createdTimestamp,
      });
      if (collected.length >= RECENT_CONTEXT_MAX) break;
    }
    return collected
      .sort((a, b) => a.created - b.created)
      .map(({ authorDisplayName, content }) => ({ authorDisplayName, content }));
  } catch {
    return [];
  }
}

/**
 * Handle an @-mention. Returns true if it produced a reply, so the caller
 * can skip the XP path for what is effectively a bot command.
 *
 * Never throws — a failure here must not break message handling.
 */
export async function handleAkiMention(message: Message): Promise<boolean> {
  const botId = message.client.user?.id;
  if (!botId || !message.inGuild() || !message.member) return false;
  if (!isAddressedToBot(message, botId)) return false;
  if (!isAkiEnabled()) return false;

  // Lát 3 — resolve entity markup BEFORE anything downstream (filter,
  // triage, search intent, the answer model) so every stage reads names,
  // not snowflakes.
  const question = resolveDiscordEntities(extractQuestion(message, botId), message.guild);
  if (question.length < MIN_QUESTION_LEN) {
    // Bare ping with no question — acknowledge in character rather than
    // spending a model call on nothing.
    await message.reply({ content: 'Gọi ta có việc gì? Nói thẳng đi ✿', allowedMentions: { parse: [] } })
      .catch(() => undefined);
    return true;
  }

  const userId = message.author.id;

  // Đợt 1 guards run BEFORE the quota check: a troll shouldn't be able to
  // burn the shared daily allowance just by demanding nonsense, and a
  // refusal costs no model call at all.
  //
  // B1+B4 — absurd task ("đếm từ 1 đến 1000"), refused flatly, no haggling.
  const absurd = guardAbsurdTask(question, userId);
  if (absurd.blocked) {
    logger.info({ discord_id: userId, reason: absurd.reason }, 'guard: absurd task blocked');
    await message
      .reply({ content: absurd.reply, allowedMentions: { parse: [] } })
      .catch(() => undefined);
    return true;
  }

  // B2 — encoded payload whose plaintext is abusive. Decoded and screened
  // locally; the insult never reaches the model, let alone the channel.
  const encoded = await inspectEncodedPayload(question);
  if (encoded.blocked) {
    logger.warn({ discord_id: userId, reason: encoded.reason }, 'guard: encoded payload blocked');
    await message
      .reply({ content: encoded.reply, allowedMentions: { parse: [] } })
      .catch(() => undefined);
    return true;
  }

  // Same quota pool as /ask — mentions are far easier to fire off than a
  // slash command, so they must not get a separate, looser allowance.
  const quota = tryAcquireAskQuota(userId);
  if (!quota.ok) {
    const msg =
      quota.reason === 'minute'
        ? `⏱️ Hỏi nhanh quá (${quota.callsThisMinute} câu/1 phút), đợi chút.`
        : `😴 Đủ rồi hôm nay (${quota.callsThisDay}/100 lượt/24h). Mai lại.`;
    await logRefusal(userId, question.length, `rate-limit: ${quota.reason}`);
    await message.reply({ content: msg, allowedMentions: { parse: [] } }).catch(() => undefined);
    return true;
  }

  // Staff bypass the "is this a real question" filter.
  //
  // That filter exists to stop members burning the shared daily quota on
  // nonsense — staff are not that risk. Live on 2026-07-29 it rejected
  // the Chưởng Môn's own "@Aki anh khoa láo kìa m" as junk, which is
  // exactly the moderation-report case this feature was built for. Bill
  // has flagged the filter as over-eager before (2026-07-18).
  const isStaffAsker = [...message.member.roles.cache.values()].some((r) =>
    STAFF_ROLE_NAMES.has(r.name),
  );

  try {
    // Collected up-front (was: right before askAki) so the filter can see
    // it too. Same single fetch either way — only the order moved.
    const recentMessages = await collectRecentContext(message, botId, message.guild);
    const repliedTo = await fetchRepliedTo(message, botId, message.guild);

    // Lát 4 — the filter judges the question WITH the conversation around
    // it. A bare "còn cái đó thì sao?" looks like junk in isolation but is
    // obviously legit right after a discussion; blind filtering is how
    // "@Aki anh khoa láo kìa m" got rejected on 2026-07-29.
    const filterContext = [
      ...(repliedTo ? [`${repliedTo.authorDisplayName}: ${repliedTo.content.slice(0, 150)}`] : []),
      ...recentMessages.slice(-3).map((m) => `${m.authorDisplayName}: ${m.content.slice(0, 150)}`),
    ].join('\n');

    const filter = isStaffAsker
      ? { legit: true, response: null, tokensIn: 0, tokensOut: 0, costUsd: 0, source: 'disabled' as const }
      : await runFilter(question, filterContext);
    const filterMeta = {
      stage: filter.source,
      tokensIn: filter.tokensIn,
      tokensOut: filter.tokensOut,
      costUsd: filter.costUsd,
    };
    if (!filter.legit && filter.response) {
      await logRefusal(userId, question.length, `filter: ${filter.source}`, filterMeta);
      await message
        .reply({ content: filter.response.slice(0, DISCORD_MSG_LIMIT), allowedMentions: { parse: [] } })
        .catch(() => undefined);
      return true;
    }

    // Archive lookup — same double gate as /ask: feature flag + role.
    let searchContext = '';
    if (env.ARCHIVE_ENABLED && canSearchChat(message.member) && message.guild) {
      try {
        const intent = await detectSearchIntent(question);
        if (intent.needsSearch) {
          const found = runSearch(message.guild, intent);
          searchContext = formatHitsForPrompt(found.hits);
          logger.info(
            { discord_id: userId, hits: found.hits.length, note: found.note },
            'mention: archive lookup performed',
          );
        }
      } catch (err) {
        logger.warn({ err, discord_id: userId }, 'mention: archive lookup failed');
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

    // Typing indicator: mention replies can take several seconds and there
    // is no "thinking…" affordance like a slash command's deferred reply.
    await message.channel.sendTyping().catch(() => undefined);

    const image = message.attachments.find((a) =>
      (a.contentType ?? '').toLowerCase().startsWith('image/'),
    );

    const result = await askAki({
      discordId: userId,
      question,
      imageUrl: image?.url,
      askerUsername: message.author.username,
      askerDisplayName: message.member.displayName,
      recentMessages,
      repliedTo: repliedTo ?? undefined,
      filterMeta,
      webContext,
      askerStanding: describeAsker(
        message.member.displayName,
        readStandingFromMember(message.member),
      ),
      searchContext,
      coldMode: isInColdMode(userId),
    });

    // B3 — last gate on Aki's own words. CJK bleed gets stripped (members
    // called it out: "sao toàn taipei ching chong thế này"); anything the
    // content filter rejects means a jailbreak reached the model, so the
    // text is dropped entirely rather than shipped.
    const outVerdict = await checkOutput(result.reply);
    if (!outVerdict.ok) {
      logger.warn(
        { discord_id: userId, reason: outVerdict.reason },
        'guard: output blocked, sending safe fallback',
      );
      await message
        .reply({ content: SAFE_FALLBACK_REPLY, allowedMentions: { parse: [] } })
        .catch(() => undefined);
      return true;
    }
    if (outVerdict.reason) {
      logger.info({ discord_id: userId, reason: outVerdict.reason }, 'guard: output cleaned');
    }

    const chunks = chunkForDiscord(outVerdict.cleaned);
    // parse: [] hard-blocks any ping the model might emit.
    await message.reply({ content: chunks[0], allowedMentions: { parse: [] } });
    for (let i = 1; i < chunks.length; i++) {
      await message.channel.send({ content: chunks[i], allowedMentions: { parse: [] } });
    }

    logger.info({ discord_id: userId, chars: outVerdict.cleaned.length }, 'mention: replied');
    return true;
  } catch (err) {
    logger.error({ err, discord_id: userId }, 'mention: handler failed');
    await message
      .reply({ content: '😵 Aki gặp lỗi... thử lại sau (；⌣́_⌣́)', allowedMentions: { parse: [] } })
      .catch(() => undefined);
    return true;
  }
}
