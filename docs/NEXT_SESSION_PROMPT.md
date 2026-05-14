# Prompt cho session tiếp theo — Phase 11.2 + 11.3 + Phase 12 game mechanics

> **Paste toàn bộ file này làm message đầu tiên trong Claude Code session sau.**

---

Tiếp tục project Radiant Tech Sect Bot. Bot đang chạy LIVE trên Vietnix VPS (IP `14.225.255.73`, hostname `billthedev-yqin`, PM2 managed). Phase 11 1A + 1B + multi-model rotation + 2026 model upgrade đã deploy và verified live (`/ask` calls đang dùng Qwen 3 32B làm filter primary, sass tone coherent).

## Đọc trước (BẮT BUỘC)

1. `CLAUDE.md` — project rules
2. `PROGRESS.md` — full phase tracker (Phase 0-11 done)
3. `docs/PHASE_11.md` — **runbook + designs**, single source of truth
4. `docs/PHASE_10_AKI.md` — Aki persona spec
5. `SPEC.md` — architecture
6. Memory: `C:\Users\ADMIN\.claude\projects\c--Users-ADMIN-Downloads-Discord-Sever\memory\` — load all
7. Run `git log --oneline -15` to see recent commits

## Trạng thái hiện tại

- 303 unit tests + 124 smoke checks pass
- LLM router live với 7-route chain (Groq Qwen 3 32B primary, Gemini 2.5/3.x fallback)
- 9 slash commands deployed global: `/raid-mode`, `/rank`, `/leaderboard`, `/daily`, `/automod-config`, `/title`, `/breakthrough`, `/ask`, `/verify-test`
- Channel rename live (`💬-general-💬`, `🔒-verify-🔒`, etc — 33 channels renamed)
- LLM env: `GROQ_API_KEY` + `GEMINI_API_KEY` đã set trên VPS `.env`
- Per-user verify thread live khi DM blocked
- 2-day verify timeout, kickDays=0 (no auto-kick), re-join skip cho previously-verified

## Tier A — Phase 11.2 (Commit 2): Gemini-narrated UX (LOCKED DESIGN, GO)

3 features chạy qua LLM router (đã có sẵn `llm.complete('narration', input)`):

### A6 · Graduated profanity rate-limiter

**Thresholds (Bill locked 2026-05-14)**:
| Profanity hits trong 60s window | Action |
|---|---|
| 1-4 | Aki nudge gentle qua `llm.complete('aki-nudge')` — không delete |
| 5-14 | Aki nudge stern — không delete |
| 15+ | Delete + warn DM + automod log (= behavior cũ) |

**Implementation**:
- New module `src/modules/automod/profanity-counter.ts` — sliding 60s window Map<userId, timestamp[]>
- New persona `src/modules/aki/persona-nudge.ts` — Aki nudge prompt with flag `respectful_tone: boolean`
  - Default: sass tone ("đạo hữu kiềm chế tí")
  - Staff role (Tông Chủ / Trưởng Lão / Chấp Pháp): sweeter tone ("Tông Chủ ơi đệ tử mạn phép nhắc...")
- Hook in `src/modules/automod/rules/profanity.ts` to check count + branch action
- Per-user 30s cooldown giữa nudges (tránh spam LLM)
- Failure mode: LLM down → silent skip (better than wrong nudge)

**Important**: Staff exemption REMOVED — kể cả Tông Chủ cũng được nhắc, chỉ tone softer.

### A6b · Thiên Đạo punishment narration

**Trigger**: Bất kỳ automod action nào landed (delete / warn / timeout / kick) trong `applyDecision`
**Where**: Post embed vào `📋-bot-log-📋` channel (đã có)
**Tone**: "Thiên Đạo" voice — cultivation cosmic narration

**Examples**:
```
⚡ Thiên Đạo đã giáng thiên kiếp khiến **<user>** ngưng tu tâm —
ngôn từ ô uế đã bị thiên đạo phong ấn.

🌩️ **<user>** vô tình kích hoạt cơ chế tự vệ của tông môn —
Aki đã thu hồi vong ngôn về vực sâu.
```

**Implementation**:
- New module `src/modules/automod/narration.ts` — `llm.complete('narration', { systemPrompt, userPrompt })`
- System prompt persona: Thiên Đạo cosmic voice (separate from Aki maid persona)
- Caller: `automod/actions.ts:applyDecision` triggers narration AFTER action lands
- Static fallback: nếu LLM lỗi → "**<user>** bị **<rule>**" plain text
- Cost: ~$0/day on Groq Qwen 32B free tier

### A8 · Level-up cultivation narration

**Trigger**: Cảnh giới promotion (`promotion.promoted === true` in `postLevelUpEmbed`)
**Replace**: Embed description block của static template hiện có

**Examples** (Qwen 32B prose, VN xianxia):
```
"A đã tiến đến **Trúc Cơ kỳ**, vạn người kính ngưỡng. Đường tu
hành dài rộng, mong đạo hữu giữ chí lớn."

"B vừa đột phá **Kim Đan kỳ** — nội đan thành hình, từ đây
phong vân chiêu sinh chỉ trong tay áo."
```

**Implementation**:
- New module `src/modules/leveling/narration.ts` — generates prose per rank promotion
- Caller: `postLevelUpEmbed` (`src/modules/leveling/rank-promoter.ts`) calls narration BEFORE building embed, fallback to current static template on LLM error (graceful)
- Cache result 5 phút per (oldRank, newRank) pair — rare event nhưng defensive

**Acceptance Tier A**:
- [ ] 3 modules mới + persona files
- [ ] Smoke-test extends to verify new task routes work
- [ ] Unit tests cho profanity-counter sliding window
- [ ] All graceful fallback paths (LLM down → static text)
- [ ] No regression in 303 unit + 124 smoke
- [ ] Bill paste deploy commands → live test trên Discord

---

## Tier B — Phase 11.3 backlog polish (medium priority)

Bill optional — ship after Tier A confirmed live ổn.

### B2 · `#audit-log` consolidation channel

- Tạo channel mới `📋-audit-log-📋` chỉ Trưởng Lão+ thấy (`admin_only` preset)
- Hợp nhất tất cả bot actions vào đây: kick, warn, automod hit, Aki refusal, scheduler job result
- Hiện `📋-bot-log-📋` đã làm 1 phần — consolidate hay split? Bill quyết

### B5 · `/stats` admin dashboard slash command

- Ephemeral admin-only slash (PermissionFlagsBits.Administrator)
- Display: total members, verified %, active 7d, top 5 XP, Aki cost today + month, automod hits by rule, LLM router stats (calls per provider/model)
- Pure read from store — không touch live state
- Estimate: ~120 LOC + slash command registration

### B6 · Verify re-attempt cooldown

- Kicked vì failed verify → can't rejoin trong 1 giờ
- New entity: `failedVerifyKickCooldowns` (single field, Map<discord_id, expiry_ts>)
- Check trong `guildMemberAdd` BEFORE audit
- If cooldown active → ban temporary 1h via Discord API (auto-revoke)
- ~60 LOC

### B7 · Aki memory per user

- Retrieve last 3 `/ask` calls của user từ `akiLogs` (đã có entity)
- Embed vào system prompt cho Grok: "Trong các câu hỏi gần đây của <user>, họ đã hỏi: ..."
- Privacy: chỉ feed back chính câu hỏi của user đó, không leak others
- ~40 LOC trong `src/modules/aki/client.ts`

### Role-tier channel visibility

- Optional design: 3 tier channels
  - 🌸 Inner Sect (level 10+ / Trúc Cơ+)
  - 💎 Core Disciples (level 50+ / Hóa Thần+)
  - ⚡ Elders Council (level 120+ / Đại Thừa+ + staff)
- 3 new perm presets in `src/modules/sync/perm-presets.ts`
- 3 new channels in `server-structure.ts`
- Sync-server auto-apply

---

## Tier C — Phase 12 game mechanics (BIGGER SCOPE, plan trước implement sau)

Bill mentioned trong PROGRESS decision log — defer until Tier A+B done. Đề xuất plan-first session trước.

### Multi-NPC roster

- Hiện chỉ có Aki. Plan: thêm 2-3 NPCs với personas khác nhau
- Mỗi NPC = 1 LLM persona file + 1 slash command (vd `/ask-akira` = mềm mỏng, `/ask-meifeng` = sass cao, etc)
- Share same LLM router infra
- Acceptance: persona riêng biệt, không drift sang Aki

### `/stat` combat profile

- Embed: level + cảnh giới + sub-title + lực chiến (combat power score) + công pháp inventory
- Button "Khởi Thiên Kiếp" → trigger tribulation manually (gated: level ≥ 10, cooldown 24h server)
- Hiện `/breakthrough` đã có nhưng prosaic — `/stat` là profile-style

### Currency: Đan dược độ kiếp + điểm cống hiến

- 2 currencies mới in User entity: `pills` (tribulation pill currency, earned daily/event), `contribution_points` (soft currency earned from activity)
- New commands: `/inventory`, `/shop`
- Spending: pills required để tribulation, points để buy công pháp

### Công pháp (technique manuals)

- New entity `CongPhap` (id, name, description, stat_bonuses, cost, rarity)
- New entity `UserCongPhap` (user_id, cong_phap_id, equipped)
- Catalog channel `📜-cong-phap-📜` lists available
- `/cong-phap list/buy/equip/unequip`

### Lực chiến (combat power)

- Single derived score from: level + sub-title + equipped công pháp stat bonuses
- Display on `/stat`, `/rank`, leaderboard
- New leaderboard mode: `/leaderboard mode:luc-chien`

### PvP combat

- `/duel @opponent` — propose duel
- Interactive turn-based combat: math/reaction mini-games
- Winner gains contribution points, loser loses (or no penalty depending on stake)
- Far-future — design carefully

### Daily quest

- New cron `0 0 * * *` VN — generates daily quest per user
- Quest examples: "Gửi 10 messages", "Voice 30 phút", "Reaction 5 lần", "/daily streak day X"
- Reward: XP + pills + contribution points
- `/quest` shows current quest + progress

---

## Implementation rules (carry over)

1. **Plan-first** for Tier C — present design + AskUserQuestion để confirm scope trước khi code
2. **LLM router pattern** — never hardcode provider/model trong feature code. Always `llm.complete(task, input)`
3. **Graceful degradation** — every LLM call must have fallback path (static text, silent skip, etc)
4. **Smoke-test parity** — every new feature gets smoke-test coverage (`scripts/smoke-test.ts`)
5. **TypeScript strict** — no `any`, no `as never`. Zod cho external input.
6. **VN user-facing** — code comment + commit message English, user-facing strings VN
7. **No new docs** trừ khi Bill yêu cầu — update PROGRESS.md + docs/PHASE_11.md (now docs/PHASE_12.md cho game mechanics khi tới đó)
8. **Test sweep before commit** — `npm run typecheck && npm run lint && npm test && npm run smoke-test && npm run build`
9. **Channel lookups** — use `matchesChannelName(c, 'general')` not `c.name === 'general'` (canonical-aware)
10. **Phase 11 commits đã ship trên origin/main** — không có gì uncommitted local

## Suggested execution order

1. **Tier A (Phase 11.2 / Commit 2)** — A6 + A6b + A8 trong 1 commit, ~500 LOC + tests. **GO ngay khi session start.**
2. After live confirm Tier A → **Tier B** items one at a time (Bill picks priority)
3. After Tier B → **plan-first session for Tier C**, design docs/PHASE_12.md, then implement in chunks

## Deploy steps (template, cho every commit)

```bash
# Local
git push origin main

# VPS (Bill paste)
ssh root@14.225.255.73
cd /root/bots/radiant-bot
git pull && npm run build && pm2 restart radiant-tech-sect-bot
sleep 5 && pm2 logs radiant-tech-sect-bot --lines 30 --nostream | grep -iE "error|warn|ready"
npm run smoke-test 2>&1 | tail -3
```

## Tone

Bill thuộc execute mode, không thích over-confirm. Plan ngắn gọn → AskUserQuestion 1-2 lần để lock design → code → test → commit → push → deploy instruction. Avoid:
- Long lecture về best practices
- Asking permission for things already locked in docs/PHASE_11.md
- Re-explaining architecture Bill đã approved

## Memory entries đã lock (do not re-confirm)

- VN user-facing, no Hán tự
- Custom WAL+Snapshot storage (no SQL libs)
- Channel icons both sides
- accountAgeKickDays = 0 (auto-kick disabled)
- captchaTimeoutMs = 2 days
- Fail-open filter (UX > cost)
- Multi-model rotation > multi-key
- LLM router: Qwen 3 32B primary cho filter+narration
