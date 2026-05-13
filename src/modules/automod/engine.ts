import type { Message } from 'discord.js';
import { logger } from '../../utils/logger.js';
import type { AutomodDecision, AutomodRule } from './types.js';

/**
 * Automod engine: first-match-wins evaluator. Rules are ordered by
 * `severity` desc on registration so a profanity hit (severity 2) wins
 * over a caps-lock hit (severity 1) on the same message.
 *
 * The engine is sync-friendly but `await`s every rule so async checks
 * (e.g. profanity list lazy-loaded) work transparently.
 *
 * Rule errors are caught individually — one broken rule doesn't kill
 * the chain.
 */
export class AutomodEngine {
  private readonly rules: readonly AutomodRule[];

  constructor(rules: readonly AutomodRule[]) {
    // Stable sort by severity desc so severity-3 (kick/timeout) wins over 1.
    this.rules = [...rules].sort((a, b) => b.severity - a.severity);
  }

  async evaluate(message: Message): Promise<AutomodDecision | null> {
    for (const rule of this.rules) {
      try {
        const hit = await rule.detect(message);
        if (hit) return { rule, hit };
      } catch (err) {
        logger.error(
          { err, rule: rule.id, message_id: message.id },
          'automod: rule threw — skipping',
        );
      }
    }
    return null;
  }

  list(): readonly AutomodRule[] {
    return this.rules;
  }
}
