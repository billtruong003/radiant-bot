import { ChannelType, EmbedBuilder, type Guild, type GuildBasedChannel } from 'discord.js';
import type { BotCliService } from '../service.js';

const COLORS = {
  info: 0x5dade2,
  success: 0x27ae60,
  warn: 0xf4d03f,
  error: 0xe74c3c,
} as const;

type Level = keyof typeof COLORS;

function isLevel(s: string): s is Level {
  return s in COLORS;
}

function resolveChannel(guild: Guild, query: string): GuildBasedChannel | undefined {
  const idMatch = query.match(/^<?#?(\d{15,})>?$/);
  const id = idMatch?.[1];
  if (id) return guild.channels.cache.get(id);
  for (const ch of guild.channels.cache.values()) {
    if (ch.name === query) return ch;
  }
  return undefined;
}

export const notify: BotCliService = {
  name: 'notify',
  description: 'Send a formatted embed notification to a channel',
  usage: 'notify <channel> <level=info|success|warn|error> <title> <description...>',
  needsClient: true,
  async execute(ctx, args) {
    const g = ctx.guild;
    if (!g) throw new Error('notify requires a connected client');
    if (args.length < 4) {
      throw new Error(`usage: ${this.usage}`);
    }
    const [query, levelArg, title, ...descParts] = args;
    if (!query || !levelArg || !title) {
      throw new Error(`usage: ${this.usage}`);
    }
    if (!isLevel(levelArg)) {
      throw new Error(`invalid level "${levelArg}"; must be one of: info, success, warn, error`);
    }
    const description = descParts.join(' ');

    await g.channels.fetch();
    const channel = resolveChannel(g, query);
    if (!channel) throw new Error(`channel not found: ${query}`);
    if (channel.type === ChannelType.GuildCategory) {
      throw new Error(`"${channel.name}" is a category; cannot send`);
    }
    if (!channel.isTextBased()) {
      throw new Error(`channel "${channel.name}" is not text-based`);
    }

    const embed = new EmbedBuilder()
      .setColor(COLORS[levelArg])
      .setTitle(title)
      .setDescription(description || null)
      .setTimestamp(Date.now())
      .setFooter({ text: `bot-cli · ${levelArg}` });

    const sent = await channel.send({ embeds: [embed] });
    process.stdout.write(
      `\nNotified #${channel.name} (${channel.id}) [${levelArg}]\n  message id: ${sent.id}\n  title     : ${title}\n\n`,
    );
  },
};
