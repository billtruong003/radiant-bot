import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { sanitizeForLlmBody } from '../../utils/sanitize.js';
import { llm } from '../llm/index.js';

/**
 * Phase 18 — Aki can look things up on the web.
 *
 * Until now Aki only knew her training data plus this server's context,
 * so anything recent ("Unity 6 ra khi nào", "giá con GPU này") was either
 * a guess or a refusal. This adds a real lookup via Tavily.
 *
 * Same shape as the archive search tool: a cheap classification call
 * decides whether a lookup is needed, we run it, and the results go into
 * the answer prompt as facts. Deliberately NOT native function-calling —
 * the free models Aki runs on are unreliable at emitting tool calls (some
 * spend their whole budget on hidden reasoning and return nothing).
 *
 * Tavily returns a synthesised `answer` plus source snippets. We pass both
 * so Aki can cite where something came from rather than asserting it
 * bare — and so a wrong answer is traceable.
 */

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
/** Sources fed into the prompt. More than this just crowds the context. */
const MAX_RESULTS = 4;
const MAX_SNIPPET_LEN = 400;
const TIMEOUT_MS = 15_000;

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResult {
  answer: string | null;
  hits: WebSearchHit[];
}

export function isWebSearchEnabled(): boolean {
  return env.TAVILY_API_KEY.length > 0;
}

/** Run a web search. Returns null on any failure — never throws. */
export async function searchWeb(query: string): Promise<WebSearchResult | null> {
  if (!isWebSearchEnabled()) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(TAVILY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: env.TAVILY_API_KEY,
        query,
        max_results: MAX_RESULTS,
        include_answer: true,
        search_depth: 'basic',
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'web-search: tavily returned non-OK');
      return null;
    }
    const data = (await res.json()) as {
      answer?: unknown;
      results?: { title?: unknown; url?: unknown; content?: unknown }[];
    };
    const hits: WebSearchHit[] = (data.results ?? [])
      .slice(0, MAX_RESULTS)
      .map((r) => ({
        title: typeof r.title === 'string' ? r.title : '',
        url: typeof r.url === 'string' ? r.url : '',
        snippet: typeof r.content === 'string' ? r.content.slice(0, MAX_SNIPPET_LEN) : '',
      }))
      .filter((h) => h.url.length > 0);

    return {
      answer: typeof data.answer === 'string' && data.answer.trim() ? data.answer.trim() : null,
      hits,
    };
  } catch (err) {
    logger.warn({ err }, 'web-search: request failed');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Today's date, Vietnam time.
 *
 * Without this the model dates its own search queries from its training
 * cutoff. On 2026-08-01 a member asked Aki to compare the strongest
 * current models; she searched "best AI models 2025", got last year's
 * results, and presented them as current. His reply was "cái đéo mà bịa à".
 */
export function todayInVietnam(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(now);
}

const WEB_INTENT_PROMPT_BASE = [
  'Bạn quyết định xem câu hỏi có CẦN TRA CỨU INTERNET hay không.',
  '',
  'Trả về DUY NHẤT JSON: {"needsWeb": true/false, "query": "câu truy vấn tìm kiếm hoặc null"}',
  '',
  'needsWeb = true khi câu hỏi về: tin tức/sự kiện, phiên bản phần mềm mới, giá cả,',
  'tài liệu/docs cụ thể, số liệu thực tế, hoặc bất cứ thứ gì thay đổi theo thời gian.',
  'needsWeb = false với: tán gẫu, hỏi về server/game này, kiến thức lập trình phổ thông',
  'không cần số liệu mới, hoặc hỏi về thành viên trong server.',
  '',
  'query nên viết NGẮN GỌN bằng tiếng Anh nếu là chủ đề kỹ thuật (kết quả tốt hơn).',
  'TUYỆT ĐỐI KHÔNG tự thêm năm vào query theo trí nhớ của bạn — trí nhớ đó đã cũ.',
  'Nếu câu hỏi ngụ ý "mới nhất/hiện nay", dùng đúng năm hôm nay ghi ở trên.',
  'Chỉ in JSON.',
].join('\n');

function webIntentPrompt(): string {
  return `HÔM NAY LÀ ${todayInVietnam()} (múi giờ Việt Nam).\n\n${WEB_INTENT_PROMPT_BASE}`;
}

export interface WebIntent {
  needsWeb: boolean;
  query?: string;
}

export function parseWebIntent(raw: string): WebIntent {
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return { needsWeb: false };
  try {
    const p = JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
    if (p.needsWeb !== true) return { needsWeb: false };
    const query = typeof p.query === 'string' && p.query.trim() ? p.query.trim() : undefined;
    // No query means nothing to search for — treat as no-op rather than
    // firing a request with an empty string.
    if (!query) return { needsWeb: false };
    return { needsWeb: true, query };
  } catch {
    return { needsWeb: false };
  }
}

/** Decide whether this question needs the web. Fails closed. */
export async function detectWebIntent(question: string): Promise<WebIntent> {
  try {
    const result = await llm.complete('aki-triage', {
      systemPrompt: webIntentPrompt(),
      userPrompt: question,
      maxOutputTokens: 600,
      temperature: 0,
    });
    if (!result) return { needsWeb: false };
    return parseWebIntent(result.text);
  } catch {
    return { needsWeb: false };
  }
}

/**
 * Format results as a context block.
 *
 * Snippets are third-party web content going into a prompt, so they pass
 * through the injection guard exactly like archived member messages — a
 * page could otherwise carry "ignore previous instructions".
 */
export function formatWebForPrompt(result: WebSearchResult | null, query: string): string {
  if (!result || (result.hits.length === 0 && !result.answer)) {
    return '[Đã tra internet nhưng KHÔNG tìm được thông tin. Hãy nói thẳng là không tra được, ĐỪNG bịa.]';
  }
  const lines = [`[Kết quả tra internet cho "${sanitizeForLlmBody(query, { maxLen: 120 })}":`];
  if (result.answer) {
    lines.push(`  Tóm tắt: ${sanitizeForLlmBody(result.answer, { maxLen: 600 })}`);
  }
  for (const h of result.hits) {
    lines.push(`  - ${sanitizeForLlmBody(h.title, { maxLen: 120 })} (${h.url})`);
    if (h.snippet) lines.push(`    ${sanitizeForLlmBody(h.snippet, { maxLen: 300 })}`);
  }
  lines.push(
    '  LƯU Ý: đây là dữ liệu THẬT lấy từ internet. Dựa vào đây để trả lời và',
    '  nêu nguồn khi cần. KHÔNG bịa thêm thông tin ngoài các nguồn trên.]',
  );
  return lines.join('\n');
}

export const __for_testing = { parseWebIntent, formatWebForPrompt };
