import { getStore } from '../../db/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Raid detection + auto-mode toggling. Scaffold lives here in Chunk 5;
 * Chunk 6 fills in the slash command + manual on/off + #bot-log alert.
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
 * it off automatically. Scheduler tick in Chunk 7 calls
 * `maybeAutoDisableRaid()`.
 */

const AUTO_DISABLE_QUIET_MS = 30 * 60 * 1000;

export interface RaidCheckResult {
  forceHard: boolean;
  raidWasJustActivated: boolean;
  joinsInWindow: number;
}

/**
 * Append `now` to `recent_joins`, prune out-of-window entries, and
 * return whether the next join should be forced to hard captcha.
 *
 * Called from `guildMemberAdd` event handler before `startVerification`.
 */
export async function recordJoinAndCheck(
  now: number,
  windowMs: number,
  threshold: number,
): Promise<RaidCheckResult> {
  const store = getStore();
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
  }

  return {
    forceHard: nowActive,
    raidWasJustActivated: triggered && !wasActive,
    joinsInWindow: pruned.length,
  };
}

/**
 * Read-only: is raid mode currently on? Used by tests + status command.
 */
export function isRaidActive(): boolean {
  return getStore().raidState.get().is_active;
}

/**
 * Auto-disable when raid mode has been on with no joins for the quiet
 * window. Called periodically by the scheduler.
 */
export async function maybeAutoDisableRaid(
  now: number = Date.now(),
): Promise<{ disabled: boolean }> {
  const store = getStore();
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
  return { disabled: true };
}

/**
 * Manual toggle, called by /raid-mode on|off (Chunk 6). Returns the new
 * state for caller-side messaging.
 */
export async function setRaidMode(
  active: boolean,
  now: number = Date.now(),
): Promise<{ wasActive: boolean; nowActive: boolean }> {
  const store = getStore();
  const wasActive = store.raidState.get().is_active;
  await store.raidState.update({
    is_active: active,
    activated_at: active ? (wasActive ? store.raidState.get().activated_at : now) : null,
    recent_joins: active ? store.raidState.get().recent_joins : [],
  });
  logger.info({ was: wasActive, now: active }, 'raid: manual toggle');
  return { wasActive, nowActive: active };
}
