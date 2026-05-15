# Unity Client Guide — Radiant Arena

> Implementation guide cho **Unity WebGL client** của Radiant Arena. Unity 6 + URP + HLSL shaders + BillGameCore.
>
> **Trạng thái hiện tại:** chưa build. Bot Lát A đã ship (commit `1c9f1b3`); Colyseus server theo `docs/COLYSEUS_SERVER_GUIDE.md` (cũng chưa build).
>
> **Đọc trước:**
> - `docs/RADIANT_ARENA_ARCHITECTURE.md` §7 (Unity architecture overview)
> - BillGameCore API reference (đã paste trong session — đặt ở repo `radiant-arena-unity/Docs/BILLGAMECORE_API.md`)
> - `docs/COLYSEUS_SERVER_GUIDE.md` §4 (message + state contract — Unity tiêu thụ)

---

## 0. TL;DR — Design philosophy

| Pillar | Decision |
|---|---|
| Engine | Unity 6 |
| Render pipeline | URP (Universal Render Pipeline) |
| Shader language | HLSL (custom shaders) — note loại ở §11, Bill dev sau |
| Visual direction | Stylize cartoon — bold outlines, flat-shaded zones, no PBR, ink-wash particles |
| Framework | BillGameCore (Bill.X services) — KHÔNG bypass; mọi pattern qua Bill.State / Bill.Events / Bill.Pool |
| Networking | Colyseus Unity SDK (`com.colyseus.colyseus-unity-sdk`) qua `NetClient.cs` wrapper |
| Server authority | 100% server. Client chỉ render trajectory đã được sim trên Colyseus. Drag-aim chỉ là input UX. |
| Test workflow | **Double-test** — 2 Editor instance qua ParrelSync, hoặc Editor + WebGL build |
| Weapon UI rule | **Lobby chỉ show weapon nào server biết** (sent qua state) — không hardcode catalog UI side |

---

## 1. Project bootstrap

### 1.1 — Create Unity project

```
Unity Hub → New Project → Unity 6.0 LTS → Universal 3D template
Name: radiant-arena-unity
Location: ~/projects/radiant-arena-unity
```

After create:
- `Edit → Project Settings → Player → Other Settings → API Compatibility = .NET Standard 2.1`
- `Edit → Project Settings → Player → WebGL → Resolution = 1280×720, Run In Background = false`
- `Edit → Project Settings → Quality → Default (URP-HighFidelity-Renderer)` cho desktop preview; runtime WebGL có Quality riêng.

### 1.2 — Install packages

Window → Package Manager → `+` → "Add package from git URL":

```
https://github.com/colyseus/colyseus-unity-sdk.git?path=Assets/Colyseus
```

Then via Unity Package Manager (registry):
- `com.unity.cinemachine` — camera (optional but recommended)
- `com.unity.shadergraph` — shader graph fallback for non-HLSL shaders
- `com.unity.render-pipelines.universal` — URP
- `com.unity.ui` (UI Toolkit) — for panels via BillGameCore IUIService

BillGameCore install (Bill's existing package; assume local path or git):
```
Window → Package Manager → "Add from disk" → BillGameCore/package.json
```

### 1.3 — Folder layout

```
Assets/
├── RadiantArena/
│   ├── Scenes/
│   │   ├── ArenaScene.unity         # main gameplay scene
│   │   └── LobbyScene.unity         # weapon-pick + ready (optional, can be panels in Arena)
│   ├── Scripts/
│   │   ├── Bootstrap/
│   │   │   ├── GameBootstrap.cs     # Bill.Init + pool registration + state machine
│   │   │   └── ArenaContext.cs      # static singleton — current match snapshot
│   │   ├── Net/
│   │   │   ├── NetClient.cs         # Colyseus connection + message → Bill.Events bridge
│   │   │   └── NetMessageTypes.cs   # POCOs for messages
│   │   ├── States/
│   │   │   ├── BootState.cs
│   │   │   ├── ConnectingState.cs
│   │   │   ├── LobbyState.cs
│   │   │   ├── CountdownState.cs
│   │   │   ├── MyTurnState.cs
│   │   │   ├── OpponentTurnState.cs
│   │   │   ├── AnimatingState.cs
│   │   │   └── EndState.cs
│   │   ├── Gameplay/
│   │   │   ├── ArenaManager.cs      # root controller, registers states
│   │   │   ├── WeaponController.cs  # drag-aim-release input + render
│   │   │   ├── TrajectoryRenderer.cs # plays back received trajectory
│   │   │   ├── PlayerVisual.cs      # HP bar, weapon mount, hit reactions
│   │   │   └── HitFX.cs             # impact particle pool spawn
│   │   ├── Weapons/
│   │   │   ├── WeaponData.cs        # plain DTO matching server schema
│   │   │   ├── WeaponPrefabRegistry.cs # slug → GameObject prefab map
│   │   │   └── WeaponHueApplier.cs  # apply visual.hue to materials at runtime
│   │   ├── UI/
│   │   │   ├── LobbyPanel.cs        # weapon pick list + ready button
│   │   │   ├── HudPanel.cs          # HP bars + turn timer
│   │   │   ├── TurnInputPanel.cs    # drag-aim overlay + power gauge
│   │   │   └── ResultPanel.cs       # win/lose embed + replay button
│   │   ├── Events/
│   │   │   └── ArenaEvents.cs       # struct event definitions
│   │   ├── Dev/
│   │   │   └── ManualRoomConnect.cs # Editor-only test connector
│   │   └── Util/
│   │       └── UrlQuery.cs          # parse ?t=<token> from WebGL URL
│   ├── Prefabs/
│   │   ├── Weapons/                  # 1 prefab per weapon slug
│   │   ├── FX/
│   │   │   ├── fx_wall_bounce.prefab
│   │   │   ├── fx_hit_impact.prefab
│   │   │   ├── fx_crit_burst.prefab
│   │   │   └── fx_pierce_arc.prefab
│   │   └── UI/
│   │       └── LobbyPanel.uxml
│   ├── Materials/
│   │   ├── Cartoon_Lit.mat
│   │   └── Trail_Stylize.mat
│   ├── Shaders/
│   │   ├── CartoonLit.shader        # HLSL custom (§11)
│   │   ├── OutlineFresnel.shader
│   │   ├── TrajectoryArc.shader
│   │   ├── HueShift.shader
│   │   └── ImpactFlash.shader
│   ├── Resources/
│   │   ├── Prefabs/
│   │   │   └── Weapons/...           # Pool-loadable copies
│   │   └── Audio/
│   │       ├── SFX/
│   │       └── Music/
│   └── Settings/
│       ├── URP-Renderer.asset
│       └── PoolKeys.cs               # `static class PoolKeys { const string HIT_FX = ...; }`
└── ColyseusSDK/                      # from package manager
```

---

## 2. Boot sequence (BillGameCore-flavoured)

### 2.1 — `GameBootstrap.cs`

```csharp
using UnityEngine;
using BillGameCore;
using RadiantArena.States;
using RadiantArena.Net;

namespace RadiantArena.Bootstrap {
    public class GameBootstrap : MonoBehaviour {
        [SerializeField] BillCoreConfig config;

        async void Awake() {
            // Bill.Init scans config + registers all services. Fires GameReadyEvent on done.
            await Bill.Init(config);

            RegisterStates();
            RegisterPools();
            RegisterEvents();

            Bill.State.GoTo<BootState>();
        }

        void RegisterStates() {
            Bill.State.AddState<BootState>();
            Bill.State.AddState<ConnectingState>();
            Bill.State.AddState<LobbyState>();
            Bill.State.AddState<CountdownState>();
            Bill.State.AddState<MyTurnState>();
            Bill.State.AddState<OpponentTurnState>();
            Bill.State.AddState<AnimatingState>();
            Bill.State.AddState<EndState>();
        }

        void RegisterPools() {
            // FX pools — pre-warm 8 each to avoid first-shot hitch
            Bill.Pool.Register("fx_wall_bounce",
                Resources.Load<GameObject>("Prefabs/FX/fx_wall_bounce"), warmCount: 8);
            Bill.Pool.Register("fx_hit_impact",
                Resources.Load<GameObject>("Prefabs/FX/fx_hit_impact"), warmCount: 8);
            Bill.Pool.Register("fx_crit_burst",
                Resources.Load<GameObject>("Prefabs/FX/fx_crit_burst"), warmCount: 4);
            Bill.Pool.Register("fx_pierce_arc",
                Resources.Load<GameObject>("Prefabs/FX/fx_pierce_arc"), warmCount: 4);
            Bill.Pool.Register("dmg_number",
                Resources.Load<GameObject>("Prefabs/UI/DamageNumber"), warmCount: 12);
            Bill.Pool.Register("trajectory_dot",
                Resources.Load<GameObject>("Prefabs/FX/TrajectoryDot"), warmCount: 200);
        }

        void RegisterEvents() {
            Bill.Events.Subscribe<NetConnectedEvent>(OnNetConnected);
            Bill.Events.Subscribe<NetDisconnectedEvent>(OnNetDisconnected);
        }

        void OnNetConnected(NetConnectedEvent _) {
            Bill.State.GoTo<LobbyState>();
        }

        void OnNetDisconnected(NetDisconnectedEvent _) {
            Bill.State.GoTo<EndState>(); // or show reconnect UI
        }
    }
}
```

### 2.2 — Boot state

```csharp
public class BootState : GameState {
    public override void Enter() {
        // Parse URL token (WebGL: ?t=<token>&room=<id>)
        var (roomId, token, wsUrl) = UrlQuery.ParseArenaUrl();
        if (string.IsNullOrEmpty(token)) {
            Bill.UI.Open<ErrorPanel>(p => p.SetMessage("Thiếu token đăng nhập."));
            return;
        }
        ArenaContext.PendingConnection = new ConnectionInfo {
            RoomId = roomId, Token = token, WsUrl = wsUrl,
        };
        Bill.State.GoTo<ConnectingState>();
    }
}

public class ConnectingState : GameState {
    public override async void Enter() {
        Bill.UI.Open<ConnectingPanel>();
        var nc = Object.FindObjectOfType<NetClient>();
        var ok = await nc.Connect(ArenaContext.PendingConnection);
        if (!ok) {
            Bill.UI.Open<ErrorPanel>(p => p.SetMessage("Không kết nối được sân đấu."));
            return;
        }
        // OnConnected → Bill.Events.Fire(NetConnectedEvent) handled by bootstrap → goes to LobbyState
    }
    public override void Exit() => Bill.UI.Close<ConnectingPanel>();
}
```

---

## 3. NetClient — the only thing that touches Colyseus

### 3.1 — Purpose

`NetClient.cs` is the ONLY MonoBehaviour that talks to Colyseus SDK directly. Everything else reads `ArenaContext` (static singleton snapshot) and fires/subscribes `Bill.Events`. This isolates SDK churn — if you swap Colyseus for SpacetimeDB in 6 months, only NetClient changes.

### 3.2 — Skeleton

```csharp
using System.Threading.Tasks;
using UnityEngine;
using Colyseus;
using BillGameCore;
using RadiantArena.Events;

namespace RadiantArena.Net {
    public class NetClient : MonoBehaviour {
        ColyseusClient client;
        ColyseusRoom<DuelState> room;

        public async Task<bool> Connect(ConnectionInfo info) {
            try {
                client = new ColyseusClient(info.WsUrl);
                room = await client.JoinById<DuelState>(
                    info.RoomId,
                    new Dictionary<string, object> { ["token"] = info.Token });
                WireRoomEvents();
                Bill.Events.Fire(new NetConnectedEvent());
                return true;
            } catch (System.Exception ex) {
                Debug.LogError($"NetClient.Connect failed: {ex.Message}");
                return false;
            }
        }

        void WireRoomEvents() {
            // State sync — fires every state change (1 schema diff)
            room.OnStateChange += OnStateChange;

            // Discrete messages
            room.OnMessage<MatchStartMsg>("match_start", OnMatchStart);
            room.OnMessage<ShotResolvedMsg>("shot_resolved", OnShotResolved);
            room.OnMessage<TurnSwitchedMsg>("turn_switched", OnTurnSwitched);
            room.OnMessage<SignatureUsedMsg>("signature_used", OnSignatureUsed);
            room.OnMessage<MatchEndedMsg>("match_ended", OnMatchEnded);

            room.OnLeave += OnLeave;
        }

        void OnStateChange(DuelState state, bool isFirstState) {
            if (isFirstState) {
                ArenaContext.HydrateFromState(state);
            }
            // Phase change
            if (state.phase != ArenaContext.CurrentPhase) {
                var old = ArenaContext.CurrentPhase;
                ArenaContext.CurrentPhase = state.phase;
                Bill.Events.Fire(new MatchPhaseChangedEvent {
                    OldPhase = old, NewPhase = state.phase,
                });
            }
            // HP change per player → fire individual events
            foreach (var kvp in state.players) {
                var prev = ArenaContext.LastKnownHp.TryGetValue(kvp.Key, out var v) ? v : kvp.Value.hp_max;
                if (prev != kvp.Value.hp) {
                    Bill.Events.Fire(new HpChangedEvent {
                        PlayerId = kvp.Key,
                        HpOld = prev,
                        HpNew = kvp.Value.hp,
                        HpMax = kvp.Value.hp_max,
                    });
                    ArenaContext.LastKnownHp[kvp.Key] = kvp.Value.hp;
                }
            }
        }

        void OnMatchStart(MatchStartMsg m) {
            Bill.Events.Fire(new MatchStartedEvent { FirstTurnId = m.first_turn_id });
        }

        void OnShotResolved(ShotResolvedMsg m) {
            Bill.Events.Fire(new TrajectoryReceivedEvent {
                Points = m.trajectory,
                ShooterId = m.shooter,
                DamageDealt = m.damage_dealt,
            });
        }

        void OnTurnSwitched(TurnSwitchedMsg m) {
            Bill.Events.Fire(new TurnSwitchedEvent {
                NewTurnId = m.new_turn_id,
                DeadlineAt = m.deadline_at,
            });
        }

        void OnSignatureUsed(SignatureUsedMsg m) {
            Bill.Events.Fire(new SignatureUsedEvent {
                PlayerId = m.player_id, SkillId = m.effect_id,
            });
        }

        void OnMatchEnded(MatchEndedMsg m) {
            Bill.Events.Fire(new MatchEndedEvent {
                WinnerId = m.winner, Outcome = m.outcome,
            });
        }

        void OnLeave(int code) {
            Bill.Events.Fire(new NetDisconnectedEvent { Code = code });
        }

        // Outbound — called from State classes
        public void Send(string type, object payload) {
            if (room == null) return;
            room.Send(type, payload);
        }

#if UNITY_EDITOR
        // Dev helper — called by ManualRoomConnect.cs
        public void ManualConnect(string wsUrl, string roomId, string token) {
            _ = Connect(new ConnectionInfo { WsUrl = wsUrl, RoomId = roomId, Token = token });
        }
#endif
    }
}
```

### 3.3 — Message DTOs (`NetMessageTypes.cs`)

```csharp
[System.Serializable] public class MatchStartMsg { public string first_turn_id; }
[System.Serializable] public class ShotResolvedMsg {
    public TrajectoryPointDto[] trajectory;
    public string shooter;
    public int damage_dealt;
}
[System.Serializable] public class TrajectoryPointDto {
    public int t; public float x; public float y; public string @event;
}
[System.Serializable] public class TurnSwitchedMsg {
    public string new_turn_id; public long deadline_at;
}
[System.Serializable] public class SignatureUsedMsg { public string player_id, effect_id; }
[System.Serializable] public class MatchEndedMsg { public string winner, outcome; }
```

---

## 4. ArenaContext — single-source snapshot

```csharp
namespace RadiantArena {
    public static class ArenaContext {
        public static ConnectionInfo PendingConnection;
        public static string MyDiscordId;
        public static string OpponentDiscordId;
        public static string CurrentPhase = "";
        public static int Stake;
        public static int Round;
        public static long TurnDeadlineAt;
        public static string TurnPlayerId;
        public static Dictionary<string, int> LastKnownHp = new();
        public static Dictionary<string, WeaponData> WeaponsByPlayerId = new();

        public static void HydrateFromState(DuelState s) {
            // First-state population. MyDiscordId comes from JWT decode of own token.
            Round = s.round;
            CurrentPhase = s.phase;
            Stake = s.stake;
            foreach (var kvp in s.players) {
                LastKnownHp[kvp.Key] = kvp.Value.hp;
                WeaponsByPlayerId[kvp.Key] = WeaponData.FromSchema(kvp.Value.weapon);
                if (kvp.Key == MyDiscordId)
                    LastKnownHp[kvp.Key] = kvp.Value.hp;
                else
                    OpponentDiscordId = kvp.Key;
            }
        }

        public static WeaponData MyWeapon =>
            WeaponsByPlayerId.TryGetValue(MyDiscordId, out var w) ? w : null;
        public static WeaponData OpponentWeapon =>
            WeaponsByPlayerId.TryGetValue(OpponentDiscordId, out var w) ? w : null;
        public static bool IsMyTurn => TurnPlayerId == MyDiscordId;
    }
}
```

---

## 5. Weapon system — server-driven lobby

### 5.1 — Rule (user explicitly requested)

> "data info thì sẽ cần match id từ colyseus qua data, loại nào có id mới hiện lên và chọn, sau đó bấm ready mới chơi"

**Implementation:**

1. Bot's `/arena duel` (Lát D) đọc weapons từ `userWeapons` query của 2 player.
2. Bot send danh sách weapons available của EACH player vào create-room body — server hydrates → state.
3. LobbyState fires `LobbyOpenedEvent` containing weapons available cho player.
4. LobbyPanel renders ONLY those weapons. Player picks → `pick_weapon` message to server.
5. Server validates pick is in roster, sets `player.weapon = selected`. Re-broadcast state.
6. When both players have `weapon` set AND `ready=true` → countdown starts.

### 5.2 — Server-side extension needed (note for Colyseus dev)

Currently Lát A bot passes a SINGLE weapon per player (the equipped one). For the "pick from owned list" UX, bot needs to send the full owned list:

```typescript
// bot side (Lát D) — extend CreateRoomRequest:
players: [{
  discord_id, display_name, token,
  available_weapons: WeaponData[],  // NEW — full owned list
  pre_selected_slug?: string,        // default to equipped
}]
```

Server stores available_weapons in PlayerSchema as `ArraySchema<WeaponSchema>` named `available_weapons`. Client reads → renders lobby.

### 5.3 — `WeaponData.cs`

```csharp
[System.Serializable]
public class WeaponData {
    public string slug;
    public string display_name;
    public string category;     // 'blunt' | 'pierce' | 'spirit'
    public string tier;
    public WeaponStats stats;
    public WeaponVisual visual;
    public string[] skill_ids;

    public static WeaponData FromSchema(WeaponSchema s) {
        return new WeaponData {
            slug = s.slug,
            display_name = s.display_name,
            category = s.category,
            tier = s.tier,
            stats = new WeaponStats { /* copy fields */ },
            visual = new WeaponVisual { /* copy fields */ },
        };
    }
}
[System.Serializable] public class WeaponStats {
    public float power, hitbox, bounce, damage_base, crit_chance, crit_multi;
    public int pierce_count;
}
[System.Serializable] public class WeaponVisual {
    public string model_prefab_key, particle_fx_key, trail_fx_key, hue;
}
```

### 5.4 — `WeaponPrefabRegistry.cs`

```csharp
public static class WeaponPrefabRegistry {
    static readonly Dictionary<string, GameObject> cache = new();

    public static GameObject Get(string modelKey) {
        if (cache.TryGetValue(modelKey, out var go)) return go;
        var prefab = Resources.Load<GameObject>($"Prefabs/Weapons/{modelKey}");
        if (prefab == null) {
            Debug.LogWarning($"Weapon prefab not found: {modelKey} — falling back to placeholder");
            prefab = Resources.Load<GameObject>("Prefabs/Weapons/_placeholder");
        }
        cache[modelKey] = prefab;
        return prefab;
    }
}
```

When a weapon slug is unknown on client side (catalog updated server-side but Unity build is older), `_placeholder` prefab handles graceful degradation — match still runs, just with a grey sphere instead of pretty mesh.

### 5.5 — LobbyPanel rules

```csharp
public class LobbyPanel : BasePanel {
    VisualElement root;
    Button readyButton;
    ListView weaponList;
    Label opponentStatus;

    public override void OnOpen() {
        Bill.Events.Subscribe<MatchPhaseChangedEvent>(OnPhaseChanged);
        Bill.Events.Subscribe<LobbyWeaponsReceivedEvent>(OnWeapons);

        // Build UI from available_weapons in state
        var weapons = ArenaContext.AvailableWeaponsForMe;
        weaponList.itemsSource = weapons;
        weaponList.makeItem = MakeWeaponItem;
        weaponList.bindItem = BindWeaponItem;

        readyButton.clicked += OnReadyClick;
    }

    void OnReadyClick() {
        if (string.IsNullOrEmpty(ArenaContext.PickedWeaponSlug)) {
            ShowToast("Chọn pháp khí trước đã.");
            return;
        }
        var nc = Object.FindObjectOfType<NetClient>();
        nc.Send("pick_weapon", new { slug = ArenaContext.PickedWeaponSlug });
        nc.Send("ready", new { });
        readyButton.SetEnabled(false);
        readyButton.text = "Đã sẵn sàng ✓";
    }
}
```

---

## 6. State classes — turn loop

### 6.1 — `LobbyState`

```csharp
public class LobbyState : GameState {
    public override void Enter() {
        Bill.UI.Open<LobbyPanel>();
        Bill.Audio.PlayMusic("bgm_lobby", fadeDuration: 1f);
        Bill.Events.Subscribe<MatchPhaseChangedEvent>(OnPhase);
    }
    public override void Exit() {
        Bill.UI.Close<LobbyPanel>();
        Bill.Events.Unsubscribe<MatchPhaseChangedEvent>(OnPhase);
    }
    void OnPhase(MatchPhaseChangedEvent e) {
        if (e.NewPhase == "countdown") Bill.State.GoTo<CountdownState>();
    }
}
```

### 6.2 — `CountdownState`

```csharp
public class CountdownState : GameState {
    public override void Enter() {
        Bill.UI.Open<CountdownPanel>(p => p.Begin(3));
        Bill.Audio.Play("sfx_countdown_tick");
        Bill.Timer.Delay(3f, () => {
            Bill.Audio.Play("sfx_match_start");
            // Server flips state.phase to 'active' after countdown — MyTurnState
            // or OpponentTurnState entered via MatchStartedEvent.
        });
        Bill.Events.Subscribe<MatchStartedEvent>(OnStart);
    }
    public override void Exit() {
        Bill.UI.Close<CountdownPanel>();
        Bill.Events.Unsubscribe<MatchStartedEvent>(OnStart);
    }
    void OnStart(MatchStartedEvent e) {
        if (e.FirstTurnId == ArenaContext.MyDiscordId) Bill.State.GoTo<MyTurnState>();
        else Bill.State.GoTo<OpponentTurnState>();
    }
}
```

### 6.3 — `MyTurnState`

```csharp
public class MyTurnState : GameState {
    TurnInputPanel panel;
    public override void Enter() {
        Bill.UI.Open<TurnInputPanel>(p => {
            panel = p;
            p.SetWeapon(ArenaContext.MyWeapon);
            p.OnShotReleased += OnShotReleased;
            p.StartTimer(ArenaContext.TurnDeadlineAt);
        });
        Bill.Audio.Play("sfx_your_turn");
        Bill.Events.Subscribe<TrajectoryReceivedEvent>(OnTrajectory);
    }
    public override void Exit() {
        Bill.UI.Close<TurnInputPanel>();
        Bill.Events.Unsubscribe<TrajectoryReceivedEvent>(OnTrajectory);
        if (panel != null) panel.OnShotReleased -= OnShotReleased;
    }
    void OnShotReleased(float angle, float power) {
        Object.FindObjectOfType<NetClient>().Send("shoot", new { angle, power });
        Bill.Audio.Play("sfx_swing_release");
        // Go to AnimatingState only after server confirms via shot_resolved
    }
    void OnTrajectory(TrajectoryReceivedEvent e) {
        if (e.ShooterId == ArenaContext.MyDiscordId)
            Bill.State.GoTo<AnimatingState>();
    }
}
```

### 6.4 — `AnimatingState`

```csharp
public class AnimatingState : GameState {
    TrajectoryReceivedEvent shot;
    int round;

    public override void Enter() {
        Bill.Events.Subscribe<TrajectoryReceivedEvent>(OnReceived);
        // Already received via state-transition trigger — replay immediately
        if (ArenaContext.LastTrajectory != null) Play(ArenaContext.LastTrajectory);
    }

    void OnReceived(TrajectoryReceivedEvent e) {
        Play(e);
    }

    async void Play(TrajectoryReceivedEvent e) {
        round = ArenaContext.Round;
        var renderer = Object.FindObjectOfType<TrajectoryRenderer>();
        await renderer.Play(e.Points, e.ShooterId, e.DamageDealt);
        Object.FindObjectOfType<NetClient>().Send("animation_complete", new { round });
        // Server fires turn_switched or match_ended → relevant state takes over
    }

    public override void Exit() => Bill.Events.Unsubscribe<TrajectoryReceivedEvent>(OnReceived);
}
```

### 6.5 — `EndState`

```csharp
public class EndState : GameState {
    public override void Enter() {
        Bill.UI.Open<ResultPanel>(p => {
            p.SetOutcome(ArenaContext.LastOutcome, ArenaContext.LastWinnerId);
            p.OnReplayClicked += () => Bill.Scene.Load("ArenaScene", TransitionType.Fade);
        });
        Bill.Audio.PlayMusic(
            ArenaContext.LastWinnerId == ArenaContext.MyDiscordId
                ? "bgm_victory" : "bgm_defeat",
            fadeDuration: 1.5f);
    }
    public override void Exit() => Bill.UI.Close<ResultPanel>();
}
```

---

## 7. Drag-aim mechanic (the core gameplay)

### 7.1 — Input feel

Player drags FROM weapon position (own slot anchor), away from target. The further they drag, the more power (capped at max-drag-distance). Release fires shot.

This is the **Worms/Angry Birds slingshot** archetype. Familiar, immediately readable.

### 7.2 — `TurnInputPanel.cs` core logic

```csharp
public class TurnInputPanel : BasePanel {
    [SerializeField] LineRenderer aimLine;
    [SerializeField] float maxDragWorldUnits = 200f;
    [SerializeField] Vector3 myWeaponWorldPos;

    bool dragging;
    Vector3 dragStart, dragCurrent;
    Camera cam;

    public System.Action<float, float> OnShotReleased;

    public override void OnOpen() {
        cam = Camera.main;
        aimLine.enabled = false;
    }

    void Update() {
        if (Input.GetMouseButtonDown(0)) BeginDrag();
        if (dragging) {
            UpdateDrag();
            if (Input.GetMouseButtonUp(0)) ReleaseDrag();
        }
    }

    void BeginDrag() {
        dragStart = cam.ScreenToWorldPoint(new Vector3(Input.mousePosition.x, Input.mousePosition.y, 10f));
        dragging = true;
        aimLine.enabled = true;
        Bill.Audio.Play("sfx_aim_charge_start");
    }

    void UpdateDrag() {
        dragCurrent = cam.ScreenToWorldPoint(new Vector3(Input.mousePosition.x, Input.mousePosition.y, 10f));
        var raw = dragStart - dragCurrent; // shot fires opposite to drag direction
        var dist = Mathf.Min(raw.magnitude, maxDragWorldUnits);
        var dir = raw.normalized;
        var endPos = myWeaponWorldPos + dir * dist;
        aimLine.SetPosition(0, myWeaponWorldPos);
        aimLine.SetPosition(1, endPos);
        var power = dist / maxDragWorldUnits;
        // Update power gauge UI
        Bill.Events.Fire(new AimUpdatedEvent { Power = power, Angle = Mathf.Atan2(dir.y, dir.x) });
    }

    void ReleaseDrag() {
        dragging = false;
        aimLine.enabled = false;
        var raw = dragStart - dragCurrent;
        var dist = Mathf.Min(raw.magnitude, maxDragWorldUnits);
        var power = dist / maxDragWorldUnits;
        if (power < 0.1f) return; // dead-zone — accidental tap
        var angle = Mathf.Atan2(raw.normalized.y, raw.normalized.x);
        OnShotReleased?.Invoke(angle, power);
        Bill.Audio.Play("sfx_aim_release");
    }

    public void StartTimer(long deadlineAtMs) {
        var secs = Mathf.Max(0, (int)((deadlineAtMs - System.DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()) / 1000));
        // UI element shows countdown — use Bill.Timer.Repeat(1, tick)
        timerHandle = Bill.Timer.Repeat(1f, () => {
            secs--;
            timerLabel.text = $"{secs}s";
            if (secs <= 5) Bill.Audio.Play("sfx_timer_tick_warning");
            if (secs <= 0) {
                timerHandle.Cancel();
                // Server auto-skips, no-op client side
            }
        });
    }
}
```

### 7.3 — Aim line visual (HLSL shader — see §11)

`aimLine` is a `LineRenderer` with `TrajectoryArc.shader` material that pulses dotted dashes. Bright accent color when power=1.0, faded when low.

---

## 8. Trajectory playback — the "juicy" part

### 8.1 — Spec

When `TrajectoryReceivedEvent` fires:
1. Camera dollies to follow projectile (Cinemachine ImpulseSource pulses on each wall_bounce).
2. Spawn `trajectory_dot` from Bill.Pool along the path with fade-out trail.
3. On `wall_bounce`: pool spawn `fx_wall_bounce` particle + screen shake (Bill.Tween camera).
4. On `hit:<dmg>` or `crit:<dmg>`:
   - Spawn `fx_hit_impact` (or `fx_crit_burst` if crit).
   - Spawn `dmg_number` floating up from hit point.
   - Bill.Audio.Play `sfx_hit` (or `sfx_crit`).
   - Time slow 0.15x for 200ms (Bill.Timer to restore).
   - Camera shake 0.4 intensity.
5. On `pierce_player:<id>`: slow-mo 0.3x for 400ms + `fx_pierce_arc` from entry to exit.
6. On `stop`: settle puff + return to neutral camera over 500ms.

### 8.2 — `TrajectoryRenderer.cs`

```csharp
public class TrajectoryRenderer : MonoBehaviour {
    [SerializeField] Transform projectileVisual;
    [SerializeField] AnimationCurve dampingCurve;

    public async Task Play(TrajectoryPointDto[] points, string shooterId, int dmgDealt) {
        if (points == null || points.Length == 0) return;
        Bill.Audio.Play("sfx_projectile_woosh", projectileVisual.position);
        var shooterPos = SlotAnchor(shooterId);
        projectileVisual.position = shooterPos;
        projectileVisual.gameObject.SetActive(true);

        long startMs = points[0].t;
        long lastMs = startMs;

        // Animate through points by their .t timestamps (relative ms)
        foreach (var pt in points) {
            var waitMs = pt.t - lastMs;
            if (waitMs > 0) await Task.Delay(System.Math.Max(1, waitMs));
            lastMs = pt.t;

            projectileVisual.position = new Vector3(pt.x, pt.y, 0);
            Bill.Pool.Spawn("trajectory_dot", projectileVisual.position, Quaternion.identity)
                .GetComponent<TrajectoryDot>().Init(0.3f);

            HandleEvent(pt);
        }

        projectileVisual.gameObject.SetActive(false);
        if (dmgDealt > 0) SpawnBigDamageNumber(dmgDealt);
    }

    void HandleEvent(TrajectoryPointDto pt) {
        if (string.IsNullOrEmpty(pt.@event) || pt.@event == "") return;

        var pos = new Vector3(pt.x, pt.y, 0);
        if (pt.@event == "wall_bounce") {
            Bill.Pool.Spawn("fx_wall_bounce", pos, Quaternion.identity);
            Bill.Audio.Play("sfx_wall_bounce", pos);
            CameraShake(0.2f, 0.1f);
            return;
        }
        if (pt.@event == "stop") {
            Bill.Pool.Spawn("fx_settle_puff", pos, Quaternion.identity);
            return;
        }
        if (pt.@event.StartsWith("hit:")) {
            int dmg = int.Parse(pt.@event.Substring(4));
            OnHit(pos, dmg, isCrit: false);
            return;
        }
        if (pt.@event.StartsWith("crit:")) {
            int dmg = int.Parse(pt.@event.Substring(5));
            OnHit(pos, dmg, isCrit: true);
            return;
        }
        if (pt.@event.StartsWith("pierce_player:")) {
            Bill.Pool.Spawn("fx_pierce_arc", pos, Quaternion.identity);
            Bill.Audio.Play("sfx_pierce", pos);
            TimeSlow(0.3f, 400);
            return;
        }
    }

    void OnHit(Vector3 pos, int dmg, bool isCrit) {
        var fx = isCrit ? "fx_crit_burst" : "fx_hit_impact";
        Bill.Pool.Spawn(fx, pos, Quaternion.identity);
        Bill.Audio.Play(isCrit ? "sfx_crit_hit" : "sfx_hit", pos);

        // Damage number popup
        var num = Bill.Pool.Spawn("dmg_number", pos + Vector3.up * 30f, Quaternion.identity);
        num.GetComponent<DamageNumber>().Init(dmg, isCrit);

        CameraShake(isCrit ? 0.6f : 0.3f, isCrit ? 0.2f : 0.1f);
        TimeSlow(isCrit ? 0.15f : 0.3f, isCrit ? 250 : 150);
        Bill.Events.Fire(new PlayerHitEvent {
            VictimId = ArenaContext.OpponentDiscordId,
            Damage = dmg, IsCrit = isCrit, HitPoint = pos,
        });
    }

    void CameraShake(float intensity, float duration) {
        // Cinemachine ImpulseSource → 1 line
        var impulseSrc = Camera.main.GetComponent<Unity.Cinemachine.CinemachineImpulseSource>();
        impulseSrc.GenerateImpulse(Vector3.one * intensity);
    }

    void TimeSlow(float scale, int durationMs) {
        Time.timeScale = scale;
        Bill.Timer.Delay(durationMs / 1000f, () => Time.timeScale = 1f);
    }

    Vector3 SlotAnchor(string discordId) {
        // Cached lookup — bootstrap stores PlayerASlot / PlayerBSlot transforms
        return ArenaContext.SlotAnchors.TryGetValue(discordId, out var pos) ? pos : Vector3.zero;
    }

    void SpawnBigDamageNumber(int total) {
        // Center-screen big total damage popup
    }
}
```

---

## 9. UI Toolkit panels

### 9.1 — Why UI Toolkit (not uGUI)

- BillGameCore IUIService designed for UIDocument workflow.
- HTML/CSS-like syntax (UXML + USS) — easier to theme for cartoon vibe.
- Better runtime performance for static panels.

### 9.2 — `LobbyPanel.uxml`

```xml
<UXML xmlns="UnityEngine.UIElements">
    <Box class="lobby-root">
        <Label text="Đấu Trường Pháp Khí" class="lobby-title" />
        <Label class="lobby-subtitle" text="Chọn pháp khí và sẵn sàng" />

        <Box class="weapon-grid">
            <ListView name="weaponList" />
        </Box>

        <Box class="weapon-detail">
            <Label name="weaponName" />
            <Label name="weaponLore" class="lore" />
            <Box class="stats-row">
                <Label name="statPower" />
                <Label name="statHitbox" />
                <Label name="statDamage" />
                <Label name="statCrit" />
            </Box>
        </Box>

        <Box class="footer">
            <Label name="opponentStatus" text="Đối thủ chưa sẵn sàng…" />
            <Button name="readyButton" text="Sẵn sàng" class="primary-btn" />
        </Box>
    </Box>
</UXML>
```

### 9.3 — `lobby.uss` (theme stub)

```css
.lobby-root {
    flex-direction: column;
    align-items: center;
    background-color: rgba(20, 20, 40, 0.9);
    padding: 32px;
}
.lobby-title {
    font-size: 48px;
    color: #f5e8ff;
    -unity-font-style: bold;
}
.primary-btn {
    background-color: #c9a455;
    color: #1a1428;
    padding: 12px 24px;
    border-radius: 8px;
    transition: scale 100ms;
}
.primary-btn:hover { scale: 1.05 1.05; }
.primary-btn:active { scale: 0.98 0.98; }
```

---

## 10. Game design — making it feel good

### 10.1 — Juicy checklist (per shot)

- [ ] Pre-shot: drag intensifies → power gauge pulses, weapon tilts
- [ ] Release: weapon swings forward, anticipation pop (Bill.Tween scale 1.2 → 1.0 over 80ms)
- [ ] Mid-flight: projectile rotates, trail leaves stylized dots (HLSL shader)
- [ ] Wall bounce: spark particles + camera shake 0.2 + audio pop
- [ ] Hit: time slow + camera shake + damage number popup + audio + screen color flash
- [ ] Crit: time slow LONGER + bigger camera shake + golden tint + slow-mo zoom-in
- [ ] Pierce: slow-mo through entire pierce sequence
- [ ] Death (HP=0): time slow 0.2x for 1s + camera dolly-zoom on victim + 2s pause before result panel

### 10.2 — Audio design

| Event | Sound | Layers |
|---|---|---|
| `match_start` | Sect bell + ambient drum | thiên-đạo theme |
| `aim_charge_start` | String tension build | continuous loop while dragging |
| `aim_release` | Wind whoosh | one-shot |
| `wall_bounce` | Wood-clack + flute pop | spatial |
| `hit` | Body-thud + harmonic ring | spatial |
| `crit` | Thunder crack + chime sustain | spatial + screen-wide |
| `pierce` | Cloth tear + breath gasp | spatial |
| `victory` | Tribulation choir + bell sustain | full-screen |
| `defeat` | Low ink-brush + somber flute | full-screen |

All assets in `Assets/Mythfall/Resources/Audio/` (auto-loaded by Bill.Audio).

### 10.3 — Camera

Cinemachine setup:
- **CM_Lobby**: orthographic, fixed framing on both slots.
- **CM_Combat**: orthographic, default position, slight 5° tilt for depth.
- **CM_Projectile**: damped follow on projectile (active during animating, blends out).
- **CM_Hit**: dolly-in on hit point, FOV punch (Cinemachine FollowZoom for ortho fake).
- **CM_End**: orbit slowly around victor (cinematic).

Blend times 0.3-0.8s. Smooth, not snappy.

### 10.4 — Color grading

URP global volume profile:
- **LiftGammaGain**: lift slight purple (cosmic theme), gain slight gold
- **Bloom**: threshold 0.9, intensity 0.6 — keeps stylize, no hyper-real glow
- **VignetteEffect**: 0.2 — focus on center action
- **Color adjustments**: saturation 1.15 — readable cartoon palette

On crit: temporarily push saturation 1.5 + vignette 0.5 for 250ms (Bill.Tween).

### 10.5 — Pacing

Match length target: **3-5 minutes** average. HP 100, damage 20-40 per hit → 3-5 hits to KO. Each turn ~10-25s. So 4 hits each, 8 turns total, ~3 min.

If matches feel too long after physics tuning, reduce HP_max in server config (not in client).

---

## 11. Shader list — stylize cartoon HLSL (Bill dev later)

Bill chỉ note ở đây, dev sau. Tất cả HLSL, URP-compatible (use `UnityCG.cginc` + URP `Lighting.hlsl`).

### 11.1 — Required shaders

| Shader | Path | Purpose | Key features |
|---|---|---|---|
| **CartoonLit.shader** | Shaders/CartoonLit | Default mesh shader for weapons + players | Step-shaded (3 bands), rim light, hue-shift uniform, soft edge AO fake |
| **OutlineFresnel.shader** | Shaders/OutlineFresnel | Outline pass for all gameplay objects | Inverted-hull or screen-space fresnel; 2-3px equiv at 1080p, scales with FOV |
| **TrajectoryArc.shader** | Shaders/TrajectoryArc | Aim line + trail | Dashed UV scrolling, glow falloff, color from `_HueShift` |
| **HueShift.shader** | Shaders/HueShift | Apply weapon.visual.hue at runtime | RGB → HSV, shift H by uniform, recombine |
| **ImpactFlash.shader** | Shaders/ImpactFlash | Screen-space flash on hit/crit | Vignette + chromatic abber + brief invert |
| **InkParticle.shader** | Shaders/InkParticle | Particles for wall bounce, hit FX | Soft mask with noise distortion, ink-bleed look |
| **GroundCellShade.shader** | Shaders/GroundCellShade | Floor tile shader | 2-tone gradient with subtle hex pattern |
| **WeaponEnergyHalo.shader** | Shaders/WeaponEnergyHalo | Aura around thiên/tiên-tier weapons | Animated noise, alpha by camera distance |
| **DamageNumberShader.shader** | Shaders/DamageNumberShader | Floating damage number | Outline + drop shadow + size pulse on spawn |
| **VictoryBeam.shader** | Shaders/VictoryBeam | End-state column of light | Soft cone, scrolling stripes, glow halo |

### 11.2 — Style guide (HLSL hints)

```hlsl
// Cartoon step shading example
half NdotL = dot(normalize(input.normalWS), _MainLightDir);
half toon = floor(saturate(NdotL) * 3.0) / 3.0;  // 3 bands
half3 lit = lerp(_ShadowColor.rgb, _LitColor.rgb, toon);

// Rim light
half rim = 1.0 - saturate(dot(normalize(input.normalWS), normalize(_WorldSpaceCameraPos - input.positionWS)));
rim = pow(rim, _RimPower);
lit += rim * _RimColor.rgb * _RimStrength;
```

### 11.3 — URP integration

- All shaders use `Universal Forward` light mode.
- Renderer feature: outline pass via `RenderObjects` injected after opaques.
- Shader Graph fallback acceptable for FX/particle if HLSL bandwidth limited — `CartoonLit` core must be HLSL.

### 11.4 — Asset bundle vs Resources

WebGL build prefers AssetBundles for hot-reload, but Phase 1 keeps it simple with `Resources/`. Migrate to Addressables in Phase 2 when build size matters.

---

## 12. Double-test workflow (CRITICAL — user request)

Same as Colyseus guide §7, expanded for Unity side.

### 12.1 — Setup tree

```
Terminal 1: cd radiant-arena-server && npm run dev          # Colyseus :2567
Terminal 2: cd radiant-bot && npm run dev                   # Bot :3030 (optional)
Editor 1:   Unity Editor (main project)                     # Player A
Editor 2:   Unity Editor (ParrelSync clone)                 # Player B
```

### 12.2 — Install ParrelSync

```
Window → Package Manager → + → Add package from git URL:
https://github.com/VeriorPies/ParrelSync.git?path=/ParrelSync
```

### 12.3 — Create clone

`ParrelSync → Clones Manager → Add new clone` — Unity duplicates project at `radiant-arena-unity-clone1/`. Open it in second Editor (manually via Unity Hub or `ParrelSync → Open in New Editor`).

### 12.4 — Get tokens

```bash
cd radiant-arena-server
npm run smoke
# Output:
# Player A join URL: ws://localhost:2567/duel/<id>?token=<tokenA>
# Player B join URL: ws://localhost:2567/duel/<id>?token=<tokenB>
```

### 12.5 — Connect Editor instances

In each Editor:
1. Open `ArenaScene`.
2. Select GameObject with `ManualRoomConnect` component (Editor-only).
3. Paste:
   - WS URL: `ws://localhost:2567`
   - Room ID: `<id>` (from smoke output)
   - Token: `<tokenA>` for Editor 1, `<tokenB>` for Editor 2
4. Enter Play mode.
5. Right-click `ManualRoomConnect` → "Connect".

If both clients connect, `state.phase` flips to `lobby` and `LobbyPanel` opens on both. Pick weapon → Ready → countdown → play.

### 12.6 — Common issues

| Symptom | Likely cause | Fix |
|---|---|---|
| `WebSocket connection failed` | Colyseus not running, or wrong port | `npm run dev` server, check port 2567 free |
| `Auth failed: invalid token` | `ARENA_TOKEN_SECRET` mismatch | Server + bot + smoke script must use identical string |
| `Auth failed: session mismatch` | Re-ran smoke; old token, new session | Re-run smoke, copy fresh URLs |
| Player B joins but doesn't see Player A | First-state schema diff timing | `ArenaContext.HydrateFromState` must run on `OnStateChange isFirstState` — verify NetClient |
| Shot fires but no animation | `shot_resolved` message handler missing in NetClient | Check `room.OnMessage<>` registrations |
| Animation plays but state stuck | `animation_complete` not sent | Verify `TrajectoryRenderer.Play` awaits to completion then calls Send |

### 12.7 — Unit tests (Unity Test Framework)

```csharp
// Tests/Editor/TrajectoryRendererTests.cs
[Test]
public void HandleEvent_HitParsesDamage() {
    var renderer = new GameObject().AddComponent<TrajectoryRenderer>();
    var pt = new TrajectoryPointDto { x = 100, y = 0, @event = "hit:25" };
    // Assert dmg number spawned, sfx triggered, no exceptions
}

[Test]
public void HandleEvent_CritParsesDamage() { /* similar */ }

[Test]
public void DragPower_ClampsAtMax() {
    var panel = new GameObject().AddComponent<TurnInputPanel>();
    // Simulate drag of 999 units, expect power == 1.0
}
```

Run: `Window → General → Test Runner → EditMode → Run All`.

---

## 13. Build + deploy

### 13.1 — WebGL build settings

`File → Build Settings → WebGL`:
- Target: WebGL
- Compression: Brotli (smaller files, supported on Cloudflare Pages)
- Code Optimization: Speed
- Strip Engine Code: yes
- Managed Stripping Level: High

`Player Settings`:
- Resolution: 1280×720 default, full-screen toggle yes
- WebGL Template: Default
- Memory Size: 256 MB (tune up if `OOM` errors)

### 13.2 — Cloudflare Pages

```bash
cd radiant-arena-unity
# Unity builds to Builds/WebGL/
# Move to a clean wrangler-friendly structure:
mkdir -p ../arena-cf/public
cp -r Builds/WebGL/* ../arena-cf/public/

cd ../arena-cf
npx wrangler pages publish public --project-name=radiant-arena
```

Set `arena.billthedev.com` → Pages project in Cloudflare DNS.

### 13.3 — Bot DM URL format

Bot's `/arena duel` (Lát D) DMs each player:

```
🗡️ Bước vào sân đấu:
https://arena.billthedev.com/?room=<roomId>&t=<token>
```

`UrlQuery.cs` parses these params on `BootState`.

### 13.4 — OG card

Add to `index.html` (Unity WebGL template):

```html
<meta property="og:title" content="Radiant Arena — Duel">
<meta property="og:description" content="Đệ tử nhập sân — pháp khí chọn người.">
<meta property="og:image" content="https://arena.billthedev.com/og-card.png">
```

Discord auto-renders rich preview when bot posts the join URL.

---

## 14. Lát plan (Unity side)

| Lát | Scope | DoD |
|---|---|---|
| D.U1 | Project bootstrap + BillGameCore wired + GameBootstrap.cs | `Bill.IsReady=true` after Init, BootState entered |
| D.U2 | NetClient.cs + Colyseus connect + state hydration | 2 Editor instances connect, both see `state.phase='lobby'` |
| D.U3 | LobbyPanel + weapon pick UI + Ready button | Both players pick + ready → server emits countdown |
| D.U4 | TurnInputPanel + drag-aim mechanic + Send("shoot") | Drag releases fires shot, server confirms |
| D.U5 | TrajectoryRenderer + basic FX (sphere placeholder weapons) | Trajectory plays back smoothly, hits trigger HP change |
| D.U6 | HudPanel HP bars + turn timer + ResultPanel | Match plays end-to-end, win/lose screen shows |
| D.U7 | Juice pass: camera shake, time slow, dmg numbers, audio | "It feels good" — Bill subjective sign-off |
| D.U8 | Weapon prefabs (6 catalog + bản mệnh placeholder) | Each weapon visually distinct (hue + model) |
| D.U9 | Shaders (CartoonLit + OutlineFresnel + TrajectoryArc) | Visual style is cartoon, not default lit |
| D.U10 | WebGL build + Cloudflare Pages deploy | `arena.billthedev.com/?room=...&t=...` loads + plays |

---

## 15. BillGameCore integration cheatsheet

Cross-reference from §2 above:

| Need | Bill.X call | Notes |
|---|---|---|
| Switch game state | `Bill.State.GoTo<MyTurnState>()` | All transitions, never `Application.LoadScene` |
| React to event | `Bill.Events.Subscribe<X>(handler)` in `OnEnable`, unsubscribe in `OnDisable` | Always unsubscribe — leak otherwise |
| Spawn FX | `Bill.Pool.Spawn("fx_hit_impact", pos)` | Pre-register in `GameBootstrap.RegisterPools` |
| Open panel | `Bill.UI.Open<HudPanel>()` | UI Toolkit-backed |
| Play SFX | `Bill.Audio.Play("sfx_hit")` | Auto-loaded from Resources/Audio/SFX |
| Camera shake | Cinemachine `ImpulseSource.GenerateImpulse(...)` | NOT Bill.Tween — Cinemachine handles spatial |
| Time slow | `Time.timeScale = 0.3f; Bill.Timer.Delay(0.2f, () => Time.timeScale = 1f)` | Bill.Timer respects timeScale by default; use `UnscaledDelay` for restore |
| Persistent state | `Bill.Save.Set("arena_prefs", data)` | For local settings only — game state is server-authoritative |
| Read config | `Bill.Config.GetFloat("arena.shake_intensity", 0.4f)` | Tunable balance values |

---

## 16. Don't-do list

❌ **Don't** mutate `room.State` from client. Server state is one-way.
❌ **Don't** simulate physics client-side. Render only.
❌ **Don't** Instantiate prefabs directly. Use Bill.Pool.
❌ **Don't** access `Bill.X` before `Bill.IsReady` — gate with `SubscribeOnce<GameReadyEvent>`.
❌ **Don't** use class events. `IEvent` MUST be `struct` (no GC).
❌ **Don't** ship without ParrelSync double-test passing.
❌ **Don't** hardcode weapon list in UI — read from `state.players[me].available_weapons` only.
❌ **Don't** put trajectory math on client. Server is source of truth.

---

## 17. Reference back to bot

| What client needs | Where bot/server provides |
|---|---|
| `MyDiscordId` | Decoded from token JWT payload before connect (or hardcoded in dev) |
| `available_weapons` | `state.players[me].available_weapons` (ArraySchema from server) — bot fills via Lát D extension |
| Weapon stats | `state.players[*].weapon.stats` — server-authoritative |
| Match outcome / replay URL | Posted by Colyseus to bot's `/api/arena/result` — bot DMs replay URL in #arena |
| HP changes | `state.players[*].hp` schema diff (consumed via `OnStateChange`) |

**Single Discord ID source**: bot signs token containing it. Unity decodes payload (without verify — trust server `onAuth`). DO NOT prompt user for ID; never trust client-claimed identity.

---

*End of Unity Client Guide.*
