# D.U5 — TrajectoryRenderer playback · SONNET_PROMPTS

> Mode: Sonnet 1 sub / invocation (HARD RULE per `[[sonnet_one_sub_invocation]]`).
> Bill pastes one prompt → Sonnet executes → STOP → Bill pastes next.
> Each prompt is self-contained (re-pasteable if a single sub needs re-run).

---

## Sub 1 — Verify baseline (read-only, NO commit)

```
Persona: arena-unity/SKILL.md. Lát D.U5 Stage 2 Sub 1.

## Read
- arena-unity/tasks/todo/D.U5-trajectory/PLAN.md §3, §6
- arena-unity/tasks/todo/D.U5-trajectory/SUBTASKS.md Sub 1

## Do
1. mcp__unityMCP__read_console types=["error"] → record baseline (expect: D.U1 3× PanelSettings + 1× URP missing-types only).
2. Glob radiant-bot/arena-server/src/physics/**/*.ts → expect 0 results (confirms server D.5 physics not shipped).
3. Grep "@event" Assets/RadiantArena/Scripts/Net/MessageSchemas.cs → confirms field name is `@event`.
4. Grep "Current" Assets/BillGameCore/Runtime/Services/State/GameStateMachine.cs (or similar) — record whether `Current`/`ActiveState` property exists. Affects PLAN §6.2 paranoid guard only; if missing, PLAN drops the guard (subscribe-only inside AnimatingState is enough).
5. Grep "Pool.Register" Assets/RadiantArena/ → expect 0 matches (confirms no trajectory pool keys registered yet).

## Output (post to Bill, no file edit)
- ✅/❌ server D.5 physics still missing
- ✅/❌ schema field is `@event`
- API name for active state (or "not exposed")
- ✅/❌ no Bill.Pool registration in RadiantArena

## STOP — NO commit, NO code edits. Wait for Bill green light before Sub 2.
```

---

## Sub 2 — ArenaEvents + ArenaContext + TrajectoryPoint DTO

```
Persona: arena-unity/SKILL.md. Lát D.U5 Sub 2.

## Read
- arena-unity/tasks/todo/D.U5-trajectory/SUBTASKS.md Sub 2 (event signatures + DTO + ctx fields verbatim)
- Assets/RadiantArena/Scripts/Events/ArenaEvents.cs (existing — D.U2+D.U4 events present)
- Assets/RadiantArena/Scripts/Net/ArenaContext.cs (existing — D.U4 turn fields present)

## Do
- Edit ArenaEvents.cs: APPEND 4 new event structs (ShotResolvedEvent, PlayerHitEvent, WallBounceEvent, TrajectoryFinishedEvent) after the existing D.U4 events. Keep `using UnityEngine;` if not already present (PlayerHitEvent + WallBounceEvent carry `Vector3`).
- Edit ArenaContext.cs:
  - Append a new public struct `TrajectoryPoint { ushort t; float x; float y; string evt; }` at the namespace level (after WeaponSnapshot or at end of file).
  - Append 4 new static props on ArenaContext: `LastTrajectory`, `LastShooterId`, `LastShotDamage`, `LastShotCrit` (defaults per SUBTASKS Sub 2b).
  - Extend Reset() to wipe the 4 new fields (BUT NOT MyDiscordId — preserved per existing comment).
  - Do NOT touch HydrateFrom() — LastTrajectory is set by the message handler in Sub 4, not by state diffs.
- mcp__unityMCP__refresh_unity → mcp__unityMCP__read_console types=["error"] → zero new errors.

## Commit
feat(arena-unity/Lát-D.U5): add TrajectoryPoint DTO + ShotResolved/PlayerHit/WallBounce/TrajectoryFinished events + LastTrajectory ctx

## STOP — wait for Bill before Sub 3.
```

---

## Sub 3 — TrajectoryConstants + TrajectoryRenderer

```
Persona: arena-unity/SKILL.md. Lát D.U5 Sub 3.

## Read
- arena-unity/tasks/todo/D.U5-trajectory/SUBTASKS.md Sub 3 (full code for both files)
- arena-unity/tasks/todo/D.U5-trajectory/PLAN.md §6.3, §6.4, §6.5, §6.9 (lifecycle, no-pool decision, event grammar, sim→world)
- Assets/RadiantArena/Scripts/Weapons/ArenaAimController.cs (precedent for runtime LineRenderer + URP Unlit material pattern)

## Do
- Create Assets/RadiantArena/Scripts/Trajectory/TrajectoryConstants.cs verbatim per SUBTASKS Sub 3a.
- Create Assets/RadiantArena/Scripts/Trajectory/TrajectoryRenderer.cs verbatim per SUBTASKS Sub 3b.
  - Namespace `RadiantArena.Trajectory`.
  - `Spawn()` static factory + AddComponent pattern.
  - Update loop drives interp between `_points[idx-1]` and `_points[idx]` until `Time.time*1000 >= pt.t`, then snaps + fires HandleEvent.
  - HandleEvent parses: wall_bounce → fire WallBounceEvent; hit:N / crit:N → parse int + fire PlayerHitEvent (victim = the non-shooter of {MyDiscordId, OpponentDiscordId}); pierce_player → log only; stop → FinishAndDestroy.
  - FinishAndDestroy fires TrajectoryFinishedEvent, invokes _onComplete, Destroys gameObject with 0.15s grace.
  - Empty trajectory → schedule Bill.Timer.Delay(0.3f, FinishAndDestroy).
- Reference impl in arena-unity/RADIANT_ARENA_UNITY.md §7 uses `event_` (OUTDATED) and `StartCoroutine` (also OUTDATED — we use Update). Stick to SUBTASKS code, not the reference doc verbatim.
- mcp__unityMCP__refresh_unity → mcp__unityMCP__read_console types=["error"] → zero new errors.

## Commit
feat(arena-unity/Lát-D.U5): add TrajectoryRenderer + TrajectoryConstants — runtime sphere+trail, event-grammar parse, lifecycle

## STOP — wait for Bill before Sub 4.
```

---

## Sub 4 — NetClient.OnShotResolved + AnimatingState upgrade

```
Persona: arena-unity/SKILL.md. Lát D.U5 Sub 4.

## Read
- arena-unity/tasks/todo/D.U5-trajectory/SUBTASKS.md Sub 4 (full code for NetClient handler + AnimatingState body)
- arena-unity/tasks/todo/D.U5-trajectory/PLAN.md §6.1, §6.2, §6.6, §6.7 (one-way bridge, single subscriber, empty trajectory, ack tolerance)
- Assets/RadiantArena/Scripts/Net/NetClient.cs (existing — note the stub at line 97-98)
- Assets/RadiantArena/Scripts/States/AnimatingState.cs (existing D.U4 stub body)

## Do
- Edit NetClient.cs:
  - Replace the lambda `Room.OnMessage<ShotResolvedMessage>("shot_resolved", _ => Debug.Log("..."))` with a method reference `Room.OnMessage<ShotResolvedMessage>("shot_resolved", OnShotResolved)`.
  - Add private method `OnShotResolved(ShotResolvedMessage m)` after `OnLeave`. Snapshot `m.trajectory[]` into `TrajectoryPoint[]`, populate ArenaContext.LastTrajectory/LastShooterId/LastShotDamage/LastShotCrit, fire `ShotResolvedEvent`. Use `pt.@event` (escaped reserved keyword). Cast `damage_dealt` (float) via `Mathf.RoundToInt`.
- Replace Assets/RadiantArena/Scripts/States/AnimatingState.cs entirely with the SUBTASKS Sub 4b body. Note:
  - Subscribes BOTH PhaseChangedEvent and ShotResolvedEvent in Enter.
  - On ShotResolvedEvent: spawn TrajectoryRenderer, Play, register OnPlaybackComplete callback.
  - On OnPlaybackComplete: fire-and-forget Send("animation_complete", AnimationCompleteMsg { round = CurrentRound }). Use `_sentAck` guard for idempotency.
  - On Exit: kill any live renderer GO (defensive, e.g. server-forced phase change mid-playback).
  - Race fallback: on Enter, check ArenaContext.LastTrajectory.Length > 0 OR LastShooterId non-empty → replay cached payload via PlayCached(). This is the "message arrived before state Enter" defense.
- mcp__unityMCP__refresh_unity → mcp__unityMCP__read_console types=["error"] → zero new errors.

## Commit
feat(arena-unity/Lát-D.U5): wire NetClient.OnShotResolved + upgrade AnimatingState to drive TrajectoryRenderer + send animation_complete

## STOP — wait for Bill before Sub 5.
```

---

## Sub 5 — Mock smoke (NO commit)

```
Persona: arena-unity/SKILL.md. Lát D.U5 Sub 5.

## Pre
- Bootstrap.unity loaded. No arena-server connection.
- D.U4 mock-smoke pattern (single execute_code bundle, reflection for boxed-struct field setting) is the proven approach — bundle all phase transitions + ShotResolvedEvent fires in fewer larger execute_code calls to avoid domain reload drops.

## Do
1. mcp__unityMCP__read_console types=["error"] → record baseline.
2. mcp__unityMCP__manage_editor → enter Play. Wait Bill.IsReady.
3. **Step A + B (single execute_code bundle)** — drive into AnimatingState then fire a 5-point ShotResolvedEvent:
   ```
   ArenaContext.MyDiscordId = "me";
   ArenaContext.OpponentDiscordId = "opp";
   ArenaContext.CurrentRound = 1;
   ArenaContext.CurrentPhase = "active";
   ArenaContext.TurnPlayerId = "me";
   Bill.State.GoTo<LobbyState>();
   Bill.Events.Fire(new PhaseChangedEvent { oldPhase = "lobby",     newPhase = "countdown" });
   Bill.Events.Fire(new PhaseChangedEvent { oldPhase = "countdown", newPhase = "active" });
   Bill.Events.Fire(new PhaseChangedEvent { oldPhase = "active",    newPhase = "animating" });

   var pts = new TrajectoryPoint[] {
     new() { t=0,   x=500, y=500, evt="" },
     new() { t=200, x=600, y=520, evt="wall_bounce" },
     new() { t=400, x=700, y=540, evt="" },
     new() { t=600, x=800, y=560, evt="hit:25" },
     new() { t=800, x=820, y=565, evt="stop" },
   };
   Bill.Events.Fire(new ShotResolvedEvent { points = pts, shooterId = "me", damage = 25, crit = false });
   ```
   Use reflection if needed (boxed-struct field SetValue trick from D.U4 REPORT §4-5 still applies).
4. **Verify**:
   - `[Arena.Animating] shot_resolved received — playing 5-point trajectory (shooter=me, dmg=25)`
   - `[Arena.Trajectory] spawned renderer — 5 points, shooter=me, dmg=25, crit=False`
   - `mcp__unityMCP__find_gameobjects name="[TrajectoryRenderer]"` → count = 1 immediately after Step B.
   - Wait ~1.0s (or use Bill.Timer.Delay-then-poll; or just sleep in execute_code reflection wait).
   - Logs (in order, timed): `event=wall_bounce`, `event=hit:25 dmg=25 isCrit=False victim=opp`, `event=stop — playback complete`.
   - `[Arena.Animating] sending animation_complete (round=1)` followed by `[Arena.Net] Send(animation_complete) ignored — not connected.`
   - `mcp__unityMCP__find_gameobjects name="[TrajectoryRenderer]"` after ~1.5s → count = 0.
5. **Step C — empty trajectory edge case**:
   - Re-fire `PhaseChangedEvent { oldPhase="animating", newPhase="active" }` then back to `"animating"` to re-enter AnimatingState (or call Bill.State.GoTo<AnimatingState>() if exposed).
   - Reset `ArenaContext.LastTrajectory = System.Array.Empty<TrajectoryPoint>(); ArenaContext.LastShooterId = "";` first so the race-fallback PlayCached doesn't trigger.
   - Fire `ShotResolvedEvent { points = Array.Empty<TrajectoryPoint>(), shooterId = "me", damage = 0, crit = false }`.
   - Verify: `empty trajectory — server physics not wired (D.U5b); auto-completing in 0.3s.` → after ~0.3s `sending animation_complete (round=1)`.
6. **Step D — duplicate-fire guard**:
   - In a fresh AnimatingState, fire ShotResolvedEvent twice back-to-back (same payload). Expect second to log `shot_resolved arrived while renderer already running — ignoring duplicate`.
7. mcp__unityMCP__manage_editor → exit Play.
8. mcp__unityMCP__read_console types=["error"] → no NEW errors beyond baseline.

## Output (post to Bill)
- Full log capture for steps 3-6.
- Pass/fail per expected log line.
- find_gameobjects count history (1 → 0).

## STOP — NO commit. Stage 4 (Opus) writes REPORT.md and moves the folder.

## Fallback
- MCP unavailable → pause + tell Bill which MCP tool errored and what filesystem-only alternative would look like.
- If execute_code can't access RadiantArena.Events types via reflection cleanly, fall back to bundled execute_code per the D.U4 REPORT pattern (`Type.GetType("RadiantArena.Events.ShotResolvedEvent")` + reflection field set on boxed struct, then GetMethod("Fire") iteration to pick the 1-param generic-definition overload).
```

---

## Bill checkpoints

| After | Action |
|---|---|
| Sub 1 | Confirm assumptions hold; green-light or amend PLAN. |
| Sub 3 | (Optional) Review TrajectoryRenderer.cs at commit — the core of this Lát. |
| Sub 4 | Confirm AnimatingState race-fallback + duplicate-guard logic reads correctly. |
| Sub 5 | Mock smoke logs match expected; decide D.U5a close → Opus runs Stage 4 (REPORT) + Stage 5 (move folder to done/). |

## Notes
- Pre-commit hook fail → NEW commit, no `--amend` (per global rule).
- MCP unavailable mid-sub → pause + report; do NOT silently fall back to filesystem-only.
- D.U5b (real server `shot_resolved` from `simulateShot()`) deferred — open the next Lát only after server-side Lát D.5 ships.
