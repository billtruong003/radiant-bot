import type { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { command as raidMode } from './raid-mode.js';

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
]);

export function findCommand(name: string): SlashCommand | undefined {
  return COMMANDS.get(name);
}

export function listCommands(): readonly SlashCommand[] {
  return [...COMMANDS.values()];
}
