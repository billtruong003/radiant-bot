# D.U1 — Bootstrap · PLAN

> Stage 1 (Architect) output. Bill confirm trước khi Sonnet execute Stage 2.
> Date: 2026-05-15

## 1. Goal
Verify BillGameCore boot trong existing Unity project, scaffold `Assets/RadiantArena/` folder layout, write `ArenaBootstrap.cs` skeleton gated on `GameReadyEvent`. Install packages Colyseus + ParrelSync một lần (sẽ dùng từ D.U2) để tránh package churn giữa các Lát.

## 2. Project state (verified read-only, 2026-05-15)
- ✅ Unity project `d:\Projects\ArenaPK\`. BillGameCore present (`Assets/BillGameCore/`).
- ❌ **`Assets/Resources/BillBootstrapConfig.asset` MISSING** — framework abort boot khi thiếu. Top priority.
- ❌ `Assets/RadiantArena/` chưa tồn tại.
- ✅ Packages có sẵn (`Packages/manifest.json`): Cinemachine 3.1.6, URP 17.3.0, Input System 1.16.0, UI Toolkit (built-in modules), Test Framework, VFX Graph, Unity MCP.
- ❌ Packages missing: **Colyseus Unity SDK**, **ParrelSync**. ShaderGraph verify-then-skip (URP 17.x thường pull tự động).
- Platform hiện tại unknown — sẽ check qua MCP rồi switch WebGL.

## 3. Files sẽ touch

| Path | Action |
|---|---|
| `Packages/manifest.json` | EDIT — add Colyseus SDK + ParrelSync |
| `Assets/Resources/BillBootstrapConfig.asset` | CREATE — ScriptableObject của type `BillGameCore.BillBootstrapConfig` |
| `Assets/RadiantArena/Scenes/` | CREATE folder |
| `Assets/RadiantArena/Scripts/Bootstrap/` | CREATE folder |
| `Assets/RadiantArena/Scripts/Net/` | CREATE folder (empty, D.U2 sẽ fill) |
| `Assets/RadiantArena/Scripts/States/` | CREATE folder (empty, D.U2+ fill) |
| `Assets/RadiantArena/Scripts/Events/` | CREATE folder |
| `Assets/RadiantArena/Scripts/UI/` | CREATE folder (empty, D.U3+ fill) |
| `Assets/RadiantArena/Scripts/Events/ArenaEvents.cs` | CREATE — placeholder `ArenaBootstrapReadyEvent` struct |
| `Assets/RadiantArena/Scripts/Bootstrap/ArenaBootstrap.cs` | CREATE — MonoBehaviour gate trên `Bill.IsReady`/`GameReadyEvent` |
| `Assets/RadiantArena/Scenes/Bootstrap.unity` | CREATE — `[ArenaBootstrap]` GameObject + Main Camera + Directional Light |
| `ProjectSettings/EditorBuildSettings.asset` | UPDATE — set Bootstrap.unity là scene index 0 |
| `ProjectSettings/ProjectSettings.asset` | UPDATE — switch platform WebGL, .NET Standard 2.1, resolution 1280×720 |

## 4. APIs sử dụng (Bill.X surface)

| API | Source | Use trong D.U1 |
|---|---|---|
| `Bill.IsReady` | `Assets/BillGameCore/Runtime/Bootstrap/Bill.cs:30` | Gate sync check trong `ArenaBootstrap.Start()` |
| `Bill.Events.SubscribeOnce<GameReadyEvent>(handler)` | `Infrastructure/Interfaces.cs:15` | Fallback gate nếu `Start()` chạy trước `Phase2()` complete |
| `GameReadyEvent` | fired tại `Bill.cs:162` after `MarkInitialized()` | Listen for ready signal |
| `Bill.Events.Fire<T>()` | `Interfaces.cs:18` | Fire `ArenaBootstrapReadyEvent` sau khi gate pass |
| `BillBootstrapConfig` | `Bootstrap/BillBootstrapConfig.cs` | ScriptableObject type cho `Resources/BillBootstrapConfig.asset` |

**KHÔNG dùng trong D.U1**: `Bill.State`, `Bill.Pool`, `Bill.UI`, `Bill.Audio`, `Bill.Tween`, `Bill.Timer`, `Bill.Net`, `Bill.Config`, `Bill.Save` — defer cho D.U2+.

## 5. Architecture decisions

### Defer cho Lát sau (KHÔNG làm trong D.U1)
- ❌ Register Arena states (`ConnectingState`/`LobbyState`/...) — types chưa tồn tại, defer D.U2+.
- ❌ Register pools — không có prefabs nào, defer D.U5/D.U8.
- ❌ Init `ArenaContext` / `WeaponDatabase` / `WeaponPrefabRegistry` — types chưa tồn tại, defer D.U2/D.U8.
- ❌ Tạo `Arena.unity` / `DevDebug.unity` scenes — defer D.U2.
- ❌ Tạo subfolder `Materials/`, `Shaders/`, `Prefabs/*`, `Settings/`, `UI/`(UXML), `ScriptableObjects/` — lazy theo nhu cầu.

### Pre-install (làm sớm để tránh churn)
- ✅ Install Colyseus SDK + ParrelSync trong D.U1 — D.U2 sẽ touch ngay sau. Tránh recompile giữa Lát.
- ❌ ShaderGraph: verify trước, install chỉ khi URP không auto-pull. Defer if not strictly needed.

### `Bootstrap.unity` scene minimal
- 1 empty GameObject `[ArenaBootstrap]` với `ArenaBootstrap` component attached.
- Main Camera (default URP setup).
- Directional Light (per SKILL.md MCP convention — scenes mới luôn có camera + main light).
- **KHÔNG** include MapRoot / PlayerSlots / UIRoot / NetClient — defer D.U2.

### `ArenaBootstrap.cs` minimal
- Single `void Start()` method (không `async` vì không cần `await`).
- Gate pattern:
  ```csharp
  if (Bill.IsReady) InitArena();
  else Bill.Events.SubscribeOnce<GameReadyEvent>(_ => InitArena());
  ```
- `InitArena()`: log + fire `ArenaBootstrapReadyEvent`. **KHÔNG** register states/pools — comment ghi rõ "Arena state registration → D.U2+".
- `#nullable enable` ON per SKILL.md §3.
- Namespace `RadiantArena.Bootstrap`.

### `BillBootstrapConfig.asset` field values
Will read `BillBootstrapConfig.cs` source ở Sub 4 để biết schema. Tentative:
- `targetFrameRate = 60`
- `vSyncCount = 0`
- `enforceBootstrapScene = true` (lock to scene 0)
- `defaultGameScene = ""` (stay ở Bootstrap.unity post-boot)
- `enableTracing = false`
- `includeDebugOverlay = true` (Editor/Dev only — Bill.cs:144 gate)
- `includeCheatConsole = true`
- `returnToEditSceneInEditor = true`

⚠️ Nếu schema khác → adjust per actual fields, confirm với Bill trước commit Sub 4.

## 6. MCP touchpoints

| Category | MCP tools | Purpose |
|---|---|---|
| Verify | `manage_asset` (list), `manage_packages` (list), `manage_editor` (getPlatform) | Read-only baseline check (Sub 1) |
| Platform | `manage_editor` (switchPlatform → WebGL, set PlayerSettings) | Sub 2 |
| Packages | `manage_packages` (add) HOẶC Edit `Packages/manifest.json` + `refresh_unity` | Sub 3 |
| Asset create | `manage_asset` (createScriptableObject, createFolder) | Sub 4, Sub 5 |
| Code | `manage_script` (createScript) HOẶC Write tool + `refresh_unity` | Sub 6, Sub 7 |
| Scene | `manage_scene` (create, save), `manage_gameobject` (create + addComponent) | Sub 8 |
| Build settings | `manage_editor` (setSceneInBuildSettings) hoặc edit `EditorBuildSettings.asset` | Sub 8 |
| Verify | `manage_editor` (enterPlay/exitPlay), `read_console` (filter Error/Log) | Sub 9 |

**Fallback nếu MCP unavailable**: 
- Edit `Packages/manifest.json` qua filesystem (Write tool).
- Write C# files qua Write tool.
- Bill click trong Editor: create BillBootstrapConfig asset (right-click Project → Create → BillGameCore → BootstrapConfig), save scene, set build settings.
- Báo rõ "MCP not available, need Bill to do X" trước fall back.

## 7. Smoke test plan (DoD verification — Sub 9)

1. Bootstrap.unity là active scene (load via MCP `manage_scene` if needed).
2. `manage_editor` enterPlay.
3. `read_console` filter `Error` level → **MUST be empty**.
4. `read_console` filter `Log` level → **MUST contain** (order matters per Bill.cs:106-156):
   - `[Bill] + Infrastructure (...ms)`
   - `[Bill] + Core Services (...ms)`
   - `[Bill] + State Machine (...ms)`
   - `[Bill] + Network (...ms)`
   - `[Bill] + Dev Tools (...ms)` (Editor only — `Bill.cs:142-156` gate)
   - `[Bill] Ready. N services in Xms.`
   - `[Arena] bootstrap ready (Bill.IsReady=True)` ← từ ArenaBootstrap
5. `manage_editor` exitPlay.

Bill.cs sequence reference: `Phase1` → scene 0 enforce → `Phase2` → register services → `MarkInitialized` → `Fire<GameReadyEvent>` → `Debug.Log("[Bill] Ready. ...")`.

## 8. Trade-offs / risks

| Risk | Mitigation |
|---|---|
| `BillBootstrapConfig` schema có required field chưa biết | Sub 1 đọc `BillBootstrapConfig.cs`, confirm field list với Bill trước Sub 4 create asset. |
| Colyseus 0.15 SDK Unity package git URL có thể khác repo path | Pin từ extract §A — Unity SDK 0.15.x matches schema v2 server (0.15.57). Fallback: clone local + local file ref. |
| ParrelSync git URL stale | Test resolve sau Sub 3. Fall back manual clone nếu fail. |
| MCP not available khi Sonnet execute | Bill khởi động Unity Editor + `Window > MCP for Unity > Start Server` 🟢 trước. Stage 2 prerequisite. |
| `enforceBootstrapScene = true` + `defaultGameScene = ""` → loop reload? | Test sau Sub 4 create asset. Bill.cs:82-92 chỉ enforce LoadScene(0) nếu current != 0. Nếu Bootstrap.unity is scene 0, không loop. |
| `BootState` (BillGameCore default) goto sau init — có override gameplay không? | Bill.cs:161 `Bill.State.GoTo<BootState>()`. ArenaBootstrap chạy sau, không conflict. Defer state registration đến D.U2. |
| ShaderGraph dependency của URP — auto-pull failure | Sub 1 verify. Nếu missing + URP complains → add explicitly. |

## 9. Out of scope (D.U1 KHÔNG đụng tới)
- NetClient + Colyseus connect → D.U2 (extract đã có ở `arena-unity/server-extract-2026-05-15.md`)
- Schema mirror C# classes → D.U2
- UI panels (UXML/USS) → D.U3+
- Drag-aim input → D.U4
- Trajectory playback → D.U5
- HUD/Result UI → D.U6
- Juice (camera shake, hit-stop) → D.U7
- Weapon prefabs → D.U8
- HLSL shaders → D.U9
- WebGL build deploy → D.U10

## 10. Related artifacts
- `arena-unity/ROADMAP.md` — workflow (5-stage).
- `arena-unity/TASKS.md` §D.U1 — scope source.
- `arena-unity/RADIANT_ARENA_UNITY.md` §1.3 (folder layout), §3 (bootstrap pattern — fixed 2026-05-15).
- `arena-unity/server-extract-2026-05-15.md` — server contract (D.U2 input, lưu sẵn).
- `Assets/BillGameCore/Runtime/Bootstrap/Bill.cs` — boot orchestration (read 2026-05-15).
- `Assets/BillGameCore/Runtime/Bootstrap/BillBootstrapConfig.cs` — config schema (read at Sub 1).
- `Assets/BillGameCore/Runtime/Infrastructure/Interfaces.cs` — service API (read 2026-05-15).

## 11. Estimated effort
- Sub 1-3 (verify + platform + packages): ~15 min, mostly waiting on Unity recompile.
- Sub 4 (BillBootstrapConfig asset): ~10 min, includes reading schema source.
- Sub 5-7 (folders + 2 C# scripts): ~15 min.
- Sub 8 (scene): ~10 min.
- Sub 9 (smoke verify): ~5 min.
- **Total**: ~1 hour Sonnet execution + Bill review checkpoints between Sub 3 / 4 / 8.

---

*End of PLAN. Pair with `SUBTASKS.md` for ordered execution.*
