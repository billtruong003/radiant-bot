# Prompt cho session tiếp theo — Phase 12.6 polish bundle (10 features)

> **Paste toàn bộ file này làm message đầu tiên trong Claude Code session sau.**

---

Tiếp tục project Radiant Tech Sect Bot. Bot đang chạy LIVE trên Vietnix VPS (`14.225.255.73`, PM2 managed). Tất cả Phase 0-12.5 đã ship + 484 unit / 320 smoke tests xanh / 0 lint err / build clean.

## Đọc trước (BẮT BUỘC)

1. `CLAUDE.md` — project rules + tech stack lockfile
2. `HANDOFF.md` — final state + future roadmap (anchor doc)
3. `docs/SETUP.md` — operations guide
4. `docs/PHASE_12.md` — game mechanics design
5. `PROGRESS.md` — full phase log
6. Memory: `C:\Users\ADMIN\.claude\projects\c--Users-ADMIN-Downloads-Discord-Sever\memory\` — load all
7. `git log --oneline -15` để xem chain commit gần đây

Trạng thái khi session bắt đầu:
- 28 slash commands
- 5 LLM tasks (aki-filter, aki-nudge, narration, doc-validate, divine-judgment)
- Custom WAL+Snapshot store (no SQL libs)
- Ethereal Mystic role palette
- Per-rank aura visual + rainbow animation (Đại Thừa+)
- Áp Chế Thiên Đạo (manual /thien-dao + Aki auto-defense detector)

## Scope — 10 features trong 1 session

Mục tiêu: ship cả **Genuinely missing (4)** + **Nice to have (6)** trong 1 session. Tổng ~900 LOC. Phương pháp: 2-3 commits theo nhóm cohesive, mỗi commit có tests + smoke. Stop sau khi `/restore-snapshot` ship hoặc Bill bảo dừng.

### 🔥 Genuinely missing

#### F1 · Forum thread auto-publish cho `/contribute-doc` (~150 LOC)

Validator hiện đã approve/reject + classify nhưng KHÔNG thực sự post thread. Cần:

- **Channel type**: convert `📚-docs-📚` + `📚 Resources` từ text channel sang **GuildForum** type
  - File: `src/config/server-structure.ts` — đổi `type: 'text'` → `type: 'forum'` (nếu chưa support, thêm vào `ChannelDef` type union + sync-server `applyChannel()`)
  - Apply tags: `easy / medium / hard` (difficulty) + `tech / cultivation / lore / dev / data-science / community` (section). Forum supports up to 20 tags.
  - Migration: existing messages cần archive. Tạo `scripts/migrate-docs-to-forum.ts` standalone — copy text channel content sang `#docs-archive-2026-XX` (read-only text) trước khi convert. Idempotent skip nếu archive exists.

- **Publish on approve**: `src/modules/docs/validator.ts:submitContribution` — sau khi mark `approved`, gọi helper `publishToForum(contribution)`:
  - Look up forum channel by canonical name `docs` hoặc `resources` (caller chỉ định section → channel)
  - `forum.threads.create({ name: title, message: { content: body }, appliedTags: [difficultyTagId, sectionTagId] })`
  - Update `DocContribution.thread_id` với new thread ID
  - Aki post 2nd message in thread = classification summary (`📊 Điểm: 85 · 🎯 Độ khó: medium · 🏷️ Tags: ...`)
  - Best-effort: forum missing / perm denied → log warn, contribution stays `approved` nhưng `thread_id=null`

- **REST endpoint side**: same code path triggers when `POST /api/contribute` approves.

- **Tests**: unit `tests/docs/publisher.test.ts` covering happy path + missing-channel + permission denied. Smoke: verify forum tag lookup.

#### F2 · Sub-title perks (~150 LOC)

Hiện sub-title cho `+50` lực chiến (`src/modules/combat/power.ts`). Bill spec ban đầu: mỗi sub-title có perk riêng. Implement:

| Sub-title | Perk | File touched |
|---|---|---|
| **Kiếm Tu** (combat) | +15% crit chance trong `/duel` | `src/modules/combat/duel.ts:simulateDuel` — bump `CRIT_CHANCE` từ 0.05 → 0.20 nếu fighter có sub_title === 'Kiếm Tu' |
| **Đan Sư** (alchemy) | -30% pill cost cho `/cong-phap buy` + `/breakthrough` | `src/modules/combat/cong-phap.ts:buyCongPhap` — discount `cost_pills` nếu user sub_title === 'Đan Sư'. Same cho `src/commands/breakthrough.ts:TRIBULATION_PILL_COST` |
| **Trận Pháp Sư** (formation) | Unlock 2nd công pháp equip slot ngay (không cần Đại Thừa) | Combined với F5 multi-equip below — Trận Pháp Sư = "early access" cho slot 2 |
| **Tán Tu** (mixed) | +10% XP multiplier cho mọi source | `src/modules/leveling/tracker.ts:awardXp` — multiply `input.amount * 1.10` nếu sub_title === 'Tán Tu' (before incr) |

- New module `src/modules/leveling/sub-title-perks.ts` exports pure helpers: `getCritBonus(user) / getPillDiscount(user) / getXpMultiplier(user) / getMaxCongPhapSlots(user)`. Each takes `Pick<User, 'sub_title' | 'cultivation_rank'>` and returns number.
- Tests: unit `tests/leveling/sub-title-perks.test.ts` — 1 case per perk × default vs sub-title.
- Smoke: 4 checks, 1 per sub-title.

#### F3 · `/aki-memory wipe` full impl (~50 LOC)

Currently stub. Cần thực sự xoá question history. Approach:

- Add `User.aki_memory_wiped_at` (number | null, default null) — không phải Phase 12 schema bump, dùng optional field như các Phase 12 fields trước.
- Update `src/modules/aki/client.ts:askAki` memory retrieval — filter ra logs có `created_at < user.aki_memory_wiped_at`.
- `/aki-memory wipe` slash sets `aki_memory_wiped_at = Date.now()` and confirms count of soft-purged logs.
- Old logs stay on disk (append-only collection can't delete) — but excluded from future memory retrievals. Privacy-equivalent to deletion.
- Tests: unit covering retrieve-skip behaviour.

#### F4 · Praise detection (anti của Aki defense) (~80 LOC)

Đối xứng với `aki-defense.ts:detectAkiInsult`. Khi user khen Aki, Aki post sweet response (không gọi Thiên Đạo, không grant currency để tránh farm).

- New module `src/modules/admin/aki-praise.ts`:
  - `detectAkiPraise(content): { isPraise, matchedName, matchedToken }` — same regex shape as insult detector, but tokens = `xinh, dễ thương, giỏi, đỉnh, tuyệt vời, cute, awesome, amazing, lovely, the best`
  - Per-user 10-min cooldown (lower than defense 1h vì reward thấp)
  - `maybeAkiPraiseReply({ message, isStaff })` — checks + posts a single sweet line via `message.reply` (not LLM, just static lines pool of ~10 with random pick + emoji `(◕‿◕)` etc.)
- Wire into `messageCreate.ts` AFTER automod, AFTER divine wrath check (so insult takes priority if both detect somehow).
- Tests + smoke same shape as aki-defense.

### 🟡 Nice to have

#### F5 · Multi-equip công pháp slot (~150 LOC)

Hiện User chỉ có `equipped_cong_phap_slug` (single slot). Mở rộng:

- Schema: `equipped_cong_phap_slugs?: string[]` — backward compat với old field via migration helper. Cap = `getMaxCongPhapSlots(user)`.
- `getMaxCongPhapSlots(user)`:
  - Phàm Nhân – Hợp Thể: 1 slot
  - Đại Thừa, Độ Kiếp: 2 slots
  - Tiên Nhân: 3 slots
  - **Trận Pháp Sư sub-title**: +1 slot mọi cảnh giới (combined với F2)
- `src/modules/combat/power.ts:computeCombatPower` — sum stat_bonuses across all equipped công pháp.
- `src/modules/combat/cong-phap.ts:equipCongPhap` — error if `slot_full`; takes optional `slot` param (0/1/2) hoặc auto-pick first empty.
- `src/commands/cong-phap.ts:equip` — show "Slot 1/2 đã trang bị: X. Equip slug:Y vào slot 2?" UX.
- Migration shim: any `equipped_cong_phap_slug` (singular) coerces to `equipped_cong_phap_slugs = [it]` on first access.
- Tests cover slot cap + Trận Pháp Sư bonus slot.

#### F6 · Aki periodic shop rotation (~100 LOC)

Aki "discount của tuần" cho 3 công pháp ngẫu nhiên mỗi Monday 00:00 VN.

- New entity `ShopDiscount`: `{ slug, discount_pct, expires_at }`. Collection: `shopDiscounts` (overwriting weekly).
- Cron `0 0 * * 1` VN (Monday midnight): pick 3 random công pháp from catalog, set discount 30%, expires Sunday 23:59. Store + post #bot-log announcement.
- `/shop` hiển thị discount with strikethrough giá gốc + new price.
- `buyCongPhap` apply discount nếu slug có active discount.
- Tests + smoke: discount lookup, cron trigger, price calc.

#### F7 · /stats expansion (~80 LOC)

Current `src/commands/stats.ts` = 24h only. Expand:

- Option: `period: 24h | 7d | 30d` (string choice). Default `24h`.
- Add fields:
  - **Per-rank distribution**: count users in each cảnh giới (small histogram with bars)
  - **Aki cost trend**: line of cost per day for last 7 days (text values, no chart)
  - **Automod hits by rule**: same shape as 24h but filtered by chosen period
- Reuse existing query infra.
- Smoke: 3 periods × verify embed has expected fields.

#### F8 · DM-consent flow cho /aki-memory toggle (~30 LOC)

Currently 1-step ephemeral confirm. Make 2-step:

- `/aki-memory toggle` → ephemeral embed with "BẬT memory?" + ✅ confirm / ❌ cancel buttons (60s collector).
- Only on confirm → flip `aki_memory_opt_in` + show success.
- Cancel/timeout → no change, ephemeral note.
- Test the collector flow with mock interaction.

#### F9 · Closed tag taxonomy cho docs (~40 LOC)

Hiện LLM tự sinh tag (free-form). Constrain vô list cố định.

- New `src/config/doc-tags.json` — list ~30 allowed tags grouped by section (e.g. `tech: git, typescript, react, ...; cultivation: kim_dan, do_kiep, ...; lore: aki, thien_dao, ...`).
- Validator system prompt include the closed list + instruction "chỉ chọn tags từ list này".
- Post-parse: filter LLM output tags against allowed set, drop unknowns.
- Tests cover filter + smoke.

#### F10 · `/restore-snapshot` admin slash (~80 LOC)

Currently restore manual SSH+tar. Slash to trigger from Discord.

- Slash admin-only (`Chưởng Môn`).
- Subcommand `list` — show snapshots available (read `data/backups/` directory).
- Subcommand `restore <filename>` — confirm modal (type "CONFIRM RESTORE"), then:
  - Call `store.shutdown()` (final snapshot first)
  - Copy chosen backup over current `data/snapshot.json` + truncate WAL
  - Call `store.init()` to reload
  - Embed confirms restore
- Hardest part: re-init store hot. Alternative: snapshot the operation to a file the supervisor (`scripts/restore.sh`) reads on next pm2 restart. Simpler. Slash chỉ tạo "pending restore" marker, then auto-restart bot.
- Decide on approach in implementation. Safer = slash writes marker + triggers pm2 restart via shell hook.

## Implementation order

Recommend 2-3 commits:

**Commit A — Genuinely missing core (F1+F2+F3+F4)**
- Forum publish + sub-title perks + memory wipe + praise detection
- ~430 LOC. Most cohesive group — all user-facing features that fill clear gaps.

**Commit B — Multi-equip + shop rotation (F5+F6)**
- Both touch công pháp economy. Build together.
- ~250 LOC.

**Commit C — Polish (F7+F8+F9+F10)**
- /stats expand + DM consent + closed tag + /restore-snapshot
- ~230 LOC. Independent items but small enough to bundle.

## Hard rules (carry over from project history)

1. **LLM router pattern** — never hardcode provider/model. `llm.complete(task, input)`.
2. **Graceful degradation** — every LLM call has fallback path (static text, silent skip).
3. **TypeScript strict** — no `any`, no `as never`. Zod cho external input.
4. **VN user-facing** — code comment + commit message English, user-facing VN.
5. **Test sweep before commit** — `npm run typecheck && npm run lint && npm test && npm run smoke-test && npm run build`
6. **Channel lookups** — `matchesChannelName(c, 'general')` not raw name compare.
7. **Store mutation discipline** — never mutate from `store.get()`. Always `set({ ...entity, field: newValue })` or `incr()`.
8. **No private message content storage** — except `aki_memory_opt_in === true` users (CLAUDE.md privacy rule).
9. **allowedMentions parse=[] on every reply path** — defense-in-depth against name-injection (Phase 12.2 baseline).
10. **Sanitize display name + LLM body** before any LLM prompt (Phase 12.2). `sanitizeForLlmPrompt` / `sanitizeForLlmBody`.
11. **Per-user cooldown for any LLM-triggering auto-feature** (defense, praise, etc.) — minimum 10 min, default 1 hour for high-stakes (defense).
12. **Staff exemption for community-touching auto-features** (defense, automod profanity nudge respects respectful tone).
13. **`pm2 restart` after build** — no hot-reload. Bot must stop + start cleanly.
14. **Deploy commands**: `npm run deploy-commands` only when adding/changing slash. `npm run sync-server` only when changing channel/role schema.

## Deploy steps (template per commit)

```bash
# Local
git push origin main

# VPS (Bill paste)
ssh root@14.225.255.73
cd /root/bots/radiant-bot && \
  git pull && \
  npm run build && \
  pm2 restart radiant-tech-sect-bot
# Add `npm run deploy-commands` if commit adds slash.
# Add `npm run sync-server` if commit changes channel/role structure.
sleep 5 && \
  pm2 logs radiant-tech-sect-bot --lines 30 --nostream | grep -iE "ready|error|warn"
```

## Tone Bill prefers

- Execute mode, không over-confirm.
- Plan ngắn → 1-2 `AskUserQuestion` để lock design KHI gap thực sự (vd "F1: forum migration archive cũ giữ hay clear?") → code → test → commit → push → deploy template.
- Avoid: long lectures về best practices, asking permission cho things already locked in this prompt, re-explaining architecture Bill đã approved.
- Defense + sanitize layers đã có sẵn — KHÔNG cần re-implement. Use `sanitizeForLlmPrompt` from `src/utils/sanitize.ts`.

## Sau khi xong

Update `HANDOFF.md` § "Future direction":
- Cross out các item đã ship (đánh dấu `~~strikethrough~~` hoặc move sang `## Completed`)
- Update Tier C list nếu có items thực sự still pending (managed DB, sharding, voice AI, web dashboard).

Update `PROGRESS.md`:
- Bump current-phase line nếu shipping major chunk.

Update `docs/PHASE_12.md`:
- Mark Lát 10 polish (F1-F4) + Lát 11 economy expansion (F5-F6) + Lát 12 polish (F7-F10) shipped.

Update `NEXT_SESSION_PROMPT.md`:
- Pivot to "what's left after this session" — typically just Tier C scale items if all 10 ship.

## Quick reference — file pointers

- `src/config/server-structure.ts` — channel definitions (F1 forum convert)
- `src/modules/docs/validator.ts` — F1 publish step
- `src/modules/combat/power.ts` — F2 sub-title bonus / F5 multi-equip sum
- `src/modules/combat/duel.ts` — F2 Kiếm Tu crit
- `src/modules/combat/cong-phap.ts` — F2 Đan Sư pill discount / F5 multi-equip
- `src/commands/breakthrough.ts` — F2 Đan Sư pill discount
- `src/modules/leveling/tracker.ts` — F2 Tán Tu XP multiplier
- `src/modules/aki/client.ts` — F3 wipe filter
- `src/commands/aki-memory.ts` — F3 wipe slash / F8 DM consent
- `src/modules/admin/aki-defense.ts` — F4 sibling structure (mirror to aki-praise.ts)
- `src/db/types.ts` — F3 wiped_at field / F5 multi-equip array
- `src/modules/scheduler/index.ts` — F6 weekly cron
- `src/commands/stats.ts` — F7 expand
- `src/modules/docs/validator.ts` — F9 closed tag filter
- `src/commands/restore-snapshot.ts` (new) — F10
- `tests/...` — mirror module path for unit tests

GO. Goal: ship all 10 features end of session, 3 commits, full test coverage.
