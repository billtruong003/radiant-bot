# Phase 12 — Game mechanics (combat power, currency, công pháp, daily quest, PvP, multi-NPC)

> Single-doc runbook + design lock cho Phase 12. Follow theo thứ tự lát,
> tick checkbox khi xong. Mỗi lát = 1 commit độc lập, có thể pause/skip
> nếu scope đổi.

**Last updated:** 2026-05-14
**Phase status:** 📐 designed — Lát 1 next

---

## TL;DR cheat-sheet

| Lát | Scope | Status |
|---|---|---|
| 1 | Foundation: User entity additions + entities (CongPhap, UserCongPhap, DailyQuest) + `/stat` read-only | 📐 designed |
| 2 | Currency UI: `/inventory` list + currency display in `/rank` + lực chiến hiển thị `/leaderboard` | 📋 planned |
| 3 | Công pháp: catalog seed + `/shop` + `/cong-phap` commands (list/info/buy/equip/unequip) | 📋 planned |
| 4 | Daily quest: cron generate + tracker + `/quest` | 📋 planned |
| 5 | Multi-NPC: persona files + `/ask-akira`, `/ask-meifeng` | 📋 planned |
| 6 | PvP `/duel` — design + implement carefully | 📋 planned (future) |

Status indicators: 📐 designed (plan locked, not coded) · 🔄 in progress · ✅ shipped · ⏸️ paused

---

## Goals

Add cultivation game-mechanic depth on top of existing leveling +
tribulation: **combat power** (lực chiến), **2 currencies** (pills +
contribution points), **technique manuals** (công pháp) with stat
bonuses, **daily quests**, **PvP duels**, and **multi-NPC roster**.

Anchors that should NOT change:
- Existing leveling math (5L²+50L+100 curve)
- Existing XP earning rates (message 15-25 / voice 10/min / reaction 2 / daily 100+bonus)
- 60s message XP cooldown sacred
- Cảnh giới rank thresholds (level → rank mapping)
- Profanity counter / Thiên Đạo narration from Phase 11.2

What changes / new:
- 3 new entities + Store collections
- 7 new slash commands
- 1 new cron (daily quest generator)
- Lực chiến formula
- /breakthrough now requires 1 pill (was free)

---

## Data model

### User entity additions
Add to `src/db/types.ts` `User` interface (all default to 0/null, schema
defaulting handles legacy users without these fields):

```ts
interface User {
  // ...existing fields...
  pills: number;                       // Đan dược độ kiếp (default 0)
  contribution_points: number;         // Điểm cống hiến (default 0)
  equipped_cong_phap_slug: string | null;  // slug of currently equipped công pháp
  combat_power_cache: number | null;   // derived score, recomputed on stat change
  last_quest_assigned_at: number | null; // epoch ms — set when daily cron generates a quest
}
```

### New entity: CongPhap (catalog)
Read-mostly catalog of all available công pháp. Seeded from a JSON file,
not user-mutable except via admin slash later.

```ts
type CongPhapRarity = 'common' | 'rare' | 'epic' | 'legendary';

interface CongPhap {
  id: string;          // ulid
  slug: string;        // 'kim-cang-quyen', stable identifier referenced by UserCongPhap
  name: string;        // 'Kim Cang Quyền' — VN display name
  description: string; // VN flavor text
  rarity: CongPhapRarity;
  cost_pills: number;          // pills required to acquire
  cost_contribution: number;   // contribution points required
  stat_bonuses: {
    combat_power: number;      // flat bonus to lực chiến
    xp_multiplier?: number;    // 1.05 = +5% XP, optional
  };
  min_rank_required: CultivationRankId | null; // gate by cảnh giới
  created_at: number;
}
```

Store collection: `congPhapCatalog` (Collection<CongPhap>, keyed by slug).
Seeded from `src/config/cong-phap-catalog.json` at startup; admin slash
in a later phase can add/remove entries at runtime.

### New entity: UserCongPhap (inventory)

```ts
interface UserCongPhap {
  id: string;           // ulid
  discord_id: string;
  cong_phap_slug: string; // FK to CongPhap.slug
  acquired_at: number;
}
```

Store collection: `userCongPhap` (Collection<UserCongPhap>). Keyed by id;
queried by `discord_id`.

Equipped state lives on `User.equipped_cong_phap_slug` (single equipped
slot for now; multi-slot in a future phase).

### New entity: DailyQuest

```ts
type DailyQuestType = 'message_count' | 'voice_minutes' | 'reaction_count' | 'daily_streak_check';

interface DailyQuest {
  id: string;          // ulid
  discord_id: string;
  quest_type: DailyQuestType;
  target: number;             // e.g. 10 messages
  progress: number;           // current
  reward_xp: number;
  reward_pills: number;
  reward_contribution: number;
  assigned_at: number;        // start of VN day (00:00 +07:00)
  completed_at: number | null;
}
```

Store collection: `dailyQuests` (Collection<DailyQuest>). Latest per
user looked up by `discord_id` + `assigned_at` >= today VN midnight.

---

## Lực chiến formula

`combat_power = base + level_bonus + rank_bonus + sub_title_bonus + cong_phap_bonus`

| Term | Value |
|---|---|
| base | 100 |
| level_bonus | level × 10 |
| rank_bonus | rank_index × 50 (Phàm Nhân=0, Luyện Khí=1, ..., Độ Kiếp=9, Tiên Nhân=10) |
| sub_title_bonus | 50 if `User.sub_title !== null` else 0 |
| cong_phap_bonus | sum of `equipped công pháp.stat_bonuses.combat_power` (currently single slot) |

Cached in `User.combat_power_cache`, recomputed when:
- Level changes (in `awardXp`)
- Rank changes (in `maybePromoteRank`)
- Sub-title changes (`/title add` / `/title remove`)
- Công pháp equipped/unequipped (`/cong-phap equip` / `unequip`)
- Công pháp acquired (if auto-equipped)

Helper: `computeCombatPower(user, equippedCongPhap)` in `src/modules/combat/power.ts`.

---

## Currencies

### Earning pills (Đan dược độ kiếp)
| Source | Amount |
|---|---|
| Tribulation pass | +5 |
| Tribulation fail | 0 |
| Daily quest completion | +1 |
| Streak milestone day 7 | +2 |
| Streak milestone day 30 | +10 |
| Admin grant (`/grant pills @user N`) | N |

### Earning contribution points
| Source | Amount |
|---|---|
| Message XP earned | +0.1 per XP (floor at end of day) |
| Reaction received | +1 per reaction |
| Daily quest completion | +10 |
| Daily claim (existing /daily) | +5 |
| Voice minute (working channel) | +0.5 per min |
| Admin grant | N |

### Spending
- **Pills**: required for `/breakthrough` tribulation attempt (1 pill consumed per attempt). Bill TODO confirm: keep free for now? → defer to Lát 4 deploy.
- **Contribution points**: buy công pháp from `/shop`.

Note: spending paths gated on lát 3 (shop) shipping. Until then, both
currencies just accumulate (visible in `/stat`).

---

## Slash commands (Phase 12)

| Command | Description | Lát |
|---|---|---|
| `/stat [user?]` | Profile embed: lực chiến + currencies + cảnh giới + sub_title + equipped công pháp + XP progress | 1 |
| `/inventory` | List user's owned công pháp + equip/unequip via buttons | 2 |
| `/shop` | Browse công pháp catalog filtered by user's rank + currency | 3 |
| `/cong-phap list\|info\|buy\|equip\|unequip <slug>` | CRUD công pháp from CLI | 3 |
| `/quest` | Show today's daily quest + progress | 4 |
| `/ask-akira <question>` | Alt NPC — gentle scholar tone | 5 |
| `/ask-meifeng <question>` | Alt NPC — sharp combat-focused tone | 5 |
| `/duel @target [stake]` | PvP challenge (future) | 6 |
| `/grant pills\|contribution @user <n>` | Admin grant | 1 (along with foundation) |

---

## Multi-NPC roster (Lát 5)

Currently only Aki. Plan: add 2-3 NPCs with different personas, all share
LLM router + filter pipeline.

| NPC | Persona file | Tone | Use case |
|---|---|---|---|
| **Aki** | `src/modules/aki/persona.ts` (existing) | playful maid, sass-helper | general / default |
| **Akira** | `src/modules/npc/akira/persona.ts` | gentle scholar, formal tone | study / theory questions |
| **Meifeng** | `src/modules/npc/meifeng/persona.ts` | sharper sass, combat/duel focus | game-mechanics, lực chiến |

Each NPC has:
- `persona.ts` — system prompt (xAI persona)
- `persona-filter.ts` — same filter contract, different tone for rejection
- Slash command `/ask-<name>` in `src/commands/`
- Share `src/modules/aki/client.ts` Grok call + budget + LLM router

Refactor `aki/client.ts` to take a `Persona` interface, then 3 thin
slashes wrap it. ~150 LOC total.

---

## Daily quest (Lát 4)

### Cron
New cron in `src/modules/scheduler/`:
- `0 0 * * *` VN (00:00 +07:00 daily)
- For each user verified in last 30 days + active in last 7 days:
  - Generate 1 quest (random pick from generator pool)
  - Insert into `dailyQuests` collection
- Skip users who haven't messaged in 7+ days (don't generate stale quests)

### Quest generator pool
```ts
const QUEST_POOL = [
  { type: 'message_count',  target: 10, reward_xp: 50,  reward_pills: 1, reward_contribution: 10 },
  { type: 'message_count',  target: 25, reward_xp: 100, reward_pills: 1, reward_contribution: 20 },
  { type: 'voice_minutes',  target: 30, reward_xp: 75,  reward_pills: 1, reward_contribution: 15 },
  { type: 'reaction_count', target: 5,  reward_xp: 30,  reward_pills: 0, reward_contribution: 10 },
  { type: 'daily_streak_check', target: 1, reward_xp: 25, reward_pills: 1, reward_contribution: 5 },
];
```

### Progress tracking
- `message_count`: increment in `awardXp` when source='message'
- `voice_minutes`: increment in `voice-xp.ts` tick
- `reaction_count`: increment in `messageReactionAdd` handler
- `daily_streak_check`: auto-complete when `/daily` claimed today

When `progress >= target` → mark `completed_at = Date.now()` + grant
rewards atomically.

---

## PvP `/duel` (Lát 6 — future)

Design carefully when arriving. Brief sketch:
- `/duel @opponent [stake_pills=1]` — challenge with 60s accept window
- Opponent button: ✅ accept / ❌ decline
- On accept: instantiate Duel entity, turn-based 5-round combat
- Each round: both players have buttons (Attack / Defend / Special)
- Damage = own_lực_chiến × move_multiplier − opp_lực_chiến × defense
- Winner: 80% of stake pills, loser: 0
- Cooldown: 30 min per user
- Anti-grief: max 3 duels/day per user

Defer entity + flow design until Lát 5 done.

---

## Hard rules (carry over from Phase 11.2)

1. **LLM router pattern**: never hardcode provider/model; `llm.complete(task, input)`
2. **Graceful degradation**: every LLM call has fallback path
3. **TypeScript strict**: no `any`, no `as never`. Zod cho external input.
4. **VN user-facing**: comment + commit English, user-facing strings VN
5. **Test sweep before commit**: `npm run typecheck && npm run lint && npm test && npm run smoke-test && npm run build`
6. **Channel lookups**: use `matchesChannelName(c, 'general')` not `c.name === 'general'`
7. **Store mutation discipline**: never mutate entity from `store.get()`. Always `set({ ...entity, field: newValue })` or `incr()`
8. **WAL fsync**: dev `WAL_FSYNC=false` OK, prod always `true`

---

## Acceptance criteria per lát

### Lát 1 acceptance
- [ ] User entity additions present + WAL/snapshot round-trip preserves them
- [ ] CongPhap, UserCongPhap, DailyQuest entities + Store collections
- [ ] `computeCombatPower(user, equippedCongPhap)` pure function + unit tests
- [ ] `/stat [user?]` embed shows level + rank + sub_title + lực chiến + pills + contribution
- [ ] Lực chiến cache recomputes on level / rank / sub_title change
- [ ] Existing 364 unit / 180 smoke + new tests pass
- [ ] `/grant pills @user N` admin slash works

### Lát 2 acceptance
- [ ] `/inventory` shows user's owned công pháp + equip button
- [ ] Equip / unequip updates `User.equipped_cong_phap_slug` + recomputes combat_power_cache
- [ ] Currency display added to `/rank` (pills + contribution)
- [ ] Leaderboard mode: `/leaderboard mode:luc-chien` sorts by combat_power desc

### Lát 3 acceptance
- [ ] `cong-phap-catalog.json` seeded with 12-15 entries (common to legendary)
- [ ] `/shop` paginated embed, filtered by user's rank + currency
- [ ] Buy command: deducts currency atomically, inserts UserCongPhap, optional auto-equip
- [ ] Min-rank gate enforced
- [ ] All transitions are atomic (no partial state on crash)

### Lát 4 acceptance
- [ ] Daily quest cron runs at 00:00 VN
- [ ] Progress increments in real-time
- [ ] `/quest` shows current quest + progress bar
- [ ] Completion auto-grants rewards + posts to a configured channel
- [ ] Missed-day handling: stale quest cleaned at next cron tick

### Lát 5 acceptance
- [ ] 2-3 NPCs with distinct persona files + filter prompts
- [ ] `/ask-akira`, `/ask-meifeng` work end-to-end via LLM router
- [ ] Shared client.ts refactored to take Persona interface, no duplication
- [ ] Each persona keeps its own AkiCallLog (track usage per NPC)

### Lát 6 acceptance — design first
- [ ] Duel entity + flow design doc reviewed by Bill
- [ ] Then implement

---

## Migration notes

User entity additions need a migration shim — existing users in WAL/
snapshot won't have the new fields. Approach:

```ts
// In Store load path or User.get wrapper:
function ensureV12Fields(user: UserV11): User {
  return {
    ...user,
    pills: user.pills ?? 0,
    contribution_points: user.contribution_points ?? 0,
    equipped_cong_phap_slug: user.equipped_cong_phap_slug ?? null,
    combat_power_cache: user.combat_power_cache ?? null,
    last_quest_assigned_at: user.last_quest_assigned_at ?? null,
  };
}
```

Run on every `users.get()` in case the WAL was written by an older
schema. Idempotent — re-running on a v12 user is a no-op.

---

## Decision log (Phase 12)

| Date | Decision |
|---|---|
| 2026-05-14 | **Single equipped slot** — multi-slot công pháp deferred to v2. Simpler UI + simpler combat_power formula. |
| 2026-05-14 | **Pills required for /breakthrough** — defer enforcement to Lát 4 deploy so existing users have time to accumulate. Initially `/breakthrough` keeps free. |
| 2026-05-14 | **combat_power cached on User** — Map<discord_id, cp> alternative is faster but doesn't survive restart. Cache on entity + recompute helpers keep it simple. |
| 2026-05-14 | **NPCs share LLM router** — multi-NPC adds zero infra cost; just persona files + slash wrappers. |
| 2026-05-14 | **`/duel` defers to after Lát 5** — duel design is the most complex piece; should not block the rest. |
| 2026-05-14 | **Daily quest target rate** — 1 quest/day with rewards calibrated to ~3% daily XP boost. Avoids treadmill UX. |
