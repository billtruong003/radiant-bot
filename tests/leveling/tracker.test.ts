import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setStoreForTesting } from '../../src/db/index.js';
import { Store } from '../../src/db/store.js';
import { cumulativeXpForLevel } from '../../src/modules/leveling/engine.js';
import { awardXp, randomXpAmount } from '../../src/modules/leveling/tracker.js';
import { mkTmpDir } from '../helpers/tmp-dir.js';

const NEVER = 99_999_999;

describe('awardXp', () => {
  let store: Store;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await mkTmpDir('tracker');
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

  it('first XP earn creates a User with default rank + adds XP', async () => {
    expect(store.users.get('u1')).toBeUndefined();
    const r = await awardXp({
      discordId: 'u1',
      username: 'alice',
      displayName: 'Alice',
      amount: 20,
      source: 'message',
    });
    expect(r.newXp).toBe(20);
    expect(r.oldLevel).toBe(0);
    expect(r.newLevel).toBe(0); // need 100 xp for level 1
    expect(r.leveledUp).toBe(false);
    const u = store.users.get('u1');
    expect(u?.xp).toBe(20);
    expect(u?.username).toBe('alice');
    expect(u?.cultivation_rank).toBe('pham_nhan');
  });

  it('appends an XpLog entry per award', async () => {
    await awardXp({
      discordId: 'u1',
      username: 'alice',
      displayName: null,
      amount: 15,
      source: 'message',
    });
    await awardXp({
      discordId: 'u1',
      username: 'alice',
      displayName: null,
      amount: 25,
      source: 'voice',
    });
    expect(store.xpLogs.count()).toBe(2);
    const logs = store.xpLogs.recent(2);
    expect(logs.map((l) => l.amount)).toEqual([15, 25]);
    expect(logs.map((l) => l.source)).toEqual(['message', 'voice']);
  });

  it('crosses level threshold → leveledUp=true + user.level updated', async () => {
    // Level 1 needs cumulativeXpForLevel(1) = xpToNext(0) = 100 XP.
    await awardXp({
      discordId: 'u1',
      username: 'a',
      displayName: null,
      amount: 99,
      source: 'admin_grant',
    });
    const before = store.users.get('u1');
    expect(before?.level).toBe(0);

    const r = await awardXp({
      discordId: 'u1',
      username: 'a',
      displayName: null,
      amount: 1,
      source: 'admin_grant',
    });
    expect(r.leveledUp).toBe(true);
    expect(r.oldLevel).toBe(0);
    expect(r.newLevel).toBe(1);
    expect(store.users.get('u1')?.level).toBe(1);
  });

  it('big jump → newLevel reflects formula, not +1', async () => {
    // 1800 xp → level 10 per formula (cumulativeXpForLevel(10) ≈ 4,675);
    // SPEC commented "level 10 ≈ 1.8k" — formula says level 10 = 4,675.
    // Verify the formula is the source of truth.
    const target = cumulativeXpForLevel(10); // exact xp for level 10
    const r = await awardXp({
      discordId: 'u1',
      username: 'a',
      displayName: null,
      amount: target,
      source: 'admin_grant',
    });
    expect(r.newLevel).toBe(10);
    expect(r.leveledUp).toBe(true);
  });

  it('touchLastMessage=true → last_message_at updated', async () => {
    const before = Date.now();
    await awardXp({
      discordId: 'u1',
      username: 'a',
      displayName: null,
      amount: 20,
      source: 'message',
      touchLastMessage: true,
    });
    const u = store.users.get('u1');
    expect(u?.last_message_at).toBeGreaterThanOrEqual(before);
  });

  it('touchLastMessage omitted → last_message_at stays null', async () => {
    await awardXp({
      discordId: 'u1',
      username: 'a',
      displayName: null,
      amount: 10,
      source: 'reaction',
    });
    expect(store.users.get('u1')?.last_message_at).toBeNull();
  });

  it('non-positive amount → ignored, no log appended', async () => {
    const r = await awardXp({
      discordId: 'u1',
      username: 'a',
      displayName: null,
      amount: 0,
      source: 'message',
    });
    expect(r.leveledUp).toBe(false);
    expect(store.xpLogs.count()).toBe(0);
    expect(store.users.get('u1')).toBeUndefined();
  });

  it('100 parallel awards land exactly +100×amount (atomic incr)', async () => {
    // Seed the user so all 100 calls hit the existing-user path uniformly.
    await awardXp({
      discordId: 'u1',
      username: 'a',
      displayName: null,
      amount: 1,
      source: 'admin_grant',
    });
    const promises = Array.from({ length: 100 }, () =>
      awardXp({
        discordId: 'u1',
        username: 'a',
        displayName: null,
        amount: 2,
        source: 'message',
      }),
    );
    await Promise.all(promises);
    expect(store.users.get('u1')?.xp).toBe(1 + 100 * 2);
  });

  it('state persists across simulated restart', async () => {
    await awardXp({
      discordId: 'u1',
      username: 'a',
      displayName: 'Alpha',
      amount: 50,
      source: 'message',
      touchLastMessage: true,
    });
    await store.snapshot();
    const dir = store.getSnapshotPath().replace(/[/\\]snapshot\.json$/, '');
    await store.shutdown();
    __setStoreForTesting(null);

    const reloaded = new Store({ dataDir: dir, snapshotIntervalMs: NEVER, fsync: false });
    await reloaded.init();
    __setStoreForTesting(reloaded);

    const u = reloaded.users.get('u1');
    expect(u?.xp).toBe(50);
    expect(u?.display_name).toBe('Alpha');
    expect(u?.last_message_at).not.toBeNull();
    expect(reloaded.xpLogs.count()).toBe(1);

    store = reloaded;
  });
});

describe('randomXpAmount', () => {
  it('returns value within [min, max] inclusive', () => {
    for (let i = 0; i < 100; i++) {
      const v = randomXpAmount(15, 25);
      expect(v).toBeGreaterThanOrEqual(15);
      expect(v).toBeLessThanOrEqual(25);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('min === max → constant', () => {
    expect(randomXpAmount(42, 42)).toBe(42);
  });
});
