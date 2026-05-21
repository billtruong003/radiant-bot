# D.U6 — HudPanel + ResultPanel · PLAN

> Stage 1 (Architect). Bill confirm → Opus sequential auto-run per D.U4/D.U5 precedent.
> Date: 2026-05-18 · Executor: Opus 4.7.

---

## 1. Goal

Two new always-on/terminal UI surfaces complete the combat-phase visual story:

- **`HudPanel`** — opened once when we leave Lobby, stays through Countdown → MyTurn ↔ OpponentTurn ↔ Animating; closed on phase=ended. Always shows: my HP bar (left) + opponent HP bar (right), each with numeric HP / HP_max + weapon name, plus a top-center turn countdown that goes red+pulses at ≤5s.
- **`ResultPanel`** — opened by a new `EndState` on `phase=ended`. Centered modal banner: "Trận đấu thắng" / "Trận đấu thua" (or "Trận đấu hoà" edge case), outcome label, final HPs, two stub buttons (Chơi lại / Về sảnh).

Driven by two new gameplay-facing events emitted from `NetClient.OnStateChange` and `NetClient.OnMessage<MatchEndedMessage>` respectively:

- `HpChangedEvent { playerId, oldHp, newHp, hpMax }` — fires on schema diff (NetClient holds a private `Dictionary<string,int> _lastHp`).
- `MatchEndedEvent { winnerId, outcome, finalHp }` — plain-C# snapshot of `MatchEndedMessage`.

HP animation uses `BillTween.Float(...)` (a real service, confirmed at [`BillTween.cs:174`](../../../Assets/BillGameCore/Runtime/Services/Tween/BillTween.cs#L174)) to interpolate the HP-bar width over 400ms; juice (pop scale, screen flash) deferred to D.U7.

---

## 2. Scope split (D.U6a now, D.U6b after server D.5)

| Sub-scope | Status | Notes |
|---|---|---|
| **D.U6a (this Lát, client-only)** | | |
| `HpChangedEvent` + `MatchEndedEvent` (gameplay-facing) | ✅ GO | Mirror plain-C# DTO pattern from D.U5 `ShotResolvedEvent`. |
| `NetClient` HP diff tracking + `OnMatchEnded` handler | ✅ GO | Replaces the D.U2 stub log on line 102-103. |
| `ArenaContext.LastMatchWinnerId / LastMatchOutcome / LastMatchFinalHp` race-fallback cache | ✅ GO | Same pattern as `LastTrajectory` for D.U5. |
| `HudPanel` UXML + USS + .cs (HP bars + turn timer + weapon names) | ✅ GO | BasePanel + scheduler tick for timer + BillTween for HP bar fill. |
| `ResultPanel` UXML + USS + .cs (winner banner + outcome + final HPs + 2 stub buttons) | ✅ GO | BasePanel; stub buttons log only. |
| `EndState` (new state) + ArenaStates.Register + AnimatingState ended→EndState wire | ✅ GO | Mirrors how CountdownState wires from LobbyState. |
| `CountdownState` opens HudPanel on Enter | ✅ GO | HudPanel lifecycle: open at Countdown, close at EndState. |
| Consolidate turn-timer: move ownership from TurnInputPanel → HudPanel | ✅ GO | Edit `TurnInputPanel.uxml` (drop `timer` Label) + `TurnInputPanel.cs` (drop `_timer` + `RefreshTimer`). HudPanel becomes the canonical timer. |
| Mock smoke (no server) | ✅ GO | execute_code: enter Countdown → HudPanel opens → fire synthetic HpChangedEvent → bar tweens → fire synthetic MatchEndedEvent → EndState opens ResultPanel. |
| **D.U6b (deferred until server D.5 — physics with real damage)** | | |
| Real HP changes from `simulateShot()` damage in `shot_resolved` → state diff fires HpChangedEvent | ⏸ BLOCKED | Server currently emits `trajectory: []`, `damage_dealt: 0`, HP never mutates server-side. |
| Real `match_ended` broadcast on HP=0 (already exists server-side per [DuelRoom.ts:599](../../../radiant-bot/arena-server/src/rooms/DuelRoom.ts#L599)) | ⏸ Half-blocked | Server emits `match_ended` on `concede` already (works today via concede msg); HP-0 path needs D.5 damage. |
| 2-instance ParrelSync end-to-end (combat → HP drops → match end → ResultPanel) | ⏸ BLOCKED | Same shape as D.U5b. |
| **OUT OF SCOPE (deferred to later Láts)** | | |
| HP bar pop scale 1.0→1.15→1.0 + screen flash on crit | ❌ D.U7 | Juice pass. |
| Layered audio on HP change / match end | ❌ D.U7 | |
| Replay link button → load replay blob | ❌ D.U10/D.U11 | |
| Return-to-lobby button real flow | ❌ D.U11 (replay viewer Lát) or beyond | D.U6 logs only. |
| Cinematic camera move on match end | ❌ D.U7 | |

---

## 3. Project state (verified 2026-05-18)

- ✅ `Bill.Tween` is a real `ITweenService` exposed at [`Bill.cs:12`](../../../Assets/BillGameCore/Runtime/Bootstrap/Bill.cs#L12); facade `BillTween.Float(from, to, dur, setter)` lives at [`BillTween.cs:174`](../../../Assets/BillGameCore/Runtime/Services/Tween/BillTween.cs#L174) and auto-falls-back to the active service via `ServiceLocator`. D.U6 uses `BillTween.Float(...)` for HP-bar width tween — no Transform/UI Toolkit shortcuts in the facade for `VisualElement.style.width`, so we hand-roll the setter `v => element.style.width = new StyleLength(Length.Percent(...))`.
- ✅ `BasePanel` precedent in `LobbyPanel.cs` (D.U3) + `TurnInputPanel.cs` (D.U4) — `Build(root)` loads UXML + USS via `Resources.Load`, queries elements by name, optionally subscribes Bill.Events in `OnOpened`/unsubscribes in `OnClosed`, schedules periodic ticks via `root.schedule.Execute(...).Every(ms)`.
- ✅ `NetClient.Room.OnMessage<MatchEndedMessage>("match_ended", ...)` already registered as a stub log at [`NetClient.cs:102-103`](../../../Assets/RadiantArena/Scripts/Net/NetClient.cs#L102). Sub 3 replaces handler body, keeps registration site.
- ✅ `MessageTypes.MatchEndedMessage { string winner; string outcome; Dictionary<string,int>? final_hp }` exists.
- ✅ Server `DuelRoom.endMatch` (Lát D.4) broadcasts `match_ended` on concede + on its internal timer paths (`DuelRoom.ts:599`). HP-0 trigger path exists but the HP-decrement code lives inside `simulateShot()` which isn't shipped yet — so the message DOES fire today (via concede / disconnect / timeout_join), HP just doesn't decrement until D.5.
- ✅ `ArenaContext.MyPlayer.Hp / HpMax` + `OpponentPlayer.Hp / HpMax` already hydrated by `PlayerSnapshot(PlayerSchema)` ctor (D.U2). State diff `OnStateChange → HydrateFrom` rebuilds these snapshots every server tick.
- ✅ `BasePanel` has `internal Init(VisualElement)` → `protected abstract Build(VisualElement)` — same constraint LobbyPanel handled (load `Resources.Load<VisualTreeAsset>("name")` + `CloneTree(root)`).
- ✅ `Application.runInBackground = true` carryover from D.U5 diagnostic — left in. Doesn't affect this Lát.
- ⚠️ `TurnInputPanel.cs:126` has its own `RefreshTimer` + `_timer` Label. To avoid two competing timer renders, **Sub 7 removes it from TurnInputPanel**. The Label is named `"timer"` in TurnInputPanel.uxml — Sub 7 drops that line from the UXML too.
- ⚠️ `Bill.UI.Open<T>` semantics if already open: unclear from `IUIService` interface; safest pattern is `if (!Bill.UI.IsOpen<HudPanel>()) Bill.UI.Open<HudPanel>();` — Sub 6 applies this guard in CountdownState.
- ⚠️ `MyTurnState.Exit` and `OpponentTurnState.Exit` currently call `Bill.UI.Close<TurnInputPanel>()` (D.U4). They do NOT touch HudPanel. Confirmed — HudPanel will persist across MyTurn↔OpponentTurn↔Animating transitions.

---

## 4. Files this Lát will touch

| Path | Action | Purpose |
|---|---|---|
| `Assets/RadiantArena/Scripts/Events/ArenaEvents.cs` | EDIT | +`HpChangedEvent`, +`MatchEndedEvent`. |
| `Assets/RadiantArena/Scripts/Net/ArenaContext.cs` | EDIT | +`LastMatchWinnerId / LastMatchOutcome / LastMatchFinalHp`, extend `Reset()`. |
| `Assets/RadiantArena/Scripts/Net/NetClient.cs` | EDIT | Add `Dictionary<string,int> _lastHp` field. In `OnStateChange` (after `HydrateFrom`) iterate `state.players` and fire `HpChangedEvent` on each delta. Replace `match_ended` stub with `OnMatchEnded(MatchEndedMessage m)` method. |
| `Assets/RadiantArena/Scripts/States/EndState.cs` | CREATE | Opens ResultPanel on Enter; closes on Exit. |
| `Assets/RadiantArena/Scripts/States/ArenaStates.cs` | EDIT | Register `EndState`. |
| `Assets/RadiantArena/Scripts/States/AnimatingState.cs` | EDIT | On `PhaseChangedEvent { newPhase="ended" }` → `Bill.State.GoTo<EndState>()` (currently logs only). |
| `Assets/RadiantArena/Scripts/States/CountdownState.cs` | EDIT | On `Enter` → guarded `Bill.UI.Open<HudPanel>()`. |
| `Assets/RadiantArena/Scripts/States/LobbyState.cs` | EDIT | (Defensive) On `Enter` → `Bill.UI.Close<HudPanel>()` in case we re-entered Lobby after a match. |
| `Assets/RadiantArena/UI/HudPanel.cs` | CREATE | BasePanel — 2 HP bars + turn timer; subscribes `HpChangedEvent`; scheduler tick for timer; BillTween animates bar widths. |
| `Assets/RadiantArena/UI/Resources/HudPanel.uxml` | CREATE | Layout: header (timer) + 2 slot rows (player name + weapon name + HP bar). |
| `Assets/RadiantArena/UI/Resources/hud.uss` | CREATE | Glass-dark theme matching `lobby.uss` palette; bar fill colors green (>50%) → yellow (>25%) → red (≤25%). |
| `Assets/RadiantArena/UI/ResultPanel.cs` | CREATE | BasePanel — winner banner + outcome + final HPs + 2 stub buttons. |
| `Assets/RadiantArena/UI/Resources/ResultPanel.uxml` | CREATE | Centered card layout. |
| `Assets/RadiantArena/UI/Resources/result.uss` | CREATE | Modal overlay + card style. |
| `Assets/RadiantArena/UI/Resources/TurnInputPanel.uxml` | EDIT | Drop the `<Label name="timer">` line. |
| `Assets/RadiantArena/UI/TurnInputPanel.cs` | EDIT | Drop `_timer` field + `RefreshTimer` method + scheduler call. |

**No** scene edits — `[Bill.UI]` UIDocument is auto-created at runtime (D.U3 precedent).
**No** Bill.Pool registration (HP bar fill is pure UI Toolkit, no GameObjects).

---

## 5. APIs used

### 5.1 BillGameCore
- `Bill.Events.Fire / Subscribe / Unsubscribe<T>` — for HpChangedEvent + MatchEndedEvent + PhaseChangedEvent.
- `Bill.UI.Open<HudPanel> / IsOpen / Close<HudPanel>` — lifecycle.
- `Bill.State.AddState / GoTo` — EndState registration + transition.
- `BillTween.Float(from, to, duration, setter)` — animate `style.width.percent` for HP-bar fill.
- `root.schedule.Execute(callback).Every(ms)` — scheduler for turn timer refresh (250ms — copy from TurnInputPanel pattern).

### 5.2 Unity UI Toolkit
- `Resources.Load<VisualTreeAsset>` / `Resources.Load<StyleSheet>` — UXML + USS load.
- `VisualElement.style.width = new StyleLength(Length.Percent(...))` — HP-bar fill driven by BillTween setter.
- `VisualElement.EnableInClassList("class", bool)` — toggle low-hp red class, timer-urgent class, winner / loser class on banner.

### 5.3 RadiantArena types (new + existing)
- `RadiantArena.Events.HpChangedEvent` (new) — `{ string playerId; int oldHp; int newHp; int hpMax; }`.
- `RadiantArena.Events.MatchEndedEvent` (new) — `{ string winnerId; string outcome; System.Collections.Generic.Dictionary<string,int> finalHp; }`. (Nullable carries through.)
- `RadiantArena.Net.ArenaContext.LastMatch*` (new) — race-fallback cache so EndState can re-read after-the-fact.
- `RadiantArena.Net.ArenaContext.MyDiscordId / OpponentDiscordId / MyPlayer.Hp / OpponentPlayer.Hp / TurnDeadlineAt` — read by HudPanel for initial render + timer.

---

## 6. Architecture decisions

### 6.1 HpChangedEvent fired by NetClient (not by ArenaContext.HydrateFrom)
NetClient owns the previous-state map (`Dictionary<string,int> _lastHp`) because:
- It already runs the per-tick `OnStateChange` loop — adding a couple of field comparisons is cheap.
- ArenaContext is a static "current snapshot" — by the time `HydrateFrom` returns, the previous snapshot is gone.
- Mirrors the existing `_lastPhase` field at `NetClient.cs:35` that fires `PhaseChangedEvent`.

Initial state: when `_lastHp` doesn't contain a player's id yet, treat `oldHp = hp_max` (so the first event isn't a fake "100 → 100" no-op — actually we just skip firing when oldHp == newHp). On first hydration we populate `_lastHp[discordId] = state.players[discordId].hp` without firing.

### 6.2 MatchEndedEvent fired by NetClient (mirror ShotResolvedEvent shape)
Same one-way bridge pattern from D.U5: `Room.OnMessage<MatchEndedMessage>(...)` handler snapshots into `MatchEndedEvent` payload, populates `ArenaContext.LastMatch*`, fires `Bill.Events.Fire(new MatchEndedEvent { ... })`. EndState subscribes the event AND peeks ArenaContext on Enter (race-fallback) — same construction as AnimatingState's ShotResolvedEvent handling.

Server also broadcasts `match_ended` on concede / disconnect / timeout — same handler path, same event. The `outcome` field disambiguates.

### 6.3 HudPanel opens at Countdown, closes at EndState — long-lived across combat
HudPanel persists from `phase=countdown` through `phase=active|animating` to `phase=ended`. Re-creating it per state would (a) flicker, (b) defeat the BillTween animation (a fresh panel restarts at full HP). Lifecycle is owned by the two boundary states:

- `CountdownState.Enter` → guarded `Bill.UI.Open<HudPanel>()`.
- `EndState.Enter` → `Bill.UI.Close<HudPanel>()` + `Bill.UI.Open<ResultPanel>()`.
- `LobbyState.Enter` → defensive `Bill.UI.Close<HudPanel>()` (defends against lobby re-entry e.g. after server reset).

MyTurn/OpponentTurn/Animating never touch HudPanel. They DO still toggle TurnInputPanel.

### 6.4 ResultPanel modal — replaces HudPanel and TurnInputPanel
On match end, EndState:
1. Closes HudPanel.
2. Closes TurnInputPanel (defensive — Animating.Exit might already have done it, but if we end mid-turn it's still up).
3. Opens ResultPanel.

ResultPanel renders read-only — no inputs hook back to NetClient this Lát. Buttons just log.

### 6.5 Turn timer ownership consolidated to HudPanel
Two reasons to move it:
- TASKS.md D.U6 spec explicitly lists "turn timer" in HudPanel.
- Two panels rendering the same `ArenaContext.TurnDeadlineAt` is visual duplication.

Drop the `<Label name="timer" />` from `TurnInputPanel.uxml` and the `_timer` / `RefreshTimer` from `TurnInputPanel.cs`. Net effect: TurnInputPanel becomes "title + power gauge + hint" only. Spectator mode still works (no timer in spectator either — the HUD has it).

### 6.6 HP bar fill via inline `style.width` percent + BillTween setter
HP bar = container `width: 100%` + inner fill `width: HP/HpMax %`. Setter:
```csharp
BillTween.Float((float)oldHp, (float)newHp, 0.40f, v =>
{
    float pct = (v / hpMax) * 100f;
    fillElement.style.width = new StyleLength(Length.Percent(pct));
    // Color ramp green→yellow→red based on pct/100
    fillElement.style.backgroundColor = HpColor(pct);
});
```
Color ramp at update-time (same approach as `TurnInputPanel.UpdatePowerVisual`).

### 6.7 No per-bar `Tween.Kill` bookkeeping this Lát
If a player takes 2 hits in quick succession, the second `BillTween.Float` starts a NEW tween (zero-allocation pool — see [`BillTween.cs:130`](../../../Assets/BillGameCore/Runtime/Services/Tween/BillTween.cs#L130) `Rent()`). Both tweens compete on the same setter — last one wins per frame, but the visual stutters. **Acceptable for D.U6**: gameplay-wise, two hits arrive ≥200ms apart (turn-based — only the animating phase can drop HP). Not a real issue. D.U7 can add `BillTween.KillTarget(fillElement)` before starting the new tween if it shows up under stress.

### 6.8 Initial HP render is a snap, not a tween
When HudPanel opens, `OnOpened` snaps both bars to current ArenaContext HP/HpMax with no animation. The first `HpChangedEvent` (e.g., on first hit) starts the first tween.

### 6.9 EndState peeks ArenaContext on Enter (race-fallback) — same as AnimatingState
If `match_ended` arrives before EndState.Enter (e.g., faster phase transition than event order), `ArenaContext.LastMatchWinnerId` is set. EndState.Enter checks `if (!string.IsNullOrEmpty(ArenaContext.LastMatchWinnerId)) RenderResult(...)` to populate ResultPanel from cache.

### 6.10 No `Bill.State.GoTo<EndState>` from `MyTurnState` or `OpponentTurnState`
Only `AnimatingState` handles `phase=ended` directly (the server transitions there from animating after the killing blow). The other turn states observe phase=ended via their existing PhaseChangedEvent subscriber, but defer to AnimatingState's logic — actually they should ALSO transition. Decision: each of CountdownState / MyTurnState / OpponentTurnState / AnimatingState gets a "phase=ended → GoTo<EndState>" clause. Otherwise the player could be stuck mid-MyTurn when the server force-ends the match (concede from opponent etc).

Minimal change: AnimatingState already routes `phase=ended` (just logs); upgrade it to `Bill.State.GoTo<EndState>()`. Add the same line to CountdownState / MyTurnState / OpponentTurnState `OnPhaseChanged` handler.

---

## 7. MCP touchpoints

| Step | Tool |
|---|---|
| Write .cs / .uxml / .uss files | `Write` |
| Force-refresh after new folder/file imports (UI/Resources may need it) | `mcp__unityMCP__refresh_unity scope=all mode=force` (D.U5 lesson — needed once for the new Trajectory/ folder) |
| Console check after each sub | `mcp__unityMCP__read_console types=["error"]` |
| Mock smoke | `mcp__unityMCP__execute_code compiler=codedom` (D.U5 lesson — Roslyn nukes Bill services) |
| Verify panels render | `mcp__unityMCP__find_gameobjects "[Bill.UI]"` + inspect children |

No `manage_asset`/`manage_prefabs`/`manage_scene` — UI only, runtime-instantiated by Bill.UI.

---

## 8. Smoke test plan

### 8.1 Per-sub compile gate
After every Write: `refresh_unity` → `read_console types=["error"]` empty.

### 8.2 Mock smoke (Sub 8) — script
1. Stop/start Play (D.U5 lesson — fresh Bill).
2. Probe `Bill.IsReady=True`. `compiler: codedom` for all execute_code.
3. `ArenaStates.Register()` explicit call (D.U5 lesson — race against ArenaBootstrap.Start).
4. Prime ArenaContext: `MyDiscordId="me"`, `OpponentDiscordId="opp"`, `CurrentRound=1`, `TurnPlayerId="me"`, `TurnDeadlineAt=Now+30s`.
5. Inject `MyPlayer` + `OpponentPlayer` snapshots with `Hp=100, HpMax=100, SelectedWeaponSlug="weapon_kiem_01"` etc. via reflection (LobbyPanel/PlayerSnapshot precedent).
6. `Bill.State.GoTo<CountdownState>()` → expect `[Arena.Countdown] Enter` + HudPanel opens + `[Arena.HUD] opened, snapping bars me=100/100 opp=100/100`.
7. `find_gameobjects "[Bill.UI]"` — confirm UIDocument has HudPanel children.
8. Fire `HpChangedEvent { playerId="opp", oldHp=100, newHp=75, hpMax=100 }` → expect log + tween starts. Wait ~0.5s. Verify width changed (probe `opp-bar-fill.style.width` via reflection or just trust the log "tween started 100→75").
9. Fire another `HpChangedEvent { playerId="me", oldHp=100, newHp=40, hpMax=100 }` → expect color ramp shifted to red (≤50% threshold).
10. Fire `MatchEndedEvent { winnerId="me", outcome="win", finalHp={me:40, opp:0} }` → expect `EndState.Enter` log + HudPanel closes + ResultPanel opens + banner reads "Trận đấu thắng".
11. `find_gameobjects "[Bill.UI]"` — confirm ResultPanel rendered.
12. Stop Play. `read_console types=["error"]` → 0 errors.

### 8.3 Visual feel
Mock-smoke verifies logic, not visual polish. Bill may manually focus Game View + replay smoke to eyeball: HP bar shrinks smoothly (400ms tween), red color when low, timer ticks down, winner banner reads correctly. Optional, not gating.

---

## 9. Bill checkpoints

| After Sub | Checkpoint |
|---|---|
| Sub 1 | Confirm Bill.Tween facade signature + Bill.UI.IsOpen<T> behavior. |
| Sub 4 | HudPanel layout sanity check (UXML structure). |
| Sub 5 | ResultPanel layout — winner/loser banner copy. |
| Sub 8 | Mock smoke logs match §8.2. Decide D.U6a close. |

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| `Bill.UI.Open<T>` when already open errors / dupes panel | §6.3 guards via `if (!Bill.UI.IsOpen<HudPanel>())`. Sub 1 verifies behavior; if it dupes, the guard is mandatory; if it no-ops, the guard is defensive. |
| BillTween facade returns null if service not registered | `BillTween.cs:165` logs `[BillTween] TweenService not registered`; we never null-check the return — accept the no-op since Bill.IsReady=true post-boot guarantees the service. |
| `Dictionary<string,int>?` MatchEndedMessage.final_hp may be null | Defensive handling — copy to a fresh `Dictionary<string,int>` (or `Array.Empty`-equivalent dict) before storing in `ArenaContext.LastMatchFinalHp`. |
| State machine reentry into CountdownState dupes HudPanel | §6.3 guard. |
| `OpponentDiscordId` empty when only one player connected — HUD shows "Waiting" placeholder | HudPanel's right slot shows `"—"` placeholder when `OpponentPlayer == null`. |
| Race: HpChangedEvent fires before HudPanel opens (e.g. tutorial damage during Lobby) | Server doesn't damage in Lobby — no real-world race. HudPanel's `OnOpened` snaps to current `ArenaContext.HP`, so a missed event before open just means initial snap shows the post-event value. No bug. |
| Removing the timer from TurnInputPanel breaks Sub 9 D.U4 smoke if re-run | D.U4 is closed — no replay required. TurnInputPanel.cs change is mechanical. Confirmed visually by inspection. |
| `BillTween` setter captures `hpMax` by value — if hpMax changes mid-tween, fill ratio drifts | hpMax only changes on respawn / new round (server-side); for D.U6 single-match scope, doesn't happen. Acceptable. |
| `Application.runInBackground = true` carryover from D.U5 makes Editor-paused-while-MCP-runs not block Time | Plus, not minus — Time advances normally during Bash sleeps in our smoke. Good. |

---

## 11. Definition of Done (D.U6a close)

- [ ] Console clean post all writes (no new errors beyond baseline).
- [ ] `HpChangedEvent` + `MatchEndedEvent` defined; NetClient HP diff loop + OnMatchEnded fire them.
- [ ] HudPanel opens at Countdown, persists through MyTurn/OpponentTurn/Animating, closes at EndState. HP bars animate via BillTween on HpChangedEvent. Turn timer ticks.
- [ ] ResultPanel renders winner banner + outcome + final HPs + 2 stub buttons on EndState.Enter.
- [ ] TurnInputPanel no longer has a timer.
- [ ] Mock smoke (§8.2) passes all expected logs + visual transitions.
- [ ] REPORT.md drafted with shipped files + commits + deviations + D.U6b backlog.
- [ ] Folder moved `todo/D.U6-hud-result → done/D.U6-hud-result`.

D.U6b (real server damage HP diff + 2-instance match-end smoke) deferred until arena-server Lát D.5 ships physics.

---

## 12. References

- [`Assets/RadiantArena/UI/LobbyPanel.cs`](../../../Assets/RadiantArena/UI/LobbyPanel.cs) — BasePanel + scheduler tick + Bill.Events lifecycle precedent.
- [`Assets/RadiantArena/UI/TurnInputPanel.cs:126`](../../../Assets/RadiantArena/UI/TurnInputPanel.cs#L126) — `RefreshTimer` code being moved to HudPanel (and dropped here).
- [`Assets/RadiantArena/UI/Resources/lobby.uss`](../../../Assets/RadiantArena/UI/Resources/lobby.uss) — palette + glassmorphism precedent for hud.uss / result.uss.
- [`Assets/BillGameCore/Runtime/Services/Tween/BillTween.cs:174`](../../../Assets/BillGameCore/Runtime/Services/Tween/BillTween.cs#L174) — `BillTween.Float(from, to, dur, setter)` signature.
- [`Assets/RadiantArena/Scripts/States/AnimatingState.cs`](../../../Assets/RadiantArena/Scripts/States/AnimatingState.cs) — phase=ended currently logs only; Sub 6 adds `GoTo<EndState>()`.
- [`Assets/RadiantArena/Scripts/Net/MessageTypes.cs:83`](../../../Assets/RadiantArena/Scripts/Net/MessageTypes.cs#L83) — `MatchEndedMessage` shape.
- [`radiant-bot/arena-server/src/rooms/DuelRoom.ts:587-604`](../../../radiant-bot/arena-server/src/rooms/DuelRoom.ts#L587) — server's `endMatch` broadcast.
- Previous Lát handoff: [`done/D.U5-trajectory/REPORT.md`](../../tasks/done/D.U5-trajectory/REPORT.md).
- Memory: [[mcp_execute_code_codedom]] + [[arena_states_register_idempotent]] — apply both in Sub 8 smoke.
