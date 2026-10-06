import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import { command as aiDebug } from './ai-debug.js';
import { command as aiModels } from './ai-models.js';
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
import { command as hunter } from './hunter.js';
import { command as inventory } from './inventory.js';
import { command as leaderboard } from './leaderboard.js';
import { command as linkWhitelist } from './link-whitelist.js';
import { command as me } from './me.js';
import { mergeCommands } from './merge.js';
import { command as nhan } from './nhan.js';
import { command as phapKhi } from './phap-khi.js';
import { command as quest } from './quest.js';
import { command as raidMode } from './raid-mode.js';
import { command as rank } from './rank.js';
import { command as selftest } from './selftest.js';
import { command as shop } from './shop.js';
import { command as statAlloc } from './stat-alloc.js';
import { command as stat } from './stat.js';
import { command as stats } from './stats.js';
import { command as syncPinned } from './sync-pinned.js';
import { command as thienDao } from './thien-dao.js';
import { command as title } from './title.js';
import { command as traCuu } from './tra-cuu.js';
import { command as trade } from './trade.js';
import { command as tutorial } from './tutorial.js';
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

const ADMIN = '8'; // PermissionFlagsBits.Administrator, as Discord expects it in JSON

/**
 * Related commands share one name (39 commands became 17). Each child keeps
 * its own file and code; `mergeCommands` only routes to it.
 */
const ALL: SlashCommand[] = [
  mergeCommands('profile', 'Hồ sơ của bạn: tổng quan, cảnh giới, lực chiến, phân bố chỉ số', [
    { as: 'me', command: me as SlashCommand },
    { as: 'rank', command: rank as SlashCommand },
    { as: 'stat', command: stat as SlashCommand },
    { as: 'alloc', command: statAlloc as SlashCommand },
  ]),
  mergeCommands('title', 'Phong hiệu và danh hiệu', [
    { as: 'phong-hieu', command: title as SlashCommand },
    { as: 'danh-hieu', command: danhHieu as SlashCommand },
  ]),
  mergeCommands('ask', 'Hỏi Aki, Akira hoặc Meifeng', [
    { as: 'aki', command: ask as SlashCommand },
    { as: 'akira', command: askAkira as SlashCommand },
    { as: 'meifeng', command: askMeifeng as SlashCommand },
    { as: 'memory', command: akiMemory as SlashCommand },
  ]),
  mergeCommands('help', 'Hướng dẫn: menu điều hướng và nhập môn', [
    { as: 'menu', command: help as SlashCommand },
    { as: 'tutorial', command: tutorial as SlashCommand },
  ]),
  mergeCommands('gear', 'Trang bị: túi đồ, vũ khí, công pháp, pháp khí, nhẫn', [
    { as: 'inventory', command: inventory as SlashCommand },
    { as: 'weapon', command: weapon as SlashCommand },
    { as: 'cong-phap', command: congPhap as SlashCommand },
    { as: 'phap-khi', command: phapKhi as SlashCommand },
    { as: 'nhan', command: nhan as SlashCommand },
  ]),
  mergeCommands('shop', 'Cửa hàng: xem đồ và bán lại công pháp', [
    { as: 'browse', command: shop as SlashCommand },
    { as: 'trade', command: trade as SlashCommand },
  ]),
  mergeCommands('ai', 'Chẩn đoán AI (Chưởng Môn)', [
    { as: 'debug', command: aiDebug as SlashCommand },
    { as: 'models', command: aiModels as SlashCommand },
  ]),
  mergeCommands(
    'mod',
    'Kiểm duyệt: automod, link, raid, Thiên Đạo, cấp thưởng (admin)',
    [
      { as: 'automod', command: automodConfig as SlashCommand },
      { as: 'links', command: linkWhitelist as SlashCommand },
      { as: 'raid', command: raidMode as SlashCommand },
      { as: 'thien-dao', command: thienDao as SlashCommand },
      { as: 'grant', command: grant as SlashCommand },
    ],
    ADMIN,
  ),
  mergeCommands(
    'admin',
    'Quản trị bot: thống kê, selftest, verify, pinned, arena (admin)',
    [
      { as: 'stats', command: stats as SlashCommand },
      { as: 'selftest', command: selftest as SlashCommand },
      { as: 'verify-test', command: verifyTest as SlashCommand },
      { as: 'sync-pinned', command: syncPinned as SlashCommand },
      { as: 'arena', command: arena as SlashCommand },
    ],
    ADMIN,
  ),
  daily as SlashCommand,
  quest as SlashCommand,
  duel as SlashCommand,
  leaderboard as SlashCommand,
  breakthrough as SlashCommand,
  hunter as SlashCommand,
  traCuu as SlashCommand,
  contributeDoc as SlashCommand,
];

const COMMANDS: ReadonlyMap<string, SlashCommand> = new Map(ALL.map((c) => [c.data.name, c]));

/** What deploy-commands registers with Discord. */
export function listCommands(): readonly SlashCommand[] {
  return ALL;
}

export function findCommand(name: string): SlashCommand | undefined {
  return COMMANDS.get(name);
}
