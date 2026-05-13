import { ChannelType } from 'discord.js';
import type { BotCliService } from '../service.js';

const TYPE_LABEL: Record<number, string> = {
  [ChannelType.GuildText]: 'text',
  [ChannelType.GuildVoice]: 'voice',
  [ChannelType.GuildCategory]: 'cat',
  [ChannelType.GuildAnnouncement]: 'news',
  [ChannelType.GuildStageVoice]: 'stage',
  [ChannelType.GuildForum]: 'forum',
};

export const listChannels: BotCliService = {
  name: 'list-channels',
  description: 'List all live guild channels grouped by category with IDs',
  usage: 'list-channels',
  needsClient: true,
  async execute(ctx) {
    const g = ctx.guild;
    if (!g) throw new Error('list-channels requires a connected client');
    await g.channels.fetch();

    const cats = new Map<
      string,
      { id: string; name: string; children: { id: string; name: string; type: number }[] }
    >();
    const rootless: { id: string; name: string; type: number }[] = [];

    for (const ch of g.channels.cache.values()) {
      if (ch.type === ChannelType.GuildCategory) {
        cats.set(ch.id, { id: ch.id, name: ch.name, children: [] });
      }
    }
    for (const ch of g.channels.cache.values()) {
      if (ch.type === ChannelType.GuildCategory) continue;
      const parentId = ch.parentId;
      if (parentId && cats.has(parentId)) {
        cats.get(parentId)?.children.push({ id: ch.id, name: ch.name, type: ch.type });
      } else {
        rootless.push({ id: ch.id, name: ch.name, type: ch.type });
      }
    }

    const lines: string[] = ['', `=== Channels in ${g.name} ===`, ''];

    if (rootless.length > 0) {
      lines.push('▼ (root — no category)');
      for (const c of rootless) {
        lines.push(`  [${TYPE_LABEL[c.type] ?? c.type}] ${c.name.padEnd(30)}  ${c.id}`);
      }
      lines.push('');
    }

    for (const cat of cats.values()) {
      lines.push(`▼ ${cat.name}  ${cat.id}`);
      if (cat.children.length === 0) {
        lines.push('  (empty)');
      } else {
        for (const c of cat.children) {
          lines.push(`  [${TYPE_LABEL[c.type] ?? c.type}] ${c.name.padEnd(30)}  ${c.id}`);
        }
      }
      lines.push('');
    }

    lines.push(`Total: ${cats.size} categories, ${g.channels.cache.size - cats.size} channels`);
    lines.push('');

    process.stdout.write(lines.join('\n'));
  },
};
