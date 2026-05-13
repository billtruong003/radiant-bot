/**
 * Standalone server sync. Run via `npm run sync-server` or
 * `npm run sync-server -- --dry-run`.
 *
 * Connects with the bot token, fetches the configured guild, runs the
 * idempotent sync from src/modules/sync, then exits. Does NOT touch the
 * storage layer — sync is pure Discord state.
 */
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { env } from '../src/config/env.js';
import { syncServer } from '../src/modules/sync/index.js';
import { logger } from '../src/utils/logger.js';

function parseArgs(): { dryRun: boolean; rateDelayMs: number } {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  let rateDelayMs = 500;
  for (const arg of argv) {
    const m = arg.match(/^--rate-delay=(\d+)$/);
    if (m?.[1]) rateDelayMs = Number.parseInt(m[1], 10);
  }
  return { dryRun, rateDelayMs };
}

async function main(): Promise<void> {
  const args = parseArgs();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  await client.login(env.DISCORD_TOKEN);
  logger.info({ tag: client.user?.tag }, 'sync-server: connected');

  const guild = await client.guilds.fetch(env.DISCORD_GUILD_ID);
  logger.info({ guild: guild.name, id: guild.id }, 'sync-server: target guild');

  try {
    await syncServer(guild, args);
    logger.info('sync-server: done');
  } catch (err) {
    logger.error({ err }, 'sync-server: failed');
    await client.destroy();
    process.exit(1);
  }

  await client.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error('[sync-server] fatal:', err);
  process.exit(1);
});
