import { ulid } from 'ulid';
import { getStore } from '../../db/index.js';
import type { User, XpSource } from '../../db/types.js';
import { logger } from '../../utils/logger.js';
import { levelFromXp } from './engine.js';

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

  return { newXp, oldLevel, newLevel, leveledUp };
}

/**
 * Picks a random integer in [min, max] inclusive. Exposed so message-XP
 * event handler can pick a per-message amount in [15, 25] per SPEC §3.
 */
export function randomXpAmount(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
