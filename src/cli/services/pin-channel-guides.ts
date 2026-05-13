import { EmbedBuilder, type Guild, type Message, type TextChannel } from 'discord.js';
import { CHANNEL_GUIDES, type ChannelGuide } from '../../config/channel-guides.js';
import type { BotCliService } from '../service.js';

/**
 * One-time / re-runnable: post (or edit-in-place) a pinned guide embed
 * in each channel from CHANNEL_GUIDES. Idempotency key is the embed
 * title — if a pinned bot message already exists with the same title,
 * we edit it instead of posting a new one.
 *
 * Usage:
 *   npm run bot -- pin-channel-guides              # apply all
 *   npm run bot -- pin-channel-guides --dry-run    # preview only
 *   npm run bot -- pin-channel-guides --channel=rules  # single channel
 */

interface ParsedArgs {
  dryRun: boolean;
  channelFilter: string | null;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  let dryRun = false;
  let channelFilter: string | null = null;
  for (const a of args) {
    if (a === '--dry-run') dryRun = true;
    else if (a.startsWith('--channel=')) channelFilter = a.slice('--channel='.length);
  }
  return { dryRun, channelFilter };
}

function buildEmbed(guide: ChannelGuide): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(guide.color)
    .setTitle(guide.title)
    .setDescription(guide.body.join('\n'));
  if (guide.footer) e.setFooter({ text: guide.footer });
  return e;
}

async function findExistingPinned(
  channel: TextChannel,
  title: string,
  botId: string,
): Promise<Message | null> {
  // Note: fetchPinned is deprecated in discord.js 14.17+ in favor of
  // fetchPins, but the new API has a different return shape and is
  // not stable in our pinned dep version. Keeping fetchPinned — the
  // deprecation warning is benign for this one-time CLI.
  const pinned = await channel.messages.fetchPinned();
  for (const msg of pinned.values()) {
    if (msg.author.id !== botId) continue;
    const t = msg.embeds[0]?.data.title;
    if (t === title) return msg;
  }
  return null;
}

async function applyGuide(
  guild: Guild,
  guide: ChannelGuide,
  botId: string,
  dryRun: boolean,
): Promise<'posted' | 'edited' | 'no-channel' | 'dry-post' | 'dry-edit'> {
  const channel = guild.channels.cache.find((c) => c.name === guide.channel && c.isTextBased()) as
    | TextChannel
    | undefined;
  if (!channel) return 'no-channel';

  const existing = await findExistingPinned(channel, guide.title, botId);
  const embed = buildEmbed(guide);

  if (existing) {
    if (dryRun) return 'dry-edit';
    await existing.edit({ embeds: [embed] });
    return 'edited';
  }
  if (dryRun) return 'dry-post';

  const sent = await channel.send({ embeds: [embed] });
  await sent.pin('channel guide (pin-channel-guides)');
  return 'posted';
}

export const pinChannelGuides: BotCliService = {
  name: 'pin-channel-guides',
  description: 'Post or edit-in-place the per-channel pinned guide embeds (idempotent)',
  usage: 'pin-channel-guides [--dry-run] [--channel=<name>]',
  needsClient: true,
  async execute(ctx, args) {
    const g = ctx.guild;
    if (!g) throw new Error('pin-channel-guides requires a connected client');
    const c = ctx.client;
    if (!c?.user) throw new Error('client.user missing — bot not ready');

    const parsed = parseArgs(args);
    await g.channels.fetch();

    const guides = parsed.channelFilter
      ? CHANNEL_GUIDES.filter((g) => g.channel === parsed.channelFilter)
      : CHANNEL_GUIDES;

    if (guides.length === 0) {
      throw new Error(
        parsed.channelFilter
          ? `no guide configured for channel "#${parsed.channelFilter}"`
          : 'no guides defined',
      );
    }

    const lines: string[] = [
      '',
      `=== pin-channel-guides ${parsed.dryRun ? '(DRY-RUN)' : '(APPLY)'} ===`,
      `Bot user: ${c.user.tag}`,
      `Guides  : ${guides.length}${parsed.channelFilter ? ` (filtered to #${parsed.channelFilter})` : ''}`,
      '',
    ];

    const counters = { posted: 0, edited: 0, noChannel: 0, dryPost: 0, dryEdit: 0 };
    for (const guide of guides) {
      try {
        const result = await applyGuide(g, guide, c.user.id, parsed.dryRun);
        const tag =
          result === 'posted'
            ? '✅ POSTED + pinned'
            : result === 'edited'
              ? '✏️  EDITED existing pin'
              : result === 'no-channel'
                ? '⚠️  channel missing — skipped'
                : result === 'dry-post'
                  ? '➕ would POST + pin'
                  : '✏️  would EDIT existing';
        lines.push(`  #${guide.channel.padEnd(20)} → ${tag}`);
        if (result === 'posted') counters.posted++;
        else if (result === 'edited') counters.edited++;
        else if (result === 'no-channel') counters.noChannel++;
        else if (result === 'dry-post') counters.dryPost++;
        else if (result === 'dry-edit') counters.dryEdit++;

        // Rate-limit pacing.
        if (!parsed.dryRun) await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        lines.push(`  #${guide.channel.padEnd(20)} → ❌ ERROR: ${(err as Error).message}`);
      }
    }

    lines.push('');
    lines.push('Summary:');
    if (parsed.dryRun) {
      lines.push(`  would post + pin : ${counters.dryPost}`);
      lines.push(`  would edit       : ${counters.dryEdit}`);
    } else {
      lines.push(`  posted + pinned  : ${counters.posted}`);
      lines.push(`  edited (idempot.): ${counters.edited}`);
    }
    lines.push(`  channels missing : ${counters.noChannel}`);
    lines.push('');

    process.stdout.write(lines.join('\n'));
  },
};
