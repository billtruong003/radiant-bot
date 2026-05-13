import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setStoreForTesting } from '../../src/db/index.js';
import { Store } from '../../src/db/store.js';
import {
  DEFAULT_SUBTITLE_MAPPINGS,
  routeReaction,
  saveReactionRolesConfig,
} from '../../src/modules/reactionRoles/index.js';
import { mkTmpDir } from '../helpers/tmp-dir.js';

const NEVER = 99_999_999;

describe('routeReaction', () => {
  let store: Store;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await mkTmpDir('rr');
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

  it('no config saved → never matches', () => {
    const r = routeReaction('msg-id', '⚔️');
    expect(r.matched).toBe(false);
    expect(r.roleName).toBeUndefined();
  });

  it('matched message + known emoji → returns role name', async () => {
    await saveReactionRolesConfig('chan-1', 'msg-1', DEFAULT_SUBTITLE_MAPPINGS);
    const r = routeReaction('msg-1', '⚔️');
    expect(r.matched).toBe(true);
    expect(r.roleName).toBe('Kiếm Tu');
  });

  it('all 4 sub-title emojis map correctly', async () => {
    await saveReactionRolesConfig('chan-1', 'msg-1', DEFAULT_SUBTITLE_MAPPINGS);
    expect(routeReaction('msg-1', '⚔️').roleName).toBe('Kiếm Tu');
    expect(routeReaction('msg-1', '🧪').roleName).toBe('Đan Sư');
    expect(routeReaction('msg-1', '🔮').roleName).toBe('Trận Pháp Sư');
    expect(routeReaction('msg-1', '🌀').roleName).toBe('Tán Tu');
  });

  it('matched message + unknown emoji → matched=true but no roleName', async () => {
    await saveReactionRolesConfig('chan-1', 'msg-1', DEFAULT_SUBTITLE_MAPPINGS);
    const r = routeReaction('msg-1', '🎲');
    expect(r.matched).toBe(true);
    expect(r.roleName).toBeUndefined();
  });

  it('different message → no match even if emoji known', async () => {
    await saveReactionRolesConfig('chan-1', 'msg-1', DEFAULT_SUBTITLE_MAPPINGS);
    const r = routeReaction('msg-other', '⚔️');
    expect(r.matched).toBe(false);
  });

  it('config persists across simulated reload', async () => {
    await saveReactionRolesConfig('chan-1', 'msg-1', DEFAULT_SUBTITLE_MAPPINGS);
    await store.snapshot();
    const dir = store.getSnapshotPath().replace(/[/\\]snapshot\.json$/, '');
    await store.shutdown();
    __setStoreForTesting(null);

    const reloaded = new Store({ dataDir: dir, snapshotIntervalMs: NEVER, fsync: false });
    await reloaded.init();
    __setStoreForTesting(reloaded);

    const r = routeReaction('msg-1', '⚔️');
    expect(r.matched).toBe(true);
    expect(r.roleName).toBe('Kiếm Tu');

    store = reloaded;
  });
});
