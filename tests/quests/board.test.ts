import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setStoreForTesting } from '../../src/db/index.js';
import { Store } from '../../src/db/store.js';
import type { User } from '../../src/db/types.js';
import {
  assignDailyQuest,
  getCurrentQuest,
  getTodayQuests,
  groupOf,
  incrementProgress,
} from '../../src/modules/quests/daily-quest.js';
import { questButtons } from '../../src/modules/quests/discord.js';
import { mkTmpDir } from '../helpers/tmp-dir.js';

describe('daily board (study + slay rows)', () => {
  let store: Store;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await mkTmpDir('board');
    cleanup = tmp.cleanup;
    store = new Store({ dataDir: tmp.dir, snapshotIntervalMs: 99_999_999, fsync: false });
    await store.init();
    __setStoreForTesting(store);
    await store.users.set({
      discord_id: 'u1',
      username: 'u',
      display_name: null,
      xp: 0,
      level: 0,
      cultivation_rank: 'pham_nhan',
      pills: 0,
      contribution_points: 0,
    } as unknown as User);
  });
  afterEach(async () => {
    __setStoreForTesting(null);
    await store.shutdown();
    await cleanup();
  });

  it('assigns one quest per row, idempotently', async () => {
    await assignDailyQuest('u1');
    await assignDailyQuest('u1');
    const board = getTodayQuests('u1');
    expect(board.map(groupOf)).toEqual(['daily', 'study', 'slay']);
    expect(store.dailyQuests.query(() => true)).toHaveLength(3);
    expect(getCurrentQuest('u1')?.group ?? 'daily').toBe('daily');
  });

  it('progress goes to the row holding that quest type and pays once', async () => {
    await assignDailyQuest('u1');
    const study = getTodayQuests('u1').find((q) => groupOf(q) === 'study');
    if (!study) throw new Error('no study quest');
    const r1 = await incrementProgress('u1', study.quest_type, study.target);
    expect(r1.completed).toBe(true);
    const r2 = await incrementProgress('u1', study.quest_type, 1);
    expect(r2.updated).toBe(false);
    expect(store.users.get('u1')?.pills).toBe(study.reward_pills);
  });

  it('shows a button for the open study quest only', async () => {
    await assignDailyQuest('u1');
    const board = getTodayQuests('u1');
    const rows = questButtons(board);
    expect(rows).toHaveLength(1);
    const study = board.find((q) => groupOf(q) === 'study');
    if (!study) throw new Error('no study');
    await incrementProgress('u1', study.quest_type, study.target);
    expect(questButtons(getTodayQuests('u1'))).toHaveLength(0);
  });
});
