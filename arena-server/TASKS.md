# Tasks — Radiant Arena Server (Lát D)

> High-level Lát plan cho Colyseus server. Mỗi Lát ship được riêng — Bill sẽ break sub-tasks chi tiết khi vào từng Lát.
>
> **Đọc trước:** `SKILL.md`, `README.md`, và 2 doc bên parent repo (`docs/RADIANT_ARENA_ARCHITECTURE.md` + `docs/RADIANT_ARENA_COLYSEUS.md`).
>
> **Hiện trạng:** scaffold done (Lát D.1). Express + Colyseus boot + /health endpoint. No rooms registered.

---

## ✅ Lát D.1 — Project scaffold

**Status:** done (committed when this folder was created).

**Shipped:**
- `package.json` với Colyseus + Express + Zod + Pino deps.
- `tsconfig.json` strict mode + experimentalDecorators (Colyseus schema needs).
- `biome.json` mirror bot config.
- `src/index.ts` — Express + WSS boot, /health endpoint, graceful shutdown.
- `src/env.ts` — Zod env schema, fails fast on missing secrets.
- `src/logger.ts` — Pino with `pino-pretty` in dev.
- `.env.example` template.

**Verify:**
```bash
cd arena-server
npm install
cp .env.example .env  # fill in ARENA_TOKEN_SECRET + ARENA_RESULT_SECRET
npm run dev
# → "arena server listening" at :2567
# curl http://localhost:2567/health → 200 { ok: true, ... }
```

---

## ✅ Lát D.2 — DuelRoom skeleton

**Status:** done.

**Shipped:**
- `src/auth/tokens.ts` — verbatim port of `signToken`/`verifyToken`/`signBody`/`verifyBody` from bot's `src/modules/arena/tokens.ts`.
- `src/rooms/schemas.ts` — 7 schema classes (`WeaponStatsSchema`, `WeaponVisualSchema`, `WeaponSkillSchema`, `WeaponSchema`, `TrajectoryPointSchema`, `PlayerSchema`, `DuelState`) with default-initialized fields per Colyseus 2.0 requirement.
- `src/rooms/DuelRoom.ts` — `Room<DuelState>` with `onCreate` (Zod-parse options + hydrate state), `onAuth` (HMAC verify + session + roster check), `onJoin` (mark connected, waiting→lobby), `onLeave` (mark disconnected), `onDispose` (release counter). `CreateOptionsSchema` Zod exported for D.3.
- `src/pending-rooms.ts` — atomic counter (`tryAcquire`/`release`/`count`).
- `src/index.ts` — `gameServer.define('duel', DuelRoom)`.
- `tests/auth.test.ts` — 12 cases (round-trip, tampered, wrong-secret, expired, malformed, no-dot, empty-secret, body-HMAC variants).
- `vitest.config.ts` + `tsconfig.build.json` split — fixed rootDir conflict between tests/ and build emit.

**Verified:**
- `npm run typecheck` ✅
- `npm run lint` ✅ (biome clean)
- `npm test` ✅ (12/12)
- `npm run build` ✅ (dist/ emitted clean)
- `npm run dev` ✅ (server boots, /health 200)

**DoD remaining for full smoke:** D.3 admin endpoint needed for bot to POST create-room. Until then, room lifecycle is unit-tested via D.3's smoke script (next Lát).

---

## 🔧 Lát D.3 — Admin /create-room HMAC handler

**Goal:** Bot's `/arena duel` (Lát D bot side, future) calls this endpoint with HMAC-signed body; server creates the DuelRoom programmatically and returns ws_url.

**Scope:**
- `src/admin/hmac.ts` — `signBodyHmac` + `verifyBodyHmac` (mirror `tokens.ts:signBody/verifyBody`).
- `src/admin/create-room.ts` — Express handler: HMAC verify → Zod parse body → check `roomCounter.tryAcquire(5)` → `matchMaker.createRoom('duel', options)` → 200 { ok, room_name, ws_url } OR 503 ROOM_LIMIT_REACHED.
- `src/index.ts` wire handler.
- `scripts/smoke-room.ts` — mock bot: sign body with shared secret → POST → assert 200 + valid join URLs for 2 mock players (use `signToken` mirror to forge join tokens).
- `tests/admin-create.test.ts` — happy path + 401 wrong sig + 503 over-limit.

**DoD:** `npm run smoke` returns 2 ws URLs. Curl each in `wscat` (or Postman) successfully joins.

---

## 🔧 Lát D.4 — Turn loop: lobby → countdown → active → animating

**Goal:** Both clients `Send("ready")` → countdown 3s → first turn assigned → can `Send("shoot")` (stub physics for now, just rotate turn).

**Scope:**
- `src/rooms/DuelRoom.ts` extend: register `ready`, `shoot`, `concede`, `animation_complete`, `ping` messages.
- State transitions: `lobby → countdown (3s) → active → animating → active → ... → ended`.
- Turn timer 30s — auto-skip on AFK.
- Animation confirm: both clients send `animation_complete` OR timer 8s.
- `firstTurnPlayer` — slot 0 goes first (deterministic for v1).

**DoD:** Smoke script connects 2 ws clients, sends `ready` from both, observes `state.phase` transitions correctly, sends `shoot` (no physics yet — just turn rotation), reaches `ended` on `concede`.

---

## 🔧 Lát D.5 — Physics sim (blunt + pierce)

**Goal:** `shoot` triggers real trajectory; HP reaches 0 in realistic shot count.

**Scope:**
- `src/rooms/physics.ts` — `simulateShot({ shooter, target, angle, power, mapHalf }): SimResult`.
  - Fixed 16ms timestep.
  - Friction 0.985 per step.
  - Wall reflection with `bounce` coefficient.
  - Blunt: bounce off player like wall.
  - Pierce: continue through (track `pierce_count` budget).
  - Crit roll (seeded PRNG keyed by session_id + shot_index for replayability).
  - Down-sample emit: keep every 3rd step + all event points.
- `src/rooms/damage.ts` — `applyHit(shooter, target, point, isCrit)` parses `event` field, mutates target.hp.
- `tests/physics.test.ts` — direct shot hits target, wall bounce, pierce continues, crit chance respected over 1000 samples.

**DoD:** Smoke duel runs to HP=0 in ~3-7 hits. Vitest covers all categories.

---

## 🔧 Lát D.6 — Result callback to bot

**Goal:** Match ends → server POSTs `/api/arena/result` to bot with HMAC. Bot's existing endpoint (already shipped Lát A) transfers stake and posts to #arena.

**Scope:**
- `src/callbacks/bot-result.ts` — `postResult(payload, attempt=0)` with retry: 3 attempts (1s, 3s, 10s backoff), dead-letter log on final failure.
- `src/rooms/DuelRoom.ts:endMatch()` calls `postResult`.
- `tests/bot-result.test.ts` — mock fetch, assert correct HMAC sig + retry logic.

**DoD:** End-to-end smoke: server runs duel locally + bot also running → match ends → bot posts to #arena channel (manual check).

---

## 🔧 Lát D.7 — Skill registry (passive + signature)

**Goal:** Thiên-phẩm+ weapons can active-skill once per cooldown. Passive skills trigger on hit/crit/low-hp.

**Scope:**
- `src/rooms/skill-registry.ts` — map `skill_id → { onHit?, onCrit?, onActivate?, ... }`.
- 4 starter skills:
  - `passive_lifesteal_10` — onHit: heal shooter by 10% damage dealt.
  - `passive_corner_combo_15` — onHit: if wall bounce within last 200ms, +15% damage.
  - `passive_freeze_miss_30` — onHit: 30% chance target misses next turn.
  - `signature_thiet_phien_quet` — onActivate: next shot deals 1.8× damage, fires 3 trajectories in 30° arc.
- `src/rooms/DuelRoom.ts` extend: `signature` message handler checks cooldown, applies effect, broadcasts `signature_used`.

**DoD:** Smoke duel with thiên-phẩm weapon: `Send("signature")` works once per 8s, fails with cooldown error otherwise. Lifesteal HP visible in state diff.

---

## 🔧 Lát D.8 — Spirit weapon mechanics

**Goal:** Spirit category weapons (dị hoả + lệ băng) have their unique mechanics.

**Scope:**
- `src/rooms/spirit-effects.ts` — Burning zone (dị hoả leaves DoT zone next round) + freeze pulse (lệ băng applies 30% miss for next 2 turns).
- Schema extension: `DuelState.active_zones` ArraySchema for fire zones.
- Cleanup zones at end of next-next round.

**DoD:** Smoke with dị hoả: opponent walking through fire zone loses HP. Lệ băng: opponent's next shot has 30% miss roll.

---

## 🔧 Lát D.9 — Production deploy (Vietnix + Caddy + PM2)

**Goal:** `arena-api.billthedev.com` reachable from internet, bot's `/arena debug` shows ✅ probe.

**Scope:**
- `Dockerfile` (optional, for portability).
- Deploy doc: PM2 ecosystem file, Caddy block for WSS subdomain, DNS A-record setup.
- Bot env update: `ARENA_ENABLED=true` + shared secrets.

**DoD:** From local: `curl https://arena-api.billthedev.com/health` returns 200. In Discord: `/arena debug` shows green Probe row.

---

## 🧪 Optional Lát D.10 — Replay storage

**Goal:** Each match's full trajectory blob persisted, accessible via URL for client replay viewer.

**Scope:**
- `src/replay/store.ts` — local FS append (`data/replays/<session_id>.json`).
- HTTP route `GET /replay/:session_id` — serve gzipped JSON.
- Bot's `replay_url` field populated correctly on `/api/arena/result` POST.

**DoD:** Bot's #arena post embed has clickable replay link → opens viewer page.

---

## 🚦 Lát D.11 — Anti-cheat hardening

**Goal:** Fuzz-test malformed inputs, rate-limit shoot messages, log suspicious patterns.

**Scope:**
- Rate limit `shoot` to 1 per turn server-side (already enforced via phase check, but add explicit drop with log).
- Input fuzz: 1000 random angle+power → assert no crashes, no NaN trajectories.
- Suspicious pattern detector: 3+ consecutive 1.0-power perfect shots → log warn.

**DoD:** Fuzz test passes. Log shows zero false-positives in normal play.

---

## 📋 Cross-Lát checklist

After each Lát:

- [ ] `npm run typecheck` clean
- [ ] `npm run lint` no errors
- [ ] `npm test` green
- [ ] `npm run build` succeeds
- [ ] If contract changed: update `../docs/RADIANT_ARENA_COLYSEUS.md` + bot's `../src/modules/arena/client.ts` if needed
- [ ] Commit: `feat(arena-server/Lát-D.<n>): <verb> <object>`

---

## 🔗 References

- `SKILL.md` — execute persona for Claude session in this folder
- `README.md` — quickstart
- `../docs/RADIANT_ARENA_ARCHITECTURE.md` — full architecture
- `../docs/RADIANT_ARENA_COLYSEUS.md` — implementation walkthrough
- `../src/modules/arena/` — bot side (already shipped Lát A) — contract reference
