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
 * Pure helper, exported for tests. Returns the first matched word from
 * `words` that appears in `text` as a whole token (separated by
 * whitespace, punctuation, or string boundary), or `null` if none.
 */
export function findProfanity(text: string, words: readonly string[]): string | null {
  const normalizedText = normalizeForMatch(text);
  for (const w of words) {
    const normalizedWord = normalizeForMatch(w);
    if (!normalizedWord) continue;
    // \b doesn't work for non-ASCII; use a manual boundary check.
    const pattern = new RegExp(
      `(?:^|[^\\p{L}\\p{N}])(${escapeRegex(normalizedWord)})(?:$|[^\\p{L}\\p{N}])`,
      'u',
    );
    if (pattern.test(normalizedText)) return w;
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
