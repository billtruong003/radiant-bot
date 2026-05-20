import { ulid } from 'ulid';
import { getStore } from '../../db/index.js';
import type { DailyQuest, DailyQuestType } from '../../db/types.js';
import { logger } from '../../utils/logger.js';

/**
 * Phase 12 Lát 4 — Daily quest module.
 *
 * - Cron at 00:00 VN generates 1 quest per active user.
 * - Progress increments in real-time from existing event handlers
 *   (awardXp, voice-xp tick, reaction handler, /daily).
 * - Completion auto-grants rewards (XP + pills + contribution) and
 *   posts a small embed to bot-log.
 */

interface QuestTemplate {
  type: DailyQuestType;
  target: number;
  reward_xp: number;
  reward_pills: number;
  reward_contribution: number;
  label: string;
}

export const QUEST_POOL: readonly QuestTemplate[] = [
  {
    type: 'message_count',
    target: 10,
    reward_xp: 50,
    reward_pills: 1,
    reward_contribution: 10,
    label: 'Gửi 10 tin nhắn',
  },
  {
    type: 'message_count',
    target: 25,
    reward_xp: 100,
    reward_pills: 1,
    reward_contribution: 20,
    label: 'Gửi 25 tin nhắn',
  },
  {
    type: 'voice_minutes',
    target: 30,
    reward_xp: 75,
    reward_pills: 1,
    reward_contribution: 15,
    label: 'Voice chat 30 phút',
  },
  {
    type: 'reaction_count',
    target: 5,
    reward_xp: 30,
    reward_pills: 0,
    reward_contribution: 10,
    label: 'Thả 5 reaction',
  },
  {
    type: 'daily_streak_check',
    target: 3,
    reward_xp: 75,
    reward_pills: 2,
    reward_contribution: 20,
    label: 'Giữ streak điểm danh 3 ngày',
  },
  // Phase 14 — engagement quests (Bill 2026-05-20 round 2).
  {
    type: 'duel_win',
    target: 1,
    reward_xp: 80,
    reward_pills: 3,
    reward_contribution: 40,
    label: 'Thắng 1 trận duel',
  },
  {
    type: 'spend_contribution',
    target: 100,
    reward_xp: 40,
    reward_pills: 1,
    reward_contribution: 20,
    label: 'Chi 100 điểm cống hiến ở shop',
  },
  {
    type: 'upgrade_attempt',
    target: 1,
    reward_xp: 60,
    reward_pills: 2,
    reward_contribution: 30,
    label: 'Cường hóa 1 lần (công pháp hoặc vũ khí)',
  },
  {
    type: 'equip_both',
    target: 1,
    reward_xp: 30,
    reward_pills: 1,
    reward_contribution: 15,
    label: 'Trang bị đồng thời 1 công pháp + 1 vũ khí',
  },
  {
    type: 'tribulation_pass',
    target: 1,
    reward_xp: 120,
    reward_pills: 5,
    reward_contribution: 60,
    label: 'Vượt qua 1 thiên kiếp',
  },
];

const VN_TZ = 'Asia/Ho_Chi_Minh';

/** Returns the start-of-day VN timestamp (ms epoch) for `now`. */
export function vnDayStart(now: number): number {
  // Get YYYY-MM-DD in VN, then parse as VN midnight.
  const d = new Intl.DateTimeFormat('en-CA', {
    timeZone: VN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
  // VN is UTC+7, so midnight VN = previous day 17:00 UTC.
  return Date.parse(`${d}T00:00:00+07:00`);
}

/**
 * Find user's current daily quest (for today VN), or null if none assigned.
 */
export function getCurrentQuest(discordId: string, now: number = Date.now()): DailyQuest | null {
  const dayStart = vnDayStart(now);
  const quests = getStore().dailyQuests.query(
    (q) => q.discord_id === discordId && q.assigned_at >= dayStart,
  );
  // Should be at most 1 per day; if multiple (race?), return most recent.
  return quests.sort((a, b) => b.assigned_at - a.assigned_at)[0] ?? null;
}

/**
 * Assign a fresh quest to `discordId` for today VN. Idempotent: skip if
 * there's already a quest assigned today. Returns the (existing or new)
 * quest, or null if user record missing.
 */
export async function assignDailyQuest(
  discordId: string,
  now: number = Date.now(),
): Promise<DailyQuest | null> {
  const store = getStore();
  const user = store.users.get(discordId);
  if (!user) return null;

  const existing = getCurrentQuest(discordId, now);
  if (existing) return existing;

  // Pick template — deterministic per user-day so re-running gives same
  // quest if a transient cron rerun happens.
  const dayStart = vnDayStart(now);
  const seed = (discordId.charCodeAt(0) + Math.floor(dayStart / 86_400_000)) % QUEST_POOL.length;
  const tpl = QUEST_POOL[seed] ?? QUEST_POOL[0];
  if (!tpl) return null;

  const quest: DailyQuest = {
    id: ulid(),
    discord_id: discordId,
    quest_type: tpl.type,
    target: tpl.target,
    progress: 0,
    reward_xp: tpl.reward_xp,
    reward_pills: tpl.reward_pills,
    reward_contribution: tpl.reward_contribution,
    assigned_at: now,
    completed_at: null,
  };
  await store.dailyQuests.set(quest);
  await store.users.set({ ...user, last_quest_assigned_at: now });
  return quest;
}

/**
 * Increment progress on a user's current daily quest matching `type`.
 * Atomic: if progress crosses `target`, marks `completed_at` and grants
 * rewards in one set call. No-op if no quest or already completed.
 *
 * Returns `{ completed: true }` when this call tipped it over.
 */
export async function incrementProgress(
  discordId: string,
  type: DailyQuestType,
  delta = 1,
  now: number = Date.now(),
): Promise<{ updated: boolean; completed: boolean }> {
  if (delta <= 0) return { updated: false, completed: false };
  const store = getStore();
  const quest = getCurrentQuest(discordId, now);
  if (!quest) return { updated: false, completed: false };
  if (quest.quest_type !== type) return { updated: false, completed: false };
  if (quest.completed_at !== null) return { updated: false, completed: false };

  const newProgress = Math.min(quest.target, quest.progress + delta);
  const justCompleted = newProgress >= quest.target;
  const updated: DailyQuest = {
    ...quest,
    progress: newProgress,
    completed_at: justCompleted ? now : null,
  };
  await store.dailyQuests.set(updated);

  if (justCompleted) {
    const user = store.users.get(discordId);
    if (user) {
      await store.users.set({
        ...user,
        pills: (user.pills ?? 0) + quest.reward_pills,
        contribution_points: (user.contribution_points ?? 0) + quest.reward_contribution,
      });
      // Phase 12 polish — auto-grant reward_xp through awardXp pipeline
      // so it can trigger level-up + rank promotion if the bonus tips
      // the user over a threshold. Lazy-imported to avoid circular dep
      // (tracker → quests → tracker).
      if (quest.reward_xp > 0) {
        const { awardXp } = await import('../leveling/tracker.js');
        await awardXp({
          discordId,
          username: user.username,
          displayName: user.display_name,
          amount: quest.reward_xp,
          source: 'event',
          metadata: { quest_id: quest.id, quest_type: type },
        });
      }
      logger.info(
        {
          discord_id: discordId,
          quest_id: quest.id,
          type,
          target: quest.target,
          reward_xp: quest.reward_xp,
          reward_pills: quest.reward_pills,
          reward_contribution: quest.reward_contribution,
        },
        'quest: completed + rewards granted',
      );
    }
  }

  return { updated: true, completed: justCompleted };
}

/**
 * Set quest progress to an absolute value (idempotent, clamped to target).
 * Used by `daily_streak_check`: progress mirrors `user.daily_streak` so a
 * user who already maintained a 3-day streak auto-completes on `/daily`
 * even if the quest was assigned mid-streak.
 *
 * Diverges from `incrementProgress`: delta semantics don't fit streak — a
 * user with streak=5 shouldn't keep adding +1 per /daily. Returns same
 * shape as incrementProgress for parity at call sites.
 */
export async function setProgress(
  discordId: string,
  type: DailyQuestType,
  value: number,
  now: number = Date.now(),
): Promise<{ updated: boolean; completed: boolean }> {
  if (value < 0) return { updated: false, completed: false };
  const store = getStore();
  const quest = getCurrentQuest(discordId, now);
  if (!quest) return { updated: false, completed: false };
  if (quest.quest_type !== type) return { updated: false, completed: false };
  if (quest.completed_at !== null) return { updated: false, completed: false };

  const clamped = Math.min(quest.target, value);
  if (clamped <= quest.progress) return { updated: false, completed: false };

  const justCompleted = clamped >= quest.target;
  await store.dailyQuests.set({
    ...quest,
    progress: clamped,
    completed_at: justCompleted ? now : null,
  });

  if (justCompleted) {
    const user = store.users.get(discordId);
    if (user) {
      await store.users.set({
        ...user,
        pills: (user.pills ?? 0) + quest.reward_pills,
        contribution_points: (user.contribution_points ?? 0) + quest.reward_contribution,
      });
      if (quest.reward_xp > 0) {
        const { awardXp } = await import('../leveling/tracker.js');
        await awardXp({
          discordId,
          username: user.username,
          displayName: user.display_name,
          amount: quest.reward_xp,
          source: 'event',
          metadata: { quest_id: quest.id, quest_type: type, set_progress: true },
        });
      }
      logger.info(
        {
          discord_id: discordId,
          quest_id: quest.id,
          type,
          target: quest.target,
          reward_xp: quest.reward_xp,
          reward_pills: quest.reward_pills,
          reward_contribution: quest.reward_contribution,
        },
        'quest: completed via setProgress + rewards granted',
      );
    }
  }

  return { updated: true, completed: justCompleted };
}

/**
 * Convenience hook for `equip_both` quest: call after any equip operation
 * (công pháp OR vũ khí) — if BOTH slots are now filled, increments the
 * quest. Idempotent because incrementProgress no-ops on already-completed
 * quests. Lazy-imported to avoid circular deps at call sites.
 */
export async function checkEquipBothQuest(discordId: string): Promise<void> {
  const user = getStore().users.get(discordId);
  if (!user) return;
  // Phase 14.6 — read multi-slot array via centralized helper (handles
  // back-compat fallback to legacy single-slot field internally).
  const { readEquippedCongPhapSlugs } = await import('../combat/equipment-resolver.js');
  if (readEquippedCongPhapSlugs(user).length === 0 || !user.equipped_weapon_slug) return;
  await incrementProgress(discordId, 'equip_both', 1);
}

export const __for_testing = { QUEST_POOL, vnDayStart };
