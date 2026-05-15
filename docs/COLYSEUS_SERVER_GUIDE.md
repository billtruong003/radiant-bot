# Colyseus Server Guide — Radiant Arena

> Implementation guide cho **game server** của Radiant Arena. Đây là Node.js process độc lập với Discord bot, chạy ở port 2567 trên cùng Vietnix VM.
>
> **Trạng thái hiện tại:** chưa build. Bot side (Lát A) đã ship — kiểm tra `docs/RADIANT_ARENA_ARCHITECTURE.md` cho contract trước khi đọc tiếp.
>
> **Đọc trước:**
> - `docs/RADIANT_ARENA_ARCHITECTURE.md` §3-§5 (HTTP contract + room protocol)
> - `src/modules/arena/tokens.ts` ở repo bot (HMAC handshake — phải dùng cùng secret)

---

## 0. TL;DR

```
┌─────────────────────────────────────────────────────────────────┐
│  Discord Bot (existing)                                         │
│    /arena duel @target stake:10                                 │
│    → POST {ARENA_COLYSEUS_URL}/admin/create-room (HMAC body)    │
│    → bot DM cả 2 player URL play                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Colyseus Server (THIS GUIDE) :2567                             │
│                                                                  │
│  /admin/create-room      → create DuelRoom + emit join URLs     │
│  /health                 → bot probe (returns 200 + uptime)     │
│  wss://.../duel_<id>     → player WS connections                │
│                                                                  │
│  DuelRoom orchestrates:                                          │
│   - HMAC token verify on join                                   │
│   - Server-authoritative turn loop                              │
│   - Physics sim (trajectory + bounce + pierce)                  │
│   - Damage calc + HP management                                 │
│   - On end → POST {BOT_URL}/api/arena/result (HMAC body)        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                       Unity WebGL clients
                       (2 players, 1 room)
```

---

## 1. Repo bootstrap

### 1.1 — Create the project

```bash
mkdir radiant-arena-server && cd radiant-arena-server
npm init -y
git init
```

`package.json`:

```jsonc
{
  "name": "radiant-arena-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node --enable-source-maps dist/index.js",
    "typecheck": "tsc --noEmit",
    "lint": "biome check src",
    "test": "vitest run",
    "smoke": "tsx scripts/smoke-room.ts"
  },
  "dependencies": {
    "@colyseus/core": "^0.15.0",
    "@colyseus/schema": "^2.0.0",
    "colyseus": "^0.15.0",
    "@colyseus/ws-transport": "^0.15.0",
    "express": "^4.19.0",
    "pino": "^9.5.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "@types/express": "^4.17.0",
    "@types/node": "^22.9.0",
    "pino-pretty": "^11.3.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

### 1.2 — File layout

```
radiant-arena-server/
├── src/
│   ├── index.ts                # entry: Express + Colyseus boot
│   ├── env.ts                  # zod env schema (mirror bot pattern)
│   ├── logger.ts               # pino with service tag
│   ├── rooms/
│   │   ├── DuelRoom.ts         # main room class
│   │   ├── schemas.ts          # DuelState + PlayerSchema + WeaponSchema
│   │   ├── physics.ts          # trajectory sim + collision
│   │   ├── damage.ts           # hit resolution + skill triggers
│   │   └── skill-registry.ts   # passive/active skill IDs
│   ├── admin/
│   │   ├── create-room.ts      # POST /admin/create-room handler
│   │   └── hmac.ts             # body-HMAC verify (mirror bot tokens.ts)
│   ├── auth/
│   │   └── verify-token.ts     # onAuth: HMAC token verify
│   ├── callbacks/
│   │   └── bot-result.ts       # outbound POST /api/arena/result
│   └── pending-rooms.ts        # map session_id → roomId (in-memory)
├── scripts/
│   └── smoke-room.ts           # E2E test: spin server + 2 mock clients
├── tests/
│   ├── physics.test.ts
│   ├── damage.test.ts
│   └── auth.test.ts
├── Dockerfile                  # optional, for portability
├── biome.json
├── tsconfig.json
└── package.json
```

### 1.3 — Env vars (must match bot)

```
ARENA_PORT=2567
ARENA_HOST=0.0.0.0
NODE_ENV=development
LOG_LEVEL=info

# Shared with bot — must be IDENTICAL strings
ARENA_TOKEN_SECRET=<same as bot env>
ARENA_RESULT_SECRET=<same as bot env>

# Where to POST results
BOT_RESULT_URL=http://localhost:3030/api/arena/result

# Limits
MAX_CONCURRENT_ROOMS=5
JOIN_DEADLINE_MS=300000      # 5 min
TURN_DEADLINE_MS=30000       # 30s
COUNTDOWN_MS=3000            # 3s
ANIMATION_TIMEOUT_MS=8000    # 8s
DISCONNECT_GRACE_MS=30000    # 30s
RESULT_DISPOSE_DELAY_MS=10000 # 10s
```

---

## 2. Boot sequence

### 2.1 — `src/index.ts`

```typescript
import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { env } from './env.js';
import { logger } from './logger.js';
import { DuelRoom } from './rooms/DuelRoom.js';
import { createRoomHandler } from './admin/create-room.js';

const app = express();
app.use(express.json({ limit: '32kb' }));

// Health probe — bot's /arena debug calls this
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    uptime_ms: Math.floor(process.uptime() * 1000),
    rooms_active: roomCounter.value,
    max_rooms: env.MAX_CONCURRENT_ROOMS,
  });
});

// Admin: bot → create room
app.post('/admin/create-room', createRoomHandler);

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

// Register room kind — multiple physical rooms created with .define()
gameServer.define('duel', DuelRoom);

httpServer.listen(env.ARENA_PORT, env.ARENA_HOST, () => {
  logger.info(
    { port: env.ARENA_PORT, host: env.ARENA_HOST },
    'arena server listening',
  );
});

// Graceful shutdown — drain rooms before close
function shutdown(sig: string): void {
  logger.info({ sig }, 'shutdown signal');
  gameServer.gracefullyShutdown().finally(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

### 2.2 — Room counter (`src/pending-rooms.ts`)

```typescript
// Track concurrent room count for /admin/create-room 503 logic.
// Decremented in DuelRoom.onDispose.

class RoomCounter {
  private _count = 0;

  get value(): number {
    return this._count;
  }

  tryAcquire(max: number): boolean {
    if (this._count >= max) return false;
    this._count++;
    return true;
  }

  release(): void {
    if (this._count > 0) this._count--;
  }
}

export const roomCounter = new RoomCounter();

// Map session_id → roomId so the create-room handler can return the
// correct ws URL.
export const sessionToRoomId = new Map<string, string>();
```

---

## 3. Admin endpoint — POST /admin/create-room

### 3.1 — Body shape (matches bot's `arena/client.ts`)

```typescript
interface CreateRoomBody {
  session_id: string;
  stake: number;
  join_deadline_at: number;
  players: [
    {
      discord_id: string;
      display_name: string;
      token: string;
      weapon_data: {
        slug: string;
        display_name: string;
        category: 'blunt' | 'pierce' | 'spirit';
        tier: string;
        stats: { /* ... */ };
        visual: { /* ... */ };
      };
    },
    /* second player same shape */
  ];
}
```

### 3.2 — Handler (`src/admin/create-room.ts`)

```typescript
import { Request, Response } from 'express';
import { matchMaker } from '@colyseus/core';
import { z } from 'zod';
import { env } from '../env.js';
import { verifyBodyHmac } from './hmac.js';
import { roomCounter, sessionToRoomId } from '../pending-rooms.js';
import { logger } from '../logger.js';

const playerSchema = z.object({
  discord_id: z.string().min(1),
  display_name: z.string().min(1),
  token: z.string().min(1),
  weapon_data: z.object({
    slug: z.string().min(1),
    display_name: z.string().min(1),
    category: z.enum(['blunt', 'pierce', 'spirit']),
    tier: z.string(),
    stats: z.object({
      power: z.number(),
      hitbox: z.number(),
      bounce: z.number(),
      damage_base: z.number(),
      pierce_count: z.number().int(),
      crit_chance: z.number(),
      crit_multi: z.number(),
    }),
    visual: z.object({
      model_prefab_key: z.string(),
      particle_fx_key: z.string(),
      trail_fx_key: z.string(),
      hue: z.string(),
    }),
  }),
});

const bodySchema = z.object({
  session_id: z.string().min(1),
  stake: z.number().int().nonnegative(),
  join_deadline_at: z.number().int(),
  players: z.tuple([playerSchema, playerSchema]),
});

export async function createRoomHandler(req: Request, res: Response): Promise<void> {
  // 1. Verify HMAC signature on raw body
  const sig = req.header('x-bot-signature') ?? '';
  const rawBody = JSON.stringify(req.body); // express.json already parsed
  if (!verifyBodyHmac(rawBody, sig, env.ARENA_TOKEN_SECRET)) {
    res.status(401).json({ error: 'invalid signature' });
    return;
  }

  // 2. Schema validate
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid body', detail: parsed.error.issues });
    return;
  }
  const body = parsed.data;

  // 3. Room limit check (atomic via counter)
  if (!roomCounter.tryAcquire(env.MAX_CONCURRENT_ROOMS)) {
    res.status(503).json({
      ok: false,
      error: 'ROOM_LIMIT_REACHED',
      current: roomCounter.value,
      max: env.MAX_CONCURRENT_ROOMS,
      retry_after_seconds: 60,
    });
    return;
  }

  // 4. Pre-create matchmaking entry. matchMaker.createRoom creates a
  //    Colyseus room programmatically (not via .joinOrCreate by client).
  try {
    const room = await matchMaker.createRoom('duel', {
      session_id: body.session_id,
      stake: body.stake,
      join_deadline_at: body.join_deadline_at,
      players: body.players, // DuelRoom.onCreate reads these
    });

    sessionToRoomId.set(body.session_id, room.roomId);

    const wsUrl = `wss://arena-api.billthedev.com/duel/${room.roomId}`;
    res.status(200).json({
      ok: true,
      room_name: room.roomId,
      ws_url: wsUrl,
    });

    logger.info(
      { session_id: body.session_id, room_id: room.roomId, players: body.players.map((p) => p.discord_id) },
      'arena: room created',
    );
  } catch (err) {
    roomCounter.release(); // rollback counter on failure
    logger.error({ err }, 'arena: matchMaker.createRoom failed');
    res.status(500).json({ ok: false, error: 'create failed' });
  }
}
```

### 3.3 — HMAC verify (`src/admin/hmac.ts`)

Identical to `src/modules/arena/tokens.ts:signBody/verifyBody` in the bot:

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

export function signBodyHmac(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function verifyBodyHmac(body: string, headerValue: string, secret: string): boolean {
  if (!secret || !headerValue) return false;
  const expected = signBodyHmac(body, secret);
  if (headerValue.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(headerValue), Buffer.from(expected));
  } catch {
    return false;
  }
}
```

---

## 4. DuelRoom — schemas + lifecycle

### 4.1 — Schemas (`src/rooms/schemas.ts`)

```typescript
import { Schema, MapSchema, ArraySchema, type } from '@colyseus/schema';

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

export class WeaponSchema extends Schema {
  @type('string') slug = '';
  @type('string') display_name = '';
  @type('string') category = 'blunt';
  @type('string') tier = 'pham';
  @type(WeaponStatsSchema) stats = new WeaponStatsSchema();
  @type(WeaponVisualSchema) visual = new WeaponVisualSchema();
  @type(['string']) skill_ids = new ArraySchema<string>();
}

export class PlayerSchema extends Schema {
  @type('string') discord_id = '';
  @type('string') display_name = '';
  @type('uint8') slot = 0; // 0 or 1
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('uint16') hp = 100;
  @type('uint16') hp_max = 100;
  @type(WeaponSchema) weapon = new WeaponSchema();
  @type('boolean') ready = false;
  @type('boolean') connected = true;
  @type('uint32') signature_cd_until = 0;
}

export class TrajectoryPointSchema extends Schema {
  @type('uint16') t = 0; // ms since shot start
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('string') event = ''; // '' | 'wall_bounce' | 'pierce_player:<id>' | 'hit:<dmg>' | 'stop' | 'crit:<dmg>'
}

export class DuelState extends Schema {
  @type('string') session_id = '';
  @type('string') phase = 'waiting'; // waiting | lobby | countdown | active | animating | ended
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type('string') turn_player_id = '';
  @type('uint32') turn_deadline_at = 0;
  @type('uint32') join_deadline_at = 0;
  @type('uint8') round = 0;
  @type([TrajectoryPointSchema]) last_trajectory = new ArraySchema<TrajectoryPointSchema>();
  @type('string') last_shooter_id = '';
  @type('string') winner_id = '';
  @type('string') outcome = '';
  @type('uint8') stake = 0;
}
```

**Schema rule**: every field MUST have a default value AND a `@type()` decorator. Adding a field without a default crashes at instance time.

### 4.2 — DuelRoom skeleton (`src/rooms/DuelRoom.ts`)

```typescript
import { Room, Client } from '@colyseus/core';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { verifyToken } from '../auth/verify-token.js';
import { postResult } from '../callbacks/bot-result.js';
import { roomCounter, sessionToRoomId } from '../pending-rooms.js';
import { simulateShot, type ShotInput } from './physics.js';
import { applyHit } from './damage.js';
import {
  DuelState,
  PlayerSchema,
  TrajectoryPointSchema,
  WeaponSchema,
  WeaponStatsSchema,
  WeaponVisualSchema,
} from './schemas.js';

interface CreateOptions {
  session_id: string;
  stake: number;
  join_deadline_at: number;
  players: Array<{
    discord_id: string;
    display_name: string;
    token: string;
    weapon_data: any;
  }>;
}

const MAP_HALF = 500; // 1000×1000 world space, centred at origin
const SPAWN_OFFSET_X = 350;

export class DuelRoom extends Room<DuelState> {
  // Players keyed by their discord_id for fast lookup
  private expectedPlayers = new Set<string>();
  private playerMeta = new Map<string, { token: string; weapon: any; display_name: string }>();
  private turnTimer: NodeJS.Timeout | null = null;
  private animationTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  onCreate(options: CreateOptions): void {
    this.setState(new DuelState());
    this.state.session_id = options.session_id;
    this.state.join_deadline_at = options.join_deadline_at;
    this.state.stake = options.stake;
    this.state.phase = 'waiting';

    for (const p of options.players) {
      this.expectedPlayers.add(p.discord_id);
      this.playerMeta.set(p.discord_id, {
        token: p.token,
        weapon: p.weapon_data,
        display_name: p.display_name,
      });
    }

    this.maxClients = 2;
    this.autoDispose = false; // we control dispose lifecycle

    // Join deadline timer
    const joinTimeout = options.join_deadline_at - Date.now();
    this.clock.setTimeout(() => {
      if (this.state.phase === 'waiting' || this.state.phase === 'lobby') {
        this.endMatch('timeout_join', null);
      }
    }, Math.max(1000, joinTimeout));

    this.registerMessages();

    logger.info({ session_id: options.session_id }, 'DuelRoom: created');
  }

  async onAuth(client: Client, options: { token?: string }): Promise<{ discord_id: string }> {
    if (!options.token) throw new Error('missing token');
    const payload = verifyToken(options.token, env.ARENA_TOKEN_SECRET);
    if (!payload) throw new Error('invalid token');
    if (payload.session_id !== this.state.session_id) throw new Error('session mismatch');
    if (!this.expectedPlayers.has(payload.discord_id)) throw new Error('not in roster');
    return { discord_id: payload.discord_id };
  }

  onJoin(client: Client, _options: unknown, auth: { discord_id: string }): void {
    const meta = this.playerMeta.get(auth.discord_id);
    if (!meta) {
      client.leave(4000);
      return;
    }

    const slot = this.state.players.size;
    const isLeft = slot === 0;

    const player = new PlayerSchema();
    player.discord_id = auth.discord_id;
    player.display_name = meta.display_name;
    player.slot = slot;
    player.x = isLeft ? -SPAWN_OFFSET_X : SPAWN_OFFSET_X;
    player.y = 0;
    player.hp = 100;
    player.hp_max = 100;

    // Hydrate weapon
    const w = meta.weapon;
    const weapon = new WeaponSchema();
    weapon.slug = w.slug;
    weapon.display_name = w.display_name;
    weapon.category = w.category;
    weapon.tier = w.tier;
    Object.assign(weapon.stats, w.stats);
    Object.assign(weapon.visual, w.visual);
    player.weapon = weapon;

    this.state.players.set(auth.discord_id, player);
    client.userData = { discord_id: auth.discord_id };

    if (this.state.players.size === 2) {
      this.state.phase = 'lobby';
    }

    logger.info(
      { session_id: this.state.session_id, discord_id: auth.discord_id, slot },
      'DuelRoom: player joined',
    );
  }

  onLeave(client: Client, consented: boolean): void {
    const id = client.userData?.discord_id as string | undefined;
    if (!id) return;
    const player = this.state.players.get(id);
    if (!player) return;
    player.connected = false;

    if (this.state.phase === 'active' && this.state.turn_player_id === id) {
      // Disconnect during own turn → grace then forfeit.
      this.clock.setTimeout(() => {
        const stillDisconnected = this.state.players.get(id)?.connected === false;
        if (stillDisconnected && this.state.phase === 'active') {
          this.endMatch('disconnect', this.opponentOf(id));
        }
      }, env.DISCONNECT_GRACE_MS);
    }
  }

  // ──────────────────────────────────────────────────────────────────
  private registerMessages(): void {
    this.onMessage('ready', (client) => {
      const id = client.userData?.discord_id as string;
      const player = this.state.players.get(id);
      if (!player || this.state.phase !== 'lobby') return;
      player.ready = true;
      if (this.allReady()) this.startCountdown();
    });

    this.onMessage('shoot', (client, payload: ShotInput) => {
      const id = client.userData?.discord_id as string;
      if (this.state.phase !== 'active' || this.state.turn_player_id !== id) return;
      this.handleShot(id, payload);
    });

    this.onMessage('signature', (client) => {
      const id = client.userData?.discord_id as string;
      if (this.state.phase !== 'active' || this.state.turn_player_id !== id) return;
      // TODO Lát D.6: skill registry resolution
      this.broadcast('signature_used', { player_id: id, skill_id: 'placeholder' });
    });

    this.onMessage('concede', (client) => {
      const id = client.userData?.discord_id as string;
      if (this.state.phase !== 'active') return;
      this.endMatch('win', this.opponentOf(id));
    });

    this.onMessage('animation_complete', (client, payload: { round: number }) => {
      const id = client.userData?.discord_id as string;
      if (this.state.phase !== 'animating') return;
      // Wait for BOTH clients to confirm, or the animation timer fires.
      this.recordAnimComplete(id, payload.round);
    });

    this.onMessage('ping', (client, payload: { t: number }) => {
      client.send('pong', { t: payload.t, server_t: Date.now() });
    });
  }

  private allReady(): boolean {
    let ready = 0;
    this.state.players.forEach((p) => {
      if (p.ready) ready++;
    });
    return ready === 2;
  }

  private startCountdown(): void {
    this.state.phase = 'countdown';
    this.clock.setTimeout(() => {
      this.startActiveTurn(this.firstTurnPlayer());
    }, env.COUNTDOWN_MS);
  }

  private firstTurnPlayer(): string {
    // Left slot goes first (slot 0). Could randomise later for variety.
    let first = '';
    this.state.players.forEach((p) => {
      if (p.slot === 0) first = p.discord_id;
    });
    return first;
  }

  private startActiveTurn(playerId: string): void {
    if (this.disposed) return;
    this.state.phase = 'active';
    this.state.turn_player_id = playerId;
    this.state.turn_deadline_at = Date.now() + env.TURN_DEADLINE_MS;
    this.state.round = this.state.round + 1;

    this.clearTurnTimer();
    this.turnTimer = setTimeout(() => {
      this.onTurnTimeout(playerId);
    }, env.TURN_DEADLINE_MS);

    this.broadcast('match_start', { first_turn_id: playerId });
  }

  private onTurnTimeout(playerId: string): void {
    if (this.state.phase !== 'active' || this.state.turn_player_id !== playerId) return;
    // AFK — opponent gets a free pass; check if both AFK in a row
    const opp = this.opponentOf(playerId);
    // Simplest: count consecutive AFK turns. If 2 in a row → double_afk.
    // For v1 we just rotate; double_afk is best-effort.
    this.broadcast('shot_resolved', {
      trajectory: [],
      shooter: playerId,
      damage_dealt: 0,
      afk: true,
    });
    this.advanceToAnimating(opp);
  }

  private handleShot(shooterId: string, payload: ShotInput): void {
    this.clearTurnTimer();

    const shooter = this.state.players.get(shooterId);
    const targetId = this.opponentOf(shooterId);
    const target = this.state.players.get(targetId);
    if (!shooter || !target) return;

    // Clamp inputs (anti-cheat)
    const angle = clamp(payload.angle, 0, Math.PI * 2);
    const power = clamp(payload.power, 0, 1);

    const sim = simulateShot({
      shooter: { x: shooter.x, y: shooter.y, weapon: shooter.weapon },
      target: { x: target.x, y: target.y, hitbox: target.weapon.stats.hitbox },
      angle,
      power,
      mapHalf: MAP_HALF,
    });

    // Apply damage
    let totalDamage = 0;
    for (const pt of sim.points) {
      if (pt.event.startsWith('hit:')) {
        const dmg = applyHit(shooter, target, pt, sim.isCrit);
        totalDamage += dmg;
      }
    }

    // Replace last_trajectory
    this.state.last_trajectory.clear();
    for (const pt of sim.points) {
      const tp = new TrajectoryPointSchema();
      tp.t = pt.t;
      tp.x = pt.x;
      tp.y = pt.y;
      tp.event = pt.event;
      this.state.last_trajectory.push(tp);
    }
    this.state.last_shooter_id = shooterId;

    this.broadcast('shot_resolved', {
      trajectory: sim.points,
      shooter: shooterId,
      damage_dealt: totalDamage,
    });

    if (target.hp <= 0) {
      // Game over after animation
      this.advanceToAnimating(shooterId, /*finishOnDone*/ true, shooterId);
    } else {
      this.advanceToAnimating(targetId);
    }
  }

  private advanceToAnimating(
    nextTurnPlayer: string,
    finishOnDone = false,
    winnerId?: string,
  ): void {
    this.state.phase = 'animating';
    const expectedConfirms = new Set<string>();
    this.state.players.forEach((p) => {
      if (p.connected) expectedConfirms.add(p.discord_id);
    });

    const confirmed = new Set<string>();
    const round = this.state.round;
    this.animConfirmState = { expected: expectedConfirms, confirmed, round, nextTurnPlayer, finishOnDone, winnerId };

    if (this.animationTimer) clearTimeout(this.animationTimer);
    this.animationTimer = setTimeout(() => this.finishAnimation(), env.ANIMATION_TIMEOUT_MS);
  }

  private animConfirmState: {
    expected: Set<string>;
    confirmed: Set<string>;
    round: number;
    nextTurnPlayer: string;
    finishOnDone: boolean;
    winnerId?: string;
  } | null = null;

  private recordAnimComplete(playerId: string, round: number): void {
    if (!this.animConfirmState || this.animConfirmState.round !== round) return;
    this.animConfirmState.confirmed.add(playerId);
    if (this.animConfirmState.confirmed.size >= this.animConfirmState.expected.size) {
      this.finishAnimation();
    }
  }

  private finishAnimation(): void {
    if (!this.animConfirmState) return;
    const { finishOnDone, winnerId, nextTurnPlayer } = this.animConfirmState;
    this.animConfirmState = null;

    if (this.animationTimer) {
      clearTimeout(this.animationTimer);
      this.animationTimer = null;
    }

    if (finishOnDone && winnerId) {
      this.endMatch('win', winnerId);
      return;
    }
    this.startActiveTurn(nextTurnPlayer);
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  private opponentOf(id: string): string {
    let out = '';
    this.state.players.forEach((p) => {
      if (p.discord_id !== id) out = p.discord_id;
    });
    return out;
  }

  private async endMatch(outcome: string, winnerId: string | null): Promise<void> {
    if (this.state.phase === 'ended') return;
    this.state.phase = 'ended';
    this.state.outcome = outcome;
    this.state.winner_id = winnerId ?? '';
    this.clearTurnTimer();
    if (this.animationTimer) clearTimeout(this.animationTimer);

    const finalHp: Record<string, number> = {};
    this.state.players.forEach((p, id) => {
      finalHp[id] = p.hp;
    });

    // Build trajectory snapshot for replay viewer (out-of-scope here,
    // but persisted at bot side).
    const trajectorySnapshot: unknown[] = []; // could collect all rounds

    this.broadcast('match_ended', { winner: winnerId ?? '', outcome });

    // POST result to bot — fire-and-forget with retry.
    await postResult({
      session_id: this.state.session_id,
      outcome,
      winner_id: winnerId,
      loser_id: winnerId ? this.opponentOf(winnerId) : null,
      final_hp: finalHp,
      rounds_played: this.state.round,
      trajectory_snapshot: trajectorySnapshot,
      ended_at: Date.now(),
    });

    // Dispose after delay (let clients render result screen)
    this.clock.setTimeout(() => this.disconnect(), env.RESULT_DISPOSE_DELAY_MS);
  }

  onDispose(): void {
    this.disposed = true;
    roomCounter.release();
    sessionToRoomId.delete(this.state.session_id);
    logger.info({ session_id: this.state.session_id }, 'DuelRoom: disposed');
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
```

### 4.3 — Token verify (`src/auth/verify-token.ts`)

**Identical** to bot's `src/modules/arena/tokens.ts:verifyToken`. Copy verbatim — both processes must use the same crypto.

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ArenaTokenPayload {
  session_id: string;
  discord_id: string;
  expires_at: number;
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

export function verifyToken(
  token: string,
  secret: string,
  nowMs = Date.now(),
): ArenaTokenPayload | null {
  if (!secret) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = createHmac('sha256', secret).update(payloadB64).digest('hex');
  if (sig.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }

  const raw = base64UrlDecode(payloadB64);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw.toString('utf-8')) as ArenaTokenPayload;
    if (typeof parsed.session_id !== 'string') return null;
    if (typeof parsed.discord_id !== 'string') return null;
    if (typeof parsed.expires_at !== 'number') return null;
    if (parsed.expires_at <= nowMs) return null;
    return parsed;
  } catch {
    return null;
  }
}
```

### 4.4 — Result callback (`src/callbacks/bot-result.ts`)

```typescript
import { env } from '../env.js';
import { logger } from '../logger.js';
import { signBodyHmac } from '../admin/hmac.js';

export interface ResultPayload {
  session_id: string;
  outcome: string;
  winner_id: string | null;
  loser_id: string | null;
  final_hp: Record<string, number>;
  rounds_played: number;
  trajectory_snapshot: unknown[];
  ended_at: number;
}

const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [1000, 3000, 10000];

export async function postResult(payload: ResultPayload, attempt = 0): Promise<void> {
  const bodyJson = JSON.stringify(payload);
  const sig = signBodyHmac(bodyJson, env.ARENA_RESULT_SECRET);

  try {
    const res = await fetch(env.BOT_RESULT_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-arena-signature': sig,
      },
      body: bodyJson,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new Error(`http_${res.status}`);
    }
    logger.info({ session_id: payload.session_id, attempt }, 'result POST ok');
  } catch (err) {
    if (attempt < MAX_RETRIES - 1) {
      const wait = RETRY_BACKOFF_MS[attempt] ?? 10000;
      setTimeout(() => postResult(payload, attempt + 1), wait);
      logger.warn({ err, attempt, wait }, 'result POST failed — retrying');
    } else {
      logger.error({ err, payload }, 'result POST exhausted retries — DROPPED');
      // Last-resort: append to local dead-letter file. Operator manual-resends.
    }
  }
}
```

---

## 5. Physics simulation

### 5.1 — Concept

Server runs the entire trajectory in **single tick** (synchronous), then sends the full point list. Clients only animate the playback — they have zero authority over hit detection.

Why monolithic sim instead of per-tick: keeps state machine simple (no need for `phase: 'simulating'` window), reduces bandwidth (single message vs 60 per shot), trivially deterministic.

### 5.2 — `src/rooms/physics.ts`

```typescript
import type { PlayerSchema, WeaponSchema } from './schemas.js';

const GRAVITY = 0;        // top-down 2D, no gravity
const FRICTION = 0.985;   // 1.5% velocity decay per step
const STEP_MS = 16;       // 60 Hz sim tick
const MAX_STEPS = 600;    // 9.6 s max simulation
const INITIAL_SPEED = 1200; // world-units / sec at power=1.0

export interface ShotInput {
  angle: number;  // radians
  power: number;  // 0..1
}

interface SimContext {
  shooter: { x: number; y: number; weapon: WeaponSchema };
  target: { x: number; y: number; hitbox: number };
  angle: number;
  power: number;
  mapHalf: number;
}

export interface SimPoint {
  t: number;
  x: number;
  y: number;
  event: string;
}

export interface SimResult {
  points: SimPoint[];
  isCrit: boolean;
  damageDealt: number;
}

export function simulateShot(ctx: SimContext): SimResult {
  const w = ctx.shooter.weapon;
  const stats = w.stats;
  const points: SimPoint[] = [];
  let x = ctx.shooter.x;
  let y = ctx.shooter.y;
  const speed = INITIAL_SPEED * ctx.power * stats.power;
  let vx = Math.cos(ctx.angle) * speed;
  let vy = Math.sin(ctx.angle) * speed;

  const isCrit = Math.random() < stats.crit_chance;
  const baseDmg = stats.damage_base * (isCrit ? stats.crit_multi : 1);

  let pierced = 0;
  let damageDealt = 0;
  let hitTargetThisShot = false; // for pierce_count=0 (blunt): allow re-bounce
  const targetRadius = ctx.target.hitbox * 30; // arbitrary world-units per hitbox unit
  const projectileRadius = 15;

  points.push({ t: 0, x, y, event: '' });

  for (let step = 1; step <= MAX_STEPS; step++) {
    const dt = STEP_MS / 1000;
    x += vx * dt;
    y += vy * dt;
    vx *= FRICTION;
    vy *= FRICTION;

    // Stop if velocity below threshold
    const sp = Math.hypot(vx, vy);
    if (sp < 30) {
      points.push({ t: step * STEP_MS, x, y, event: 'stop' });
      break;
    }

    // Wall bounce
    if (x > ctx.mapHalf) {
      x = ctx.mapHalf;
      vx = -vx * stats.bounce;
      points.push({ t: step * STEP_MS, x, y, event: 'wall_bounce' });
      continue;
    }
    if (x < -ctx.mapHalf) {
      x = -ctx.mapHalf;
      vx = -vx * stats.bounce;
      points.push({ t: step * STEP_MS, x, y, event: 'wall_bounce' });
      continue;
    }
    if (y > ctx.mapHalf) {
      y = ctx.mapHalf;
      vy = -vy * stats.bounce;
      points.push({ t: step * STEP_MS, x, y, event: 'wall_bounce' });
      continue;
    }
    if (y < -ctx.mapHalf) {
      y = -ctx.mapHalf;
      vy = -vy * stats.bounce;
      points.push({ t: step * STEP_MS, x, y, event: 'wall_bounce' });
      continue;
    }

    // Hit target?
    const dx = x - ctx.target.x;
    const dy = y - ctx.target.y;
    const distSq = dx * dx + dy * dy;
    const hitDistSq = (targetRadius + projectileRadius) ** 2;
    if (distSq <= hitDistSq && !hitTargetThisShot) {
      const dmg = Math.round(baseDmg);
      damageDealt += dmg;
      points.push({
        t: step * STEP_MS,
        x,
        y,
        event: isCrit ? `crit:${dmg}` : `hit:${dmg}`,
      });

      if (stats.pierce_count > 0) {
        pierced++;
        if (pierced >= stats.pierce_count) {
          points.push({ t: step * STEP_MS, x, y, event: 'stop' });
          break;
        }
        // Continue through
        hitTargetThisShot = true; // anti-multi-hit same target in one pass
        continue;
      }
      // Blunt: bounce off target like a wall (180° + bounce coeff)
      const angle = Math.atan2(dy, dx);
      const newSpeed = sp * stats.bounce;
      vx = Math.cos(angle) * newSpeed;
      vy = Math.sin(angle) * newSpeed;
      hitTargetThisShot = true;
      continue;
    }

    // Reset hitTargetThisShot once projectile clearly leaves target area
    if (hitTargetThisShot && distSq > hitDistSq * 4) {
      hitTargetThisShot = false;
    }

    // Down-sample emit: every 3 steps keep one
    if (step % 3 === 0) {
      points.push({ t: step * STEP_MS, x, y, event: '' });
    }
  }

  return { points, isCrit, damageDealt };
}
```

### 5.3 — Damage (`src/rooms/damage.ts`)

```typescript
import type { PlayerSchema } from './schemas.js';
import type { SimPoint } from './physics.js';

export function applyHit(
  _shooter: PlayerSchema,
  target: PlayerSchema,
  pt: SimPoint,
  isCrit: boolean,
): number {
  const m = pt.event.match(/^(?:hit|crit):(\d+)$/);
  if (!m) return 0;
  const dmg = Number.parseInt(m[1] ?? '0', 10);
  target.hp = Math.max(0, target.hp - dmg);
  void isCrit; // for skill triggers later
  return dmg;
}
```

---

## 6. Game design notes

### 6.1 — Map

- 1000×1000 world units, square, 4 walls.
- Origin at center.
- Player slots fixed: slot 0 left (-350, 0), slot 1 right (+350, 0). No movement v1.

### 6.2 — Turn loop feel

- Drag-aim-release UX (Worms/Angry-Birds style). Aim arc drawn during drag.
- Turn time 30s, with **5s warning ping** at remaining=5s (server sends `turn_warning` discrete event).
- Shot animation should take 2-5s realtime — anything longer feels sluggish.
- After hit: 800ms hit-pause for impact emphasis before turn switch animation.

### 6.3 — Juicy

Server emits clean events. Client owns juice — see Unity guide. But server **must** include:
- `crit:<dmg>` event differentiated from `hit:<dmg>` for client crit FX
- `wall_bounce` for spark FX
- `pierce_player:<id>` for slow-mo trigger
- Each `shot_resolved` includes `damage_dealt` total for client big-number popup

### 6.4 — Weapon mechanic divergence

| Category | Server behavior |
|---|---|
| **Blunt** (`pierce_count=0`) | Hits target → bounces off like wall (with bounce coeff). Can re-hit after wall bounce. |
| **Pierce** (`pierce_count≥1`) | Hits target → continues through. Stops after N pierces OR velocity decay. |
| **Spirit** | Mechanic delegated to skill registry — see skill IDs. Server runs `passive_burning_path`: leave fire zone (DoT next round); `passive_freeze_miss_30`: target rolls 30% miss next turn. |

### 6.5 — Signature skills (Thiên Phẩm+)

Active skills triggered by `signature` message. Server checks cooldown, sets `signature_cd_until = now + skill.cooldown_ms`, broadcasts `signature_used` with `skill_id` + `fx_key`. Damage applied within next shot via passive registry hook.

Lát D.6 — full skill registry. For v1 just gate `signature` message → respond with cooldown error if not ready.

---

## 7. Double-test workflow (CRITICAL)

User explicitly asked for 2-client drag-shoot testing in editor. Here's the workflow:

### 7.1 — Local stack

```
Terminal 1: cd radiant-arena-server && npm run dev       # Colyseus on :2567
Terminal 2: cd radiant-bot && npm run dev                # Bot on :3030
Terminal 3: cd radiant-arena-unity && open Unity Editor  # Player A
Browser:    http://localhost:8080 (WebGL preview build)  # Player B
```

### 7.2 — Mock create-room (skip the bot)

For pure Colyseus testing without bot involvement, use the smoke script:

`scripts/smoke-room.ts`:

```typescript
import { signBodyHmac } from '../src/admin/hmac.js';
import { signToken } from '../src/auth/sign-token.js'; // mirror of bot's signToken

const SECRET = process.env.ARENA_TOKEN_SECRET ?? 'dev-secret';
const SERVER = 'http://localhost:2567';

async function main(): Promise<void> {
  const sessionId = `smoke-${Date.now()}`;
  const expiresAt = Date.now() + 300_000;

  const p1Token = signToken(
    { session_id: sessionId, discord_id: 'test_player_1', expires_at: expiresAt },
    SECRET,
  );
  const p2Token = signToken(
    { session_id: sessionId, discord_id: 'test_player_2', expires_at: expiresAt },
    SECRET,
  );

  const body = {
    session_id: sessionId,
    stake: 0,
    join_deadline_at: expiresAt,
    players: [
      {
        discord_id: 'test_player_1',
        display_name: 'Player A',
        token: p1Token,
        weapon_data: mockWeapon('blunt', 'pham'),
      },
      {
        discord_id: 'test_player_2',
        display_name: 'Player B',
        token: p2Token,
        weapon_data: mockWeapon('pierce', 'pham'),
      },
    ],
  };
  const json = JSON.stringify(body);
  const sig = signBodyHmac(json, SECRET);

  const res = await fetch(`${SERVER}/admin/create-room`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bot-signature': sig },
    body: json,
  });
  const data = await res.json();
  console.log('Create-room response:', data);
  console.log('\nPlayer A join URL:', `${SERVER.replace('http', 'ws')}/duel/${data.room_name}?token=${encodeURIComponent(p1Token)}`);
  console.log('Player B join URL:', `${SERVER.replace('http', 'ws')}/duel/${data.room_name}?token=${encodeURIComponent(p2Token)}`);
  console.log('\nUnity → set Editor's TestRunner: paste Player A token. WebGL build URL bar: paste Player B token.');
}

function mockWeapon(category: string, tier: string) {
  return {
    slug: `mock-${category}-${tier}`,
    display_name: `Mock ${category} ${tier}`,
    category,
    tier,
    stats: { power: 1, hitbox: 1, bounce: 0.5, damage_base: 20, pierce_count: category === 'pierce' ? 1 : 0, crit_chance: 0.1, crit_multi: 1.5 },
    visual: { model_prefab_key: `weapon_mock_${category}`, particle_fx_key: '', trail_fx_key: '', hue: '#ffffff' },
  };
}

main().catch(console.error);
```

Run: `npm run smoke`

### 7.3 — 2-client setup options

| Option | Setup | Pros / Cons |
|---|---|---|
| **A — Editor + WebGL build** | Player A in Unity Editor (Play mode), Player B in WebGL build hosted on `python3 -m http.server` | Closest to prod. WebGL build is slow (~30s). Cons: WebGL build invalidates often during dev. |
| **B — ParrelSync (Editor x2)** | Install [ParrelSync](https://github.com/VeriorPies/ParrelSync) → "Clones" → opens 2nd Editor instance mirroring assets | Fast iteration. Two editors share assets, separate Play sessions. Recommended for daily dev. |
| **C — Editor + Standalone build** | Player A in Editor, Player B = Standalone Windows build run from `.exe` | Fast build (~10s). Best for desktop testing physics+input. Doesn't catch WebGL-specific issues. |

**Recommended: B during dev, A before deploy.**

### 7.4 — Unity TestRunner integration

In Unity `ArenaScene`:

```csharp
// Assets/RadiantArena/Scripts/Dev/ManualRoomConnect.cs (Editor only)
#if UNITY_EDITOR
using UnityEngine;

public class ManualRoomConnect : MonoBehaviour {
    [SerializeField] string wsUrl = "ws://localhost:2567";
    [SerializeField] string roomId = "duel_XXX";
    [SerializeField] string token = "<paste from smoke-room.ts output>";

    [ContextMenu("Connect")]
    void Connect() {
        var nc = FindObjectOfType<NetClient>();
        nc.ManualConnect(wsUrl, roomId, token);
    }
}
#endif
```

Right-click component → Connect → joins room with that token. Run twice in separate Editor instances (ParrelSync) for double-client play.

### 7.5 — End-to-end smoke checklist

After everything wired, this sequence must work:

1. `radiant-arena-server` running (terminal 1).
2. `npm run smoke` outputs 2 join URLs.
3. Editor instance A: paste URL/token → Connect → state.phase='lobby'.
4. Editor instance B: paste URL/token → Connect → state.phase='lobby' (both joined).
5. Both click Ready → state.phase='countdown' → 3s → state.phase='active'.
6. Player A turn: drag, release → server sims shot → `shot_resolved` event in both clients → trajectory animation plays.
7. Continue until HP=0.
8. state.phase='ended' → `match_ended` broadcast → 10s dispose.

If any step fails, log inspector + state diff is the debug entrypoint.

### 7.6 — Server unit tests

`tests/physics.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { simulateShot } from '../src/rooms/physics.js';

describe('physics.simulateShot', () => {
  it('hits target with direct power-1.0 shot', () => {
    const result = simulateShot({
      shooter: { x: -350, y: 0, weapon: makeWeapon('blunt') },
      target: { x: 350, y: 0, hitbox: 1.0 },
      angle: 0,
      power: 1.0,
      mapHalf: 500,
    });
    const hits = result.points.filter((p) => p.event.startsWith('hit:'));
    expect(hits.length).toBeGreaterThan(0);
    expect(result.damageDealt).toBeGreaterThan(0);
  });

  it('bounces off wall when shooting at corner', () => {
    const result = simulateShot({
      shooter: { x: -350, y: 0, weapon: makeWeapon('blunt') },
      target: { x: 350, y: 0, hitbox: 1.0 },
      angle: Math.PI / 4, // upper-right
      power: 1.0,
      mapHalf: 500,
    });
    expect(result.points.some((p) => p.event === 'wall_bounce')).toBe(true);
  });

  it('pierce weapon hits then continues', () => {
    const result = simulateShot({
      shooter: { x: -350, y: 0, weapon: makeWeapon('pierce') },
      target: { x: 0, y: 0, hitbox: 1.0 },
      angle: 0,
      power: 1.0,
      mapHalf: 500,
    });
    const hitIdx = result.points.findIndex((p) => p.event.startsWith('hit:'));
    expect(hitIdx).toBeGreaterThan(0);
    // After hit, more points should exist (continued trajectory)
    expect(result.points.length).toBeGreaterThan(hitIdx + 5);
  });
});

function makeWeapon(category: 'blunt' | 'pierce') {
  return /* mock weapon schema */ {} as any;
}
```

---

## 8. Production deployment

### 8.1 — PM2 on Vietnix

```bash
# Install
ssh root@<vps>
cd /root/bots
git clone <radiant-arena-server-repo> radiant-arena-server
cd radiant-arena-server
npm install
npm run build

# Env file
cp .env.example .env
nano .env  # paste shared secrets matching bot

# Start
pm2 start dist/index.js --name radiant-arena-server --time
pm2 save
```

### 8.2 — Caddy reverse proxy

`/etc/caddy/Caddyfile` add:

```
arena-api.billthedev.com {
    reverse_proxy localhost:2567 {
        # WSS upgrade
        header_up X-Real-IP {remote_host}
    }
}
```

Reload: `sudo systemctl reload caddy`

### 8.3 — Bot env update on prod

```
ARENA_ENABLED=true
ARENA_COLYSEUS_URL=http://localhost:2567  # internal, NOT https
ARENA_TOKEN_SECRET=<32-byte hex>           # same as arena server
ARENA_RESULT_SECRET=<32-byte hex>          # same as arena server
```

Restart: `pm2 restart radiant-tech-sect-bot`

### 8.4 — Verify

```bash
# From local
curl https://arena-api.billthedev.com/health
# → { ok: true, uptime_ms: N, rooms_active: 0, max_rooms: 5 }

# In Discord:
/arena debug
# Expected: ARENA_ENABLED=true · Probe ✅ Reachable · 8ms
```

---

## 9. Lát plan

| Lát | Scope | DoD |
|---|---|---|
| D.1 | Repo bootstrap + Express + Colyseus boot + /health | `npm run dev` exits clean, /health 200 |
| D.2 | DuelRoom schemas + onCreate/onAuth/onJoin/onLeave | smoke-room.ts: 2 clients join, state.phase='lobby' |
| D.3 | Turn loop: ready→countdown→active→animating→active | both clients can ready+shoot end-to-end (no physics) |
| D.4 | Physics sim (blunt + pierce) + damage calc | smoke physics tests pass; HP reaches 0 in realistic shot count |
| D.5 | Result callback + endMatch + dispose | bot's `/api/arena/result` receives signed POST, stake transfers |
| D.6 | Skill registry (passive + active signature) | thiên-phẩm weapon can active-skill once per cooldown |
| D.7 | Spirit weapon mechanics (burn / freeze) | dị-hoả leaves zone, lệ-băng triggers next-shot miss |
| D.8 | Anti-cheat hardening (input clamp + timing) | fuzzing test: malformed inputs don't crash sim |
| D.9 | Caddy + DNS + PM2 deploy | prod /arena debug reachable from bot |

---

## 10. Architecture reference back to bot

| What bot owns | What Colyseus owns |
|---|---|
| Weapon **catalog** (slug → stats source-of-truth, in WAL) | Weapon **instance** in match (copy of stats, server-authoritative for this match only) |
| User pills + stake escrow | No money concept (stake passed in body, applied on result) |
| HMAC token **signing** (issuing) | HMAC token **verifying** (onAuth) |
| Forge bản mệnh (deterministic SHA-256) | None — weapons fully hydrated from create-room body |
| Post result embed to #arena | Post **result data** to bot's /api/arena/result |
| Replay URL minting + storage | Trajectory snapshot generation (bot persists) |

**Single source of truth rule**: weapon stats in catalog. Colyseus never invents stats — only reads what bot passed in create-room body. If bot updates a weapon's damage_base via catalog re-seed, only future matches reflect it (in-flight rooms use the snapshot from their create-room call).

---

*End of Colyseus Server Guide.*
