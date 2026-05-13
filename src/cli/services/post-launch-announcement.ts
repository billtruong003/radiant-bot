import { EmbedBuilder, type TextChannel } from 'discord.js';
import type { BotCliService } from '../service.js';

/**
 * One-time launch announcement for the public opening of the server.
 * Posts a richly-formatted welcome embed to `#announcements` with the
 * feature roll-call. Idempotent: re-runs replace the existing
 * launch-announcement message by edit (matched on embed title).
 *
 * Usage:
 *   npm run bot -- post-launch-announcement --dry-run     # preview
 *   npm run bot -- post-launch-announcement               # post / edit
 *   npm run bot -- post-launch-announcement --channel=X   # override
 */

interface ParsedArgs {
  dryRun: boolean;
  channelName: string;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  let dryRun = false;
  let channelName = 'announcements';
  for (const a of args) {
    if (a === '--dry-run') dryRun = true;
    else if (a.startsWith('--channel=')) channelName = a.slice('--channel='.length);
  }
  return { dryRun, channelName };
}

const TITLE = '🏯 Radiant Tech Sect — Khai Tông';

function buildEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle(TITLE)
    .setDescription(
      [
        '*Tông môn chính thức khai môn lập phái. Chào mừng toàn thể đệ tử gia nhập đường tu.*',
        '',
        '**🎯 Tính năng chính:**',
        '',
        '🔒 **Xác minh tài khoản** — chống bot raid 2 lớp (audit + captcha), tự bật raid mode khi phát hiện spam join.',
        '',
        '⚡ **Tu vi 10 cảnh giới** — từ **Phàm Nhân** lên đến **Độ Kiếp**. Mỗi đột phá tự đổi role + announce ở `#level-up`.',
        '',
        '💬 **Earn XP đa kênh** — message (15-25), voice (10-15/phút), reaction (2/lần), `/daily` (100 + streak bonus 7/14/30 ngày).',
        '',
        '🏆 **Bảng xếp hạng** — `/leaderboard` cho top 10 (all-time hoặc tuần), tự post mỗi Chủ Nhật 20:00.',
        '',
        '🛡️ **Automod** — lọc profanity (VN + EN), spam, mass-mention, link ngoài whitelist, caps-lock. Staff được miễn.',
        '',
        '⚡ **Thiên Kiếp** — mini-game tribulation cho member level ≥ 10, random 18:00 mỗi ngày hoặc tự khởi bằng `/breakthrough`.',
        '',
        '🏷️ **Sub-titles** — pick Kiếm Tu / Đan Sư / Trận Pháp Sư / Tán Tu qua reaction ở `#leveling-guide` hoặc `/title add`.',
        '',
        '**🚀 Bắt đầu thế nào:**',
        '1. Đọc pinned message ở các channel chính (#rules, #leveling-guide, #bot-commands).',
        '2. Dùng `/daily` để nhận 100 XP đầu tiên.',
        '3. Tham gia chat hoặc voice — XP sẽ tự tích lũy.',
        '4. Xem cấp độ + tiến độ với `/rank`.',
        '',
        '**Bot uptime 24/7. Data backed up daily.**',
        '',
        '_Chúc các đệ tử tu hành thuận lợi, sớm ngày đột phá cảnh giới._',
      ].join('\n'),
    )
    .setFooter({ text: 'Radiant Tech Sect — Tu kỹ thuật, luyện trí tuệ' })
    .setTimestamp();
}

export const postLaunchAnnouncement: BotCliService = {
  name: 'post-launch-announcement',
  description: 'Post (or edit-in-place) the public launch announcement in #announcements',
  usage: 'post-launch-announcement [--dry-run] [--channel=<name>]',
  needsClient: true,
  async execute(ctx, args) {
    const g = ctx.guild;
    const c = ctx.client;
    if (!g || !c?.user) throw new Error('post-launch-announcement requires a connected client');
    const parsed = parseArgs(args);

    await g.channels.fetch();
    const channel = g.channels.cache.find(
      (ch) => ch.name === parsed.channelName && ch.isTextBased(),
    ) as TextChannel | undefined;
    if (!channel) {
      throw new Error(`channel "#${parsed.channelName}" not found`);
    }

    const embed = buildEmbed();

    // Find existing launch announcement (matched by title) and edit instead of double-post.
    const pinned = await channel.messages.fetchPinned().catch(() => null);
    const existing = pinned
      ? [...pinned.values()].find(
          (m) => m.author.id === c.user?.id && m.embeds[0]?.data.title === TITLE,
        )
      : undefined;

    const lines: string[] = [
      '',
      `=== post-launch-announcement ${parsed.dryRun ? '(DRY-RUN)' : '(APPLY)'} ===`,
      `Channel  : #${channel.name}`,
      `Existing : ${existing ? `found (message ${existing.id}) — will EDIT + re-pin` : 'none — will POST + pin'}`,
      '',
    ];

    if (parsed.dryRun) {
      lines.push(
        'Preview:',
        '---',
        embed.data.title ?? '',
        '',
        (embed.data.description ?? '').slice(0, 800),
        '...',
        '---',
        '',
      );
      process.stdout.write(lines.join('\n'));
      return;
    }

    if (existing) {
      await existing.edit({ embeds: [embed] });
      lines.push('✏️  Edited existing announcement.');
    } else {
      const sent = await channel.send({ embeds: [embed] });
      await sent.pin('launch announcement');
      lines.push(`✅ Posted + pinned. Message ID: ${sent.id}`);
    }
    lines.push('');
    process.stdout.write(lines.join('\n'));
  },
};
