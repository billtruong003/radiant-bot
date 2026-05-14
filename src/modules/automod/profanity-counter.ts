/**
 * Per-user sliding-window counter for graduated profanity response.
 *
 * Phase 11.2 / Commit 2 (A6) — instead of always delete-and-warn on the
 * first profanity hit, we let the user trip into harsher tiers based on
 * how often they fire in a rolling 60s window:
 *
 *   - 1–4 hits in window  → Aki gentle nudge (no delete)
 *   - 5–14 hits in window → Aki stern nudge (no delete)
 *   - 15+ hits in window  → existing delete + warn DM + log
 *
 * State is pure in-memory (Map<userId, timestamps[]>). Acceptable trade-off:
 * a bot restart re-zeroes everyone, but a 60s window is short enough that
 * the worst case is one "lucky escape" right after a restart. Persisting
 * would invite false positives on long-uptime instances anyway.
 *
 * Pruning: we lazily drop timestamps outside the window every time the
 * counter is touched, so memory stays O(n_recent_offenders) without a
 * background sweep.
 */

const WINDOW_MS = 60_000;

const hits: Map<string, number[]> = new Map();

function prune(userId: string, now: number): number[] {
  const arr = hits.get(userId);
  if (!arr) return [];
  const cutoff = now - WINDOW_MS;
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

/**
 * Record one profanity hit for `userId` and return the resulting count
 * within the 60s sliding window (including this hit).
 */
export function recordHit(userId: string, now: number = Date.now()): number {
  const kept = prune(userId, now);
  kept.push(now);
  hits.set(userId, kept);
  return kept.length;
}

/** Read the current count without recording a new hit. Used by tests. */
export function getCount(userId: string, now: number = Date.now()): number {
  return prune(userId, now).length;
}

/** Test / shutdown helper. */
export function reset(userId?: string): void {
  if (userId === undefined) {
    hits.clear();
  } else {
    hits.delete(userId);
  }
}

export const WINDOW_MS_FOR_TESTING = WINDOW_MS;
