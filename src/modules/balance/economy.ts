import { DAILY_BASE_XP, TRIBULATION_TIERS } from '../../config/leveling.js';
import { costToUpgrade, weaponSuccessRate } from '../combat/upgrade.js';
import { QUEST_POOL, SLAY_POOL, STUDY_POOL } from '../quests/daily-quest.js';
import { RAID_DAILY_CAP } from '../raid/engine.js';
import { BOSS_REWARD } from '../raid/service.js';

/**
 * Daily income of an engaged member, worked out from the live constants so
 * docs/ECONOMY.md and tests/balance/economy.test.ts cannot drift from the
 * code. "Before" is the game before Tu Tiên Pixel (daily + one quest);
 * "after" adds the study and slay rows, the raid cap and the weekly boss.
 * Message XP and tribulations are left out: they did not change.
 */

export interface Income {
  xp: number;
  pills: number;
  coins: number;
}

const avg = (
  pool: readonly { reward_xp: number; reward_pills: number; reward_contribution: number }[],
): Income => ({
  xp: pool.reduce((s, q) => s + q.reward_xp, 0) / pool.length,
  pills: pool.reduce((s, q) => s + q.reward_pills, 0) / pool.length,
  coins: pool.reduce((s, q) => s + q.reward_contribution, 0) / pool.length,
});

const add = (...xs: Income[]): Income => ({
  xp: xs.reduce((s, x) => s + x.xp, 0),
  pills: xs.reduce((s, x) => s + x.pills, 0),
  coins: xs.reduce((s, x) => s + x.coins, 0),
});

/** /daily without streak bonuses: base XP, 2 pills, 5 cống hiến. */
export const DAILY_INCOME: Income = { xp: DAILY_BASE_XP, pills: 2, coins: 5 };

export function incomeRows(): { source: string; before: Income | null; after: Income }[] {
  const boss: Income = {
    xp: BOSS_REWARD.xp / 7,
    pills: BOSS_REWARD.pills / 7,
    coins: BOSS_REWARD.coins / 7,
  };
  return [
    { source: '/daily', before: DAILY_INCOME, after: DAILY_INCOME },
    { source: 'Nhiệm vụ hằng ngày (trung bình)', before: avg(QUEST_POOL), after: avg(QUEST_POOL) },
    { source: 'Nhiệm vụ học tập', before: null, after: avg(STUDY_POOL) },
    { source: 'Nhiệm vụ trảm yêu', before: null, after: avg(SLAY_POOL) },
    { source: 'Bí cảnh (giới hạn ngày)', before: null, after: { ...RAID_DAILY_CAP } },
    { source: 'Boss tuần (chia 7)', before: null, after: boss },
  ];
}

export function dailyIncome(): { before: Income; after: Income } {
  const rows = incomeRows();
  return {
    before: add(...rows.map((r) => r.before ?? { xp: 0, pills: 0, coins: 0 })),
    after: add(...rows.map((r) => r.after)),
  };
}

/** Expected pills and cống hiến to take a weapon from +0 to +7, failures included (no downgrades below +7). */
export function weaponToSeven(): { pills: number; coins: number } {
  let pills = 0;
  let coins = 0;
  for (let lv = 0; lv < 7; lv++) {
    const c = costToUpgrade(lv);
    const tries = 1 / weaponSuccessRate(lv);
    pills += c.pills * tries;
    coins += c.contribution * tries;
  }
  return { pills: Math.round(pills), coins: Math.round(coins) };
}

export const TRIBULATION_PASS = TRIBULATION_TIERS;
