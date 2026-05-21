# D.U9 — Weapon prefab catalog · SUBTASKS

> 5 subs / 4 commits (Sub 1 + Sub 5 verify-only). Opus sequential auto-run.

---

## Sub 1 — Verify baseline (NO commit)

**Goal**: confirm assumptions before code.

**Actions**:
1. `read_console types=["error"]` → baseline.
2. `Grep "_BaseColor"` Library/PackageCache or Assets/BillGameCore → confirm URP/Unlit uses `_BaseColor` (vs legacy `_Color`).
3. `Grep "WeaponSnapshot"` Assets/RadiantArena → confirm fields (Slug, Hue) are accessible publicly from PlayerVisual scope.
4. `Grep "GetPropertyBlock"` Assets/RadiantArena → confirm no prior MPB consumer (we'd be first).
5. `Grep "MaterialPropertyBlock"` Assets/BillGameCore → record any framework helpers (skip if Bill provides one).

**Output**:
- ✅ console baseline
- URP property name confirmed (`_BaseColor` or `_Color`)
- WeaponSnapshot.Slug/Hue public ✅/❌
- No prior MPB consumer ✅/❌

**DoD**: report. NO commit.

---

## Sub 2 — WeaponPrefabRegistry.cs

**Goal**: runtime composite primitive factory, 6 weapons + placeholder.

### `Assets/RadiantArena/Scripts/Weapons/WeaponPrefabRegistry.cs`

```csharp
#nullable enable
using UnityEngine;

namespace RadiantArena.Weapons
{
    /// <summary>
    /// Runtime composite primitive factory. Slug → GameObject built from Unity
    /// primitives parented to a "WeaponRoot" empty. No .prefab assets — keeps
    /// version control clean while we're in placeholder phase. Real FBX models
    /// + materials replace per-method bodies when D.U12 / future asset pass ships.
    ///
    /// All composite primitives have Colliders dropped (visual-only, server is
    /// authoritative on collisions).
    /// </summary>
    public static class WeaponPrefabRegistry
    {
        static Material? _baseMat;
        static System.Collections.Generic.HashSet<string>? _warnedSlugs;

        /// <summary>
        /// Spawn a weapon prefab parented to the given transform. Returns the
        /// root GameObject. Unknown slugs return the placeholder (grey sphere)
        /// and log a one-time warning.
        /// </summary>
        public static GameObject Spawn(string slug, Transform parent)
        {
            EnsureBaseMaterial();
            GameObject root;
            switch (slug)
            {
                case "weapon_thiet_con_01":   root = BuildThietCon();   break;
                case "weapon_chuy_01":        root = BuildChuy();       break;
                case "weapon_kiem_01":        root = BuildKiem();       break;
                case "weapon_thiet_phien_01": root = BuildThietPhien(); break;
                case "weapon_di_hoa_01":      root = BuildDiHoa();      break;
                case "weapon_le_bang_01":     root = BuildLeBang();     break;
                default:
                    WarnUnknown(slug);
                    root = BuildPlaceholder();
                    break;
            }
            root.name = "Weapon_" + slug;
            if (parent != null) root.transform.SetParent(parent, worldPositionStays: false);
            return root;
        }

        static void EnsureBaseMaterial()
        {
            if (_baseMat != null) return;
            var shader = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Color");
            _baseMat = new Material(shader);
            _baseMat.color = new Color(0.85f, 0.85f, 0.90f);
        }

        static void WarnUnknown(string slug)
        {
            if (_warnedSlugs == null) _warnedSlugs = new System.Collections.Generic.HashSet<string>();
            if (_warnedSlugs.Contains(slug)) return;
            _warnedSlugs.Add(slug);
            Debug.LogWarning("[Weapons] unknown slug '" + slug + "' — spawning placeholder");
        }

        // ───── Builders ──────────────────────────────────────────────────────

        static GameObject NewRoot()
        {
            return new GameObject("WeaponRoot");
        }

        static GameObject AddPrim(GameObject root, PrimitiveType type, Vector3 localPos, Vector3 localScale, Quaternion? rot = null)
        {
            var go = GameObject.CreatePrimitive(type);
            go.transform.SetParent(root.transform, worldPositionStays: false);
            go.transform.localPosition = localPos;
            go.transform.localScale = localScale;
            if (rot.HasValue) go.transform.localRotation = rot.Value;
            var col = go.GetComponent<Collider>();
            if (col != null) Object.Destroy(col);
            var r = go.GetComponent<MeshRenderer>();
            if (r != null && _baseMat != null) r.sharedMaterial = _baseMat;
            return go;
        }

        static GameObject BuildThietCon()
        {
            // Iron staff — long thin horizontal cylinder.
            var root = NewRoot();
            AddPrim(root, PrimitiveType.Cylinder,
                Vector3.zero,
                new Vector3(0.08f, 0.5f, 0.08f),
                Quaternion.Euler(0f, 0f, 90f)); // rotate cylinder to horizontal
            return root;
        }

        static GameObject BuildChuy()
        {
            // Mace — short handle + ball head.
            var root = NewRoot();
            AddPrim(root, PrimitiveType.Cylinder,
                new Vector3(-0.1f, 0f, 0f),
                new Vector3(0.06f, 0.25f, 0.06f),
                Quaternion.Euler(0f, 0f, 90f));
            AddPrim(root, PrimitiveType.Sphere,
                new Vector3(0.25f, 0f, 0f),
                Vector3.one * 0.22f);
            return root;
        }

        static GameObject BuildKiem()
        {
            // Sword — flat blade + small handle.
            var root = NewRoot();
            // blade
            AddPrim(root, PrimitiveType.Cube,
                new Vector3(0.15f, 0f, 0f),
                new Vector3(0.55f, 0.04f, 0.10f));
            // hilt
            AddPrim(root, PrimitiveType.Cube,
                new Vector3(-0.18f, 0f, 0f),
                new Vector3(0.10f, 0.06f, 0.16f));
            return root;
        }

        static GameObject BuildThietPhien()
        {
            // Iron fan — flat wide.
            var root = NewRoot();
            AddPrim(root, PrimitiveType.Cube,
                Vector3.zero,
                new Vector3(0.45f, 0.03f, 0.30f));
            return root;
        }

        static GameObject BuildDiHoa()
        {
            // Exotic flower — 3 spheres clustered.
            var root = NewRoot();
            AddPrim(root, PrimitiveType.Sphere, new Vector3( 0.00f, 0f,  0.00f), Vector3.one * 0.16f);
            AddPrim(root, PrimitiveType.Sphere, new Vector3( 0.15f, 0f,  0.08f), Vector3.one * 0.12f);
            AddPrim(root, PrimitiveType.Sphere, new Vector3(-0.10f, 0f, -0.12f), Vector3.one * 0.14f);
            return root;
        }

        static GameObject BuildLeBang()
        {
            // Ice/frost — 3 thin cylinders fanning out (icicles).
            var root = NewRoot();
            AddPrim(root, PrimitiveType.Cylinder, new Vector3( 0.00f, 0f, 0f), new Vector3(0.05f, 0.20f, 0.05f), Quaternion.Euler(0f, 0f, 90f));
            AddPrim(root, PrimitiveType.Cylinder, new Vector3(-0.05f, 0f, 0.10f), new Vector3(0.04f, 0.16f, 0.04f), Quaternion.Euler(20f, 0f, 90f));
            AddPrim(root, PrimitiveType.Cylinder, new Vector3(-0.05f, 0f,-0.10f), new Vector3(0.04f, 0.16f, 0.04f), Quaternion.Euler(-20f, 0f, 90f));
            return root;
        }

        static GameObject BuildPlaceholder()
        {
            // Grey sphere fallback.
            var root = NewRoot();
            AddPrim(root, PrimitiveType.Sphere, Vector3.zero, Vector3.one * 0.20f);
            return root;
        }
    }
}
```

**DoD**: compile clean.

**Commit**: `feat(arena-unity/Lát-D.U9): add WeaponPrefabRegistry — runtime composite primitive factory (6 catalog + placeholder)`

---

## Sub 3 — WeaponHueApplier.cs

**Goal**: hex string → MaterialPropertyBlock tint across all MeshRenderers.

### `Assets/RadiantArena/Scripts/Weapons/WeaponHueApplier.cs`

```csharp
#nullable enable
using UnityEngine;

namespace RadiantArena.Weapons
{
    /// <summary>
    /// Apply a hex color tint to every MeshRenderer under a weapon root via
    /// MaterialPropertyBlock — zero GC alloc, no shader variant explosion.
    /// </summary>
    public static class WeaponHueApplier
    {
        static readonly int _baseColorId = Shader.PropertyToID("_BaseColor"); // URP
        static readonly int _legacyColorId = Shader.PropertyToID("_Color");   // legacy Unlit
        static MaterialPropertyBlock? _mpb;

        public static void Apply(GameObject root, string hex)
        {
            if (root == null) return;
            if (string.IsNullOrEmpty(hex)) return; // no tint = leave default

            string h = hex.StartsWith("#") ? hex : "#" + hex;
            if (!ColorUtility.TryParseHtmlString(h, out var color))
            {
                Debug.LogWarning("[Weapons.Hue] could not parse hex '" + hex + "' — skipping tint");
                return;
            }

            if (_mpb == null) _mpb = new MaterialPropertyBlock();
            var renderers = root.GetComponentsInChildren<MeshRenderer>(includeInactive: true);
            foreach (var r in renderers)
            {
                r.GetPropertyBlock(_mpb);
                _mpb.SetColor(_baseColorId,   color);
                _mpb.SetColor(_legacyColorId, color);
                r.SetPropertyBlock(_mpb);
            }
        }
    }
}
```

**DoD**: compile clean.

**Commit**: `feat(arena-unity/Lát-D.U9): add WeaponHueApplier — MaterialPropertyBlock hex tint across weapon hierarchy`

---

## Sub 4 — PlayerVisual extension (detect LockedWeapon.Slug change → spawn/destroy)

**Goal**: PlayerVisual now also manages a weapon child.

### `Assets/RadiantArena/Scripts/Arena/PlayerVisual.cs` — edit

Add fields next to existing `_accumMs`/`_capsuleY`:

```csharp
string _currentWeaponSlug = "";
GameObject? _weaponGo;
const float WeaponOffsetY = 0.8f;
```

Extend `SyncFromContext` — add at the end, after the existing position-update block:

```csharp
// Weapon attachment — track LockedWeapon.Slug changes; spawn/destroy as needed.
var locked = p.LockedWeapon;
string newSlug = locked != null ? (locked.Slug ?? "") : "";
if (newSlug != _currentWeaponSlug)
{
    if (_weaponGo != null)
    {
        UnityEngine.Object.Destroy(_weaponGo);
        _weaponGo = null;
    }
    _currentWeaponSlug = newSlug;
    if (!string.IsNullOrEmpty(newSlug))
    {
        _weaponGo = Weapons.WeaponPrefabRegistry.Spawn(newSlug, transform);
        _weaponGo.transform.localPosition = new Vector3(0f, WeaponOffsetY, 0f);
        if (locked != null) Weapons.WeaponHueApplier.Apply(_weaponGo, locked.Hue ?? "");
        Debug.Log("[Arena.PlayerVisual] " + (IsMine ? "me" : "opp") + " spawned weapon=" + newSlug + " hue=" + (locked != null ? locked.Hue : ""));
    }
}
```

Also note: when player snapshot becomes null (Reset/disconnect), the early-return at top of SyncFromContext keeps the weapon alive — that's fine since the capsule itself is still alive at SlotAnchor.

If we want to clean up weapon on null snapshot, add at the top of SyncFromContext (inside the `if (p == null)` block):

```csharp
if (_weaponGo != null) { UnityEngine.Object.Destroy(_weaponGo); _weaponGo = null; _currentWeaponSlug = ""; }
```

**DoD**: compile clean.

**Commit**: `feat(arena-unity/Lát-D.U9): PlayerVisual spawns weapon via WeaponPrefabRegistry on LockedWeapon.Slug change + applies hue`

---

## Sub 5 — Mock smoke + Bill visual sign-off (NO commit)

**Pre**: stop/start Play. `compiler: codedom`. Bootstrap.unity active.

### Mock smoke

1. `read_console clear`.
2. Drive into Countdown (HUD + DamageNumberLayer open, scene builder ready).
3. Inject `MyPlayer.LockedWeapon` = `{ Slug="weapon_kiem_01", Hue="#aaffaa" }` (via reflection to set Property on PlayerSnapshot, or build new PlayerSnapshot). Inject `OpponentPlayer.LockedWeapon` = `{ Slug="weapon_chuy_01", Hue="#ffaa88" }`.
4. Wait 0.2s (PlayerVisual 100ms poll catches the slug change).
5. Probe `MyVisual.transform.childCount` → expect 1 child named "Weapon_weapon_kiem_01".
6. Walk first MeshRenderer's MaterialPropertyBlock — `_BaseColor` should be `#aaffaa` parsed.
7. Swap MyPlayer.LockedWeapon to slug "weapon_thiet_con_01" + hue "#ffeecc". Wait 0.2s. Probe: child name changed to "Weapon_weapon_thiet_con_01", MPB color updated.
8. Set MyPlayer.LockedWeapon = null. Wait 0.2s. Probe: childCount = 0 (or weapon Destroyed in deferred frame).
9. Swap to invalid slug "weapon_invalid_xyz". Wait 0.2s. Probe: child = placeholder (sphere child only).
10. Stop Play. `read_console types=["error"]` → 0.

### Bill visual sign-off

1. Bootstrap.unity active + Play.
2. Drive to Countdown via mock recipe.
3. Bill sees green capsule with sword above it (weapon_kiem_01) + orange capsule with mace (weapon_chuy_01).
4. Hue tints visible (green tint on me's sword, orange tint on opp's mace).
5. Optional: paste slug swap snippet to test all 6 catalog visually.

Sign-off → close D.U9.

**NO commit**. REPORT.md follows.

---

## DoD overall (D.U9 close)

- [ ] Sub 1 baseline verified.
- [ ] Sub 2 WeaponPrefabRegistry landed (6 weapons + placeholder).
- [ ] Sub 3 WeaponHueApplier landed.
- [ ] Sub 4 PlayerVisual extended.
- [ ] Sub 5 mock smoke + Bill visual sign-off.

Next: D.U10 UI fantasy polish.
