import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../../src/db/store.js';
import type { User, XpLog } from '../../src/db/types.js';
import { mkTmpDir } from '../helpers/tmp-dir.js';

// Effectively never — timer never fires during any test.
const NEVER = 99_999_999;

function makeUser(overrides: Partial<User> = {}): User {
  return {
    discord_id: 'u1',
    username: 'alice',
    display_name: 'Alice',
    xp: 0,
    level: 0,
    cultivation_rank: 'pham_nhan',
    sub_title: null,
    joined_at: 1_700_000_000_000,
    verified_at: null,
    last_message_at: null,
    last_daily_at: null,
    daily_streak: 0,
    is_suspect: false,
    notes: null,
    ...overrides,
  };
}

function makeXpLog(overrides: Partial<XpLog> = {}): XpLog {
  return {
    id: 'log-1',
    discord_id: 'u1',
    amount: 20,
    source: 'message',
    metadata: null,
    created_at: 1_700_000_000_000,
    ...overrides,
  };
}

describe('Store', () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await mkTmpDir('store'));
  });

  afterEach(async () => {
    await cleanup();
  });

  function makeStore(): Store {
    return new Store({ dataDir: dir, snapshotIntervalMs: NEVER, fsync: false });
  }

  it('init on fresh dir leaves all collections empty', async () => {
    const store = makeStore();
    await store.init();
    expect(store.users.count()).toBe(0);
    expect(store.xpLogs.count()).toBe(0);
    expect(store.raidState.get().is_active).toBe(false);
  });

  it('repeated init throws', async () => {
    const store = makeStore();
    await store.init();
    await expect(store.init()).rejects.toThrow(/already initialized/);
  });

  it('graceful shutdown: snapshot persists, new store reads it', async () => {
    const s1 = makeStore();
    await s1.init();
    await s1.users.set(makeUser({ discord_id: 'u1', xp: 100 }));
    await s1.shutdown();

    const s2 = makeStore();
    await s2.init();
    expect(s2.users.get('u1')?.xp).toBe(100);
  });

  it('after shutdown, WAL is empty and snapshot has the data', async () => {
    const s1 = makeStore();
    await s1.init();
    await s1.users.set(makeUser({ discord_id: 'u1', xp: 50 }));
    await s1.shutdown();

    const walSize = (await fs.stat(s1.getWalPath())).size;
    expect(walSize).toBe(0);
    const snap = JSON.parse(await fs.readFile(s1.getSnapshotPath(), 'utf-8'));
    expect(snap.users).toHaveLength(1);
    expect(snap.users[0].xp).toBe(50);
  });

  it('CRASH RECOVERY: writes since last snapshot are restored via WAL replay', async () => {
    // Phase A: write, snapshot.
    const s1 = makeStore();
    await s1.init();
    await s1.users.set(makeUser({ discord_id: 'u1', xp: 100 }));
    await s1.snapshot();
    // Phase B: more writes that ONLY hit the WAL (no snapshot, no shutdown).
    await s1.users.incr('u1', 'xp', 50);
    await s1.users.set(makeUser({ discord_id: 'u2', xp: 25 }));
    // Simulate crash: drop s1, do not shutdown. WAL is on disk.

    const s2 = makeStore();
    await s2.init();
    expect(s2.users.get('u1')?.xp).toBe(150);
    expect(s2.users.get('u2')?.xp).toBe(25);
  });

  it('CRASH RECOVERY: writes with NO prior snapshot replay from WAL alone', async () => {
    const s1 = makeStore();
    await s1.init();
    await s1.users.set(makeUser({ discord_id: 'u1', xp: 10 }));
    await s1.users.set(makeUser({ discord_id: 'u2', xp: 20 }));
    await s1.users.incr('u1', 'xp', 5);
    // No snapshot, no shutdown — pure WAL recovery.

    const s2 = makeStore();
    await s2.init();
    expect(s2.users.count()).toBe(2);
    expect(s2.users.get('u1')?.xp).toBe(15);
    expect(s2.users.get('u2')?.xp).toBe(20);
  });

  it('CRASH RECOVERY: append-only collection (xp_logs) restored', async () => {
    const s1 = makeStore();
    await s1.init();
    await s1.xpLogs.append(makeXpLog({ id: 'log-1', amount: 20 }));
    await s1.xpLogs.append(makeXpLog({ id: 'log-2', amount: 30 }));
    // simulate crash

    const s2 = makeStore();
    await s2.init();
    expect(s2.xpLogs.count()).toBe(2);
    const logs = s2.xpLogs.query(() => true);
    expect(logs.map((l) => l.id).sort()).toEqual(['log-1', 'log-2']);
    expect(logs.reduce((sum, l) => sum + l.amount, 0)).toBe(50);
  });

  it('CRASH RECOVERY: singleton (raid_state) restored', async () => {
    const s1 = makeStore();
    await s1.init();
    await s1.raidState.update({ is_active: true, activated_at: 12345 });
    // simulate crash

    const s2 = makeStore();
    await s2.init();
    expect(s2.raidState.get().is_active).toBe(true);
    expect(s2.raidState.get().activated_at).toBe(12345);
  });

  it('CRASH RECOVERY: multiple collections all restored', async () => {
    const s1 = makeStore();
    await s1.init();
    await s1.users.set(makeUser({ discord_id: 'u1', xp: 100 }));
    await s1.xpLogs.append(makeXpLog({ id: 'log-1' }));
    await s1.events.set({
      id: 'evt-1',
      name: 'Đột phá tuần',
      type: 'tribulation',
      started_at: 1_700_000_000_000,
      ended_at: null,
      metadata: null,
    });
    await s1.raidState.update({ is_active: true, activated_at: 9999 });

    const s2 = makeStore();
    await s2.init();
    expect(s2.users.get('u1')?.xp).toBe(100);
    expect(s2.xpLogs.count()).toBe(1);
    expect(s2.events.get('evt-1')?.name).toBe('Đột phá tuần');
    expect(s2.raidState.get().is_active).toBe(true);
  });

  it('snapshot is atomic: existing snapshot stays valid if write would fail mid-way', async () => {
    // We can't easily fault-inject the write, but we can verify the tmp+rename
    // contract by inspecting that after a successful snapshot there is NO
    // .tmp file left over.
    const s1 = makeStore();
    await s1.init();
    await s1.users.set(makeUser({ discord_id: 'u1', xp: 100 }));
    await s1.snapshot();
    const tmpPath = `${s1.getSnapshotPath()}.tmp`;
    await expect(fs.access(tmpPath)).rejects.toThrow();
  });

  it('snapshot truncates WAL', async () => {
    const s = makeStore();
    await s.init();
    await s.users.set(makeUser({ discord_id: 'u1', xp: 100 }));
    expect((await fs.stat(s.getWalPath())).size).toBeGreaterThan(0);
    await s.snapshot();
    expect((await fs.stat(s.getWalPath())).size).toBe(0);
    // State preserved in memory.
    expect(s.users.get('u1')?.xp).toBe(100);
  });

  it('snapshot + post-snapshot writes both preserved after crash', async () => {
    const s1 = makeStore();
    await s1.init();
    // Pre-snapshot state.
    await s1.users.set(makeUser({ discord_id: 'u1', xp: 100 }));
    await s1.snapshot();
    // Post-snapshot writes (WAL-only).
    await s1.users.set(makeUser({ discord_id: 'u2', xp: 200 }));
    await s1.xpLogs.append(makeXpLog({ id: 'log-after' }));
    // Crash.

    const s2 = makeStore();
    await s2.init();
    expect(s2.users.count()).toBe(2);
    expect(s2.users.get('u1')?.xp).toBe(100);
    expect(s2.users.get('u2')?.xp).toBe(200);
    expect(s2.xpLogs.count()).toBe(1);
  });

  it('corrupt WAL line skipped during replay, surrounding ops still applied', async () => {
    const s1 = makeStore();
    await s1.init();
    await s1.users.set(makeUser({ discord_id: 'u1', xp: 10 }));
    // simulate crash, then corrupt the WAL file by appending a garbage line
    // and a valid op manually.
    await fs.appendFile(s1.getWalPath(), 'this is not json at all\n');
    await fs.appendFile(
      s1.getWalPath(),
      `${JSON.stringify({
        op: 'SET',
        coll: 'users',
        key: 'u2',
        value: makeUser({ discord_id: 'u2', xp: 20 }),
        ts: Date.now(),
      })}\n`,
    );

    const s2 = makeStore();
    await s2.init();
    expect(s2.users.count()).toBe(2);
    expect(s2.users.get('u1')?.xp).toBe(10);
    expect(s2.users.get('u2')?.xp).toBe(20);
  });

  it('corrupt snapshot.json falls back to WAL', async () => {
    const s1 = makeStore();
    await s1.init();
    await s1.users.set(makeUser({ discord_id: 'u1', xp: 50 }));
    await s1.shutdown();
    // Corrupt the snapshot.
    await fs.writeFile(s1.getSnapshotPath(), '{ this is not json');
    // Manually inject a valid WAL op.
    await fs.appendFile(
      s1.getWalPath(),
      `${JSON.stringify({
        op: 'SET',
        coll: 'users',
        key: 'u1',
        value: makeUser({ discord_id: 'u1', xp: 99 }),
        ts: Date.now(),
      })}\n`,
    );

    const s2 = makeStore();
    await s2.init();
    // Snapshot was corrupt → empty; WAL replays the one SET we appended.
    expect(s2.users.get('u1')?.xp).toBe(99);
  });

  it('snapshot performance: 10k users + 50k xp_logs under 2s', async () => {
    const s1 = makeStore();
    await s1.init();
    // Bulk seed via internal API to skip per-op WAL writes (fast setup).
    const users: User[] = [];
    for (let i = 0; i < 10_000; i++) {
      users.push(makeUser({ discord_id: `u${i}`, xp: i }));
    }
    s1.users._bulkLoad(users);
    const logs: XpLog[] = [];
    for (let i = 0; i < 50_000; i++) {
      logs.push(makeXpLog({ id: `log-${i}`, discord_id: `u${i % 10_000}`, amount: 20 }));
    }
    s1.xpLogs._bulkLoad(logs);

    const t0 = Date.now();
    await s1.snapshot();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(2_000);

    // Reload and verify count.
    const s2 = makeStore();
    await s2.init();
    expect(s2.users.count()).toBe(10_000);
    expect(s2.xpLogs.count()).toBe(50_000);
  });

  it('shutdown is idempotent (second call is a no-op)', async () => {
    const s = makeStore();
    await s.init();
    await s.users.set(makeUser({ discord_id: 'u1', xp: 5 }));
    await s.shutdown();
    await expect(s.shutdown()).resolves.toBeUndefined();
  });
});
