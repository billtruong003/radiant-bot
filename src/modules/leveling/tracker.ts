import { ulid } from 'ulid';
import { getStore } from '../../db/index.js';
import type { User, XpSource } from '../../db/types.js';
import { logger } from '../../utils/logger.js';
import { cumulativeXpForLevel, levelFromXp } from './engine.js';

/**
 * Source-agnostic XP awarder. The caller decides the amount (e.g.
 * random(15,25) for message, 10 for voice/minute) and source; the
 * tracker:
 *   1. Ensures a User entity exists (creates one with default rank if
 *      not — defensive in case a member earns XP without going through
 *      verification, e.g., admin grant).
 *   2. `incr`-s the xp field atomically.
 *   3. Re-fetches to compute new level (post-incr, so concurrent awards
 *      compose).
 *   4. If `leveledUp` OR `touchLastMessage`, follows up with a `set` to
 *      update non-incrementable fields (level, last_message_at).
 *   5. Appends an `XpLog` entry via the append-only WAL collection.
 *
 * Rank role swap is NOT done here — `rank-promoter.ts` (Chunk 2) reads
 * the `leveledUp` flag and handles the Discord side-effect.
 */

export interface AwardXpInput {
  discordId: string;
  /** Used to seed the User record on first XP earn. */
  username: string;
  displayName: string | null;
  amount: number;
  source: XpSource;
  metadata?: Record<string, unknown> | null;
  /** Update last_message_at — set true only for source='message'. */
  touchLastMessage?: boolean;
}

export interface XpAwardResult {
  newXp: number;
  oldLevel: number;
  newLevel: number;
  leveledUp: boolean;
}

function freshUser(input: Pick<AwardXpInput, 'discordId' | 'username' | 'displayName'>): User {
  return {
    discord_id: input.discordId,
    username: input.username,
    display_name: input.displayName,
    xp: 0,
    level: 0,
    cultivation_rank: 'pham_nhan',
    sub_title: null,
    joined_at: Date.now(),
    verified_at: null,
    last_message_at: null,
    last_daily_at: null,
    daily_streak: 0,
    is_suspect: false,
    notes: null,
    // Phase 12 — initialize to 0 so incr() works without a prior set().
    pills: 0,
    contribution_points: 0,
    equipped_cong_phap_slug: null,
    last_quest_assigned_at: null,
    premium_boosted_at_ms: null,
    aki_memory_opt_in: false,
  };
}

export async function awardXp(input: AwardXpInput): Promise<XpAwardResult> {
  const store = getStore();
  const now = Date.now();

  if (input.amount <= 0) {
    logger.warn(
      { discord_id: input.discordId, amount: input.amount, source: input.source },
      'awardXp: non-positive amount, ignoring',
    );
    const u = store.users.get(input.discordId);
    return {
      newXp: u?.xp ?? 0,
      oldLevel: u?.level ?? 0,
      newLevel: u?.level ?? 0,
      leveledUp: false,
    };
  }

  // Ensure User record exists. Verification flow creates one on pass, but a
  // defensive create here covers admin-granted XP / future bulk migrations.
  let existing = store.users.get(input.discordId);
  if (!existing) {
    existing = freshUser(input);
    await store.users.set(existing);
  }
  const oldLevel = existing.level;

  // Atomic XP bump.
  const updated = await store.users.incr(input.discordId, 'xp', input.amount);
  if (!updated) {
    // Race / disappeared between get + incr (extremely unlikely with single
    // writer). Treat as no-op to stay defensive.
    logger.warn({ discord_id: input.discordId }, 'awardXp: incr returned null, skipping');
    return { newXp: existing.xp, oldLevel, newLevel: oldLevel, leveledUp: false };
  }

  const newXp = updated.xp;
  const newLevel = levelFromXp(newXp);
  const leveledUp = newLevel > oldLevel;

  // Follow-up `set` only if non-XP fields need updating. Spread the latest
  // `updated` so concurrent incr-s aren't clobbered.
  if (leveledUp || input.touchLastMessage) {
    await store.users.set({
      ...updated,
      level: newLevel,
      last_message_at: input.touchLastMessage ? now : updated.last_message_at,
    });
  }

  // Append-only XP log (high-volume → AppendOnlyCollection).
  await store.xpLogs.append({
    id: ulid(),
    discord_id: input.discordId,
    amount: input.amount,
    source: input.source,
    metadata: input.metadata ?? null,
    created_at: now,
  });

  // Phase 12 — contribution points auto-earn from message XP. Rate: 1
  // contribution per 10 XP (effectively ~2 contrib per message), only
  // for source='message' so voice/reaction/daily don't double-count
  // (those have their own contribution paths in respective handlers).
  // Use set() rather than incr() because legacy users from before
  // Phase 12 may have `contribution_points === undefined` which incr
  // rejects. set() with `(field ?? 0) + delta` is safe.
  if (input.source === 'message') {
    const contribDelta = Math.floor(input.amount / 10);
    if (contribDelta > 0) {
      const fresh = store.users.get(input.discordId);
      if (fresh) {
        await store.users.set({
          ...fresh,
          contribution_points: (fresh.contribution_points ?? 0) + contribDelta,
        });
      }
    }
    // Phase 12 Lát 4 — daily quest progress (message_count quests).
    const { incrementProgress } = await import('../quests/daily-quest.js');
    void incrementProgress(input.discordId, 'message_count', 1, now);
  }

  return { newXp, oldLevel, newLevel, leveledUp };
}

/**
 * Picks a random integer in [min, max] inclusive. Exposed so message-XP
 * event handler can pick a per-message amount in [15, 25] per SPEC §3.
 */
export function randomXpAmount(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Apply an XP penalty (e.g. tribulation fail). Per SPEC §3:
 *   - `xp` floors at `cumulativeXpForLevel(currentLevel)` — penalty
 *     never demotes the member.
 *   - Logs to `xpLogs` with negative amount, source `tribulation_fail`.
 *
 * Returns the actual delta applied (≤ requested amount, possibly 0
 * if already at the floor).
 */
export async function applyXpPenalty(
  discordId: string,
  amount: number,
): Promise<{ applied: number; newXp: number }> {
  if (amount <= 0) {
    const u = getStore().users.get(discordId);
    return { applied: 0, newXp: u?.xp ?? 0 };
  }
  const store = getStore();
  const user = store.users.get(discordId);
  if (!user) return { applied: 0, newXp: 0 };

  const floor = cumulativeXpForLevel(user.level);
  const targetXp = Math.max(user.xp - amount, floor);
  const applied = user.xp - targetXp;
  if (applied <= 0) return { applied: 0, newXp: user.xp };

  await store.users.set({ ...user, xp: targetXp });
  await store.xpLogs.append({
    id: ulid(),
    discord_id: discordId,
    amount: -applied,
    source: 'tribulation_fail',
    metadata: { requested: amount, floored_at: floor },
    created_at: Date.now(),
  });
  return { applied, newXp: targetXp };
}
