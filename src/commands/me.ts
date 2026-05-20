import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import { rankById, rankIndex } from '../config/cultivation.js';
import { getTitle } from '../config/titles.js';
import { HUB_ICONS, RANK_ICONS } from '../config/ui.js';
import { getStore } from '../db/index.js';
import { resolveEquippedSlots } from '../modules/combat/equipment-resolver.js';
import { computeCombatPowerBreakdown } from '../modules/combat/power.js';

/**
 * /me — Phase 14.8 personalized hub.
 *
 * Bill 2026-05-20: "33 commands quá nhiều cho user nhớ". /help is the
 * full discovery menu; /me is the "what next" suggestion engine.
 *
 * Logic — surface 3-4 suggested next actions based on current progress:
 *   - new account (Lv 0)          → /daily, /tutorial, /quest
 *   - low rank + no CP equipped   → /shop, /inventory
 *   - mid rank no weapon          → /arena forge, /weapon list
 *   - has unspent stat points     → /stat-alloc
 *   - daily streak about to break → /daily nudge
 *   - eligible for breakthrough   → /breakthrough
 *   - has títulos to display      → /danh-hieu equip nudge
 *   - high-rank + ready for duel  → /duel
 *
 * Compact embed — current state at top, 3-4 numbered suggestions below.
 * Cosmetically uses HUB_ICONS (cosmic + alchemy) for the section dividers
 * per Bill's "icon ngầu hơn" request.
 */

interface Suggestion {
  emoji: string;
  cmd: string;
  reason: string;
}

function nextSuggestions(userId: string): Suggestion[] {
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) {
    return [
      { emoji: HUB_ICONS.start, cmd: '/daily', reason: 'Điểm danh nhận 100 XP đầu tiên.' },
      { emoji: '📜', cmd: '/tutorial', reason: 'Đọc hướng dẫn 5 trang.' },
    ];
  }

  const suggestions: Suggestion[] = [];
  const slots = resolveEquippedSlots(userId);
  const lastDaily = user.last_daily_at ?? 0;
  const hoursAgo = (Date.now() - lastDaily) / (60 * 60 * 1000);

  // 1. Daily check — if >20h since last daily, nudge
  if (hoursAgo >= 20) {
    suggestions.push({
      emoji: '☀',
      cmd: '/daily',
      reason: lastDaily === 0 ? 'Chưa điểm danh hôm nay → +100 XP.' : 'Sắp mất streak — claim ngay.',
    });
  }

  // 2. Stat points unspent
  const unspent = user.stat_points_unspent ?? 0;
  if (unspent > 0) {
    suggestions.push({
      emoji: HUB_ICONS.diamond,
      cmd: '/stat-alloc',
      reason: `Còn **${unspent} điểm chỉ số** chưa phân — vào ngay để tăng LC.`,
    });
  }

  // 3. New user — no công pháp owned
  const ownedCpCount = store.userCongPhap.query((uc) => uc.discord_id === userId).length;
  if (ownedCpCount === 0 && user.level >= 1) {
    suggestions.push({
      emoji: HUB_ICONS.gear,
      cmd: '/shop',
      reason: 'Chưa có công pháp nào — vào shop tab 📜 mua món đầu tiên.',
    });
  }

  // 4. No weapon forged
  const ownedWeapons = store.userWeapons.query((w) => w.discord_id === userId).length;
  if (ownedWeapons === 0) {
    suggestions.push({
      emoji: HUB_ICONS.combat,
      cmd: '/arena forge',
      reason: 'Chưa có vũ khí bản mệnh — rèn 1 trong 6 mạch theo Discord ID.',
    });
  }

  // 5. Multi-slot CP available but underused (rank Trúc Cơ+ but <2 equipped)
  const equippedCpCount = slots.congPhap.length;
  if (rankIndex(user.cultivation_rank) >= rankIndex('truc_co') && equippedCpCount < 2 && ownedCpCount >= 2) {
    suggestions.push({
      emoji: HUB_ICONS.path,
      cmd: '/inventory',
      reason: `Mới đeo ${equippedCpCount} công pháp — bạn có thể đeo tối đa 5 slot.`,
    });
  }

  // 6. Breakthrough ready (Lv 10+)
  if (user.level >= 10 && hoursAgo >= 24) {
    suggestions.push({
      emoji: '🌩',
      cmd: '/breakthrough',
      reason: `Lv ${user.level} — đột phá thiên kiếp lấy +500 XP + 5 đan dược.`,
    });
  }

  // 7. Quest pending
  const dayStart = Date.now() - (Date.now() % (24 * 60 * 60 * 1000));
  const currentQuest = store.dailyQuests
    .query((q) => q.discord_id === userId && q.assigned_at >= dayStart && q.completed_at === null)
    .sort((a, b) => b.assigned_at - a.assigned_at)[0];
  if (currentQuest && currentQuest.progress < currentQuest.target) {
    suggestions.push({
      emoji: '📅',
      cmd: '/quest',
      reason: `Quest đang dở: ${currentQuest.progress}/${currentQuest.target} (+${currentQuest.reward_xp} XP khi xong).`,
    });
  }

  // 8. Has titles but none equipped
  const ownedTitles = store.userTitles.query((t) => t.discord_id === userId);
  if (ownedTitles.length > 0 && !user.equipped_title_id) {
    suggestions.push({
      emoji: '🎖',
      cmd: '/danh-hieu',
      reason: `Có ${ownedTitles.length} danh hiệu nhưng chưa trang bị — hiển thị trong /stat.`,
    });
  }

  // Cap at 4 suggestions for tidy UI
  return suggestions.slice(0, 4);
}

export const data = new SlashCommandBuilder()
  .setName('me')
  .setDescription('Hub cá nhân — trạng thái hiện tại + gợi ý "nên làm gì tiếp"')
  .setDMPermission(false);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const store = getStore();
  const user = store.users.get(userId);

  if (!user) {
    const embed = new EmbedBuilder()
      .setColor(0xb09bd3)
      .setTitle(`${HUB_ICONS.start} Chào tân đệ tử!`)
      .setDescription(
        [
          'Bạn chưa có user record. Hãy:',
          '',
          '1. Chat vài câu trong server (chat tự tạo record)',
          '2. Chạy `/daily` để nhận XP đầu tiên',
          '3. Đọc `/tutorial` để biết flow toàn cục',
        ].join('\n'),
      );
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  const rank = rankById(user.cultivation_rank);
  const rankIcon = RANK_ICONS[user.cultivation_rank] ?? '⭐';
  const slots = resolveEquippedSlots(userId);
  const cp = computeCombatPowerBreakdown(user, slots.congPhap, slots.phapKhi, slots.nhan, slots.weapon);
  const member = await interaction.guild?.members.fetch(userId).catch(() => null);
  const displayName = member?.displayName ?? interaction.user.username;
  const title = user.equipped_title_id ? getTitle(user.equipped_title_id) : null;

  const stateLines: string[] = [
    `${rankIcon} **${rank.name}** · Lv ${user.level} · ${user.xp.toLocaleString('vi-VN')} XP`,
    `${HUB_ICONS.combat} Lực chiến: **${cp.total.toLocaleString('vi-VN')}**`,
    `💊 ${user.pills ?? 0} đan · 🪙 ${(user.contribution_points ?? 0).toLocaleString('vi-VN')} cống hiến · 🔥 streak ${user.daily_streak} ngày`,
  ];
  if (title) {
    stateLines.push(`🎖 Danh hiệu: ${title.emoji} **${title.name}**`);
  }

  const suggestions = nextSuggestions(userId);
  const suggestionLines = suggestions.length
    ? suggestions.map((s, i) => `**${i + 1}.** ${s.emoji} \`${s.cmd}\` — ${s.reason}`)
    : ['_Mọi thứ đã chạy mượt — đi /duel hoặc thử /shop xem có gì mới._'];

  const embed = new EmbedBuilder()
    .setColor(Number.parseInt(rank.colorHex.slice(1), 16))
    .setTitle(`${HUB_ICONS.path} ${displayName}`)
    .setDescription(
      [
        stateLines.join('\n'),
        '',
        `${HUB_ICONS.sparkle_alt} **Gợi ý kế:**`,
        ...suggestionLines,
        '',
        `_${HUB_ICONS.diamond} Dùng \`/help\` để xem toàn bộ lệnh theo mục._`,
      ].join('\n'),
    )
    .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: `Trạng thái cá nhân · Phase 14.8 hub` });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

export const command = { data, execute };
export default command;
