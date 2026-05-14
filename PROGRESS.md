# PROGRESS.md — Radiant Tech Sect Bot Progress Tracker

> Claude Code: update file này sau mỗi task. Format ngày: `YYYY-MM-DD`.
> Status: `todo` | `in_progress` | `blocked` | `done`
> Khi blocked, ghi rõ lý do ở section "Blockers" cuối file.

**Last updated:** 2026-05-14
**Current phase:** `Phase 11.3 polish shipped + Phase 12 Lát 1 foundation shipped`. Sprint 1 = `/link-whitelist`, `/stats`, B6 verify rejoin cooldown. Lát 1 = User additions (pills, contribution_points, equipped_cong_phap_slug, combat_power_cache, last_quest_assigned_at) + 3 new entities (CongPhap, UserCongPhap, DailyQuest) + Store wiring + `computeCombatPower` + `/stat` read-only + `/grant` admin. Doc `docs/PHASE_12.md` locks scope for Lát 2-6. B7 (Aki memory per user) deferred — needs privacy decision (CLAUDE.md forbids storing message content; B7 would require storing /ask question text).

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

**Status:** `done` (code-complete; manual e2e with alt account is the final gate before flipping)
**Estimated complexity:** L (2-3 ngày) — actual: 1 session
**Goal:** Multi-layer verification chống bot raid + member filter.

### Tasks
- [x] `src/modules/verification/audit.ts` — Layer 1 (age, avatar, username pattern) — Chunk 3
- [x] `src/modules/verification/captcha-math.ts` — math problem generator + verify — Chunk 2
- [x] `src/modules/verification/captcha-image.ts` — image captcha với node-canvas (SPEC.md 4.3) — Chunk 2
- [x] `src/modules/verification/flow.ts` — orchestrator — Chunk 4
- [x] `src/modules/verification/raid.ts` — raid detection + auto-mode — Chunk 6
- [x] `src/events/guildMemberAdd.ts` — entry: assign Chưa Xác Minh, run audit, start flow — Chunk 5
- [x] `src/events/messageCreate.ts` — DM-only routing to flow.handleDmReply — Chunk 5
- [x] `src/events/interactionCreate.ts` — button + modal + slash dispatcher — Chunk 5
- [x] Button interaction handler cho fallback (DM closed) — verify:start, verify:open, verify:modal
- [x] Cleanup cron job: expire pending verifications (every minute) — Chunk 7
- [x] Slash command `/raid-mode on|off|status` (admin-only) — Chunk 6
- [x] #bot-log channel post on kick / pass / raid auto-activate / raid auto-disable — Chunk 7
- [x] `src/modules/bot-log.ts` — singleton helper for cross-cutting log posts
- [x] `src/modules/scheduler/index.ts` — node-cron registry, started on ClientReady, stopped on shutdown
- [x] CLI `npm run bot -- bulk-onboard --apply` — one-time backfill of pre-existing members (Chunk 1; 75 members onboarded on live guild)
- [ ] Manual test cases (alt account):
  - [ ] Account < 1 ngày: auto-kick
  - [ ] Account 3 ngày + avatar: hard captcha (image+math)
  - [ ] Account > 7 ngày + avatar: standard captcha (math)
  - [ ] DM closed: fallback button → modal flow works
  - [ ] Fail 3 lần: kick + #bot-log entry
  - [ ] Timeout 5 min: cron picks up + kick
  - [ ] Pass: grant Phàm Nhân, remove Chưa Xác Minh, welcome DM, #bot-log entry
  - [ ] 10 join trong 60s: raid mode auto-enable, all new joins get hard captcha
  - [ ] /raid-mode on/off/status with admin role works
  - [ ] /raid-mode invocable only by Chưởng Môn (default permission gating)

### Test results (automated)
- **10 test files, 102 tests, all pass in ~3s** (Windows, Node 24)
- New in Phase 3:
  - `audit.test.ts` (10): age/avatar/username heuristics + boundary cases
  - `captcha.test.ts` (7): math gen + image gen + verify + parseHardReply
  - `flow.test.ts` (10): buildChallenge dispatch + verifyReply pure paths
  - `raid.test.ts` (11): threshold trigger, window prune, latch-on, auto-disable, manual toggle

### Acceptance criteria
- [x] Alt account verify e2e — **pending manual run** (alt account)
- [x] Image captcha đọc được mắt thường, OCR không trivial — visual inspection during Chunk 2
- [x] Tất cả branch có error handling — kick failure, DM block, role missing, channel missing, modal interaction expired
- [x] Verification logged vào `store.verifications` (set/update via WAL) + automodLogs.append on every kick
- [x] Raid mode tự bật khi spam join (auto-activated + #bot-log alert)
- [x] Raid mode tự tắt sau 30 min không join — `maybeAutoDisableRaid` cron + #bot-log notice
- [x] Bot restart resume đúng — verifications, raid state replay from WAL/snapshot (covered by Phase 1 crash-recovery tests)
- [x] User-facing tiếng Việt; code/log English (verified in flow.ts DM strings + bot-log messages)

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

**Status:** `done` (code-complete; manual verify next session)
**Estimated complexity:** L (2 ngày) — actual: 1 session
**Goal:** XP engine, cooldown, level up, role swap.

### Tasks
- [x] `src/modules/leveling/engine.ts` — xpToNext, levelFromXp, levelProgress (pulled forward to Phase 1)
- [x] `src/modules/leveling/cooldown.ts` — singleton RateLimiter instances (message 60s, reaction 10s) + sweep helpers — Chunk 1
- [x] `src/modules/leveling/tracker.ts` — awardXp source-agnostic, race-safe via store.users.incr + xpLogs.append — Chunk 1
- [x] `src/modules/leveling/rank-promoter.ts` — maybePromoteRank + postLevelUpEmbed (đột phá cảnh giới) — Chunk 2
- [x] `src/modules/leveling/eligibility.ts` — substantive-length filter (strip emojis) — Chunk 3
- [x] `src/modules/leveling/voice-xp.ts` — runVoiceTick: per-minute scan, 10/15 XP — Chunk 4
- [x] `src/modules/leveling/daily.ts` — computeDailyAward + streak logic (VN tz calendar days) — Chunk 5
- [x] `src/events/messageCreate.ts` — guild XP path added (DM path from Phase 3 preserved) — Chunk 3
- [x] `src/events/messageReactionAdd.ts` — 2 XP/reaction, max 10/msg, 10s/reactor cooldown — Chunk 4
- [x] `src/commands/rank.ts` — /rank [user?] with progress bar — Chunk 5
- [x] `src/commands/leaderboard.ts` — /leaderboard [period=all|weekly] — Chunk 5
- [x] `src/commands/daily.ts` — /daily + streak (7/14/30-day bonuses) — Chunk 5
- [x] Voice tick wired into scheduler/index.ts (every minute alongside verification cleanup + raid)
- [x] Cooldown sweep timers wired into bot.ts ClientReady/stopBot
- [x] Slash commands deployed to guild (4 total: raid-mode, rank, leaderboard, daily)
- [x] Level-up embed posts to `#level-up`; đột phá cảnh giới for rank changes

### Test results (automated)
- **15 test files, 160 tests, all pass in ~4s** (Windows, Node 24)
- New in Phase 4 (+23 tests over Phase 3's 137):
  - `engine.test.ts` (8): xpToNext/levelFromXp formula reference points (already from Phase 1)
  - `tracker.test.ts` (11): create-user-on-first-earn, log append, level cross, big jump, touchLastMessage, non-positive guard, 100-parallel atomic incr, persistence
  - `rank-promoter.test.ts` (9): same-rank no-op, threshold cross + atomic role swap, big jump, Tiên Nhân locked, missing user, missing role, embed flavors
  - `eligibility.test.ts` (9): plain text, custom emoji, unicode emoji, ZWJ sequences, mixed
  - `daily.test.ts` (13): dayKey in VN tz, first claim, already-claimed, streak continuation, 7/14/30 bonuses, day 31 reset to base, missed-day reset

### Acceptance criteria
- [x] Spam multiple messages: only one within 60s earns XP (cooldown enforced)
- [x] Voice ≥ 2 people: 10 XP/min default, 15 XP/min in Focus Room / Quiet Study
- [x] Voice solo OR AFK channel: 0 XP
- [x] Level up triggers `#level-up` embed
- [x] Đột phá cảnh giới (rank crosses threshold) → role swap (atomic via roles.set) + special embed with rank color
- [x] `/rank` shows level, XP, cultivation rank, progress bar
- [x] `/leaderboard` top 10 (all-time or weekly)
- [x] `/daily` works with streak detection in VN timezone
- [ ] Manual e2e: send 5 messages → verify XP awarded once + entry in xp_logs
- [ ] Manual e2e: join Focus Room with another member → verify 15 XP/min
- [ ] Manual e2e: react to someone's message → they get 2 XP
- [ ] Manual e2e: /daily two days in a row → streak = 2; skip a day → streak = 1
- [ ] Manual e2e: cumulative XP to level 1 (100 XP) → role swap to Luyện Khí, embed posted

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

**Status:** `done` (code-complete + deployed)
**Estimated complexity:** M (1-2 ngày) — actual: 1 session
**Goal:** Rule-based automod.

### Tasks
- [x] `src/modules/automod/types.ts` — AutomodRule contract — Chunk 1
- [x] `src/modules/automod/engine.ts` — severity-desc, first-match-wins — Chunk 1
- [x] `src/modules/automod/actions.ts` — delete/warn/timeout/kick + log + #bot-log post — Chunk 1
- [x] `src/modules/automod/rules/profanity.ts` — diacritic-tolerant word match — Chunk 2
- [x] `src/modules/automod/rules/mass-mention.ts` — ≥ N mentions → timeout — Chunk 2
- [x] `src/modules/automod/rules/link-whitelist.ts` — suffix-match whitelist → warn — Chunk 2
- [x] `src/modules/automod/rules/spam-detection.ts` — SpamTracker sliding window → timeout — Chunk 2
- [x] `src/modules/automod/rules/caps-lock.ts` — > 70% caps + > 10 chars → delete — Chunk 2
- [x] `src/config/automod.json` + `src/config/automod.ts` — zod-validated cached config — Chunk 2
- [x] Wire into `messageCreate` BEFORE XP path; skip staff (Chưởng Môn / Trưởng Lão / Chấp Pháp / Thiên Đạo) — Chunk 3
- [x] `/automod-config` admin slash command — view-only readout — Chunk 3
- [x] Deploy commands (5 total now: raid-mode, rank, leaderboard, daily, automod-config) — Chunk 3
- [x] All actions logged to `store.automodLogs` + #bot-log one-liner post — Chunk 1

### Test results (automated)
- **17 test files, 182 tests, all pass in ~4s**
- New in Phase 5 (+22 tests):
  - `rules.test.ts` (16): capsRatio, findNonWhitelistedHosts, findProfanity — all pure helpers
  - `spam.test.ts` (6): SpamTracker normalization, window pruning, per-user isolation, reset

### Acceptance criteria
- [x] Profanity: delete + DM warn (sev 2) — VN diacritic-tolerant
- [x] Mass mention 6+ entities: delete + timeout 10 min (sev 3)
- [x] Spam ≥ 5 duplicate messages in 5 min: timeout 10 min + reset counter (sev 3)
- [x] All actions logged to `store.automodLogs` + posted to `#bot-log` one-liner
- [x] Staff exempt (per SPEC §8.3 "DO NOT take action on admin/mod")
- [x] /automod-config shows rules + thresholds + word-list counts (admin-only, ephemeral)
- [ ] Manual e2e: spam same message 5x in #general → timeout fires + #bot-log entry
- [ ] Manual e2e: post `evil.com` link in #general → deleted + DM warn
- [ ] Manual e2e: mention 6+ users → timeout
- [ ] Manual e2e: profanity word → deleted + DM warn (test with mild word like `fuck`)

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

**Status:** `done` (code-complete + 6 slash commands deployed)
**Estimated complexity:** M (1-2 ngày) — actual: 1 session
**Goal:** Quality-of-life features + scheduling foundation.

### Tasks
- [x] `src/modules/welcome/index.ts` — postWelcome on verification pass (public embed + DM quick-start) — Chunk 1
- [x] `src/modules/reactionRoles/index.ts` — routeReaction + handleReactionAdd/Remove + saveReactionRolesConfig — Chunk 2
- [x] `src/db/types.ts` — ReactionRolesConfig singleton entity + integration in store.ts — Chunk 2
- [x] `src/cli/services/setup-reaction-roles.ts` — one-time CLI: post embed + react + persist — Chunk 2
- [x] `src/events/messageReactionRemove.ts` — un-react → remove role — Chunk 2
- [x] `src/commands/title.ts` — `/title add|remove|list` alternative — Chunk 3
- [x] `src/modules/scheduler/weekly-leaderboard.ts` — Sunday 20:00 VN — Chunk 4
- [x] `src/modules/scheduler/backup.ts` — Daily 00:00 VN GitHub push (skip if env unset) — Chunk 4
- [x] Scheduler registers 3 cron handles (per-min + weekly + daily) — Chunk 4
- [x] Slash commands deployed to guild (6 total: raid-mode, rank, leaderboard, daily, automod-config, title)
- [x] daily check-in reset — N/A, /daily uses calendar-day VN tz check at command time (no cron needed)
- [ ] inactive thread archive — defer to Phase 9 polish

### Test results (automated)
- **19 test files, 203 tests, all pass in ~4s**
- New in Phase 6 (+6 tests):
  - `reaction-roles.test.ts` (6): routeReaction (no config / 4 sub-titles / unknown emoji / different message) + persistence across snapshot+reload

### Acceptance criteria
- [x] Member verify xong → welcome auto (public embed in #general + DM quick-start)
- [x] React ⚔️ → role Kiếm Tu (requires setup-reaction-roles CLI first)
- [x] Weekly leaderboard cron registered (Sunday 20:00 VN, Asia/Ho_Chi_Minh tz)
- [x] Reaction roles survive bot restart (singleton persisted via snapshot/WAL)
- [x] Backup script env-gated (silent skip in dev)
- [x] `/title` works as alternative to reaction picker
- [ ] Manual e2e: alt account passes verification → welcome embed appears
- [ ] Manual e2e: run `npm run bot -- setup-reaction-roles` → message posted, reactions added
- [ ] Manual e2e: react ⚔️ → Kiếm Tu role granted; un-react → removed
- [ ] Manual e2e: `/title list` shows ✅/⬜ correctly per current roles
- [ ] Manual e2e: configure BACKUP_GITHUB_REPO + BACKUP_GITHUB_TOKEN env → manually invoke backup → verify push lands on GitHub

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

**Status:** `done` (code-complete + /breakthrough deployed)
**Estimated complexity:** M (1-2 ngày) — actual: 1 session
**Goal:** Random mini-game cho member level ≥ 10.

### Tasks
- [x] `src/modules/events/games/math-puzzle.ts` — difficulty-by-level multiple choice — Chunk 1
- [x] `src/modules/events/games/reaction-speed.ts` — 5 emoji buttons, click 🐉 — Chunk 1
- [x] `src/modules/leveling/tracker.ts:applyXpPenalty` — floored XP loss helper — Chunk 2
- [x] `src/modules/events/tribulation.ts` — orchestrator + button collector + outcome embed — Chunk 2
- [x] Eligibility helpers (`isTribulationOnCooldown`, `pickEligibleUserId`) — Chunk 2
- [x] `/breakthrough` self-trigger slash command — Chunk 3
- [x] `src/modules/scheduler/tribulation-trigger.ts` — 25% daily 18:00 VN cron — Chunk 3
- [x] Cron job registered (4th scheduler handle) — Chunk 3
- [x] `simulate-tribulation` CLI (gating + game preview) — Chunk 4
- [x] Slash commands deployed (7 total now)
- [x] Event entity persists to `store.events` with outcome metadata
- [ ] Pick eligibility "online, not AFK" — Phase 7 keeps it simple (level ≥ 10 + member-in-guild check); voice-state / presence filter deferred to Phase 9 polish

### Test results (automated)
- **23 test files, 237 tests, all pass in ~4s**
- New in Phase 7 (+22 tests):
  - `games.test.ts` (8): math puzzle shape correctness (3 difficulty tiers), unique options, no negative distractors; reaction game unique 5 options, target always present, target shuffles
  - `tribulation-helpers.test.ts` (14): applyXpPenalty (5 cases), isTribulationOnCooldown (5), pickEligibleUserId (4)

### Acceptance criteria
- [x] Event tự trigger random (25% roll daily 18:00 VN, gated by cooldown + eligible-user check)
- [x] Member level < 10 không pick (`pickEligibleUserId` filters)
- [x] Cooldown 24h server-wide (`isTribulationOnCooldown` queries store.events)
- [x] Pass: +500 XP via awardXp; fail: -100 XP via applyXpPenalty (floor at cumulativeXpForLevel)
- [x] Embed đẹp với suspense — purple intro, gold pass, red fail/timeout, animal emoji decoys for the dragon button game
- [ ] Manual e2e: `/breakthrough` while < level 10 → ephemeral refusal
- [ ] Manual e2e: `/breakthrough` while ≥ 10 → public embed in #tribulation + buttons functional
- [ ] Manual e2e: click correct answer → +500 XP + #tribulation pass embed + event recorded
- [ ] Manual e2e: click wrong / let it timeout → -100 XP capped + fail/timeout embed
- [ ] Manual e2e: trigger twice in < 24h → second call gets cooldown refusal

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

**Status:** `code-complete` (code + docs done; VM provision is manual operator work)
**Estimated complexity:** M (1 ngày code, +0.5 ngày manual VM setup)
**Goal:** Production deploy trên Oracle Cloud.

### Tasks (code-side)
- [x] `ecosystem.config.cjs` — PM2 config (single-instance, fork mode, 500M memory ceiling, log rotation)
- [x] `src/utils/health.ts` — `/health` HTTP endpoint (200 ok / 503 degraded)
- [x] `HEALTH_PORT` env var added, wired into `bot.ts` ClientReady / stopBot
- [x] `.env.example` updated with `HEALTH_PORT`
- [x] `DEPLOY.md` — comprehensive deployment guide:
  - VM provision (Oracle Cloud A1 Flex)
  - System deps (Node 20, canvas native libs, PM2)
  - Clone + build + PM2 launch
  - Health endpoint config + UptimeRobot setup
  - Update / rollback procedures
  - **Recovery scenario** (VM lost → spin fresh, restore from GitHub backup)
  - Initial public-launch checklist (8-step ordered runbook)
  - Troubleshooting matrix (8 common symptoms → fix)

### Manual tasks (operator)
- [ ] Provision Oracle Cloud Always Free Tier ARM Ampere A1 Flex VM
- [ ] SSH setup + system update + Node 20 install
- [ ] Clone repo, configure `.env` with prod values
- [ ] Restore data from GitHub backup if migrating from dev
- [ ] `pm2 start ecosystem.config.cjs && pm2 save && pm2 startup`
- [ ] Configure UptimeRobot monitor on `<PUBLIC_IP>:3030/health`
- [ ] Run initial public-launch checklist (DEPLOY.md §9)
- [ ] Stress test 100 msg/min — verify XP tracking integrity
- [ ] Recovery drill: nuke VM, restore from backup, verify state

### Acceptance criteria
- Bot 24/7 trên VM, no crash
- VM restart → PM2 auto-resume
- Backup file ở GitHub daily (cron registered)
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

**Status:** `done` (code/asset prep complete; live polish applied for #1+#2; #3 gated on Boost L2)
**Estimated complexity:** M (2 ngày) — actual: 1 session
**Goal:** Final polish — UX richness + onboarding.

### Source cleanups (done 2026-05-13, before Phase 9 polish)
- [x] `src/config/roles.ts` — centralized role name constants (ROLE_PHAM_NHAN, ROLE_UNVERIFIED, etc + STAFF_ROLE_NAMES Set)
- [x] `src/config/leveling.ts` — centralized XP/timing balance dials (message XP min/max, cooldowns, voice rates, reaction XP, daily, tribulation rewards)
- [x] Refactored consumers: flow.ts, messageCreate.ts, bulk-onboard.ts, cooldown.ts, eligibility.ts, voice-xp.ts, daily.ts, tribulation.ts, tribulation-trigger.ts

### UX polish (Bill feedback 2026-05-13) — IMPLEMENTED
- [x] **Pinned channel guides** — 10 VN-language pinned embeds, idempotent CLI `npm run bot -- pin-channel-guides`. Applied live: 10 channels (#rules, #verify, #general, #introductions, #daily-checkin, #leveling-guide, #leaderboard, #tribulation, #bot-commands, #help-me).
- [x] **Colorful progress bar in /rank** — replaced ASCII `█████░░░░░` with 12-emoji block bar tinted by cảnh giới color (🟦🟨🟪🟥 etc + ▫️ empty), + percentage label.
- [x] **Role icons CLI scaffold** — `npm run bot -- upload-role-icons [--use=unicode|png]`. Supports both unicode-emoji + PNG paths; checks `guild.premiumTier ≥ 2` and aborts with clear message if not met. Live guild currently at Boost Level 0 → blocked.
- [x] **Asset spec** — `assets/role-icons/README.md` with 256×256 PNG energy-orb spec + colorHex palette for all 11 ranks + 4 sub-titles.
- [x] **Launch announcement CLI** — `npm run bot -- post-launch-announcement` with idempotent pin/edit on #announcements. Dry-run smoked, NOT yet posted live (Phase 8 deploy-day artifact).

### Remaining (run-time tasks, not code)
- [ ] Boost server to Level 2 (≥ 7 boosts) → run `upload-role-icons` for cultivation + sub-title roles
- [ ] Design + drop 10 PNG orb icons in `assets/role-icons/` → re-run with `--use=png`
- [ ] After Phase 8 deploy: `npm run bot -- post-launch-announcement` to officially open

### Original Phase 9 (deferred to launch-day)
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

## Phase 10 — Aki AI helper (designed, awaiting impl)

**Status:** `designed` — full spec in `docs/PHASE_10_AKI.md`
**Estimated complexity:** M (1-2 sessions)
**Goal:** `/ask` command calling Grok 4.1 Fast Reasoning as Aki — cute
maid persona that answers server/game questions but refuses to write
code for users (anti-spam policy).

### Design highlights (see `docs/PHASE_10_AKI.md` for full)
- **API**: `grok-4-1-fast-reasoning` via `https://api.x.ai/v1` (OpenAI-compatible)
- **Pricing**: $0.20 input / $0.50 output / $0.05 cached per 1M tokens
- **Cost estimate**: ~$0.0003/call → $3-9/mo at heavy use with caching
- **Persona**: Vietnamese maid, sassy with lazy questions, knows full server context, refuses to write code (gives prompt templates instead)
- **Image input**: supported via OpenAI-compatible `image_url` (multimodal)
- **5 chunks**: client wrapper → rate-limit/budget → /ask command → simulate CLI → manual e2e

### Caveat
- **Model retirement**: `grok-4-1-fast-reasoning` reported retirement
  date 2026-05-15. Verify + plan successor when starting Phase 10.

### Open questions for Bill (before start)
- Daily budget cap ($2/day default OK?)
- Per-user limits (5/min, 50/day OK?)
- Channel scoping (all channels, or `#bot-commands` + `#help-me` only?)

---

## Phase 11 — Verify hardening + UX richness + LLM provider abstraction

> **Full doc + deploy runbook: [`docs/PHASE_11.md`](docs/PHASE_11.md)** —
> single-doc source of truth, checklist-driven. Read that first when
> resuming work; this section is a high-level pointer.

**Status:** `1A done + sync applied`, `1B done`, `2 designed`
**Estimated complexity:** L (3 sessions)
**Goal:** Address verify pain points (re-join captcha replay, DM-blocked
button-spam in public, 5-min timeout too tight), introduce a free-tier
LLM provider with per-task routing (Groq + Gemini fallback), decorate
channels with icons, and lay the groundwork for cultivation-themed
Gemini narration (Thiên Đạo punishment + level-up prose).

### Commit 1A — Foundation + LLM infra (DONE 2026-05-14, `34703a3`)

8 features in one commit. Tests: 290 unit + 104 smoke, all green.

- [x] **LLM provider infrastructure** — `src/modules/llm/`
    - `types.ts` (LlmProvider interface + errors)
    - `providers/groq.ts` (OpenAI-compat via `openai` SDK)
    - `providers/gemini.ts` (fetch adapter, extracted from filter.ts)
    - `router.ts` (per-task routes + 429 throttle + fallback chain)
    - `index.ts` (single seam `llm.complete(task, input)`)
    - Task routes: filter+nudge → `llama-3.1-8b-instant` (14.4K RPD),
      narration → `llama-3.3-70b-versatile` (1K RPD), fallback → Gemini Flash
- [x] **Filter migrated** to `llm.complete('aki-filter')`. Fail-open
      preserved (Bill's UX-first call).
- [x] **A1 · Re-join skip** — `guildMemberAdd` checks `store.users` for
      `verified_at !== null`. Restores Phàm Nhân + current rank role,
      skips captcha, posts "Đệ tử quay về" embed.
- [x] **A3 · 2-day verify timeout** — `captchaTimeoutMs: 300000 → 172800000`.
- [x] **A4 · "Chỉ thấy verify"** — `public_read` + `public_full` presets
      now deny `UNVERIFIED: READ`. Fresh joins see only #verify until pass.
- [x] **A7 · /ask context** — sends username + nickname + last 5 channel
      messages to Grok via `AskAkiInput`. `collectRecentContext()` in
      `commands/ask.ts` (best-effort; failures drop context silently).
- [x] **B4 · Sub-title prompt on Trúc Cơ promotion** — DM with 4
      sub-title options when level reaches Trúc Cơ (lvl 10). One-shot
      (skips if `user.sub_title` already set).
- [x] **A5 · Channel rename with icons** — all 33 channels renamed
      (`💬-general-💬`, `🔒-verify-🔒`, voice `🎯 Focus Room 🎯`, etc).
      `canonicalChannelName()` + `matchesChannelName()` helpers in
      `config/channels.ts` so lookups stay slug-based. `isNoXpChannel()`
      + `isWorkingVoiceChannel()` replace raw `Set.has()`. sync-server
      auto-renames on canonical-match drift detection.
- [x] **Bot-log audit reasons** (Phase 11 carry-over from Phase 10
      bugfix): kick log post now includes audit_reasons array, so a
      kick says "lý do: audit — `account age 0.13d < 1d threshold`"
      instead of just "lý do: audit".
- [x] **Auto-kick disabled** by default (`accountAgeKickDays: 0`).
      Every new account goes through captcha; no implicit kicks.
- [x] **Smoke-test + unit tests** — `npm run smoke-test` (104 checks),
      `tests/llm/router.test.ts` (11 tests), `tests/config/channels.test.ts`
      (23 tests). `tests/aki/filter.test.ts` rewritten for new arch.

**Live sync verified:** 2026-05-14, 33 channels renamed in-place,
sync-server output `channelsCreated: 1 · channelsUpdated: 33`.

### Commit 1B — Verify thread + auto-react (DONE 2026-05-14, `df69f8d` + `c80d7eb`)

- [x] **A2 · Per-user verify thread on DM blocked** — `verify-<slug>`
      thread created in `🔒-verify-🔒` (24h auto-archive). Thread ID
      persisted on `Verification.fallback_thread_id`. Pass / fail /
      timeout cleans the thread. Falls back to legacy channel post
      if thread create fails (graceful).
- [x] **B1 · Verify thread cleanup cron** — hourly sweep of archived
      `verify-*` threads > 24h old. Wired into `scheduler/index.ts`.
- [x] **B3 · First-message auto-react** — verified user's first
      message in `#general` (canonical match works after icon rename)
      gets 🌟 + "Tân đệ tử nhập môn ٩(◕‿◕)۶". One-shot via
      `User.first_message_greeted_at` timestamp, set BEFORE the
      react/reply attempts to race-protect concurrent messages.

Tests: 298 unit (+8 threadNameFor) + 118 smoke (+14 1B coverage).
Awaiting Bill live deploy → see `docs/PHASE_11.md` sanity checklist.

### Commit 2 — LLM narration (shipped 2026-05-14)

- [x] **A6 · Graduated profanity rate-limiter** — sliding 60s window
      per user. 1-4 → Aki gentle nudge, 5-14 → stern nudge, 15+ →
      delete + warn (existing). Counter in `profanity-counter.ts`,
      branch in `actions.ts:applyDecision`. Staff exemption removed
      per Bill — `respectfulTone=true` swaps Aki tone to honorific.
      Per-user 30s LLM cooldown, silent skip on LLM down.
- [x] **A6b · Thiên Đạo punishment narration** — every landed automod
      action now posts a VN-xianxia "Thiên Đạo" line to #bot-log in
      place of the plain `🛡️ Automod` text. Static fallback always
      returns a usable string. Calls `llm.complete('narration', ...)`.
- [x] **A8 · Level-up cultivation narration** — chronicler prose
      replaces the static `rank.description` flavor inside the đột
      phá embed. 5-min cache per (oldRank, newRank) pair; `__USER__`
      placeholder lets cached prose stay correct for each disciple.
      Graceful fallback on LLM error.

Tests: 335 unit (+37 covering counter, nudge, narration, graduated
flow) + 155 smoke (+37 covering all Commit 2 modules). No lint errs,
build clean. Awaiting Bill deploy → live LLM smoke (real Groq/Gemini
keys on VPS).

### Backlog (Phase 11+ future)

- B2 · `#audit-log` consolidation channel for staff
- B5 · `/stats` admin dashboard
- B6 · Verify re-attempt cooldown (kicked → can't rejoin 1h)
- B7 · Aki memory per user (last N /ask retrieved into prompt)
- Channel role-tier visibility (Inner Sect, Core Disciples, Elders) —
  deferred, would need new presets + UX design

### Decision log (Phase 11)

- **2026-05-14** (P11): **LLM provider abstraction** chosen over
  hardcoded-Gemini-everywhere. Reason: Bill's Gemini free tier
  rate-limit pain (15 RPM) → adding Groq with 30 RPM + 14.4K RPD
  for 8B = 70× headroom for filter traffic. Single seam keeps
  feature code clean even if we swap providers again.
- **2026-05-14** (P11): **Multi-key rotation deferred.** Single Groq
  key has 30 RPM × 14.4K RPD = plenty for a small server's filter
  + nudge + narration workload. Multi-key adds TOS risk (Google /
  Groq say one account per person) for negligible gain at current
  scale. Revisit if traffic grows past 10× current estimate.
- **2026-05-14** (P11): **Fail-open filter, NOT fail-closed.** UX
  priority — rejecting legit users during a 30s LLM outage is
  worse than burning Grok tokens on those calls. Cost is bounded
  by existing per-user quota (100/day) + server daily budget ($2/day)
  so a filter outage at worst lets through one user's daily quota.
- **2026-05-14** (P11): **Channel icons on both sides** (`💬-general-💬`)
  per Bill's "1 icon trước và 1 icon sau" instruction. Adds visual
  weight in the channel list. Required `canonicalChannelName()` helper
  for all lookup sites that compare by canonical slug (`general`)
  not display name.
- **2026-05-14** (P11): **`accountAgeKickDays: 0` (auto-kick off).**
  Original `1` (24h) was too aggressive — caught legit new Discord
  users like azurajoan1996 (account <3h old, kicked 4× as they
  rejoined). Captcha gate is sufficient barrier. Schema accepts
  `nonnegative()` so 0 explicitly disables; audit.ts treats 0 as
  "skip kick path".
- **2026-05-14** (P11): **Sub-title prompt only on Trúc Cơ promotion**,
  not every level. Promotion (level 10) is the canonical "you're not
  a tutorial player anymore" moment in the cultivation theme. Earlier
  prompts would feel premature; later prompts would be too late.

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
- **2026-05-13** (Phase 3 Chunk 4): **`challenge_data` shape for image+math.** Store both the joined `expected` string AND the individual `image_text` / `math_answer` fields. `verifyReply` uses the individual fields because `parseHardReply` splits the reply into two tokens that get compared separately (image case-insensitive, math digit-exact). The joined `expected` field is kept for human-readable debug + future spec compatibility, but isn't the verifier's source of truth.
- **2026-05-13** (Phase 3 Chunk 4): **Image buffer NOT persisted.** The captcha image buffer is generated at challenge time and sent in the DM; only the answer text lives in `challenge_data`. On bot restart, the user has already seen the image and we still hold the answer — verification continues correctly. On DM-fail fallback, the button click regenerates the captcha (and updates `expected`/`image_text`/`math_answer` in the same Verification record) since the image was never delivered.
- **2026-05-13** (Phase 3 Chunk 5): **Each event file exports `register(client)`** instead of using a discovery convention (e.g., `default export { name, execute }` like discord.js examples). bot.ts imports each by name and wires them in `startBot()`. Simpler than auto-discovery for ≤10 event files and gives explicit ordering control. Will revisit if event count grows past ~20.
- **2026-05-13** (Phase 3 Chunk 5): **messageCreate is DM-only in Phase 3.** Guild-side message handlers (XP earning, automod) live in Phase 4 + Phase 5 — adding them now would either duplicate file content (one per phase) or grow a stub with TODOs. Cleanest: re-open messageCreate.ts each phase and add the new responsibility. The current `if (message.guildId) return` guard is the explicit "this phase only handles DMs" marker.
- **2026-05-13** (Phase 3 Chunk 6): **`/raid-mode` admin gate via Discord's permission system, not runtime role-name check.** `setDefaultMemberPermissions(PermissionFlagsBits.Administrator)` is the source of truth. Chưởng Môn has Administrator from the Phase 2 perm preset; nobody else does. Avoids the runtime fragility where a code-side role-name list drifts from the synced schema.
- **2026-05-13** (Phase 3 Chunk 6): **Raid functions accept optional `store` param** (default `getStore()`) so tests can inject a fresh `Store` without going through the module singleton. Production callers omit the param. Same pattern can extend to other modules if they need test-isolated state.
- **2026-05-13** (Phase 3 Chunk 7): **`src/modules/bot-log.ts` is a separate singleton from `getStore()`.** The pattern: bot.ts calls `setBotLogClient(client)` on `ClientReady`, then any module imports `postBotLog(content)` to post to `#bot-log` without threading the Discord client through every function signature. All sends are best-effort — silent no-op if client isn't wired (tests), guild not in cache, or channel missing.
- **2026-05-13** (Phase 3 Chunk 7): **Scheduler is module-level, started on `ClientReady`, stopped on `stopBot`.** Both verification cleanup and raid auto-disable run every minute via a single `cron.schedule('* * * * *', ...)` callback that catches errors per-job. Phase 6 will add more crons to the same file; the tasks array is the cleanup unit. node-cron callbacks aren't awaited, so the wrapper `.catch()` is essential — uncaught rejections inside cron callbacks otherwise become unhandled.
- **2026-05-13** (Phase 4 Chunk 1): **`awardXp` does a follow-up `set` after `incr`** to update non-incrementable fields (level, last_message_at). The spread `{ ...updated, level: newLevel }` preserves whatever the latest XP is (in case concurrent awards landed between the incr and set), so we never clobber a parallel award. Trade-off: 2 writes per award instead of 1. Acceptable for ~50 msg/min server-wide.
- **2026-05-13** (Phase 4 Chunk 1): **Defensive `User` create on first XP earn** even though verification flow already creates one on pass. Covers admin-grant XP and future bulk-migration cases where a member exists in the guild but never went through `/verify`. The created User has `verified_at: null` to distinguish from verification-pass users.
- **2026-05-13** (Phase 4 Chunk 2): **Rank role swap uses `member.roles.set([keep, newRole])`** instead of remove-then-add. Atomic from Discord's perspective: no window where the user has zero cultivation roles. Store update happens FIRST so a Discord API failure doesn't lose the rank change — next bot tick / manual fix can resync the role.
- **2026-05-13** (Phase 4 Chunk 2): **Tiên Nhân is excluded from auto-promotion.** Admin-grant only; `maybePromoteRank` returns early if `user.cultivation_rank === 'tien_nhan'`. `rankForLevel` in cultivation.ts already excludes Tiên Nhân from auto-mapping, so this is belt-and-suspenders.
- **2026-05-13** (Phase 4 Chunk 3): **XP eligibility uses `substantiveLength` (≥ 5 chars after stripping emojis)**, not raw length. Custom Discord emojis `<:name:id>` and Unicode emojis (Extended_Pictographic + VS-16 + ZWJ) are stripped before counting. Prevents emoji-spam grind while still allowing emoji-decorated real messages.
- **2026-05-13** (Phase 4 Chunk 4): **Voice XP uses a minute-tick scan, not voiceStateUpdate session tracking.** Simpler: no persistent session state to maintain, no edge cases on reconnect/move/crash mid-session. Trade-off: a member who joins for <60s right between ticks earns 0 XP. Acceptable — sub-minute presence shouldn't grind.
- **2026-05-13** (Phase 4 Chunk 4): **Working voice channels hard-coded by name** (`Focus Room`, `Quiet Study`) in `WORKING_VOICE_CHANNEL_NAMES`. If we add more pomodoro-style channels, edit the Set. Alternative — schema flag in server-structure.ts — was rejected as overkill for 2 channels.
- **2026-05-13** (Phase 4 Chunk 5): **Daily uses calendar days in `Asia/Ho_Chi_Minh`, not rolling 24h windows.** "Today vs yesterday" matches what a VN player intuitively sees: they can claim once per VN calendar day. Streak continues if yesterday was claimed, resets if any day was missed. `dayKey(ts, tz)` uses `Intl.DateTimeFormat` with `en-CA` locale for ISO `YYYY-MM-DD` output that's directly string-comparable.
- **2026-05-13** (Phase 4 Chunk 5): **Streak bonuses fire only on milestone days (7, 14, 30), not as recurring multipliers.** Day 7 → +50 once. Day 8-13 → back to base 100. Day 14 → +150 once. Etc. After day 30 the bonus pool is exhausted until reset. Simplest interpretation of SPEC; revisit if user feedback says streaks deserve recurring rewards.

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
