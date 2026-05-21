# D.U4 — TurnInputPanel + drag-aim · OPUS_PROMPTS

> Mode: sequential auto-run (Bill's precedent — `feedback_executor_opus_sequential.md`).
> Each prompt remains paste-able if a single sub needs re-run by hand.

---

## Sub 1 — Verify baseline (read-only, NO commit)

```
Persona: arena-unity/SKILL.md. Lát D.U4 Stage 2 Sub 1.

## Read
- arena-unity/tasks/todo/D.U4-turn-input/PLAN.md §3, §5
- arena-unity/tasks/todo/D.U4-turn-input/SUBTASKS.md Sub 1

## Do
1. read_console types=["error"] → empty.
2. execute_code: check `UnityEngine.InputSystem.Mouse.current != null` accessible.
3. find_in_file Library/PackageCache for "Universal Render Pipeline/Unlit" shader name.
4. Verify BasePanel API unchanged.

## Output
- ✅/❌ Mouse.current works under activeInputHandler=2.
- ✅ URP Unlit shader Find lookup.

## STOP — no commit.
```

---

## Sub 2 — Extend ArenaContext + ArenaEvents

```
Persona: SKILL.md. Lát D.U4 Sub 2.

## Read
- SUBTASKS.md Sub 2 (field list + events)
- Assets/RadiantArena/Scripts/Net/ArenaContext.cs (existing — D.U2+D.U3 layout)
- Assets/RadiantArena/Scripts/Events/ArenaEvents.cs

## Do
- Edit ArenaContext.cs: add TurnPlayerId + TurnDeadlineAt props, extend HydrateFrom + Reset.
- Edit ArenaEvents.cs: add 4 new events (TurnStartedEvent, AimUpdatedEvent, AimClearedEvent, ShotReleasedEvent).
- refresh_unity + read_console zero errors.

## Commit
feat(arena-unity/Lát-D.U4): extend ArenaContext (turn fields) + ArenaEvents (turn/aim/shot events)

## STOP
```

---

## Sub 3 — 4 state skeletons

```
Persona: SKILL.md. Lát D.U4 Sub 3.

## Read
- SUBTASKS.md Sub 3 (skeletons for Countdown/MyTurn/Opp/Animating)

## Do
- Create 4 files under Assets/RadiantArena/Scripts/States/:
  CountdownState.cs (full logic)
  MyTurnState.cs (skeleton — full impl in Sub 7)
  OpponentTurnState.cs (skeleton — full impl in Sub 7)
  AnimatingState.cs (full skeleton — stub for D.U5)
- refresh_unity + read_console zero errors.

## Commit
feat(arena-unity/Lát-D.U4): add CountdownState + MyTurnState + OpponentTurnState + AnimatingState skeletons

## STOP
```

---

## Sub 4 — TurnInputPanel UXML + USS

```
Persona: SKILL.md. Lát D.U4 Sub 4.

## Read
- SUBTASKS.md Sub 4

## Do
- Create Assets/RadiantArena/UI/Resources/TurnInputPanel.uxml exactly per Sub 4 spec.
- Create Assets/RadiantArena/UI/Resources/turn_input.uss with the listed style targets.
- refresh_unity + read_console zero errors.

## Commit
feat(arena-unity/Lát-D.U4): add TurnInputPanel.uxml + turn_input.uss

## STOP
```

---

## Sub 5 — TurnInputPanel.cs

```
Persona: SKILL.md. Lát D.U4 Sub 5.

## Read
- SUBTASKS.md Sub 5 (full code)

## Do
- Create Assets/RadiantArena/UI/TurnInputPanel.cs per skeleton verbatim.
- SetMode toggles .spectator class on root + adjusts title/hint text.
- AimUpdated/AimCleared subscribers update power gauge fill + value + color.
- Scheduler ticks RefreshTimer every 250ms reading ArenaContext.TurnDeadlineAt.
- refresh_unity + read_console zero errors.

## Commit
feat(arena-unity/Lát-D.U4): add TurnInputPanel BasePanel with dual-mode (Self/Spectator) + power gauge + timer

## STOP
```

---

## Sub 6 — ArenaAimController.cs

```
Persona: SKILL.md. Lát D.U4 Sub 6.

## Read
- SUBTASKS.md Sub 6 (full code)
- PLAN.md §6.1 (slingshot direction), §6.4 (lifecycle), §6.5 (placeholder origin)
- arena-unity/RADIANT_ARENA_UNITY.md §8 (reference WeaponController)

## Do
- Create Assets/RadiantArena/Scripts/Weapons/ArenaAimController.cs per Sub 6 skeleton.
- Awake creates LineRenderer + runtime material (URP Unlit fallback to Unlit/Color).
- Update reads Mouse.current; dead zone 10%, max drag world distance 3.0.
- Fires AimUpdated/AimCleared/ShotReleased events.
- SetOrigin(Transform?) for future D.U8 weapon prefab attachment.
- refresh_unity + read_console zero errors.

## Commit
feat(arena-unity/Lát-D.U4): add ArenaAimController with LineRenderer + Mouse drag-aim + slingshot direction

## STOP
```

---

## Sub 7 — Activate MyTurnState + OpponentTurnState

```
Persona: SKILL.md. Lát D.U4 Sub 7.

## Read
- SUBTASKS.md Sub 7 (full Enter/Exit logic)

## Do
- Replace MyTurnState skeleton with full impl: open TurnInputPanel.Self, spawn ArenaAimController GO, subscribe phase + shot events. Send("shoot", ShootMsg) on shot, GoTo<AnimatingState>.
- Replace OpponentTurnState skeleton with: open TurnInputPanel.Spectator, listen phase=animating.
- refresh_unity + read_console zero errors.

## Commit
feat(arena-unity/Lát-D.U4): activate MyTurnState + OpponentTurnState — open panel, spawn controller, route ShotReleased to NetClient.Send

## STOP
```

---

## Sub 8 — Wire transitions

```
Persona: SKILL.md. Lát D.U4 Sub 8.

## Read
- SUBTASKS.md Sub 8

## Do
- Edit LobbyState.cs OnPhaseChanged: activate the GoTo<CountdownState>() on newPhase=="countdown".
- Edit ArenaStates.cs Register: append 4 AddState() calls.
- refresh_unity + read_console zero errors.

## Commit
feat(arena-unity/Lát-D.U4): wire LobbyState→CountdownState transition + register 4 new states

## STOP
```

---

## Sub 9 — Mock smoke (NO commit)

```
Persona: SKILL.md. Lát D.U4 Sub 9.

## Pre
- Bootstrap.unity loaded. No arena-server needed.

## Do
1. read_console clear.
2. manage_editor play. Wait Bill.IsReady.
3. execute_code: inject mock ArenaContext (6 weapons + opponent) + GoTo<LobbyState>.
4. execute_code: set ArenaContext fields phase=countdown, TurnPlayerId=me, TurnDeadlineAt=now+30s. Fire PhaseChangedEvent(lobby→countdown). Verify [Bill.State] Lobby -> Countdown.
5. execute_code: set phase=active. Fire PhaseChangedEvent(countdown→active). Verify Countdown→MyTurn + panel opens + ArenaAimController GO spawns.
6. find_gameobjects "ArenaAimController" → confirm 1.
7. execute_code: fire PhaseChangedEvent(active→animating). Verify MyTurn→Animating + controller GO destroyed.
8. execute_code: set TurnPlayerId=opp + fire PhaseChangedEvent(animating→active). Verify Animating→OpponentTurn + panel opens in spectator mode.
9. manage_editor stop. read_console errors → no NEW baseline beyond D.U1/D.U2/D.U3 carryover.

## Output
- Full log capture from steps 4-8.
- Pass/fail per step.

## STOP — no commit. REPORT.md follows.
```

---

## Bill checkpoints

| After | Action |
|---|---|
| Sub 1 | Confirm Mouse.current works. |
| Sub 4 | Optional UXML review. |
| Sub 6 | Code review ArenaAimController drag-aim mechanic. |
| Sub 9 | Mock smoke + (optional) live drag check. Decide D.U4a close. |

## Notes
- Pre-commit hook fail → NEW commit, no `--amend`.
- MCP unavailable → pause + report.
- Live drag smoke is OPTIONAL post-Sub-9 Bill manual check.
