import type { Guild, GuildMember } from 'discord.js';
import { env } from '../../config/env.js';
import type { BotCliService } from '../service.js';

/**
 * Dry-run preview of the welcome flow. Fetches a target member,
 * builds the embed + DM that would be sent on verification pass,
 * and prints them to stdout. NO actual post, NO actual DM.
 *
 * Use to eyeball the wording + verify channel resolution before
 * running a real alt-account verification.
 */

interface ParsedArgs {
  memberId: string | null;
  self: boolean;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  let memberId: string | null = null;
  let self = false;
  for (const a of args) {
    if (a === '--self') self = true;
    else if (a.startsWith('--member=')) memberId = a.slice('--member='.length);
  }
  return { memberId, self };
}

async function resolveMember(guild: Guild, parsed: ParsedArgs): Promise<GuildMember> {
  if (parsed.self) {
    const targetId = env.ADMIN_USER_IDS[0] ?? guild.ownerId;
    return await guild.members.fetch(targetId);
  }
  if (!parsed.memberId) {
    throw new Error('must pass --member=<id> or --self');
  }
  return await guild.members.fetch(parsed.memberId);
}

export const simulateWelcome: BotCliService = {
  name: 'simulate-welcome',
  description: 'Dry-run preview of the welcome message + DM that would post on verification pass',
  usage: 'simulate-welcome [--self | --member=<id>]',
  needsClient: true,
  async execute(ctx, args) {
    const g = ctx.guild;
    if (!g) throw new Error('simulate-welcome requires a connected client');
    const parsed = parseArgs(args);

    await g.channels.fetch();
    const member = await resolveMember(g, parsed);

    // Lazy-import to avoid evaluating the welcome module before
    // the CLI service registry is collected (welcome imports
    // ANNOUNCEMENT_CHANNELS which is fine, but keeping the import
    // local mirrors the runtime call shape).
    const { __for_testing: _w } = await import('../../modules/welcome/index.js');

    // Build the same content welcome.ts would.
    const welcomeChannel = g.channels.cache.find(
      (c) => c.name === _w.WELCOME_CHANNEL && c.isTextBased(),
    );
    const fallbackChannel = g.channels.cache.find(
      (c) => c.name === _w.INTRODUCTIONS_CHANNEL && c.isTextBased(),
    );
    const targetChannel = welcomeChannel ?? fallbackChannel;

    const lines: string[] = [
      '',
      '=== simulate-welcome (DRY-RUN) ===',
      `Target member : ${member.user.tag} (${member.id})`,
      `Joined        : ${member.joinedAt?.toISOString() ?? '<unknown>'}`,
      '',
      `Welcome channel: ${
        welcomeChannel ? `#${welcomeChannel.name} ✓` : `#${_w.WELCOME_CHANNEL} ✗ MISSING`
      }`,
      `Fallback       : ${
        fallbackChannel ? `#${fallbackChannel.name} ✓` : `#${_w.INTRODUCTIONS_CHANNEL} ✗ MISSING`
      }`,
      `Will post to   : ${targetChannel ? `#${targetChannel.name}` : '⚠️ NONE (welcome would be skipped)'}`,
      '',
      '--- Welcome embed (would post) ---',
      'Title : 🌅 Chào mừng tân đệ tử',
      `Author: ${member.displayName}`,
      'Color : 0x5dade2 (light blue)',
      'Body  : (see welcome/index.ts buildWelcomeEmbed for full text)',
      '',
      '--- DM quick-start guide (would DM) ---',
    ];

    // Reconstruct the DM text inline so we don't need to export it.
    const dmPreview = [
      '🏯 **Chào mừng đến Radiant Tech Sect!**',
      '...',
      '**Lệnh hữu ích:** /daily, /rank, /leaderboard',
      '**Earn XP:** Message (15-25), Voice (10-15/min), Reaction (2)',
      'Đột phá cảnh giới tự động ở level milestones.',
    ];
    for (const l of dmPreview) lines.push(l);

    lines.push('');
    lines.push('No channel post made. No DM sent. No state mutated.');
    lines.push('');
    process.stdout.write(lines.join('\n'));
  },
};
