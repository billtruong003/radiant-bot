import type { User } from '../../db/types.js';

/**
 * /daily reward + streak logic. Pure functions (no I/O, no Discord) so
 * the command file is a thin wrapper that persists the result.
 *
 * SPEC §3 daily rewards:
 *   - base                 : 100 XP
 *   - streak day 7         : +50  bonus
 *   - streak day 14        : +150 bonus
 *   - streak day 30        : +500 bonus
 *   - streak resets to 1 if a calendar day was missed
 *
 * Calendar days are computed in Asia/Ho_Chi_Minh (UTC+7) so "today vs
 * yesterday" matches what a Vietnamese player intuitively sees.
 */

const DEFAULT_TZ = 'Asia/Ho_Chi_Minh';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const BASE_AMOUNT = 100;
const STREAK_BONUSES: ReadonlyMap<number, number> = new Map([
  [7, 50],
  [14, 150],
  [30, 500],
]);

export interface DailyAwardResult {
  /** True if the user can claim today; false if already claimed. */
  ok: boolean;
  /** Total XP to award (base + bonus). 0 if !ok. */
  amount: number;
  base: number;
  bonus: number;
  /** New streak value to persist. Unchanged if !ok. */
  newStreak: number;
  reason?: 'already-claimed-today';
}

/**
 * Return the day key (YYYY-MM-DD) for a timestamp in the given timezone.
 * `en-CA` locale produces ISO-style output suitable for string comparison.
 */
export function dayKey(ts: number, tz: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ts));
}

/**
 * Compute the daily reward without mutating anything. Caller (command
 * file) reads `ok`, persists `newStreak` + xp + last_daily_at, then
 * awards XP.
 */
export function computeDailyAward(
  user: User | null,
  now: number = Date.now(),
  tz: string = DEFAULT_TZ,
): DailyAwardResult {
  const todayKey = dayKey(now, tz);
  const lastTs = user?.last_daily_at ?? null;

  // Already claimed today?
  if (lastTs !== null && dayKey(lastTs, tz) === todayKey) {
    return {
      ok: false,
      amount: 0,
      base: 0,
      bonus: 0,
      newStreak: user?.daily_streak ?? 0,
      reason: 'already-claimed-today',
    };
  }

  // Continuation vs reset: was last claim exactly yesterday?
  const yesterdayKey = dayKey(now - MS_PER_DAY, tz);
  const isContinuation = lastTs !== null && dayKey(lastTs, tz) === yesterdayKey;
  const newStreak = isContinuation ? (user?.daily_streak ?? 0) + 1 : 1;

  const bonus = STREAK_BONUSES.get(newStreak) ?? 0;
  return {
    ok: true,
    amount: BASE_AMOUNT + bonus,
    base: BASE_AMOUNT,
    bonus,
    newStreak,
  };
}

/**
 * Optional human-readable hint for the next reachable milestone, used in
 * the /daily reply embed.
 */
export function nextMilestoneHint(currentStreak: number): string | null {
  for (const [day, bonus] of STREAK_BONUSES) {
    if (day > currentStreak) {
      return `Còn ${day - currentStreak} ngày nữa đến mốc streak ${day} ngày (+${bonus} XP bonus)`;
    }
  }
  return null;
}
