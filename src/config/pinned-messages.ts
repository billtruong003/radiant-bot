/**
 * Phase 12.6 — Pinned message content for important channels.
 *
 * Each entry has:
 *   - canonicalChannel : canonical channel slug (matched via `matchesChannelName`)
 *   - title            : embed title
 *   - description      : full markdown body (3rd-person, no first-person voice)
 *   - color            : accent color (hex int)
 *   - footer           : embed footer
 *   - reactions        : array of unicode emojis the bot auto-reacts with after pinning
 *
 * Style rules locked by Bill (2026-05-14):
 *   - 3rd person impersonal. NO "tôi", "em", "Aki yêu cầu". Tông môn /
 *     hệ thống / quy tắc speak instead.
 *   - Aesthetic dividers (━━━━━━━━━━━━━━━━━━━━━━━━━━━━).
 *   - Themed emoji palette per channel — varied + clean, not spam.
 *   - Reactions = decorative cluster; aim 4-6 emojis matching the
 *     channel's theme.
 *
 * Sync logic (`src/modules/admin/pinned-sync.ts`) unpins old bot-authored
 * pins in the channel BEFORE posting the new one — so re-running the
 * sync replaces the canonical pin rather than accumulating.
 */

export interface PinnedMessageDef {
  canonicalChannel: string;
  title: string;
  description: string;
  color: number;
  footer: string;
  reactions: readonly string[];
}

const DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

export const PINNED_MESSAGES: readonly PinnedMessageDef[] = [
  // ─────────────────────────────────────────────────────────────────────
  // 📜 RULES
  // ─────────────────────────────────────────────────────────────────────
  {
    canonicalChannel: 'rules',
    title: '📜 Luật Tông Môn — Radiant Tech Sect',
    color: 0xb09bd3, // iris purple
    description: [
      DIVIDER,
      '## 🌸 Tinh Thần Tông Môn',
      '',
      'Radiant Tech Sect là cộng đồng kết hợp **học thuật + giải trí** với theme **tu tiên xianxia**:',
      '',
      '🛠️ Tech · dev · AI · game development · automation · data science',
      '🌌 Tu hành · cảnh giới · lực chiến · công pháp · thiên kiếp',
      '🤝 Tôn trọng · giúp đỡ · học hỏi từ nhau',
      '',
      DIVIDER,
      '## ⚖️ Quy Tắc Cơ Bản',
      '',
      '**1 · Tôn trọng**',
      'Không công kích cá nhân. Không phân biệt chủng tộc · tôn giáo · giới tính · khuyết tật. Mọi đệ tử bình đẳng dưới thiên đạo.',
      '',
      '**2 · Ngôn ngữ văn minh**',
      'Kiềm chế thô tục. Hệ thống tự cảnh báo khi vượt ngưỡng 15 lần trong 60 giây — tin nhắn vi phạm bị thu hồi cùng lịch sử gần đây.',
      '',
      '**3 · Không spam**',
      'Không lặp tin nhắn. Không mass-mention ≥ 6 người. Không gửi link đáng ngờ (URL rút gọn, TLD lạ, IP-only).',
      '',
      '**4 · Đúng kênh**',
      '`#gaming` · `#game-dev` · `#help-me` · `#meme` · `#art` · `#tribulation` — chọn kênh hợp với nội dung. Lạc kênh sẽ bị nhắc.',
      '',
      '**5 · Không quảng cáo**',
      'Server khác · sản phẩm thương mại · Discord invite — đều bị xoá tự động.',
      '',
      '**6 · Tu hành chân chính**',
      'Không grind XP qua spam. Không lạm dụng bot. Daily quest · tribulation · /duel là con đường chính.',
      '',
      '**7 · Bảo mật**',
      'Không share token · credential · API key của bất kỳ ai. Báo cáo lỗ hổng riêng cho Chưởng Môn.',
      '',
      DIVIDER,
      '## 🛡️ Hệ Thống Tự Vệ Của Tông Môn',
      '',
      '⚡ **Thiên Đạo** giám sát mọi tin nhắn — vi phạm sẽ bị cảnh báo / thu hồi / cấm khẩu / trục xuất.',
      '🌩️ **Tribulation** xảy ra ngẫu nhiên 18:00 VN — vượt qua để lên cảnh giới + nhận đan dược.',
      '📋 **Daily quest** reset 00:00 VN — hoàn thành nhận XP + đan dược + cống hiến.',
      '⚖️ **Áp Chế Thiên Đạo** — Chưởng Môn có quyền triệu hồi Thiên Đạo xử phạt riêng khi cần.',
      '',
      DIVIDER,
      '## 🎯 Bắt Đầu Tu Hành',
      '',
      '`/help` — danh sách 28 lệnh đầy đủ',
      '`/rank` — xem cảnh giới + XP hiện tại',
      '`/stat` — combat profile + lực chiến + currency',
      '`/daily` — điểm danh hằng ngày',
      '`/shop` — cửa hàng công pháp',
      '`/quest` — nhiệm vụ hằng ngày',
      '`/ask` — hỏi Aki (AI assistant)',
      '',
      DIVIDER,
      '## 📈 11 Cảnh Giới',
      '',
      '⚪ Phàm Nhân → 🌬️ Luyện Khí → 🔵 Trúc Cơ → 🟡 Kim Đan → 🟣 Nguyên Anh → 🔥 Hóa Thần → ☯️ Luyện Hư → 🌟 Hợp Thể → 💎 Đại Thừa → ⚡ Độ Kiếp → 👑 Tiên Nhân',
      '',
      '_Tiên Nhân chỉ được Chưởng Môn ban — không tự đột phá được._',
      DIVIDER,
      '',
      '_Thiên đạo vô tư · Đạo tâm vạn dặm · Radiant Tech Sect_',
    ].join('\n'),
    footer: 'Luật được giám sát bởi Thiên Đạo · Cập nhật bởi tông môn',
    reactions: ['📜', '⚖️', '🌸', '☯️', '✨'],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 📢 ANNOUNCEMENTS
  // ─────────────────────────────────────────────────────────────────────
  {
    canonicalChannel: 'announcements',
    title: '📢 Bảng Cáo Thị — Tông Môn',
    color: 0xffd56b, // divine sun gold
    description: [
      DIVIDER,
      '## 🔔 Kênh Thông Báo Chính Thức',
      '',
      'Kênh này chỉ chứa thông báo từ **Chưởng Môn · Trưởng Lão · Thiên Đạo** — đệ tử không được phép phát ngôn.',
      '',
      '**Loại thông báo sẽ xuất hiện ở đây**:',
      '',
      '🌟 Sự kiện đặc biệt · sect war · tribulation tập thể',
      '📜 Cập nhật luật tông môn',
      '⚖️ Phán xử quan trọng từ Thiên Đạo',
      '🎁 Phần thưởng cộng đồng · milestone server',
      '🛠️ Bảo trì · cập nhật bot · downtime',
      '',
      DIVIDER,
      '## 🔕 Tắt Thông Báo',
      '',
      'Đệ tử có thể click chuột phải kênh → **Mute** nếu không muốn nhận ping. Mỗi thông báo quan trọng vẫn được ghim — đọc lại lúc nào cũng được.',
      '',
      DIVIDER,
      '',
      '_Vạn pháp tuỳ duyên · Thông tin lưu ở đây · Radiant Tech Sect_',
    ].join('\n'),
    footer: 'Chỉ staff đăng được · Đệ tử đọc thôi',
    reactions: ['📢', '🔔', '✨', '🌸', '⭐'],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 👋 INTRODUCTIONS
  // ─────────────────────────────────────────────────────────────────────
  {
    canonicalChannel: 'introductions',
    title: '👋 Giới Thiệu Bản Thân',
    color: 0x7fa6c5, // river blue
    description: [
      DIVIDER,
      '## 🌸 Cho Cộng Đồng Biết Đạo Hữu Là Ai',
      '',
      'Đây là kênh để **đệ tử mới giới thiệu**, hoặc đệ tử cũ chia sẻ cột mốc mới.',
      '',
      DIVIDER,
      '## 📝 Mẫu Giới Thiệu',
      '',
      '```',
      '🌟 Tên / Nickname:',
      '🎯 Sở thích chính:',
      '   (tech / dev / gaming / art / writing / khác)',
      '🛠️ Đang học / làm gì:',
      '🎮 Sub-title sẽ chọn:',
      '   (Kiếm Tu · Đan Sư · Trận Pháp Sư · Tán Tu)',
      '✨ Mục tiêu trên server:',
      '```',
      '',
      DIVIDER,
      '## 💡 Gợi Ý Cho Đạo Hữu Mới',
      '',
      '1. Đọc `📜-rules` trước để hiểu luật tông môn.',
      '2. Dùng `/help` xem 28 lệnh đầy đủ.',
      '3. `/daily` mỗi ngày để tích XP + đan dược + cống hiến.',
      '4. Sau khi đạt **Trúc Cơ** (Level 10), dùng `/title add` chọn sub-title.',
      '5. Đạt **Trúc Cơ** xong có thể thử `/breakthrough` (cần 1 đan dược).',
      '',
      DIVIDER,
      '',
      '_Đường tu vạn dặm bắt đầu từ hơi thở đầu tiên · Radiant Tech Sect_',
    ].join('\n'),
    footer: 'Welcome đến Radiant Tech Sect ✿',
    reactions: ['👋', '🌸', '✨', '💫', '🤝'],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 📖 LEVELING GUIDE
  // ─────────────────────────────────────────────────────────────────────
  {
    canonicalChannel: 'leveling-guide',
    title: '📖 Cẩm Nang Tu Vi · Leveling Guide',
    color: 0x8fbf9f, // sage jade
    description: [
      DIVIDER,
      '## ⚡ Cách Tích XP',
      '',
      '| Hành động | XP | Điều kiện |',
      '|---|---|---|',
      '| **Tin nhắn** | 15-25 | ≥ 5 ký tự thực, cooldown 60s / user |',
      '| **Voice** | 10 / phút | ≥ 2 người không phải bot, không AFK |',
      '| **Voice (working)** | 15 / phút | Focus Room · Quiet Study |',
      '| **Reaction nhận được** | 2 / react | Max 10 reaction / tin, cooldown 10s / reactor |',
      '| **/daily** | 100 + streak bonus | 1 lần / ngày VN |',
      '| **Tribulation pass** | +500 + 5 đan dược | Cần 1 đan dược để khởi |',
      '| **Tribulation fail** | -100 (floor) | Không demote cảnh giới |',
      '| **Daily quest complete** | 25-100 | Theo loại quest |',
      '',
      DIVIDER,
      '## 📈 11 Cảnh Giới',
      '',
      '| Bậc | Cảnh giới | Level | Quyền lợi đặc biệt |',
      '|---|---|---|---|',
      '| 0 | ⚪ Phàm Nhân | 0 | Sau khi xác minh |',
      '| 1 | 🌬️ Luyện Khí | 1-9 | Thêm phản ứng emoji |',
      '| 2 | 🔵 Trúc Cơ | 10-19 | Dùng emoji ngoài, nhúng liên kết, mở `/title` |',
      '| 3 | 🟡 Kim Đan | 20-34 | Tạo chủ đề công khai |',
      '| 4 | 🟣 Nguyên Anh | 35-49 | Tạo chủ đề riêng tư, đính tập tin |',
      '| 5 | 🔥 Hóa Thần | 50-69 | Người nói ưu tiên, sticker ngoài |',
      '| 6 | ☯️ Luyện Hư | 70-89 | Quản lý tin nhắn của chính mình |',
      '| 7 | 🌟 Hợp Thể | 90-119 | Trusted — có thể được đề cử Nội Môn |',
      '| 8 | 💎 Đại Thừa | 120-159 | Custom title flair · custom emoji react |',
      '| 9 | ⚡ Độ Kiếp | 160+ | Đỉnh cao · có thể vote Trưởng Lão |',
      '| 10 | 👑 Tiên Nhân | — | **Admin grant only** — không tự đột phá |',
      '',
      DIVIDER,
      '## 🌅 Daily Streak Bonus',
      '',
      '🔥 Day 7: **+50 XP** bonus',
      '🔥 Day 14: **+150 XP** + 2 đan dược',
      '🔥 Day 30: **+500 XP** + 10 đan dược',
      '_Miss 1 ngày → streak reset về 1_',
      '',
      DIVIDER,
      '## ⚔️ Lực Chiến (Combat Power)',
      '',
      'Công thức tính qua `/stat`:',
      '',
      '```',
      'Lực chiến = 100 (base)',
      '          + Level × 10',
      '          + Rank_index × 50',
      '          + Sub-title (50 nếu có)',
      '          + Công pháp đang trang bị',
      '```',
      '',
      'Xem ranking lực chiến: `/leaderboard mode:luc-chien`',
      '',
      DIVIDER,
      '',
      '_Tu hành phi nhất triêu nhất tịch · Đường tu vạn dặm · Radiant Tech Sect_',
    ].join('\n'),
    footer: 'Tích XP đúng cách · Tránh grind spam · Thiên đạo giám sát',
    reactions: ['📖', '📈', '⚡', '✨', '🌟'],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 🌩️ TRIBULATION
  // ─────────────────────────────────────────────────────────────────────
  {
    canonicalChannel: 'tribulation',
    title: '🌩️ Thiên Kiếp · Tribulation',
    color: 0xd97b8a, // rose quartz crimson
    description: [
      DIVIDER,
      '## ⚡ Tribulation Là Gì',
      '',
      'Thiên kiếp là cơ chế **đột phá cảnh giới chủ động**. Đệ tử dùng `/breakthrough` để khởi tribulation; hệ thống đưa ra một trò chơi nhỏ (math · reaction · QTE) — vượt qua được sẽ nhận thưởng lớn, thua sẽ bị mất một phần XP.',
      '',
      DIVIDER,
      '## 📋 Điều Kiện',
      '',
      '✅ **Level ≥ 10** (Trúc Cơ)',
      '✅ Có **≥ 1 đan dược** trong inventory',
      '✅ Server cooldown 24h từ tribulation gần nhất (toàn server)',
      '',
      DIVIDER,
      '## 🎁 Phần Thưởng',
      '',
      '🌟 **Pass**: **+500 XP** + **5 đan dược**',
      '💀 **Fail / Timeout**: **-100 XP** (floor ở ngưỡng cảnh giới — không demote)',
      '💊 Pill consumption: **1 đan dược** tiêu thụ bất kể pass / fail',
      '',
      DIVIDER,
      '## 🌀 Cách Khởi',
      '',
      '1. Mở kênh này',
      '2. Gõ `/breakthrough`',
      '3. Đợi intro embed + nút button',
      '4. Click button trong **30 giây**',
      '5. Hoàn thành mini-game được giao',
      '',
      DIVIDER,
      '## ☯️ Lưu Ý',
      '',
      '🌑 Random tribulation tự kích hoạt **18:00 VN** mỗi ngày với 25% xác suất — pick random đệ tử đủ điều kiện. Không tốn pill nếu bị chọn ngẫu nhiên.',
      '',
      '🛡️ Đại Thừa · Độ Kiếp · Tiên Nhân tributation có hiệu ứng **rainbow animation** trên embed level-up.',
      '',
      DIVIDER,
      '',
      '_Thiên đạo phong vân · Đạo tâm thử thách · Radiant Tech Sect_',
    ].join('\n'),
    footer: 'Vượt qua thiên kiếp · Trở thành thiên chi kiêu tử',
    reactions: ['🌩️', '⚡', '💥', '🔥', '☯️'],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 💻 BOT COMMANDS
  // ─────────────────────────────────────────────────────────────────────
  {
    canonicalChannel: 'bot-commands',
    title: '💻 Lệnh Bot · Quick Reference',
    color: 0xa89bce, // amethyst dream
    description: [
      DIVIDER,
      '## 📈 Tu Vi · Leveling',
      '',
      '`/rank [user?]` — cảnh giới + XP + currency',
      '`/stat [user?]` — combat profile + lực chiến',
      '`/leaderboard [period?] [mode?]` — top 10 XP hoặc lực chiến',
      '`/daily` — điểm danh hằng ngày',
      '`/breakthrough` — khởi Thiên Kiếp (cần Lv 10 + 1 đan dược)',
      '`/title add|remove|list` — sub-title',
      '`/quest` — nhiệm vụ hằng ngày',
      '',
      DIVIDER,
      '## ⚔️ Game Mechanics',
      '',
      '`/inventory` — túi đồ + currency',
      '`/shop` — catalog công pháp',
      '`/cong-phap list|info|buy|equip|unequip` — quản lý công pháp',
      '`/trade sell <slug>` — bán công pháp lại',
      '`/duel @opponent [stake?]` — PvP 5 hiệp',
      '',
      DIVIDER,
      '## 🤖 Aki AI',
      '',
      '`/ask <question> [image?]` — hỏi Aki (sass-helper)',
      '`/ask-akira <question>` — hỏi Akira (học giả)',
      '`/ask-meifeng <question>` — hỏi Meifeng (combat)',
      '`/aki-memory status|toggle|wipe` — bật/tắt Aki nhớ câu hỏi',
      '',
      DIVIDER,
      '## 📚 Cộng Đồng',
      '',
      '`/contribute-doc <title> <body>` — submit tài liệu — Aki tự duyệt',
      '`/help` — xem toàn bộ danh sách lệnh',
      '',
      DIVIDER,
      '## 🛡️ Admin Tools (Staff only)',
      '',
      '`/stats` — dashboard 24h',
      '`/automod-config` — xem cấu hình automod',
      '`/link-whitelist add|remove|list` — quản lý whitelist domain',
      '`/grant pills|contribution @user N` — cấp currency',
      '`/raid-mode on|off` — bật/tắt raid mode',
      '`/thien-dao target:@user crime:<text>` — triệu hồi Thiên Đạo xử phạt',
      '',
      DIVIDER,
      '',
      '_Tổng cộng **28 lệnh slash** · 5 LLM tasks · Đầy đủ vũ trang_',
    ].join('\n'),
    footer: 'Lệnh ephemeral chỉ mình bạn thấy · Public hiện cho cả kênh',
    reactions: ['💻', '🤖', '⚙️', '✨', '🛠️'],
  },
];

/**
 * Marker the bot embeds in each pinned message footer/title so the sync
 * job can identify its own previously-posted pins (vs. user-posted pins
 * the bot must NEVER unpin).
 */
export const BOT_PIN_MARKER = '__radiant_bot_pin_v1__';
