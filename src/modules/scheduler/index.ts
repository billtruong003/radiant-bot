import type { Client } from 'discord.js';
import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../../config/env.js';
import { loadVerificationConfig } from '../../config/verification.js';
import { getStore } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import { runVoiceTick } from '../leveling/voice-xp.js';
import { assignDailyQuest } from '../quests/daily-quest.js';
import { cleanupExpiredVerifications, cleanupStaleVerifyThreads } from '../verification/flow.js';
import { maybeAutoDisableRaid } from '../verification/raid.js';
import { pruneOldMessages } from '../archive/message-archive.js';
import { runWeeklyAnalytics } from '../insights/group-analytics.js';
import { runMemberProfiling } from '../insights/member-profiles.js';
import { backupToGitHub } from './backup.js';
import { maybeRunRandomTribulation } from './tribulation-trigger.js';
import { postWeeklyLeaderboard } from './weekly-leaderboard.js';

/**
 * Scheduler registry. Cron jobs:
 *
 *   Per-minute (`* * * * *`):
 *     - verification cleanup (kick expired pending verifications)
 *     - raid auto-disable (after 30min quiet window)
 *     - voice XP tick (per-channel scan)
 *
 *   Sunday 20:00 VN (`0 20 * * 0`, Asia/Ho_Chi_Minh):
 *     - weekly leaderboard post to #leaderboard
 *
 *   Daily 00:00 VN (`0 0 * * *`, Asia/Ho_Chi_Minh):
 *     - GitHub backup (snapshot + WAL push)
 *
 * `stopScheduler()` stops all jobs uniformly. Each job catches errors
 * internally so a transient failure doesn't poison the next tick.
 */

const tasks: ScheduledTask[] = [];
const VN_TZ = 'Asia/Ho_Chi_Minh';

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

async function assignQuestsForActiveUsers(): Promise<void> {
  const store = getStore();
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const active = store.users.query(
    (u) => u.verified_at !== null && (u.last_message_at ?? 0) >= sevenDaysAgo,
  );
  let assigned = 0;
  for (const user of active) {
    const q = await assignDailyQuest(user.discord_id);
    if (q && q.assigned_at >= Date.now() - 60_000) assigned++;
  }
  logger.info({ active_users: active.length, assigned }, 'scheduler: daily quests assigned');
}

export function startScheduler(client: Client): void {
  if (tasks.length > 0) {
    logger.warn('scheduler: already started, skipping');
    return;
  }

  // Per-minute aggregate tick.
  const minuteTick = cron.schedule('* * * * *', () => {
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
  tasks.push(minuteTick);

  // Sunday 20:00 VN — weekly leaderboard.
  const weekly = cron.schedule(
    '0 20 * * 0',
    () => {
      postWeeklyLeaderboard(client).catch((err) => {
        logger.error({ err }, 'scheduler: weekly leaderboard failed');
      });
    },
    { timezone: VN_TZ },
  );
  tasks.push(weekly);

  // Daily 00:00 VN — GitHub backup.
  const nightly = cron.schedule(
    '0 0 * * *',
    () => {
      backupToGitHub().catch((err) => {
        logger.error({ err }, 'scheduler: backup failed');
      });
    },
    { timezone: VN_TZ },
  );
  tasks.push(nightly);

  // Daily 18:00 VN — 25% chance random tribulation (gating inside fn).
  const tribulationCron = cron.schedule(
    '0 18 * * *',
    () => {
      maybeRunRandomTribulation(client).catch((err) => {
        logger.error({ err }, 'scheduler: tribulation trigger failed');
      });
    },
    { timezone: VN_TZ },
  );
  tasks.push(tribulationCron);

  // Hourly — sweep stale verify-* threads from #verify (Phase 11 B1).
  const threadCleanup = cron.schedule('0 * * * *', () => {
    const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID);
    if (!guild) return;
    cleanupStaleVerifyThreads(guild).catch((err) => {
      logger.error({ err }, 'scheduler: verify-thread cleanup failed');
    });
  });
  tasks.push(threadCleanup);

  // Phase 12 Lát 4 — daily quest generator. Runs at 00:00 VN. Issues
  // 1 quest per active (verified + active in last 7d) user.
  const dailyQuest = cron.schedule(
    '0 0 * * *',
    () => {
      assignQuestsForActiveUsers().catch((err) => {
        logger.error({ err }, 'scheduler: daily quest assignment failed');
      });
    },
    { timezone: VN_TZ },
  );
  tasks.push(dailyQuest);

  // Phase 15 — member knowledge base, two jobs behind one flag:
  //   - DAILY 09:00 VN: learn + infer (profiles track how people change)
  //   - WEEKLY Sun 20:00 VN: activity analytics digest
  // Both off unless MEMBER_PROFILING_ENABLED=true.
  if (env.MEMBER_PROFILING_ENABLED) {
    const memberProfiling = cron.schedule(
      env.MEMBER_PROFILING_CRON,
      () => {
        runMemberProfiling(client).catch((err) => {
          logger.error({ err }, 'scheduler: member profiling failed');
        });
      },
      { timezone: VN_TZ },
    );
    tasks.push(memberProfiling);

    // Weekly activity analytics — Sunday 20:00 VN by default, landing
    // with the weekly leaderboard so leaders get one review moment.
    // Gated behind the same flag: both jobs read the same member data.
    const groupAnalytics = cron.schedule(
      env.GROUP_ANALYTICS_CRON,
      () => {
        runWeeklyAnalytics(client).catch((err) => {
          logger.error({ err }, 'scheduler: weekly group analytics failed');
        });
      },
      { timezone: VN_TZ },
    );
    tasks.push(groupAnalytics);
  }

  // Phase 16 — nightly retention sweep on the message archive. 03:00 VN,
  // off-peak: the prune ends with a VACUUM which briefly locks the file.
  if (env.ARCHIVE_ENABLED) {
    const archivePrune = cron.schedule(
      '0 3 * * *',
      () => {
        try {
          pruneOldMessages();
        } catch (err) {
          logger.error({ err }, 'scheduler: archive prune failed');
        }
      },
      { timezone: VN_TZ },
    );
    tasks.push(archivePrune);
  }

  logger.info(
    { jobs: tasks.length, tz: VN_TZ },
    'scheduler: started (per-min + weekly + nightly backup + tribulation)',
  );
}

export function stopScheduler(): void {
  for (const t of tasks) {
    t.stop();
  }
  tasks.length = 0;
  logger.info('scheduler: stopped');
}

/** Number of cron tasks currently registered. Used by /selftest. */
export function getSchedulerTaskCount(): number {
  return tasks.length;
}
