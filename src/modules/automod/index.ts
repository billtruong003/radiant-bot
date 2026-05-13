import { AutomodEngine } from './engine.js';
import { capsLockRule } from './rules/caps-lock.js';
import { linkWhitelistRule } from './rules/link-whitelist.js';
import { massMentionRule } from './rules/mass-mention.js';
import { profanityRule } from './rules/profanity.js';
import { spamRule } from './rules/spam-detection.js';

/**
 * Default automod engine — all 5 rules loaded. Severity-desc ordering
 * is applied at construction inside `AutomodEngine`, so source order
 * here doesn't matter for evaluation priority.
 */
export const automodEngine = new AutomodEngine([
  profanityRule,
  massMentionRule,
  linkWhitelistRule,
  spamRule,
  capsLockRule,
]);

export { applyDecision } from './actions.js';
export { AutomodEngine } from './engine.js';
export type {
  AutomodAction,
  AutomodDecision,
  AutomodRule,
  AutomodRuleId,
  RuleHit,
} from './types.js';
