# RADIANT ARENA — Architecture Document

> Version 0.1 · Initial spec
> Scope: backend API contract + Unity client structure + weapon data model
> Out of scope: PvE đánh quái (stub ở §11), tournament system, replay viewer (sẽ tách doc riêng)

---

## 0. Clarifications upfront

**Vercel KHÔNG host được Colyseus backend.** Vercel chạy serverless functions (max 5 min Pro, 1 min Hobby) — không giữ WebSocket persistent. Colyseus cần Node process 24/7. Self-host options khả thi:

- **Vietnix VM** (đã có, 2GB RAM, 2 cores, đủ cho 5-room cap) — RECOMMEND
- **Oracle Cloud Free Tier** (24GB RAM ARM, tách biệt bot) — backup khi scale
- **Fly.io / Railway** (credit-based free tier, không thật sự free 24/7)

Vercel/Cloudflare Pages dùng cho frontend Unity WebGL static, KHÔNG cho game server.

---

## 1. System Topology

Ba node độc lập, ràng nhau qua HTTPS + WSS:

```
┌─────────────┐         ┌──────────────────────────┐         ┌──────────────┐
│   Discord   │ <──WS──>│       Vietnix VM          │ <──WS──>│   Browser    │
│             │  bot    │  ┌─────────┐ ┌─────────┐  │  game   │  Unity WebGL │
│  Player A   │ gateway │  │   Bot   │ │Colyseus │  │  state  │              │
│  Player B   │         │  │  :3030  │ │  :2567  │  │         │  drag-shoot  │
│  #arena ch. │ <──────>│  └────┬────┘ └────┬────┘  │ <───────│  render      │
└─────────────┘  HTTPS  │       └──HMAC HTTP┘       │  HTTPS  └──────┬───────┘
                        │  ┌─────────┐ ┌─────────┐  │                │
                        │  │  WAL    │ │  Caddy  │  │                │
                        │  │  store  │ │  TLS    │  │  Cloudflare    │
                        │  └─────────┘ └─────────┘  │  Pages CDN     │
                        └──────────────────────────┘  (static assets)
```

**Public endpoints:**
- `arena.billthedev.com` — Cloudflare Pages, Unity WebGL build
- `arena-api.billthedev.com` — Caddy → Colyseus :2567 (WSS for game)
- `bot.billthedev.com` (existing) — Caddy → Bot :3030

---

## 2. Component Responsibilities

### 2.1 Discord Bot (Vietnix :3030)

**Owns:**
- Discord gateway connection (existing infra)
- `/duel` slash command + accept/decline DM buttons
- User entity (cống hiến, đan dược, weapon inventory)
- WAL store (existing custom store, extended với `weapon:*` và `replay:*` keys)
- HMAC token signing/verifying
- Colyseus room creation trigger (HTTP POST)
- Result post tới `#arena` channel + reward DMs

**Does NOT own:**
- Game state runtime (Colyseus owns)
- Physics simulation (Colyseus owns)
- Render/UI (Unity owns)

### 2.2 Colyseus Game Server (Vietnix :2567)

**Owns:**
- `DuelRoom` instances (max 5 concurrent — capped qua `MAX_CONCURRENT_ROOMS`)
- Authoritative turn state machine
- Physics simulation (trajectory snapshot pattern)
- Damage calculation, hit/miss resolution
- HMAC token verification on join (`onAuth`)
- Room timeout: 300s join window, 30s turn deadline
- Result callback tới bot khi match ends

**Does NOT own:**
- Player persistent data (bot owns)
- Discord identity (delegates to bot qua HMAC trust)
- Asset rendering (Unity owns)

### 2.3 Unity WebGL Client (Cloudflare Pages)

**Owns:**
- Render + audio + input
- BillGameCore service runtime (Bill.State, Bill.Events, Bill.Pool, etc.)
- Drag-aim-release input → outgoing `shoot` message
- Trajectory playback animation (interpolate received points)
- UI: HP bar, weapon stats display, ready button, result screen
- Colyseus client SDK (`colyseus.js` qua Unity bridge)

**Does NOT own:**
- Game truth (server authoritative)
- Damage calc (server tells client what happened)
- Persistence (server side)

---

## 3. Backend API Contract

### 3.1 Bot → Colyseus: Create Room

Bot gọi nội bộ qua loopback khi `/duel` được accept:

```http
POST http://localhost:2567/admin/create-room
Headers:
  X-Bot-Signature: <HMAC-SHA256 of body using BOT_COLYSEUS_SECRET>
  Content-Type: application/json

Body:
{
  "session_id": "xK7nQ2pM",
  "stake": 10,
  "join_deadline_at": 1747300800000,
  "players": [
    {
      "discord_id": "123456789",
      "display_name": "truongngocchau",
      "token": "<HMAC-token-A>",
      "weapon_slug": "phap-khi-ban-menh-123456789",
      "weapon_data": { /* full weapon JSON, see §6.5 */ }
    },
    {
      "discord_id": "987654321",
      "display_name": "bananadude1203",
      "token": "<HMAC-token-B>",
      "weapon_slug": "thiet-phien-thien-pham",
      "weapon_data": { /* ... */ }
    }
  ]
}
```

Response 200 OK:
```json
{
  "ok": true,
  "room_name": "duel_xK7nQ2pM",
  "ws_url": "wss://arena-api.billthedev.com/duel/duel_xK7nQ2pM"
}
```

Response 503 ROOM_LIMIT_REACHED:
```json
{
  "ok": false,
  "error": "ROOM_LIMIT_REACHED",
  "current": 5,
  "max": 5,
  "retry_after_seconds": 60
}
```

Bot xử khi 503: DM cả 2 player "Arena đang đầy (5/5), thử lại sau 1 phút" rồi rollback stake.

### 3.2 Colyseus → Bot: Result Callback

Khi match ended hoặc join timeout, Colyseus POST kết quả về bot:

```http
POST http://localhost:3030/api/arena/result
Headers:
  X-Arena-Signature: <HMAC-SHA256 of body using BOT_COLYSEUS_SECRET>

Body:
{
  "session_id": "xK7nQ2pM",
  "outcome": "win",
  "winner_id": "123456789",
  "loser_id": "987654321",
  "final_hp": { "123456789": 35, "987654321": 0 },
  "rounds_played": 7,
  "trajectory_snapshot": [
    { "round": 1, "shooter": "123456789", "points": [...], "damage": 18 },
    { "round": 2, "shooter": "987654321", "points": [...], "damage": 0 }
  ],
  "ended_at": 1747300920000
}
```

Outcome variants:
- `win` — HP của 1 player về 0 normally
- `timeout_join` — không đủ 2 player vào room trong 300s (no stake transfer, void)
- `double_afk` — cả 2 AFK liên tục (draw, no transfer)
- `disconnect` — 1 player disconnect >30s ở turn của họ (count as loss)

Response 200 OK:
```json
{
  "ok": true,
  "rewards_processed": true,
  "replay_url": "https://arena.billthedev.com/r/xK7nQ2pM"
}
```

### 3.3 HMAC Token Protocol

Token cho player vào Colyseus room (URL DM `?t=<token>`):

```
Token format (base64url):
  payload   = { session_id, discord_id, expires_at }
  signature = HMAC-SHA256(payload, ARENA_TOKEN_SECRET)
  token     = base64url(JSON(payload)) + "." + base64url(signature)

Expiry: 300s từ lúc bot tạo (cùng join window)

Verify trong Colyseus DuelRoom.onAuth:
  1. Split token thành payload/sig
  2. Recompute HMAC, compare constant-time
  3. Check expires_at > now
  4. Check session_id match room
  5. Check discord_id ∈ room.players
  → return { discord_id } cho onJoin
```

Shared secret `ARENA_TOKEN_SECRET` set ở environment, bot và Colyseus đều biết. KHÔNG share lên client.

---

## 4. Colyseus Room Protocol

### 4.1 Schema Definitions

```typescript
// arena/rooms/schemas.ts
import { Schema, MapSchema, ArraySchema, type } from '@colyseus/schema';

export class WeaponSchema extends Schema {
  @type('string') slug!: string;
  @type('string') category!: string;      // 'blunt' | 'pierce' | 'spirit'
  @type('string') tier!: string;          // 'ban_menh' | 'pham' | 'dia' | 'thien' | 'tien'
  @type('float32') power!: number;
  @type('float32') hitbox!: number;
  @type('float32') bounce!: number;
  @type('float32') damage_base!: number;
  @type('uint8') pierce_count = 0;        // 0 = blunt bounce, 1+ = pierce through N players
  @type('float32') crit_chance = 0;
  @type('float32') crit_multi = 1.5;
  @type(['string']) skill_ids = new ArraySchema<string>();
}

export class PlayerSchema extends Schema {
  @type('string') discord_id!: string;
  @type('string') display_name!: string;
  @type('float32') x!: number;
  @type('float32') y!: number;
  @type('uint16') hp = 100;
  @type('uint16') hp_max = 100;
  @type(WeaponSchema) weapon!: WeaponSchema;
  @type('boolean') ready = false;
  @type('boolean') connected = true;
  @type('uint32') signature_cd_until = 0;  // ms epoch
}

export class TrajectoryPoint extends Schema {
  @type('uint16') t!: number;             // ms từ lúc shoot
  @type('float32') x!: number;
  @type('float32') y!: number;
  @type('string') event = '';             // '' | 'wall_bounce' | 'pierce_player' | 'hit:<dmg>' | 'stop'
}

export class DuelState extends Schema {
  @type('string') session_id!: string;
  @type('string') phase = 'waiting';      // waiting | lobby | countdown | active | animating | ended
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type('string') turn_player_id = '';
  @type('uint32') turn_deadline_at = 0;
  @type('uint32') join_deadline_at = 0;
  @type('uint8') round = 0;
  @type([TrajectoryPoint]) last_trajectory = new ArraySchema<TrajectoryPoint>();
  @type('string') last_shooter_id = '';
  @type('string') winner_id = '';
  @type('string') outcome = '';
}
```

### 4.2 Client → Server Messages

| Message | Payload | Phase allowed | Effect |
|---|---|---|---|
| `ready` | `{}` | `lobby` | Mark player ready. Both ready → countdown |
| `shoot` | `{ angle: number, power: number }` | `active` + turn của mình | Server sims trajectory, broadcast, switch turn |
| `signature` | `{}` | `active` + turn của mình + có thiên cấp + cooldown OK | Activate vũ khí signature skill |
| `concede` | `{}` | bất kỳ phase active | Forfeit, opponent wins |
| `animation_complete` | `{ round: number }` | `animating` | Client confirms playback done, server tiến turn_switch |
| `ping` | `{ t: number }` | any | Server echoes for RTT measurement |

Input bounds:
- `angle`: 0 - 2π radians
- `power`: 0.0 - 1.0 (normalized)

Server validate range, clamp, ignore nếu out of bounds (anti-cheat).

### 4.3 Server → Client Broadcasts

State sync tự động qua schema. Ngoài ra có discrete events:

| Event | Payload | When |
|---|---|---|
| `match_start` | `{ first_turn_id: string }` | Sau countdown 3s |
| `shot_resolved` | `{ trajectory: TrajectoryPoint[], shooter: string, damage_dealt: number }` | Sau khi sim shoot xong, trước switch turn |
| `turn_switched` | `{ new_turn_id: string, deadline_at: number }` | Sau khi client confirm animation_complete |
| `signature_used` | `{ player_id: string, effect_id: string }` | Khi player active signature skill |
| `match_ended` | `{ winner: string, outcome: string }` | HP=0 hoặc AFK timeout |

Animation confirm có timeout 8s — nếu client không confirm thì server tự tiến (anti-stall attack).

### 4.4 Room Lifecycle States

```
                  bot creates room
                        │
                        ▼
                ┌──────────────┐  300s timeout
                │   waiting    │ ──────────────► outcome=timeout_join, dispose
                │ (no players) │
                └──────┬───────┘
                       │ player joins
                       ▼
                ┌──────────────┐
                │    lobby     │
                │ (1-2 players │
                │  not ready)  │
                └──────┬───────┘
                       │ both ready
                       ▼
                ┌──────────────┐
                │  countdown   │ 3s
                └──────┬───────┘
                       │ countdown done
                       ▼
                ┌──────────────┐   30s turn timeout
                │    active    │ ──── (AFK)
                │ (turn-based) │
                └──────┬───────┘
                       │ HP=0 OR timeout
                       ▼
                ┌──────────────┐
                │    ended     │  result POST to bot, dispose 10s sau
                └──────────────┘
```

---

## 5. Session Rules

| Constraint | Value | Reason |
|---|---|---|
| `MAX_CONCURRENT_ROOMS` | 5 | Vietnix 2GB safe headroom |
| `JOIN_DEADLINE` | 300s | Spec |
| `TURN_DEADLINE` | 30s | Fast pace |
| `COUNTDOWN_DURATION` | 3s | Standard |
| `ANIMATION_CONFIRM_TIMEOUT` | 8s | Cap stall attack |
| `DISCONNECT_GRACE` | 30s | Network blip tolerance trong turn của mình |
| `RESULT_DISPOSE_DELAY` | 10s | Cho UI hiển thị result trước khi dispose |

Khi room limit reached, bot reply 503 → DM cả 2 player. Quota implement bằng counter atomic trong Colyseus, decrement ở `onDispose`.

---

## 6. Weapon System

### 6.1 Categories

Ba loại với mechanic riêng:

| Category | VN Examples | Mechanic | Risk/Reward |
|---|---|---|---|
| **Blunt** (đập) | đại kiếm, chùy, búa tạ, thiết côn | Va vào opponent → văng ra theo bounce coefficient. Nếu kẹt 4 góc tường → bouncing đập liên tục cho tới khi mất hết động năng. Mỗi va chạm trừ `damage_base * speed_factor`. | Damage moderate, hit rate cao, có chance combo dame nếu lùa opponent vào góc |
| **Pierce** (xuyên) | thiết phiến, gươm, kiếm, trường thương | Xuyên qua opponent (không bounce off player), continue trajectory, có thể hit lại nếu bounce wall xong quay về. `pierce_count` = số lần đâm thủng trước khi stop. | Damage cao (~1.5x blunt), hitbox nhỏ hơn → khó trúng, đòi hỏi aim chính xác |
| **Spirit** (linh khí) | dị hoả, lệ băng, lôi châu, độc khí | Custom mechanic theo từng weapon. Vd dị hoả: leave fire trail trên path, DoT khi opponent đi qua. Lệ băng: hit → opponent miss next shot 30%. Lôi châu: chain damage (n/a 1v1, dùng PvE sau). | Strategic, damage thường lower base nhưng có debuff/DoT/zone control |

### 6.2 Tiers

| Tier | VN | Acquisition | Upgrade | Has Signature? |
|---|---|---|---|---|
| `ban_menh` | Bản Mệnh | Auto-forged khi user duel lần đầu, seeded từ Discord ID (deterministic) | KHÔNG (identity weapon) | No |
| `pham` | Phàm Phẩm | Mua bằng cống hiến | +5 level | No |
| `dia` | Địa Phẩm | Mua bằng cống hiến + đan dược | +10 level | No |
| `thien` | Thiên Phẩm | Drop tournament top 3, hoặc craft với material rare | +15 level | YES — 1 signature active skill per weapon |
| `tien` | Tiên Phẩm | Server-wide event, 1-of-1 unique | +20 level | YES — unique signature + passive |

### 6.3 Data Model (Class-based, NOT ScriptableObject)

Quyết định không dùng SO vì:
1. Player không mua weapon trong Unity UI — flow là mua qua Discord bot
2. Bot cần đọc/ghi weapon data, ScriptableObject không serializable cleanly cho server-side
3. JSON-based cho phép bot generate/modify weapon entries runtime (vd LLM gen bản mệnh)

```csharp
// Assets/RadiantArena/Scripts/Weapons/WeaponData.cs
using System;
using System.Collections.Generic;
using UnityEngine;

namespace RadiantArena.Weapons {

    [Serializable]
    public class WeaponData {
        public string slug;                   // unique id, e.g. "thiet-phien-thien-pham-001"
        public string display_name;
        public WeaponCategory category;
        public WeaponTier tier;
        public WeaponStats stats;
        public List<SkillRef> skills;
        public WeaponVisual visual;
        public string lore;                   // 1-2 câu flavor text

        public static WeaponData FromJson(string json) =>
            JsonUtility.FromJson<WeaponData>(json);

        public string ToJson() => JsonUtility.ToJson(this);
    }

    [Serializable]
    public class WeaponStats {
        public float power = 1.0f;            // 1.0 - 1.4
        public float hitbox = 1.0f;           // 0.85 - 1.15
        public float bounce = 0.5f;           // 0.35 - 0.65 (blunt cao, pierce thấp irrelevant)
        public float damage_base = 20f;
        public int pierce_count = 0;          // 0 = blunt, 1+ = pierce
        public float crit_chance = 0f;
        public float crit_multi = 1.5f;
    }

    [Serializable]
    public class SkillRef {
        public string skill_id;               // 'passive_lifesteal_10', 'signature_thiet_phien_quet'
        public SkillTrigger trigger;
        public float magnitude;               // % cho passive, dame multi cho active
        public float cooldown;                // 0 cho passive
        public string fx_key;                 // particle prefab key
    }

    [Serializable]
    public class WeaponVisual {
        public string model_prefab_key;       // Bill.Pool key
        public string particle_fx_key;
        public string trail_fx_key;           // empty cho tier thấp
        public string hue;                    // hex color cho dynamic tint
    }

    public enum WeaponCategory { Blunt, Pierce, Spirit }
    public enum WeaponTier { BanMenh, Pham, Dia, Thien, Tien }
    public enum SkillTrigger { Passive, OnHit, OnCrit, OnLowHp, Active, OnRoundStart }
}
```

### 6.4 Skill System

Hai loại skill — define class-based, runtime resolve qua skill_id registry:

**Passive** (luôn active, không cooldown):
```csharp
SkillRegistry.Register("passive_lifesteal_10",
    new PassiveLifesteal { pct = 0.10f });

SkillRegistry.Register("passive_low_hp_rage_15",
    new LowHpDamageBoost { threshold = 0.3f, boost = 0.15f });
```

**Active** (chỉ ở thiên/tiên cấp, có cooldown):
```csharp
// Kiếm linh — quét chéo gây damage chained
SkillRegistry.Register("signature_kiem_linh_quet",
    new SignatureKiemLinh {
        cooldown = 8f,
        fx_key = "fx_kiem_linh_arc",
        damage_multi = 1.8f
    });

// Dị hoả linh khí — leave fire zone trên path
SkillRegistry.Register("signature_di_hoa_burning_path",
    new SignatureBurningPath {
        cooldown = 10f,
        fx_key = "fx_burning_zone",
        dot_per_sec = 5,
        duration = 4f
    });
```

Skill resolution chạy server-side trong Colyseus (authoritative damage calc). Client chỉ render fx khi nhận `signature_used` event.

### 6.5 JSON Schema for Bot Integration

Bot lưu weapon entries trong WAL với key pattern `weapon:<slug>`. Mỗi entry:

```json
{
  "slug": "thiet-phien-thien-pham-001",
  "display_name": "Thiết Phiến Phong Lưu",
  "category": "Pierce",
  "tier": "Thien",
  "stats": {
    "power": 1.30,
    "hitbox": 0.95,
    "bounce": 0.40,
    "damage_base": 35,
    "pierce_count": 2,
    "crit_chance": 0.15,
    "crit_multi": 2.0
  },
  "skills": [
    {
      "skill_id": "passive_lifesteal_10",
      "trigger": "OnHit",
      "magnitude": 0.10,
      "cooldown": 0,
      "fx_key": "fx_lifesteal_drain"
    },
    {
      "skill_id": "signature_thiet_phien_quet",
      "trigger": "Active",
      "magnitude": 1.8,
      "cooldown": 8.0,
      "fx_key": "fx_phong_arc"
    }
  ],
  "visual": {
    "model_prefab_key": "weapon_thiet_phien_01",
    "particle_fx_key": "fx_wind_aura",
    "trail_fx_key": "trail_thien_pham_gold",
    "hue": "#D4AF37"
  },
  "lore": "Một thiết phiến rèn từ tinh hoa Phong Lưu Đảo, mỗi vết quét đều mang theo gió.",
  "shop": {
    "cost_cong_hien": 5000,
    "cost_dan_duoc": 50,
    "unlock_realm": "truc_co"
  }
}
```

Bot ops trên weapon catalog:
- `weapon:list` — query all weapons
- `weapon:get:<slug>` — single weapon
- `weapon:user:<discord_id>:owned` — list slugs user owns
- `weapon:user:<discord_id>:equipped` — current equipped slug
- Slash commands: `/shop weapon`, `/equip <slug>`, `/forge` (craft thiên phẩm sau)

Bản mệnh weapon đặc biệt: slug pattern `phap-khi-ban-menh-<discord_id>`, stats generate deterministic từ Discord ID hash, lưu permanent, không listed in shop.

---

## 7. Unity Client Architecture

### 7.1 GameObject Hierarchy

```
ArenaScene (Unity scene)
├── GameBootstrap (BillGameCore init, scene-level)
├── ArenaManager (root controller, registers states với Bill.State)
├── NetClient (Colyseus connection, sends/receives messages)
├── CameraRig (top-down orthographic, slight tilt)
├── MapRoot (4-wall square map, static)
│   ├── WallNorth / WallSouth / WallEast / WallWest
│   └── FloorMesh
├── PlayerASlot (Transform empty, anchor point)
│   └── [WeaponRoot spawned here at lobby phase]
├── PlayerBSlot
│   └── [WeaponRoot spawned here]
├── UIRoot (UIDocument, BillGameCore IUIService panels)
│   ├── LobbyPanel (visible in lobby phase)
│   ├── HudPanel (visible in active phase — HP, weapon name, turn indicator)
│   ├── TurnInputPanel (drag-aim-power UI, visible khi turn của mình)
│   └── ResultPanel (visible in ended phase)
└── FXRoot (parent cho particles spawned during match)
```

WeaponRoot prefab structure (instance được spawn vào player slot khi room joined):

```
WeaponRoot (GameObject)
├── [Components: WeaponController, NetworkSync, AudioSource]
├── Model (child, swappable mesh based on weapon.visual.model_prefab_key)
│   ├── [Components: MeshFilter, MeshRenderer, Collider (Trigger)]
│   ├── Particle (ParticleSystem, decorative ambient FX)
│   └── Trail (TrailRenderer, enabled khi tier >= Thien)
├── HitboxCollider (separate from model, sized theo weapon.stats.hitbox)
└── WorldUIAnchor (Transform, where world-space HP bar attaches)
```

WeaponController logic:
- Handle drag input (mouse/touch) trong turn của mình
- Calculate angle + power từ drag vector (max drag distance = power 1.0)
- On release: send `shoot` message qua NetClient
- Receive `shot_resolved` event → spawn trajectory playback (interpolate points qua Bill.Tween hoặc raw lerp)
- Spawn impact FX khi `event: hit:*` hoặc `wall_bounce`

### 7.2 BillGameCore Integration

Map các BillGameCore service vào Radiant Arena:

| BillGameCore | Radiant Arena Use |
|---|---|
| `Bill.State` | ArenaState machine: LobbyState, CountdownState, MyTurnState, OpponentTurnState, AnimatingState, EndState |
| `Bill.Events` | Bus cho gameplay events (xem §7.3) |
| `Bill.Pool` | Pool cho trajectory ball, impact FX, hit numbers, weapon prefabs |
| `Bill.UI` | Open/close LobbyPanel, HudPanel, TurnInputPanel, ResultPanel |
| `Bill.Audio` | SFX shoot, wall bounce, hit, signature activate; BGM lobby/combat |
| `Bill.Timer` | Turn countdown UI (Bill.Timer.Repeat 1s update remaining), animation delays |
| `Bill.Tween` | Camera shake on hit, HP bar fill animation, weapon idle bob |
| `Bill.Save` | KHÔNG dùng — server-authoritative, không save local. Bot WAL là source of truth |
| `Bill.Net` | KHÔNG dùng (Colyseus SDK riêng) — Bill.Net cho HTTP REST sau này (PvE) |
| `Bill.Config` | Read magic numbers: turn_timeout, animation speeds, camera params |

ArenaState examples:

```csharp
// Assets/RadiantArena/Scripts/States/MyTurnState.cs
public class MyTurnState : GameState {
    public override void Enter() {
        Bill.UI.Open<TurnInputPanel>(panel => {
            panel.SetWeapon(ArenaContext.MyWeapon);
            panel.OnShotReleased += OnShotReleased;
        });
        Bill.Events.Fire(new TurnStartedEvent { is_mine = true });
    }

    void OnShotReleased(float angle, float power) {
        NetClient.Send("shoot", new { angle, power });
        Bill.State.GoTo<AnimatingState>();
    }

    public override void Exit() {
        Bill.UI.Close<TurnInputPanel>();
    }
}
```

### 7.3 Event Bus Contract

Gameplay events qua `Bill.Events`, define như structs (no GC):

```csharp
namespace RadiantArena.Events {

    public struct MatchPhaseChangedEvent : IEvent {
        public string old_phase;
        public string new_phase;
    }

    public struct TurnStartedEvent : IEvent {
        public bool is_mine;
        public string turn_player_id;
        public uint deadline_at_ms;
    }

    public struct ShotFiredEvent : IEvent {
        public string shooter_id;
        public float angle;
        public float power;
    }

    public struct TrajectoryReceivedEvent : IEvent {
        public TrajectoryPoint[] points;
        public string shooter_id;
        public int damage_dealt;
    }

    public struct WallBounceEvent : IEvent {
        public Vector3 position;
        public Vector3 normal;
    }

    public struct PlayerHitEvent : IEvent {
        public string victim_id;
        public int damage;
        public bool is_crit;
        public Vector3 hit_point;
    }

    public struct HpChangedEvent : IEvent {
        public string player_id;
        public int hp_old;
        public int hp_new;
        public int hp_max;
    }

    public struct SignatureUsedEvent : IEvent {
        public string player_id;
        public string skill_id;
        public string fx_key;
    }

    public struct MatchEndedEvent : IEvent {
        public string winner_id;
        public string outcome;
        public int rounds_played;
    }
}
```

NetClient subscribes Colyseus state changes → translate → `Bill.Events.Fire(...)`. Tách network layer khỏi gameplay layer — components không touch Colyseus SDK directly.

### 7.4 Networking Layer

`NetClient` MonoBehaviour, lives ở root ArenaScene:

```csharp
public class NetClient : MonoBehaviour {
    Client client;
    Room<DuelState> room;

    async void Start() {
        var (sessionId, token) = ParseUrlQuery();
        client = new Client("wss://arena-api.billthedev.com");
        room = await client.JoinById<DuelState>($"duel_{sessionId}",
            new { token });

        room.OnStateChange += OnStateChange;
        room.OnMessage<TrajectoryResolved>("shot_resolved", OnShotResolved);
        room.OnMessage<MatchEnded>("match_ended", OnMatchEnded);

        Bill.Events.SubscribeOnce<GameReadyEvent>(_ => {
            Bill.State.GoTo<LobbyState>();
        });
    }

    void OnStateChange(DuelState state, bool isFirstState) {
        if (isFirstState) {
            ArenaContext.HydrateFrom(state);
        }
        if (state.phase != ArenaContext.CurrentPhase) {
            Bill.Events.Fire(new MatchPhaseChangedEvent {
                old_phase = ArenaContext.CurrentPhase,
                new_phase = state.phase
            });
            ArenaContext.CurrentPhase = state.phase;
        }
    }

    public void Send(string type, object payload) => room.Send(type, payload);
}
```

ArenaContext là static singleton holding current match snapshot (my_id, opponent_id, my_weapon, opponent_weapon, current_phase). Components read from it instead of touching Room state directly.

---

## 8. Data Flow Walkthrough

End-to-end khi user mua weapon mới và đấu trận:

```
1. User: /shop weapon trong Discord
   → bot reply embed với button mua

2. User: click "Mua Thiết Phiến Phong Lưu (5000 cống hiến)"
   → bot validate balance, deduct, append `weapon:user:<id>:owned += slug`
   → WAL append

3. User: /equip thiet-phien-thien-pham-001
   → bot set `weapon:user:<id>:equipped = slug`

4. User: /duel @opponent stake:10
   → bot DM opponent với accept button

5. Opponent: click Accept
   → bot:
     a. Generate session_id, 2 HMAC tokens
     b. Read equipped weapon của cả 2 từ WAL
     c. POST /admin/create-room tới Colyseus với weapon_data inline
     d. Colyseus tạo DuelRoom, hydrate state với weapons
     e. Bot DM 2 player arena link

6. 2 player click link → browser load Unity từ Cloudflare Pages
   → Unity parse URL, extract token, NetClient connects WSS
   → Colyseus verify token, onJoin
   → State sync to client → UI renders weapon stats

7. Lobby: both click Ready
   → Colyseus: phase=countdown → 3s → phase=active

8. Match: drag aim release per turn
   → Each shoot: server sim → trajectory broadcast → client playback → switch turn

9. HP=0:
   → Colyseus: phase=ended
   → POST /api/arena/result tới bot
   → Bot:
     a. Transfer stake (winner +10, loser -10)
     b. Append to WAL `replay:<session_id> = trajectory_blob`
     c. Post embed to #arena với replay URL
     d. DM cả 2 players outcome

10. Colyseus dispose room sau 10s
    → Room counter decrement
    → Slot mới mở cho duel kế
```

---

## 9. Vietnix Resource Budget (verified)

Đo trên VM 2GB hiện tại:

```
Current baseline:        310 MiB used, 1.4 GiB available
+ Colyseus base:         ~80 MiB
+ Caddy reverse proxy:   ~30 MiB
+ 5 active rooms × 10MB: ~50 MiB
= Total peak:            ~470 MiB
Headroom:                ~1.5 GiB still free
```

Action items trước khi cài:
- [x] Verified RAM dư (free -h)
- [ ] Add 1GB swap (vm.swappiness=10)
- [ ] Check Node version ≥ 18
- [ ] Verify port 2567 trống
- [ ] Setup Caddy reverse proxy config cho arena-api subdomain
- [ ] DNS record `arena.billthedev.com` → Cloudflare Pages
- [ ] DNS record `arena-api.billthedev.com` → Vietnix IP

---

## 10. Implementation Order (Lát)

| Lát | Scope | Deliverable | Blocked by |
|---|---|---|---|
| 13.1 | Colyseus scaffold + Caddy proxy + HMAC handshake + bot `/arena-debug` slash | Empty room joinable từ browser test page | None |
| 13.2 | Physics sim + trajectory + Unity debug scene (sphere placeholder) | Drag-shoot working end-to-end | 13.1 |
| 13.3 | Weapon data model + JSON schema + bản mệnh forge | `/duel` spawn room với weapon stats từ bot | 13.1 |
| 13.4 | Blunt + Pierce category mechanic divergence | Đập bounce vs xuyên xuyên working | 13.2, 13.3 |
| 13.5 | BillGameCore integration: states, events, panels | Unity client polished, BillGameCore-style code | 13.2 |
| 13.6 | Skill system + signature thiên phẩm | Active skill, passive trigger correctly | 13.3, 13.4 |
| 13.7 | Spirit category mechanic + 2-3 weapon templates | Dị hoả linh khí playable | 13.4, 13.6 |
| 13.8 | `/shop weapon` + `/equip` slash commands | Player purchase flow end-to-end | 13.3 |
| 13.9 | Replay save + public URL viewer | Share-able trận đấu | 13.2 |
| 13.10 | Art pass + 3D models 6-8 weapons | Polished visual ready for launch | 13.7 |

---

## 11. Future Stubs (out of current scope)

**PvE single-session:**
- Same DuelRoom infrastructure, opponent là AI behavior tree
- Quái boss có weapon riêng (server-side only)
- Drop reward → bot WAL → cống hiến accrue
- Stage progression saved in bot

**Tournament:**
- Bracket system trong bot
- Multiple rooms in parallel (cap còn 5, queue overflow)
- Auto-advance winners

**Migration to SpacetimeDB:**
- Chỉ cân nhắc khi >500 DAU và cần shared persistent world
- Colyseus pattern map sang STDB tables tự nhiên (room → instance, players → connected_clients table)

---

## 12. Open Implementation Decisions

Trước khi vào lát 13.1, cần chốt:

1. **Repo layout**: Colyseus code ở `radiant-bot/arena/` subfolder hay tách `radiant-arena` repo riêng?
2. **Unity build location**: Project Unity riêng cùng org `billtruong003`?
3. **Map size cụ thể**: 1000x1000 world units đề xuất, confirm fit camera top-down view?
4. **Damage formula**: `dmg = damage_base * speed_factor * crit_multi * (1 - opponent_armor)` — confirm có armor stat không hay skip cho v1?
5. **Camera**: orthographic top-down hay slight isometric tilt?

---

*End of architecture document.*
