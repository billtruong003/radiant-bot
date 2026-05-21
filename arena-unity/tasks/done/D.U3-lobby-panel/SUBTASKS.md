# D.U3 — LobbyPanel + weapon pick UI · SUBTASKS

> 8 subs / 6 commits (Sub 1 + Sub 8 verify-only). 1 sub per invocation per ROADMAP convention; Bill chose sequential-auto mode for this Lát.

---

## Sub 1 — Verify baseline (read-only, NO commit)

**Goal**: confirm `BasePanel`, `Bill.UI.Open<T>`, `Resources.Load<VisualTreeAsset>`, `ArrayShema<WeaponSchema>` enumeration patterns work before writing code.

**Actions**:
1. `read_console` types=["error"] → empty.
2. Read `Assets/BillGameCore/Runtime/Services/CoreServices.cs:75-142` → confirm BasePanel + UIService surface (DONE during PLAN drafting; re-verify path exists).
3. `execute_code` quick check: `Bill.UI != null` in Edit mode? (probably no — Bill init runs at game start). Just verify type accessible via reflection.
4. Confirm Newtonsoft.Json no longer in scope (D.U3 doesn't need JSON — Colyseus handles wire format).
5. Quick `find_in_file` over Colyseus SDK for `ArraySchema` enumeration pattern: confirm `foreach (var w in p.available_weapons)` works (it implements IEnumerable<T>).

**Output**:
- ✅ / ❌ BasePanel base class accessible from Assembly-CSharp.
- ✅ / ❌ Resources folder convention applies anywhere — recommend `Assets/RadiantArena/UI/Resources/`.
- ArraySchema enumeration: `foreach (T item in arraySchema)` or `.GetItems()` — record correct one.

**DoD**: report posted, NO file change, NO commit.

---

## Sub 2 — Extend `ArenaContext` with `WeaponSnapshot` + AvailableWeapons hydration

**Goal**: edit `Assets/RadiantArena/Scripts/Net/ArenaContext.cs` to add `WeaponSnapshot` class and extend `PlayerSnapshot` ctor.

**Add**:
```csharp
public class WeaponSnapshot
{
    public string Slug = "";
    public string DisplayName = "";
    public string Category = "blunt";
    public string Tier = "pham";
    public string Hue = "#ffffff";   // from WeaponVisualSchema.hue

    public WeaponSnapshot() { }
    public WeaponSnapshot(WeaponSchema w)
    {
        Slug = w.slug;
        DisplayName = w.display_name;
        Category = w.category;
        Tier = w.tier;
        Hue = w.visual != null ? w.visual.hue : "#ffffff";
    }
}
```

**Extend `PlayerSnapshot`**:
- Add fields: `public WeaponSnapshot[] AvailableWeapons = System.Array.Empty<WeaponSnapshot>();` + `public WeaponSnapshot? LockedWeapon = null;` (after countdown).
- Update `PlayerSnapshot(PlayerSchema p)`:
  ```csharp
  if (p.available_weapons != null) {
      var list = new System.Collections.Generic.List<WeaponSnapshot>(p.available_weapons.Count);
      foreach (WeaponSchema w in p.available_weapons) list.Add(new WeaponSnapshot(w));
      AvailableWeapons = list.ToArray();
  }
  LockedWeapon = (p.weapon != null && !string.IsNullOrEmpty(p.weapon.slug)) ? new WeaponSnapshot(p.weapon) : null;
  ```

**Constraints**:
- `#nullable enable`, same as existing file.
- Keep all D.U2 fields intact.
- Don't touch `ArenaContext.HydrateFrom` body — it already wraps PlayerSnapshot ctor.

**DoD**: compile clean.

**Commit**: `feat(arena-unity/Lát-D.U3): extend ArenaContext with WeaponSnapshot + available_weapons hydration`

---

## Sub 3 — Write `Assets/RadiantArena/UI/Resources/LobbyPanel.uxml`

**Goal**: UI Toolkit layout for the lobby.

**Structure** (semantic outline, attribute syntax flat):
```xml
<UXML xmlns:ui="UnityEngine.UIElements">
  <ui:VisualElement name="root" class="lobby-root">
    <ui:VisualElement name="header" class="lobby-header">
      <ui:Label name="title" text="LOBBY" class="lobby-title" />
      <ui:Label name="session-id" class="lobby-session" />
    </ui:VisualElement>

    <ui:VisualElement name="player-slots" class="lobby-slots">
      <ui:VisualElement name="me-slot" class="lobby-slot me">
        <ui:Label name="me-name" class="slot-name" text="Me" />
        <ui:Label name="me-ready" class="slot-ready" text="Not ready" />
      </ui:VisualElement>
      <ui:VisualElement name="opponent-slot" class="lobby-slot opponent">
        <ui:Label name="opponent-name" class="slot-name" text="Waiting…" />
        <ui:Label name="opponent-ready" class="slot-ready" text="--" />
      </ui:VisualElement>
    </ui:VisualElement>

    <ui:VisualElement name="weapons-section" class="lobby-weapons">
      <ui:Label class="weapons-label" text="Chọn vũ khí" />
      <ui:ListView name="weapon-list" class="weapon-list" />
    </ui:VisualElement>

    <ui:VisualElement name="actions" class="lobby-actions">
      <ui:Button name="ready-btn" text="Sẵn sàng" class="btn btn-primary" />
      <ui:Button name="unready-btn" text="Huỷ" class="btn btn-secondary" />
    </ui:VisualElement>
  </ui:VisualElement>
</UXML>
```

**Notes**:
- Use `name="..."` for code lookup via `root.Q<T>("name")`.
- All class attributes get USS styling in Sub 4.
- No images / sprites yet (D.U7+).

**DoD**: file exists. Unity recognizes as VisualTreeAsset (no console error on import).

**Commit**: `feat(arena-unity/Lát-D.U3): add LobbyPanel.uxml under UI/Resources`

---

## Sub 4 — Write `Assets/RadiantArena/UI/Resources/lobby.uss`

**Goal**: Style sheet for LobbyPanel. Minimal dark theme — readable at 1280×720.

**Style targets**:
- `.lobby-root`: absolute fill, dark translucent backdrop, flex column, padding 32px.
- `.lobby-header`: row, space-between, font-size 24px.
- `.lobby-slots`: row, 2 children flex 1, gap 16px.
- `.lobby-slot`: rounded card, background dark gray, padding 16px. `.me` accent left border green, `.opponent` accent right border orange.
- `.slot-name`: font-size 18, bold.
- `.slot-ready`: font-size 14, color gray. (LobbyPanel.cs will toggle a `.ready` class for green color.)
- `.lobby-weapons`: flex 1, margin-top 24px.
- `.weapon-list .unity-list-view__item`: row, padding 12px, border-radius 4px, hover bg lighter.
- `.weapon-list .unity-list-view__item:selected`: border 2px green.
- `.lobby-actions`: row, gap 12px, justify-content flex-end, margin-top 24px.
- `.btn`: padding 12px 24px, font-size 16, border-radius 6px, cursor pointer.
- `.btn-primary`: bg green, color white. `:disabled`: bg gray.
- `.btn-secondary`: bg dark gray, color light gray.

**DoD**: file exists, no USS parse errors in console.

**Commit**: `feat(arena-unity/Lát-D.U3): add lobby.uss under UI/Resources`

---

## Sub 5 — Write `LobbyPanel.cs`

**Goal**: Create `Assets/RadiantArena/UI/LobbyPanel.cs`. BasePanel impl with ListView binding + event hooks.

**Skeleton**:
```csharp
#nullable enable
using System;
using BillGameCore;
using RadiantArena.Net;
using UnityEngine;
using UnityEngine.UIElements;

namespace RadiantArena.UI
{
    public class LobbyPanel : BasePanel
    {
        // Public surface — state machine subscribes.
        public event Action<string>? OnWeaponPicked;
        public event Action? OnReadyClicked;
        public event Action? OnUnreadyClicked;

        VisualElement? _root;
        ListView? _weaponList;
        Label? _meName;
        Label? _meReady;
        Label? _opponentName;
        Label? _opponentReady;
        Label? _sessionId;
        Button? _readyBtn;
        Button? _unreadyBtn;

        WeaponSnapshot[] _weapons = System.Array.Empty<WeaponSnapshot>();
        IVisualElementScheduledItem? _opponentPoll;

        protected override void Build(VisualElement root)
        {
            _root = root;

            var tree = Resources.Load<VisualTreeAsset>("LobbyPanel");
            if (tree == null) { Debug.LogError("[Arena.Lobby] LobbyPanel.uxml not found in Resources/"); return; }
            tree.CloneTree(root);

            var uss = Resources.Load<StyleSheet>("lobby");
            if (uss != null) root.styleSheets.Add(uss);

            _weaponList = root.Q<ListView>("weapon-list");
            _meName = root.Q<Label>("me-name");
            _meReady = root.Q<Label>("me-ready");
            _opponentName = root.Q<Label>("opponent-name");
            _opponentReady = root.Q<Label>("opponent-ready");
            _sessionId = root.Q<Label>("session-id");
            _readyBtn = root.Q<Button>("ready-btn");
            _unreadyBtn = root.Q<Button>("unready-btn");

            if (_weaponList != null)
            {
                _weaponList.fixedItemHeight = 36;
                _weaponList.selectionType = SelectionType.Single;
                _weaponList.makeItem = () => {
                    var label = new Label();
                    label.AddToClassList("weapon-item");
                    return label;
                };
                _weaponList.bindItem = (el, i) => {
                    if (i < 0 || i >= _weapons.Length) return;
                    var w = _weapons[i];
                    ((Label)el).text = $"{w.DisplayName}  ·  {w.Tier}/{w.Category}";
                };
                _weaponList.selectionChanged += OnSelectionChanged;
            }

            if (_readyBtn != null) _readyBtn.clicked += () => OnReadyClicked?.Invoke();
            if (_unreadyBtn != null) _unreadyBtn.clicked += () => OnUnreadyClicked?.Invoke();
        }

        void OnSelectionChanged(System.Collections.Generic.IEnumerable<object> _)
        {
            if (_weaponList == null) return;
            int idx = _weaponList.selectedIndex;
            if (idx < 0 || idx >= _weapons.Length) return;
            OnWeaponPicked?.Invoke(_weapons[idx].Slug);
        }

        public void SetAvailableWeapons(WeaponSnapshot[] weapons)
        {
            _weapons = weapons ?? System.Array.Empty<WeaponSnapshot>();
            if (_weaponList != null)
            {
                _weaponList.itemsSource = _weapons;
                _weaponList.Rebuild();
            }
        }

        public void SetSessionId(string sessionId)
        {
            if (_sessionId != null) _sessionId.text = sessionId;
        }

        public override void OnOpened()
        {
            // Mirror opponent state every 250ms via UI scheduler — cheap, decouples from per-field events.
            _opponentPoll = _root?.schedule.Execute(RefreshFromContext).Every(250);
            RefreshFromContext();
        }

        public override void OnClosed()
        {
            _opponentPoll?.Pause();
            _opponentPoll = null;
        }

        void RefreshFromContext()
        {
            if (_meName != null) _meName.text = ArenaContext.MyDiscordId == "" ? "Me" : ArenaContext.MyDiscordId;
            if (_meReady != null)
            {
                var ready = ArenaContext.MyPlayer != null && ArenaContext.MyPlayer.Ready;
                _meReady.text = ready ? "READY" : "Not ready";
                _meReady.EnableInClassList("ready", ready);
            }
            if (_opponentName != null)
            {
                _opponentName.text = string.IsNullOrEmpty(ArenaContext.OpponentDiscordId) ? "Waiting for opponent…" : ArenaContext.OpponentDiscordId;
            }
            if (_opponentReady != null)
            {
                var ready = ArenaContext.OpponentPlayer != null && ArenaContext.OpponentPlayer.Ready;
                _opponentReady.text = ArenaContext.OpponentPlayer == null ? "--" : (ready ? "READY" : "Not ready");
                _opponentReady.EnableInClassList("ready", ready);
            }
        }
    }
}
```

**Constraints**:
- `using BillGameCore;` for `BasePanel`.
- All Q lookups return-checked for null (UXML schema could drift).
- `_opponentPoll` uses VisualElement scheduler — cheaper than `Update()` Component.

**DoD**: compile clean.

**Commit**: `feat(arena-unity/Lát-D.U3): add LobbyPanel BasePanel with ListView + event surface`

---

## Sub 6 — Write `LobbyState.cs`

**Goal**: Create `Assets/RadiantArena/Scripts/States/LobbyState.cs`. Opens panel, wires events to NetClient.Send, listens for phase=countdown to log handoff.

**Skeleton**:
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
    public class LobbyState : GameState
    {
        Action<PhaseChangedEvent>? _onPhase;
        LobbyPanel? _panel;

        public override void Enter()
        {
            var weapons = ArenaContext.MyPlayer != null
                ? ArenaContext.MyPlayer.AvailableWeapons
                : System.Array.Empty<WeaponSnapshot>();

            _panel = Bill.UI.Open<LobbyPanel>(p => {
                p.SetSessionId(ArenaContext.SessionId);
                p.SetAvailableWeapons(weapons);
                p.OnWeaponPicked += OnWeaponPicked;
                p.OnReadyClicked += OnReadyClicked;
                p.OnUnreadyClicked += OnUnreadyClicked;
            });

            _onPhase = OnPhaseChanged;
            Bill.Events.Subscribe(_onPhase);

            Debug.Log($"[Arena.Lobby] Opened LobbyPanel, {weapons.Length} weapons available");
        }

        public override void Exit()
        {
            if (_panel != null)
            {
                _panel.OnWeaponPicked -= OnWeaponPicked;
                _panel.OnReadyClicked -= OnReadyClicked;
                _panel.OnUnreadyClicked -= OnUnreadyClicked;
            }
            Bill.UI.Close<LobbyPanel>();

            if (_onPhase != null) Bill.Events.Unsubscribe(_onPhase);
            _onPhase = null;
            _panel = null;
        }

        void OnWeaponPicked(string slug)
        {
            Debug.Log($"[Arena.Lobby] pick weapon: {slug}");
            NetClient.Instance?.Send("select_weapon", new SelectWeaponMsg { slug = slug });
        }

        void OnReadyClicked()
        {
            Debug.Log("[Arena.Lobby] ready");
            NetClient.Instance?.Send("ready", new ReadyMsg());
        }

        void OnUnreadyClicked()
        {
            Debug.Log("[Arena.Lobby] unready");
            NetClient.Instance?.Send("unready", new UnreadyMsg());
        }

        void OnPhaseChanged(PhaseChangedEvent e)
        {
            if (e.newPhase == "countdown")
            {
                Debug.Log($"[Arena.Lobby] phase -> countdown (CountdownState deferred to D.U4 — staying in Lobby)");
                // D.U4: Bill.State.GoTo<CountdownState>();
            }
            else if (e.newPhase == "active")
            {
                Debug.Log($"[Arena.Lobby] phase -> active (TurnInput deferred to D.U4)");
            }
        }
    }
}
```

**DoD**: compile clean.

**Commit**: `feat(arena-unity/Lát-D.U3): add LobbyState wiring panel events to NetClient.Send`

---

## Sub 7 — Wire LobbyState into ConnectingState + ArenaStates.Register

**Goal**: 2 small edits.

### 7a. `ConnectingState.cs` — transition on phase=lobby

In `_onError` definition / after the existing `_onConnected` log, extend:

Actually cleaner: add a new field `Action<PhaseChangedEvent>? _onPhase;` and subscribe in Enter, route to LobbyState on `newPhase=="lobby"`. Unsubscribe in Exit.

```csharp
// In ConnectingState (full file edit)
Action<PhaseChangedEvent>? _onPhase;

public override void Enter()
{
    Debug.Log("[Arena.Connecting] Waiting for NetConnectedEvent / NetErrorEvent ...");

    _onConnected = e => Debug.Log($"[Arena.Connecting] Connected sessionId={e.sessionId} roomId={e.roomId}");
    _onError = e => Debug.LogWarning($"[Arena.Connecting] NetErrorEvent code={e.code} message={e.message}");
    _onPhase = e => {
        if (e.newPhase == "lobby")
        {
            Debug.Log("[Arena.Connecting] phase -> lobby, transitioning to LobbyState");
            Bill.State.GoTo<LobbyState>();
        }
    };
    Bill.Events.Subscribe(_onConnected);
    Bill.Events.Subscribe(_onError);
    Bill.Events.Subscribe(_onPhase);

    // (existing auto-connect block unchanged)
}

public override void Exit()
{
    if (_onConnected != null) Bill.Events.Unsubscribe(_onConnected);
    if (_onError != null) Bill.Events.Unsubscribe(_onError);
    if (_onPhase != null) Bill.Events.Unsubscribe(_onPhase);
    _onConnected = null;
    _onError = null;
    _onPhase = null;
}
```

### 7b. `ArenaStates.cs` — append LobbyState

```csharp
public static void Register()
{
    Bill.State.AddState(new BootState());
    Bill.State.AddState(new ConnectingState());
    Bill.State.AddState(new LobbyState());   // NEW
}
```

**DoD**: compile clean.

**Commit**: `feat(arena-unity/Lát-D.U3): wire ConnectingState→LobbyState on phase=lobby + register LobbyState`

---

## Sub 8 — Mock smoke (NO commit)

**Goal**: prove panel renders + click handlers fire without a live server, via `execute_code` reflection.

**Actions**:
1. `manage_scene` load Bootstrap.unity (already there but explicit).
2. `read_console` clear.
3. `manage_editor` play. Wait `is_playing=true`.
4. `execute_code`:
   - Set `ArenaContext.MyDiscordId = "mock_me";`.
   - Create 3 `WeaponSnapshot` instances with realistic data (slug + display_name + tier + category).
   - Create a `PlayerSnapshot` with those weapons in `AvailableWeapons`. Set `Ready = false`.
   - Assign to `ArenaContext.MyPlayer` (note: it's `{ get; private set; }` — need reflection FieldInfo or expose internal setter via partial class — alternative: directly call `HydrateFrom(state)` with a mocked `DuelState`).
   
   **Workaround**: skip MyPlayer setter struggle — instead, just call `Bill.State.GoTo<LobbyState>()` after `_panel` reads `ArenaContext.MyPlayer` (null) → falls back to empty list. Confirms panel opens. Then verify via reflection that LobbyState.Enter ran (look for `[Arena.Lobby] Opened LobbyPanel` log).
   
5. Verify logs:
   - `[Bill.State] ... -> Lobby`
   - `[Arena.Lobby] Opened LobbyPanel, 0 weapons available` (empty because MyPlayer null)
6. `execute_code`: get `[Bill.UI]` GameObject, check its UIDocument's rootVisualElement has a child VisualElement (LobbyPanel.Root).
7. `Bill.State.GoTo<RadiantArena.States.ConnectingState>()` → confirm LobbyState.Exit fires + panel closes.
8. `manage_editor` stop. Final console clean.

Better approach for step 4 — populate `ArenaContext.MyPlayer` via reflection (it's a public static property with private setter):
```csharp
var t = System.Type.GetType("RadiantArena.Net.ArenaContext, Assembly-CSharp");
var prop = t.GetProperty("MyPlayer");
var setter = prop.GetSetMethod(true) ?? prop.SetMethod;  // private setter
var snapshotT = System.Type.GetType("RadiantArena.Net.PlayerSnapshot, Assembly-CSharp");
var snap = System.Activator.CreateInstance(snapshotT);
snapshotT.GetField("DiscordId").SetValue(snap, "mock_me");
// ... populate fields ...
setter.Invoke(null, new[] { snap });
```

**DoD**: 
- `[Bill.State] -> Lobby` log present.
- `[Arena.Lobby] Opened LobbyPanel, N weapons available` log present (N ≥ 0).
- LobbyPanel VisualElement attached to `[Bill.UI]`.
- No new errors beyond baseline.

**NO commit**. REPORT.md captures the smoke output.

---

## DoD overall (D.U3a close)

- [x] (Sub 1) BasePanel + Resources pattern verified.
- [x] (Sub 2) WeaponSnapshot + ArenaContext hydration.
- [x] (Sub 3) LobbyPanel.uxml.
- [x] (Sub 4) lobby.uss.
- [x] (Sub 5) LobbyPanel.cs (BasePanel impl).
- [x] (Sub 6) LobbyState.cs.
- [x] (Sub 7) ConnectingState→LobbyState transition + register.
- [x] (Sub 8) Mock smoke: panel opens, events route, exit cleans up.

D.U3b (real 2-instance lobby → both ready → countdown) deferred — blocked on arena-server D.3 + D.4.
