# Phase 11 — Verify hardening + UX richness + LLM provider abstraction

> Single-doc runbook cho toàn bộ Phase 11. Follow theo thứ tự, tick
> checkbox khi xong. Trạng thái mỗi feature tóm tắt ngay đầu — chi
> tiết code references + decision context ở phần dưới.

**Last updated:** 2026-05-14
**Phase status:**
- ✅ **Commit 1A** shipped + live sync applied (33 channels renamed)
- ✅ **Commit 1B** shipped — awaiting Bill deploy + live sanity
- 📐 **Commit 2** designed (A6 + A6b + A8 narration) — gated on 1B live ok

---

## TL;DR cheat-sheet

| Commit | What | Files | Status |
|---|---|---|---|
| 1A | LLM router + verify hardening + channel icons | `34703a3` | ✅ shipped, sync-server applied |
| 1A-test | smoke + router + canonical tests | `d8c114d` | ✅ shipped |
| 1B | verify thread + cleanup cron + first-msg greet | `df69f8d` | ✅ shipped, awaiting deploy |
| 1B-test | thread + greet smoke coverage | `c80d7eb` | ✅ shipped |
| 2 | A6 graduated profanity + A6b/A8 Gemini narration | — | 📐 designed |

Test status (current): **298 unit / 118 smoke / 0 lint err / build clean**

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

## Commit 2 — Narration (designed, awaiting 1B live ok)

### A6 · Graduated profanity rate-limiter

**Thresholds (Bill confirmed):**
| Profanity hits in 60s | Action |
|---|---|
| 1-4 | Aki nudge gentle (LLM-generated, "đạo hữu nhẹ tay tí ٩(◕‿◕)۶") |
| 5-14 | Aki nudge stern ("kiềm chế nha, em đếm rồi đó (¬_¬)") |
| 15+ | Delete + warn DM + log (= behavior cũ) |

**Implementation plan:**
- [ ] `src/modules/automod/profanity-counter.ts` — sliding 60s window map per user
- [ ] `src/modules/aki/persona-nudge.ts` — Aki nudge persona prompt builder. Flag `respectful_tone: true` cho staff (Tông Chủ / Trưởng Lão / Chấp Pháp) → sweeter tone
- [ ] Hook in `automod/rules/profanity.ts` to check count + branch action
- [ ] Per-user 30s cooldown giữa nudges (tránh spam LLM)
- [ ] Cost cap: ~$0/day (Groq free) hoặc rất nhỏ (~$0.005/day worst case)

**Edge cases:**
- Window cleared if user goes 60s without profanity → reset to 0
- Staff exemption REMOVED (per Bill: "kể cả role tông chủ cũng k ngoại lệ") — but tone softened
- Nudge fails (LLM down) → silent skip (don't post nothing-message)

### A6b · Thiên Đạo punishment narration

**Trigger:** Bất kỳ automod action nào landed (delete / warn / timeout / kick)
**Where:** Post vào `📋-bot-log-📋` channel (đã có)
**Tone:** "Thiên Đạo" voice — cultivation cosmic narration:

Examples:
```
⚡ Thiên Đạo đã giáng thiên kiếp khiến **<user>** ngưng tu tâm —
ngôn từ ô uế đã bị thiên đạo phong ấn.

🌩️ **<user>** vô tình kích hoạt cơ chế tự vệ của tông môn —
Aki đã thu hồi vong ngôn về vực sâu.
```

**Implementation plan:**
- [ ] `src/modules/automod/narration.ts` — LLM call via `llm.complete('narration', ...)`
- [ ] System prompt persona: Thiên Đạo cosmic voice
- [ ] Caller: `automod/actions.ts:applyDecision` triggers narration AFTER action lands
- [ ] Static fallback: nếu LLM lỗi → "**<user>** bị **<rule>**" plain text
- [ ] Cost: ~$0/day on Groq free tier, ~$0.0003/punishment if fallback to Gemini

### A8 · Level-up cultivation narration

**Trigger:** Promotion to next cảnh giới (currently static text in `rank-promoter.ts`)
**Replace:** Embed description block

Examples:
```
"A đã tiến đến **Trúc Cơ kỳ**, vạn người kính ngưỡng. Đường tu
hành dài rộng, mong đạo hữu giữ chí lớn."

"B vừa đột phá **Kim Đan kỳ** — nội đan thành hình, từ đây
phong vân chiêu sinh chỉ trong tay áo."
```

**Implementation plan:**
- [ ] `src/modules/leveling/narration.ts` — generates prose per rank
- [ ] System prompt persona: cultivation chronicler voice
- [ ] Caller: `postLevelUpEmbed` calls narration BEFORE building embed
- [ ] Fall back to current static template on LLM error (graceful)
- [ ] Cache result for 5 minutes (rare event but defensive)

### Commit 2 acceptance
- [ ] All 3 features behind LLM router (Groq primary, Gemini fallback)
- [ ] Graceful degradation: any LLM error → static text fallback
- [ ] Cost cap: Groq 14.4K RPD (8B) + 1K RPD (70B) > expected load
- [ ] Tests: smoke-test extends to verify schema + new task routes
- [ ] No regression in existing 298 unit / 118 smoke

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
