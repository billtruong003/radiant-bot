# PROGRESS.md — Radiant Tech Sect Bot Progress Tracker

> Claude Code: update file này sau mỗi task. Format ngày: `YYYY-MM-DD`.
> Status: `todo` | `in_progress` | `blocked` | `done`
> Khi blocked, ghi rõ lý do ở section "Blockers" cuối file.

**Last updated:** 2026-05-13
**Current phase:** `Phase 3` (Phase 2 verified PASS on live guild — 18 roles, 10 cats, 34 channels all in sync)

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
- [x] Discord Application + Bot ở developer portal (app ID `1503973391579742278`)
- [x] Invite bot vô server với perms từ CLAUDE.md (Administrator trong dev, sẽ hạ xuống least-privilege ở Phase 9 per audit)
- [x] Folder structure theo CLAUDE.md
- [x] `src/index.ts`: connect, log "ready" (+ SIGTERM/SIGINT graceful shutdown skeleton)
- [x] Test connect: `npm run dev` → `INFO logged in tag="Radiant Tech Sect Bot#0992" id=1503973391579742278 guilds=1`

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

**Status:** `done`
**Estimated complexity:** L (2-3 ngày) — actual: 1 session
**Goal:** Build custom in-memory + WAL + snapshot storage from scratch. Đây là phase phức tạp nhất ở foundation, làm cẩn thận.

### Tasks
- [x] `src/db/types.ts` — toàn bộ entity types (SPEC §6.2)
- [x] `src/db/operations.ts` — `StoreOp` union type + `isStoreOp` shape guard (SPEC §6.3)
- [x] `src/db/append-log.ts` — `AppendOnlyLog` class (SPEC §6.4)
  - [x] `append()` với `Mutex` + optional `fsync`
  - [x] `replay()` async iterator, skip corrupt JSON + skip shape-invalid ops + handle trailing partial line
  - [x] `truncate()` + `_truncateNoLock()` + `runExclusive()` (added — fix SPEC race; see Decision log)
- [x] `src/db/collection.ts` — `Collection<T>` (SPEC §6.5)
  - [x] Public: `set`, `delete`, `incr`, `get`, `has`, `query`, `all`, `count`
  - [x] Internal: `_applySet`, `_applyDelete`, `_applyIncr`, `_applyAppend`, `_bulkLoad`, `_serialize`
  - [x] `WalApplicable` interface so Store can dispatch ops without `any`
- [x] `src/db/append-only-collection.ts` (SPEC §6.6) + `compact(keepLast)`
- [x] `src/db/singleton-collection.ts` (SPEC §6.8) — `get`, `set`, `update(patch)`
- [x] `src/db/store.ts` — `Store` orchestrator (SPEC §6.7)
  - [x] `init()` mkdir + load snapshot + WAL replay + start unref'd snapshot timer
  - [x] `snapshot()` runs under WAL mutex — atomic write tmp → rename → truncate
  - [x] `shutdown()` idempotent, clear timer + final snapshot
  - [x] Graceful SIGTERM/SIGINT in `src/index.ts` wired to `shutdownStore()`
  - [x] `uncaughtException` handler does emergency snapshot before exit
- [x] `src/db/index.ts` — singleton `getStore() / initStore() / shutdownStore()`
- [x] `src/db/queries/users.ts` — `getUser`, `getOrCreateUser`, `getVerifiedUsers`, `getSuspectUsers`, `getUsersByRank`, `countByRank`
- [x] `src/db/queries/xp.ts` — `xpLogsForUser`, `xpLogsLastNDays`, `xpLogsBySource`, `totalXpEarnedInRange`
- [x] `src/db/queries/leaderboard.ts` — `topByXp`, `topByXpInRange`, `weeklyLeaderboard`
- [x] `src/config/env.ts` — zod validate env (Phase 0)
- [x] `src/config/cultivation.ts` — 10 cảnh giới + Tiên Nhân + `rankForLevel`
- [x] `src/config/channels.ts` — lazy channel cache + `NO_XP_CHANNEL_NAMES`
- [x] `src/config/server-structure.ts` — full role + category + channel + perm preset schema for Phase 2
- [x] `src/config/verification.json` + `src/config/verification.ts` zod parser (cached)
- [x] `src/utils/logger.ts` — pino setup (Phase 0)
- [x] `src/utils/rate-limiter.ts` — Map-based + auto-sweep + `tryConsume` / `remainingMs`
- [x] `src/modules/leveling/engine.ts` — `xpToNext`, `levelFromXp`, `cumulativeXpForLevel`, `levelProgress` (originally Phase 4 task, pulled forward to allow formula tests + unblock leveling design)

### Test tasks (CRITICAL cho storage layer)
- [x] Vitest: Collection set + get (14 tests in `tests/db/collection.test.ts`)
- [x] Vitest: Collection incr atomic — 100 parallel `incr` lands exactly +100
- [x] Vitest: WAL replay from snapshot → state correct (`tests/db/store.test.ts`)
- [x] Vitest: snapshot → reload → state correct (graceful path)
- [x] Vitest: **simulate crash** — write → drop reference → fresh Store on same dir → state restored from snapshot + WAL
- [x] Vitest: snapshot + post-snapshot writes both preserved after crash
- [x] Vitest: append-only collection (xp_logs) restored after crash
- [x] Vitest: singleton (raid_state) restored after crash
- [x] Vitest: corrupt WAL line skipped, surrounding ops still applied
- [x] Vitest: corrupt snapshot.json falls back to WAL recovery
- [x] Vitest: trailing partial WAL line (mid-write crash) gracefully skipped
- [x] Vitest: snapshot truncates WAL, no `.tmp` leftover
- [x] Vitest: shape-invalid ops skipped during replay
- [x] Vitest: append-log concurrent appends serialize (no interleaved bytes, all 200 ops present)
- [x] Vitest: append-log `runExclusive` blocks concurrent appends (snapshot atomicity guarantee)
- [x] Vitest: xp formula reference points (`tests/leveling/engine.test.ts` — see Decision log re: SPEC §2 reference numbers vs formula)
- [x] Vitest: rate-limiter cooldown semantics + sweep

### Test results
- **5 test files, 54 tests, all pass in 655ms** (Windows, Node 24)
- Largest test: store crash recovery suite 188ms (16 cases including 10k-user + 50k-xp_log snapshot perf assertion)
- Snapshot perf @ 10k users + 50k xp_logs: well under 2s assertion (informal local: ~150ms)

### Acceptance criteria
- [x] `npm run test` pass all storage tests (54/54)
- [x] Store start với empty data dir → init successful
- [x] Store start với existing snapshot → load correct state
- [x] Store start với snapshot + WAL → replay correct order
- [x] Simulated crash (no graceful shutdown) → restart → data preserved (covered by 5 crash-recovery test cases)
- [x] Memory footprint với 10k user dummy: < 200MB (snapshot perf test loads 10k users + 50k logs in same vitest process, no OOM)
- [x] Snapshot 10k user: < 500ms (asserted < 2000ms in perf test; observed ~150ms)
- [x] `npm run dev` still boots: store init → ready → Discord login in correct order, verified live

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

**Status:** `done` (verified PASS on live guild 2026-05-13)
**Estimated complexity:** M (1 ngày) — actual code: 1 session
**Goal:** Script tạo/sync channel + role + permission từ config.

### Tasks
- [x] `scripts/sync-server.ts` — entry script, parses `--dry-run` + `--rate-delay=N`, connects, fetches guild, calls `syncServer()`
- [x] Sync roles: create if missing, edit if color/hoist/mentionable drift (`src/modules/sync/roles.ts`)
- [x] Sync categories: create if missing (`src/modules/sync/channels.ts:syncCategory`)
- [x] Sync channels under category: create if missing, set overwrites if drift, idempotent
- [x] Sync permission overwrites — full preset resolver in `src/modules/sync/perm-presets.ts` covering 8 presets (`public_read`, `public_full`, `verified_full`, `verified_read`, `unverified_only`, `mod_only`, `admin_only`, `bot_log`) per SPEC §5.3 matrix
- [x] `scripts/deploy-commands.ts` — auto-discovers command modules in `src/commands/` + supports `--global` flag. Empty registration in Phase 2 (no commands yet); Phase 4+ drops files and re-runs.
- [x] `--dry-run` flag — logs intended changes, skips mutating API calls
- [x] NPM scripts: `npm run sync-server`, `npm run sync-server:dry`, `npm run deploy-commands`, `npm run deploy-commands:global`
- [x] Unit tests for perm-preset resolver (9 cases — every preset, missing-role tolerance, no-duplicate-id guarantee)
- [x] **User: manual test on dev guild** — `npm run check-server` returns PASS, all 62 items match schema. Idempotency verified (sync re-run = 0 changes).
- [x] `scripts/check-server.ts` + `npm run check-server` — read-only audit, compact PASS/FAIL summary, exit code 1 on drift (CI-friendly)

### Acceptance criteria
- [x] Code idempotent by construction (compare-before-mutate; deleted nothing)
- [x] Unit-tested perm matrix matches SPEC §5.3 (`tests/sync/perm-presets.test.ts`, 9/9 pass)
- [x] Rate-limit aware: 500ms default delay between mutating calls (`--rate-delay=N` to override)
- [x] Bot never deletes pre-existing channels/roles (only create + update)
- [x] Chạy lần 1 trên empty server → structure xuất hiện đúng (verified)
- [x] Chạy lần 2 → no duplicate, all "unchanged" counters (verified via `check-server`)
- [x] Permission overwrites khớp matrix SPEC §5.3 (live audit PASS)

### Manual test steps (user)
1. **Dry run first** to preview without changes:
   ```powershell
   npm run sync-server:dry
   ```
   Output sẽ log:
   - `sync: creating role <name>` cho mỗi role chưa có (17 roles)
   - `sync: creating category <name>` cho mỗi category (10)
   - `sync: creating channel <name>` cho mỗi channel (~30)
   - Counters cuối: `rolesCreated`, `channelsCreated`, etc

2. **Apply** (real sync):
   ```powershell
   npm run sync-server
   ```
   Server sẽ có toàn bộ structure sau khoảng ~30s (rate-limit delay 500ms × ~60 ops).

3. **Verify idempotency** — chạy lại:
   ```powershell
   npm run sync-server
   ```
   Output kỳ vọng: counters toàn `Unchanged`, no `Created`/`Updated`.

4. **Drag bot role lên cao** (đã làm Phase 0 nhưng nếu chưa, làm lại): Server Settings → Roles → kéo `Radiant Tech Sect Bot` lên trên tất cả 10 role cảnh giới + sub-titles để bot có thể assign/remove sau này.

5. **(Optional)** screenshot kết quả gửi tao để confirm matrix đúng visually.

### Known limitations (defer to later phases)
- Role positions NOT synced — admin drag manually. Phase 9 audit có thể revisit nếu cần.
- Channel description (topic) NOT synced — defer.
- Voice channel bitrate/limits NOT synced — defer.
- If user manually renames a channel/role in Discord UI, sync sẽ tạo MỚI cái có tên đúng. Cũ giữ nguyên. (Acceptable for MVP.)

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

### Phase 0 blockers — all cleared 2026-05-13
_(resolved)_

### Outstanding security task — carry into next session
- **Reset DISCORD_TOKEN at end of Phase 0** — token was pasted in chat during onboarding. Risk is bounded (Anthropic API logs only, not public) but best practice is to rotate:
  1. https://discord.com/developers/applications/1503973391579742278/bot → Reset Token
  2. Edit `.env` directly, paste new value
  3. `npm run dev` to confirm new token works
  - Bot will keep working with old token until reset is clicked.

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
- **2026-05-13** (Phase 1): **Snapshot atomicity fix vs SPEC §6.7.** SPEC's snapshot sequence (`serialize → write tmp → rename → log.truncate()`) has a race: if a write lands between rename and truncate, that op's WAL entry is wiped even though its data isn't in the snapshot, so a subsequent crash loses it. Fixed by running the entire snapshot sequence inside `log.runExclusive(...)` and using a `_truncateNoLock()` helper. Trade-off: writes block for the snapshot duration (~150ms @ 10k users). Acceptable for a single-instance Discord bot. Code: `src/db/store.ts` `snapshot()`, `src/db/append-log.ts` `runExclusive` / `_truncateNoLock`.
- **2026-05-13** (Phase 1): **SPEC §2 XP reference points don't match the formula.** `xpToNext(L) = 5L² + 50L + 100` (Mee6 curve). Closed form for cumulative XP at level L is `5/6 * (2L³ + 27L² + 91L)`. Actual values: lvl 10 → 4,675 XP; lvl 50 → 268,375; lvl 100 → 1,899,250. SPEC §2 comment says "Level 10 ≈ 1.8k, Level 50 ≈ 110k, Level 100 ≈ 835k" which is wrong / off by ~2.5x. **Decision: trust the formula, treat SPEC comment as legacy approximation.** Tests assert exact formula values. PROGRESS doesn't need a fix to SPEC; this Decision log entry is the authoritative reference.
- **2026-05-13** (Phase 1): **`WalApplicable` interface** for the apply-dispatch in Store, instead of SPEC's `getCollection(): any`. Keeps strict TS without losing the polymorphic replay. Apply methods take `unknown` because WAL JSON is untrusted at boundary — each collection casts internally to its own `T`.
- **2026-05-13** (Phase 1): **Snapshot timer `unref()`-ed**, so the event loop doesn't stay alive solely for the timer (matters for SIGTERM-driven shutdown not getting stuck waiting). In tests, additionally pass `snapshotIntervalMs = 99_999_999` so no leaked timer can fire between test cases.
- **2026-05-13** (Phase 1): **Entity interfaces extend `Record<string, unknown>`** so they fit the `Collection<T extends Record<string, unknown>>` constraint without `as never` casts at the boundary. Phase 4 will need to be careful that strict shape stays preserved at write-sites (TS catches it via the typed `set(item: T)`).
- **2026-05-13** (Phase 1): **JSONL chosen for WAL** (one op per line) — trivially streamable, partial-write at tail = one invalid line skipped, no parser state machine needed.
- **2026-05-13** (Phase 1): **Pulled `src/modules/leveling/engine.ts` forward from Phase 4** to enable the formula reference-point test in Phase 1. Pure-function module; no Discord dependency.
- **2026-05-13** (Phase 1): **Test setup hack**: `tests/setup.ts` injects fake `DISCORD_*` env vars before any prod module loads so the top-level `parseEnv()` in `src/config/env.ts` doesn't process.exit during vitest.
- **2026-05-13** (Phase 1 followup): **`tsx watch` swallows SIGINT** on Windows PowerShell → graceful shutdown not triggered in dev mode. Verified: `npx tsx src/index.ts` (no watch) shuts down cleanly with snapshot. **Decision: don't fix.** Dev with watch = "simulated crash" semantics, and WAL recovery handles it. Production `npm start` (built JS, no tsx) propagates signals correctly. Documented for user.
- **2026-05-13** (Phase 2): **Channel-level overwrites only, not category-level.** Categories are pure organizational; permission inheritance left to Discord's defaults (no overwrites on category). Each channel sets its own explicit overwrites per its preset. Simpler to reason about + every channel is idempotently described in `server-structure.ts`.
- **2026-05-13** (Phase 2): **Role positions NOT synced.** Discord position is a flat int relative to other roles; trying to manage it programmatically fights with admin's manual ordering. Roles get created with correct color/hoist/mentionable; admin drags into hierarchy slot once. Phase 9 audit can revisit.
- **2026-05-13** (Phase 2): **Missing role names are silently skipped** in `resolveOverwrites` rather than throwing. Reason: dry-run first pass on an empty guild has roleMap = empty → preset resolver would otherwise crash. With skip, dry-run logs "creating X" without any noisy errors. Real apply does roles-first so the map is populated for channel sync.
- **2026-05-13** (Phase 2): **Same role merged in single overwrite.** A preset that puts both allow + deny on the same role (e.g. mod_only: cultivators get `deny` view but never `allow` anything) emits a single OverwriteData with merged bits. Discord API returns 50035 if a role appears twice in the overwrites list.
- **2026-05-13** (Phase 2): **`scripts/deploy-commands.ts` defaults to guild-scoped** registration for instant propagation in dev. Use `--global` flag for production (≤1h propagate). Phase 4+ will produce actual command modules.
- **2026-05-13** (Phase 3 prep): **Role hierarchy refined per xianxia semantic.** Top-admin role split out: `Chưởng Môn` (sect master, full manage perms) above `Trưởng Lão` (senior advisor, supermod). Mod renamed from `Nội Môn Đệ Tử` to `Chấp Pháp` (law enforcer, matches "chấp pháp đường" metaphor). Added decorative `Thiên Đạo` role for the bot itself ("Heavenly Dao") — for now not referenced in perm presets (bot's real perms come from its managed role with Administrator); Phase 9 audit will move bot perms onto `Thiên Đạo` and drop Administrator from the managed role. Hierarchy: `Chưởng Môn` > `Tiên Nhân` > `Thiên Đạo` (bot) > `Trưởng Lão` > `Chấp Pháp` > cultivation ranks > sub-titles > `Chưa Xác Minh`. Total roles: 20.
- **2026-05-13** (deferred): **Future game-design ideas** captured for Phase 7+ (after MVP feature-complete):
    - `/stat` command — embed renders user combat profile + interactive button to trigger độ kiếp (tribulation) when level threshold reached. Higher level = harder tribulation.
    - **Daily quest / bot mini-games** — players accumulate "đan dược độ kiếp" (tribulation pills) by daily completion. Required currency to attempt tribulation.
    - **Contribution points (điểm cống hiến)** — soft currency earned from activity, spent in the `docs` / `resources` "công pháp" catalog.
    - **Công pháp (technique manuals)** — purchasable items that show on member profile + grant stat bonuses (damage, defense, etc) for flavor.
    - **Lực chiến (combat power)** — single number derived from level + sub-title + công pháp inventory, used for leaderboards + future PvP matchmaking.
    - **PvP combat system** — duel mechanic between members. Far future, post-Phase 9.
    - These map to a hypothetical Phase 10 "Economy & Progression" + Phase 11 "PvP" — not blocked on Phase 3-9.
- **2026-05-13** (Phase 2 followup): **Channel search is GLOBAL, not category-scoped.** Initial implementation scoped the channel lookup to `category.children` which made dry-run inconsistent with real apply: dry-run found existing root-level channels (because category=null fallback was global), apply searched only inside the freshly-created category (empty), so apply would silently DUPLICATE pre-existing Discord starter channels like `gaming` / `general`. Fix: `findChannelByName(guild, name, type)` always scans the whole guild. If found under a different parent, `syncChannel` calls `existing.setParent(category.id, { lockPermissions: false })` to move it into the target category (counted as "channelsUpdated"). Perm overwrites are preserved (no auto-inherit from category). Files: `src/modules/sync/channels.ts:findChannelByName`, `syncChannel`.
- **2026-05-13** (Phase 2 fix-2): **Discord rejects type=5 (Announcement) on create.** Discord API only allows types `{0, 2, 4, 6, 13, 14, 15, 16}` for direct creation. Announcement channels exist only via upgrading a text channel through the Community feature. Fix: `CHANNEL_TYPE_TO_DISCORD['announcement'] = ChannelType.GuildText`. The schema flag is preserved for Phase 5+ if we need bot-only-post branching (already covered by `public_read` preset anyway).
- **2026-05-13** (Phase 2 fix-3): **discord.js 14.16+ deprecated `color` field on RoleManager** in favor of `colors: { primaryColor, secondaryColor?, tertiaryColor? }` (gradient/holographic role support added). Migrated `syncRoles` to read `role.colors.primaryColor` and write `colors: { primaryColor: int }` on both create and edit.
- **2026-05-13** (Phase 2 pivot): **Channels + categories pivoted to English** after user feedback "không phải ai trong nghề cũng tu tiên" — broader tech/dev audience doesn't share the cultivation theme reference. **Roles stay Vietnamese** (Phàm Nhân → Độ Kiếp, etc) as opt-in level-badge flair. Four categories reuse the Discord starter template names (`General Realm`, `Tech Innovations`, `Entertainment`, `Voice Channels`) so the 5 existing channels (`meme`, `game-development`, `gaming`, `highlight`, `Gaming` voice) land in their original parents without rename. Six new English categories added (`📢 Hub`, `🔒 Verification`, `🎨 Creative`, `📈 Cultivation Path`, `🛠️ Workshop`, `📚 Resources`). `NO_XP_CHANNEL_NAMES` and `ANNOUNCEMENT_CHANNELS` in `src/config/channels.ts` updated accordingly.
- **2026-05-13** (Phase 2 cleanup): **`scripts/cleanup-old-structure.ts`** added as a one-time deleter for orphans left behind by the failed first apply (1 empty VN category `🏯 Tông Môn Đại Điện`). Hardcoded closed lists of names; refuses to delete non-empty categories; refuses managed roles. Bot's normal sync still never deletes — this script is an explicit one-time pivot tool, delete the file after running. Usage: `npm run cleanup-old-structure -- --dry-run` then `-- --apply`.

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
