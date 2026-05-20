import { ulid } from 'ulid';
import { rankIndex } from '../../config/cultivation.js';
import { getStore } from '../../db/index.js';
import type { CultivationRankId, Nhan } from '../../db/types.js';

/**
 * Nhẫn shop helper. Up to 2 nhẫn equipped via User.equipped_ring_slugs.
 * Buy itself is rank-gated only; slot gating enforced at equip time
 * (slot 2 unlocks at Nguyên Anh).
 */

function meetsRankRequirement(
  userRank: CultivationRankId,
  required: CultivationRankId | null,
): boolean {
  if (required === null) return true;
  return rankIndex(userRank) >= rankIndex(required);
}

export function listShopNhan(userRank: CultivationRankId): Nhan[] {
  return getStore()
    .nhanCatalog.query((n) => meetsRankRequirement(userRank, n.min_rank_required))
    .sort((a, b) => a.cost_contribution - b.cost_contribution);
}

export function listLockedShopNhan(userRank: CultivationRankId): Nhan[] {
  return getStore()
    .nhanCatalog.query((n) => !meetsRankRequirement(userRank, n.min_rank_required))
    .sort((a, b) => a.cost_contribution - b.cost_contribution);
}

export type BuyNhanResult =
  | { ok: true; newPills: number; newContribution: number }
  | {
      ok: false;
      reason:
        | 'not-found'
        | 'already-owned'
        | 'rank-too-low'
        | 'not-enough-pills'
        | 'not-enough-contribution'
        | 'no-user';
    };

export async function buyNhan(userId: string, slug: string): Promise<BuyNhanResult> {
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) return { ok: false, reason: 'no-user' };
  const item = store.nhanCatalog.get(slug);
  if (!item) return { ok: false, reason: 'not-found' };
  if (!meetsRankRequirement(user.cultivation_rank, item.min_rank_required)) {
    return { ok: false, reason: 'rank-too-low' };
  }
  const owned = store.userNhan.query((u) => u.discord_id === userId && u.nhan_slug === slug);
  if (owned.length > 0) return { ok: false, reason: 'already-owned' };
  const pills = user.pills ?? 0;
  const contrib = user.contribution_points ?? 0;
  if (pills < item.cost_pills) return { ok: false, reason: 'not-enough-pills' };
  if (contrib < item.cost_contribution) return { ok: false, reason: 'not-enough-contribution' };

  const newPills = pills - item.cost_pills;
  const newContribution = contrib - item.cost_contribution;
  await store.users.set({ ...user, pills: newPills, contribution_points: newContribution });
  await store.userNhan.set({
    id: ulid(),
    discord_id: userId,
    nhan_slug: slug,
    acquired_at: Date.now(),
  });
  if (item.cost_contribution > 0) {
    const { incrementProgress } = await import('../quests/daily-quest.js');
    void incrementProgress(userId, 'spend_contribution', item.cost_contribution);
  }
  return { ok: true, newPills, newContribution };
}

export const NHAN_RARITY_EMOJI: Record<string, string> = {
  uncommon: '⚪',
  rare: '🔵',
  epic: '🟣',
  legendary: '🟡',
};
