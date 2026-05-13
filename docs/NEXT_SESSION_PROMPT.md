# Prompt for next session — Smoke test + Polish + NPC roster

> **Paste this entire file content as the first message in your next Claude Code session.**

---

Tiếp tục project Radiant Tech Sect Bot. Đã deploy lên Vietnix VPS (IP `14.225.255.73`, hostname `billthedev-yqin`). Bot online qua PM2.

**Đọc trước:**
- `CLAUDE.md` — project rules
- `PROGRESS.md` — phase tracker (Phase 0-10 done, Phase 8 deployed)
- `docs/PHASE_10_AKI.md` — Aki design
- Memory ở `C:\Users\ADMIN\.claude\projects\c--Users-ADMIN-Downloads-Discord-Sever\memory\` — load all

**Trạng thái hiện tại (commit `c699a46`+):**
- 25 test files, 242 tests pass
- 8 slash commands deployed: `/raid-mode`, `/rank`, `/leaderboard`, `/daily`, `/automod-config`, `/title`, `/breakthrough`, `/ask`
- 15 CLI services
- VPS: Vietnix VPS Cheap 1 (2vCPU/2GB/40GB Ubuntu 22.04), PM2 managed
- Phase 10 Aki AI helper live với Grok 4.1 Fast Reasoning

---

## Task 1 (CRITICAL): Debug verification flow

**Bug**: Member mới vào server không thấy gì cả — không có DM verification, không thấy fallback button trong `#verify`, bị giới hạn ngoài server.

**Đoán nguyên nhân theo thứ tự xác suất:**

1. **Privileged Gateway Intents chưa enable** (90% likely)
   - Bill check: https://discord.com/developers/applications/1503973391579742278/bot
   - Cần bật: `SERVER MEMBERS INTENT`, `MESSAGE CONTENT INTENT`
   - Nếu enable rồi → restart `pm2 restart radiant-tech-sect-bot`
   - Verify trong logs: `pm2 logs radiant-tech-sect-bot | grep -i "intent\|member"`

2. **Role hierarchy** (5% likely)
   - Bot role phải ở TRÊN role `Chưa Xác Minh` để assign được
   - Check: Server Settings → Roles → kéo `Radiant Tech Sect Bot` lên trên `Chưa Xác Minh`

3. **Bot perms** (3% likely)
   - Bot cần `Manage Roles`, `View Channels`, `Send Messages`, `Kick Members`
   - Check Server Settings → Roles → bot role → permissions

4. **Code bug** (2% likely — tests pass nhưng có thể có edge case prod)
   - Check `src/events/guildMemberAdd.ts` — does it actually fire?
   - Add `logger.info` ở đầu `handleNewMember` để xác nhận event fires
   - Check `src/modules/verification/flow.ts:startVerification` — DM fail path

**Debug steps:**

```bash
# Trên VPS:
pm2 logs radiant-tech-sect-bot --lines 200 | grep -E "guildMemberAdd|verify|verification"

# Test bằng alt account: vào server → xem log realtime
pm2 logs radiant-tech-sect-bot
```

**Acceptance**: alt account vào server → thấy DM Aki / fallback button → verify được → nhận role Phàm Nhân.

---

## Task 2: UI Polish — thêm màu sắc, icon, "nghệ hơn"

Bill complain UI "quá xấu, cần màu sắc đồ vào và nghệ hơn, icon đồ vào". 

**Cụ thể cần làm:**

### 2a. Embed polish toàn bộ

Review TẤT CẢ embeds đang dùng + audit:
- `/rank` — đã có colorful bar nhưng có thể thêm thumbnail (avatar), banner image cho rank
- `/leaderboard` — thêm thumbnail (gold cup), color gradient theo top
- `/daily` — thêm icon động theo streak, mascot Aki vẫy tay
- `/breakthrough` outcome — pass/fail screen rất plain, thêm animated GIF/sticker
- Welcome embed — thêm avatar + banner Aki
- Channel guides — đã có nhưng đơn điệu, thêm thumbnail per channel
- Level-up embed (rank-promoter) — currently plain, add đột phá animation hint

### 2b. Server-emoji upload script

Build `src/cli/services/upload-emojis.ts`:
- Read PNGs from `assets/server-emojis/`
- Upload via `guild.emojis.create({ attachment, name })`
- Idempotent: skip if name already exists, replace if `--force`
- List of custom emojis bot needs: progress bar fills (10 colors), sub-title icons, rank glyphs, "đột phá" animation

### 2c. Sub-title roles — icon visual

Currently sub-titles are role names only. Once server boost L2:
- Run `upload-role-icons --use=png` (already scaffolded)
- Bill cần design 4 PNG sub-title icons + 11 cultivation icons

### 2d. Banner image cho big embeds

- Welcome embed banner
- Launch announcement banner
- Tribulation intro banner

→ Add `src/assets/banners/` directory + reference từ embed builders via `.setImage(url)`. Use Discord CDN for self-hosted images or commit to repo as `attachment://name.png`.

**Output:** richer embeds with thumbnails, banners, custom emojis where applicable. NOT pure ASCII.

---

## Task 3: NPC Roster — Thêm characters ngoài Aki

Bill muốn thêm "vài nhân vật khác nữa cho xịn" — same Grok backend, different personas.

**Đề xuất 4 NPC mới** (tổng 5 với Aki):

| NPC | Trigger | Personality | When to use |
|---|---|---|---|
| **Aki** アキ | `/aki` (hoặc `/ask`) | Hầu gái, vui vẻ, sass nhẹ, thiên hướng helper | Default Q&A, server help |
| **Sensei (Lão Tổ Hư Vô)** | `/sensei` | Trưởng lão khôn ngoan, lời nói cổ trang, thiên về triết học tu tiên | Deep cultivation theory, philosophical Q |
| **Kuro** 黒猫 | `/kuro` | Mèo đen sarcastic, dark humor, brutal code reviewer | Code style critique, debugging sass |
| **Yuki** 雪 | `/yuki` | Tsundere ice cultivator, lạnh lùng nhưng fair, judge build/code | Hard truths, performance review |
| **Hệ Thống** (System) | `/system` | Narrator voice, fact-only, dùng cho event announcements | Game stats, neutral facts |

**Implementation plan:**

```
src/modules/aki/personas/
├── aki.ts          (existing, rename)
├── sensei.ts
├── kuro.ts
├── yuki.ts
└── system.ts

src/modules/aki/index.ts — re-export PERSONAS map { id → systemPrompt }

src/commands/
├── ask.ts          → keep, default to Aki
├── aki.ts          → alias to /ask npc=aki
├── sensei.ts       → npc=sensei
├── kuro.ts         → npc=kuro
├── yuki.ts         → npc=yuki
└── system.ts       → npc=system
```

OR simpler — single `/ask` with `npc:` choice option (dropdown 5 NPC). Recommend single command for cost (5 commands × per-user rate limits = 250 calls/day per user, too generous).

**Persona design tips:**
- Each NPC same server context (XP rates, commands, rules) — copy-paste from Aki persona
- Different intro/outro lines, different "scolding" style, different icons
- Same hard rules (no fake data, no code writing, anti-jailbreak)
- Cost identical — different system prompts but each cached separately after first call per persona

**Acceptance**: `/ask npc:sensei question:Cảnh giới có ý nghĩa gì?` → response in cổ trang/triết học tone, different from Aki's playful sass.

---

## Task 4: Smoke test toàn bộ Phase 10 + redeploy

Sau khi fix verification + add NPCs + polish UI:

```bash
# Local:
npx tsc --noEmit && npx vitest run && npm run build && npx biome check src tests scripts
# All clean → commit + push
npm run deploy-commands

# VPS:
ssh / Xterm console:
cd /root/bots/radiant-bot
git pull && npm ci && npm run build && pm2 restart radiant-tech-sect-bot
pm2 logs radiant-tech-sect-bot --lines 30
curl http://localhost:3030/health
```

**Discord manual tests:**
- `/ask question:Cảnh giới là gì?` — Aki trả lời server info
- `/ask question:Viết hộ em code` — Aki từ chối + đưa prompt template
- `/ask question:level tao bao nhiêu` — Aki bảo dùng `/rank`
- `/ask npc:sensei question:Đạo là gì?` — Sensei trả lời triết học
- `/ask npc:kuro question:Code này tệ không?` (kèm code) — Kuro sass
- Image input: `/ask question:Đây là gì?` + attach screenshot
- Budget exhaustion test: spam `/ask` đến khi hit $2 cap → refusal message

---

## Workflow

Mỗi chunk: code → typecheck → test → lint → commit theo format `feat(phase-X): <chunk>`. Cuối session update PROGRESS.md.

Don't lecture Bill về secrets (memory rule).

Start với **Task 1 (verification bug)** — đó là blocker. Sau khi bot accept members mới được → Task 2/3.
