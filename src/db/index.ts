import { env } from '../config/env.js';
import { Store } from './store.js';

let _store: Store | null = null;

/**
 * Singleton store instance. Call `initStore()` once during bot bootstrap
 * before importing `store` anywhere else.
 */
export function getStore(): Store {
  if (!_store) {
    throw new Error('Store accessed before initStore() — call initStore() during bootstrap');
  }
  return _store;
}

export async function initStore(): Promise<Store> {
  if (_store) return _store;
  _store = new Store({
    dataDir: env.DATA_DIR,
    snapshotIntervalMs: env.SNAPSHOT_INTERVAL_MS,
    fsync: env.WAL_FSYNC,
  });
  await _store.init();
  return _store;
}

export async function shutdownStore(): Promise<void> {
  if (!_store) return;
  await _store.shutdown();
  _store = null;
}

/**
 * Test-only escape hatch. Lets a vitest file inject a pre-constructed
 * Store into the singleton slot so module-level `getStore()` callers
 * (`flow.ts`, `raid.ts`, etc.) see a tmp-dir Store instead of throwing.
 * Pass `null` to reset. NEVER call from production code paths.
 */
export function __setStoreForTesting(store: Store | null): void {
  _store = store;
}

// Re-exports so consumers can `import { store, User } from '@/db'`-style.
export { Store } from './store.js';
export { Collection } from './collection.js';
export { AppendOnlyCollection } from './append-only-collection.js';
export { SingletonCollection } from './singleton-collection.js';
export { AppendOnlyLog } from './append-log.js';
export type {
  User,
  XpLog,
  XpSource,
  VoiceSession,
  Verification,
  AutomodLog,
  SectEvent,
  RaidState,
  ReactionRolesConfig,
  ReactionRoleMapping,
  CultivationRankId,
} from './types.js';
export type { StoreOp } from './operations.js';
