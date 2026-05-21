# Radiant Arena Unity — Roadmap & Task Workflow

> Single source of truth cho priority order, workflow per task, và folder structure.
> Đọc file này trước khi bắt đầu bất kỳ Lát D.U nào.

---

## 1. Project state hiện tại (verify trước khi start)

- **Working directory**: `d:\Projects\ArenaPK\` — Unity 6 project ĐÃ TỒN TẠI. KHÔNG cần Unity Hub → New Project.
- **BillGameCore**: present at `Assets/BillGameCore/`, auto-boots qua `[RuntimeInitializeOnLoadMethod]` (xem `Assets/BillGameCore/Runtime/Bootstrap/Bill.cs`).
- **`Assets/Resources/BillBootstrapConfig.asset`**: REQUIRED — framework abort boot if missing. Verify đầu D.U1.
- **NO `Bill.Init()` method** — gate gameplay bằng `Bill.IsReady` hoặc `Bill.Events.SubscribeOnce<GameReadyEvent>`. Bỏ qua `await Bill.Init()` trong `RADIANT_ARENA_UNITY.md` §3 (đã fix).
- **Unity MCP**: configured (`com.coplaydev.unity-mcp` + `.mcp.json` + `.claude/settings.local.json` `enableAllProjectMcpServers: true`). Cần Unity Editor mở + `Window > MCP for Unity > Start Server` → 🟢 Connected.
- **Docs layout**: `arena-unity/` là sibling folder của Unity project root, KHÔNG nằm trong `Assets/Docs/`.
- **`BILLGAMECORE_API.md` không tồn tại** — fallback đọc trực tiếp `Assets/BillGameCore/Runtime/Infrastructure/Interfaces.cs` + `Bootstrap/Bill.cs` để confirm signature.

---

## 2. Priority order (base → polish, execute sequentially)

| # | Lát | Goal (1-line) | Folder | Status |
|---|---|---|---|---|
| 1 | D.U1 | Bootstrap — verify BillGameCore boots, folder layout, ArenaBootstrap skeleton | `tasks/done/D.U1-bootstrap/` | ✅ |
| 2 | D.U2 | NetClient + Colyseus connect | `tasks/done/D.U2-netclient/` | ✅ |
| 3 | D.U3 | LobbyPanel + weapon pick UI | `tasks/done/D.U3-lobby-panel/` | ✅ |
| 4 | D.U4 | TurnInputPanel + drag-aim mechanic | `tasks/done/D.U4-turn-input/` | ✅ |
| 5 | D.U5 | TrajectoryRenderer playback | `tasks/done/D.U5-trajectory/` | ✅ |
| 6 | D.U6 | HudPanel + ResultPanel | `tasks/done/D.U6-hud-result/` | ✅ |
| 7 | D.U7 | Juice pass (camera shake, hit-stop, damage numbers) — D.U7a closed, D.U7b deferred (audio + color flash + anticipation pulse) | `tasks/done/D.U7-juice/` | ✅ |
| 8 | **D.U8** | **Arena scene — map + 2 player capsules + top-down orthographic camera + drag-aim origin = my-player** | `tasks/todo/D.U8-arena-scene/` | 🟡 |
| 9 | **D.U9** | **Weapon spawn factory** — `WeaponPrefabRegistry` runtime composite + `WeaponHueApplier` MPB tint. *Misnomer note:* PLAN §6.1 chose factory pattern, NO actual `.prefab` files shipped. Real prefabs land in D.U9b. | `tasks/done/D.U9-weapon-prefabs/` | ✅ |
| 9b | **D.U9b** | **Weapon + Map polish** — real `Prefabs/Weapons/*.prefab` assets (sửa misnomer D.U9), weapon position polish (lateral + aim-facing), anticipation pulse (D.U7b unblock), map polish (ground texture / wall details / lighting / decoration). | `tasks/todo/D.U9b-weapon-map-polish/` | ⬜ |
| 10 | **D.U10** | **UI fantasy polish** — calligraphic font, ink overlay, tier color coding (Phẩm/Địa/Thiên/Tiên/Bản mệnh), dramatic damage numbers | `tasks/todo/D.U10-ui-polish/` | ⬜ |
| 11 | D.U11 | HLSL shaders (10 shaders, 1/Lát, deferred) — pushed back from D.U9 | `tasks/todo/D.U11-shaders/` | ⬜ |
| 12 | **D.U12** | **WebGL build + Cloudflare Pages deploy — LAST phase (per Bill)** | `tasks/todo/D.U12-webgl-deploy/` | ⬜ |
| 13* | D.U13 | (optional) Replay viewer — was D.U11 pre-pivot | tạo khi D.U12 xong | ⬜ |
| 14* | D.U14 | (optional) PvE mode vs AI — was D.U12 pre-pivot | tạo khi D.U12 xong | ⬜ |

**Scope pivot 2026-05-18 (Bill):**
- After D.U7a juice, original D.U8 (6-weapon catalog) deferred — pivot to **visible combat first** via **D.U8 arena scene**.
- Content-first ordering: arena scene → weapon prefabs → UI fantasy polish → deep shader polish → deploy at the very end.
- WebGL deploy moved from D.U10 to D.U12 (LAST numbered Lát) so client content + polish complete before any public release.
- Optional Replay viewer + PvE mode renumbered to D.U13 / D.U14.

**D.U9 misnomer + D.U9b insert 2026-05-19 (Bill):**
- D.U9 named "weapon prefabs" but PLAN §6.1 chose runtime composite factory — **0 `.prefab` files shipped**. Bill caught misnomer post-close.
- Insert `D.U9b-weapon-map-polish` to (a) ship real `.prefab` assets and migrate Registry off switch-case, (b) refine weapon position (lateral + aim-facing) + anticipation pulse (D.U7b unblock), (c) map polish (ground texture / wall trim / lighting / decoration).
- Numbering D.U10–D.U12 unchanged to avoid renumber churn. Convention `b`-suffix per D.U7a/D.U7b precedent (= polish follow-up to base Lát).

Scope chi tiết per Lát: xem `TASKS.md`.

---

## 3. Folder structure

```
arena-unity/
├── ROADMAP.md                      # ← this file. Workflow + priority + project state
├── TASKS.md                        # Scope chi tiết per Lát (don't break subtask here)
├── SKILL.md                        # Agent persona + task folder lifecycle (§4.A)
├── README.md                       # Quickstart (legacy — assumes starting from zero)
├── RADIANT_ARENA_UNITY.md          # Implementation guide cho Unity client
├── RADIANT_ARENA_ARCHITECTURE.md   # Architecture spec
├── RADIANT_ARENA_COLYSEUS.md       # Server contract reference
└── tasks/
    ├── todo/
    │   ├── D.U1-bootstrap/         # empty until Opus enters task
    │   ├── D.U2-netclient/
    │   ├── ...
    │   └── D.U10-webgl-deploy/
    └── done/                       # populated when tasks complete (audit trail)
```

**Empty folder rule**: `tasks/todo/D.Ux-*/` folders chỉ là placeholder, KHÔNG pre-fill subtask. Opus break subtask **chỉ khi vào task đó**, không over-plan ahead.

---

## 4. Per-task workflow (5 stages)

### Stage 1 — Architect (Opus only)
1. Đọc `ROADMAP.md` (this file) + scope row của Lát trong `TASKS.md` + project state hiện tại.
2. Đọc related sections trong `RADIANT_ARENA_UNITY.md`, `RADIANT_ARENA_ARCHITECTURE.md`, `RADIANT_ARENA_COLYSEUS.md`.
3. Đọc BillGameCore source code (`Assets/BillGameCore/Runtime/`) để confirm API surface — bắt đầu từ `Infrastructure/Interfaces.cs` + `Bootstrap/Bill.cs`.
4. Verify Unity MCP availability — check `mcp__unityMCP__*` tools loaded; nếu không thì fall back manual instructions for Bill.
5. Write `tasks/todo/D.U<n>-<slug>/PLAN.md`:
   - Files sẽ touch (absolute path)
   - Public APIs sử dụng (Bill.X services, Colyseus message types, MCP tool names)
   - Architecture decisions + trade-offs
   - MCP touchpoints — tool nào dùng cho step nào
   - Smoke test plan (DoD verification path)
6. Write `tasks/todo/D.U<n>-<slug>/SUBTASKS.md`:
   - Ordered, dependency-aware
   - Mỗi subtask = 1 commit (verify-only subs = 0 commit)
   - DoD per subtask + DoD overall (match `TASKS.md` DoD line)
   - Bill checkpoints inline (e.g., confirm config values sau verify sub, fallback nếu blocker)
7. Write `tasks/todo/D.U<n>-<slug>/SONNET_PROMPTS.md` — self-contained prompts, 1 per sub, ready-to-paste:
   - Persona reference (`arena-unity/SKILL.md`)
   - Read prerequisites (specific section pointers)
   - Action scope (CHỈ sub này, không chain)
   - DoD + commit message (or "NO commit" cho verify subs)
   - **STOP condition** + MCP fallback rule
8. **STOP. Đợi Bill confirm** PLAN + SUBTASKS + SONNET_PROMPTS trước khi handoff Sonnet.

### Stage 2 — Execute (Sonnet, 1 sub per invocation)

**HARD RULE — Bill enforces**: Sonnet chỉ làm **1 subtask mỗi lần invoke**. KHÔNG chain Sub N+1 sau khi xong Sub N. Bill paste prompt tiếp theo từ `SONNET_PROMPTS.md` cho mỗi sub. Lý do: Sonnet cần task detail rõ ràng, drift xảy ra khi tự ý nối subtask. 1 commit = 1 sub = 1 invocation.

9. Bill paste prompt Sub N từ `tasks/todo/D.U<n>-<slug>/SONNET_PROMPTS.md` vào Sonnet session.
10. Sonnet đọc prompt + Read prerequisites + execute action:
    - Edit code (Edit/Write/`mcp__unityMCP__manage_script`)
    - Trigger compile via `mcp__unityMCP__refresh_unity` nếu cần
    - Verify `mcp__unityMCP__read_console` clean
    - Commit format: `feat(arena-unity/Lát-D.U<n>): <verb> <object>` (verify-only sub: skip commit)
11. Sonnet **STOP** sau commit (or sau report nếu verify sub). KHÔNG tự ý qua Sub N+1.
12. Bill review, paste Sub N+1 prompt khi sẵn sàng.
13. Scene/asset/UI/prefab ops: ưu tiên `mcp__unityMCP__manage_scene` / `manage_gameobject` / `manage_asset` / `manage_prefabs` / `manage_material` / `manage_components` thay vì manual Editor click.
14. **MCP unavailable**: Sonnet báo "MCP not available, need Bill to: (a) start Unity, (b) start MCP server". KHÔNG silent fall back hết qua filesystem.

### Stage 3 — Verify
11. Run DoD smoke: `mcp__unityMCP__manage_editor` enter Play → `read_console` check expected logs + zero errors → exit Play.
12. Run Test Runner nếu task có test: `mcp__unityMCP__run_tests` EditMode + PlayMode.
13. Double-test smoke (gameplay-touching Láts D.U2+): ParrelSync 2 Editor instances HOẶC Editor + WebGL preview build.

### Stage 4 — Report (Opus)
14. Write `tasks/todo/D.U<n>-<slug>/REPORT.md`:
    - **Shipped**: file list + commit hashes/messages
    - **Shifted**: deviation from PLAN, lý do
    - **Left**: known issues, follow-up items
    - **Doc updates**: links đến doc đã update (e.g., `RADIANT_ARENA_UNITY.md` §X.Y)

### Stage 5 — Move
15. Move folder `tasks/todo/D.U<n>-<slug>/` → `tasks/done/D.U<n>-<slug>/`.
16. Commit: `chore(arena-unity/Lát-D.U<n>): mark complete, move to done`.
17. Start next Lát per priority order (Stage 1 again).

---

## 5. MCP touchpoints per Lát

Tool prefix `mcp__unityMCP__` omitted in table.

| Lát | Primary MCP tools | Purpose |
|---|---|---|
| D.U1 | `manage_asset`, `manage_scene`, `read_console`, `manage_editor`, `refresh_unity`, `manage_packages` | Verify `BillBootstrapConfig.asset`, install Colyseus/Cinemachine/ParrelSync packages, create `Bootstrap.unity`/`Arena.unity`/`DevDebug.unity`, smoke Play check `[Bill] Ready.` log |
| D.U2 | `manage_script`, `read_console`, `manage_gameobject`, `manage_components` | Write Net layer (NetClient, schemas, ArenaContext, UrlParser), wire NetClient GameObject vào scene, verify compile |
| D.U3 | `manage_asset` (UXML/USS), `manage_gameobject` (UIDocument), `read_console` | UI Toolkit panel setup — Bill explicit asked agent to handle UI via MCP (manual UI Toolkit click is painful) |
| D.U4 | `manage_gameobject` (LineRenderer), `manage_editor` (Play test), `read_console`, `manage_components` | Input wiring, drag-aim aim line, smoke test |
| D.U5 | `manage_asset` (FX prefabs), `manage_gameobject` (TrajectoryPlayer), `manage_prefabs` | Trajectory playback + impact FX prefabs registered to Bill.Pool |
| D.U6 | `manage_asset` (UXML/USS), `manage_gameobject` | HUD (HP bars + turn timer) + Result (win/lose) panels |
| D.U7 | `manage_asset` (VFX/Audio), `manage_camera`, `manage_components` (CinemachineImpulseSource), `manage_vfx` | Camera shake, hit-stop, damage number FX, audio layering |
| D.U8 | `manage_asset`, `manage_prefabs`, `manage_material` | 6 weapon prefabs + hue applier + WeaponDatabase ScriptableObject |
| D.U9 | `manage_shader`, `manage_material` | HLSL shaders (1/Lát) — verify trong URP Sample Scene |
| D.U10 | `manage_build`, `manage_editor` (switch platform) | WebGL build pipeline + OG meta tag injection |

**Resources khác**:
- `mcpforunity://instances` — list active Unity sessions when multiple connected
- `editor_state` resource — poll `isCompiling` field for domain reload completion
- `set_active_instance` — pin routing nếu nhiều Unity instance (ParrelSync clone scenario in D.U2+)

**Fallback policy**: nếu MCP unavailable (Unity Editor closed, MCP server not started) — fall back đến Edit/Write tools cho C# scripts + xin Bill click Editor cho scene/asset ops. Đừng silent fail; báo "MCP not available, need Bill to do X".

**Reference**: see `SKILL.md` §2.7 + §4.A cho full operational guidance.

---

## 6. Conventions

- **One Lát = one folder.** Format: `D.U<n>-<short-slug>` (e.g., `D.U1-bootstrap`).
- **Opus = architect.** Subtask breakdown, PLAN, REPORT.
- **Sonnet = executor.** Subtask implementation per breakdown.
- **`done/` folders are immutable audit trail.** Don't delete after move.
- **No "TODO" comments** for scope creep — track in REPORT.md "what's left".
- **Commit per subtask**, not per Lát.
- **MCP-first.** Manual Editor clicking là last resort + explicit flag tới Bill.
- **All Vietnamese inline OK** — Bill bilingual VN+EN, terse, treats agent as peer.

---

## 7. Quick start cho session mới

1. Open Claude Code CLI ở `d:\Projects\ArenaPK\`.
2. Reference `arena-unity/SKILL.md` (persona) — paste hoặc let agent đọc.
3. Đọc `arena-unity/ROADMAP.md` (this file — workflow).
4. Identify next Lát = lowest-numbered folder remaining in `tasks/todo/`.
5. Switch model to **Opus** → run Stage 1 (Architect: write PLAN.md + SUBTASKS.md).
6. **STOP for Bill confirm.**
7. After confirm: switch to **Sonnet** → run Stage 2-3 (Execute + Verify).
8. Switch back to **Opus** for Stage 4 (Report).
9. Stage 5 (Move) can be Sonnet.

---

*Document version: v0.1 — initialize task workflow infrastructure. 2026-05-15.*
