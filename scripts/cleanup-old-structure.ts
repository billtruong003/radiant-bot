/**
 * One-time cleanup of the Vietnamese-named structure that an earlier sync
 * attempt left behind. The bot's normal sync never deletes anything (hard
 * rule), so when we pivoted the schema from VN to English we needed a
 * separate, explicit, hardcoded-list deleter.
 *
 * What this script deletes:
 *   - Categories listed in `CATEGORIES_TO_DELETE`
 *   - Channels listed in `CHANNELS_TO_DELETE`
 *   - Roles listed in `ROLES_TO_DELETE`
 *
 * Each list is closed: anything NOT named in it is untouched. After running
 * once successfully, this file should be deleted from the repo.
 *
 * Usage:
 *   npm run cleanup-old-structure -- --dry-run    # preview
 *   npm run cleanup-old-structure -- --apply      # actually delete
 */
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { env } from '../src/config/env.js';
import { logger } from '../src/utils/logger.js';

/**
 * The user's guild ended up running a full VN sync successfully between
 * the bug fixes and the English pivot — so we now have ~25 VN-named
 * channels in 10 VN-named categories. Channels with English names that
 * already exist (`meme`, `game-development`, `ai-ml`, `tools-showcase`,
 * `gaming`, `highlight`, `bot-dev`, `Gaming`, `Gaming 2`) are NOT in
 * the delete list — the sync will move them into the new English
 * categories. Only the VN-named ones (no English equivalent in the new
 * schema, or English name differs) need deletion.
 */
const CATEGORIES_TO_DELETE: readonly string[] = [
  '🏯 Tông Môn Đại Điện',
  '🔒 Kiểm Tra',
  '📜 Đại Hội',
  '🔬 Công Nghệ',
  '🎮 Giải Trí',
  '🎨 Sáng Tạo',
  '🌌 Tu Luyện',
  '🛠️ Phòng Luyện Khí',
  '📚 Tài Nguyên',
  '🔊 Voice',
];

const CHANNELS_TO_DELETE: readonly string[] = [
  // 🏯 Tông Môn Đại Điện
  'thông-báo',
  'nội-quy',
  'nhật-ký-tông-môn',
  'phòng-trưởng-lão',
  // 🔒 Kiểm Tra
  'xác-minh',
  // 📜 Đại Hội (meme stays, will be moved by sync)
  'thảo-luận-chung',
  'giới-thiệu',
  'điểm-danh',
  // 🔬 Công Nghệ (game-development, ai-ml, tools-showcase stay)
  'cứu-trợ',
  // 🎮 Giải Trí (gaming, highlight stay)
  'xem-phim-cùng',
  // 🎨 Sáng Tạo
  'tranh-vẽ',
  'âm-nhạc',
  'văn-chương',
  // 🌌 Tu Luyện
  'hướng-dẫn-tu-luyện',
  'đột-phá',
  'bảng-xếp-hạng',
  'độ-kiếp',
  // 🛠️ Phòng Luyện Khí (bot-dev stays)
  'lệnh-bot',
  'ý-tưởng-automation',
  // 📚 Tài Nguyên
  'tài-liệu',
  'tin-tuyển-dụng',
  // 🔊 Voice (Gaming, Gaming 2 stay)
  'Sảnh Chính',
  'Tu Luyện (Pomodoro)',
  'Tu Luyện Tịnh Tâm',
  'Phim Ảnh',
];

const ROLES_TO_DELETE: readonly string[] = [
  // User opted to KEEP the 18 cultivation/staff/unverified VN roles as theme
  // flair (visible as level badges). Don't add them here.
];

interface Args {
  apply: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  if (argv.includes('--apply')) return { apply: true };
  return { apply: false };
}

async function main(): Promise<void> {
  const args = parseArgs();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  await client.login(env.DISCORD_TOKEN);
  logger.info({ tag: client.user?.tag, apply: args.apply }, 'cleanup: connected');

  const guild = await client.guilds.fetch(env.DISCORD_GUILD_ID);
  await guild.channels.fetch();
  await guild.roles.fetch();

  const stats = { deleted: 0, skipped: 0, notFound: 0 };

  // --- Channels first (must drop before their parent category) -----------
  for (const name of CHANNELS_TO_DELETE) {
    const channel = guild.channels.cache.find((c) => c.name === name);
    if (!channel) {
      logger.info({ name }, 'cleanup: channel not found, skipping');
      stats.notFound++;
      continue;
    }
    logger.info({ name, id: channel.id, type: channel.type }, 'cleanup: channel to delete');
    if (args.apply) {
      await channel.delete('one-time cleanup of orphaned VN structure');
      stats.deleted++;
    } else {
      stats.skipped++;
    }
  }

  // --- Categories ---------------------------------------------------------
  for (const name of CATEGORIES_TO_DELETE) {
    const category = guild.channels.cache.find((c) => c.name === name && c.type === 4);
    if (!category) {
      logger.info({ name }, 'cleanup: category not found, skipping');
      stats.notFound++;
      continue;
    }
    // Refuse to delete a non-empty category — safety check, the user may have
    // created channels under it after the first apply.
    if ('children' in category && category.children.cache.size > 0) {
      logger.error(
        {
          name,
          id: category.id,
          children: category.children.cache.map((c) => c.name),
        },
        'cleanup: category has children, REFUSING to delete (move/delete children first)',
      );
      continue;
    }
    logger.info({ name, id: category.id }, 'cleanup: category to delete');
    if (args.apply) {
      await category.delete('one-time cleanup of orphaned VN structure');
      stats.deleted++;
    } else {
      stats.skipped++;
    }
  }

  // --- Roles --------------------------------------------------------------
  for (const name of ROLES_TO_DELETE) {
    const role = guild.roles.cache.find((r) => r.name === name);
    if (!role) {
      logger.info({ name }, 'cleanup: role not found, skipping');
      stats.notFound++;
      continue;
    }
    if (role.managed) {
      logger.warn({ name }, 'cleanup: role is managed (bot/integration), REFUSING');
      continue;
    }
    logger.info({ name, id: role.id }, 'cleanup: role to delete');
    if (args.apply) {
      await role.delete('one-time cleanup of orphaned VN structure');
      stats.deleted++;
    } else {
      stats.skipped++;
    }
  }

  logger.info({ ...stats, apply: args.apply }, 'cleanup: complete');
  if (!args.apply) {
    logger.info('cleanup: this was a dry-run. Re-run with `-- --apply` to actually delete.');
  }

  await client.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error('[cleanup] fatal:', err);
  process.exit(1);
});
