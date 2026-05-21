# Handoff — 2026-05-18 (chiều / tối tại cty)

> Cập nhật sau morning handoff (`HANDOFF-2026-05-18.md`, D.U3b verify).
> Buổi tối ship D.U7 juice + D.U8 arena scene + roadmap restructure
> + Phase 13 catalog expansion (radiant-bot side).

---

## TL;DR

| Lát | Status | Repo |
|---|---|---|
| **D.U7 juice (D.U7a)** | ✅ closed (mock smoke pass) | ArenaPK (`duel-radiant-arena`) |
| **D.U8 arena scene** | ✅ closed (mock smoke + Bill visual sign-off) | ArenaPK |
| **D.U9 weapon prefab catalog** | 🟡 Stage 1 docs only — execute defer pending D.7 server | ArenaPK |
| **Roadmap restructure** | ✅ deploy moved to D.U12 LAST | ArenaPK |
| **Bot catalog expansion (Phase 13 Lát A → B → C)** | ✅ all shipped | radiant-bot |

---

## ArenaPK (Unity client) — Commits chiều/tối nay

```
62cb881 docs(arena-unity/Lát-D.U9): Stage 1 architect — PLAN + SUBTASKS + OPUS_PROMPTS
084a066 chore(arena-unity/Lát-D.U8): mark complete, move to done — REPORT.md added
cfe639b feat(arena-unity/Lát-D.U8): add ArenaBuildSettingsFixer editor menu — set Bootstrap.unity as Scene 0
337ced4 feat(arena-unity/Lát-D.U8): MyTurnState passes MyVisual.transform as ArenaAimController origin
4a05ca3 feat(arena-unity/Lát-D.U8): spawn ArenaSceneBuilder from ArenaBootstrap.InitArena
2e95333 feat(arena-unity/Lát-D.U8): add ArenaSceneBuilder + PlayerVisual — top-down ortho camera + ground/walls/capsules
6d0c280 docs(arena-unity): restructure phase order — deploy moved to D.U12 LAST
60b1c43 docs(arena-unity/Lát-D.U8): Stage 1 architect — PLAN + SUBTASKS + OPUS_PROMPTS
cc77dac fix(arena-unity/juice): CameraShaker top-down ortho — X/Z plane + sinusoidal oscillation
09edada chore(arena-unity/Lát-D.U7): mark complete, move to done — REPORT.md added
fb84c5a fix(arena-unity/Lát-D.U7): guard JuicePresenter.OnDestroy with Bill.IsReady
fe3dd80 feat(arena-unity/Lát-D.U7): wire JuicePresenter + DamageNumberLayer lifecycle
f48470a feat(arena-unity/Lát-D.U7): add JuicePresenter — central PlayerHit/WallBounce dispatcher
86495ae feat(arena-unity/Lát-D.U7): add DamageNumberLayer — runtime Label pop/drift/fade tween
77e8d7d feat(arena-unity/Lát-D.U7): add HitStop — Time.timeScale toggle with reentry-safe unscaled restore
8de7b56 feat(arena-unity/Lát-D.U7): add CameraShaker — hand-rolled position jitter via BillTween envelope
5719f92 docs(arena-unity/Lát-D.U7): Stage 1 architect — PLAN + SUBTASKS + OPUS_PROMPTS
```

### Files shipped (Unity)
- `Assets/RadiantArena/Scripts/Juice/CameraShaker.cs` — top-down X/Z punch oscillation (post-fix `cc77dac`).
- `Assets/RadiantArena/Scripts/Juice/HitStop.cs` — `Time.timeScale=0.05` with reentry-safe Max-deadline unscaled restore.
- `Assets/RadiantArena/Scripts/Juice/JuicePresenter.cs` — singleton DDOL; dispatches `PlayerHitEvent` + `WallBounceEvent` to subsystems.
- `Assets/RadiantArena/UI/DamageNumberLayer.cs` + UXML + USS — runtime Label spawn, 3-phase pop→settle→drift+fade BillTween.
- `Assets/RadiantArena/Scripts/Arena/ArenaSceneBuilder.cs` — top-down ortho camera config + ground Plane + 4 wall Cubes + 2 player Capsules (runtime spawn, no scene-file diff).
- `Assets/RadiantArena/Scripts/Arena/PlayerVisual.cs` — polls `ArenaContext.MyPlayer.X/Y` every 100ms, fallback to SlotAnchor when server uninitialized.
- `Assets/RadiantArena/Editor/ArenaBuildSettingsFixer.cs` — menu `Tools > RadiantArena > Set Bootstrap as Scene 0`.

### Roadmap (post Bill's "deploy LAST" reorder)

| # | Lát | Folder | Status |
|---|---|---|---|
| 1-7 | D.U1 – D.U7 | `done/` | ✅ |
| 8 | D.U8 — Arena scene | `done/` | ✅ |
| 9 | **D.U9 — Weapon prefab catalog** | `todo/D.U9-weapon-prefabs/` | 🟡 Stage 1 docs ready |
| 10 | D.U10 — UI fantasy polish | `todo/D.U10-ui-polish/` | ⬜ |
| 11 | D.U11 — HLSL shaders | `todo/D.U11-shaders/` | ⬜ |
| 12 | D.U12 — WebGL deploy LAST | `todo/D.U12-webgl-deploy/` | ⬜ |
| 13* | D.U13 — Replay viewer (optional) | not yet created | ⬜ |
| 14* | D.U14 — PvE mode (optional) | not yet created | ⬜ |

---

## radiant-bot — Commits chiều/tối nay

```
cf855e5 feat(arena/catalog): /arena catalog browse + shared skill-descriptions module
81d3e94 feat(arena/inspect): show bản mệnh skill ('mạch') in inspect embed
7733063 feat(arena/forge): backfill custom_skills on existing bản mệnh rows
a1466c2 feat(arena/catalog): expand to 12 weapons + 18-skill pool + bản mệnh skill roll
```

### Phase 13 sub-Lát map (post-handoff)

| Lát | Status | What |
|---|---|---|
| Lát A — Bản mệnh forge | ✅ pre-existing | `forgeBanMenh` deterministic hash → stats + visual |
| Lát A.1 — Catalog expansion 6→12 | ✅ today (`a1466c2`) | 12 weapons fill 4-tier × 3-cat matrix + 18 skill IDs + 5 bản mệnh skills + lore rewrite |
| Lát B — Skill UI follow-ups | ✅ today (`7733063` + `81d3e94`) | `forgeBanMenh` backfills `custom_skills` on old rows + `/arena inspect` shows mạch |
| Lát C — Catalog browse | ✅ today (`cf855e5`) | `/arena catalog` paginated Buttons + shared `skill-descriptions.ts` (23 entries) |

### Plan doc
`radiant-bot/docs/PHASE_13_LAT_B.md` — short plan for Lát B (now shipped).

### Files shipped (bot)
- `src/config/weapon-catalog.json` — 12 weapons + atmospheric lore.
- `src/db/types.ts` — `UserWeapon.custom_skills: WeaponSkillRef[] | null`.
- `src/modules/arena/forge.ts` — `pickBanMenhSkill(hash) → WeaponSkillRef`. `previewBanMenh` returns `{ stats, visual, skill }`. Backfill in existing-row branch.
- `src/modules/arena/client.ts` — `weaponToRoomWeapon` propagates `skills[]` to Colyseus.
- `src/modules/arena/skill-descriptions.ts` 🆕 — 23-entry shared lookup `{ name, short, icon }`.
- `src/commands/arena.ts` — `/arena catalog` subcommand, paginated Buttons, 5-min collector.

---

## Pending — không vào hôm nay, có plan cho session sau

### Theo Bill order rule sau bot catalog: `3 → 2 → 1`
- ✅ **Option 3** (`/arena catalog` browse) — DONE today
- ⏭️ **Option 2** (arena-server `skills.ts` engine — Lát D.7) — NEXT
- ⏭️ **Option 1** (Unity D.U9 execute — weapon prefab placeholders) — AFTER D.7

### arena-server Lát D.7 — Skills execution engine (next big work)
**Goal:** server-side `src/weapons/skills.ts` consumes the 18+5 = 23 skill_ids → wires actual gameplay effects into `simulateShot()` resolution flow.

**Blocker:** arena-server Lát D.5 physics (`simulateShot`) chưa ship — currently broadcasts empty trajectory. Without D.5, D.7 skill effects don't have a shot-resolution flow to hook into.

**Options on shipping:**
- (a) Combined: D.5 + D.7 as one big arena-server Lát (heavy, ~10 subs)
- (b) Sequential: D.5 first (physics base, baseline trajectory math), D.7 after (skill effects on top)

Bill chưa chốt — chờ next session.

### D.U9 Unity execute
Stage 1 docs ready ở `arena-unity/tasks/todo/D.U9-weapon-prefabs/` (PLAN+SUBTASKS+OPUS_PROMPTS).

Scope: `WeaponPrefabRegistry` (6 composite primitive shapes, mapped from 12 catalog slugs via shared `model_prefab_key`) + `WeaponHueApplier` (MaterialPropertyBlock hex tint) + extend `PlayerVisual` to spawn weapon on `LockedWeapon.Slug` change.

**Note:** D.U9 Unity work là client-side placeholder — không block bởi server D.7. Có thể ship trước D.7 nếu Bill muốn visual progress.

### D.U7b deferred items (juice polish)
- Anticipation pulse (weapon scale 1.0→1.15 trước release) — unblocked sau D.U9 weapon prefabs.
- Layered hit/crit audio — cần SFX pack.
- Color flash on crit (chromatic + vignette) — cần URP Volume profile asset.

---

## Untracked / messy state in Unity repo

Items đang untracked nhưng chưa cleanup này session:

- `Assets/Plugins/ParrelSync/` + meta — D.U1 install, never committed. Tốn 1 review pass — nên track hay add to `.gitignore`. Recommend: track (ParrelSync workflow requires consistent install across clones).
- `Packages/packages-lock.json` (modified), `ProjectSettings/Packages/com.unity.probuilder/Settings.json` (modified), `ProjectSettings/VFXManager.asset` (modified) — Unity import-time drift, không phải session work. Có thể commit "chore: Unity import-time settings drift" hoặc revert.
- `Assets/RadiantArena/Editor/ArenaDevMenu.cs.meta` — Bill mentioned ArenaDevMenu sớm hơn nhưng .cs có khả năng tracked, chỉ .meta untracked (orphan).

Đề nghị làm clean trong session sau hoặc lúc rảnh — không gấp.

---

## Memory updates ghi session này

3 memory entries đã save vào `C:\Users\ADMIN\.claude\projects\d--Projects-ArenaPK\memory\`:
- [bill-ondestroy-guard](file://...) — DDOL MonoBehaviours touching Bill services trong OnDestroy phải guard `if (Bill.IsReady)`.
- [arena-states-register-idempotent](file://...) — gọi `ArenaStates.Register()` explicit trong execute_code prologue.
- [mcp-execute-code-codedom](file://...) — Roslyn nukes Bill services; pass `compiler: codedom` cho Bill mock smoke.

---

## Tonight verifiable tests (post-pull)

### ArenaPK / Unity
1. Open Bootstrap.unity → Play → top-down 10×10 arena visible với 2 capsules (green me + orange opp).
2. Drag-aim từ green capsule, release → projectile bay theo aim direction, bounce wall, damping decay over time (mock shot pipeline via execute_code recipe).
3. Cycle camera shake / hit-stop / damage numbers trên `PlayerHitEvent` (auto-fire via mock).
4. `Tools > RadiantArena > Set Bootstrap as Scene 0` — runs editor menu fixer.

### radiant-bot
1. `npm run dev` → bot online.
2. `/arena forge` lần đầu — forge bản mệnh với `custom_skills` field populated.
3. `/arena forge` lần 2 trên cùng user — backfill nếu missing (chỉ kicks in cho rows pre-`a1466c2`).
4. `/arena inspect <user>` — embed shows "🩸 Mạch bản mệnh" field với icon+name+short.
5. `/arena catalog` — paginated browse 12 weapons với ⬅/➡ buttons. Mỗi page: stats + skill list + lore + shop unlock realm.

---

## Next session — what to action first

Bill có 3 choices ngay đầu session:

1. **arena-server Lát D.7** — physics + skills engine (heavy, ~10 subs). Plan + execute split D.5 / D.7 first.
2. **Unity D.U9 execute** — weapon prefab placeholder (light, 5 subs). Stage 1 docs already ready.
3. **Cleanup untracked items** — ProjectSettings drift + ParrelSync + ArenaDevMenu.meta orphan.

Recommend **(2) trước** — quick win, Bill thấy visual progress (capsules có weapon attachment). **(1)** parking lot until physics direction confirmed.
