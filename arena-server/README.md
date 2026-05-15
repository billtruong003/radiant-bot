# Radiant Arena Server

> Colyseus game server cho Radiant Arena. Sibling subproject của `radiant-tech-sect-bot` (Discord bot) trong cùng monorepo.

---

## TL;DR

```bash
cd arena-server
npm install
cp .env.example .env
# Fill ARENA_TOKEN_SECRET + ARENA_RESULT_SECRET (32-byte hex, MUST match bot's .env)
npm run dev
# → "arena server listening" at :2567

curl http://localhost:2567/health
# → { ok: true, uptime_ms: ..., env: "development" }
```

Bot's `/arena debug` (Discord admin slash) sẽ thấy ✅ Probe Reachable ngay khi bot có cùng `ARENA_COLYSEUS_URL=http://localhost:2567`.

---

## Workflow khi vào folder này với Claude Code

1. Mở Claude Code trong folder `arena-server/`.
2. **Paste `SKILL.md` làm tin nhắn đầu tiên** — Claude sẽ load persona "expert game backend developer".
3. Yêu cầu: "Implement Lát D.2 từ TASKS.md" (hoặc bất kỳ Lát nào).
4. Claude sẽ:
   - Đọc Lát đó trong `TASKS.md`.
   - Đọc references (architecture + guide docs).
   - List sub-tasks qua TodoWrite trước khi viết code.
   - Đợi Bill confirm hoặc chỉnh trước khi implement.
   - Implement + test + verify gates.
   - Commit.

`SKILL.md` chứa toàn bộ persona, coding principles, anti-patterns, definition-of-done. Đọc 1 lần là Claude operate đúng style cả session.

---

## Repo position

```
radiant-tech-sect-bot/             # monorepo root
├── src/                            # Discord bot (parent project — Lát A đã ship)
│   └── modules/arena/              # bot-side: HMAC sign, Colyseus client, forge
├── arena-server/                   # ← YOU ARE HERE — Colyseus server (this guide)
│   ├── SKILL.md                    # agent persona
│   ├── TASKS.md                    # Lát D.1-D.9 plan
│   ├── README.md                   # this file
│   ├── package.json                # own deps
│   ├── src/                        # server code
│   └── tests/                      # vitest
├── docs/
│   ├── RADIANT_ARENA_ARCHITECTURE.md   # contract spec
│   ├── RADIANT_ARENA_COLYSEUS.md        # impl guide với code skeletons
│   └── RADIANT_ARENA_UNITY.md           # Unity side
└── arena-unity/                    # Unity-side docs + skill (Unity project lives in separate location)
```

**Tại sao monorepo-lite (cùng repo, tách subfolder)?**

- ✅ Single source of HMAC contract (bot's `src/modules/arena/tokens.ts` is canonical; server copies pattern verbatim).
- ✅ Single git history — đổi token format ở bot + ở server land cùng PR.
- ✅ Deploy cùng VPS, dễ verify shared secrets bằng `.env` đối chiếu.
- ❌ Bot + server có separate `package.json` + `node_modules` — không share runtime, không xài npm workspace ở v1 (giữ đơn giản).

---

## Architecture position

```
                  Discord clients
                        │
                        │ WSS to Discord gateway
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Vietnix VM 2GB                                          │
│  ┌──────────────┐          ┌─────────────────────────┐   │
│  │ Discord Bot  │          │ Arena Server (THIS)     │   │
│  │ :3030        │          │ :2567                   │   │
│  │              │ HTTP+HMAC│                          │   │
│  │ /arena duel  │─────────▶│ POST /admin/create-room │   │
│  │              │          │                          │   │
│  │              │◀─────────│ POST /api/arena/result   │   │
│  │ Pills/XP/WAL │ HTTP+HMAC│ DuelRoom physics         │   │
│  └──────────────┘          └─────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                                       ▲
                                       │ WSS
                                       │
                              Unity WebGL clients
                              (2 players, 1 room)
```

---

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | tsx watch — auto-restart on file change |
| `npm run build` | tsc → `dist/` |
| `npm start` | run prod build (PM2 entrypoint) |
| `npm run typecheck` | tsc --noEmit |
| `npm run lint` | biome check |
| `npm run lint:fix` | biome fix |
| `npm test` | vitest run |
| `npm run smoke` | E2E smoke: mock bot signs create-room → 2 fake clients join (Lát D.3+) |

---

## Env vars

Required:

| Var | Description |
|---|---|
| `ARENA_TOKEN_SECRET` | HMAC secret shared with bot for join tokens + admin endpoint. 32-byte hex. **Must match bot's `.env`**. |
| `ARENA_RESULT_SECRET` | HMAC secret for outbound POST to bot's `/api/arena/result`. Distinct from token secret. **Must match bot's `.env`**. |

Optional (defaults sensible):

| Var | Default | |
|---|---|---|
| `ARENA_PORT` | `2567` | Colyseus + Express listen port |
| `ARENA_HOST` | `0.0.0.0` | Bind address |
| `BOT_RESULT_URL` | `http://localhost:3030/api/arena/result` | Bot's result endpoint |
| `MAX_CONCURRENT_ROOMS` | `5` | Vietnix 2GB safe headroom |
| `JOIN_DEADLINE_MS` | `300000` | 5 min join window |
| `TURN_DEADLINE_MS` | `30000` | 30s per turn |
| `COUNTDOWN_MS` | `3000` | Lobby → active delay |
| `ANIMATION_TIMEOUT_MS` | `8000` | Cap stall attack |
| `DISCONNECT_GRACE_MS` | `30000` | Network blip tolerance |
| `RESULT_DISPOSE_DELAY_MS` | `10000` | Show result before dispose |

---

## Production deploy

Sau khi all Lát đã ship (D.1-D.9):

```bash
# On Vietnix VM
ssh root@<vps>
cd /root/bots/radiant-tech-sect-bot/arena-server
npm install
npm run build
cp .env.example .env  # paste shared secrets from bot's .env

pm2 start dist/index.js --name radiant-arena-server --time
pm2 save

# Caddy config — add to /etc/caddy/Caddyfile:
# arena-api.billthedev.com {
#     reverse_proxy localhost:2567
# }
sudo systemctl reload caddy

# Verify from local
curl https://arena-api.billthedev.com/health
# → 200 OK

# In Discord: /arena debug → green Probe row
```

---

## Status hiện tại

**Lát D.1 done** — scaffold only. Server boots, /health returns 200, no DuelRoom registered yet.

Next: Lát D.2 — paste `SKILL.md` vào Claude session trong folder này và yêu cầu "Implement Lát D.2".

---

## References

| File | Khi nào đọc |
|---|---|
| `SKILL.md` | Mỗi session đầu tiên — load persona |
| `TASKS.md` | Khi bắt đầu Lát mới |
| `../docs/RADIANT_ARENA_ARCHITECTURE.md` | Architecture / contract spec |
| `../docs/RADIANT_ARENA_COLYSEUS.md` | Implementation walkthrough với code skeleton |
| `../src/modules/arena/tokens.ts` | HMAC reference — copy vào `src/auth/` |
| `../src/utils/health.ts` | Bot's result endpoint contract |
