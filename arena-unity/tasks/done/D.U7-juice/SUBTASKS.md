# D.U7 — Juice pass · SUBTASKS

> 7 subs / 6 commits (Sub 1 + Sub 7 verify-only).
> Opus sequential auto-run.

---

## Sub 1 — Verify baseline (read-only, NO commit)

**Goal**: confirm 4 assumptions before touching code.

**Actions**:
1. `read_console types=["error"]` → expect 2 baseline entries (URP missing types + BillInspector dup).
2. `Grep "Bill\\.Timer\\.Delay.*unscaled|unscaled:\\s*true" Assets/` → confirm 0 prior consumers (we are first to use unscaled timer).
3. `Grep "Random\\.insideUnitSphere|Camera\\.main\\.transform" Assets/RadiantArena` → confirm no existing camera shake.
4. `Grep "scaleMode" Assets/RadiantArena Assets/BillGameCore` → confirm no PanelSettings.scaleMode override (default ConstantPixelSize).
5. `execute_code (codedom)`: probe `Camera.main != null` + `UnityEngine.Time.unscaledTime` accessible.

**Output report** (no file edit):
- ✅/❌ baseline clean
- ✅/❌ no prior `Bill.Timer.Delay(..., unscaled: true)` usage
- ✅/❌ no existing camera shake
- ✅/❌ PanelSettings.scaleMode is default (ConstantPixelSize)
- ✅/❌ Camera.main + Time.unscaledTime callable

**DoD**: report. NO commit.

---

## Sub 2 — CameraShaker.cs

**Goal**: hand-rolled position jitter on `Camera.main.transform`. Static accessor for simplicity.

### `Assets/RadiantArena/Scripts/Juice/CameraShaker.cs`

```csharp
#nullable enable
using BillGameCore;
using UnityEngine;

namespace RadiantArena.Juice
{
    /// <summary>
    /// Hand-rolled camera shake — BillTween envelope drives random offset
    /// on Camera.main.transform.position. Restores origin on tween complete.
    /// </summary>
    public static class CameraShaker
    {
        static Vector3 _origin;
        static bool _shaking;
        static Tween? _activeTween;

        /// <summary>Trigger a shake; intensity in world units, duration in seconds.</summary>
        public static void Shake(float intensity, float duration)
        {
            var cam = Camera.main;
            if (cam == null) { Debug.LogWarning("[Juice.Shake] Camera.main null — skip"); return; }

            // First shake captures origin; subsequent shakes within the window
            // re-use the same origin to avoid drift on rapid hits.
            if (!_shaking) _origin = cam.transform.position;
            _shaking = true;

            // Kill any in-flight shake so we don't double-jitter.
            if (_activeTween != null) BillTween.Kill(_activeTween);

            var t = cam.transform;
            _activeTween = BillTween.Float(1f, 0f, duration, env =>
            {
                if (cam == null || t == null) return;
                t.position = _origin + Random.insideUnitSphere * (intensity * env);
            });
            _activeTween?.OnComplete(() =>
            {
                _activeTween = null;
                _shaking = false;
                if (cam != null && t != null) t.position = _origin;
            });
        }
    }
}
```

**DoD**: compile clean.

**Commit**: `feat(arena-unity/Lát-D.U7): add CameraShaker — hand-rolled position jitter on Camera.main via BillTween envelope`

---

## Sub 3 — HitStop.cs

**Goal**: reentry-safe Time.timeScale toggle with unscaled-time restore.

### `Assets/RadiantArena/Scripts/Juice/HitStop.cs`

```csharp
#nullable enable
using BillGameCore;
using UnityEngine;

namespace RadiantArena.Juice
{
    /// <summary>
    /// Drops Time.timeScale to FreezeScale for a short window, restores via
    /// unscaled Bill.Timer.Delay. Re-entry extends the deadline; restore
    /// callback no-ops if a newer hit-stop has already scheduled later.
    /// </summary>
    public static class HitStop
    {
        const float FreezeScale = 0.05f;
        const float NormalScale = 1.0f;

        static float _restoreAtUnscaled;
        static bool _pending;

        public static void Trigger(int durationMs)
        {
            float now = Time.unscaledTime;
            float dur = Mathf.Max(0.01f, durationMs / 1000f);
            float deadline = now + dur;

            if (deadline <= _restoreAtUnscaled)
            {
                // An earlier trigger already scheduled a longer freeze — no-op.
                Debug.Log($"[Juice.HitStop] reentry shorter than pending ({dur:F2}s vs deadline-{now:F2}); skip");
                return;
            }
            _restoreAtUnscaled = deadline;

            Time.timeScale = FreezeScale;

            if (!_pending)
            {
                _pending = true;
                Bill.Timer.Delay(dur, TryRestore, unscaled: true);
                Debug.Log($"[Juice.HitStop] Time.timeScale={FreezeScale}, restore in {dur:F2}s");
            }
            else
            {
                // Pending restore exists — but it'll fire at the OLD deadline.
                // Schedule a fresh one for the new (later) deadline; first one's
                // TryRestore will short-circuit because _restoreAtUnscaled grew.
                Bill.Timer.Delay(dur, TryRestore, unscaled: true);
                Debug.Log($"[Juice.HitStop] extended freeze to {dur:F2}s");
            }
        }

        static void TryRestore()
        {
            if (Time.unscaledTime + 0.0001f < _restoreAtUnscaled)
            {
                // A newer Trigger pushed the deadline; let its callback handle it.
                return;
            }
            Time.timeScale = NormalScale;
            _pending = false;
            _restoreAtUnscaled = 0f;
            Debug.Log("[Juice.HitStop] Time.timeScale restored to 1.0");
        }
    }
}
```

**DoD**: compile clean.

**Commit**: `feat(arena-unity/Lát-D.U7): add HitStop — Time.timeScale toggle with reentry-safe unscaled restore`

---

## Sub 4 — DamageNumberLayer UXML + USS + .cs

**Goal**: BasePanel hosting transient damage labels. Persistent root, runtime-added Label children, BillTween animated then destroyed.

### 4a. `Assets/RadiantArena/UI/Resources/DamageNumberLayer.uxml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<ui:UXML xmlns:ui="UnityEngine.UIElements" editor-extension-mode="False">
  <ui:VisualElement name="root" class="damage-layer-root">
    <!-- Damage Labels added at runtime by DamageNumberLayer.Spawn(...). -->
  </ui:VisualElement>
</ui:UXML>
```

### 4b. `Assets/RadiantArena/UI/Resources/damage_number.uss`

```css
.damage-layer-root {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    /* Don't intercept clicks — HUD/turn-input below need them. */
}

.damage-number {
    position: absolute;
    font-size: 22px;
    -unity-font-style: bold;
    color: rgb(240, 230, 230);
    /* drop-shadow approximation via text outline (URP UI Toolkit support varies — fallback to bold color). */
}

.damage-number.crit {
    font-size: 36px;
    color: rgb(255, 215, 80);
    -unity-font-style: bold;
}
```

### 4c. `Assets/RadiantArena/UI/DamageNumberLayer.cs`

```csharp
#nullable enable
using BillGameCore;
using UnityEngine;
using UnityEngine.UIElements;

namespace RadiantArena.UI
{
    /// <summary>
    /// Transient damage-number overlay. Spawn(worldPos, dmg, isCrit) attaches a
    /// Label child, animates pop → settle → drift up + fade, then detaches.
    /// </summary>
    public class DamageNumberLayer : BasePanel
    {
        VisualElement? _root;

        protected override void Build(VisualElement root)
        {
            _root = root;

            var tree = Resources.Load<VisualTreeAsset>("DamageNumberLayer");
            if (tree == null)
            {
                Debug.LogError("[Arena.Dmg] DamageNumberLayer.uxml not found in Resources/");
                return;
            }
            tree.CloneTree(root);

            var uss = Resources.Load<StyleSheet>("damage_number");
            if (uss != null) root.styleSheets.Add(uss);

            // Make root pass clicks through.
            root.pickingMode = PickingMode.Ignore;
        }

        public void Spawn(Vector3 worldPos, int damage, bool isCrit)
        {
            if (_root == null) return;
            var cam = Camera.main;
            if (cam == null) return;

            var screen = cam.WorldToScreenPoint(worldPos);
            if (screen.z <= 0f) return; // behind camera — skip

            float panelY = Screen.height - screen.y;

            var label = new Label(damage.ToString());
            label.AddToClassList("damage-number");
            if (isCrit) label.AddToClassList("crit");
            label.pickingMode = PickingMode.Ignore;
            label.style.left = new StyleLength(screen.x);
            label.style.top  = new StyleLength(panelY);
            label.style.scale = new StyleScale(new Scale(Vector3.zero));
            label.style.opacity = new StyleFloat(1f);

            _root.Add(label);

            Debug.Log($"[Arena.Dmg] spawn dmg={damage} crit={isCrit} screen=({screen.x:F0},{panelY:F0})");

            // Single tween 0→1 driving 3-phase transform:
            //   t ∈ [0.00, 0.10]: scale 0 → 1.2
            //   t ∈ [0.10, 0.20]: scale 1.2 → 1.0
            //   t ∈ [0.20, 1.00]: drift up 60px + alpha 1 → 0
            const float TotalDur = 0.76f;
            float startY = panelY;
            BillTween.Float(0f, 1f, TotalDur, t =>
            {
                if (label.parent == null) return;
                float scale;
                if (t < 0.105f)
                {
                    scale = Mathf.Lerp(0f, 1.2f, t / 0.105f);
                }
                else if (t < 0.21f)
                {
                    scale = Mathf.Lerp(1.2f, 1.0f, (t - 0.105f) / 0.105f);
                }
                else
                {
                    scale = 1.0f;
                    float driftT = (t - 0.21f) / 0.79f;
                    label.style.top = new StyleLength(startY - 60f * driftT);
                    label.style.opacity = new StyleFloat(1f - driftT);
                }
                label.style.scale = new StyleScale(new Scale(new Vector3(scale, scale, 1f)));
            })?.OnComplete(() =>
            {
                if (label.parent != null) label.RemoveFromHierarchy();
            });
        }
    }
}
```

**DoD**: compile clean.

**Commit**: `feat(arena-unity/Lát-D.U7): add DamageNumberLayer BasePanel + UXML + USS — runtime Label spawn with pop/drift/fade tween`

---

## Sub 5 — JuicePresenter.cs

**Goal**: central event subscriber dispatching to CameraShaker / HitStop / DamageNumberLayer.

### `Assets/RadiantArena/Scripts/Juice/JuicePresenter.cs`

```csharp
#nullable enable
using System;
using BillGameCore;
using RadiantArena.Events;
using RadiantArena.UI;
using UnityEngine;

namespace RadiantArena.Juice
{
    /// <summary>
    /// MonoBehaviour spawned by ArenaBootstrap. Listens to PlayerHitEvent +
    /// WallBounceEvent and dispatches to the three juice subsystems.
    /// Lives across scene loads (DontDestroyOnLoad). Singleton-guarded.
    /// </summary>
    public class JuicePresenter : MonoBehaviour
    {
        public static JuicePresenter? Instance { get; private set; }

        // Tunables (RADIANT_ARENA_UNITY.md §9 reference values).
        const float ShakeHit       = 0.30f;
        const float ShakeCrit      = 0.60f;
        const float ShakeWall      = 0.15f;
        const float ShakeDurHit    = 0.25f;
        const float ShakeDurWall   = 0.15f;
        const int   HitStopHitMs   = 60;
        const int   HitStopCritMs  = 120;

        Action<PlayerHitEvent>? _onHit;
        Action<WallBounceEvent>? _onWall;

        void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            DontDestroyOnLoad(gameObject);

            _onHit  = OnPlayerHit;
            _onWall = OnWallBounce;
            Bill.Events.Subscribe(_onHit);
            Bill.Events.Subscribe(_onWall);

            Debug.Log("[Juice] JuicePresenter ready");
        }

        void OnDestroy()
        {
            if (_onHit != null) Bill.Events.Unsubscribe(_onHit);
            if (_onWall != null) Bill.Events.Unsubscribe(_onWall);
            _onHit = null;
            _onWall = null;
            if (Instance == this) Instance = null;
        }

        void OnPlayerHit(PlayerHitEvent e)
        {
            CameraShaker.Shake(e.isCrit ? ShakeCrit : ShakeHit, ShakeDurHit);
            HitStop.Trigger(e.isCrit ? HitStopCritMs : HitStopHitMs);

            if (Bill.UI.IsOpen<DamageNumberLayer>())
            {
                // Grab the live panel instance via re-Open (idempotent).
                var layer = Bill.UI.Open<DamageNumberLayer>();
                layer?.Spawn(e.point, e.damage, e.isCrit);
            }
            else
            {
                Debug.LogWarning("[Juice] PlayerHitEvent fired but DamageNumberLayer not open — skipping number");
            }
        }

        void OnWallBounce(WallBounceEvent e)
        {
            CameraShaker.Shake(ShakeWall, ShakeDurWall);
            // No hit-stop, no damage number.
        }
    }
}
```

**DoD**: compile clean.

**Commit**: `feat(arena-unity/Lát-D.U7): add JuicePresenter — central PlayerHit/WallBounce dispatcher → shake/hit-stop/damage-number`

---

## Sub 6 — Wire JuicePresenter into bootstrap + DamageNumberLayer lifecycle

**Goal**: ensure presenter spawns once and DamageNumberLayer opens/closes alongside HudPanel.

### 6a. `Assets/RadiantArena/Scripts/Bootstrap/ArenaBootstrap.cs` — extend `InitArena()`

After the existing `ArenaStates.Register(); Bill.State.GoTo<RadiantArena.States.BootState>();` block, add (BEFORE the GoTo so the presenter exists when states start firing):

```csharp
// Spawn JuicePresenter once — Awake guards duplicates.
if (RadiantArena.Juice.JuicePresenter.Instance == null)
{
    var juiceGo = new GameObject("[JuicePresenter]");
    juiceGo.AddComponent<RadiantArena.Juice.JuicePresenter>();
}
```

Actual placement: between `ArenaStates.Register();` and `Bill.State.GoTo<RadiantArena.States.BootState>();`.

### 6b. `Assets/RadiantArena/Scripts/States/CountdownState.cs` — extend `Enter`

After the existing `if (!Bill.UI.IsOpen<HudPanel>()) Bill.UI.Open<HudPanel>();` line, add:

```csharp
if (!Bill.UI.IsOpen<DamageNumberLayer>()) Bill.UI.Open<DamageNumberLayer>();
```

### 6c. `Assets/RadiantArena/Scripts/States/EndState.cs` — extend close block in `Enter`

After the existing `if (Bill.UI.IsOpen<HudPanel>()) Bill.UI.Close<HudPanel>();` line, add:

```csharp
if (Bill.UI.IsOpen<DamageNumberLayer>()) Bill.UI.Close<DamageNumberLayer>();
```

### 6d. `Assets/RadiantArena/Scripts/States/LobbyState.cs` — extend defensive close block in `Enter`

After `if (Bill.UI.IsOpen<ResultPanel>()) Bill.UI.Close<ResultPanel>();`, add:

```csharp
if (Bill.UI.IsOpen<DamageNumberLayer>()) Bill.UI.Close<DamageNumberLayer>();
```

**DoD**: compile clean.

**Commit**: `feat(arena-unity/Lát-D.U7): wire JuicePresenter spawn in ArenaBootstrap + DamageNumberLayer open/close lifecycle (Countdown/End/Lobby)`

---

## Sub 7 — Mock smoke (NO commit)

**Goal**: validate JuicePresenter → CameraShaker / HitStop / DamageNumberLayer wiring.

**Pre**: stop/start Play. `compiler: codedom`. `ArenaStates.Register()` explicit.

**Actions**:

1. `read_console clear`.
2. **Step A** — `execute_code`: register states, prime context, GoTo<CountdownState>. Verify HudPanel + DamageNumberLayer both open. JuicePresenter spawned at boot — log `[Juice] JuicePresenter ready` present.
3. **Step B — hit event** — fire `PlayerHitEvent { damage=25, isCrit=false, victimId="opp", point=new Vector3(2f,0f,0f) }`. Probe within same execute_code:
   - `Time.timeScale` should be 0.05 (hit-stop active)
   - `Camera.main.transform.position` should differ from origin (shake started)
   - DamageNumberLayer root should have 1 child Label with text "25" and no .crit class.
4. Sleep 0.15s. Probe: `Time.timeScale` should be 1f (restored after 60ms unscaled).
5. Sleep 0.3s. Probe: shake position back near origin (250ms total shake completed).
6. **Step C — crit event** — fire `PlayerHitEvent { damage=80, isCrit=true, victimId="opp", point=Vector3(-1,0,1) }`. Probe: `Time.timeScale=0.05`, child count grew to 2, latest child has `.crit` class.
7. Sleep 0.15s + 0.15s. Probe: `Time.timeScale` restored (120ms crit hit-stop done).
8. **Step D — wall bounce** — fire `WallBounceEvent { point=Vector3(3,0,0) }`. Probe: shake active, `Time.timeScale` still 1f (no hit-stop), child Label count unchanged.
9. Sleep 1s (let all tweens finish). Probe DamageNumberLayer child count = 0 (all faded + removed). Camera position ≈ origin.
10. Stop Play. `read_console types=["error"]` → 0.

**Output**:
- Full log capture for steps 2-9.
- Pass/fail per probe.

**DoD**:
- JuicePresenter spawns at boot, subscribes events.
- Hit event triggers shake + hit-stop + damage label (text matches, crit class correct).
- Wall bounce triggers shake only.
- Time.timeScale restores cleanly after each hit-stop window.
- Labels self-destruct after fade.

**NO commit**.

---

## DoD overall (D.U7a close)

- [ ] Sub 1 baseline verified.
- [ ] Sub 2 CameraShaker landed.
- [ ] Sub 3 HitStop landed.
- [ ] Sub 4 DamageNumberLayer landed.
- [ ] Sub 5 JuicePresenter landed.
- [ ] Sub 6 lifecycle wiring landed.
- [ ] Sub 7 mock smoke pass.

D.U7b (anticipation pulse + audio + color flash) deferred until D.U8 weapon prefab + SFX pack + Volume profile.
