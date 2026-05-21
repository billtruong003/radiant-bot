# D.U5 — TrajectoryRenderer playback · PLAN

> Stage 1 (Architect). Bill confirm → Stage 2 Sonnet 1 sub/invoke per `[[sonnet_one_sub_invocation]]`.
> Date: 2026-05-18 · Executor: Opus 4.7.

---

## 1. Goal

Plug the `shot_resolved` message into a playable visual: when the server broadcasts a trajectory, the client interpolates a projectile along `points[]` by their `t` timestamps, fires placeholder FX/log at each `event` marker (wall_bounce / hit:<dmg> / crit:<dmg> / pierce_player / stop), then sends `animation_complete` so the server advances the turn.

This is the **playback wiring** — visuals stay deliberately placeholder (runtime-built sphere + LineRenderer trail, simple cube FX) because:
- **D.U6** owns HP bars + result UI.
- **D.U7** owns camera shake / hit-stop / damage numbers / audio polish.
- **D.U8** owns weapon-prefab visuals.

D.U5 ships the *pipe*: server says it → client renders it → client confirms it.

---

## 2. Scope split (D.U5a now, D.U5b after server D.5)

| Sub-scope | Status | Notes |
|---|---|---|
| **D.U5a (this Lát — client-only)** | | |
| `ShotResolvedEvent` (gameplay-facing struct) | ✅ GO | Wraps `ShotResolvedMessage` — keeps Net layer one-way. |
| `NetClient.OnMessage<ShotResolvedMessage>` wiring | ✅ GO | Replace the D.U2 stub log; hydrate ArenaContext.LastTrajectory + fire event. |
| `ArenaContext.LastTrajectory` + `LastShooterId` | ✅ GO | Cached so AnimatingState can read post-event without race. |
| `TrajectoryRenderer.cs` (MonoBehaviour singleton-pattern, runtime-spawned) | ✅ GO | `Play(points, shooterId, dmg, crit, onComplete)`. Update-loop interpolation; handles event markers. |
| `AnimatingState.cs` upgrade — call TrajectoryRenderer + Send animation_complete | ✅ GO | Replace D.U4 idle stub with real playback. Empty trajectory ⇒ short delay then send (server D.4 stub case). |
| `PlayerHitEvent` + `WallBounceEvent` (gameplay events) | ✅ GO | D.U6 HUD + D.U7 juice subscribe later. |
| Mock smoke (no server) | ✅ GO | execute_code injects a synthetic 5-point trajectory + fires `ShotResolvedEvent` from AnimatingState; verify ball spawn, events logged, `animation_complete` send attempt. |
| **D.U5b (deferred until server D.5 — physics sim)** | | |
| Real `shot_resolved` from `simulateShot()` | ⏸ BLOCKED on server D.5 (no `radiant-bot/arena-server/src/physics/` yet — DuelRoom emits empty `trajectory: []`). |
| 2-instance ParrelSync end-to-end smoke (drag → shot → trajectory → HP → next turn) | ⏸ BLOCKED until D.5 ships physics. |
| **OUT OF SCOPE (deferred to later Láts)** | | |
| HP bar visuals + state-diff watcher | ❌ D.U6 | TrajectoryRenderer fires `PlayerHitEvent`; D.U6 HudPanel subscribes. |
| Camera shake, hit-stop, damage numbers, layered audio, screen flash | ❌ D.U7 | Placeholder calls (`Debug.Log` + tiny `Bill.Tween` jitter on transform.position is fine). |
| Real FX prefabs (`fx_impact_burst`, `fx_wall_dust`, `trajectory_dot`, `DamageNumber`) | ❌ D.U7 / D.U8 | Use runtime-built primitives (sphere ball, small cube FX). `Bill.Pool` registration deferred — D.U5 spawns/destroys directly. |
| Weapon hue tinting | ❌ D.U8 | Ball uses a single colour (cyan-ish). |
| Server D.5 physics + replay snapshot | ❌ server-side Lát D.5. |

---

## 3. Project state (verified 2026-05-18)

- ✅ Server `DuelRoom.handleShoot` (Lát D.4, commits `71b0363`/`9698874`) broadcasts `shot_resolved` with `trajectory: []`, shooter, damage_dealt=0, crit=false, plus debug `angle`/`power`. Physics sim (`src/physics/trajectory.ts`) **not yet present** on disk. → D.U5a must handle empty trajectory cleanly.
- ✅ Server auto-advances after `ANIMATION_TIMEOUT_MS` regardless of `animation_complete` — client send is best-effort; missing ack is recoverable.
- ✅ `NetClient.Room.OnMessage<ShotResolvedMessage>("shot_resolved", ...)` already subscribed as a stub log (`NetClient.cs:97-98`). Sub 2 replaces handler body, keeps the registration site.
- ✅ `MessageTypes.ShotResolvedMessage` exists with `trajectory: TrajectoryPointSchema[]?`, `shooter`, `damage_dealt`, `crit`. C# schema field is **`@event`** (not `event_` — RADIANT_ARENA_UNITY.md §7 ref code is outdated; we use `@event`).
- ✅ `MessageTypes.AnimationCompleteMsg { int round }` already exists for the outbound ack.
- ✅ `AnimatingState.cs` (D.U4 commit `ea698af`) already routes `PhaseChangedEvent { newPhase=active|ended }` and logs "trajectory playback deferred to D.U5". Sub 4 upgrades.
- ✅ `Bill.Pool` / `Bill.Audio` / `Bill.Timer` / `Bill.Tween` / `Bill.Events` services confirmed in [`Bill.cs:12-22`](../../Assets/BillGameCore/Runtime/Bootstrap/Bill.cs). Tween service backed by `BillTween.cs`.
- ✅ `ArenaContext.MyDiscordId` + `MyPlayer`/`OpponentPlayer` populated by NetClient.OnStateChange. New fields go on the static class (consistent with D.U4 turn fields).
- ⚠️ **No `Assets/RadiantArena/Prefabs/` or `Resources/Prefabs/Trajectory/` folder yet.** Reference impl assumes `Bill.Pool.Register("TrajectoryBall", ...)` was wired in bootstrap — it wasn't. D.U5 spawns `GameObject.CreatePrimitive(PrimitiveType.Sphere)` at runtime to avoid the dependency. D.U7 / D.U8 will swap to real pooled prefabs.
- ⚠️ Server's coordinate system is 0..1000 in x and y (2D). Unity uses 3D. We map `(simX, simY)` → world `((simX − 500) × 0.01, 0, (simY − 500) × 0.01)` (matches RADIANT_ARENA_UNITY.md §7 `WorldFromSim`). 10×10 world units total, centered.
- ⚠️ TrajectoryPointSchema reflects Colyseus `Schema`; `event` is escaped to `@event` in C#. ArraySchema<T> doesn't implement `IList<T>` cleanly — handler converts to a plain `TrajectoryPoint[]` snapshot in NetClient before firing the event (decouples gameplay from live schema, mirrors PlayerSnapshot pattern in [`ArenaContext.cs`](../../Assets/RadiantArena/Scripts/Net/ArenaContext.cs)).

---

## 4. Files this Lát will touch

| Path | Action | Purpose |
|---|---|---|
| `Assets/RadiantArena/Scripts/Events/ArenaEvents.cs` | EDIT | Add `ShotResolvedEvent` (gameplay-facing), `PlayerHitEvent`, `WallBounceEvent`, `TrajectoryFinishedEvent`. |
| `Assets/RadiantArena/Scripts/Net/ArenaContext.cs` | EDIT | Add `LastTrajectory : TrajectoryPoint[]`, `LastShooterId : string`, `LastDamage : int`, `LastCrit : bool`. Plain-C# DTO `TrajectoryPoint` (no live schema refs). |
| `Assets/RadiantArena/Scripts/Net/MessageTypes.cs` | (no change) | `ShotResolvedMessage` + `AnimationCompleteMsg` already exist. |
| `Assets/RadiantArena/Scripts/Net/NetClient.cs` | EDIT | Replace `Room.OnMessage<ShotResolvedMessage>("shot_resolved", _ => …)` stub with handler that copies trajectory → ArenaContext, fires `ShotResolvedEvent`. |
| `Assets/RadiantArena/Scripts/Trajectory/TrajectoryRenderer.cs` | CREATE | MonoBehaviour. Static `Spawn()` factory creates a GO + Renderer. `Play(...)` populates `points`, runs in `Update()`, dispatches events at marker timestamps, calls `onComplete`. Destroys itself after completion. |
| `Assets/RadiantArena/Scripts/States/AnimatingState.cs` | EDIT | Subscribe `ShotResolvedEvent` on Enter; on event spawn TrajectoryRenderer; on complete `NetClient.Instance?.Send("animation_complete", new AnimationCompleteMsg { round = ArenaContext.CurrentRound })`. Keep PhaseChanged routing fallback for empty/missing trajectory. |
| `Assets/RadiantArena/Scripts/Trajectory/TrajectoryConstants.cs` | CREATE | Centralizes sim→world scale, ball colour, event-grammar prefixes (`"hit:"`, `"crit:"`, etc.) — easy to tweak without touching the renderer. |

**No** new MCP-driven assets (no UXML, no prefabs, no materials registered to Bill.Pool — see §6.4).
**No** scene edits — TrajectoryRenderer is `new GameObject(...).AddComponent<...>()` at runtime, same pattern as `ArenaAimController` in D.U4 (`MyTurnState.cs:Enter`).

---

## 5. APIs used

### 5.1 BillGameCore (already in use)
- `Bill.Events.Fire<T>(T data)` / `Subscribe<T>` / `Unsubscribe<T>`.
- `Bill.Timer.Delay(seconds, Action, unscaled=false)` — fallback delay for empty-trajectory or `stop`-event settle.
- `Bill.State.GoTo<T>()` — only on phase-change fallback; ack-driven advance comes from the server.
- Avoided this Lát: `Bill.Pool` (no registered keys for trajectory FX), `Bill.Audio` (no clips registered — D.U7), `Bill.Tween` (juice — D.U7).

### 5.2 Unity
- `GameObject.CreatePrimitive(PrimitiveType.Sphere)` for the ball.
- `LineRenderer` (optional trail; same runtime-material pattern as `ArenaAimController.cs:Awake`).
- `Shader.Find("Universal Render Pipeline/Unlit")` → fallback `"Unlit/Color"`.
- `Vector3.Lerp` + `Time.time` for interpolation.

### 5.3 RadiantArena types
- `NetClient.Instance.Send("animation_complete", new AnimationCompleteMsg { round = ArenaContext.CurrentRound })`.
- `ArenaContext.LastTrajectory` / `LastShooterId` (new).
- `TrajectoryPoint` (new plain-C# DTO, snapshot copy of `TrajectoryPointSchema`).

---

## 6. Architecture decisions

### 6.1 `ShotResolvedMessage` → `ShotResolvedEvent` via NetClient (one-way bridge)
NetClient is the **only** type that touches `TrajectoryPointSchema` (which is a live Colyseus `Schema`). The handler snapshots `message.trajectory[]` into a plain `TrajectoryPoint[]` (struct, no allocations on iteration) and fires `ShotResolvedEvent { points, shooter, damage, crit }`. Gameplay code reads the event payload, never the live schema. Matches the existing `PlayerSnapshot` / `WeaponSnapshot` pattern in `ArenaContext.cs`.

**Why a separate event** instead of the gameplay code subscribing directly to `Room.OnMessage`? Because:
- Tests can fire the event without a live Colyseus connection (Sub 5 mock smoke).
- ArenaEvents is the single contract surface between net and gameplay (§1.3 of `ROADMAP.md` precedent).

### 6.2 `AnimatingState` is the only subscriber to `ShotResolvedEvent`
Other states (Countdown / MyTurn / OpponentTurn) never care about an in-flight shot. Coupling stays clean:
- `MyTurnState`'s `ShotReleasedEvent → NetClient.Send("shoot")` already transitions to AnimatingState (D.U4).
- Server's `phase=animating` broadcast → `PhaseChangedEvent` triggers state transition (D.U2 plumbing).
- Server's `shot_resolved` broadcast → `ShotResolvedEvent` is caught **inside** AnimatingState → playback starts.

Race rule: phase transitions and message broadcasts arrive on the Colyseus thread sequentially. AnimatingState always subscribes in `Enter()` **before** any shot_resolved can route through. If a shot_resolved somehow arrives before phase transitions, the event handler short-circuits via `Bill.State.Current != AnimatingState` check (paranoid guard).

### 6.3 `TrajectoryRenderer` is runtime-spawned, self-destructs
Same lifecycle as `ArenaAimController` in D.U4 — `AnimatingState.Enter` creates the GO via `new GameObject("[TrajectoryRenderer]").AddComponent<TrajectoryRenderer>()`. The renderer:
- Builds its visual primitives in `Awake()` (sphere mesh, LineRenderer trail material).
- `Play(...)` stores `points`, `_startTime = Time.time`, sets `_playing = true`.
- `Update()` advances the play head; fires event markers as the head passes each point; on `idx >= points.Count` or trajectory length 0 → calls `_onComplete` + `Destroy(gameObject, 0.15f)` (small grace so settle FX can finish).
- Reference impl uses `StartCoroutine` — we prefer plain `Update()` to honour [§14 "no raw Coroutine"](../../arena-unity/RADIANT_ARENA_UNITY.md#L1084) and keep cancellation trivial (just `_playing = false`).

### 6.4 No `Bill.Pool` registration this Lát
The reference impl registers `TrajectoryBall`, `FX_Impact`, `FX_WallDust`, `DamageNumber` keys. None of those prefabs exist in the project. Registering empty/runtime prefabs into `Bill.Pool` for the sake of API parity adds friction without value.

Instead: D.U5a creates primitives + line-renderer at runtime, destroys at end. Plenty fast for ≤240-point trajectories (server's `MAX_STEPS=240` per `RADIANT_ARENA_COLYSEUS.md` §9), zero GC inside `Update()` because the sphere is a single GO and event FX are spawned in handler branches we keep cheap. D.U7 sweeps in pooled prefabs + Bill.Pool wiring when juice work lands.

### 6.5 Event-grammar handling — string parse, central constants
`TrajectoryPoint.@event` is a string: `""`, `"wall_bounce"`, `"pierce_player"`, `"hit:<dmg>"`, `"crit:<dmg>"`, `"stop"`. We parse:
- Empty → no-op.
- `"wall_bounce"` → `Bill.Events.Fire(new WallBounceEvent { point = worldPos })` + a tiny placeholder primitive (auto-destroyed after 0.2s).
- `"hit:N"` / `"crit:M"` → parse the int after `:`; fire `PlayerHitEvent { damage, isCrit, point, victim = shooter==MyDiscordId ? OpponentDiscordId : MyDiscordId }`. (Shooter never hits self; victim is the other player.)
- `"pierce_player"` → log only this Lát; future Lát (D.U7) adds slow-mo. Don't fire a hit event — server only marks the pass-through, the actual damage is encoded as a separate `hit:N` point at the same coordinates.
- `"stop"` → mark playback complete on the next Update tick (renderer transitions to `_settling = true`, calls `_onComplete`).

Constants live in `TrajectoryConstants.cs` so the parse logic is easy to swap if server adds new event types.

### 6.6 Empty trajectory short-circuit
Server D.4 ships `trajectory: []`. AnimatingState should NOT hang. Decision:
- If `points.Length == 0` (or null): `Bill.Timer.Delay(0.3f, () => { renderer.OnComplete(); })`. 300ms gives the player a moment to register the shot fired even when there's no visual. Then send animation_complete.
- Logged as `[Arena.Trajectory] empty trajectory — server physics not wired (D.U5b); auto-completing in 0.3s.`

### 6.7 Server confirmation tolerance
Server has `ANIMATION_TIMEOUT_MS` fallback — even if our `Send("animation_complete")` is dropped, the turn advances. Client treats the ack send as fire-and-forget. State transition out of AnimatingState is driven by `PhaseChangedEvent { newPhase="active" }`, not by send confirmation.

### 6.8 No HP-bar update in this Lát
`PlayerHitEvent` carries the damage payload; D.U6 HudPanel will subscribe and animate HP bars. ArenaContext's `MyPlayer.Hp` / `OpponentPlayer.Hp` are still hydrated by `NetClient.OnStateChange` because server's authoritative HP change rides along the schema diff — but we don't drive any visuals off them yet.

### 6.9 Sim→world coordinate mapping is a single helper
`TrajectoryConstants.WorldFromSim(float simX, float simY) → Vector3` is the single conversion site. If D.U8/D.U10 changes the map scale, only this helper changes. Matches RADIANT_ARENA_UNITY.md §7 formula exactly.

---

## 7. MCP touchpoints

| Step | Tool |
|---|---|
| Write .cs files | `Write` + `mcp__unityMCP__refresh_unity` |
| Console clean check after each sub | `mcp__unityMCP__read_console types=["error"]` |
| Mock smoke (Sub 5) | `mcp__unityMCP__execute_code` to fabricate a `TrajectoryPoint[]` + fire `ShotResolvedEvent` after entering AnimatingState |
| Verify renderer spawn / destroy | `mcp__unityMCP__find_gameobjects name="[TrajectoryRenderer]"` |

No `manage_asset` / `manage_prefabs` / `manage_material` / `manage_scene` this Lát — pool/FX assets deferred to D.U7+.

---

## 8. Smoke test plan

### 8.1 Per-sub compile gate
After every Write: `refresh_unity` → `read_console types=["error"]` empty.

### 8.2 Mock smoke (Sub 5) — script
1. `manage_editor` enter Play. Wait for `[Bill] Ready.` + ArenaBootstrap log.
2. `execute_code` step A: mock ArenaContext to (MyDiscordId="me", OpponentDiscordId="opp", CurrentRound=1), `Bill.State.GoTo<LobbyState>()`, then fire `PhaseChangedEvent { newPhase="countdown" }` → `Countdown → MyTurn` (turn=me).
3. `execute_code` step B: fire `PhaseChangedEvent { newPhase="animating" }`. Expect: `[Bill.State] MyTurn → Animating`, `[Arena.Animating] Enter — awaiting shot_resolved`.
4. `execute_code` step C: fabricate a 5-point trajectory:
   ```
   { t=0,    x=500, y=500, event="" }
   { t=200,  x=600, y=520, event="wall_bounce" }
   { t=400,  x=700, y=540, event="" }
   { t=600,  x=800, y=560, event="hit:25" }
   { t=800,  x=820, y=565, event="stop" }
   ```
   Fire `ShotResolvedEvent { points = ..., shooter="me", damage=25, crit=false }`.
5. Expected logs (within ~800ms of step 4):
   - `[Arena.Animating] shot_resolved received — playing 5-point trajectory (shooter=me, dmg=25)`
   - `[Arena.Trajectory] spawned renderer`
   - `[Arena.Trajectory] event=wall_bounce at (~1.0, 0, ~0.2)`
   - `[Arena.Trajectory] event=hit:25 dmg=25 isCrit=False at (...)`
   - `[Arena.Trajectory] event=stop — playback complete`
   - `[Arena.Animating] sending animation_complete (round=1)`
   - `[Arena.Net] Send(animation_complete) ignored — not connected.` (expected because no live Colyseus session in mock smoke)
6. `find_gameobjects name="[TrajectoryRenderer]"` immediately after step 4 → count ≥ 1.
7. Wait ~1.5s. `find_gameobjects` again → count = 0 (auto-destroyed after grace).
8. `execute_code` step D: fire `ShotResolvedEvent { points = [], shooter="me", damage=0, crit=false }` (empty case). Expect: `[Arena.Trajectory] empty trajectory — auto-completing in 0.3s.` then `[Arena.Animating] sending animation_complete (round=1)`.
9. Stop Play. `read_console types=["error"]` → no new errors beyond D.U1 baseline (3× PanelSettings + 1× URP missing-types).

### 8.3 Optional live smoke (post-server-D.5)
Bill manually plays 2-instance ParrelSync round: drag → release → server-side physics → `shot_resolved` with real points → trajectory ball animates → animation_complete → next turn. Deferred to D.U5b.

---

## 9. Bill checkpoints

| After Sub | Checkpoint |
|---|---|
| Sub 1 | Confirm verified base assumptions: server D.4 broadcasts empty trajectory, schema field `@event` correct, ArenaContext snapshot pattern stays. |
| Sub 3 | Code review TrajectoryRenderer.cs — the per-frame interp + event dispatch is the core of this Lát. |
| Sub 4 | Spot-check AnimatingState's subscribe/unsubscribe + animation_complete send. Race conditions live here. |
| Sub 5 | Mock smoke logs match §8.2 expected sequence. Decide D.U5a close. |

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| `ArraySchema<T>` doesn't expose IEnumerable — iteration with `.Count` + indexer works (precedent: `PlayerSnapshot(p)` constructor uses this in ArenaContext.cs). | Sub 2 mirrors the pattern. |
| `@event` field access — C# requires backtick for reserved keywords. | `pt.@event` in handler. Already validated in MessageSchemas.cs line 96. |
| Server-side `shot_resolved` arrives before AnimatingState subscribes (race). | NetClient fires the event on the Unity main thread (Colyseus SDK marshals via SyncContext). AnimatingState.Enter runs synchronously before Bill.Events releases the firing thread. If an order inversion ever happens, ArenaContext.LastTrajectory remains populated; AnimatingState.Enter peeks at it as fallback. |
| `Time.time` clock vs server `t` ms — interp drifts if `Time.timeScale != 1`. | Use `Time.time` (scaled) for now; D.U7 hit-stop will pause via `Time.timeScale=0.05f` which pauses the interp too — exactly the feel we want. |
| `Destroy(gameObject, 0.15f)` triggers MonoBehaviour `OnDestroy` after the grace; ensure no Update tick fires after `_playing=false`. | Add an early-return at the top of Update if `!_playing`. |
| Empty trajectory hang. | §6.6 short-circuit. |
| `int.Parse` on malformed event string. | Use `int.TryParse` with default 0; log warning if parse fails. |
| Schema's `event` field is `@event` in C# — reference doc (`RADIANT_ARENA_UNITY.md` §7) uses `event_` and will mislead Sonnet. | PLAN.md §3 + SUBTASKS.md call this out explicitly. |
| `Bill.State.Current` may not be public — guard in §6.2 might not compile. | Verify in Sub 1; if missing, drop the guard (subscribe-only-in-AnimatingState is enough). |

---

## 11. Definition of Done (D.U5a close)

- [ ] Console clean after all writes (no new errors beyond D.U1 baseline).
- [ ] `ShotResolvedMessage` handler wired in NetClient — copies trajectory → ArenaContext + fires `ShotResolvedEvent`.
- [ ] `TrajectoryRenderer` interpolates by `point.t`, dispatches events at each marker, auto-destroys.
- [ ] `AnimatingState` opens Renderer on `ShotResolvedEvent`, sends `animation_complete` on completion, handles empty-trajectory path.
- [ ] Mock smoke (§8.2) passes all expected logs.
- [ ] `PlayerHitEvent` + `WallBounceEvent` fire with correct payloads (validated in mock smoke; D.U6/D.U7 will subscribe).
- [ ] REPORT.md drafted with: shipped files, commits, deviations, D.U5b backlog.
- [ ] Folder moved `todo/D.U5-trajectory → done/D.U5-trajectory` (final commit by Stage 5).

D.U5b (real server `shot_resolved` with populated trajectory + 2-instance ParrelSync end-to-end) deferred until arena-server Lát D.5 ships `src/physics/trajectory.ts` and DuelRoom calls `simulateShot()` instead of broadcasting `trajectory: []`.

---

## 12. References

- [`RADIANT_ARENA_UNITY.md` §7 (TrajectoryPlayer reference impl)](../../RADIANT_ARENA_UNITY.md#L684) — adapted, **not** copied verbatim (uses outdated `event_` + `StartCoroutine`).
- [`RADIANT_ARENA_COLYSEUS.md` §3 + §9](../../RADIANT_ARENA_COLYSEUS.md#L190) — TrajectoryPointSchema, event grammar, `MAX_STEPS=240` physics budget, `BASE_SPEED=500`.
- [`Assets/RadiantArena/Scripts/States/AnimatingState.cs`](../../../Assets/RadiantArena/Scripts/States/AnimatingState.cs) — D.U4 stub, this Lát replaces body.
- [`Assets/RadiantArena/Scripts/Net/NetClient.cs:97`](../../../Assets/RadiantArena/Scripts/Net/NetClient.cs#L97) — current shot_resolved stub handler.
- [`Assets/RadiantArena/Scripts/Net/MessageSchemas.cs:84-97`](../../../Assets/RadiantArena/Scripts/Net/MessageSchemas.cs#L84) — TrajectoryPointSchema definition (note `@event`).
- [`Assets/BillGameCore/Runtime/Bootstrap/Bill.cs:12-22`](../../../Assets/BillGameCore/Runtime/Bootstrap/Bill.cs) — service surface.
- Previous Lát handoff: [`done/D.U4-turn-input/REPORT.md`](../../tasks/done/D.U4-turn-input/REPORT.md).
