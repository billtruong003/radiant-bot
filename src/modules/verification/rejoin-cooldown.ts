/**
 * B6 — verify re-attempt cooldown (Phase 11.3 polish).
 *
 * When a member is kicked because they failed the captcha (or timed out
 * the verify flow), we record a per-user cooldown. If they rejoin
 * within the window, the bot kicks them again immediately with a
 * `vui lòng đợi` reason so they can't grind retries.
 *
 * State is in-memory (Map<discord_id, expiry_ts>) — restart re-zeros it,
 * which is acceptable because:
 *   - the cooldown is short (default 1h)
 *   - failed-verify kicks are rare enough that we can afford the
 *     occasional grandfathered retry after a deploy
 *
 * Pruning is lazy: entries are dropped when checked past expiry.
 */

const COOLDOWN_MS_DEFAULT = 60 * 60 * 1000; // 1 hour

const cooldowns: Map<string, number> = new Map();

let cooldownMs = COOLDOWN_MS_DEFAULT;

/** Set the cooldown duration (used by tests + admin config). */
export function setCooldownMs(ms: number): void {
  cooldownMs = ms;
}

/** Read the active cooldown duration. */
export function getCooldownMs(): number {
  return cooldownMs;
}

/**
 * Record a failed-verify kick — sets the cooldown expiry for `discordId`.
 * Idempotent: re-recording overwrites with a fresh window.
 */
export function recordFailedVerifyKick(discordId: string, now: number = Date.now()): void {
  cooldowns.set(discordId, now + cooldownMs);
}

/**
 * Returns the remaining cooldown in ms if `discordId` is still within
 * the window, or `null` if free to retry. Lazy-prunes expired entries.
 */
export function getRemainingCooldownMs(discordId: string, now: number = Date.now()): number | null {
  const expiry = cooldowns.get(discordId);
  if (expiry === undefined) return null;
  if (now >= expiry) {
    cooldowns.delete(discordId);
    return null;
  }
  return expiry - now;
}

/** Returns true if the user should be kicked on rejoin. */
export function isOnCooldown(discordId: string, now: number = Date.now()): boolean {
  return getRemainingCooldownMs(discordId, now) !== null;
}

/** Test / shutdown helper. */
export function reset(): void {
  cooldowns.clear();
  cooldownMs = COOLDOWN_MS_DEFAULT;
}

export const __for_testing = { cooldowns };
