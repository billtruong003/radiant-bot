# D.U6 — HudPanel + ResultPanel · SUBTASKS

> 8 subs / 7 commits (Sub 1 + Sub 8 = verify-only).
> Mode: Opus sequential auto-run (D.U4/D.U5 precedent).

---

## Sub 1 — Verify baseline (read-only, NO commit)

**Goal**: confirm 4 PLAN.md §3 assumptions before touching code.

**Actions**:
1. `mcp__unityMCP__read_console types=["error"]` → baseline (expect D.U5 baseline: URP missing types + BillInspector dup + 3× PanelSettings, no errors).
2. `Grep "Bill\\.Tween|BillTween\\." Assets/RadiantArena` → confirm no existing usage (we're the first consumer).
3. `Grep "match_ended" Assets/RadiantArena/Scripts/Net/NetClient.cs` → confirm line 102-103 still stub.
4. `Grep "IsOpen" Assets/BillGameCore/Runtime/Services/UI/` → record `IUIService.Open<T>()` semantics if already-open (for §6.3 guard decision).
5. Smoke-test `BillTween.Float` is callable from execute_code (compiler=codedom): one-line tween a throwaway float and observe the setter invokes.

**Output report** (to Bill, no file edit):
- ✅/❌ console clean
- ✅/❌ no existing BillTween consumer
- ✅/❌ NetClient.cs:102 still stub
- API note: `Bill.UI.Open<T>` when already open does what?
- ✅/❌ BillTween.Float invokes setter

**DoD**: report posted. NO commit.

---

## Sub 2 — Extend ArenaEvents + ArenaContext last-match cache

**Goal**: gameplay-facing events + race-fallback ctx.

### 2a. `Assets/RadiantArena/Scripts/Events/ArenaEvents.cs` — APPEND after `TrajectoryFinishedEvent`

```csharp
/// <summary>
/// Fired by NetClient when a player's hp changes in the state diff. Snapshots
/// the (player, old, new, max) into a plain-C# payload so HudPanel never reads
/// the live Colyseus schema. D.U6 HudPanel subscribes; D.U7 juice can subscribe
/// to drive flash / shake.
/// </summary>
public struct HpChangedEvent : IEvent
{
    public string playerId;
    public int oldHp;
    public int newHp;
    public int hpMax;
}

/// <summary>
/// Fired by NetClient on "match_ended" inbound. Plain-C# snapshot of the
/// server payload. EndState opens ResultPanel from this; ArenaContext.LastMatch*
/// caches as race-fallback if event arrives before EndState.Enter.
/// </summary>
public struct MatchEndedEvent : IEvent
{
    public string winnerId;
    /// <summary>'' | 'win' | 'timeout_join' | 'double_afk' | 'disconnect' | 'concede'</summary>
    public string outcome;
    public System.Collections.Generic.Dictionary<string, int> finalHp;
}
```

### 2b. `Assets/RadiantArena/Scripts/Net/ArenaContext.cs` — APPEND after the LastTrajectory block, BEFORE `MyPlayer`

```csharp
public static string LastMatchWinnerId { get; set; } = "";
public static string LastMatchOutcome { get; set; } = "";
public static System.Collections.Generic.Dictionary<string, int> LastMatchFinalHp { get; set; }
    = new System.Collections.Generic.Dictionary<string, int>();
```

Extend `Reset()` (mirror the LastTrajectory wipes):

```csharp
LastMatchWinnerId = "";
LastMatchOutcome  = "";
LastMatchFinalHp  = new System.Collections.Generic.Dictionary<string, int>();
```

**DoD**: compile clean, console no new errors.

**Commit**: `feat(arena-unity/Lát-D.U6): add HpChangedEvent + MatchEndedEvent + LastMatch ctx`

---

## Sub 3 — NetClient: HP diff tracking + OnMatchEnded handler

**Goal**: wire the events into the net layer.

### 3a. `Assets/RadiantArena/Scripts/Net/NetClient.cs` — add private field next to `_lastPhase` (line 35)

```csharp
readonly System.Collections.Generic.Dictionary<string, int> _lastHp = new System.Collections.Generic.Dictionary<string, int>();
```

### 3b. Extend `OnStateChange` (after the existing phase-diff block, before `if (isFirstState) ...`)

```csharp
// HP diff — fire HpChangedEvent per player whose hp changed since last tick.
foreach (var keyObj in state.players.Keys)
{
    if (!(keyObj is string pid)) continue;
    var p = state.players[pid];
    if (p == null) continue;
    int now = p.hp;
    int max = p.hp_max;
    if (_lastHp.TryGetValue(pid, out int prev))
    {
        if (prev != now)
        {
            Bill.Events.Fire(new HpChangedEvent
            {
                playerId = pid, oldHp = prev, newHp = now, hpMax = max,
            });
        }
    }
    _lastHp[pid] = now;
}
```

### 3c. Extend `Disconnect()` + `OnLeave` to clear `_lastHp`

In both `Disconnect()` and `OnLeave(int code)`, after `_lastPhase = ""`, add:

```csharp
_lastHp.Clear();
```

### 3d. Replace the match_ended stub at line 102-103

```csharp
Room.OnMessage<MatchEndedMessage>("match_ended",
    _ => Debug.Log("[Arena.Net] match_ended (no handler — D.U6)"));
```

→

```csharp
Room.OnMessage<MatchEndedMessage>("match_ended", OnMatchEnded);
```

### 3e. Add `OnMatchEnded` method after `OnShotResolved`

```csharp
void OnMatchEnded(MatchEndedMessage m)
{
    // Snapshot final_hp into a fresh dict — never hold a reference Colyseus
    // might mutate (defensive even though match_ended is terminal).
    var finalHp = new System.Collections.Generic.Dictionary<string, int>();
    if (m.final_hp != null)
    {
        foreach (var kv in m.final_hp) finalHp[kv.Key] = kv.Value;
    }

    ArenaContext.LastMatchWinnerId  = m.winner ?? "";
    ArenaContext.LastMatchOutcome   = m.outcome ?? "";
    ArenaContext.LastMatchFinalHp   = finalHp;

    Debug.Log($"[Arena.Net] match_ended — winner={m.winner} outcome={m.outcome} hpEntries={finalHp.Count}");

    Bill.Events.Fire(new MatchEndedEvent
    {
        winnerId = m.winner ?? "",
        outcome  = m.outcome ?? "",
        finalHp  = finalHp,
    });
}
```

**DoD**: compile clean, console clean.

**Commit**: `feat(arena-unity/Lát-D.U6): NetClient HP diff loop + OnMatchEnded handler`

---

## Sub 4 — HudPanel UXML + USS + .cs

**Goal**: create the canonical in-game HUD.

### 4a. `Assets/RadiantArena/UI/Resources/HudPanel.uxml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<ui:UXML xmlns:ui="UnityEngine.UIElements" editor-extension-mode="False">
  <ui:VisualElement name="root" class="hud-root">

    <ui:VisualElement name="hud-header" class="hud-header">
      <ui:Label name="hud-round" text="Hiệp 1" class="hud-round" />
      <ui:Label name="hud-timer" text="—" class="hud-timer" />
      <ui:Label name="hud-turn"  text=""    class="hud-turn-indicator" />
    </ui:VisualElement>

    <ui:VisualElement name="hud-slots" class="hud-slots">

      <ui:VisualElement name="me-slot" class="hud-slot me">
        <ui:VisualElement name="me-info" class="hud-info">
          <ui:Label name="me-name"   text="Me"   class="hud-name" />
          <ui:Label name="me-weapon" text="—"    class="hud-weapon" />
        </ui:VisualElement>
        <ui:VisualElement name="me-bar-track" class="hud-bar-track">
          <ui:VisualElement name="me-bar-fill" class="hud-bar-fill" />
        </ui:VisualElement>
        <ui:Label name="me-hp" text="100 / 100" class="hud-hp" />
      </ui:VisualElement>

      <ui:VisualElement name="opp-slot" class="hud-slot opp">
        <ui:VisualElement name="opp-info" class="hud-info">
          <ui:Label name="opp-name"   text="—"  class="hud-name" />
          <ui:Label name="opp-weapon" text="—"  class="hud-weapon" />
        </ui:VisualElement>
        <ui:VisualElement name="opp-bar-track" class="hud-bar-track">
          <ui:VisualElement name="opp-bar-fill" class="hud-bar-fill" />
        </ui:VisualElement>
        <ui:Label name="opp-hp" text="100 / 100" class="hud-hp" />
      </ui:VisualElement>

    </ui:VisualElement>

  </ui:VisualElement>
</ui:UXML>
```

### 4b. `Assets/RadiantArena/UI/Resources/hud.uss`

Palette borrows from `lobby.uss`. Targets:

```css
.hud-root {
    position: absolute;
    left: 0; right: 0; top: 0;
    flex-direction: column;
    padding-left: 24px;
    padding-right: 24px;
    padding-top: 16px;
}

.hud-header {
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}

.hud-round {
    font-size: 14px;
    color: rgba(180, 200, 230, 0.7);
}

.hud-timer {
    font-size: 28px;
    -unity-font-style: bold;
    color: rgb(232, 240, 255);
    -unity-text-align: middle-center;
    letter-spacing: 2;
}

.hud-timer.timer-urgent {
    color: rgb(240, 90, 90);
}

.hud-turn-indicator {
    font-size: 12px;
    color: rgba(180, 200, 230, 0.7);
    -unity-text-align: middle-right;
}

.hud-slots {
    flex-direction: row;
}

.hud-slot {
    flex-grow: 1;
    flex-direction: column;
    padding-left: 12px;
    padding-right: 12px;
    padding-top: 8px;
    padding-bottom: 8px;
    margin-left: 6px;
    margin-right: 6px;
    background-color: rgba(16, 22, 32, 0.78);
    border-top-left-radius: 6px;
    border-top-right-radius: 6px;
    border-bottom-left-radius: 6px;
    border-bottom-right-radius: 6px;
}

.hud-slot.me  { border-left-width: 3px; border-left-color:  rgb(74, 220, 140); }
.hud-slot.opp { border-right-width: 3px; border-right-color: rgb(240, 160, 80); }

.hud-info {
    flex-direction: row;
    justify-content: space-between;
    margin-bottom: 4px;
}

.hud-name {
    font-size: 14px;
    -unity-font-style: bold;
    color: rgb(220, 230, 245);
}

.hud-weapon {
    font-size: 12px;
    color: rgba(180, 200, 230, 0.7);
}

.hud-bar-track {
    height: 14px;
    background-color: rgba(40, 48, 60, 0.95);
    border-top-left-radius: 4px;
    border-top-right-radius: 4px;
    border-bottom-left-radius: 4px;
    border-bottom-right-radius: 4px;
    margin-top: 2px;
    margin-bottom: 2px;
}

.hud-bar-fill {
    height: 14px;
    width: 100%;
    background-color: rgb(74, 220, 140);
    border-top-left-radius: 4px;
    border-bottom-left-radius: 4px;
}

.hud-hp {
    font-size: 12px;
    color: rgba(180, 200, 230, 0.85);
    -unity-text-align: middle-right;
}
```

### 4c. `Assets/RadiantArena/UI/HudPanel.cs`

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
    public class HudPanel : BasePanel
    {
        VisualElement? _root;
        Label? _round;
        Label? _timer;
        Label? _turnIndicator;

        Label? _meName;
        Label? _meWeapon;
        Label? _meHp;
        VisualElement? _meFill;

        Label? _oppName;
        Label? _oppWeapon;
        Label? _oppHp;
        VisualElement? _oppFill;

        Action<HpChangedEvent>? _onHp;
        IVisualElementScheduledItem? _tick;

        protected override void Build(VisualElement root)
        {
            _root = root;

            var tree = Resources.Load<VisualTreeAsset>("HudPanel");
            if (tree == null)
            {
                Debug.LogError("[Arena.HUD] HudPanel.uxml not found in Resources/");
                return;
            }
            tree.CloneTree(root);

            var uss = Resources.Load<StyleSheet>("hud");
            if (uss != null) root.styleSheets.Add(uss);

            _round         = root.Q<Label>("hud-round");
            _timer         = root.Q<Label>("hud-timer");
            _turnIndicator = root.Q<Label>("hud-turn");

            _meName   = root.Q<Label>("me-name");
            _meWeapon = root.Q<Label>("me-weapon");
            _meHp     = root.Q<Label>("me-hp");
            _meFill   = root.Q<VisualElement>("me-bar-fill");

            _oppName   = root.Q<Label>("opp-name");
            _oppWeapon = root.Q<Label>("opp-weapon");
            _oppHp     = root.Q<Label>("opp-hp");
            _oppFill   = root.Q<VisualElement>("opp-bar-fill");
        }

        public override void OnOpened()
        {
            _onHp = OnHpChanged;
            Bill.Events.Subscribe(_onHp);
            _tick = _root?.schedule.Execute(RefreshHeader).Every(250);
            SnapAllBars();
            RefreshHeader();
            Debug.Log($"[Arena.HUD] opened, snapping bars me={MyHp()}/{MyMax()} opp={OppHp()}/{OppMax()}");
        }

        public override void OnClosed()
        {
            if (_onHp != null) Bill.Events.Unsubscribe(_onHp);
            _onHp = null;
            _tick?.Pause();
            _tick = null;
            BillTween.KillTarget(_meFill!);
            BillTween.KillTarget(_oppFill!);
        }

        void OnHpChanged(HpChangedEvent e)
        {
            // Determine which slot this targets.
            bool isMine = e.playerId == ArenaContext.MyDiscordId;
            var fill = isMine ? _meFill : _oppFill;
            var hpLabel = isMine ? _meHp : _oppHp;
            if (fill == null) return;

            int max = e.hpMax > 0 ? e.hpMax : 100;

            Debug.Log($"[Arena.HUD] HP {(isMine ? "me" : "opp")} {e.oldHp}→{e.newHp}/{max}");

            BillTween.KillTarget(fill);
            BillTween.Float((float)e.oldHp, (float)e.newHp, 0.40f, v =>
            {
                if (fill == null) return;
                float pct = Mathf.Clamp01(v / max) * 100f;
                fill.style.width = new StyleLength(Length.Percent(pct));
                fill.style.backgroundColor = HpColor(pct);
                if (hpLabel != null) hpLabel.text = $"{Mathf.RoundToInt(v)} / {max}";
            })?.SetTarget(fill);
        }

        void SnapAllBars()
        {
            SnapBar(_meFill, _meHp,  MyHp(),  MyMax());
            SnapBar(_oppFill, _oppHp, OppHp(), OppMax());
            if (_meName   != null) _meName.text   = !string.IsNullOrEmpty(ArenaContext.MyDiscordId)       ? ArenaContext.MyDiscordId       : "Me";
            if (_oppName  != null) _oppName.text  = !string.IsNullOrEmpty(ArenaContext.OpponentDiscordId) ? ArenaContext.OpponentDiscordId : "—";
            if (_meWeapon  != null) _meWeapon.text  = ArenaContext.MyPlayer?.LockedWeapon?.DisplayName
                                                  ?? ArenaContext.MyPlayer?.SelectedWeaponSlug ?? "—";
            if (_oppWeapon != null) _oppWeapon.text = ArenaContext.OpponentPlayer?.LockedWeapon?.DisplayName
                                                  ?? ArenaContext.OpponentPlayer?.SelectedWeaponSlug ?? "—";
        }

        void SnapBar(VisualElement? fill, Label? hpLabel, int hp, int max)
        {
            if (fill == null) return;
            if (max <= 0) max = 100;
            float pct = Mathf.Clamp01((float)hp / max) * 100f;
            fill.style.width = new StyleLength(Length.Percent(pct));
            fill.style.backgroundColor = HpColor(pct);
            if (hpLabel != null) hpLabel.text = $"{hp} / {max}";
        }

        void RefreshHeader()
        {
            if (_round != null) _round.text = ArenaContext.CurrentRound > 0
                ? $"Hiệp {ArenaContext.CurrentRound}"
                : "—";

            if (_timer != null)
            {
                var deadline = ArenaContext.TurnDeadlineAt;
                if (deadline <= 0)
                {
                    _timer.text = "—";
                    _timer.EnableInClassList("timer-urgent", false);
                }
                else
                {
                    var nowMs = (long)(System.DateTime.UtcNow
                        - new System.DateTime(1970, 1, 1, 0, 0, 0, System.DateTimeKind.Utc)).TotalMilliseconds;
                    var remainMs = System.Math.Max(0L, deadline - nowMs);
                    var seconds  = (int)(remainMs / 1000);
                    _timer.text = $"{seconds}s";
                    _timer.EnableInClassList("timer-urgent", seconds <= 5 && seconds > 0);
                }
            }

            if (_turnIndicator != null)
            {
                var tp = ArenaContext.TurnPlayerId;
                if (string.IsNullOrEmpty(tp)) _turnIndicator.text = "";
                else if (tp == ArenaContext.MyDiscordId) _turnIndicator.text = "Lượt của bạn";
                else _turnIndicator.text = "Lượt đối thủ";
            }
        }

        static Color HpColor(float pct)
        {
            if (pct > 50f) return new Color(0.30f, 0.86f, 0.55f);
            if (pct > 25f) return new Color(0.95f, 0.85f, 0.30f);
            return new Color(0.95f, 0.35f, 0.35f);
        }

        int MyHp()    => ArenaContext.MyPlayer?.Hp    ?? 100;
        int MyMax()   => ArenaContext.MyPlayer?.HpMax ?? 100;
        int OppHp()   => ArenaContext.OpponentPlayer?.Hp    ?? 100;
        int OppMax()  => ArenaContext.OpponentPlayer?.HpMax ?? 100;
    }
}
```

**DoD**: compile clean. UXML/USS parse clean (Unity will yell in console if not).

**Commit**: `feat(arena-unity/Lát-D.U6): add HudPanel BasePanel + UXML + USS — HP bars (BillTween animated), turn timer, round/turn indicator`

---

## Sub 5 — ResultPanel UXML + USS + .cs

**Goal**: terminal modal banner.

### 5a. `Assets/RadiantArena/UI/Resources/ResultPanel.uxml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<ui:UXML xmlns:ui="UnityEngine.UIElements" editor-extension-mode="False">
  <ui:VisualElement name="root" class="result-root">

    <ui:VisualElement name="result-card" class="result-card">

      <ui:Label name="result-banner" text="Trận đấu kết thúc" class="result-banner" />
      <ui:Label name="result-outcome" text="" class="result-outcome" />

      <ui:VisualElement name="result-hp" class="result-hp-section">
        <ui:Label name="result-hp-me"  text="—" class="result-hp-row" />
        <ui:Label name="result-hp-opp" text="—" class="result-hp-row" />
      </ui:VisualElement>

      <ui:VisualElement name="result-actions" class="result-actions">
        <ui:Button name="result-replay-btn" text="Chơi lại" class="btn btn-secondary" />
        <ui:Button name="result-lobby-btn"  text="Về sảnh"  class="btn btn-primary" />
      </ui:VisualElement>

    </ui:VisualElement>
  </ui:VisualElement>
</ui:UXML>
```

### 5b. `Assets/RadiantArena/UI/Resources/result.uss`

```css
.result-root {
    position: absolute;
    left: 0; right: 0; top: 0; bottom: 0;
    align-items: center;
    justify-content: center;
    background-color: rgba(0, 0, 0, 0.68);
}

.result-card {
    width: 420px;
    flex-direction: column;
    align-items: center;
    padding-left: 32px;
    padding-right: 32px;
    padding-top: 28px;
    padding-bottom: 28px;
    background-color: rgba(20, 26, 38, 0.96);
    border-top-left-radius: 12px;
    border-top-right-radius: 12px;
    border-bottom-left-radius: 12px;
    border-bottom-right-radius: 12px;
}

.result-banner {
    font-size: 36px;
    -unity-font-style: bold;
    letter-spacing: 2;
    color: rgb(232, 240, 255);
    margin-bottom: 8px;
}

.result-banner.win  { color: rgb(120, 230, 160); }
.result-banner.lose { color: rgb(240, 110, 110); }
.result-banner.draw { color: rgb(220, 220, 200); }

.result-outcome {
    font-size: 14px;
    color: rgba(180, 200, 230, 0.7);
    margin-bottom: 20px;
}

.result-hp-section {
    flex-direction: column;
    margin-bottom: 24px;
}

.result-hp-row {
    font-size: 14px;
    color: rgb(200, 210, 225);
    -unity-text-align: middle-center;
    margin-bottom: 4px;
}

.result-actions {
    flex-direction: row;
}
```

(Buttons inherit `.btn` / `.btn-primary` / `.btn-secondary` from `lobby.uss` — but USS is per-panel scoped via `styleSheets.Add`. Sub 5c will load BOTH `result.uss` AND `lobby.uss` so the buttons inherit the existing style.)

### 5c. `Assets/RadiantArena/UI/ResultPanel.cs`

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
    public class ResultPanel : BasePanel
    {
        VisualElement? _root;
        Label? _banner;
        Label? _outcome;
        Label? _hpMe;
        Label? _hpOpp;
        Button? _replayBtn;
        Button? _lobbyBtn;

        protected override void Build(VisualElement root)
        {
            _root = root;

            var tree = Resources.Load<VisualTreeAsset>("ResultPanel");
            if (tree == null)
            {
                Debug.LogError("[Arena.Result] ResultPanel.uxml not found in Resources/");
                return;
            }
            tree.CloneTree(root);

            // Load result.uss (own styles) + lobby.uss (button .btn inheritance).
            var resultUss = Resources.Load<StyleSheet>("result");
            if (resultUss != null) root.styleSheets.Add(resultUss);
            var lobbyUss = Resources.Load<StyleSheet>("lobby");
            if (lobbyUss != null) root.styleSheets.Add(lobbyUss);

            _banner     = root.Q<Label>("result-banner");
            _outcome    = root.Q<Label>("result-outcome");
            _hpMe       = root.Q<Label>("result-hp-me");
            _hpOpp      = root.Q<Label>("result-hp-opp");
            _replayBtn  = root.Q<Button>("result-replay-btn");
            _lobbyBtn   = root.Q<Button>("result-lobby-btn");

            if (_replayBtn != null) _replayBtn.clicked += () => Debug.Log("[Arena.Result] replay clicked (stub — D.U10/D.U11)");
            if (_lobbyBtn  != null) _lobbyBtn.clicked  += () => Debug.Log("[Arena.Result] back-to-lobby clicked (stub — D.U11)");
        }

        public void Render(string winnerId, string outcome,
            System.Collections.Generic.Dictionary<string, int>? finalHp)
        {
            var meId  = ArenaContext.MyDiscordId  ?? "";
            var oppId = ArenaContext.OpponentDiscordId ?? "";

            string verdictClass;
            string verdictText;
            if (string.IsNullOrEmpty(winnerId))                  { verdictText = "Trận đấu kết thúc"; verdictClass = "draw"; }
            else if (winnerId == meId)                            { verdictText = "Trận đấu THẮNG";   verdictClass = "win"; }
            else                                                  { verdictText = "Trận đấu THUA";    verdictClass = "lose"; }

            if (_banner != null)
            {
                _banner.text = verdictText;
                _banner.EnableInClassList("win",  verdictClass == "win");
                _banner.EnableInClassList("lose", verdictClass == "lose");
                _banner.EnableInClassList("draw", verdictClass == "draw");
            }
            if (_outcome != null)
            {
                _outcome.text = string.IsNullOrEmpty(outcome) ? "" : $"({outcome})";
            }

            int meHp  = 0, oppHp = 0;
            if (finalHp != null)
            {
                if (!string.IsNullOrEmpty(meId))  finalHp.TryGetValue(meId,  out meHp);
                if (!string.IsNullOrEmpty(oppId)) finalHp.TryGetValue(oppId, out oppHp);
            }
            if (_hpMe  != null) _hpMe.text  = $"{(string.IsNullOrEmpty(meId)  ? "Me" : meId)}: {meHp} HP";
            if (_hpOpp != null) _hpOpp.text = $"{(string.IsNullOrEmpty(oppId) ? "—" : oppId)}: {oppHp} HP";
        }
    }
}
```

**DoD**: compile clean.

**Commit**: `feat(arena-unity/Lát-D.U6): add ResultPanel BasePanel + UXML + USS — winner banner + outcome + final HPs + stub buttons`

---

## Sub 6 — EndState + transitions + CountdownState opens HudPanel

**Goal**: state machine wiring.

### 6a. `Assets/RadiantArena/Scripts/States/EndState.cs` — CREATE

```csharp
#nullable enable
using System;
using BillGameCore;
using RadiantArena.Events;
using RadiantArena.Net;
using RadiantArena.UI;
using UnityEngine;

namespace RadiantArena.States
{
    /// <summary>
    /// Terminal state. Opens ResultPanel from MatchEndedEvent (or from
    /// ArenaContext.LastMatch* if the event landed before Enter — race-fallback).
    /// Closes HudPanel + TurnInputPanel defensively.
    /// </summary>
    public class EndState : GameState
    {
        Action<MatchEndedEvent>? _onMatch;
        bool _rendered;

        public override void Enter()
        {
            Debug.Log("[Arena.End] Enter — closing HUD + opening ResultPanel");
            _rendered = false;

            // Close all combat UI.
            if (Bill.UI.IsOpen<HudPanel>())       Bill.UI.Close<HudPanel>();
            if (Bill.UI.IsOpen<TurnInputPanel>()) Bill.UI.Close<TurnInputPanel>();

            // Open ResultPanel — may not have payload yet; setter below fills it.
            var panel = Bill.UI.Open<ResultPanel>();

            _onMatch = OnMatchEnded;
            Bill.Events.Subscribe(_onMatch);

            // Race fallback — if NetClient already cached last match, render now.
            if (!string.IsNullOrEmpty(ArenaContext.LastMatchWinnerId)
                || !string.IsNullOrEmpty(ArenaContext.LastMatchOutcome))
            {
                Debug.Log("[Arena.End] replaying cached LastMatch* (arrived before Enter)");
                panel?.Render(
                    ArenaContext.LastMatchWinnerId,
                    ArenaContext.LastMatchOutcome,
                    ArenaContext.LastMatchFinalHp);
                _rendered = true;
            }
        }

        public override void Exit()
        {
            if (_onMatch != null) Bill.Events.Unsubscribe(_onMatch);
            _onMatch = null;
            if (Bill.UI.IsOpen<ResultPanel>()) Bill.UI.Close<ResultPanel>();
        }

        void OnMatchEnded(MatchEndedEvent e)
        {
            if (_rendered) return; // idempotent — Render() already ran from cache
            _rendered = true;
            var panel = Bill.UI.IsOpen<ResultPanel>() ? GetOpenPanel() : Bill.UI.Open<ResultPanel>();
            panel?.Render(e.winnerId, e.outcome, e.finalHp);
        }

        static ResultPanel? GetOpenPanel()
        {
            // Bill.UI doesn't expose an "active T" getter — re-Open is idempotent
            // when already open (per Sub 1 verify). But to be safe we return null
            // and let the caller re-Open which the IUIService should treat as no-op.
            return Bill.UI.Open<ResultPanel>();
        }
    }
}
```

### 6b. `Assets/RadiantArena/Scripts/States/ArenaStates.cs` — append

```csharp
Bill.State.AddState(new EndState());
```

### 6c. `Assets/RadiantArena/Scripts/States/CountdownState.cs` — extend `Enter`

Find the existing `Debug.Log("[Arena.Countdown] Enter — ...")` line; insert after it:

```csharp
if (!Bill.UI.IsOpen<UI.HudPanel>()) Bill.UI.Open<UI.HudPanel>();
```

(Use the full namespace `RadiantArena.UI.HudPanel` or add `using RadiantArena.UI;` — match existing using style.)

### 6d. `Assets/RadiantArena/Scripts/States/LobbyState.cs` — defensive close in `Enter`

Find the existing `Enter`. Add at the top (defensive — handles re-entry after a match):

```csharp
if (Bill.UI.IsOpen<UI.HudPanel>()) Bill.UI.Close<UI.HudPanel>();
if (Bill.UI.IsOpen<UI.ResultPanel>()) Bill.UI.Close<UI.ResultPanel>();
```

### 6e. `Assets/RadiantArena/Scripts/States/AnimatingState.cs` — extend `OnPhaseChanged`

Replace the existing `else if (e.newPhase == "ended")` block:

```csharp
else if (e.newPhase == "ended")
{
    Debug.Log("[Arena.Animating] phase=ended → EndState");
    Bill.State.GoTo<EndState>();
}
```

### 6f. `Assets/RadiantArena/Scripts/States/MyTurnState.cs` — extend `_onPhase` lambda

Original:
```csharp
_onPhase = e => { if (e.newPhase == "animating") Bill.State.GoTo<AnimatingState>(); };
```
→
```csharp
_onPhase = e =>
{
    if (e.newPhase == "animating") Bill.State.GoTo<AnimatingState>();
    else if (e.newPhase == "ended") Bill.State.GoTo<EndState>();
};
```

### 6g. `Assets/RadiantArena/Scripts/States/OpponentTurnState.cs` — same change as 6f

### 6h. `Assets/RadiantArena/Scripts/States/CountdownState.cs` — extend `OnPhaseChanged` to handle ended

Add `else if (e.newPhase == "ended") Bill.State.GoTo<EndState>();` to the existing `OnPhaseChanged` method.

**DoD**: compile clean.

**Commit**: `feat(arena-unity/Lát-D.U6): add EndState + register + wire phase=ended from Countdown/MyTurn/OpponentTurn/Animating + Countdown opens HudPanel + Lobby closes leftover HUDs`

---

## Sub 7 — Move timer ownership: drop from TurnInputPanel

**Goal**: TurnInputPanel no longer has its own timer; HudPanel owns the canonical render.

### 7a. `Assets/RadiantArena/UI/Resources/TurnInputPanel.uxml` — drop the timer Label

Before:
```xml
<ui:VisualElement name="header" class="turn-header">
  <ui:Label name="title" text="LƯỢT CỦA TÔI" class="turn-title" />
  <ui:Label name="timer" text="—" class="turn-timer" />
</ui:VisualElement>
```
After:
```xml
<ui:VisualElement name="header" class="turn-header">
  <ui:Label name="title" text="LƯỢT CỦA TÔI" class="turn-title" />
</ui:VisualElement>
```

### 7b. `Assets/RadiantArena/UI/TurnInputPanel.cs`

Delete:
- `Label? _timer;` field
- `_timer = root.Q<Label>("timer");` in `Build`
- The entire `RefreshTimer()` method
- The scheduler `_tick = _root?.schedule.Execute(RefreshTimer).Every(250); RefreshTimer();` in `OnOpened`
- `_tick?.Pause(); _tick = null;` in `OnClosed`
- `IVisualElementScheduledItem? _tick;` field (no longer needed)

Keep: `_currentPower`, `UpdatePowerVisual()`, all aim event handling.

(Optionally leave `.turn-timer` styles in `turn_input.uss` — they're dead code but harmless. Don't waste a commit removing.)

**DoD**: compile clean. TurnInputPanel still renders title + power gauge + hint when opened.

**Commit**: `refactor(arena-unity/Lát-D.U6): move turn-timer ownership from TurnInputPanel to HudPanel — drop duplicate render`

---

## Sub 8 — Mock smoke (NO commit)

**Goal**: validate full HUD + ResultPanel pipeline without arena-server.

**Pre**:
- Stop/start Play (D.U5 lesson — fresh Bill.IsReady).
- `compiler: codedom` for every execute_code (D.U5 lesson — Roslyn nukes services).
- Call `ArenaStates.Register()` explicitly first (D.U5 lesson — race against ArenaBootstrap.Start).

**Actions**:

1. `mcp__unityMCP__read_console clear`.
2. **Step A — drive into Countdown**:
   ```csharp
   RadiantArena.States.ArenaStates.Register();

   RadiantArena.Net.ArenaContext.MyDiscordId       = "me";
   RadiantArena.Net.ArenaContext.OpponentDiscordId = "opp";
   RadiantArena.Net.ArenaContext.SessionId         = "smoke-session";
   RadiantArena.Net.ArenaContext.CurrentRound      = 1;
   RadiantArena.Net.ArenaContext.CurrentPhase      = "countdown";
   RadiantArena.Net.ArenaContext.TurnPlayerId      = "me";
   RadiantArena.Net.ArenaContext.TurnDeadlineAt    =
       (long)(System.DateTime.UtcNow.AddSeconds(30) -
              new System.DateTime(1970,1,1,0,0,0,System.DateTimeKind.Utc)).TotalMilliseconds;

   // Inject MyPlayer / OpponentPlayer snapshots — use reflection setter (private setter).
   var psType = typeof(RadiantArena.Net.ArenaContext);
   var flags  = System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static;
   var meSnap  = new RadiantArena.Net.PlayerSnapshot { DiscordId = "me",  DisplayName = "Me",  Hp = 100, HpMax = 100, SelectedWeaponSlug = "weapon_kiem_01" };
   var oppSnap = new RadiantArena.Net.PlayerSnapshot { DiscordId = "opp", DisplayName = "Opp", Hp = 100, HpMax = 100, SelectedWeaponSlug = "weapon_chuy_01"  };
   psType.GetProperty("MyPlayer").SetValue(null, meSnap);
   psType.GetProperty("OpponentPlayer").SetValue(null, oppSnap);

   BillGameCore.Bill.State.GoTo<RadiantArena.States.CountdownState>();
   ```
   Expect log: `[Bill.State] ??? -> Countdown`, `[Arena.Countdown] Enter`, `[Arena.HUD] opened, snapping bars me=100/100 opp=100/100`.
3. `find_gameobjects "[Bill.UI]"` → confirm UIDocument exists (it always does — but verify HudPanel children via subsequent reflection probe).
4. **Step B — HP change for opponent (75)**:
   ```csharp
   BillGameCore.Bill.Events.Fire(new RadiantArena.Events.HpChangedEvent {
       playerId = "opp", oldHp = 100, newHp = 75, hpMax = 100 });
   ```
   Expect: `[Arena.HUD] HP opp 100→75/100`.
5. Wait ~0.5s (Bash sleep). Probe `opp-bar-fill.style.width.value.value` (or just trust the log).
6. **Step C — HP change for me (40 — into red zone)**:
   ```csharp
   BillGameCore.Bill.Events.Fire(new RadiantArena.Events.HpChangedEvent {
       playerId = "me", oldHp = 100, newHp = 40, hpMax = 100 });
   ```
   Expect: `[Arena.HUD] HP me 100→40/100`. Color in setter should hit yellow → red ramp.
7. Wait ~0.5s.
8. **Step D — Match ends**:
   ```csharp
   var hpDict = new System.Collections.Generic.Dictionary<string,int> {
       { "me", 40 }, { "opp", 0 } };
   BillGameCore.Bill.Events.Fire(new RadiantArena.Events.MatchEndedEvent {
       winnerId = "me", outcome = "win", finalHp = hpDict });
   ```
   Expect: `[Arena.End] Enter — closing HUD + opening ResultPanel`, banner reads "Trận đấu THẮNG".
9. `Bill.State.GoTo<RadiantArena.States.EndState>()` may or may not have already fired via PhaseChangedEvent — if not, call it explicitly here. (Step D fires MatchEndedEvent directly; EndState.Enter is what closes HudPanel + opens ResultPanel. So we DO need to GoTo<EndState>() explicitly in mock since we're not firing PhaseChangedEvent.)
   Actually — re-order: fire `Bill.State.GoTo<EndState>()` AFTER the MatchEndedEvent so the race-fallback `LastMatch*` path is exercised. Confirm log `[Arena.End] replaying cached LastMatch* (arrived before Enter)`.
10. **Step E — Loser perspective**: re-mock with `MyDiscordId="opp"` (so winner "me" becomes opponent), re-fire match_ended, verify banner reads "Trận đấu THUA". (Optional — skip if context budget tight.)
11. `mcp__unityMCP__manage_editor stop`.
12. `mcp__unityMCP__read_console types=["error"]` → 0 errors.

**Output**:
- Full log capture for steps 2-9 (pass/fail per expected line).
- Confirmation that no NEW errors introduced (baseline unchanged).

**DoD**:
- HudPanel opens on Countdown, displays both bars at 100%.
- HpChangedEvent triggers BillTween (verified by `[Arena.HUD] HP ...` logs + width change after sleep).
- MatchEndedEvent → EndState opens ResultPanel with correct banner text.
- Race-fallback path exercised (event before Enter case in §6.9).
- TurnInputPanel still works (no timer references after Sub 7 cleanup).

**NO commit**. REPORT.md follows.

---

## DoD overall (D.U6a close)

- [ ] Sub 1 baseline verified (BillTween facade, NetClient stub, IsOpen behavior).
- [ ] Sub 2 events + ctx landed.
- [ ] Sub 3 NetClient HP diff + OnMatchEnded landed.
- [ ] Sub 4 HudPanel landed.
- [ ] Sub 5 ResultPanel landed.
- [ ] Sub 6 EndState + state-machine wiring landed.
- [ ] Sub 7 TurnInputPanel timer refactored out.
- [ ] Sub 8 mock smoke pass.

D.U6b (real server damage + HP-0 match end + 2-instance smoke) deferred until arena-server Lát D.5 ships physics.
