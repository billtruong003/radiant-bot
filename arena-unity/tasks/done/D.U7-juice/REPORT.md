# D.U7 — Juice pass · REPORT

> Closed 2026-05-18 (Opus 4.7, sequential auto-run per D.U4/D.U5/D.U6 precedent).

---

## Result: D.U7a PASS · D.U7b deferred as planned

Three of six juice effects ship — the ones that don't need external assets:

- **`CameraShaker`** — hand-rolled `Camera.main.transform.position` jitter driven by `BillTween.Float` envelope (1→0 over duration), Random.insideUnitSphere offset scaled by `intensity * envelope`. Restores origin on complete. Zero Cinemachine dependency.
- **`HitStop`** — `Time.timeScale = 0.05f` with reentry-safe `Bill.Timer.Delay(..., unscaled: true)` restore. Max-deadline pattern: subsequent triggers within the freeze window extend the deadline; pending callbacks short-circuit if a newer Trigger pushed past their captured time.
- **`DamageNumberLayer`** — BasePanel hosting transient Label children, spawned via `Spawn(worldPos, dmg, isCrit)`. Single `BillTween.Float(0→1, 0.76s)` setter drives 3-phase transform inline (scale 0→1.2 in 0-0.105 / 1.2→1.0 in 0.105-0.21 / drift up 60px + opacity 1→0 in 0.21-1.0). Crit labels gain `.crit` USS class (36px, gold).

Wired by **`JuicePresenter`** MonoBehaviour singleton, spawned in `ArenaBootstrap.InitArena` (DontDestroyOnLoad). Subscribes `PlayerHitEvent` + `WallBounceEvent` from D.U5; dispatches to the three subsystems.

Lifecycle: `DamageNumberLayer` opens at `CountdownState.Enter` alongside `HudPanel`, closes at `EndState.Enter` + `LobbyState.Enter` defensive. JuicePresenter lives across scene loads.

### Mock-smoke chain

```
─ Step A — Countdown enter ────────────────────────────────────────────────────
[Bill.State] None -> Countdown
[Arena.Countdown] Enter — server lock, awaiting phase=active
[Arena.HUD] opened, snapping bars me=100/100 opp=100/100
→ state=Countdown · juiceAlive=True · hudOpen=True · dmgOpen=True

─ Step B — Hit (damage=25, isCrit=false) ──────────────────────────────────────
[Juice] JuicePresenter ready
[Juice.HitStop] Time.timeScale=0.05, restore in 0.06s
[Arena.Dmg] spawn dmg=25 crit=False screen=(...)
→ timescale=0.050 · dmgLabels=1 · firstText='25' · firstCrit=False

─ Step C — Crit (damage=80, isCrit=true) ──────────────────────────────────────
[Juice.HitStop] extended freeze, new deadline in 0.12s
[Arena.Dmg] spawn dmg=80 crit=True screen=(...)
→ timescale=0.050 · dmgLabels=2 · lastText='80' · lastCrit=True

─ Step D — Wall bounce ────────────────────────────────────────────────────────
(manual Time.timeScale=1 reset before fire so we can isolate)
→ beforeCount=2 · afterCount=2 · timescaleAfter=1.000
  (no new damage label, no hit-stop — wall bounce = shake only)
```

Final `read_console types=["error"]` after Play stop: **0 entries**. Baseline warnings (URP missing types + BillInspector dup menu) unchanged.

---

## Sub-by-sub status

| Sub | Status | Commit | Notes |
|---|---|---|---|
| Stage 1 docs | ✅ | `5719f92` | PLAN + SUBTASKS + OPUS_PROMPTS. |
| 1. Verify baseline | ✅ | — | Console clean; no prior `Bill.Timer.Delay(..., unscaled: true)` in RadiantArena; no prior Camera.main shake; no PanelSettings.scaleMode override. |
| 2. CameraShaker | ✅ | `8de7b56` | Static API `Shake(intensity, duration)` — BillTween envelope drives Random.insideUnitSphere offset. OnComplete restores origin. |
| 3. HitStop | ✅ | `77e8d7d` | Reentry-safe Max-deadline; TryRestore short-circuits if newer Trigger advanced `_restoreAtUnscaled`. |
| 4. DamageNumberLayer | ✅ | `86495ae` | UXML empty fullscreen root + USS (.damage-number + .damage-number.crit) + .cs (BasePanel + Spawn(worldPos, dmg, isCrit) with 3-phase tween). |
| 5. JuicePresenter | ✅ | `f48470a` | Singleton MonoBehaviour, DontDestroyOnLoad, subscribes PlayerHit + WallBounce. Tunable constants inline. |
| 6. Bootstrap + lifecycle wire | ✅ | `fe3dd80` | ArenaBootstrap.InitArena spawns JuicePresenter; CountdownState opens DamageNumberLayer; EndState + LobbyState close it. |
| 7. Mock smoke (+ teardown fix) | ✅ | `fb84c5a` | Wiring verified via dispatcher side effects (timescale=0.05, label spawn with correct text/class, wall bounce no-label-no-timescale). Followup fix: guard JuicePresenter.OnDestroy with `Bill.IsReady` to avoid `SERVICE NOT FOUND: IEventBus` NRE on Play teardown. |

---

## Deviations from PLAN

1. **ArenaBootstrap race — JuicePresenter not yet spawned when Sub 7 first probed.**
   Mock smoke entered Play, immediately ran execute_code, and `JuicePresenter.Instance` was `null`. ArenaBootstrap.Start hadn't ticked yet (same `[RuntimeInitializeOnLoadMethod]` + first-frame Start race as D.U5/D.U6 with `ArenaStates.Register()`). Workaround: smoke spawns JuicePresenter manually with the same `if (Instance == null)` guard — idempotent with bootstrap. Adding to memory: any singleton spawned in `ArenaBootstrap.InitArena` may need manual fallback-spawn in mock smoke prologue.

2. **`Bill.Events`/`Bill.Timer` services torn down before `JuicePresenter.OnDestroy` runs on Play stop.**
   First Sub 7 attempt logged on stop:
   ```
   [Bill] SERVICE NOT FOUND: IEventBus
   NullReferenceException: Object reference not set to an instance of an object
   ```
   Cause: ServiceLocator cleans up Bill services before our DDOL JuicePresenter's `OnDestroy` fires. `Bill.Events.Unsubscribe(...)` then NREs. Patched in commit `fb84c5a`: wrap unsubscribe block in `if (Bill.IsReady) { ... }`. Worth documenting as a general DDOL+Bill teardown pattern for any future `OnDestroy` that touches Bill services.

3. **Time.time stalls during MCP idle — visual probes (camera position, tween-applied opacity) not directly verifiable.**
   Same D.U5 lesson: when Editor unfocused (which MCP runs make it), `Time.timeScale * deltaTime` accumulates very slowly. BillTween's setter never fired between our `Fire` and `Probe` calls, so the camera position read back as `(0, 1, -10)` (origin unchanged). Wiring confirmed via dispatcher side effects instead:
   - HitStop set `Time.timeScale = 0.05f` synchronously ⇒ proves JuicePresenter → HitStop pipeline works.
   - DamageNumberLayer added Label child synchronously ⇒ proves dispatcher → DamageNumberLayer pipeline works.
   - Wall bounce produced no label + no timescale change ⇒ proves the `OnWallBounce ≠ OnPlayerHit` branch.
   - CameraShaker.Shake fires (we just can't see the position oscillate via reflection probe in paused Editor). Bill's manual feel-check in focused Editor will validate visually.

4. **Smoke called `Time.timeScale = 1f` manually before Step D so we could isolate wall-bounce-doesn't-engage-HitStop.**
   Without the manual reset, the still-active hit-stop from Step C would mask the test. Documented inline in the execute_code body. Not a behavior gap — just a smoke shortcut.

5. **Damage label parent (`_root`) is the BasePanel root, not the inner UXML `name="root"` VisualElement.**
   PLAN §6.4 referenced `hostRoot = _root.Q<VisualElement>("root") ?? _root`. Verified in smoke: `rootChildren=2` (CloneTree UXML root + 1 dmg Label). The inner UXML "root" doesn't intercept add — labels parent under the BasePanel-provided `_root`. Works fine. Adjusted the simpler implementation in Sub 4 (just `_root.Add(label)`) and removed the Q-and-fallback dance. Not a deviation per se — code matches PLAN end-state behavior.

---

## Bill checkpoints — what happened

| Checkpoint | Outcome |
|---|---|
| Sub 1 | All 4 baseline assumptions confirmed; no surprises. |
| Sub 3 | Auto-run, code review skipped. HitStop reentry math available in commit `77e8d7d` if Bill wants to revisit. |
| Sub 4 | Auto-run. 3-phase tween math available in commit `86495ae`. |
| Sub 7 | Mock smoke passes; one teardown-NRE fix added inline (commit `fb84c5a`). D.U7a closed pending Bill's subjective feel-check. |

---

## What's left for D.U7b (asset-blocked)

1. **Anticipation pulse** — weapon model scale 1.0 → 1.15 → 1.0 over 80ms before release. Needs D.U8 weapon prefab.
2. **Layered hit/crit audio** — `body thud + harmonic ring + sub-bass` as 3 SFX one-shots. Needs Bill to provide SFX pack + register with `Bill.Audio`.
3. **Color flash on crit** — chromatic aberration spike + vignette via URP Volume profile. Needs Volume profile asset with both overrides + a `BillTween.Float` driver on the profile weights.

All 3 effects already have firing hooks (PlayerHitEvent + WallBounceEvent), so D.U7b is purely asset-side + a few `JuicePresenter` add-ons.

---

## What's left for downstream Láts (not D.U7 scope)

- **Subjective feel-check**: Bill plays Game View focused, manually fires PlayerHitEvent (or runs the D.U5 trajectory smoke to inject real hits), eyeballs whether shake intensity / hit-stop duration / damage number animation feel right. Re-tune the constants in `JuicePresenter.cs` (`ShakeHit = 0.30f`, etc.) if needed.
- **HP bar pop-scale** on damage (suggested optional D.U6 polish) — easy follow-up; fold into D.U7b or do as a one-line follow-up.

---

## Known baseline (NOT D.U7 issues)

- `Missing types referenced from component UniversalRenderPipelineGlobalSettings` — D.U1 URP downgrade leftover.
- `Cannot add menu item 'Tools/BillInspector/Validation Window'` — pre-existing dup from ArenaDevMenu untracked file.
- 3× `No Theme Style Sheet set to PanelSettings` — D.U3 patches `Bill.UI` at runtime; DebugOverlay + CheatConsole still warn at boot.

---

## Files added/edited

| Path | Lines | Status |
|---|---|---|
| `Assets/RadiantArena/Scripts/Juice/CameraShaker.cs` | 52 | new |
| `Assets/RadiantArena/Scripts/Juice/HitStop.cs` | 65 | new |
| `Assets/RadiantArena/Scripts/Juice/JuicePresenter.cs` | 92 | new (incl. teardown fix) |
| `Assets/RadiantArena/UI/DamageNumberLayer.cs` | 94 | new |
| `Assets/RadiantArena/UI/Resources/DamageNumberLayer.uxml` | 8 | new |
| `Assets/RadiantArena/UI/Resources/damage_number.uss` | 20 | new |
| `Assets/RadiantArena/Scripts/Bootstrap/ArenaBootstrap.cs` | +7 | edit (spawn JuicePresenter) |
| `Assets/RadiantArena/Scripts/States/CountdownState.cs` | +1 | edit (open DamageNumberLayer) |
| `Assets/RadiantArena/Scripts/States/EndState.cs` | +1 | edit (close DamageNumberLayer) |
| `Assets/RadiantArena/Scripts/States/LobbyState.cs` | +1 | edit (defensive close DamageNumberLayer) |
| (meta sidecars) | — | auto-generated by Unity import |

Stage 1 docs: ~960 lines under `arena-unity/tasks/todo/D.U7-juice/`.

---

## Commits (this Lát)

```
fb84c5a fix(arena-unity/Lát-D.U7): guard JuicePresenter.OnDestroy with Bill.IsReady — avoid SERVICE NOT FOUND NRE on Play stop teardown
fe3dd80 feat(arena-unity/Lát-D.U7): wire JuicePresenter spawn in ArenaBootstrap + DamageNumberLayer open/close lifecycle (Countdown/End/Lobby)
f48470a feat(arena-unity/Lát-D.U7): add JuicePresenter — central PlayerHit/WallBounce dispatcher → shake/hit-stop/damage-number
86495ae feat(arena-unity/Lát-D.U7): add DamageNumberLayer BasePanel + UXML + USS — runtime Label spawn with pop/drift/fade tween
77e8d7d feat(arena-unity/Lát-D.U7): add HitStop — Time.timeScale toggle with reentry-safe unscaled restore
8de7b56 feat(arena-unity/Lát-D.U7): add CameraShaker — hand-rolled position jitter on Camera.main via BillTween envelope
5719f92 docs(arena-unity/Lát-D.U7): Stage 1 architect — PLAN + SUBTASKS + OPUS_PROMPTS
```

---

## Next lát: D.U8 — Weapon prefabs

Prereqs unblocked by D.U7a:
- Anticipation pulse can land in D.U7b once D.U8 ships weapon prefabs (1.0→1.15 transform scale).
- HUD currently shows `SelectedWeaponSlug` as a fallback when `LockedWeapon == null`. D.U8 prefab-display-name lookup will resolve this.

Prereqs STILL blocked:
- ⏸ Server Lát D.5 physics for any live-match smoke that involves real damage / HP / match end.
- ⏸ SFX pack + URP Volume profile for D.U7b.
