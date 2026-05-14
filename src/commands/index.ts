import type { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { command as ask } from './ask.js';
import { command as automodConfig } from './automod-config.js';
import { command as breakthrough } from './breakthrough.js';
import { command as daily } from './daily.js';
import { command as grant } from './grant.js';
import { command as leaderboard } from './leaderboard.js';
import { command as linkWhitelist } from './link-whitelist.js';
import { command as raidMode } from './raid-mode.js';
import { command as rank } from './rank.js';
import { command as stat } from './stat.js';
import { command as stats } from './stats.js';
import { command as title } from './title.js';
import { command as verifyTest } from './verify-test.js';

/**
 * Slash command registry. Each command lives in its own file and is
 * imported here, then exposed via `findCommand(name)` for the
 * interactionCreate dispatcher. deploy-commands.ts auto-discovers by
 * scanning the directory, so this index file is for runtime dispatch
 * only.
 */

export interface SlashCommand {
  data: SlashCommandBuilder | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

const COMMANDS: ReadonlyMap<string, SlashCommand> = new Map([
  [raidMode.data.name, raidMode as SlashCommand],
  [rank.data.name, rank as SlashCommand],
  [leaderboard.data.name, leaderboard as SlashCommand],
  [daily.data.name, daily as SlashCommand],
  [automodConfig.data.name, automodConfig as SlashCommand],
  [title.data.name, title as SlashCommand],
  [breakthrough.data.name, breakthrough as SlashCommand],
  [ask.data.name, ask as SlashCommand],
  [verifyTest.data.name, verifyTest as SlashCommand],
  [linkWhitelist.data.name, linkWhitelist as SlashCommand],
  [stats.data.name, stats as SlashCommand],
  [stat.data.name, stat as SlashCommand],
  [grant.data.name, grant as SlashCommand],
]);

export function findCommand(name: string): SlashCommand | undefined {
  return COMMANDS.get(name);
}

export function listCommands(): readonly SlashCommand[] {
  return [...COMMANDS.values()];
}
