import type { Guild } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { syncCategoriesAndChannels } from './channels.js';
import { type SyncCounters, type SyncOptions, makeCounters } from './common.js';
import { syncRoles } from './roles.js';

export type { SyncOptions, SyncCounters } from './common.js';

const DEFAULT_OPTIONS: SyncOptions = {
  dryRun: false,
  rateDelayMs: 500,
};

/**
 * Idempotent server sync. Walks `server-structure.ts` and creates / updates
 * roles, categories, channels, and permission overwrites to match.
 *
 * Hard rules:
 *   - NEVER deletes anything.
 *   - Roles synced first; channels reference them.
 *   - Each mutating API call is followed by `rateDelayMs` to avoid bursting
 *     past Discord's gateway rate limit on bulk first-time setup.
 *   - dry-run mode logs intended changes without calling mutating APIs.
 *
 * Returns the counters so audit/check scripts can render their own summary.
 */
export async function syncServer(
  guild: Guild,
  overrides: Partial<SyncOptions> = {},
): Promise<SyncCounters> {
  const opts: SyncOptions = { ...DEFAULT_OPTIONS, ...overrides };
  const counters = makeCounters();

  logger.info({ guild: guild.name, guild_id: guild.id, dry_run: opts.dryRun }, 'sync: starting');

  const roleMap = await syncRoles(guild, opts, counters);
  await syncCategoriesAndChannels(guild, roleMap, opts, counters);

  logger.info({ ...counters, dry_run: opts.dryRun }, 'sync: complete');
  return counters;
}
