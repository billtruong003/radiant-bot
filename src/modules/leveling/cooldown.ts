import { MESSAGE_XP_COOLDOWN_MS, REACTION_XP_COOLDOWN_MS } from '../../config/leveling.js';
import { RateLimiter } from '../../utils/rate-limiter.js';

/**
 * Singleton cooldowns for XP-earning actions. Window values come from
 * `config/leveling.ts` so balance changes don't require editing this
 * file. Per CLAUDE.md, the message cooldown is anti-grind sacred —
 * tune in the config, never bypass.
 *
 * In-memory by design: cooldowns reset on restart. Acceptable trade-off
 * since restart cadence (hours-days) is way longer than the cooldown
 * window (60s / 10s).
 */

export const messageXpCooldown = new RateLimiter(MESSAGE_XP_COOLDOWN_MS);
export const reactionXpCooldown = new RateLimiter(REACTION_XP_COOLDOWN_MS);

export function startCooldownSweeps(): void {
  messageXpCooldown.startAutoSweep();
  reactionXpCooldown.startAutoSweep();
}

export function stopCooldownSweeps(): void {
  messageXpCooldown.stopAutoSweep();
  reactionXpCooldown.stopAutoSweep();
}
