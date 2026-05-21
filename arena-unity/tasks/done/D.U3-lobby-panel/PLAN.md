# D.U3 — LobbyPanel + weapon pick UI · PLAN

> Stage 1 (Architect). Bill confirm split + workflow → run Stage 2 sequentially.
> Date: 2026-05-17 · Executor: Opus 4.7 (per D.U1/D.U2 precedent).

---

## 1. Goal

Lobby phase UI: render the weapons **the server told us we own** (`PlayerSchema.available_weapons`), let me pick one + signal ready, observe opponent's ready state, transition to the next phase when server flips `state.phase` to `countdown`. Client never invents a weapon — UI is pure server-driven.

After D.U3a closes:
- `Bill.State` has 3 registered states now: `BootState`, `ConnectingState`, **`LobbyState`** (new).
- On `PhaseChangedEvent { newPhase = "lobby" }`, `ConnectingState` transitions to `LobbyState`.
- `LobbyState.Enter()` opens `LobbyPanel` via `Bill.UI.Open<LobbyPanel>()` and wires its callbacks to `NetClient.Send`.
- `LobbyPanel` renders the local player's weapon list from `ArenaContext.MyPlayer.AvailableWeapons`.
- Pick a weapon → `NetClient.Send("select_weapon", new SelectWeaponMsg { slug })`. Click Ready → `Send("ready", new ReadyMsg())`. Click Unready → `Send("unready", new UnreadyMsg())`.
- Opponent ready state mirrored from `state.players[opponent].ready` via state diffs.
- `OnPhaseChanged → "countdown"` exits Lobby (placeholder `Bill.State.GoTo<...>()` deferred to D.U4 — for D.U3a we log + stay).

---

## 2. Scope split (D.U3a now, D.U3b after server D.3 + D.4)

| Sub-scope | Status | Notes |
|---|---|---|
| **D.U3a (this Lát)** | | |
| Extend `ArenaContext` + `PlayerSnapshot` with weapon hydration | ✅ GO | Build `WeaponSnapshot` from `WeaponSchema`, populate `MyPlayer.AvailableWeapons / Weapon / SelectedSlug`. |
| `LobbyPanel.uxml` + `lobby.uss` under `Resources/` | ✅ GO | UI Toolkit assets loaded via `Resources.Load<VisualTreeAsset>`. |
| `LobbyPanel.cs` extends `BillGameCore.BasePanel` | ✅ GO | `Build(root)` clones VisualTreeAsset, binds ListView, wires Ready button. Public events `OnWeaponPicked` + `OnReadyClicked` + `OnUnreadyClicked` for state machine to subscribe. |
| `LobbyState.cs` (new state) | ✅ GO | Replaces stop-in-Connecting behavior. On phase=lobby → open panel + wire. On phase=countdown → log + stub-transition (D.U4 will add CountdownState). |
| Wire `ConnectingState` → `LobbyState` on `PhaseChangedEvent { newPhase="lobby" }` | ✅ GO | Already half-wired in D.U2; activate the transition. |
| Register `LobbyState` in `ArenaStates.Register` | ✅ GO | One-liner append. |
| Mock-data smoke (without live server) | ✅ GO | Sub N runs `execute_code` to manually populate `ArenaContext.MyPlayer = new PlayerSnapshot(...)` with 6 weapons, then `Bill.State.GoTo<LobbyState>()` and confirm panel renders + click handlers fire. Proves UI without server. |
| **D.U3b (deferred until server D.3 + D.4)** | | |
| End-to-end smoke: 2 Editor instances reach phase=lobby together, both Ready → phase=countdown | ⏸ BLOCKED on server D.3 (admin endpoint) + D.4 (select_weapon/ready handlers) | Identical blocker shape to D.U2b. |
| Opponent's ready state mirror | ⏸ STUB | Code is wired (reads `ArenaContext.OpponentPlayer.Ready`), but only an opponent connection produces the data. |

---

## 3. Project state (verified)

- ✅ D.U2 closed: `NetClient.Instance`, `ArenaContext.HydrateFrom`, all 5 net events, `MessageTypes.SelectWeaponMsg/ReadyMsg/UnreadyMsg` ready.
- ✅ `BillGameCore.BasePanel` abstract base with `Build(VisualElement)`, `OnOpened`, `OnClosed`. Lives at `Assets/BillGameCore/Runtime/Services/CoreServices.cs:79`. **Constraint**: `Build()` is code-first — UXML must be loaded explicitly via `Resources.Load<VisualTreeAsset>(name).CloneTree(root)`.
- ✅ `Bill.UI.Open<T>(Action<T> setup)` overload exists → call it from `LobbyState.Enter()` with the wiring callback.
- ✅ Single `[Bill.UI]` UIDocument hosts all BasePanel roots — no need for per-panel GameObjects.
- ✅ Existing `PlayerSnapshot` (from D.U2 `ArenaContext.cs`) has `DiscordId/DisplayName/X/Y/Hp/HpMax/SelectedWeaponSlug/Ready/Connected/SignatureCdUntil`. **Missing for D.U3**: `AvailableWeapons[]` and `Weapon` (locked weapon after countdown). Sub 1 extends.
- ⚠️ `Resources.Load<VisualTreeAsset>` requires assets under `Assets/.../Resources/` folder. New folder: `Assets/RadiantArena/UI/Resources/`. UXML files exist as assets, picked up by AssetDatabase.

---

## 4. Files this Lát will touch

| Path | Action | Purpose |
|---|---|---|
| `Assets/RadiantArena/Scripts/Net/ArenaContext.cs` | EDIT | Add `WeaponSnapshot` class. Extend `PlayerSnapshot` with `AvailableWeapons: WeaponSnapshot[]` + `Weapon: WeaponSnapshot?`. Update `PlayerSnapshot(PlayerSchema)` ctor to hydrate. |
| `Assets/RadiantArena/UI/LobbyPanel.cs` | CREATE | BasePanel impl. Loads UXML+USS from Resources, binds ListView, exposes events. |
| `Assets/RadiantArena/UI/Resources/LobbyPanel.uxml` | CREATE | UI Toolkit layout: player slot indicators, weapon ListView, Ready/Unready button, opponent ready indicator. |
| `Assets/RadiantArena/UI/Resources/lobby.uss` | CREATE | Style sheet. Glassmorphism dark theme, minimal — gameplay-readable at 1280×720. |
| `Assets/RadiantArena/Scripts/States/LobbyState.cs` | CREATE | Open panel on enter, subscribe `PhaseChangedEvent`, route messages. |
| `Assets/RadiantArena/Scripts/States/ConnectingState.cs` | EDIT | On `PhaseChangedEvent { newPhase=lobby }` → `Bill.State.GoTo<LobbyState>()`. |
| `Assets/RadiantArena/Scripts/States/ArenaStates.cs` | EDIT | Append `Bill.State.AddState(new LobbyState())`. |
| `arena-unity/tasks/todo/D.U3-lobby-panel/{PLAN,SUBTASKS,OPUS_PROMPTS}.md` | CREATE (this set) | |

**Out-of-scope** (defer to D.U4+):
- `CountdownState` — D.U4 will add (3s countdown UI, transition to MyTurn/OpponentTurn).
- `TurnInputPanel`, `HudPanel`, weapon prefab loader — D.U4/D.U6/D.U8.
- Weapon `hue` runtime tint — D.U8.
- USS animations / juice — D.U7.

---

## 5. APIs used

### 5.1 BillGameCore
| API | Use |
|---|---|
| `BasePanel` (abstract) | `LobbyPanel : BasePanel` |
| `Bill.UI.Open<LobbyPanel>(Action<LobbyPanel>)` | `LobbyState.Enter` |
| `Bill.UI.Close<LobbyPanel>()` | `LobbyState.Exit` |
| `Bill.UI.IsOpen<LobbyPanel>()` | Defensive check in `LobbyState.Exit` |
| `Bill.Events.Subscribe<PhaseChangedEvent>(handler)` | Lobby + Connecting state listeners |
| `Bill.State.AddState<T>(T)` / `Bill.State.GoTo<T>()` | `ArenaStates.Register` + transitions |
| `Bill.Audio.PlayMusic("bgm_lobby", 1f)` | Skipped — no audio assets yet, defer to D.U7 |

### 5.2 Unity UI Toolkit
| API | Use |
|---|---|
| `VisualTreeAsset.CloneTree(VisualElement)` | Inflate UXML inside `Build(root)` |
| `StyleSheet` + `root.styleSheets.Add(...)` | Attach USS |
| `root.Q<T>(name)` | Lookup elements by `name="..."` attribute (ListView, Button, Label) |
| `ListView` with `makeItem`, `bindItem`, `itemsSource`, `selectionType=Single` | Weapon picker |
| `Button.clicked += handler` | Ready/Unready |
| `Resources.Load<VisualTreeAsset>("LobbyPanel")` + `Resources.Load<StyleSheet>("lobby")` | Asset loading from `Resources/` folder anywhere in Assets |

### 5.3 RadiantArena types (existing)
| API | Use |
|---|---|
| `RadiantArena.Net.ArenaContext.MyPlayer / OpponentPlayer` | Read snapshot, react to diffs |
| `RadiantArena.Net.NetClient.Instance.Send(string, object)` | Outbound messages |
| `RadiantArena.Net.SelectWeaponMsg / ReadyMsg / UnreadyMsg` | Payload types |
| `RadiantArena.Events.PhaseChangedEvent / InitialStateReceivedEvent` | State machine triggers |

---

## 6. Architecture decisions

### 6.1 UXML + USS, not pure-C# UI
`BasePanel.Build(root)` is code-first but nothing prevents inflating a UXML tree inside it. UXML is faster to iterate, designer-friendly, hot-reloadable in Editor. Decision: store UXML + USS under `Assets/RadiantArena/UI/Resources/` for `Resources.Load` access. `LobbyPanel.Build` does `Resources.Load → CloneTree(root) → Q<T>(name) wiring`.

### 6.2 Panel events use plain C# `event` (not Bill.Events)
For one-shot UI callbacks (`OnWeaponPicked`, `OnReadyClicked`), a plain C# delegate keeps subscribe/unsubscribe local to LobbyState. Bill.Events is for **cross-component** signaling (NetConnected, PhaseChanged) — using it for intra-panel/state wiring is overkill + leak-prone.

### 6.3 Server-driven weapon list, no client catalog
Per TASKS.md D.U3 DoD: "Both players see only weapons server told them about." LobbyPanel reads `ArenaContext.MyPlayer.AvailableWeapons` exclusively. No `WeaponDatabase` import this Lát — D.U8 introduces that for prefab resolution. For D.U3a the panel renders by `WeaponSnapshot.display_name + tier + category` only (no prefab/hue/skills shown).

### 6.4 Send typed payloads
Use the structs from D.U2 `MessageTypes.cs`:
```csharp
NetClient.Instance.Send("select_weapon", new SelectWeaponMsg { slug = picked });
NetClient.Instance.Send("ready", new ReadyMsg());
NetClient.Instance.Send("unready", new UnreadyMsg());
```
Avoid anonymous objects (per D.U2 Sub 1 finding for `JoinById`'s case; though `Room.Send`'s second arg accepts `object` and Colyseus serializes via MsgPack reflection, structs are clearer + tests-friendly).

### 6.5 Opponent ready mirror via state diff, not a separate event
`PhaseChangedEvent` already fires on every phase delta. For sub-field changes (opponent's `ready` going true), the diff arrives via `OnStateChange` → `ArenaContext.HydrateFrom` rewrites snapshots. `LobbyPanel` doesn't subscribe to a per-field event; instead it has an `Update`/poll-via-`schedule.Execute` cycle that re-reads `ArenaContext.OpponentPlayer?.Ready` every 200ms. Cheap, simple, no extra event types.

Alternative considered: emit `OpponentReadyChangedEvent` from `NetClient.OnStateChange`. Rejected — adds an event for one panel; not worth the surface area.

### 6.6 No `WeaponSchema` → `WeaponSnapshot` deep copy of `skills`
D.U3a: copy only the fields the lobby UI displays (`slug`, `display_name`, `category`, `tier`, `hue` from `visual`). `skills` and full `stats` deferred to D.U4 (TurnInput needs `stats.power`) and D.U7 (signature skills).

### 6.7 Editor smoke via mock state injection
Without arena-server (D.U2b blocker), the only way to render the panel during this lát is to manually populate `ArenaContext.MyPlayer.AvailableWeapons` from `execute_code` in Play mode + manually `Bill.State.GoTo<LobbyState>()`. Sub 8 smoke does exactly this. Validates UI + state machine wiring without server.

### 6.8 LobbyState.Exit on phase=countdown → stub
D.U3a doesn't add `CountdownState`. On `PhaseChangedEvent { newPhase="countdown" }`, LobbyState logs `[Arena.Lobby] -> countdown (deferred to D.U4 CountdownState)`. Panel closes via OnExit. The state machine effectively idles in Lobby with no panel — fine for D.U3a since the next phase exists in spec only.

---

## 7. MCP touchpoints

| Step | MCP tool |
|---|---|
| Write .cs scripts | `Write` (filesystem) |
| Write .uxml / .uss | `Write` (Unity treats them as text assets, AssetDatabase picks up) |
| Refresh after asset writes | `mcp__unityMCP__refresh_unity` |
| Compile poll | `editor_state` resource → `isCompiling` |
| Console check | `mcp__unityMCP__read_console` types=["error"] |
| Mock-data smoke (Sub 8) | `mcp__unityMCP__execute_code` reflection: populate ArenaContext, GoTo<LobbyState>, observe panel render |
| Verify panel render | `find_gameobjects` for `[Bill.UI]` GO + check children + read_console for `[Arena.Lobby]` log |

**No scene edits this Lát** — `[Bill.UI]` GameObject is auto-created at runtime by `Bill.UI.Initialize()` in BillGameCore's bootstrap. No `manage_gameobject` work needed.

---

## 8. Smoke test plan

### 8.1 Per-sub compile gate
After every `.cs` or `.uxml` / `.uss` write: `refresh_unity` → poll `editor_state.isCompiling=false` → `read_console` types=["error"] → must be empty.

### 8.2 Final smoke (Sub 8)
**Pre**: Unity in Editor, Bootstrap.unity loaded, no arena-server running.

1. MCP `manage_editor` play → wait for Ready.
2. Verify base log chain (Bill ready, Arena Boot, etc. — same as D.U2 smoke).
3. `execute_code`: populate `ArenaContext.MyDiscordId = "mock_me"`, `ArenaContext.MyPlayer = new PlayerSnapshot { ... AvailableWeapons = new WeaponSnapshot[3] { ... } }`, `ArenaContext.CurrentPhase = "lobby"`, then `Bill.State.GoTo<LobbyState>()`.
4. Expected logs:
   - `[Bill.State] Boot -> Lobby` (auto)
   - `[Arena.Lobby] Opened LobbyPanel, 3 weapons available`
5. `find_gameobjects` for `[Bill.UI]` GameObject — confirm UIDocument has the LobbyPanel VisualElement as child.
6. `execute_code`: simulate weapon pick via reflection on LobbyPanel.OnWeaponPicked event. Confirm `NetClient.Send` is invoked (or skip if NetClient.Instance not connected — log `[Arena.Net] Send(select_weapon) ignored — not connected` per D.U2 NetClient guard).
7. `execute_code`: simulate ready click. Same expectation.
8. `Bill.State.GoTo<RadiantArena.States.ConnectingState>()` → verify LobbyState.Exit fires, panel closed.
9. MCP `manage_editor` stop. Final console clean.

**DoD**: 4-5 logs from steps 4 + 6 + 7 captured. No NEW errors.

### 8.3 D.U3b smoke (deferred)
Real 2-instance: arena-server running, both clients reach phase=lobby, pick weapons, hit Ready → server flips to countdown. Tracked as D.U3b in REPORT. Blocker = server D.3 + D.4.

---

## 9. Risks / unknowns

| Risk | Mitigation |
|---|---|
| `Resources.Load<VisualTreeAsset>` returns null | Sub 6 verifies via `execute_code` after asset write. Folder must be exactly `Assets/RadiantArena/UI/Resources/` (Resources is case-sensitive on some platforms). |
| ListView's `makeItem`/`bindItem` boilerplate | Use Unity 6 ListView with `fixedItemHeight` + `itemsSource` direct binding. ~20 lines. |
| Panel rendered but invisible (Z-order / styling) | LobbyPanel root has `position: absolute; inset: 0; background-color: rgba(0,0,0,0.7)` in USS so it's clearly visible. |
| `BasePanel.Init` calls `Build(root)` BEFORE root is added to UIDocument — `Resources.Load` must work in that timing | Verified by reading `UIService.GetOrCreate` — Init runs before `_uiRoot.Add(panel.Root)`, but `Resources.Load` is independent of scene/UIDocument state. Safe. |
| Schema's `WeaponSchema.skills` is ArraySchema — copy may throw if null | Defensive: `if (p.weapon != null && p.weapon.slug != "") ...` |
| Mock smoke needs `LobbyPanel` instantiable from reflection | `BasePanel.Init` is `internal`. `execute_code` runs in editor context, may not access internals from Assembly-CSharp via reflection without `BindingFlags.NonPublic`. Sub 8 uses `Bill.UI.Open<LobbyPanel>` instead — public API. |

---

## 10. Bill checkpoints

| After Sub | Checkpoint |
|---|---|
| Sub 1 | Verify Resources.Load pattern works (no asmdef blocks the path) — Bill skim only. |
| Sub 3 | LobbyPanel.uxml layout — quick visual sanity, Bill can override. |
| Sub 8 | Final smoke logs — Bill confirms D.U3a close vs extend to D.U3b. |

---

## 11. Definition of Done (D.U3a close)

- [ ] Console clean post all script writes.
- [ ] All ~8 subs committed (1-2 verify-only).
- [ ] LobbyState reachable from ConnectingState via PhaseChangedEvent.
- [ ] Mock smoke logs panel opening + click handlers firing.
- [ ] REPORT.md drafted, folder moved to done.

D.U3b deferred. D.U4 (TurnInput) prereqs unblocked client-side (LobbyState → CountdownState handoff stub ready).
