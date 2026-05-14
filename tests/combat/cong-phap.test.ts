import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setStoreForTesting } from '../../src/db/index.js';
import { Store } from '../../src/db/store.js';
import {
  buyCongPhap,
  equipCongPhap,
  listOwnedCongPhap,
  meetsRankRequirement,
  unequipCongPhap,
} from '../../src/modules/combat/cong-phap.js';
import { mkTmpDir } from '../helpers/tmp-dir.js';

const NEVER = 99_999_999;

async function seed(store: Store): Promise<void> {
  await store.users.set({
    discord_id: 'u1',
    username: 'TestUser',
    display_name: null,
    xp: 100,
    level: 5,
    cultivation_rank: 'luyen_khi',
    sub_title: null,
    joined_at: 0,
    verified_at: 0,
    last_message_at: null,
    last_daily_at: null,
    daily_streak: 0,
    is_suspect: false,
    notes: null,
    pills: 5,
    contribution_points: 500,
    equipped_cong_phap_slug: null,
    combat_power_cache: null,
    last_quest_assigned_at: null,
  });
  await store.congPhapCatalog.set({
    id: 'cp-1',
    slug: 'ngu-hanh-quyen',
    name: 'Ngũ Hành Quyền',
    description: 'common test',
    rarity: 'common',
    cost_pills: 0,
    cost_contribution: 50,
    stat_bonuses: { combat_power: 50 },
    min_rank_required: null,
    created_at: 0,
  });
  await store.congPhapCatalog.set({
    id: 'cp-2',
    slug: 'kim-cang-quyen',
    name: 'Kim Cang Quyền',
    description: 'rare test',
    rarity: 'rare',
    cost_pills: 1,
    cost_contribution: 200,
    stat_bonuses: { combat_power: 120 },
    min_rank_required: 'luyen_khi',
    created_at: 0,
  });
  await store.congPhapCatalog.set({
    id: 'cp-3',
    slug: 'nguyen-anh-tam-phap',
    name: 'Nguyên Anh Tâm Pháp',
    description: 'epic test',
    rarity: 'epic',
    cost_pills: 8,
    cost_contribution: 1200,
    stat_bonuses: { combat_power: 500 },
    min_rank_required: 'nguyen_anh',
    created_at: 0,
  });
}

describe('meetsRankRequirement', () => {
  it('null requirement → always passes', () => {
    expect(meetsRankRequirement('pham_nhan', null)).toBe(true);
  });
  it('exact rank passes', () => {
    expect(meetsRankRequirement('luyen_khi', 'luyen_khi')).toBe(true);
  });
  it('higher rank passes', () => {
    expect(meetsRankRequirement('kim_dan', 'luyen_khi')).toBe(true);
  });
  it('lower rank fails', () => {
    expect(meetsRankRequirement('pham_nhan', 'luyen_khi')).toBe(false);
  });
});

describe('cong-phap buy/equip flow', () => {
  let store: Store;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await mkTmpDir('cp');
    cleanup = tmp.cleanup;
    store = new Store({ dataDir: tmp.dir, snapshotIntervalMs: NEVER, fsync: false });
    await store.init();
    __setStoreForTesting(store);
    await seed(store);
  });

  afterEach(async () => {
    __setStoreForTesting(null);
    await store.shutdown();
    await cleanup();
  });

  it('buy: success path deducts currency + creates inventory', async () => {
    const r = await buyCongPhap('u1', 'ngu-hanh-quyen');
    expect(r.ok).toBe(true);
    expect(r.newContribution).toBe(450);
    expect(r.newPills).toBe(5);
    const owned = listOwnedCongPhap('u1');
    expect(owned).toHaveLength(1);
    expect(owned[0]?.item.slug).toBe('ngu-hanh-quyen');
  });

  it('buy: rank-too-low blocks', async () => {
    const r = await buyCongPhap('u1', 'nguyen-anh-tam-phap');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('rank-too-low');
  });

  it('buy: not-enough-pills blocks', async () => {
    // Lower pills first
    const user = store.users.get('u1');
    if (user) await store.users.set({ ...user, pills: 0 });
    const r = await buyCongPhap('u1', 'kim-cang-quyen');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not-enough-pills');
  });

  it('buy: already-owned blocks', async () => {
    await buyCongPhap('u1', 'ngu-hanh-quyen');
    const r2 = await buyCongPhap('u1', 'ngu-hanh-quyen');
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe('already-owned');
  });

  it('equip + unequip flow', async () => {
    await buyCongPhap('u1', 'ngu-hanh-quyen');
    const eq = await equipCongPhap('u1', 'ngu-hanh-quyen');
    expect(eq.ok).toBe(true);
    expect(store.users.get('u1')?.equipped_cong_phap_slug).toBe('ngu-hanh-quyen');
    await unequipCongPhap('u1');
    expect(store.users.get('u1')?.equipped_cong_phap_slug).toBeNull();
  });

  it('equip: not-owned blocks', async () => {
    const r = await equipCongPhap('u1', 'ngu-hanh-quyen');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not-owned');
  });
});
