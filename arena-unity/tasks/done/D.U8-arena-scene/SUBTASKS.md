# D.U8 — Arena scene · SUBTASKS

> 7 subs / 6 commits (Sub 1 + Sub 7 verify-only). Opus sequential auto-run.

---

## Sub 1 — Verify baseline (read-only, NO commit)

**Goal**: confirm 3 assumptions.

**Actions**:
1. `read_console types=["error"]` → expect baseline.
2. `Glob` `Assets/RadiantArena/Scenes/Bootstrap.unity` exists.
3. `Grep "Main Camera"` Bootstrap.unity — confirm Main Camera GameObject present.
4. `Grep "EditorBuildSettings"` Assets to confirm no existing fixer script that would conflict.
5. `Grep "SetOrigin\\("` Assets/RadiantArena to confirm `ArenaAimController.SetOrigin` callable + currently no callers.

**Output**:
- Console baseline OK.
- Bootstrap.unity present.
- Main Camera in Bootstrap.unity scene.
- ArenaAimController.SetOrigin exists + 0 callers today.
- No existing build-settings fixer.

**DoD**: report. NO commit.

---

## Sub 2 — ArenaSceneBuilder.cs (camera + ground + walls + slot anchors)

**Goal**: singleton MonoBehaviour that builds the arena scene at runtime.

### `Assets/RadiantArena/Scripts/Arena/ArenaSceneBuilder.cs`

```csharp
#nullable enable
using BillGameCore;
using UnityEngine;

namespace RadiantArena.Arena
{
    /// <summary>
    /// Singleton MonoBehaviour spawned by ArenaBootstrap. Configures Main Camera
    /// (top-down orthographic) and creates ground + 4 walls + 2 player capsules
    /// at runtime. PlayerVisual components attach to capsules.
    ///
    /// DDOL — lives for app lifetime. Bill.IsReady-guard on OnDestroy per
    /// [[bill-ondestroy-guard]] precedent.
    /// </summary>
    public class ArenaSceneBuilder : MonoBehaviour
    {
        public static ArenaSceneBuilder? Instance { get; private set; }

        public PlayerVisual? MyVisual { get; private set; }
        public PlayerVisual? OpponentVisual { get; private set; }

        // Layout constants.
        const float MapHalf       = 5.0f;   // world units per side (10×10 total)
        const float WallThickness = 0.4f;
        const float WallHeight    = 1.0f;
        const float CapsuleY      = 0.5f;
        const float SlotMeX       = -3.0f;
        const float SlotOppX      =  3.0f;
        const float CameraY       = 10.0f;
        const float CameraOrthoSize = 6.0f;

        static readonly Color GroundColor = new Color(0.12f, 0.14f, 0.18f);
        static readonly Color WallColor   = new Color(0.22f, 0.26f, 0.32f);
        static readonly Color MeColor     = new Color(0.30f, 0.86f, 0.55f);
        static readonly Color OppColor    = new Color(0.94f, 0.65f, 0.32f);
        static readonly Color BgColor     = new Color(0.06f, 0.07f, 0.10f);

        Material? _groundMat;
        Material? _wallMat;
        Material? _meMat;
        Material? _oppMat;

        void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            DontDestroyOnLoad(gameObject);

            BuildMaterials();
            ConfigureCamera();
            BuildGround();
            BuildWalls();
            BuildPlayers();

            Debug.Log("[Arena.Scene] ArenaSceneBuilder ready — ground, 4 walls, 2 capsules, top-down ortho camera");
        }

        void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        // ─────────────────────────────────────────────────────────────────

        void BuildMaterials()
        {
            var shader = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Color");
            _groundMat = new Material(shader); _groundMat.color = GroundColor;
            _wallMat   = new Material(shader); _wallMat.color   = WallColor;
            _meMat     = new Material(shader); _meMat.color     = MeColor;
            _oppMat    = new Material(shader); _oppMat.color    = OppColor;
        }

        void ConfigureCamera()
        {
            var cam = Camera.main;
            if (cam == null) { Debug.LogWarning("[Arena.Scene] Camera.main null — skip configure"); return; }
            cam.orthographic     = true;
            cam.orthographicSize = CameraOrthoSize;
            cam.transform.position = new Vector3(0f, CameraY, 0f);
            cam.transform.rotation = Quaternion.Euler(90f, 0f, 0f);
            cam.clearFlags       = CameraClearFlags.SolidColor;
            cam.backgroundColor  = BgColor;
        }

        void BuildGround()
        {
            var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
            ground.name = "ArenaGround";
            ground.transform.SetParent(transform, worldPositionStays: false);
            // Plane default size = 10×10 world units (vertex extent ±5). Matches our 10×10 map.
            ground.transform.localScale = Vector3.one; // 1 → already 10×10
            var r = ground.GetComponent<MeshRenderer>();
            if (r != null && _groundMat != null) r.sharedMaterial = _groundMat;
        }

        void BuildWalls()
        {
            // 4 walls at +Z, -Z, +X, -X boundaries.
            BuildWall("WallNorth", new Vector3(0f, WallHeight * 0.5f,  MapHalf),  new Vector3(MapHalf * 2f + WallThickness, WallHeight, WallThickness));
            BuildWall("WallSouth", new Vector3(0f, WallHeight * 0.5f, -MapHalf),  new Vector3(MapHalf * 2f + WallThickness, WallHeight, WallThickness));
            BuildWall("WallEast",  new Vector3( MapHalf, WallHeight * 0.5f, 0f),  new Vector3(WallThickness, WallHeight, MapHalf * 2f));
            BuildWall("WallWest",  new Vector3(-MapHalf, WallHeight * 0.5f, 0f),  new Vector3(WallThickness, WallHeight, MapHalf * 2f));
        }

        void BuildWall(string n, Vector3 pos, Vector3 scale)
        {
            var w = GameObject.CreatePrimitive(PrimitiveType.Cube);
            w.name = n;
            w.transform.SetParent(transform, worldPositionStays: false);
            w.transform.position = pos;
            w.transform.localScale = scale;
            var col = w.GetComponent<Collider>();
            if (col != null) Destroy(col); // visual-only
            var r = w.GetComponent<MeshRenderer>();
            if (r != null && _wallMat != null) r.sharedMaterial = _wallMat;
        }

        void BuildPlayers()
        {
            MyVisual       = BuildPlayer("MyPlayerVisual",       new Vector3(SlotMeX,  CapsuleY, 0f), _meMat,  isMine: true);
            OpponentVisual = BuildPlayer("OpponentPlayerVisual", new Vector3(SlotOppX, CapsuleY, 0f), _oppMat, isMine: false);
        }

        PlayerVisual BuildPlayer(string n, Vector3 pos, Material? mat, bool isMine)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            go.name = n;
            go.transform.SetParent(transform, worldPositionStays: false);
            go.transform.position = pos;
            var col = go.GetComponent<Collider>();
            if (col != null) Destroy(col);
            var r = go.GetComponent<MeshRenderer>();
            if (r != null && mat != null) r.sharedMaterial = mat;
            var pv = go.AddComponent<PlayerVisual>();
            pv.IsMine = isMine;
            pv.SlotAnchor = pos;
            return pv;
        }
    }
}
```

**DoD**: compile clean.

**Commit**: `feat(arena-unity/Lát-D.U8): add ArenaSceneBuilder — top-down ortho camera + runtime ground + walls + player capsules`

---

## Sub 3 — PlayerVisual.cs (transform binding)

**Goal**: each capsule polls ArenaContext, updates position when server data live; falls back to slot anchor otherwise.

### `Assets/RadiantArena/Scripts/Arena/PlayerVisual.cs`

```csharp
#nullable enable
using RadiantArena.Net;
using RadiantArena.Trajectory;
using UnityEngine;

namespace RadiantArena.Arena
{
    /// <summary>
    /// Attached to a capsule by ArenaSceneBuilder. Each frame (or every Nth)
    /// reads ArenaContext.MyPlayer/OpponentPlayer.X/Y and updates transform.
    /// Falls back to SlotAnchor when server hasn't set position (X=Y=0).
    /// </summary>
    public class PlayerVisual : MonoBehaviour
    {
        public bool IsMine;
        public Vector3 SlotAnchor;

        const float PollIntervalMs = 100f;
        float _accumMs;
        float _capsuleY;

        void Awake()
        {
            _capsuleY = transform.position.y;
        }

        void Update()
        {
            _accumMs += Time.unscaledDeltaTime * 1000f;
            if (_accumMs < PollIntervalMs) return;
            _accumMs = 0f;
            SyncFromContext();
        }

        void SyncFromContext()
        {
            var p = IsMine ? ArenaContext.MyPlayer : ArenaContext.OpponentPlayer;
            if (p == null)
            {
                transform.position = SlotAnchor;
                return;
            }
            // Fallback heuristic: server defaults x=y=0 (uninitialized) → use slot anchor.
            if (Mathf.Approximately(p.X, 0f) && Mathf.Approximately(p.Y, 0f))
            {
                transform.position = SlotAnchor;
                return;
            }
            // Map sim (x, y) → world (X, 0, Z) via TrajectoryConstants, then re-apply capsule center Y.
            var world = TrajectoryConstants.WorldFromSim(p.X, p.Y);
            transform.position = new Vector3(world.x, _capsuleY, world.z);
        }
    }
}
```

**DoD**: compile clean.

**Commit**: `feat(arena-unity/Lát-D.U8): add PlayerVisual — polls ArenaContext.X/Y per 100ms, falls back to SlotAnchor when server uninitialized`

---

## Sub 4 — Wire ArenaSceneBuilder spawn into ArenaBootstrap

**Goal**: spawn `[ArenaSceneBuilder]` alongside `[JuicePresenter]` in `ArenaBootstrap.InitArena`.

### `Assets/RadiantArena/Scripts/Bootstrap/ArenaBootstrap.cs` — extend InitArena

Find the existing JuicePresenter spawn block (added in D.U7 Sub 6). Insert immediately after:

```csharp
if (RadiantArena.Arena.ArenaSceneBuilder.Instance == null)
{
    var sceneGo = new GameObject("[ArenaSceneBuilder]");
    sceneGo.AddComponent<RadiantArena.Arena.ArenaSceneBuilder>();
}
```

**DoD**: compile clean.

**Commit**: `feat(arena-unity/Lát-D.U8): spawn ArenaSceneBuilder from ArenaBootstrap.InitArena`

---

## Sub 5 — Wire ArenaAimController.SetOrigin from MyTurnState

**Goal**: drag-aim line origins at my-player capsule.

### `Assets/RadiantArena/Scripts/States/MyTurnState.cs` — extend Enter

Find the existing `var go = new GameObject("[ArenaAimController]"); _aim = go.AddComponent<ArenaAimController>();` block. After AddComponent, insert:

```csharp
_aim.SetOrigin(RadiantArena.Arena.ArenaSceneBuilder.Instance?.MyVisual?.transform);
```

**DoD**: compile clean.

**Commit**: `feat(arena-unity/Lát-D.U8): MyTurnState passes MyVisual.transform as ArenaAimController origin — drag-aim line tracks my-player position`

---

## Sub 6 — ArenaBuildSettingsFixer (Editor menu)

**Goal**: one-shot menu Bill runs once to fix `EditorBuildSettings.scenes[0] = Bootstrap.unity`.

### `Assets/RadiantArena/Editor/ArenaBuildSettingsFixer.cs`

```csharp
#if UNITY_EDITOR
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace RadiantArena.EditorTools
{
    /// <summary>
    /// One-shot Editor menu — sets Bootstrap.unity as Scene 0 in Build Settings.
    /// Bill runs once when starting a fresh clone or after Build Settings drift.
    /// </summary>
    public static class ArenaBuildSettingsFixer
    {
        const string BootstrapPath = "Assets/RadiantArena/Scenes/Bootstrap.unity";

        [MenuItem("Tools/RadiantArena/Set Bootstrap as Scene 0")]
        public static void SetBootstrapScene0()
        {
            var asset = AssetDatabase.LoadAssetAtPath<SceneAsset>(BootstrapPath);
            if (asset == null)
            {
                Debug.LogError($"[ArenaBuildSettingsFixer] Bootstrap.unity not found at {BootstrapPath}");
                return;
            }

            var existing = EditorBuildSettings.scenes;
            var seen = new HashSet<string>();
            var list = new List<EditorBuildSettingsScene>();

            // Bootstrap first.
            list.Add(new EditorBuildSettingsScene(BootstrapPath, enabled: true));
            seen.Add(BootstrapPath);

            // Preserve all other scenes in their existing order, skipping duplicates.
            foreach (var s in existing)
            {
                if (s == null || string.IsNullOrEmpty(s.path)) continue;
                if (seen.Contains(s.path)) continue;
                list.Add(new EditorBuildSettingsScene(s.path, s.enabled));
                seen.Add(s.path);
            }

            EditorBuildSettings.scenes = list.ToArray();
            Debug.Log($"[ArenaBuildSettingsFixer] Bootstrap set as Scene 0. Total scenes: {list.Count}");
        }
    }
}
#endif
```

**DoD**: compile clean. Menu present at `Tools > RadiantArena > Set Bootstrap as Scene 0`.

**Commit**: `feat(arena-unity/Lát-D.U8): add ArenaBuildSettingsFixer editor menu — set Bootstrap.unity as Scene 0`

---

## Sub 7 — Mock smoke + Bill manual visual check (NO commit)

**Goal**: validate runtime scene + camera + aim binding.

### Pre

- Bill loads `Bootstrap.unity` manually in Editor before this smoke (Build Settings fix not yet effective unless Bill runs the menu — paste menu invocation in execute_code as a fallback).
- stop/start Play.
- `compiler: codedom` for execute_code.

### Mock smoke

1. `read_console clear`.
2. (Optional) Run the build-settings fixer programmatically from execute_code to avoid manual menu:
   ```csharp
   RadiantArena.EditorTools.ArenaBuildSettingsFixer.SetBootstrapScene0();
   ```
   Note this is Editor-only; only callable from Editor context — execute_code runs in Editor, so it works.
3. Verify Camera.main config:
   - `Camera.main.orthographic == true`
   - `Camera.main.orthographicSize ≈ 6`
   - `Camera.main.transform.position.y ≈ 10`
   - rotation Euler X ≈ 90
4. `find_gameobjects "ArenaGround"` count = 1.
5. `find_gameobjects "Wall*"` count = 4 (or check each name explicitly).
6. `find_gameobjects "MyPlayerVisual"` count = 1, "OpponentPlayerVisual" count = 1.
7. Probe `ArenaSceneBuilder.Instance.MyVisual` / `OpponentVisual` non-null.
8. Probe initial capsule positions: me at `(-3, 0.5, 0)`, opp at `(3, 0.5, 0)` (slot fallback because MyPlayer null at boot).
9. Inject mock `ArenaContext.MyPlayer` with X=200, Y=500 (sim coords). Wait 0.15s. Probe my-capsule `transform.position` — should be `WorldFromSim(200, 500) = (-3, 0.5, 0)` (X=-3, Z=0 because 200-500=-300, *0.01=-3; 500-500=0, *0.01=0; Y stays at capsuleY=0.5).
10. Drive into MyTurnState (mock LobbyState → Countdown → MyTurn chain via ArenaContext priming + PhaseChangedEvent + GoTo<MyTurnState>).
11. Probe `ArenaAimController._origin` via reflection — should equal `MyVisual.transform` (NOT null, NOT Vector3.zero).
12. Stop Play. `read_console types=["error"]` → 0.

### Bill manual visual

1. Verify Build Settings fix (`Tools > RadiantArena > Set Bootstrap as Scene 0` if not auto-applied).
2. Re-Play. Bootstrap.unity loads automatically.
3. Focus Game View — should see top-down arena: dark slate ground, slightly-lighter walls, green capsule left of center, orange capsule right.
4. Watch JuicePresenter auto-fire (if hooked from D.U7 — otherwise paste auto-fire snippet again).
5. If MyTurn auto-triggers (via mock or future server flow), drag mouse over arena — green aim line emanates from green capsule (not world origin).
6. Sign-off D.U8 close.

**DoD**:
- Scene visuals present + camera ortho top-down.
- PlayerVisual position tracks ArenaContext.X/Y via WorldFromSim.
- ArenaAimController.SetOrigin called with MyVisual transform.
- Build Settings fixer menu works.

**NO commit**. REPORT.md follows.

---

## DoD overall (D.U8 close)

- [ ] Sub 1 verified.
- [ ] Sub 2 ArenaSceneBuilder landed.
- [ ] Sub 3 PlayerVisual landed.
- [ ] Sub 4 ArenaBootstrap wiring landed.
- [ ] Sub 5 MyTurnState aim origin wired.
- [ ] Sub 6 BuildSettingsFixer menu landed.
- [ ] Sub 7 mock smoke + Bill visual sign-off.

Roadmap already applied pre-Sub-1 (Bill 2026-05-18): D.U9 = weapon prefabs (was D.U8), D.U10 = UI fantasy polish (new), D.U11 = HLSL shaders (was D.U9), D.U12 = WebGL deploy LAST (was D.U10). ROADMAP.md + TASKS.md committed before Sub 1.
