# SPEC.md — Radiant Tech Sect Bot Specification

> Spec đầy đủ. Claude Code reference khi implement từng phase.

---

## 1. Theme & Naming

**Tu tiên × Tech fusion**, **chỉ dùng tiếng Việt** (không Hán tự).

- Server: Radiant Tech Sect
- Member: "Đệ Tử" (disciple)
- Admin: "Trưởng Lão" (elder)
- Moderator: "Nội Môn Đệ Tử" (inner disciple)
- Bot: "Tông Môn Linh Phù" (sect's spiritual talisman)

User-facing message guideline: dùng từ Hán-Việt cho flavor (cảnh giới, đột phá, tu vi, linh khí) nhưng KHÔNG dùng chữ Hán/Trung phồn thể/giản thể.

---

## 2. Cảnh giới system

10 cảnh giới, member auto đột phá khi đủ XP.

| # | Cảnh giới | Level | Màu role (hex) | Quyền đặc biệt |
|---|---|---|---|---|
| 0 | Phàm Nhân | 0 | `#8a8a8a` | Default sau khi verify |
| 1 | Luyện Khí | 1–9 | `#a0a0a0` | + Add reactions |
| 2 | Trúc Cơ | 10–19 | `#5dade2` | + External emojis, embed links |
| 3 | Kim Đan | 20–34 | `#f4d03f` | + Create public threads |
| 4 | Nguyên Anh | 35–49 | `#9b59b6` | + Create private threads, attach files |
| 5 | Hóa Thần | 50–69 | `#e74c3c` | + Priority speaker, external stickers |
| 6 | Luyện Hư | 70–89 | `#1abc9c` | + Manage own messages |
| 7 | Hợp Thể | 90–119 | `#e67e22` | + Trusted role, nominate-able cho Nội Môn |
| 8 | Đại Thừa | 120–159 | `#ecf0f1` | + Custom title flair, custom emoji react |
| 9 | Độ Kiếp | 160+ | `#ffd700` | + Candidate cho Tiên Nhân, vote Trưởng Lão |

**Tiên Nhân**: top role, admin grant manual only.

### Sub-titles (flair)
- ⚔️ **Kiếm Tu** — gaming / combat
- 🧪 **Đan Sư** — art / creative
- 🔮 **Trận Pháp Sư** — tech / dev
- 🌀 **Tán Tu** — mixed

### Công thức level

```ts
function xpToNext(level: number): number {
  return 5 * level * level + 50 * level + 100;
}

function levelFromXp(xp: number): number {
  let level = 0;
  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level++;
  }
  return level;
}
```

Reference: Level 1 = 100 XP, Level 10 ≈ 1.8k, Level 50 ≈ 110k, Level 100 ≈ 835k.

---

## 3. XP rules

| Hành vi | XP | Cooldown / điều kiện |
|---|---|---|
| Send message | `random(15, 25)` | 60s/user, ≥ 5 chars, không emoji-only |
| Voice channel | 10/phút | ≥ 2 người, không AFK |
| Voice "Working" | 15/phút | bonus pomodoro |
| Reaction received | 2/reaction | max 10/message, 10s cooldown per reactor |
| Message pinned | 50 | one-time |
| `/daily` | 100 | 24h |
| Streak 7d | +50 bonus | reset khi miss |
| Streak 14d | +150 | |
| Streak 30d | +500 | |
| `/solved` | 100 cho helper | trong `#cứu-trợ` thread |
| Event participation | 200–1000 | per event |
| Tribulation pass | 500 | random event |
| Tribulation fail | -100 | floor at current level threshold |

### Anti-abuse
1. Cooldown 60s hardcoded
2. No-XP channels: `#lệnh-bot`, `#bot-dev`, `#nhật-ký-tông-môn`, voice AFK
3. Voice solo: 0 XP
4. Spam (>10 similar message trong 5 min): mute 10 min + revert XP
5. Emoji-only message: < 5 char không tính
6. Bot messages: 0 XP

---

## 4. Verification & Member Filter

Server public → cần multi-layer chống bot raid.

### 4.1. Multi-layer defense

```
Member joins
      │
      ▼
┌─────────────────────────────┐
│ LAYER 1: Account audit       │
│  - Age, avatar, username     │
└──────────────┬──────────────┘
       ┌───────┴────────┐
   PASS│            SUSPECT│
       ▼                ▼
┌──────────┐    ┌──────────────┐
│ Layer 2  │    │ Layer 2-hard │
│ Math     │    │ Image+math   │
└────┬─────┘    └──────┬───────┘
     └────────┬────────┘
       ┌──────┴───────┐
   PASS│           FAIL│
       ▼               ▼
┌──────────────┐  ┌─────────┐
│ Grant Phàm   │  │  Kick   │
│ Nhân         │  └─────────┘
└──────────────┘
```

### 4.2. Layer 1: Account audit (auto)

| Check | Threshold | Action nếu fail |
|---|---|---|
| Account age < 1 ngày | hard | **Kick** + log "suspicious" |
| Account age < 7 ngày | soft | `is_suspect = true`, hard captcha |
| Không có avatar custom | soft | `is_suspect = true` |
| Username chứa pattern bot | soft | `is_suspect = true` |
| Username giống admin (Levenshtein < 3) | hard | **Kick** + alert |

Bot pattern regex (refine sau):
```ts
const BOT_PATTERNS = [
  /^[a-z]+\d{4,}$/,
  /^[A-Z][a-z]+[A-Z][a-z]+\d+$/,
  /^.{1,3}$/,
  /^[a-z]{8,}$/,
];
```

### 4.3. Layer 2: Captcha gate

**Standard captcha** (account ≥ 7 ngày, có avatar):
- DM: "Chào mừng đến Radiant Tech Sect. Xác minh: **{a} + {b} = ?**"
- Member reply DM
- Bot verify, grant role

**Hard captcha** (suspect):
- DM với **image captcha** (6 chars random, có noise) + math
- Reply: "<captcha> <math_answer>"
- Bot verify cả 2

**Captcha generation**:
```ts
import { createCanvas } from 'canvas';

export function generateImageCaptcha(): { text: string; buffer: Buffer } {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const text = Array(6).fill(0)
    .map(() => chars[Math.floor(Math.random() * chars.length)])
    .join('');
  
  const canvas = createCanvas(200, 70);
  const ctx = canvas.getContext('2d');
  
  ctx.fillStyle = '#1e1e2e';
  ctx.fillRect(0, 0, 200, 70);
  for (let i = 0; i < 100; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.3})`;
    ctx.fillRect(Math.random() * 200, Math.random() * 70, 1, 1);
  }
  
  ctx.font = 'bold 36px sans-serif';
  ctx.fillStyle = '#fafafa';
  for (let i = 0; i < text.length; i++) {
    ctx.save();
    ctx.translate(20 + i * 28, 45);
    ctx.rotate((Math.random() - 0.5) * 0.4);
    ctx.fillText(text[i], 0, 0);
    ctx.restore();
  }
  
  for (let i = 0; i < 4; i++) {
    ctx.strokeStyle = `rgba(255,255,255,0.3)`;
    ctx.beginPath();
    ctx.moveTo(Math.random() * 200, Math.random() * 70);
    ctx.lineTo(Math.random() * 200, Math.random() * 70);
    ctx.stroke();
  }
  
  return { text, buffer: canvas.toBuffer('image/png') };
}
```

### 4.4. Timing
- Captcha timeout: 5 phút (suspect: 3 phút)
- Max attempts: 3 (suspect: 2)
- DM closed: fallback button trong `#xác-minh`
- Pass: grant `Phàm Nhân`, remove `Chưa Xác Minh`, welcome message
- Fail/timeout: kick + log

### 4.5. Quarantine
Role `Chưa Xác Minh`:
- Default cho member mới
- Permission: chỉ view `#xác-minh`, `#nội-quy`, `#hướng-dẫn-tu-luyện`

### 4.6. Raid protection
```yaml
trigger: >10 joins trong 60s
actions:
  - all new joins: hard captcha (skip age check)
  - timeout giảm xuống 2 phút
  - alert admin in #nhật-ký-tông-môn với @Trưởng Lão
  - auto-disable sau 30 min không có join mới
manual: /raid-mode <on|off|status>
```

### 4.7. Config
```json
{
  "accountAge": { "hardFailDays": 1, "softFailDays": 7 },
  "captcha": {
    "standard": { "timeoutSeconds": 300, "maxAttempts": 3, "type": "math" },
    "hard": { "timeoutSeconds": 180, "maxAttempts": 2, "type": "image+math" }
  },
  "raid": { "joinThreshold": 10, "joinWindowSeconds": 60, "autoDisableMinutes": 30 },
  "quarantineRole": "Chưa Xác Minh",
  "verifiedRole": "Phàm Nhân"
}
```

---

## 5. Server structure

### 5.1. Roles (priority high → low)

```
Trưởng Lão (Admin)
Tiên Nhân
Nội Môn Đệ Tử
─────── auto cảnh giới ───────
Độ Kiếp / Đại Thừa / Hợp Thể / Luyện Hư / Hóa Thần
Nguyên Anh / Kim Đan / Trúc Cơ / Luyện Khí / Phàm Nhân
─────── sub-titles ───────
Kiếm Tu / Đan Sư / Trận Pháp Sư / Tán Tu
──────────────────────────
Tông Môn Linh Phù (Bot)
Chưa Xác Minh
@everyone
```

### 5.2. Channels

```
🏯 Tông Môn Đại Điện/
├── # thông-báo                  announcements
├── # nội-quy                    rules
├── # nhật-ký-tông-môn           sect-log (bot post only)
└── # phòng-trưởng-lão           admin discuss

🔒 Kiểm Tra/                     (Chưa Xác Minh only)
└── # xác-minh

📜 Đại Hội/
├── # thảo-luận-chung
├── # giới-thiệu
├── # meme
└── # điểm-danh                  daily

🔬 Công Nghệ/
├── # game-development
├── # ai-ml
├── # tools-showcase
└── # cứu-trợ                    help-me

🎮 Giải Trí/
├── # gaming
├── # highlight
└── # xem-phim-cùng

🎨 Sáng Tạo/
├── # tranh-vẽ
├── # âm-nhạc
└── # văn-chương

🌌 Tu Luyện/
├── # hướng-dẫn-tu-luyện
├── # đột-phá                    level-up announcements
├── # bảng-xếp-hạng              leaderboard
└── # độ-kiếp                    tribulation arena

🛠️ Phòng Luyện Khí/
├── # lệnh-bot                   bot-commands
├── # bot-dev
└── # ý-tưởng-automation

📚 Tài Nguyên/
├── # tài-liệu
└── # tin-tuyển-dụng

🔊 Voice/
├── 🔊 Sảnh Chính
├── 🎮 Gaming
├── 🔨 Tu Luyện (Pomodoro)
├── 🤫 Tu Luyện Tịnh Tâm
├── 🎬 Phim Ảnh
└── 🎮 Gaming 2
```

### 5.3. Permission matrix

| Channel | @everyone | Chưa Xác Minh | Phàm Nhân+ | Mod | Admin |
|---|---|---|---|---|---|
| `#thông-báo` | view | view | view | post | manage |
| `#xác-minh` | hidden | view+send | hidden | view | view |
| `#thảo-luận-chung` | hidden | hidden | view+send | manage | full |
| `#nhật-ký-tông-môn` | hidden | hidden | hidden | view | view |
| `#phòng-trưởng-lão` | hidden | hidden | hidden | hidden | view+send |
| `#bot-dev` | hidden | hidden | hidden | view+send | full |

Default: tất cả category khác = `Phàm Nhân+ view`, `Chưa Xác Minh hidden`.

---

## 6. Storage architecture (CUSTOM, replaces SQL)

### 6.1. Design overview

```
┌────────────────────────────────────┐
│  In-memory: Map<key, Entity>        │ ← primary, O(1) read/write
└──────────┬─────────────────────────┘
           │ every write
           ▼
┌────────────────────────────────────┐
│  WAL: data/wal.jsonl                │ ← append-only, durable
│  {op:"SET", coll:"users", ...}     │
│  {op:"INCR", coll:"users", ...}    │
└──────────┬─────────────────────────┘
           │ every 1h or on shutdown
           ▼
┌────────────────────────────────────┐
│  Snapshot: data/snapshot.json       │ ← full state dump
│  { version, users: [...], ... }    │
└──────────┬─────────────────────────┘
           │ nightly cron
           ▼
┌────────────────────────────────────┐
│  Cloud backup (GitHub private repo) │
│  - snapshot.json                    │
│  - wal.jsonl (if not yet compacted) │
└────────────────────────────────────┘
```

### 6.2. Entity types

```ts
// src/db/types.ts

export type CultivationRankId =
  | 'pham_nhan' | 'luyen_khi' | 'truc_co' | 'kim_dan' | 'nguyen_anh'
  | 'hoa_than' | 'luyen_hu' | 'hop_the' | 'dai_thua' | 'do_kiep'
  | 'tien_nhan';

export type XpSource =
  | 'message' | 'voice' | 'voice_working' | 'reaction' | 'pin'
  | 'daily' | 'streak_7' | 'streak_14' | 'streak_30'
  | 'solved' | 'event' | 'tribulation_pass' | 'tribulation_fail'
  | 'admin_grant';

export interface User {
  discord_id: string;
  username: string;
  display_name: string | null;
  xp: number;
  level: number;
  cultivation_rank: CultivationRankId;
  sub_title: string | null;
  joined_at: number;          // epoch ms
  verified_at: number | null;
  last_message_at: number | null;
  last_daily_at: number | null;
  daily_streak: number;
  is_suspect: boolean;
  notes: string | null;
}

export interface XpLog {
  id: string;                  // ulid
  discord_id: string;
  amount: number;
  source: XpSource;
  metadata: Record<string, unknown> | null;
  created_at: number;
}

export interface VoiceSession {
  discord_id: string;
  channel_id: string;
  joined_at: number;
  is_working: boolean;
}

export interface Verification {
  discord_id: string;
  challenge_type: 'math' | 'image+math';
  challenge_data: { expected: string; [k: string]: unknown };
  attempts: number;
  started_at: number;
  status: 'pending' | 'passed' | 'failed' | 'timeout';
}

export interface AutomodLog {
  id: string;
  discord_id: string;
  rule: 'spam' | 'profanity' | 'mass_mention' | 'link' | 'caps';
  action: 'delete' | 'warn' | 'timeout' | 'kick' | 'ban';
  context: Record<string, unknown> | null;
  created_at: number;
}

export interface SectEvent {
  id: string;
  name: string;
  type: 'tribulation' | 'sect_war' | 'alchemy' | 'custom';
  started_at: number;
  ended_at: number | null;
  metadata: Record<string, unknown> | null;
}

export interface RaidState {
  is_active: boolean;
  activated_at: number | null;
  last_join_at: number | null;
  recent_joins: number[];      // timestamps
}
```

### 6.3. Operations type

```ts
// src/db/operations.ts

export type StoreOp =
  | { op: 'SET'; coll: string; key: string; value: unknown; ts: number }
  | { op: 'DEL'; coll: string; key: string; ts: number }
  | { op: 'INCR'; coll: string; key: string; field: string; delta: number; ts: number }
  | { op: 'APPEND'; coll: string; value: unknown; ts: number };
```

### 6.4. AppendOnlyLog implementation

```ts
// src/db/append-log.ts

import { promises as fs, createReadStream } from 'fs';
import readline from 'readline';
import { Mutex } from 'async-mutex';
import { StoreOp } from './operations';

export class AppendOnlyLog {
  private mutex = new Mutex();
  
  constructor(
    private filePath: string,
    private fsync: boolean,
  ) {}
  
  async ensureExists(): Promise<void> {
    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(this.filePath, '');
    }
  }
  
  async append(op: StoreOp): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const line = JSON.stringify(op) + '\n';
      if (this.fsync) {
        const fd = await fs.open(this.filePath, 'a');
        try {
          await fd.write(line);
          await fd.sync();   // fsync to disk, durable
        } finally {
          await fd.close();
        }
      } else {
        await fs.appendFile(this.filePath, line);
      }
    });
  }
  
  async *replay(): AsyncIterable<StoreOp> {
    const stream = createReadStream(this.filePath);
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line) as StoreOp;
      } catch (err) {
        // Skip corrupt lines, log warning
        console.warn('Corrupt WAL line, skipping:', line);
      }
    }
  }
  
  async truncate(): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await fs.writeFile(this.filePath, '');
    });
  }
}
```

### 6.5. Collection<T> implementation

```ts
// src/db/collection.ts

import { Mutex } from 'async-mutex';
import { AppendOnlyLog } from './append-log';

export class Collection<T extends Record<string, unknown>> {
  private data = new Map<string, T>();
  private mutex = new Mutex();
  
  constructor(
    public readonly name: string,
    private log: AppendOnlyLog,
    private getKey: (item: T) => string,
  ) {}
  
  // Public API (writes go to WAL)
  
  async set(item: T): Promise<void> {
    const key = this.getKey(item);
    return this.mutex.runExclusive(async () => {
      this.data.set(key, item);
      await this.log.append({
        op: 'SET', coll: this.name, key, value: item, ts: Date.now(),
      });
    });
  }
  
  async delete(key: string): Promise<boolean> {
    return this.mutex.runExclusive(async () => {
      const existed = this.data.delete(key);
      if (existed) {
        await this.log.append({ op: 'DEL', coll: this.name, key, ts: Date.now() });
      }
      return existed;
    });
  }
  
  async incr(key: string, field: keyof T & string, delta: number): Promise<T | null> {
    return this.mutex.runExclusive(async () => {
      const item = this.data.get(key);
      if (!item) return null;
      const current = item[field];
      if (typeof current !== 'number') {
        throw new Error(`Cannot incr non-number field ${field}`);
      }
      const next = { ...item, [field]: current + delta } as T;
      this.data.set(key, next);
      await this.log.append({
        op: 'INCR', coll: this.name, key, field, delta, ts: Date.now(),
      });
      return next;
    });
  }
  
  // Read API (no WAL, sync)
  
  get(key: string): T | undefined {
    return this.data.get(key);
  }
  
  has(key: string): boolean {
    return this.data.has(key);
  }
  
  query(predicate: (item: T) => boolean): T[] {
    return [...this.data.values()].filter(predicate);
  }
  
  all(): T[] {
    return [...this.data.values()];
  }
  
  count(): number {
    return this.data.size;
  }
  
  // Internal (called by Store during replay/snapshot, bypass WAL)
  
  _applySet(key: string, value: T): void {
    this.data.set(key, value);
  }
  
  _applyDelete(key: string): void {
    this.data.delete(key);
  }
  
  _applyIncr(key: string, field: keyof T & string, delta: number): void {
    const item = this.data.get(key);
    if (!item) return;
    const current = item[field];
    if (typeof current !== 'number') return;
    this.data.set(key, { ...item, [field]: current + delta } as T);
  }
  
  _bulkLoad(items: T[]): void {
    this.data.clear();
    for (const item of items) {
      this.data.set(this.getKey(item), item);
    }
  }
  
  _serialize(): T[] {
    return [...this.data.values()];
  }
}
```

### 6.6. AppendOnlyCollection<T>

For high-volume logs (xp_logs, automod_logs) — không cần get-by-key, không update/delete, chỉ push & query.

```ts
// src/db/append-only-collection.ts

export class AppendOnlyCollection<T extends Record<string, unknown>> {
  private items: T[] = [];
  private mutex = new Mutex();
  
  constructor(
    public readonly name: string,
    private log: AppendOnlyLog,
  ) {}
  
  async append(item: T): Promise<void> {
    return this.mutex.runExclusive(async () => {
      this.items.push(item);
      await this.log.append({
        op: 'APPEND', coll: this.name, value: item, ts: Date.now(),
      });
    });
  }
  
  query(predicate: (item: T) => boolean): T[] {
    return this.items.filter(predicate);
  }
  
  recent(n: number): T[] {
    return this.items.slice(-n);
  }
  
  count(): number {
    return this.items.length;
  }
  
  _applyAppend(item: T): void {
    this.items.push(item);
  }
  
  _bulkLoad(items: T[]): void {
    this.items = [...items];
  }
  
  _serialize(): T[] {
    return this.items;
  }
  
  // Compact: keep only last N items, drop older
  // Useful nếu log quá lớn
  compact(maxItems: number): void {
    if (this.items.length > maxItems) {
      this.items = this.items.slice(-maxItems);
    }
  }
}
```

### 6.7. Store (orchestrator)

```ts
// src/db/store.ts

import path from 'path';
import { promises as fs } from 'fs';
import { Collection } from './collection';
import { AppendOnlyCollection } from './append-only-collection';
import { SingletonCollection } from './singleton-collection';
import { AppendOnlyLog } from './append-log';
import {
  User, XpLog, VoiceSession, Verification,
  AutomodLog, SectEvent, RaidState,
} from './types';
import { logger } from '@/utils/logger';

export class Store {
  // Collections (keyed)
  users!: Collection<User>;
  voiceSessions!: Collection<VoiceSession>;
  verifications!: Collection<Verification>;
  events!: Collection<SectEvent>;
  
  // Append-only collections
  xpLogs!: AppendOnlyCollection<XpLog>;
  automodLogs!: AppendOnlyCollection<AutomodLog>;
  
  // Singleton
  raidState!: SingletonCollection<RaidState>;
  
  private log!: AppendOnlyLog;
  private snapshotPath!: string;
  private snapshotTimer?: NodeJS.Timeout;
  
  constructor(
    private dataDir: string,
    private snapshotIntervalMs: number,
    private fsync: boolean,
  ) {}
  
  async init(): Promise<void> {
    // Ensure data dir exists
    await fs.mkdir(this.dataDir, { recursive: true });
    
    this.log = new AppendOnlyLog(path.join(this.dataDir, 'wal.jsonl'), this.fsync);
    await this.log.ensureExists();
    this.snapshotPath = path.join(this.dataDir, 'snapshot.json');
    
    // Init collections
    this.users = new Collection('users', this.log, u => u.discord_id);
    this.voiceSessions = new Collection('voice_sessions', this.log, v => v.discord_id);
    this.verifications = new Collection('verifications', this.log, v => v.discord_id);
    this.events = new Collection('events', this.log, e => e.id);
    this.xpLogs = new AppendOnlyCollection('xp_logs', this.log);
    this.automodLogs = new AppendOnlyCollection('automod_logs', this.log);
    this.raidState = new SingletonCollection('raid_state', this.log, {
      is_active: false,
      activated_at: null,
      last_join_at: null,
      recent_joins: [],
    });
    
    // 1. Load snapshot if exists
    if (await fileExists(this.snapshotPath)) {
      const raw = await fs.readFile(this.snapshotPath, 'utf-8');
      const snapshot = JSON.parse(raw);
      this.users._bulkLoad(snapshot.users || []);
      this.voiceSessions._bulkLoad(snapshot.voice_sessions || []);
      this.verifications._bulkLoad(snapshot.verifications || []);
      this.events._bulkLoad(snapshot.events || []);
      this.xpLogs._bulkLoad(snapshot.xp_logs || []);
      this.automodLogs._bulkLoad(snapshot.automod_logs || []);
      if (snapshot.raid_state) this.raidState._set(snapshot.raid_state);
      logger.info({ snapshot_version: snapshot.version }, 'Snapshot loaded');
    }
    
    // 2. Replay WAL
    let replayCount = 0;
    for await (const op of this.log.replay()) {
      this.applyOp(op);
      replayCount++;
    }
    logger.info({ ops: replayCount }, 'WAL replay complete');
    
    // 3. Start periodic snapshot
    this.snapshotTimer = setInterval(
      () => this.snapshot().catch(err => logger.error({ err }, 'Snapshot failed')),
      this.snapshotIntervalMs,
    );
  }
  
  private applyOp(op: StoreOp): void {
    const coll = this.getCollection(op.coll);
    if (!coll) {
      logger.warn({ coll: op.coll }, 'Unknown collection in WAL, skipping');
      return;
    }
    switch (op.op) {
      case 'SET': coll._applySet(op.key, op.value as never); break;
      case 'DEL': coll._applyDelete(op.key); break;
      case 'INCR': coll._applyIncr(op.key, op.field as never, op.delta); break;
      case 'APPEND': coll._applyAppend(op.value as never); break;
    }
  }
  
  private getCollection(name: string): any {
    const map: Record<string, any> = {
      users: this.users,
      voice_sessions: this.voiceSessions,
      verifications: this.verifications,
      events: this.events,
      xp_logs: this.xpLogs,
      automod_logs: this.automodLogs,
      raid_state: this.raidState,
    };
    return map[name];
  }
  
  async snapshot(): Promise<void> {
    const data = {
      version: 1,
      created_at: Date.now(),
      users: this.users._serialize(),
      voice_sessions: this.voiceSessions._serialize(),
      verifications: this.verifications._serialize(),
      events: this.events._serialize(),
      xp_logs: this.xpLogs._serialize(),
      automod_logs: this.automodLogs._serialize(),
      raid_state: this.raidState._serialize(),
    };
    
    // Atomic: write tmp + rename
    const tmpPath = this.snapshotPath + '.tmp';
    await fs.writeFile(tmpPath, JSON.stringify(data));
    await fs.rename(tmpPath, this.snapshotPath);
    
    // Truncate WAL (all ops persisted in snapshot)
    await this.log.truncate();
    
    logger.info({
      users: this.users.count(),
      xp_logs: this.xpLogs.count(),
    }, 'Snapshot saved');
  }
  
  async shutdown(): Promise<void> {
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    await this.snapshot();
    logger.info('Store shutdown complete');
  }
}

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}
```

### 6.8. SingletonCollection

For state có exactly 1 record (raid_state).

```ts
// src/db/singleton-collection.ts

export class SingletonCollection<T extends Record<string, unknown>> {
  private data: T;
  private mutex = new Mutex();
  
  constructor(
    public readonly name: string,
    private log: AppendOnlyLog,
    initial: T,
  ) {
    this.data = initial;
  }
  
  get(): T {
    return this.data;
  }
  
  async update(patch: Partial<T>): Promise<void> {
    return this.mutex.runExclusive(async () => {
      this.data = { ...this.data, ...patch };
      await this.log.append({
        op: 'SET', coll: this.name, key: '_singleton', value: this.data, ts: Date.now(),
      });
    });
  }
  
  _set(value: T): void { this.data = value; }
  _applySet(_key: string, value: T): void { this.data = value; }
  _serialize(): T { return this.data; }
  _applyAppend(): void { /* no-op */ }
  _bulkLoad(): void { /* no-op */ }
  _applyDelete(): void { /* no-op */ }
  _applyIncr(): void { /* no-op */ }
}
```

### 6.9. Backup strategy

Nightly cron via `node-cron` (00:00 VN time):

```ts
// src/modules/scheduler/backup.ts

import { simpleGit } from 'simple-git';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';

export async function backupToGitHub(): Promise<void> {
  if (!config.BACKUP_GITHUB_REPO || !config.BACKUP_GITHUB_TOKEN) {
    logger.info('Backup skipped (no GitHub config)');
    return;
  }
  
  const backupDir = './backup-repo';
  const remoteUrl = `https://${config.BACKUP_GITHUB_TOKEN}@github.com/${config.BACKUP_GITHUB_REPO}.git`;
  const git = simpleGit();
  
  // Clone or pull
  if (!(await fileExists(backupDir))) {
    await git.clone(remoteUrl, backupDir);
  } else {
    await simpleGit(backupDir).pull();
  }
  
  // Copy snapshot + wal
  await fs.copyFile(
    path.join(config.DATA_DIR, 'snapshot.json'),
    path.join(backupDir, 'snapshot.json'),
  );
  await fs.copyFile(
    path.join(config.DATA_DIR, 'wal.jsonl'),
    path.join(backupDir, 'wal.jsonl'),
  );
  
  // Commit & push
  const repoGit = simpleGit(backupDir);
  await repoGit.add('./*');
  const date = new Date().toISOString().slice(0, 10);
  await repoGit.commit(`backup ${date}`);
  await repoGit.push('origin', 'main');
  
  logger.info({ date }, 'Backup pushed to GitHub');
}
```

Schedule trong scheduler module:
```ts
cron.schedule('0 0 * * *', backupToGitHub, { timezone: 'Asia/Ho_Chi_Minh' });
```

### 6.10. Recovery scenario

Mất Oracle VM hoàn toàn → spin VM mới:
```bash
# 1. Setup VM theo Phase 0
# 2. Clone repo + cài deps
# 3. Pull data từ backup
git clone https://<token>@github.com/<user>/<backup-repo>.git ./tmp-backup
cp ./tmp-backup/snapshot.json ./data/
cp ./tmp-backup/wal.jsonl ./data/

# 4. Start bot — store.init() tự load snapshot + replay WAL
pm2 start ecosystem.config.cjs
```

Data loss tối đa = thay đổi sau backup nightly (vd VM die lúc 11pm → mất 23h). Có thể tăng tần suất backup (mỗi 6h) nếu cần.

### 6.11. Performance sanity check

- Read `store.users.get(id)`: O(1), ~0.001ms
- Write `store.users.set(...)`: O(1) memory + WAL append. Without fsync: ~0.1ms. With fsync: ~5ms.
- Query `store.users.query(predicate)`: O(n). 10k users → ~1ms.
- Snapshot 10k users + 500k xp_logs: ~50MB JSON, write ~200ms. Chạy 1h/lần OK.
- Memory: ~120MB cho 10k users + 500k xp_logs. Oracle VM 12GB → 1% usage.
- WAL size: ~500 bytes/op. 100k ops/day → 50MB/day. Compact mỗi snapshot.

---

## 7. Slash commands

| Command | Args | Permission | Output |
|---|---|---|---|
| `/rank [user?]` | optional user | everyone | Embed: cảnh giới, XP, progress bar |
| `/leaderboard [type?]` | all/weekly/voice/help | everyone | Top 10 embed |
| `/daily` | — | everyone | Award daily XP + streak |
| `/sect-info` | — | everyone | Server stats |
| `/breakthrough` | — | level ≥ 10 | Tribulation mini-game |
| `/solved @helper` | mention | OP của thread `#cứu-trợ` | Award 100 XP cho helper |
| `/title <name>` | sub-title | level ≥ 5 | Set sub-title |
| `/profile [user?]` | optional | everyone | Full profile |
| **Admin** | | | |
| `/sync-server` | — | admin | Re-apply server-config |
| `/raid-mode <on/off/status>` | mode | admin | Toggle raid protection |
| `/grant-xp @user <amount> <reason>` | | admin | Manual XP |
| `/grant-rank @user <rank>` | | admin | Manual rank grant |
| `/sect-report` | — | admin | Monthly report |
| `/snapshot-now` | — | admin | Force snapshot (debug) |
| `/backup-now` | — | admin | Force backup (debug) |

---

## 8. Module specifications

### 8.1. Leveling (`src/modules/leveling/`)

```ts
interface LevelingEngine {
  awardXp(userId: string, amount: number, source: XpSource, metadata?: object): Promise<XpResult>;
  getUserStats(userId: string): UserStats;
  getLeaderboard(type: 'all'|'weekly'|'voice', limit?: number): LeaderboardEntry[];
}

interface XpResult {
  newXp: number;
  oldLevel: number;
  newLevel: number;
  leveledUp: boolean;
  rankChanged: boolean;
  newRank?: CultivationRankId;
}
```

Implementation note: `awardXp` use `store.users.incr()` for atomic XP write, then recalc level và check rank change separately.

### 8.2. Verification (`src/modules/verification/`)

- `audit.ts` — Layer 1
- `captcha-math.ts` — math generation + verify
- `captcha-image.ts` — image captcha (node-canvas)
- `flow.ts` — orchestrate
- `raid.ts` — raid detection

### 8.3. Automod (`src/modules/automod/`)

Rule engine data-driven:
```ts
interface AutomodRule {
  name: string;
  detect: (msg: Message) => Promise<boolean> | boolean;
  action: 'delete' | 'warn' | 'timeout' | 'kick';
  severity: 1 | 2 | 3;
  log: boolean;
}
```

### 8.4. Scheduler (`src/modules/scheduler/`)

```ts
// Vietnam time
cron.schedule('0 0 * * *', resetDailyFlags, { timezone: 'Asia/Ho_Chi_Minh' });
cron.schedule('0 0 * * *', backupToGitHub, { timezone: 'Asia/Ho_Chi_Minh' });
cron.schedule('0 20 * * 0', postWeeklyLeaderboard, { timezone: 'Asia/Ho_Chi_Minh' });
cron.schedule('0 */4 * * *', archiveInactiveThreads);
cron.schedule('0 * * * *', cleanupExpiredVerifications);
cron.schedule('0 18 * * *', maybeRunTribulation);  // 25% chance in window
```

### 8.5. Tribulation (`src/modules/events/`)

Game types:
1. **Math puzzle**: arithmetic in 30s, difficulty scales by level
2. **Reaction speed**: bot post 5 emoji, click 🐉 trong 5s

Flow:
- Pick random eligible member (level ≥ 10, online, not AFK)
- Post in `#độ-kiếp` với mention + buttons
- 30s timer
- Pass: +500 XP, fail: -100 XP (floor)

---

## 9. Deployment (Oracle Cloud Always Free)

### 9.1. VM setup

```bash
# Oracle Cloud Console:
# Create Always Free Tier ARM Ampere A1 Flex instance
# - 2 OCPU, 12GB RAM
# - Ubuntu 22.04
# Note public IP

ssh -i key.pem ubuntu@<public-ip>

sudo apt update && sudo apt upgrade -y

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

sudo apt install -y build-essential git \
  libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev

sudo npm install -g pm2

# Firewall
sudo iptables -I INPUT -p tcp --dport 22 -j ACCEPT
sudo netfilter-persistent save
```

### 9.2. Deploy

```bash
git clone <your-private-repo> radiant-bot
cd radiant-bot
npm ci
cp .env.example .env && nano .env  # fill tokens

npm run deploy-commands
npm run sync-server

pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

### 9.3. Restore from backup

```bash
git clone https://<token>@github.com/<user>/<backup-repo> ./tmp-backup
mkdir -p ./data
cp ./tmp-backup/snapshot.json ./data/
cp ./tmp-backup/wal.jsonl ./data/
pm2 restart radiant-bot
```

### 9.4. Monitoring

- `pm2 logs radiant-bot`
- UptimeRobot free + bot expose `/health` endpoint
- Discord webhook alert khi error rate spike

---

## 10. Reference: example flow code

```ts
// src/events/messageCreate.ts
import { Events, Message } from 'discord.js';
import { ulid } from 'ulid';
import { store } from '@/db';
import { leveling } from '@/modules/leveling';
import { cooldown } from '@/modules/leveling/cooldown';
import { automod } from '@/modules/automod';
import { NO_XP_CHANNELS } from '@/config/channels';

export const name = Events.MessageCreate;

export async function execute(message: Message) {
  if (message.author.bot) return;
  if (!message.guild) return;
  
  // Automod first
  const modResult = await automod.check(message);
  if (modResult.deleted) return;
  
  // XP eligibility
  if (NO_XP_CHANNELS.includes(message.channelId)) return;
  if (message.content.trim().length < 5) return;
  if (cooldown.isOnCooldown(message.author.id)) return;
  
  cooldown.set(message.author.id, 60_000);
  
  const xpAmount = 15 + Math.floor(Math.random() * 11);
  
  // Atomic increment XP, then check level change
  const updated = await store.users.incr(message.author.id, 'xp', xpAmount);
  if (!updated) return;  // user not in store yet (shouldn't happen if verified)
  
  // Log XP transaction
  await store.xpLogs.append({
    id: ulid(),
    discord_id: message.author.id,
    amount: xpAmount,
    source: 'message',
    metadata: { channel_id: message.channelId },
    created_at: Date.now(),
  });
  
  // Check level up
  const result = leveling.checkLevelChange(updated);
  if (result.leveledUp) {
    await leveling.handleLevelUp(message.member!, result);
  }
}
```

---

## 11. Testing strategy

- **Unit tests** (`vitest`): pure functions (xp engine, captcha generation, store operations)
- **Store integration tests**: create temp dir, init store, set/get/snapshot/restart/verify state
- **Manual integration**: dev guild cho Discord interaction
- **Crash recovery test**: write 100 ops, `kill -9`, restart → verify all 100 replayed

Example store test:
```ts
test('store recovers from snapshot + wal', async () => {
  const dataDir = `./test-data-${Date.now()}`;
  const store1 = new Store(dataDir, 60_000, false);
  await store1.init();
  
  await store1.users.set({ discord_id: '1', xp: 100, /* ... */ });
  await store1.snapshot();
  await store1.users.incr('1', 'xp', 50);  // in WAL only
  // Simulate crash (no graceful shutdown)
  
  const store2 = new Store(dataDir, 60_000, false);
  await store2.init();
  expect(store2.users.get('1')?.xp).toBe(150);  // snapshot 100 + WAL incr 50
});
```

---

## 12. Non-goals (out of scope MVP)

- ❌ Web dashboard (Phase X future)
- ❌ Mobile app
- ❌ Cross-server federation
- ❌ Music bot
- ❌ AI chat features
- ❌ Economy / currency
- ❌ NFT / crypto
- ❌ Voice transcription
- ❌ Multi-instance bot (custom store là single-writer)
