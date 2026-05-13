/**
 * Read-only audit. Compares the live guild state to `server-structure.ts`
 * and prints a clean PASS/FAIL verdict with counts. Exits with status 0 if
 * everything is in sync, 1 otherwise — usable as a CI check.
 *
 *   npm run check-server
 *
 * Implementation: calls `syncServer(guild, { dryRun: true })` so the audit
 * matches sync's drift detection exactly, then formats counters into a
 * compact summary.
 */
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { env } from '../src/config/env.js';
import { syncServer } from '../src/modules/sync/index.js';
import { logger } from '../src/utils/logger.js';

// Audit should be quiet by default — the per-item "channel up-to-date" debug
// lines drown out the summary at the bottom. Caller can still see all detail
// by running `npm run sync-server:dry` directly.
logger.level = 'warn';

const ICON_OK = '[OK]';
const ICON_DRIFT = '[DRIFT]';

async function main(): Promise<void> {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  await client.login(env.DISCORD_TOKEN);
  const guild = await client.guilds.fetch(env.DISCORD_GUILD_ID);

  // Run sync in dry-run mode at WARN log level so the per-item drift lines
  // are suppressed; we render our own summary instead.
  const counters = await syncServer(guild, { dryRun: true, rateDelayMs: 0 });

  const rolesTotal = counters.rolesCreated + counters.rolesUpdated + counters.rolesUnchanged;
  const catsTotal =
    counters.categoriesCreated + counters.categoriesUpdated + counters.categoriesUnchanged;
  const chansTotal =
    counters.channelsCreated + counters.channelsUpdated + counters.channelsUnchanged;

  const rolesDrift = counters.rolesCreated + counters.rolesUpdated;
  const catsDrift = counters.categoriesCreated + counters.categoriesUpdated;
  const chansDrift = counters.channelsCreated + counters.channelsUpdated;

  const line = (
    icon: string,
    label: string,
    unchanged: number,
    total: number,
    created: number,
    updated: number,
  ): string => {
    const drift = created + updated;
    const detail = drift > 0 ? `  (need: +${created} create, ~${updated} update)` : '';
    return `${icon}   ${label.padEnd(11)}: ${unchanged}/${total} unchanged${detail}`;
  };

  const summary = [
    '',
    '=== Server audit ===',
    `Guild: ${guild.name} (${guild.id})`,
    '',
    line(
      rolesDrift === 0 ? ICON_OK : ICON_DRIFT,
      'Roles',
      counters.rolesUnchanged,
      rolesTotal,
      counters.rolesCreated,
      counters.rolesUpdated,
    ),
    line(
      catsDrift === 0 ? ICON_OK : ICON_DRIFT,
      'Categories',
      counters.categoriesUnchanged,
      catsTotal,
      counters.categoriesCreated,
      counters.categoriesUpdated,
    ),
    line(
      chansDrift === 0 ? ICON_OK : ICON_DRIFT,
      'Channels',
      counters.channelsUnchanged,
      chansTotal,
      counters.channelsCreated,
      counters.channelsUpdated,
    ),
    '',
  ].join('\n');

  // Write directly to stdout so the structured pino logs don't interleave
  // with the readable summary.
  process.stdout.write(summary);

  const allInSync = rolesDrift === 0 && catsDrift === 0 && chansDrift === 0;
  if (allInSync) {
    process.stdout.write('Status: PASS  —  server matches schema.\n\n');
    await client.destroy();
    process.exit(0);
  }

  process.stdout.write(
    'Status: DRIFT  —  run `npm run sync-server` to apply the changes above.\n\n',
  );
  await client.destroy();
  process.exit(1);
}

main().catch((err) => {
  console.error('[check-server] fatal:', err);
  process.exit(1);
});
