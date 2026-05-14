# Radiant Tech Sect Bot

> Discord bot quản lý cộng đồng **tech + tu tiên** — verification gate, leveling system với cảnh giới tu tiên, automod rule-based, game mechanics (PvP, công pháp, daily quest), AI helpers (Aki / Akira / Meifeng) qua LLM router, và full admin tools.

[![Tests](https://img.shields.io/badge/unit-484%20passing-brightgreen)]() [![Smoke](https://img.shields.io/badge/smoke-320%20passing-brightgreen)]() [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)]() [![Node](https://img.shields.io/badge/Node-20%20LTS-green)]() [![License](https://img.shields.io/badge/license-private-lightgrey)]()

---

## 🌸 Mục Tiêu

Radiant Tech Sect là cộng đồng học thuật + giải trí kết hợp theme tu tiên xianxia. Bot làm 3 việc chính:

1. **Quản lý cộng đồng** — verification chống bot, automod 5 rules, raid mode, link policy permissive với suspicious-link detection.
2. **Game mechanics** — leveling 11 cảnh giới (Phàm Nhân → Tiên Nhân), 2 currencies (đan dược + cống hiến), 12-entry công pháp catalog, daily quest, PvP `/duel`, server boost rewards.
3. **AI assistants** — 3 NPCs với personas riêng (Aki sass-helper / Akira scholar / Meifeng combat), LLM router multi-provider (Groq + Gemini), narration tự sinh cho tribulation + level-up + automod actions.

---

## 🛠️ Tech Stack

| Layer | Choice | Lý do |
|---|---|---|
| Runtime | Node.js 20 LTS | discord.js v14 stable |
| Language | TypeScript strict mode | type safety, IDE support |
| Discord lib | `discord.js@14` | most maintained |
| **Storage** | **Custom Store (in-memory + WAL + snapshot)** | Full control, ~500 LOC, fit scale, no SQL/NoSQL libs |
| Scheduler | `node-cron` | daily/weekly jobs |
| LLM router | `openai` SDK pointed at Groq + Gemini REST | free-tier first, fallback chain |
| Captcha | `canvas` | image captcha trong DM |
| Logger | `pino` + `pino-pretty` (dev) | structured JSON logs |
| Concurrency | `async-mutex` | single-writer guarantee cho WAL |
| Lint/Format | `biome` | faster than ESLint+Prettier |
| Process mgr | `pm2` (production) | auto-restart, log rotation |
| Validation | `zod` | parse user input, env vars |

**Không xài**: SQL (SQLite/Postgres), ORM (Prisma/Drizzle), NoSQL libs (LowDB/NeDB/MongoDB). Storage tự build theo pattern WAL + Snapshot (Postgres WAL / Redis AOF / Kafka log).

---

## 📦 Quick Start

### Prerequisites

- Node.js 20+
- Discord application + bot token (https://discord.com/developers/applications)
- Optional API keys: Groq (free), Gemini (free), xAI Grok (paid, cho `/ask`)

### Setup

```bash
git clone https://github.com/billtruong003/radiant-bot.git
cd radiant-bot
npm install

# Create .env (xem docs/SETUP.md §3 cho danh sách env vars đầy đủ)
cp .env.example .env  # hoặc tạo từ tay
# Fill DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID

npm run build
npm run sync-server          # tạo channels + roles
npm run deploy-commands      # đăng ký 28 slash commands
npm run dev                  # hoặc node dist/src/index.js cho prod
```

### Production trên VPS

Xem [`docs/SETUP.md`](docs/SETUP.md) — đầy đủ checklist clone-and-run, PM2 systemd, GitHub backup cron, customization cho theme khác.

---

## 📚 Documentation Index

| Doc | Mục đích |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Project rules + tech stack lockfile (read first khi mở session với Claude Code) |
| [`HANDOFF.md`](HANDOFF.md) | Trạng thái cuối + roadmap tương lai (anchor doc) |
| [`docs/SETUP.md`](docs/SETUP.md) | Hướng dẫn clone + deploy + customize cho Discord khác |
| [`docs/BACKUP.md`](docs/BACKUP.md) | Backup strategy + disaster recovery |
| [`docs/PHASE_12.md`](docs/PHASE_12.md) | Game mechanics design (latest major phase) |
| [`docs/PHASE_11.md`](docs/PHASE_11.md) | LLM router + verify hardening |
| [`docs/PHASE_10_AKI.md`](docs/PHASE_10_AKI.md) | Aki AI design |
| [`docs/NEXT_SESSION_PROMPT.md`](docs/NEXT_SESSION_PROMPT.md) | Prompt cho session kế (Phase 12.6 polish bundle) |
| [`PROGRESS.md`](PROGRESS.md) | Full phase log (Phase 0-12.5) |
| [`SPEC.md`](SPEC.md) | Architecture spec |

---

## 🎯 Feature Matrix

### Game mechanics
- 11 cảnh giới với role color Ethereal Mystic palette
- 4 sub-titles (Kiếm Tu / Đan Sư / Trận Pháp Sư / Tán Tu)
- XP từ message / voice / reaction / daily + streak bonuses
- Tribulation system + `/breakthrough` (consume 1 đan dược)
- 2 currencies tự earn từ activity
- 12 công pháp catalog (common → legendary)
- `/duel` PvP 5-round với accept window
- `/trade` sell-back + 10% Aki premium roll
- Daily quest cron 00:00 VN + 5 quest templates
- Server boost reward (+5 đan dược + 500 cống hiến)

### Community management
- Verification gate (math + image captcha) + verify thread fallback
- 5-rule automod (profanity với graduated tier 1-15 / mass_mention / link / spam / caps_lock)
- Permissive link policy với suspicious detection (shortener / suspect TLD / IP-only / punycode)
- Raid mode auto-toggle
- Per-user verify rejoin cooldown 1h
- Retroactive history sweep at profanity tier 15+

### AI / LLM
- 5 LLM tasks routed (aki-filter / aki-nudge / narration / doc-validate / divine-judgment)
- Multi-provider chain (Groq primary, Gemini fallback)
- Per-task model selection (8B fast, 70B quality)
- Defensive `reasoning_format: hidden` + `<think>` stripping
- 3 NPC personas (Aki / Akira / Meifeng) sharing pipeline
- `/aki-memory` opt-in user question history
- Áp Chế Thiên Đạo (admin `/thien-dao` + Aki auto-defense when chửi)

### Admin tools
- `/help` grouped command reference
- `/stats` 24h dashboard (members, top XP, automod, Aki cost)
- `/automod-config` view rules
- `/link-whitelist` runtime hot-reload (no restart)
- `/grant` currency adjust
- `/raid-mode` toggle
- `/thien-dao` LLM-judged punishment

### Security defenses
- `sanitizeForDisplay` + `sanitizeForLlmPrompt` + `sanitizeForLlmBody` (mention strip / control char / bidi / zero-width / prompt-injection guard)
- `allowedMentions: { parse: [] }` trên mọi reply path (defense-in-depth)
- Per-user cooldown cho mọi LLM-triggering auto-feature
- HMAC signature cho `POST /api/contribute` REST endpoint
- Per-user 60s message XP cooldown chống grind

### Visual
- Ethereal Mystic role palette (pastel + cosmic) — 11 tiers + 4 staff + 4 sub-titles
- Tiered aura on level-up embed (smoke → energy → divine)
- Rainbow animation cho legendary tier breakthrough (Đại Thừa+)
- Themed embeds với divider system + rank icon
- Channel icons both sides (`💬-general-💬`)

---

## 🏗️ Architecture

```
src/
├── index.ts                    # Bootstrap: storage → bot → graceful shutdown
├── bot.ts                      # Discord client + event registration
├── config/                     # Static config (env, channels, roles, automod)
├── commands/                   # 1 file = 1 slash command (28 total)
├── events/                     # Discord event handlers
├── modules/
│   ├── verification/           # Captcha gate + audit + raid mode
│   ├── leveling/               # XP, level math, rank promotion, daily, voice-xp, aura
│   ├── automod/                # 5 rules + actions + narration
│   ├── aki/                    # /ask pipeline + filter + budget + rate-limit
│   ├── npc/                    # Akira + Meifeng + shared ask-runner
│   ├── combat/                 # power.ts (lực chiến), duel.ts (PvP), cong-phap.ts
│   ├── quests/                 # daily-quest.ts + cron
│   ├── docs/                   # validator.ts (LLM judge) + REST endpoint
│   ├── admin/                  # divine-judgment + aki-defense
│   ├── llm/                    # Provider abstraction + router
│   ├── scheduler/              # Cron jobs (per-min, daily, weekly)
│   ├── bot-log.ts              # Cross-cutting #bot-log poster
│   └── sync/                   # sync-server (channels + roles)
├── db/                         # Custom WAL+Snapshot store
└── utils/                      # logger, health, embed, rate-limiter, sanitize
```

**Storage pattern** (production-grade):

```
In-memory state (Map<key, Entity>)
    ↑
    │ replay on startup
    │
WAL (data/wal.jsonl)  ─── every write appends ───┐
    ↑                                            │
    │ truncate after snapshot                    │
    │                                            ▼
Snapshot (data/snapshot.json)  ◄── periodic (1h) atomic rename
```

Same pattern as Postgres WAL / Redis AOF / Kafka log. ~100MB RAM cho 10K users + 500K xp_logs.

---

## 🧪 Testing

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # biome check
npm test               # vitest — 484 unit tests
npm run smoke-test     # standalone production-path smoke — 320 assertions
npm run build          # tsc -p tsconfig.build.json
```

Test discipline:
- Unit tests per module (mirror `src/` → `tests/`)
- Smoke test exercises real production code paths against synthetic inputs (no Discord connection needed)
- Pre-commit sweep: typecheck + lint + test + smoke + build must all pass

---

## 🚀 Deploy Cycle

```bash
# Local
npm run typecheck && npm test && npm run smoke-test && npm run build
git push origin main

# VPS (Vietnix / OracleCloud / any)
ssh root@<vps-ip>
cd /root/bots/radiant-bot && git pull && npm run build && pm2 restart radiant-tech-sect-bot

# Conditional steps
npm run deploy-commands    # only when adding/changing slash commands
npm run sync-server        # only when changing channel/role schema
```

Health check: `GET <vps-ip>:3030/health` → JSON `{ status: 'ok', uptime_ms, discord: {...}, store: {...} }`.

---

## 🔐 Security Posture

| Threat | Defense |
|---|---|
| Mention injection (display name = `<@everyone>`) | `sanitizeForDisplay()` strips mentions + `allowedMentions.parse=[]` on every reply |
| LLM prompt injection (display name = "Ignore previous instructions") | `sanitizeForLlmPrompt()` redacts known patterns; embed sandboxing trong prompt templates |
| `<think>` reasoning leak from Qwen / gpt-oss models | Groq `reasoning_format: hidden` + defensive `stripReasoning()` in narration paths |
| Bidi homograph attack | `sanitizeForDisplay()` strips U+202A-202E + U+2066-2069 + U+061C |
| Zero-width hide | `sanitizeForDisplay()` strips U+200B-200D + U+2060 + U+FEFF |
| HMAC-spoofed `POST /api/contribute` | `X-Hub-Signature-256` SHA-256 verify with `timingSafeEqual` |
| Spam grind / mass-mention raid | 5-rule automod + raid mode auto-trigger |
| Bot rejoin grind on failed captcha | 1h per-user cooldown |
| Repeat profanity offender | Sliding 60s counter → 15 hit threshold → delete + 15min retroactive sweep |
| Aki insulted by community | Auto-defense detector → Thiên Đạo penalty with 1h cooldown |

---

## 📊 Live Stats (current production)

- **Tests**: 484 unit / 320 smoke / 0 lint err / build clean
- **Slash commands**: 28
- **LLM tasks**: 5 (aki-filter, aki-nudge, narration, doc-validate, divine-judgment)
- **Cost**: ~$0/day expected (Groq free tier covers filter/narration/judgment; Grok only `/ask` at ~$0.05-0.50/day capped at $2.0)
- **Memory**: ~100MB on Oracle VM (handles 10K users)
- **VPS**: Vietnix `14.225.255.73`, PM2 managed

---

## 🤝 Contributing

Bot is production-deployed for a single specific server (Radiant Tech Sect community). Source is reference-quality for anyone wanting to fork & customize for their own theme — see `docs/SETUP.md` §7 for the rebrand-from-tu-tiên-to-X workflow.

PRs welcome for:
- Bug fixes
- Test coverage gaps
- Documentation clarifications

NOT welcome:
- Speculative features without server-side use case validated
- Architectural rewrites (the WAL+Snapshot approach is deliberate, not legacy debt)
- Adding heavy dependencies (the no-SQL-libs constraint is intentional)

---

## 📜 License

Private. Source available for educational reference only.

---

## 🌟 Credits

- **Bill Truong** ([@billtruong003](https://github.com/billtruong003)) — project lead, design decisions, live feedback
- **Aki** — fictional maid persona + project mascot
- Built across multiple sessions with **Claude Code** (Opus 4.7), Phase 0 → Phase 12.5

---

_Thiên đạo vô tư — Radiant Tech Sect_
