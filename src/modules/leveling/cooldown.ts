import { RateLimiter } from '../../utils/rate-limiter.js';

/**
 * Singleton cooldowns for XP-earning actions. Per CLAUDE.md "Anti-grind XP
 * cooldown 60s/user sacred" — do NOT bypass or scale this without a
 * decision-log entry.
 *
 * In-memory by design: cooldowns reset on restart. Acceptable trade-off
 * since restart cadence (hours-days) is way longer than the cooldown
 * window (60s).
 */

/** 60s between message-XP awards per user. */
export const messageXpCooldown = new RateLimiter(60_000);

/** 10s between reaction-XP awards per reactor (per any target message). */
export const reactionXpCooldown = new RateLimiter(10_000);

/** Start sweep timers so the maps don't grow unbounded under heavy load. */
export function startCooldownSweeps(): void {
  messageXpCooldown.startAutoSweep();
  reactionXpCooldown.startAutoSweep();
}

export function stopCooldownSweeps(): void {
  messageXpCooldown.stopAutoSweep();
  reactionXpCooldown.stopAutoSweep();
}
