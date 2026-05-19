import { ulid } from 'ulid';
import { CULTIVATION_RANKS } from '../../config/cultivation.js';
import { getStore } from '../../db/index.js';
import type { CongPhap, CultivationRankId, UserCongPhap } from '../../db/types.js';

/**
 * Phase 12 — công pháp inventory + acquisition logic. All atomic via
 * store mutations. Pure-ish: no Discord side-effects, embeds live in
 * the slash command files.
 */

const RANK_ORDER: ReadonlyMap<CultivationRankId, number> = (() => {
  const m = new Map<CultivationRankId, number>();
  CULTIVATION_RANKS.forEach((r, i) => m.set(r.id, i));
  m.set('tien_nhan', CULTIVATION_RANKS.length);
  return m;
})();

export function meetsRankRequirement(
  userRank: CultivationRankId,
  required: CultivationRankId | null,
): boolean {
  if (required === null) return true;
  const u = RANK_ORDER.get(userRank) ?? 0;
  const r = RANK_ORDER.get(required) ?? 0;
  return u >= r;
}

export interface BuyResult {
  ok: boolean;
  reason?:
    | 'not-found'
    | 'already-owned'
    | 'rank-too-low'
    | 'not-enough-pills'
    | 'not-enough-contribution'
    | 'no-user';
  newPills?: number;
  newContribution?: number;
  ownership?: UserCongPhap;
}

/**
 * Attempt to buy a công pháp for `discordId`. Returns ok=false with a
 * reason on any failure. Atomic: deducts currency + inserts UserCongPhap
 * in a single set/append pair. Caller decides auto-equip.
 */
export async function buyCongPhap(discordId: string, slug: string): Promise<BuyResult> {
  const store = getStore();
  const user = store.users.get(discordId);
  if (!user) return { ok: false, reason: 'no-user' };

  const item = store.congPhapCatalog.get(slug);
  if (!item) return { ok: false, reason: 'not-found' };

  // Already owned?
  const owned = store.userCongPhap.query(
    (uc) => uc.discord_id === discordId && uc.cong_phap_slug === slug,
  );
  if (owned.length > 0) return { ok: false, reason: 'already-owned' };

  if (!meetsRankRequirement(user.cultivation_rank, item.min_rank_required)) {
    return { ok: false, reason: 'rank-too-low' };
  }

  const pills = user.pills ?? 0;
  const contrib = user.contribution_points ?? 0;
  if (pills < item.cost_pills) return { ok: false, reason: 'not-enough-pills' };
  if (contrib < item.cost_contribution) return { ok: false, reason: 'not-enough-contribution' };

  const newPills = pills - item.cost_pills;
  const newContribution = contrib - item.cost_contribution;
  const ownership: UserCongPhap = {
    id: ulid(),
    discord_id: discordId,
    cong_phap_slug: slug,
    acquired_at: Date.now(),
  };

  await store.users.set({
    ...user,
    pills: newPills,
    contribution_points: newContribution,
  });
  await store.userCongPhap.set(ownership);

  // Phase 14 quest — spend_contribution increments by the contrib cost of
  // this purchase. Async, best-effort: failure to record quest doesn't roll
  // back the purchase.
  if (item.cost_contribution > 0) {
    const { incrementProgress } = await import('../quests/daily-quest.js');
    void incrementProgress(discordId, 'spend_contribution', item.cost_contribution);
  }

  return { ok: true, newPills, newContribution, ownership };
}

export interface EquipResult {
  ok: boolean;
  reason?: 'not-owned' | 'no-user' | 'not-in-catalog' | 'already-equipped' | 'slot-locked';
  slotIdx?: number;
}

/**
 * Phase 14 round 3 — equip a công pháp into the next available slot, OR
 * a specific slot if `slotIdx` provided. Multi-slot semantics:
 *   - reads existing `equipped_cong_phap_slugs` array
 *   - if slug already equipped in another slot → rejects with 'already-equipped'
 *   - if slotIdx given but ≥ maxCongPhapSlots(rank) → 'slot-locked'
 *   - if no slotIdx → appends to first empty slot (up to max); replaces last if full
 *
 * Legacy `equipped_cong_phap_slug` is mirrored to the first slug for any
 * non-migrated reader.
 */
export async function equipCongPhap(
  discordId: string,
  slug: string,
  slotIdx?: number,
): Promise<EquipResult> {
  const store = getStore();
  const user = store.users.get(discordId);
  if (!user) return { ok: false, reason: 'no-user' };
  if (!store.congPhapCatalog.get(slug)) return { ok: false, reason: 'not-in-catalog' };

  const owned = store.userCongPhap.query(
    (uc) => uc.discord_id === discordId && uc.cong_phap_slug === slug,
  );
  if (owned.length === 0) return { ok: false, reason: 'not-owned' };

  // Resolve slot capacity from user's rank.
  const { maxCongPhapSlots } = await import('./equipment-resolver.js');
  const maxSlots = maxCongPhapSlots(user.cultivation_rank);

  const current = (user.equipped_cong_phap_slugs && user.equipped_cong_phap_slugs.length > 0
    ? user.equipped_cong_phap_slugs
    : user.equipped_cong_phap_slug
      ? [user.equipped_cong_phap_slug]
      : []
  ).slice(0, maxSlots);

  // Already equipped check.
  const existingIdx = current.indexOf(slug);
  if (existingIdx >= 0 && slotIdx !== existingIdx) {
    return { ok: false, reason: 'already-equipped', slotIdx: existingIdx };
  }

  let target: number;
  if (typeof slotIdx === 'number') {
    if (slotIdx < 0 || slotIdx >= maxSlots) {
      return { ok: false, reason: 'slot-locked' };
    }
    target = slotIdx;
  } else {
    // Find first empty slot; otherwise replace the last (newest preference).
    const emptyIdx = current.findIndex((_, i) => i >= current.length);
    target = emptyIdx >= 0 ? emptyIdx : Math.min(current.length, maxSlots - 1);
  }

  const next = [...current];
  while (next.length <= target) next.push('');
  next[target] = slug;
  // Drop any stale empty strings beyond maxSlots.
  const finalSlugs = next.filter((s) => s.length > 0).slice(0, maxSlots);

  await store.users.set({
    ...user,
    equipped_cong_phap_slugs: finalSlugs,
    equipped_cong_phap_slug: finalSlugs[0] ?? null,
  });

  // Phase 14 quest — equip_both check (fires only if weapon also equipped).
  {
    const { checkEquipBothQuest } = await import('../quests/daily-quest.js');
    void checkEquipBothQuest(discordId);
  }
  return { ok: true, slotIdx: target };
}

export async function unequipCongPhap(discordId: string, slotIdx?: number): Promise<{ ok: boolean }> {
  const store = getStore();
  const user = store.users.get(discordId);
  if (!user) return { ok: false };
  const current = user.equipped_cong_phap_slugs && user.equipped_cong_phap_slugs.length > 0
    ? user.equipped_cong_phap_slugs
    : user.equipped_cong_phap_slug
      ? [user.equipped_cong_phap_slug]
      : [];
  let next: string[];
  if (typeof slotIdx === 'number') {
    next = current.filter((_, i) => i !== slotIdx);
  } else {
    next = [];
  }
  await store.users.set({
    ...user,
    equipped_cong_phap_slugs: next,
    equipped_cong_phap_slug: next[0] ?? null,
  });
  return { ok: true };
}

export function listOwnedCongPhap(
  discordId: string,
): Array<{ ownership: UserCongPhap; item: CongPhap }> {
  const store = getStore();
  const owned = store.userCongPhap.query((uc) => uc.discord_id === discordId);
  const result: Array<{ ownership: UserCongPhap; item: CongPhap }> = [];
  for (const uc of owned) {
    const item = store.congPhapCatalog.get(uc.cong_phap_slug);
    if (item) result.push({ ownership: uc, item });
  }
  return result;
}

export function listShopAvailable(userRank: CultivationRankId): CongPhap[] {
  const store = getStore();
  return store.congPhapCatalog
    .query((c) => meetsRankRequirement(userRank, c.min_rank_required))
    .sort((a, b) => a.cost_contribution - b.cost_contribution);
}

export const RARITY_EMOJI: Record<string, string> = {
  common: '⚪',
  rare: '🔵',
  epic: '🟣',
  legendary: '🟡',
};

export const __for_testing = { RANK_ORDER };
