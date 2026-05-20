import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import { command as akiMemory } from './aki-memory.js';
import { command as arena } from './arena.js';
import { command as askAkira } from './ask-akira.js';
import { command as askMeifeng } from './ask-meifeng.js';
import { command as ask } from './ask.js';
import { command as automodConfig } from './automod-config.js';
import { command as breakthrough } from './breakthrough.js';
import { command as congPhap } from './cong-phap.js';
import { command as contributeDoc } from './contribute-doc.js';
import { command as daily } from './daily.js';
import { command as danhHieu } from './danh-hieu.js';
import { command as duel } from './duel.js';
import { command as grant } from './grant.js';
import { command as help } from './help.js';
import { command as inventory } from './inventory.js';
import { command as leaderboard } from './leaderboard.js';
import { command as linkWhitelist } from './link-whitelist.js';
import { command as nhan } from './nhan.js';
import { command as phapKhi } from './phap-khi.js';
import { command as quest } from './quest.js';
import { command as raidMode } from './raid-mode.js';
import { command as rank } from './rank.js';
import { command as shop } from './shop.js';
import { command as statAlloc } from './stat-alloc.js';
import { command as stat } from './stat.js';
import { command as stats } from './stats.js';
import { command as syncPinned } from './sync-pinned.js';
import { command as thienDao } from './thien-dao.js';
import { command as title } from './title.js';
import { command as trade } from './trade.js';
import { command as verifyTest } from './verify-test.js';
import { command as weapon } from './weapon.js';

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
  /**
   * Optional autocomplete handler. When the command declares string options
   * with `setAutocomplete(true)`, the interactionCreate dispatcher routes
   * AutocompleteInteractions here. Should respond within 3s — Discord
   * times out otherwise.
   */
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
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
  [statAlloc.data.name, statAlloc as SlashCommand],
  [grant.data.name, grant as SlashCommand],
  // Phase 12 Lát 2-6
  [inventory.data.name, inventory as SlashCommand],
  [shop.data.name, shop as SlashCommand],
  [congPhap.data.name, congPhap as SlashCommand],
  [quest.data.name, quest as SlashCommand],
  [askAkira.data.name, askAkira as SlashCommand],
  [askMeifeng.data.name, askMeifeng as SlashCommand],
  [duel.data.name, duel as SlashCommand],
  [trade.data.name, trade as SlashCommand],
  [help.data.name, help as SlashCommand],
  [akiMemory.data.name, akiMemory as SlashCommand],
  [contributeDoc.data.name, contributeDoc as SlashCommand],
  [thienDao.data.name, thienDao as SlashCommand],
  [syncPinned.data.name, syncPinned as SlashCommand],
  // Phase 13 Lát A
  [arena.data.name, arena as SlashCommand],
  // Phase 14 — weapon management
  [weapon.data.name, weapon as SlashCommand],
  // Phase 14 — danh hiệu (honor titles)
  [danhHieu.data.name, danhHieu as SlashCommand],
  // Phase 14 round 3 — pháp khí + nhẫn multi-slot equipment
  [phapKhi.data.name, phapKhi as SlashCommand],
  [nhan.data.name, nhan as SlashCommand],
]);

export function findCommand(name: string): SlashCommand | undefined {
  return COMMANDS.get(name);
}

export function listCommands(): readonly SlashCommand[] {
  return [...COMMANDS.values()];
}
