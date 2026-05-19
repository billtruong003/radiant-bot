import { CULTIVATION_RANKS } from '../../config/cultivation.js';
import type { CongPhap, User, UserWeapon, Weapon } from '../../db/types.js';

/**
 * Lực chiến (combat power) formula — Phase 14 redesign.
 *
 *   total =
 *     BASE +
 *     level * LEVEL_BONUS +
 *     rank_idx * RANK_BONUS_STEP +
 *     SUB_TITLE_BONUS (if any) +
 *     stat_alloc contribution +
 *     cong_phap contribution * (1 + cp_level * 0.10) +
 *     weapon contribution * (1 + weapon_level * 0.15)
 *
 * Phase 14 changes (Bill 2026-05-20 vision — stat allocation):
 *   - LEVEL_BONUS halved (10 → 5) and RANK_BONUS_STEP lowered (50 → 30) to
 *     make room for user-allocated stats. Existing users with 0 alloc see
 *     a small LC drop, then catch up after spending their migrated points.
 *   - Added stat_alloc weights: dmg×8, hp×5, def×3, spd×4. All-dmg build
 *     biggest LC, balanced build slightly lower but tankier in duel HP.
 *   - Công pháp and weapon now scale with their upgrade `level` field.
 *
 * Pure function — no I/O, no Discord. Caller resolves all entities.
 */

const BASE = 100;
const LEVEL_BONUS = 5;
const RANK_BONUS_STEP = 30;
const SUB_TITLE_BONUS = 30;

const STAT_WEIGHT = {
  dmg: 8,
  hp: 5,
  def: 3,
  spd: 4,
} as const;

const CONG_PHAP_LEVEL_SCALE = 0.1;
const WEAPON_LEVEL_SCALE = 0.15;

const RANK_INDEX: ReadonlyMap<string, number> = (() => {
  const map = new Map<string, number>();
  CULTIVATION_RANKS.forEach((r, i) => map.set(r.id, i));
  map.set('tien_nhan', CULTIVATION_RANKS.length);
  return map;
})();

export interface CombatPowerBreakdown {
  base: number;
  levelBonus: number;
  rankBonus: number;
  subTitleBonus: number;
  statBonus: number;
  congPhapBonus: number;
  weaponBonus: number;
  total: number;
}

/**
 * Resolved weapon view — caller can pass a `Weapon` catalog entry OR a
 * bản-mệnh UserWeapon (which carries custom_stats). The narrow shape
 * lets `simulateDuel` and `/stat` share one resolver.
 */
export interface WeaponContribution {
  damage_base: number;
  level: number;
}

/**
 * Returns the lực chiến components AND the total. Useful for /stat
 * embeds that want to show attribution.
 *
 * `equippedCongPhap` / `weapon` are null when the user has nothing
 * equipped in that slot — bonus = 0.
 */
export function computeCombatPowerBreakdown(
  user: Pick<User, 'level' | 'cultivation_rank' | 'sub_title' | 'stat_alloc'>,
  equippedCongPhap: CongPhap | null,
  congPhapLevel: number = 0,
  weapon: WeaponContribution | null = null,
): CombatPowerBreakdown {
  const rankIdx = RANK_INDEX.get(user.cultivation_rank) ?? 0;
  const levelBonus = (user.level ?? 0) * LEVEL_BONUS;
  const rankBonus = rankIdx * RANK_BONUS_STEP;
  const subTitleBonus = user.sub_title ? SUB_TITLE_BONUS : 0;

  const alloc = user.stat_alloc ?? { dmg: 0, hp: 0, def: 0, spd: 0 };
  const statBonus =
    alloc.dmg * STAT_WEIGHT.dmg +
    alloc.hp * STAT_WEIGHT.hp +
    alloc.def * STAT_WEIGHT.def +
    alloc.spd * STAT_WEIGHT.spd;

  const cpRaw = equippedCongPhap?.stat_bonuses.combat_power ?? 0;
  const cpLv = Math.max(0, Math.min(10, congPhapLevel ?? 0));
  const congPhapBonus = Math.round(cpRaw * (1 + cpLv * CONG_PHAP_LEVEL_SCALE));

  const wpRaw = weapon?.damage_base ?? 0;
  const wpLv = Math.max(0, Math.min(10, weapon?.level ?? 0));
  const weaponBonus = Math.round(wpRaw * 10 * (1 + wpLv * WEAPON_LEVEL_SCALE));

  const total = BASE + levelBonus + rankBonus + subTitleBonus + statBonus + congPhapBonus + weaponBonus;
  return {
    base: BASE,
    levelBonus,
    rankBonus,
    subTitleBonus,
    statBonus,
    congPhapBonus,
    weaponBonus,
    total,
  };
}

/** Shortcut for callers that only need the number. */
export function computeCombatPower(
  user: Pick<User, 'level' | 'cultivation_rank' | 'sub_title' | 'stat_alloc'>,
  equippedCongPhap: CongPhap | null,
  congPhapLevel: number = 0,
  weapon: WeaponContribution | null = null,
): number {
  return computeCombatPowerBreakdown(user, equippedCongPhap, congPhapLevel, weapon).total;
}

/**
 * Resolve the weapon contribution view for a user's equipped weapon.
 * Handles both catalog refs (lookup via slug) and bản mệnh forged
 * weapons (use custom_stats.damage_base). Returns null if nothing
 * equipped or the lookup misses entirely.
 */
export function resolveWeaponContribution(
  weaponSlug: string | null | undefined,
  catalogLookup: (slug: string) => Weapon | null,
  ownedLookup: (slug: string) => UserWeapon | null,
): WeaponContribution | null {
  if (!weaponSlug) return null;
  const catalog = catalogLookup(weaponSlug);
  if (catalog) {
    const owned = ownedLookup(weaponSlug);
    return { damage_base: catalog.stats.damage_base, level: owned?.level ?? 0 };
  }
  // Bản mệnh — not in catalog, lookup user-weapon record for custom_stats.
  const owned = ownedLookup(weaponSlug);
  if (owned?.custom_stats) {
    return { damage_base: owned.custom_stats.damage_base, level: owned.level ?? 0 };
  }
  return null;
}

export const __for_testing = {
  BASE,
  LEVEL_BONUS,
  RANK_BONUS_STEP,
  SUB_TITLE_BONUS,
  STAT_WEIGHT,
  CONG_PHAP_LEVEL_SCALE,
  WEAPON_LEVEL_SCALE,
  RANK_INDEX,
};
