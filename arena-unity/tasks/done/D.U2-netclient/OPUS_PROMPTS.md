# D.U2 — NetClient + Colyseus connect · OPUS_PROMPTS

> Self-contained prompts cho Bill paste sequential vào Opus session. **1 sub per invocation.** Opus làm xong sub → STOP → Bill paste sub tiếp.
> Source detail: `SUBTASKS.md`. Architecture: `PLAN.md`. Server contract: `arena-unity/server-extract-2026-05-15.md`.
> Executor model: **Opus 4.7** (per D.U1 precedent — Bill's choice).

---

## Sub 1 — Verify baseline (read-only, NO commit)

```
Bạn là senior Unity 6 client dev theo persona `arena-unity/SKILL.md`. Đọc SKILL.md adopt persona + coding principles + MCP §2.7 trước khi action.

Đang execute Lát D.U2 (NetClient + Colyseus connect) Stage 2 theo `arena-unity/ROADMAP.md`. Stage 1 done — Bill confirmed PLAN+SUBTASKS+OPUS_PROMPTS.

## Read first
- `arena-unity/tasks/todo/D.U2-netclient/PLAN.md` §3 (project state) + §5 (APIs)
- `arena-unity/tasks/todo/D.U2-netclient/SUBTASKS.md` Sub 1
- `arena-unity/server-extract-2026-05-15.md` §A (Colyseus version match)

## Nhiệm vụ: CHỈ Sub 1 (read-only)
1. MCP `read_console` types=["error"] count=20 → must be empty.
2. MCP `find_in_file` paths=["Library/PackageCache/io.colyseus.sdk@b4b1da15d686"] pattern=`class ColyseusClient` → record file path + signature.
3. MCP `find_in_file` paths=["Library/PackageCache/io.colyseus.sdk@b4b1da15d686"] pattern=`class.*Room<` (or equivalent) → record `ColyseusRoom<T>` (or `Room<T>`) actual generic class name + namespace.
4. MCP `find_in_file` paths=["Library/PackageCache/io.colyseus.sdk@b4b1da15d686"] pattern=`namespace Colyseus.Schema` → confirm Schema base class location + attribute syntax (`[Type(...)]` vs `[SerializeField]` vs other).
5. Grep `Packages/packages-lock.json` for `com.unity.nuget.newtonsoft-json` — confirm present + record version. Nếu MISSING → flag as blocker (Sub 8 needs it).
6. Read `Assets/BillGameCore/Runtime/Infrastructure/Interfaces.cs` — extract IStateService + IEventService method signatures (signature for Register, GoTo, Subscribe, Fire).

## Output report cho Bill
- ✅ / ❌ Colyseus namespace + exact using statements needed (e.g., `using Colyseus;` vs `using io.colyseus.sdk;`).
- ✅ / ❌ Schema base class fully-qualified name + attribute syntax with one example.
- ✅ / ❌ Newtonsoft.Json available (version).
- BillGameCore IStateService + IEventService method signatures verbatim.
- Any blocker / surprise. If Colyseus asmdef name differs from PLAN's assumption (`io.colyseus.sdk`), report exact name for Sub 8 asmdef adjustment.

## STOP
KHÔNG commit, KHÔNG modify file, KHÔNG proceed Sub 2.
MCP unavailable → báo "MCP not available, need Bill to start Unity + MCP server", KHÔNG silent fallback.
```

---

## Sub 2 — Hand-mirror Colyseus schemas

```
Persona: `arena-unity/SKILL.md`. Lát D.U2 Stage 2 Sub 2. Sub 1 đã verify baseline, Bill confirmed proceed.

## Read first
- `arena-unity/tasks/todo/D.U2-netclient/SUBTASKS.md` Sub 2
- `arena-unity/server-extract-2026-05-15.md` §B (raw TS schemas — source of truth)
- Sub 1 output (Schema base class name + attribute syntax)

## Nhiệm vụ: CHỈ Sub 2
Tạo `Assets/RadiantArena/Scripts/Net/MessageSchemas.cs` với 7 schema classes hand-mirror từ TS:

1. `WeaponStatsSchema` — 7 fields theo thứ tự: power(float32), hitbox(float32), bounce(float32), damage_base(float32), pierce_count(uint8), crit_chance(float32), crit_multi(float32).
2. `WeaponVisualSchema` — 4 fields: model_prefab_key(string), particle_fx_key(string), trail_fx_key(string), hue(string).
3. `WeaponSkillSchema` — 5 fields: skill_id(string), trigger(string), magnitude(float32), cooldown(float32), fx_key(string).
4. `WeaponSchema` — 7 fields: slug(string), display_name(string), category(string), tier(string), stats(WeaponStatsSchema), visual(WeaponVisualSchema), skills(ArraySchema<WeaponSkillSchema>).
5. `TrajectoryPointSchema` — 4 fields: t(uint16), x(float32), y(float32), event(string).
6. `PlayerSchema` — 12 fields theo thứ tự server-extract §B: discord_id(string), display_name(string), x(float32), y(float32), hp(uint16), hp_max(uint16), available_weapons(ArraySchema<WeaponSchema>), selected_weapon_slug(string), weapon(WeaponSchema), ready(boolean), connected(boolean), signature_cd_until(uint32).
7. `DuelState` — 14 fields theo thứ tự: session_id(string), phase(string), players(MapSchema<PlayerSchema>), turn_player_id(string), turn_deadline_at(uint32), join_deadline_at(uint32), round(uint16), stake(uint16), last_trajectory(ArraySchema<TrajectoryPointSchema>), last_shooter_id(string), winner_id(string), outcome(string), map_width(uint16), map_height(uint16).

## Quy tắc
- Namespace: `RadiantArena.Net`. `#nullable enable` trên cùng.
- Field names snake_case strict (server-extract §B notes).
- Decorator order = TS class field order EXACT.
- Use Schema base class + attribute syntax từ Sub 1 verified output.
- Nested schema fields default-construct (e.g., `public WeaponSchema weapon = new WeaponSchema();`).
- ArraySchema/MapSchema init: `public ArraySchema<WeaponSchema> skills = new ArraySchema<WeaponSchema>();`.
- File ~150 lines OK.

## Verify
- MCP `refresh_unity` → poll `editor_state.isCompiling=false`.
- MCP `read_console` types=["error"] → zero errors.

## DoD
File compiles, console clean.

## Commit
`feat(arena-unity/Lát-D.U2): hand-mirror Colyseus DuelState schemas (7 classes)`

## STOP sau commit. KHÔNG proceed Sub 3.
MCP unavailable → báo Bill, KHÔNG silent.
```

---

## Sub 3 — Outbound + inbound message types

```
Persona: `arena-unity/SKILL.md`. Lát D.U2 Stage 2 Sub 3.

## Read first
- `arena-unity/tasks/todo/D.U2-netclient/SUBTASKS.md` Sub 3
- `arena-unity/server-extract-2026-05-15.md` §C (message protocol)

## Nhiệm vụ: CHỈ Sub 3
Tạo `Assets/RadiantArena/Scripts/Net/MessageTypes.cs`. Namespace `RadiantArena.Net`. `#nullable enable`.

### Outbound (struct, used by Room.Send(type, payload))
- `SelectWeaponMsg { string slug }` — type="select_weapon"
- `ReadyMsg { }` — type="ready" (no fields, just `{}`)
- `UnreadyMsg { }` — type="unready"
- `ShootMsg { float angle, float power }` — type="shoot"
- `SignatureMsg { }` — type="signature"
- `ConcedeMsg { }` — type="concede"
- `AnimationCompleteMsg { int round }` — type="animation_complete"
- `PingMsg { long t }` — type="ping"

### Inbound (class, used by Room.OnMessage<T>)
- `MatchStartMessage { string first_turn_id, int seed }`
- `ShotResolvedMessage { TrajectoryPointSchema[] trajectory, string shooter, float damage_dealt, bool crit }`
- `TurnSwitchedMessage { string new_turn_id, long deadline_at, int round }`
- `SignatureUsedMessage { string player_id, string skill_id, string fx_key }`
- `MatchEndedMessage { string winner, string outcome /* + final_hp via Dictionary<string,int> */ }`
- `PongMessage { long t, long server_t }`
- `ErrorMessage { string code /* + extras */ }`

Notes:
- snake_case mirror cho server contract.
- Inbound = public class with public fields (Colyseus message deserializer uses reflection).
- For D.U2a only — không Send() ở đâu cả. D.U3+ sẽ gọi.
- Add XML doc comment `/// <summary>...</summary>` mỗi outbound type ghi rõ server-side phase allowed (per server-extract §C table).

## Verify
- `refresh_unity` + `read_console` zero errors.

## DoD
File compiles, console clean.

## Commit
`feat(arena-unity/Lát-D.U2): define outbound + inbound message types (stub for D.U3+)`

## STOP sau commit. KHÔNG proceed Sub 4.
```

---

## Sub 4 — ArenaContext snapshot singleton

```
Persona: `arena-unity/SKILL.md`. Lát D.U2 Stage 2 Sub 4.

## Read first
- `arena-unity/tasks/todo/D.U2-netclient/SUBTASKS.md` Sub 4
- `arena-unity/tasks/todo/D.U2-netclient/PLAN.md` §6.2 (architecture decision)
- `Assets/RadiantArena/Scripts/Net/MessageSchemas.cs` (Sub 2 output — DuelState + PlayerSchema fields)

## Nhiệm vụ: CHỈ Sub 4
Tạo `Assets/RadiantArena/Scripts/Net/ArenaContext.cs`. Namespace `RadiantArena.Net`. `#nullable enable`.

### Public surface
```csharp
public static class ArenaContext {
    public static string MyDiscordId { get; set; } = "";
    public static string OpponentDiscordId { get; set; } = "";
    public static string SessionId { get; set; } = "";
    public static string CurrentPhase { get; set; } = "waiting";
    public static int CurrentRound { get; set; } = 0;
    public static PlayerSnapshot? MyPlayer { get; private set; }
    public static PlayerSnapshot? OpponentPlayer { get; private set; }

    public static void HydrateFrom(DuelState state) { ... }
    public static void Reset() { ... }
}

public class PlayerSnapshot {
    public string DiscordId = "";
    public string DisplayName = "";
    public float X, Y;
    public int Hp = 100, HpMax = 100;
    public string SelectedWeaponSlug = "";
    public bool Ready;
    public bool Connected = true;
    public long SignatureCdUntil;

    public PlayerSnapshot() { }
    public PlayerSnapshot(PlayerSchema p) {
        DiscordId = p.discord_id;
        DisplayName = p.display_name;
        X = p.x; Y = p.y;
        Hp = p.hp; HpMax = p.hp_max;
        SelectedWeaponSlug = p.selected_weapon_slug;
        Ready = p.ready;
        Connected = p.connected;
        SignatureCdUntil = p.signature_cd_until;
    }
}
```

### HydrateFrom logic
- Copy `state.session_id` → `SessionId`.
- Copy `state.phase` → `CurrentPhase`.
- Copy `state.round` → `CurrentRound`.
- Iterate `state.players` (MapSchema — use foreach over `players.Keys`, lookup via `players[key]`):
  - If key == `MyDiscordId` → `MyPlayer = new PlayerSnapshot(value)`.
  - Else → `OpponentPlayer = new PlayerSnapshot(value)`; `OpponentDiscordId = key`.

### Reset logic
- Set all string fields to `""`, int/long to 0.
- `MyPlayer = null; OpponentPlayer = null;`.

Out-of-scope D.U2: WeaponDb, PrefabRegistry, full weapon hydration on PlayerSnapshot. Keep SelectedWeaponSlug as string only.

## Verify
- `refresh_unity` + `read_console` zero errors.

## DoD
File compiles, console clean.

## Commit
`feat(arena-unity/Lát-D.U2): add ArenaContext snapshot singleton`

## STOP sau commit. KHÔNG proceed Sub 5.
```

---

## Sub 5 — Extend ArenaEvents with net events

```
Persona: `arena-unity/SKILL.md`. Lát D.U2 Stage 2 Sub 5.

## Read first
- `arena-unity/tasks/todo/D.U2-netclient/SUBTASKS.md` Sub 5
- `Assets/RadiantArena/Scripts/Events/ArenaEvents.cs` (current — chỉ có ArenaBootstrapReadyEvent + placeholder comment)

## Nhiệm vụ: CHỈ Sub 5
Edit `Assets/RadiantArena/Scripts/Events/ArenaEvents.cs`:
- Giữ `ArenaBootstrapReadyEvent`.
- Cập nhật comment header (xóa D.U2 placeholder line vì giờ đã add).
- Add 5 struct mới (mỗi struct : IEvent):

```csharp
public struct NetConnectedEvent { public string sessionId; public string roomId; }
public struct NetDisconnectedEvent { public int code; public string reason; }
public struct NetErrorEvent { public string code; public string message; }
public struct PhaseChangedEvent { public string oldPhase; public string newPhase; }
public struct InitialStateReceivedEvent { public string sessionId; }
```

Comment header sau khi update nên ghi: `// Real events for D.U2 added. D.U5 will add ShotResolvedEvent + PlayerHitEvent + WallBounceEvent. D.U6 will add MatchEndedEvent.`

## Quy tắc
- Namespace `RadiantArena.Events`.
- `#nullable enable`.
- Struct, KHÔNG class (allocates GC per fire — anti-pattern §3.4 SKILL).

## Verify
- `refresh_unity` + `read_console` zero errors.

## DoD
File compiles, console clean, 5 new event structs visible to IntelliSense.

## Commit
`feat(arena-unity/Lát-D.U2): add net-layer events to ArenaEvents`

## STOP sau commit. KHÔNG proceed Sub 6.
```

---

## Sub 6 — ConnectionInfo + UrlParser (WebGL-safe)

```
Persona: `arena-unity/SKILL.md`. Lát D.U2 Stage 2 Sub 6.

## Read first
- `arena-unity/tasks/todo/D.U2-netclient/SUBTASKS.md` Sub 6
- `arena-unity/tasks/todo/D.U2-netclient/PLAN.md` §6.4 (WebGL safety)

## Nhiệm vụ: CHỈ Sub 6

### File 1: `Assets/RadiantArena/Scripts/Net/ConnectionInfo.cs`
```csharp
namespace RadiantArena.Net {
    public struct ConnectionInfo {
        public string wsUrl;
        public string roomId;
        public string sessionId;
        public string token;
        public string discordId;

        public bool IsValid() =>
            !string.IsNullOrEmpty(wsUrl) &&
            !string.IsNullOrEmpty(roomId) &&
            !string.IsNullOrEmpty(token);
    }
}
```

### File 2: `Assets/RadiantArena/Scripts/Net/UrlParser.cs`
- Namespace `RadiantArena.Net`. `#nullable enable`.
- Static class với 1 public method: `public static ConnectionInfo Parse(string fullUrl)`.
- Parse query strings như `?room=ABC123&t=<token>&session=<uuid>&did=<discord_id>`.
- **KHÔNG dùng `System.Web`** (not available in WebGL IL2CPP).
- Manual split: find `?`, split rest by `&`, split each by `=`, URL-decode values via `UnityWebRequest.UnEscapeURL(string)`.
- Host → wsUrl mapping:
  - `arena.billthedev.com` (any scheme) → `wss://arena-api.billthedev.com`.
  - Else → `ws://localhost:2567` (dev).
- Empty / null fullUrl → return `{ wsUrl="ws://localhost:2567", others="" }` (Editor fallback).
- Defensive: try-catch around Uri construction; on exception return Editor fallback + log warning.

Query param names supported:
- `room` → roomId
- `t` → token
- `session` → sessionId
- `did` → discordId

## Verify
- `refresh_unity` + `read_console` zero errors.

## DoD
Both files compile, console clean.

## Commit
`feat(arena-unity/Lát-D.U2): add ConnectionInfo + UrlParser (WebGL-safe)`

## STOP sau commit. KHÔNG proceed Sub 7.
```

---

## Sub 7 — NetClient MonoBehaviour

```
Persona: `arena-unity/SKILL.md`. Lát D.U2 Stage 2 Sub 7. Đây là artifact chính của lát.

## Read first
- `arena-unity/tasks/todo/D.U2-netclient/SUBTASKS.md` Sub 7
- `arena-unity/tasks/todo/D.U2-netclient/PLAN.md` §6.1 (decision why NOT Bill.Net) + §6.8 (error handling)
- `arena-unity/server-extract-2026-05-15.md` §B (schema) + §D (auth)
- Sub 1 output (exact `ColyseusClient` + `Room<T>` API)
- Existing files: `MessageSchemas.cs`, `ConnectionInfo.cs`, `ArenaContext.cs`, `ArenaEvents.cs`

## Nhiệm vụ: CHỈ Sub 7
Tạo `Assets/RadiantArena/Scripts/Net/NetClient.cs`. Namespace `RadiantArena.Net`. `#nullable enable`.

### Public surface
```csharp
public class NetClient : MonoBehaviour {
    public static NetClient? Instance { get; private set; }
    public ColyseusRoom<DuelState>? Room { get; private set; }  // type name from Sub 1
    public bool IsConnected => Room != null;
    public ConnectionInfo CurrentInfo { get; private set; }

    public async Task ConnectAsync(ConnectionInfo info);
    public void Send(string type, object payload);
    public void Disconnect();
}
```

### Awake
- Singleton enforce:
  ```csharp
  if (Instance != null && Instance != this) { Destroy(gameObject); return; }
  Instance = this;
  DontDestroyOnLoad(gameObject);
  ```

### ConnectAsync logic (per PLAN §6.8 — fail closed)
1. `Debug.Log($"[Arena.Net] Connecting to {info.wsUrl} room={info.roomId} ...");`
2. Validate `info.IsValid()` → nếu không, `Bill.Events.Fire(new NetErrorEvent { code="MISSING_TOKEN", message="ConnectionInfo invalid" }); return;`
3. `CurrentInfo = info;`
4. `ArenaContext.MyDiscordId = info.discordId; ArenaContext.SessionId = info.sessionId;`
5. Try-catch around:
   ```csharp
   var client = new ColyseusClient(info.wsUrl);
   Room = await client.JoinById<DuelState>(info.roomId, new Dictionary<string, object> { ["token"] = info.token });
   ```
   (Or use anonymous object `new { token = info.token }` — Sub 1 should confirm signature.)
6. Catch generic Exception → `Bill.Events.Fire(new NetErrorEvent { code="JOIN_FAILED", message=e.Message }); Debug.LogError($"[Arena.Net] Join failed: {e}"); return;`
7. Wire handlers:
   ```csharp
   Room.OnStateChange += OnStateChange;
   Room.OnLeave += OnLeave;
   Room.OnMessage<MatchStartMessage>("match_start", m => Debug.Log("[Arena.Net] match_start"));
   // ... repeat for 5 more inbound types (stub logs for D.U2b)
   Room.OnMessage<ErrorMessage>("error", m => Bill.Events.Fire(new NetErrorEvent { code=m.code, message="" }));
   ```
8. `Debug.Log($"[Arena.Net] Joined room {info.roomId}");`
9. `Bill.Events.Fire(new NetConnectedEvent { sessionId=info.sessionId, roomId=info.roomId });`

### OnStateChange handler
- Track private field `private string _lastPhase = "";`
- On call:
  ```csharp
  ArenaContext.HydrateFrom(state);
  if (state.phase != _lastPhase) {
      var old = _lastPhase;
      _lastPhase = state.phase;
      Bill.Events.Fire(new PhaseChangedEvent { oldPhase=old, newPhase=state.phase });
      Debug.Log($"[Arena.Phase] {old} -> {state.phase}");
  }
  if (isFirstState) {
      Bill.Events.Fire(new InitialStateReceivedEvent { sessionId=CurrentInfo.sessionId });
  }
  ```

### OnLeave handler
- `Bill.Events.Fire(new NetDisconnectedEvent { code=code, reason=$"OnLeave code={code}" });`
- `Room = null;`
- `_lastPhase = "";`
- `ArenaContext.Reset();`

### Send
- Guard `if (Room == null) { Debug.LogWarning($"[Arena.Net] Send({type}) ignored — not connected"); return; }`
- `Room.Send(type, payload);`

### Disconnect
- `if (Room != null) { Room.Leave(); Room = null; }`
- `_lastPhase = "";`
- `ArenaContext.Reset();`
- `Debug.Log("[Arena.Net] Disconnected");`

### OnDestroy
- `Disconnect();`
- `Instance = null;`

## Verify
- `refresh_unity` + poll `editor_state.isCompiling=false`.
- `read_console` types=["error"] zero.
- Manual sanity: `using` statements gồm `using System.Collections.Generic; using System.Threading.Tasks; using Colyseus; using UnityEngine; using BillGameCore; using RadiantArena.Events;` (adjust Colyseus namespace per Sub 1).

## DoD
File compiles, console clean.

## Commit
`feat(arena-unity/Lát-D.U2): add NetClient MonoBehaviour wrapping Colyseus connection`

## Bill checkpoint
Sau khi commit Sub 7, Bill có thể quick-review NetClient.cs trước khi tiếp Sub 8 (Editor token signer phụ thuộc NetClient.Instance.ConnectAsync signature).

## STOP sau commit. KHÔNG proceed Sub 8.
```

---

## Sub 8 — DevTokenSigner + ManualRoomConnect (Editor-only) + asmdefs

```
Persona: `arena-unity/SKILL.md`. Lát D.U2 Stage 2 Sub 8.

## Read first
- `arena-unity/tasks/todo/D.U2-netclient/SUBTASKS.md` Sub 8
- `arena-unity/server-extract-2026-05-15.md` §D (token spec) + §E (C# port template)
- `arena-unity/tasks/todo/D.U2-netclient/PLAN.md` §6.5 (Editor-only constraint)

## Nhiệm vụ: CHỈ Sub 8

### 8a. Asmdef Runtime
File: `Assets/RadiantArena/Scripts/RadiantArena.Runtime.asmdef`
```json
{
    "name": "RadiantArena.Runtime",
    "rootNamespace": "RadiantArena",
    "references": ["BillGameCore", "<COLYSEUS_ASMDEF_FROM_SUB1>"],
    "autoReferenced": true,
    "noEngineReferences": false
}
```
(Sub 1 output cho tên asmdef thật của Colyseus — `io.colyseus.sdk` hay khác.)

### 8b. Asmdef Editor
File: `Assets/RadiantArena/Editor/RadiantArena.Editor.asmdef`
```json
{
    "name": "RadiantArena.Editor",
    "rootNamespace": "RadiantArena.Editor",
    "references": ["RadiantArena.Runtime", "Unity.Newtonsoft.Json"],
    "includePlatforms": ["Editor"],
    "autoReferenced": true,
    "noEngineReferences": false
}
```

### 8c. DevTokenSigner
File: `Assets/RadiantArena/Editor/DevTokenSigner.cs`. Namespace `RadiantArena.Editor`. `#nullable enable`.

```csharp
public static class DevTokenSigner {
    public static string SignToken(string sessionId, string discordId, long expiresAtUnixMs, string secret) {
        if (string.IsNullOrEmpty(secret)) throw new System.ArgumentException("secret empty");

        // Use Newtonsoft to control JSON field order EXACT
        var payload = new Newtonsoft.Json.Linq.JObject {
            ["session_id"] = sessionId,
            ["discord_id"] = discordId,
            ["expires_at"] = expiresAtUnixMs,
        };
        var json = payload.ToString(Newtonsoft.Json.Formatting.None);
        var jsonBytes = System.Text.Encoding.UTF8.GetBytes(json);
        var payloadB64 = System.Convert.ToBase64String(jsonBytes)
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');
        using var hmac = new System.Security.Cryptography.HMACSHA256(
            System.Text.Encoding.UTF8.GetBytes(secret));
        var sigBytes = hmac.ComputeHash(System.Text.Encoding.UTF8.GetBytes(payloadB64));
        var sigHex = System.BitConverter.ToString(sigBytes).Replace("-", "").ToLowerInvariant();
        return $"{payloadB64}.{sigHex}";
    }
}
```

### 8d. ManualRoomConnect EditorWindow
File: `Assets/RadiantArena/Editor/ManualRoomConnect.cs`. Namespace `RadiantArena.Editor`. `#nullable enable`.

Layout:
- `[MenuItem("Window/Radiant Arena/Manual Room Connect")]` → static OpenWindow.
- Fields (TextField) backed by EditorPrefs với prefix `RadiantArena.`:
  - WsUrl (default `ws://localhost:2567`)
  - RoomId
  - SessionId (default `test_session_001`)
  - DiscordId (default `bill_test_001`)
  - ArenaTokenSecret (password field — `EditorGUILayout.PasswordField`)
- Read-only TextArea: TokenPreview (filled after Mint).
- Buttons:
  - **"Mint Token (15min)"** — disabled nếu secret empty. Computes:
    ```csharp
    long expiresAt = System.DateTimeOffset.UtcNow.AddMinutes(15).ToUnixTimeMilliseconds();
    tokenPreview = DevTokenSigner.SignToken(sessionId, discordId, expiresAt, secret);
    EditorGUIUtility.systemCopyBuffer = tokenPreview;
    Debug.Log($"[Arena.DevToken] Minted token ({tokenPreview.Length} chars), copied to clipboard.");
    ```
  - **"Connect"** — disabled if `!Application.isPlaying` OR `string.IsNullOrEmpty(tokenPreview)` OR `string.IsNullOrEmpty(roomId)`. Action:
    ```csharp
    var info = new RadiantArena.Net.ConnectionInfo {
        wsUrl = wsUrl, roomId = roomId, sessionId = sessionId,
        token = tokenPreview, discordId = discordId,
    };
    var nc = RadiantArena.Net.NetClient.Instance;
    if (nc == null) { Debug.LogError("[Arena.DevConnect] NetClient.Instance null — Bootstrap scene not in Play mode"); return; }
    _ = nc.ConnectAsync(info);  // fire-and-forget
    ```
  - **"Disconnect"** — disabled if `!Application.isPlaying`. Calls `NetClient.Instance?.Disconnect()`.
- Persist field values on every change: `OnLostFocus()` saves all EditorPrefs.

## Verify
- `refresh_unity` + `read_console` zero errors.
- Confirm menu item "Window > Radiant Arena > Manual Room Connect" appears (MCP `manage_editor` action="execute_menu_item" hoặc Bill xác nhận manual).

## DoD
Both .cs files compile (Editor only — verified via asmdef includePlatforms=Editor). Console clean. Menu visible.

## Commit
`feat(arena-unity/Lát-D.U2): add Editor DevTokenSigner + ManualRoomConnect window`

## Bill checkpoint POST-commit
Bill SET `EditorPrefs["RadiantArena.ArenaTokenSecret"]` = matching server's `ARENA_TOKEN_SECRET` env. Cách:
- Mở window từ Window > Radiant Arena > Manual Room Connect.
- Paste secret vào field "Arena Token Secret".
- Lost focus auto-save.

Opus PAUSE + remind Bill nếu chưa xác nhận. Sub 9 không cần secret nhưng Sub 11 smoke cần.

## STOP sau commit. KHÔNG proceed Sub 9.
```

---

## Sub 9 — BootState + ConnectingState + ArenaStates register

```
Persona: `arena-unity/SKILL.md`. Lát D.U2 Stage 2 Sub 9.

## Read first
- `arena-unity/tasks/todo/D.U2-netclient/SUBTASKS.md` Sub 9
- Sub 1 output (IStateService method signatures)
- `Assets/BillGameCore/Runtime/StateMachine/` (verify IState interface — likely `IGameState` or similar with OnEnter/OnExit/OnUpdate hooks)

## Nhiệm vụ: CHỈ Sub 9

### 9a. `Assets/RadiantArena/Scripts/States/BootState.cs`
Namespace `RadiantArena.States`. `#nullable enable`.

```csharp
public class BootState : IGameState  // adjust interface name per BillGameCore
{
    public void OnEnter() {
        Debug.Log("[Arena.State] -> Boot");
        var info = RadiantArena.Net.UrlParser.Parse(Application.absoluteURL);
        Debug.Log($"[Arena.Boot] URL parsed: wsUrl={info.wsUrl}, session={info.sessionId}, token=({info.token.Length} chars)");
        if (info.IsValid()) {
            // Stash for ConnectingState (D.U2a: no URL flow yet — usually skip)
            // Actually for D.U2a, URL is empty in Editor so usually NOT valid → stay in Boot.
            Bill.State.GoTo<ConnectingState>();
        }
    }
    public void OnExit() { }
    public void OnUpdate(float dt) { }
}
```

### 9b. `Assets/RadiantArena/Scripts/States/ConnectingState.cs`
Namespace `RadiantArena.States`. `#nullable enable`.

```csharp
public class ConnectingState : IGameState
{
    System.Action<RadiantArena.Events.NetConnectedEvent>? _onConnected;
    System.Action<RadiantArena.Events.NetErrorEvent>? _onError;

    public void OnEnter() {
        Debug.Log("[Arena.State] -> Connecting");

        _onConnected = e => {
            Debug.Log($"[Arena.Connecting] Connected to room {e.roomId}");
            // D.U3 will transition to LobbyState here.
        };
        _onError = e => {
            Debug.LogError($"[Arena.Connecting] NetErrorEvent: code={e.code} message={e.message}");
            // D.U3+ will go to ErrorState.
        };
        Bill.Events.Subscribe(_onConnected);
        Bill.Events.Subscribe(_onError);

        // If NetClient already has cached ConnectionInfo (from ManualRoomConnect), trigger connect.
        // For D.U2a: BootState already called GoTo<ConnectingState>() if URL valid.
        // If URL was invalid (Editor smoke), ManualRoomConnect will invoke ConnectAsync directly later.
    }

    public void OnExit() {
        if (_onConnected != null) Bill.Events.Unsubscribe(_onConnected);
        if (_onError != null) Bill.Events.Unsubscribe(_onError);
        _onConnected = null;
        _onError = null;
    }

    public void OnUpdate(float dt) { }
}
```
(`Bill.Events.Subscribe` / `Unsubscribe` signature confirmed in Sub 1.)

### 9c. `Assets/RadiantArena/Scripts/States/ArenaStates.cs`
```csharp
namespace RadiantArena.States {
    public static class ArenaStates {
        public static void Register() {
            Bill.State.Register<BootState>(new BootState());
            Bill.State.Register<ConnectingState>(new ConnectingState());
        }
    }
}
```
(Adjust per actual `IStateService.Register<T>` signature from Sub 1.)

### 9d. Edit `Assets/RadiantArena/Scripts/Bootstrap/ArenaBootstrap.cs`
After `Bill.Events.Fire(new ArenaBootstrapReadyEvent());` line, append:
```csharp
RadiantArena.States.ArenaStates.Register();
Bill.State.GoTo<RadiantArena.States.BootState>();
```

## Verify
- `refresh_unity` + `read_console` zero errors.

## DoD
Files compile, console clean. (Sub 11 will verify Play-mode log chain.)

## Commit
`feat(arena-unity/Lát-D.U2): add BootState + ConnectingState + state register from ArenaBootstrap`

## STOP sau commit. KHÔNG proceed Sub 10.
```

---

## Sub 10 — Wire [NetClient] into Bootstrap.unity

```
Persona: `arena-unity/SKILL.md`. Lát D.U2 Stage 2 Sub 10.

## Read first
- `arena-unity/tasks/todo/D.U2-netclient/SUBTASKS.md` Sub 10
- `Assets/RadiantArena/Scripts/Net/NetClient.cs` (Sub 7 output — confirm class type for component add)

## Nhiệm vụ: CHỈ Sub 10
1. MCP `manage_scene` action="load" path="Assets/RadiantArena/Scenes/Bootstrap.unity".
2. MCP `manage_scene` action="get_hierarchy" → confirm 3 GO hiện tại: Main Camera, Directional Light, [ArenaBootstrap].
3. MCP `manage_gameobject` action="create" name="[NetClient]" position=(0,0,0). (Position trivial, GO doesn't render.)
4. MCP `manage_components` action="add" target="[NetClient]" component="RadiantArena.Net.NetClient".
5. MCP `manage_scene` action="get_hierarchy" → confirm 4 GO total.
6. MCP `manage_scene` action="save".
7. MCP `read_console` types=["error"] zero.

## DoD
- Scene Bootstrap.unity contains `[NetClient]` GO with NetClient component.
- Hierarchy có 4 GO total.
- Console clean.

## Commit
`feat(arena-unity/Lát-D.U2): wire NetClient GameObject into Bootstrap.unity`

## STOP sau commit. KHÔNG proceed Sub 11.

## Fallback nếu MCP `manage_components` fail (component type không resolve)
Báo Bill: "MCP can't add NetClient component via manage_components — please add manually via Inspector. Drag NetClient.cs onto [NetClient] GO, then save scene." Bill sẽ tự làm và confirm.
```

---

## Sub 11 — Smoke verify (NO commit, output cho REPORT)

```
Persona: `arena-unity/SKILL.md`. Lát D.U2 Stage 2 Sub 11 — last sub.

## Pre-conditions (Bill xác nhận trước khi paste prompt này)
- arena-server đang chạy local: `cd c:\Users\ADMIN\Downloads\Discord Sever\arena-server\ && pnpm dev` → `[arena] listening on :2567`.
- EditorPrefs `RadiantArena.ArenaTokenSecret` đã set = same as server's `ARENA_TOKEN_SECRET`.
- (Optional, ideal) Bill có 1 roomId đã pre-created bên server với roster chứa `discord_id=bill_test_001`. Nếu không, smoke vẫn pass với NetErrorEvent path (chứng minh wiring đúng).

## Read first
- `arena-unity/tasks/todo/D.U2-netclient/PLAN.md` §8.2 (D.U2a smoke spec — expected log regex)
- `arena-unity/tasks/todo/D.U2-netclient/SUBTASKS.md` Sub 11

## Nhiệm vụ: CHỈ Sub 11 (verify, NO commit)
1. MCP `manage_scene` action="load" path="Assets/RadiantArena/Scenes/Bootstrap.unity". Confirm active.
2. MCP `read_console` action="clear".
3. MCP `manage_editor` action="play".
4. Poll `editor_state` resource: `is_playing=true` AND `is_changing=false`. Max 5s.
5. MCP `read_console` types=["error","warning","log"] count=50. Capture all entries since Play start.
6. Verify expected log sequence (regex match):
   - `\[Bill\] Ready\. \d+ services in \d+ms\.`
   - `\[Arena\] bootstrap ready \(Bill\.IsReady=True\)`
   - `\[Arena\.State\] -> Boot`
   - `\[Arena\.Boot\] URL parsed:`
   - Optional (URL empty case): no further transition — STAY in Boot. THIS IS EXPECTED in Editor without query string.

7. (Optional manual step — Bill clicks Window > Radiant Arena > Manual Room Connect):
   - Bill paste roomId từ arena-server console + Mint Token + Connect.
   - Capture additional logs:
     - `\[Arena\.Net\] Connecting to ws://localhost:2567 room=<id> ...`
     - THEN ONE OF:
       - SUCCESS: `\[Arena\.Net\] Joined room <id>` + `\[Arena\.Phase\] -> waiting` (state diff) + `\[Arena\.Connecting\] Connected to room <id>`
       - REJECT (no room with id): `\[Arena\.Net\] Join failed: ...` + `\[Arena\.Connecting\] NetErrorEvent: code=JOIN_FAILED ...`
   - Either path = wiring proof. Document which path happened.

8. MCP `manage_editor` action="stop".
9. MCP `read_console` types=["error"] count=20.
   - Filter out 3× known baseline (PanelSettings) + 1× URP missing-types.
   - NEW errors from D.U2 code = FAIL. Report each verbatim.

## Output report cho Bill
- Pass/Fail per expected log line.
- Full log snippet (raw, paste-able).
- Error list with baseline subtracted (zero new errors expected).
- Whether ManualRoomConnect was used + which path (success vs reject).
- Recommendation: close D.U2 here (D.U2a complete) OR extend to D.U2b if server D.3 has shipped.

## STOP
KHÔNG commit. Đợi Opus session viết REPORT.md (Stage 4) → Move folder qua done/ (Stage 5).
```

---

## Bill checkpoints recap

| After Sub | Bill action |
|---|---|
| Sub 1 | Confirm Colyseus namespace + Newtonsoft availability + asmdef name. Adjust Sub 8 asmdef ref if needed. |
| Sub 2 | (Optional) cross-ref schema field order vs server `schemas.ts` — Opus already mirrored from server-extract, but Bill peek doesn't hurt. |
| Sub 7 | Quick code review of NetClient.cs (main artifact). |
| Sub 8 | SET `EditorPrefs["RadiantArena.ArenaTokenSecret"]` = matching server's `ARENA_TOKEN_SECRET`. |
| Sub 10 | Confirm scene has 4 GOs after save. If `manage_components` fails to resolve `RadiantArena.Net.NetClient`, Bill adds component manually. |
| Sub 11 | Bill starts arena-server, (optional) pre-creates a room with bill_test_001 in roster, paste roomId into ManualRoomConnect. Decide D.U2a close vs extend D.U2b. |

## Notes
- Mỗi prompt self-contained — Opus session reset OK, full context từ Read prereqs.
- Pre-commit hook fail → fix root, NEW commit (KHÔNG `--amend` per Bash guidance trong CLAUDE.md).
- MCP unavailable mọi sub → báo Bill, KHÔNG silent manual fallback.
- Asmdef names trong Sub 8 dependent on Sub 1 verification (Colyseus asmdef actual name).
