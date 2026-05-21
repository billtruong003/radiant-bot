# Arena Server — Read-Only Extract for Unity D.U2

> **Source**: Output từ Claude Code session chạy ở repo Colyseus server (`c:\Users\ADMIN\Downloads\Discord Sever\arena-server\`).
> **Date**: 2026-05-15
> **Purpose**: Input context cho Unity D.U2 (NetClient + Colyseus connect) — hand-mirror schemas, define message handlers, port HMAC token signer.
> **Status**: Read-only extract; KHÔNG modify server side. Re-run trước mỗi Lát Unity touching server contract (D.U3 select_weapon, D.U5 trajectory event format, etc.) vì server có thể đã shift.

---

## A. Repo state

**Branch / commits**: `main` (4 commits ahead of origin/main), clean working tree.
- HEAD: `fec478f` — docs(arena-unity): blueprint fine-tune
- `d701968` — feat(arena/Lát-D.2): DuelRoom skeleton + arena-unity blueprint + docs unify
- `7fb6c0f` — docs(arena): COLYSEUS_SERVER_GUIDE + UNITY_CLIENT_GUIDE
- `1c9f1b3` — feat(phase-13/A): Radiant Arena bot-side bridge (no Colyseus yet)

**`arena-server/package.json` key fields**:
```json
{
  "name": "radiant-arena-server",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=20.0.0" },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node --enable-source-maps dist/index.js",
    "typecheck": "tsc --noEmit",
    "lint": "biome check src",
    "test": "vitest run",
    "smoke": "tsx scripts/smoke-room.ts"
  }
}
```
⚠️ `scripts/smoke-room.ts` file does **NOT exist yet** (Lát D.3).

**Colyseus runtime — installed versions**:

| Package | Declared | Installed (lock-resolved) |
|---|---|---|
| colyseus | ^0.15.0 | 0.15.57 |
| @colyseus/core | ^0.15.0 | 0.15.57 |
| @colyseus/schema | ^2.0.0 | 2.0.37 |
| @colyseus/ws-transport | ^0.15.0 | 0.15.3 |

**Unity SDK match**: server runs Colyseus 0.15.x with schema v2. Unity SDK 0.15.x supports schema v2; pre-0.15 / schema v1 SDK builds are **NOT compatible**.

**Folder layout**:
```
arena-server/
├── .env.example
├── README.md
├── SKILL.md
├── TASKS.md
├── biome.json
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
├── src/
│   ├── index.ts         # Express + WSS boot + /health + /admin/create-room stub
│   ├── env.ts           # Zod env schema
│   ├── logger.ts        # Pino
│   ├── pending-rooms.ts # atomic roomCounter
│   ├── auth/
│   │   └── tokens.ts    # HMAC sign/verify (verbatim from bot)
│   └── rooms/
│       ├── DuelRoom.ts  # Room<DuelState> — onCreate/onAuth/onJoin/onLeave/onDispose ONLY
│       └── schemas.ts   # 7 Schema classes
└── tests/
    └── auth.test.ts     # 12 vitest cases — all green
```

**Lát status**:

| Lát | Status | What exists |
|---|---|---|
| D.1 scaffold | ✅ done | Express + Colyseus boot, /health, env, logger |
| D.2 DuelRoom skeleton | ✅ done | schemas + auth + room lifecycle (onCreate/onAuth/onJoin/onLeave/onDispose) |
| D.3 admin /create-room HMAC | ❌ NOT shipped | `src/index.ts` returns `501 'not implemented yet (Lát D.3)'` |
| D.4 turn loop (ready/shoot/etc messages) | ❌ NOT shipped | zero `onMessage` handlers in DuelRoom.ts |
| D.5 physics sim | ❌ NOT shipped | no `src/physics/*` |
| D.6 result callback | ❌ NOT shipped | no `src/callback/*` |
| D.7-D.11 | ❌ NOT shipped | — |

**Schema codegen / .fbs files**: ❌ None. No `npx schema-codegen` setup. → Option B in TASKS.md D.U2 **NOT viable**; Unity must hand-mirror schemas verbatim.

---

## B. Schemas (raw TypeScript)

**File**: `arena-server/src/rooms/schemas.ts` (full content)

```typescript
import { ArraySchema, MapSchema, Schema, type } from '@colyseus/schema';

export class WeaponStatsSchema extends Schema {
  @type('float32') power = 1.0;
  @type('float32') hitbox = 1.0;
  @type('float32') bounce = 0.5;
  @type('float32') damage_base = 20;
  @type('uint8') pierce_count = 0;
  @type('float32') crit_chance = 0;
  @type('float32') crit_multi = 1.5;
}

export class WeaponVisualSchema extends Schema {
  @type('string') model_prefab_key = '';
  @type('string') particle_fx_key = '';
  @type('string') trail_fx_key = '';
  @type('string') hue = '#ffffff';
}

export class WeaponSkillSchema extends Schema {
  @type('string') skill_id = '';
  /** 'passive' | 'onHit' | 'onCrit' | 'onLowHp' | 'signature' */
  @type('string') trigger = 'passive';
  @type('float32') magnitude = 0;
  @type('float32') cooldown = 0;
  @type('string') fx_key = '';
}

export class WeaponSchema extends Schema {
  @type('string') slug = '';
  @type('string') display_name = '';
  /** 'blunt' | 'pierce' | 'spirit' */
  @type('string') category = 'blunt';
  /** 'ban_menh' | 'pham' | 'dia' | 'thien' | 'tien' */
  @type('string') tier = 'pham';
  @type(WeaponStatsSchema) stats = new WeaponStatsSchema();
  @type(WeaponVisualSchema) visual = new WeaponVisualSchema();
  @type([WeaponSkillSchema]) skills = new ArraySchema<WeaponSkillSchema>();
}

export class TrajectoryPointSchema extends Schema {
  /** ms since shoot */
  @type('uint16') t = 0;
  @type('float32') x = 0;
  @type('float32') y = 0;
  /** '' | 'wall_bounce' | 'pierce_player' | 'hit:<dmg>' | 'crit:<dmg>' | 'stop' */
  @type('string') event = '';
}

export class PlayerSchema extends Schema {
  @type('string') discord_id = '';
  @type('string') display_name = '';
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('uint16') hp = 100;
  @type('uint16') hp_max = 100;
  /** Weapons the player can pick from in lobby — bot fills at room create. */
  @type([WeaponSchema]) available_weapons = new ArraySchema<WeaponSchema>();
  /** Server enforces ∈ available_weapons[].slug during lobby; locked at countdown. */
  @type('string') selected_weapon_slug = '';
  /** Cloned from available_weapons on countdown→active. */
  @type(WeaponSchema) weapon = new WeaponSchema();
  @type('boolean') ready = false;
  @type('boolean') connected = true;
  /** Epoch ms until which the signature skill is on cooldown. */
  @type('uint32') signature_cd_until = 0;
}

/**
 * 'waiting'   — room created, 0 players joined
 * 'lobby'     — 1-2 players present, picking weapons
 * 'countdown' — both ready, weapons locked, 3s pre-start
 * 'active'    — turn-based combat
 * 'animating' — shot resolved, waiting for client playback confirm
 * 'ended'     — terminal, result sent to bot, room disposing
 */
export class DuelState extends Schema {
  @type('string') session_id = '';
  @type('string') phase = 'waiting';
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type('string') turn_player_id = '';
  @type('uint32') turn_deadline_at = 0;
  @type('uint32') join_deadline_at = 0;
  @type('uint16') round = 0;
  @type('uint16') stake = 0;
  @type([TrajectoryPointSchema]) last_trajectory = new ArraySchema<TrajectoryPointSchema>();
  @type('string') last_shooter_id = '';
  @type('string') winner_id = '';
  /** '' | 'win' | 'timeout_join' | 'double_afk' | 'disconnect' | 'concede' */
  @type('string') outcome = '';
  @type('uint16') map_width = 1000;
  @type('uint16') map_height = 1000;
}
```

**Unity hand-mirror notes**:
- Field names snake_case strict — C# mirror MUST keep `discord_id`, `damage_base`, `pierce_count`, `signature_cd_until`, `crit_chance`, `crit_multi`, `model_prefab_key`, etc.
- Decorator order in C# must match TS class declaration order — schema v2 encodes by index.
- `MapSchema<PlayerSchema>` key is `discord_id` (string).
- `PlayerSchema.weapon` initialized to `new WeaponSchema()` (not null) — Unity nested schema fields must also default-construct.

---

## C. Message protocol

**Current code reality**: Zero `onMessage` handlers in `DuelRoom.ts`. No `broadcast()` calls. No `client.send()` calls. Below is **spec-only** (from docs §5), planned for D.4-D.6.

**C→S** (planned for Lát D.4):

| Type | Payload | Phase allowed | Validation |
|---|---|---|---|
| `select_weapon` | `{ slug: string }` | `lobby` | slug ∈ player.available_weapons; sets selected_weapon_slug; resets ready=false |
| `ready` | `{}` | `lobby`, weapon selected | requires selected_weapon_slug !== ''; sets ready=true; both ready → countdown |
| `unready` | `{}` | `lobby` | sets ready=false |
| `shoot` | `{ angle: number, power: number }` | `active`, your turn | angle clamped to [0, 2π]; power clamped to [0, 1]; sim + broadcast |
| `signature` | `{}` | `active`, your turn, cooldown ok | checks signature_cd_until |
| `concede` | `{}` | any active phase | forfeit; opponent wins |
| `animation_complete` | `{ round: number }` | `animating` | switch turn |
| `ping` | `{ t: number }` | any | echoes back |

**S→C broadcasts**:

| Type | Payload | When |
|---|---|---|
| `match_start` | `{ first_turn_id: string, seed: number }` | after countdown ends |
| `shot_resolved` | `{ trajectory: TrajectoryPoint[], shooter: string, damage_dealt: number, crit: boolean }` | after shot sim |
| `turn_switched` | `{ new_turn_id: string, deadline_at: number, round: number }` | after animation_complete (or timeout) |
| `signature_used` | `{ player_id: string, skill_id: string, fx_key: string }` | player triggers signature |
| `match_ended` | `{ winner: string, outcome: string, final_hp: { [discord_id]: number } }` | terminal |
| `pong` | `{ t: number, server_t: number }` | reply to ping |

**Error message format**:
```ts
client.send('error', { code: string, ...extra });
// Known codes per spec:
//   WEAPON_NOT_OWNED         { slug: string }
//   NO_WEAPON_SELECTED       {}
```

**State sync triggers** (auto-pushed by Colyseus via `@type` field changes):

| Field change | Trigger |
|---|---|
| `state.phase` | waiting → lobby (first join) → lobby (both selected+ready) → countdown → active → animating → active → … → ended |
| `state.turn_player_id` + `turn_deadline_at` + `round` | every animation_complete / 8s timeout / 30s AFK timeout |
| `state.last_trajectory` (clear+repush) + `last_shooter_id` | every successful shoot |
| `state.winner_id` + `outcome` | endMatch |
| `players.<id>.connected` | onJoin / onLeave |
| `players.<id>.hp` | after shot damage |

---

## D. Auth + handshake

**File**: `arena-server/src/auth/tokens.ts` (verbatim port of bot's `src/modules/arena/tokens.ts`)

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ArenaTokenPayload {
  session_id: string;
  discord_id: string;
  expires_at: number;     // epoch ms
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): Buffer | null {
  try {
    let pad = s.replace(/-/g, '+').replace(/_/g, '/');
    while (pad.length % 4 !== 0) pad += '=';
    return Buffer.from(pad, 'base64');
  } catch {
    return null;
  }
}

export function signToken(payload: ArenaTokenPayload, secret: string): string {
  if (!secret) throw new Error('arena/tokens: secret must be non-empty');
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload), 'utf-8'));
  const sig = createHmac('sha256', secret).update(payloadB64).digest('hex');
  return `${payloadB64}.${sig}`;
}

export function verifyToken(token: string, secret: string, nowMs = Date.now()): ArenaTokenPayload | null {
  if (!secret) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(payloadB64).digest('hex');
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig, 'utf-8'), Buffer.from(expected, 'utf-8'))) return null;
  const raw = base64UrlDecode(payloadB64);
  if (!raw) return null;
  // … shape validation, expiry check …
}

export function signBody(rawBody: Buffer, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}
```

**Token spec exact**:

| Field | Value |
|---|---|
| Payload JSON | `{ "session_id": string, "discord_id": string, "expires_at": number }` (epoch ms) |
| HMAC algorithm | HMAC-SHA256 |
| HMAC input | the base64url-encoded payload string (NOT the raw JSON bytes) |
| Payload encoding | base64url (RFC 4648 §5): `+`→`-`, `/`→`_`, strip `=` padding |
| Signature encoding | lowercase hex (Node's `.digest('hex')`) |
| Separator | literal `.` |
| Final format | `<payload_b64url>.<sig_hex>` |
| Comparison | `timingSafeEqual` over hex-string bytes |
| Expiry rejected when | `payload.expires_at <= nowMs` (strict `<=`) |
| Shared env var | `ARENA_TOKEN_SECRET` |

**Room name pattern**: server registers via `gameServer.define('duel', DuelRoom)`. Colyseus auto-generates `room.roomId` (random 9-char string), **NOT** `duel_${session_id}`. Unity client connects via `client.JoinById<DuelState>(roomId, { token })`.

**`onAuth` payload format** (from `DuelRoom.ts:165-177`):
```typescript
override onAuth(_client: Client, options: { token?: string }): { discord_id: string } {
  const payload = options?.token ? verifyToken(options.token, env.ARENA_TOKEN_SECRET) : null;
  if (!payload) throw new Error('invalid or expired token');
  if (payload.session_id !== this.state.session_id) throw new Error('token session mismatch');
  if (!this.state.players.has(payload.discord_id)) throw new Error('discord_id not in room roster');
  return { discord_id: payload.discord_id };
}
```
Client sends: `{ token: "<payload_b64>.<sig_hex>" }` as second arg to `client.joinById(roomId, { token })`.
Failure → Colyseus rejects WS upgrade with close code 4215.

**Admin endpoint `POST /admin/create-room`**: currently returns `501 'not implemented yet (Lát D.3)'`.

Spec contract (planned):
| | Value |
|---|---|
| Header | `X-Bot-Signature: sha256=<hex>` (HMAC over raw body with `ARENA_TOKEN_SECRET`) |
| Body | `{ session_id, stake, join_deadline_at, players: [...] }` |
| Response 200 | `{ ok: true, room_name: string, ws_url: string }` |
| Response 401 | `{ ok: false, error: 'invalid signature' }` |
| Response 503 | `{ ok: false, error: 'ROOM_LIMIT_REACHED', current, max, retry_after_seconds }` |

---

## E. seed-room.ts status (Lát D.3 helper)

❌ **Does not exist**. `arena-server/scripts/` directory does not exist.
❌ ETA: scheduled for Lát D.3, same Lát as admin endpoint.

**Workaround — DevTokenSigner C# port for Unity Editor**:

```csharp
using System;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;

public static class ArenaTokenSigner
{
    [Serializable]
    public struct Payload {
        public string session_id;
        public string discord_id;
        public long expires_at;   // epoch ms
    }

    public static string Sign(Payload payload, string secret)
    {
        var json = JsonConvert.SerializeObject(payload);
        var jsonBytes = Encoding.UTF8.GetBytes(json);
        var payloadB64 = Convert.ToBase64String(jsonBytes)
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var sigBytes = hmac.ComputeHash(Encoding.UTF8.GetBytes(payloadB64));
        var sigHex = BitConverter.ToString(sigBytes).Replace("-", "").ToLowerInvariant();
        return $"{payloadB64}.{sigHex}";
    }
}
```

**Gotcha**: Unity's built-in `JsonUtility.ToJson()` is alphabetic and may differ from Node's `JSON.stringify`. Use `Newtonsoft.Json` (`com.unity.nuget.newtonsoft-json` package) and define struct fields in same order as TS. Round-trip a known payload against server's vitest fixtures (`arena-server/tests/auth.test.ts`) before relying on it.

---

## F. Game constants

**Env defaults** (from `arena-server/src/env.ts`):

| Var | Default | Notes |
|---|---|---|
| `ARENA_PORT` | 2567 | |
| `ARENA_HOST` | 0.0.0.0 | |
| `MAX_CONCURRENT_ROOMS` | 5 | |
| `JOIN_DEADLINE_MS` | 300_000 (5 min) | |
| `TURN_DEADLINE_MS` | 30_000 (30 s) | |
| `COUNTDOWN_MS` | 3_000 (3 s) | lobby→active gate |
| `ANIMATION_TIMEOUT_MS` | 8_000 (8 s) | server uses this name; spec doc calls it `ANIMATION_CONFIRM_TIMEOUT_MS` |
| `DISCONNECT_GRACE_MS` | 30_000 (30 s) | |
| `RESULT_DISPOSE_DELAY_MS` | 10_000 (10 s) | dispose delay after match_ended |

**Map dimensions** (from DuelState schema defaults): `map_width = 1000`, `map_height = 1000`.

**Physics constants** (spec only — Lát D.5 not yet shipped, exists in docs §9 NOT in code yet):

| Constant | Value | Where it'll live |
|---|---|---|
| `STEP_MS` | 16 (~60Hz) | future `src/physics/trajectory.ts` |
| `MAX_STEPS` | 240 (≈4 s max trajectory) | same |
| `BASE_SPEED` | 500 units/sec at power=1 | same |
| Player radius | 35 units | hard-coded in spec's simulateShot |
| Hitbox base radius | 30 * stats.hitbox units | same |
| Self-hit grace | step > 2 (~32ms) | same |

⚠️ Unity must NOT hard-code physics constants for prediction — server is authoritative. Listed so client can size FX (trail length, particle scale) appropriately.

---

## G. Trajectory event string format

From schemas.ts docstring (`@type('string') event`):

| Value | Format | Notes |
|---|---|---|
| `''` | empty | normal trajectory tick (no event) |
| `'wall_bounce'` | literal | shot reflected off arena wall |
| `'pierce_player'` | literal — **no id appended** | pierce weapon passed through opponent (current schema spec; doc historically said `pierce_player:<id>` but code dropped id — TBD in D.5) |
| `'hit:<dmg>'` | `<dmg>` is integer (`Math.round(dmg)`) | blunt-style hit; trajectory continues bouncing |
| `'crit:<dmg>'` | `<dmg>` is integer | crit-multiplied hit |
| `'stop'` | literal | last trajectory point — energy depleted or pierce budget exhausted |

Unity parser: `string.Split(':')[0]` for prefix + `int.Parse(parts[1])` for damage. Defensive: handle unknown event strings (server may add new ones in D.7/D.8).

---

## H. Endpoints

**Local dev**:
- WS: `ws://localhost:2567` ✅ (env.ts:4 + index.ts:39)
- HTTP `/health` → `{ ok: true, uptime_ms, env }` (index.ts:19-25)
- HTTP `/admin/create-room` → currently 501, will be entry point after D.3

**Production** (not yet deployed — Lát D.9):
- WSS: `wss://arena-api.billthedev.com`
- Behind Caddy reverse proxy.

**Unity Colyseus SDK shape**:
```csharp
// Editor / local
var client = new Colyseus.ColyseusClient("ws://localhost:2567");

// Prod (when D.9 ships)
var client = new Colyseus.ColyseusClient("wss://arena-api.billthedev.com");

// Connect
var room = await client.JoinById<DuelState>(roomId, new { token = jwtFromBot });
```

---

## I. Mismatches vs spec / cross-repo

### 1. CRITICAL: bot ↔ server body shape mismatch

**Bot side** (`src/modules/arena/client.ts`) sends:
```ts
interface RoomPlayer {
  discord_id: string;
  display_name: string;
  token: string;
  weapon_data: { … };   // SINGULAR
}
```

**Server side** (`DuelRoom.ts:66-77`) expects:
```ts
const PlayerOptSchema = z.object({
  discord_id: z.string().min(1),
  display_name: z.string(),
  available_weapons: z.array(WeaponOptSchema).default([]),  // PLURAL array
});
```

Bot calling admin endpoint as-is → Zod rejects → room disposes immediately (`DuelRoom.ts:124-128`). Bot must update OR server Zod accept both shapes before end-to-end works. **Unity implication**: trust server schema — `PlayerSchema.available_weapons: ArraySchema<WeaponSchema>` is what Unity actually receives.

### 2. Env var naming drift (server vs spec doc)

| Spec doc | Actual server `env.ts` |
|---|---|
| `PORT` | `ARENA_PORT` |
| `HOST` | `ARENA_HOST` |
| `ANIMATION_CONFIRM_TIMEOUT_MS` | `ANIMATION_TIMEOUT_MS` |
| `BOT_RESULT_TIMEOUT_MS` (spec only) | — (not declared) |
| — | `RESULT_DISPOSE_DELAY_MS` (server only) |

### 3. Message handlers — completely absent. Until D.4 ships, Unity Send() = no-op.

### 4. Physics not implemented (D.5).

### 5. Result callback not implemented (D.6).

### 6. Admin endpoint URL fragment — Unity uses bare WSS origin + `JoinById(roomId)`, **NOT** parse `/duel/<id>` manually.

### 7. `WeaponSkillSchema.trigger` enum — docstring lists `'passive' | 'onHit' | 'onCrit' | 'onLowHp' | 'signature'` but server Zod doesn't enforce. Unity treat as open string.

---

## J. Next-step recommendation

**Can Unity start D.U2 now?** Yes — partially.

| D.U2 sub-task | Status | Notes |
|---|---|---|
| Hand-mirror Schema classes in C# | ✅ GO | Schemas stable since D.2 |
| ColyseusClient boot pointing at `ws://localhost:2567` | ✅ GO | server boots |
| onAuth token wire format `{ token: "<b64>.<hex>" }` | ✅ GO | locked by D.2 |
| DevTokenSigner C# port | ✅ GO | template in §E — Editor-only |
| Connect + listen to state diffs | ✅ GO | DuelRoom hydrates at onCreate |
| Wire C→S message stubs | ⚠️ STUB | server ignores until D.4 |
| Subscribe to S→C broadcasts | ⚠️ STUB | won't fire until D.4-D.6 |
| End-to-end smoke test | ❌ BLOCKED on D.3 | admin endpoint returns 501 |

**Suggested D.U2 split**:
- **D.U2a** (immediate): hand-mirror schemas + NetClient connect + onAuth handshake + state sync subscription. Test against workaround harness OR mock state. No message protocol yet.
- **D.U2b** (after server D.3 + D.4 ship): wire C→S sends, S→C broadcasts, full lobby → countdown → active loop smoke.

**Re-check this report before**:
- D.U3 (lobby weapon picker) — confirms `select_weapon` payload + error codes when D.4 ships
- D.U5 (trajectory playback) — confirms `TrajectoryPoint.event` strings when D.5 physics ships
- D.U6 (signature skills) — confirms `signature_used` broadcast when D.7 ships
- D.U7 (spirit weapons / zones) — confirms `DuelState.active_zones` schema addition when D.8 ships

---

*End of extract. Read-only; no server code modified.*
