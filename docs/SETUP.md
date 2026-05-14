# Radiant Tech Sect Bot — Setup Guide

> Complete clone-and-run guide. Follow top to bottom for a fresh Discord server.

**Bot version**: Phase 12 complete (Lát 1-9, all features shipped).
**Test status**: 417 unit / 216 smoke / 0 lint err / build clean.

---

## 1. Prerequisites

### Discord
1. Tạo **Discord server** mới (Settings → Create a server → For me and my friends).
2. Tạo **bot application**:
   - https://discord.com/developers/applications → New Application
   - Bot tab → Add Bot → bật **MESSAGE CONTENT INTENT** + **SERVER MEMBERS INTENT** + **PRESENCE INTENT**
   - Copy **Bot Token** (giữ kín)
   - OAuth2 → URL Generator → scope `bot` + `applications.commands`, permissions `Administrator` (sẽ giảm sau khi sync)
   - Paste URL vào browser → invite bot vô server

### Local / VPS
- Node.js **20 LTS** (`node --version` → v20.x)
- Git
- Discord server's **Guild ID** (Server Settings → enable Developer Mode → right-click server icon → Copy ID)
- Discord application's **Client ID** (Developer Portal → General Information → Application ID)

### Optional API keys (tăng feature)
- **Groq API key** (free tier) — https://console.groq.com/keys — bật Aki + narration LLM
- **Gemini API key** (free tier) — https://aistudio.google.com/app/apikey — LLM fallback chain
- **xAI Grok key** (paid) — https://console.x.ai/ — `/ask` actual Grok answer
- **GitHub PAT** — chỉ cần nếu muốn auto-backup snapshot nightly

---

## 2. Clone & install

```bash
git clone https://github.com/billtruong003/radiant-bot.git
cd radiant-bot
npm install
```

`canvas` (image captcha) sẽ build native. Trên Linux cần:
```bash
sudo apt install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```
Trên Windows: `npm install --build-from-source` thường ok với Visual Studio Build Tools.

---

## 3. Environment

Copy `.env.example` → `.env` (nếu file chưa có, tạo từ list dưới):

```bash
# === REQUIRED ===
DISCORD_TOKEN=                          # Bot token
DISCORD_CLIENT_ID=                      # Application ID
DISCORD_GUILD_ID=                       # Server ID

# === RECOMMENDED ===
NODE_ENV=production
LOG_LEVEL=info
DATA_DIR=./data
SNAPSHOT_INTERVAL_MS=3600000            # 1 hour
WAL_FSYNC=true                          # durable, ~5ms/write
ADMIN_USER_IDS=                         # CSV của user IDs có /verify-test (dev) + future privileged
HEALTH_PORT=3030                        # 0 = disable HTTP server (also disables docs API)

# === Aki AI (Phase 10+) ===
XAI_API_KEY=                            # xai-... — empty disables /ask
AKI_MODEL=grok-4-1-fast-reasoning
AKI_MAX_OUTPUT_TOKENS=600
AKI_DAILY_BUDGET_USD=2.0                # server-wide cap

# === LLM router (Phase 11) ===
GROQ_API_KEY=                           # gsk_... — primary for filter/nudge/narration/docs
GEMINI_API_KEY=                         # Google AI Studio — fallback chain
AKI_FILTER_MODEL=gemini-2.0-flash       # legacy; per-task config in src/modules/llm/router.ts

# === Backup (optional) ===
BACKUP_GITHUB_REPO=                     # user/private-repo for nightly snapshot push
BACKUP_GITHUB_TOKEN=                    # PAT with repo scope

# === Phase 12 Lát 9 docs ===
DOCS_HMAC_SECRET=                       # random hex secret for POST /api/contribute; empty disables endpoint
```

**Generate HMAC secret**:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 4. First-time server bootstrap

### 4.1 Build
```bash
npm run build
```
Outputs to `dist/`. TypeScript strict mode — phải clean trước khi chạy.

### 4.2 Sync server structure (roles, channels, categories)

**Dry-run** xem changes:
```bash
npm run sync-server -- --dry-run
```

Kỳ vọng output: ~20 roles + ~30 channels + 6 categories sẽ được tạo.

**Apply**:
```bash
npm run sync-server
```

Sync-server idempotent — chạy lại an toàn, chỉ tạo/sửa cái còn thiếu/sai. Sau khi xong:
- 11 cultivation rank roles (Phàm Nhân → Tiên Nhân) — màu Ethereal Mystic palette
- 4 staff roles (Chưởng Môn / Trưởng Lão / Chấp Pháp / Thiên Đạo)
- 4 sub-title roles (Kiếm Tu / Đan Sư / Trận Pháp Sư / Tán Tu)
- Chưa Xác Minh (unverified gate)
- Channels: `🔒-verify-🔒`, `💬-general-💬`, `📋-bot-log-📋`, `📈-level-up-📈`, `🌩️-tribulation-🌩️`, etc.

**Quan trọng**: Sau sync, drag bot's auto-managed role lên TRÊN tất cả rank roles trong Discord Settings → Roles. Bot phải có position cao hơn để assign/swap.

### 4.3 Deploy slash commands

```bash
npm run deploy-commands
```

Đẩy 27 slash commands lên Discord. Lần đầu mất ~30s cho global propagation; dev guild commands tức thì.

### 4.4 First run

```bash
# Dev:
npm run dev

# Production:
npm run build
NODE_ENV=production node dist/src/index.js
```

Log đầu phải thấy:
- `store: no snapshot, fresh start` (fresh DB)
- `store: công pháp catalog seeded` (12 công pháp seed lần đầu)
- `scheduler: started`
- `logged in` với bot tag

---

## 5. Persistent process (PM2 trên VPS)

```bash
npm install -g pm2

pm2 start dist/src/index.js --name radiant-tech-sect-bot --time
pm2 save
pm2 startup
# Follow the systemd command pm2 prints

# Logs
pm2 logs radiant-tech-sect-bot --lines 100 --nostream

# Restart sau code change
git pull && npm run build && pm2 restart radiant-tech-sect-bot
```

PM2-logrotate cũng nên install để log không phình:
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

---

## 6. Verify deployment (smoke test)

Trong Discord, theo thứ tự:

| Step | Command | Expected |
|---|---|---|
| 1 | `/help` | Embed list 27 commands, ephemeral |
| 2 | Member mới join | Quarantined role "Chưa Xác Minh", DM captcha hoặc verify thread |
| 3 | Pass captcha | Roles swap → Phàm Nhân, welcome embed ở #general |
| 4 | Chat 5+ chars trong #general | +15-25 XP, +1-2 contribution_points |
| 5 | `/rank` | Show XP + level + currency + lực chiến hint |
| 6 | `/stat` | Combat profile embed |
| 7 | `/daily` | +100 XP + 5 contribution; streak ladder |
| 8 | `/leaderboard` | Top 10 XP |
| 9 | `/leaderboard mode:luc-chien` | Top 10 lực chiến |
| 10 | `/shop` | 12 công pháp với filter rank |
| 11 | `/grant` (admin) → `/cong-phap buy` → `/inventory` | Currency → mua → trang bị |
| 12 | `/ask question:hello` | Aki reply (cần XAI_API_KEY) |
| 13 | Profanity ≥15 lần/60s | Tin nhắn bị xóa + sweep history, #bot-log có Thiên Đạo prose |
| 14 | Post `bit.ly/x` | Bị xoá (shortener) |
| 15 | Post `medium.com/post` | KHÔNG bị xoá (permissive link policy) |
| 16 | `/duel @opponent stake:1` | Embed accept window → click → 5-round sim |
| 17 | `/breakthrough` (level 10+) | Tiêu 1 pill → Thiên Kiếp |
| 18 | `/quest` | Daily quest progress |
| 19 | `/contribute-doc` | LLM validate + approve/reject |
| 20 | `curl POST /api/contribute` với HMAC | Same flow via REST |

---

## 7. Customization — cho server khác

### 7.1 Theme rename

Toàn bộ tu-tiên flavor (Phàm Nhân, Trúc Cơ, Aki, Thiên Đạo, đan dược, công pháp...) là user-facing VN strings. Nếu Discord khác cần theme khác (vd guild D&D, cyberpunk):

| File | Đổi gì |
|---|---|
| `src/config/cultivation.ts` | 11 rank IDs + names + descriptions + colors |
| `src/config/server-structure.ts` | ROLES (cùng cultivation list) + CHANNELS + CATEGORIES |
| `src/config/cong-phap-catalog.json` | 12 item catalog rename + cost |
| `src/modules/aki/persona.ts` | Aki system prompt — full persona override |
| `src/modules/npc/akira-persona.ts` & `meifeng-persona.ts` | Alt NPCs |
| `src/modules/automod/narration.ts` | Thiên Đạo cosmic voice → rename + reword |
| `src/modules/leveling/narration.ts` | Chronicler rank-up prose |
| `src/modules/aki/persona-nudge.ts` | Aki profanity nudge tone |

Currency labels (đan dược, cống hiến) appear trong multiple commands — search `đan dược` và `cống hiến` rồi thay.

### 7.2 Tuning thresholds

| File | Tuning |
|---|---|
| `src/config/leveling.ts` | XP rates, daily streak bonuses, tribulation rewards |
| `src/config/automod.json` | profanity words, link policy, mass-mention threshold, caps ratio |
| `src/config/verification.ts` | captcha timeout, audit thresholds, raid window |
| `src/modules/automod/actions.ts` | `STERN_THRESHOLD` (5), `DELETE_THRESHOLD` (15), `SWEEP_MAX_AGE_MS` (15min) |
| `src/modules/combat/power.ts` | Lực chiến formula constants |
| `src/modules/combat/duel.ts` | Duel round count, crit chance, defense reduction |
| `src/modules/quests/daily-quest.ts` | QUEST_POOL — quest templates + rewards |
| `src/commands/duel.ts` | `DUEL_COOLDOWN_MS`, `DUELS_PER_DAY_MAX` |
| `src/commands/breakthrough.ts` | `TRIBULATION_PILL_COST` |
| `src/events/guildMemberUpdate.ts` | `BOOST_REWARD_PILLS`, `BOOST_REWARD_CONTRIBUTION` |
| `src/commands/trade.ts` | `PILL_REFUND_RATIO`, `AKI_PREMIUM_CHANCE` |

### 7.3 Disable features

| Feature | How to disable |
|---|---|
| Aki AI (/ask) | Empty `XAI_API_KEY` |
| LLM narration | Empty `GROQ_API_KEY` + `GEMINI_API_KEY` (uses static fallback) |
| Image captcha | `src/config/verification.ts` — set `accountAgeSuspectDays: 0` |
| Auto-kick young accounts | `accountAgeKickDays: 0` (default already 0) |
| Verify | Comment out `registerGuildMemberAdd` in `src/bot.ts` |
| Docs API endpoint | Empty `DOCS_HMAC_SECRET` |
| GitHub backup | Empty `BACKUP_GITHUB_REPO` |

---

## 8. Operations cheat-sheet

```bash
# View live logs
pm2 logs radiant-tech-sect-bot --lines 50 --nostream

# Force snapshot (graceful)
pm2 reload radiant-tech-sect-bot

# Inspect store
ls -la data/
cat data/snapshot.json | jq '.users | length'
cat data/wal.jsonl | wc -l

# Backup store manually
tar -czf snapshot-$(date +%Y%m%d).tar.gz data/

# Restore from backup
pm2 stop radiant-tech-sect-bot
tar -xzf snapshot-20260514.tar.gz
pm2 start radiant-tech-sect-bot

# Add domain to link whitelist (live, no restart)
# (do this in Discord)
/link-whitelist add domain:billthedev.com

# Add currency
/grant currency:pills user:@x amount:10

# Check stats
/stats
```

---

## 9. Architecture quick map

```
src/
├── index.ts                # Bootstrap: storage → bot → graceful shutdown
├── bot.ts                  # Discord client + event registration
├── config/                 # Static config (env, channels, roles, automod)
├── commands/               # 1 file = 1 slash command (27 total)
├── events/                 # Discord event handlers
├── modules/
│   ├── verification/       # Captcha gate + audit + raid mode
│   ├── leveling/           # XP, level math, rank promotion, daily, voice-xp
│   ├── automod/            # 5 rules + actions + narration
│   ├── aki/                # /ask pipeline: filter → quota → budget → Grok
│   ├── npc/                # Akira + Meifeng + shared ask-runner
│   ├── combat/             # power.ts (lực chiến), duel.ts (PvP), cong-phap.ts (inventory)
│   ├── quests/             # daily-quest.ts + cron in scheduler
│   ├── docs/               # validator.ts (LLM judge) + REST endpoint in utils/health
│   ├── llm/                # Provider abstraction (groq + gemini) + router
│   ├── scheduler/          # Cron jobs (per-min, daily, weekly)
│   ├── bot-log.ts          # Cross-cutting #bot-log poster
│   └── sync/               # sync-server (channels + roles)
├── db/                     # Custom WAL+Snapshot store
│   ├── types.ts            # Entity interfaces
│   ├── collection.ts       # Mutable Collection<T>
│   ├── append-only-collection.ts
│   ├── singleton-collection.ts
│   ├── append-log.ts       # WAL writer
│   └── store.ts            # Main Store class
└── utils/                  # logger, health, embed, rate-limiter
```

---

## 10. Common issues

### Verification not firing
- Check Privileged Gateway Intents bật trong Developer Portal
- Bot có role position cao hơn rank roles?
- `pm2 logs` → grep `guildMemberAdd`

### Slash commands không xuất hiện
- Chưa chạy `npm run deploy-commands`?
- Global commands cần 1h propagate; dev guild instant
- Bot scope đúng `applications.commands`?

### LLM 400 errors
- `reasoning_format is not supported with this model` → already fixed in `groq.ts:modelSupportsReasoningFormat`
- Qwen `<think>` leak → already fixed via `reasoning_format: hidden` + `stripReasoning` helper

### Store corruption
- WAL replay handles partial writes
- Snapshot version mismatch logs `store: snapshot version mismatch, treating as empty`
- Restore last snapshot from `BACKUP_GITHUB_REPO` if configured

### Memory growth
- WAL truncates on snapshot — check `SNAPSHOT_INTERVAL_MS` not too long
- xpLogs / akiLogs append-only — query is `Array.filter()` so bound to ~100MB for ~500K rows

---

## 11. Going to production checklist

- [ ] `.env` filled (DISCORD_TOKEN, CLIENT_ID, GUILD_ID required)
- [ ] `WAL_FSYNC=true` set
- [ ] `HEALTH_PORT=3030` + UptimeRobot pinging `/health`
- [ ] PM2 startup script installed (`pm2 startup`)
- [ ] PM2-logrotate configured
- [ ] `BACKUP_GITHUB_REPO` + token set (or alternate backup)
- [ ] `DOCS_HMAC_SECRET` random hex if using /api/contribute
- [ ] Bot role positioned above rank roles in Discord
- [ ] Privileged Intents enabled
- [ ] `npm run sync-server` ran without errors
- [ ] `npm run deploy-commands` ran without errors
- [ ] Tested 20 verify checklist items in §6
- [ ] Test alt account verified successfully end-to-end

---

## 12. Where to learn more

- `CLAUDE.md` — Project rules + tech stack decisions
- `SPEC.md` — Architecture spec (Phase 0-9 design)
- `PROGRESS.md` — Phase-by-phase ship log
- `docs/PHASE_10_AKI.md` — Aki AI helper design
- `docs/PHASE_11.md` — Verify hardening + LLM router
- `docs/PHASE_12.md` — Game mechanics (current major phase)
- `HANDOFF.md` — Final session handoff + future roadmap
