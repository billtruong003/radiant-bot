import 'dotenv/config';
import { startBot, stopBot } from './bot.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  const client = await startBot();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutdown signal received, closing gracefully');
    try {
      await stopBot(client);
      logger.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
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
    process.exit(1);
  });
}

main().catch((err) => {
  // logger may not be initialized if env validation failed
  console.error('[bootstrap] fatal:', err);
  process.exit(1);
});
