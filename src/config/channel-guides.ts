/**
 * Manifest of per-channel pinned guide embeds. Used by
 * `npm run bot -- pin-channel-guides` (one-time / re-runnable
 * idempotently).
 *
 * Per Bill's Phase 9 polish ask: every member-facing channel needs a
 * pinned VN-language card explaining its purpose + relevant commands +
 * examples. Admin-only channels (#bot-log, #elder-lounge) are skipped.
 *
 * Each entry's `title` is the idempotency key — the script looks for
 * an existing pinned bot message with the same embed title and edits
 * it instead of posting a new one.
 */

export interface ChannelGuide {
  /** Channel name to post in. */
  channel: string;
  title: string;
  /** Hex color (0x...). Pick a vibe that matches the channel theme. */
  color: number;
  /** Multi-paragraph description. Each entry is one line in the embed. */
  body: readonly string[];
  /** Footer text — also used as a stable marker for idempotency. */
  footer?: string;
}

export const CHANNEL_GUIDES: readonly ChannelGuide[] = [
  {
    channel: 'rules',
    title: '📜 Nội quy Radiant Tech Sect',
    color: 0xe74c3c,
    body: [
      '**Quy tắc tu tâm:**',
      '1. Tôn trọng đồng môn — không công kích cá nhân, kỳ thị, hoặc spam.',
      '2. Giao tiếp văn minh — automod sẽ tự xoá ngôn từ thô tục.',
      '3. Không quảng cáo — link ngoài whitelist sẽ bị xoá.',
      '4. Không spam — gửi cùng nội dung ≥ 5 lần trong 5 phút sẽ bị timeout.',
      '5. Caps lock vừa phải — > 70% chữ in hoa sẽ bị xoá.',
      '',
      '**Quy tắc tu vi:**',
      '• Mỗi member bắt đầu là **Phàm Nhân** (Level 0) — kiếm XP để đột phá.',
      '• Cấm sử dụng bot/script để farm XP.',
      '• Cấm dùng nhiều tài khoản — phát hiện = ban toàn bộ.',
      '',
      '**Vi phạm sẽ bị:** xoá tin nhắn → warn DM → timeout → kick → ban (tuỳ mức độ).',
    ],
    footer: 'Vi phạm? Báo cho Chấp Pháp hoặc Trưởng Lão.',
  },
  {
    channel: 'verify',
    title: '🔒 Xác minh tài khoản',
    color: 0x5dade2,
    body: [
      'Sau khi vào server, bạn sẽ **nhận DM từ bot** với câu đố toán hoặc captcha ảnh.',
      '',
      '**Cách xác minh:**',
      '• Bot DM: trả lời con số / dòng chữ trong DM.',
      '• Nếu DM bị chặn: bấm nút **🔓 Bắt đầu xác minh** trong kênh này.',
      '',
      '⏱️ Thời gian: **5 phút**. Tối đa **3 lần thử**.',
      '',
      'Xác minh thành công → nhận role **Phàm Nhân** + được truy cập toàn server.',
      'Thất bại / hết hạn → kick (có thể vào lại để thử tiếp).',
    ],
    footer: 'DM bị chặn? Mở Privacy Settings → Direct Messages → Allow from server.',
  },
  {
    channel: 'general',
    title: '💬 Phòng chat chung',
    color: 0x95a5a6,
    body: [
      'Khu giao lưu chính của tông môn. Mọi chủ đề đều được, miễn là tuân theo `#rules`.',
      '',
      '**Earn XP khi chat ở đây:**',
      '• **15-25 XP** mỗi tin nhắn',
      '• Cooldown **60 giây** giữa các lần earn',
      '• Tin nhắn ≥ 5 ký tự (không tính emoji)',
      '',
      '**Lệnh nhanh:**',
      '• `/rank` — xem cấp độ + tiến độ',
      '• `/daily` — điểm danh hằng ngày (+100 XP)',
      '• `/leaderboard` — top 10',
    ],
  },
  {
    channel: 'introductions',
    title: '👋 Giới thiệu bản thân',
    color: 0x5dade2,
    body: [
      'Mới gia nhập? Giới thiệu một chút để mọi người làm quen!',
      '',
      '**Template gợi ý:**',
      '```',
      'Tên: ',
      'Đến từ: ',
      'Tech stack / sở thích: ',
      'Mục tiêu trên server: ',
      '```',
      '',
      'Không bắt buộc — chỉ là để cộng đồng dễ kết nối hơn.',
    ],
  },
  {
    channel: 'daily-checkin',
    title: '🌅 Điểm danh hằng ngày',
    color: 0xf4d03f,
    body: [
      'Dùng `/daily` mỗi ngày để nhận **+100 XP** + bonus streak:',
      '',
      '• Streak **7 ngày** liên tục: **+50 XP** bonus',
      '• Streak **14 ngày**: **+150 XP** bonus',
      '• Streak **30 ngày**: **+500 XP** bonus',
      '',
      '⚠️ Bỏ 1 ngày là streak reset về **1**. Lịch reset là **00:00 giờ VN**.',
      '',
      '_Chăm chỉ là gốc của tu vi._',
    ],
  },
  {
    channel: 'leveling-guide',
    title: '⚡ Hướng dẫn tu vi — Cảnh giới',
    color: 0x9b59b6,
    body: [
      '**10 cảnh giới tu vi (Phàm Nhân → Độ Kiếp) + Tiên Nhân (admin grant):**',
      '',
      '🩶 **Phàm Nhân** (Level 0) — khởi đầu sau xác minh',
      '⚪ **Luyện Khí** (Level 1-9) — khởi đầu tu vi, có thêm reactions',
      '🔵 **Trúc Cơ** (Level 10-19) — dùng external emoji, embed links',
      '🟡 **Kim Đan** (Level 20-34) — tạo public threads',
      '🟣 **Nguyên Anh** (Level 35-49) — tạo private threads, attach files',
      '🔴 **Hoá Thần** (Level 50-69) — priority speaker, external stickers',
      '🟢 **Luyện Hư** (Level 70-89) — quản lý tin nhắn của chính mình',
      '🟠 **Hợp Thể** (Level 90-119) — trusted, có thể được đề cử Trưởng Lão',
      '⚪ **Đại Thừa** (Level 120-159) — custom title flair, custom emoji',
      '🥇 **Độ Kiếp** (Level 160+) — đỉnh tu vi, có thể vote Trưởng Lão',
      '👑 **Tiên Nhân** — admin-grant only',
      '',
      '**XP earning rates:**',
      '• Message: 15-25 XP (cooldown 60s, ≥ 5 chars không tính emoji)',
      '• Voice ≥ 2 người: 10 XP/phút (15 XP/phút ở Focus Room / Quiet Study)',
      '• Reaction người khác nhận: 2 XP cho người bị react (max 10/message)',
      '• /daily: 100 XP + streak bonuses',
      '• Tribulation pass: 500 XP · fail: -100 XP (sàn ở ngưỡng cảnh giới)',
      '',
      '**Sub-titles (phong hiệu phụ):**',
      '⚔️ Kiếm Tu · 🧪 Đan Sư · 🔮 Trận Pháp Sư · 🌀 Tán Tu',
      'Dùng `/title add|remove|list` để quản lý.',
    ],
    footer: 'Đột phá cảnh giới tự động khi level đủ — role swap + announce ở #level-up.',
  },
  {
    channel: 'leaderboard',
    title: '🏆 Bảng xếp hạng',
    color: 0xffd700,
    body: [
      'Top 10 đệ tử có XP cao nhất.',
      '',
      '**Lệnh:**',
      '• `/leaderboard` — top 10 all-time',
      '• `/leaderboard period:weekly` — top 10 tuần này',
      '',
      '**Tự động post:** Bot post bảng xếp hạng tuần vào **Chủ Nhật 20:00 giờ VN**.',
    ],
  },
  {
    channel: 'tribulation',
    title: '⚡ Độ Kiếp — Thiên Kiếp giáng lâm',
    color: 0x9b59b6,
    body: [
      'Mini-game vượt **Thiên Kiếp** cho đệ tử **Level ≥ 10**.',
      '',
      '**Hai loại bài thử (random):**',
      '🧮 **Math puzzle** — câu đố toán 4 lựa chọn, **30 giây**',
      '🐉 **Reaction speed** — bấm vào Thiên Long (🐉) trong 5 emoji, **5 giây**',
      '',
      '**Phần thưởng:**',
      '• Pass: **+500 XP**',
      '• Fail / Timeout: **-100 XP** (sàn không xuống dưới ngưỡng cảnh giới)',
      '',
      '**Trigger:**',
      '• Random: Bot có **25% khả năng** trigger vào **18:00 giờ VN** mỗi ngày, pick 1 đệ tử eligible.',
      '• Manual: dùng `/breakthrough` (cooldown 24h server-wide).',
    ],
    footer: 'Sàn XP nghĩa là: thua không bao giờ rớt cảnh giới đã đạt.',
  },
  {
    channel: 'bot-commands',
    title: '🤖 Danh sách lệnh',
    color: 0x3498db,
    body: [
      '**Member commands (ai cũng dùng được):**',
      '• `/rank [user?]` — xem cấp độ + tiến độ + cảnh giới',
      '• `/leaderboard [period?=all|weekly]` — top 10',
      '• `/daily` — điểm danh hằng ngày (+100 XP, streak bonus)',
      '• `/title add|remove|list` — quản lý sub-title',
      '• `/breakthrough` — tự khởi Thiên Kiếp (Level ≥ 10, cooldown 24h server-wide)',
      '',
      '**Admin commands (Chưởng Môn / Trưởng Lão):**',
      '• `/raid-mode on|off|status` — toggle raid mode thủ công',
      '• `/automod-config` — xem cấu hình automod',
      '',
      'Kênh này là nơi chính để dùng lệnh — earn XP **tắt** ở đây để không spam.',
    ],
  },
  {
    channel: 'help-me',
    title: '🆘 Cứu trợ kỹ thuật',
    color: 0x3498db,
    body: [
      'Có vấn đề tech? Hỏi ở đây.',
      '',
      '**Mẹo đặt câu hỏi tốt:**',
      '1. **Mô tả vấn đề** — bạn đang làm gì?',
      '2. **Hành vi mong đợi vs. thực tế** — bạn mong đợi điều gì, kết quả thực tế thế nào?',
      '3. **Đã thử gì** — search nào, document nào, code nào đã thử?',
      '4. **Code / log / screenshot** — paste đầy đủ, dùng code block (```).',
      '5. **Stack** — ngôn ngữ, version, OS, etc.',
      '',
      'Câu hỏi tốt = câu trả lời nhanh.',
    ],
    footer: 'XKCD: "How to ask questions the smart way" — nguyên tắc vàng.',
  },
];
