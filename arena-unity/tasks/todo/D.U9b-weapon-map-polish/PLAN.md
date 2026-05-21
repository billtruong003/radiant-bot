# D.U9b — Weapon + Map polish · PLAN

> Stage 1 (Architect). Opus sequential. Date: 2026-05-19 · Executor: Opus 4.7.
> Follow-up to D.U9. Addresses D.U9 misnomer (no `.prefab` files shipped) + D.U7b deferred (anticipation pulse) + map placeholder pass.

---

## 1. Goal

4 sub-goals shipped in 1 Lát:

1. **Real `.prefab` assets** — fix D.U9 misnomer. Create `Assets/RadiantArena/Resources/Weapons/*.prefab` for all 7 entries (6 catalog + placeholder). Migrate `WeaponPrefabRegistry` from switch-case factory → `Resources.Load<GameObject>($"Weapons/{slug}")`.
2. **Weapon position polish** — lateral offset (held beside capsule) + aim-facing rotation (weapon orients toward aim direction on my turn, toward me-player on opp turn).
3. **Anticipation pulse** (D.U7b unblock) — weapon scale 1.0 → 1.15 → 1.0 over 80ms before shot release.
4. **Map polish** — replace plain dark-slate ground/walls with textured ground + wall trim + Directional Light + ambient color tune. Optional corner decorations.

---

## 2. Scope

| Item | Status | Notes |
|---|---|---|
| `Assets/RadiantArena/Resources/Weapons/*.prefab` (7 files) | ✅ GO | Generated programmatically via Editor menu OR `PrefabUtility.SaveAsPrefabAsset` from in-code composite. Each prefab has the same `WeaponRoot` hierarchy from D.U9 builder methods, just persisted to disk. |
| `WeaponPrefabRegistry.cs` migration | ✅ GO | Replace switch-case builders with `Resources.Load<GameObject>(...)` + `Instantiate`. Keep `Spawn(slug, parent)` signature unchanged so PlayerVisual caller is untouched. Cache loaded prefabs in static dict to avoid Resources roundtrip every spawn. |
| **Editor menu** `Tools > RadiantArena > Generate Weapon Prefabs` | ✅ GO | One-shot tool. For each slug, call current D.U9 builder method → `PrefabUtility.SaveAsPrefabAsset` → save to `Assets/RadiantArena/Resources/Weapons/{slug}.prefab`. Idempotent (overwrite). Lives in `Editor/ArenaWeaponPrefabGenerator.cs`. |
| Weapon position polish — lateral offset | ✅ GO | New `PlayerVisual.WeaponOffset` Vector3 constant `(0.55, 0.50, 0)` local — weapon held to the right of capsule center, at capsule center Y. Replace current `(0, 1.2, 0)`. |
| Weapon facing rotation | ✅ GO | New `_weaponGo.transform.localRotation` setter inside `PlayerVisual.Update` (not poll-gated — every frame). For mine: rotate toward latest aim angle from `AimUpdatedEvent` (subscribe in Awake). For opp: rotate `LookAt(MyVisual.position)`. Default rotation when no aim: point forward (+X = toward opponent). |
| Anticipation pulse | ✅ GO | New `JuicePresenter.PlayAnticipation(GameObject weapon, Action onComplete)` — `BillTween.To` scale 1.0→1.15 over 80ms ease-out → snap back. `MyTurnState.OnShotReleased` calls `JuicePresenter.Instance.PlayAnticipation(myVisual.WeaponGo, () => { send shoot; GoTo<Animating>(); })`. Need expose `PlayerVisual.WeaponGo` public getter. |
| Map polish — Directional Light + ambient | ✅ GO | `ArenaSceneBuilder` adds child Directional Light GO at `(50, 50, 50)` Euler `(50, -30, 0)` (key light angle) + `RenderSettings.ambientLight = (0.3, 0.32, 0.4)` (subtle cool ambient). |
| Map polish — ground variant | ✅ GO | `ArenaSceneBuilder` ground material: replace flat `Color(0.10, 0.12, 0.18)` with subtle 2-tone via MaterialPropertyBlock + per-quadrant minor color shift. Or simpler: add 2nd Quad child as "rune circle" decal (textureless, just darker ring shape). Pick simpler option per implementation feel. |
| Map polish — wall trim | ✅ GO | Add 4 thin Cube children on top of each wall as cap trim (slightly lighter color, raised 0.1u). Visual "molding" effect. |
| Map polish — corner stones (optional) | 🟡 OPTIONAL | 4 small Cube/Cylinder pillars at arena corners. Skip if scope feels heavy. |
| **OUT OF SCOPE — defer** | | |
| HLSL shaders (HueShift, WeaponEnergyHalo, GroundCellShade, OutlineFresnel) | ❌ D.U11 | Material polish only here; shader pass D.U11. |
| Real FBX/artist models for weapons | ❌ Future asset pass | Composite primitives saved as prefabs are the polish baseline. Artist replaces .prefab contents later without code change. |
| Particle/trail FX | ❌ D.U11 | Shader work. |
| Tier-specific weapon polish (gold for Thiên, rainbow for Bản mệnh) | ❌ D.U11 | Needs shader keywords. |
| Bản mệnh signature FX (per-Discord unique glow) | ❌ D.U12 | Heavy, needs shader infrastructure. |
| Weapon swap mid-match | ❌ Out of design | Server locks at countdown. |

---

## 3. Project state (verified 2026-05-19)

- ✅ D.U9 closed `fa49a28`. `WeaponPrefabRegistry` switch-case factory works. `WeaponHueApplier` MPB tint works.
- ✅ `PlayerVisual.SyncFromContext` 100ms poll spawns/destroys weapon on slug change. `_weaponGo` private field. `WeaponOffsetY = 1.2f` const.
- ✅ `MyTurnState.OnShotReleased` fires `NetClient.Send + Bill.State.GoTo<AnimatingState>()` directly — no anticipation gap. Insert pulse here.
- ✅ `JuicePresenter` (D.U7) singleton DDOL exists. Spawned by `ArenaBootstrap.InitArena`. Has access to `BillTween` patterns.
- ✅ `ArenaAimController` fires `AimUpdatedEvent { angle, power }` every frame during drag. Use angle for rotation.
- ✅ `ArenaSceneBuilder` runtime-spawns ground Plane + 4 walls + 2 capsules. Singleton with `MyVisual` / `OpponentVisual` PlayerVisual refs. Materials via `Shader.Find("Universal Render Pipeline/Unlit")`.
- ✅ No `Assets/RadiantArena/Prefabs/` or `Resources/` folders exist yet. Will be created.
- ✅ `BillTween` API available via Bill.* services (used in D.U7 DamageNumberLayer + CameraShaker).
- ⚠️ Scene lighting: no Directional Light in Bootstrap.unity currently. Unity's default ambient washes everything to flat color. Adding light may show shadow/depth on walls — verify URP main light setup.
- ⚠️ `Resources/` folder triggers Unity's always-include-in-build behavior. For WebGL D.U12, prefab size matters. Composite primitives are tiny — acceptable.

---

## 4. Files this Lát will touch

| Path | Action | Purpose |
|---|---|---|
| `Assets/RadiantArena/Editor/ArenaWeaponPrefabGenerator.cs` | CREATE | Editor menu `Tools > RadiantArena > Generate Weapon Prefabs`. Iterates 7 slugs → builds composite via existing Registry builders (made internal for Editor access) → `PrefabUtility.SaveAsPrefabAsset` → cleanup runtime GO. |
| `Assets/RadiantArena/Resources/Weapons/*.prefab` (7 files) | CREATE | Generated artifacts. Tracked in git. |
| `Assets/RadiantArena/Scripts/Weapons/WeaponPrefabRegistry.cs` | EDIT | Replace switch-case with `Resources.Load`. Keep `Spawn(slug, parent)` signature. Add static prefab cache. Builder methods stay but become `internal` for Generator access (callable as `WeaponPrefabRegistry.BuildKiem()` etc. during prefab generation). |
| `Assets/RadiantArena/Scripts/Arena/PlayerVisual.cs` | EDIT | Change `WeaponOffsetY` → `WeaponOffset Vector3(0.55, 0.50, 0)`. Add `public GameObject? WeaponGo => _weaponGo;` getter. Add Update-loop rotation logic (subscribe `AimUpdatedEvent` for mine, LookAt(MyVisual) for opp). |
| `Assets/RadiantArena/Scripts/Juice/JuicePresenter.cs` | EDIT | Add `PlayAnticipation(GameObject weapon, Action onComplete)` method. Uses `BillTween` scale tween. |
| `Assets/RadiantArena/Scripts/States/MyTurnState.cs` | EDIT | `OnShotReleased` — instead of immediate Send+GoTo, call `JuicePresenter.Instance.PlayAnticipation(_aim?.GetOriginVisual()?.WeaponGo, () => { send + GoTo })`. Defer 80ms. |
| `Assets/RadiantArena/Scripts/Arena/ArenaSceneBuilder.cs` | EDIT | Add Directional Light + ambient color + ground variant + wall trim caps inside `Awake`. Optional corner pillars. |

**Total**: 1 new editor script, 7 new .prefab files, 5 .cs edits.

---

## 5. APIs used

### 5.1 Unity Editor
- `UnityEditor.PrefabUtility.SaveAsPrefabAsset(GameObject root, string path)` — persist composite GO.
- `UnityEditor.AssetDatabase.CreateFolder` — ensure `Resources/Weapons/` exists.
- `UnityEditor.AssetDatabase.Refresh` — reimport.
- `[MenuItem("Tools/RadiantArena/Generate Weapon Prefabs")]` — entry point.

### 5.2 Unity Runtime
- `Resources.Load<GameObject>("Weapons/" + slug)` — load prefab.
- `UnityEngine.Object.Instantiate(prefab, parent)` — spawn.
- `Transform.LookAt` / `Quaternion.LookRotation` — opp weapon rotation.
- `RenderSettings.ambientLight` — global ambient.

### 5.3 RadiantArena
- `BillTween` (Bill services) — scale tween for anticipation.
- `AimUpdatedEvent { angle, power }` — subscribed by PlayerVisual.
- `JuicePresenter.Instance` — singleton access.

---

## 6. Architecture decisions

### 6.1 `Resources/Weapons/` path (not ScriptableObject WeaponDatabase)
- `Resources.Load` is simple, works in WebGL, no Bootstrap registration needed.
- `WeaponDatabase` ScriptableObject would be cleaner (no Resources/ always-include-in-build), but requires extra inspector setup + cross-reference plumbing.
- D.U12 can migrate to ScriptableObject when build size is a concern. Composite primitives are tiny — acceptable for now.

### 6.2 Builder methods stay in `WeaponPrefabRegistry`, just become `internal`
- Generator needs to call `BuildKiem()` etc. to create the composite GO before saving as prefab.
- Keeping them in same class avoids duplication. Generator imports `RadiantArena.Weapons` namespace.
- After D.U9b, runtime `Spawn` no longer calls them — only Generator does (at design time).

### 6.3 Cache loaded prefabs to avoid Resources.Load every spawn
```csharp
static readonly Dictionary<string, GameObject> _prefabCache = new();

public static GameObject Spawn(string slug, Transform parent)
{
    if (!_prefabCache.TryGetValue(slug, out var prefab))
    {
        prefab = Resources.Load<GameObject>("Weapons/" + slug)
              ?? Resources.Load<GameObject>("Weapons/_placeholder");
        _prefabCache[slug] = prefab;
    }
    var go = Object.Instantiate(prefab, parent);
    go.name = "Weapon_" + slug;
    return go;
}
```

### 6.4 Weapon offset = lateral right, not above
- D.U9: weapon at `(0, 1.2, 0)` above capsule — looked "floating".
- D.U9b: weapon at `(0.55, 0.50, 0)` — held to the right of capsule center, at capsule center Y. Reads as "held weapon".
- For top-down view, lateral offset means weapon silhouette extends visually from capsule, easier to read shape.
- Tradeoff: weapon may clip wall if capsule against wall. Acceptable for placeholder.

### 6.5 Weapon facing rotation logic
- **Mine** (when MyTurnState active): subscribe `AimUpdatedEvent` → rotate `_weaponGo.transform.localRotation = Quaternion.Euler(0, angleDeg, 0)`. Default (no aim) = face opponent direction (`Quaternion.identity` since opp is +X).
- **Opp**: every poll, set `_weaponGo.transform.LookAt(otherVisual.transform.position)`. Always face me.
- Edge case: when MyTurnState exits and another state enters, the `AimUpdatedEvent` subscription should be cleaned up. Use unsubscribe pattern.

### 6.6 Anticipation pulse — fires BEFORE Send + state transition
```csharp
void OnShotReleased(ShotReleasedEvent e) {
    var weaponGo = ArenaSceneBuilder.Instance?.MyVisual?.WeaponGo;
    JuicePresenter.Instance.PlayAnticipation(weaponGo, () => {
        NetClient.Instance?.Send("shoot", new ShootMsg { angle = e.angle, power = e.power });
        Bill.State.GoTo<AnimatingState>();
    });
}
```
- 80ms delay added between drag-release and state transition.
- If `weaponGo` null, callback fires immediately (no pulse, no break).

### 6.7 Map polish — minimal viable improvement
- Directional Light: angle from `(50, -30, 0)` Euler, intensity 1.0. Casts soft shadows on walls + capsules → depth perception.
- Ambient color: `(0.30, 0.32, 0.40)` — slight cool tint, prevents shadowed sides going black.
- Ground variant: keep flat color but add subtle vignette darker outside arena (4 quads at edges, slightly darker than ground). Or skip — Directional Light shadow on capsule already adds depth.
- Wall trim caps: 4 thin Cubes (height 0.05) on top of each wall, color slightly lighter than wall. Adds "molding" detail.
- Corner stones (optional, OUT if scope tight): 4 Cylinders at arena corners, scaled (0.2, 0.8, 0.2), color matching wall.

### 6.8 Why not ProBuilder for map
- ProBuilder package installed (per ProjectSettings/Packages drift), but adding mesh authoring tools = scope creep.
- Programmatic GO spawn keeps version control clean (no .mesh asset bloat). Consistent with D.U7/D.U8 runtime-spawn pattern.

---

## 7. MCP touchpoints

| Step | Tool |
|---|---|
| Run Editor menu generator | `mcp__unityMCP__execute_menu_item Tools/RadiantArena/Generate Weapon Prefabs` |
| Verify prefabs exist | `mcp__unityMCP__manage_asset action=search filterType=Prefab` filter to `Weapons/` |
| Inspector verify prefab structure | reflection probe via `execute_code` |
| Force refresh | `refresh_unity` |
| Console check | `read_console types=["error"]` |
| Smoke spawn weapon at runtime | `execute_code compiler=codedom` |
| Visual verify | `manage_camera screenshot include_image=true` |

---

## 8. Smoke test plan

### 8.1 Per-sub compile gate
`refresh_unity` + `read_console types=["error"]` empty after each Write/Edit.

### 8.2 Sub 1 (Editor generator) verify
1. Run menu `Tools > RadiantArena > Generate Weapon Prefabs`.
2. `manage_asset search` `Assets/RadiantArena/Resources/Weapons/*.prefab` → expect 7 entries.
3. `read_console types=["error"]` → 0.

### 8.3 Sub 2 (Registry migration) verify
1. Play mode start.
2. `execute_code` inject `LockedWeapon` for me. Wait 0.2s poll.
3. Reflection probe `MyVisual.transform.GetChild(0).name` = `Weapon_weapon_kiem_01`.
4. Reflection probe spawned GO has same composite structure as D.U9 (renderer count match).
5. Confirm prefab cache hits after second spawn (debug log or reflection on `_prefabCache.Count`).

### 8.4 Sub 3 (Position polish) verify
1. After Sub 2 spawn, probe weapon `localPosition` = `(0.55, 0.50, 0)` ✓.
2. Screenshot Game View — weapon visible to right of green capsule (not above).
3. Drive into MyTurnState. Fire `AimUpdatedEvent` with angle PI/4. Reflection probe weapon rotation Y ≈ 45°.

### 8.5 Sub 4 (Anticipation pulse) verify
1. Drive MyTurnState. Subscribe to scale-tween test by adding temporary log to JuicePresenter.PlayAnticipation.
2. Fire mock ShotReleasedEvent. Console log shows "anticipation start → end after ~80ms".
3. After 80ms, state transitioned to AnimatingState.
4. Visual: weapon scale visibly pulses (Bill manual play sign-off).

### 8.6 Sub 5 (Map polish) verify
1. After scene rebuild, screenshot top-down + scene view 45° angle.
2. Expect: walls have visible shadow gradient (Directional Light cast), ground reads non-flat, trim caps on walls visible from above.
3. `read_console` 0 errors.

### 8.7 Bill visual sign-off (final)
- Open Bootstrap → Play → drag-aim with weapon visible "held" → release → pulse scale → AnimatingState wait.
- Atmospheric arena reads better than D.U9 placeholder state.

---

## 9. Bill checkpoints

| After Sub | Checkpoint |
|---|---|
| Sub 1 (Generator) | Optional inspect — Bill opens 1 prefab in Project view to confirm content matches expectation. |
| Sub 3 (Position) | Visual review — Bill may want different offset (e.g., (0.7, 0.4, 0) or rotation override per weapon). Tune-up acceptable. |
| Sub 4 (Anticipation) | Visual feel-check — 80ms may feel too short/long. Tune `AnticipationMs` const. |
| Sub 5 (Map) | Bill subjective — "feels like a real arena, not a placeholder cube room?" If no → narrow tune within same Lát. |
| Sub 6 (Smoke + sign-off) | Bill final accept → close Lát. |

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| `PrefabUtility.SaveAsPrefabAsset` requires editor-only API — must live in Editor/ folder. | Generator script in `Assets/RadiantArena/Editor/`. Use `#if UNITY_EDITOR` guards if any runtime cross-ref. |
| Prefab path `Resources/Weapons/...` must match `Resources.Load("Weapons/" + slug)` — case-sensitive on WebGL. | Use exact slug strings, no transformation. Verify in smoke. |
| Composite primitive prefabs include `Collider` default — generator must strip after CreatePrimitive (same as D.U9 builders). | Builders already strip via `Object.Destroy(col)`. Generator uses same builders → behavior preserved. |
| Anticipation pulse 80ms blocks Send — server timeout sensitive if Bill drag with long hesitation. | 80ms is well below 100ms server pulse. Negligible. |
| Weapon facing rotation may cause weapon to clip into capsule when aim opposite. | Local rotation on `_weaponGo` (the WeaponRoot empty), so weapon root rotates around capsule center + lateral offset. Should orbit around capsule, not clip into it. If clipping → adjust offset radius. |
| AimUpdatedEvent fires every frame during drag — rotation update is fine, but unsubscribe on PlayerVisual disable required to avoid leak. | Subscribe in `OnEnable` / unsubscribe in `OnDisable`. Capture as Action so unsubscribe works. |
| Directional Light may wash UI overlay colors. | UI Toolkit panels render in screen space, not lit. Should not interact. |
| Ground variant via subtle vignette may not be visible in top-down ortho. | Test visually; if no visible effect, skip vignette + commit only Directional Light + wall trim. |
| Generated `.prefab` files cause big initial commit (~7 files + meta). | Acceptable — first-time tracked content cost. Each prefab is ~1KB. |
| `Resources/` triggers Unity AlwaysIncludedShader-style behavior — bloat WebGL build slightly. | Acceptable for placeholder. D.U12 build review can swap to ScriptableObject if needed. |
| Generator overwrite — if prefab already exists, `PrefabUtility.SaveAsPrefabAsset` should overwrite cleanly. | Verify in smoke. Document expected behavior in REPORT. |
| BillTween scale tween — if `_weaponGo` destroyed mid-tween (state transition before pulse complete), tween writes to destroyed object. | Use `BillTween.KillTarget(_weaponGo)` in PlayerVisual cleanup path. Or guard tween callback `if (target == null) return`. |

---

## 11. Definition of Done

- [ ] Editor generator menu creates 7 .prefab files under `Assets/RadiantArena/Resources/Weapons/`.
- [ ] `WeaponPrefabRegistry.Spawn(slug)` returns Instantiated prefab clone, not composite-built GO.
- [ ] `PlayerVisual` weapon offset lateral `(0.55, 0.50, 0)` + aim-facing rotation working.
- [ ] Anticipation pulse: weapon scales 1.0→1.15→1.0 over 80ms before shot fires + state transition.
- [ ] `ArenaSceneBuilder` adds Directional Light + ambient color + wall trim. Map reads atmospheric.
- [ ] All 6 catalog + placeholder shapes match D.U9 visual baseline (prefabs preserve composite structure).
- [ ] Console clean after all writes.
- [ ] Bill visual sign-off — weapons feel "held", pulse visible on shot, map no longer placeholder.
- [ ] REPORT.md drafted + folder moved to `done/` AFTER explicit visual sign-off (lesson from D.U9 premature move).

---

## 12. References

- `done/D.U9-weapon-prefabs/PLAN.md` §6.1 — factory pattern decision being reversed here.
- `done/D.U9-weapon-prefabs/REPORT.md` §Deviations #5, #6 — scale tune + premature move lessons.
- `done/D.U7-juice/PLAN.md` — anticipation pulse original spec (D.U7b deferred).
- `done/D.U8-arena-scene/PLAN.md` §6.3 — runtime-spawn-no-scene-diff pattern reused for map polish.
- [`Assets/RadiantArena/Scripts/Weapons/WeaponPrefabRegistry.cs`](../../../Assets/RadiantArena/Scripts/Weapons/WeaponPrefabRegistry.cs) — migration target.
- [`Assets/RadiantArena/Scripts/Arena/PlayerVisual.cs`](../../../Assets/RadiantArena/Scripts/Arena/PlayerVisual.cs) — position/rotation extension.
- [`Assets/RadiantArena/Scripts/States/MyTurnState.cs:60-65`](../../../Assets/RadiantArena/Scripts/States/MyTurnState.cs#L60) — anticipation insertion point.
- [`Assets/RadiantArena/Scripts/Arena/ArenaSceneBuilder.cs`](../../../Assets/RadiantArena/Scripts/Arena/ArenaSceneBuilder.cs) — map polish target.
- `arena-unity/TASKS.md` §D.U9b — scope source of truth.
- Memory: [[bill-ondestroy-guard]] (BillTween scale tween in JuicePresenter must guard if `_weaponGo` destroyed mid-tween).
