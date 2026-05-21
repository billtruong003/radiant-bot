# D.U8 — Arena scene (map + players + camera) · PLAN

> Stage 1 (Architect). Bill pivot 2026-05-18: skip per-feature polish, get to **visible combat** ASAP.
> Original `D.U8 — Weapon prefabs` deferred to D.U9 (renumbered after pivot — deploy pushed to D.U12 LAST).
> Executor: Opus 4.7 sequential auto-run.

---

## 1. Goal

Open Play, focus Game View, immediately see:
- A **top-down orthographic** camera framing a **10×10 world-unit arena** (matches server sim 1000×1000 via `TrajectoryConstants.WorldFromSim`).
- **2 player capsule placeholders** at slot positions (me = green tint, opp = orange tint, matching lobby/HUD slot colors).
- **Ground plane + 4 wall meshes** demarcating the play space.
- Existing combat UI (HudPanel, DamageNumberLayer, TurnInputPanel) overlaid.
- Drag-aim **line originating from my-player position** (not `Vector3.zero` as today).
- D.U5 trajectory sphere visible flying between players.
- Build Settings fixed so `Bootstrap.unity` loads automatically on Play (today's session loaded `SampleScene` by accident — manual mock smoke was required).

No new gameplay logic — pure visual scaffolding so playtesting feels concrete.

---

## 2. Scope (single Lát, no a/b split)

This Lát is **client-only and runtime-only**. No server-side dependency, no asset import.

| Item | Status | Notes |
|---|---|---|
| Top-down orthographic Main Camera | ✅ GO | Configured at runtime by `ArenaSceneBuilder` (no scene-file diff — keeps Bootstrap.unity binary clean). Position `(0, 10, 0)`, rotation `(90, 0, 0)`, `orthographic=true`, `orthographicSize = 6` (half-height in world units; 12 vertical fit ≈ 10×10 map + margin). |
| Ground plane | ✅ GO | `GameObject.CreatePrimitive(PrimitiveType.Plane)` scaled to 10×10 world units. URP/Unlit material with dark slate color. |
| 4 wall cubes | ✅ GO | Thin cuboids at borders. Same primitive pattern. Lighter contrast color. |
| 2 player capsules | ✅ GO | `PrimitiveType.Capsule` with URP/Unlit tinted materials (me green, opp orange). Initial slot positions: me `(-3, 0.5, 0)`, opp `(3, 0.5, 0)`. Y=0.5 sits center on ground (capsule height 1). |
| `PlayerVisual.cs` MonoBehaviour | ✅ GO | Each capsule has one. `Update` polls `ArenaContext.MyPlayer.X/Y` (or `OpponentPlayer.X/Y`) → `transform.position = WorldFromSim(x, y)` (fall back to slot anchor if server hasn't set position yet — `x == 0 && y == 0` heuristic). |
| `ArenaSceneBuilder.cs` MonoBehaviour | ✅ GO | Spawned once by `ArenaBootstrap.InitArena` (DontDestroyOnLoad). Configures camera + spawns ground/walls/players. Holds references to slot anchors (`MyPlayerVisual`, `OpponentPlayerVisual`) for other systems to read. |
| `ArenaAimController.SetOrigin` wired | ✅ GO | `MyTurnState.Enter` calls `_aim.SetOrigin(ArenaSceneBuilder.Instance.MyVisual.transform)`. Drag-aim line now origins at my-player capsule instead of world origin. |
| Build Settings: Bootstrap.unity as Scene 0 | ✅ GO | Edit `EditorBuildSettings.scenes` via Editor script or `mcp__unityMCP__manage_editor` (whichever works). Without this, Play loads whatever's currently active (SampleScene today). |
| Mock smoke | ✅ GO | Enter Play, verify Main Camera config, find_gameobjects ground + walls + 2 capsules, check `MyPlayerVisual` reference set on ArenaSceneBuilder, drive into MyTurn, verify drag-aim controller origin = MyVisual.transform. |
| **OUT OF SCOPE — defer to later Láts** | | |
| 6-weapon prefab catalog (the original D.U8) | ❌ D.U9 | Today's capsules use no weapon attachment. |
| WeaponHueApplier / WeaponPrefabRegistry | ❌ D.U9 | Same Lát as catalog. |
| UI fantasy polish (calligraphic font, ink overlay, tier color) | ❌ D.U10 | Bill flagged interest — separate scope. |
| HLSL toon/outline shaders | ❌ D.U11 | |
| WebGL deploy | ❌ D.U12 (LAST) | Deploy is the final numbered Lát per Bill order rule. |
| Real server HP/position drive | ❌ Server D.5 | PlayerVisual reads ArenaContext; today server leaves x/y=0 until physics ships. Fallback to slot position covers that. |
| Animations / IK / player rigs | ❌ Future | Capsule placeholder is intentional. |
| Audio (footstep, ambient) | ❌ D.U7b | |

---

## 3. Project state (verified 2026-05-18)

- ✅ `Assets/RadiantArena/Scenes/Bootstrap.unity` exists (D.U1). Has Main Camera + Directional Light + `[ArenaBootstrap]` GameObject.
- ✅ Today's session loaded `SampleScene` (Bill's last-opened scene), NOT Bootstrap.unity → ArenaBootstrap.InitArena never ran → ApplyArenaRuntimeTheme + JuicePresenter spawn never fired. Build Settings fix in this Lát prevents recurrence.
- ✅ `TrajectoryConstants.WorldFromSim(simX, simY) → Vector3((simX-500)*0.01, 0, (simY-500)*0.01)` already maps sim coords to world coords. PlayerVisual reuses this.
- ✅ `ArenaContext.MyPlayer.X / Y` populated by `PlayerSnapshot(PlayerSchema)` ctor. Defaults to 0/0 — fallback to slot anchor pos until server D.5.
- ✅ `ArenaAimController` already has `SetOrigin(Transform?)` method ([ArenaAimController.cs:389](../../../Assets/RadiantArena/Scripts/Weapons/ArenaAimController.cs#L389)) — just needs caller. `ScreenToWorld` already uses `_origin.position.y` for plane raycast height, so capsule center Y=0.5 will be fine.
- ✅ JuicePresenter pattern (singleton MonoBehaviour spawned by ArenaBootstrap) is proven. ArenaSceneBuilder mirrors it.
- ⚠️ Server `PlayerSchema.x/y` defaults to 0 today (no D.5 physics). PlayerVisual must handle "both at sim (0,0)" without overlapping by falling back to slot anchor positions.
- ⚠️ `manage_editor` MCP tool may not have a "set scene 0" action — verify in Sub 1 baseline. Fallback: write a tiny Editor script that mutates `EditorBuildSettings.scenes` and calls from menu.

---

## 4. Files this Lát will touch

| Path | Action | Purpose |
|---|---|---|
| `Assets/RadiantArena/Scripts/Arena/ArenaSceneBuilder.cs` | CREATE | MonoBehaviour singleton. `Awake`: configure Main Camera (ortho, top-down), spawn ground/walls/players, expose `MyVisual` + `OpponentVisual` properties. |
| `Assets/RadiantArena/Scripts/Arena/PlayerVisual.cs` | CREATE | MonoBehaviour. `Update` (or scheduled 100ms) reads `ArenaContext.MyPlayer/OpponentPlayer.X/Y` and updates `transform.position` via `TrajectoryConstants.WorldFromSim` (fallback to slot anchor). Exposes `IsMine` flag. |
| `Assets/RadiantArena/Scripts/Bootstrap/ArenaBootstrap.cs` | EDIT | Spawn `ArenaSceneBuilder` GameObject after `JuicePresenter` (mirror that pattern). |
| `Assets/RadiantArena/Scripts/States/MyTurnState.cs` | EDIT | In `Enter`: `_aim.SetOrigin(ArenaSceneBuilder.Instance?.MyVisual?.transform)`. |
| `Assets/RadiantArena/Editor/ArenaBuildSettingsFixer.cs` (Editor folder) | CREATE | Tiny one-shot Editor script — menu `Tools > RadiantArena > Set Bootstrap as Scene 0` that mutates `EditorBuildSettings.scenes`. Bill runs once, never again. |

**No** UXML/USS (UI untouched).
**No** scene-file edits (everything runtime).
**No** asset imports (primitives + URP/Unlit materials runtime-created).

---

## 5. APIs used

### 5.1 BillGameCore (already wired)
- `Bill.IsReady` — guard ArenaSceneBuilder Awake.
- `Bill.UI.IsOpen<T>` — no direct use; existing panels handle their own lifecycle.

### 5.2 Unity
- `Camera.main` — fetched in ArenaSceneBuilder Awake. Set `orthographic=true`, `orthographicSize=6`, `transform.position=(0, 10, 0)`, `transform.rotation=Quaternion.Euler(90, 0, 0)`, `clearFlags=SolidColor`, `backgroundColor` dark slate.
- `GameObject.CreatePrimitive(PrimitiveType.{Plane,Cube,Capsule})` — runtime mesh creation.
- `Material(Shader.Find("Universal Render Pipeline/Unlit"))` — URP unlit material (fallback `Unlit/Color`).
- `MeshRenderer.sharedMaterial` — tint per object.
- `Camera.main.WorldToScreenPoint` — already used by DamageNumberLayer; will keep working with new camera.
- `UnityEditor.EditorBuildSettings.scenes` — Editor-only, used by ArenaBuildSettingsFixer.

### 5.3 RadiantArena
- `ArenaContext.MyDiscordId / MyPlayer.X/Y / OpponentDiscordId / OpponentPlayer.X/Y` — read by PlayerVisual.
- `TrajectoryConstants.WorldFromSim(x, y)` — coord conversion.
- `ArenaAimController.SetOrigin(Transform)` — called from MyTurnState.

---

## 6. Architecture decisions

### 6.1 Top-down orthographic, x-z plane (Bill confirmed)
- Camera at `(0, 10, 0)` looking down (rotation `(90, 0, 0)`).
- World Y is "height" (always 0 for combat objects). Sim X/Y → world X/Z (Y=0). Matches `TrajectoryConstants.WorldFromSim` already in place since D.U5.
- Orthographic eliminates depth foreshortening — clean readable 2D-feeling combat with 3D meshes. Easier to reason about positions during playtesting.
- `orthographicSize = 6` → vertical fit = 12 world units = covers map (10) + 1-unit margin top/bottom. Aspect ratio at 16:9 → horizontal fit ≈ 21 units, plenty of side margin for damage numbers spilling past wall.

### 6.2 Runtime spawn, no scene-file diff
Same rationale as D.U6/D.U7: scene YAML files diff badly + binary-ish in Unity, hard to review. C# code that builds the scene in `ArenaSceneBuilder.Awake` is version-controlled, refactor-friendly, no merge conflicts.

Trade-off: every Play start re-creates objects. Cost is negligible (single Plane + 4 Cubes + 2 Capsules = 7 GameObjects, < 1ms).

### 6.3 ArenaSceneBuilder is a singleton MonoBehaviour spawned by ArenaBootstrap.InitArena
Mirror JuicePresenter pattern:
```csharp
if (RadiantArena.Arena.ArenaSceneBuilder.Instance == null)
{
    var go = new GameObject("[ArenaSceneBuilder]");
    go.AddComponent<RadiantArena.Arena.ArenaSceneBuilder>();
}
```
DontDestroyOnLoad. Lives for app lifetime. Bill.IsReady-guard on OnDestroy ([[bill-ondestroy-guard]] precedent).

### 6.4 PlayerVisual position fallback when server hasn't set X/Y
Server today emits `PlayerSchema.x = 0, y = 0` (no physics yet). Both players at sim (0, 0) → world (-5, 0, -5). Bad.

Decision: in `PlayerVisual.Update`, if `(player.X == 0f && player.Y == 0f)` treat as "uninitialized" and use the slot anchor position (me = world (-3, 0.5, 0), opp = (3, 0.5, 0)). When server D.5 ships real positions, the condition naturally fails and live position takes over.

Edge case: if server later legitimately places a player AT sim center (500, 500) which is world (0, 0, 0), the heuristic would mis-fire and snap to slot. Acceptable for D.U8 — server doesn't place at exact center in current design. Document as known limitation; revisit when D.5 lands.

### 6.5 Material tints inline, not asset-based
Two URP/Unlit materials created in `ArenaSceneBuilder.Awake`:
- `me-mat`: color `RGB(0.30, 0.86, 0.55)` (lobby green).
- `opp-mat`: color `RGB(0.94, 0.65, 0.32)` (lobby orange).
- `ground-mat`: color `RGB(0.12, 0.14, 0.18)` (dark slate).
- `wall-mat`: color `RGB(0.22, 0.26, 0.32)` (slate slightly lighter).

No `.mat` assets to track. Future D.U11 (weapon prefabs) or D.U9 (shaders) will introduce real materials.

### 6.6 ArenaAimController origin uses MyVisual transform, not a fixed anchor
`MyTurnState.Enter` already creates `ArenaAimController` GO. Add one line:
```csharp
_aim.SetOrigin(ArenaSceneBuilder.Instance?.MyVisual?.transform);
```
When server D.5 ships real positions, the aim origin tracks live position. For D.U8, it's the slot anchor — still better than `Vector3.zero` which was off-screen of the top-down camera.

### 6.7 Walls are visual-only, no collider gameplay
Server is authoritative on wall bounces (TrajectoryPointSchema event="wall_bounce"). Client walls are decoration. We drop colliders from the wall cubes — purely cosmetic. Plane keeps its default collider (free, no harm).

### 6.8 Build Settings fix is an Editor-only one-shot
`ArenaBuildSettingsFixer` lives at `Assets/RadiantArena/Editor/` with a `[MenuItem]` that:
1. Loads `Bootstrap.unity` scene asset.
2. Builds `EditorBuildSettingsScene[]` with Bootstrap as index 0.
3. Optionally appends `SampleScene` and others if present at index 1+.
4. Assigns to `EditorBuildSettings.scenes`.

Bill runs the menu once after Lát closes. No runtime effect. Doc the menu path in REPORT so it's easy to find.

---

## 7. MCP touchpoints

| Step | Tool |
|---|---|
| Write .cs files | `Write` |
| Compile + check | `mcp__unityMCP__refresh_unity` + `read_console` |
| Verify scene state | `mcp__unityMCP__find_gameobjects` (ground, walls, capsules) |
| Camera config check | `execute_code` reflection probe |
| Mock smoke (drive into MyTurn + probe aim origin) | `mcp__unityMCP__execute_code compiler=codedom` |

No `manage_scene` / `manage_gameobject` for object placement — runtime spawn. `manage_editor` only for play/stop.

---

## 8. Smoke test plan

### 8.1 Per-sub compile gate
After each Write: `refresh_unity scope=all mode=force` (D.U5/D.U7 lesson) → `read_console types=["error"]` empty.

### 8.2 Mock smoke (Sub 7)

**Pre**: stop/start Play (fresh Bill). compiler=codedom for execute_code. Bill loads `Bootstrap.unity` manually before Play (Build Settings fix not yet applied in mock).

Actions:
1. read_console clear.
2. Verify ArenaSceneBuilder spawned by ArenaBootstrap.InitArena (Instance != null), JuicePresenter alive.
3. Probe Camera.main: `orthographic=true`, `orthographicSize ≈ 6`, `position.y ≈ 10`, rotation matches top-down.
4. `find_gameobjects` for "ground", "wall-*", "me-capsule", "opp-capsule" — confirm all present, count expected.
5. Probe `ArenaSceneBuilder.Instance.MyVisual` + `OpponentVisual` non-null.
6. Initial position check: both capsules at slot fallback (me at (-3, 0.5, 0), opp at (3, 0.5, 0)) — because ArenaContext.MyPlayer is null at boot.
7. Inject mock ArenaContext.MyPlayer with X=200, Y=500 (sim coords). After ~200ms (PlayerVisual poll cycle), probe my-capsule transform.position — should be `WorldFromSim(200, 500) = (-3, 0, 0)`. (Y stays 0.5 via PlayerVisual; only X/Z updated from sim.)
8. Drive into MyTurnState (via prior smoke pattern). Probe `ArenaAimController._origin` (private field, reflection): should equal MyVisual.transform (non-null, not Vector3.zero fallback).
9. Stop Play. read_console types=["error"] → 0.

### 8.3 Visual feel (Bill manual, post-Sub-7)
Bill enters Play (with Build Settings fix in place — Bootstrap.unity loads automatically). Game View shows: top-down arena, 2 capsules, drag-aim line from me-capsule, damage numbers spawn at hit world positions over the arena. Stop Play, sign-off D.U8 close.

---

## 9. Bill checkpoints

| After Sub | Checkpoint |
|---|---|
| Sub 2 | ArenaSceneBuilder camera config — Bill can override ortho size / camera Y height. |
| Sub 4 | Optional review of PlayerVisual fallback heuristic. |
| Sub 6 | ArenaBuildSettingsFixer menu — Bill runs once, verifies Bootstrap = Scene 0. |
| Sub 7 | Mock smoke + visual feel pass. |

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Camera.main null if no Main Camera tag in scene | Bootstrap.unity has Main Camera (D.U1 verified). ArenaSceneBuilder guards null. |
| Orthographic camera + drag-aim ScreenToWorld math broken | ArenaAimController uses `Camera.main.ScreenPointToRay` + `Plane.Raycast` on Y=0 plane. Works for both ortho + perspective. Confirmed via Unity docs. |
| `PrimitiveType.Plane` has a 10×10 default size but normal mesh — could clip with capsules at Y=0 | Plane sits at Y=0 (default origin), capsules at Y=0.5 — clear gap. |
| URP/Unlit shader not found at runtime | D.U5 + D.U7 already use `Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Color")` fallback — proven. |
| PlayerVisual fallback heuristic edge case (server places player at sim 500,500 exactly) | Documented in §6.4. Acceptable; revisit when server D.5 lands. |
| Build Settings fix menu fails to find Bootstrap.unity asset | ArenaBuildSettingsFixer uses `AssetDatabase.LoadAssetAtPath<SceneAsset>("Assets/RadiantArena/Scenes/Bootstrap.unity")` — fully qualified. Logs error if not found. |
| Scene state polluted: ArenaSceneBuilder spawns N capsules if Play restarted without proper teardown | Singleton guard in Awake handles. DontDestroyOnLoad means GameObject persists; second Play creates new GO whose Awake `Destroy(gameObject)` on existing-Instance check. |
| Camera config from runtime conflicts with scene-file Main Camera config | We MUTATE the existing Main Camera in scene, not replace. If scene file later has different settings, runtime mutate wins (last writer). Acceptable. |

---

## 11. Definition of Done

- [ ] Console clean after all writes.
- [ ] ArenaSceneBuilder spawns at boot; configures Main Camera ortho top-down; creates ground + 4 walls + 2 capsules.
- [ ] PlayerVisual transforms track ArenaContext.MyPlayer/OpponentPlayer.X/Y when non-zero; fall back to slot anchors otherwise.
- [ ] ArenaAimController.SetOrigin called by MyTurnState passing MyVisual.transform.
- [ ] ArenaBuildSettingsFixer menu present + works (Bill verifies once).
- [ ] Mock smoke §8.2 passes.
- [ ] Bill manual visual feel pass §8.3.
- [ ] REPORT.md drafted + folder moved to `done/`.

---

## 12. Roadmap impact (applied 2026-05-18, pre-Sub-1)

Updated priority order — **deploy moved to LAST per Bill order rule**:

| # | Lát | Folder | Status |
|---|---|---|---|
| 1-7 | D.U1 – D.U7 | `tasks/done/` | ✅ closed |
| 8 | **D.U8 — Arena scene (this Lát)** | `tasks/todo/D.U8-arena-scene/` | 🟡 in progress |
| 9 | D.U9 — Weapon prefab catalog (was D.U8 pre-pivot) | `tasks/todo/D.U9-weapon-prefabs/` | ⬜ |
| 10 | D.U10 — UI fantasy polish (new) | `tasks/todo/D.U10-ui-polish/` | ⬜ |
| 11 | D.U11 — HLSL shaders (was D.U9 pre-pivot) | `tasks/todo/D.U11-shaders/` | ⬜ |
| 12 | D.U12 — WebGL deploy LAST (was D.U10 pre-pivot) | `tasks/todo/D.U12-webgl-deploy/` | ⬜ |
| 13* | D.U13 — Replay viewer (optional, was D.U11 pre-pivot) | not yet created | ⬜ |
| 14* | D.U14 — PvE mode (optional, was D.U12 pre-pivot) | not yet created | ⬜ |

ROADMAP.md + TASKS.md updated pre-Sub-1 (Bill 2026-05-18 instruction to settle phase order before execute).
