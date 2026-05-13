import { getStore } from '../../db/index.js';

/**
 * Per-user quota for /ask, enforced by counting non-refusal calls in
 * `akiLogs` over a sliding window. Two limits:
 *
 *   - 5 calls / 1 minute (burst protection)
 *   - 50 calls / 24 hours (daily quota)
 *
 * Why count-based instead of `RateLimiter` (spacing-based):
 *   RateLimiter enforces MIN SPACING between calls. For a "50/day"
 *   quota that translated to "60s/50 = ~28.8min between calls",
 *   which incorrectly rejected after the FIRST call. Count-based
 *   over the akiLogs history is the right semantic for "max N per
 *   window".
 *
 * Refusals are excluded from the count so a rate-limited user doesn't
 * keep digging deeper into their own quota — only successful calls
 * (and budget-exhausted refusals) count.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PER_MINUTE = 5;
const MAX_PER_DAY = 50;

export interface QuotaCheckResult {
  ok: boolean;
  reason?: 'minute' | 'day';
  callsThisMinute: number;
  callsThisDay: number;
}

/**
 * Returns whether the user can make another /ask call right now.
 * Does NOT mutate state — counting is over the AkiCallLog history,
 * which gets appended inside `askAki` itself. Caller checks this
 * BEFORE invoking askAki.
 */
export function tryAcquireAskQuota(userId: string, now: number = Date.now()): QuotaCheckResult {
  const minuteAgo = now - MINUTE_MS;
  const dayAgo = now - DAY_MS;

  const logsLast24h = getStore().akiLogs.query(
    (l) => l.discord_id === userId && !l.refusal && l.created_at >= dayAgo,
  );
  const callsThisDay = logsLast24h.length;
  const callsThisMinute = logsLast24h.filter((l) => l.created_at >= minuteAgo).length;

  if (callsThisDay >= MAX_PER_DAY) {
    return { ok: false, reason: 'day', callsThisMinute, callsThisDay };
  }
  if (callsThisMinute >= MAX_PER_MINUTE) {
    return { ok: false, reason: 'minute', callsThisMinute, callsThisDay };
  }
  return { ok: true, callsThisMinute, callsThisDay };
}

/**
 * Lifecycle hooks kept as no-ops for compatibility with bot.ts.
 * Previous RateLimiter-based impl needed sweep timers; the count-
 * based approach reads akiLogs directly so there's nothing to sweep.
 */
export function startAkiCooldownSweeps(): void {
  /* no-op (count-based, no in-memory state) */
}

export function stopAkiCooldownSweeps(): void {
  /* no-op */
}

export const AKI_QUOTA_LIMITS = {
  MAX_PER_MINUTE,
  MAX_PER_DAY,
} as const;
