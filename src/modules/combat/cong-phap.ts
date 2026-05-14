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

  return { ok: true, newPills, newContribution, ownership };
}

export interface EquipResult {
  ok: boolean;
  reason?: 'not-owned' | 'no-user' | 'not-in-catalog';
}

export async function equipCongPhap(discordId: string, slug: string): Promise<EquipResult> {
  const store = getStore();
  const user = store.users.get(discordId);
  if (!user) return { ok: false, reason: 'no-user' };
  if (!store.congPhapCatalog.get(slug)) return { ok: false, reason: 'not-in-catalog' };

  const owned = store.userCongPhap.query(
    (uc) => uc.discord_id === discordId && uc.cong_phap_slug === slug,
  );
  if (owned.length === 0) return { ok: false, reason: 'not-owned' };

  await store.users.set({ ...user, equipped_cong_phap_slug: slug });
  return { ok: true };
}

export async function unequipCongPhap(discordId: string): Promise<{ ok: boolean }> {
  const store = getStore();
  const user = store.users.get(discordId);
  if (!user) return { ok: false };
  await store.users.set({ ...user, equipped_cong_phap_slug: null });
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
