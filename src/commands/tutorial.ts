import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  type Message,
  type MessageActionRowComponentBuilder,
  SlashCommandBuilder,
} from 'discord.js';

/**
 * /tutorial — Phase 14.5 onboarding flow.
 *
 * Five pages, button-navigated, ephemeral. Each page explains one core
 * mechanic so a new disciple can self-orient without reading docs. Tone:
 * warm, theme-consistent (tu tiên xianxia voice), brief.
 *
 * Pages:
 *   1. Welcome + cảnh giới + XP earning paths
 *   2. Daily ritual: /daily + streak + quests
 *   3. Inventory & shop: /shop tabs + /inventory equipment management
 *   4. Combat: /duel + /stat + /stat-alloc
 *   5. Endgame: /weapon upgrade + /phap-khi + /nhan + /danh-hieu
 */

const COLLECTOR_TIMEOUT_MS = 10 * 60 * 1000;

interface Page {
  title: string;
  description: string;
  footer: string;
  color: number;
}

const PAGES: readonly Page[] = [
  {
    title: '🌅 Trang 1/5 — Nhập môn',
    description: [
      'Chào mừng đệ tử tới **Radiant Tech Sect**! Đây là tông môn tu hành xen lẫn lập trình + giao lưu — nơi bạn vừa chat vừa tu vi.',
      '',
      '**Cảnh giới của bạn:**',
      '· Bắt đầu ở **Phàm Nhân** (Lv 0). Lên cấp dần qua: chat (15-25 XP/tin, cooldown 60s), voice chat (10 XP/phút), reaction (2 XP), điểm danh `/daily` (100 XP + streak bonus).',
      '· 10 cảnh giới: Phàm Nhân → Luyện Khí → Trúc Cơ → Kim Đan → Nguyên Anh → Hóa Thần → Luyện Hư → Hợp Thể → Đại Thừa → Độ Kiếp.',
      '· Mỗi mốc cảnh giới mở slot trang bị mới + nhiều shop items hơn.',
      '',
      '**Bước tiếp theo:** chạy `/daily` ngay để claim XP đầu tiên.',
    ].join('\n'),
    footer: 'Trang 1/5 · ◀ Trước · ▶ Tiếp · 🏁 Bỏ qua',
    color: 0xf5d76e,
  },
  {
    title: '📅 Trang 2/5 — Nhật trình mỗi ngày',
    description: [
      'Mỗi ngày bạn nên làm những điều này:',
      '',
      '**`/daily`** — điểm danh 1 lần/ngày. Cộng 100 XP + 5 cống hiến + 2 đan dược. Streak 7/14/30 ngày bonus to.',
      '**`/quest`** — xem nhiệm vụ hôm nay (random 1 trong 10 loại). Hoàn thành → thưởng XP + đan dược + cống hiến.',
      '**`/breakthrough`** — đột phá thiên kiếp khi đủ XP. Pass = +500 XP + 5 pills + rank-up. Fail trừ XP.',
      '',
      '**Tích cực chat** trong các channel General Realm / Tech Innovations / Entertainment để lên cấp tự nhiên. Chat cooldown 60s/tin XP, nhưng quest message_count tính mọi tin nên cứ chat thoải mái.',
    ].join('\n'),
    footer: 'Trang 2/5',
    color: 0x9ec1c4,
  },
  {
    title: '🏪 Trang 3/5 — Cửa hàng & túi đồ',
    description: [
      '**Hai loại tiền tệ:**',
      '· 💊 **Đan dược** — kiếm chủ yếu từ /daily, quest, duel win, tribulation pass',
      '· 🪙 **Cống hiến** — auto-earn 1/10 XP từ chat',
      '',
      '**`/shop`** — cửa hàng 4 tab: 📜 Công pháp · ⚔️ Vũ khí · ✨ Pháp khí · 💍 Nhẫn. Click tab xem catalog, chọn select-menu để mua nhanh.',
      '**`/inventory`** — túi đồ 5 tab: 💰 Tổng (currency + stat overview) · 📜 Công pháp · ⚔️ Vũ khí · ✨ Pháp khí · 💍 Nhẫn. Mỗi tab có select-menu equip.',
      '',
      '**Icon trạng thái shop:**',
      '⭐ đang trang bị · ✅ sở hữu · 🟢 mua được · ⏳ chưa đủ tiền · 🔒 chưa đủ cảnh giới',
    ].join('\n'),
    footer: 'Trang 3/5',
    color: 0xf4d03f,
  },
  {
    title: '⚔️ Trang 4/5 — Combat & chỉ số',
    description: [
      '**`/stat`** — combat profile: lực chiến (LC) breakdown, cảnh giới, currency, equipment, danh hiệu. Hiện cả "mở khoá kế" + "preview cường hóa".',
      '**`/stat-alloc`** — phân điểm chỉ số. Mỗi level cộng 2 điểm; phân vào DMG / HP / DEF / SPD. Reset miễn phí.',
      '**`/duel @opponent stake:N`** — PvP 5 hiệp. Stake 1-10 đan dược. Cooldown 30 phút, 3 trận/ngày.',
      '',
      '**Miểu sát**: cách cảnh giới ≥ 2 → instant kill không cần chấp nhận, không lấy đan dược. Riêng cooldown 24h.',
      '',
      '**Lực chiến** = base 100 + level×5 + rank×30 + sub_title 30 + stat_alloc + sum(công pháp×scale) + pháp khí×scale + nhẫn flat + vũ khí×scale.',
    ].join('\n'),
    footer: 'Trang 4/5',
    color: 0xb09bd3,
  },
  {
    title: '🌟 Trang 5/5 — Endgame: cường hóa & danh hiệu',
    description: [
      'Khi cảnh giới cao, mở những hệ thống này:',
      '',
      '**Cường hóa** — `/cong-phap upgrade`, `/weapon upgrade`, `/phap-khi upgrade`. Mỗi level 0→10. Cost tăng tuyến tính (2+L×3 pills + 200+L×200 cống hiến).',
      '· Công pháp + pháp khí: forgiving curve, fail = giữ nguyên level',
      '· Vũ khí: RNG hardcore — fail ≥ L7 = tụt xuống 1 cấp',
      '',
      '**Multi-slot equipment** (mở dần theo cảnh giới):',
      '· Công pháp slot 1 free → slot 2 Trúc Cơ → slot 3 Hóa Thần',
      '· Pháp khí: Kim Đan',
      '· Nhẫn slot 1 free → slot 2 Nguyên Anh',
      '',
      '**`/danh-hieu`** — honor titles auto-grant theo achievement: thắng N duel, max upgrade item, vượt thiên kiếp, lên cảnh giới Đại Thừa. Trang bị 1 → hiện trong /stat.',
      '',
      '**Sẵn sàng tu hành! Chúc đạo tâm vững vàng.** 🌌',
    ].join('\n'),
    footer: 'Trang 5/5 — hết. Chạy /tutorial lại bất cứ khi nào.',
    color: 0xe6c87e,
  },
];

function buildEmbed(pageIdx: number): EmbedBuilder {
  const p = PAGES[pageIdx] ?? PAGES[0];
  if (!p) throw new Error('tutorial: no pages');
  return new EmbedBuilder()
    .setColor(p.color)
    .setTitle(p.title)
    .setDescription(p.description)
    .setFooter({ text: p.footer });
}

function buildButtons(pageIdx: number, userId: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`tut:prev:${userId}`)
      .setEmoji('◀')
      .setLabel('Trước')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageIdx === 0),
    new ButtonBuilder()
      .setCustomId(`tut:next:${userId}`)
      .setEmoji('▶')
      .setLabel('Tiếp')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(pageIdx === PAGES.length - 1),
    new ButtonBuilder()
      .setCustomId(`tut:close:${userId}`)
      .setEmoji('🏁')
      .setLabel('Bỏ qua')
      .setStyle(ButtonStyle.Secondary),
  );
}

export const data = new SlashCommandBuilder()
  .setName('tutorial')
  .setDescription('Hướng dẫn nhập môn — 5 trang button navigation')
  .setDMPermission(false);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  let pageIdx = 0;

  const msg = (await interaction.reply({
    embeds: [buildEmbed(pageIdx)],
    components: [buildButtons(pageIdx, userId)],
    ephemeral: true,
    fetchReply: true,
  })) as Message;

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (i) => i.user.id === userId,
    idle: COLLECTOR_TIMEOUT_MS,
  });

  collector.on('collect', async (btn) => {
    const parts = btn.customId.split(':');
    if (parts[1] === 'next' && pageIdx < PAGES.length - 1) {
      pageIdx++;
    } else if (parts[1] === 'prev' && pageIdx > 0) {
      pageIdx--;
    } else if (parts[1] === 'close') {
      collector.stop('user-closed');
      return;
    }
    await btn.update({
      embeds: [buildEmbed(pageIdx)],
      components: [buildButtons(pageIdx, userId)],
    });
  });

  collector.on('end', async () => {
    try {
      await msg.edit({
        embeds: [buildEmbed(pageIdx).setFooter({ text: '⏱️ Hết phiên / đóng — chạy /tutorial lại để tiếp.' })],
        components: [],
      });
    } catch {
      /* ephemeral dismissed */
    }
  });
}

export const command = { data, execute };
export default command;
