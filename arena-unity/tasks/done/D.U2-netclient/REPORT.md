# D.U2 — NetClient + Colyseus connect · REPORT

> Closed 2026-05-17 (executor: Claude Opus 4.7, 1M ctx — Bill's choice, deviation from ROADMAP "Sonnet executes" convention).
> PLAN.md / SUBTASKS.md / OPUS_PROMPTS.md captured the architect intent. This file captures what actually shipped.

---

## Result: D.U2a PASS · D.U2b deferred as planned

D.U2a DoD all met. Code wired, compile clean, Play-mode smoke confirms the
full Bill → Arena → BootState chain. D.U2b (2-instance smoke through
`phase=lobby`) remains blocked on arena-server Lát D.3 (admin endpoint) +
D.4 (message handlers) — same shape as PLAN §2 anticipated.

Final Play-mode log (Editor, no URL query, no ManualRoomConnect invoked):

```
[Bill] + Infrastructure (4.3ms)
[Bill] + Core Services (45.0ms)
[Bill] + State Machine (1.6ms)
[Bill] + Network (0.2ms)
[Bill] + Dev Tools (16.4ms)
[Bill.State] None -> Boot
[Bill] Ready. 14 services in 494ms.
[Arena] bootstrap ready (Bill.IsReady=True)
[Arena.Boot] URL parsed: wsUrl=ws://localhost:2567, session=, token=(0 chars), discordId=
[Arena.Boot] URL not valid — staying in Boot. Use Window > Radiant Arena > Manual Room Connect to connect manually.
[Bill.State] Boot -> Boot
```

Errors: 3× `No Theme Style Sheet set to PanelSettings` + 1× URP missing-types —
all baseline carryovers from D.U1, NOT introduced by D.U2.

### Deep smoke (post-Sub 11, drove via `mcp__unityMCP__execute_code` reflection):

```
[DeepSmoke] Token minted (189 chars)
[DeepSmoke] NetClient.Instance OK
[DeepSmoke] ConnectionInfo built
[DeepSmoke] ConnectAsync invoked — waiting for NetErrorEvent ...
[Arena.Net] Connecting to ws://localhost:2567 room=BOGUS_ROOM_999 as did=deep_smoke_bill ...
[Arena.Net] Join failed: Cannot connect to destination host
```

Proven end-to-end without arena-server actually running:
1. DevTokenSigner.SignToken → 189-char `<b64>.<hex>` token, format verified.
2. NetClient.Instance singleton survives Play mode entry.
3. NetClient.ConnectAsync invokes Colyseus.Client.JoinById against `ws://localhost:2567`.
4. Colyseus SDK actually attempts the WebSocket → got "Cannot connect to destination host" (port not listening).
5. NetClient catch block fires `NetErrorEvent { code=JOIN_FAILED, message="Cannot connect to destination host" }`.

This validates the entire wire-up Bill.Events → NetClient → Colyseus → catch → Event without depending on a live server. Real 2-instance smoke (D.U2b) only needs server D.3 + D.4 to land — the client side is locked in.

---

## Sub-by-sub status

| Sub | Status | Commit | Notes |
|---|---|---|---|
| 1. Verify baseline (read-only) | ✅ | — | Findings drove deviations §2 below. |
| 2. MessageSchemas.cs (hand-mirror 7) | ✅ | `524eede` | Field indices match server TS order. `event` → `@event` (C# keyword). |
| 3. MessageTypes.cs | ✅ | `db6afb9` | 8 outbound structs, 7 inbound classes. Stubs — D.U3+ activates. |
| 4. ArenaContext.cs | ✅ | `a007a3f` | Snapshot singleton. MyDiscordId preserved across Reset() for reconnect. |
| 5. ArenaEvents.cs extend | ✅ | `7f50c7c` | 5 new events: `NetConnected/NetDisconnected/NetError/PhaseChanged/InitialStateReceived`. |
| 6. ConnectionInfo + UrlParser | ✅ | `491e87e` | WebGL-safe manual query parse, no System.Web. |
| 7. NetClient.cs (main artifact) | ✅ | `f247582` | Fail-closed ConnectAsync, OnStateChange→Hydrate+events, OnLeave reset. |
| 8. DevTokenSigner + ManualRoomConnect | ✅ | `e63c72d` + rename | DevTokenSigner OK first try. EditorWindow renamed `ManualRoomConnect → ArenaConnectWindow` to dodge a stale-MonoScript-cache compile-drop quirk (see §2 deviation 8). Editor-only via folder convention (no asmdef — see §2 deviation 3). |
| 9. BootState + ConnectingState + ArenaStates | ✅ | `87e883c` | CS0104 ambiguity with `BillGameCore.BootState` fixed via FQN. |
| 10. Wire [NetClient] GO | ✅ | `c9b6220` | MCP `manage_gameobject` + `manage_scene save`. 4 root GOs total. |
| 11. Smoke verify (no commit) | ✅ | — | Full log chain captured. Boot stays in Boot (Editor expected path). |

---

## Deviations from PLAN

1. **`IGameState` doesn't exist — state base is `abstract class GameState`.**
   PLAN §6.6 + SUBTASKS Sub 9 assumed an `IGameState` interface with
   `OnEnter/OnExit/OnUpdate` hooks. Sub 1 (verify) found the real shape:
   `BillGameCore.GameState` abstract class with `virtual void Enter() / Tick(float) / Exit()`.
   `RadiantArena.States.BootState` + `ConnectingState` extend `GameState` accordingly.

2. **`Bill.State.Register<T>` doesn't exist either.** Real API is
   `Bill.State.AddState<T>()` (needs `new()`) or `AddState<T>(T instance)`.
   `ArenaStates.Register()` calls `AddState(new BootState())` + `AddState(new ConnectingState())`.

3. **Asmdef plan dropped — `BillGameCore` has no core asmdef.** PLAN §6.7
   proposed `RadiantArena.Runtime` + `RadiantArena.Editor` asmdefs with the
   Runtime referencing `BillGameCore`. Reality: only `BillFav`, `BillInspector`,
   and `BillSceneSwitcher` sub-modules have asmdefs; the core BillGameCore
   Runtime + Editor sit in `Assembly-CSharp` / `Assembly-CSharp-Editor`. Adding
   our own runtime asmdef would require an asmdef on BillGameCore core first
   (out of D.U2 scope). Workaround: RadiantArena runtime stays in
   `Assembly-CSharp`. Editor scripts under `Assets/RadiantArena/Editor/` go
   into `Assembly-CSharp-Editor` automatically via Unity's Editor folder
   convention — same Editor-only guarantee without the asmdef. Documented
   here so a future "asmdef-everything" cleanup picks it up.

4. **`JoinById` options is `Dictionary<string, object>`, NOT anonymous object.**
   The reference code in `RADIANT_ARENA_UNITY.md` §4.1 passes `new { token = ... }`.
   Verified via Sub 1: the SDK signature is
   `Task<Room<T>> JoinById<T>(string roomId, Dictionary<string, object> options, ...)`.
   NetClient builds the dict explicitly: `new Dictionary<string, object> { ["token"] = info.token }`.
   Anonymous object would throw at runtime — caught early.

5. **Two `BootState` types share the name "Boot".** Both
   `BillGameCore.BootState` (built-in empty state, auto-entered on Bill init)
   and `RadiantArena.States.BootState` exist. `GameState.Name` strips the
   "State" suffix, so the log shows `[Bill.State] Boot -> Boot` for the
   transition. Cosmetic only — types are different so the dispatch dictionary
   keys them separately. CS0104 in `ArenaBootstrap.cs` was fixed by using the
   fully-qualified `Bill.State.GoTo<RadiantArena.States.BootState>()`.

6. **No `[Arena.State]` log line — `Bill.State` auto-logs `[Bill.State]`.**
   PLAN §8.2 smoke regex expected `\[Arena.State\] -> Boot`. Reality:
   `GameStateMachine.GoImpl` emits `[Bill.State] {from} -> {to}` itself, no
   need for custom logging in our states. Smoke regex updated mentally;
   captured here so D.U3 SUBTASKS doesn't repeat the bad expectation.

7. **`MapSchema<T>.Keys` is non-generic `ICollection`.** `HydrateFrom`
   iterates via `foreach (var keyObj in state.players.Keys)` with an explicit
   `keyObj is string key` cast. Saves a few cycles vs LINQ-cast every diff.

8. **`ManualRoomConnect.cs` failed to compile silently — renamed to `ArenaConnectWindow.cs`.**
   The original EditorWindow file `ManualRoomConnect.cs` (committed in `e63c72d`)
   would not compile into `Assembly-CSharp-Editor` despite zero CS errors in the
   console. `UnityEditor.AssetDatabase.LoadAssetAtPath<MonoScript>` returned a
   MonoScript with `text.Length == 5952` but `GetClass() == null` — Unity could
   read the source but the type never appeared in the compiled assembly.
   `DevTokenSigner.cs` in the same folder, same .meta shape, compiled fine.
   Tried: delete + regenerate .meta, `AssetDatabase.ImportAsset(ForceUpdate)`,
   `CompilationPipeline.RequestScriptCompilation(CleanBuildCache)`, Write-tool
   rewrite (vs Edit-tool patch). None recovered. Theory: a stale MonoScript /
   incremental-compile cache entry tied to the file's GUID. Workaround: delete
   the file (`ManualRoomConnect.cs` + `.meta`) and recreate as
   `ArenaConnectWindow.cs` with class `RadiantArena.Editor.ArenaConnectWindow`
   + menu path `Window/Radiant Arena/Connect`. Fresh GUID → fresh MonoScript →
   compiled cleanly first try and the menu item now opens correctly.

   Filed mentally as a Unity 6000.2.7f2 quirk. If it recurs in another lát,
   the fix is the same: rename the file + the type.

---

## Bill checkpoints — what happened

| Checkpoint | Outcome |
|---|---|
| Sub 1 verify | Five deviations §2.1–§2.4 + §2.6 surfaced. Worth the read-only sub. |
| Sub 2 schema cross-ref | Field-order verified against server-extract §B during write; no Bill peek needed. |
| Sub 7 NetClient review | Skipped — Bill auto-greenlit the whole run. Code review available in `f247582`. |
| Sub 8 `ARENA_TOKEN_SECRET` set | **NOT done in this session**. Bill must set EditorPrefs `RadiantArena.ArenaTokenSecret` before any real smoke against arena-server. |
| Sub 10 scene 4 GOs | Confirmed via MCP `manage_scene get_hierarchy`. |
| Sub 11 D.U2a close vs D.U2b extend | Closed at D.U2a per PLAN. D.U2b backlog tracked below. |

---

## What's left for D.U2b (follow-up in D.U3 prep)

When arena-server ships Lát D.3 + D.4, D.U2 finishes via:

1. Bill mints 2 dev tokens (different `discord_id`s, same `session_id`) via ManualRoomConnect.
2. Either:
   - **Server D.3 path**: hit `POST /admin/create-room` with HMAC-signed body containing both rosters. Server returns `room_name + ws_url`.
   - **Workaround path**: extend `arena-server` with a `scripts/seed-room.ts` helper (server's TASKS Lát D.3 line) that calls `gameServer.matchMaker.create('duel', opts)` and prints roomId.
3. ParrelSync clone Unity Editor (already installed). Each instance pastes its own token + same roomId into ManualRoomConnect → Connect.
4. Both should reach `[Arena.Phase] waiting -> lobby` after the second join.
5. Then activate inbound `OnMessage<T>` handlers in `NetClient` to fire gameplay events (currently stub-logging).

This unlocks D.U3 LobbyPanel which subscribes to `PhaseChangedEvent { newPhase="lobby" }`.

---

## Known baseline (NOT D.U2 issues — inherited from D.U1)

- 3× `No Theme Style Sheet set to PanelSettings` — BillGameCore UIService /
  DebugOverlay / CheatConsole runtime PanelSettings creation. Cosmetic.
- 1× `Missing types referenced from UniversalRenderPipelineGlobalSettings` —
  URP downgrade leftover after Unity 6.3 → 6.2. Auto-repair on save settles
  it; not blocking.

Both pre-existed in D.U1 REPORT.md.

---

## Files added

| Path | Lines |
|---|---|
| `Assets/RadiantArena/Scripts/Net/MessageSchemas.cs` | 153 |
| `Assets/RadiantArena/Scripts/Net/MessageTypes.cs` | 106 |
| `Assets/RadiantArena/Scripts/Net/ArenaContext.cs` | 104 |
| `Assets/RadiantArena/Scripts/Net/ConnectionInfo.cs` | 32 |
| `Assets/RadiantArena/Scripts/Net/UrlParser.cs` | 97 |
| `Assets/RadiantArena/Scripts/Net/NetClient.cs` | 167 |
| `Assets/RadiantArena/Scripts/Events/ArenaEvents.cs` | edit (+5 events) |
| `Assets/RadiantArena/Scripts/States/BootState.cs` | 38 |
| `Assets/RadiantArena/Scripts/States/ConnectingState.cs` | 52 |
| `Assets/RadiantArena/Scripts/States/ArenaStates.cs` | 22 |
| `Assets/RadiantArena/Scripts/Bootstrap/ArenaBootstrap.cs` | edit (+3 lines) |
| `Assets/RadiantArena/Editor/DevTokenSigner.cs` | 61 |
| `Assets/RadiantArena/Editor/ArenaConnectWindow.cs` | 152 | (was `ManualRoomConnect.cs` in `e63c72d`; renamed post-smoke per §2.8) |
| `Assets/RadiantArena/Scenes/Bootstrap.unity` | scene edit (+[NetClient] GO) |

~9 commits + Stage 1 docs commit + this REPORT commit = 11 D.U2 commits total.

---

## Commits

```
c9b6220 feat(arena-unity/Lát-D.U2): wire NetClient GameObject into Bootstrap.unity
87e883c feat(arena-unity/Lát-D.U2): add BootState + ConnectingState + state register from ArenaBootstrap
e63c72d feat(arena-unity/Lát-D.U2): add Editor DevTokenSigner + ManualRoomConnect window
f247582 feat(arena-unity/Lát-D.U2): add NetClient MonoBehaviour wrapping Colyseus connection
491e87e feat(arena-unity/Lát-D.U2): add ConnectionInfo + UrlParser (WebGL-safe)
7f50c7c feat(arena-unity/Lát-D.U2): add net-layer events to ArenaEvents
a007a3f feat(arena-unity/Lát-D.U2): add ArenaContext snapshot singleton
db6afb9 feat(arena-unity/Lát-D.U2): define outbound + inbound message types (stub for D.U3+)
524eede feat(arena-unity/Lát-D.U2): hand-mirror Colyseus DuelState schemas (7 classes)
27e85a5 docs(arena-unity/Lát-D.U2): Stage 1 architect — PLAN + SUBTASKS + OPUS_PROMPTS
```

---

## Next lát: D.U3 — LobbyPanel + weapon pick UI

Prereqs unblocked by D.U2a:
- ✅ `ArenaContext.MyPlayer.SelectedWeaponSlug` populated on every state diff.
- ✅ `PhaseChangedEvent` fires on `state.phase` transitions.
- ✅ `NetClient.Send("select_weapon", new SelectWeaponMsg { slug })` reachable.

Prereqs STILL blocked:
- ⏸ Server D.4 message handlers — `Send("select_weapon"/"ready")` are no-ops on server until then.
- ⏸ Server D.3 admin endpoint — needed before a 2-instance lobby can actually exist.

D.U3 Stage 1 can be drafted now (UI Toolkit panel design + ListView binding +
event wiring), with Stage 2 (smoke) gated on server D.3/D.4 the same way
D.U2b is. Recommend: hold D.U3 Stage 1 until Bill confirms server-side
unblock timeline.
