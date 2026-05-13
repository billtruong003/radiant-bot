import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setStoreForTesting } from '../../src/db/index.js';
import { Store } from '../../src/db/store.js';
import type { SectEvent, User } from '../../src/db/types.js';
import {
  TRIBULATION_CONSTANTS,
  isTribulationOnCooldown,
  pickEligibleUserId,
} from '../../src/modules/events/tribulation.js';
import { cumulativeXpForLevel } from '../../src/modules/leveling/engine.js';
import { applyXpPenalty } from '../../src/modules/leveling/tracker.js';
import { mkTmpDir } from '../helpers/tmp-dir.js';

const NEVER = 99_999_999;

function makeUser(over: Partial<User>): User {
  return {
    discord_id: 'u',
    username: 'u',
    display_name: null,
    xp: 0,
    level: 0,
    cultivation_rank: 'pham_nhan',
    sub_title: null,
    joined_at: 0,
    verified_at: 0,
    last_message_at: null,
    last_daily_at: null,
    daily_streak: 0,
    is_suspect: false,
    notes: null,
    ...over,
  };
}

function makeEvent(over: Partial<SectEvent>): SectEvent {
  return {
    id: 'e1',
    name: 'Thiên Kiếp',
    type: 'tribulation',
    started_at: 0,
    ended_at: null,
    metadata: null,
    ...over,
  };
}

describe('applyXpPenalty', () => {
  let store: Store;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await mkTmpDir('xp-penalty');
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

  it('full penalty applied when user has room above the floor', async () => {
    // Level 5 floor = cumulativeXpForLevel(5). Set xp 200 above.
    const floor = cumulativeXpForLevel(5);
    await store.users.set(makeUser({ discord_id: 'u1', xp: floor + 200, level: 5 }));

    const r = await applyXpPenalty('u1', 100);
    expect(r.applied).toBe(100);
    expect(r.newXp).toBe(floor + 100);
    expect(store.xpLogs.count()).toBe(1);
    const log = store.xpLogs.recent(1)[0];
    expect(log?.amount).toBe(-100);
    expect(log?.source).toBe('tribulation_fail');
  });

  it('penalty floored at level threshold', async () => {
    const floor = cumulativeXpForLevel(5);
    // 50 XP above floor; ask for 200 penalty → only 50 applied.
    await store.users.set(makeUser({ discord_id: 'u2', xp: floor + 50, level: 5 }));

    const r = await applyXpPenalty('u2', 200);
    expect(r.applied).toBe(50);
    expect(r.newXp).toBe(floor);
    expect(store.users.get('u2')?.xp).toBe(floor);
  });

  it('user already at floor → no penalty', async () => {
    const floor = cumulativeXpForLevel(5);
    await store.users.set(makeUser({ discord_id: 'u3', xp: floor, level: 5 }));

    const r = await applyXpPenalty('u3', 100);
    expect(r.applied).toBe(0);
    expect(r.newXp).toBe(floor);
    expect(store.xpLogs.count()).toBe(0); // no log when no change
  });

  it('missing user → no-op', async () => {
    const r = await applyXpPenalty('ghost', 100);
    expect(r.applied).toBe(0);
  });

  it('non-positive amount → no-op', async () => {
    await store.users.set(makeUser({ discord_id: 'u4', xp: 1_000, level: 5 }));
    const r = await applyXpPenalty('u4', 0);
    expect(r.applied).toBe(0);
    expect(store.users.get('u4')?.xp).toBe(1_000);
  });
});

describe('isTribulationOnCooldown', () => {
  let store: Store;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await mkTmpDir('trib-cd');
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

  it('no events ever → not on cooldown', () => {
    expect(isTribulationOnCooldown()).toBe(false);
  });

  it('last event within 24h → on cooldown', async () => {
    const now = Date.now();
    await store.events.set(makeEvent({ id: 'e1', started_at: now - 1000, ended_at: now - 500 }));
    expect(isTribulationOnCooldown(now)).toBe(true);
  });

  it('last event past 24h → not on cooldown', async () => {
    const now = Date.now();
    const longAgo = now - TRIBULATION_CONSTANTS.SERVER_COOLDOWN_MS - 1_000;
    await store.events.set(makeEvent({ id: 'e1', started_at: longAgo, ended_at: longAgo + 500 }));
    expect(isTribulationOnCooldown(now)).toBe(false);
  });

  it('non-tribulation event types ignored', async () => {
    const now = Date.now();
    await store.events.set(
      makeEvent({ id: 'e1', type: 'alchemy', started_at: now - 1000, ended_at: now }),
    );
    expect(isTribulationOnCooldown(now)).toBe(false);
  });

  it('picks the LATEST event when multiple exist', async () => {
    const now = Date.now();
    await store.events.set(
      makeEvent({
        id: 'old',
        started_at: now - TRIBULATION_CONSTANTS.SERVER_COOLDOWN_MS - 10_000,
        ended_at: now - TRIBULATION_CONSTANTS.SERVER_COOLDOWN_MS - 5_000,
      }),
    );
    await store.events.set(makeEvent({ id: 'recent', started_at: now - 100, ended_at: now - 50 }));
    expect(isTribulationOnCooldown(now)).toBe(true);
  });
});

describe('pickEligibleUserId', () => {
  let store: Store;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await mkTmpDir('trib-pick');
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

  it('no users → null', () => {
    expect(pickEligibleUserId()).toBeNull();
  });

  it('no users level ≥ 10 → null', async () => {
    await store.users.set(makeUser({ discord_id: 'u1', level: 5 }));
    await store.users.set(makeUser({ discord_id: 'u2', level: 9 }));
    expect(pickEligibleUserId()).toBeNull();
  });

  it('exactly level 10 → eligible', async () => {
    await store.users.set(makeUser({ discord_id: 'u1', level: 10 }));
    expect(pickEligibleUserId()).toBe('u1');
  });

  it('one of several eligible users picked', async () => {
    await store.users.set(makeUser({ discord_id: 'u1', level: 5 }));
    await store.users.set(makeUser({ discord_id: 'u2', level: 12 }));
    await store.users.set(makeUser({ discord_id: 'u3', level: 20 }));
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const pick = pickEligibleUserId();
      if (pick) seen.add(pick);
    }
    // Both eligible users should be hit at least once in 30 trials.
    expect(seen.has('u2') || seen.has('u3')).toBe(true);
    expect(seen.has('u1')).toBe(false); // never picked
  });
});
