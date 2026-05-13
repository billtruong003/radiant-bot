import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../../src/db/store.js';
import {
  AUTO_DISABLE_QUIET_MS,
  getRaidStatus,
  isRaidActive,
  maybeAutoDisableRaid,
  recordJoinAndCheck,
  setRaidMode,
} from '../../src/modules/verification/raid.js';
import { mkTmpDir } from '../helpers/tmp-dir.js';

const NEVER = 99_999_999;
const WINDOW = 60_000;
const THRESHOLD = 10;

describe('recordJoinAndCheck', () => {
  let store: Store;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await mkTmpDir('raid');
    cleanup = tmp.cleanup;
    store = new Store({ dataDir: tmp.dir, snapshotIntervalMs: NEVER, fsync: false });
    await store.init();
  });

  afterEach(async () => {
    await store.shutdown();
    await cleanup();
  });

  it('first join: count=1, not triggered', async () => {
    const r = await recordJoinAndCheck(1_000, WINDOW, THRESHOLD, store);
    expect(r.joinsInWindow).toBe(1);
    expect(r.forceHard).toBe(false);
    expect(r.raidWasJustActivated).toBe(false);
    expect(isRaidActive(store)).toBe(false);
  });

  it('threshold-1 joins within window: not triggered', async () => {
    for (let i = 0; i < THRESHOLD - 1; i++) {
      await recordJoinAndCheck(1_000 + i, WINDOW, THRESHOLD, store);
    }
    expect(isRaidActive(store)).toBe(false);
    expect(getRaidStatus(store).recent_joins_count).toBe(THRESHOLD - 1);
  });

  it('exactly threshold joins within window: triggered + activates', async () => {
    let last: Awaited<ReturnType<typeof recordJoinAndCheck>> | undefined;
    for (let i = 0; i < THRESHOLD; i++) {
      last = await recordJoinAndCheck(1_000 + i, WINDOW, THRESHOLD, store);
    }
    expect(last?.forceHard).toBe(true);
    expect(last?.raidWasJustActivated).toBe(true);
    expect(isRaidActive(store)).toBe(true);
  });

  it('joins outside window are pruned', async () => {
    // Burst at t=0..5 (will fall out of window when we jump ahead).
    for (let i = 0; i < 5; i++) {
      await recordJoinAndCheck(i, WINDOW, THRESHOLD, store);
    }
    // Jump >window forward — old joins drop out, new count starts at 1.
    const r = await recordJoinAndCheck(WINDOW + 100, WINDOW, THRESHOLD, store);
    expect(r.joinsInWindow).toBe(1);
    expect(r.forceHard).toBe(false);
  });

  it('once active, subsequent joins keep forceHard=true even if window quiets', async () => {
    // Trigger first.
    for (let i = 0; i < THRESHOLD; i++) {
      await recordJoinAndCheck(1_000 + i, WINDOW, THRESHOLD, store);
    }
    expect(isRaidActive(store)).toBe(true);
    // One more join far later — count drops but raid stays active.
    const r = await recordJoinAndCheck(2 * WINDOW + 5_000, WINDOW, THRESHOLD, store);
    expect(r.forceHard).toBe(true);
    expect(r.raidWasJustActivated).toBe(false); // wasActive already
  });

  it('raidWasJustActivated is true exactly once', async () => {
    let activations = 0;
    for (let i = 0; i < THRESHOLD + 5; i++) {
      const r = await recordJoinAndCheck(1_000 + i, WINDOW, THRESHOLD, store);
      if (r.raidWasJustActivated) activations++;
    }
    expect(activations).toBe(1);
  });
});

describe('maybeAutoDisableRaid', () => {
  let store: Store;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await mkTmpDir('raid-disable');
    cleanup = tmp.cleanup;
    store = new Store({ dataDir: tmp.dir, snapshotIntervalMs: NEVER, fsync: false });
    await store.init();
  });

  afterEach(async () => {
    await store.shutdown();
    await cleanup();
  });

  it('no-op when raid not active', async () => {
    const r = await maybeAutoDisableRaid(Date.now(), store);
    expect(r.disabled).toBe(false);
  });

  it('no-op when active but within quiet window', async () => {
    // Activate at t=0
    await setRaidMode(true, 0, store);
    await recordJoinAndCheck(1_000, WINDOW, THRESHOLD, store);
    // Check at t = quietMs - 1 → still within window
    const r = await maybeAutoDisableRaid(1_000 + AUTO_DISABLE_QUIET_MS - 1, store);
    expect(r.disabled).toBe(false);
    expect(isRaidActive(store)).toBe(true);
  });

  it('disables when active + past quiet window', async () => {
    await setRaidMode(true, 0, store);
    await recordJoinAndCheck(1_000, WINDOW, THRESHOLD, store);
    const r = await maybeAutoDisableRaid(1_000 + AUTO_DISABLE_QUIET_MS + 1, store);
    expect(r.disabled).toBe(true);
    expect(isRaidActive(store)).toBe(false);
    expect(getRaidStatus(store).recent_joins_count).toBe(0);
  });
});

describe('setRaidMode', () => {
  let store: Store;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await mkTmpDir('raid-set');
    cleanup = tmp.cleanup;
    store = new Store({ dataDir: tmp.dir, snapshotIntervalMs: NEVER, fsync: false });
    await store.init();
  });

  afterEach(async () => {
    await store.shutdown();
    await cleanup();
  });

  it('on: activates with timestamp + reports prior state', async () => {
    const r = await setRaidMode(true, 5_000, store);
    expect(r.wasActive).toBe(false);
    expect(r.nowActive).toBe(true);
    expect(isRaidActive(store)).toBe(true);
    expect(getRaidStatus(store).activated_at).toBe(5_000);
  });

  it('off: deactivates + clears recent_joins', async () => {
    await setRaidMode(true, 0, store);
    await recordJoinAndCheck(100, WINDOW, THRESHOLD, store);
    const r = await setRaidMode(false, 1_000, store);
    expect(r.wasActive).toBe(true);
    expect(r.nowActive).toBe(false);
    expect(isRaidActive(store)).toBe(false);
    expect(getRaidStatus(store).recent_joins_count).toBe(0);
  });
});
