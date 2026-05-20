import { ulid } from 'ulid';
import { rankIndex } from '../../config/cultivation.js';
import { getStore } from '../../db/index.js';
import type { CultivationRankId, PhapKhi } from '../../db/types.js';

/**
 * Pháp khí shop helper. Mirrors weapon-shop.ts shape so /shop can share
 * the tab pattern. Single equip slot (User.equipped_phap_khi_slug),
 * unlock at Kim Đan via canEquipPhapKhi check elsewhere — buy is gated
 * only by rank, not equip-ability.
 */

function meetsRankRequirement(
  userRank: CultivationRankId,
  required: CultivationRankId | null,
): boolean {
  if (required === null) return true;
  return rankIndex(userRank) >= rankIndex(required);
}

export function listShopPhapKhi(userRank: CultivationRankId): PhapKhi[] {
  return getStore()
    .phapKhiCatalog.query((p) => meetsRankRequirement(userRank, p.min_rank_required))
    .sort((a, b) => a.cost_contribution - b.cost_contribution);
}

export function listLockedShopPhapKhi(userRank: CultivationRankId): PhapKhi[] {
  return getStore()
    .phapKhiCatalog.query((p) => !meetsRankRequirement(userRank, p.min_rank_required))
    .sort((a, b) => a.cost_contribution - b.cost_contribution);
}

export type BuyPhapKhiResult =
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

export async function buyPhapKhi(userId: string, slug: string): Promise<BuyPhapKhiResult> {
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) return { ok: false, reason: 'no-user' };
  const item = store.phapKhiCatalog.get(slug);
  if (!item) return { ok: false, reason: 'not-found' };
  if (!meetsRankRequirement(user.cultivation_rank, item.min_rank_required)) {
    return { ok: false, reason: 'rank-too-low' };
  }
  const owned = store.userPhapKhi.query(
    (u) => u.discord_id === userId && u.phap_khi_slug === slug,
  );
  if (owned.length > 0) return { ok: false, reason: 'already-owned' };
  const pills = user.pills ?? 0;
  const contrib = user.contribution_points ?? 0;
  if (pills < item.cost_pills) return { ok: false, reason: 'not-enough-pills' };
  if (contrib < item.cost_contribution) return { ok: false, reason: 'not-enough-contribution' };

  const newPills = pills - item.cost_pills;
  const newContribution = contrib - item.cost_contribution;
  await store.users.set({ ...user, pills: newPills, contribution_points: newContribution });
  await store.userPhapKhi.set({
    id: ulid(),
    discord_id: userId,
    phap_khi_slug: slug,
    acquired_at: Date.now(),
    level: 0,
  });
  if (item.cost_contribution > 0) {
    const { incrementProgress } = await import('../quests/daily-quest.js');
    void incrementProgress(userId, 'spend_contribution', item.cost_contribution);
  }
  return { ok: true, newPills, newContribution };
}

export const PHAP_KHI_RARITY_EMOJI: Record<string, string> = {
  rare: '🔵',
  epic: '🟣',
  legendary: '🟡',
  tien_khi: '✨',
};
