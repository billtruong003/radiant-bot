# D.U7 — Juice pass · OPUS_PROMPTS

> Mode: Opus sequential auto-run (D.U4/D.U5/D.U6 precedent).
> Each prompt is self-contained — re-pasteable per sub.

---

## Sub 1 — Verify baseline (read-only, NO commit)

```
Persona: arena-unity/SKILL.md. Lát D.U7 Stage 2 Sub 1.

## Read
- arena-unity/tasks/todo/D.U7-juice/PLAN.md §3, §6
- arena-unity/tasks/todo/D.U7-juice/SUBTASKS.md Sub 1

## Do
1. read_console types=["error"] → expect 2 baseline (URP missing types + BillInspector dup).
2. Grep "Bill\\.Timer\\.Delay.*unscaled|unscaled:\\s*true" Assets/ → expect 0 prior consumers.
3. Grep "Random\\.insideUnitSphere|Camera\\.main\\.transform" Assets/RadiantArena → expect no existing camera shake.
4. Grep "scaleMode" Assets/RadiantArena Assets/BillGameCore → confirm no PanelSettings.scaleMode override.
5. execute_code (codedom): one-line probe — Camera.main null? Time.unscaledTime accessible?

## Output (post to Bill, no edit)
- baseline status
- prior unscaled-timer consumer count (expect 0)
- prior camera-shake consumer count (expect 0)
- PanelSettings.scaleMode default? (expect ConstantPixelSize)
- Camera.main + Time.unscaledTime ✅/❌

## STOP — no commit.
```

---

## Sub 2 — CameraShaker

```
Persona: SKILL.md. Lát D.U7 Sub 2.

## Read
- SUBTASKS.md Sub 2 (full code verbatim)
- PLAN.md §6.1, §6.2 (hand-rolled rationale, envelope design)

## Do
- Create Assets/RadiantArena/Scripts/Juice/CameraShaker.cs verbatim per SUBTASKS.
- Static class. Shake(intensity, duration) captures Camera.main origin (re-uses if mid-shake), kills any in-flight tween, starts BillTween.Float(1→0, duration) callback applying Random.insideUnitSphere offset; OnComplete restores origin.
- refresh_unity scope=all mode=force; read_console types=["error"] → zero new.

## Commit
feat(arena-unity/Lát-D.U7): add CameraShaker — hand-rolled position jitter on Camera.main via BillTween envelope

## STOP
```

---

## Sub 3 — HitStop

```
Persona: SKILL.md. Lát D.U7 Sub 3.

## Read
- SUBTASKS.md Sub 3 (full code)
- PLAN.md §6.3 (reentry-safe Max-deadline design)

## Do
- Create Assets/RadiantArena/Scripts/Juice/HitStop.cs verbatim.
- Static class. Trigger(durationMs) sets Time.timeScale=0.05, schedules Bill.Timer.Delay(..., unscaled=true) restore. Reentry: compute Max(existing deadline, now+new dur). TryRestore short-circuits if a newer Trigger pushed the deadline.
- refresh_unity scope=scripts; read_console types=["error"] → zero new.

## Commit
feat(arena-unity/Lát-D.U7): add HitStop — Time.timeScale toggle with reentry-safe unscaled restore

## STOP
```

---

## Sub 4 — DamageNumberLayer

```
Persona: SKILL.md. Lát D.U7 Sub 4.

## Read
- SUBTASKS.md Sub 4 (3 files verbatim: UXML, USS, .cs)
- PLAN.md §6.4, §6.5, §6.6 (panel design, world→screen→panel coord, 3-phase tween)

## Do
- Create Assets/RadiantArena/UI/Resources/DamageNumberLayer.uxml (empty fullscreen root).
- Create Assets/RadiantArena/UI/Resources/damage_number.uss (.damage-number + .damage-number.crit).
- Create Assets/RadiantArena/UI/DamageNumberLayer.cs:
  - BasePanel; Build loads UXML + USS, sets root pickingMode=Ignore.
  - Spawn(worldPos, dmg, isCrit): WorldToScreenPoint (skip if z≤0), flip Y, attach Label with .damage-number (+ .crit if crit), inline left/top + initial scale 0.
  - Single BillTween.Float(0→1, 0.76s) drives 3-phase transform inline (scale 0→1.2 in 0-0.105, scale 1.2→1.0 in 0.105-0.21, drift up 60px + fade in 0.21-1.0). OnComplete removes label from hierarchy.
- refresh_unity scope=all mode=force; read_console zero new.

## Commit
feat(arena-unity/Lát-D.U7): add DamageNumberLayer BasePanel + UXML + USS — runtime Label spawn with pop/drift/fade tween

## STOP
```

---

## Sub 5 — JuicePresenter

```
Persona: SKILL.md. Lát D.U7 Sub 5.

## Read
- SUBTASKS.md Sub 5 (full code)
- PLAN.md §6.7 (singleton boot pattern), §6.8 (intensity constants), §6.9 (hit-stop durations), §6.10 (wall bounce = shake only)

## Do
- Create Assets/RadiantArena/Scripts/Juice/JuicePresenter.cs:
  - MonoBehaviour singleton (Instance + DontDestroyOnLoad — NetClient.Awake pattern).
  - Awake subscribes PlayerHitEvent + WallBounceEvent.
  - OnPlayerHit: CameraShaker.Shake(crit?0.60:0.30, 0.25s), HitStop.Trigger(crit?120:60ms), DamageNumberLayer.Spawn (guard with IsOpen — log warning if closed).
  - OnWallBounce: CameraShaker.Shake(0.15, 0.15s) only.
  - OnDestroy unsubscribes + clears Instance.
- refresh_unity scope=scripts; read_console zero new.

## Commit
feat(arena-unity/Lát-D.U7): add JuicePresenter — central PlayerHit/WallBounce dispatcher → shake/hit-stop/damage-number

## STOP
```

---

## Sub 6 — Wire bootstrap + state lifecycle

```
Persona: SKILL.md. Lát D.U7 Sub 6.

## Read
- SUBTASKS.md Sub 6 (edits 6a-6d)

## Do
- Edit ArenaBootstrap.InitArena (6a): between ArenaStates.Register() and Bill.State.GoTo<BootState>(), spawn JuicePresenter GameObject (guarded by Instance == null check).
- Edit CountdownState.Enter (6b): open DamageNumberLayer alongside HudPanel (guarded by IsOpen check).
- Edit EndState.Enter (6c): close DamageNumberLayer alongside HudPanel close.
- Edit LobbyState.Enter (6d): defensive close DamageNumberLayer in the existing defensive block.
- refresh_unity scope=scripts; read_console zero new.

## Commit
feat(arena-unity/Lát-D.U7): wire JuicePresenter spawn in ArenaBootstrap + DamageNumberLayer open/close lifecycle (Countdown/End/Lobby)

## STOP
```

---

## Sub 7 — Mock smoke (NO commit)

```
Persona: SKILL.md. Lát D.U7 Sub 7.

## Pre
- manage_editor stop then play (fresh Bill).
- compiler="codedom" for every execute_code.
- ArenaStates.Register() explicit before any state GoTo.

## Do
1. read_console clear.
2. Step A — execute_code: register + prime ArenaContext + inject MyPlayer/OpponentPlayer snapshots + GoTo<CountdownState>. Probe: HudPanel.IsOpen + DamageNumberLayer.IsOpen + read_console log includes [Juice] JuicePresenter ready.
3. Probe Camera.main.transform.position as origin reference (save value).
4. Step B (hit event) — fire PlayerHitEvent { damage=25, isCrit=false, victimId="opp", point=Vector3(2,0,0) }. Inside same execute_code, probe:
   - Time.timeScale == 0.05f
   - Camera.main.transform.position != origin
   - DamageNumberLayer root has 1 child Label with text "25" and no .crit class
5. Bash sleep 0.15s. Probe Time.timeScale == 1f (hit-stop restored).
6. Bash sleep 0.3s. Probe Camera shake near origin again.
7. Step C (crit) — fire PlayerHitEvent { damage=80, isCrit=true, point=Vector3(-1,0,1) }. Probe Time.timeScale=0.05, child count=2, last child has .crit class.
8. Bash sleep 0.3s. Probe Time.timeScale=1f.
9. Step D (wall bounce) — fire WallBounceEvent { point=Vector3(3,0,0) }. Probe Camera deviates briefly, Time.timeScale stays 1f, child count unchanged.
10. Bash sleep 1s. Probe DamageNumberLayer child count=0 (all faded + removed), Camera near origin.
11. manage_editor stop. read_console types=["error"] → 0.

## Output
- Log capture for steps 2-10.
- Pass/fail per probe (Time.timeScale + camera deviation + label count + class swap).

## STOP — no commit. Stage 4 REPORT follows.

## Fallback
- If BillTween doesn't tick during hit-stop (timeScale 0.05): expected behavior, shake decay slows = punchy feel. Document.
- If label position appears at wrong screen coord — verify Y-flip: panelY = Screen.height - screen.y.
- If PanelSettings.scaleMode turns out NOT to be ConstantPixelSize (Sub 1 baseline): swap label position math to RuntimePanelUtils.ScreenToPanel.
```

---

## Bill checkpoints

| After | Action |
|---|---|
| Sub 1 | Confirm Camera.main + unscaled timer + scaleMode assumptions. |
| Sub 3 | (Optional) Eyeball HitStop reentry logic — easy to get wrong. |
| Sub 4 | (Optional) Sanity-check 3-phase tween math (0.105 / 0.21 / 1.0 segment boundaries). |
| Sub 7 | Mock smoke logs match expected; D.U7a closes; optional manual feel-check pass next. |

## Notes
- D.U7a's DoD per TASKS.md is **subjective feel** ("feels punchy"). Mock smoke verifies wiring only. After Sub 7 close, Bill manually plays + replays D.U5 trajectory smoke to feel hit/crit. Iterate constants in JuicePresenter (intensity/duration) if needed before D.U7b.
- D.U7b waits on: D.U8 weapon prefab (anticipation), SFX pack (audio), URP Volume profile (color flash). Open the next Lát only after those drop.
- Pre-commit hook fail → NEW commit per global rule.
