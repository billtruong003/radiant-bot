# Phase 11 — Verify hardening + UX richness + LLM provider abstraction

> Single-doc runbook cho toàn bộ Phase 11. Follow theo thứ tự, tick
> checkbox khi xong. Trạng thái mỗi feature tóm tắt ngay đầu — chi
> tiết code references + decision context ở phần dưới.

**Last updated:** 2026-05-14
**Phase status:**
- ✅ **Commit 1A** shipped + live sync applied (33 channels renamed)
- ✅ **Commit 1B** shipped — awaiting Bill deploy + live sanity
- ✅ **Commit 2** shipped — A6 graduated profanity + A6b/A8 LLM narration. Awaiting deploy.

---

## TL;DR cheat-sheet

| Commit | What | Files | Status |
|---|---|---|---|
| 1A | LLM router + verify hardening + channel icons | `34703a3` | ✅ shipped, sync-server applied |
| 1A-test | smoke + router + canonical tests | `d8c114d` | ✅ shipped |
| 1B | verify thread + cleanup cron + first-msg greet | `df69f8d` | ✅ shipped, awaiting deploy |
| 1B-test | thread + greet smoke coverage | `c80d7eb` | ✅ shipped |
| 2 | A6 graduated profanity + A6b/A8 LLM narration | _next commit_ | ✅ shipped |

Test status (current): **335 unit / 155 smoke / 0 lint err / build clean**

---

## Deploy runbook

### One-time prep (only if not done)
- [ ] **Groq API key** added to `.env` on VPS: `GROQ_API_KEY=gsk_...`
      (get from https://console.groq.com/keys — free tier, 30 RPM / 14.4K RPD)
- [ ] **Gemini key** already in `.env` (fallback provider)

### Deploy 1A + 1B together
```bash
# Local
git push origin main

# VPS
ssh root@14.225.255.73
cd /root/bots/radiant-bot
git pull && npm run build
npm run sync-server          # ← only on first 1A deploy (rename channels)
pm2 restart radiant-tech-sect-bot
pm2 logs radiant-tech-sect-bot --lines 30 --nostream
```

> Sync-server đã chạy 1 lần local cho server prod — 33 channels renamed.
> Nếu prod VPS sync khác guild thì cần chạy lại; nếu cùng guild thì
> sync hôm `2026-05-14` đã apply, skip step này.

### Live sanity checklist (sau pm2 restart)

**A1 · Re-join skip**
- [ ] Alt account đã verified leave guild → rejoin → mong đợi: thấy "Đệ tử quay về" embed ở #general, không có captcha DM
- [ ] User XP + cảnh giới role được restore

**A2 · Per-user verify thread (DM-blocked)**
- [ ] Alt account chặn DM của bot → join server → thread `verify-<slug>` xuất hiện trong `🔒-verify-🔒`
- [ ] Click button trong thread → modal/captcha xuất hiện
- [ ] Pass captcha → thread biến mất + welcome ở #general
- [ ] Fail 3 lần liên tiếp → thread biến mất + member kicked

**A3 · 2-day verify timeout**
- [ ] (Difficult to test live) — chỉ check: `npm run smoke-test` xác nhận `captchaTimeoutMs = 172_800_000`

**A4 · Chỉ thấy #verify khi chưa verify**
- [ ] Alt account chưa verify chỉ thấy `🔒-verify-🔒` channel, không thấy `📢-announcements-📢` hay `📜-rules-📜`

**A5 · Channel icons**
- [ ] Mỗi channel hiện format `🔒-verify-🔒`, `💬-general-💬`, etc — icon hai bên
- [ ] Voice channels: `🏛️ Main Hall 🏛️`, `🎮 Gaming 🎮`, etc
- [ ] Bot vẫn post bot-log / level-up / tribulation đúng channel (lookups dùng canonical name)

**A7 · /ask context**
- [ ] `/ask question: explain git rebase` → Aki reply tự nhiên, có thể ref nickname người hỏi
- [ ] Chat vài câu trước trong channel → `/ask` → Aki có context (reference các câu trước)

**B1 · Thread cleanup cron**
- [ ] Sau 24h, archived `verify-*` threads bị sweep (manual check sau ngày deploy)

**B3 · First-message auto-react**
- [ ] Alt verified mới — câu đầu trong #general → 🌟 react + "Tân đệ tử nhập môn ٩(◕‿◕)۶"
- [ ] Câu thứ 2 → không react nữa (one-shot)

**B4 · Sub-title prompt on Trúc Cơ**
- [ ] Alt level lên 10 → DM gợi ý sub-title (Kiếm Tu / Đan Sư / Trận Pháp Sư / Tán Tu)

**LLM router**
- [ ] `/ask test` → pre-filter rejection (Aki dunk gentle)
- [ ] `/ask chéo cánh không em` → Groq filter rejection (Aki sass)
- [ ] `/ask cách lên cảnh giới` → forward to Grok, full answer with context
- [ ] Check `pm2 logs` → `aki-filter: classified` entries có `provider: "groq"`

---

## Commit 2 — Narration (shipped 2026-05-14)

### A6 · Graduated profanity rate-limiter — ✅ shipped

**Thresholds (Bill confirmed):**
| Profanity hits in 60s | Action |
|---|---|
| 1-4 | Aki nudge gentle (LLM-generated, "đạo hữu nhẹ tay tí ٩(◕‿◕)۶") |
| 5-14 | Aki nudge stern ("kiềm chế nha, em đếm rồi đó (¬_¬)") |
| 15+ | Delete + warn DM + log (= behavior cũ) + Thiên Đạo narration |

**Implementation:**
- [x] `src/modules/automod/profanity-counter.ts` — sliding 60s window Map<userId, ts[]>, lazy prune on touch
- [x] `src/modules/aki/persona-nudge.ts` — `buildNudgePrompt({ severity, respectfulTone, userDisplayName })` builder with GENTLE/STERN + SASS/RESPECTFUL cells
- [x] Hooked in `automod/rules/profanity.ts:detect` — records hit + emits `RuleHit.context.profanityCount`
- [x] Branch in `automod/actions.ts:applyDecision` — count < 15 → nudge via Aki, no delete/log; count ≥ 15 → normal action chain
- [x] Per-user 30s nudge cooldown (`lastNudgeAt` Map) to cap LLM spend
- [x] Cost: ~$0/day on Groq Qwen 32B free tier (worst case ~$0.005/day if fallback to Gemini hits)

**Edge cases handled:**
- Window auto-prunes when user goes 60s without profanity → counter drops to 0
- Staff exemption REMOVED (per Bill: "kể cả role tông chủ cũng k ngoại lệ") — `respectfulTone=true` swaps SASS to honorific
- Nudge LLM down → silent skip (no message), counter still increments

### A6b · Thiên Đạo punishment narration — ✅ shipped

**Trigger:** Any automod action that landed (count ≥ 15 for profanity, or any other rule)
**Where:** Posts narrated line to `📋-bot-log-📋` via `postBotLog()`. Old plain `🛡️ Automod warn ...` line is REPLACED, with the `(rule · action · tag)` metadata appended on a second italic line.
**Tone:** "Thiên Đạo" cosmic voice — VN xianxia, no Hán tự.

**Implementation:**
- [x] `src/modules/automod/narration.ts` — `narratePunishment({ userDisplayName, ruleId, action })` via `llm.complete('narration', ...)`
- [x] System prompt locked: VN-only, 1–2 sentences, `**<user>**` exactly once, no rule-ID leakage (uses VN labels like "ngôn từ ô uế")
- [x] Caller: `automod/actions.ts:applyDecision` triggers narration AFTER action lands (after store log)
- [x] Static fallback always returns a usable string: `⚡ Thiên Đạo đã <action label> **<user>** vì <rule label>.`
- [x] Cost: ~$0/action on Groq Qwen 32B free tier

### A8 · Level-up cultivation narration — ✅ shipped

**Trigger:** `postLevelUpEmbed` called with `promotion.promoted === true` (cảnh giới crossover)
**Replace:** Embed `description` block — the `_${rank.description}_` flavor line is now the chronicler prose.

**Implementation:**
- [x] `src/modules/leveling/narration.ts` — `narrateRankPromotion({ userDisplayName, oldRank, newRank })`
- [x] System prompt: VN chronicler voice, 1–2 sentences, both rank name + user name `**bold**`
- [x] Cache by `(oldRank, newRank)` pair for 5 minutes — same-pair promos reuse prose with `__USER__` placeholder swap so each user still sees their own name
- [x] Fall back to static template on any LLM error
- [x] Caller: `postLevelUpEmbed` in `src/modules/leveling/rank-promoter.ts:177` calls narration BEFORE building embed

### Commit 2 acceptance — DONE
- [x] All 3 features behind LLM router (Qwen 3 32B primary, Gemini chain fallback)
- [x] Graceful degradation: any LLM null → static text fallback
- [x] Cost cap: well within Groq free-tier RPD across primary + 4 fallback Groq models + 3 Gemini models
- [x] Tests: 5 new unit suites + 4 new smoke groups, 335 unit / 155 smoke green
- [x] No regression in existing tests after retrofit (engine-integration warn test switched to link rule)

---

## Backlog (deferred to Phase 11.x)

| Item | Why deferred |
|---|---|
| **B2** dedicated `#audit-log` consolidation | Current `#bot-log` already centralised; revisit if staff want separation |
| **B5** `/stats` admin dashboard | Useful but not blocking; tackle after narration ships |
| **B6** verify re-attempt cooldown (1h after kick) | Edge case; current flow handles rejoin via A1 if previously verified |
| **B7** Aki memory per user (retrieve last N /ask) | UX nice-to-have; current /ask context (Phase 11 A7) already provides recent-channel-history |
| Role-tier channel visibility (Inner Sect, etc) | Would need new presets + UX design + rename more channels; revisit when community ready |

---

## Architecture references

### LLM provider abstraction (`src/modules/llm/`)
- `types.ts` — `LlmProvider` interface, `LlmRateLimitError`, `LlmProviderError`
- `providers/groq.ts` — OpenAI-compat via `openai` SDK
- `providers/gemini.ts` — REST fetch, JSON mode supported
- `router.ts` — per-task TASK_ROUTES, 429 throttle, fallback chain
- `index.ts` — single seam `llm.complete(task, input)`

Task routes:
```
aki-filter  → groq:llama-3.1-8b-instant   → gemini:gemini-2.0-flash
aki-nudge   → groq:llama-3.1-8b-instant   → gemini:gemini-2.0-flash
narration   → groq:llama-3.3-70b-versatile → gemini:gemini-2.0-flash
```

### Channel canonical names (`src/config/channels.ts`)
- `canonicalChannelName(raw)` — strips emoji + collapses separators → slug
- `matchesChannelName(channel, canonical)` — find()-friendly helper
- `isNoXpChannel(rawName)` / `isWorkingVoiceChannel(rawName)` — Set lookups via canonical

### Verify thread schema (`src/db/types.ts`)
- `Verification.fallback_thread_id?: string | null` — set when DM-blocked and thread created. Lets pass/fail/timeout cleanup delete the thread.

### User schema (`src/db/types.ts`)
- `User.first_message_greeted_at?: number | null` — one-shot timestamp for B3 greet

---

## Decision log (Phase 11)

| Date | Decision |
|---|---|
| 2026-05-14 | **LLM provider abstraction** over hardcoded Gemini. Groq free 30 RPM × 14.4K RPD = 70× headroom. |
| 2026-05-14 | **Multi-key rotation deferred.** Single key enough for current scale; multi-key adds TOS risk. |
| 2026-05-14 | **Fail-open filter** (per Bill). UX priority — rejecting legit users during outage worse than burning Grok tokens. Cost capped by existing quota + budget. |
| 2026-05-14 | **Channel icons both sides** per Bill — `💬-general-💬`. Needs `canonicalChannelName()` helper for lookups. |
| 2026-05-14 | **`accountAgeKickDays: 0`** — auto-kick disabled. Captcha is sufficient barrier. |
| 2026-05-14 | **Sub-title prompt only on Trúc Cơ** (level 10) — canonical "graduated tutorial" moment. |
| 2026-05-14 | **Verify thread autoArchive 24h** + cron sweep hourly. Conservative `verify-` prefix match in cleanup. |
| 2026-05-14 | **First-msg greet one-shot** via `User.first_message_greeted_at` set BEFORE the React/reply attempts (race protection). |

---

## Commands quick reference

```bash
# Run smoke-test (118 assertions, no Discord needed)
npm run smoke-test

# Run unit tests (298 tests)
npm test

# Full sweep before commit
npm run typecheck && npm run lint && npm run smoke-test && npm test && npm run build

# Sync server (rename channels, idempotent)
npm run sync-server -- --dry-run    # preview
npm run sync-server                  # apply

# Live ops on VPS
ssh root@14.225.255.73
cd /root/bots/radiant-bot
git pull && npm run build && pm2 restart radiant-tech-sect-bot
pm2 logs radiant-tech-sect-bot --lines 30 --nostream
```

---

## Status indicators (for future you)

- ✅ **shipped** — code merged + tests green
- 🚀 **deployed** — running on VPS, sanity checked live
- 📐 **designed** — plan locked, not yet coded
- 📋 **planned** — in this doc but no design yet
- 🔄 **in progress** — being worked on now
- ⏸️ **paused** — blocked or deferred
