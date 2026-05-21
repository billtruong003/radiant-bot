# D.U1 — Bootstrap · SUBTASKS

> Stage 1 (Architect) output. Ordered, 1 commit per sub (except verify steps). Bill confirm trước Sonnet execute Stage 2.

## DoD overall

- Unity Console clean (zero errors, no new warnings beyond baseline) khi Play `Bootstrap.unity`.
- `[Bill] Ready. N services in Xms.` log visible.
- `[Arena] bootstrap ready (Bill.IsReady=True)` log visible (proof gate pattern hoạt động).
- `Assets/RadiantArena/Scripts/{Bootstrap,Net,States,Events,UI}/` folder structure tồn tại.
- `Assets/Resources/BillBootstrapConfig.asset` tồn tại + populated.
- Colyseus SDK + ParrelSync installed (verify via `Packages/manifest.json`).
- Build target = WebGL.

## Commit format
`feat(arena-unity/Lát-D.U1): <verb> <object>` (per SKILL.md §4 + ROADMAP.md §4 Stage 2).

---

## Sub 1 — Verify project baseline (read-only, NO commit)

**Action**:
- MCP `manage_packages` list → confirm Cinemachine/URP/Input System present, Colyseus/ParrelSync missing.
- MCP `manage_asset` list `Assets/Resources/` → confirm `BillBootstrapConfig.asset` không tồn tại (already confirmed in PLAN §2 — re-verify in case).
- MCP `manage_editor` getPlatform → record current target (planning WebGL switch).
- Read `Assets/BillGameCore/Runtime/Bootstrap/BillBootstrapConfig.cs` — extract field schema (default values + required fields).
- Report findings tới Bill. **Wait for confirm trên BillBootstrapConfig field values** (PLAN §5 tentative list) trước qua Sub 4.

**DoD**: Bill có status confirmation list + agreed BillBootstrapConfig field values. NO commit.

---

## Sub 2 — Switch platform → WebGL

**Action**:
- MCP `manage_editor` switchPlatform → WebGL. Đợi domain reload.
- `manage_editor` poll `editor_state.isCompiling` until false.
- PlayerSettings (via `manage_editor` setPlayerSettings hoặc edit `ProjectSettings/ProjectSettings.asset`):
  - Scripting Backend → IL2CPP (WebGL default)
  - Api Compatibility Level → `.NET Standard 2.1`
  - Default Screen Width = 1280, Height = 720
- `read_console` filter Error → empty.

**DoD**: Build target = WebGL, console clean, no compile errors.

**Commit**: `chore(arena-unity/Lát-D.U1): switch build target to WebGL + player settings`

---

## Sub 3 — Install Colyseus SDK + ParrelSync packages

**Action**:
- Edit `Packages/manifest.json` add (sort alphabetically among existing):
  - `"io.colyseus.colyseus-unity-sdk": "https://github.com/colyseus/colyseus-unity-sdk.git?path=Assets/Colyseus"`
  - `"com.veriorpies.parrelsync": "https://github.com/VeriorPies/ParrelSync.git?path=/ParrelSync"`
- MCP `refresh_unity` trigger package resolve.
- Poll `editor_state.isCompiling` until false.
- `read_console` verify package import zero errors.
- Spot-check: `Assets/Colyseus/` folder hoặc `Library/PackageCache/io.colyseus.colyseus-unity-sdk@...` exists.

**DoD**: 2 packages resolved, console clean, no missing assembly errors.

**Commit**: `chore(arena-unity/Lát-D.U1): add Colyseus SDK + ParrelSync packages`

⚠️ **Bill checkpoint**: nếu Colyseus git URL stale → fallback strategy (local clone) cần Bill confirm trước.

---

## Sub 4 — Create BillBootstrapConfig asset

**Action**:
- Per Sub 1 readout, confirm BillBootstrapConfig field schema match PLAN §5 tentative. Adjust nếu khác.
- MCP `manage_asset` createScriptableObject:
  - Path: `Assets/Resources/BillBootstrapConfig.asset`
  - Type: `BillGameCore.BillBootstrapConfig`
- Set field values (Bill-confirmed):
  - `targetFrameRate = 60`
  - `vSyncCount = 0`
  - `enforceBootstrapScene = true`
  - `defaultGameScene = ""` 
  - `enableTracing = false`
  - `includeDebugOverlay = true`
  - `includeCheatConsole = true`
  - `returnToEditSceneInEditor = true`
- Save asset.
- `read_console` verify zero errors. Note: if Editor not in Play yet, framework boot không trigger — không kỳ vọng `[Bill] Ready.` log ở step này.

**DoD**: Asset exists at path, fields populated correctly.

**Commit**: `feat(arena-unity/Lát-D.U1): add BillBootstrapConfig resource`

---

## Sub 5 — Create RadiantArena folder layout

**Action**:
- MCP `manage_asset` createFolder cho từng path (Unity auto-create .meta):
  - `Assets/RadiantArena/`
  - `Assets/RadiantArena/Scenes/`
  - `Assets/RadiantArena/Scripts/`
  - `Assets/RadiantArena/Scripts/Bootstrap/`
  - `Assets/RadiantArena/Scripts/Net/`
  - `Assets/RadiantArena/Scripts/States/`
  - `Assets/RadiantArena/Scripts/Events/`
  - `Assets/RadiantArena/Scripts/UI/`
- Verify list listing.

**DoD**: 8 folder + 8 .meta files exist.

**Commit**: `feat(arena-unity/Lát-D.U1): scaffold Assets/RadiantArena folder layout`

---

## Sub 6 — Write ArenaEvents.cs placeholder

**Action**:
- Create `Assets/RadiantArena/Scripts/Events/ArenaEvents.cs`:
  ```csharp
  #nullable enable
  using BillGameCore;
  
  namespace RadiantArena.Events {
      // Placeholder. Real events added per Lát:
      //   D.U2 — NetConnectedEvent, PhaseChangedEvent, NetErrorEvent
      //   D.U5 — ShotResolvedEvent, PlayerHitEvent, WallBounceEvent
      //   D.U6 — MatchEndedEvent
      public struct ArenaBootstrapReadyEvent : IEvent { }
  }
  ```
- MCP `refresh_unity` + `read_console` zero compile errors.

**DoD**: File compiles, struct defined.

**Commit**: `feat(arena-unity/Lát-D.U1): scaffold ArenaEvents.cs placeholder`

---

## Sub 7 — Write ArenaBootstrap.cs

**Action**:
- Create `Assets/RadiantArena/Scripts/Bootstrap/ArenaBootstrap.cs`:
  ```csharp
  #nullable enable
  using BillGameCore;
  using RadiantArena.Events;
  using UnityEngine;
  
  namespace RadiantArena.Bootstrap {
      /// <summary>
      /// Entry MonoBehaviour for Arena scene. Gates init on BillGameCore ready signal.
      /// BillGameCore auto-boots via [RuntimeInitializeOnLoadMethod] before scene load;
      /// when this Start() fires, Bill.IsReady is typically already true. Gate guards
      /// against race condition with scene-load order.
      ///
      /// Arena state registration + pool setup + ArenaContext init defer to D.U2+.
      /// </summary>
      public class ArenaBootstrap : MonoBehaviour {
          void Start() {
              if (Bill.IsReady) InitArena();
              else Bill.Events.SubscribeOnce<GameReadyEvent>(_ => InitArena());
          }
  
          void InitArena() {
              Debug.Log($"[Arena] bootstrap ready (Bill.IsReady={Bill.IsReady})");
              Bill.Events.Fire(new ArenaBootstrapReadyEvent());
          }
      }
  }
  ```
- MCP `refresh_unity` + `read_console` zero compile errors.

**DoD**: Script compiles, gate pattern correct.

**Commit**: `feat(arena-unity/Lát-D.U1): add ArenaBootstrap MonoBehaviour with GameReadyEvent gate`

---

## Sub 8 — Create Bootstrap.unity scene

**Action**:
- MCP `manage_scene` create `Assets/RadiantArena/Scenes/Bootstrap.unity`.
- Inside scene via `manage_gameobject`:
  - Create empty GameObject named `[ArenaBootstrap]`, position (0,0,0).
  - Add component `RadiantArena.Bootstrap.ArenaBootstrap`.
  - Ensure Main Camera (default URP) exists; create if scene template không include.
  - Ensure Directional Light exists; create at rotation (50, -30, 0) if missing.
- Save scene.
- Set Bootstrap.unity là build index 0:
  - MCP `manage_editor` setSceneInBuildSettings (nếu support)
  - Hoặc edit `ProjectSettings/EditorBuildSettings.asset` trực tiếp
  - Hoặc Bill click File → Build Settings → Add Open Scenes (fallback).
- `read_console` zero errors.

**DoD**: 
- `Assets/RadiantArena/Scenes/Bootstrap.unity` exists.
- Contains `[ArenaBootstrap]` GameObject + Main Camera + Directional Light.
- Build settings: Bootstrap.unity at index 0.

**Commit**: `feat(arena-unity/Lát-D.U1): add Bootstrap.unity scene as build index 0`

---

## Sub 9 — Smoke verify (NO commit)

**Action**:
- Ensure Bootstrap.unity là active scene. MCP `manage_scene` load nếu cần.
- MCP `manage_editor` enterPlay.
- Poll `editor_state.isCompiling` until false (should be instant if no recent code change).
- MCP `read_console` filter `Error` level → **MUST be empty**. Nếu có error → STOP, document, fix trước khi xuống bước.
- MCP `read_console` filter `Log` level → confirm presence of:
  - `[Bill] + Infrastructure (...ms)`
  - `[Bill] + Core Services (...ms)`
  - `[Bill] + State Machine (...ms)`
  - `[Bill] + Network (...ms)`
  - `[Bill] + Dev Tools (...ms)`
  - `[Bill] Ready. N services in Xms.`
  - `[Arena] bootstrap ready (Bill.IsReady=True)`
- Capture log output snippet cho REPORT.md (Stage 4).
- MCP `manage_editor` exitPlay.

**DoD**: All 7 expected logs present in correct order, zero errors. Ready for REPORT.

---

## Execution notes

- **Parallelism**: Sub 6 + Sub 7 có thể parallel (independent C# files). Sub 5 trước Sub 6/7 (folder must exist). Sub 8 sau Sub 7 (scene cần ArenaBootstrap component compiled).
- **Commit failure**: nếu pre-commit hook fail → fix root cause + NEW commit (KHÔNG `--amend` per Bash tool guidance).
- **Bill checkpoints**:
  - Sau Sub 1: confirm BillBootstrapConfig field values trước Sub 4.
  - Sau Sub 3: nếu package URL stale → confirm fallback strategy.
  - Sau Sub 9: REPORT review trước Move (Stage 5).
- **MCP not available**: nếu Unity Editor closed → báo Bill "MCP not available, need Bill to: (a) khởi động Unity, (b) start MCP server". KHÔNG silent fall back hết qua manual.

## Next Lát preview (D.U2)
Khi D.U1 done + moved tới `tasks/done/D.U1-bootstrap/`, D.U2 entry sẽ reference `arena-unity/server-extract-2026-05-15.md` cho:
- Hand-mirror 7 Schema classes (C, §B).
- DevTokenSigner.cs (§E).
- ConnectingState → NetClient.JoinById flow (§D).
- Extract đề xuất split D.U2a (schemas + connect, doable ngay) + D.U2b (message protocol, blocked on server D.4).

---

*End of SUBTASKS.*
