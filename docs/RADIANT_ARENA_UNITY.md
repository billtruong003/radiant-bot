# Radiant Arena — Unity 6 Gameplay Implementation Guide

> **Audience**: Dev cầm doc này sang Unity 6 project mới (`radiant-arena-client/`).
>
> **Tech stack**: Unity 6 + URP + HLSL stylized cartoon shaders + BillGameCore service runtime + Colyseus Unity SDK + UI Toolkit (UIDocument).
>
> **Contract upstream**: Colyseus server ([RADIANT_ARENA_COLYSEUS.md](RADIANT_ARENA_COLYSEUS.md)) — authoritative on gameplay truth (HP, damage, trajectory, turn order).
>
> **Contract downstream**: User browser via WebGL build hosted on Cloudflare Pages.

---

## 0. Design pillars

1. **Server-authoritative truth** — Unity renders what the server says happened. Zero local damage calc, zero local hit detection. Easy to reason about, kills cheats.
2. **Juicy stylized cartoon** — every action gives feedback: camera shake, hit-stop, particle burst, screen flash, HP-bar pop. Combat math is simple; presentation makes it feel impactful.
3. **BillGameCore everywhere** — Bill.State for phase machine, Bill.Events for net→gameplay bus, Bill.Pool for FX, Bill.UI for panels, Bill.Audio for SFX, Bill.Tween for camera + UI animation, Bill.Timer for delays. No raw `Coroutine` / `Invoke` / `Instantiate`.
4. **Weapon ID matching** — server tells client "you can pick weapons [a, b, c]". Unity has local `WeaponDatabase` keyed by slug. **Only weapons whose slug exists locally render in picker.** New weapon = server side adds slug + Unity ships asset bundle update. Backward-compatible upgrade flow.
5. **No magic numbers** — combat params (turn deadline, animation speeds, camera shake intensity) read from `Bill.Config` so balance tuning doesn't require rebuild.

---

## 1. Project setup

### 1.1 Create project

- Unity Hub → New project → 6.0 LTS → **Universal 3D** template.
- Set WebGL target: `File → Build Profiles → WebGL → Switch Platform`.
- Player settings → WebGL → Publishing Settings:
  - Compression: Brotli
  - Memory size: 256MB (1v1 game, modest)
  - Code optimization: Speed
  - Strip engine code: ON (smaller build)
- Quality: only `URP-Performant` profile, delete others.

### 1.2 Package manager dependencies

```
# Manifest: Packages/manifest.json
{
  "dependencies": {
    "com.unity.render-pipelines.universal": "17.x",
    "com.unity.ui": "1.x",                                  // UI Toolkit
    "com.unity.inputsystem": "1.7+",                        // New Input System
    "com.unity.cinemachine": "3.x",
    "com.unity.shadergraph": "17.x",
    "io.colyseus.colyseus-unity-sdk": "git+https://github.com/colyseus/colyseus-unity-sdk.git",
    "com.veriorpies.parrelsync": "git+https://github.com/VeriorPies/ParrelSync.git",
    "com.bill.gamecore": "<your private package or local file:>"
  }
}
```

> If `BillGameCore` isn't a published package, import as local file: dependency or drop the asset folder into `Assets/BillGameCore/`. Either way, `Bill.X` static accessors must work at runtime.

### 1.3 Directory layout

```
Assets/
├── RadiantArena/
│   ├── Scenes/
│   │   ├── Bootstrap.unity              # Loads BillGameCore, persists across loads
│   │   ├── Arena.unity                  # Main gameplay scene
│   │   └── DevDebug.unity               # Standalone test scene (no Colyseus)
│   ├── Scripts/
│   │   ├── Bootstrap/
│   │   │   └── ArenaBootstrap.cs        # Bill.Init + register states/pools/panels
│   │   ├── Net/
│   │   │   ├── NetClient.cs             # Colyseus connection + state sync
│   │   │   ├── ArenaContext.cs          # Singleton holding match snapshot
│   │   │   ├── MessageSchemas.cs        # C↔S payload structs
│   │   │   └── UrlParser.cs             # ?t=<token>&session=<id> from URL
│   │   ├── States/
│   │   │   ├── ConnectingState.cs
│   │   │   ├── LobbyState.cs
│   │   │   ├── CountdownState.cs
│   │   │   ├── MyTurnState.cs
│   │   │   ├── OpponentTurnState.cs
│   │   │   ├── AnimatingState.cs
│   │   │   └── EndState.cs
│   │   ├── Weapons/
│   │   │   ├── WeaponData.cs            # Plain serializable struct
│   │   │   ├── WeaponDatabase.cs        # ScriptableObject — local registry
│   │   │   ├── WeaponPrefabRegistry.cs  # Maps model_prefab_key → GameObject
│   │   │   └── WeaponController.cs      # Drag-aim input behaviour
│   │   ├── Trajectory/
│   │   │   ├── TrajectoryPlayer.cs      # Interpolates points + spawns FX
│   │   │   └── TrajectoryBall.cs        # The projectile visual
│   │   ├── Players/
│   │   │   ├── PlayerView.cs            # Visual proxy for PlayerSchema
│   │   │   └── HpBar.cs                 # World-space HP bar (UI Toolkit Runtime)
│   │   ├── UI/
│   │   │   ├── LobbyPanel.cs            # Weapon picker + ready button
│   │   │   ├── HudPanel.cs              # HP bars, turn timer, weapon icon
│   │   │   ├── TurnInputPanel.cs        # Drag-aim-power HUD overlay
│   │   │   ├── ResultPanel.cs           # Win/lose screen
│   │   │   └── ConnectingOverlay.cs
│   │   ├── Camera/
│   │   │   ├── ArenaCamera.cs           # Cinemachine config + shake
│   │   │   └── HitStop.cs               # Time-scale freeze on hit
│   │   ├── FX/
│   │   │   ├── ImpactFX.cs              # Pool-spawned particle wrappers
│   │   │   └── DamageNumber.cs          # Floating damage text
│   │   ├── Events/
│   │   │   └── ArenaEvents.cs           # IEvent struct definitions
│   │   ├── Audio/
│   │   │   └── AudioKeys.cs             # Constants for Bill.Audio.Play
│   │   └── Util/
│   │       ├── Logger.cs                # Wraps Debug.Log with category
│   │       └── ColorUtil.cs             # Hex → Color32 (matches server hue)
│   ├── Prefabs/
│   │   ├── Players/
│   │   │   └── PlayerRoot.prefab
│   │   ├── Weapons/                     # one prefab per model_prefab_key
│   │   │   ├── weapon_thiet_con_01.prefab
│   │   │   ├── weapon_kiem_01.prefab
│   │   │   └── ...
│   │   ├── FX/
│   │   │   ├── fx_impact_burst.prefab
│   │   │   ├── fx_wall_dust.prefab
│   │   │   └── ...
│   │   ├── UI/
│   │   │   └── HpBar.prefab
│   │   └── Trajectory/
│   │       └── TrajectoryBall.prefab
│   ├── UI/                              # UI Toolkit UXML + USS
│   │   ├── LobbyPanel.uxml
│   │   ├── HudPanel.uxml
│   │   ├── TurnInputPanel.uxml
│   │   ├── ResultPanel.uxml
│   │   └── Theme.uss                    # Stylized cartoon palette
│   ├── Materials/
│   │   ├── Toon_Lit.mat
│   │   ├── Toon_Outline.mat
│   │   ├── FX_Trail.mat
│   │   └── ...
│   ├── Shaders/                         # HLSL shaders (see §10)
│   │   ├── ToonLit.shader
│   │   ├── ToonOutline.shader
│   │   ├── FXTrail.shader
│   │   └── ...
│   ├── Settings/
│   │   ├── URP-Performant.asset
│   │   └── ArenaInputActions.inputactions
│   └── ScriptableObjects/
│       └── WeaponDatabase.asset
└── Resources/                           # only what Bill.Audio + Bill.Pool need
    ├── Audio/
    │   ├── SFX/
    │   └── Music/
    └── Prefabs/                         # mirror of Assets/RadiantArena/Prefabs for Bill.Pool keys
```

---

## 2. BillGameCore integration map

| BillGameCore | Arena use |
|---|---|
| `Bill.State` | ArenaState machine: Connecting → Lobby → Countdown → MyTurn / OpponentTurn → Animating → End |
| `Bill.Events` | NetClient subscribes Colyseus state changes → fires `IEvent` structs. Gameplay components consume only events, never touch Room/Schema. |
| `Bill.Pool` | TrajectoryBall, ImpactFX, WallDustFX, DamageNumber, weapon prefabs by `model_prefab_key`. |
| `Bill.UI` | LobbyPanel, HudPanel, TurnInputPanel, ResultPanel, ConnectingOverlay. |
| `Bill.Audio` | shoot, wall_bounce, hit, hit_crit, signature_activate, ready, win, lose, lobby_bgm, combat_bgm. |
| `Bill.Timer` | Countdown ticks, turn deadline display, animation delays, damage-number fade-out. |
| `Bill.Tween` | Camera shake on hit, HP bar fill animation, weapon idle bob, lobby panel slide. |
| `Bill.Save` | **NOT used** — server-authoritative, nothing to save locally. |
| `Bill.Net` | **NOT used for Colyseus** — Colyseus SDK has its own networking. Reserve Bill.Net for future REST calls (post-launch). |
| `Bill.Config` | Read magic numbers: `arena.turn_timeout_ms`, `arena.camera_shake_intensity`, `arena.hit_stop_ms`, etc. |
| `Bill.Cheat` | Dev commands: `arena_seed_lobby`, `arena_finish_round`, `arena_set_hp`. |
| `Bill.Debug` | FPS/draw-call overlay during testing. |

---

## 3. Bootstrap

```csharp
// Assets/RadiantArena/Scripts/Bootstrap/ArenaBootstrap.cs
using UnityEngine;
using RadiantArena.States;
using RadiantArena.UI;
using RadiantArena.Net;

public class ArenaBootstrap : MonoBehaviour {
    [SerializeField] WeaponDatabase weaponDatabase;
    [SerializeField] WeaponPrefabRegistry prefabRegistry;

    async void Start() {
        // 1. Init BillGameCore (idempotent)
        await Bill.Init();

        // 2. Register states
        Bill.State.AddState<ConnectingState>();
        Bill.State.AddState<LobbyState>();
        Bill.State.AddState<CountdownState>();
        Bill.State.AddState<MyTurnState>();
        Bill.State.AddState<OpponentTurnState>();
        Bill.State.AddState<AnimatingState>();
        Bill.State.AddState<EndState>();

        // 3. Register pools (model prefabs + FX)
        RegisterPools();

        // 4. UI Panels are auto-registered by Bill.UI scanning Resources/UI/

        // 5. Cheats (dev only)
        #if DEVELOPMENT_BUILD || UNITY_EDITOR
        RegisterCheats();
        #endif

        // 6. Cache singletons
        ArenaContext.Init(weaponDatabase, prefabRegistry);

        // 7. Kick off net connect
        Bill.State.GoTo<ConnectingState>();
    }

    void RegisterPools() {
        Bill.Pool.Register("TrajectoryBall",
            Resources.Load<GameObject>("Prefabs/Trajectory/TrajectoryBall"),
            warmCount: 8);
        Bill.Pool.Register("FX_Impact",
            Resources.Load<GameObject>("Prefabs/FX/fx_impact_burst"),
            warmCount: 12);
        Bill.Pool.Register("FX_WallDust",
            Resources.Load<GameObject>("Prefabs/FX/fx_wall_dust"),
            warmCount: 16);
        Bill.Pool.Register("DamageNumber",
            Resources.Load<GameObject>("Prefabs/UI/DamageNumber"),
            warmCount: 6);
        // Weapon prefabs registered lazily by WeaponPrefabRegistry on first use.
    }

    #if DEVELOPMENT_BUILD || UNITY_EDITOR
    void RegisterCheats() {
        Bill.Cheat.Register("arena_set_hp", (int hp) => {
            if (ArenaContext.MyPlayer != null) ArenaContext.MyPlayer.hp = hp;
        }, "Set own HP");
        Bill.Cheat.Register("arena_quit", () => {
            NetClient.Instance?.Disconnect();
        }, "Force disconnect");
    }
    #endif
}
```

---

## 4. Net layer

### 4.1 NetClient

```csharp
// Assets/RadiantArena/Scripts/Net/NetClient.cs
using System.Threading.Tasks;
using UnityEngine;
using Colyseus;
using RadiantArena.Events;

public class NetClient : MonoBehaviour {
    public static NetClient Instance { get; private set; }

    ColyseusClient client;
    public ColyseusRoom<DuelState> Room { get; private set; }

    void Awake() {
        if (Instance != null) { Destroy(gameObject); return; }
        Instance = this;
        DontDestroyOnLoad(gameObject);
    }

    public async Task ConnectAsync() {
        var (wsUrl, sessionId, token) = UrlParser.Parse(Application.absoluteURL);
        if (string.IsNullOrEmpty(token)) {
            Bill.Events.Fire(new NetErrorEvent { code = "MISSING_TOKEN" });
            return;
        }

        client = new ColyseusClient(wsUrl);
        try {
            Room = await client.JoinById<DuelState>($"duel_{sessionId}", new {
                token = token,
            });
        } catch (System.Exception e) {
            Bill.Events.Fire(new NetErrorEvent { code = "JOIN_FAILED", message = e.Message });
            return;
        }

        // 1. State sync → ArenaContext
        Room.OnStateChange += OnStateChange;

        // 2. Discrete messages → events
        Room.OnMessage<MatchStartMessage>("match_start", OnMatchStart);
        Room.OnMessage<ShotResolvedMessage>("shot_resolved", OnShotResolved);
        Room.OnMessage<TurnSwitchedMessage>("turn_switched", OnTurnSwitched);
        Room.OnMessage<SignatureUsedMessage>("signature_used", OnSignatureUsed);
        Room.OnMessage<MatchEndedMessage>("match_ended", OnMatchEnded);
        Room.OnMessage<ErrorMessage>("error", OnServerError);

        // 3. Phase changes via state.phase delta
        Room.State.OnChange += OnRootStateFieldChange;

        Bill.Events.Fire(new NetConnectedEvent { sessionId = sessionId });
    }

    void OnStateChange(DuelState state, bool isFirstState) {
        ArenaContext.HydrateFrom(state);
        if (isFirstState) {
            Bill.Events.Fire(new InitialStateReceivedEvent());
        }
    }

    void OnRootStateFieldChange(System.Collections.Generic.List<Colyseus.Schema.DataChange> changes) {
        foreach (var c in changes) {
            if (c.Field == "phase") {
                var newPhase = (string)c.Value;
                Bill.Events.Fire(new PhaseChangedEvent { newPhase = newPhase });
            }
        }
    }

    void OnMatchStart(MatchStartMessage m) {
        Bill.Events.Fire(new MatchStartedEvent {
            firstTurnId = m.first_turn_id,
            seed = m.seed,
        });
    }

    void OnShotResolved(ShotResolvedMessage m) {
        Bill.Events.Fire(new ShotResolvedEvent {
            trajectory = m.trajectory,
            shooter = m.shooter,
            damageDealt = m.damage_dealt,
            crit = m.crit,
        });
    }

    // ... OnTurnSwitched, OnSignatureUsed, OnMatchEnded, OnServerError

    public void Send(string type, object payload) => Room?.Send(type, payload);

    public void Disconnect() {
        Room?.Leave();
        Room = null;
    }

    void OnDestroy() {
        Disconnect();
        Instance = null;
    }
}
```

### 4.2 URL parser

WebGL is loaded as `https://arena.billthedev.com/?t=<token>&session=<id>`. Token survives across the WebGL bootstrap.

```csharp
// Assets/RadiantArena/Scripts/Net/UrlParser.cs
using System;
using System.Collections.Specialized;
using System.Web;
using UnityEngine;

public static class UrlParser {
    public static (string wsUrl, string sessionId, string token) Parse(string fullUrl) {
        if (string.IsNullOrEmpty(fullUrl)) return ("ws://localhost:2567", "dev-fallback", "");
        var uri = new Uri(fullUrl);
        var query = HttpUtility.ParseQueryString(uri.Query);
        var token = query["t"] ?? "";
        var session = query["session"] ?? "";

        // Choose WS endpoint based on host
        var wsScheme = uri.Scheme == "https" ? "wss" : "ws";
        var wsHost = uri.Host == "arena.billthedev.com"
            ? "arena-api.billthedev.com"
            : "localhost:2567";
        return ($"{wsScheme}://{wsHost}", session, token);
    }
}
```

> WebGL has restricted access to `Uri` namespace types; you may need a custom query-string parser. The shape is the same.

### 4.3 ArenaContext (snapshot singleton)

Components don't reach into `Room.State` directly — they read from `ArenaContext`, which is hydrated whenever state changes. Keeps networking layer isolated from gameplay.

```csharp
// Assets/RadiantArena/Scripts/Net/ArenaContext.cs
public static class ArenaContext {
    public static WeaponDatabase WeaponDb { get; private set; }
    public static WeaponPrefabRegistry PrefabRegistry { get; private set; }

    public static string MyDiscordId { get; set; } = "";
    public static string OpponentDiscordId { get; set; } = "";
    public static string CurrentPhase { get; set; } = "waiting";
    public static PlayerSnapshot MyPlayer { get; private set; }
    public static PlayerSnapshot OpponentPlayer { get; private set; }

    public static void Init(WeaponDatabase db, WeaponPrefabRegistry registry) {
        WeaponDb = db;
        PrefabRegistry = registry;
    }

    public static void HydrateFrom(DuelState state) {
        CurrentPhase = state.phase;
        foreach (var kv in state.players) {
            var snap = new PlayerSnapshot(kv.Value);
            if (kv.Key == MyDiscordId) MyPlayer = snap;
            else OpponentPlayer = snap;
        }
    }
}

public class PlayerSnapshot {
    public string DiscordId;
    public string DisplayName;
    public int Hp;
    public int HpMax;
    public WeaponData Weapon;
    public WeaponData[] AvailableWeapons;
    public string SelectedSlug;
    public bool Ready;
    public Vector2 Position;
    public PlayerSnapshot(PlayerSchema p) { /* copy fields */ }
}
```

---

## 5. State machine

Each state is a slim `GameState` with `Enter`/`Tick`/`Exit`. They subscribe to events and call `Bill.UI.Open<X>` / `Bill.State.GoTo<X>`. **Never** poll `Room.State` directly inside a state.

```csharp
// Assets/RadiantArena/Scripts/States/LobbyState.cs
using RadiantArena.Events;
using RadiantArena.UI;
using RadiantArena.Net;

public class LobbyState : GameState {
    public override void Enter() {
        Bill.UI.Open<LobbyPanel>(panel => {
            panel.SetAvailableWeapons(ArenaContext.MyPlayer.AvailableWeapons);
            panel.OnWeaponPicked += slug => NetClient.Instance.Send("select_weapon", new { slug });
            panel.OnReady += () => NetClient.Instance.Send("ready", new {});
            panel.OnUnready += () => NetClient.Instance.Send("unready", new {});
        });
        Bill.Events.Subscribe<PhaseChangedEvent>(OnPhaseChanged);
        Bill.Audio.PlayMusic("bgm_lobby", 1.0f);
    }

    void OnPhaseChanged(PhaseChangedEvent e) {
        if (e.newPhase == "countdown") Bill.State.GoTo<CountdownState>();
    }

    public override void Exit() {
        Bill.UI.Close<LobbyPanel>();
        Bill.Events.Unsubscribe<PhaseChangedEvent>(OnPhaseChanged);
    }
}
```

```csharp
// Assets/RadiantArena/Scripts/States/MyTurnState.cs
public class MyTurnState : GameState {
    public override void Enter() {
        Bill.UI.Open<TurnInputPanel>(panel => {
            panel.SetWeapon(ArenaContext.MyPlayer.Weapon);
            panel.OnShotReleased += OnShotReleased;
        });
        Bill.Events.Fire(new TurnStartedEvent { isMine = true, deadlineAt = ArenaContext.TurnDeadlineAt });
    }

    void OnShotReleased(float angle, float power) {
        NetClient.Instance.Send("shoot", new { angle, power });
        Bill.State.GoTo<AnimatingState>();
    }

    public override void Exit() {
        Bill.UI.Close<TurnInputPanel>();
    }
}
```

```csharp
// Assets/RadiantArena/Scripts/States/AnimatingState.cs
public class AnimatingState : GameState {
    public override void Enter() {
        Bill.Events.Subscribe<ShotResolvedEvent>(OnShotResolved);
    }

    void OnShotResolved(ShotResolvedEvent e) {
        TrajectoryPlayer.Instance.Play(e.trajectory, e.shooter, onComplete: () => {
            NetClient.Instance.Send("animation_complete", new { round = ArenaContext.CurrentRound });
            // State machine will receive PhaseChanged → MyTurn or OpponentTurn via NetClient.
        });
    }

    public override void Exit() {
        Bill.Events.Unsubscribe<ShotResolvedEvent>(OnShotResolved);
    }
}
```

---

## 6. Weapon ID matching flow

**The contract**:
1. Server `state.players[me].available_weapons` has the authorized weapon list (one `WeaponSchema` per).
2. Local `WeaponDatabase` (ScriptableObject) has entries keyed by slug, containing **only visual + prefab refs**. Server is source of truth for stats.
3. LobbyPanel iterates `available_weapons`, looks up each slug in WeaponDatabase. **If lookup fails → hide that entry** (Unity ships without asset for that weapon yet — silent skip, no error).
4. User picks an entry → send `select_weapon { slug }`.
5. User clicks Ready → send `ready`.

### WeaponData (plain serializable)

```csharp
// Assets/RadiantArena/Scripts/Weapons/WeaponData.cs
[System.Serializable]
public class WeaponData {
    public string slug;
    public string display_name;
    public string category;             // "blunt" | "pierce" | "spirit"
    public string tier;                 // "ban_menh" | "pham" | "dia" | "thien" | "tien"
    public WeaponStats stats;
    public WeaponVisual visual;
    public WeaponSkill[] skills;

    /// Convert from Colyseus schema instance to plain data
    public static WeaponData FromSchema(WeaponSchema s) {
        return new WeaponData {
            slug = s.slug,
            display_name = s.display_name,
            category = s.category,
            tier = s.tier,
            stats = WeaponStats.FromSchema(s.stats),
            visual = WeaponVisual.FromSchema(s.visual),
            skills = /* ... */,
        };
    }
}
```

### WeaponDatabase (ScriptableObject)

```csharp
// Assets/RadiantArena/Scripts/Weapons/WeaponDatabase.cs
using UnityEngine;
using System.Collections.Generic;

[CreateAssetMenu(menuName = "Radiant Arena/Weapon Database")]
public class WeaponDatabase : ScriptableObject {
    [System.Serializable]
    public class Entry {
        public string slug;                       // matches server slug
        public string displayNameOverride;        // optional: cosmetic override
        public Sprite icon;                       // 64x64 PNG for picker
        public GameObject modelPrefab;            // 3D mesh
        public GameObject muzzleFxPrefab;         // optional
        public AudioClip shootSfx;
        public AudioClip impactSfx;
        public Color tintHue = Color.white;       // fallback if server doesn't provide hue
    }

    [SerializeField] List<Entry> entries;
    Dictionary<string, Entry> _index;

    void OnEnable() {
        _index = new Dictionary<string, Entry>();
        foreach (var e in entries) {
            if (!string.IsNullOrEmpty(e.slug)) _index[e.slug] = e;
        }
    }

    public bool Has(string slug) => _index != null && _index.ContainsKey(slug);
    public Entry Get(string slug) => _index != null && _index.TryGetValue(slug, out var e) ? e : null;
    public IEnumerable<Entry> All => entries;
}
```

### LobbyPanel render

```csharp
// Assets/RadiantArena/Scripts/UI/LobbyPanel.cs
using UnityEngine;
using UnityEngine.UIElements;

public class LobbyPanel : BasePanel {
    UIDocument doc;
    ScrollView weaponList;
    Button readyBtn;
    Label statusLabel;
    string selectedSlug;

    public System.Action<string> OnWeaponPicked;
    public System.Action OnReady;
    public System.Action OnUnready;

    public override void OnOpen() {
        doc = Bill.UI.GetDocument<LobbyPanel>();
        var root = doc.rootVisualElement;
        weaponList = root.Q<ScrollView>("weapon-list");
        readyBtn = root.Q<Button>("ready-btn");
        statusLabel = root.Q<Label>("status");
        readyBtn.clicked += OnReadyClicked;
    }

    public void SetAvailableWeapons(WeaponData[] available) {
        weaponList.Clear();
        var db = ArenaContext.WeaponDb;
        int rendered = 0;
        foreach (var w in available) {
            if (!db.Has(w.slug)) {
                // Unity doesn't have local asset for this weapon — skip silently.
                // (Server permits it but client visual not ready.)
                continue;
            }
            var entry = db.Get(w.slug);
            var card = MakeCard(w, entry);
            weaponList.Add(card);
            rendered++;
        }
        if (rendered == 0) {
            statusLabel.text = "⚠️ Không có pháp khí khả dụng trong client phiên bản này.";
        } else {
            statusLabel.text = $"Chọn pháp khí ({rendered} khả dụng)";
        }
    }

    VisualElement MakeCard(WeaponData server, WeaponDatabase.Entry local) {
        var card = new Button(() => {
            selectedSlug = server.slug;
            OnWeaponPicked?.Invoke(server.slug);
            HighlightSelected();
        });
        card.AddToClassList("weapon-card");
        card.userData = server.slug;
        var icon = new Image { sprite = local.icon };
        card.Add(icon);
        card.Add(new Label(local.displayNameOverride ?? server.display_name));
        card.Add(new Label($"Tier: {server.tier}"));
        card.Add(new Label($"DMG {server.stats.damage_base}"));
        if (!string.IsNullOrEmpty(server.visual.hue) && ColorUtility.TryParseHtmlString(server.visual.hue, out var hue)) {
            card.style.borderLeftColor = hue;
        }
        return card;
    }

    void HighlightSelected() {
        foreach (var el in weaponList.Children()) {
            el.EnableInClassList("selected", (string)el.userData == selectedSlug);
        }
    }

    void OnReadyClicked() {
        if (string.IsNullOrEmpty(selectedSlug)) {
            statusLabel.text = "⚠️ Chọn pháp khí trước khi sẵn sàng.";
            return;
        }
        OnReady?.Invoke();
    }
}
```

### When state updates mid-lobby

ArenaContext re-hydrates whenever server `OnStateChange` fires. LobbyPanel can subscribe to a `WeaponSelectionChangedEvent` (fired by NetClient when `player.selected_weapon_slug` field changes via `OnChange`) to update opponent's selection display ("Đối thủ đã chọn Thiết Phiến").

---

## 7. Trajectory playback

When `ShotResolvedEvent` fires, animate the projectile along the points + spawn FX at marked events.

```csharp
// Assets/RadiantArena/Scripts/Trajectory/TrajectoryPlayer.cs
using System.Collections.Generic;
using UnityEngine;
using RadiantArena.Events;

public class TrajectoryPlayer : MonoBehaviour {
    public static TrajectoryPlayer Instance { get; private set; }
    void Awake() { Instance = this; }

    public void Play(IList<TrajectoryPointSchema> points, string shooterId, System.Action onComplete) {
        var ball = Bill.Pool.Spawn<TrajectoryBall>("TrajectoryBall", Vector3.zero, Quaternion.identity);
        ball.Init(weaponHue: ShooterHue(shooterId));
        StartCoroutine(PlayRoutine(ball, points, shooterId, onComplete));
    }

    System.Collections.IEnumerator PlayRoutine(TrajectoryBall ball, IList<TrajectoryPointSchema> points, string shooterId, System.Action onComplete) {
        if (points.Count == 0) { Bill.Pool.Return(ball.gameObject); onComplete?.Invoke(); yield break; }

        int idx = 0;
        float playStart = Time.time;
        var first = points[0];
        ball.transform.position = WorldFromSim(first.x, first.y);

        while (idx < points.Count) {
            var pt = points[idx];
            float playT = Time.time - playStart;
            float ptT = pt.t / 1000f;
            if (playT < ptT) {
                // interpolate from previous
                var prev = idx == 0 ? pt : points[idx - 1];
                float lerpT = Mathf.InverseLerp(prev.t / 1000f, ptT, playT);
                ball.transform.position = Vector3.Lerp(
                    WorldFromSim(prev.x, prev.y),
                    WorldFromSim(pt.x, pt.y),
                    lerpT);
                yield return null;
                continue;
            }

            // Reached this point — fire its event
            HandleEvent(pt, ball.transform.position);
            idx++;
        }

        Bill.Pool.Return(ball.gameObject, delay: 0.1f);
        onComplete?.Invoke();
    }

    void HandleEvent(TrajectoryPointSchema pt, Vector3 worldPos) {
        if (string.IsNullOrEmpty(pt.event_)) return;
        if (pt.event_ == "wall_bounce") {
            Bill.Pool.Spawn("FX_WallDust", worldPos, Quaternion.identity);
            Bill.Audio.Play("sfx_wall_bounce", worldPos, volume: 0.6f);
            Bill.Tween.To(0f, 1f, 0.15f, _ => { /* tiny camera shake */ });
            return;
        }
        if (pt.event_.StartsWith("hit:") || pt.event_.StartsWith("crit:")) {
            var isCrit = pt.event_.StartsWith("crit:");
            var dmg = int.Parse(pt.event_.Split(':')[1]);
            Bill.Pool.Spawn("FX_Impact", worldPos, Quaternion.identity);
            Bill.Pool.Spawn<DamageNumber>("DamageNumber", worldPos, Quaternion.identity).Init(dmg, isCrit);
            Bill.Audio.Play(isCrit ? "sfx_hit_crit" : "sfx_hit", worldPos);
            ArenaCamera.Instance.Shake(intensity: isCrit ? 0.6f : 0.3f, duration: 0.25f);
            HitStop.Instance.Trigger(durationMs: isCrit ? 120 : 60);
            Bill.Events.Fire(new PlayerHitEvent {
                damage = dmg, isCrit = isCrit, hitPoint = worldPos,
            });
            return;
        }
        if (pt.event_ == "stop") {
            // trajectory ends here — return ball
        }
    }

    static Vector3 WorldFromSim(float simX, float simY) {
        // Sim is 0..1000 in both axes; we use 1 sim-unit = 0.01 world-units → 10×10 world units total
        return new Vector3((simX - 500) * 0.01f, 0f, (simY - 500) * 0.01f);
    }

    string ShooterHue(string shooterId) {
        var weapon = (shooterId == ArenaContext.MyDiscordId)
            ? ArenaContext.MyPlayer?.Weapon
            : ArenaContext.OpponentPlayer?.Weapon;
        return weapon?.visual?.hue ?? "#ffffff";
    }
}
```

---

## 8. Weapon input — drag-aim-power

```csharp
// Assets/RadiantArena/Scripts/Weapons/WeaponController.cs
using UnityEngine;
using UnityEngine.InputSystem;

public class WeaponController : MonoBehaviour {
    [SerializeField] float maxDragWorldDistance = 3.0f;
    Vector3 dragStart;
    bool dragging;

    public System.Action<float, float> OnShot; // angle (rad), power (0..1)

    void Update() {
        if (Mouse.current == null) return;

        if (Mouse.current.leftButton.wasPressedThisFrame) {
            dragStart = ScreenToWorld(Mouse.current.position.ReadValue());
            dragging = true;
        }
        if (dragging && Mouse.current.leftButton.isPressed) {
            var current = ScreenToWorld(Mouse.current.position.ReadValue());
            var drag = current - dragStart;
            UpdateAimPreview(drag);
        }
        if (dragging && Mouse.current.leftButton.wasReleasedThisFrame) {
            var current = ScreenToWorld(Mouse.current.position.ReadValue());
            var drag = current - dragStart;
            var power = Mathf.Clamp01(drag.magnitude / maxDragWorldDistance);
            if (power < 0.1f) { dragging = false; HideAimPreview(); return; }
            // Aim direction is OPPOSITE of drag (slingshot style)
            var aimDir = -drag.normalized;
            var angle = Mathf.Atan2(aimDir.z, aimDir.x);
            OnShot?.Invoke(angle, power);
            dragging = false;
            HideAimPreview();
        }
    }

    Vector3 ScreenToWorld(Vector2 screen) {
        var ray = Camera.main!.ScreenPointToRay(screen);
        var plane = new Plane(Vector3.up, Vector3.zero);
        if (plane.Raycast(ray, out float enter)) return ray.GetPoint(enter);
        return Vector3.zero;
    }

    void UpdateAimPreview(Vector3 drag) {
        // Show LineRenderer arc + power indicator (call into TurnInputPanel for UI sync)
        Bill.Events.Fire(new AimUpdatedEvent {
            aimAngle = Mathf.Atan2(-drag.z, -drag.x),
            power = Mathf.Clamp01(drag.magnitude / maxDragWorldDistance),
        });
    }

    void HideAimPreview() {
        Bill.Events.Fire(new AimClearedEvent());
    }
}
```

---

## 9. Juicy polish — the cartoon feel

Without these the game is mechanically correct but feels flat. Each item is small but **multiplicative**:

| Effect | Implementation | When |
|---|---|---|
| **Camera shake** | `ArenaCamera.Instance.Shake(intensity, duration)` using Cinemachine's `CinemachineImpulseSource` | Hit, crit, wall bounce |
| **Hit-stop** | Briefly set `Time.timeScale = 0.05f` for 60-120ms via `HitStop.Instance.Trigger(ms)`. Bill.Timer.UnscaledDelay restores. | Hit, crit, signature activate |
| **Damage number** | Pool-spawned floating text. Tween scale 0→1.2→1.0, position upward, alpha fade. Crit = bigger + golden | Hit |
| **Impact particle** | Burst FX prefab tinted by weapon hue. 8-12 particles, gravity 0, 0.4s lifetime | Hit |
| **Wall dust** | Smaller particle, gravity-pulled, 0.3s | Wall bounce |
| **HP bar pop** | Bill.Tween scales HP bar X to 1.15 → 1.0 over 0.15s on damage | HP changed |
| **Screen flash** | Tween a fullscreen overlay alpha 0.0→0.3→0 over 0.2s on crit | Crit |
| **Trajectory trail** | TrailRenderer on the ball, color = weapon hue, length 8 segments, fade-out 0.4s | Always while ball alive |
| **Lobby card glow** | Selected card: pulse outline shader on the border, 1.5Hz | Lobby weapon picked |
| **Ready indicator** | Both players see "Đối thủ đã sẵn sàng" with pulsing tick on opponent panel | Opponent ready |
| **Countdown SFX** | "3...2...1...GO!" voice over with each tick big-text bloom | Countdown phase |
| **Turn timer urgency** | Last 5s of turn deadline: timer goes red, ticks pulse, low-frequency heartbeat SFX | Active phase |

```csharp
// Assets/RadiantArena/Scripts/Camera/HitStop.cs
public class HitStop : MonoBehaviour {
    public static HitStop Instance { get; private set; }
    void Awake() { Instance = this; }

    public void Trigger(int durationMs) {
        float originalScale = Time.timeScale;
        Time.timeScale = 0.05f;
        Bill.Timer.UnscaledDelay(durationMs / 1000f, () => {
            Time.timeScale = originalScale;
        });
    }
}
```

---

## 10. HLSL shaders — list + notes

> **Implementation deferred** — Bill ghi note here, build later khi art assets ready. Stack: Unity 6 URP + HLSL custom (not Shader Graph; HLSL gives finer control for stylized cartoon).

### 10.1 Required shaders

| Shader | Purpose | Notes |
|---|---|---|
| **ToonLit** | Base material for player + weapon meshes | Cel-shaded lighting (3-band), rim light, optional fresnel for ban-mệnh ethereal weapons |
| **ToonOutline** | Black/colored outline on character + weapon silhouettes | Inverted-hull technique (cheap, WebGL friendly), thickness scales with view distance |
| **FXTrail** | Projectile trail | Additive, tinted by `_HueColor` property fed from weapon JSON, soft fadeout via vertex alpha |
| **FXImpact** | Particle burst on hit | Additive sprite shader with `_HueColor`, screen-space distortion ripple (optional) |
| **DamageNumberFloat** | Floating damage text | Outline + drop shadow, position offset via vertex animation for "pop" |
| **GroundGrid** | Map floor | Stylized grid pattern, slight parallax, vignette toward edges |
| **WallToon** | 4 arena walls | Same as ToonLit but with corner highlight when projectile near (proximity glow) |
| **HpBarRadial** | World-space HP bar | Radial fill with `_Fill` (0..1), pulse glow when damaged |
| **AuraRimSpirit** | Spirit-tier weapons | Rim light + animated noise displacement (e.g., dị hoả flame fringe) |
| **PostProcessFlash** | Screen flash on crit | URP renderer feature override, full-screen overlay |
| **SignaturePulse** | Active skill cast effect | Pulsing dome + chromatic aberration burst |

### 10.2 Shader properties shared across stylized stack

```hlsl
// Common.hlsl
Properties {
    _BaseMap     ("Albedo", 2D) = "white" {}
    _BaseColor   ("Tint", Color) = (1,1,1,1)
    _ShadowColor ("Shadow Tint", Color) = (0.3, 0.3, 0.5, 1)
    _RimColor    ("Rim Tint", Color) = (1, 1, 1, 1)
    _RimPower    ("Rim Power", Range(0.5, 8.0)) = 3.0
    _CelBands    ("Cel Bands", Range(2, 5)) = 3
    _OutlineWidth("Outline Width", Range(0, 0.05)) = 0.005
    _OutlineColor("Outline Color", Color) = (0, 0, 0, 1)
    _HueShift    ("Hue Shift", Range(0, 1)) = 0  // for per-weapon tint
}
```

### 10.3 Note for future shader dev

- **Stylized cartoon target reference**: think *Genshin Impact* lite, *Sky: Children of Light*, *Eastward*. Soft edges, limited cel bands (3 not 5), bold rim lights, no aggressive PBR.
- **WebGL constraints**: avoid compute shaders, custom shadow casters, screen-space reflections. URP forward+ works. Texture limit 2K per surface.
- **Mobile-friendly**: target 60fps on mid-range integrated GPU (Intel UHD 620). Keep overdraw low.
- **Tweak per weapon**: each weapon's `visual.hue` should multiply into `_BaseColor` (or `_HueShift`) for instant color identity per pháp khí — same model can be reused across tiers with hue variation.

---

## 11. Camera setup

Top-down with slight tilt (15-20°), orthographic. Cinemachine virtual camera follows a "center between players" target.

```csharp
// Assets/RadiantArena/Scripts/Camera/ArenaCamera.cs
using Unity.Cinemachine;
using UnityEngine;

public class ArenaCamera : MonoBehaviour {
    public static ArenaCamera Instance { get; private set; }
    [SerializeField] CinemachineImpulseSource impulse;
    [SerializeField] CinemachineCamera vcam;

    void Awake() { Instance = this; }

    public void Shake(float intensity, float duration) {
        impulse.GenerateImpulse(Vector3.one * intensity);
    }

    public void FocusOnHit(Vector3 worldPos) {
        // Briefly zoom-in toward the hit location for crits
        Bill.Tween.To(vcam.Lens.OrthographicSize, vcam.Lens.OrthographicSize * 0.9f, 0.1f, v => vcam.Lens.OrthographicSize = v);
        Bill.Timer.Delay(0.3f, () => {
            Bill.Tween.To(vcam.Lens.OrthographicSize, vcam.Lens.OrthographicSize / 0.9f, 0.3f, v => vcam.Lens.OrthographicSize = v);
        });
    }
}
```

---

## 12. Double-test workflow — 2 clients in editor

### Stack

| Tool | Purpose |
|---|---|
| `radiant-arena-server` running locally | Colyseus on `ws://localhost:2567` |
| Seed script `scripts/seed-room.ts` | Bypass bot, create room directly, print 2 token URLs |
| **ParrelSync** | Two Unity Editor instances on same project |
| Dev URL field | DebugDevScene has a TextField to paste `?t=...` URL |

### Step-by-step

1. **Start Colyseus server**:
   ```bash
   cd radiant-arena-server
   npm run dev
   ```

2. **Seed a room** (gets 2 URLs):
   ```bash
   npx tsx scripts/seed-room.ts
   ```
   Output:
   ```
   === ROOM CREATED ===
   Client A URL: ws://localhost:2567 ?t=<tokenA>&session=dev-1234
   Client B URL: ws://localhost:2567 ?t=<tokenB>&session=dev-1234
   ```

3. **ParrelSync clone**:
   - Main Unity instance: open the project.
   - `Window → ParrelSync → Clones Manager → Add new clone`.
   - Wait for clone (5-10 min first time, links symlinked thereafter).
   - Open clone in new Unity instance.

4. **Dev scene boot**:
   - Both instances: load `Scenes/Arena.unity`.
   - `ArenaBootstrap` has serialized field `[SerializeField] string devDebugUrl;`. In editor: paste Client A URL into instance 1's bootstrap, Client B URL into instance 2.
   - Alternative: enable `DevDebug.unity` scene with an in-game text field for runtime paste.

5. **Press Play in both**:
   - Instance 1: connects with token A → lobby loads → picks Thiết Côn → Ready.
   - Instance 2: connects with token B → lobby loads → picks Thanh Kiếm → Ready.
   - Countdown 3s → Both enter Active phase.
   - Drag-shoot turn by turn.
   - HP=0 → both see Result panel.

6. **Iterate fast**:
   - Code change → both instances auto-recompile (ParrelSync shares the script DB).
   - Restart only the affected instance.

### Editor scaffold for paste flow

```csharp
// Assets/RadiantArena/Scripts/DevDebug/UrlPasteScreen.cs
#if UNITY_EDITOR || DEVELOPMENT_BUILD
using UnityEngine;
using UnityEngine.UIElements;

public class UrlPasteScreen : MonoBehaviour {
    [SerializeField] UIDocument doc;
    void Start() {
        var root = doc.rootVisualElement;
        var field = root.Q<TextField>("url");
        var btn = root.Q<Button>("go");
        btn.clicked += () => {
            // Stash the pasted URL where UrlParser can read it
            DevUrlOverride.Set(field.value);
            // Boot the arena
            FindObjectOfType<ArenaBootstrap>()?.StartArena();
        };
    }
}
#endif
```

```csharp
// Assets/RadiantArena/Scripts/Net/UrlParser.cs — extend for dev override
public static (string wsUrl, string sessionId, string token) Parse(string fullUrl) {
    #if UNITY_EDITOR || DEVELOPMENT_BUILD
    var devOverride = DevUrlOverride.Get();
    if (!string.IsNullOrEmpty(devOverride)) fullUrl = devOverride;
    #endif
    // ... same as §4.2
}
```

---

## 13. WebGL build + Cloudflare Pages deploy

### Build

`File → Build Profiles → WebGL → Build`. Output: `Build/` folder with `index.html`, `*.wasm`, `*.data`.

### Pages config

1. Create new Cloudflare Pages project pointing at your `radiant-arena-client/` repo's `Build/` folder.
2. Build command: `# Unity build is done locally, just upload`.
3. Output directory: `Build/`.
4. Custom domain: `arena.billthedev.com`.

### OG meta tags (for Discord embed preview)

Edit `Build/index.html` template (or use a post-build hook):

```html
<head>
  <meta property="og:title" content="Radiant Arena — Pháp Khí Đấu Trường" />
  <meta property="og:description" content="Drag-aim-release PvP với pháp khí cá nhân" />
  <meta property="og:image" content="https://arena.billthedev.com/og-thumbnail.png" />
  <meta property="og:url" content="https://arena.billthedev.com" />
  <meta name="twitter:card" content="summary_large_image" />
</head>
```

So when bot posts the match URL in `#arena`, Discord auto-renders preview card.

---

## 14. Clean code conventions

| Rule | Reason |
|---|---|
| Components subscribe in `OnEnable`, unsubscribe in `OnDisable` | No leaks when state machine transitions |
| **No** `Instantiate` direct calls — always `Bill.Pool.Spawn` | Pool reuse + warm-up; consistent lifecycle |
| **No** `Coroutine` direct in non-Pool MonoBehaviours — use `Bill.Timer.Delay/Repeat` | Cancellable; respect `Time.timeScale`; testable |
| **No** raw `Camera.main.transform.position` — use `ArenaCamera.Instance` | Cinemachine-friendly; shake/zoom composed |
| **No** `Time.deltaTime` in physics math — server is authoritative | Client only renders trajectory; no client-side physics |
| Events use `struct : IEvent`, never `class` | Value type, no GC alloc |
| Strings for pool keys / audio keys / shader properties → constants in `AudioKeys.cs`, `PoolKeys.cs`, `ShaderProps.cs` | Compile-time safety; refactor without ctrl+F |
| State enter logs via `Bill.Trace` not `Debug.Log` | Searchable, can toggle off in build |
| No `[FormerlySerializedAs]` chains — rename fields cleanly | Keeps inspector clean for new devs |
| `BasePanel.OnOpen` does setup; `OnClose` does teardown. No state on panel between opens. | Avoids stale UI state |

### Anti-patterns to avoid

```csharp
// ❌ DON'T: poll Room.State in Update()
void Update() {
    if (NetClient.Instance.Room.State.phase == "active") {
        // ...
    }
}

// ✅ DO: subscribe to PhaseChangedEvent once
void OnEnable() => Bill.Events.Subscribe<PhaseChangedEvent>(OnPhase);

// ❌ DON'T: direct Instantiate in trajectory player
GameObject ball = Instantiate(ballPrefab);

// ✅ DO: pool spawn
var ball = Bill.Pool.Spawn<TrajectoryBall>("TrajectoryBall", pos, rot);

// ❌ DON'T: hardcoded turn timeout
const float TURN_TIMEOUT = 30f;

// ✅ DO: Bill.Config
float turnTimeout = Bill.Config.GetFloat("arena.turn_timeout_ms", 30000f) / 1000f;

// ❌ DON'T: Subscribe forever from MonoBehaviour Start
void Start() => Bill.Events.Subscribe<X>(OnX);  // never unsub → leak

// ✅ DO: OnEnable/OnDisable pair
void OnEnable() => Bill.Events.Subscribe<X>(OnX);
void OnDisable() => Bill.Events.Unsubscribe<X>(OnX);
```

---

## 15. Test scenarios (Unity-side smoke)

| # | Scenario | Expected |
|---|---|---|
| 1 | Boot scene without URL → no token | ConnectingOverlay shows "Cần token". No crash. |
| 2 | Boot with invalid token | Server rejects → NetErrorEvent → "Token không hợp lệ" screen. |
| 3 | Boot with valid token, server unreachable | 5s timeout → "Không kết nối được server". Retry button. |
| 4 | Connect succeeds → Lobby renders | Available weapons appear; weapons not in WeaponDatabase are hidden silently. |
| 5 | Pick weapon → server confirms via state.selected_weapon_slug | Card shows selected highlight. |
| 6 | Pick weapon Unity doesn't have asset for | Doesn't show in picker. |
| 7 | Click Ready before picking weapon | UI warning "Chọn pháp khí trước". |
| 8 | Both ready → countdown 3s | Big text "3, 2, 1, ĐẤU!" + SFX, scene transitions to Active. |
| 9 | My turn → drag and release | Aim line preview during drag; trajectory ball spawns on release. |
| 10 | Trajectory animation plays smoothly | Ball follows server points; impact FX at hit event; wall dust at bounces. |
| 11 | Opponent shoots | Trajectory shown from their perspective; my HP drops if hit. |
| 12 | Crit hit | Bigger camera shake, hit-stop, golden damage number, screen flash. |
| 13 | HP = 0 on opponent | Match ends → ResultPanel shows "Thắng" |
| 14 | HP = 0 on me | ResultPanel shows "Thua" |
| 15 | Network disconnect mid-game | ConnectingOverlay with "Mất kết nối, đang thử lại..." |
| 16 | ParrelSync 2 instances → both connect, play full match | Full E2E works without bot. |

---

## 16. Animation roadmap (priority order)

1. **Placeholder phase** (week 1-2): all 3D models are stretched cubes / spheres with hue tint. No outline shader. Focus on: state machine working, drag-shoot working, trajectory playback correct.
2. **Toon shading baseline** (week 3): implement ToonLit + ToonOutline. Apply to cube placeholders. Already looks 10× better.
3. **First weapon model** (week 4): Thiết Côn Phàm Phẩm (the cheapest tier — start with one). Replace cube → mesh, hue tint preserved.
4. **All 6 weapons + bản mệnh visual variation** (week 5-6): if budget tight, do 3 distinct meshes (blunt/pierce/spirit archetypes) and recolor via `_HueShift`.
5. **Polish FX**: trail, impact, damage numbers, screen flash, signature pulse. Iterative.
6. **Audio pass** (week 7): all SFX from CC0/royalty-free packs (Freesound, Sonniss).
7. **Map + walls** (week 8): stylized ground grid, 4 wall meshes with corner glow proximity.

---

## 17. Open items / TODO before launch

- [ ] Implement all 7 ArenaState classes (Connecting / Lobby / Countdown / MyTurn / OpponentTurn / Animating / End)
- [ ] WeaponDatabase ScriptableObject populated with 6 weapons
- [ ] WeaponPrefabRegistry: at least placeholder cube + tint per weapon
- [ ] NetClient with full Colyseus connection + retry logic
- [ ] Drag-aim input with LineRenderer preview
- [ ] Trajectory playback with FX on every event type
- [ ] LobbyPanel UI Toolkit with weapon picker grid
- [ ] HudPanel with 2 HP bars + turn timer
- [ ] TurnInputPanel with aim power meter
- [ ] ResultPanel with replay link + return-to-Discord button
- [ ] ParrelSync setup verified
- [ ] WebGL build pipeline + Cloudflare Pages deploy
- [ ] OG meta tags for `arena.billthedev.com`
- [ ] HLSL shaders (see §10) — defer to art pass
- [ ] Audio assets — defer

---

## 18. Quick start checklist (when starting from zero)

```
[ ] Unity 6 LTS installed
[ ] Create new URP project "radiant-arena-client"
[ ] Switch platform to WebGL
[ ] Import: Colyseus SDK, ParrelSync, Cinemachine, BillGameCore
[ ] Create folder structure (§1.3)
[ ] Copy ArenaBootstrap.cs, NetClient.cs, ArenaContext.cs, UrlParser.cs
[ ] Define MessageSchemas.cs matching server (§3 of COLYSEUS doc)
[ ] Define ArenaEvents.cs (IEvent structs)
[ ] Create WeaponDatabase asset with 2 placeholder weapons (slug + cube mesh)
[ ] Build Arena.unity with: ArenaBootstrap object, NetClient object, Camera, MapRoot 4 walls, PlayerASlot + PlayerBSlot empties, UIRoot UIDocument
[ ] Implement ConnectingState.cs first → verify connect → lobby shows
[ ] Implement LobbyState + LobbyPanel.uxml → verify weapon picker
[ ] Implement Countdown → MyTurn → drag-shoot → server returns trajectory
[ ] Implement TrajectoryPlayer + AnimatingState → playback works
[ ] Iterate juicy effects (§9)
[ ] ParrelSync test 2-client full match
[ ] Build WebGL → Cloudflare Pages
```

---

*End of Unity gameplay implementation guide.*
