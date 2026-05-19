import { CULTIVATION_RANKS } from '../../config/cultivation.js';
import type { CongPhap, Nhan, PhapKhi, User, UserWeapon, Weapon } from '../../db/types.js';

/**
 * Lực chiến (combat power) formula — Phase 14 round 3 multi-slot redesign.
 *
 *   total =
 *     BASE +
 *     level * LEVEL_BONUS +
 *     rank_idx * RANK_BONUS_STEP +
 *     SUB_TITLE_BONUS (if any) +
 *     stat_alloc contribution +
 *     sum(cong_phap[i].cp * (1 + level[i]*0.10))  over up to 3 slots
 *     + phap_khi.cp * (1 + phap_khi_level*0.10)
 *     + sum(nhan[i].cp)  over up to 2 slots
 *     + weapon.damage_base * 10 * (1 + weapon_level * 0.15)
 *
 * Phase 14 round 3 changes (Bill 2026-05-20 multi-equip):
 *   - cong_phap now array (up to 3) instead of single slot
 *   - pháp khí slot added — single equip, stacks like weapon
 *   - nhẫn slots added — up to 2 rings, both contribute (no upgrade level
 *     on nhẫn yet — flat bonus)
 *
 * Back-compat: callers that pass a single `equippedCongPhap` still work —
 * helper `singleAsList` wraps it. New callers should resolve all slots.
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
const PHAP_KHI_LEVEL_SCALE = 0.1;

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
  /** Total bonus from ALL equipped công pháp slots (after upgrade scaling). */
  congPhapBonus: number;
  /** Bonus from equipped pháp khí (after upgrade scaling). */
  phapKhiBonus: number;
  /** Bonus from all equipped nhẫn slots. */
  nhanBonus: number;
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
 * Resolved công pháp slot view — pairs the catalog entry with the user's
 * upgrade level for that ownership row. Caller resolves before invoking
 * `computeCombatPowerBreakdown`.
 */
export interface CongPhapSlotContribution {
  item: CongPhap;
  level: number;
}

/** Resolved pháp khí slot view. */
export interface PhapKhiContribution {
  item: PhapKhi;
  level: number;
}

/**
 * Returns the lực chiến components AND the total. All slot arrays default
 * to empty — callers can pass only what's equipped.
 */
export function computeCombatPowerBreakdown(
  user: Pick<User, 'level' | 'cultivation_rank' | 'sub_title' | 'stat_alloc'>,
  congPhapSlots: readonly CongPhapSlotContribution[] = [],
  phapKhi: PhapKhiContribution | null = null,
  nhanSlots: readonly Nhan[] = [],
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

  let congPhapBonus = 0;
  for (const slot of congPhapSlots) {
    const lv = Math.max(0, Math.min(10, slot.level ?? 0));
    congPhapBonus += Math.round(slot.item.stat_bonuses.combat_power * (1 + lv * CONG_PHAP_LEVEL_SCALE));
  }

  let phapKhiBonus = 0;
  if (phapKhi) {
    const lv = Math.max(0, Math.min(10, phapKhi.level ?? 0));
    phapKhiBonus = Math.round(phapKhi.item.stat_bonuses.combat_power * (1 + lv * PHAP_KHI_LEVEL_SCALE));
  }

  let nhanBonus = 0;
  for (const nhan of nhanSlots) {
    nhanBonus += nhan.stat_bonuses.combat_power;
  }

  const wpRaw = weapon?.damage_base ?? 0;
  const wpLv = Math.max(0, Math.min(10, weapon?.level ?? 0));
  const weaponBonus = Math.round(wpRaw * 10 * (1 + wpLv * WEAPON_LEVEL_SCALE));

  const total =
    BASE + levelBonus + rankBonus + subTitleBonus + statBonus + congPhapBonus + phapKhiBonus + nhanBonus + weaponBonus;

  return {
    base: BASE,
    levelBonus,
    rankBonus,
    subTitleBonus,
    statBonus,
    congPhapBonus,
    phapKhiBonus,
    nhanBonus,
    weaponBonus,
    total,
  };
}

/** Shortcut for callers that only need the number. */
export function computeCombatPower(
  user: Pick<User, 'level' | 'cultivation_rank' | 'sub_title' | 'stat_alloc'>,
  congPhapSlots: readonly CongPhapSlotContribution[] = [],
  phapKhi: PhapKhiContribution | null = null,
  nhanSlots: readonly Nhan[] = [],
  weapon: WeaponContribution | null = null,
): number {
  return computeCombatPowerBreakdown(user, congPhapSlots, phapKhi, nhanSlots, weapon).total;
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
  PHAP_KHI_LEVEL_SCALE,
  RANK_INDEX,
};
