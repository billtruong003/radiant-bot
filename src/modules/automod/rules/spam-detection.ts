import type { Message } from 'discord.js';
import { loadAutomodConfig } from '../../../config/automod.js';
import type { AutomodRule, RuleHit } from '../types.js';

/**
 * Spam detection: if a user posts the same (normalized) message ≥ N
 * times within a sliding window, timeout them. Per-user state lives
 * in-memory only — restart resets the counters which is fine since
 * the window is short (5 min default).
 *
 * Normalization is aggressive: lowercase, collapse whitespace, strip
 * leading/trailing punctuation. Catches "spam spam" / "SPAM!" /
 * "spam ." as the same content.
 */

interface RecentMessage {
  text: string;
  ts: number;
}

class SpamTracker {
  private readonly perUser = new Map<string, RecentMessage[]>();

  /**
   * Record a new message + return how many times the (normalized) text
   * has appeared from this user within `windowMs`.
   */
  record(userId: string, text: string, windowMs: number, now: number): number {
    const normalized = SpamTracker.normalize(text);
    if (!normalized) return 0;
    const cutoff = now - windowMs;
    const prev = (this.perUser.get(userId) ?? []).filter((m) => m.ts >= cutoff);
    prev.push({ text: normalized, ts: now });
    this.perUser.set(userId, prev);
    let count = 0;
    for (const m of prev) {
      if (m.text === normalized) count++;
    }
    return count;
  }

  reset(userId: string): void {
    this.perUser.delete(userId);
  }

  /** Drop entries older than the longest tracked window. Memory housekeeping. */
  sweep(now: number, windowMs: number): void {
    const cutoff = now - windowMs;
    for (const [uid, msgs] of this.perUser) {
      const kept = msgs.filter((m) => m.ts >= cutoff);
      if (kept.length === 0) this.perUser.delete(uid);
      else this.perUser.set(uid, kept);
    }
  }

  size(): number {
    return this.perUser.size;
  }

  static normalize(text: string): string {
    return text
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '');
  }
}

/** Singleton state — module-level so all messageCreate calls share it. */
export const spamTracker = new SpamTracker();

export const spamRule: AutomodRule = {
  id: 'spam',
  name: 'Spam (duplicate messages)',
  severity: 3,
  action: 'timeout',
  warnText: '⚠️ Bạn vừa gửi cùng một tin nhắn quá nhiều lần — đã bị tạm khoá 10 phút.',
  async detect(message: Message): Promise<RuleHit | null> {
    const config = await loadAutomodConfig();
    const count = spamTracker.record(
      message.author.id,
      message.content,
      config.thresholds.spamWindowMs,
      Date.now(),
    );
    if (count < config.thresholds.spamDuplicates) return null;
    // Reset counter after triggering so the timeout-ed user doesn't keep
    // accumulating (their next message after timeout starts fresh).
    spamTracker.reset(message.author.id);
    return {
      reason: `same message ${count}x within window`,
      context: { duplicates: count, window_ms: config.thresholds.spamWindowMs },
    };
  },
};
