# Radiant Arena — Colyseus Server Implementation Guide

> **Audience**: Dev (Bill) cầm doc này sang repo `radiant-arena-server` mới (Node 20 + TypeScript + Colyseus 0.15) và build ra một game server đầy đủ.
>
> **Contract upstream**: Discord bot ([./RADIANT_ARENA_ARCHITECTURE.md](RADIANT_ARENA_ARCHITECTURE.md), Lát A đã ship) — bot owns user/weapon persistence, signs HMAC tokens, receives match results.
>
> **Contract downstream**: Unity 6 WebGL client ([./RADIANT_ARENA_UNITY.md](RADIANT_ARENA_UNITY.md)) — owns rendering, audio, input, UX. Server is authoritative on gameplay truth.

---

## 0. Current state — what's done

| Component | State | Owner | File / Location |
|---|---|---|---|
| Bot-side bridge (HMAC sign/verify, /api/arena/result, weapon entities, /arena slash) | ✅ Shipped (commit `1c9f1b3`) | Discord bot repo | `src/modules/arena/`, `src/utils/health.ts`, `src/db/types.ts` |
| Weapon catalog seed (6 weapons) | ✅ Shipped | Discord bot repo | `src/config/weapon-catalog.json` |
| Bản mệnh deterministic forge | ✅ Shipped | Discord bot repo | `src/modules/arena/forge.ts` |
| HMAC token protocol | ✅ Specified + implemented bot-side | Discord bot repo | `src/modules/arena/tokens.ts` |
| Architecture spec | ✅ v0.1 | Both | `docs/RADIANT_ARENA_ARCHITECTURE.md` |
| **Colyseus server** | ❌ Greenfield — this doc | New repo | `radiant-arena-server/` |
| **Unity WebGL client** | ❌ Greenfield — sibling doc | New repo | `radiant-arena-client/` |

**Bot is "Colyseus-ready"** — behind `ARENA_ENABLED=false`. Khi server lên xanh và Unity ship đầy đủ, flip flag thì pipeline tự nối.

**Design shift quan trọng (override architecture v0.1)**: Weapon selection happens in **Unity lobby**, not pre-baked at bot-side room creation. Bot passes the player's **owned weapon list** (one array of WeaponData per player); Unity shows a picker; player chooses + clicks Ready. Section §6.2 below details this.

---

## 1. Repo scaffold

```bash
mkdir radiant-arena-server && cd radiant-arena-server
npm init -y
npm i colyseus @colyseus/schema express
npm i -D typescript tsx @types/node @types/express vitest @biomejs/biome
```

`package.json` (key scripts):
```json
{
  "name": "radiant-arena-server",
  "type": "module",
  "engines": { "node": ">=20.0.0" },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "biome check src tests"
  }
}
```

`tsconfig.json` — strict mode, target ES2022, module nodenext, decorators enabled (Colyseus schemas dùng decorators):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

**Directory layout:**
```
radiant-arena-server/
├── src/
│   ├── index.ts                    # Boot: Colyseus + Express admin + health
│   ├── server.ts                   # ArenaServer wrapper
│   ├── config/
│   │   └── env.ts                  # Zod-validated env
│   ├── rooms/
│   │   ├── DuelRoom.ts             # Main room class
│   │   ├── schemas.ts              # DuelState + sub-schemas
│   │   └── lifecycle.ts            # Phase transitions (lobby→countdown→active→ended)
│   ├── physics/
│   │   ├── trajectory.ts           # Server-authoritative shot sim
│   │   ├── walls.ts                # Wall bounce math
│   │   ├── collision.ts            # Player hit detection (blunt vs pierce)
│   │   └── damage.ts               # Damage formula
│   ├── weapons/
│   │   ├── catalog.ts              # Authorized weapon registry
│   │   └── skills.ts               # Passive + active skill resolution
│   ├── auth/
│   │   └── tokens.ts               # HMAC verify (matches bot's signToken)
│   ├── callback/
│   │   └── botResult.ts            # POST /api/arena/result to bot
│   ├── admin/
│   │   └── createRoom.ts           # Express handler for bot→Colyseus
│   └── utils/
│       ├── logger.ts               # Pino structured logging
│       └── rng.ts                  # Seeded RNG for replay determinism
├── tests/
│   ├── physics/                    # trajectory math unit tests
│   ├── tokens.test.ts              # round-trip with bot's secret
│   ├── damage.test.ts
│   └── duel-room.test.ts           # Room state transitions
├── tsconfig.json
├── biome.json
└── .env.example
```

---

## 2. Environment variables

```bash
# Network
PORT=2567                          # Colyseus WS + Express HTTP
ADMIN_PORT=2568                    # Optional separate admin port (else same as PORT)
HOST=0.0.0.0

# Shared secrets with bot
ARENA_TOKEN_SECRET=<32-byte hex>   # MUST match bot's ARENA_TOKEN_SECRET
ARENA_RESULT_SECRET=<32-byte hex>  # MUST match bot's ARENA_RESULT_SECRET

# Bot callback
BOT_RESULT_URL=http://localhost:3030/api/arena/result
BOT_RESULT_TIMEOUT_MS=5000

# Capacity caps
MAX_CONCURRENT_ROOMS=5
JOIN_DEADLINE_MS=300000
TURN_DEADLINE_MS=30000
COUNTDOWN_MS=3000
ANIMATION_CONFIRM_TIMEOUT_MS=8000
DISCONNECT_GRACE_MS=30000

# Logging
LOG_LEVEL=info
NODE_ENV=development
```

---

## 3. State schema (Colyseus)

All schemas extend `Schema` từ `@colyseus/schema`. Field types use Colyseus's `@type` decorator để auto-sync state về clients.

```typescript
// src/rooms/schemas.ts
import { Schema, MapSchema, ArraySchema, type } from '@colyseus/schema';

/** Mirrors bot's WeaponStats — never expand server-side. */
export class WeaponStatsSchema extends Schema {
  @type('float32') power = 1.0;
  @type('float32') hitbox = 1.0;
  @type('float32') bounce = 0.5;
  @type('float32') damage_base = 20;
  @type('uint8') pierce_count = 0;
  @type('float32') crit_chance = 0;
  @type('float32') crit_multi = 1.5;
}

/** A skill on a weapon — ID resolved by `weapons/skills.ts`. */
export class WeaponSkillSchema extends Schema {
  @type('string') skill_id = '';
  @type('string') trigger = 'passive';
  @type('float32') magnitude = 0;
  @type('float32') cooldown = 0;
  @type('string') fx_key = '';
}

/** Visual hints — server passes through, client interprets. */
export class WeaponVisualSchema extends Schema {
  @type('string') model_prefab_key = '';
  @type('string') particle_fx_key = '';
  @type('string') trail_fx_key = '';
  @type('string') hue = '#ffffff';
}

export class WeaponSchema extends Schema {
  @type('string') slug = '';
  @type('string') display_name = '';
  @type('string') category = 'blunt';     // 'blunt' | 'pierce' | 'spirit'
  @type('string') tier = 'pham';          // 'ban_menh'|'pham'|'dia'|'thien'|'tien'
  @type(WeaponStatsSchema) stats = new WeaponStatsSchema();
  @type(WeaponVisualSchema) visual = new WeaponVisualSchema();
  @type([WeaponSkillSchema]) skills = new ArraySchema<WeaponSkillSchema>();
}

export class TrajectoryPointSchema extends Schema {
  @type('uint16') t = 0;        // ms since shoot
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
  /** Available weapons the player can pick from in lobby. Sent by bot at
   *  room creation; Unity filters to ones it has local data for. */
  @type([WeaponSchema]) available_weapons = new ArraySchema<WeaponSchema>();
  /** Server enforces this matches one of available_weapons.slug. */
  @type('string') selected_weapon_slug = '';
  /** Resolved at countdown→active transition. Null until then. */
  @type(WeaponSchema) weapon = new WeaponSchema();
  @type('boolean') ready = false;
  @type('boolean') connected = true;
  @type('uint32') signature_cd_until = 0;
}

export class DuelState extends Schema {
  @type('string') session_id = '';
  @type('string') phase = 'waiting';
  /** 'waiting' | 'lobby' | 'countdown' | 'active' | 'animating' | 'ended' */
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type('string') turn_player_id = '';
  @type('uint32') turn_deadline_at = 0;
  @type('uint32') join_deadline_at = 0;
  @type('uint16') round = 0;
  @type('uint16') stake = 0;
  @type([TrajectoryPointSchema]) last_trajectory = new ArraySchema<TrajectoryPointSchema>();
  @type('string') last_shooter_id = '';
  @type('string') winner_id = '';
  @type('string') outcome = '';            // see §7 outcome variants
  @type('uint16') map_width = 1000;
  @type('uint16') map_height = 1000;
}
```

**Why this layout**:
- `players` is `MapSchema<PlayerSchema>` keyed by discord_id — clients lookup their own / opponent easily.
- `available_weapons` per-player is the **new contract**: bot passes the full inventory subset Unity can pick from (typically owned weapons + bản mệnh). Empty array = use bản mệnh only.
- `selected_weapon_slug` is mutable in `lobby` phase; locked after `countdown`.
- `last_trajectory` is the broadcast of the most recent shot — clients animate from this.

---

## 4. Room lifecycle

```
                  bot POST /admin/create-room
                              │
                              ▼
              ┌──────────────────┐  300s no-join
              │   waiting        │ ──────────────► outcome=timeout_join, dispose
              │ (room created,   │
              │  0 players)      │
              └──────┬───────────┘
                     │ first player joins (onJoin)
                     ▼
              ┌──────────────────┐
              │   lobby          │
              │ (1-2 players,    │
              │  picking weapons)│
              └──────┬───────────┘
                     │ both selected_weapon_slug !== '' AND both ready=true
                     ▼
              ┌──────────────────┐
              │   countdown      │ 3s (env COUNTDOWN_MS)
              │ (weapons locked) │
              └──────┬───────────┘
                     │ countdown done → seed RNG, place players at slots
                     ▼
              ┌──────────────────┐   30s no-shoot
              │   active         │ ─── (AFK on your turn)
              │ (turn-based)     │
              └──────┬───────────┘
                     │ HP=0 OR both AFK OR concede OR disconnect
                     ▼
              ┌──────────────────┐
              │   ended          │ result POST to bot, dispose 10s sau
              └──────────────────┘
```

Implementation skeleton:

```typescript
// src/rooms/DuelRoom.ts
import { Room, Client, type ClientArray } from 'colyseus';
import { DuelState, PlayerSchema, WeaponSchema } from './schemas.js';
import { verifyToken } from '../auth/tokens.js';
import { simulateShot } from '../physics/trajectory.js';
import { postResult } from '../callback/botResult.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

interface CreateOptions {
  session_id: string;
  stake: number;
  join_deadline_at: number;
  players: Array<{
    discord_id: string;
    display_name: string;
    available_weapons: WeaponSchema[];   // sanitised already
  }>;
}

export class DuelRoom extends Room<DuelState> {
  static MAX_PLAYERS = 2;

  private joinDeadlineTimer?: NodeJS.Timeout;
  private turnDeadlineTimer?: NodeJS.Timeout;
  private animationDeadlineTimer?: NodeJS.Timeout;
  private disconnectGraceTimers = new Map<string, NodeJS.Timeout>();

  onCreate(options: CreateOptions): void {
    this.maxClients = DuelRoom.MAX_PLAYERS;
    this.autoDispose = true;

    const state = new DuelState();
    state.session_id = options.session_id;
    state.stake = options.stake;
    state.join_deadline_at = options.join_deadline_at;
    state.phase = 'waiting';

    for (const p of options.players) {
      const player = new PlayerSchema();
      player.discord_id = p.discord_id;
      player.display_name = p.display_name;
      // Bot pre-sanitised display_name (allowedMentions stripped, etc).
      for (const w of p.available_weapons) {
        player.available_weapons.push(w);
      }
      // Auto-fallback: if no weapons (shouldn't happen), seed with bản mệnh
      // by ID convention — Unity computes preview deterministically.
      state.players.set(p.discord_id, player);
    }

    this.setState(state);

    this.scheduleJoinDeadline();
    this.registerMessageHandlers();
    logger.info({ session_id: state.session_id }, 'duel-room: created');
  }

  async onAuth(client: Client, options: { token: string }): Promise<{ discord_id: string }> {
    const payload = verifyToken(options.token, env.ARENA_TOKEN_SECRET);
    if (!payload) throw new Error('invalid token');
    if (payload.session_id !== this.state.session_id) {
      throw new Error('token session mismatch');
    }
    if (!this.state.players.has(payload.discord_id)) {
      throw new Error('discord_id not in room');
    }
    return { discord_id: payload.discord_id };
  }

  onJoin(client: Client, _options: unknown, auth: { discord_id: string }): void {
    client.userData = { discord_id: auth.discord_id };
    const p = this.state.players.get(auth.discord_id);
    if (!p) return;
    p.connected = true;
    // Clear any pending disconnect grace
    const grace = this.disconnectGraceTimers.get(auth.discord_id);
    if (grace) {
      clearTimeout(grace);
      this.disconnectGraceTimers.delete(auth.discord_id);
    }

    // Phase transition: waiting → lobby on first join
    if (this.state.phase === 'waiting') {
      this.state.phase = 'lobby';
    }
    logger.info({ session_id: this.state.session_id, discord_id: auth.discord_id }, 'duel-room: player joined');
  }

  onLeave(client: Client, consented: boolean): void {
    const discordId = (client.userData as { discord_id?: string }).discord_id;
    if (!discordId) return;
    const p = this.state.players.get(discordId);
    if (!p) return;
    p.connected = false;

    if (consented || this.state.phase === 'ended') return;

    // During active turn of this player: start disconnect grace
    if (this.state.phase === 'active' && this.state.turn_player_id === discordId) {
      const t = setTimeout(() => {
        this.endMatch('disconnect', this.getOpponentId(discordId));
      }, env.DISCONNECT_GRACE_MS);
      this.disconnectGraceTimers.set(discordId, t);
    }
  }

  async onDispose(): Promise<void> {
    for (const t of [this.joinDeadlineTimer, this.turnDeadlineTimer, this.animationDeadlineTimer]) {
      if (t) clearTimeout(t);
    }
    for (const t of this.disconnectGraceTimers.values()) clearTimeout(t);
    logger.info({ session_id: this.state.session_id, outcome: this.state.outcome }, 'duel-room: disposed');
  }

  // --- See §5 for message handlers, §6 for phase transitions, §7 for endMatch ---

  private scheduleJoinDeadline(): void { /* … */ }
  private registerMessageHandlers(): void { /* see §5 */ }
  private getOpponentId(discordId: string): string {
    const ids = [...this.state.players.keys()];
    return ids.find((id) => id !== discordId) ?? '';
  }
  private endMatch(outcome: string, winnerId: string): void { /* see §7 */ }
}
```

---

## 5. Message protocol

| Direction | Type | Payload | Phase allowed | Effect |
|---|---|---|---|---|
| C→S | `select_weapon` | `{ slug: string }` | `lobby` | Validate slug ∈ player.available_weapons; set `selected_weapon_slug` |
| C→S | `ready` | `{}` | `lobby`, weapon selected | Toggle `player.ready`; if both ready → countdown |
| C→S | `unready` | `{}` | `lobby` | Toggle `player.ready=false` (undo) |
| C→S | `shoot` | `{ angle: number, power: number }` | `active`, your turn | Validate range, sim trajectory, broadcast, switch turn |
| C→S | `signature` | `{}` | `active`, your turn, có signature, cooldown OK | Activate signature skill |
| C→S | `concede` | `{}` | any active phase | Forfeit; opponent wins |
| C→S | `animation_complete` | `{ round: number }` | `animating` | Client confirms playback done; switch turn now |
| C→S | `ping` | `{ t: number }` | any | Server echoes for RTT |
| S→C broadcast | `match_start` | `{ first_turn_id: string, seed: number }` | (after countdown) | Tells client game live + RNG seed for deterministic FX replay |
| S→C broadcast | `shot_resolved` | `{ trajectory: TrajectoryPoint[], shooter: string, damage_dealt: number, crit: boolean }` | (after shot sim) | Triggers Unity playback |
| S→C broadcast | `turn_switched` | `{ new_turn_id: string, deadline_at: number, round: number }` | (after animation confirm) | Updates turn UI |
| S→C broadcast | `signature_used` | `{ player_id: string, skill_id: string, fx_key: string }` | (when player triggers) | FX spawn cue |
| S→C broadcast | `match_ended` | `{ winner: string, outcome: string, final_hp: { [id]: number } }` | (terminal) | Show result screen |
| S→C broadcast | `pong` | `{ t: number, server_t: number }` | (in reply to ping) | RTT measurement |

**Server-side handler example** (shoot):

```typescript
private registerMessageHandlers(): void {
  this.onMessage('shoot', (client, payload: { angle: number; power: number }) => {
    const discordId = (client.userData as { discord_id?: string }).discord_id;
    if (!discordId) return;
    if (this.state.phase !== 'active') return;
    if (this.state.turn_player_id !== discordId) return;
    const shooter = this.state.players.get(discordId);
    const opponent = this.state.players.get(this.getOpponentId(discordId));
    if (!shooter || !opponent) return;

    // Input bounds (anti-cheat)
    const angle = Math.max(0, Math.min(Math.PI * 2, payload.angle));
    const power = Math.max(0, Math.min(1, payload.power));

    // Sim
    const result = simulateShot({
      shooter,
      opponent,
      angle,
      power,
      mapWidth: this.state.map_width,
      mapHeight: this.state.map_height,
    });

    // Apply damage
    opponent.hp = Math.max(0, opponent.hp - result.damage);

    // Broadcast trajectory
    this.state.last_trajectory.clear();
    for (const pt of result.trajectory) {
      this.state.last_trajectory.push(pt);
    }
    this.state.last_shooter_id = discordId;

    this.broadcast('shot_resolved', {
      trajectory: result.trajectory,
      shooter: discordId,
      damage_dealt: result.damage,
      crit: result.crit,
    });

    // Check for KO
    if (opponent.hp <= 0) {
      this.endMatch('win', discordId);
      return;
    }

    // Phase → animating
    this.state.phase = 'animating';
    this.scheduleAnimationConfirmTimeout();
  });

  this.onMessage('animation_complete', (client, _payload) => {
    if (this.state.phase !== 'animating') return;
    this.advanceTurn();
  });

  // ... select_weapon, ready, unready, signature, concede, ping
}
```

---

## 6. Lifecycle details

### 6.1 — Join deadline

```typescript
private scheduleJoinDeadline(): void {
  const remaining = this.state.join_deadline_at - Date.now();
  this.joinDeadlineTimer = setTimeout(() => {
    if (this.state.phase === 'waiting' || this.state.phase === 'lobby') {
      // Check if both players present
      const allPresent = [...this.state.players.values()].every((p) => p.connected);
      if (!allPresent) {
        this.endMatch('timeout_join', '');
      }
    }
  }, Math.max(0, remaining));
}
```

### 6.2 — Weapon selection (lobby phase)

**Design contract**: Bot at room creation sends each player's `available_weapons` array. Unity displays these in a picker. **Unity must also have local data** (mesh, FX prefabs) for each weapon. If Unity's local DB lacks a weapon ID, it's hidden in the picker — server side doesn't care; user can only `select_weapon` with a slug from the server-authorized list.

```typescript
this.onMessage('select_weapon', (client, payload: { slug: string }) => {
  const discordId = (client.userData as { discord_id?: string }).discord_id;
  if (!discordId) return;
  if (this.state.phase !== 'lobby') return;
  const p = this.state.players.get(discordId);
  if (!p) return;
  const owned = p.available_weapons.find((w) => w.slug === payload.slug);
  if (!owned) {
    client.send('error', { code: 'WEAPON_NOT_OWNED', slug: payload.slug });
    return;
  }
  p.selected_weapon_slug = payload.slug;
  // Selecting a weapon implicitly unready (forces re-ready after change)
  p.ready = false;
});

this.onMessage('ready', (client, _payload) => {
  const discordId = (client.userData as { discord_id?: string }).discord_id;
  if (!discordId) return;
  if (this.state.phase !== 'lobby') return;
  const p = this.state.players.get(discordId);
  if (!p) return;
  if (!p.selected_weapon_slug) {
    client.send('error', { code: 'NO_WEAPON_SELECTED' });
    return;
  }
  p.ready = true;

  // Both ready? → countdown
  const players = [...this.state.players.values()];
  if (players.length === 2 && players.every((x) => x.ready && x.selected_weapon_slug)) {
    this.beginCountdown();
  }
});
```

### 6.3 — Countdown → Active

```typescript
private beginCountdown(): void {
  // Lock weapon choice — copy from available_weapons into weapon field
  for (const p of this.state.players.values()) {
    const w = p.available_weapons.find((x) => x.slug === p.selected_weapon_slug);
    if (w) p.weapon = w.clone();
  }
  this.state.phase = 'countdown';

  setTimeout(() => {
    this.startActive();
  }, env.COUNTDOWN_MS);
}

private startActive(): void {
  // Place players at slots
  const players = [...this.state.players.values()];
  players[0]!.x = this.state.map_width * 0.25;
  players[0]!.y = this.state.map_height * 0.5;
  players[1]!.x = this.state.map_width * 0.75;
  players[1]!.y = this.state.map_height * 0.5;

  // Coin-flip first turn (use deterministic seed for replay)
  const seed = Math.floor(Math.random() * 0xffffffff);
  const first = (seed & 1) ? players[0]!.discord_id : players[1]!.discord_id;
  this.state.turn_player_id = first;
  this.state.turn_deadline_at = Date.now() + env.TURN_DEADLINE_MS;
  this.state.phase = 'active';
  this.state.round = 1;

  this.broadcast('match_start', { first_turn_id: first, seed });
  this.scheduleTurnDeadline();
}
```

### 6.4 — Turn deadline

```typescript
private scheduleTurnDeadline(): void {
  if (this.turnDeadlineTimer) clearTimeout(this.turnDeadlineTimer);
  this.turnDeadlineTimer = setTimeout(() => {
    if (this.state.phase !== 'active') return;
    // Current player AFK — count toward double-AFK detector
    const me = this.state.turn_player_id;
    // For v1: single AFK on your turn = forfeit (no double-AFK draw yet)
    this.endMatch('disconnect', this.getOpponentId(me));
  }, env.TURN_DEADLINE_MS);
}
```

### 6.5 — Animation confirm timeout

```typescript
private scheduleAnimationConfirmTimeout(): void {
  if (this.animationDeadlineTimer) clearTimeout(this.animationDeadlineTimer);
  this.animationDeadlineTimer = setTimeout(() => {
    if (this.state.phase === 'animating') {
      // Client didn't confirm — auto-advance (anti-stall)
      this.advanceTurn();
    }
  }, env.ANIMATION_CONFIRM_TIMEOUT_MS);
}

private advanceTurn(): void {
  if (this.animationDeadlineTimer) clearTimeout(this.animationDeadlineTimer);
  this.state.phase = 'active';
  this.state.turn_player_id = this.getOpponentId(this.state.turn_player_id);
  this.state.turn_deadline_at = Date.now() + env.TURN_DEADLINE_MS;
  this.state.round++;
  this.broadcast('turn_switched', {
    new_turn_id: this.state.turn_player_id,
    deadline_at: this.state.turn_deadline_at,
    round: this.state.round,
  });
  this.scheduleTurnDeadline();
}
```

---

## 7. End-of-match & bot callback

```typescript
private async endMatch(outcome: string, winnerId: string): Promise<void> {
  if (this.state.phase === 'ended') return; // idempotent

  this.state.phase = 'ended';
  this.state.outcome = outcome;
  this.state.winner_id = winnerId;

  const players = [...this.state.players.values()];
  const finalHp: Record<string, number> = {};
  for (const p of players) finalHp[p.discord_id] = p.hp;

  this.broadcast('match_ended', { winner: winnerId, outcome, final_hp: finalHp });

  // Persist result back to bot
  try {
    await postResult({
      session_id: this.state.session_id,
      outcome,
      winner_id: winnerId,
      loser_id: winnerId ? this.getOpponentId(winnerId) : '',
      final_hp: finalHp,
      rounds_played: this.state.round,
      trajectory_snapshot: this.collectReplay(),
      ended_at: Date.now(),
    });
  } catch (err) {
    logger.error({ err, session_id: this.state.session_id }, 'duel-room: result POST failed');
  }

  // Dispose after grace period for UI
  setTimeout(() => this.disconnect(), 10_000);
}
```

**Outcome variants**:
- `win` — clean KO, stake transfers winner ←→ loser
- `timeout_join` — player(s) never joined, no stake transfer
- `double_afk` — both AFK; treated as draw, no transfer (rare in 1v1)
- `disconnect` — one player disconnected > grace; opponent wins

**Result callback** (`src/callback/botResult.ts`):

```typescript
import { createHmac } from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export interface ResultPayload {
  session_id: string;
  outcome: string;
  winner_id: string;
  loser_id: string;
  final_hp: Record<string, number>;
  rounds_played: number;
  trajectory_snapshot: unknown;
  ended_at: number;
}

export async function postResult(payload: ResultPayload): Promise<void> {
  const body = JSON.stringify(payload);
  const sig = `sha256=${createHmac('sha256', env.ARENA_RESULT_SECRET).update(body).digest('hex')}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), env.BOT_RESULT_TIMEOUT_MS);
  try {
    const res = await fetch(env.BOT_RESULT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-arena-signature': sig },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      logger.warn({ status: res.status, session_id: payload.session_id }, 'bot result POST non-2xx');
    }
  } finally {
    clearTimeout(t);
  }
}
```

---

## 8. Admin endpoint (Express) — bot → Colyseus

```typescript
// src/admin/createRoom.ts
import type { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { matchMaker } from 'colyseus';
import { logger } from '../utils/logger.js';

export async function handleCreateRoom(req: Request, res: Response): Promise<void> {
  // 1. HMAC body verification
  const rawBody: Buffer = (req as any).rawBody; // populated by express.raw middleware
  const sigHeader = req.header('x-bot-signature') ?? '';
  const expected = `sha256=${createHmac('sha256', env.ARENA_TOKEN_SECRET).update(rawBody).digest('hex')}`;
  if (sigHeader.length !== expected.length || !timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected))) {
    res.status(401).json({ ok: false, error: 'invalid signature' });
    return;
  }

  // 2. Capacity check
  const existing = (await matchMaker.query({ name: 'duel' })).length;
  if (existing >= env.MAX_CONCURRENT_ROOMS) {
    res.status(503).json({
      ok: false,
      error: 'ROOM_LIMIT_REACHED',
      current: existing,
      max: env.MAX_CONCURRENT_ROOMS,
      retry_after_seconds: 60,
    });
    return;
  }

  // 3. Spawn
  const body = JSON.parse(rawBody.toString('utf-8'));
  const room = await matchMaker.createRoom('duel', body);

  res.json({
    ok: true,
    room_name: room.roomId,
    ws_url: `wss://${req.hostname}/duel/${room.roomId}`,
  });
}
```

Wire up in `src/server.ts`:

```typescript
import express from 'express';
import { createServer } from 'http';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { DuelRoom } from './rooms/DuelRoom.js';
import { handleCreateRoom } from './admin/createRoom.js';
import { env } from './config/env.js';

export async function startServer(): Promise<void> {
  const app = express();
  app.use(express.raw({ type: 'application/json', limit: '32kb', verify: (req: any, _, buf) => { req.rawBody = buf; } }));
  app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));
  app.post('/admin/create-room', handleCreateRoom);

  const http = createServer(app);
  const gameServer = new Server({ transport: new WebSocketTransport({ server: http }) });
  gameServer.define('duel', DuelRoom);

  http.listen(env.PORT, env.HOST, () => {
    console.log(`[arena] Colyseus listening on ${env.HOST}:${env.PORT}`);
  });
}
```

---

## 9. Physics — server-authoritative shot sim

**Why server-authoritative**: client cheats are nullified. Client just renders what server tells it happened. The trajectory snapshot is the truth.

```typescript
// src/physics/trajectory.ts
import { PlayerSchema } from '../rooms/schemas.js';
import { TrajectoryPointSchema } from '../rooms/schemas.js';

export interface ShotInput {
  shooter: PlayerSchema;
  opponent: PlayerSchema;
  angle: number;
  power: number;
  mapWidth: number;
  mapHeight: number;
}

export interface ShotResult {
  trajectory: TrajectoryPointSchema[];
  damage: number;
  crit: boolean;
}

const STEP_MS = 16;            // sim step
const MAX_STEPS = 240;         // 240 * 16 ≈ 4 seconds max trajectory
const BASE_SPEED = 500;        // units/sec at power=1

export function simulateShot(input: ShotInput): ShotResult {
  const { shooter, opponent, angle, power, mapWidth, mapHeight } = input;
  const w = shooter.weapon;
  const stats = w.stats;

  // Initial velocity
  const speed = BASE_SPEED * power * stats.power;
  let vx = Math.cos(angle) * speed;
  let vy = Math.sin(angle) * speed;
  let x = shooter.x;
  let y = shooter.y;
  let t = 0;
  let pierceRemaining = stats.pierce_count;
  let totalDamage = 0;
  let crit = false;
  const trajectory: TrajectoryPointSchema[] = [];
  const hitbox = stats.hitbox * 30; // base radius 30 units

  for (let step = 0; step < MAX_STEPS; step++) {
    t += STEP_MS;
    const dt = STEP_MS / 1000;
    x += vx * dt;
    y += vy * dt;

    // Wall bounce
    let bounced = false;
    if (x < hitbox) { x = hitbox; vx = -vx * stats.bounce; bounced = true; }
    if (x > mapWidth - hitbox) { x = mapWidth - hitbox; vx = -vx * stats.bounce; bounced = true; }
    if (y < hitbox) { y = hitbox; vy = -vy * stats.bounce; bounced = true; }
    if (y > mapHeight - hitbox) { y = mapHeight - hitbox; vy = -vy * stats.bounce; bounced = true; }

    const point = new TrajectoryPointSchema();
    point.t = t;
    point.x = x;
    point.y = y;

    // Player collision
    const dx = x - opponent.x;
    const dy = y - opponent.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const playerRadius = 35;
    if (dist < hitbox + playerRadius && step > 2) { // grace 2 steps so shot doesn't self-hit
      const speedFactor = Math.sqrt(vx * vx + vy * vy) / BASE_SPEED;
      let dmg = stats.damage_base * speedFactor;
      const isCrit = Math.random() < stats.crit_chance;
      if (isCrit) { dmg *= stats.crit_multi; crit = true; }
      dmg = Math.round(dmg);
      totalDamage += dmg;
      point.event = isCrit ? `crit:${dmg}` : `hit:${dmg}`;
      trajectory.push(point);

      if (stats.pierce_count === 0) {
        // Blunt: bounce off player like wall
        const nx = dx / dist;
        const ny = dy / dist;
        const dot = vx * nx + vy * ny;
        vx -= 2 * dot * nx * stats.bounce;
        vy -= 2 * dot * nx * stats.bounce;
      } else {
        // Pierce: pass through, count down
        pierceRemaining--;
        if (pierceRemaining < 0) break;
      }
      continue;
    } else if (bounced) {
      point.event = 'wall_bounce';
    }

    trajectory.push(point);

    // Stop condition
    const v = Math.sqrt(vx * vx + vy * vy);
    if (v < 30) break; // run out of energy
  }

  if (trajectory.length > 0) {
    trajectory[trajectory.length - 1]!.event = 'stop';
  }

  return { trajectory, damage: totalDamage, crit };
}
```

**Weapon mechanic divergence**:
- `category='blunt'` → `pierce_count=0`, bounce off player like wall. Corner-trap = combo damage.
- `category='pierce'` → `pierce_count≥1`, pass through opponents until counter depletes. Bigger damage_base, smaller hitbox.
- `category='spirit'` → mostly pierce-like trajectory but with **post-trajectory effect** (zone fire, freeze, chain) handled separately in `skills.ts`. Damage_base typically lower, debuff stronger.

**Skill resolution** (`src/weapons/skills.ts`): keyed registry, runs after shot resolution.

```typescript
type SkillContext = {
  shooter: PlayerSchema;
  opponent: PlayerSchema;
  damage: number;
  crit: boolean;
  trajectory: TrajectoryPointSchema[];
  room: DuelRoom;
};

type SkillHandler = (ctx: SkillContext) => void;
const REGISTRY: Record<string, SkillHandler> = {};

export function registerSkill(id: string, h: SkillHandler): void { REGISTRY[id] = h; }

export function resolveSkills(ctx: SkillContext, trigger: string): void {
  for (const s of ctx.shooter.weapon.skills) {
    if (s.trigger !== trigger) continue;
    const handler = REGISTRY[s.skill_id];
    if (handler) handler(ctx);
  }
}

registerSkill('passive_lifesteal_10', (ctx) => {
  const heal = Math.round(ctx.damage * 0.1);
  ctx.shooter.hp = Math.min(ctx.shooter.hp_max, ctx.shooter.hp + heal);
});

registerSkill('passive_freeze_miss_30', (ctx) => {
  // 30% chance opponent's next shot misses — set a flag on opponent
  if (Math.random() < 0.3) {
    // Add a marker field on PlayerSchema (`next_shot_miss = true`)
    // and consume it in simulateShot when opponent shoots.
  }
});

// passive_burning_path, passive_corner_combo_15, etc. — defer until art ready
```

---

## 10. Clean code patterns

### Pure physics functions
Trajectory + damage are pure (no `Date.now()`, no DOM, no Colyseus state mutation in physics layer). State mutation happens at the Room layer **after** sim returns. Easy to unit test.

```typescript
// tests/physics/trajectory.test.ts
import { describe, it, expect } from 'vitest';
import { simulateShot } from '../../src/physics/trajectory.js';
import { PlayerSchema, WeaponSchema, WeaponStatsSchema } from '../../src/rooms/schemas.js';

describe('simulateShot', () => {
  it('blunt weapon bounces off opponent on hit', () => {
    const shooter = makePlayer(100, 500);
    const opponent = makePlayer(700, 500);
    shooter.weapon = makeWeapon({ pierce_count: 0, damage_base: 20 });
    const r = simulateShot({ shooter, opponent, angle: 0, power: 1.0, mapWidth: 1000, mapHeight: 1000 });
    expect(r.damage).toBeGreaterThan(0);
    // Shot continues after hit (bounced, not stopped)
    expect(r.trajectory.some((p) => p.event === 'wall_bounce' || p.event.startsWith('hit:'))).toBe(true);
  });

  it('pierce weapon passes through opponent', () => {
    const shooter = makePlayer(100, 500);
    const opponent = makePlayer(500, 500);
    shooter.weapon = makeWeapon({ pierce_count: 2, damage_base: 30 });
    const r = simulateShot({ shooter, opponent, angle: 0, power: 1.0, mapWidth: 1000, mapHeight: 1000 });
    const hits = r.trajectory.filter((p) => p.event.startsWith('hit:') || p.event.startsWith('crit:'));
    expect(hits.length).toBe(1); // only one player; pierce counter doesn't deplete on multi-hit
  });
});

function makePlayer(x: number, y: number): PlayerSchema {
  const p = new PlayerSchema();
  p.x = x; p.y = y; p.hp = 100; p.hp_max = 100;
  return p;
}
function makeWeapon(overrides: Partial<WeaponStatsSchema>): WeaponSchema {
  const w = new WeaponSchema();
  Object.assign(w.stats, overrides);
  return w;
}
```

### No `any`, strict mode
Same as bot — `tsconfig` strict, no escapes. `client.userData` is the one place to use `as` cast (Colyseus types it loosely) — wrap immediately:

```typescript
function getDiscordId(client: Client): string | null {
  return (client.userData as { discord_id?: string })?.discord_id ?? null;
}
```

### Deterministic where possible
Use seeded RNG (`utils/rng.ts`) for crit rolls so replay matches across clients:

```typescript
import { createHmac } from 'node:crypto';
export function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}
```

Replace `Math.random()` in `simulateShot` with this when reproducibility matters (replay viewer, regression tests).

### Structured logging
Pino in JSON. Every log carries `session_id` for correlation.

### Idempotent everything
- `onCreate` won't double-fire (Colyseus guarantees).
- `endMatch` short-circuits if `phase === 'ended'`.
- Result POST has retry-after at bot side (already handles duplicate session_id → 200 no-op).

---

## 11. Double-test workflow — 2 clients in Unity editor

**Goal**: Test full handshake + gameplay loop with 2 clients on dev machine without deploying.

### Stack

| Tool | Purpose |
|---|---|
| `npm run dev` | Colyseus on `localhost:2567` |
| Discord bot (existing) | Mock `/admin/create-room` requests, or directly use seed script |
| **ParrelSync** ([Unity Asset](https://github.com/VeriorPies/ParrelSync)) | Spawn 2 Unity editor instances pointing at same project — each acts as a player |
| `seed-room.ts` script | Standalone CLI: skip the bot, directly POST `/admin/create-room` with HMAC, print the 2 tokens + arena URLs to paste into Unity URL field |

### Step-by-step

1. **Start Colyseus**: `npm run dev` in `radiant-arena-server/`. Logs show `listening on 0.0.0.0:2567`.

2. **Optionally start Discord bot** (if you want full handshake): `npm run dev` in `radiant-bot/`. Use `/arena debug` to confirm reachability.

3. **OR use seed script** for fast iteration:

   ```typescript
   // scripts/seed-room.ts
   import { createHmac } from 'node:crypto';
   import { signToken } from '../src/auth/tokens.js';

   const SECRET = process.env.ARENA_TOKEN_SECRET!;
   const sessionId = `dev-${Date.now()}`;
   const tokenA = signToken({ session_id: sessionId, discord_id: 'devA', expires_at: Date.now() + 600_000 }, SECRET);
   const tokenB = signToken({ session_id: sessionId, discord_id: 'devB', expires_at: Date.now() + 600_000 }, SECRET);

   const body = JSON.stringify({
     session_id: sessionId,
     stake: 0,
     join_deadline_at: Date.now() + 300_000,
     players: [
       {
         discord_id: 'devA',
         display_name: 'DevAlpha',
         available_weapons: [
           // 2 weapons in dev kit
           { slug: 'thanh-kiem-pham-pham', display_name: 'Thanh Kiếm Phàm Phẩm', category: 'pierce', tier: 'pham',
             stats: { power: 1.1, hitbox: 0.95, bounce: 0.35, damage_base: 28, pierce_count: 1, crit_chance: 0.1, crit_multi: 1.8 },
             visual: { model_prefab_key: 'weapon_kiem_01', particle_fx_key: '', trail_fx_key: '', hue: '#8d9ba8' },
             skills: [],
           },
           { slug: 'thiet-con-pham-pham', display_name: 'Thiết Côn Phàm Phẩm', category: 'blunt', tier: 'pham',
             stats: { power: 1.05, hitbox: 1.1, bounce: 0.55, damage_base: 22, pierce_count: 0, crit_chance: 0.05, crit_multi: 1.5 },
             visual: { model_prefab_key: 'weapon_thiet_con_01', particle_fx_key: '', trail_fx_key: '', hue: '#a89b8d' },
             skills: [],
           },
         ],
       },
       { discord_id: 'devB', display_name: 'DevBravo', available_weapons: [/* same kit */] },
     ],
   });

   const sig = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
   const res = await fetch('http://localhost:2567/admin/create-room', {
     method: 'POST',
     headers: { 'content-type': 'application/json', 'x-bot-signature': sig },
     body,
   });
   const json = await res.json();
   console.log('\n=== ROOM CREATED ===');
   console.log(`Session: ${sessionId}`);
   console.log(`Room: ${json.room_name}`);
   console.log(`\nClient A URL (paste in ParrelSync instance 1):`);
   console.log(`  ws://localhost:2567 ?t=${tokenA}&session=${sessionId}`);
   console.log(`\nClient B URL (paste in ParrelSync instance 2):`);
   console.log(`  ws://localhost:2567 ?t=${tokenB}&session=${sessionId}`);
   ```

   Run: `npx tsx scripts/seed-room.ts` → copy the two URLs.

4. **ParrelSync setup**:
   - In Unity 6 project, install ParrelSync via Package Manager: `Window → Package Manager → +` → Git URL `https://github.com/VeriorPies/ParrelSync.git`.
   - `Window → ParrelSync → Clones Manager → Add new clone`.
   - Open clone in separate Unity instance.

5. **Unity dev URL bar**: Have the Unity scene support reading `?t=` from a debug field (visible in dev build / editor only). See `RADIANT_ARENA_UNITY.md` §3.

6. **Play scenario**:
   - Instance 1: paste URL A → loads Lobby → picks weapon → Ready
   - Instance 2: paste URL B → loads Lobby → picks weapon → Ready
   - Countdown 3s → Active. Take turns. Watch HP drain. Reach 0 → ended → both see result screen.
   - Colyseus logs `result POST sent to bot` (or warns if bot offline — fine for dev).

### Colyseus monitor

```bash
npm i @colyseus/monitor
```

```typescript
// in server.ts
import { monitor } from '@colyseus/monitor';
app.use('/colyseus', monitor());
```

Then visit `http://localhost:2567/colyseus` — see live rooms, clients, message rates, room state inspector. Invaluable for debugging.

---

## 12. Test scenarios (smoke checklist)

| # | Scenario | Expected outcome |
|---|---|---|
| 1 | Bot POSTs create-room valid HMAC + body | 200, room appears in monitor |
| 2 | Bot POSTs create-room invalid sig | 401 |
| 3 | Bot POSTs create-room when 5 rooms active | 503 ROOM_LIMIT_REACHED |
| 4 | Client joins with valid token | onAuth pass, onJoin fires |
| 5 | Client joins with expired token | onAuth throws → 4001 connection rejected |
| 6 | Client joins with token for different session | Rejected |
| 7 | Player picks unowned weapon | `error` message back, state unchanged |
| 8 | Both ready without weapon | First ready: error msg. State remains lobby |
| 9 | Both ready with weapons | Phase → countdown → active after 3s |
| 10 | Player shoots out of turn | Ignored silently |
| 11 | Player shoots with angle=NaN or power=999 | Clamped to valid range, sim still runs |
| 12 | Pierce weapon hits opponent | Damage applied, trajectory continues |
| 13 | Blunt weapon hits opponent | Damage applied, trajectory bounces off |
| 14 | HP reaches 0 | match_ended fires immediately, no further turns |
| 15 | One player disconnects mid-turn | After grace, opponent wins by `disconnect` |
| 16 | Animation_complete not received in 8s | Server auto-advances turn |
| 17 | Both players AFK 30s | Opponent of current turn wins (or double_afk if no current) |
| 18 | Concede mid-match | Opponent wins, no stake transfer for concede outcome |
| 19 | Result POST to bot 5xx | Logged warning, room still disposes |
| 20 | Replay request (`scripts/seed-room.ts` repeated) | Two different session_ids, independent rooms |

---

## 13. Deployment to Vietnix VPS

```bash
# On VPS as root
cd /root
git clone <radiant-arena-server-repo> arena-server
cd arena-server
npm install
npm run build

# .env
cat > .env <<EOF
PORT=2567
HOST=127.0.0.1
ARENA_TOKEN_SECRET=<same as bot>
ARENA_RESULT_SECRET=<same as bot>
BOT_RESULT_URL=http://localhost:3030/api/arena/result
MAX_CONCURRENT_ROOMS=5
LOG_LEVEL=info
NODE_ENV=production
EOF

# PM2
pm2 start dist/index.js --name radiant-arena-server --time
pm2 save
pm2 logs radiant-arena-server --lines 100 --nostream
```

**Caddy reverse proxy** (`/etc/caddy/Caddyfile`):

```
arena-api.billthedev.com {
  reverse_proxy 127.0.0.1:2567
}
```

DNS:
- `arena.billthedev.com` → Cloudflare Pages (Unity WebGL build) — see Unity doc §13
- `arena-api.billthedev.com` → Vietnix IP

**Bot env update** when ready:
```
ARENA_ENABLED=true
ARENA_COLYSEUS_URL=http://localhost:2567   # bot calls Colyseus via loopback
```

---

## 14. Migration / scaling notes

- **5-room cap**: enforced in `handleCreateRoom`. Bot sees 503 → DM "Arena đang đầy" to both players, rollback stake.
- **Memory**: each room ~10MB (state + trajectory history). 5 × 10 = 50MB peak — VPS 2GB has 1.5GB headroom, fine.
- **Scaling out**: when DAU > 50 concurrent, switch from in-process MatchMaker to Colyseus's Redis Presence + multi-process. Out of scope this doc.
- **Replay storage**: trajectory blobs persist at bot side (already implemented in /api/arena/result handler). Server side fire-and-forget after POST.

---

## 15. Open items / TODO before v1 launch

- [ ] Implement spirit weapon mechanics: di hoả burning path, lệ băng freeze-miss zone, lôi châu chain (chain irrelevant 1v1, defer to PvE)
- [ ] Implement signature active skills (Thiên/Tiên cấp only)
- [ ] Add `concede` handler
- [ ] Add `ping` / `pong` for RTT measurement
- [ ] Add `@colyseus/monitor` dashboard with basic auth
- [ ] Caddy TLS for `arena-api.billthedev.com`
- [ ] Smoke tests #1-#20 above all passing (vitest + integration)
- [ ] CI: GitHub Actions running typecheck + lint + vitest on PR

---

*End of Colyseus implementation guide.*
