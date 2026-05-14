# Handoff — Radiant Tech Sect Bot

> Final state of the project as of 2026-05-14. Tất cả phases đã ship,
> tests xanh. Tài liệu này tóm tắt cái đã có, cách vận hành, và đề xuất
> hướng đi tương lai.

---

## TL;DR

**Status**: All phases shipped. **417 unit / 216 smoke / 0 lint err / build clean**.

**Live URL** (current host): VPS Vietnix — `14.225.255.73`, PM2 process `radiant-tech-sect-bot`.

**Git HEAD**: `main` branch — final commit chain spans Phase 0 → Phase 12 Lát 9.

**Token cost / day** (production-typical):
- Aki `/ask` (Grok 4.1 Fast): ~$0.05-0.50/day, capped at $2.0 by `AKI_DAILY_BUDGET_USD`
- Filter + narration + nudge + doc-validate: **$0/day** trên Groq free tier (Qwen 3 32B + Llama 3.3 70B)
- Net: < $0.50/day average for an active server

---

## What's shipped

### Phase 0-9 — Foundation
- Discord bot bootstrap (discord.js v14, TypeScript strict)
- Custom WAL+Snapshot store (no SQL/NoSQL libs) — handles 10K users / 500K xp_logs at ~100MB RAM
- 11 cultivation rank system (Phàm Nhân → Tiên Nhân) with auto role promotion
- 4 sub-titles (Kiếm Tu / Đan Sư / Trận Pháp Sư / Tán Tu)
- XP from message (15-25), voice (10/min), reaction (2), `/daily` (100 + streak)
- Tribulation system + `/breakthrough`
- 5-rule automod (profanity, mass mention, link, spam, caps)
- Verify gate (math + image+math captcha) + 2-day timeout + per-user verify thread fallback
- Welcome embeds, channel sync, reaction roles, raid mode auto
- GitHub backup nightly cron
- UI polish design system (themed embeds, divider icons, rank colors)

### Phase 10 — Aki AI helper
- `/ask` slash with Grok 4.1 Fast Reasoning ($0.20/$0.50/$0.05 cached per 1M)
- 2-stage filter (Gemini Flash before Grok) for spam/troll rejection
- Per-user quota (5/min, 100/day) + server-wide budget cap
- AkiCallLog entity for analytics

### Phase 11 — LLM router + verify hardening + Ethereal Mystic palette
- Multi-provider LLM router (Groq → Gemini fallback chain, per-task routing)
- Channel rename with icon-on-both-sides (`💬-general-💬`) + canonical name lookup
- Re-join skip for previously-verified members
- Per-user verify thread when DM blocked
- 2-day verify timeout, `accountAgeKickDays=0` (auto-kick disabled)
- First-message auto-react + sub-title prompt on Trúc Cơ

### Phase 11.2 — Graduated profanity + Thiên Đạo narration + permissive link policy
- Graduated profanity tiers (1-4 gentle nudge / 5-14 stern / 15+ delete+sweep)
- Thiên Đạo cosmic narration to `#bot-log` for every automod action
- Chronicler narration for rank breakthroughs (replaces static text)
- Retroactive history sweep at delete tier (15min window)
- Permissive link policy (default allow, block suspicious heuristics)
- Public-channel "🧹 Aki dọn rác" cleanup line on profanity delete tier
- `<think>` reasoning leak stripping (Qwen/gpt-oss) + Groq `reasoning_format` gated by model

### Phase 11.3 — Polish
- `/link-whitelist add|remove|list` (admin, runtime hot-reload)
- `/stats` admin dashboard (24h overview)
- Verify re-attempt cooldown (1h after fail-kick)

### Phase 12 — Game mechanics (Lát 1-9)
- **Lát 1**: User additions (pills, contribution_points, equipped_cong_phap_slug) + 3 entities (CongPhap, UserCongPhap, DailyQuest) + lực chiến formula + `/stat` + `/grant`
- **Lát 2**: Currency auto-earning + `/rank` currency display + `/leaderboard mode:luc-chien`
- **Lát 3**: 12 công pháp catalog seed + `/shop` + `/cong-phap` + `/inventory`
- **Lát 4**: Daily quest cron + `/quest` + progress hooks (message/voice/reaction/daily)
- **Lát 5**: Multi-NPC (Akira scholar + Meifeng combat) via shared ask-runner
- **Lát 6**: `/duel` PvP with 60s accept window + 5-round simulation
- **Lát 7**: Server boost reward (+5 pills, +500 contribution) with double-reward gate
- **Lát 8**: `/trade sell` công pháp sell-back + 10% Aki premium roll
- **Lát 9**: `/contribute-doc` slash + `POST /api/contribute` HMAC + LLM `doc-validate` task + auto-classify (difficulty/section/tags)
- **Polish**: `/help` command, `/breakthrough` consume 1 pill, quest auto-grant XP, `/aki-memory` opt-in user history, removed unused `combat_power_cache`

### Phase 12.1 — Role palette refresh
- Ethereal Mystic — pastel + cosmic dreamy progression. Each rank distinct hue family (no more grey-vs-grey, yellow-vs-gold collisions).

---

## Slash command surface (27 commands)

| Command | Group | Description |
|---|---|---|
| `/help` | utility | Lists all commands grouped |
| `/rank` | leveling | XP + level + currency + progress |
| `/stat` | game | Lực chiến breakdown + công pháp |
| `/leaderboard` | leveling | Top 10 by XP or lực chiến |
| `/daily` | leveling | Daily claim + streak |
| `/breakthrough` | leveling | Self-trigger tribulation (Lv 10+, 1 pill) |
| `/title` | leveling | Sub-title CRUD |
| `/quest` | game | Daily quest progress |
| `/inventory` | game | Bag: currency + công pháp |
| `/shop` | game | Browse công pháp catalog |
| `/cong-phap` | game | CRUD công pháp (list/info/buy/equip/unequip) |
| `/trade` | game | Sell công pháp back to Aki |
| `/duel` | game | PvP 5-round with accept window |
| `/ask` | aki | Hỏi Aki (default maid persona) |
| `/ask-akira` | aki | Hỏi Akira (scholar) |
| `/ask-meifeng` | aki | Hỏi Meifeng (combat) |
| `/aki-memory` | aki | Toggle question memory (opt-in) |
| `/contribute-doc` | docs | Submit document — Aki validates |
| `/verify-test` | dev | Test captcha (admin-only IDs) |
| `/stats` | admin 🛡️ | 24h dashboard |
| `/automod-config` | admin 🛡️ | Show automod state |
| `/link-whitelist` | admin 🛡️ | Manage link whitelist runtime |
| `/grant` | admin 🛡️ | Grant/deduct currency |
| `/raid-mode` | admin 🛡️ | Toggle raid mode |

---

## Cron jobs

| Schedule | Job | Purpose |
|---|---|---|
| `* * * * *` | per-minute | verify cleanup + raid auto-disable + voice XP tick |
| `0 * * * *` | hourly | sweep stale `verify-*` threads |
| `0 0 * * *` VN | daily 00:00 | GitHub backup + daily quest assignment |
| `0 18 * * *` VN | daily 18:00 | 25% chance random tribulation in `#tribulation` |
| `0 20 * * 0` VN | Sunday 20:00 | weekly leaderboard post |

---

## LLM task routing (Phase 11+)

| Task | Primary | Fallbacks |
|---|---|---|
| `aki-filter` | groq:qwen/qwen3-32b | groq:llama-3.3-70b-versatile → groq:llama-4-scout → groq:llama-3.1-8b → 3×gemini |
| `aki-nudge` | groq:llama-3.1-8b-instant | groq:llama-4-scout → gemini:flash-lite |
| `narration` | groq:llama-3.3-70b-versatile | groq:llama-4-scout → groq:qwen → groq:gpt-oss-120b → 3×gemini |
| `doc-validate` | groq:llama-3.3-70b-versatile | groq:llama-4-scout → 2×gemini |

`reasoning_format: 'hidden'` only sent to Qwen + gpt-oss (Llama 400s on it). Defensive `stripReasoning()` for any model that still leaks `<think>` blocks.

---

## Operational playbook

### Daily
- Health check: `curl http://14.225.255.73:3030/health | jq` → `status: ok`
- `/stats` in Discord → spot-check Aki cost + automod hits

### Weekly
- Sunday 20:00 VN — verify weekly leaderboard auto-posted to `#leaderboard`
- Inspect `pm2 logs` for any `error` lines

### Monthly
- `pm2 logs --json | grep "error" | wc -l` — error rate trend
- Review GitHub backup commits to confirm nightly job

### On bot issues
1. `pm2 logs radiant-tech-sect-bot --lines 100 --nostream` for symptoms
2. `pm2 restart radiant-tech-sect-bot` if transient
3. Worst case: `git reset --hard <prev-known-good-commit>` + rebuild + restart

### On Discord rate limits / outages
- discord.js auto-retries with backoff. Logs show `warn` level. No action needed.
- Token rotation: edit `.env` `DISCORD_TOKEN`, `pm2 restart`. No code change.

---

## Future direction — recommendations

### Tier A — Polish (≤1 day each)
1. **Migrate #docs / #resources to forum channels** + auto-publish approved contributions as threads.
   - Currently `/contribute-doc` validates but doesn't actually create a forum thread. Wiring needed:
     - Change channel type in sync-server to `GuildForum`
     - Apply tags to forum (difficulty + section as forum tags)
     - On approve → `forum.threads.create({ name: title, message: { content: body }, appliedTags: [...] })`
     - Aki posts classification summary as second message in thread
2. **/aki-memory wipe full implementation** — currently a stub. Needs an `AkiCallLog.is_purged` field + filter logic.
3. **Forum migration script** — `npm run migrate-docs` to archive existing `#docs` / `#resources` messages before forum conversion.

### Tier B — Features
4. **Bot's website integration** — `POST /api/contribute` is ready; Bill's billthedev.com needs to wire up the sender side (`fetch + HMAC sign`).
5. **Auto-tags ML** — currently LLM picks tags from open vocabulary. Adding a closed tag taxonomy + LLM picks from list = more curated knowledge base.
6. **Aki periodic auto-buy công pháp** — cron sweeps unused công pháp from inactive users, refunds owner with bonus, keeps catalog circulating.
7. **Multi-equip slots** — current single-slot công pháp; add 2-3 slot tiers based on cảnh giới (e.g., Đại Thừa unlocks 2nd slot).
8. **Sub-title roles unlock perks** — Kiếm Tu +bonus duel crit chance, Đan Sư +pill discount, Trận Pháp Sư bonus công pháp slot, Tán Tu +XP multiplier.

### Tier C — Scope changes
9. **Migrate to managed DB** — when WAL+snapshot hits limits (currently sized for 10K users; if server grows to 100K+, swap to SQLite or Postgres). The Collection<T> API is designed to be storage-agnostic.
10. **Horizontal sharding** — currently single-instance. Discord allows sharding for >2500 guilds. Not needed unless bot goes multi-server.
11. **Voice chat AI** — Aki integration with voice channels (Discord allows audio bots). Phase 13 territory.
12. **Web dashboard** — admin panel for non-Discord moderation (view logs, edit automod config, grant currency from web).

---

## Tech debt + known gaps

| Item | Severity | Note |
|---|---|---|
| Forum channel auto-publish for /contribute-doc | low | API endpoint + validator work; just not wired to forum.threads.create yet |
| `/aki-memory wipe` is a stub | low | Mark `is_purged` field + filter logic |
| `combat_power_cache` field removed but old snapshots may still have it | none | Defensive `?? 0` everywhere; non-issue |
| Voice quest progress increments on every voice tick (≥2 humans) | low | Solo voice doesn't trigger awardXp → no quest progress. By design |
| `/title` doesn't recompute lực chiến cache | none | Cache removed; `/stat` recomputes on-demand |
| Backup restore is manual (no slash command) | low | Restore via SSH + tar; could add `/restore-snapshot` admin slash |
| No DM consent flow for Aki memory | low | Currently `/aki-memory toggle` gives a one-line confirmation; could add 2-step "are you sure" embed |

---

## Repo references

- `CLAUDE.md` — project rules + tech stack lockfile
- `SPEC.md` — architectural spec
- `PROGRESS.md` — full phase log
- `docs/SETUP.md` — clone-and-run guide (this companion doc)
- `docs/PHASE_10_AKI.md` — Aki design
- `docs/PHASE_11.md` — verify hardening + LLM router
- `docs/PHASE_12.md` — game mechanics design
- `docs/NEXT_SESSION_PROMPT.md` — outdated, pinned for archival

---

## Memory snapshot — what Claude/AI assistant knows

If a future session of Claude Code or any AI assistant picks this project up, they should:

1. **Read `CLAUDE.md`** first — hard rules + tech stack
2. **Read this `HANDOFF.md`** for current state
3. **Read `docs/SETUP.md`** for operations
4. **Run `git log --oneline -20`** for recent commits
5. **Run `npm run typecheck && npm test && npm run smoke-test`** to confirm green
6. **Check `pm2 logs` (if VPS)** for live issues
7. **Memory directory** `C:\Users\ADMIN\.claude\projects\c--Users-ADMIN-Downloads-Discord-Sever\memory\` — user preferences, project memory, feedback notes

The codebase is opinionated:
- VN user-facing, EN code/commits
- No SQL/NoSQL libs (custom WAL+Snapshot)
- LLM router pattern (never hardcode provider)
- Graceful degradation (every external call has fallback)
- Single-writer Store with async-mutex
- TypeScript strict, no `any`, Zod for boundaries

---

## Acknowledgments

- **Bill Truong** (billtruong003) — project lead, design decisions, live feedback
- **Aki** — fictional maid persona, project mascot, primary AI character
- Built across multiple sessions of Claude Code (Opus 4.7), Phase 0 to Phase 12.1

---

_Generated 2026-05-14. If you need to revive this bot 6 months from now: start with `docs/SETUP.md` §11 production checklist, then read this handoff §"Future direction"._
