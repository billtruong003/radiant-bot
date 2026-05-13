/**
 * Bot operator CLI entry point. Dispatches to a strategy service under
 * `src/cli/services/`.
 *
 *   npm run bot                                # show help
 *   npm run bot -- whoami                      # bot identity check
 *   npm run bot -- permissions                 # channel × role matrix (offline)
 *   npm run bot -- list-channels               # live channel dump with IDs
 *   npm run bot -- send <channel> <message>    # send plain text
 *   npm run bot -- notify <ch> <level> <t> <d> # send embed
 */
import 'dotenv/config';
import { dispatch } from '../src/cli/dispatcher.js';
import { logger } from '../src/utils/logger.js';

// Default to warn so the dispatcher's startup logs don't drown out service
// output. Services that want INFO can raise it themselves.
logger.level = 'warn';

dispatch(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`\n[bot-cli] error: ${(err as Error).message}\n\n`);
  process.exit(1);
});
