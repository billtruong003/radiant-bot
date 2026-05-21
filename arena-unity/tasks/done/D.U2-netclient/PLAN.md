# D.U2 — NetClient + Colyseus connect · PLAN

> Stage 1 (Architect) output. Bill confirm trước khi Opus execute Stage 2.
> Date: 2026-05-17 · Executor: Opus 4.7 (per D.U1 precedent — Bill chose Opus over Sonnet)

---

## 1. Goal

Stand up the **Net layer** for Radiant Arena: hand-mirror Colyseus schemas, write `NetClient` MonoBehaviour singleton that owns the Colyseus connection + state subscription, fire `Bill.Events` so the rest of the codebase never touches `Room<DuelState>` directly. Provide an Editor-only path to mint dev tokens + manually connect to a locally running `arena-server` (the prod admin-create-room endpoint isn't shipped yet — server Lát D.3 blocker).

Concretely, after D.U2:
- Project compiles cleanly in WebGL target with Colyseus SDK references resolved.
- `ArenaBootstrap` fires `ArenaBootstrapReadyEvent`, then `BootState` parses URL (`?room=X&t=Y&session=Z`) and transitions to `ConnectingState`.
- `ConnectingState` invokes `NetClient.ConnectAsync()`; success → `NetConnectedEvent` + `state.phase=lobby` observed in `ArenaContext`.
- 2 Editor instances (ParrelSync) can join the same `arena-server` room and both see `phase=lobby` (smoke gated by D.U2b — needs server D.3 OR `DevTokenSigner` interim).

---

## 2. Scope split (D.U2a now, D.U2b after server D.3 + D.4)

Per `arena-unity/server-extract-2026-05-15.md` §J — server is at Lát D.2, no admin endpoint, no message handlers. We can write the wiring but can't end-to-end smoke until server D.3/D.4 ship.

| Sub-scope | Status | Notes |
|---|---|---|
| **D.U2a (this Lát)** | | |
| Hand-mirror 7 Colyseus schema classes | ✅ GO | Server schemas stable since `d701968` |
| `NetClient.cs` Colyseus client + state subscription | ✅ GO | Receives `OnStateChange` regardless of message protocol |
| `ArenaContext.cs` hydration helper | ✅ GO | |
| `UrlParser.cs` parse `Application.absoluteURL` | ✅ GO | |
| `BootState` + `ConnectingState` | ✅ GO | |
| `DevTokenSigner.cs` (Editor-only HMAC signer) | ✅ GO | Per spec in server-extract §E |
| `ManualRoomConnect.cs` (Editor-only paste-and-connect window) | ✅ GO | Workaround for missing `?room=` URL |
| **D.U2b (deferred until server D.3 + D.4)** | | |
| Outbound message protocol (`select_weapon`, `ready`, `shoot`, ...) wiring | ⏸ STUB only | Subs include payload structs, but no Send() calls yet — gameplay láts will add. |
| S→C broadcast handlers (`match_start`, `shot_resolved`, ...) | ⏸ STUB only | `OnMessage` callbacks registered as no-ops so adding payloads later is mechanical. |
| End-to-end 2-instance smoke (both reach phase=lobby) | ⏸ BLOCKED on server D.3 | D.U2a smoke = compile + attempt-connect logging; full smoke deferred. |

**Implication**: D.U2 closes on D.U2a DoD. D.U2b unblocks the moment server D.3 lands; the OPUS_PROMPTS doc keeps a small backlog for the "wire it up after server ships" follow-up.

---

## 3. Project state (verified 2026-05-17)

- ✅ Unity 6000.2.7f2, build target WebGL, IL2CPP, .NET Std 2.1 (D.U1 closed).
- ✅ `Assets/RadiantArena/Scripts/{Bootstrap,Net,States,Events,UI}/` scaffolded; `Net/States/UI` empty.
- ✅ `ArenaBootstrap.cs` fires `ArenaBootstrapReadyEvent` — D.U2 `BootState` subscribes to this.
- ✅ Colyseus SDK installed: `Library/PackageCache/io.colyseus.sdk@b4b1da15d686` (v0.15.x, schema v2 compatible per server-extract §A).
- ✅ NativeWebSocket installed: `Library/PackageCache/com.endel.nativewebsocket@522f0c3f5c2e` (Colyseus transitive dep).
- ✅ ParrelSync installed: `Library/PackageCache/com.veriorpies.parrelsync@256065af1fc7`. Use for 2-instance smoke later.
- ✅ Newtonsoft.Json available as `com.unity.nuget.newtonsoft-json` in lock (transitive via Colyseus or VS). Needed for `DevTokenSigner` JSON serialization with explicit field order.
- ⚠️ `arena-server` lives at `c:\Users\ADMIN\Downloads\Discord Sever\arena-server\` (separate repo). Bill runs `pnpm dev` there for smoke; URL `ws://localhost:2567`.
- ⚠️ Server Lát D.3 NOT shipped — no admin endpoint. Smoke needs Bill to either (a) call Colyseus client's `create('duel', { players, session_id, ... })` directly from a temporary Editor REPL, or (b) wait for server D.3.
- ⚠️ `Bill.Net` is **Photon-shaped** (`CreateRoom`/`JoinRoom` adapter pattern) — does NOT fit Colyseus's `JoinById(roomId, options)` semantics. D.U2 deliberately does NOT use `Bill.Net`; the `RADIANT_ARENA_UNITY.md` §3 table already documents this exception.

---

## 4. Files this Lát will touch (absolute paths)

| Path | Action | Purpose |
|---|---|---|
| `Assets/RadiantArena/Scripts/Net/MessageSchemas.cs` | CREATE | 7 hand-mirror Colyseus.Schema classes (DuelState, PlayerSchema, WeaponSchema, ...). |
| `Assets/RadiantArena/Scripts/Net/MessageTypes.cs` | CREATE | Outbound payload structs + inbound message DTOs (deserialized via Colyseus message decoder). Stub for D.U2b. |
| `Assets/RadiantArena/Scripts/Net/ArenaContext.cs` | CREATE | Static singleton — `MyDiscordId`, `OpponentDiscordId`, `CurrentPhase`, `PlayerSnapshot` × 2. Hydrated by NetClient on every `OnStateChange`. |
| `Assets/RadiantArena/Scripts/Net/ConnectionInfo.cs` | CREATE | Struct: `{ wsUrl, roomId, sessionId, token }`. Returned by UrlParser. |
| `Assets/RadiantArena/Scripts/Net/UrlParser.cs` | CREATE | Parse `Application.absoluteURL` query string. WebGL-safe (no `System.Web`); manual `&`/`=` split. |
| `Assets/RadiantArena/Scripts/Net/NetClient.cs` | CREATE | `MonoBehaviour` singleton. Owns `ColyseusClient` + `ColyseusRoom<DuelState>`. Public: `ConnectAsync(ConnectionInfo)`, `Send(type, payload)`, `Disconnect()`. Wires `OnStateChange` → `ArenaContext.HydrateFrom` → Bill.Events. |
| `Assets/RadiantArena/Scripts/Events/ArenaEvents.cs` | EDIT | Add: `NetConnectedEvent`, `NetDisconnectedEvent`, `NetErrorEvent`, `PhaseChangedEvent`, `InitialStateReceivedEvent`. Keep `ArenaBootstrapReadyEvent`. |
| `Assets/RadiantArena/Scripts/States/BootState.cs` | CREATE | `IState` impl. On enter: parse URL via `UrlParser`, populate `ArenaContext.MyDiscordId`, transition → `ConnectingState`. |
| `Assets/RadiantArena/Scripts/States/ConnectingState.cs` | CREATE | `IState` impl. On enter: call `NetClient.ConnectAsync`, subscribe to `NetConnectedEvent` / `NetErrorEvent`, transition (D.U2a stops here — no `LobbyState` yet, lát D.U3). |
| `Assets/RadiantArena/Scripts/States/ArenaStates.cs` | CREATE | Centralized state registration helpers (`RegisterArenaStates()` called from ArenaBootstrap or a new RadiantArena.asmdef bootstrapper). |
| `Assets/RadiantArena/Scripts/Bootstrap/ArenaBootstrap.cs` | EDIT | Add state registration: `Bill.State.Register<BootState>(...)` etc. after `InitArena`. Add NetClient GO existence check. |
| `Assets/RadiantArena/Editor/DevTokenSigner.cs` | CREATE | Editor-only static helper. HMAC-SHA256 mint per server-extract §D spec. Secret from `EditorPrefs["ArenaTokenSecret"]`. |
| `Assets/RadiantArena/Editor/ManualRoomConnect.cs` | CREATE | `EditorWindow` — paste `wsUrl`, `roomId`, `sessionId`, `discord_id`; click "Mint Token + Connect"; calls `NetClient.Instance.ConnectAsync(...)` in Play mode. Saves last values to EditorPrefs. |
| `Assets/RadiantArena/Editor/RadiantArena.Editor.asmdef` | CREATE | Editor assembly so DevTokenSigner / ManualRoomConnect aren't compiled into WebGL. References `RadiantArena.Runtime` (we'll create the runtime asmdef too). |
| `Assets/RadiantArena/Scripts/RadiantArena.Runtime.asmdef` | CREATE | Runtime assembly. References Colyseus, NativeWebSocket, BillGameCore, Newtonsoft.Json (for ArenaTokenSigner runtime piece if needed). |
| `Assets/RadiantArena/Scenes/Bootstrap.unity` | EDIT (via MCP) | Add `[NetClient]` GameObject with `NetClient` component (sibling to `[ArenaBootstrap]`). Save scene. |
| `arena-unity/tasks/todo/D.U2-netclient/PLAN.md` | CREATE (this file) | |
| `arena-unity/tasks/todo/D.U2-netclient/SUBTASKS.md` | CREATE | |
| `arena-unity/tasks/todo/D.U2-netclient/OPUS_PROMPTS.md` | CREATE | Per-sub copy-paste prompts. |

**Out-of-scope** (defer to D.U3+):
- No `LobbyState`, `MyTurnState`, `OpponentTurnState`, `AnimatingState`, `EndState` — D.U3+.
- No UI Toolkit panels — D.U3+.
- No `WeaponPrefabRegistry`, `WeaponDatabase` — D.U8.

---

## 5. Public APIs used

### 5.1 BillGameCore surface (verified by reading `Assets/BillGameCore/Runtime/Infrastructure/Interfaces.cs` + `Bootstrap/Bill.cs`)

| API | Source | Use in D.U2 |
|---|---|---|
| `Bill.IsReady` | `Bootstrap/Bill.cs:30` | Pre-connect guard inside `NetClient.Awake()` |
| `Bill.Events.Fire<T>(T evt)` | `Infrastructure/Interfaces.cs` | Fire `NetConnectedEvent`, `PhaseChangedEvent`, etc. |
| `Bill.Events.Subscribe<T>(Action<T>)` | same | `BootState`/`ConnectingState` subscribe to events |
| `Bill.Events.SubscribeOnce<T>(Action<T>)` | same | Useful in state OnEnter for first-shot wiring |
| `Bill.State.Register<TState>(...)` | StateMachine service | Register `BootState`/`ConnectingState` |
| `Bill.State.GoTo<TState>()` | same | Transition between states |
| `Bill.Timer.Delay(seconds, action)` | Services/Timer | Connect timeout (5s) wrapper |
| `Bill.Net` | `Network/NetworkService.cs` | **NOT used** — Colyseus is separate. Documented in `RADIANT_ARENA_UNITY.md` §3. |

### 5.2 Colyseus Unity SDK (v0.15.x — installed at `Library/PackageCache/io.colyseus.sdk@b4b1da15d686`)

| API | Use in D.U2 |
|---|---|
| `Colyseus.ColyseusClient(string wsUrl)` | Constructed in NetClient with wsUrl from UrlParser |
| `client.JoinById<TState>(roomId, options)` (Task) | Direct join with auth payload `new { token = "..." }` |
| `room.OnStateChange += (state, isFirstState) => ...` | Hydrate ArenaContext on every diff |
| `room.OnLeave += code => ...` | Fire `NetDisconnectedEvent` with reason code |
| `room.OnMessage<T>(string type, Action<T>)` | Subscribe to `error`, `match_start`, etc. (D.U2b will use; D.U2a registers no-op handlers so future wiring is mechanical) |
| `room.Send(string type, object payload)` | Wrap as `NetClient.Send(...)` (D.U2b activates) |
| `room.Leave()` | Disconnect on `OnDestroy` |
| `Colyseus.Schema.Schema` + `[Type("string")]`-equivalent attrs | Hand-mirror server `@type` decorators (Unity SDK uses `[Type(...)]` C# attribute syntax) |

### 5.3 Server-extract contract (cross-ref `arena-unity/server-extract-2026-05-15.md`)

| Aspect | Spec from extract |
|---|---|
| WS URL local | `ws://localhost:2567` |
| Schema v2 — field order matters | Decorator order MUST match TS class declaration order. Documented per Sub 2 step-by-step. |
| Token format | `<payloadB64Url>.<sigHex>` — base64url(JSON({session_id, discord_id, expires_at})) + HMAC-SHA256(payloadB64Url, secret) → hex |
| `MapSchema<PlayerSchema>` key | `discord_id` (string) |
| Phase values | `'waiting' \| 'lobby' \| 'countdown' \| 'active' \| 'animating' \| 'ended'` |
| Auth join shape | `client.JoinById(roomId, new { token = "..." })` — second arg as anonymous object |
| Close code on auth fail | 4215 (`onAuth` rejection) |
| Room creation responsibility | Server's `gameServer.define('duel', DuelRoom)` — room auto-created on `client.create('duel', opts)`. D.U2a uses ManualRoomConnect with pre-known roomId. |

---

## 6. Architecture decisions

### 6.1 NetClient is its own `MonoBehaviour`, NOT a `Bill.Net` adapter
- `INetworkAdapter` in BillGameCore has Photon-flavored `CreateRoom(id, max)` / `JoinRoom(id)` returning void via callbacks. Colyseus uses `JoinById<TState>` returning `Task<Room<TState>>` and exposes per-room state diffs that no adapter abstraction in BillGameCore can pass through.
- Forcing Colyseus into the adapter shape loses 90% of the SDK (state diff, OnMessage, OnLeave). Not worth it.
- Decision: `NetClient` is a standalone MonoBehaviour singleton in `RadiantArena.Net` namespace. Bypasses `Bill.Net` entirely. Documented in `RADIANT_ARENA_UNITY.md` §3 already.
- `Bill.Net` is still wired (OfflineAdapter default) so any future REST-only code can use it.

### 6.2 `ArenaContext` is the cross-boundary snapshot
- Gameplay components (UI, weapons, state machine) read from `ArenaContext` — never reach into `room.State` or `NetClient.Room`.
- Hydrated on every `OnStateChange` — full snapshot, not partial diff (Colyseus diff is field-level, but Unity gameplay reads single-snapshot view).
- Allows future swap-in of mock state for tests without touching gameplay.
- For D.U2a: only `CurrentPhase`, `MyPlayer`, `OpponentPlayer`, `MyDiscordId`, `OpponentDiscordId` are populated. Weapons / trajectory hydration is D.U3+.

### 6.3 Schemas hand-mirrored, NOT generated
- Per server-extract §A: no `.fbs` codegen pipeline exists on server side. Manual mirror keeps things simple.
- 7 schema classes is small; manual sync cost is low.
- When server schemas change (e.g., D.5 adds `active_zones`), update the C# mirror in lockstep — flag in PR description.

### 6.4 URL parsing — WebGL safe
- Reference impl in `RADIANT_ARENA_UNITY.md` §4.2 uses `System.Web.HttpUtility.ParseQueryString` which is NOT available in WebGL.
- D.U2 writes a manual `string.Split('?')` + `&`/`=` split. Verified against query strings `?room=ABC123&t=<token>&session=<uuid>`.
- Fallback for empty `Application.absoluteURL` (Editor): return `("ws://localhost:2567", "", "", "")` — DevTokenSigner + ManualRoomConnect fill the gap in Editor.

### 6.5 DevTokenSigner — Editor-only, never compiled into player builds
- Implementation lives under `Assets/RadiantArena/Editor/`, guarded by `RadiantArena.Editor.asmdef` with `"includePlatforms": ["Editor"]`. Player builds skip the file entirely.
- Secret stored in `EditorPrefs["RadiantArena.ArenaTokenSecret"]` — committed to local Editor only, NOT committed to git.
- Token expiry: `DateTimeOffset.UtcNow.AddMinutes(15).ToUnixTimeMilliseconds()` — short window for safety.
- Round-trip validation: when Bill mints a token via Editor window, the window shows the encoded payload + hex sig so Bill can `curl` the server's `/admin/verify-token` debug route (if added later) to confirm parity. For D.U2a, parity is checked indirectly via successful WS join.

### 6.6 State machine — only 2 states this Lát
- `BootState` (entry) → `ConnectingState` (NetClient.ConnectAsync) → STOP (D.U2a).
- D.U3 adds `LobbyState` listening for `PhaseChangedEvent` with `newPhase="lobby"`.
- `ArenaBootstrap` registers `BootState` and `ConnectingState` after gate. Initial state is `BootState`.

### 6.7 Asmdef split: Runtime vs Editor
- Runtime asmdef: `RadiantArena.Runtime` — referenced by Player. Contains Bootstrap, Net, States, Events, UI scripts.
- Editor asmdef: `RadiantArena.Editor` — Editor-only. Contains DevTokenSigner, ManualRoomConnect.
- References Colyseus + NativeWebSocket + BillGameCore + (Editor only) Newtonsoft.Json.

### 6.8 Error handling — fail closed
- `NetClient.ConnectAsync` catches all exceptions, fires `NetErrorEvent { code, message }`, returns. Never throws.
- Token missing → `NetErrorEvent { code = "MISSING_TOKEN" }` BEFORE attempting connection (saves a roundtrip).
- WS upgrade rejected (4215) → caught as `JoinException` → `NetErrorEvent { code = "AUTH_REJECTED" }`.
- Generic catch → `NetErrorEvent { code = "JOIN_FAILED", message = e.Message }`.
- `ConnectingState` listens to `NetErrorEvent`, on receive: log + (D.U3+) transition to an error screen. D.U2a: stays in state with log.

---

## 7. MCP touchpoints

Per `ROADMAP.md` §5: D.U2 = `manage_script`, `read_console`, `manage_gameobject`, `manage_components`.

| Step | MCP tool | Why |
|---|---|---|
| Verify Colyseus SDK namespace compiles | `read_console` (with `filter_text=Colyseus`) | Catch missing assembly refs early |
| Write C# scripts | `Edit` / `Write` (NOT `manage_script`) | Plain C# — Edit is faster; use `refresh_unity` after to trigger compile |
| Trigger recompile after script edits | `refresh_unity` | Forces AssetDatabase.Refresh |
| Poll compile status | `editor_state` resource (`isCompiling` field) | Avoid racing into next step before compile done |
| Read console after compile | `read_console` types=["error"] | Block sub completion on any error |
| Add `[NetClient]` GameObject to Bootstrap.unity | `manage_gameobject` (create) + `manage_components` (add NetClient component) | Avoid manual Editor click |
| Save scene | `manage_scene` (save) | Persist scene changes |
| Smoke verify | `manage_editor` (play/stop) + `read_console` filter `Bill\|Arena\|Net` | Confirm log sequence |

**Fallback if MCP unavailable**: report blocker to Bill, ask him to do (a) start Unity, (b) start MCP server. Do NOT silent fall back through filesystem edits past the script writes — scene/GameObject ops MUST go through MCP or Bill manually.

---

## 8. Smoke test plan

### 8.1 Compile gate (after every sub that touches .cs)
1. `refresh_unity` → wait `editor_state.isCompiling=false`
2. `read_console` types=["error"] → must be empty
3. If errors → STOP, fix, retry

### 8.2 D.U2a smoke (Sub 11)
**Goal**: Compile clean + ManualRoomConnect can ATTEMPT a connection (even if server rejects — proves wiring).

1. Bill starts `arena-server` locally: `cd c:\Users\ADMIN\Downloads\Discord Sever\arena-server\ && pnpm dev` → confirm `[arena] listening on :2567`.
2. In Unity Editor:
   - Open `Assets/RadiantArena/Scenes/Bootstrap.unity`.
   - Open `Window > Radiant Arena > Manual Room Connect` (added by Sub 8).
   - Set EditorPrefs `RadiantArena.ArenaTokenSecret` to match server's `ARENA_TOKEN_SECRET` env (server's `.env` or default — Bill confirms).
   - Paste fields: `wsUrl=ws://localhost:2567`, `roomId=<from server console>`, `sessionId=test_session_001`, `discord_id=bill_test_001`.
   - Click "Mint Token + Connect".
3. Press Play. Expected console logs:
   ```
   [Bill] Ready. ...
   [Arena] bootstrap ready ...
   [Arena.State] -> Boot
   [Arena.Boot] URL parsed: wsUrl=..., session=..., token=... (15 chars)
   [Arena.State] Boot -> Connecting
   [Arena.Net] Connecting to ws://localhost:2567 ...
   ```
   Then ONE of:
   - **Best case** (Bill manually pre-created a room with this discord_id in roster): `[Arena.Net] Joined room ABC123 as bill_test_001` + `[Arena.Phase] waiting` → success.
   - **Likely case** (server has no matching room): `[Arena.Net] JoinException: room ABC123 not found` → `NetErrorEvent { code=JOIN_FAILED }` fired → proves wiring works, just no room exists yet.
4. Exit Play. Console MUST have zero new errors beyond baseline.

### 8.3 D.U2b smoke (deferred)
**Goal**: 2 Editor instances both reach `phase=lobby`. **Blocked on**:
- arena-server D.3 admin endpoint (so a room can be created with 2 roster entries)
- OR DevTokenSigner-friendly seed script in arena-server

When unblocked, the OPUS_PROMPTS doc has a Sub 12 hook ready (commented out for now). For D.U2 close: skip 8.3, document as known follow-up in REPORT.md.

---

## 9. Bill checkpoints

These are decision points where Opus stops mid-execution and asks Bill before proceeding.

| After Sub | Checkpoint |
|---|---|
| Sub 1 (verify baseline) | Confirm Colyseus SDK namespaces accessible — if compile fails on `using Colyseus;`, blocker. |
| Sub 2 (schemas) | Confirm field order matches TS verbatim — Bill may want to cross-ref server's `schemas.ts` against the C# mirror once before continuing. |
| Sub 7 (NetClient) | Quick review — `NetClient` is the main artifact. Bill may want to tweak event-fire patterns before next subs depend on it. |
| Sub 8 (DevTokenSigner) | **Bill provides ARENA_TOKEN_SECRET via EditorPrefs**. Opus pauses to let Bill set this. |
| Sub 11 (smoke) | Bill runs arena-server, paste roomId, decides whether D.U2 closes here or extends to D.U2b. |

---

## 10. Risks / unknowns

| Risk | Mitigation |
|---|---|
| Colyseus Unity SDK API surface drifted from `RADIANT_ARENA_UNITY.md` §4 reference code | Sub 1 verifies actual namespace + method signatures via `find_in_file` MCP tool over `Library/PackageCache/io.colyseus.sdk@.../Runtime`. |
| `Newtonsoft.Json` not in transitive deps | Verify in Sub 1 by checking `Packages/packages-lock.json` for `com.unity.nuget.newtonsoft-json`. If missing, manifest add + commit before Sub 8. |
| WebGL doesn't allow `HMACSHA256` synchronously | DevTokenSigner is Editor-only — runs on .NET full framework. WebGL build never compiles this file (asmdef Editor-platform filter). Verify by building WebGL after Sub 8. |
| `Application.absoluteURL` empty in Editor | UrlParser returns sane defaults: `wsUrl=ws://localhost:2567`, others empty strings. ManualRoomConnect overrides for Editor smoke. |
| Server room name pattern differs from URL `?room=` value | D.U2a accepts the gap — ManualRoomConnect takes raw roomId from server console. D.U2b will be fixed when server D.3 returns roomId via admin endpoint. |
| Schema v2 attribute syntax mismatch | Sub 2 verifies one schema first via dry compile, then mirrors remaining 6. |
| Lát D.U1 closed but state machine wiring (`Bill.State.Register`) untested in actual flow | Sub 9 + Sub 10 + Sub 11 verify end-to-end. |

---

## 11. Definition of Done (D.U2a close)

- [ ] Console clean (zero compile errors) on WebGL build target.
- [ ] All 11 subs committed (Sub 1 + Sub 11 are verify-only — 9 commits).
- [ ] `NetClient` GameObject in `Bootstrap.unity`, with `NetClient` component attached.
- [ ] Smoke (§8.2): Play mode shows full Bill + Arena boot log + attempt-connect log + NetErrorEvent or NetConnectedEvent (one of the two — either is wiring proof).
- [ ] No new warnings beyond baseline (3× PanelSettings, 1× URP missing-types from D.U1 carryover).
- [ ] REPORT.md drafted with: shipped files + commit list + deviations + D.U2b backlog.
- [ ] Folder moved `tasks/todo/D.U2-netclient/ → tasks/done/D.U2-netclient/`.

D.U2b (full 2-instance smoke) is OUT OF SCOPE for this close — tracked as follow-up under D.U3 prep notes.
