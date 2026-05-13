# CLAUDE.md — Radiant Tech Sect Bot

> Đây là file context cho Claude Code. Đọc file này TRƯỚC khi bắt đầu mỗi session.

## Project mission

Build 1 Discord bot quản lý server "Radiant Tech Sect" với:
- Verification gate (anti-bot + member filter)
- Leveling system với theme cảnh giới tu tiên (Việt only, không Hán tự)
- Auto-mod rule-based
- Scheduled events (leaderboard, tribulation)
- **Custom storage layer** (in-memory + WAL + snapshot, không SQL không NoSQL library)
- Hosting cost = 0đ

## Tech stack (locked)

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | Node.js 20 LTS | discord.js v14 stable |
| Language | TypeScript strict mode | type safety, IDE support |
| Discord lib | `discord.js@14` | most maintained |
| **Storage** | **Custom Store (in-memory + WAL + snapshot)** | Full control, ~500 LOC, fit scale, learning value |
| Scheduler | `node-cron` | reliable for daily/weekly jobs |
| Captcha | `canvas` (node-canvas) | image captcha trong DM |
| Logger | `pino` + `pino-pretty` (dev) | structured JSON logs |
| Concurrency | `async-mutex` | single-writer guarantee cho WAL |
| ID generation | `ulid` | sortable unique IDs for logs |
| Lint/Format | `biome` | faster than ESLint+Prettier |
| Process mgr | `pm2` (production) | auto-restart, log rotation |
| Dev runner | `tsx` | run TS directly |
| Validation | `zod` | parse user input, env vars |
| Cloud backup | GitHub API + `simple-git` | nightly push snapshot |

**Không xài**: SQL (SQLite/Postgres), ORM (Prisma/Drizzle), NoSQL libs (LowDB/NeDB/MongoDB). Storage tự build.

## Storage architecture (core concept)

### Pattern: WAL + Snapshot
Đây là pattern production thật (Postgres WAL, Redis AOF, Kafka log):

1. **In-memory** primary state: `Map<key, Entity>` per collection
2. **WAL** (Write-Ahead Log) `data/wal.jsonl`: mọi write append vô file dạng JSONL
3. **Snapshot** `data/snapshot.json`: full state dump mỗi 1h hoặc on graceful shutdown
4. **Recovery** khi start: load snapshot → replay WAL từ sau snapshot → ready

### Operations supported
- `SET(collection, key, value)` — insert hoặc update
- `DEL(collection, key)` — delete
- `INCR(collection, key, field, delta)` — atomic increment (cho XP)
- `APPEND(collection, value)` — push to append-only collection

### Trade-off chấp nhận
- ✅ Single bot instance — Discord bot không cần scale horizontal
- ✅ Memory ~100MB cho 10k user, 500k xp logs — Oracle VM 12GB dư
- ✅ Crash mất tối đa data trong WAL chưa flush (~ms, configurable fsync)
- ✅ Query là `Array.filter()` over Map values — < 1ms với 10k items
- ❌ Không có complex SQL join — code tự handle
- ❌ Không có concurrent writer process — không cần

## Code conventions

### File structure
```
src/
├── index.ts                    # entry, no logic
├── bot.ts                      # Client init + event registration
├── config/                     # static config, no runtime state
├── commands/                   # 1 file = 1 slash command
├── events/                     # 1 file = 1 Discord event handler
├── modules/                    # domain logic
│   ├── leveling/
│   ├── verification/
│   ├── automod/
│   ├── reactionRoles/
│   ├── scheduler/
│   └── events/
├── db/                         # custom storage layer
│   ├── types.ts                # entity types
│   ├── operations.ts           # StoreOp definitions
│   ├── append-log.ts           # WAL implementation
│   ├── collection.ts           # Collection<T>
│   ├── append-only-collection.ts
│   ├── singleton-collection.ts
│   ├── store.ts                # main Store
│   ├── queries/                # higher-level query helpers
│   └── index.ts                # singleton export
├── utils/
└── types/
```

### Naming
- Files: `kebab-case.ts`
- Classes: `PascalCase`
- Functions/vars: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Entity field: `snake_case` (vd `discord_id`, `created_at`)
- Discord channel names: `kebab-case`

### User-facing text
- **Tiếng Việt** cho tất cả message gửi đến user
- **English** cho code comment, commit, log, error internal

### TypeScript rules
- `strict: true` luôn
- Không xài `any`, dùng `unknown` + narrow
- Zod schemas cho external input
- Entity types là plain interfaces với primitive fields (string, number, boolean, null) — không nested Date (dùng epoch ms), không Map/Set inside entity

### Store usage patterns
```ts
import { store } from '@/db';

// Get (O(1))
const user = store.users.get(discordId);

// Set (insert hoặc update)
await store.users.set({ ...user, xp: user.xp + 25 });

// Atomic increment (race-safe, prefered for counters)
await store.users.incr(discordId, 'xp', 25);

// Append to log
await store.xpLogs.append({
  id: ulid(),
  discord_id: discordId,
  amount: 25,
  source: 'message',
  created_at: Date.now(),
});

// Query (in-memory filter, sync)
const topUsers = store.users.query(u => u.level >= 10)
  .sort((a, b) => b.xp - a.xp)
  .slice(0, 10);

// ❌ DON'T: bypass store, direct file write
fs.writeFile('data/users.json', ...);

// ❌ DON'T: hold reference and mutate (won't trigger WAL)
const user = store.users.get(id);
user.xp += 25;  // ❌ lost on snapshot
```

### Logging rules
- Mọi XP change → `store.xpLogs.append()`
- Mọi mod action → `store.automodLogs.append()` + post `#nhật-ký-tông-môn`
- Mọi error → `pino.error({ ...context })`
- Không log token, password, PII

## Hard rules (don't break)

1. **Bot token**: chỉ trong `.env`, không commit. `.env` trong `.gitignore`.
2. **Least privilege**: bot role chỉ cần `Manage Roles`, `Manage Channels`, `Kick`, `Ban`, `Manage Messages`, `Read/Send Messages`, `Embed Links`, `Add Reactions`. Administrator chỉ first-time sync.
3. **Rate limit aware**: không loop `await channel.send()` >5 lần liên tiếp.
4. **Idempotency**: tất cả setup script chạy lại được.
5. **Anti-grind**: XP cooldown 60s/user sacred.
6. **Privacy**: không log nội dung message vào DB (chỉ user_id, channel_id, timestamp, length).
7. **Tiếng Việt user-facing, no Han characters**.
8. **Storage**: tất cả write phải qua `store.*` API. Không direct file IO.
9. **Graceful shutdown**: bắt `SIGTERM`, `SIGINT` → `store.shutdown()` để snapshot final state.

## Common pitfalls

- Discord.js v14: `Events.MessageCreate` (capital), không phải `'message'` như v13
- `interaction.reply()` chỉ 1 lần, sau dùng `editReply()` / `followUp()`
- Slash command: dev guild (instant), prod global (1h propagate)
- `GuildMember.roles.add()` trả promise
- `node-canvas` cần system deps: `apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev`
- ARM Oracle VM: `canvas` build từ source, cài đủ deps
- **Store mutation**: KHÔNG mutate entity từ `store.get()`. Luôn `set({ ...entity, field: newValue })` hoặc `incr()`.
- **Async writes**: `await store.set()` phải await để WAL flushed.
- **WAL fsync**: production set `WAL_FSYNC=true` (durable, ~5ms/write), dev có thể `false` (faster).

## Workflow with Claude Code

1. Đọc `CLAUDE.md`
2. Đọc `PROGRESS.md` → phase `in_progress` hoặc next `todo`
3. Đọc section tương ứng `SPEC.md`
4. Implement
5. Update `PROGRESS.md`: tick checkbox, đổi status, note vấn đề
6. Commit `feat(phase-X): <what>` hoặc `fix(phase-X): <what>`
7. Báo user review trước khi sang phase kế

## Environment variables
```
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_GUILD_ID=...
NODE_ENV=development|production
LOG_LEVEL=debug|info|warn|error
DATA_DIR=./data
SNAPSHOT_INTERVAL_MS=3600000
WAL_FSYNC=true
ADMIN_USER_IDS=123,456
BACKUP_GITHUB_REPO=user/private-repo
BACKUP_GITHUB_TOKEN=...
```

## Definition of done (per feature)
- [ ] TypeScript compile no error
- [ ] Biome check pass
- [ ] Feature work trên test guild
- [ ] Storage changes use `store.*` API, không direct file IO
- [ ] Bot restart → data resume đúng (test `kill -9` rồi start lại)
- [ ] PROGRESS.md updated
- [ ] User-facing text tiếng Việt
- [ ] Error case handle (DM closed, missing permission, rate limited)
