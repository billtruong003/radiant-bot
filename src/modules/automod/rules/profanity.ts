import type { Message } from 'discord.js';
import { loadAutomodConfig } from '../../../config/automod.js';
import { recordHit } from '../profanity-counter.js';
import type { AutomodRule, RuleHit } from '../types.js';

/**
 * Profanity filter: word-list match with word-boundary anchoring so
 * partial matches don't fire (e.g. `class` doesn't match `ass`).
 *
 * Match is case-insensitive + diacritic-tolerant for Vietnamese (so
 * `địt` matches `DIT` and `Địt`). Word list is JSON-config; lookup is
 * O(words) per message which is fine for ~50 word lists.
 *
 * On a hit we also record into the graduated-response sliding-window
 * counter (`profanity-counter.ts`) and pass the running 60s-window
 * count back via `RuleHit.context.profanityCount`. `actions.ts` reads
 * that to branch between nudge (1–14) and delete-warn-log (15+) tiers.
 */

function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

/**
 * Ordinary Vietnamese words that collapse onto a banned word once the
 * diacritics are stripped. Without this list the filter censors normal
 * speech, which is exactly what happened in production:
 *
 *   "các"     → "cac" → matched "cặc"
 *   "đầy đủ"  → "day du" → matched "đụ"
 *
 * Both are everyday words ("các" is the plural marker), so a large share
 * of normal Vietnamese messages were being flagged as profanity — and
 * because automod short-circuits the message pipeline, those messages
 * never reached Aki at all. Observed live 2026-07-29 on the question
 * "Làm sao để hiểu đầy đủ toàn bộ các nguyên âm trong tiếng hàn".
 *
 * Compared against the ORIGINAL token (diacritics intact), so a real
 * "cặc" still matches while "các" does not.
 */
const DIACRITIC_SAFE_WORDS: ReadonlySet<string> = new Set([
  // → "cac"
  'các',
  'cac',
  // → "du"
  'đủ',
  'dù',
  'dữ',
  'du',
  'dụ',
  'dú',
  // → "lon"
  'lớn',
  'lon',
  'lôn',
  'lộn',
  // → "dit"
  'đít',
  'dịt',
  // → "dm"
  'dm',
]);

/**
 * Pure helper, exported for tests. Returns the first matched word from
 * `words` that appears in `text` as a whole token (separated by
 * whitespace, punctuation, or string boundary), or `null` if none.
 *
 * Matching is diacritic-tolerant so `địt` still catches `DIT`/`d1t`-style
 * evasion, but a normalised hit is discarded when the token as actually
 * typed is a legitimate word (see DIACRITIC_SAFE_WORDS). An exact match
 * WITH diacritics always counts — nobody types "cặc" by accident.
 */
export function findProfanity(text: string, words: readonly string[]): string | null {
  const lowerText = text.toLowerCase();
  const normalizedText = normalizeForMatch(text);

  for (const w of words) {
    const normalizedWord = normalizeForMatch(w);
    if (!normalizedWord) continue;
    // \b doesn't work for non-ASCII; use a manual boundary check.
    const boundary = (word: string): RegExp =>
      new RegExp(`(?:^|[^\\p{L}\\p{N}])(${escapeRegex(word)})(?:$|[^\\p{L}\\p{N}])`, 'u');

    // Exact form, diacritics and all — unambiguous, always a hit.
    if (boundary(w.toLowerCase()).test(lowerText)) return w;

    if (!boundary(normalizedWord).test(normalizedText)) continue;

    // Normalised hit: only count it if the token the user actually typed
    // isn't an ordinary word that merely collides after stripping accents.
    const collidesWithRealWord = lowerText
      .split(/[^\p{L}\p{N}]+/u)
      .some((token) => normalizeForMatch(token) === normalizedWord && DIACRITIC_SAFE_WORDS.has(token));
    if (!collidesWithRealWord) return w;
  }
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const profanityRule: AutomodRule = {
  id: 'profanity',
  name: 'Profanity filter',
  severity: 2,
  action: 'warn',
  warnText:
    '⚠️ Vui lòng giữ giao tiếp văn minh. Tin nhắn của bạn vừa bị xoá vì chứa từ ngữ không phù hợp.',
  async detect(message: Message): Promise<RuleHit | null> {
    const config = await loadAutomodConfig();
    const hit = findProfanity(message.content, config.profanityWords);
    if (!hit) return null;
    const result = recordHit(message.author.id);
    return {
      reason: `profanity match: ${hit}`,
      context: {
        word: hit,
        profanityCount: result.count,
        firstProfanityHitMs: result.firstHitMs,
      },
    };
  },
};
