import type { Message } from 'discord.js';
import { loadAutomodConfig } from '../../../config/automod.js';
import type { AutomodRule, RuleHit } from '../types.js';

/**
 * Caps-lock guard: messages with > 70% uppercase letters and length
 * above a minimum threshold are deleted (no warn — too noisy for a
 * mild offense). Only counts ASCII letters; emoji/digit/punctuation
 * ignored so "AAAAAAA!!!" still triggers but "Số 1!!!" doesn't.
 */

const LETTER_RE = /[A-Za-z]/g;
const UPPER_RE = /[A-Z]/g;

/**
 * Pure helper, exported for tests. Returns `null` if the message
 * doesn't have enough letters to evaluate, otherwise the upper-case
 * ratio in [0, 1].
 */
export function capsRatio(text: string): number | null {
  const letters = text.match(LETTER_RE)?.length ?? 0;
  if (letters === 0) return null;
  const uppers = text.match(UPPER_RE)?.length ?? 0;
  return uppers / letters;
}

export const capsLockRule: AutomodRule = {
  id: 'caps',
  name: 'Caps-lock spam',
  severity: 1,
  action: 'delete',
  async detect(message: Message): Promise<RuleHit | null> {
    const config = await loadAutomodConfig();
    const content = message.content.trim();
    if (content.length < config.thresholds.capsMinLength) return null;
    const ratio = capsRatio(content);
    if (ratio === null) return null;
    if (ratio < config.thresholds.capsRatioThreshold) return null;
    return {
      reason: `caps ratio ${(ratio * 100).toFixed(0)}% over ${(config.thresholds.capsRatioThreshold * 100).toFixed(0)}%`,
      context: { ratio, length: content.length },
    };
  },
};
