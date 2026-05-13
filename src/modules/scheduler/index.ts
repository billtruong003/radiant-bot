import type { Client } from 'discord.js';
import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../../config/env.js';
import { loadVerificationConfig } from '../../config/verification.js';
import { logger } from '../../utils/logger.js';
import { runVoiceTick } from '../leveling/voice-xp.js';
import { cleanupExpiredVerifications } from '../verification/flow.js';
import { maybeAutoDisableRaid } from '../verification/raid.js';

/**
 * Scheduler registry. Phase 3 owns two jobs:
 *
 *   - verification cleanup (every minute): kick members whose pending
 *     verification crossed the timeout threshold and mark the record.
 *   - raid auto-disable (every minute): turn raid mode off after a quiet
 *     window (30 min by default).
 *
 * Phase 6+ will add daily check-in reset, weekly leaderboard, backup
 * push, etc. — same `cron.schedule(...)` + `tasks.push(handle)` pattern
 * so `stopScheduler()` cleans all of them up.
 */

const tasks: ScheduledTask[] = [];

async function runVerificationCleanup(client: Client): Promise<void> {
  const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID);
  if (!guild) {
    logger.warn({ guild_id: env.DISCORD_GUILD_ID }, 'scheduler: guild not in cache, skipping tick');
    return;
  }
  const config = await loadVerificationConfig();
  await cleanupExpiredVerifications(guild, config);
}

async function runRaidAutoDisable(): Promise<void> {
  await maybeAutoDisableRaid();
}

async function runVoiceXpTick(client: Client): Promise<void> {
  const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID);
  if (!guild) return;
  await runVoiceTick(guild);
}

export function startScheduler(client: Client): void {
  if (tasks.length > 0) {
    logger.warn('scheduler: already started, skipping');
    return;
  }

  // Every minute: verification cleanup + raid auto-disable + voice XP tick.
  // node-cron doesn't await the callback so we manually catch and log.
  const tick = cron.schedule('* * * * *', () => {
    runVerificationCleanup(client).catch((err) => {
      logger.error({ err }, 'scheduler: verification cleanup failed');
    });
    runRaidAutoDisable().catch((err) => {
      logger.error({ err }, 'scheduler: raid auto-disable failed');
    });
    runVoiceXpTick(client).catch((err) => {
      logger.error({ err }, 'scheduler: voice XP tick failed');
    });
  });
  tasks.push(tick);

  logger.info({ jobs: tasks.length }, 'scheduler: started');
}

export function stopScheduler(): void {
  for (const t of tasks) {
    t.stop();
  }
  tasks.length = 0;
  logger.info('scheduler: stopped');
}
