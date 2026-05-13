# PROGRESS.md — Radiant Tech Sect Bot Progress Tracker

> Claude Code: update file này sau mỗi task. Format ngày: `YYYY-MM-DD`.
> Status: `todo` | `in_progress` | `blocked` | `done`
> Khi blocked, ghi rõ lý do ở section "Blockers" cuối file.

**Last updated:** 2026-05-13
**Current phase:** `Phase 1` (Phase 0 done, awaiting review)

---

## Phase 0 — Project bootstrap

**Status:** `done`
**Estimated complexity:** S (1 ngày)
**Goal:** Setup repo, deps, env.

### Tasks
- [x] Init Node: `package.json` written directly (avoid `npm init -y` defaults)
- [x] Install deps: `discord.js zod node-cron pino canvas dotenv async-mutex ulid simple-git` (+ `pino-pretty` for dev)
- [x] Install dev deps: `typescript tsx @types/node @biomejs/biome vitest @types/node-cron`
- [x] `tsconfig.json` strict mode + path alias `@/*` → `./src/*` (+ `tsconfig.build.json` for prod build)
- [x] `biome.json` config
- [x] `.env.example` (xem CLAUDE.md)
- [x] `.gitignore`: `node_modules`, `.env`, `data/`, `logs/`, `backup-repo/`, `dist/`
- [ ] Discord Application + Bot ở developer portal — **blocked**, needs user (xem Blockers)
- [ ] Invite bot vô server với perms từ CLAUDE.md — **blocked**, needs user
- [x] Folder structure theo CLAUDE.md
- [x] `src/index.ts`: connect, log "ready" (+ SIGTERM/SIGINT graceful shutdown skeleton)
- [ ] Test connect: `npm run dev` — **blocked** on Discord token

### Acceptance criteria
- `npm run dev` → bot online ở server, log "Logged in as <name>"
- `npm run lint` pass
- `npm run typecheck` pass

### Prompt template
```
Đọc CLAUDE.md và SPEC.md. Bắt đầu Phase 0 trong PROGRESS.md.

Yêu cầu:
- Setup project Node.js + TypeScript strict mode
- Cài deps theo CLAUDE.md (lưu ý: KHÔNG cài better-sqlite3 hay Prisma — dùng custom storage)
- Folder structure theo CLAUDE.md
- src/index.ts: tạo Discord client, login, log ready event
- package.json scripts: dev, build, lint, typecheck

Khi xong: update PROGRESS.md, tick checkboxes, đổi status sang done.
Báo lại user verify trước khi sang Phase 1.
```

---

## Phase 1 — Storage layer (CUSTOM, no SQL/NoSQL libraries)

**Status:** `todo`
**Estimated complexity:** L (2-3 ngày)
**Goal:** Build custom in-memory + WAL + snapshot storage from scratch. Đây là phase phức tạp nhất ở foundation, làm cẩn thận.

### Tasks
- [ ] `src/db/types.ts` — toàn bộ entity types (xem SPEC.md 6.2)
- [ ] `src/db/operations.ts` — `StoreOp` union type (SPEC.md 6.3)
- [ ] `src/db/append-log.ts` — `AppendOnlyLog` class (SPEC.md 6.4)
  - [ ] append() với mutex + optional fsync
  - [ ] replay() async iterator, skip corrupt lines với warn
  - [ ] truncate()
- [ ] `src/db/collection.ts` — `Collection<T>` (SPEC.md 6.5)
  - [ ] Public API: set, delete, incr, get, has, query, all, count
  - [ ] Internal: _applySet, _applyDelete, _applyIncr, _bulkLoad, _serialize
- [ ] `src/db/append-only-collection.ts` (SPEC.md 6.6)
- [ ] `src/db/singleton-collection.ts` (SPEC.md 6.8)
- [ ] `src/db/store.ts` — `Store` orchestrator (SPEC.md 6.7)
  - [ ] init(): load snapshot + replay WAL + start snapshot timer
  - [ ] snapshot(): atomic write tmp + rename + truncate WAL
  - [ ] shutdown(): clear timer + final snapshot
  - [ ] Graceful signal handler (SIGTERM, SIGINT) trong `src/index.ts`
- [ ] `src/db/index.ts` — export singleton `store` instance
- [ ] `src/db/queries/users.ts` — helper functions cho user lookups
- [ ] `src/db/queries/xp.ts` — xp log helpers (recent_n_days, by_source)
- [ ] `src/db/queries/leaderboard.ts` — top N, weekly leaderboard
- [ ] `src/config/env.ts` — zod validate env
- [ ] `src/config/cultivation.ts` — 10 cảnh giới definitions
- [ ] `src/config/channels.ts` — channel name → id map (lazy init)
- [ ] `src/config/server-structure.ts` — full structure cho sync
- [ ] `src/config/verification.json` + zod schema parser
- [ ] `src/utils/logger.ts` — pino setup với pretty trong dev
- [ ] `src/utils/rate-limiter.ts` — Map-based per-user rate limiter

### Test tasks (CRITICAL cho storage layer)
- [ ] Vitest: collection set + get
- [ ] Vitest: collection incr atomic
- [ ] Vitest: WAL replay từ snapshot → state đúng
- [ ] Vitest: snapshot → reload → state đúng
- [ ] Vitest: simulate crash (no shutdown call) → replay khôi phục được
- [ ] Vitest: append-only collection
- [ ] Vitest: corrupt WAL line → skip không crash
- [ ] Manual: xp formula reference points khớp với SPEC

### Acceptance criteria
- `npm run test` pass tất cả storage tests
- Store start với empty data dir → init thành công
- Store start với existing snapshot → load đúng state
- Store start với snapshot + WAL → replay đúng order
- Kill bot bằng `kill -9` (no graceful shutdown), restart → data không mất
- Memory footprint với 10k user dummy: < 200MB
- Snapshot 10k user: hoàn thành < 500ms

### Prompt template
```
Đọc CLAUDE.md + SPEC.md section 6 (Storage architecture) chi tiết. Implement Phase 1.

CRITICAL — đây là foundation cho cả bot, làm chậm và đúng:

1. Implement đúng pattern WAL + Snapshot, không simplify
2. Mọi write phải qua mutex (async-mutex) để tránh race trên WAL file
3. Snapshot phải atomic: write tmp file → rename (POSIX rename atomic)
4. Replay phải skip corrupt lines (log warn), không crash
5. SingletonCollection cho raid_state
6. AppendOnlyCollection cho xp_logs, automod_logs (high volume)
7. Test crash recovery RẤT KỸ — đây là core value của design này

Không xài:
- better-sqlite3, sqlite3, kysely
- prisma, drizzle, typeorm
- lowdb, nedb, mongoose
- json-server, levelup

Test cases bắt buộc pass:
- set → get cùng giá trị
- set → snapshot → load fresh store → get cùng giá trị
- set → snapshot → set lần 2 → simulate crash (no shutdown) → load → cả 2 set restored
- incr atomic không bị race với 100 parallel calls
- Corrupt 1 line giữa WAL → các line khác vẫn replay được

Sau khi xong: update PROGRESS.md với test results, performance numbers (memory, snapshot time).
```

---

## Phase 2 — Server sync (idempotent setup)

**Status:** `todo`
**Estimated complexity:** M (1 ngày)
**Goal:** Script tạo/sync channel + role + permission từ config.

### Tasks
- [ ] `scripts/sync-server.ts` — main sync logic
- [ ] Sync roles: create nếu chưa có, update color/perm nếu khác
- [ ] Sync categories
- [ ] Sync channels under category
- [ ] Sync permission overwrites (SPEC.md 5.3)
- [ ] `scripts/deploy-commands.ts` — register slash commands
- [ ] `--dry-run` flag
- [ ] NPM script: `npm run sync-server`, `npm run deploy-commands`
- [ ] Test trên dev guild

### Acceptance criteria
- Chạy lần 1 trên empty server → structure xuất hiện đúng
- Chạy lần 2 → không duplicate, no error
- Permission overwrites khớp matrix SPEC.md 5.3
- Bot không tự xóa channel/role có sẵn

### Prompt template
```
Đọc SPEC.md section 5. Implement Phase 2.

CRITICAL:
- Idempotent: chạy nhiều lần safe
- KHÔNG xóa gì cả, chỉ create + update
- Permission overwrites đúng matrix
- Test --dry-run trước apply
- Rate limit aware: delay 500ms giữa các operation

Sau khi xong: chạy sync trên test guild, screenshot kết quả.
```

---

## Phase 3 — Verification gate (CRITICAL)

**Status:** `todo`
**Estimated complexity:** L (2-3 ngày)
**Goal:** Multi-layer verification chống bot raid + member filter.

### Tasks
- [ ] `src/modules/verification/audit.ts` — Layer 1 (age, avatar, username pattern)
- [ ] `src/modules/verification/captcha-math.ts` — math problem generator + verify
- [ ] `src/modules/verification/captcha-image.ts` — image captcha với node-canvas (SPEC.md 4.3)
- [ ] `src/modules/verification/flow.ts` — orchestrator
- [ ] `src/modules/verification/raid.ts` — raid detection + auto-mode
- [ ] `src/events/guildMemberAdd.ts` — entry: assign quarantine, initiate flow
- [ ] `src/events/messageCreate.ts` — handle DM reply cho captcha
- [ ] Button interaction handler cho fallback (DM closed)
- [ ] Cleanup cron job: expire pending verifications
- [ ] Slash command `/raid-mode`
- [ ] Manual test cases:
  - [ ] Account < 1 ngày: auto-kick
  - [ ] Account 3 ngày + avatar: hard captcha
  - [ ] Account > 7 ngày + avatar: standard captcha
  - [ ] DM closed: fallback button work
  - [ ] Fail 3 lần: kick
  - [ ] Timeout 5 min: kick
  - [ ] Pass: grant Phàm Nhân
  - [ ] 10 join trong 60s: raid mode enable

### Acceptance criteria
- Alt account verify được end-to-end
- Image captcha đọc được mắt thường, OCR không trivial
- Tất cả branch có error handling
- Verification logged vào `store.verifications`
- Raid mode tự bật khi spam join

### Prompt template
```
Đọc SPEC.md section 4 chi tiết. Implement Phase 3.

Lưu ý:
- DM có thể bị block → cần fallback button trong #xác-minh
- Image captcha: dùng node-canvas, font dày, noise vừa phải
- Verification state lưu trong store.verifications, cleanup expired
- KHÔNG grant Phàm Nhân quá sớm
- Edge case: bot mất permission → log error, alert admin
- Test bằng alt account
```

---

## Phase 4 — Leveling core

**Status:** `todo`
**Estimated complexity:** L (2 ngày)
**Goal:** XP engine, cooldown, level up, role swap.

### Tasks
- [ ] `src/modules/leveling/engine.ts` — pure functions (xpToNext, levelFromXp)
- [ ] `src/modules/leveling/cooldown.ts` — Map-based cooldown
- [ ] `src/modules/leveling/tracker.ts` — award XP (use `store.users.incr` + `store.xpLogs.append`)
- [ ] `src/modules/leveling/rank-promoter.ts` — check level → tìm rank mới → swap role
- [ ] `src/events/messageCreate.ts` — message XP (SPEC.md section 10)
- [ ] `src/events/voiceStateUpdate.ts` — voice session tracking
- [ ] `src/events/messageReactionAdd.ts` — reaction XP
- [ ] `src/commands/rank.ts` — `/rank` embed
- [ ] `src/commands/leaderboard.ts` — `/leaderboard`
- [ ] `src/commands/daily.ts` — `/daily` + streak logic
- [ ] Channel #đột-phá: post embed khi level up + announce đột phá cảnh giới

### Acceptance criteria
- Spam 5 message liên tục: chỉ 1 message earn XP (60s cooldown)
- Voice 2+ người 5 phút: ~50 XP
- Voice "Working" 5 phút: ~75 XP
- Level up trigger embed
- Đột phá Phàm Nhân → Luyện Khí: role swap, announce
- `/rank` đúng XP, level, progress bar
- `/leaderboard` top 10 đúng order

### Prompt template
```
Đọc SPEC.md section 2, 3, 7, 8.1, 10. Implement Phase 4.

CRITICAL:
- Cooldown 60s/user HARD CODED
- XP increment dùng store.users.incr() (atomic, race-safe)
- Mỗi XP award MUST log vào store.xpLogs.append()
- Role swap dùng GuildMember.roles.set([...newRoles]) (atomic)
- Embed tiếng Việt

Test edge cases:
- Message < 5 char
- Emoji-only
- Channel trong NO_XP_CHANNELS
- Bot message
- Voice solo
- Voice AFK channel
```

---

## Phase 5 — Automod

**Status:** `todo`
**Estimated complexity:** M (1-2 ngày)
**Goal:** Rule-based automod.

### Tasks
- [ ] `src/modules/automod/rules/` folder
- [ ] `profanity.ts` — list-based filter
- [ ] `mass-mention.ts` — > 5 mention/message
- [ ] `link-whitelist.ts` — non-whitelist link
- [ ] `spam-detection.ts` — similar messages
- [ ] `caps-lock.ts` — > 70% uppercase + > 10 char
- [ ] `src/modules/automod/engine.ts` — chain rules
- [ ] `src/modules/automod/actions.ts` — delete, warn, timeout, kick
- [ ] Log mọi action `store.automodLogs.append()` + post `#nhật-ký-tông-môn`
- [ ] Admin command `/automod-config` view rules

### Acceptance criteria
- Profanity: delete + DM warn
- Mass mention 10 user: delete + timeout 10 min
- Spam 6 message giống: timeout 5 min, revert XP earned
- Tất cả action có log

### Prompt template
```
Đọc SPEC.md section 8.3. Implement Phase 5.

Approach:
- Data-driven rules: 1 file = 1 rule
- Engine chain qua rules, return first match
- Profanity list tách JSON (configurable không cần redeploy)
- Tiếng Việt + English profanity

DO NOT:
- Hard-code rules trong engine
- Take action on admin/mod
- Take action on bot
```

---

## Phase 6 — Welcome, reaction roles, scheduler

**Status:** `todo`
**Estimated complexity:** M (1-2 ngày)
**Goal:** Quality-of-life features + scheduling foundation.

### Tasks
- [ ] `src/modules/welcome/index.ts` — welcome khi verified
- [ ] `src/modules/reactionRoles/index.ts` — generic handler
- [ ] Reaction roles cho sub-titles ở `#hướng-dẫn-tu-luyện`
- [ ] `src/modules/scheduler/index.ts` — cron registry
- [ ] Job: daily check-in reset (00:00 VN)
- [ ] Job: weekly leaderboard Sunday 20:00 VN
- [ ] Job: inactive thread archive mỗi 4h
- [ ] Job: cleanup expired verifications hourly
- [ ] Job: **backup to GitHub** daily 00:00 VN
- [ ] `src/commands/title.ts` — `/title` alternative

### Acceptance criteria
- Member verify xong → welcome auto
- React ⚔️ → role Kiếm Tu
- Weekly leaderboard tự post Sunday
- Reaction roles survive bot restart
- Backup script push thành công lên GitHub (test với private repo)

### Prompt template
```
Đọc SPEC.md section 8.4 + 6.9 (Backup strategy). Implement Phase 6.

Reaction roles approach:
- Bot post 1 message với 4 reactions
- Lưu message ID config (file hoặc store)
- On reaction → check message ID → toggle role
- Survive restart

Backup:
- Dùng simple-git library
- Clone backup repo lần đầu, sau pull + commit + push
- Token trong env (GitHub PAT scope: repo only, no other perms)
- Test backup chạy thật, verify file lên GitHub
```

---

## Phase 7 — Tribulation events

**Status:** `todo`
**Estimated complexity:** M (1-2 ngày)
**Goal:** Random mini-game cho member level ≥ 10.

### Tasks
- [ ] `src/modules/events/tribulation.ts` — orchestrator
- [ ] `src/modules/events/games/math-puzzle.ts`
- [ ] `src/modules/events/games/reaction-speed.ts`
- [ ] Random trigger via scheduler (25% daily 18-22h VN)
- [ ] Pick eligible: level ≥ 10, online, not AFK
- [ ] Post in `#độ-kiếp` với Button components
- [ ] 30s timer + timeout handle
- [ ] Reward XP, log event in `store.events.set()`
- [ ] `/breakthrough` self-trigger (24h cooldown)

### Acceptance criteria
- Event tự trigger random
- Member level < 10 không pick
- Cooldown 24h server-wide
- Pass: +500 XP, fail: -100 XP (floor không xuống dưới level threshold)
- Embed đẹp, có suspense

### Prompt template
```
Đọc SPEC.md section 8.5. Implement Phase 7.

Game design:
- Math puzzle: 3+5*2, difficulty by level
- Reaction speed: 5 emoji, click 🐉 trong 5s

Suspense vibe (tiếng Việt):
- Embed mô tả Thiên Kiếp (sấm sét, lightning emoji)
- Delay 2s giữa các message để build tension
- Win/lose embed màu khác (gold vs đỏ)

Don't:
- Trigger nhiều event 1 lúc
- Quên cooldown check
- Quên log event
```

---

## Phase 8 — Deployment & monitoring

**Status:** `todo`
**Estimated complexity:** M (1 ngày)
**Goal:** Production deploy trên Oracle Cloud.

### Tasks
- [ ] `ecosystem.config.cjs` — PM2 config
- [ ] `scripts/health-check.ts` — `/health` HTTP endpoint cho UptimeRobot
- [ ] Setup Oracle Cloud VM (SPEC.md 9.1)
- [ ] Install deps + clone repo + deploy
- [ ] PM2 startup script enable
- [ ] UptimeRobot account + monitor
- [ ] Error webhook → `#nhật-ký-tông-môn` khi error spike
- [ ] Document deploy + recovery steps trong README.md
- [ ] Test recovery: nuke VM, spin mới, restore từ GitHub backup → verify state

### Acceptance criteria
- Bot 24/7 trên VM, no crash
- VM restart → PM2 auto-resume
- Backup file ở GitHub daily
- UptimeRobot ping success
- Stress: 100 message/min không drop XP tracking
- Recovery: delete data dir → start bot với backup → state khôi phục

### Prompt template
```
Đọc SPEC.md section 9. Phase này nhiều infra hơn code.

Manual steps (user):
- Tạo Oracle Cloud account
- Spin VM ARM A1 Flex
- SSH setup

Claude Code:
- PM2 ecosystem config
- Health-check endpoint
- Deploy guide chi tiết trong README.md
- Recovery test script

Critical:
- TEST RECOVERY: nuke data dir, restore từ GitHub, verify state
- Stress test 100 msg/min: verify no data loss
```

---

## Phase 9 — Polish & launch

**Status:** `todo`
**Estimated complexity:** S (1 ngày)
**Goal:** Final polish.

### Tasks
- [ ] Review user-facing text (Việt tự nhiên)
- [ ] Test verification e2e với 3 alt accounts khác profile
- [ ] Stress test: 50 member join trong 5 min
- [ ] Tune anti-raid threshold theo test
- [ ] Admin runbook (top 5 issue scenarios)
- [ ] Permission audit (bot không Administrator nữa)
- [ ] Soft launch 10-20 trusted user
- [ ] Collect feedback, fix bug
- [ ] Open public

### Acceptance criteria
- Soft launch không complain bug critical
- Bot uptime > 99% trong 1 tuần
- Không có XP exploit
- Admin runbook đầy đủ

---

## Blockers / Notes

### Phase 0 blockers
- **need Discord bot token + IDs** — to finalize `npm run dev` smoke test. User needs to:
  1. Go to https://discord.com/developers/applications → New Application → "Radiant Tech Sect Bot"
  2. Bot tab → Reset Token → copy into `.env` as `DISCORD_TOKEN`
  3. General Information → copy Application ID → `.env` as `DISCORD_CLIENT_ID`
  4. Enable **Privileged Gateway Intents**: SERVER MEMBERS, MESSAGE CONTENT, PRESENCE (optional)
  5. OAuth2 → URL Generator → scopes: `bot` + `applications.commands` → bot perms per CLAUDE.md (Manage Roles, Manage Channels, Kick, Ban, Manage Messages, Read/Send Messages, Embed Links, Add Reactions) → use generated URL to invite bot to test server
  6. Right-click your test server → Copy Server ID → `.env` as `DISCORD_GUILD_ID`
  7. `cp .env.example .env` then fill values
  8. `npm run dev` → should log `"logged in"` with the bot tag

- **git not initialized yet** — repo is plain dir. Will run `git init` + first commit at end of Phase 0 work; user can decide later whether to push to a remote.

---

## Decision log

- **2026-05-13**: Theme chỉ tiếng Việt, không Hán tự. (Bill quyết)
- **2026-05-13**: Verification multi-layer required vì public server. (Bill quyết)
- **2026-05-13**: Storage = custom WAL + Snapshot pattern, KHÔNG SQL/NoSQL library. (Bill quyết)
- **2026-05-13**: Backup via GitHub private repo nightly để decouple data khỏi VM cụ thể.
- **2026-05-13**: Oracle Cloud Always Free cho host vì cần stateful bot (WebSocket).
- **2026-05-13** (Phase 0): `package.json` ghi tay thay vì `npm init -y` để có sẵn scripts đúng (dev/build/typecheck/lint/test/sync-server/deploy-commands) và `"type": "module"` cho ESM.
- **2026-05-13** (Phase 0): Bootstrap pre-Phase-1 minimal versions của `src/config/env.ts` (zod) và `src/utils/logger.ts` (pino + pino-pretty trong dev) để `bot.ts` compile. Phase 1 sẽ refine (full env schema, log redaction, etc).
- **2026-05-13** (Phase 0): Intents include `MessageContent`, `GuildMembers`, `GuildMessageReactions`, `GuildVoiceStates`, `DirectMessages` (cần cho XP, verification DM, automod). Partials: `Channel`, `Message`, `Reaction` để nhận DM event và uncached reaction.
- **2026-05-13** (Phase 0): Thêm `tsconfig.build.json` riêng để prod build chỉ emit `src/`, exclude tests/scripts.

---

## Quick reference

| Cần | File |
|---|---|
| Cách work với CC | `CLAUDE.md` |
| Architecture chi tiết | `SPEC.md` |
| **Storage layer design** | **`SPEC.md` section 6** |
| Phase đang làm | section in_progress file này |
| Cảnh giới definitions | `SPEC.md` section 2 |
| Verification flow | `SPEC.md` section 4 |
| Channel structure | `SPEC.md` section 5 |
| Deployment + recovery | `SPEC.md` section 9 |
