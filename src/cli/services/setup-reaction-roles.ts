import { EmbedBuilder, type TextChannel } from 'discord.js';
import { SUB_TITLES } from '../../config/cultivation.js';
import { initStore, shutdownStore } from '../../db/index.js';
import {
  DEFAULT_SUBTITLE_MAPPINGS,
  saveReactionRolesConfig,
} from '../../modules/reactionRoles/index.js';
import type { BotCliService } from '../service.js';

/**
 * One-time setup: post the reaction-roles message in `#leveling-guide`
 * (or `--channel=<name>`), react with each sub-title emoji, and persist
 * the message ID + mappings to `store.reactionRolesConfig`.
 *
 * Idempotent: if a config already exists in the store, prints it and
 * exits — pass `--reset` to overwrite (will leave the old message
 * orphaned but Discord-side; admin can delete it manually).
 */

const DEFAULT_CHANNEL = 'leveling-guide';

function parseArgs(args: readonly string[]): { channelName: string; reset: boolean } {
  let channelName = DEFAULT_CHANNEL;
  let reset = false;
  for (const a of args) {
    if (a === '--reset') reset = true;
    else if (a.startsWith('--channel=')) channelName = a.slice('--channel='.length);
  }
  return { channelName, reset };
}

function buildEmbed(): EmbedBuilder {
  const lines = SUB_TITLES.map((s) => `${s.emoji} **${s.name}** — ${s.theme}`);
  return new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🏷️ Chọn sub-title (phong hiệu)')
    .setDescription(
      [
        'Bấm reaction tương ứng để **nhận** sub-title. Bấm lại để **bỏ** sub-title.',
        '',
        ...lines,
        '',
        '_Bạn có thể giữ nhiều sub-title cùng lúc._',
      ].join('\n'),
    )
    .setFooter({ text: 'Radiant Tech Sect — Sub-title flair' });
}

export const setupReactionRoles: BotCliService = {
  name: 'setup-reaction-roles',
  description: 'One-time post + persist the sub-title reaction-roles message in #leveling-guide',
  usage: 'setup-reaction-roles [--channel=<name>] [--reset]',
  needsClient: true,
  async execute(ctx, args) {
    const g = ctx.guild;
    if (!g) throw new Error('setup-reaction-roles requires a connected client');
    const parsed = parseArgs(args);

    await initStore();

    try {
      const existing = (await import('../../db/index.js')).getStore().reactionRolesConfig.get();
      if (existing.message_id && !parsed.reset) {
        process.stdout.write(
          [
            '',
            '=== setup-reaction-roles ===',
            'Config already exists in store. Use --reset to overwrite (old message will be orphaned).',
            `  channel_id : ${existing.channel_id}`,
            `  message_id : ${existing.message_id}`,
            `  mappings   : ${existing.mappings.map((m) => `${m.emoji} → ${m.role_name}`).join(', ')}`,
            '',
          ].join('\n'),
        );
        return;
      }

      await g.channels.fetch();
      const channel = g.channels.cache.find(
        (c) => c.name === parsed.channelName && c.isTextBased(),
      ) as TextChannel | undefined;
      if (!channel) {
        throw new Error(`channel "#${parsed.channelName}" not found — run sync-server first`);
      }

      // Verify all the sub-title roles exist before posting (defensive).
      const missing = SUB_TITLES.filter((s) => !g.roles.cache.find((r) => r.name === s.name));
      if (missing.length > 0) {
        throw new Error(
          `missing sub-title roles in guild: ${missing.map((m) => m.name).join(', ')} — run sync-server`,
        );
      }

      const sent = await channel.send({ embeds: [buildEmbed()] });
      for (const s of SUB_TITLES) {
        await sent.react(s.emoji);
        await new Promise((r) => setTimeout(r, 250)); // rate-limit pacing
      }

      await saveReactionRolesConfig(channel.id, sent.id, DEFAULT_SUBTITLE_MAPPINGS);

      process.stdout.write(
        [
          '',
          '=== setup-reaction-roles complete ===',
          `Channel    : #${channel.name} (${channel.id})`,
          `Message    : ${sent.id}`,
          `Reactions  : ${SUB_TITLES.map((s) => s.emoji).join(' ')}`,
          '',
          'Persisted to store.reactionRolesConfig — reaction events now route to role grant.',
          '',
        ].join('\n'),
      );
    } finally {
      await shutdownStore();
    }
  },
};
