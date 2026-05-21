# D.U1 — Bootstrap · opus_PROMPTS

> Self-contained prompts cho Bill paste sequential vào opus session. **1 sub per invocation.** opus làm xong sub → STOP → Bill paste sub tiếp.
> Source detail: `SUBTASKS.md`. Architecture: `PLAN.md`.

---

## Sub 1 — Verify project baseline (read-only, NO commit)

```
Bạn là senior Unity 6 client dev theo persona `arena-unity/SKILL.md`. Đọc SKILL.md adopt persona + coding principles + MCP §2.7 trước khi action.

Đang execute Lát D.U1 (Bootstrap) Stage 2 theo `arena-unity/ROADMAP.md`. Stage 1 done, Bill đã confirm PLAN+SUBTASKS.

## Read first
- `arena-unity/tasks/todo/D.U1-bootstrap/PLAN.md` §2 (verified state) + §5 (BillBootstrapConfig values Bill confirmed)
- `arena-unity/tasks/todo/D.U1-bootstrap/SUBTASKS.md` Sub 1

## Nhiệm vụ: CHỈ Sub 1 (read-only)
- MCP `manage_packages` list → confirm Cinemachine/URP/Input System present, Colyseus/ParrelSync missing
- MCP `manage_asset` list `Assets/Resources/` → confirm `BillBootstrapConfig.asset` không tồn tại
- MCP `manage_editor` getPlatform → record current target
- Read `Assets/BillGameCore/Runtime/Bootstrap/BillBootstrapConfig.cs` → extract actual field schema

## Output report cho Bill
- BillBootstrapConfig.cs actual field list (compare với PLAN §5 tentative — match? differ? required fields nào?)
- Baseline: packages list summary, Resources state, current platform
- Blocker/surprise nào? Flag

## STOP
KHÔNG commit, KHÔNG modify file, KHÔNG proceed Sub 2.
MCP unavailable → báo "MCP not available, need Bill to start Unity + MCP server", KHÔNG silent fallback.
```

---

## Sub 2 — Switch platform to WebGL + PlayerSettings

```
Persona: `arena-unity/SKILL.md`. Lát D.U1 Stage 2 Sub 2. Sub 1 đã verify baseline, Bill confirmed proceed.

## Read first
- `arena-unity/tasks/todo/D.U1-bootstrap/SUBTASKS.md` Sub 2

## Nhiệm vụ: CHỈ Sub 2
- MCP `manage_editor` switchPlatform → WebGL
- Poll `editor_state.isCompiling` → false (đợi domain reload xong)
- PlayerSettings (qua MCP `manage_editor` setPlayerSettings hoặc edit `ProjectSettings/ProjectSettings.asset`):
  - Scripting Backend → IL2CPP
  - Api Compatibility Level → .NET Standard 2.1
  - Default Screen Width = 1280, Height = 720
- MCP `read_console` filter Error → MUST be empty

## DoD
Build target = WebGL, console clean, no compile errors.

## Commit
`chore(arena-unity/Lát-D.U1): switch build target to WebGL + player settings`

## STOP sau commit. KHÔNG proceed Sub 3. Đợi Bill paste Sub 3 prompt.
MCP unavailable → báo Bill, KHÔNG silent.
```

---

## Sub 3 — Install Colyseus SDK + ParrelSync packages

```
Persona: `arena-unity/SKILL.md`. Lát D.U1 Stage 2 Sub 3.

## Read first
- `arena-unity/tasks/todo/D.U1-bootstrap/SUBTASKS.md` Sub 3
- `arena-unity/server-extract-2026-05-15.md` §A (Colyseus version requirements — 0.15.x match schema v2)

## Nhiệm vụ: CHỈ Sub 3
- Edit `Packages/manifest.json` add (sort alphabetically among existing entries):
  - `"io.colyseus.colyseus-unity-sdk": "https://github.com/colyseus/colyseus-unity-sdk.git?path=Assets/Colyseus"`
  - `"com.veriorpies.parrelsync": "https://github.com/VeriorPies/ParrelSync.git?path=/ParrelSync"`
- MCP `refresh_unity` trigger package resolve
- Poll `editor_state.isCompiling` until false
- MCP `read_console` verify package import zero errors
- Spot-check: confirm `Library/PackageCache/io.colyseus.colyseus-unity-sdk@...` hoặc `Assets/Colyseus/` exists

## DoD
2 packages resolved, console clean, no missing assembly errors.

## Commit
`chore(arena-unity/Lát-D.U1): add Colyseus SDK + ParrelSync packages`

## Bill checkpoint
Nếu Colyseus/ParrelSync git URL resolve FAIL → STOP, báo Bill exact error, đề xuất fallback (local clone hoặc alternative URL). KHÔNG tự ý thử URL khác.

## STOP sau commit (or sau khi báo failure). KHÔNG proceed Sub 4.
```

---

## Sub 4 — Create BillBootstrapConfig.asset

```
Persona: `arena-unity/SKILL.md`. Lát D.U1 Stage 2 Sub 4.

## Read first
- `arena-unity/tasks/todo/D.U1-bootstrap/PLAN.md` §5 (BillBootstrapConfig field values — Bill confirmed)
- `arena-unity/tasks/todo/D.U1-bootstrap/SUBTASKS.md` Sub 4
- Sub 1 output (actual schema từ BillBootstrapConfig.cs)

## Nhiệm vụ: CHỈ Sub 4
- Nếu Sub 1 phát hiện schema khác PLAN §5 → STOP báo Bill confirm adjusted values TRƯỚC khi create asset.
- MCP `manage_asset` createScriptableObject:
  - Path: `Assets/Resources/BillBootstrapConfig.asset`
  - Type: `BillGameCore.BillBootstrapConfig`
- Set field values per PLAN §5 (Bill-confirmed):
  - `targetFrameRate = 60`
  - `vSyncCount = 0`
  - `enforceBootstrapScene = true`
  - `defaultGameScene = ""`
  - `enableTracing = false`
  - `includeDebugOverlay = true`
  - `includeCheatConsole = true`
  - `returnToEditSceneInEditor = true`
- Save asset
- MCP `read_console` verify zero errors

## DoD
Asset exists at path, fields populated correctly.

## Commit
`feat(arena-unity/Lát-D.U1): add BillBootstrapConfig resource`

## STOP sau commit. KHÔNG proceed Sub 5.
```

---

## Sub 5 — Create RadiantArena folder layout

```
Persona: `arena-unity/SKILL.md`. Lát D.U1 Stage 2 Sub 5.

## Read first
- `arena-unity/tasks/todo/D.U1-bootstrap/SUBTASKS.md` Sub 5

## Nhiệm vụ: CHỈ Sub 5
MCP `manage_asset` createFolder cho 8 path (Unity auto-create .meta):
- `Assets/RadiantArena/`
- `Assets/RadiantArena/Scenes/`
- `Assets/RadiantArena/Scripts/`
- `Assets/RadiantArena/Scripts/Bootstrap/`
- `Assets/RadiantArena/Scripts/Net/`
- `Assets/RadiantArena/Scripts/States/`
- `Assets/RadiantArena/Scripts/Events/`
- `Assets/RadiantArena/Scripts/UI/`

Verify list listing — confirm 8 folder + 8 .meta files created.

## DoD
All 8 folders exist with .meta sidecars.

## Commit
`feat(arena-unity/Lát-D.U1): scaffold Assets/RadiantArena folder layout`

## STOP sau commit. KHÔNG proceed Sub 6.
```

---

## Sub 6 — Write ArenaEvents.cs placeholder

```
Persona: `arena-unity/SKILL.md`. Lát D.U1 Stage 2 Sub 6.

## Read first
- `arena-unity/tasks/todo/D.U1-bootstrap/SUBTASKS.md` Sub 6

## Nhiệm vụ: CHỈ Sub 6
Tạo file `Assets/RadiantArena/Scripts/Events/ArenaEvents.cs` với content exact:

#nullable enable
using BillGameCore;

namespace RadiantArena.Events {
    // Placeholder. Real events added per Lát:
    //   D.U2 — NetConnectedEvent, PhaseChangedEvent, NetErrorEvent
    //   D.U5 — ShotResolvedEvent, PlayerHitEvent, WallBounceEvent
    //   D.U6 — MatchEndedEvent
    public struct ArenaBootstrapReadyEvent : IEvent { }
}

(Lưu ý: paste content trong file phải có dấu `///` được encode đúng — copy từ SUBTASKS.md Sub 6 code block để chính xác.)

- MCP `refresh_unity` + `read_console` zero compile errors.

## DoD
File compiles, `ArenaBootstrapReadyEvent` struct defined trong namespace `RadiantArena.Events`.

## Commit
`feat(arena-unity/Lát-D.U1): scaffold ArenaEvents.cs placeholder`

## STOP sau commit. KHÔNG proceed Sub 7.
```

---

## Sub 7 — Write ArenaBootstrap.cs

```
Persona: `arena-unity/SKILL.md`. Lát D.U1 Stage 2 Sub 7.

## Read first
- `arena-unity/tasks/todo/D.U1-bootstrap/SUBTASKS.md` Sub 7 (full code block — copy exactly)
- `arena-unity/tasks/todo/D.U1-bootstrap/PLAN.md` §4 (APIs used) + §5 (architecture decisions)
- `Assets/BillGameCore/Runtime/Bootstrap/Bill.cs` §11-30 (Bill.IsReady + Bill.Events surface)

## Nhiệm vụ: CHỈ Sub 7
Tạo file `Assets/RadiantArena/Scripts/Bootstrap/ArenaBootstrap.cs` theo code block trong SUBTASKS.md Sub 7. Namespace `RadiantArena.Bootstrap`. Pattern:
- `void Start()` → if Bill.IsReady → InitArena() else SubscribeOnce<GameReadyEvent>
- InitArena() logs `[Arena] bootstrap ready (Bill.IsReady=True)` + fires ArenaBootstrapReadyEvent
- `#nullable enable` ON

KHÔNG add Arena state registration / pool registration / WeaponDatabase init — defer D.U2+ (per PLAN §5).

- MCP `refresh_unity` + `read_console` zero compile errors.

## DoD
Script compiles, gate pattern correct, namespace `RadiantArena.Bootstrap`.

## Commit
`feat(arena-unity/Lát-D.U1): add ArenaBootstrap MonoBehaviour with GameReadyEvent gate`

## STOP sau commit. KHÔNG proceed Sub 8.
```

---

## Sub 8 — Create Bootstrap.unity scene

```
Persona: `arena-unity/SKILL.md`. Lát D.U1 Stage 2 Sub 8.

## Read first
- `arena-unity/tasks/todo/D.U1-bootstrap/SUBTASKS.md` Sub 8
- `arena-unity/tasks/todo/D.U1-bootstrap/PLAN.md` §5 ("Bootstrap.unity scene minimal")

## Nhiệm vụ: CHỈ Sub 8
- MCP `manage_scene` create `Assets/RadiantArena/Scenes/Bootstrap.unity`
- Inside scene via MCP `manage_gameobject`:
  - Create empty GameObject `[ArenaBootstrap]` position (0,0,0)
  - Add component `RadiantArena.Bootstrap.ArenaBootstrap`
  - Ensure Main Camera (default URP) exists; tạo nếu thiếu
  - Ensure Directional Light exists at rotation (50, -30, 0); tạo nếu thiếu
- Save scene
- Set Bootstrap.unity là build index 0:
  - MCP `manage_editor` setSceneInBuildSettings (nếu support)
  - Hoặc edit `ProjectSettings/EditorBuildSettings.asset`
  - Hoặc nếu cả 2 fail → STOP báo Bill manual fallback (File → Build Settings → Add Open Scenes)
- MCP `read_console` zero errors

## DoD
- `Assets/RadiantArena/Scenes/Bootstrap.unity` exists
- Contains `[ArenaBootstrap]` GO with ArenaBootstrap component + Main Camera + Directional Light
- Build settings: Bootstrap.unity at index 0

## Commit
`feat(arena-unity/Lát-D.U1): add Bootstrap.unity scene as build index 0`

## STOP sau commit. KHÔNG proceed Sub 9.
```

---

## Sub 9 — Smoke verify (NO commit, output cho REPORT)

```
Persona: `arena-unity/SKILL.md`. Lát D.U1 Stage 2 Sub 9 — last sub.

## Read first
- `arena-unity/tasks/todo/D.U1-bootstrap/PLAN.md` §7 (smoke test plan)
- `arena-unity/tasks/todo/D.U1-bootstrap/SUBTASKS.md` Sub 9

## Nhiệm vụ: CHỈ Sub 9 (verify, NO commit)
- Confirm Bootstrap.unity là active scene. MCP `manage_scene` load nếu cần.
- MCP `manage_editor` enterPlay.
- Poll `editor_state.isCompiling` until false.
- MCP `read_console` filter `Error` level → MUST be empty. Nếu có error → STOP, document, KHÔNG tự ý fix (Opus sẽ triage trong REPORT).
- MCP `read_console` filter `Log` level → confirm presence of:
  - `[Bill] + Infrastructure (...ms)`
  - `[Bill] + Core Services (...ms)`
  - `[Bill] + State Machine (...ms)`
  - `[Bill] + Network (...ms)`
  - `[Bill] + Dev Tools (...ms)` (Editor only)
  - `[Bill] Ready. N services in Xms.`
  - `[Arena] bootstrap ready (Bill.IsReady=True)`
- Capture full log snippet cho Bill (paste vào output).
- MCP `manage_editor` exitPlay.

## Output report cho Bill
- Pass/Fail status per expected log line
- Full log snippet (raw)
- Error list nếu có (zero expected)
- Timing breakdown (`[Bill] Ready. N services in Xms.` — what's N, X?)

## STOP
KHÔNG commit. Đợi Opus session viết REPORT.md → Move qua `tasks/done/D.U1-bootstrap/`.
```

---

## Bill checkpoints recap

| After | Bill action |
|---|---|
| Sub 1 | Confirm BillBootstrapConfig schema match (or adjusted values) trước Sub 4 |
| Sub 3 | Confirm fallback nếu package URL fail |
| Sub 8 | Confirm Bootstrap scene loaded properly trước Sub 9 smoke |
| Sub 9 | Review log output, switch Opus session for REPORT + Move |

## Notes
- Mỗi prompt self-contained — opus session reset OK, full context từ Read prereqs.
- Pre-commit hook fail → fix root, NEW commit (KHÔNG `--amend` per Bash guidance).
- MCP unavailable mọi sub → báo Bill, KHÔNG silent manual fallback.
