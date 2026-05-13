import { describe, expect, it } from 'vitest';
import type { User } from '../../src/db/types.js';
import { computeDailyAward, dayKey, nextMilestoneHint } from '../../src/modules/leveling/daily.js';

const TZ = 'Asia/Ho_Chi_Minh';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    discord_id: 'u1',
    username: 'alice',
    display_name: null,
    xp: 0,
    level: 0,
    cultivation_rank: 'pham_nhan',
    sub_title: null,
    joined_at: 0,
    verified_at: null,
    last_message_at: null,
    last_daily_at: null,
    daily_streak: 0,
    is_suspect: false,
    notes: null,
    ...overrides,
  };
}

// 2026-05-13 00:00:00 UTC = 2026-05-13 07:00 in VN
const NOW = Date.parse('2026-05-13T07:00:00+07:00');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('dayKey', () => {
  it('formats YYYY-MM-DD in VN timezone', () => {
    expect(dayKey(NOW, TZ)).toBe('2026-05-13');
  });

  it('UTC midnight → previous VN day if before 17:00 UTC', () => {
    // 2026-05-13 00:00 UTC = 2026-05-13 07:00 VN → same day
    // 2026-05-12 16:00 UTC = 2026-05-12 23:00 VN → still 12th
    // 2026-05-12 17:00 UTC = 2026-05-13 00:00 VN → 13th
    expect(dayKey(Date.parse('2026-05-12T16:00:00Z'), TZ)).toBe('2026-05-12');
    expect(dayKey(Date.parse('2026-05-12T17:00:00Z'), TZ)).toBe('2026-05-13');
  });
});

describe('computeDailyAward — first claim', () => {
  it('no previous claim → 100 XP, streak=1, no bonus', () => {
    const r = computeDailyAward(makeUser(), NOW, TZ);
    expect(r.ok).toBe(true);
    expect(r.amount).toBe(100);
    expect(r.base).toBe(100);
    expect(r.bonus).toBe(0);
    expect(r.newStreak).toBe(1);
  });

  it('null user (first-time user) → first claim, streak=1', () => {
    const r = computeDailyAward(null, NOW, TZ);
    expect(r.ok).toBe(true);
    expect(r.newStreak).toBe(1);
  });
});

describe('computeDailyAward — already claimed', () => {
  it('claimed today → ok=false, reason=already-claimed-today', () => {
    const lastTs = NOW - 3 * 60 * 60 * 1000; // 3h ago, still same VN day
    const r = computeDailyAward(makeUser({ last_daily_at: lastTs, daily_streak: 5 }), NOW, TZ);
    expect(r.ok).toBe(false);
    expect(r.amount).toBe(0);
    expect(r.reason).toBe('already-claimed-today');
    expect(r.newStreak).toBe(5); // unchanged
  });
});

describe('computeDailyAward — streak continuation', () => {
  it('claimed yesterday → streak increments by 1', () => {
    const yesterday = NOW - MS_PER_DAY;
    const r = computeDailyAward(makeUser({ last_daily_at: yesterday, daily_streak: 3 }), NOW, TZ);
    expect(r.ok).toBe(true);
    expect(r.newStreak).toBe(4);
    expect(r.bonus).toBe(0);
    expect(r.amount).toBe(100);
  });

  it('streak day 7 → +50 bonus', () => {
    const yesterday = NOW - MS_PER_DAY;
    const r = computeDailyAward(makeUser({ last_daily_at: yesterday, daily_streak: 6 }), NOW, TZ);
    expect(r.newStreak).toBe(7);
    expect(r.bonus).toBe(50);
    expect(r.amount).toBe(150);
  });

  it('streak day 14 → +150 bonus', () => {
    const yesterday = NOW - MS_PER_DAY;
    const r = computeDailyAward(makeUser({ last_daily_at: yesterday, daily_streak: 13 }), NOW, TZ);
    expect(r.newStreak).toBe(14);
    expect(r.bonus).toBe(150);
    expect(r.amount).toBe(250);
  });

  it('streak day 30 → +500 bonus', () => {
    const yesterday = NOW - MS_PER_DAY;
    const r = computeDailyAward(makeUser({ last_daily_at: yesterday, daily_streak: 29 }), NOW, TZ);
    expect(r.newStreak).toBe(30);
    expect(r.bonus).toBe(500);
    expect(r.amount).toBe(600);
  });

  it('streak day 31 → no bonus (back to base)', () => {
    const yesterday = NOW - MS_PER_DAY;
    const r = computeDailyAward(makeUser({ last_daily_at: yesterday, daily_streak: 30 }), NOW, TZ);
    expect(r.newStreak).toBe(31);
    expect(r.bonus).toBe(0);
    expect(r.amount).toBe(100);
  });
});

describe('computeDailyAward — streak reset', () => {
  it('missed a day → streak resets to 1', () => {
    const twoDaysAgo = NOW - 2 * MS_PER_DAY;
    const r = computeDailyAward(makeUser({ last_daily_at: twoDaysAgo, daily_streak: 10 }), NOW, TZ);
    expect(r.newStreak).toBe(1);
    expect(r.bonus).toBe(0);
  });

  it('missed a week → streak resets to 1', () => {
    const aWeekAgo = NOW - 7 * MS_PER_DAY;
    const r = computeDailyAward(makeUser({ last_daily_at: aWeekAgo, daily_streak: 50 }), NOW, TZ);
    expect(r.newStreak).toBe(1);
  });
});

describe('nextMilestoneHint', () => {
  it('points to next reachable milestone', () => {
    expect(nextMilestoneHint(0)).toMatch(/7 ngày/);
    expect(nextMilestoneHint(7)).toMatch(/14 ngày/);
    expect(nextMilestoneHint(13)).toMatch(/14 ngày/);
    expect(nextMilestoneHint(20)).toMatch(/30 ngày/);
  });

  it('past all milestones → null', () => {
    expect(nextMilestoneHint(30)).toBeNull();
    expect(nextMilestoneHint(100)).toBeNull();
  });
});
