# UX Flow — Radiant Tech Sect Server

> Hành trình của đệ tử từ lúc bấm join → endgame Đại Thừa / Độ Kiếp. Tài liệu này là contract giữa **bot behavior + channel design + pinned messages** — sửa channel structure phải đồng bộ với section tương ứng ở đây.

---

## 🧭 Bản đồ tổng quan

```
┌────────────────────────────────────────────────────────────────────┐
│  ❶ JOIN  →  ❷ VERIFY  →  ❸ ORIENT  →  ❹ EARLY  →  ❺ MID  →  ❻ END │
│                                                                    │
│  ❷ #verify           ❸ #rules               ❺ /quest, /shop,      │
│  DM captcha          #introductions          /breakthrough, /duel  │
│  fallback thread     #leveling-guide                               │
│  retry 1h cooldown   #bot-commands           ❻ /contribute-doc,    │
│                                              /ask-akira, sect war   │
│  ❹ /daily, chat XP,                                                │
│     react XP, sub-title chọn ở Lv 10                               │
└────────────────────────────────────────────────────────────────────┘
```

---

## ❶ Join — phút 0

**Trigger**: User bấm Discord invite.

**Bot tự động**:
1. `events/guildMemberAdd.ts` fires → role **Chưa Xác Minh** được gán → user chỉ thấy `#🔒-verify-🔒`.
2. Bot gửi DM với button "Bắt đầu xác minh" (image+math captcha cho suspect accounts, math-only cho clean accounts).
3. Nếu DM bị block → tạo thread `verify-<user-id>` trong `#verify` (chỉ user + staff thấy).

**Channels visible**: `#verify` (chỉ kênh duy nhất).

**Pinned tại `#verify`**: explains DM flow, fallback thread, suspect-account criteria, retry cooldown.

**Risk**: User rời server vì DM bị tắt và không thấy fallback thread → mitigation: pinned message ở `#verify` ghi rõ "ping @Trưởng Lão nếu cần".

---

## ❷ Verify — phút 0-5

**Trigger**: User click button trong DM (hoặc trong thread).

**Bot logic** (`src/modules/verification/`):
1. Generate challenge (math: `a+b=?` 1-20; image+math: 6-char PNG captcha + math).
2. User reply → bot validates → success/fail.
3. Success → role **Phàm Nhân** added, **Chưa Xác Minh** removed.
4. Welcome embed posted in `#👋-introductions-👋` (tagging the new member).

**Fail handling**: 3 wrong answers → kick. Re-join → 1h cooldown trước khi thử lại.

**Timeout**: 2 ngày kể từ join → auto-kick (không ban). `verify-thread` được cleanup hourly.

**Channels visible sau verify**: tất cả public channels (general/intro/help-me/docs/...).

---

## ❸ Orient — phút 5-30

**Đệ tử mới đọc theo thứ tự**:
1. `#📜-rules-📜` — pinned: tinh thần tông môn + 7 quy tắc + cấu trúc tự vệ (Thiên Đạo / tribulation / quest).
2. `#👋-introductions-👋` — pinned: mẫu intro + gợi ý cho đệ tử mới.
3. Post intro của mình → bot auto-react 👋✨ (welcome).
4. `#📖-leveling-guide-📖` — pinned: bảng XP, 11 cảnh giới, daily streak, công thức lực chiến.
5. `#💬-general-💬` — pinned: cách chọn kênh + quy tắc tóm lược + bí mật của sảnh đường (XP per message, react XP).
6. `#💻-bot-commands-💻` — pinned: 26 lệnh slash chia 5 nhóm.

**Mục tiêu UX**: sau 30 phút, đệ tử biết:
- Mình đang ở cảnh giới gì (Phàm Nhân, Lv 0).
- Cách tích XP (message + voice + react + /daily).
- Có 11 cảnh giới mục tiêu.
- Có thể hỏi Aki bằng `/ask`.
- Tribulation = đột phá chủ động, cần đạt Trúc Cơ trước.

---

## ❹ Early Game — Lv 1-10 (≈ 7 ngày)

**Daily ritual**:
1. `/daily` ở `#📅-daily-checkin-📅` (+100 XP + streak bonus).
2. `/quest` xem 3-5 nhiệm vụ hằng ngày.
3. Tham gia chat → +15-25 XP/tin (cooldown 60s).
4. Tham gia voice → +10 XP/min (`#🎯 Focus Room` / `#📚 Quiet Study` thưởng +50%).
5. React vào tin nhắn người khác / nhận react → tích XP nhỏ.

**Channels active**: `#general`, `#meme`, `#help-me`, `#daily-checkin`, voice channels.

**Milestone Lv 10 (Trúc Cơ)**:
- Bot DM/embed: "Đệ tử đạt Trúc Cơ — chọn sub-title trong vòng 7 ngày."
- 4 lựa chọn: ⚔️ Kiếm Tu · 💊 Đan Sư · 🔮 Trận Pháp Sư · 🌿 Tán Tu.
- `/title add <name>` set vĩnh viễn (có thể đổi qua `/title remove` rồi `add` lại).
- Mở khoá perks: external emoji, embed links, dùng `/breakthrough`.

**Pinned tại `#daily-checkin`**: routine 6 bước hằng ngày + giải thích streak + tribulation random.

---

## ❺ Mid Game — Lv 10-50 (≈ 1-3 tháng)

**Game loop mở rộng**:

| Action | Lệnh | Thưởng |
|---|---|---|
| **Daily quests** | `/quest` | 25-100 XP / quest + pills + contribution |
| **Mua công pháp** | `/shop` → `/cong-phap buy` | +lực chiến |
| **Trang bị / đổi** | `/cong-phap equip <slug>` | Refresh stat |
| **Bán lại** | `/trade sell <slug>` | Hoàn 50-60% giá + 10% chance Aki bonus |
| **PvP** | `/duel @target [stake]` | Win → +XP + pills, lose → -XP |
| **Active breakthrough** | `/breakthrough` | +500 XP + 5 pills (cần 1 pill khởi) |
| **Random tribulation** | (system 18:00 VN, 25%) | Free shot lên cảnh giới |
| **Hỏi NPC** | `/ask-akira`, `/ask-meifeng` | Tu duy / combat advice |

**Channels active thêm**:
- `#🎮-game-dev-🎮`, `#🤖-ai-ml-🤖`, `#🛠️-tools-showcase-🛠️` — chia sẻ project.
- `#🌩️-tribulation-🌩️` — xem tribulation announce + sách lược.
- `#🏆-leaderboard-🏆` — đối chiếu vị trí (read-only).

**Cảnh giới milestone**:
- **Kim Đan (Lv 20)**: tạo public thread permission.
- **Nguyên Anh (Lv 35)**: tạo private thread + attach files.
- **Hóa Thần (Lv 50)**: priority speaker voice + external sticker — bắt đầu được tôn trọng như "đệ tử lớn".

---

## ❻ Late / End Game — Lv 50+ (≈ 6+ tháng)

**Vai trò thay đổi**: từ học → dạy + đóng góp.

**Hoạt động chính**:

1. **Contribute docs** ở `#📚-docs-📚`:
   - `/contribute-doc title:... body:... [image:<file>]` — Aki tự duyệt (approved → +50 contribution + 500 XP).
   - Hoặc POST `/api/contribute` với HMAC (image qua REST: roadmap).
   - Aki tự phân loại: difficulty / section / tags.
   - **Approved** → bot tự tạo **public thread** trong `#docs` với starter embed (body + score + classification + image). Mỗi doc là 1 thread riêng → reply / hỏi / debate ngay trong thread đó. Auto-archive sau 7 ngày inactive.
   - **Rejected** → ephemeral phản hồi với lý do để sửa lại + submit lần nữa.

2. **Mentor ở `#🆘-help-me-🆘`**: trả lời câu hỏi đệ tử mới → user hỏi react ✅ → +10 contribution points.

3. **Sect events** (Trưởng Lão tổ chức):
   - Sect war / collective tribulation / pill brewing competition.
   - Posted ở `#📢-announcements-📢` (chỉ staff đăng).

4. **Voice culture**: `#🏛️ Main Hall`, `#🎮 Gaming`, `#📚 Quiet Study` (working XP boost).

**Cảnh giới đỉnh**:
- **Luyện Hư (Lv 70)**: tự quản tin nhắn của mình (manage own messages).
- **Hợp Thể (Lv 90)**: trusted — có thể được đề cử lên Nội Môn / Trưởng Lão.
- **Đại Thừa (Lv 120)**: custom title flair + custom emoji react.
- **Độ Kiếp (Lv 160+)**: gần đỉnh — có thể vote elections cho vai trò Trưởng Lão.
- **Tiên Nhân**: **chỉ Chưởng Môn ban** — không auto promote.

---

## 🛡️ Staff Flow

**Trưởng Lão / Chấp Pháp** có thêm UX layer:

| Action | Channel / Command | Purpose |
|---|---|---|
| Áp Chế Thiên Đạo | `/thien-dao target:@user crime:<text>` | LLM-judged punishment menu |
| Cấp currency | `/grant pills\|contribution @user N` | Event reward / compensation |
| Raid response | `/raid-mode on` | Lock unverified + slow chat |
| Dashboard | `/stats` | 24h overview |
| Whitelist quản lý | `/link-whitelist add/remove/list` | Runtime URL whitelist |
| Pinned sync | `/sync-pinned` | Re-publish canonical pins (idempotent) |
| Audit | `npm run audit-server` (VPS) | Members/roles/channels/pinned report |

**Voice retreat**: `#🍵 Elder Lounge 🍵` (voice) + `#🏛️-elder-lounge-🏛️` (text, admin-only).

---

## 🤖 LLM Touchpoints

| Where users see LLM | Provider | Cost |
|---|---|---|
| `/ask` answer | Grok 4.1 Fast | ~$0.05-0.50/day |
| `/ask-akira`, `/ask-meifeng` | Grok 4.1 Fast | same budget |
| Aki nudge (profanity 1-14) | Groq free (Qwen/Llama) | $0 |
| Thiên Đạo narration (`#bot-log`) | Groq free | $0 |
| Chronicler narration (rank breakthrough) | Groq free | $0 |
| `/contribute-doc` validate | Groq free | $0 |
| `/thien-dao` punishment selection | Groq free | $0 |
| Filter (anti-spam `/ask` input) | Gemini Flash → Groq fallback | $0 (free tier) |

**Privacy**: Aki memory = opt-in only (`/aki-memory toggle`). Discord usernames / display names đều sanitize trước khi đưa vào prompt (`src/utils/sanitize.ts`).

---

## 🆘 Khi UX Fail — Common Recovery

| Symptom | Cause likely | Fix |
|---|---|---|
| Đệ tử join nhưng không thấy DM verify | Discord DM block | Pinned `#verify` chỉ ping `@Trưởng Lão` |
| Verify timeout 2 ngày → bị kick | Đệ tử quên / busy | Re-invite + thử lại sau 1h cooldown |
| Channel category bị xáo trộn | Manual move trên Discord | `npm run sync-server -- --dry-run` rồi sync |
| Pinned messages bị edit / xoá | User pin mới đè bot pin | `/sync-pinned` re-publish (chỉ thay bot pin) |
| Lực chiến không khớp | Công pháp inventory drift | `/cong-phap list` → `/cong-phap unequip` → equip lại |
| Quest không progress | Quest type không match action | Đọc pinned `#daily-checkin` — quest type liệt kê đầy đủ |
| XP không tích sau spam | Cooldown 60s | _Working as intended_ — chống grind |
| Aki không trả lời 1 ngày | Daily $2 budget exhausted | Đợi 00:00 VN reset |

---

## 📋 Channel — Pinned Status Matrix

| Canonical | Có pinned chính thức | Audience | Frequency vai trò |
|---|---|---|---|
| `verify` | ✅ | Đệ tử mới | First touch |
| `rules` | ✅ | Mọi đệ tử | Re-read khi có dispute |
| `announcements` | ✅ | Mọi đệ tử | Đọc khi có @everyone |
| `introductions` | ✅ | Mọi đệ tử | Post 1 lần khi join |
| `general` | ✅ | Mọi đệ tử | Daily |
| `daily-checkin` | ✅ | Mọi đệ tử | Daily |
| `meme` | ✅ | Mọi đệ tử | Daily (relax) |
| `help-me` | ✅ | Mọi đệ tử cần hỗ trợ | Ad-hoc |
| `leveling-guide` | ✅ | Mọi đệ tử | Re-read khi unclear |
| `tribulation` | ✅ | Lv 10+ | Trước khi /breakthrough |
| `level-up` | ✅ | Mọi đệ tử (read-only) | React để chúc mừng |
| `docs` | ✅ | Đệ tử endgame contributor | Khi submit / đọc tài liệu |
| `bot-commands` | ✅ | Mọi đệ tử | Reference |
| `game-dev`, `ai-ml`, `tools-showcase` | ❌ (theme self-organize) | Theme audience | Theme-specific |
| `art`, `music`, `writing` | ❌ (theme self-organize) | Creative | Theme-specific |
| `gaming`, `highlight`, `movie-night` | ❌ (chitchat) | Entertainment | Ad-hoc |
| `jobs`, `automation-ideas` | ❌ (low traffic) | Niche | Ad-hoc |
| `bot-log`, `bot-dev` | ❌ (system / staff only) | Staff | Staff-only |
| `leaderboard` | ❌ (system auto post) | Read-only | System-driven |
| `elder-lounge` | ❌ (admin-only retreat) | Staff | Staff retreat |

**Tổng**: 13 pinned messages chính thức / ~24 text channels.

Re-sync any time với `/sync-pinned` (admin slash). Sync **chỉ thay bot pin** — user pins không bao giờ bị unpin.

---

## 🎯 Design Principles (locked)

1. **Ngôi 3 vô danh** — không "tôi/em/Aki yêu cầu". Tông môn / hệ thống / quy tắc speak. (Bill 2026-05-14)
2. **Aesthetic dividers** — `━━━━━━━━━━━━━━━━━━━━━━━━━━━━` giữa sections.
3. **Themed emoji palette** — mỗi kênh có cluster 4-6 emoji riêng (rules: 📜⚖️🌸☯️✨; tribulation: 🌩️⚡💥🔥☯️; daily: 📅🌅✨🔥🌙).
4. **Idempotent re-sync** — chạy `/sync-pinned` nhiều lần không tích luỹ pin; chỉ thay bot pin một lần.
5. **User pins inviolable** — `BOT_PIN_MARKER` footer phân biệt; bot không bao giờ unpin user pins.
6. **Cross-link** — mỗi pinned message dẫn tới kênh / lệnh liên quan thay vì duplicate content.

---

## 🔁 Maintenance Workflow

Khi thêm / sửa pinned content:

1. Sửa `src/config/pinned-messages.ts`.
2. Update smoke test ở `scripts/smoke-test.ts` nếu thêm canonical channel (cập nhật `expectedCanonical` set + count expect).
3. `npm run typecheck && npm test && npm run smoke-test && npm run build`.
4. Commit.
5. Deploy: `git pull && npm run build && pm2 restart radiant-tech-sect-bot`.
6. Trong Discord, admin chạy `/sync-pinned` để re-publish canonical pins.
7. Verify: `npm run audit-server` trên VPS — kiểm bot-pin count per channel.

Nếu cần thêm canonical channel mới:
1. Thêm channel vào `src/config/server-structure.ts` + `npm run sync-server`.
2. Thêm entry vào `PINNED_MESSAGES` array.
3. Thêm canonical name vào `expectedCanonical` ở smoke test.
4. Cập nhật table "Channel — Pinned Status Matrix" trong file này.
