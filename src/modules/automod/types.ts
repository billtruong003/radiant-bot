import type { Message } from 'discord.js';

/**
 * Automod rule contract. Each rule is one file under
 * `src/modules/automod/rules/` exporting an `AutomodRule`. The engine
 * iterates rules and applies the first one that matches.
 *
 * `detect` returns a `RuleHit` (with reason + context for logging) when
 * the rule fires, or `null` to pass through. Sync or async — engine
 * awaits uniformly.
 */

/** Maps directly to `AutomodLog.rule` in the entity types. */
export type AutomodRuleId = 'profanity' | 'mass_mention' | 'link' | 'spam' | 'caps';

/** Maps directly to `AutomodLog.action`. */
export type AutomodAction = 'delete' | 'warn' | 'timeout' | 'kick';

export interface RuleHit {
  /** Short human-readable reason for the log + #bot-log post. */
  reason: string;
  /** Extra structured fields persisted in `AutomodLog.context`. */
  context?: Record<string, unknown>;
}

export interface AutomodRule {
  id: AutomodRuleId;
  name: string;
  /** Severity tier (1=light delete, 2=warn+delete, 3=timeout/kick). */
  severity: 1 | 2 | 3;
  action: AutomodAction;
  /** Required for action='timeout'. Milliseconds. */
  timeoutMs?: number;
  /** Optional DM sent to the offender on action='warn' / 'timeout'. */
  warnText?: string;
  /**
   * Return `null` to skip; return `RuleHit` to fire the action.
   * Side-effect-free — actions live in `actions.ts`.
   */
  detect(message: Message): Promise<RuleHit | null> | RuleHit | null;
}

export interface AutomodDecision {
  rule: AutomodRule;
  hit: RuleHit;
}
