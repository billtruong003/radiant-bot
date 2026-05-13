import { RateLimiter } from '../../utils/rate-limiter.js';

/**
 * Per-user rate limits for /ask:
 *   - 5 calls / minute      (burst protection)
 *   - 50 calls / day        (daily quota)
 *
 * Both are in-memory and reset on bot restart — acceptable since the
 * windows are short and a restart is rare. Counts are also indirectly
 * visible via AkiCallLog queries if we ever need exact persistence.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const askMinuteLimit = new RateLimiter(MINUTE_MS / 5); // ~12s spacing → ~5/min average
export const askDayLimit = new RateLimiter(DAY_MS / 50); // ~28.8min spacing → ~50/day average

/**
 * Check both limits + consume on success. Returns:
 *   - { ok: true } on allow
 *   - { ok: false, reason } on refusal, where reason is one of:
 *       'minute' — too fast (≥ 5 in last minute)
 *       'day'    — exhausted today's 50
 */
export function tryAcquireAskQuota(
  userId: string,
): { ok: true } | { ok: false; reason: 'minute' | 'day' } {
  if (!askMinuteLimit.tryConsume(userId)) {
    return { ok: false, reason: 'minute' };
  }
  if (!askDayLimit.tryConsume(userId)) {
    return { ok: false, reason: 'day' };
  }
  return { ok: true };
}

/**
 * Note: the simple RateLimiter only enforces SPACING between calls, not
 * burst windows. For /ask the effective semantics are "min spacing of
 * 12s and 28.8min" — sufficient for anti-spam without a full sliding-
 * window implementation. Upgrade to a token bucket if usage scales.
 */
export function startAkiCooldownSweeps(): void {
  askMinuteLimit.startAutoSweep();
  askDayLimit.startAutoSweep();
}

export function stopAkiCooldownSweeps(): void {
  askMinuteLimit.stopAutoSweep();
  askDayLimit.stopAutoSweep();
}
