/**
 * Per-key cooldown rate limiter backed by a Map. Not durable (in-memory only) —
 * intentional: cooldowns reset on restart, which is fine for XP anti-grind
 * (60s window is short relative to deploy cadence).
 *
 * Auto-prunes expired entries lazily on each access; an optional sweep
 * interval reclaims memory if the limiter is rarely queried after a burst.
 */
export class RateLimiter {
  private readonly map = new Map<string, number>();
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly cooldownMs: number,
    private readonly sweepIntervalMs: number = 5 * 60 * 1000,
  ) {}

  /**
   * Returns `true` if the action is allowed (and records the new timestamp).
   * Returns `false` if the key is still cooling down.
   */
  tryConsume(key: string, now: number = Date.now()): boolean {
    const last = this.map.get(key);
    if (last !== undefined && now - last < this.cooldownMs) {
      return false;
    }
    this.map.set(key, now);
    return true;
  }

  /** Time remaining (ms) until next allowed action, or 0 if available now. */
  remainingMs(key: string, now: number = Date.now()): number {
    const last = this.map.get(key);
    if (last === undefined) return 0;
    const remaining = this.cooldownMs - (now - last);
    return remaining > 0 ? remaining : 0;
  }

  reset(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }

  startAutoSweep(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep(), this.sweepIntervalMs);
    this.sweepTimer.unref();
  }

  stopAutoSweep(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /** Removes entries that are past the cooldown window. */
  sweep(now: number = Date.now()): number {
    let removed = 0;
    for (const [key, ts] of this.map) {
      if (now - ts >= this.cooldownMs) {
        this.map.delete(key);
        removed++;
      }
    }
    return removed;
  }
}
