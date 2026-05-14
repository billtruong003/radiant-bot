import type { EmbedBuilder, GuildMember, TextChannel } from 'discord.js';
import { ANNOUNCEMENT_CHANNELS, matchesChannelName } from '../../config/channels.js';
import { rankById } from '../../config/cultivation.js';
import { DIVIDER, ICONS, RANK_ICONS } from '../../config/ui.js';
import { getStore } from '../../db/index.js';
import { themedEmbed } from '../../utils/embed.js';
import { logger } from '../../utils/logger.js';

/**
 * Welcome posting — called from `flow.ts:passVerification` once a member
 * successfully completes the captcha. Two side-effects:
 *   1. A public welcome embed in `#general` mentioning the new member.
 *   2. A best-effort DM quick-start guide (silent if DMs are blocked).
 *
 * Both are wrapped in try/catch — verification's pass path is the
 * critical work and must not fail because the welcome post fails.
 */

const WELCOME_CHANNEL = 'general';
const INTRODUCTIONS_CHANNEL = 'introductions';

function findChannelByName(member: GuildMember, name: string): TextChannel | null {
  const ch = member.guild.channels.cache.find(
    (c) => matchesChannelName(c, name) && c.isTextBased(),
  );
  return (ch as TextChannel | undefined) ?? null;
}

function buildWelcomeEmbed(member: GuildMember): EmbedBuilder {
  const hero = [
    `${ICONS.sparkle} ${member} vừa gia nhập **Radiant Tech Sect** ${ICONS.sparkle}`,
    '',
    '🩶 Khởi đầu tu vi từ **Phàm Nhân** (Level 0)',
    '*Đường tu là đường tự rèn — chăm chỉ là gốc của tu vi.*',
  ].join('\n');

  const quickStart = [
    `${ICONS.scroll} **Bắt đầu thế nào:**`,
    '• `/daily` — điểm danh hằng ngày, nhận **+100 XP**',
    '• Nhắn tin trong các kênh — **15–25 XP** mỗi message (cooldown 60s)',
    '• Tham gia voice channel — **10 XP**/phút (**15 XP** ở Focus Room)',
    '• `/rank` — xem cấp độ + tiến độ',
    '• `/leaderboard` — top 10 đệ tử',
    `• \`/ask\` — hỏi **Aki** ${ICONS.aki_happy} hầu gái của tông môn`,
  ].join('\n');

  const path = [
    `${ICONS.dao} **Đường tu vi 10 cảnh giới:**`,
    '⚪ Phàm Nhân → 🌬️ Luyện Khí → 🔵 Trúc Cơ → 🟡 Kim Đan → 🟣 Nguyên Anh',
    '→ 🔥 Hóa Thần → ☯️ Luyện Hư → 🌟 Hợp Thể → 💎 Đại Thừa → ⚡ Độ Kiếp',
  ].join('\n');

  return themedEmbed('info', {
    title: '🌅 Chào mừng tân đệ tử',
    description: [hero, DIVIDER, quickStart, DIVIDER, path].join('\n\n'),
    footer: 'Radiant Tech Sect — Đường tu là đường tự rèn',
  })
    .setAuthor({
      name: member.displayName,
      iconURL: member.user.displayAvatarURL({ size: 128 }),
    })
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }));
}

function buildQuickStartDm(): string {
  return [
    '🏯 **Chào mừng đến Radiant Tech Sect!**',
    '',
    'Đây là Discord server cho cộng đồng tech — leveling theo theme tu tiên (Phàm Nhân → Tiên Nhân).',
    '',
    '**Lệnh hữu ích:**',
    '• `/daily` — điểm danh hằng ngày (+100 XP, streak bonus ở ngày 7/14/30)',
    '• `/rank` — xem cấp độ + cảnh giới',
    '• `/leaderboard` — top 10',
    '',
    '**Earn XP tự động:**',
    '• Message: 15–25 XP, cooldown 60s, ≥ 5 ký tự (không tính emoji)',
    '• Voice: 10/phút (15 ở Focus Room), cần ≥ 2 người',
    '• Reaction người khác nhận được: 2 XP cho người được react',
    '',
    'Đột phá cảnh giới (level 1, 10, 20, ...) tự động đổi role + announce ở `#level-up`.',
    '',
    '_Chúc tu hành thuận lợi._',
  ].join('\n');
}

function buildReturningEmbed(member: GuildMember): EmbedBuilder {
  // Pull stats from store so the message references real progress.
  const user = getStore().users.get(member.id);
  const rankInfo = (() => {
    if (!user) return null;
    try {
      const r = rankById(user.cultivation_rank);
      const icon = RANK_ICONS[user.cultivation_rank] ?? '⭐';
      return { name: r.name, icon, level: user.level, xp: user.xp };
    } catch {
      return null;
    }
  })();

  const hero = [
    `${ICONS.sparkle} ${member} đã quay lại **Radiant Tech Sect** ${ICONS.sparkle}`,
    '',
    rankInfo
      ? `${rankInfo.icon} Cảnh giới **${rankInfo.name}** · Level **${rankInfo.level}** · ${rankInfo.xp.toLocaleString('vi-VN')} XP được bảo toàn`
      : '_Tu vi của đạo hữu được tông môn lưu giữ._',
    '*Đường tu chưa từng đứt — tiếp tục là được.*',
  ].join('\n');

  return themedEmbed('success', {
    title: '🌅 Đệ tử quay về',
    description: [
      hero,
      DIVIDER,
      `${ICONS.aki_happy} Aki đã miễn captcha cho đạo hữu. Welcome back!`,
    ].join('\n\n'),
    footer: 'Radiant Tech Sect — Đường tu là đường tự rèn',
  })
    .setAuthor({
      name: member.displayName,
      iconURL: member.user.displayAvatarURL({ size: 128 }),
    })
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }));
}

export interface WelcomeOptions {
  /** True when the member is a previously-verified returner (A1, Phase 11). */
  returning?: boolean;
}

/**
 * Post welcome embed in `#general` (fallback `#introductions`) and DM
 * the quick-start guide. Both best-effort. For returners (opts.returning
 * true), skips DM and uses the shorter returning-disciple embed.
 */
export async function postWelcome(member: GuildMember, opts: WelcomeOptions = {}): Promise<void> {
  const channel =
    findChannelByName(member, WELCOME_CHANNEL) ?? findChannelByName(member, INTRODUCTIONS_CHANNEL);

  if (channel) {
    try {
      await channel.send({
        content: `${member}`,
        embeds: [opts.returning ? buildReturningEmbed(member) : buildWelcomeEmbed(member)],
        allowedMentions: { users: [member.id] },
      });
    } catch (err) {
      logger.warn(
        { err, discord_id: member.id, returning: !!opts.returning },
        'welcome: channel post failed',
      );
    }
  } else {
    logger.warn(
      { guild: member.guild.id, expected: [WELCOME_CHANNEL, INTRODUCTIONS_CHANNEL] },
      'welcome: no welcome channel found',
    );
  }

  if (opts.returning) return; // returners already know the server, skip DM
  try {
    await member.send(buildQuickStartDm());
  } catch {
    // ignore — verification already confirmed they can be DMed if they passed
    // through DM, but settings may differ for non-bot DMs.
  }
}

// Exposed for tests.
export const __for_testing = {
  WELCOME_CHANNEL,
  INTRODUCTIONS_CHANNEL,
  ANNOUNCEMENT_CHANNELS,
};
