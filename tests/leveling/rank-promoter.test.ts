import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CULTIVATION_RANKS } from '../../src/config/cultivation.js';
import { __setStoreForTesting } from '../../src/db/index.js';
import { Store } from '../../src/db/store.js';
import type { User } from '../../src/db/types.js';
import { maybePromoteRank, postLevelUpEmbed } from '../../src/modules/leveling/rank-promoter.js';
import { mkTmpDir } from '../helpers/tmp-dir.js';
import { makeMockMember } from '../verification/__mocks__/member.js';

const NEVER = 99_999_999;

/** Build the full cultivation role map (name → role id) for the mock. */
function fullRoleMap(): Record<string, string> {
  return Object.fromEntries(CULTIVATION_RANKS.map((r) => [r.name, `role-${r.id}`]));
}

function seedUser(store: Store, overrides: Partial<User> = {}): User {
  const u: User = {
    discord_id: overrides.discord_id ?? 'u1',
    username: 'alice',
    display_name: null,
    xp: 0,
    level: 0,
    cultivation_rank: 'pham_nhan',
    sub_title: null,
    joined_at: Date.now(),
    verified_at: Date.now(),
    last_message_at: null,
    last_daily_at: null,
    daily_streak: 0,
    is_suspect: false,
    notes: null,
    ...overrides,
  };
  store.users.set(u);
  return u;
}

describe('maybePromoteRank', () => {
  let store: Store;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await mkTmpDir('promoter');
    cleanup = tmp.cleanup;
    store = new Store({ dataDir: tmp.dir, snapshotIntervalMs: NEVER, fsync: false });
    await store.init();
    __setStoreForTesting(store);
  });

  afterEach(async () => {
    __setStoreForTesting(null);
    await store.shutdown();
    await cleanup();
  });

  it('same-rank level up → no promotion', async () => {
    await seedUser(store, { discord_id: 'u1', cultivation_rank: 'luyen_khi' });
    const { member } = makeMockMember({
      id: 'u1',
      roleIds: ['role-luyen_khi'],
      roleMap: fullRoleMap(),
    });
    // Luyện Khí range is 1-9. Going from level 3 to 5 stays in same rank.
    const r = await maybePromoteRank(member, 5);
    expect(r.promoted).toBe(false);
    expect(r.oldRank).toBe('luyen_khi');
    expect(r.newRank).toBe('luyen_khi');
  });

  it('cross threshold → promoted + role swapped + user.cultivation_rank updated', async () => {
    await seedUser(store, { discord_id: 'u1', cultivation_rank: 'pham_nhan' });
    const { member, spies } = makeMockMember({
      id: 'u1',
      roleIds: ['role-pham_nhan', 'other-role-id'],
      roleMap: fullRoleMap(),
    });
    // Pass roles.set spy through manually since mock factory uses add/remove.
    const setSpy = vi.fn().mockResolvedValue(undefined);
    // biome-ignore lint/suspicious/noExplicitAny: test patches the member fake
    (member.roles as any).set = setSpy;

    const r = await maybePromoteRank(member, 1); // crosses into luyen_khi
    expect(r.promoted).toBe(true);
    expect(r.oldRank).toBe('pham_nhan');
    expect(r.newRank).toBe('luyen_khi');
    expect(store.users.get('u1')?.cultivation_rank).toBe('luyen_khi');
    expect(setSpy).toHaveBeenCalledTimes(1);
    // First arg is the role-id list; the old cultivation role should be dropped,
    // the new one added, and non-cultivation roles preserved.
    const newRoleIds = setSpy.mock.calls[0]?.[0] as string[];
    expect(newRoleIds).toContain('other-role-id'); // preserved
    expect(newRoleIds).toContain('role-luyen_khi'); // added
    expect(newRoleIds).not.toContain('role-pham_nhan'); // removed
    // unused but documents intent
    expect(spies).toBeDefined();
  });

  it('big jump → promoted to the highest matching rank, not just +1', async () => {
    await seedUser(store, { discord_id: 'u1', cultivation_rank: 'pham_nhan' });
    const { member } = makeMockMember({
      id: 'u1',
      roleIds: ['role-pham_nhan'],
      roleMap: fullRoleMap(),
    });
    // biome-ignore lint/suspicious/noExplicitAny: test patches member fake
    (member.roles as any).set = vi.fn().mockResolvedValue(undefined);
    const r = await maybePromoteRank(member, 50); // hoa_than (50-69)
    expect(r.newRank).toBe('hoa_than');
    expect(store.users.get('u1')?.cultivation_rank).toBe('hoa_than');
  });

  it('Tiên Nhân (admin grant) → never auto-touched, even on level up', async () => {
    await seedUser(store, { discord_id: 'u1', cultivation_rank: 'tien_nhan' });
    const { member } = makeMockMember({ id: 'u1', roleMap: fullRoleMap() });
    // biome-ignore lint/suspicious/noExplicitAny: test patches member fake
    (member.roles as any).set = vi.fn().mockResolvedValue(undefined);
    const r = await maybePromoteRank(member, 200);
    expect(r.promoted).toBe(false);
    expect(r.oldRank).toBe('tien_nhan');
    expect(r.newRank).toBe('tien_nhan');
    expect(store.users.get('u1')?.cultivation_rank).toBe('tien_nhan');
  });

  it('user not in store → no-op', async () => {
    const { member } = makeMockMember({ id: 'ghost', roleMap: fullRoleMap() });
    const r = await maybePromoteRank(member, 50);
    expect(r.promoted).toBe(false);
  });

  it('target role missing in guild → promotion recorded in store, role swap skipped', async () => {
    await seedUser(store, { discord_id: 'u1', cultivation_rank: 'pham_nhan' });
    // Only seed pham_nhan role; level 1 wants luyen_khi which is absent.
    const { member } = makeMockMember({
      id: 'u1',
      roleIds: ['role-pham_nhan'],
      roleMap: { 'Phàm Nhân': 'role-pham_nhan' },
    });
    const setSpy = vi.fn().mockResolvedValue(undefined);
    // biome-ignore lint/suspicious/noExplicitAny: test patches member fake
    (member.roles as any).set = setSpy;
    const r = await maybePromoteRank(member, 1);
    expect(r.promoted).toBe(true);
    expect(store.users.get('u1')?.cultivation_rank).toBe('luyen_khi');
    expect(setSpy).not.toHaveBeenCalled(); // role missing → skipped
  });
});

describe('postLevelUpEmbed', () => {
  let store: Store;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await mkTmpDir('embed');
    cleanup = tmp.cleanup;
    store = new Store({ dataDir: tmp.dir, snapshotIntervalMs: NEVER, fsync: false });
    await store.init();
    __setStoreForTesting(store);
  });

  afterEach(async () => {
    __setStoreForTesting(null);
    await store.shutdown();
    await cleanup();
  });

  function mockMemberWithLevelUpChannel() {
    const channelSend = vi.fn().mockResolvedValue(undefined);
    const { member } = makeMockMember({ id: 'u1', roleMap: fullRoleMap() });
    // Inject #level-up channel into the guild fake.
    // biome-ignore lint/suspicious/noExplicitAny: test extends mock guild
    (member.guild.channels.cache as any).find = (
      pred: (c: { name: string; isTextBased(): boolean }) => boolean,
    ) => {
      const fake = { name: 'level-up', isTextBased: () => true, send: channelSend };
      return pred(fake) ? fake : undefined;
    };
    return { member, channelSend };
  }

  it('plain level-up → embed posted with new level', async () => {
    const { member, channelSend } = mockMemberWithLevelUpChannel();
    await postLevelUpEmbed(member, 5, {
      promoted: false,
      oldRank: 'luyen_khi',
      newRank: 'luyen_khi',
    });
    expect(channelSend).toHaveBeenCalledTimes(1);
    const payload = channelSend.mock.calls[0]?.[0];
    expect(payload.embeds).toHaveLength(1);
    expect(payload.embeds[0].data.title).toBe('🎯 Lên cấp');
    expect(payload.embeds[0].data.description).toContain('Level 5');
  });

  it('promotion → đột phá cảnh giới embed with rank color + mention', async () => {
    const { member, channelSend } = mockMemberWithLevelUpChannel();
    await postLevelUpEmbed(member, 10, {
      promoted: true,
      oldRank: 'luyen_khi',
      newRank: 'truc_co',
    });
    const payload = channelSend.mock.calls[0]?.[0];
    expect(payload.content).toContain(member.id);
    expect(payload.embeds[0].data.title).toBe('⚡ Đột phá cảnh giới');
    expect(payload.embeds[0].data.description).toContain('Trúc Cơ');
  });

  it('#level-up missing → silently skips, no throw', async () => {
    const { member } = makeMockMember({ id: 'u1' });
    await expect(
      postLevelUpEmbed(member, 5, {
        promoted: false,
        oldRank: 'luyen_khi',
        newRank: 'luyen_khi',
      }),
    ).resolves.toBeUndefined();
  });
});
