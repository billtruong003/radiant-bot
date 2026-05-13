import type { Store } from '../store.js';
import type { CultivationRankId, User } from '../types.js';

export function getUser(store: Store, discordId: string): User | undefined {
  return store.users.get(discordId);
}

export function getOrCreateUser(
  store: Store,
  discordId: string,
  username: string,
  displayName: string | null,
): { user: User; created: boolean } {
  const existing = store.users.get(discordId);
  if (existing) return { user: existing, created: false };
  const now = Date.now();
  const fresh: User = {
    discord_id: discordId,
    username,
    display_name: displayName,
    xp: 0,
    level: 0,
    cultivation_rank: 'pham_nhan',
    sub_title: null,
    joined_at: now,
    verified_at: null,
    last_message_at: null,
    last_daily_at: null,
    daily_streak: 0,
    is_suspect: false,
    notes: null,
  };
  return { user: fresh, created: true };
}

export function getVerifiedUsers(store: Store): User[] {
  return store.users.query((u) => u.verified_at !== null);
}

export function getSuspectUsers(store: Store): User[] {
  return store.users.query((u) => u.is_suspect);
}

export function getUsersByRank(store: Store, rank: CultivationRankId): User[] {
  return store.users.query((u) => u.cultivation_rank === rank);
}

export function countByRank(store: Store): Record<CultivationRankId, number> {
  const out = {
    pham_nhan: 0,
    luyen_khi: 0,
    truc_co: 0,
    kim_dan: 0,
    nguyen_anh: 0,
    hoa_than: 0,
    luyen_hu: 0,
    hop_the: 0,
    dai_thua: 0,
    do_kiep: 0,
    tien_nhan: 0,
  } satisfies Record<CultivationRankId, number>;
  for (const u of store.users.all()) {
    out[u.cultivation_rank]++;
  }
  return out;
}
