# D.U9b — Weapon + Map polish · SUBTASKS

> 7 subs / 5 commits (Sub 1 + Sub 7 verify-only). Opus sequential auto-run.

---

## Sub 1 — Verify baseline (NO commit)

**Goal**: confirm assumptions before code + read API surfaces.

**Actions**:
1. `read_console types=["error"]` → baseline.
2. `Grep "BillTween\.Float"` Assets/ — confirm signature (with/without complete callback). Plan tween chain accordingly.
3. `Grep "PrefabUtility.SaveAsPrefabAsset"` Library/PackageCache or other Editor scripts in ArenaPK — confirm API available (Unity 6 has it under `UnityEditor` namespace).
4. `Glob "Assets/RadiantArena/Resources/**"` → expect 0 results (folder not yet existing).
5. Read `Assets/RadiantArena/Scripts/Juice/CameraShaker.cs` lines 40-50 — observe `BillTween.Float` + `BillTween.Kill` usage. Mirror style in JuicePresenter.PlayAnticipation.
6. Read `Assets/RadiantArena/Scripts/States/MyTurnState.cs` lines 60-65 — verify `OnShotReleased` signature + state-transition insertion point.

**Output**:
- ✅ console baseline (D.U9 already verified — should be 5 entries of D.U8 known baseline)
- BillTween.Float signature confirmed (chain via nested calls or completion cb)
- PrefabUtility.SaveAsPrefabAsset confirmed Unity 6 API
- MyTurnState.OnShotReleased line ~60-64 (3-line method) — clear insertion site

**DoD**: report. NO commit.

---

## Sub 2 — Editor Generator + 7 .prefab assets

**Goal**: persist D.U9 composite primitives as real `.prefab` assets.

### 2.1 Open `WeaponPrefabRegistry.cs` builders for Editor access

Change `static GameObject BuildThietCon()` (and 6 others) from `static` → `internal static` so the Editor generator can call them by FQN. Or add a sibling `internal static GameObject BuildForSlug(string slug)` that wraps the existing switch dispatcher minus the parent assignment.

Recommended: extract a public method `internal static GameObject CreateUnparented(string slug)` that contains the existing switch with `EnsureBaseMaterial()` + builder calls but does NOT do `SetParent`. Generator calls this, then `PrefabUtility.SaveAsPrefabAsset`, then `Destroy` the runtime instance.

### 2.2 `Assets/RadiantArena/Editor/ArenaWeaponPrefabGenerator.cs`

```csharp
#if UNITY_EDITOR
using System.IO;
using UnityEditor;
using UnityEngine;
using RadiantArena.Weapons;

namespace RadiantArena.EditorTools
{
    public static class ArenaWeaponPrefabGenerator
    {
        const string FolderPath = "Assets/RadiantArena/Resources/Weapons";

        static readonly string[] Slugs = new string[]
        {
            "weapon_thiet_con_01",
            "weapon_chuy_01",
            "weapon_kiem_01",
            "weapon_thiet_phien_01",
            "weapon_di_hoa_01",
            "weapon_le_bang_01",
            "_placeholder",
        };

        [MenuItem("Tools/RadiantArena/Generate Weapon Prefabs")]
        public static void Generate()
        {
            EnsureFolder();
            int count = 0;
            foreach (var slug in Slugs)
            {
                var runtime = WeaponPrefabRegistry.CreateUnparented(slug);
                if (runtime == null)
                {
                    Debug.LogWarning("[WeaponPrefabGen] Builder returned null for '" + slug + "', skipping");
                    continue;
                }
                runtime.name = slug;
                var path = FolderPath + "/" + slug + ".prefab";
                PrefabUtility.SaveAsPrefabAsset(runtime, path);
                Object.DestroyImmediate(runtime);
                count++;
            }
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("[WeaponPrefabGen] Generated " + count + " prefab(s) at " + FolderPath);
        }

        static void EnsureFolder()
        {
            if (!Directory.Exists(FolderPath))
            {
                Directory.CreateDirectory(FolderPath);
                AssetDatabase.Refresh();
            }
        }
    }
}
#endif
```

### 2.3 Run generator via MCP

```
mcp__unityMCP__execute_menu_item Tools/RadiantArena/Generate Weapon Prefabs
```

Then `refresh_unity` + `read_console types=["error"]` → 0.

`manage_asset action=search filterType=Prefab` → expect 7 `.prefab` matches under `Resources/Weapons/`.

**DoD**: 7 prefab files created. Console clean.

**Commit**: `feat(arena-unity/Lát-D.U9b): add ArenaWeaponPrefabGenerator + 7 weapon .prefab assets — fix D.U9 misnomer`

---

## Sub 3 — Migrate WeaponPrefabRegistry → Resources.Load + cache

**Goal**: `Spawn(slug)` returns Instantiated prefab clone, not composite-built GO.

### `Assets/RadiantArena/Scripts/Weapons/WeaponPrefabRegistry.cs`

Replace existing `Spawn` body + remove `EnsureBaseMaterial` + `WarnUnknown` runtime call from `Spawn` (keep `WarnUnknown` as utility for missing-prefab case).

```csharp
public static class WeaponPrefabRegistry
{
    static readonly System.Collections.Generic.Dictionary<string, GameObject> _prefabCache = new();
    static System.Collections.Generic.HashSet<string>? _warnedSlugs;

    public static GameObject Spawn(string slug, Transform parent)
    {
        if (!_prefabCache.TryGetValue(slug, out var prefab) || prefab == null)
        {
            prefab = Resources.Load<GameObject>("Weapons/" + slug);
            if (prefab == null)
            {
                WarnUnknown(slug);
                prefab = Resources.Load<GameObject>("Weapons/_placeholder");
            }
            _prefabCache[slug] = prefab;
        }
        var go = prefab != null ? Object.Instantiate(prefab) : new GameObject("WeaponRoot");
        go.name = "Weapon_" + slug;
        if (parent != null) go.transform.SetParent(parent, worldPositionStays: false);
        return go;
    }

    // Kept internal for ArenaWeaponPrefabGenerator + tests
    internal static GameObject CreateUnparented(string slug)
    {
        EnsureBaseMaterial();
        switch (slug)
        {
            case "weapon_thiet_con_01":   return BuildThietCon();
            case "weapon_chuy_01":        return BuildChuy();
            case "weapon_kiem_01":        return BuildKiem();
            case "weapon_thiet_phien_01": return BuildThietPhien();
            case "weapon_di_hoa_01":      return BuildDiHoa();
            case "weapon_le_bang_01":     return BuildLeBang();
            case "_placeholder":          return BuildPlaceholder();
            default: return null!;
        }
    }

    // EnsureBaseMaterial + builder methods stay (used by CreateUnparented only)
    // WarnUnknown stays (used by Spawn for missing prefab case)
    ...
}
```

**DoD**: compile clean. `Spawn` works via Resources.Load. Cache populated after first Spawn per slug.

**Commit**: `feat(arena-unity/Lát-D.U9b): migrate WeaponPrefabRegistry.Spawn — Resources.Load + cache (was switch-case factory)`

---

## Sub 4 — PlayerVisual position polish + aim-facing rotation

**Goal**: weapon held lateral right of capsule + rotates toward aim direction (mine) or toward me (opp).

### `Assets/RadiantArena/Scripts/Arena/PlayerVisual.cs` — edit

Replace `WeaponOffsetY` const with Vector3:
```csharp
static readonly Vector3 WeaponOffset = new Vector3(0.55f, 0.50f, 0f);
```

Add public getter for `_weaponGo`:
```csharp
public GameObject? WeaponGo => _weaponGo;
```

Add aim-angle tracking field + event subscription:
```csharp
float _latestAimAngleRad;
Action<RadiantArena.Events.AimUpdatedEvent>? _onAim;

void OnEnable()
{
    _onAim = e => _latestAimAngleRad = e.angle;
    BillGameCore.Bill.Events.Subscribe(_onAim);
}

void OnDisable()
{
    if (BillGameCore.Bill.IsReady && _onAim != null)
        BillGameCore.Bill.Events.Unsubscribe(_onAim);
    _onAim = null;
}
```

In `SyncFromContext`, after weapon spawn block, replace localPosition setter:
```csharp
_weaponGo.transform.localPosition = WeaponOffset;
```

Add new `LateUpdate` for per-frame rotation:
```csharp
void LateUpdate()
{
    if (_weaponGo == null) return;
    if (IsMine)
    {
        // Aim angle is radians on XZ plane (Atan2(z, x) — D.U4 convention).
        float deg = _latestAimAngleRad * Mathf.Rad2Deg;
        _weaponGo.transform.localRotation = Quaternion.Euler(0f, -deg, 0f);
        // -deg because Unity Y-rotation increases clockwise when viewed from above;
        // aim angle convention is counter-clockwise positive. Verify in smoke.
    }
    else
    {
        // Opp weapon faces my player.
        var other = RadiantArena.Arena.ArenaSceneBuilder.Instance?.MyVisual;
        if (other != null)
        {
            var dir = other.transform.position - transform.position;
            dir.y = 0f;
            if (dir.sqrMagnitude > 0.0001f)
                _weaponGo.transform.rotation = Quaternion.LookRotation(dir);
        }
    }
}
```

**DoD**: compile clean. Weapon visible to right of capsule at Y=0.5. Rotation tracks aim during drag.

**Commit**: `feat(arena-unity/Lát-D.U9b): PlayerVisual lateral weapon offset + aim-facing rotation (mine→AimUpdated, opp→LookAt me)`

---

## Sub 5 — JuicePresenter.PlayAnticipation + MyTurnState integration

**Goal**: 80ms scale-up scale-down on weapon before shot fires + state transition.

### 5.1 `Assets/RadiantArena/Scripts/Juice/JuicePresenter.cs` — add method

```csharp
const float AnticipationDurSec = 0.08f;
const float AnticipationScale = 1.15f;

public static void PlayAnticipation(GameObject? weapon, Action onComplete)
{
    if (Instance == null || weapon == null)
    {
        onComplete?.Invoke();
        return;
    }
    Instance.StartAnticipationCoroutine(weapon, onComplete);
}

void StartAnticipationCoroutine(GameObject weapon, Action onComplete)
{
    var t = weapon.transform;
    var origScale = t.localScale;
    var maxScale = origScale * AnticipationScale;

    // Scale up 50% of duration, scale down 50%.
    float half = AnticipationDurSec * 0.5f;

    BillTween.KillTarget(t);
    BillTween.Float(0f, 1f, half, p =>
    {
        if (t == null) return;
        t.localScale = Vector3.Lerp(origScale, maxScale, p);
    }, () =>
    {
        BillTween.Float(0f, 1f, half, p =>
        {
            if (t == null) return;
            t.localScale = Vector3.Lerp(maxScale, origScale, p);
        }, () =>
        {
            if (t != null) t.localScale = origScale;
            onComplete?.Invoke();
        });
    });
}
```

(If `BillTween.Float` does not take a completion callback, use `Bill.Time.Delay(half, () => ...)` or coroutine. Sub 1 verifies which.)

### 5.2 `Assets/RadiantArena/Scripts/States/MyTurnState.cs` — edit

Replace `OnShotReleased`:
```csharp
void OnShotReleased(ShotReleasedEvent e)
{
    Debug.Log($"[Arena.MyTurn] shot fired angle={e.angle:F2} power={e.power:F2}");
    var weapon = RadiantArena.Arena.ArenaSceneBuilder.Instance?.MyVisual?.WeaponGo;
    Action proceed = () =>
    {
        NetClient.Instance?.Send("shoot", new ShootMsg { angle = e.angle, power = e.power });
        Bill.State.GoTo<AnimatingState>();
    };
    if (weapon != null)
        RadiantArena.Juice.JuicePresenter.PlayAnticipation(weapon, proceed);
    else
        proceed();
}
```

**DoD**: compile clean. Drag-release → 80ms pulse → state transition.

**Commit**: `feat(arena-unity/Lát-D.U9b): add JuicePresenter.PlayAnticipation + MyTurnState defers shot 80ms with weapon pulse`

---

## Sub 6 — ArenaSceneBuilder map polish

**Goal**: Directional Light + ambient color + wall trim caps. Optional corner pillars.

### `Assets/RadiantArena/Scripts/Arena/ArenaSceneBuilder.cs` — edit

Inside `Awake` (or extract `BuildLighting` / `BuildWallTrim` helpers):

```csharp
// Lighting
var lightGo = new GameObject("ArenaKeyLight");
lightGo.transform.SetParent(transform);
lightGo.transform.position = new Vector3(50f, 50f, 50f);
lightGo.transform.rotation = Quaternion.Euler(50f, -30f, 0f);
var light = lightGo.AddComponent<Light>();
light.type = LightType.Directional;
light.intensity = 1.0f;
light.color = new Color(1.0f, 0.96f, 0.88f); // soft warm key
light.shadows = LightShadows.Soft;

RenderSettings.ambientLight = new Color(0.30f, 0.32f, 0.40f);

// Wall trim caps (4 caps, one per wall, slightly lighter)
var trimColor = new Color(0.30f, 0.32f, 0.40f);
var wallTopY = 1.0f; // wall height — confirm from existing wall spawn config

void AddTrimCap(Vector3 center, Vector3 scale)
{
    var cap = GameObject.CreatePrimitive(PrimitiveType.Cube);
    cap.name = "WallTrim";
    cap.transform.SetParent(transform);
    cap.transform.position = center;
    cap.transform.localScale = scale;
    var col = cap.GetComponent<Collider>();
    if (col != null) Destroy(col);
    var r = cap.GetComponent<MeshRenderer>();
    var shader = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Color");
    var mat = new Material(shader);
    mat.color = trimColor;
    r.sharedMaterial = mat;
}

// Top + bottom (along X axis, full arena width)
AddTrimCap(new Vector3(0f, wallTopY + 0.05f,  5f), new Vector3(10f, 0.05f, 0.3f));
AddTrimCap(new Vector3(0f, wallTopY + 0.05f, -5f), new Vector3(10f, 0.05f, 0.3f));
// Left + right (along Z axis, full arena depth)
AddTrimCap(new Vector3( 5f, wallTopY + 0.05f, 0f), new Vector3(0.3f, 0.05f, 10f));
AddTrimCap(new Vector3(-5f, wallTopY + 0.05f, 0f), new Vector3(0.3f, 0.05f, 10f));
```

(Reference existing wall spawn block in current file for actual `wallTopY` constant.)

Optional corner pillars (skip if visual feels heavy):
```csharp
float pillarH = 1.6f;
foreach (var pos in new[] { new Vector3(5f, pillarH/2f, 5f), new Vector3(-5f, pillarH/2f, 5f), new Vector3(5f, pillarH/2f, -5f), new Vector3(-5f, pillarH/2f, -5f) })
{
    var p = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
    p.name = "CornerStone";
    p.transform.SetParent(transform);
    p.transform.position = pos;
    p.transform.localScale = new Vector3(0.25f, pillarH/2f, 0.25f);
    var col = p.GetComponent<Collider>();
    if (col != null) Destroy(col);
    var r = p.GetComponent<MeshRenderer>();
    var s = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Color");
    var m = new Material(s);
    m.color = new Color(0.20f, 0.22f, 0.30f);
    r.sharedMaterial = m;
}
```

**DoD**: compile clean. Scene renders with Directional Light shadow + wall trim visible from top-down + ambient color.

**Commit**: `feat(arena-unity/Lát-D.U9b): ArenaSceneBuilder map polish — Directional Light + ambient + wall trim caps`

---

## Sub 7 — Mock smoke + Bill visual sign-off (NO commit)

**Pre**: stop/start Play. `compiler: codedom`. Bootstrap.unity active.

### 7.1 Mock smoke

1. `read_console clear` + `refresh_unity force scope=all` → wait ready.
2. `manage_asset action=search filterType=Prefab` `Resources/Weapons` → 7 prefabs.
3. Play mode start.
4. Setup state via execute_code: `ArenaStates.Register()`, `MyDiscordId="me"`, snapshots, `LockedWeapon=weapon_kiem_01`, `GoTo<MyTurnState>`.
5. Reflection probe:
   - `MyVisual.WeaponGo != null` ✓
   - `WeaponGo.transform.localPosition` = `(0.55, 0.50, 0)` ✓
   - `WeaponGo.name` = `Weapon_weapon_kiem_01` ✓
   - Spawned via Instantiate (not CreatePrimitive runtime) — check `PrefabUtility.GetPrefabAssetType` on the source. Or check that `WeaponPrefabRegistry._prefabCache.Count` > 0 (reflection on private static field).
6. Drive `AimUpdatedEvent { angle = 0.785f, power = 1.0f }` (45 deg). Wait 1 frame. Probe `WeaponGo.transform.localRotation.eulerAngles.y` ≈ -45 deg (or +45, verify sign convention).
7. Fire `ShotReleasedEvent { angle, power }`. Console log "[Arena.MyTurn] shot fired" + 80ms later state transitions to Animating. During pulse, `WeaponGo.localScale` momentarily > original.
8. Stop Play. `read_console types=["error"]` → 0 new.

### 7.2 Bill visual sign-off

1. Bootstrap → Play → `ArenaDevMenu > Mock to MyTurn` (or execute_code recipe).
2. Bill sees green capsule with weapon HELD to its right (not above).
3. Drag aim — weapon rotates following aim direction.
4. Release — weapon pulses (1.0→1.15→1.0 over 80ms), then state goes Animating.
5. Map reads atmospheric: walls have shadow gradient from Directional Light, trim caps visible.

Sign-off → close D.U9b, move folder. **Only after explicit visual sign-off — lesson from D.U9 premature move.**

---

## DoD overall (D.U9b close)

- [ ] Sub 1 baseline verified.
- [ ] Sub 2 Generator + 7 .prefab files landed.
- [ ] Sub 3 Registry migration to Resources.Load.
- [ ] Sub 4 PlayerVisual position + rotation.
- [ ] Sub 5 Anticipation pulse + MyTurnState defer.
- [ ] Sub 6 Map polish (Light + ambient + trim).
- [ ] Sub 7 Mock smoke + Bill visual sign-off.

Next: D.U10 UI fantasy polish.
