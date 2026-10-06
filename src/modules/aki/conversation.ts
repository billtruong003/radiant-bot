import type { Guild, Message } from 'discord.js';

/**
 * ONE conversation/context builder for every way of talking to Aki:
 * `@Aki`, replying to Aki, `/ask aki`, `/ask akira`, `/ask meifeng`.
 *
 * Before this there were three near-copies of `collectRecentContext`, and
 * they had drifted into different products:
 *
 *   mention-handler  limit 30 → 15 turns, KEEPS Aki's own replies,
 *                    resolves <@123> markup, fetches the replied-to message
 *   ask-runner       limit 30 → 15 turns, DROPS Aki's replies, raw markup
 *   ask.ts           limit 10 →  5 turns, DROPS Aki's replies, raw markup
 *
 * Dropping the assistant's own turns makes multi-turn structurally
 * impossible: "còn cái đó thì sao?" has nothing to resolve "cái đó"
 * against, so `/ask aki` could not do follow-ups at all while `@Aki` could.
 *
 * Selection is relevance-scored rather than last-N. Deterministic integer
 * scoring on data Discord already gave us — no vector store, no extra
 * model pass. The ranking that matters: a message the user directly
 * replied to outranks newer unrelated chatter, always.
 */

export interface ConversationTurn {
  messageId: string;
  authorId: string;
  authorName: string;
  role: 'user' | 'assistant' | 'other';
  content: string;
  timestamp: number;
  replyToMessageId?: string;
}

/** How many raw messages to pull before scoring. */
const FETCH_LIMIT = 30;
/** How many turns survive into the prompt. */
export const MAX_SELECTED_TURNS = 15;
/** Per-turn character cap. */
const TURN_CONTENT_LIMIT = 300;
/** Total character budget for the conversation block (spec §13). */
const CONTEXT_CHAR_BUDGET = 3000;

/**
 * Turn raw Discord entity markup into names the model can read. Without
 * this, `anh <@4625…> láo kìa` reaches the model as a number blob and it
 * cannot tell who is being discussed. Unresolvable ids degrade to a
 * placeholder rather than leaking a raw snowflake.
 */
export function resolveDiscordEntities(text: string, guild: Guild | null): string {
  if (!guild) return text.replace(/<a?:(\w+):\d+>/g, ':$1:');
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

/** Minimal shape we need from a channel — keeps this testable. */
interface FetchableChannel {
  messages: {
    fetch: {
      (options: { limit: number }): Promise<Map<string, Message> | Iterable<[string, Message]>>;
      (id: string): Promise<Message>;
    };
  };
}

function isFetchable(channel: unknown): channel is FetchableChannel {
  return typeof channel === 'object' && channel !== null && 'messages' in channel;
}

export interface CollectInput {
  channel: unknown;
  guild: Guild | null;
  botId: string;
  /** Message/interaction id to exclude (the request itself). */
  excludeId?: string;
}

/**
 * Pull recent channel history as normalized turns. Keeps Aki's own
 * messages (role 'assistant'), drops OTHER bots.
 */
export async function collectTurns(input: CollectInput): Promise<ConversationTurn[]> {
  if (!isFetchable(input.channel)) return [];
  try {
    const fetched = await input.channel.messages.fetch({ limit: FETCH_LIMIT });
    const turns: ConversationTurn[] = [];
    for (const [, m] of fetched as Iterable<[string, Message]>) {
      const isSelf = m.author.id === input.botId;
      if (m.author.bot && !isSelf) continue;
      if (input.excludeId && m.id === input.excludeId) continue;
      if (!m.content.trim()) continue;
      turns.push({
        messageId: m.id,
        authorId: m.author.id,
        authorName: isSelf ? 'Aki (bạn)' : (m.member?.displayName ?? m.author.username),
        role: isSelf ? 'assistant' : 'user',
        content: resolveDiscordEntities(m.content, input.guild).slice(0, TURN_CONTENT_LIMIT),
        timestamp: m.createdTimestamp,
        ...(m.reference?.messageId ? { replyToMessageId: m.reference.messageId } : {}),
      });
    }
    return turns.sort((a, b) => a.timestamp - b.timestamp);
  } catch {
    return [];
  }
}

/** Fetch the message the user replied to, as a turn. */
export async function fetchRepliedTo(
  message: Message,
  botId: string,
  guild: Guild | null,
): Promise<ConversationTurn | null> {
  const refId = message.reference?.messageId;
  if (!refId) return null;
  if (!isFetchable(message.channel)) return null;
  try {
    const ref = await message.channel.messages.fetch(refId);
    if (!ref.content.trim()) return null;
    const isSelf = ref.author.id === botId;
    return {
      messageId: ref.id,
      authorId: ref.author.id,
      authorName: isSelf ? 'Aki (bạn)' : (ref.member?.displayName ?? ref.author.username),
      role: isSelf ? 'assistant' : 'user',
      content: resolveDiscordEntities(ref.content, guild).slice(0, 600),
      timestamp: ref.createdTimestamp,
    };
  } catch {
    return null;
  }
}

export interface ScoreInput {
  turns: readonly ConversationTurn[];
  askerId: string;
  botId: string;
  /** Id of the message being replied to, if any. */
  repliedToId?: string;
  /** The current question — used for lexical overlap. */
  question: string;
  now: number;
}

const STOPWORDS = new Set([
  'the','a','an','is','are','was','were','and','or','but','of','to','in','on','for','with','it','this','that',
  'là','và','có','không','thì','mà','của','cho','với','như','được','bị','ở','ra','vào','đi','các','những','một',
  'em','anh','chị','ông','bà','tôi','mình','bạn','nó','ai','gì','sao','nào','vậy','à','ừ','ạ','nhé','nha',
]);

function contentWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/**
 * Deterministic relevance score. Weights are ordered by how much signal
 * each carries, not tuned to decimals — the ordering is what matters:
 *
 *   directly replied-to  >  reply-chain member  >  Aki's replies to this
 *   asker  >  this asker's own messages  >  topic overlap  >  recency
 *
 * Recency is the WEAKEST term on purpose. It used to be the only term,
 * which is how "unrelated newer chatter" displaced the message the user
 * was actually pointing at.
 */
export function scoreTurn(turn: ConversationTurn, input: ScoreInput): number {
  let score = 0;

  if (input.repliedToId && turn.messageId === input.repliedToId) score += 100;
  // Part of the reply chain around the request.
  if (input.repliedToId && turn.replyToMessageId === input.repliedToId) score += 40;
  if (turn.replyToMessageId && turn.replyToMessageId === input.repliedToId) score += 40;

  // Aki's own prior answers — required for follow-up resolution.
  if (turn.role === 'assistant') score += 25;
  // The asker's own messages: their thread of thought.
  if (turn.authorId === input.askerId) score += 20;

  // Topic overlap with the current question.
  const qWords = contentWords(input.question);
  if (qWords.size > 0) {
    const tWords = contentWords(turn.content);
    let shared = 0;
    for (const w of tWords) if (qWords.has(w)) shared++;
    score += Math.min(shared, 6) * 5;
  }

  // Recency: decays over ~30 minutes, capped low so it can never outrank
  // an explicit pointer.
  const ageMin = Math.max(0, (input.now - turn.timestamp) / 60_000);
  score += Math.max(0, 15 - ageMin / 2);

  return score;
}

/**
 * Rank by relevance, keep the best, then restore chronological order so
 * the model reads a conversation rather than a leaderboard.
 *
 * Also enforces the character budget: low-value turns are DISCARDED whole
 * rather than every turn being truncated into uselessness.
 */
export function selectRelevantTurns(input: ScoreInput): ConversationTurn[] {
  const ranked = [...input.turns]
    .map((t) => ({ t, s: scoreTurn(t, input) }))
    .sort((a, b) => b.s - a.s);

  const kept: ConversationTurn[] = [];
  let chars = 0;
  for (const { t } of ranked) {
    if (kept.length >= MAX_SELECTED_TURNS) break;
    if (chars + t.content.length > CONTEXT_CHAR_BUDGET) continue;
    kept.push(t);
    chars += t.content.length;
  }
  return kept.sort((a, b) => a.timestamp - b.timestamp);
}

export interface BuiltContext {
  recentMessages: Array<{ authorDisplayName: string; content: string }>;
  repliedTo?: { authorDisplayName: string; content: string };
  /** Diagnostics for /ai debug. */
  stats: { fetched: number; selected: number };
}

/**
 * The single entry point every invocation path uses.
 *
 * `triggerMessage` is present only on the @-mention path (slash commands
 * have no reply target); everything else behaves identically either way,
 * which is the entire point of this module.
 */
export async function buildConversationContext(params: {
  channel: unknown;
  guild: Guild | null;
  botId: string;
  askerId: string;
  question: string;
  excludeId?: string;
  triggerMessage?: Message;
  now?: number;
}): Promise<BuiltContext> {
  const now = params.now ?? Date.now();
  const turns = await collectTurns({
    channel: params.channel,
    guild: params.guild,
    botId: params.botId,
    ...(params.excludeId ? { excludeId: params.excludeId } : {}),
  });

  const repliedToTurn = params.triggerMessage
    ? await fetchRepliedTo(params.triggerMessage, params.botId, params.guild)
    : null;

  const selected = selectRelevantTurns({
    turns,
    askerId: params.askerId,
    botId: params.botId,
    ...(repliedToTurn ? { repliedToId: repliedToTurn.messageId } : {}),
    question: params.question,
    now,
  });

  return {
    recentMessages: selected.map((t) => ({
      authorDisplayName: t.authorName,
      content: t.content,
    })),
    ...(repliedToTurn
      ? {
          repliedTo: {
            authorDisplayName: repliedToTurn.authorName,
            content: repliedToTurn.content,
          },
        }
      : {}),
    stats: { fetched: turns.length, selected: selected.length },
  };
}
