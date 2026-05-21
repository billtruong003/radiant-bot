# D.U4 — TurnInputPanel + drag-aim · SUBTASKS

> 9 subs / 7 commits (Sub 1 + Sub 9 verify-only). Sequential auto-run per Bill's precedent.

---

## Sub 1 — Verify baseline (read-only, NO commit)

**Goal**: confirm Input System Mouse.current + URP Unlit shader + LineRenderer runtime material pattern + BasePanel scheduler tick.

**Actions**:
1. `read_console` types=["error"] → empty.
2. Quick `execute_code`: `return UnityEngine.InputSystem.Mouse.current != null` in Edit mode (or check via reflection that the type exists in com.unity.inputsystem).
3. `find_in_file` over Library/PackageCache for `Universal Render Pipeline/Unlit` shader path — confirm `Shader.Find` lookup works.
4. Spot-check BasePanel surface still matches D.U3 expectations.

**Output**:
- ✅ / ❌ Mouse.current accessible (Input System backend on).
- ✅ Shader.Find("Universal Render Pipeline/Unlit") returns non-null.
- ✅ BasePanel + scheduler API unchanged.

**DoD**: report posted, NO commit.

---

## Sub 2 — Extend ArenaContext + ArenaEvents

**Goal**: edit two existing files. Add turn-tracking fields + 4 events.

### 2a. `Assets/RadiantArena/Scripts/Net/ArenaContext.cs`
- Add to `ArenaContext` static class:
  ```csharp
  public static string TurnPlayerId { get; set; } = "";
  public static long TurnDeadlineAt { get; set; } = 0;
  ```
- Extend `HydrateFrom(DuelState state)` after existing copies:
  ```csharp
  TurnPlayerId = state.turn_player_id ?? "";
  TurnDeadlineAt = state.turn_deadline_at; // uint32, implicit widen to long
  ```
- Extend `Reset()`:
  ```csharp
  TurnPlayerId = "";
  TurnDeadlineAt = 0;
  ```

### 2b. `Assets/RadiantArena/Scripts/Events/ArenaEvents.cs`
Add 4 new events (after the existing 5 D.U2 events):
```csharp
public struct TurnStartedEvent : IEvent { public string turnPlayerId; public long deadlineAt; public int round; }
public struct AimUpdatedEvent : IEvent { public float angle; public float power; }
public struct AimClearedEvent : IEvent { }
public struct ShotReleasedEvent : IEvent { public float angle; public float power; }
```

**DoD**: compiles, console clean.

**Commit**: `feat(arena-unity/Lát-D.U4): extend ArenaContext (turn fields) + ArenaEvents (turn/aim/shot events)`

---

## Sub 3 — Write 4 new state skeletons

**Goal**: create 4 `GameState` subclasses with minimal stubs. Transitions wired in Sub 8. No UI opened yet — Sub 4-6 add that.

### 3a. `Assets/RadiantArena/Scripts/States/CountdownState.cs`
```csharp
public class CountdownState : GameState
{
    Action<PhaseChangedEvent>? _onPhase;

    public override void Enter()
    {
        Debug.Log("[Arena.Countdown] Enter — server lock, 3s pre-active.");
        // TODO Sub 4: open CountdownPanel OR reuse a generic message panel
        _onPhase = OnPhaseChanged;
        Bill.Events.Subscribe(_onPhase);
    }

    public override void Exit()
    {
        if (_onPhase != null) Bill.Events.Unsubscribe(_onPhase);
        _onPhase = null;
    }

    void OnPhaseChanged(PhaseChangedEvent e)
    {
        if (e.newPhase != "active") return;
        var amSelf = ArenaContext.TurnPlayerId == ArenaContext.MyDiscordId;
        Debug.Log($"[Arena.Countdown] phase=active, turn={ArenaContext.TurnPlayerId}, mine={amSelf}");
        Bill.State.GoTo(amSelf ? typeof(MyTurnState) : typeof(OpponentTurnState));
    }
}
```

### 3b. `Assets/RadiantArena/Scripts/States/MyTurnState.cs`
Skeleton — full impl in Sub 7.
```csharp
public class MyTurnState : GameState
{
    Action<PhaseChangedEvent>? _onPhase;
    Action<ShotReleasedEvent>? _onShot;
    UI.TurnInputPanel? _panel;
    Weapons.ArenaAimController? _aim;

    public override void Enter()
    {
        Debug.Log("[Arena.MyTurn] Enter");
        // Sub 7 fills: open TurnInputPanel + spawn ArenaAimController + subscribe events
        _onPhase = e => { if (e.newPhase == "animating") Bill.State.GoTo<AnimatingState>(); };
        Bill.Events.Subscribe(_onPhase);
    }
    public override void Exit()
    {
        if (_onPhase != null) Bill.Events.Unsubscribe(_onPhase);
        _onPhase = null;
        // Sub 7 fills: close panel + destroy controller + unsubscribe shot
    }
}
```

### 3c. `Assets/RadiantArena/Scripts/States/OpponentTurnState.cs`
Similar skeleton; spectator panel mode wired in Sub 7.

### 3d. `Assets/RadiantArena/Scripts/States/AnimatingState.cs`
```csharp
public class AnimatingState : GameState
{
    Action<PhaseChangedEvent>? _onPhase;

    public override void Enter()
    {
        Debug.Log("[Arena.Animating] Enter — trajectory playback deferred to D.U5; auto-completing.");
        _onPhase = OnPhaseChanged;
        Bill.Events.Subscribe(_onPhase);
        // D.U5 will: TrajectoryPlayer.Play(...) and on complete: Send("animation_complete", new AnimationCompleteMsg { round })
    }

    public override void Exit()
    {
        if (_onPhase != null) Bill.Events.Unsubscribe(_onPhase);
        _onPhase = null;
    }

    void OnPhaseChanged(PhaseChangedEvent e)
    {
        // server transitions back to "active" with new turn_player_id
        if (e.newPhase != "active") return;
        var amSelf = ArenaContext.TurnPlayerId == ArenaContext.MyDiscordId;
        Bill.State.GoTo(amSelf ? typeof(MyTurnState) : typeof(OpponentTurnState));
    }
}
```

**DoD**: 4 files compile, no panel open yet.

**Commit**: `feat(arena-unity/Lát-D.U4): add CountdownState + MyTurnState + OpponentTurnState + AnimatingState skeletons`

---

## Sub 4 — TurnInputPanel.uxml + turn_input.uss

**Goal**: single UXML with both self-mode and spectator-mode UI elements; USS toggles via root class.

### 4a. `Assets/RadiantArena/UI/Resources/TurnInputPanel.uxml`
```xml
<UXML xmlns:ui="UnityEngine.UIElements">
  <ui:VisualElement name="root" class="turn-root">

    <ui:VisualElement name="header" class="turn-header">
      <ui:Label name="title" text="LƯỢT CỦA TÔI" class="turn-title" />
      <ui:Label name="timer" text="30s" class="turn-timer" />
    </ui:VisualElement>

    <ui:VisualElement name="power-gauge" class="power-gauge">
      <ui:VisualElement name="power-track" class="power-track">
        <ui:VisualElement name="power-fill" class="power-fill" />
      </ui:VisualElement>
      <ui:Label name="power-value" text="0%" class="power-value" />
    </ui:VisualElement>

    <ui:VisualElement name="hint-bar" class="hint-bar">
      <ui:Label name="hint" text="Kéo để nhắm, thả để bắn" class="hint-label" />
    </ui:VisualElement>

  </ui:VisualElement>
</UXML>
```

### 4b. `Assets/RadiantArena/UI/Resources/turn_input.uss`
Style targets:
- `.turn-root`: absolute fill, pickingMode-friendly (UIDocument root passes clicks through to scene via Bill.UI shim), padding 24px.
- `.turn-header`: top row, space-between, font-size 18-22px.
- `.turn-title`: bold, accent color (green for self / orange for spectator via `.spectator` modifier).
- `.turn-timer`: monospace font, font-size 22px. `.timer-urgent` class (added when <5s): red + pulse.
- `.power-gauge`: absolute, right side, vertical track + value label.
- `.power-track`: 24px wide, full height (e.g. 320px), dark bg, rounded.
- `.power-fill`: bottom-up fill, height bound dynamically. Color ramp via inline style (set in TurnInputPanel.cs based on power value).
- `.power-value`: below track, font-size 14px.
- `.hint-bar`: bottom-center, slim band.
- `.hint-label`: font-size 14px, muted gray.
- `.turn-root.spectator .power-gauge`: `display: none` — hide power gauge.
- `.turn-root.spectator .turn-title`: orange color.
- `.turn-root.spectator .hint-label`: "Đối thủ đang đánh..." (text set in code).

**DoD**: both files exist, no UXML/USS parse errors in console.

**Commit**: `feat(arena-unity/Lát-D.U4): add TurnInputPanel.uxml + turn_input.uss`

---

## Sub 5 — TurnInputPanel.cs

**Goal**: BasePanel impl. Single panel, dual-mode via `SetMode(TurnMode)`.

```csharp
#nullable enable
using System;
using BillGameCore;
using RadiantArena.Events;
using RadiantArena.Net;
using UnityEngine;
using UnityEngine.UIElements;

namespace RadiantArena.UI
{
    public enum TurnMode { Self, Spectator }

    public class TurnInputPanel : BasePanel
    {
        VisualElement? _root;
        Label? _title;
        Label? _timer;
        Label? _hint;
        Label? _powerValue;
        VisualElement? _powerFill;

        TurnMode _mode = TurnMode.Self;
        float _currentPower = 0f;
        Action<AimUpdatedEvent>? _onAimUpdated;
        Action<AimClearedEvent>? _onAimCleared;
        IVisualElementScheduledItem? _tick;

        protected override void Build(VisualElement root)
        {
            _root = root;
            var tree = Resources.Load<VisualTreeAsset>("TurnInputPanel");
            if (tree == null) { Debug.LogError("[Arena.TurnInput] UXML missing"); return; }
            tree.CloneTree(root);
            var uss = Resources.Load<StyleSheet>("turn_input");
            if (uss != null) root.styleSheets.Add(uss);

            _title       = root.Q<Label>("title");
            _timer       = root.Q<Label>("timer");
            _hint        = root.Q<Label>("hint");
            _powerValue  = root.Q<Label>("power-value");
            _powerFill   = root.Q<VisualElement>("power-fill");

            // Default visual height = 0; gradient via inline color.
            if (_powerFill != null) _powerFill.style.height = new StyleLength(Length.Percent(0));
        }

        public void SetMode(TurnMode mode)
        {
            _mode = mode;
            if (_root == null) return;
            _root.EnableInClassList("spectator", mode == TurnMode.Spectator);
            if (_title != null)
                _title.text = mode == TurnMode.Self ? "LƯỢT CỦA TÔI" : "LƯỢT ĐỐI THỦ";
            if (_hint != null)
                _hint.text = mode == TurnMode.Self ? "Kéo để nhắm, thả để bắn" : "Đối thủ đang đánh…";
        }

        public override void OnOpened()
        {
            if (_mode == TurnMode.Self)
            {
                _onAimUpdated = OnAimUpdated;
                _onAimCleared = OnAimCleared;
                Bill.Events.Subscribe(_onAimUpdated);
                Bill.Events.Subscribe(_onAimCleared);
            }
            _tick = _root?.schedule.Execute(RefreshTimer).Every(250);
            RefreshTimer();
        }

        public override void OnClosed()
        {
            if (_onAimUpdated != null) Bill.Events.Unsubscribe(_onAimUpdated);
            if (_onAimCleared != null) Bill.Events.Unsubscribe(_onAimCleared);
            _onAimUpdated = null;
            _onAimCleared = null;
            _tick?.Pause();
            _tick = null;
        }

        void OnAimUpdated(AimUpdatedEvent e)
        {
            _currentPower = e.power;
            UpdatePowerVisual();
        }

        void OnAimCleared(AimClearedEvent _)
        {
            _currentPower = 0f;
            UpdatePowerVisual();
        }

        void UpdatePowerVisual()
        {
            if (_powerFill != null)
                _powerFill.style.height = new StyleLength(Length.Percent(_currentPower * 100f));
            if (_powerValue != null)
                _powerValue.text = $"{(int)(_currentPower * 100f)}%";
            // Color ramp: green (low) → yellow (mid) → red (high)
            if (_powerFill != null)
            {
                var c = _currentPower < 0.5f
                    ? Color.Lerp(new Color(0.3f, 0.85f, 0.4f), new Color(1f, 0.85f, 0.2f), _currentPower * 2f)
                    : Color.Lerp(new Color(1f, 0.85f, 0.2f), new Color(1f, 0.35f, 0.25f), (_currentPower - 0.5f) * 2f);
                _powerFill.style.backgroundColor = c;
            }
        }

        void RefreshTimer()
        {
            if (_timer == null) return;
            var deadline = ArenaContext.TurnDeadlineAt;
            if (deadline <= 0) { _timer.text = "—"; _timer.EnableInClassList("timer-urgent", false); return; }
            var nowMs = (long)(System.DateTime.UtcNow.Subtract(new System.DateTime(1970, 1, 1)).TotalMilliseconds);
            var remainMs = System.Math.Max(0, deadline - nowMs);
            var seconds = remainMs / 1000;
            _timer.text = $"{seconds}s";
            _timer.EnableInClassList("timer-urgent", seconds <= 5 && seconds > 0);
        }
    }
}
```

**DoD**: compile clean.

**Commit**: `feat(arena-unity/Lát-D.U4): add TurnInputPanel BasePanel with dual-mode (Self/Spectator) + power gauge + timer`

---

## Sub 6 — ArenaAimController.cs

**Goal**: MonoBehaviour with LineRenderer. Reads Mouse.current, computes drag vector, fires AimUpdated / AimCleared / ShotReleased events.

```csharp
#nullable enable
using BillGameCore;
using RadiantArena.Events;
using UnityEngine;
using UnityEngine.InputSystem;

namespace RadiantArena.Weapons
{
    public class ArenaAimController : MonoBehaviour
    {
        const float MaxDragWorld = 3.0f;
        const float DeadZone = 0.10f;

        LineRenderer? _line;
        Camera? _cam;
        Vector3 _dragStart;
        bool _dragging;
        Transform? _origin; // optional weapon prefab transform (D.U8); fallback Vector3.zero

        void Awake()
        {
            _cam = Camera.main;
            _line = gameObject.AddComponent<LineRenderer>();
            _line.positionCount = 0;
            _line.startWidth = 0.05f;
            _line.endWidth = 0.05f;
            _line.useWorldSpace = true;
            _line.numCornerVertices = 2;

            var shader = Shader.Find("Universal Render Pipeline/Unlit");
            if (shader == null) shader = Shader.Find("Unlit/Color");
            var mat = new Material(shader);
            mat.color = new Color(0.4f, 0.9f, 0.5f, 0.9f);
            _line.material = mat;

            Debug.Log("[Arena.Aim] ArenaAimController ready");
        }

        public void SetOrigin(Transform? originTransform)
        {
            _origin = originTransform;
        }

        void Update()
        {
            if (_cam == null) return;
            var mouse = Mouse.current;
            if (mouse == null) return;

            if (mouse.leftButton.wasPressedThisFrame)
            {
                _dragStart = ScreenToWorld(mouse.position.ReadValue());
                _dragging = true;
            }

            if (_dragging && mouse.leftButton.isPressed)
            {
                var current = ScreenToWorld(mouse.position.ReadValue());
                var drag = current - _dragStart;
                var power = Mathf.Clamp01(drag.magnitude / MaxDragWorld);
                var aimDir = drag.sqrMagnitude > 0.001f ? -drag.normalized : Vector3.forward;
                var angle = Mathf.Atan2(aimDir.z, aimDir.x);

                Bill.Events.Fire(new AimUpdatedEvent { angle = angle, power = power });
                DrawLine(power, aimDir);
            }

            if (_dragging && mouse.leftButton.wasReleasedThisFrame)
            {
                var current = ScreenToWorld(mouse.position.ReadValue());
                var drag = current - _dragStart;
                var power = Mathf.Clamp01(drag.magnitude / MaxDragWorld);
                _dragging = false;
                ClearLine();
                Bill.Events.Fire(new AimClearedEvent());

                if (power < DeadZone)
                {
                    Debug.Log($"[Arena.Aim] release in dead zone (power={power:F2}), canceled.");
                    return;
                }

                var aimDir = -drag.normalized;
                var angle = Mathf.Atan2(aimDir.z, aimDir.x);
                Debug.Log($"[Arena.Aim] fired angle={angle:F2} power={power:F2}");
                Bill.Events.Fire(new ShotReleasedEvent { angle = angle, power = power });
            }
        }

        Vector3 ScreenToWorld(Vector2 screen)
        {
            if (_cam == null) return Vector3.zero;
            var ray = _cam.ScreenPointToRay(screen);
            var plane = new Plane(Vector3.up, _origin != null ? _origin.position.y : 0f);
            if (plane.Raycast(ray, out float enter)) return ray.GetPoint(enter);
            return Vector3.zero;
        }

        void DrawLine(float power, Vector3 aimDir)
        {
            if (_line == null) return;
            var origin = _origin != null ? _origin.position : Vector3.zero;
            var end = origin + aimDir * (power * MaxDragWorld);
            _line.positionCount = 2;
            _line.SetPosition(0, origin);
            _line.SetPosition(1, end);
        }

        void ClearLine()
        {
            if (_line != null) _line.positionCount = 0;
        }
    }
}
```

**DoD**: compile clean. (Will spawn at runtime in Sub 7.)

**Commit**: `feat(arena-unity/Lát-D.U4): add ArenaAimController with LineRenderer + Mouse drag-aim + slingshot direction`

---

## Sub 7 — Activate MyTurnState + OpponentTurnState (full impl)

**Goal**: replace skeletons with full enter/exit logic.

### 7a. `MyTurnState.cs`
```csharp
public override void Enter()
{
    Debug.Log("[Arena.MyTurn] Enter — opening panel + spawning aim controller");
    _panel = Bill.UI.Open<TurnInputPanel>(p => p.SetMode(TurnMode.Self));

    var go = new GameObject("[ArenaAimController]");
    _aim = go.AddComponent<ArenaAimController>();

    _onPhase = e => { if (e.newPhase == "animating") Bill.State.GoTo<AnimatingState>(); };
    _onShot = OnShotReleased;
    Bill.Events.Subscribe(_onPhase);
    Bill.Events.Subscribe(_onShot);
}

public override void Exit()
{
    if (_onPhase != null) Bill.Events.Unsubscribe(_onPhase);
    if (_onShot != null) Bill.Events.Unsubscribe(_onShot);
    _onPhase = null;
    _onShot = null;
    if (_aim != null) UnityEngine.Object.Destroy(_aim.gameObject);
    _aim = null;
    Bill.UI.Close<TurnInputPanel>();
    _panel = null;
}

void OnShotReleased(ShotReleasedEvent e)
{
    Debug.Log($"[Arena.MyTurn] shot fired angle={e.angle:F2} power={e.power:F2}");
    NetClient.Instance?.Send("shoot", new ShootMsg { angle = e.angle, power = e.power });
    Bill.State.GoTo<AnimatingState>();
}
```

### 7b. `OpponentTurnState.cs`
```csharp
public override void Enter()
{
    Debug.Log("[Arena.OpponentTurn] Enter — spectator panel");
    Bill.UI.Open<TurnInputPanel>(p => p.SetMode(TurnMode.Spectator));
    _onPhase = e => { if (e.newPhase == "animating") Bill.State.GoTo<AnimatingState>(); };
    Bill.Events.Subscribe(_onPhase);
}

public override void Exit()
{
    if (_onPhase != null) Bill.Events.Unsubscribe(_onPhase);
    _onPhase = null;
    Bill.UI.Close<TurnInputPanel>();
}
```

**DoD**: compile clean. Console clean.

**Commit**: `feat(arena-unity/Lát-D.U4): activate MyTurnState + OpponentTurnState — open panel, spawn controller, route ShotReleased to NetClient.Send`

---

## Sub 8 — Wire transitions + register states

### 8a. `Assets/RadiantArena/Scripts/States/LobbyState.cs`
Replace the stub log in `OnPhaseChanged` for `newPhase=="countdown"`:
```csharp
if (e.newPhase == "countdown") Bill.State.GoTo<CountdownState>();
```

### 8b. `Assets/RadiantArena/Scripts/States/ArenaStates.cs`
Append:
```csharp
Bill.State.AddState(new CountdownState());
Bill.State.AddState(new MyTurnState());
Bill.State.AddState(new OpponentTurnState());
Bill.State.AddState(new AnimatingState());
```

**DoD**: compile clean.

**Commit**: `feat(arena-unity/Lát-D.U4): wire LobbyState→CountdownState transition + register 4 new states`

---

## Sub 9 — Mock smoke (NO commit)

**Goal**: prove transitions, panel open/close, controller spawn/destroy. Skip live drag input.

**Actions**:
1. `manage_editor` play. Wait Bill.IsReady.
2. `execute_code` step A: mock ArenaContext (6 weapons, MyDiscordId="me", OpponentDiscordId="opp"), `Bill.State.GoTo<LobbyState>()`. Verify Lobby active.
3. `execute_code` step B: set `ArenaContext.CurrentPhase = "countdown"; ArenaContext.TurnPlayerId = "me"; ArenaContext.TurnDeadlineAt = Now + 30000ms;`. Fire `PhaseChangedEvent { oldPhase="lobby", newPhase="countdown" }`. Expect log:
   - `[Bill.State] Lobby -> Countdown`
   - `[Arena.Countdown] Enter ...`
4. `execute_code` step C: set `CurrentPhase = "active"; TurnPlayerId = "me"`. Fire `PhaseChangedEvent { oldPhase="countdown", newPhase="active" }`. Expect:
   - `[Arena.Countdown] phase=active, turn=me, mine=True`
   - `[Bill.State] Countdown -> MyTurn`
   - `[Arena.MyTurn] Enter — opening panel + spawning aim controller`
   - `[Arena.Aim] ArenaAimController ready`
5. Verify GameObject `[ArenaAimController]` exists in scene via `find_gameobjects`.
6. `execute_code` step D: fire `PhaseChangedEvent { newPhase="animating" }`. Expect:
   - `[Bill.State] MyTurn -> Animating`
   - GameObject `[ArenaAimController]` destroyed (find returns 0).
7. `execute_code` step E: set `TurnPlayerId="opp"`, fire `PhaseChangedEvent { newPhase="active" }`. Expect Animating→OpponentTurn + panel in spectator mode.
8. Stop play. No NEW errors beyond baseline.

**DoD**:
- All expected logs present in step 3-7.
- Panel opens twice (Self then Spectator), each closes on Exit.
- ArenaAimController spawns/destroys on MyTurnState boundaries.

**NO commit**. REPORT.md after.

---

## DoD overall (D.U4a close)

- [x] (Sub 1) Verify Mouse.current, URP Unlit shader, BasePanel.
- [x] (Sub 2) ArenaContext + ArenaEvents extensions.
- [x] (Sub 3) 4 state skeletons.
- [x] (Sub 4) UXML + USS.
- [x] (Sub 5) TurnInputPanel.cs.
- [x] (Sub 6) ArenaAimController.cs.
- [x] (Sub 7) MyTurn/OpponentTurn full impl.
- [x] (Sub 8) Transitions wired + states registered.
- [x] (Sub 9) Mock smoke: 4 transitions verified, panel + controller lifecycle clean.

D.U4b (live server turn loop + real drag smoke) deferred to post-server-D.4.
