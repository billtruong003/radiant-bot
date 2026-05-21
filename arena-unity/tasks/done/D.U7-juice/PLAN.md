# D.U7 — Juice pass · PLAN

> Stage 1 (Architect). D.U7a-only this Lát; D.U7b deferred until asset packs land.
> Date: 2026-05-18 · Executor: Opus 4.7 sequential auto-run.

---

## 1. Goal

Add the first 3 of 6 juice effects from `TASKS.md` D.U7 — the ones that don't need external assets:

1. **Camera shake** on hit / crit / wall_bounce — hand-rolled position jitter on `Camera.main.transform` (no Cinemachine dependency).
2. **Hit-stop** on hit / crit — `Time.timeScale = 0.05f` for 60-120ms then restored via `Bill.Timer.Delay(..., unscaled: true)`.
3. **Damage number popup** — UI Toolkit Label spawned per hit, BillTween animates scale 0→1.2→1.0 + arc up + fade. Crit reads bigger + golden.

Effects 4-6 (anticipation pulse, layered audio, color flash) deferred to **D.U7b** — they depend on D.U8 weapon prefab (anticipation), SFX pack (audio), Volume profile (flash) that Bill hasn't lined up yet.

Subscribers route off **D.U5's existing events**:
- `PlayerHitEvent { damage, isCrit, victimId, point }` → shake + hit-stop + damage number.
- `WallBounceEvent { point }` → small shake only.

DoD per TASKS.md is **Bill subjective sign-off "feels punchy."** Mock smoke validates the wiring (subscribers fire, Time.timeScale dips, GameObject child appears under DamageNumberLayer); the "feel" check is Bill's manual Play-mode replay.

---

## 2. Scope split (D.U7a now, D.U7b later)

| Sub-scope | Status | Notes |
|---|---|---|
| **D.U7a (this Lát — no external assets)** | | |
| `JuicePresenter` MonoBehaviour — central event dispatcher | ✅ GO | Spawned in `ArenaBootstrap.InitArena()` (DontDestroyOnLoad). Subscribes PlayerHitEvent + WallBounceEvent. |
| `CameraShaker` — hand-rolled position jitter | ✅ GO | `Shake(intensity, duration)` — Bill.Tween float envelope drives `Random.insideUnitSphere` offset on `Camera.main.transform.position`. |
| `HitStop` — static helper, Time.timeScale toggle | ✅ GO | `Trigger(durationMs)` — sets `Time.timeScale=0.05`, `Bill.Timer.Delay(durationMs/1000f, restore, unscaled=true)`. Reentrant-safe via `_pendingRestoreAt` timestamp. |
| `DamageNumberLayer` BasePanel + UXML + USS | ✅ GO | Persistent BasePanel hosting transient Label children. `Spawn(worldPos, text, isCrit)` — converts world→screen→panel coord, attaches Label, animates scale+top+fade, destroys self. |
| `ArenaBootstrap` spawns JuicePresenter once Bill ready | ✅ GO | One-liner after `ArenaStates.Register()`. |
| `CountdownState.Enter` opens DamageNumberLayer; `EndState.Enter` / `LobbyState.Enter` close it | ✅ GO | Same lifecycle as HudPanel (D.U6). |
| Mock smoke — synthetic PlayerHitEvent (hit + crit) + WallBounceEvent | ✅ GO | Verify: Time.timeScale dips, Camera.transform.position deviates from origin during shake, DamageNumberLayer gains a child Label that disappears after fade. |
| **D.U7b (deferred — asset-blocked)** | | |
| Anticipation pulse (weapon model 1.0→1.15 over 80ms) | ⏸ BLOCKED | Needs D.U8 weapon prefab to scale. |
| Layered hit/crit audio (body thud + harmonic ring + sub-bass) | ⏸ BLOCKED | Bill to provide SFX pack; then register with Bill.Audio. |
| Color flash on crit (chromatic + vignette via Volume profile) | ⏸ BLOCKED | Needs URP Volume profile asset with chromatic aberration + vignette overrides. |
| **OUT OF SCOPE (not in D.U7 at all)** | | |
| HP bar pop-scale on damage | ❌ D.U6 polish | HUD bar already tweens via BillTween — pop-scale on container is a small follow-up; not part of D.U7 spec. Could fold into D.U7b if Bill wants. |
| Replay button wiring | ❌ D.U10/D.U11 | |
| Real server damage trigger | ❌ Server Lát D.5 | |

---

## 3. Project state (verified 2026-05-18)

- ✅ `PlayerHitEvent { damage, isCrit, victimId, point: Vector3 }` lives at [`ArenaEvents.cs:93`](../../../Assets/RadiantArena/Scripts/Events/ArenaEvents.cs#L93). `point` is world-space (mapped via `TrajectoryConstants.WorldFromSim`).
- ✅ `WallBounceEvent { point: Vector3 }` lives at [`ArenaEvents.cs:105`](../../../Assets/RadiantArena/Scripts/Events/ArenaEvents.cs#L105).
- ✅ `Bill.Timer.Delay(float seconds, Action callback, bool unscaled)` overload exists ([`Interfaces.cs:125`](../../../Assets/BillGameCore/Runtime/Infrastructure/Interfaces.cs#L125)). Critical for hit-stop restore (default Delay is `Time.timeScale`-scaled).
- ✅ `BillTween.Float(from, to, dur, setter)` already in use in HudPanel — same facade works for camera shake decay + damage-number animations.
- ✅ `Bill.UI.Open<T>` idempotent (`CoreServices.cs:122`). Same lifecycle pattern as HudPanel.
- ✅ `Camera.main` exists in Bootstrap.unity (D.U1 verified). `CameraShaker` reads `Camera.main` in `Awake` and caches.
- ✅ No Cinemachine import needed — hand-rolled jitter is cleaner for one-axis use case, avoids package surface.
- ⚠️ `BillTween.Tick(dt)` — call-site unknown from prior reading; likely passed `Time.deltaTime` (scaled). Means tweens slow during hit-stop. **That's the desired feel** — shake decays in slow-mo while time-scale drops, snaps back when scale restores.
- ⚠️ `PanelSettings.scaleMode` — D.U3 didn't customize; defaults to `ConstantPixelSize`. Panel coords = screen pixels with origin top-left. World→screen→panel conversion: `Vector2 panel = new Vector2(screenX, Screen.height - screenY)` (Y-flip).
- ⚠️ `DamageNumberLayer` opens at Countdown.Enter alongside HudPanel — same pattern as D.U6. Don't forget the defensive close in LobbyState.

---

## 4. Files this Lát will touch

| Path | Action | Purpose |
|---|---|---|
| `Assets/RadiantArena/Scripts/Juice/JuicePresenter.cs` | CREATE | MonoBehaviour, subscribes PlayerHitEvent + WallBounceEvent, dispatches to Shaker / HitStop / DamageNumberLayer. |
| `Assets/RadiantArena/Scripts/Juice/CameraShaker.cs` | CREATE | Static-ish helper or MonoBehaviour. `Shake(intensity, duration)` — BillTween envelope drives Random.insideUnitSphere offset on Camera.main.transform.position. |
| `Assets/RadiantArena/Scripts/Juice/HitStop.cs` | CREATE | Static helper. `Trigger(durationMs)` sets Time.timeScale + Bill.Timer.Delay(unscaled) to restore. Re-entry safe — extending an active hit-stop extends the restore deadline. |
| `Assets/RadiantArena/UI/DamageNumberLayer.cs` | CREATE | BasePanel hosting transient damage Labels. `Spawn(worldPos, dmg, isCrit)` adds a Label, animates, removes. |
| `Assets/RadiantArena/UI/Resources/DamageNumberLayer.uxml` | CREATE | Empty fullscreen root — children added at runtime. |
| `Assets/RadiantArena/UI/Resources/damage_number.uss` | CREATE | `.damage-number` base style + `.damage-number.crit` modifier (bigger + golden). |
| `Assets/RadiantArena/Scripts/Bootstrap/ArenaBootstrap.cs` | EDIT | After `ArenaStates.Register()`, spawn `JuicePresenter` GameObject. |
| `Assets/RadiantArena/Scripts/States/CountdownState.cs` | EDIT | Open `DamageNumberLayer` alongside `HudPanel` in `Enter`. |
| `Assets/RadiantArena/Scripts/States/EndState.cs` | EDIT | Close `DamageNumberLayer` in `Enter` (alongside `HudPanel` close). |
| `Assets/RadiantArena/Scripts/States/LobbyState.cs` | EDIT | Defensive close `DamageNumberLayer` in `Enter` (alongside existing HUD/Result closes). |

**No** scene edits (Camera.main + UIDocument auto-host).
**No** Bill.Pool registration (DamageNumberLayer creates Label children directly — runtime UI, fast enough).

---

## 5. APIs used

### 5.1 BillGameCore
- `Bill.Events.Subscribe<PlayerHitEvent>` / `<WallBounceEvent>` — JuicePresenter.
- `Bill.Timer.Delay(seconds, callback, unscaled=true)` — HitStop restore.
- `BillTween.Float(from, to, dur, setter)` — shake decay envelope, damage-number scale+position+alpha.
- `Bill.UI.Open<DamageNumberLayer>` / `Close<>` / `IsOpen<>` — lifecycle.

### 5.2 Unity
- `Camera.main.transform.position` — read origin on shake start, restore on tween end.
- `Camera.main.WorldToScreenPoint(Vector3)` — damage-number coord conversion.
- `UnityEngine.Random.insideUnitSphere` — shake offset.
- `Time.timeScale` — hit-stop toggle.

### 5.3 RadiantArena
- `PlayerHitEvent.point` (world Vector3) — passed to CameraShaker (origin reference unused, but useful for D.U7b directional shake) + DamageNumberLayer (convert to screen).
- `WallBounceEvent.point` — same.

---

## 6. Architecture decisions

### 6.1 Hand-rolled camera shake, not Cinemachine
Pros: zero package dependency, simple `transform.position` jitter, one file. Cons: doesn't compose with existing Cinemachine virtual cams if D.U8 adds any.
Mitigation: when D.U8 introduces gameplay cameras, `CameraShaker` can be swapped for `CinemachineImpulseSource` behind the same `Shake(intensity, duration)` facade. Today, no virtual cam exists, and adding Cinemachine just for shake is overkill.

### 6.2 Shake envelope = `BillTween.Float(1f, 0f, duration, ...)` driving `Random.insideUnitSphere * intensity * envelope`
Each tween-tick callback writes `transform.position = _origin + Random.insideUnitSphere * intensity * envelopeValue`. As envelope decays 1→0, jitter shrinks to nothing. On tween complete, callback `transform.position = _origin` snaps back deterministically.

### 6.3 Hit-stop: re-entry extends the deadline (Max), doesn't stack/divide
If a second `HitStop.Trigger(120)` fires while the first 60ms restore is pending, we want the longer duration to win — not double-restore-cancel logic. Implementation: track `_pendingRestoreAtUnscaled` (Time.unscaledTime + duration). On trigger, set `Time.timeScale=0.05` if not already; compute new deadline = `max(existing, now+duration)`; schedule a single `Bill.Timer.Delay(deadline - now, restore, unscaled=true)`. Restore callback verifies it's the latest deadline before restoring (`if (Time.unscaledTime >= _pendingRestoreAtUnscaled) Time.timeScale = 1f`).

### 6.4 DamageNumberLayer is its own BasePanel, separate from HudPanel
Cleaner separation: HudPanel renders bars + timer (stable layout), DamageNumberLayer overlays transient floating labels. They open/close on the same lifecycle (Countdown.Enter ↔ EndState.Enter / LobbyState defensive close). Sharing one panel would mean HudPanel's USS layout has to accommodate child overlays — extra coupling for no benefit.

### 6.5 Damage number positioning: world → screen → panel pixel coords
```csharp
var screen = Camera.main.WorldToScreenPoint(worldPos);  // origin bottom-left
var panelY = Screen.height - screen.y;                  // flip to top-left
label.style.left = new StyleLength(screen.x);
label.style.top  = new StyleLength(panelY);
```
Works because default `PanelSettings.scaleMode = ConstantPixelSize` makes panel coords = pixel coords. If D.U8/D.U10 changes to `ScaleWithScreenSize`, the conversion needs `RuntimePanelUtils.ScreenToPanel` instead — flagged in §10 risks.

### 6.6 Damage number animation: 3 phases via BillTween joined sequence
- **Phase A (pop in)**: scale 0 → 1.2 over 80ms.
- **Phase B (settle)**: scale 1.2 → 1.0 over 80ms.
- **Phase C (drift + fade)**: position-up 60px + alpha 1 → 0 over 600ms.

Total ~760ms. Crit doubles the base font size (USS class `.crit`) and uses golden color. Implementation: chain via `BillTween.Sequence().Append(...).Join(...)`, or simpler: 3 separate `BillTween.Float` calls — Phase A's tween's `OnComplete` triggers Phase B, etc. Since `BillTween.OnComplete(...)` exists per the API surface, use callbacks (simpler than Sequence here).

Actually — looking at the surface, simpler still: just 1 tween for the full 760ms whose setter applies all three transforms based on a single `t ∈ [0, 1]` parameter, with internal phase math. One callback, one tween-rent, easier to kill on destroy.

### 6.7 JuicePresenter spawned by ArenaBootstrap, lives for app lifetime
Same pattern as `NetClient.Awake → Instance + DontDestroyOnLoad`. JuicePresenter subscribes events in `Awake`, unsubscribes in `OnDestroy`. Lives across all scene loads / state transitions — no need to spawn per-Countdown.

`ArenaBootstrap.InitArena()` adds:
```csharp
var juiceGo = new GameObject("[JuicePresenter]");
juiceGo.AddComponent<JuicePresenter>();
```
After `ArenaStates.Register()`.

### 6.8 Shake intensity scales: 0.3 hit / 0.6 crit / 0.15 wall_bounce
Per `TASKS.md` D.U7 / `RADIANT_ARENA_UNITY.md` §9 reference: `intensity: isCrit ? 0.6f : 0.3f, duration: 0.25f` for hits. Wall bounce = small (0.15, 0.15). Hard-coded constants in `JuicePresenter` for now — D.U7b could externalize to `Bill.Config` if Bill wants tuning at runtime.

### 6.9 Hit-stop durations: 60ms hit / 120ms crit
Per RADIANT_ARENA_UNITY.md §9 reference. Hard-coded same as shake intensities.

### 6.10 Wall bounce gets shake but NOT hit-stop or damage number
Wall bounce isn't a damage event — server's TrajectoryPointSchema has `event="wall_bounce"` separate from `event="hit:N"`. Hit-stop and damage numbers are for damage moments. Wall bounce is just a kinematic snap; small shake is the right read.

---

## 7. MCP touchpoints

| Step | Tool |
|---|---|
| Write .cs / .uxml / .uss | `Write` |
| Force-refresh after new files | `mcp__unityMCP__refresh_unity scope=all mode=force` (D.U5/D.U6 lesson) |
| Console error check | `mcp__unityMCP__read_console types=["error"]` |
| Mock smoke | `mcp__unityMCP__execute_code compiler=codedom` (D.U5 lesson) — fire synthetic events + probe Time.timeScale + Camera.main.transform.position + DamageNumberLayer child count |
| Verify panel children | `mcp__unityMCP__find_gameobjects "[Bill.UI]"` + reflection probe panel internals |

No `manage_asset`/`manage_prefabs` — no asset deps (defers to D.U7b).

---

## 8. Smoke test plan

### 8.1 Per-sub compile gate
After every Write: `refresh_unity` (force when new files) → `read_console types=["error"]` empty.

### 8.2 Mock smoke (Sub 7)
1. Stop/start Play (fresh Bill).
2. `ArenaStates.Register()` explicit; prime ArenaContext (MyDiscordId="me", OpponentDiscordId="opp"); inject PlayerSnapshots; `Bill.State.GoTo<CountdownState>()`.
3. Verify: HudPanel + DamageNumberLayer both open. `[Juice] JuicePresenter ready` logged at boot.
4. Probe `Camera.main.transform.position` → record as `origin`.
5. Fire `PlayerHitEvent { damage=25, isCrit=false, victimId="opp", point=Vector3(2,0,0) }`.
6. Immediately probe: `Time.timeScale` should be 0.05; `Camera.main.transform.position` should differ from origin (shake started); DamageNumberLayer root should have 1 child Label whose text is "25".
7. Sleep 0.2s (let Bill.Timer restore + tween settle a bit). Probe again: `Time.timeScale` should be 1f; shake position still differs (250ms shake still in flight); child count still 1.
8. Sleep 0.5s. `Camera.main.transform.position` should be near origin (shake decayed); child Label still present (in fade phase).
9. Sleep 0.5s. Label child count = 0 (auto-destroyed after fade).
10. Fire `PlayerHitEvent { damage=80, isCrit=true, victimId="opp", point=Vector3(-1,0,1) }`. Verify: crit Label has `.crit` class + bigger font (probe via `ClassListContains` + `resolvedStyle.fontSize`).
11. Fire `WallBounceEvent { point=Vector3(3,0,0) }`. Verify: Camera deviates briefly (small shake); NO new damage label; Time.timeScale unchanged.
12. Stop Play. `read_console types=["error"]` → 0.

### 8.3 Visual feel (Bill manual, optional)
Re-Play, mock to Animating, manually fire 5-point trajectory from D.U5 smoke recipe → real PlayerHitEvent comes through trajectory playback → watch HUD bar drop + camera shake + damage number pop + hit-stop. Subjective sign-off = D.U7a close on this side.

---

## 9. Bill checkpoints

| After Sub | Checkpoint |
|---|---|
| Sub 3 (HitStop) | Confirm 60ms / 120ms durations feel right (re-tune in §6.9 hardcodes). |
| Sub 4 (DamageNumberLayer) | UXML/USS sanity — Bill can override font sizes / golden hex. |
| Sub 7 (mock smoke) | All probes pass + feel check optional. Close D.U7a. |

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| `Camera.main` null if scene has no Main Camera tag | Bootstrap.unity already has Main Camera (D.U1 verified). CameraShaker `Awake` guards null. |
| Hit-stop fires while another shake/tween mid-flight — tweens slow with timeScale | This is the desired effect. Shake decay slows in slo-mo = chunky impact feel. |
| Hit-stop reentry from rapid hits stacks the timer.scale | §6.3 design — Max deadline, single restore callback gated by `Time.unscaledTime >= _pendingRestoreAtUnscaled`. |
| World→screen behind camera returns negative Z — damage number off-screen | Check `screen.z > 0` before positioning; if behind cam, skip (return without spawn). |
| `PanelSettings.scaleMode != ConstantPixelSize` breaks pixel coords | Default value is ConstantPixelSize for newly-created panels; D.U3 didn't change. If D.U10 changes, switch to `RuntimePanelUtils.ScreenToPanel`. |
| Crit damage number font size set via inline style vs USS class — class wins | Use `EnableInClassList("crit", isCrit)` + USS rule `.damage-number.crit { font-size: 32px; color: gold; }`. Avoids C# math. |
| Tween destroy race — Label destroyed mid-tween, setter throws on disposed VisualElement | Hold a `_alive` bool captured in closure; check before mutating. Or use `BillTween.KillTarget(label)` on label destroy. |
| ArenaBootstrap spawns JuicePresenter every scene load → duplicate subscribers | `ArenaBootstrap.Start` runs on first frame of every scene. Guard with `JuicePresenter.Instance != null` check before spawning (same pattern as NetClient). |

---

## 11. Definition of Done (D.U7a close)

- [ ] Console clean after all writes.
- [ ] JuicePresenter spawned once at boot; subscribes events; unsubscribes on destroy.
- [ ] CameraShaker.Shake deflects Camera.main.transform.position and restores cleanly.
- [ ] HitStop.Trigger drops Time.timeScale to 0.05 and restores after the right duration (unscaled).
- [ ] DamageNumberLayer spawns Label on PlayerHitEvent, animates pop+drift+fade, self-destroys.
- [ ] Crit damage labels use `.crit` class (bigger, golden).
- [ ] Wall bounce triggers small shake only (no hit-stop, no damage number).
- [ ] Mock smoke §8.2 passes all probes.
- [ ] REPORT.md drafted + folder moved to `done/`.

D.U7b (anticipation pulse, audio, color flash) deferred — open after D.U8 weapon prefab + SFX pack + Volume profile.

---

## 12. References

- [`Assets/RadiantArena/Scripts/Events/ArenaEvents.cs:93`](../../../Assets/RadiantArena/Scripts/Events/ArenaEvents.cs#L93) — PlayerHitEvent + WallBounceEvent (event grammar source of truth).
- [`Assets/RadiantArena/Scripts/Trajectory/TrajectoryRenderer.cs`](../../../Assets/RadiantArena/Scripts/Trajectory/TrajectoryRenderer.cs) — where events fire from. `worldPos` passed in matches what JuicePresenter receives.
- [`RADIANT_ARENA_UNITY.md` §9](../../../arena-unity/RADIANT_ARENA_UNITY.md#L840) — reference numbers for shake intensity / hit-stop duration / damage number animation.
- [`done/D.U6-hud-result/PLAN.md`](../../tasks/done/D.U6-hud-result/PLAN.md) — same Resources/UXML pattern.
- Memory: [[mcp_execute_code_codedom]] + [[arena_states_register_idempotent]].
