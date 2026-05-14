import { ChannelType, type Guild, type GuildBasedChannel } from 'discord.js';
import { matchesChannelName } from '../../config/channels.js';
import type { BotCliService } from '../service.js';

function resolveChannel(guild: Guild, query: string): GuildBasedChannel | undefined {
  // Allow lookup by ID or by name (Discord mention `<#id>` also OK).
  const idMatch = query.match(/^<?#?(\d{15,})>?$/);
  const id = idMatch?.[1];
  if (id) return guild.channels.cache.get(id);
  for (const ch of guild.channels.cache.values()) {
    if (matchesChannelName(ch, query) || ch.name === query) return ch;
  }
  return undefined;
}

export const send: BotCliService = {
  name: 'send',
  description: 'Send a plain text message to a channel (by name or ID)',
  usage: 'send <channel-name-or-id> <message...>',
  needsClient: true,
  async execute(ctx, args) {
    const g = ctx.guild;
    if (!g) throw new Error('send requires a connected client');
    if (args.length < 2) {
      throw new Error(`usage: ${this.usage}`);
    }
    const query = args[0];
    const message = args.slice(1).join(' ');
    if (!query) throw new Error('channel query is required');

    await g.channels.fetch();
    const channel = resolveChannel(g, query);
    if (!channel) throw new Error(`channel not found: ${query}`);
    if (channel.type === ChannelType.GuildCategory) {
      throw new Error(`"${channel.name}" is a category; cannot send text`);
    }
    if (!channel.isTextBased()) {
      throw new Error(`channel "${channel.name}" is not text-based`);
    }

    const sent = await channel.send(message);
    process.stdout.write(
      `\nSent to #${channel.name} (${channel.id})\n  message id: ${sent.id}\n  content   : ${message}\n\n`,
    );
  },
};
