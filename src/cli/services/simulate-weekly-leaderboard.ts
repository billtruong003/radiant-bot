import { rankById } from '../../config/cultivation.js';
import { initStore, shutdownStore } from '../../db/index.js';
import { weeklyLeaderboard } from '../../db/queries/leaderboard.js';
import type { BotCliService } from '../service.js';

/**
 * Dry-run preview of the Sunday 20:00 VN weekly leaderboard cron.
 * Initializes the store (reads live xp_logs), runs the same query
 * the cron job uses, prints what the embed would look like.
 *
 * No Discord connection, no channel post. Pure data inspection.
 */

const MEDAL = ['🥇', '🥈', '🥉'];

export const simulateWeeklyLeaderboard: BotCliService = {
  name: 'simulate-weekly-leaderboard',
  description: 'Dry-run preview of the weekly leaderboard cron output',
  usage: 'simulate-weekly-leaderboard',
  needsClient: false,
  async execute() {
    const store = await initStore();
    try {
      const entries = weeklyLeaderboard(store, 10);
      const lines: string[] = [
        '',
        '=== simulate-weekly-leaderboard (DRY-RUN) ===',
        `Total users in store : ${store.users.count()}`,
        `Total XP log entries : ${store.xpLogs.count()}`,
        `Entries this week    : ${entries.length}`,
        '',
      ];

      if (entries.length === 0) {
        lines.push('⚠️ No entries — cron would skip posting (logger.info "no entries this week").');
      } else {
        lines.push('--- Preview of #leaderboard embed ---');
        lines.push('📅 Bảng xếp hạng tuần');
        lines.push('*Top 10 đệ tử tu vi nhanh nhất 7 ngày qua.*');
        lines.push('');
        for (const e of entries) {
          const prefix = MEDAL[e.rank - 1] ?? `**${e.rank}.**`;
          const name = e.user.display_name ?? e.user.username;
          const rank = rankById(e.user.cultivation_rank);
          lines.push(
            `${prefix} **${name}** — Level ${e.user.level} · ${rank.name} · +${e.score.toLocaleString('vi-VN')} XP tuần`,
          );
        }
      }

      lines.push('');
      lines.push('No channel post made. Cron next fires Sunday 20:00 (Asia/Ho_Chi_Minh).');
      lines.push('');
      process.stdout.write(lines.join('\n'));
    } finally {
      await shutdownStore();
    }
  },
};
