/**
 * Per-user sliding-window counter for graduated profanity response.
 *
 * Phase 11.2 / Commit 2 (A6) — instead of always delete-and-warn on the
 * first profanity hit, we let the user trip into harsher tiers based on
 * how often they fire in a rolling 60s window:
 *
 *   - 1–4 hits in window  → Aki gentle nudge (no delete)
 *   - 5–14 hits in window → Aki stern nudge (no delete)
 *   - 15+ hits in window  → existing delete + warn DM + log + RETROACTIVE
 *                            channel-history sweep (Bill, post-deploy
 *                            request 2026-05-14): when a user tips into
 *                            delete tier, scrub all their messages in
 *                            the channel since their FIRST profanity in
 *                            the broader 15-minute sweep window.
 *
 * State is pure in-memory (Map<userId, timestamps[]>). Acceptable trade-off:
 * a bot restart re-zeroes everyone, but a 15-minute window is short
 * enough that the worst case is one "lucky escape" right after a restart.
 *
 * Window layout:
 *   - TIER_WINDOW_MS (60s)   → counts hits for tier-decision (1-4 / 5-14 / 15+)
 *   - SWEEP_WINDOW_MS (15min) → oldest hit retained for retroactive cleanup
 *
 * Both share the same per-user timestamp array; the array is pruned to
 * the wider (15min) window and the narrower (60s) count is derived on
 * read. Memory is O(hits-per-user-in-15min) which is bounded by spam rate
 * × 15min (e.g. 60 hits = ~480 bytes per user).
 */

const TIER_WINDOW_MS = 60_000;
const SWEEP_WINDOW_MS = 15 * 60_000;

const hits: Map<string, number[]> = new Map();

function prune(userId: string, now: number): number[] {
  const arr = hits.get(userId);
  if (!arr) return [];
  const cutoff = now - SWEEP_WINDOW_MS;
  // Timestamps are append-only and monotonic, so trim from the head.
  let i = 0;
  while (i < arr.length) {
    const ts = arr[i];
    if (ts === undefined || ts >= cutoff) break;
    i++;
  }
  if (i === 0) return arr;
  const kept = arr.slice(i);
  if (kept.length === 0) {
    hits.delete(userId);
  } else {
    hits.set(userId, kept);
  }
  return kept;
}

export interface HitResult {
  /** Number of hits within the 60s tier-decision window (drives nudge severity). */
  count: number;
  /**
   * Timestamp (epoch ms) of the OLDEST profanity hit still in the 15min
   * sweep window. Used by retroactive history cleanup at delete tier.
   * Equals `now` when this is the first hit.
   */
  firstHitMs: number;
}

/**
 * Record one profanity hit for `userId` and return `{ count, firstHitMs }`.
 * `count` is hits-in-60s (drives tier). `firstHitMs` is oldest-in-15min
 * (drives retroactive sweep at delete tier).
 */
export function recordHit(userId: string, now: number = Date.now()): HitResult {
  const kept = prune(userId, now);
  kept.push(now);
  hits.set(userId, kept);
  const tierCutoff = now - TIER_WINDOW_MS;
  let count = 0;
  for (const ts of kept) {
    if (ts >= tierCutoff) count++;
  }
  return { count, firstHitMs: kept[0] ?? now };
}

/** Read the current count without recording a new hit. Used by tests. */
export function getCount(userId: string, now: number = Date.now()): number {
  const kept = prune(userId, now);
  const tierCutoff = now - TIER_WINDOW_MS;
  let count = 0;
  for (const ts of kept) {
    if (ts >= tierCutoff) count++;
  }
  return count;
}

/** Test / shutdown helper. */
export function reset(userId?: string): void {
  if (userId === undefined) {
    hits.clear();
  } else {
    hits.delete(userId);
  }
}

export const WINDOW_MS_FOR_TESTING = TIER_WINDOW_MS;
export const SWEEP_WINDOW_MS_FOR_TESTING = SWEEP_WINDOW_MS;
