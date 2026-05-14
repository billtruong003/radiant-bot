import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setStoreForTesting } from '../../src/db/index.js';
import { Store } from '../../src/db/store.js';
import {
  __for_testing,
  assignDailyQuest,
  getCurrentQuest,
  incrementProgress,
} from '../../src/modules/quests/daily-quest.js';
import { mkTmpDir } from '../helpers/tmp-dir.js';

const NEVER = 99_999_999;

async function seedUser(store: Store, id = 'u1'): Promise<void> {
  await store.users.set({
    discord_id: id,
    username: 'TestUser',
    display_name: null,
    xp: 0,
    level: 0,
    cultivation_rank: 'pham_nhan',
    sub_title: null,
    joined_at: 0,
    verified_at: 0,
    last_message_at: Date.now(),
    last_daily_at: null,
    daily_streak: 0,
    is_suspect: false,
    notes: null,
    pills: 0,
    contribution_points: 0,
    equipped_cong_phap_slug: null,
    combat_power_cache: null,
    last_quest_assigned_at: null,
  });
}

describe('daily-quest', () => {
  let store: Store;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await mkTmpDir('dq');
    cleanup = tmp.cleanup;
    store = new Store({ dataDir: tmp.dir, snapshotIntervalMs: NEVER, fsync: false });
    await store.init();
    __setStoreForTesting(store);
    await seedUser(store);
  });

  afterEach(async () => {
    __setStoreForTesting(null);
    await store.shutdown();
    await cleanup();
  });

  it('assignDailyQuest creates a quest for fresh user', async () => {
    const q = await assignDailyQuest('u1');
    expect(q).not.toBeNull();
    expect(q?.progress).toBe(0);
    expect(q?.completed_at).toBeNull();
  });

  it('assignDailyQuest is idempotent — second call returns existing quest', async () => {
    const q1 = await assignDailyQuest('u1');
    const q2 = await assignDailyQuest('u1');
    expect(q2?.id).toBe(q1?.id);
  });

  it('getCurrentQuest returns null when none assigned', () => {
    const q = getCurrentQuest('never-assigned');
    expect(q).toBeNull();
  });

  it('incrementProgress advances progress + completes on target', async () => {
    const q = await assignDailyQuest('u1');
    if (!q) throw new Error('no quest');
    const r1 = await incrementProgress('u1', q.quest_type, 1);
    expect(r1.updated).toBe(true);
    expect(r1.completed).toBe(false);

    // Force-complete by jumping to target
    const r2 = await incrementProgress('u1', q.quest_type, q.target);
    expect(r2.completed).toBe(true);
    const completed = getCurrentQuest('u1');
    expect(completed?.completed_at).not.toBeNull();
  });

  it('incrementProgress wrong type does nothing', async () => {
    const q = await assignDailyQuest('u1');
    if (!q) throw new Error('no quest');
    const otherType = q.quest_type === 'message_count' ? 'voice_minutes' : 'message_count';
    const r = await incrementProgress('u1', otherType, 5);
    expect(r.updated).toBe(false);
  });

  it('completion grants pills + contribution', async () => {
    const q = await assignDailyQuest('u1');
    if (!q) throw new Error('no quest');
    await incrementProgress('u1', q.quest_type, q.target);
    const user = store.users.get('u1');
    expect(user?.pills).toBe(q.reward_pills);
    expect(user?.contribution_points).toBe(q.reward_contribution);
  });

  it('vnDayStart resolves to midnight Asia/Ho_Chi_Minh', () => {
    const ts = Date.parse('2026-05-14T15:30:00+07:00');
    expect(__for_testing.vnDayStart(ts)).toBe(Date.parse('2026-05-14T00:00:00+07:00'));
  });
});
