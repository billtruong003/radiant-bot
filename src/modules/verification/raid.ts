import { type Store, getStore } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import { postBotLog } from '../bot-log.js';

/**
 * Raid detection + auto-mode toggling.
 *
 * State persists in `store.raidState` (singleton):
 *   - recent_joins: rolling window of join timestamps (epoch ms)
 *   - is_active: whether raid mode is currently on
 *   - activated_at: when last toggled on (ms) — used for auto-disable
 *   - last_join_at: latest join timestamp seen
 *
 * Detection: if there are ≥ `raidJoinThreshold` joins within
 * `raidJoinWindowMs`, enable raid mode. Once enabled, every new join
 * gets the hard captcha (forceHard=true) regardless of audit outcome.
 *
 * Auto-disable: 30 minutes since the last join with raid active turns
 * it off automatically. Scheduler tick (Chunk 7) calls
 * `maybeAutoDisableRaid()` every minute.
 *
 * Functions accept an optional `store` parameter so tests can inject a
 * fresh Store. Production callers omit it and use the singleton.
 */

export const AUTO_DISABLE_QUIET_MS = 30 * 60 * 1000;

export interface RaidCheckResult {
  forceHard: boolean;
  raidWasJustActivated: boolean;
  joinsInWindow: number;
}

export interface RaidStatus {
  is_active: boolean;
  activated_at: number | null;
  last_join_at: number | null;
  recent_joins_count: number;
}

/**
 * Append `now` to `recent_joins`, prune out-of-window entries, and
 * return whether the next join should be forced to hard captcha.
 */
export async function recordJoinAndCheck(
  now: number,
  windowMs: number,
  threshold: number,
  store: Store = getStore(),
): Promise<RaidCheckResult> {
  const state = store.raidState.get();
  const cutoff = now - windowMs;
  const pruned = state.recent_joins.filter((ts) => ts > cutoff);
  pruned.push(now);

  const wasActive = state.is_active;
  const triggered = pruned.length >= threshold;
  const nowActive = wasActive || triggered;

  await store.raidState.update({
    recent_joins: pruned,
    last_join_at: now,
    is_active: nowActive,
    activated_at: triggered && !wasActive ? now : state.activated_at,
  });

  if (triggered && !wasActive) {
    logger.warn(
      { joins_in_window: pruned.length, window_ms: windowMs, threshold },
      'raid: auto-activated — forcing hard captcha for all new joins',
    );
    await postBotLog(
      `🚨 **Raid mode tự động kích hoạt** — ${pruned.length} join trong ${Math.floor(windowMs / 1000)}s.\nMọi member mới sẽ nhận hard captcha. Dùng \`/raid-mode off\` để tắt thủ công.`,
    );
  }

  return {
    forceHard: nowActive,
    raidWasJustActivated: triggered && !wasActive,
    joinsInWindow: pruned.length,
  };
}

export function isRaidActive(store: Store = getStore()): boolean {
  return store.raidState.get().is_active;
}

export function getRaidStatus(store: Store = getStore()): RaidStatus {
  const s = store.raidState.get();
  return {
    is_active: s.is_active,
    activated_at: s.activated_at,
    last_join_at: s.last_join_at,
    recent_joins_count: s.recent_joins.length,
  };
}

/**
 * Auto-disable when raid mode has been on with no joins for the quiet
 * window. No-op if not active or if too recent.
 */
export async function maybeAutoDisableRaid(
  now: number = Date.now(),
  store: Store = getStore(),
): Promise<{ disabled: boolean }> {
  const state = store.raidState.get();
  if (!state.is_active) return { disabled: false };
  const lastJoin = state.last_join_at ?? state.activated_at ?? now;
  if (now - lastJoin < AUTO_DISABLE_QUIET_MS) return { disabled: false };

  await store.raidState.update({
    is_active: false,
    activated_at: null,
    recent_joins: [],
  });
  logger.info({ quiet_ms: now - lastJoin }, 'raid: auto-disabled after quiet window');
  await postBotLog(
    `🟢 **Raid mode tự động tắt** — đã ${Math.floor((now - lastJoin) / 60_000)} phút không có join mới.`,
  );
  return { disabled: true };
}

/**
 * Manual toggle, called by /raid-mode on|off. Returns the new state for
 * caller-side messaging.
 */
export async function setRaidMode(
  active: boolean,
  now: number = Date.now(),
  store: Store = getStore(),
): Promise<{ wasActive: boolean; nowActive: boolean }> {
  const wasActive = store.raidState.get().is_active;
  await store.raidState.update({
    is_active: active,
    activated_at: active ? (wasActive ? store.raidState.get().activated_at : now) : null,
    recent_joins: active ? store.raidState.get().recent_joins : [],
  });
  logger.info({ was: wasActive, now: active }, 'raid: manual toggle');
  return { wasActive, nowActive: active };
}
