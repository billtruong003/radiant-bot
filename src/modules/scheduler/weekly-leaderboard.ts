import type { Client, TextChannel } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ANNOUNCEMENT_CHANNELS } from '../../config/channels.js';
import { rankById } from '../../config/cultivation.js';
import { env } from '../../config/env.js';
import { getStore } from '../../db/index.js';
import { weeklyLeaderboard } from '../../db/queries/leaderboard.js';
import { logger } from '../../utils/logger.js';

/**
 * Weekly leaderboard post — Sunday 20:00 VN time per SPEC §8.4.
 * Reads the rolling 7-day XP totals from `xpLogs` (same query
 * /leaderboard period=weekly uses), posts to `#leaderboard`.
 */

const MEDAL = ['🥇', '🥈', '🥉'];

export async function postWeeklyLeaderboard(client: Client): Promise<void> {
  const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID);
  if (!guild) {
    logger.warn(
      { guild_id: env.DISCORD_GUILD_ID },
      'weekly-leaderboard: guild not in cache, skipping',
    );
    return;
  }
  const channel = guild.channels.cache.find(
    (c) => c.name === ANNOUNCEMENT_CHANNELS.leaderboard && c.isTextBased(),
  ) as TextChannel | undefined;
  if (!channel) {
    logger.warn(
      { expected: ANNOUNCEMENT_CHANNELS.leaderboard },
      'weekly-leaderboard: channel missing, skipping',
    );
    return;
  }

  const entries = weeklyLeaderboard(getStore(), 10);
  if (entries.length === 0) {
    logger.info('weekly-leaderboard: no entries to post this week');
    return;
  }

  const lines = entries.map((e) => {
    const prefix = MEDAL[e.rank - 1] ?? `**${e.rank}.**`;
    const name = e.user.display_name ?? e.user.username;
    const rank = rankById(e.user.cultivation_rank);
    return `${prefix} **${name}** — Level ${e.user.level} · ${rank.name} · +${e.score.toLocaleString('vi-VN')} XP tuần`;
  });

  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle('📅 Bảng xếp hạng tuần')
    .setDescription(
      [
        '*Top 10 đệ tử tu vi nhanh nhất 7 ngày qua.*',
        '',
        ...lines,
        '',
        '_Sang tuần mới — cố lên các vị đạo hữu!_',
      ].join('\n'),
    )
    .setTimestamp();

  try {
    await channel.send({ embeds: [embed] });
    logger.info({ entries: entries.length }, 'weekly-leaderboard: posted');
  } catch (err) {
    logger.error({ err }, 'weekly-leaderboard: post failed');
  }
}
