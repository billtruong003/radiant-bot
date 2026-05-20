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
import { HUB_ICONS } from '../config/ui.js';

/**
 * /help — Phase 14.8 task-based hub.
 *
 * Bill 2026-05-20: "33 commands quá nhiều cho user nhớ". Old /help was a
 * flat list. This redesign groups by USE CASE not by feature area:
 *
 *   1. 🌌 Khởi đạo       — "I'm new, what now?"
 *   2. ☯ Tu vi          — "Manage my rank + XP"
 *   3. ⚜ Trang bị        — "Equipment + shop"
 *   4. ⚔ Combat          — "PvP + Arena"
 *   5. 🔮 Aki AI         — "Talk to bot characters"
 *   6. ⚖ Admin           — staff-only utilities
 *
 * Each page shows commands with concrete USE CASE phrasing + a typical
 * example invocation. Button row: ◀ · 🏠 Home · ▶ · 🔍 Tìm.
 *
 * Home page is page 0 — task picker matrix with one-line teaser per
 * category. Lets new users land on a friendly menu instead of a wall
 * of slash names.
 */

const COLLECTOR_TIMEOUT_MS = 10 * 60 * 1000;

interface CommandRow {
  cmd: string;
  use_case: string;
}

interface Page {
  emoji: string;
  title: string;
  color: number;
  intro: string;
  rows: CommandRow[];
}

const PAGES: readonly Page[] = [
  // Page 0 — Home
  {
    emoji: '🏠',
    title: 'Trang chủ — chọn việc cần làm',
    color: 0xb09bd3,
    intro: 'Click button bên dưới để mở từng mục. Mỗi mục gom các lệnh theo mục đích sử dụng.',
    rows: [
      { cmd: `${HUB_ICONS.start} Khởi đạo`, use_case: 'Đệ tử mới? Bắt đầu từ đây.' },
      { cmd: `${HUB_ICONS.path} Tu vi`, use_case: 'Cảnh giới, chỉ số, phong hiệu.' },
      { cmd: `${HUB_ICONS.gear} Trang bị`, use_case: 'Shop + inventory + cường hóa.' },
      { cmd: `${HUB_ICONS.combat} Combat`, use_case: 'PvP duel + Arena + bán đồ.' },
      { cmd: `${HUB_ICONS.aki} Aki AI`, use_case: 'Hỏi đáp với Aki / Akira / Meifeng.' },
      { cmd: `${HUB_ICONS.admin} Admin`, use_case: 'Công cụ staff (🛡️ only).' },
    ],
  },
  // Page 1 — Khởi đạo
  {
    emoji: HUB_ICONS.start,
    title: 'Khởi đạo — mới bắt đầu',
    color: 0xf5d76e,
    intro: 'Đệ tử nhập môn nên làm thứ tự: tutorial → daily → quest → /stat xem mình ở đâu.',
    rows: [
      { cmd: '/tutorial', use_case: 'Hướng dẫn 5 trang button — đọc trước hết.' },
      { cmd: '/daily', use_case: 'Điểm danh nhận 100 XP + streak bonus + 2 đan dược.' },
      { cmd: '/quest', use_case: 'Xem nhiệm vụ hôm nay, hoàn thành → thưởng.' },
      { cmd: '/rank', use_case: 'Xem level + cảnh giới + XP đến mốc kế.' },
      { cmd: '/me', use_case: 'Tóm tắt nhanh + gợi ý "bước kế nên làm gì".' },
    ],
  },
  // Page 2 — Tu vi
  {
    emoji: HUB_ICONS.path,
    title: 'Tu vi — cảnh giới & chỉ số',
    color: 0x9ec1c4,
    intro: 'Quản lý sự tu hành: lực chiến, phân điểm, đột phá, danh hiệu.',
    rows: [
      { cmd: '/stat [user?]', use_case: 'Combat profile — LC breakdown + danh hiệu + progress.' },
      { cmd: '/stat-alloc', use_case: 'Phân điểm DMG/HP/DEF/SPD — mỗi level cộng 2 điểm.' },
      { cmd: '/breakthrough', use_case: 'Khởi thiên kiếp đột phá (Lv 10+, tốn 1 đan dược).' },
      { cmd: '/leaderboard [mode]', use_case: 'Top 10 theo XP hoặc lực chiến.' },
      { cmd: '/title list|add|remove', use_case: 'Sub-title (Kiếm Tu / Đan Sư / Trận Pháp Sư / Tán Tu).' },
      { cmd: '/danh-hieu', use_case: 'Honor titles auto-earn — equip vào /stat.' },
    ],
  },
  // Page 3 — Trang bị
  {
    emoji: HUB_ICONS.gear,
    title: 'Trang bị — shop & inventory',
    color: 0xf4d03f,
    intro: '/inventory là trung tâm: 5 tab quản lý mọi trang bị. /shop là nơi mua. Còn lại là CRUD chi tiết.',
    rows: [
      { cmd: '/inventory', use_case: '⭐ Hub: 5 tab, click toggle equip. Bắt đầu từ đây.' },
      { cmd: '/shop', use_case: '4 tab mua: 📜 CP · ⚔️ Vũ khí · ✨ Pháp khí · 💍 Nhẫn.' },
      { cmd: '/cong-phap upgrade <slug>', use_case: 'Cường hóa công pháp (autocomplete chỉ show owned).' },
      { cmd: '/weapon upgrade <slug>', use_case: 'Cường hóa vũ khí (RNG fail có thể tụt cấp).' },
      { cmd: '/phap-khi upgrade <slug>', use_case: 'Cường hóa pháp khí (single slot, Kim Đan unlock).' },
      { cmd: '/nhan equip|unequip <slug>', use_case: 'Quản lý nhẫn — 1 slot free, slot 2 từ Nguyên Anh.' },
    ],
  },
  // Page 4 — Combat
  {
    emoji: HUB_ICONS.combat,
    title: 'Combat — PvP & arena',
    color: 0xe74c3c,
    intro: 'Duel xen kẽ Arena game. Miểu sát khi cảnh giới chênh ≥ 2 — instant kill.',
    rows: [
      { cmd: '/duel @opponent [stake?]', use_case: '5 hiệp PvP. Cách 2 cảnh giới = miểu sát instant.' },
      { cmd: '/arena forge', use_case: 'Rèn bản mệnh khí — 1 trong 6 template theo Discord ID.' },
      { cmd: '/arena status', use_case: 'Kiểm trạng thái arena server.' },
      { cmd: '/trade sell <slug>', use_case: 'Bán công pháp lấy 50-100% pills refund.' },
    ],
  },
  // Page 5 — Aki AI
  {
    emoji: HUB_ICONS.aki,
    title: 'Aki AI — hỏi đáp NPC',
    color: 0xff8fb1,
    intro: '3 NPC voice khác nhau. Aki sass-helpful, Akira formal-scholar, Meifeng combat-sass.',
    rows: [
      { cmd: '/ask <question> [image?]', use_case: 'Hỏi Aki — hầu gái mặc định.' },
      { cmd: '/ask-akira <question>', use_case: 'Hỏi Akira — học giả kiên nhẫn.' },
      { cmd: '/ask-meifeng <question>', use_case: 'Hỏi Meifeng — kiếm sĩ thẳng tính.' },
      { cmd: '/aki-memory', use_case: 'Toggle bật/tắt Aki nhớ 3 câu hỏi gần (opt-in).' },
      { cmd: '/contribute-doc <title> <body>', use_case: 'Submit document — Aki LLM tự duyệt + tag.' },
    ],
  },
  // Page 6 — Admin
  {
    emoji: HUB_ICONS.admin,
    title: 'Admin — staff utilities',
    color: 0x9c3848,
    intro: 'Chỉ Chưởng Môn / Trưởng Lão / Chấp Pháp. Other thấy "permission denied".',
    rows: [
      { cmd: '/stats', use_case: 'Dashboard 24h: members, automod hits, Aki cost.' },
      { cmd: '/grant currency:pills|contribution|xp', use_case: 'Cấp/trừ currency hoặc XP cho user.' },
      { cmd: '/thien-dao @user <crime>', use_case: 'Chưởng Môn ONLY — LLM tự chọn hình phạt.' },
      { cmd: '/raid-mode on|off', use_case: 'Hard captcha cho mọi join (anti-raid).' },
      { cmd: '/automod-config', use_case: 'Xem cấu hình automod hiện tại.' },
      { cmd: '/link-whitelist add|remove|list', use_case: 'Quản lý whitelist domain runtime.' },
      { cmd: '/sync-pinned', use_case: 'Re-post canonical pinned messages.' },
      { cmd: '/verify-test', use_case: 'Test captcha flow trên chính bạn (dev).' },
    ],
  },
];

function buildEmbed(pageIdx: number): EmbedBuilder {
  const p = PAGES[pageIdx] ?? PAGES[0];
  if (!p) throw new Error('help: no pages');

  const lines = p.rows.map((r) => `${HUB_ICONS.diamond} \`${r.cmd}\` — ${r.use_case}`);

  return new EmbedBuilder()
    .setColor(p.color)
    .setTitle(`${p.emoji} ${p.title}`)
    .setDescription([`_${p.intro}_`, '', ...lines].join('\n'))
    .setFooter({
      text:
        pageIdx === 0
          ? `${PAGES.length - 1} mục · Click button bên dưới · Idle 10 phút`
          : `Trang ${pageIdx}/${PAGES.length - 1} · ◀ ▶ điều hướng · 🏠 trở về home`,
    });
}

function buildButtons(pageIdx: number, userId: string): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  // Row 1 — section shortcuts (jump direct to any page)
  const sectionRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`help:page:1:${userId}`)
      .setEmoji(HUB_ICONS.start)
      .setLabel('Khởi đạo')
      .setStyle(pageIdx === 1 ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(pageIdx === 1),
    new ButtonBuilder()
      .setCustomId(`help:page:2:${userId}`)
      .setEmoji(HUB_ICONS.path)
      .setLabel('Tu vi')
      .setStyle(pageIdx === 2 ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(pageIdx === 2),
    new ButtonBuilder()
      .setCustomId(`help:page:3:${userId}`)
      .setEmoji(HUB_ICONS.gear)
      .setLabel('Trang bị')
      .setStyle(pageIdx === 3 ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(pageIdx === 3),
    new ButtonBuilder()
      .setCustomId(`help:page:4:${userId}`)
      .setEmoji(HUB_ICONS.combat)
      .setLabel('Combat')
      .setStyle(pageIdx === 4 ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(pageIdx === 4),
    new ButtonBuilder()
      .setCustomId(`help:page:5:${userId}`)
      .setEmoji(HUB_ICONS.aki)
      .setLabel('Aki')
      .setStyle(pageIdx === 5 ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(pageIdx === 5),
  );
  // Row 2 — nav controls
  const navRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`help:nav:prev:${userId}`)
      .setEmoji('◀')
      .setLabel('Trước')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageIdx === 0),
    new ButtonBuilder()
      .setCustomId(`help:nav:home:${userId}`)
      .setEmoji('🏠')
      .setLabel('Trang chủ')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(pageIdx === 0),
    new ButtonBuilder()
      .setCustomId(`help:page:6:${userId}`)
      .setEmoji(HUB_ICONS.admin)
      .setLabel('Admin')
      .setStyle(pageIdx === 6 ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(pageIdx === 6),
    new ButtonBuilder()
      .setCustomId(`help:nav:next:${userId}`)
      .setEmoji('▶')
      .setLabel('Tiếp')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageIdx === PAGES.length - 1),
  );
  return [sectionRow, navRow];
}

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Hub điều hướng theo task — chọn việc cần làm, button nav')
  .setDMPermission(false);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  let pageIdx = 0;

  const msg = (await interaction.reply({
    embeds: [buildEmbed(pageIdx)],
    components: buildButtons(pageIdx, userId),
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
    if (parts[1] === 'page' && parts[2]) {
      const idx = Number.parseInt(parts[2], 10);
      if (!Number.isNaN(idx) && idx >= 0 && idx < PAGES.length) {
        pageIdx = idx;
      }
    } else if (parts[1] === 'nav') {
      if (parts[2] === 'prev' && pageIdx > 0) pageIdx--;
      else if (parts[2] === 'next' && pageIdx < PAGES.length - 1) pageIdx++;
      else if (parts[2] === 'home') pageIdx = 0;
    }
    await btn.update({
      embeds: [buildEmbed(pageIdx)],
      components: buildButtons(pageIdx, userId),
    });
  });

  collector.on('end', async () => {
    try {
      await msg.edit({
        embeds: [
          buildEmbed(pageIdx).setFooter({ text: '⏱️ Hết phiên — chạy /help lại để tiếp.' }),
        ],
        components: [],
      });
    } catch {
      /* ephemeral dismissed */
    }
  });
}

export const command = { data, execute };
export default command;
