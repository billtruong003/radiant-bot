# D.U5 — TrajectoryRenderer playback · SUBTASKS

> 5 subs / 4 commits (Sub 1 + Sub 5 = verify-only, no commit).
> HARD RULE — Sonnet 1 sub per invocation. Bill pastes next prompt from `SONNET_PROMPTS.md` after each STOP.

---

## Sub 1 — Verify baseline (read-only, NO commit)

**Goal**: confirm the assumptions in PLAN.md §3 before touching code. The 4 critical ones:

1. Server `DuelRoom.handleShoot` still broadcasts empty trajectory (`radiant-bot/arena-server/src/rooms/DuelRoom.ts:551` neighbourhood). If `src/physics/trajectory.ts` exists now, we're actually in D.U5b territory — flag to Bill.
2. `MessageSchemas.cs:96` field name = `@event` (not `event_`). Reference doc `RADIANT_ARENA_UNITY.md` §7 uses `event_` — that's the OUTDATED form.
3. `Bill.State.Current` API surface (any property exposed?) so PLAN.md §6.2 guard is feasible. If `GameStateMachine` doesn't expose `Current`, drop the guard.
4. `Bill.Pool` has no `"TrajectoryBall"` / `"FX_Impact"` / `"FX_WallDust"` keys registered anywhere (search RadiantArena/Bootstrap). Confirms §6.4 — no pool work this Lát.

**Actions**:
1. `mcp__unityMCP__read_console types=["error"]` → empty.
2. `Glob radiant-bot/arena-server/src/physics/**/*.ts` → confirm 0 results.
3. `Grep "@event" Assets/RadiantArena/Scripts/Net/MessageSchemas.cs` → returns the line.
4. `Grep "public.*Current" Assets/BillGameCore/Runtime/Services/State/` to check `GameStateMachine.Current` exists.
5. `Grep "Pool.Register" Assets/RadiantArena/` → expect 0 matches.

**Output report**:
- ✅/❌ server D.5 physics still NOT shipped (expected: ✅).
- ✅/❌ schema field is `@event` (expected: ✅).
- ✅/❌ `Bill.State.Current` exposes the active state (record actual API — `.Current`? `.ActiveState`? something else?). If none, document.
- ✅/❌ no Bill.Pool registration in RadiantArena yet (expected: ✅).

**DoD**: brief findings report posted to Bill. NO commit.

---

## Sub 2 — Extend ArenaContext + ArenaEvents + plain-C# TrajectoryPoint DTO

**Goal**: add the gameplay-facing event types + snapshot fields. Sets up the contract so Sub 3 can be written purely in gameplay-side terms (no Colyseus refs).

### 2a. `Assets/RadiantArena/Scripts/Events/ArenaEvents.cs` — append after existing events

```csharp
/// <summary>
/// Fired by NetClient when "shot_resolved" arrives. Plain-C# snapshot of the
/// server payload — gameplay never reads the live Colyseus schema.
/// </summary>
public struct ShotResolvedEvent : IEvent
{
    public TrajectoryPoint[] points;
    public string shooterId;
    public int damage;
    public bool crit;
}

/// <summary>
/// Fired by TrajectoryRenderer when a trajectory point with event="hit:N" or
/// event="crit:N" is reached. D.U6 HudPanel subscribes to animate HP; D.U7
/// adds camera shake / hit-stop / damage numbers.
/// </summary>
public struct PlayerHitEvent : IEvent
{
    public int damage;
    public bool isCrit;
    public string victimId;
    public UnityEngine.Vector3 point;
}

/// <summary>
/// Fired by TrajectoryRenderer when a trajectory point with event="wall_bounce"
/// is reached. D.U7 wires camera shake + wall-dust FX.
/// </summary>
public struct WallBounceEvent : IEvent
{
    public UnityEngine.Vector3 point;
}

/// <summary>
/// Fired by TrajectoryRenderer when playback completes (stop event reached or
/// end of points array). AnimatingState subscribes to send animation_complete.
/// </summary>
public struct TrajectoryFinishedEvent : IEvent
{
    public string shooterId;
    public int totalDamage;
}
```

### 2b. `Assets/RadiantArena/Scripts/Net/ArenaContext.cs` — append after existing fields

Add a plain-C# `TrajectoryPoint` DTO (matches `TrajectoryPointSchema` shape but no Colyseus dependency):

```csharp
/// <summary>
/// Plain-C# copy of TrajectoryPointSchema. Used by ShotResolvedEvent +
/// TrajectoryRenderer so gameplay code never holds a reference to the
/// live Colyseus schema (which the server may mutate between frames).
/// </summary>
public struct TrajectoryPoint
{
    /// <summary>ms since shoot (server-side clock).</summary>
    public ushort t;
    public float x;
    public float y;
    /// <summary>'' | 'wall_bounce' | 'pierce_player' | 'hit:&lt;dmg&gt;' | 'crit:&lt;dmg&gt;' | 'stop'</summary>
    public string evt;  // NOTE: not `event` because reserved; matched-cased mapping in NetClient handler.
}
```

Extend `ArenaContext` (after `TurnDeadlineAt`):

```csharp
public static TrajectoryPoint[] LastTrajectory { get; set; } = System.Array.Empty<TrajectoryPoint>();
public static string LastShooterId { get; set; } = "";
public static int LastShotDamage { get; set; } = 0;
public static bool LastShotCrit { get; set; } = false;
```

Extend `Reset()`:

```csharp
LastTrajectory = System.Array.Empty<TrajectoryPoint>();
LastShooterId = "";
LastShotDamage = 0;
LastShotCrit = false;
```

`HydrateFrom(DuelState state)` does **not** copy `state.last_trajectory` — the broadcast message is the authoritative trigger (LastTrajectory is set by the message handler in Sub 3, not by state diffs).

**DoD**: both files compile, console clean. Verify via `refresh_unity` + `read_console types=["error"]`.

**Commit**: `feat(arena-unity/Lát-D.U5): add TrajectoryPoint DTO + ShotResolved/PlayerHit/WallBounce/TrajectoryFinished events + LastTrajectory ctx`

---

## Sub 3 — TrajectoryConstants.cs + TrajectoryRenderer.cs

**Goal**: the core of this Lát. Two files in `Assets/RadiantArena/Scripts/Trajectory/`.

### 3a. `Assets/RadiantArena/Scripts/Trajectory/TrajectoryConstants.cs`

```csharp
#nullable enable
using UnityEngine;

namespace RadiantArena.Trajectory
{
    /// <summary>
    /// Central constants for trajectory playback. Adjust here, not in TrajectoryRenderer.
    /// </summary>
    public static class TrajectoryConstants
    {
        // Sim is 0..1000 in both axes; mapped to 10×10 world units centered at origin.
        public const float SimToWorldScale = 0.01f;
        public const float SimCenter = 500f;

        // Visual: placeholder sphere ball.
        public const float BallRadius = 0.18f;
        public static readonly Color BallColor = new Color(0.55f, 0.95f, 1.0f, 1.0f);
        public static readonly Color BallEmission = new Color(0.3f, 0.7f, 0.8f, 1.0f);

        // Trail line (placeholder).
        public const float TrailWidth = 0.08f;
        public const float TrailFadeTime = 0.35f;

        // Lifecycle.
        /// <summary>Empty-trajectory short-circuit delay (sec) — gives the player a beat before ack.</summary>
        public const float EmptyTrajectoryDelay = 0.30f;
        /// <summary>Grace period before destroying the renderer GO after onComplete.</summary>
        public const float DestroyGrace = 0.15f;

        // Event-grammar string prefixes (server's TrajectoryPointSchema.event).
        public const string EvtEmpty       = "";
        public const string EvtWallBounce  = "wall_bounce";
        public const string EvtPiercePlayer = "pierce_player";
        public const string EvtStop        = "stop";
        public const string EvtHitPrefix   = "hit:";
        public const string EvtCritPrefix  = "crit:";

        /// <summary>Server sim coord → Unity world coord. Y-up, sim-Y maps to world-Z.</summary>
        public static Vector3 WorldFromSim(float simX, float simY)
        {
            return new Vector3(
                (simX - SimCenter) * SimToWorldScale,
                0f,
                (simY - SimCenter) * SimToWorldScale);
        }
    }
}
```

### 3b. `Assets/RadiantArena/Scripts/Trajectory/TrajectoryRenderer.cs`

```csharp
#nullable enable
using System;
using BillGameCore;
using RadiantArena.Events;
using RadiantArena.Net;
using UnityEngine;

namespace RadiantArena.Trajectory
{
    /// <summary>
    /// Runtime-spawned playback of a server-resolved shot. Lifecycle is single-shot:
    /// Spawn → Play(points) → Update interp → events fire at markers → onComplete → self-destruct.
    ///
    /// D.U5 ships placeholder visuals (sphere + LineRenderer trail). D.U7+ swaps to
    /// real FX prefabs via Bill.Pool. D.U8 tints by weapon hue.
    /// </summary>
    public class TrajectoryRenderer : MonoBehaviour
    {
        TrajectoryPoint[] _points = Array.Empty<TrajectoryPoint>();
        string _shooterId = "";
        int _damage;
        bool _crit;
        Action? _onComplete;

        float _startTime;
        int _idx;       // index of the NEXT point to reach (event has not yet fired)
        bool _playing;
        bool _settling; // playback done; awaiting destroy grace
        int _totalDmgFired;

        GameObject? _ball;
        LineRenderer? _trail;

        /// <summary>Factory + entry-point in one. Caller does not need to AddComponent themselves.</summary>
        public static TrajectoryRenderer Spawn()
        {
            var go = new GameObject("[TrajectoryRenderer]");
            return go.AddComponent<TrajectoryRenderer>();
        }

        void Awake()
        {
            BuildBall();
            BuildTrail();
        }

        public void Play(TrajectoryPoint[] points, string shooterId, int damage, bool crit, Action? onComplete)
        {
            _points = points ?? Array.Empty<TrajectoryPoint>();
            _shooterId = shooterId ?? "";
            _damage = damage;
            _crit = crit;
            _onComplete = onComplete;
            _idx = 0;
            _totalDmgFired = 0;

            if (_points.Length == 0)
            {
                Debug.Log("[Arena.Trajectory] empty trajectory — server physics not wired (D.U5b); auto-completing in 0.3s.");
                _playing = false;
                Bill.Timer.Delay(TrajectoryConstants.EmptyTrajectoryDelay, FinishAndDestroy);
                return;
            }

            Debug.Log($"[Arena.Trajectory] spawned renderer — {_points.Length} points, shooter={_shooterId}, dmg={_damage}, crit={_crit}");
            var first = _points[0];
            transform.position = TrajectoryConstants.WorldFromSim(first.x, first.y);
            if (_ball != null) _ball.transform.position = transform.position;
            _startTime = Time.time;
            _playing = true;
        }

        void Update()
        {
            if (!_playing || _settling) return;
            if (_points.Length == 0) return;

            float elapsedMs = (Time.time - _startTime) * 1000f;

            // Advance event index for every point whose t has been passed.
            while (_idx < _points.Length)
            {
                var pt = _points[_idx];
                if (elapsedMs < pt.t)
                {
                    // Interp ball position between previous point and this one.
                    var prev = _idx == 0 ? pt : _points[_idx - 1];
                    float span = Mathf.Max(1f, pt.t - prev.t);
                    float lerpT = Mathf.Clamp01((elapsedMs - prev.t) / span);
                    var prevWorld = TrajectoryConstants.WorldFromSim(prev.x, prev.y);
                    var currWorld = TrajectoryConstants.WorldFromSim(pt.x, pt.y);
                    var pos = Vector3.Lerp(prevWorld, currWorld, lerpT);
                    if (_ball != null) _ball.transform.position = pos;
                    return;
                }

                // Reached this point — snap + fire its event.
                var worldPos = TrajectoryConstants.WorldFromSim(pt.x, pt.y);
                if (_ball != null) _ball.transform.position = worldPos;
                HandleEvent(pt, worldPos);
                _idx++;

                if (_settling) return; // HandleEvent flipped settling (stop event)
            }

            // Past last point with no stop event — wrap up.
            FinishAndDestroy();
        }

        void HandleEvent(TrajectoryPoint pt, Vector3 worldPos)
        {
            var evt = pt.evt ?? string.Empty;
            if (evt == TrajectoryConstants.EvtEmpty) return;

            if (evt == TrajectoryConstants.EvtWallBounce)
            {
                Debug.Log($"[Arena.Trajectory] event=wall_bounce at ({worldPos.x:F2}, 0, {worldPos.z:F2})");
                Bill.Events.Fire(new WallBounceEvent { point = worldPos });
                return;
            }

            if (evt.StartsWith(TrajectoryConstants.EvtHitPrefix) ||
                evt.StartsWith(TrajectoryConstants.EvtCritPrefix))
            {
                bool isCrit = evt.StartsWith(TrajectoryConstants.EvtCritPrefix);
                int colon = evt.IndexOf(':');
                int dmg = 0;
                if (colon >= 0 && colon < evt.Length - 1)
                {
                    if (!int.TryParse(evt.Substring(colon + 1), out dmg))
                    {
                        Debug.LogWarning($"[Arena.Trajectory] could not parse dmg from '{evt}'");
                        dmg = 0;
                    }
                }
                _totalDmgFired += dmg;
                string victimId = _shooterId == ArenaContext.MyDiscordId
                    ? ArenaContext.OpponentDiscordId
                    : ArenaContext.MyDiscordId;
                Debug.Log($"[Arena.Trajectory] event={evt} dmg={dmg} isCrit={isCrit} victim={victimId} at ({worldPos.x:F2}, 0, {worldPos.z:F2})");
                Bill.Events.Fire(new PlayerHitEvent
                {
                    damage = dmg, isCrit = isCrit, victimId = victimId, point = worldPos
                });
                return;
            }

            if (evt == TrajectoryConstants.EvtPiercePlayer)
            {
                Debug.Log($"[Arena.Trajectory] event=pierce_player at ({worldPos.x:F2}, 0, {worldPos.z:F2}) — slow-mo deferred to D.U7");
                return;
            }

            if (evt == TrajectoryConstants.EvtStop)
            {
                Debug.Log("[Arena.Trajectory] event=stop — playback complete");
                FinishAndDestroy();
                return;
            }

            Debug.LogWarning($"[Arena.Trajectory] unknown event '{evt}' — ignored");
        }

        void FinishAndDestroy()
        {
            if (_settling) return;
            _settling = true;
            _playing = false;
            Bill.Events.Fire(new TrajectoryFinishedEvent { shooterId = _shooterId, totalDamage = _totalDmgFired });
            try { _onComplete?.Invoke(); } catch (Exception e) { Debug.LogException(e); }
            Destroy(gameObject, TrajectoryConstants.DestroyGrace);
        }

        void BuildBall()
        {
            _ball = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            _ball.name = "ball";
            _ball.transform.SetParent(transform, worldPositionStays: false);
            _ball.transform.localScale = Vector3.one * (TrajectoryConstants.BallRadius * 2f);
            // Drop the collider — purely visual, server is authoritative.
            var col = _ball.GetComponent<Collider>();
            if (col != null) Destroy(col);

            var shader = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Color");
            if (shader != null)
            {
                var mat = new Material(shader);
                mat.color = TrajectoryConstants.BallColor;
                var r = _ball.GetComponent<MeshRenderer>();
                if (r != null) r.sharedMaterial = mat;
            }
        }

        void BuildTrail()
        {
            _trail = gameObject.AddComponent<LineRenderer>();
            _trail.positionCount = 0;
            _trail.startWidth = TrajectoryConstants.TrailWidth;
            _trail.endWidth = TrajectoryConstants.TrailWidth * 0.3f;
            _trail.useWorldSpace = true;

            var shader = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Color");
            if (shader != null)
            {
                var mat = new Material(shader);
                mat.color = TrajectoryConstants.BallColor;
                _trail.material = mat;
            }
        }

        void LateUpdate()
        {
            // Lazy trail update — append current ball position to LineRenderer.
            // D.U7 will replace with proper TrailRenderer + fade-out.
            if (!_playing || _ball == null || _trail == null) return;
            int n = _trail.positionCount;
            _trail.positionCount = n + 1;
            _trail.SetPosition(n, _ball.transform.position);
        }
    }
}
```

**DoD**: both files compile, console clean.

**Commit**: `feat(arena-unity/Lát-D.U5): add TrajectoryRenderer + TrajectoryConstants — runtime sphere+trail, event-grammar parse, lifecycle`

---

## Sub 4 — Wire NetClient.shot_resolved handler + upgrade AnimatingState

**Goal**: connect the existing stub `OnMessage<ShotResolvedMessage>` handler to fire `ShotResolvedEvent`; replace `AnimatingState`'s idle body with real playback.

### 4a. `Assets/RadiantArena/Scripts/Net/NetClient.cs`

Replace [line 97-98](../../../Assets/RadiantArena/Scripts/Net/NetClient.cs#L97):

```csharp
Room.OnMessage<ShotResolvedMessage>("shot_resolved",
    _ => Debug.Log("[Arena.Net] shot_resolved (no handler — D.U5)"));
```

with:

```csharp
Room.OnMessage<ShotResolvedMessage>("shot_resolved", OnShotResolved);
```

Add a new method on `NetClient` (place after `OnLeave`):

```csharp
void OnShotResolved(ShotResolvedMessage m)
{
    // Snapshot the live Colyseus schema array into a plain-C# DTO so
    // gameplay code never holds onto a reference the server mutates.
    var raw = m.trajectory;
    TrajectoryPoint[] points;
    if (raw == null || raw.Length == 0)
    {
        points = System.Array.Empty<TrajectoryPoint>();
    }
    else
    {
        points = new TrajectoryPoint[raw.Length];
        for (int i = 0; i < raw.Length; i++)
        {
            var p = raw[i];
            if (p == null) continue;
            points[i] = new TrajectoryPoint
            {
                t = p.t,
                x = p.x,
                y = p.y,
                evt = p.@event ?? string.Empty,
            };
        }
    }

    ArenaContext.LastTrajectory = points;
    ArenaContext.LastShooterId = m.shooter ?? "";
    ArenaContext.LastShotDamage = Mathf.RoundToInt(m.damage_dealt);
    ArenaContext.LastShotCrit = m.crit;

    Debug.Log($"[Arena.Net] shot_resolved — points={points.Length} shooter={m.shooter} dmg={m.damage_dealt} crit={m.crit}");

    Bill.Events.Fire(new ShotResolvedEvent
    {
        points = points,
        shooterId = m.shooter ?? "",
        damage = Mathf.RoundToInt(m.damage_dealt),
        crit = m.crit,
    });
}
```

Imports already cover `RadiantArena.Events` + `RadiantArena.Net`; no new `using` needed.

### 4b. `Assets/RadiantArena/Scripts/States/AnimatingState.cs`

Replace body with the upgraded version:

```csharp
#nullable enable
using System;
using BillGameCore;
using RadiantArena.Events;
using RadiantArena.Net;
using RadiantArena.Trajectory;
using UnityEngine;

namespace RadiantArena.States
{
    /// <summary>
    /// Trajectory playback phase. Subscribes to ShotResolvedEvent (fired by
    /// NetClient when "shot_resolved" arrives), spawns TrajectoryRenderer, and
    /// on completion sends "animation_complete" so the server can advance the
    /// turn. PhaseChangedEvent fallback handles the empty/missing-shot case.
    /// </summary>
    public class AnimatingState : GameState
    {
        Action<PhaseChangedEvent>? _onPhase;
        Action<ShotResolvedEvent>? _onShot;
        TrajectoryRenderer? _renderer;
        bool _sentAck;

        public override void Enter()
        {
            Debug.Log("[Arena.Animating] Enter — awaiting shot_resolved");
            _sentAck = false;
            _renderer = null;
            _onPhase = OnPhaseChanged;
            _onShot = OnShotResolved;
            Bill.Events.Subscribe(_onPhase);
            Bill.Events.Subscribe(_onShot);

            // If shot_resolved arrived before the state transition (race), the
            // last payload is sitting in ArenaContext. Re-play it from cache.
            if (ArenaContext.LastTrajectory.Length > 0 || !string.IsNullOrEmpty(ArenaContext.LastShooterId))
            {
                Debug.Log("[Arena.Animating] replaying cached LastTrajectory (arrived before Enter)");
                PlayCached();
            }
        }

        public override void Exit()
        {
            if (_onPhase != null) Bill.Events.Unsubscribe(_onPhase);
            if (_onShot != null) Bill.Events.Unsubscribe(_onShot);
            _onPhase = null;
            _onShot = null;

            // Renderer self-destructs after grace; if we're leaving early (e.g.
            // server-forced phase change), kill the renderer GO too.
            if (_renderer != null)
            {
                UnityEngine.Object.Destroy(_renderer.gameObject);
                _renderer = null;
            }
        }

        void OnShotResolved(ShotResolvedEvent e)
        {
            Debug.Log($"[Arena.Animating] shot_resolved received — playing {e.points.Length}-point trajectory (shooter={e.shooterId}, dmg={e.damage})");
            if (_renderer != null)
            {
                Debug.LogWarning("[Arena.Animating] shot_resolved arrived while renderer already running — ignoring duplicate");
                return;
            }
            _renderer = TrajectoryRenderer.Spawn();
            _renderer.Play(e.points, e.shooterId, e.damage, e.crit, OnPlaybackComplete);
        }

        void PlayCached()
        {
            _renderer = TrajectoryRenderer.Spawn();
            _renderer.Play(
                ArenaContext.LastTrajectory,
                ArenaContext.LastShooterId,
                ArenaContext.LastShotDamage,
                ArenaContext.LastShotCrit,
                OnPlaybackComplete);
        }

        void OnPlaybackComplete()
        {
            if (_sentAck) return;
            _sentAck = true;
            Debug.Log($"[Arena.Animating] sending animation_complete (round={ArenaContext.CurrentRound})");
            NetClient.Instance?.Send("animation_complete",
                new AnimationCompleteMsg { round = ArenaContext.CurrentRound });
            // Server now switches phase=active; PhaseChangedEvent triggers Exit().
        }

        void OnPhaseChanged(PhaseChangedEvent e)
        {
            if (e.newPhase == "active")
            {
                var amSelf = !string.IsNullOrEmpty(ArenaContext.TurnPlayerId)
                             && ArenaContext.TurnPlayerId == ArenaContext.MyDiscordId;
                Debug.Log($"[Arena.Animating] phase=active, turn={ArenaContext.TurnPlayerId}, mine={amSelf}");
                if (amSelf) Bill.State.GoTo<MyTurnState>();
                else Bill.State.GoTo<OpponentTurnState>();
            }
            else if (e.newPhase == "ended")
            {
                Debug.Log("[Arena.Animating] phase=ended (EndState deferred to D.U6)");
            }
        }
    }
}
```

**DoD**: both files compile, console clean.

**Commit**: `feat(arena-unity/Lát-D.U5): wire NetClient.OnShotResolved + upgrade AnimatingState to drive TrajectoryRenderer + send animation_complete`

---

## Sub 5 — Mock smoke (NO commit)

**Goal**: prove the full client pipeline without a live arena-server. Inject a synthetic trajectory, watch the renderer fire events, watch AnimatingState send the ack.

**Actions**:

1. `mcp__unityMCP__read_console types=["error"]` clear baseline.
2. `mcp__unityMCP__manage_editor` enter Play. Wait `[Bill] Ready.`.
3. **Step A** — `execute_code`: drive state into AnimatingState via reflection mocking (same pattern as D.U4 Sub 9). Pseudocode:
   ```
   ArenaContext.MyDiscordId = "me";
   ArenaContext.OpponentDiscordId = "opp";
   ArenaContext.CurrentRound = 1;
   ArenaContext.CurrentPhase = "active";
   ArenaContext.TurnPlayerId = "me";
   Bill.State.GoTo<LobbyState>();
   Bill.Events.Fire(new PhaseChangedEvent { oldPhase = "lobby", newPhase = "countdown" });
   Bill.Events.Fire(new PhaseChangedEvent { oldPhase = "countdown", newPhase = "active" });
   Bill.Events.Fire(new PhaseChangedEvent { oldPhase = "active", newPhase = "animating" });
   ```
   Expect logs through `[Arena.Animating] Enter — awaiting shot_resolved`.
4. **Step B** — `execute_code`: fabricate a 5-point trajectory + fire ShotResolvedEvent:
   ```
   var pts = new TrajectoryPoint[] {
     new() { t=0,   x=500, y=500, evt="" },
     new() { t=200, x=600, y=520, evt="wall_bounce" },
     new() { t=400, x=700, y=540, evt="" },
     new() { t=600, x=800, y=560, evt="hit:25" },
     new() { t=800, x=820, y=565, evt="stop" },
   };
   Bill.Events.Fire(new ShotResolvedEvent { points = pts, shooterId = "me", damage = 25, crit = false });
   ```
5. **Verify (timed)**:
   - Within ~0ms of step 4: `[Arena.Animating] shot_resolved received — playing 5-point …`, `[Arena.Trajectory] spawned renderer — 5 points, …`.
   - `find_gameobjects name="[TrajectoryRenderer]"` immediately → count = 1.
   - Within ~200ms: `[Arena.Trajectory] event=wall_bounce at …`.
   - Within ~600ms: `[Arena.Trajectory] event=hit:25 dmg=25 isCrit=False victim=opp at …`.
   - Within ~800ms: `[Arena.Trajectory] event=stop — playback complete`.
   - Right after: `[Arena.Animating] sending animation_complete (round=1)`.
   - Followed by: `[Arena.Net] Send(animation_complete) ignored — not connected.` (expected, no Colyseus session).
   - After ~1.0s (800ms playback + 0.15s grace): `find_gameobjects name="[TrajectoryRenderer]"` → count = 0.
6. **Step C — empty trajectory edge case** — `execute_code`: enter Animating again (via PhaseChangedEvent active→animating after firing active first), then fire `ShotResolvedEvent { points = Array.Empty<TrajectoryPoint>(), shooterId = "me", damage = 0, crit = false }`. Expect:
   - `[Arena.Animating] shot_resolved received — playing 0-point …`
   - `[Arena.Trajectory] spawned renderer — 0 points, …`
   - `[Arena.Trajectory] empty trajectory — server physics not wired (D.U5b); auto-completing in 0.3s.`
   - After ~0.3s: `[Arena.Animating] sending animation_complete (round=1)`.
7. **Step D — duplicate-fire guard** — fire `ShotResolvedEvent` again while a renderer is alive (re-trigger Sub 5 step B before completion if reachable; otherwise simulate by firing twice back-to-back). Expect: second fire logs `[Arena.Animating] shot_resolved arrived while renderer already running — ignoring duplicate`.
8. Stop Play. `read_console types=["error"]` → no new errors beyond D.U1 baseline (3× PanelSettings + 1× URP missing-types).

**Output**: log capture for steps 3-7 + pass/fail per expected line.

**DoD**: all expected logs present, renderer GO spawn/destroy lifecycle clean, ack send attempted in both real and empty cases, duplicate guard works.

**NO commit**. REPORT.md follows (separate Stage 4 Opus step).

---

## DoD overall (D.U5a close)

- [ ] (Sub 1) Baseline verified — server still empty trajectory, schema field `@event`, no pool keys.
- [ ] (Sub 2) ArenaEvents + ArenaContext + TrajectoryPoint DTO landed.
- [ ] (Sub 3) TrajectoryConstants + TrajectoryRenderer landed.
- [ ] (Sub 4) NetClient.OnShotResolved + AnimatingState upgrade landed.
- [ ] (Sub 5) Mock smoke logs match §8.2 expected sequence; renderer lifecycle clean.

D.U5b (real server `shot_resolved` from `simulateShot()` + 2-instance ParrelSync end-to-end) deferred until arena-server Lát D.5 ships physics.
