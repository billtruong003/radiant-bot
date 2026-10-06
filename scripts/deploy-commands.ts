/**
 * Slash command deployer. Reads command modules from `src/commands/`, builds
 * their `SlashCommandBuilder` JSON, and pushes to Discord via REST.
 *
 * Defaults to **guild-scoped** registration (instant propagation, ideal for
 * dev). Pass `--global` for global registration (≤1h propagation).
 *
 * Phase 2 state: `src/commands/` is empty — script registers 0 commands but
 * the wiring is in place for Phase 4+ to drop command files and re-run.
 */
import 'dotenv/config';
import { REST, type RESTPostAPIChatInputApplicationCommandsJSONBody, Routes } from 'discord.js';
import { env } from '../src/config/env.js';
import { logger } from '../src/utils/logger.js';

interface CommandModule {
  data: {
    toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
    name: string;
  };
}

/** The registry, not the directory: merged commands (e.g. /gear) have no file of their own. */
async function loadCommands(): Promise<CommandModule[]> {
  const { listCommands } = await import('../src/commands/index.js');
  return listCommands() as unknown as CommandModule[];
}

async function main(): Promise<void> {
  const isGlobal = process.argv.includes('--global');
  const commands = await loadCommands();
  const payload = commands.map((c) => c.data.toJSON());

  logger.info(
    { count: commands.length, scope: isGlobal ? 'global' : 'guild' },
    'deploy-commands: registering',
  );
  if (commands.length === 0) {
    logger.info(
      'deploy-commands: no command files in src/commands/ — exiting (Phase 4+ will add some)',
    );
    return;
  }

  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
  const route = isGlobal
    ? Routes.applicationCommands(env.DISCORD_CLIENT_ID)
    : Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID);

  const result = (await rest.put(route, { body: payload })) as unknown[];
  logger.info({ registered: result.length }, 'deploy-commands: done');
}

main().catch((err) => {
  console.error('[deploy-commands] fatal:', err);
  process.exit(1);
});
