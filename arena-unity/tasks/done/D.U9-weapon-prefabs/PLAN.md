# D.U9 — Weapon prefab catalog · PLAN

> Stage 1 (Architect). Opus sequential auto-run per D.U4-D.U8 precedent.
> Date: 2026-05-18 · Executor: Opus 4.7.

---

## 1. Goal

Each weapon visually distinct on the capsule. When `PlayerSnapshot.LockedWeapon.Slug` becomes non-empty (server locks weapon at countdown→active transition), `PlayerVisual` spawns the matching weapon prefab as a child of the capsule + applies `WeaponHueApplier` for server-sent hue. 6 catalog weapons + 1 `_placeholder` fallback for unknown slugs.

Aligned with `RADIANT_ARENA_UNITY.md` §8 weapon spec + `WeaponSnapshot` already populated by D.U3.

---

## 2. Scope

| Item | Status | Notes |
|---|---|---|
| `WeaponPrefabRegistry.cs` (runtime composite factory) | ✅ GO | Static `Spawn(slug, parent) → GameObject`. Each slug builds a small composite of Unity primitives (Cube/Cylinder/Sphere). `_placeholder` = grey sphere. No `.prefab` asset files — runtime spawn keeps version control clean. |
| 6 catalog weapons | ✅ GO | Distinct primitive shapes per spec: thiet_con (long cylinder), chuy (sphere on stick), kiem (flat blade), thiet_phien (flat fan), di_hoa (cluster), le_bang (icicles). |
| `_placeholder` fallback | ✅ GO | Grey sphere for unknown slug. Logged once per slug. |
| `WeaponHueApplier.cs` (static utility) | ✅ GO | `Apply(GameObject root, string hex)` — parse `#rrggbb` → Color → MaterialPropertyBlock on every MeshRenderer in the hierarchy. |
| `PlayerVisual.cs` extension | ✅ GO | Track `_currentWeaponSlug` + `_weaponGo` refs. On poll: if `LockedWeapon.Slug` differs → destroy old `_weaponGo` + spawn via Registry + apply hue + reparent to capsule. |
| Weapon offset on capsule | ✅ GO | Spawn at capsule.transform.position + `(0, 0.8, 0)` (above capsule center, visible from top-down ortho). |
| Mock smoke (no server) | ✅ GO | execute_code injects `LockedWeapon` per slug → confirm Registry returns correct shape + hue applied (probe MaterialPropertyBlock color). |
| **OUT OF SCOPE — defer** | | |
| Anticipation pulse (weapon scale 1.0→1.15 before release) | ❌ D.U7b | Now unblocked but stays in juice Lát. |
| Weapon facing aim direction during drag-aim | ❌ Future polish | D.U10 or D.U12. |
| Real `.prefab` assets with FBX models / textures / particles | ❌ Future asset pass | Placeholder primitives sufficient for "see two sides clashing" milestone. |
| Bản mệnh (signature weapon) special FX | ❌ D.U12 / future | All 6 catalog use generic placeholder shapes; hue distinguishes them per Discord ID for bản mệnh. |
| WeaponDatabase ScriptableObject | ❌ Future | Today's registry is hardcoded slug→method dispatch. SO comes when designers tune. |
| Server-driven weapon swap mid-match | ❌ Out of design | Server locks at countdown; no mid-match swap. |

---

## 3. Project state (verified 2026-05-18)

- ✅ `WeaponSnapshot` populated by D.U3 `ArenaContext.PlayerSnapshot(PlayerSchema)` ctor — fields: `Slug, DisplayName, Category, Tier, Hue`.
- ✅ `PlayerSnapshot.LockedWeapon` is non-null after server clones `available_weapons[selected_weapon_slug]` into `PlayerSchema.weapon` at countdown→active. Today's mock smoke sets `LockedWeapon = null` initially; weapon spawn triggers when injected.
- ✅ `PlayerVisual` already polls `ArenaContext` every 100ms — natural place to add weapon-slug-change detection. No additional MonoBehaviour needed.
- ✅ Capsule transform = `(slot anchor X, 0.5, 0)`. Weapon spawned at `transform.position + (0, 0.8, 0)` → world Y=1.3, visible above capsule top for top-down ortho camera at Y=10.
- ✅ Top-down ortho camera + 10×10 arena established by D.U8.
- ✅ URP/Unlit material pattern (with `Unlit/Color` fallback) proven in D.U5 + D.U7 + D.U8.
- ⚠️ `WeaponSnapshot.Hue` may be empty string when bản mệnh weapons not yet hue-resolved. WeaponHueApplier handles empty as "no tint" (skip).
- ⚠️ Slugs in spec: `weapon_thiet_con_01 / weapon_chuy_01 / weapon_kiem_01 / weapon_thiet_phien_01 / weapon_di_hoa_01 / weapon_le_bang_01`. Bản mệnh use these + custom hue.

---

## 4. Files this Lát will touch

| Path | Action | Purpose |
|---|---|---|
| `Assets/RadiantArena/Scripts/Weapons/WeaponPrefabRegistry.cs` | CREATE | Static factory. Slug → composite primitive. 6 catalog methods + placeholder. |
| `Assets/RadiantArena/Scripts/Weapons/WeaponHueApplier.cs` | CREATE | Static utility. Hex string parse + MaterialPropertyBlock tint across hierarchy. |
| `Assets/RadiantArena/Scripts/Arena/PlayerVisual.cs` | EDIT | Add weapon spawn loop inside `SyncFromContext`. Track current slug + weapon GO ref. Destroy/respawn on slug change. |

**No** scene edits, no asset imports, no new MonoBehaviour spawned. All extensions plug into existing PlayerVisual lifecycle.

---

## 5. APIs used

### 5.1 Unity
- `GameObject.CreatePrimitive(PrimitiveType.{Cube,Cylinder,Sphere})` — composite weapon shapes.
- `Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Color")` — runtime materials.
- `MeshRenderer.GetPropertyBlock` / `SetPropertyBlock` — MaterialPropertyBlock tint per-renderer.
- `ColorUtility.TryParseHtmlString(hex, out Color)` — hex parsing.
- `transform.SetParent(weaponRoot, worldPositionStays: false)` — attach to capsule.

### 5.2 RadiantArena
- `ArenaContext.MyPlayer/OpponentPlayer.LockedWeapon.Slug` — weapon identity.
- `ArenaContext.MyPlayer/OpponentPlayer.LockedWeapon.Hue` — hue color hex.
- `PlayerVisual` extended.

---

## 6. Architecture decisions

### 6.1 Runtime composite primitives, NOT `.prefab` assets
- No `.prefab` files. Each weapon = small in-code factory method that creates 1-3 primitives parented to a root `WeaponRoot` GameObject.
- Pros: no asset file diff, no `Resources/` folder for prefabs, version control clean, easy to add new weapons (one method per slug).
- Cons: not designer-friendly — when artist drops in FBX model, need to migrate to prefab-based registry. Acceptable for D.U9 placeholder.

### 6.2 Slug → method dispatch (no ScriptableObject)
`WeaponPrefabRegistry.Spawn(string slug, Transform parent)` uses a switch statement. 7 cases (6 weapons + default placeholder). Easy to add new slugs — one new method + switch case.

D.U12 (or whenever assets arrive) can swap this for `WeaponDatabase` ScriptableObject with per-slug FBX + material references.

### 6.3 WeaponHueApplier uses MaterialPropertyBlock, not material instance
- Avoids creating per-spawn material instances (zero GC alloc + zero shader variant explosion).
- `_BaseColor` property name for URP/Unlit. Fallback `_Color` for legacy Unlit/Color shader.
- Empty/null hex → no tint applied (leave default white).

### 6.4 PlayerVisual detects weapon change via slug compare
```csharp
string newSlug = locked?.Slug ?? "";
if (newSlug != _currentWeaponSlug) {
    if (_weaponGo != null) Destroy(_weaponGo);
    _currentWeaponSlug = newSlug;
    if (!string.IsNullOrEmpty(newSlug)) {
        _weaponGo = WeaponPrefabRegistry.Spawn(newSlug, transform);
        _weaponGo.transform.localPosition = new Vector3(0, 0.8f, 0);
        WeaponHueApplier.Apply(_weaponGo, locked.Hue);
    }
}
```
Runs every 100ms poll alongside position update. Cheap when no change.

### 6.5 Weapon parented to capsule transform — moves with capsule
When capsule moves (server position update), weapon follows. No separate motion logic.

### 6.6 Weapon offset = (0, 0.8, 0) local — above capsule
For top-down ortho camera, weapon visible above capsule center. Y=0.8 places weapon above the capsule top (capsule centered at Y=0.5 with height 1 → top at Y=1). Weapon root at Y=1.3 → composite shapes radiate from there.

Future polish (D.U10 / D.U12) can orient weapon based on aim direction or animate idle bobbing.

### 6.7 Bản mệnh (signature) weapons use catalog prefab + custom hue
Server's `weapon.visual.hue` is the only differentiator for bản mệnh. WeaponHueApplier tints the whole prefab — Discord ID determines hue offset (server-side). Client just renders what the server says.

### 6.8 Composite weapon shapes (placeholder design)

| Slug | Composition | Notes |
|---|---|---|
| `weapon_thiet_con_01` | 1 long horizontal Cylinder (length ~1.0, radius 0.06) | Iron staff |
| `weapon_chuy_01` | 1 short Cylinder (handle) + 1 Sphere head | Mace |
| `weapon_kiem_01` | 1 flat scaled Cube (length 1.0, thin) + 1 small handle Cube | Sword blade |
| `weapon_thiet_phien_01` | 1 flat Cube scaled wide + thin | Iron fan |
| `weapon_di_hoa_01` | 3 Spheres clustered (smaller) | Exotic flower |
| `weapon_le_bang_01` | 3 thin Cylinders fanning out (icicles) | Ice/frost weapon |
| `_placeholder` | 1 grey Sphere | Fallback |

Default scale: ~0.3-0.6 world units. Visible at ortho size 6.

### 6.9 Drop weapon colliders
All composite primitives → drop default Collider. Server is authoritative on collision; visuals don't interact physically. Same pattern as walls + capsules in D.U8.

---

## 7. MCP touchpoints

| Step | Tool |
|---|---|
| Write .cs | `Write` |
| Force-refresh (new folder) | `mcp__unityMCP__refresh_unity scope=all mode=force` |
| Console check | `read_console types=["error"]` |
| Mock smoke | `execute_code compiler=codedom` — inject LockedWeapon per slug, probe spawned GO + hue |
| Verify weapon spawned + tinted | reflection probe on `MyVisual` child count + MeshRenderer.GetPropertyBlock |

No scene/asset MCP ops.

---

## 8. Smoke test plan

### 8.1 Per-sub compile gate
`refresh_unity` + `read_console types=["error"]` empty after each Write.

### 8.2 Mock smoke (Sub 5)

**Pre**: stop/start Play. `compiler: codedom`. Bootstrap.unity loaded.

Actions:
1. read_console clear.
2. Drive context to phase=active with my LockedWeapon = `{ Slug="weapon_kiem_01", Hue="#aaffaa" }`. Opp LockedWeapon = `{ Slug="weapon_chuy_01", Hue="#ffaa88" }`.
3. Wait 0.2s (PlayerVisual poll).
4. Probe `ArenaSceneBuilder.Instance.MyVisual.transform` → expect 1 child named "Weapon_..." (or whatever WeaponPrefabRegistry assigns).
5. Probe that child's MeshRenderer.GetPropertyBlock("_BaseColor") → should be `#aaffaa` parsed color.
6. Swap MyPlayer.LockedWeapon to `weapon_thiet_con_01` with different hue. Wait 0.2s. Probe: child name changed, old destroyed, new color applied.
7. Swap to unknown slug "weapon_invalid_99". Wait 0.2s. Probe: child = placeholder sphere.
8. Stop Play. `read_console types=["error"]` → 0.

### 8.3 Bill visual sign-off
Open Bootstrap.unity + Play. Drive to Countdown via mock recipe. See:
- Green capsule has its weapon shape above it (whichever slug Bill injects)
- Orange capsule has its weapon shape
- Color tints visible per hue
- Capsules move (if server position later) → weapons follow

If visual feels right, close D.U9.

---

## 9. Bill checkpoints

| After Sub | Checkpoint |
|---|---|
| Sub 2 (Registry) | Optional review of placeholder shape choices — Bill can swap primitives if not visually distinct. |
| Sub 3 (HueApplier) | Confirm MaterialPropertyBlock pattern OK + URP `_BaseColor` property name. |
| Sub 5 (smoke) | Mock probes pass + Bill visual sign-off. |

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| URP/Unlit `_BaseColor` property name varies per Unity/URP version | Try `_BaseColor` first, fallback `_Color`. Log if neither found. |
| `ColorUtility.TryParseHtmlString` rejects hex without `#` prefix | Defensive: prepend `#` if missing, fail-soft to default white. |
| Multiple primitives per weapon = multiple MeshRenderers — hue applies to all | WeaponHueApplier walks `GetComponentsInChildren<MeshRenderer>(includeInactive=true)`. |
| Destroying old weapon GO mid-frame leaks Tween subscribers | We don't tween weapons in D.U9. D.U7b anticipation tween will need `BillTween.KillTarget(weaponGo)` before destroy. Documented. |
| Weapon offset (0, 0.8, 0) might clip with capsule top at certain ortho sizes | Acceptable for placeholder. Bill can tune `WeaponOffsetY` constant in PlayerVisual. |
| LockedWeapon = null during lobby/countdown but populated at active | PlayerVisual: when LockedWeapon == null, destroy any existing weapon GO. Slug change from "" → real slug spawns; real → "" destroys. |
| 100ms poll latency on weapon swap | Acceptable — gameplay weapon doesn't swap mid-match. |
| WeaponSnapshot.Hue empty string → no tint | WeaponHueApplier short-circuits, leaves default white. Logged once for visibility. |

---

## 11. Definition of Done

- [ ] Console clean after all writes.
- [ ] WeaponPrefabRegistry spawns 6 distinct shapes + placeholder.
- [ ] WeaponHueApplier tints all child MeshRenderers via MaterialPropertyBlock.
- [ ] PlayerVisual detects LockedWeapon.Slug change, destroys old, spawns new, applies hue.
- [ ] Mock smoke §8.2 passes.
- [ ] Bill visual sign-off §8.3.
- [ ] REPORT.md drafted + folder moved to `done/`.

---

## 12. References

- [`Assets/RadiantArena/Scripts/Arena/PlayerVisual.cs`](../../../Assets/RadiantArena/Scripts/Arena/PlayerVisual.cs) — extension target.
- [`Assets/RadiantArena/Scripts/Net/ArenaContext.cs:90-130`](../../../Assets/RadiantArena/Scripts/Net/ArenaContext.cs#L90) — `WeaponSnapshot` shape.
- [`RADIANT_ARENA_UNITY.md` §1.3 + §8](../../../arena-unity/RADIANT_ARENA_UNITY.md) — weapon folder structure + Weapon component reference.
- `done/D.U8-arena-scene/PLAN.md` §6.3 — runtime-spawn-no-scene-diff pattern reused.
- Memory: [[bill-ondestroy-guard]] (not directly applicable — no Bill services touched in OnDestroy here).
