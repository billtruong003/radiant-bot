# D.U2 — NetClient + Colyseus connect · SUBTASKS

> 11 subs, 9 commits. Subs 1 + 11 are verify-only (0 commit). Each sub = 1 paste into Opus session via `OPUS_PROMPTS.md`. STOP after each.
>
> **Hard rule**: 1 sub per invocation. Never chain.

---

## Sub 1 — Verify baseline (read-only, NO commit)

**Goal**: confirm Colyseus SDK + NativeWebSocket + Newtonsoft.Json compile + accessible namespaces before touching code.

**Actions**:
1. MCP `read_console` types=["error"] count=20 → must be empty.
2. MCP `find_in_file` paths=["Library/PackageCache/io.colyseus.sdk@b4b1da15d686"] pattern=`class ColyseusClient` → record file path + signature.
3. MCP `find_in_file` paths=["Library/PackageCache/io.colyseus.sdk@b4b1da15d686"] pattern=`class.*Room<` → record `ColyseusRoom<T>` signature.
4. MCP `find_in_file` paths=["Library/PackageCache/io.colyseus.sdk@b4b1da15d686/Runtime/Scripts/Serialization/Schema"] pattern=`class Schema` → confirm `Colyseus.Schema.Schema` is the base class.
5. Grep `Packages/packages-lock.json` for `com.unity.nuget.newtonsoft-json` → confirm present.
6. Verify `Bill.State` + `Bill.Events` API surface — read `Assets/BillGameCore/Runtime/Infrastructure/Interfaces.cs` (sections: `IStateService`, `IEventService`).

**Output to Bill**:
- ✅ / ❌ Colyseus namespace, with exact `using Colyseus;` confirmed importable.
- ✅ / ❌ Schema base class location.
- ✅ / ❌ Newtonsoft.Json available.
- BillGameCore APIs needed for Sub 9 (state register + transition signatures).
- Any blocker / surprise.

**DoD**: report posted, NO file change, NO commit. Bill confirms green-light Sub 2.

---

## Sub 2 — Write `Net/MessageSchemas.cs` (hand-mirror 7 schema classes)

**Goal**: Create `Assets/RadiantArena/Scripts/Net/MessageSchemas.cs` mirroring `arena-server/src/rooms/schemas.ts` verbatim.

**Source of truth**: `arena-unity/server-extract-2026-05-15.md` §B (raw TS schemas reproduced).

**Field-order rule**: Schema v2 encodes by index — C# property declaration order MUST match TS class field order.

**Schemas to mirror (7)**:
1. `WeaponStatsSchema` — 7 fields: `power`, `hitbox`, `bounce`, `damage_base`, `pierce_count`, `crit_chance`, `crit_multi`.
2. `WeaponVisualSchema` — 4 fields: `model_prefab_key`, `particle_fx_key`, `trail_fx_key`, `hue`.
3. `WeaponSkillSchema` — 5 fields: `skill_id`, `trigger`, `magnitude`, `cooldown`, `fx_key`.
4. `WeaponSchema` — 7 fields: `slug`, `display_name`, `category`, `tier`, `stats`, `visual`, `skills`.
5. `TrajectoryPointSchema` — 4 fields: `t`, `x`, `y`, `event`.
6. `PlayerSchema` — 11 fields: `discord_id`, `display_name`, `x`, `y`, `hp`, `hp_max`, `available_weapons`, `selected_weapon_slug`, `weapon`, `ready`, `connected`, `signature_cd_until`. ⚠️ Count again: extract shows 12 → re-count from TS source: 11 (per cursor: discord_id, display_name, x, y, hp, hp_max, available_weapons, selected_weapon_slug, weapon, ready, connected, signature_cd_until = 12. Use 12).
7. `DuelState` — 13 fields: `session_id`, `phase`, `players`, `turn_player_id`, `turn_deadline_at`, `join_deadline_at`, `round`, `stake`, `last_trajectory`, `last_shooter_id`, `winner_id`, `outcome`, `map_width`, `map_height` = 14. Use 14.

(Sub 1 will verify exact attribute syntax; this sub uses verified syntax.)

**Constraints**:
- Namespace: `RadiantArena.Net`.
- All field names in **snake_case** to match server JSON. Add `[Type(...)]` Colyseus attribute per field with matching type ("string"/"float32"/"uint8"/"uint16"/"uint32"/"boolean", or schema class type).
- Collection fields use `ArraySchema<T>` and `MapSchema<T>`.
- Nested schema fields default-construct (`new WeaponSchema()`, etc.) per server-extract Unity Hand-mirror note.
- `#nullable enable` ON.

**DoD**: file exists, `refresh_unity` triggers compile, `read_console` types=["error"] empty.

**Commit**: `feat(arena-unity/Lát-D.U2): hand-mirror Colyseus DuelState schemas (7 classes)`

---

## Sub 3 — Write `Net/MessageTypes.cs` (outbound + inbound DTOs)

**Goal**: Create `Assets/RadiantArena/Scripts/Net/MessageTypes.cs` with payload types for `Send()` and `OnMessage<T>()`.

**Outbound payload structs** (per server-extract §C, planned for server D.4):
```csharp
public struct SelectWeaponMsg { public string slug; }
public struct ReadyMsg { }
public struct UnreadyMsg { }
public struct ShootMsg { public float angle; public float power; }
public struct SignatureMsg { }
public struct ConcedeMsg { }
public struct AnimationCompleteMsg { public int round; }
public struct PingMsg { public long t; }
```

**Inbound message DTOs** (per server-extract §C broadcasts):
```csharp
public class MatchStartMessage { public string first_turn_id; public int seed; }
public class ShotResolvedMessage { public TrajectoryPointSchema[] trajectory; public string shooter; public float damage_dealt; public bool crit; }
public class TurnSwitchedMessage { public string new_turn_id; public long deadline_at; public int round; }
public class SignatureUsedMessage { public string player_id; public string skill_id; public string fx_key; }
public class MatchEndedMessage { public string winner; public string outcome; /* + final_hp dict */ }
public class PongMessage { public long t; public long server_t; }
public class ErrorMessage { public string code; /* + extra fields */ }
```

**Notes**:
- snake_case mirror for server contract. C# can deserialize via Colyseus's built-in message decoder which uses reflection on public fields.
- Outbound = structs (no GC). Inbound = classes (Colyseus instantiates).
- For D.U2a these are types-only — no `Send()` calls yet. D.U3+ activates.
- Namespace: `RadiantArena.Net`.

**DoD**: file compiles, console clean.

**Commit**: `feat(arena-unity/Lát-D.U2): define outbound + inbound message types (stub for D.U3+)`

---

## Sub 4 — Write `Net/ArenaContext.cs`

**Goal**: Create `Assets/RadiantArena/Scripts/Net/ArenaContext.cs` — static cross-boundary snapshot.

**Public surface**:
```csharp
public static class ArenaContext {
    public static string MyDiscordId { get; set; } = "";
    public static string OpponentDiscordId { get; set; } = "";
    public static string CurrentPhase { get; set; } = "waiting";
    public static int CurrentRound { get; set; } = 0;
    public static PlayerSnapshot? MyPlayer { get; private set; }
    public static PlayerSnapshot? OpponentPlayer { get; private set; }
    public static string SessionId { get; set; } = "";

    public static void HydrateFrom(DuelState state) { /* impl */ }
    public static void Reset() { /* clear all */ }
}

public class PlayerSnapshot {
    public string DiscordId = "";
    public string DisplayName = "";
    public float X = 0, Y = 0;
    public int Hp = 100, HpMax = 100;
    public string SelectedWeaponSlug = "";
    public bool Ready = false;
    public bool Connected = true;
    public long SignatureCdUntil = 0;

    public PlayerSnapshot() { }
    public PlayerSnapshot(PlayerSchema p) { /* copy from schema */ }
}
```

**Hydration logic** (`HydrateFrom`):
- Copy `state.session_id` → `SessionId`.
- Copy `state.phase` → `CurrentPhase`.
- Copy `state.round` → `CurrentRound`.
- Iterate `state.players` (MapSchema). For each entry:
  - If key == `MyDiscordId` → `MyPlayer = new PlayerSnapshot(value)`.
  - Else → `OpponentPlayer = new PlayerSnapshot(value)`; `OpponentDiscordId = key`.
- `MyDiscordId` is set by `BootState` from URL/EditorPrefs BEFORE first `HydrateFrom` call.

**Out-of-scope** (D.U3+): `WeaponDb`, `PrefabRegistry`, full weapon hydration. For D.U2 keep `MyPlayer.SelectedWeaponSlug` as raw string only — weapon object hydration deferred.

**Namespace**: `RadiantArena.Net`. `#nullable enable`.

**DoD**: file compiles, console clean.

**Commit**: `feat(arena-unity/Lát-D.U2): add ArenaContext snapshot singleton`

---

## Sub 5 — Extend `Events/ArenaEvents.cs`

**Goal**: Add net-layer events to existing `Assets/RadiantArena/Scripts/Events/ArenaEvents.cs`. Keep existing `ArenaBootstrapReadyEvent`.

**New events** (all `struct ... : IEvent`):
```csharp
public struct NetConnectedEvent { public string sessionId; public string roomId; }
public struct NetDisconnectedEvent { public int code; public string reason; }
public struct NetErrorEvent { public string code; public string message; }
public struct PhaseChangedEvent { public string oldPhase; public string newPhase; }
public struct InitialStateReceivedEvent { public string sessionId; }
```

**Comment header** updated to remove D.U2 placeholder line (since events now exist).

**Namespace**: `RadiantArena.Events`. `#nullable enable`.

**DoD**: file compiles, console clean.

**Commit**: `feat(arena-unity/Lát-D.U2): add net-layer events to ArenaEvents`

---

## Sub 6 — Write `Net/ConnectionInfo.cs` + `Net/UrlParser.cs`

**Goal**: Two files, but one logical unit (Sub 6 makes them one commit).

### 6a. `ConnectionInfo.cs`
```csharp
public struct ConnectionInfo {
    public string wsUrl;     // "ws://localhost:2567" or "wss://arena-api.billthedev.com"
    public string roomId;    // 9-char Colyseus auto-generated ID
    public string sessionId; // server-side session_id (from token payload)
    public string token;     // "<payloadB64>.<sigHex>"
    public string discordId; // self-identification

    public bool IsValid() =>
        !string.IsNullOrEmpty(wsUrl) &&
        !string.IsNullOrEmpty(roomId) &&
        !string.IsNullOrEmpty(token);
}
```

### 6b. `UrlParser.cs`
```csharp
public static class UrlParser {
    // Parses Application.absoluteURL like:
    //   "https://arena.billthedev.com/?room=ABC123&t=<token>&session=<uuid>&did=<discord_id>"
    // WebGL-safe — no System.Web.HttpUtility (not available in IL2CPP WebGL).
    public static ConnectionInfo Parse(string fullUrl) { ... }
}
```

**WebGL-safe query parsing**:
- Find `?` index. If absent → return defaults (`ws://localhost:2567`, all else empty).
- Split rest by `&`, then each by `=`.
- URL-decode values manually (`%20` → space, etc.) — or use `UnityWebRequest.UnEscapeURL`.

**Host → WS URL mapping**:
- `arena.billthedev.com` → `wss://arena-api.billthedev.com`.
- Anything else → `ws://localhost:2567` (dev fallback).

**Namespace**: `RadiantArena.Net`. `#nullable enable`.

**DoD**: file compiles, console clean.

**Commit**: `feat(arena-unity/Lát-D.U2): add ConnectionInfo + UrlParser (WebGL-safe)`

---

## Sub 7 — Write `Net/NetClient.cs`

**Goal**: Main artifact. `MonoBehaviour` singleton owning Colyseus connection + state subscription.

**Public surface**:
```csharp
public class NetClient : MonoBehaviour {
    public static NetClient? Instance { get; private set; }

    public ColyseusRoom<DuelState>? Room { get; private set; }
    public bool IsConnected => Room != null;
    public ConnectionInfo CurrentInfo { get; private set; }

    public async Task ConnectAsync(ConnectionInfo info) { ... }
    public void Send(string type, object payload) { ... }
    public void Disconnect() { ... }
}
```

**ConnectAsync impl outline**:
1. Validate `info.IsValid()` → if not, fire `NetErrorEvent { code="MISSING_TOKEN" }`, return.
2. Cache `CurrentInfo = info`, set `ArenaContext.MyDiscordId = info.discordId`, `ArenaContext.SessionId = info.sessionId`.
3. `var client = new ColyseusClient(info.wsUrl);`
4. Try-catch wrapping `Room = await client.JoinById<DuelState>(info.roomId, new { token = info.token });`
   - On exception: fire `NetErrorEvent { code="JOIN_FAILED", message=e.Message }`, log, return.
5. Wire `Room.OnStateChange += OnStateChange;`
6. Wire `Room.OnLeave += OnLeave;`
7. Register no-op `Room.OnMessage<T>(...)` for all 7 inbound types (D.U2b will activate). Each handler currently just `Debug.Log($"[Arena.Net] {type} received (no handler)")`.
8. Fire `NetConnectedEvent { sessionId=info.sessionId, roomId=info.roomId }`.

**OnStateChange handler**:
- Track `_lastPhase` for `PhaseChangedEvent` firing.
- Call `ArenaContext.HydrateFrom(state)`.
- If `state.phase != _lastPhase`: fire `PhaseChangedEvent { oldPhase=_lastPhase, newPhase=state.phase }`.
- If `isFirstState`: fire `InitialStateReceivedEvent { sessionId=info.sessionId }`.

**OnLeave handler**:
- Fire `NetDisconnectedEvent { code, reason="..." }`.
- Reset `Room = null`.

**Awake**:
- Singleton enforce: if `Instance != null && Instance != this` → `Destroy(gameObject); return;`.
- `Instance = this; DontDestroyOnLoad(gameObject);`.

**OnDestroy**:
- `Disconnect()`.
- `Instance = null`.

**Disconnect**:
- If `Room != null`: `Room.Leave(); Room = null;` (Leave is fire-and-forget).
- `ArenaContext.Reset()`.

**Send**:
- Guard `Room == null` → log warning + return.
- `Room.Send(type, payload);`.

**Namespace**: `RadiantArena.Net`. `#nullable enable`.

**DoD**: file compiles. Console clean. Console DOES log `[Arena.Net]` lines when called (Sub 11 verifies live).

**Commit**: `feat(arena-unity/Lát-D.U2): add NetClient MonoBehaviour wrapping Colyseus connection`

---

## Sub 8 — Write `Editor/DevTokenSigner.cs` + `Editor/ManualRoomConnect.cs` + Editor asmdef

**Goal**: Editor-only path to mint tokens + connect for smoke testing.

### 8a. `Assets/RadiantArena/Editor/RadiantArena.Editor.asmdef`
```json
{
    "name": "RadiantArena.Editor",
    "rootNamespace": "RadiantArena.Editor",
    "references": ["RadiantArena.Runtime", "Unity.Newtonsoft.Json"],
    "includePlatforms": ["Editor"],
    "autoReferenced": true
}
```

### 8b. `Assets/RadiantArena/Scripts/RadiantArena.Runtime.asmdef`
```json
{
    "name": "RadiantArena.Runtime",
    "rootNamespace": "RadiantArena",
    "references": ["BillGameCore", "io.colyseus.sdk"],
    "autoReferenced": true
}
```

(Asmdef references depend on Sub 1 confirming actual Colyseus asmdef name — `io.colyseus.sdk` vs `Colyseus`. Adjust accordingly.)

### 8c. `Editor/DevTokenSigner.cs`
- Static class.
- Public method: `static string SignToken(string sessionId, string discordId, long expiresAtUnixMs, string secret)`.
- Logic per server-extract §E:
  1. `payload = { session_id, discord_id, expires_at }` serialized via Newtonsoft (preserve field order).
  2. `payloadB64 = base64url(payloadBytes)`.
  3. `sigHex = HMAC-SHA256(payloadB64-as-bytes, secret).ToHex().ToLower()`.
  4. Return `$"{payloadB64}.{sigHex}"`.
- Field order: use `JsonConvert.SerializeObject(new JObject { ["session_id"]=..., ["discord_id"]=..., ["expires_at"]=... })` to ensure exact order.

### 8d. `Editor/ManualRoomConnect.cs`
- `EditorWindow` with `[MenuItem("Window/Radiant Arena/Manual Room Connect")]`.
- Fields (TextField/IntField in OnGUI), backed by `EditorPrefs`:
  - `RadiantArena.WsUrl` (default `ws://localhost:2567`)
  - `RadiantArena.RoomId` (no default)
  - `RadiantArena.SessionId` (default `test_session_001`)
  - `RadiantArena.DiscordId` (default `bill_test_001`)
  - `RadiantArena.ArenaTokenSecret` (passworded textfield, default empty)
- Buttons:
  - **"Mint Token (15 min)"** → calls `DevTokenSigner.SignToken(...)` → shows preview in read-only TextArea + copies to clipboard.
  - **"Connect"** → only enabled if Play mode active AND token preview non-empty. Calls `NetClient.Instance.ConnectAsync(new ConnectionInfo { ... })`.
  - **"Disconnect"** → calls `NetClient.Instance.Disconnect()`.

**Namespace**: `RadiantArena.Editor`. `#nullable enable`.

**DoD**: Both files compile (Editor only — verify by checking compile warning that WebGL would NOT include them via `manage_build` if needed). Console clean. Menu item appears in Unity Editor.

**Commit**: `feat(arena-unity/Lát-D.U2): add Editor DevTokenSigner + ManualRoomConnect window`

**Bill checkpoint**: After Sub 8 commit, Bill manually sets EditorPrefs `RadiantArena.ArenaTokenSecret` = same secret as `arena-server`'s `.env` `ARENA_TOKEN_SECRET`. Opus pauses + reminds Bill.

---

## Sub 9 — Write `States/BootState.cs` + `States/ConnectingState.cs` + `States/ArenaStates.cs`

**Goal**: Minimal state machine wiring. `BootState` parses URL, `ConnectingState` calls `NetClient.ConnectAsync`. Both registered with `Bill.State` from `ArenaBootstrap`.

### 9a. `States/BootState.cs`
- Implements BillGameCore's state interface (verified in Sub 1 — likely `IGameState` with `OnEnter` / `OnExit`).
- `OnEnter`:
  - Parse URL: `var info = UrlParser.Parse(Application.absoluteURL);`.
  - Log: `Debug.Log($"[Arena.Boot] URL parsed: wsUrl={info.wsUrl}, session={info.sessionId}, token=({info.token.Length} chars)");`.
  - If `info.IsValid()` → transition to `ConnectingState` via `Bill.State.GoTo<ConnectingState>()`.
  - Else → log + STAY in BootState (D.U2a: Editor uses ManualRoomConnect instead of URL).

### 9b. `States/ConnectingState.cs`
- `OnEnter`:
  - Find `NetClient.Instance` (must exist — wired in scene by Sub 10).
  - If `ArenaContext` already has connection info from ManualRoomConnect → fire and forget `NetClient.Instance.ConnectAsync(...)`.
  - Else → log: `[Arena.Connecting] Waiting for ManualRoomConnect or URL ...`.
- Subscribe to `NetConnectedEvent` → log connected (D.U3 will transition to LobbyState).
- Subscribe to `NetErrorEvent` → log error (D.U3+ will show error UI).
- `OnExit`: unsubscribe all.

### 9c. `States/ArenaStates.cs`
- Static helper: `public static void Register()` — calls `Bill.State.Register<BootState>(...)` + `Register<ConnectingState>(...)`.
- Called from `ArenaBootstrap.InitArena()` after the existing logic.

### 9d. Edit `Bootstrap/ArenaBootstrap.cs`
- After `Bill.Events.Fire(new ArenaBootstrapReadyEvent());` add:
  ```csharp
  ArenaStates.Register();
  Bill.State.GoTo<BootState>();
  ```

**Namespace**: `RadiantArena.States`. `#nullable enable`.

**DoD**: files compile. Console clean. Play mode shows `[Arena.State] -> Boot` log.

**Commit**: `feat(arena-unity/Lát-D.U2): add BootState + ConnectingState + state register from ArenaBootstrap`

---

## Sub 10 — Wire `[NetClient]` GameObject into `Bootstrap.unity`

**Goal**: Add `NetClient` MonoBehaviour-bearing GameObject to the boot scene so `NetClient.Instance` exists from Play mode start.

**Actions**:
1. MCP `manage_scene` action="load" path="Assets/RadiantArena/Scenes/Bootstrap.unity".
2. MCP `manage_gameobject` action="create" name="[NetClient]" position=(0,0,0).
3. MCP `manage_components` action="add" target="[NetClient]" component="RadiantArena.Net.NetClient".
4. MCP `manage_scene` action="save".
5. MCP `read_console` types=["error"] → empty.

**Optional**: Bill checkpoint — confirm scene has 4 GOs (`Main Camera`, `Directional Light`, `[ArenaBootstrap]`, `[NetClient]`).

**DoD**: scene saved, contains `[NetClient]` GO with `NetClient` component. Console clean.

**Commit**: `feat(arena-unity/Lát-D.U2): wire NetClient GameObject into Bootstrap.unity`

---

## Sub 11 — Smoke verify (NO commit)

**Goal**: Live Play-mode smoke. Confirm full boot → state transition → connect-attempt log chain. Per PLAN §8.2.

**Pre-conditions** (Bill's actions before Opus invocation):
- arena-server running: `cd c:\Users\ADMIN\Downloads\Discord Sever\arena-server\ && pnpm dev` → `[arena] listening on :2567`.
- EditorPrefs `RadiantArena.ArenaTokenSecret` set to match server.
- (Optional) Bill manually triggers a `client.create('duel', ...)` somewhere to spawn a room with a discord_id roster, then notes the auto-generated roomId.

**Actions**:
1. MCP `manage_scene` load Bootstrap.unity.
2. MCP `read_console` clear.
3. MCP `manage_editor` play → wait `editor_state.is_playing=true` AND `is_changing=false`.
4. MCP `read_console` types=["error", "warning", "log"] → capture all entries since Play start.
5. Expected log sequence (regex):
   - `\[Bill\] Ready\. \d+ services in \d+ms\.`
   - `\[Arena\] bootstrap ready \(Bill\.IsReady=True\)`
   - `\[Arena\.State\] .* -> Boot` (Bill.State announces transitions)
   - `\[Arena\.Boot\] URL parsed:`
   - EITHER `\[Arena\.State\] Boot -> Connecting` (URL had valid token) OR no Connecting transition (URL empty → BootState stays).
6. (If Bill used ManualRoomConnect): click "Connect" button → expect logs:
   - `\[Arena\.Net\] Connecting to ws://localhost:2567 ...`
   - THEN one of:
     - `\[Arena\.Net\] Joined room <id>` (success — server has matching room) → `\[Arena\.Phase\] waiting -> lobby` (state diff)
     - `\[Arena\.Net\] JoinException: ...` → `NetErrorEvent` fired → log present
7. MCP `manage_editor` stop.
8. Final `read_console` types=["error"] → no NEW errors beyond baseline (PanelSettings + URP carryover).

**DoD**:
- Console shows full log chain through `[Arena.State] -> Boot`.
- Either NetConnectedEvent path OR NetErrorEvent path fired — both prove wiring works.
- No NEW errors introduced by D.U2 code.

**NO commit** for Sub 11 — verification only.

**Bill checkpoint**: Bill reviews logs, decides whether to close D.U2 here OR extend to D.U2b (full 2-instance smoke) if server D.3 has shipped meanwhile.

---

## DoD overall (D.U2a close)

Match `TASKS.md` D.U2 line, with the D.U2a / D.U2b split applied:

- [x] (Sub 1) Colyseus SDK + NativeWebSocket + Newtonsoft.Json compile + accessible.
- [x] (Sub 2) 7 schemas hand-mirrored.
- [x] (Sub 3) Message types defined (stub for D.U2b).
- [x] (Sub 4) ArenaContext snapshot singleton.
- [x] (Sub 5) Net-layer events on `Bill.Events`.
- [x] (Sub 6) URL parsing + ConnectionInfo struct.
- [x] (Sub 7) `NetClient` wraps Colyseus connection + state diff + OnLeave + OnMessage stubs.
- [x] (Sub 8) Editor DevTokenSigner + ManualRoomConnect (interim for missing server D.3).
- [x] (Sub 9) BootState + ConnectingState + state register from ArenaBootstrap.
- [x] (Sub 10) `[NetClient]` GameObject in Bootstrap.unity.
- [x] (Sub 11) Smoke shows full boot → state → attempt-connect log chain. No new errors.

D.U2b (2-instance smoke through phase=lobby) explicitly **deferred** as known follow-up. REPORT.md will document this clearly so D.U3 picks it up correctly.
