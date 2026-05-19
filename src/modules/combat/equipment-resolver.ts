import { rankIndex } from '../../config/cultivation.js';
import { getStore } from '../../db/index.js';
import type { CultivationRankId, Nhan, User } from '../../db/types.js';
import type {
  CongPhapSlotContribution,
  PhapKhiContribution,
  WeaponContribution,
} from './power.js';
import { resolveWeaponContribution } from './power.js';

/**
 * Phase 14 round 3 — equipment slot unlock thresholds + resolver helpers.
 *
 * Slot capacity:
 *   - công pháp: 1 free, slot 2 unlocked at Trúc Cơ (idx 2), slot 3 at Hóa Thần (idx 5)
 *   - pháp khí:  unlocked at Kim Đan (idx 3)
 *   - nhẫn:      slot 1 free, slot 2 unlocked at Nguyên Anh (idx 4)
 *   - vũ khí:    always 1 slot (bản mệnh forge from arena)
 *
 * `resolveEquippedSlots(userId)` returns the fully-hydrated view used by
 * /stat, /duel, /inventory. Reads from store; pure read, no mutation.
 */

export const CONG_PHAP_SLOT_UNLOCK: readonly { slotIdx: number; minRank: CultivationRankId }[] = [
  { slotIdx: 0, minRank: 'pham_nhan' },
  { slotIdx: 1, minRank: 'truc_co' },
  { slotIdx: 2, minRank: 'hoa_than' },
];

export const NHAN_SLOT_UNLOCK: readonly { slotIdx: number; minRank: CultivationRankId }[] = [
  { slotIdx: 0, minRank: 'pham_nhan' },
  { slotIdx: 1, minRank: 'nguyen_anh' },
];

export const PHAP_KHI_MIN_RANK: CultivationRankId = 'kim_dan';

/**
 * Returns the maximum number of công pháp slots unlocked for the given rank.
 * E.g., Trúc Cơ → 2 slots, Phàm Nhân → 1, Hóa Thần+ → 3.
 */
export function maxCongPhapSlots(rank: CultivationRankId): number {
  const userIdx = rankIndex(rank);
  let max = 0;
  for (const { minRank } of CONG_PHAP_SLOT_UNLOCK) {
    if (userIdx >= rankIndex(minRank)) max++;
  }
  return max;
}

/**
 * Returns the maximum number of nhẫn slots unlocked for the given rank.
 */
export function maxNhanSlots(rank: CultivationRankId): number {
  const userIdx = rankIndex(rank);
  let max = 0;
  for (const { minRank } of NHAN_SLOT_UNLOCK) {
    if (userIdx >= rankIndex(minRank)) max++;
  }
  return max;
}

/**
 * Returns true if the user's rank meets the pháp khí unlock threshold.
 */
export function canEquipPhapKhi(rank: CultivationRankId): boolean {
  return rankIndex(rank) >= rankIndex(PHAP_KHI_MIN_RANK);
}

/**
 * Read the user's equipped công pháp slots as an array. Handles back-compat
 * fallback from the legacy single-slot `equipped_cong_phap_slug`.
 */
export function readEquippedCongPhapSlugs(user: User): string[] {
  if (user.equipped_cong_phap_slugs && user.equipped_cong_phap_slugs.length > 0) {
    return user.equipped_cong_phap_slugs.filter((s): s is string => typeof s === 'string');
  }
  if (user.equipped_cong_phap_slug) return [user.equipped_cong_phap_slug];
  return [];
}

export function readEquippedRingSlugs(user: User): string[] {
  if (!user.equipped_ring_slugs) return [];
  return user.equipped_ring_slugs.filter((s): s is string => typeof s === 'string');
}

export interface EquippedSlots {
  congPhap: CongPhapSlotContribution[];
  phapKhi: PhapKhiContribution | null;
  nhan: Nhan[];
  weapon: WeaponContribution | null;
}

export function resolveEquippedSlots(userId: string): EquippedSlots {
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) return { congPhap: [], phapKhi: null, nhan: [], weapon: null };

  // Công pháp slots
  const cpSlugs = readEquippedCongPhapSlugs(user);
  const congPhap: CongPhapSlotContribution[] = [];
  for (const slug of cpSlugs) {
    const item = store.congPhapCatalog.get(slug);
    if (!item) continue;
    const ownership = store.userCongPhap.query(
      (uc) => uc.discord_id === userId && uc.cong_phap_slug === slug,
    )[0];
    congPhap.push({ item, level: ownership?.level ?? 0 });
  }

  // Pháp khí (single slot)
  let phapKhi: PhapKhiContribution | null = null;
  const pkSlug = user.equipped_phap_khi_slug ?? null;
  if (pkSlug) {
    const item = store.phapKhiCatalog.get(pkSlug);
    if (item) {
      const ownership = store.userPhapKhi.query(
        (up) => up.discord_id === userId && up.phap_khi_slug === pkSlug,
      )[0];
      phapKhi = { item, level: ownership?.level ?? 0 };
    }
  }

  // Nhẫn slots (up to 2)
  const ringSlugs = readEquippedRingSlugs(user);
  const nhan: Nhan[] = [];
  for (const slug of ringSlugs) {
    const item = store.nhanCatalog.get(slug);
    if (item) nhan.push(item);
  }

  // Weapon
  const weapon = resolveWeaponContribution(
    user.equipped_weapon_slug,
    (s) => store.weaponCatalog.get(s) ?? null,
    (s) =>
      store.userWeapons.query((w) => w.discord_id === userId && w.weapon_slug === s)[0] ?? null,
  );

  return { congPhap, phapKhi, nhan, weapon };
}
