import { ulid } from 'ulid';
import { getStore } from '../../db/index.js';
import type { CultivationRankId, Weapon } from '../../db/types.js';

/**
 * Phase 14 — weapon shop helper. Mirrors `combat/cong-phap.ts` shape so
 * `/shop` and `/weapon buy` share rank-gating + ownership semantics.
 *
 * Bản mệnh weapons (`tier = 'ban_menh'`) are NOT shop-buyable — they're
 * forged via `/arena forge`. Shop only lists weapons with `shop != null`.
 */

const RANK_ORDER: readonly CultivationRankId[] = [
  'pham_nhan',
  'luyen_khi',
  'truc_co',
  'kim_dan',
  'nguyen_anh',
  'hoa_than',
  'luyen_hu',
  'hop_the',
  'dai_thua',
  'do_kiep',
  'tien_nhan',
];

function rankIdx(id: CultivationRankId): number {
  const i = RANK_ORDER.indexOf(id);
  return i < 0 ? 0 : i;
}

function meetsRankRequirement(
  userRank: CultivationRankId,
  required: CultivationRankId | null,
): boolean {
  if (required === null) return true;
  return rankIdx(userRank) >= rankIdx(required);
}

export function listShopWeapons(userRank: CultivationRankId): Weapon[] {
  const store = getStore();
  return store.weaponCatalog
    .query((w) => w.shop !== null && meetsRankRequirement(userRank, w.shop?.unlock_realm ?? null))
    .sort((a, b) => (a.shop?.cost_contribution ?? 0) - (b.shop?.cost_contribution ?? 0));
}

export function listLockedShopWeapons(userRank: CultivationRankId): Weapon[] {
  const store = getStore();
  return store.weaponCatalog
    .query((w) => w.shop !== null && !meetsRankRequirement(userRank, w.shop?.unlock_realm ?? null))
    .sort((a, b) => (a.shop?.cost_contribution ?? 0) - (b.shop?.cost_contribution ?? 0));
}

export type BuyWeaponResult =
  | { ok: true; newPills: number; newContribution: number }
  | {
      ok: false;
      reason:
        | 'not-found'
        | 'not-buyable'
        | 'already-owned'
        | 'rank-too-low'
        | 'not-enough-pills'
        | 'not-enough-contribution'
        | 'no-user';
    };

export async function buyWeapon(userId: string, slug: string): Promise<BuyWeaponResult> {
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) return { ok: false, reason: 'no-user' };
  const weapon = store.weaponCatalog.get(slug);
  if (!weapon) return { ok: false, reason: 'not-found' };
  if (!weapon.shop) return { ok: false, reason: 'not-buyable' };
  if (!meetsRankRequirement(user.cultivation_rank, weapon.shop.unlock_realm)) {
    return { ok: false, reason: 'rank-too-low' };
  }
  const owned = store.userWeapons.query(
    (w) => w.discord_id === userId && w.weapon_slug === slug,
  );
  if (owned.length > 0) return { ok: false, reason: 'already-owned' };

  const pills = user.pills ?? 0;
  const contrib = user.contribution_points ?? 0;
  if (pills < weapon.shop.cost_pills) return { ok: false, reason: 'not-enough-pills' };
  if (contrib < weapon.shop.cost_contribution) {
    return { ok: false, reason: 'not-enough-contribution' };
  }

  const newPills = pills - weapon.shop.cost_pills;
  const newContribution = contrib - weapon.shop.cost_contribution;
  await store.users.set({
    ...user,
    pills: newPills,
    contribution_points: newContribution,
  });
  await store.userWeapons.set({
    id: ulid(),
    discord_id: userId,
    weapon_slug: slug,
    custom_stats: null,
    custom_visual: null,
    custom_skills: null,
    acquired_at: Date.now(),
    level: 0,
  });

  // Phase 14 quest — spend_contribution.
  if (weapon.shop.cost_contribution > 0) {
    const { incrementProgress } = await import('../quests/daily-quest.js');
    void incrementProgress(userId, 'spend_contribution', weapon.shop.cost_contribution);
  }

  return { ok: true, newPills, newContribution };
}

export const TIER_ICON: Record<string, string> = {
  ban_menh: '🔮',
  pham: '⚔️',
  dia: '🗡️',
  thien: '🪄',
  tien: '✨',
  // Phase 14.4 — endgame tiers
  thanh: '🌟',
  than: '⚜️',
  huyen: '👑',
};
