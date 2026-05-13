import type { Client, Guild } from 'discord.js';

/**
 * Strategy interface for `npm run bot -- <name> [args...]` services.
 *
 * Each service is one file under `src/cli/services/`. The dispatcher
 * (`src/cli/dispatcher.ts`) reads argv, picks the matching service by
 * `name`, optionally connects to Discord if `needsClient`, then invokes
 * `execute(ctx, args)`.
 *
 * Why a strategy pattern: lets future operator commands (role-grant,
 * store-inspect, simulate-verify, etc) be added as drop-in files
 * without touching the dispatcher.
 */
export interface BotCliService {
  /** Unique subcommand name. Used as the first positional arg. */
  readonly name: string;
  /** Single-line description shown in help. */
  readonly description: string;
  /** Usage string shown when invoked with wrong args. */
  readonly usage: string;
  /**
   * When true, dispatcher connects to Discord and fetches the configured
   * guild before invoking the service. When false, service runs offline
   * (e.g. rendering static schema, store inspection).
   */
  readonly needsClient: boolean;
  /**
   * Run the service. Args are the tail of argv after the subcommand name.
   * Throw on error — dispatcher catches and exits with code 1.
   */
  execute(ctx: ServiceContext, args: readonly string[]): Promise<void>;
}

/**
 * Context handed to services. `client` and `guild` are only set when the
 * service has `needsClient: true`; offline services receive them as null.
 */
export interface ServiceContext {
  client: Client | null;
  guild: Guild | null;
}

export function offlineContext(): ServiceContext {
  return { client: null, guild: null };
}
