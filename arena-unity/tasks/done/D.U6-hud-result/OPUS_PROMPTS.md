# D.U6 — HudPanel + ResultPanel · OPUS_PROMPTS

> Mode: Opus sequential auto-run (D.U4/D.U5 precedent).
> Each prompt is self-contained — re-pasteable if a single sub needs re-run by hand.

---

## Sub 1 — Verify baseline (read-only, NO commit)

```
Persona: arena-unity/SKILL.md. Lát D.U6 Stage 2 Sub 1.

## Read
- arena-unity/tasks/todo/D.U6-hud-result/PLAN.md §3, §6
- arena-unity/tasks/todo/D.U6-hud-result/SUBTASKS.md Sub 1

## Do
1. read_console types=["error"] → baseline (expect D.U5 baseline).
2. Grep "BillTween\\." OR "Bill\\.Tween" Assets/RadiantArena → expect 0 hits (we are first consumer).
3. Grep "match_ended" Assets/RadiantArena/Scripts/Net/NetClient.cs → confirm line ~102 still stub.
4. Grep "Open<" + "IsOpen<" Assets/BillGameCore/Runtime/Services/UI/ — record Open/IsOpen semantics when already open.
5. execute_code (codedom): one-line `BillGameCore.BillTween.Float(0f, 1f, 0.1f, v => UnityEngine.Debug.Log($"tween={v}"));` — confirm setter fires.

## Output
- baseline status
- Bill.UI.Open<T> when already-open behavior (record actual)
- BillTween.Float ✅/❌

## STOP — no code edits, no commit.
```

---

## Sub 2 — Events + Ctx

```
Persona: SKILL.md. Lát D.U6 Sub 2.

## Read
- SUBTASKS.md Sub 2 (verbatim event signatures + ctx fields)
- Assets/RadiantArena/Scripts/Events/ArenaEvents.cs
- Assets/RadiantArena/Scripts/Net/ArenaContext.cs

## Do
- Edit ArenaEvents.cs: append HpChangedEvent + MatchEndedEvent structs (per SUBTASKS 2a).
- Edit ArenaContext.cs: add LastMatchWinnerId/Outcome/FinalHp props (per SUBTASKS 2b) + extend Reset().
- refresh_unity scope=scripts compile=request, read_console types=["error"] → zero new.

## Commit
feat(arena-unity/Lát-D.U6): add HpChangedEvent + MatchEndedEvent + LastMatch ctx

## STOP
```

---

## Sub 3 — NetClient: HP diff + OnMatchEnded

```
Persona: SKILL.md. Lát D.U6 Sub 3.

## Read
- SUBTASKS.md Sub 3 (full code blocks 3a–3e)
- Assets/RadiantArena/Scripts/Net/NetClient.cs (existing — note the _lastPhase pattern at line ~35)

## Do
- Edit NetClient.cs:
  - Add `_lastHp` dict field next to `_lastPhase`.
  - Extend OnStateChange after the phase-diff block — iterate state.players, compute per-player HP delta, fire HpChangedEvent on change, update _lastHp.
  - Extend Disconnect() + OnLeave() to clear _lastHp alongside the existing _lastPhase = "".
  - Replace the match_ended lambda stub with a method reference Room.OnMessage<MatchEndedMessage>("match_ended", OnMatchEnded).
  - Add OnMatchEnded(MatchEndedMessage m) after OnShotResolved — snapshot final_hp into a fresh Dictionary, populate ArenaContext.LastMatch*, fire MatchEndedEvent.
- refresh_unity, read_console clean.

## Commit
feat(arena-unity/Lát-D.U6): NetClient HP diff loop + OnMatchEnded handler

## STOP
```

---

## Sub 4 — HudPanel UXML + USS + .cs

```
Persona: SKILL.md. Lát D.U6 Sub 4.

## Read
- SUBTASKS.md Sub 4 (full code for all 3 files)
- PLAN.md §6.3, §6.6, §6.8 (lifecycle, HP-bar setter, initial snap)
- Assets/RadiantArena/UI/LobbyPanel.cs (BasePanel precedent + scheduler + USS-loading pattern)

## Do
- Create Assets/RadiantArena/UI/Resources/HudPanel.uxml verbatim per SUBTASKS 4a.
- Create Assets/RadiantArena/UI/Resources/hud.uss verbatim per SUBTASKS 4b.
- Create Assets/RadiantArena/UI/HudPanel.cs verbatim per SUBTASKS 4c.
  - Subscribes HpChangedEvent on OnOpened.
  - SnapAllBars() initial render (no tween).
  - BillTween.Float() per HpChangedEvent — color ramp green→yellow→red. KillTarget(fill) before each new tween to avoid overlap.
  - 250ms scheduler tick refreshes round/timer/turn-indicator.
- After Sub 4 writes the new Trajectory-style folder Resources/HudPanel.uxml — if Unity hasn't picked it up, refresh_unity scope=all mode=force (D.U5 lesson). Then read_console types=["error"] → zero new.

## Commit
feat(arena-unity/Lát-D.U6): add HudPanel BasePanel + UXML + USS — HP bars (BillTween animated), turn timer, round/turn indicator

## STOP
```

---

## Sub 5 — ResultPanel UXML + USS + .cs

```
Persona: SKILL.md. Lát D.U6 Sub 5.

## Read
- SUBTASKS.md Sub 5 (full code for all 3 files)
- Assets/RadiantArena/UI/LobbyPanel.cs (button-binding pattern)
- Assets/RadiantArena/UI/Resources/lobby.uss (btn / btn-primary / btn-secondary inheritance)

## Do
- Create Assets/RadiantArena/UI/Resources/ResultPanel.uxml verbatim.
- Create Assets/RadiantArena/UI/Resources/result.uss verbatim — depends on lobby.uss for .btn styles (loaded together in 5c).
- Create Assets/RadiantArena/UI/ResultPanel.cs:
  - Load BOTH result.uss AND lobby.uss in Build (so .btn-primary/.btn-secondary work).
  - Public Render(winnerId, outcome, finalHp) method — switches banner class + Vietnamese verdict text + HP rows.
  - Stub buttons log only (no NetClient.Send wiring this Lát).
- refresh_unity + read_console clean.

## Commit
feat(arena-unity/Lát-D.U6): add ResultPanel BasePanel + UXML + USS — winner banner + outcome + final HPs + stub buttons

## STOP
```

---

## Sub 6 — EndState + transitions + Countdown/Lobby HUD wiring

```
Persona: SKILL.md. Lát D.U6 Sub 6.

## Read
- SUBTASKS.md Sub 6 (all 8 sub-edits 6a–6h)
- PLAN.md §6.3, §6.9, §6.10 (lifecycle decisions, race-fallback, where to wire phase=ended)
- All 4 existing state files for context — CountdownState/MyTurnState/OpponentTurnState/AnimatingState

## Do
- Create Assets/RadiantArena/Scripts/States/EndState.cs per SUBTASKS 6a.
  - Subscribes MatchEndedEvent in Enter.
  - On Enter: close HudPanel + TurnInputPanel, open ResultPanel.
  - Race fallback: peek ArenaContext.LastMatch* — render now if cache populated.
  - On Exit: unsubscribe + close ResultPanel.
- Edit ArenaStates.cs (6b): append AddState(new EndState()).
- Edit CountdownState.cs (6c): in Enter, after the existing log, add guarded Bill.UI.Open<UI.HudPanel>().
- Edit LobbyState.cs (6d): defensive close of HudPanel + ResultPanel at top of Enter.
- Edit AnimatingState.cs (6e): on PhaseChangedEvent.newPhase=="ended" → Bill.State.GoTo<EndState>().
- Edit MyTurnState.cs (6f) + OpponentTurnState.cs (6g): extend the _onPhase lambda to also handle newPhase=="ended" → GoTo<EndState>().
- Edit CountdownState.cs (6h): same — extend its OnPhaseChanged to handle "ended".

After all edits: refresh_unity + read_console zero new errors.

## Commit
feat(arena-unity/Lát-D.U6): add EndState + register + wire phase=ended from Countdown/MyTurn/OpponentTurn/Animating + Countdown opens HudPanel + Lobby closes leftover HUDs

## STOP
```

---

## Sub 7 — Move timer ownership: drop from TurnInputPanel

```
Persona: SKILL.md. Lát D.U6 Sub 7.

## Read
- SUBTASKS.md Sub 7
- Assets/RadiantArena/UI/TurnInputPanel.cs (existing — see _timer field + RefreshTimer method + scheduler usage)
- Assets/RadiantArena/UI/Resources/TurnInputPanel.uxml

## Do
- Edit TurnInputPanel.uxml: drop the <ui:Label name="timer"> line. Header keeps only <Label name="title">.
- Edit TurnInputPanel.cs:
  - Remove `Label? _timer;`
  - Remove the `_timer = root.Q<Label>("timer");` line in Build
  - Remove the entire RefreshTimer() method
  - Remove `_tick = _root?.schedule.Execute(RefreshTimer).Every(250); RefreshTimer();` from OnOpened
  - Remove `_tick?.Pause(); _tick = null;` from OnClosed
  - Remove `IVisualElementScheduledItem? _tick;` field declaration
- KEEP: _currentPower, UpdatePowerVisual, AimUpdated/AimCleared handlers, SetMode logic.
- (Optional clean-up: leave dead .turn-timer / .timer-urgent styles in turn_input.uss — harmless, skip the diff.)
- refresh_unity + read_console zero new errors.

## Commit
refactor(arena-unity/Lát-D.U6): move turn-timer ownership from TurnInputPanel to HudPanel — drop duplicate render

## STOP
```

---

## Sub 8 — Mock smoke (NO commit)

```
Persona: SKILL.md. Lát D.U6 Sub 8.

## Pre
- mcp__unityMCP__manage_editor stop then play (D.U5 lesson — fresh Bill.IsReady=true).
- compiler="codedom" for every execute_code (D.U5 lesson).
- RadiantArena.States.ArenaStates.Register() explicitly first (D.U5 lesson).

## Do
1. read_console clear.
2. Step A — drive into Countdown via execute_code per SUBTASKS Sub 8 Step A script. Reflection-set MyPlayer/OpponentPlayer (private setters).
3. Verify: [Bill.State] None -> Countdown OR similar, [Arena.Countdown] Enter, [Arena.HUD] opened, snapping bars me=100/100 opp=100/100.
4. find_gameobjects "[Bill.UI]" — confirm 1.
5. Step B — Fire HpChangedEvent { opp, 100→75, 100 }. Verify log [Arena.HUD] HP opp 100→75/100.
6. Bash sleep 0.6s. Probe opp-bar-fill style.width via reflection (or trust the log).
7. Step C — Fire HpChangedEvent { me, 100→40, 100 }. Verify log + red zone color ramp.
8. Bash sleep 0.6s.
9. Step D — Fire MatchEndedEvent first (LastMatch* cache populates), THEN GoTo<EndState>(). Expect log: [Arena.End] Enter, [Arena.End] replaying cached LastMatch* (arrived before Enter), banner reads "Trận đấu THẮNG" (winner=me, MyDiscordId=me).
10. find_gameobjects "[Bill.UI]" — verify still 1 (panel container persists, contents changed).
11. (Optional Step E) — swap MyDiscordId="opp", re-fire MatchEndedEvent with winner="me" → banner reads "Trận đấu THUA".
12. manage_editor stop. read_console types=["error"] → 0 errors.

## Output
- Full log capture for steps 3-10 (pass/fail per expected line).
- Notes if any unexpected warnings/errors.

## STOP — no commit. Stage 4 (REPORT.md) follows from Opus.

## Fallback
- If Bill.UI.Open<T> already-open throws / dupes — Sub 1 should have caught it; adjust §6.3 guards (likely already in place).
- If BillTween setter doesn't fire (service not registered somehow) — fall back to setting style.width directly per HpChangedEvent (no animation). Log the degradation; D.U7 will revisit.
```

---

## Bill checkpoints

| After | Action |
|---|---|
| Sub 1 | Confirm baseline + Bill.UI.IsOpen behavior. |
| Sub 4 | Optional HudPanel UXML/USS layout sanity. |
| Sub 5 | Optional ResultPanel layout sanity (banner copy). |
| Sub 8 | Mock smoke logs match expected; Opus closes D.U6a + writes REPORT. |

## Notes
- Pre-commit hook fail → NEW commit (no --amend) per global rule.
- MCP unavailable mid-sub → pause + report; don't silently fall back to filesystem only.
- D.U6b (real server damage + HP-0 match-end) deferred — open after arena-server Lát D.5 ships physics.
