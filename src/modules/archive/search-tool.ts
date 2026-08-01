import type { Guild, GuildMember } from 'discord.js';
import { CHAT_SEARCH_ROLE_NAMES } from '../../config/roles.js';
import { logger } from '../../utils/logger.js';
import { sanitizeForLlmBody } from '../../utils/sanitize.js';
import { llm } from '../llm/index.js';
import { type ArchivedMessage, searchMessages } from './message-archive.js';

/**
 * Phase 16 — the "go look it up" capability behind Aki.
 *
 * Turns a natural question ("ê thằng A nói xấu gì tao") into an archive
 * query, runs it, and hands the hits back as context for the answer.
 *
 * WHY INTENT-DETECTION INSTEAD OF NATIVE FUNCTION-CALLING:
 * Aki runs entirely on free models now, and their tool-calling support is
 * inconsistent — several in our chains emit hidden reasoning and never
 * produce a well-formed tool call. So the "tool" is invoked by a cheap
 * classification call that returns plain JSON, which every model in the
 * chain can do. Same effect, far fewer failure modes. If we later move to
 * models with solid function-calling, only `detectSearchIntent` changes.
 *
 * ACCESS CONTROL IS ENFORCED HERE, at the only entry point: reading
 * another member's history is limited to Chưởng Môn + Tiên Nhân (Bill's
 * call — deliberately narrower than staff, since Trưởng Lão / Chấp Pháp
 * moderate but should not be able to pull up anyone's words).
 */

/** Hits fed into an answer prompt. Small on purpose — this is context, not a dump. */
const MAX_HITS_FOR_CONTEXT = 15;
const DEFAULT_WINDOW_DAYS = 30;

export function canSearchChat(member: GuildMember | null | undefined): boolean {
  if (!member) return false;
  for (const role of member.roles.cache.values()) {
    if (CHAT_SEARCH_ROLE_NAMES.has(role.name)) return true;
  }
  return false;
}

export interface SearchIntent {
  needsSearch: boolean;
  /** Display name / nickname mentioned in the question, if any. */
  targetName?: string;
  /** Keywords to match against message text. */
  keywords?: string;
  days?: number;
}

const INTENT_SYSTEM_PROMPT = [
  'Bạn phân tích câu hỏi của quản trị viên Discord để quyết định có cần TRA LỊCH SỬ CHAT hay không.',
  '',
  'Trả về DUY NHẤT một JSON object:',
  '{"needsSearch": true/false, "targetName": "tên người bị hỏi tới hoặc null",',
  ' "keywords": "từ khoá cần tìm hoặc null", "days": số ngày cần tra (mặc định 30)}',
  '',
  'needsSearch = true khi câu hỏi nhắc tới việc AI ĐÓ ĐÃ NÓI GÌ, ai nói xấu, ai nhắc tới chủ đề gì,',
  'tìm lại tin nhắn cũ, ai phàn nàn về cái gì.',
  'needsSearch = false với câu hỏi kiến thức chung, hỏi về game/server, hoặc tán gẫu.',
  'Chỉ in JSON. Không giải thích.',
].join('\n');

/** Classify whether the question needs a history lookup. */
export async function detectSearchIntent(question: string): Promise<SearchIntent> {
  try {
    const result = await llm.complete('aki-triage', {
      systemPrompt: INTENT_SYSTEM_PROMPT,
      userPrompt: question,
      maxOutputTokens: 600,
      temperature: 0,
    });
    if (!result) return { needsSearch: false };
    return parseIntent(result.text);
  } catch {
    // A failed classification must not break the answer path — just skip
    // the lookup and let Aki answer normally.
    return { needsSearch: false };
  }
}

export function parseIntent(raw: string): SearchIntent {
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return { needsSearch: false };
  try {
    const p = JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
    if (p.needsSearch !== true) return { needsSearch: false };
    const days = typeof p.days === 'number' && p.days > 0 ? Math.min(p.days, 90) : DEFAULT_WINDOW_DAYS;
    return {
      needsSearch: true,
      targetName: typeof p.targetName === 'string' && p.targetName ? p.targetName : undefined,
      keywords: typeof p.keywords === 'string' && p.keywords ? p.keywords : undefined,
      days,
    };
  } catch {
    return { needsSearch: false };
  }
}

/**
 * Resolve a name the model extracted ("thằng A", "Khoa") to a member id.
 * Returns null when it can't be resolved — the search then runs
 * keyword-only rather than silently searching the wrong person.
 */
export function resolveMemberByName(guild: Guild, name: string): string | null {
  const needle = name.toLowerCase().trim();
  if (!needle) return null;
  let fallback: string | null = null;
  for (const m of guild.members.cache.values()) {
    const display = m.displayName.toLowerCase();
    const username = m.user.username.toLowerCase();
    if (display === needle || username === needle) return m.id;
    if (!fallback && (display.includes(needle) || username.includes(needle))) fallback = m.id;
  }
  return fallback;
}

export interface SearchToolResult {
  ran: boolean;
  hits: ArchivedMessage[];
  /** Human-readable note about what was searched, for the reply footer. */
  note: string;
}

/**
 * Run the lookup for an already-authorised caller.
 *
 * NOTE: authorisation is the caller's job via `canSearchChat` — this
 * function does not re-check, so never call it on an unchecked path.
 */
export function runSearch(guild: Guild, intent: SearchIntent): SearchToolResult {
  if (!intent.needsSearch) return { ran: false, hits: [], note: '' };

  const authorId = intent.targetName ? resolveMemberByName(guild, intent.targetName) : null;
  const hits = searchMessages({
    query: intent.keywords,
    authorId: authorId ?? undefined,
    days: intent.days,
    limit: MAX_HITS_FOR_CONTEXT,
  });

  const parts: string[] = [];
  if (intent.targetName) {
    parts.push(authorId ? `người: ${intent.targetName}` : `không tìm thấy "${intent.targetName}"`);
  }
  if (intent.keywords) parts.push(`từ khoá: ${intent.keywords}`);
  parts.push(`${intent.days} ngày`);

  logger.info(
    { target: intent.targetName, resolved: !!authorId, keywords: intent.keywords, hits: hits.length },
    'archive: search tool ran',
  );

  return { ran: true, hits, note: parts.join(' · ') };
}

/**
 * Format hits as a context block for the answer prompt.
 *
 * Content is sanitised: archived messages are other people's text, so it
 * goes through the same prompt-injection guard as any user input — a
 * member could otherwise plant "ignore previous instructions" in chat and
 * have it replayed into Aki's prompt weeks later.
 */
export function formatHitsForPrompt(hits: readonly ArchivedMessage[]): string {
  if (hits.length === 0) {
    return '[Đã tra lịch sử chat nhưng KHÔNG tìm thấy tin nhắn nào khớp. Hãy nói thẳng là không tìm thấy, ĐỪNG bịa.]';
  }
  const lines = hits.map((h) => {
    const when = new Date(h.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    return `  [${when}] ${h.authorName} @${h.channelName}: ${sanitizeForLlmBody(h.content, { maxLen: 200 })}`;
  });
  return [
    '[Kết quả tra lịch sử chat (dữ liệu THẬT, hãy dựa vào đây để trả lời):',
    ...lines,
    ']',
  ].join('\n');
}

export const __for_testing = { parseIntent, formatHitsForPrompt };
