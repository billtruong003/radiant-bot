import 'dotenv/config';
import { startBot, stopBot } from './bot.js';
import { loadCongPhapCatalog } from './config/cong-phap-catalog.js';
import { getStore, initStore, shutdownStore } from './db/index.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  // Storage MUST be initialized before the Discord client. Replay completes
  // before any event handlers can fire so they see correct state.
  const store = await initStore();
  logger.info(
    {
      users: store.users.count(),
      xp_logs: store.xpLogs.count(),
      data_dir: store.getSnapshotPath(),
    },
    'store: ready',
  );

  // Phase 12 — seed công pháp catalog from JSON if Store has none.
  // Idempotent: re-running on a populated catalog is a no-op.
  try {
    const catalog = await loadCongPhapCatalog();
    let seeded = 0;
    for (const item of catalog) {
      if (!getStore().congPhapCatalog.get(item.slug)) {
        await getStore().congPhapCatalog.set(item);
        seeded++;
      }
    }
    if (seeded > 0) {
      logger.info({ seeded, total: catalog.length }, 'store: công pháp catalog seeded');
    }
  } catch (err) {
    logger.error({ err }, 'store: failed to seed công pháp catalog (continuing)');
  }

  const client = await startBot();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutdown signal received, closing gracefully');
    try {
      await stopBot(client);
      await shutdownStore();
      logger.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
      // Best-effort final snapshot even if Discord close failed.
      try {
        await shutdownStore();
      } catch (err2) {
        logger.error({ err: err2 }, 'final snapshot also failed');
      }
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    // Don't exit immediately — try to flush state. Then exit.
    shutdownStore()
      .catch((err2) => logger.error({ err: err2 }, 'emergency snapshot failed'))
      .finally(() => process.exit(1));
  });
}

main().catch((err) => {
  // logger may not be initialized if env validation failed
  console.error('[bootstrap] fatal:', err);
  process.exit(1);
});
