# D.U3 — LobbyPanel + weapon pick UI · OPUS_PROMPTS

> Mode for this Lát: **sequential auto-run** (Bill explicit override of 1-sub-per-invocation hard rule, same as D.U2). Prompts kept terse — detail lives in `SUBTASKS.md`, architecture in `PLAN.md`.
> Each prompt block remains paste-able if the auto-run is interrupted and a single sub needs to be re-run by hand.

---

## Sub 1 — Verify baseline (read-only, NO commit)

```
Persona: arena-unity/SKILL.md. Lát D.U3 Stage 2 Sub 1.

## Read
- arena-unity/tasks/todo/D.U3-lobby-panel/PLAN.md §3, §5 (BillGameCore + UI Toolkit APIs)
- arena-unity/tasks/todo/D.U3-lobby-panel/SUBTASKS.md Sub 1
- Assets/BillGameCore/Runtime/Services/CoreServices.cs (BasePanel + UIService)

## Do
1. read_console types=["error"] → empty.
2. Spot-check BasePanel + Bill.UI.Open<T> signatures still match SUBTASKS Sub 5 skeleton.
3. find_in_file over Colyseus SDK ArraySchema.cs → confirm enumeration pattern (foreach <T> or .GetItems()).
4. Confirm Resources folder convention — any Assets/.../Resources/ path works.

## Output
- ✅ / ❌ per item. Flag if BasePanel.Build / Q<T> / ListView.bindItem signatures drifted from skeleton.

## STOP
No file change, no commit.
```

---

## Sub 2 — Extend ArenaContext (WeaponSnapshot + AvailableWeapons hydration)

```
Persona: SKILL.md. Lát D.U3 Sub 2.

## Read
- SUBTASKS.md Sub 2 (WeaponSnapshot spec)
- Assets/RadiantArena/Scripts/Net/ArenaContext.cs (existing — keep all D.U2 fields)

## Do
- Edit ArenaContext.cs. Add WeaponSnapshot class. Extend PlayerSnapshot ctor to hydrate AvailableWeapons + LockedWeapon from PlayerSchema.
- Sub 1's ArraySchema enumeration result drives the foreach syntax.
- refresh_unity + read_console types=["error"] zero.

## Commit
feat(arena-unity/Lát-D.U3): extend ArenaContext with WeaponSnapshot + available_weapons hydration

## STOP
```

---

## Sub 3 — LobbyPanel.uxml

```
Persona: SKILL.md. Lát D.U3 Sub 3.

## Read
- SUBTASKS.md Sub 3 (UXML structure)

## Do
- Create Assets/RadiantArena/UI/Resources/LobbyPanel.uxml exactly per the structure in SUBTASKS.md Sub 3.
- refresh_unity + read_console zero errors (UXML import errors would land here).

## Commit
feat(arena-unity/Lát-D.U3): add LobbyPanel.uxml under UI/Resources

## STOP
```

---

## Sub 4 — lobby.uss

```
Persona: SKILL.md. Lát D.U3 Sub 4.

## Read
- SUBTASKS.md Sub 4 (style targets)

## Do
- Create Assets/RadiantArena/UI/Resources/lobby.uss per the style targets listed.
- Keep minimal — dark glassy theme, no animations, font sizes 14-24px.
- refresh_unity + read_console zero errors.

## Commit
feat(arena-unity/Lát-D.U3): add lobby.uss under UI/Resources

## STOP
```

---

## Sub 5 — LobbyPanel.cs (BasePanel impl)

```
Persona: SKILL.md. Lát D.U3 Sub 5.

## Read
- SUBTASKS.md Sub 5 (full skeleton)
- PLAN.md §6.1 (UXML+USS pattern), §6.5 (opponent poll cadence)

## Do
- Create Assets/RadiantArena/UI/LobbyPanel.cs per Sub 5 skeleton verbatim.
- All Q lookups null-guarded.
- refresh_unity + read_console zero errors.

## Commit
feat(arena-unity/Lát-D.U3): add LobbyPanel BasePanel with ListView + event surface

## STOP
```

---

## Sub 6 — LobbyState.cs

```
Persona: SKILL.md. Lát D.U3 Sub 6.

## Read
- SUBTASKS.md Sub 6 (skeleton)
- PLAN.md §6.4 (typed payloads), §6.8 (phase=countdown stub)

## Do
- Create Assets/RadiantArena/Scripts/States/LobbyState.cs per Sub 6 skeleton.
- Verify it compiles standalone — actual transition wiring happens in Sub 7.
- refresh_unity + read_console zero errors.

## Commit
feat(arena-unity/Lát-D.U3): add LobbyState wiring panel events to NetClient.Send

## STOP
```

---

## Sub 7 — Wire ConnectingState→LobbyState + register

```
Persona: SKILL.md. Lát D.U3 Sub 7.

## Read
- SUBTASKS.md Sub 7 (2 edits)

## Do
- Edit ConnectingState.cs per Sub 7a (add _onPhase field + subscribe + transition on newPhase=="lobby").
- Edit ArenaStates.cs per Sub 7b (append AddState(new LobbyState())).
- refresh_unity + read_console zero errors.

## Commit
feat(arena-unity/Lát-D.U3): wire ConnectingState→LobbyState on phase=lobby + register LobbyState

## STOP
```

---

## Sub 8 — Mock smoke (NO commit)

```
Persona: SKILL.md. Lát D.U3 Sub 8.

## Pre
- Bootstrap.unity is the active scene (D.U2 close left it that way).
- No arena-server needed.

## Do
1. read_console clear.
2. manage_editor play. Wait is_playing=true.
3. execute_code: populate ArenaContext.MyPlayer with 3 mock WeaponSnapshots (use reflection on the private setter), then Bill.State.GoTo<LobbyState>().
4. Verify logs:
   - "[Bill.State] ... -> Lobby"
   - "[Arena.Lobby] Opened LobbyPanel, 3 weapons available"
5. find_gameobjects for "[Bill.UI]" → check rootVisualElement has LobbyPanel as child.
6. execute_code: trigger LobbyPanel.OnReadyClicked manually (raise the C# event via reflection on the public EventInfo). Confirm "[Arena.Lobby] ready" log + "[Arena.Net] Send(ready) ignored — not connected" log.
7. Bill.State.GoTo<RadiantArena.States.ConnectingState>() → confirm LobbyState.Exit fires + panel disappears.
8. manage_editor stop.
9. Final read_console types=["error"] — no NEW errors beyond D.U1/D.U2 baseline.

## Output
- Full log capture.
- Pass/fail per step 4 and step 6.

## NO commit. Opus writes REPORT.md after.
```

---

## Bill checkpoints recap

| After | Bill action |
|---|---|
| Sub 1 | Confirm BasePanel API still matches assumption — quick skim. |
| Sub 3 | Optional visual sanity on UXML structure. |
| Sub 5 | Optional code review of LobbyPanel. |
| Sub 8 | Decide D.U3a close vs extend to D.U3b (only if arena-server D.3/D.4 ship in the meantime). |

## Notes
- 1 commit per sub except Sub 1 + Sub 8 (verify-only).
- Pre-commit hook fail → fix root, NEW commit.
- MCP unavailable mid-run → pause, report to Bill, don't silent-fallback.
