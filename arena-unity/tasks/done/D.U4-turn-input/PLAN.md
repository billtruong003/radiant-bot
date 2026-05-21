# D.U4 — TurnInputPanel + drag-aim · PLAN

> Stage 1 (Architect). Bill confirm scope/workflow → run Stage 2 sequentially per `feedback_executor_opus_sequential.md` precedent.
> Date: 2026-05-17 · Executor: Opus 4.7.

---

## 1. Goal

Stand up the **per-turn input loop**: client observes `phase=countdown → active → animating`, wires the state machine through it, and renders a drag-aim mechanic when it's my turn. Player drags from a screen position → aim line + power gauge fills → release fires `Send("shoot", { angle, power })`. Opponent's turn shows a passive "đang đánh" overlay.

After D.U4a closes (client-only, server-blocked):
- 4 new `GameState`s registered: `CountdownState`, `MyTurnState`, `OpponentTurnState`, `AnimatingState` (last is stub for D.U5).
- `LobbyState` transitions to `CountdownState` on `phase=countdown`.
- `CountdownState` decides `MyTurn` vs `OpponentTurn` on `phase=active` by reading `ArenaContext.TurnPlayerId`.
- `MyTurnState` opens `TurnInputPanel` + spawns `ArenaAimController` (scene-side `MonoBehaviour` with `LineRenderer`).
- Input System (`Mouse.current`) drives drag — Bill's `activeInputHandler=2` (Both) makes this work since D.U1.
- Drag mechanic per `RADIANT_ARENA_UNITY.md` §8: slingshot direction (aim = -drag), dead zone <10%, max distance saturates power 1.0.
- Release inside dead zone cancels; outside fires `Send("shoot", new ShootMsg { angle, power })`, transitions to `AnimatingState`.
- Opponent path: same `phase=active` event, different branch → `OpponentTurnState` with passive overlay.

---

## 2. Scope split (D.U4a now, D.U4b after server D.4)

| Sub-scope | Status | Notes |
|---|---|---|
| **D.U4a (this Lát)** | | |
| 4 new states + transitions | ✅ GO | Wires through PhaseChangedEvent (D.U2 plumbing). |
| TurnInputPanel UXML + USS + .cs | ✅ GO | Timer countdown, power gauge bar, hint label. |
| ArenaAimController + LineRenderer | ✅ GO | Reads Mouse.current, renders aim arc, raises AimUpdated/ShotReleased events. |
| Extend ArenaContext + ArenaEvents | ✅ GO | Add TurnPlayerId/TurnDeadlineAt + 4 events. |
| Wire LobbyState → CountdownState | ✅ GO | LobbyState.OnPhaseChanged already stubs; activate. |
| Mock smoke (no server) | ✅ GO | execute_code reflection injects phase transitions, verifies panel/controller spawn + state graph. Live drag input deferred to manual visual check by Bill. |
| **D.U4b (deferred until server D.3 + D.4)** | | |
| Server-driven turn loop: countdown → active → my drag → animation_complete → opp's turn | ⏸ BLOCKED on server D.4 (turn loop + shoot/animation_complete handlers) | Same blocker shape as D.U2b + D.U3b. |
| Turn deadline enforcement (30s timeout server-side) | ⏸ STUB | TurnInputPanel computes UI countdown locally from `ArenaContext.TurnDeadlineAt`; server enforces actual timeout. |
| Real shot resolution + animation playback | ⏸ BLOCKED | D.U5 handles `shot_resolved` payload; D.U4 just transitions into `AnimatingState` which stubs until D.U5. |
| Live drag input smoke (Bill manually drags in Game View) | ✅ post-D.U4a | Optional manual visual check after Sub 9. |

---

## 3. Project state (verified 2026-05-17)

- ✅ D.U3a closed with `LobbyState` listening for `PhaseChangedEvent { newPhase="countdown" }` → currently logs only.
- ✅ `ArenaContext` snapshot exists with `MyPlayer / OpponentPlayer / CurrentPhase / CurrentRound`. **Missing**: `TurnPlayerId`, `TurnDeadlineAt`. Sub 2 extends.
- ✅ `MessageTypes.cs` already defines `ShootMsg { angle, power }` and `AnimationCompleteMsg { round }` from D.U2.
- ✅ `activeInputHandler=2` (Both) — both legacy `UnityEngine.Input` and Input System work. Reference doc uses `Mouse.current` (Input System) — adopt that, modern + future-proof.
- ✅ Bootstrap.unity has Main Camera at default position. ArenaAimController uses `Camera.main.ScreenPointToRay` + Y=0 ground plane. Placeholder geometry until D.U8 weapon prefabs.
- ✅ ArenaRuntimeTheme + pickingMode shim (D.U3 commit `a3fcc6f`) ensures TurnInputPanel renders text + receives clicks.
- ⚠️ Schema `DuelState.turn_player_id` is `string` (D.U2 mirror). Hydration in `ArenaContext.HydrateFrom` needs to copy it — Sub 2.
- ⚠️ `DuelState.turn_deadline_at` is `uint32` (server stores epoch-relative ms or ms-from-turn-start; treat as raw ms in client). Sub 2 stores as `long`.

---

## 4. Files this Lát will touch

| Path | Action | Purpose |
|---|---|---|
| `Assets/RadiantArena/Scripts/Net/ArenaContext.cs` | EDIT | Add `TurnPlayerId / TurnDeadlineAt` properties + hydration. |
| `Assets/RadiantArena/Scripts/Events/ArenaEvents.cs` | EDIT | Add 4 events: `TurnStartedEvent`, `AimUpdatedEvent`, `AimClearedEvent`, `ShotReleasedEvent`. |
| `Assets/RadiantArena/Scripts/States/CountdownState.cs` | CREATE | 3s overlay panel state; transitions on phase=active. |
| `Assets/RadiantArena/Scripts/States/MyTurnState.cs` | CREATE | Open TurnInputPanel + spawn ArenaAimController; route ShotReleased → NetClient.Send → AnimatingState. |
| `Assets/RadiantArena/Scripts/States/OpponentTurnState.cs` | CREATE | Open passive overlay (TurnInputPanel in "spectator" mode? or separate? — decision §6.3). |
| `Assets/RadiantArena/Scripts/States/AnimatingState.cs` | CREATE | Stub for D.U5. Just logs + waits for phase change. |
| `Assets/RadiantArena/Scripts/States/LobbyState.cs` | EDIT | Activate `phase=countdown → Bill.State.GoTo<CountdownState>()`. |
| `Assets/RadiantArena/Scripts/States/ArenaStates.cs` | EDIT | Register 4 new states. |
| `Assets/RadiantArena/UI/Resources/TurnInputPanel.uxml` | CREATE | Overlay: timer header + power gauge bar (right side) + hint label (bottom-center). |
| `Assets/RadiantArena/UI/Resources/turn_input.uss` | CREATE | Style. Reuse glassmorphism + tier colors from `lobby.uss`. |
| `Assets/RadiantArena/UI/TurnInputPanel.cs` | CREATE | BasePanel impl + scheduler-driven timer + AimUpdated subscriber for power gauge. |
| `Assets/RadiantArena/Scripts/Weapons/ArenaAimController.cs` | CREATE | MonoBehaviour singleton. Update polls Mouse, ScreenToWorld, draws LineRenderer, fires events. |

**Out-of-scope** (defer D.U5+):
- `TrajectoryPlayer` — D.U5.
- `HudPanel` (HP bars, weapon name) — D.U6.
- Camera shake / hit-stop / juice on shoot — D.U7.
- Weapon prefab positioning (real shooter position) — D.U8.

---

## 5. APIs used

### 5.1 BillGameCore (already wired)
- `Bill.UI.Open<T>(Action<T>)`, `Bill.UI.Close<T>()`.
- `Bill.State.AddState<T>(T)`, `Bill.State.GoTo<T>()`.
- `Bill.Events.Subscribe / Unsubscribe / Fire<T>(T)`.
- `Bill.Timer.Delay(seconds, Action)` — countdown ticks if needed (alternative to `VisualElement.schedule`).

### 5.2 Unity (Input + Camera + Rendering)
- `UnityEngine.InputSystem.Mouse.current` — `position.ReadValue()`, `leftButton.{isPressed, wasPressedThisFrame, wasReleasedThisFrame}`.
- `UnityEngine.Touchscreen.current` — touch fallback for mobile (defer to D.U10 polish; Editor uses Mouse only).
- `Camera.main.ScreenPointToRay(Vector2)` + `Plane.Raycast` against Y=0 ground.
- `LineRenderer` + simple material (URP Unlit shader, runtime-created `Material(Shader.Find("Universal Render Pipeline/Unlit"))`).
- `Mathf.Atan2(z, x)` for angle.
- `Mathf.Clamp01(magnitude / max)` for power.

### 5.3 RadiantArena types
- `NetClient.Instance.Send("shoot", new ShootMsg { angle, power })`.
- `ArenaContext.TurnPlayerId` (Sub 2 adds).
- `ArenaContext.MyDiscordId` for self-comparison.

---

## 6. Architecture decisions

### 6.1 Drag-aim is slingshot-style (aim direction = `-drag.normalized`)
Matches `RADIANT_ARENA_UNITY.md` §8 + SKILL.md §2.6. Player intuition is "pull the slingshot back" — opposite drag is the firing direction. Dead zone of 10% prevents accidental tap-fires.

### 6.2 Input System is the primary handler
`activeInputHandler=2` lets us use `Mouse.current` cleanly. Code is simpler, designer-friendly. Touch fallback (`Touchscreen.current`) is logged but not wired this Lát — WebGL on mobile is D.U10 territory.

### 6.3 OpponentTurnState reuses TurnInputPanel in "spectator" mode
Two options:
- **Separate `OpponentPanel`** — clean, more files.
- **TurnInputPanel with `SetSpectator(bool)` flag** — single asset, two modes. Spectator mode: hides power gauge, shows different hint text ("Đối thủ đang đánh..."), no input listener.

Decision: single `TurnInputPanel` with a `SetMode(TurnMode)` enum (Self vs Spectator). Lower asset count, easier to keep visual consistent. UXML still has both elements; USS toggles via `.spectator` class on root.

### 6.4 ArenaAimController is a runtime-spawned MonoBehaviour, lives only during MyTurnState
- `MyTurnState.Enter`: `new GameObject("[ArenaAimController]").AddComponent<ArenaAimController>()`.
- `MyTurnState.Exit`: `Destroy(controller.gameObject)`.
- Reasoning: no need for a permanent scene GO; per-turn spawn keeps lifecycle clean.
- LineRenderer + material are created in `Awake()`; destroyed with the GO.

### 6.5 Drag origin is a fixed placeholder for D.U4a
Without D.U8 weapon prefabs, the "shoot from" world position is not defined. For D.U4a, use the scene origin `Vector3.zero` (or a `Transform` Anchor that Bill can place). Documented as a known limitation; D.U8 will wire `ArenaAimController.SetOrigin(weaponPrefab.transform)`.

### 6.6 Timer countdown is client-side cosmetic
`ArenaContext.TurnDeadlineAt` (epoch ms) drives the visible timer in `TurnInputPanel`. Server enforces the actual timeout — if the client clock drifts, server still wins. Client displays `max(0, deadline - now)` ms remaining.

For D.U4a smoke without server: a fallback. If `TurnDeadlineAt == 0`, panel shows a placeholder (e.g., "—:—"). Mock can inject a value to test the countdown rendering.

### 6.7 Power gauge in UI Toolkit
Not Unity's `Slider` (which is for input). Custom: `VisualElement` named `power-fill` whose `style.height` is bound to `power * 100%` via `style.height = new StyleLength(Length.Percent(power * 100))`. Wrapper `power-track` has fixed height + dark background, `power-fill` overlays bottom-up with green→yellow→red color ramp.

### 6.8 AimUpdated/AimCleared events for panel ↔ controller decoupling
Controller emits while dragging; Panel listens and updates power gauge. Decoupling means: D.U7 juice can subscribe AimUpdated to drive camera FOV bump, particle preview, etc. without touching Controller or Panel.

### 6.9 ShotReleasedEvent is fired by Controller; consumed by MyTurnState only
Local-only event — never fires when state is Opponent or other. State subscribes in Enter, unsubscribes in Exit. Payload: `{ float angle; float power; }`.

---

## 7. MCP touchpoints

| Step | Tool |
|---|---|
| Write .cs / .uxml / .uss | `Write` + `mcp__unityMCP__refresh_unity` |
| Console clean check after each sub | `mcp__unityMCP__read_console` |
| Mock smoke (Sub 9) | `mcp__unityMCP__execute_code` to inject phase transitions via reflection |
| Verify TurnInputPanel renders | `find_gameobjects` + check UIDocument child count |

No scene edits — ArenaAimController is runtime-spawned, no prefab needed.

---

## 8. Smoke test plan

### 8.1 Per-sub compile gate
After every write: `refresh_unity` → `read_console types=["error"]` → empty.

### 8.2 Mock smoke (Sub 9)
1. Play mode + Bill ready + theme applied.
2. `execute_code`: mock ArenaContext to `phase=lobby` + populate weapons → GoTo<LobbyState>.
3. Inject `phase=countdown` via reflection setting + manually fire `PhaseChangedEvent { oldPhase=lobby, newPhase=countdown }`. Expect: `[Bill.State] Lobby -> Countdown`.
4. Inject `phase=active` + `turn_player_id = "billtruong"` (matches mock MyDiscordId). Fire `PhaseChangedEvent`. Expect: `[Bill.State] Countdown -> MyTurn` + `[Arena.MyTurn] panel opened, controller spawned`.
5. Verify GameObject `[ArenaAimController]` exists in scene.
6. Inject `phase=animating`. Fire event. Expect: `[Bill.State] MyTurn -> Animating` + controller destroyed.
7. Inject `phase=active` + `turn_player_id = "rival_dev"`. Expect: `[Bill.State] Animating -> OpponentTurn` (or direct Countdown→OpponentTurn if we test that flow separately). Verify panel opens in spectator mode.
8. Exit Play. Console clean (no NEW errors).

### 8.3 Optional live drag smoke (Bill manual)
After Sub 9 commits, Bill can re-enter Play, mock to MyTurnState, focus Game View, hold + drag mouse, release. Expected console:
- `[Arena.Aim] dragging power=0.42 angle=1.57`  (or similar tick logs)
- `[Arena.MyTurn] shot fired angle=1.57 power=0.42 → [Arena.Net] Send(shoot) ignored — not connected.`
- `[Bill.State] MyTurn -> Animating`

This is optional — formal D.U4a close happens at Sub 9 mock smoke pass.

---

## 9. Bill checkpoints

| After Sub | Checkpoint |
|---|---|
| Sub 1 | Confirm Input System Mouse.current importable; LineRenderer runtime material approach. |
| Sub 4 | TurnInputPanel UXML structure — Bill can flag spec mismatch. |
| Sub 6 | Code review ArenaAimController (drag-aim mechanic is the core feel). |
| Sub 9 | Mock smoke logs — Bill decides D.U4a close + (optional) live drag check. |

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| `Mouse.current` returns null if Input System backend not enabled | activeInputHandler=2 confirmed in D.U1; if null, fall back to `UnityEngine.Input.GetMouseButton...`. |
| `Camera.main` is null if no Main Camera tag in scene | Bootstrap.unity has Main Camera (D.U1). |
| `Plane.Raycast` returns false if camera doesn't aim at Y=0 plane | Default Main Camera (0,1,-10 looking +Z) does hit. Placeholder behavior fine; D.U8 will set proper camera framing. |
| LineRenderer with no material renders pink/missing | Sub 6 creates runtime `Material(Shader.Find("Universal Render Pipeline/Unlit"))`. |
| TurnInputPanel "spectator" mode confuses scope | Decision §6.3 documents the single-panel design; Sub 4 UXML has both element groups, `.spectator` USS class hides power-gauge group. |
| Mock smoke can't truly exercise live drag | Acknowledged — Sub 9 verifies wiring, not gameplay-feel. D.U4b smoke (post-server) exercises live. |

---

## 11. Definition of Done (D.U4a close)

- [ ] Console clean post all writes.
- [ ] 4 new states registered, transitions verified via mock smoke.
- [ ] TurnInputPanel opens for my turn, panel timer + power gauge wired.
- [ ] ArenaAimController spawns/destroys on MyTurnState boundaries.
- [ ] LobbyState → CountdownState transition activated.
- [ ] REPORT.md drafted with: shipped files + commits + deviations + D.U4b backlog.
- [ ] Folder moved `todo/D.U4-turn-input → done/D.U4-turn-input`.

D.U4b (real server turn loop + live drag-aim full smoke) deferred — REPORT documents what unblocks.
