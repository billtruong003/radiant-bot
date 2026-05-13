export interface SyncOptions {
  dryRun: boolean;
  /** Delay between mutating API calls in ms. Discord has internal rate-limit
   *  handling but this gives the gateway breathing room during bulk ops. */
  rateDelayMs: number;
}

export interface SyncCounters {
  rolesCreated: number;
  rolesUpdated: number;
  rolesUnchanged: number;
  categoriesCreated: number;
  categoriesUpdated: number;
  categoriesUnchanged: number;
  channelsCreated: number;
  channelsUpdated: number;
  channelsUnchanged: number;
}

export function makeCounters(): SyncCounters {
  return {
    rolesCreated: 0,
    rolesUpdated: 0,
    rolesUnchanged: 0,
    categoriesCreated: 0,
    categoriesUpdated: 0,
    categoriesUnchanged: 0,
    channelsCreated: 0,
    channelsUpdated: 0,
    channelsUnchanged: 0,
  };
}

export async function rateDelay(opts: SyncOptions): Promise<void> {
  if (opts.dryRun || opts.rateDelayMs <= 0) return;
  await new Promise((r) => setTimeout(r, opts.rateDelayMs));
}
