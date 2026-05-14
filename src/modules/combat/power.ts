import { CULTIVATION_RANKS } from '../../config/cultivation.js';
import type { CongPhap, User } from '../../db/types.js';

/**
 * Lực chiến (combat power) formula for Phase 12.
 *
 *   combat_power = base + level_bonus + rank_bonus + sub_title_bonus + cong_phap_bonus
 *
 *   base             = 100
 *   level_bonus      = level × 10
 *   rank_bonus       = rank_index × 50  (Phàm Nhân=0, ..., Độ Kiếp=9, Tiên Nhân=10)
 *   sub_title_bonus  = 50 if user has a sub_title else 0
 *   cong_phap_bonus  = sum of equipped công pháp.stat_bonuses.combat_power (single slot for now)
 *
 * Pure function — no I/O, no Discord. Caller passes the user + the
 * resolved CongPhap entity for their equipped slug (or null if nothing
 * equipped or the entry was deleted from catalog).
 */

const BASE = 100;
const LEVEL_BONUS = 10;
const RANK_BONUS_STEP = 50;
const SUB_TITLE_BONUS = 50;

// Rank index: ordering of CULTIVATION_RANKS plus Tiên Nhân appended.
// Building once at module-load keeps the hot path branch-free.
const RANK_INDEX: ReadonlyMap<string, number> = (() => {
  const map = new Map<string, number>();
  CULTIVATION_RANKS.forEach((r, i) => map.set(r.id, i));
  map.set('tien_nhan', CULTIVATION_RANKS.length); // 10
  return map;
})();

export interface CombatPowerBreakdown {
  base: number;
  levelBonus: number;
  rankBonus: number;
  subTitleBonus: number;
  congPhapBonus: number;
  total: number;
}

/**
 * Returns the lực chiến components AND the total. Useful for /stat
 * embeds that want to show "Level × 10 = 50" style attribution.
 */
export function computeCombatPowerBreakdown(
  user: Pick<User, 'level' | 'cultivation_rank' | 'sub_title'>,
  equippedCongPhap: CongPhap | null,
): CombatPowerBreakdown {
  const rankIdx = RANK_INDEX.get(user.cultivation_rank) ?? 0;
  const levelBonus = (user.level ?? 0) * LEVEL_BONUS;
  const rankBonus = rankIdx * RANK_BONUS_STEP;
  const subTitleBonus = user.sub_title ? SUB_TITLE_BONUS : 0;
  const congPhapBonus = equippedCongPhap?.stat_bonuses.combat_power ?? 0;
  const total = BASE + levelBonus + rankBonus + subTitleBonus + congPhapBonus;
  return {
    base: BASE,
    levelBonus,
    rankBonus,
    subTitleBonus,
    congPhapBonus,
    total,
  };
}

/** Shortcut for callers that only need the number. */
export function computeCombatPower(
  user: Pick<User, 'level' | 'cultivation_rank' | 'sub_title'>,
  equippedCongPhap: CongPhap | null,
): number {
  return computeCombatPowerBreakdown(user, equippedCongPhap).total;
}

export const __for_testing = {
  BASE,
  LEVEL_BONUS,
  RANK_BONUS_STEP,
  SUB_TITLE_BONUS,
  RANK_INDEX,
};
