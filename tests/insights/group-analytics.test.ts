import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../../src/db/store.js';
import { __setStoreForTesting } from '../../src/db/index.js';
import type { User, XpLog } from '../../src/db/types.js';
import { computeWeeklyStats } from '../../src/modules/insights/group-analytics.js';
import { mkTmpDir } from '../helpers/tmp-dir.js';

/** Fresh isolated Store, registered as the global one. */
async function freshStore(label: string): Promise<Store> {
  const { dir } = await mkTmpDir(label);
  const store = new Store({ dataDir: dir, snapshotIntervalMs: 99_999_999, fsync: false });
  await store.init();
  __setStoreForTesting(store);
  return store;
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function user(id: string, over: Partial<User> = {}): User {
  return {
    discord_id: id,
    username: `u${id}`,
    display_name: `User ${id}`,
    xp: 0,
    level: 1,
    cultivation_rank: 'luyen_khi',
    sub_title: null,
    joined_at: NOW - 100 * DAY,
    verified_at: NOW - 100 * DAY,
    last_message_at: null,
    last_daily_at: null,
    daily_streak: 0,
    is_suspect: false,
    notes: null,
    ...over,
  };
}

function log(id: string, source: XpLog['source'], daysAgo: number, amount = 10): XpLog {
  return {
    id: `${id}-${source}-${daysAgo}-${Math.random()}`,
    discord_id: id,
    amount,
    source,
    metadata: null,
    created_at: NOW - daysAgo * DAY,
  };
}

describe('computeWeeklyStats', () => {
  beforeEach(async () => {
    const store = await freshStore('ga');
    __setStoreForTesting(store);
    vi.setSystemTime(NOW);
  });

  it('counts only the last 7 days as active', async () => {
    const store = await freshStore('ga2');
    store.users._bulkLoad([user('a'), user('b')]);
    store.xpLogs._bulkLoad([log('a', 'message', 2), log('b', 'message', 20)]);

    const s = computeWeeklyStats(NOW);
    expect(s.activeNow).toBe(1);
    expect(s.top[0]?.discordId).toBe('a');
  });

  // The signal leaders actually act on: someone who was here and stopped.
  it('flags members active last week but silent this week', async () => {
    const store = await freshStore('ga3');
    store.users._bulkLoad([user('gone'), user('here')]);
    store.xpLogs._bulkLoad([log('gone', 'message', 10), log('here', 'message', 1)]);

    const s = computeWeeklyStats(NOW);
    expect(s.wentQuiet.map((q) => q.name)).toEqual(['User gone']);
    expect(s.activeNow).toBe(1);
  });

  it('does not flag someone who was silent both weeks', async () => {
    const store = await freshStore('ga4');
    store.users._bulkLoad([user('ghost')]);
    store.xpLogs._bulkLoad([log('ghost', 'message', 60)]);

    expect(computeWeeklyStats(NOW).wentQuiet).toEqual([]);
  });

  it('separates message counts from voice ticks and converts voice to hours', async () => {
    const store = await freshStore('ga5');
    store.users._bulkLoad([user('a')]);
    store.xpLogs._bulkLoad([
      log('a', 'message', 1),
      log('a', 'message', 1),
      ...Array.from({ length: 120 }, () => log('a', 'voice', 1)),
    ]);

    const s = computeWeeklyStats(NOW);
    expect(s.totalMessages).toBe(2);
    expect(s.totalVoiceHours).toBe(2); // 120 ticks = 120 min = 2h
  });

  it('counts newcomers by join date inside the window', async () => {
    const store = await freshStore('ga6');
    store.users._bulkLoad([user('new', { joined_at: NOW - 2 * DAY }), user('old')]);

    expect(computeWeeklyStats(NOW).newcomers).toBe(1);
  });

  it('returns empty-but-valid stats on an empty server', async () => {
    const s = computeWeeklyStats(NOW);
    expect(s.activeNow).toBe(0);
    expect(s.top).toEqual([]);
    expect(s.wentQuiet).toEqual([]);
    expect(s.totalVoiceHours).toBe(0);
  });
});
